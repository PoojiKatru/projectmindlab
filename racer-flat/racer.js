/* Apex — a pseudo-3D racer.
 *
 * The road is a list of short segments, each with a curve and a height. Every
 * frame the camera sits a little behind the car and each segment ahead is
 * projected to the screen; drawing them far-to-near gives the hills, crests and
 * corners. It is the Pole Position / OutRun approach, not a 3D engine, but the
 * physics underneath — grip, understeer, centrifugal push, slipstream — behave
 * like driving rather than like steering a sprite.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d', { alpha: false });
  const W = cv.width, H = cv.height;

  // ---------- track constants ----------
  const SEG = 200;                 // length of one road segment
  const RUMBLE = 3;                // segments per rumble stripe
  const ROAD_W = 2200;             // half-width of the road
  const LANES = 3;
  const FOV = 100;
  const CAM_H = 1100;
  const DRAW = 260;                // segments drawn ahead
  const CENTRIFUGAL = 0.32;
  const LAPS = 3;
  const FIELD = 5;                 // rival cars

  const MAX_SPEED = SEG * 60;      // one segment per frame at 60fps
  const ACCEL = MAX_SPEED / 5.2;
  const BRAKE = -MAX_SPEED / 1.6;
  const DECEL = -MAX_SPEED / 5.5;
  const OFF_DECEL = -MAX_SPEED / 1.9;
  const OFF_LIMIT = MAX_SPEED / 3.6;

  const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);

  // ---------- state ----------
  let segments = [], trackLength = 0, cars = [];
  let pos = 0, playerX = 0, speed = 0, running = false, started = false;
  let lap = 1, lapTime = 0, best = null, lastLap = null, raceOver = false;
  let steer = 0, keys = {}, loopId = 0, raf = null, last = 0, fpsT = 0, fpsN = 0;
  let shake = 0, countdown = 0;
  try { best = parseFloat(localStorage.getItem('apex.best')) || null; } catch (e) {}

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- track building ----------
  const HILL = { none: 0, low: 20, med: 40, high: 60 };
  const CURVE = { none: 0, easy: 2, med: 4, hard: 6 };
  const LEN = { short: 25, med: 50, long: 100 };

  function lastY() { return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y; }

  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n,
      p1: { world: { y: lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { y }, camera: {}, screen: {} },
      curve,
      sprites: [],
      cars: [],
      colour: Math.floor(n / RUMBLE) % 2 ? 'dark' : 'light',
    });
  }

  function addRoad(enter, hold, leave, curve, y) {
    const startY = lastY(), endY = startY + y * SEG;
    const total = enter + hold + leave;
    const ease = (a, b, p) => a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5);
    for (let i = 0; i < enter; i++) addSegment(ease(0, curve, i / enter), ease(startY, endY, i / total));
    for (let i = 0; i < hold; i++) addSegment(curve, ease(startY, endY, (enter + i) / total));
    for (let i = 0; i < leave; i++) addSegment(ease(curve, 0, i / leave), ease(startY, endY, (enter + hold + i) / total));
  }

  const straight = (n = LEN.med) => addRoad(n, n, n, 0, 0);
  const curveR = (n, c, h) => addRoad(n, n, n, c, h);
  const hill = (n, h) => addRoad(n, n, n, 0, h);

  function buildTrack() {
    segments = [];
    straight(LEN.short);
    curveR(LEN.med, CURVE.easy, HILL.none);       // turn 1, gentle right
    hill(LEN.med, HILL.med);                       // crest
    curveR(LEN.med, -CURVE.med, -HILL.low);        // long left, downhill
    straight(LEN.med);
    curveR(LEN.med, CURVE.hard, HILL.none);        // hairpin right
    curveR(LEN.short, -CURVE.easy, HILL.low);
    hill(LEN.med, -HILL.high);                     // plunge
    curveR(LEN.med, -CURVE.hard, HILL.med);        // uphill left
    straight(LEN.short);
    curveR(LEN.med, CURVE.med, -HILL.med);
    curveR(LEN.med, -CURVE.easy, HILL.none);
    straight(LEN.long);                            // main straight

    // scenery: alternating trees and boards down each side
    for (let n = 20; n < segments.length; n += 6) {
      const side = Math.random() < 0.5 ? -1 : 1;
      segments[n].sprites.push({ offset: side * rnd(1.35, 3.2), kind: Math.random() < 0.22 ? 'board' : 'tree' });
      if (Math.random() < 0.35)
        segments[n].sprites.push({ offset: -side * rnd(1.4, 3.0), kind: 'tree' });
    }
    // start/finish gantry
    segments[3].sprites.push({ offset: 0, kind: 'gantry' });

    trackLength = segments.length * SEG;
  }

  const findSeg = (z) => segments[Math.floor(z / SEG) % segments.length];

  // ---------- rivals ----------
  function resetCars() {
    cars = [];
    for (let i = 0; i < FIELD; i++) {
      // Grid ahead of the player, not behind: placing them near the end of the
      // lap made position() read them as a full lap up, so you started last and
      // could never be anything else.
      cars.push({
        z: (i + 1) * SEG * 7,
        offset: (i % 2 ? 1 : -1) * rnd(0.32, 0.62),
        speed: MAX_SPEED * rnd(0.80, 0.92),
        hue: [8, 44, 200, 280, 150][i % 5],
        lap: 1, prevZ: 0, name: ['VOSS', 'RAINE', 'KOVA', 'ADLER', 'SOLIS'][i % 5],
      });
    }
  }

  function updateCars(dt) {
    for (const c of cars) {
      const seg = findSeg(c.z);
      // rivals lift for corners and drift toward the apex
      const target = clamp(c.offset - seg.curve * 0.07, -0.85, 0.85);
      c.offset = lerp(c.offset, target, 0.05);
      const corner = 1 - Math.min(0.34, Math.abs(seg.curve) * 0.055);
      c.speed = lerp(c.speed, MAX_SPEED * rnd(0.80, 0.94) * corner, 0.02);
      c.prevZ = c.z;
      c.z = (c.z + dt * c.speed) % trackLength;
      if (c.z < c.prevZ) c.lap++;
    }
  }

  // ---------- physics ----------
  function update(dt) {
    if (countdown > 0) { countdown -= dt; if (countdown <= 0) started = true; }

    const seg = findSeg(pos + CAM_H * 0);
    const startPos = pos;
    const speedPct = speed / MAX_SPEED;

    if (started && !raceOver) {
      const left = keys.left, right = keys.right;
      steer = lerp(steer, (left ? -1 : 0) + (right ? 1 : 0), 0.22);
      // steering authority falls away with speed — you cannot flick it at 300
      playerX += steer * dt * 2.4 * (1 - speedPct * 0.42);
      // the corner pushes you out; the faster you go the more it pushes
      playerX -= seg.curve * speedPct * CENTRIFUGAL * dt * 3.6;

      if (keys.gas) speed += ACCEL * dt;
      else if (keys.brake) speed += BRAKE * dt;
      else speed += DECEL * dt;

      if (Math.abs(playerX) > 0.98 && speed > OFF_LIMIT) {
        speed += OFF_DECEL * dt;                       // off the tarmac
        shake = Math.min(1, shake + dt * 4);
      } else shake = Math.max(0, shake - dt * 3);
    } else {
      speed += DECEL * dt * (raceOver ? 1.6 : 0);
    }

    playerX = clamp(playerX, -2.4, 2.4);
    speed = clamp(speed, 0, MAX_SPEED);
    pos = (pos + dt * speed) % trackLength;

    // collision with rivals: a shunt scrubs speed
    if (started && !raceOver) {
      const pSeg = findSeg(pos);
      for (const c of pSeg.cars) {
        if (Math.abs(playerX - c.offset) < 0.62 && speed > c.speed * 0.9) {
          speed = c.speed * 0.62;
          playerX += (playerX > c.offset ? 1 : -1) * 0.18;
          shake = 1;
          break;
        }
      }
    }

    if (started && !raceOver) {
      lapTime += dt;
      if (pos < startPos) {                            // crossed the line
        if (lap >= LAPS) finish();
        else {
          lastLap = lapTime;
          if (best === null || lapTime < best) {
            best = lapTime;
            try { localStorage.setItem('apex.best', String(best)); } catch (e) {}
          }
          showSplit(lastLap);
          lap++; lapTime = 0;
        }
      }
    }

    updateCars(dt);
    for (const s of segments) s.cars.length = 0;
    for (const c of cars) findSeg(c.z).cars.push(c);
  }

  function position() {
    const mine = (lap - 1) * trackLength + pos;
    let ahead = 1;
    for (const c of cars) if ((c.lap - 1) * trackLength + c.z > mine) ahead++;
    return ahead;
  }

  // ---------- projection ----------
  function project(p, camX, camY, camZ) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = (p.world.y || 0) - camY;
    p.camera.z = (p.world.z || 0) - camZ;
    p.screen.scale = CAM_DEPTH / p.camera.z;
    p.screen.x = Math.round((W / 2) + (p.screen.scale * p.camera.x * W / 2));
    p.screen.y = Math.round((H / 2) - (p.screen.scale * p.camera.y * H / 2));
    p.screen.w = Math.round(p.screen.scale * ROAD_W * W / 2);
  }

  function poly(x1, y1, w1, x2, y2, w2, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x2 - w2, y2);
    ctx.lineTo(x2 + w2, y2); ctx.lineTo(x1 + w1, y1);
    ctx.closePath(); ctx.fill();
  }

  const PAL = {
    light: { road: '#6b6f76', grass: '#3f7a3a', rumble: '#f2f2f2', lane: '#e8e8e8' },
    dark:  { road: '#63676e', grass: '#3a7135', rumble: '#d2372c', lane: null },
  };

  // ---------- drawing ----------
  function drawSky(baseSeg, camY) {
    const horizon = H / 2 + (camY * 0.00004 * H);
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, '#1d3f77'); g.addColorStop(0.55, '#4f7fb8'); g.addColorStop(1, '#bcd3e6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon + 2);

    // haze band + distant ridge, parallaxed off the accumulated curve
    const off = -(pos * 0.00006 * W) % W;
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.fillRect(0, horizon - 46, W, 46);
    ctx.fillStyle = '#4a6b86';
    for (let i = -1; i < 3; i++) {
      const bx = off + i * (W / 2);
      ctx.beginPath();
      ctx.moveTo(bx, horizon);
      ctx.lineTo(bx + W * 0.10, horizon - 62);
      ctx.lineTo(bx + W * 0.20, horizon - 26);
      ctx.lineTo(bx + W * 0.31, horizon - 78);
      ctx.lineTo(bx + W * 0.44, horizon - 18);
      ctx.lineTo(bx + W * 0.5, horizon);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#2f5a3a';
    ctx.fillRect(0, horizon, W, H - horizon);
  }

  function drawSprite(kind, x, y, scale, offsetX) {
    const s = scale * W * 0.5;
    if (kind === 'tree') {
      const h = s * 2.6, w = s * 0.9;
      const px = x + offsetX * (w / 2) - w / 2;
      ctx.fillStyle = '#2c1d13'; ctx.fillRect(px + w * 0.4, y - h * 0.3, w * 0.2, h * 0.3);
      ctx.fillStyle = '#1f5c2a';
      ctx.beginPath();
      ctx.moveTo(px + w / 2, y - h); ctx.lineTo(px + w, y - h * 0.24); ctx.lineTo(px, y - h * 0.24);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a7a38';
      ctx.beginPath();
      ctx.moveTo(px + w / 2, y - h * 0.86); ctx.lineTo(px + w * 0.86, y - h * 0.36); ctx.lineTo(px + w * 0.14, y - h * 0.36);
      ctx.closePath(); ctx.fill();
    } else if (kind === 'board') {
      const w = s * 2.1, h = s * 1.1;
      const px = x + offsetX * (w / 2) - w / 2;
      ctx.fillStyle = '#3a3f48'; ctx.fillRect(px + w * 0.44, y - h * 0.5, w * 0.06, h * 0.5);
      ctx.fillStyle = '#e8eaee'; ctx.fillRect(px, y - h * 1.5, w, h);
      ctx.fillStyle = '#ff3b30'; ctx.fillRect(px + w * 0.06, y - h * 1.42, w * 0.88, h * 0.2);
      ctx.fillStyle = '#12161d'; ctx.fillRect(px + w * 0.06, y - h * 1.1, w * 0.5, h * 0.16);
    } else if (kind === 'gantry') {
      const w = s * 7, h = s * 3.2;
      const px = x - w / 2;
      ctx.fillStyle = '#2b3140';
      ctx.fillRect(px, y - h, s * 0.5, h); ctx.fillRect(px + w - s * 0.5, y - h, s * 0.5, h);
      ctx.fillRect(px, y - h, w, s * 0.9);
      ctx.fillStyle = '#f2f2f2';
      for (let i = 0; i < 10; i++) ctx.fillRect(px + i * (w / 10), y - h + (i % 2 ? s * 0.45 : 0), w / 10, s * 0.45);
    }
  }

  function drawCar(c, x, y, scale, tilt) {
    const w = scale * W * 0.5 * 1.5, h = w * 0.52;
    const px = x - w / 2, py = y - h;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(x, y, w * 0.52, h * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    const body = `hsl(${c.hue},72%,52%)`, dark = `hsl(${c.hue},72%,38%)`;
    ctx.fillStyle = dark; ctx.fillRect(px, py + h * 0.52, w, h * 0.48);           // lower body
    ctx.fillStyle = body; ctx.fillRect(px + w * 0.06, py + h * 0.18, w * 0.88, h * 0.42);
    ctx.fillStyle = '#10151d';                                                     // glass
    ctx.fillRect(px + w * 0.24, py + h * 0.06, w * 0.52, h * 0.3);
    ctx.fillStyle = '#0c0f14';                                                     // tyres
    ctx.fillRect(px - w * 0.02, py + h * 0.62, w * 0.16, h * 0.4);
    ctx.fillRect(px + w * 0.86, py + h * 0.62, w * 0.16, h * 0.4);
    ctx.fillStyle = '#ff5b4a';                                                     // lights
    ctx.fillRect(px + w * 0.1, py + h * 0.62, w * 0.14, h * 0.12);
    ctx.fillRect(px + w * 0.76, py + h * 0.62, w * 0.14, h * 0.12);
    if (tilt) { ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(px, py + h * 0.18, w * 0.1, h * 0.42); }
  }

  function drawPlayer(speedPct, updown) {
    const bounce = (Math.random() * 2 - 1) * shake * 6 + Math.sin(pos * 0.0009) * 1.4;
    const w = W * 0.30, h = w * 0.46;
    const x = W / 2 - w / 2 + steer * W * 0.012;
    const y = H - h * 1.06 + bounce + updown * 8;

    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.ellipse(W / 2, y + h * 0.98, w * 0.48, h * 0.11, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#12161d'; ctx.fillRect(x, y + h * 0.52, w, h * 0.44);          // body lower
    ctx.fillStyle = '#e8e8ea'; ctx.fillRect(x + w * 0.05, y + h * 0.2, w * 0.9, h * 0.4);
    ctx.fillStyle = '#ff3b30'; ctx.fillRect(x + w * 0.05, y + h * 0.2, w * 0.9, h * 0.09);
    ctx.fillStyle = '#0b0e13'; ctx.fillRect(x + w * 0.22, y + h * 0.04, w * 0.56, h * 0.22);  // rear glass
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(x - w * 0.03, y + h * 0.6, w * 0.19, h * 0.42);                    // tyres
    ctx.fillRect(x + w * 0.84, y + h * 0.6, w * 0.19, h * 0.42);
    ctx.fillStyle = '#2a2f38'; ctx.fillRect(x + w * 0.12, y - h * 0.06, w * 0.76, h * 0.11); // wing
    ctx.fillStyle = speedPct > 0.02 ? '#ff2d20' : '#7a1a14';                        // brake lights
    ctx.fillRect(x + w * 0.1, y + h * 0.64, w * 0.16, h * 0.1);
    ctx.fillRect(x + w * 0.74, y + h * 0.64, w * 0.16, h * 0.1);
  }

  function render() {
    const base = findSeg(pos), basePct = (pos % SEG) / SEG;
    const camY = CAM_H + base.p1.world.y + (base.p2.world.y - base.p1.world.y) * basePct;
    let maxY = H, x = 0, dx = -(base.curve * basePct);

    drawSky(base, camY);

    // far to near, painting each strip
    for (let n = 0; n < DRAW; n++) {
      const s = segments[(base.index + n) % segments.length];
      const looped = s.index < base.index;
      project(s.p1, (playerX * ROAD_W) - x, camY, pos - (looped ? trackLength : 0));
      project(s.p2, (playerX * ROAD_W) - x - dx, camY, pos - (looped ? trackLength : 0));
      x += dx; dx += s.curve;

      if (s.p1.camera.z <= CAM_DEPTH || s.p2.screen.y >= s.p1.screen.y || s.p2.screen.y >= maxY) continue;

      const c = PAL[s.colour];
      const p1 = s.p1.screen, p2 = s.p2.screen;
      poly(0, p1.y, W, 0, p2.y, W, c.grass);                                    // grass strip
      const r1 = p1.w / Math.max(6, 12 - n * 0.04), r2 = p2.w / Math.max(6, 12 - n * 0.04);
      poly(p1.x, p1.y, p1.w + r1, p2.x, p2.y, p2.w + r2, c.rumble);             // rumble
      poly(p1.x, p1.y, p1.w, p2.x, p2.y, p2.w, c.road);                         // tarmac
      if (c.lane) {                                                             // lane markers
        const l1 = p1.w / 44, l2 = p2.w / 44, lw1 = (p1.w * 2) / LANES, lw2 = (p2.w * 2) / LANES;
        let lx1 = p1.x - p1.w + lw1, lx2 = p2.x - p2.w + lw2;
        for (let i = 1; i < LANES; i++, lx1 += lw1, lx2 += lw2)
          poly(lx1, p1.y, l1, lx2, p2.y, l2, c.lane);
      }
      maxY = p1.y;
    }

    // near to far for sprites and cars, so close things overlap far ones
    for (let n = DRAW - 1; n > 0; n--) {
      const s = segments[(base.index + n) % segments.length];
      for (const c of s.cars) {
        const pct = ((c.z % SEG) / SEG);
        const sx = lerp(s.p1.screen.x, s.p2.screen.x, pct);
        const sy = lerp(s.p1.screen.y, s.p2.screen.y, pct);
        const sc = lerp(s.p1.screen.scale, s.p2.screen.scale, pct);
        if (!isFinite(sx) || sc <= 0) continue;
        drawCar(c, sx + sc * c.offset * ROAD_W * W / 2, sy, sc, true);
      }
      for (const sp of s.sprites) {
        const sc = s.p1.screen.scale, sx = s.p1.screen.x, sy = s.p1.screen.y;
        if (!isFinite(sx) || sc <= 0) continue;
        drawSprite(sp.kind, sx + sc * sp.offset * ROAD_W * W / 2, sy, sc, sp.offset < 0 ? -1 : 1);
      }
    }

    drawPlayer(keys.brake ? 1 : 0, Math.sin(pos * 0.0021) * (speed / MAX_SPEED));
    if (shake > 0.02) {                                                         // off-track dust
      ctx.fillStyle = `rgba(190,170,120,${(shake * 0.16).toFixed(3)})`;
      ctx.fillRect(0, H * 0.62, W, H * 0.38);
    }
  }

  // ---------- HUD ----------
  const fmt = (t) => {
    if (t == null) return '—:—.—';
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
  };

  function drawTacho(pct, gear) {
    const t = $('tacho'), g = t.getContext('2d'), S = t.width, r = S / 2 - 14;
    g.clearRect(0, 0, S, S);
    g.lineWidth = 12; g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,.10)';
    g.beginPath(); g.arc(S / 2, S / 2, r, Math.PI * 0.76, Math.PI * 2.24); g.stroke();
    const end = Math.PI * 0.76 + (Math.PI * 1.48) * clamp(pct, 0, 1);
    g.strokeStyle = pct > 0.88 ? '#ff3b30' : pct > 0.68 ? '#ffcc00' : '#39d98a';
    g.beginPath(); g.arc(S / 2, S / 2, r, Math.PI * 0.76, end); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * 0.76 + (Math.PI * 1.48) * (i / 8);
      g.beginPath();
      g.moveTo(S / 2 + Math.cos(a) * (r - 12), S / 2 + Math.sin(a) * (r - 12));
      g.lineTo(S / 2 + Math.cos(a) * (r - 3), S / 2 + Math.sin(a) * (r - 3));
      g.stroke();
    }
  }

  function hud() {
    const pct = speed / MAX_SPEED;
    const kph = Math.round(pct * 312);
    const gear = clamp(Math.ceil(pct * 6), 1, 6);
    $('kph').textContent = kph;
    $('gear').textContent = gear;
    $('lap').innerHTML = `${Math.min(lap, LAPS)}<i>/${LAPS}</i>`;
    $('pos').innerHTML = `${position()}<i>/${FIELD + 1}</i>`;
    $('cur').textContent = fmt(lapTime);
    $('best').textContent = fmt(best);
    drawTacho(pct, gear);
  }

  let splitTimer = 0;
  function showSplit(t) {
    const el = $('split');
    const delta = best === null ? 0 : t - best;
    el.textContent = (delta <= 0 ? '−' : '+') + fmt(Math.abs(delta)).replace('0:', '');
    el.className = 'split show ' + (delta <= 0 ? 'down' : 'up');
    splitTimer = 3;
  }

  // ---------- flow ----------
  function reset() {
    buildTrack(); resetCars();
    pos = 0; playerX = 0; speed = 0; steer = 0; shake = 0;
    lap = 1; lapTime = 0; lastLap = null; raceOver = false; started = false;
  }

  function startLoop() {
    if (raf) cancelAnimationFrame(raf);
    const id = ++loopId;
    last = performance.now();
    const run = (ts) => {
      if (id !== loopId || !running) return;
      let dt = (ts - last) / 1000;
      if (!(dt > 0)) dt = 1 / 60;
      dt = Math.min(0.05, dt);
      last = ts;
      try {
        update(dt);
        render();
        hud();
        if (splitTimer > 0) { splitTimer -= dt; if (splitTimer <= 0) $('split').className = 'split'; }
        fpsN++; fpsT += dt;
        if (fpsT >= 0.5) { $('fps').textContent = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
      } catch (err) {
        running = false;
        $('p-eyebrow').textContent = 'Something broke';
        $('p-title').textContent = 'It stopped.';
        $('p-text').textContent = String(err && err.message || err);
        $('panel').hidden = false;
        console.error('[apex]', err);
        return;
      }
      raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
  }

  function lights() {
    const box = $('lights'), bulbs = [...box.children];
    box.hidden = false; bulbs.forEach((b) => (b.className = ''));
    let i = 0;
    const step = () => {
      if (i < 5) { bulbs[i].className = 'on'; i++; setTimeout(step, 700); return; }
      bulbs.forEach((b) => (b.className = 'go'));
      started = true;
      say('Green. Go.');
      setTimeout(() => { box.hidden = true; }, 700);
    };
    setTimeout(step, 500);
  }

  function begin() {
    reset();
    running = true;
    $('panel').hidden = true; $('hud').hidden = false;
    startLoop(); lights();
  }

  function finish() {
    raceOver = true; started = false;
    const p = position();
    const rows = [{ n: 'YOU', t: best, you: true }]
      .concat(cars.map((c) => ({ n: c.name, t: null })));
    $('p-eyebrow').textContent = 'Chequered flag';
    $('p-title').textContent = p === 1 ? 'Won it.' : `P${p}.`;
    $('p-text').textContent = `${LAPS} laps done. Best lap ${fmt(best)}.`;
    $('p-keys').innerHTML = rows.slice(0, 4).map((r, i) =>
      `<div class="${r.you ? 'you' : ''}"><b>${i + 1}</b><span>${r.n}</span></div>`).join('');
    $('go').innerHTML = 'Race again <span aria-hidden="true">→</span>';
    $('panel').hidden = false;
    say(`Race over. Position ${p}.`);
  }

  const say = (t) => { $('say').textContent = t; };

  // ---------- input ----------
  const KEY = {
    ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') { begin(); return; }
    const k = KEY[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
    else if (e.code === 'Space' && $('panel').hidden === false) { e.preventDefault(); $('go').click(); }
  });
  addEventListener('keyup', (e) => { const k = KEY[e.code]; if (k) { keys[k] = false; e.preventDefault(); } });
  addEventListener('blur', () => { keys = {}; });

  const hold = (id, k) => {
    const el = $(id);
    const on = (e) => { e.preventDefault(); keys[k] = true; };
    const off = (e) => { e.preventDefault(); keys[k] = false; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  };
  hold('p-gas', 'gas'); hold('p-brake', 'brake');
  hold('p-left', 'left'); hold('p-right', 'right');

  $('go').addEventListener('click', begin);
  addEventListener('error', (e) => {
    $('p-title').textContent = 'It stopped.';
    $('p-text').textContent = String(e.message || e.error);
    $('panel').hidden = false;
  });

  // ---------- boot ----------
  reset();
  render();
  $('best').textContent = fmt(best);
})();
