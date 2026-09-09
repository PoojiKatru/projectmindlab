/* The runner — an endless runner. You are Σ. Jump the cash on the ground,
   duck the cash in the air.

   Levels are data, not code, so adding level two is a new entry in LEVELS
   rather than a new branch in the draw loop. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // If anything throws, say so on the page. A silent failure here looks
  // identical to "the button does nothing", which is impossible to report.
  function fail(where, err) {
    const msg = `${where}: ${err && err.message ? err.message : err}`;
    try {
      $('over-eyebrow').textContent = 'Something broke';
      $('over-title').textContent = 'It stopped.';
      $('over-text').textContent = msg;
      $('overlay').hidden = false;
    } catch (e) { /* nothing left to report with */ }
    console.error('[city dash]', msg, err);
  }
  addEventListener('error', (e) => fail('load', e.error || e.message));
  const cv = $('c'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, GROUND = 268;

  // Nine cities, each pinned to the hour it actually looks best. Night cities get
  // stars, a moon and lit windows; day cities get a sun, real clouds and mostly
  // dark glass. Everything else is palette.
  const SPAN = 170;                                   // metres per city
  const LEVELS = [
    { id:'nyc', name:'New York', night:true,
      sky:['#171a4a','#1e2358','#282e6b','#343b7d'],
      towerFar:'#252a5e', towerMid:'#2b3068', stone:['#6d5a46','#7d6a52','#5d4c3c'], trim:'#8a7660',
      gold:'#f6c95f', goldHot:'#ffe6a0', coldWin:'#8fc0f0',
      road:'#141634', kerb:'#3a3a5e', walk:'#232544', tree:['#1c4a33','#276b46'],
      signs:['WALL ST','BROAD ST','NASSAU ST'], mark:'bull', ticker:true },

    { id:'sfo', name:'San Francisco', night:false,
      sky:['#e8825c','#f2a878','#f8caa0','#fbe3c8'],   // fog burning off at sunset
      towerFar:'#9a8aa4', towerMid:'#7d7090', stone:['#d9a49c','#e9c6b2','#c79690'], trim:'#f6e2cf',
      gold:'#ffd9a0', goldHot:'#fff2da', coldWin:'#b9cfe4',
      road:'#5d4d58', kerb:'#8d7a84', walk:'#7b6b74', tree:['#3f6b4a','#5b8d63'],
      signs:['MARKET ST','LOMBARD ST','CASTRO'], mark:'bridge', fog:true },

    { id:'lon', name:'London', night:false,
      sky:['#5a6577','#6f7a8c','#8b95a4','#a8b0bb'],   // flat overcast dusk
      towerFar:'#4a5361', towerMid:'#3f4753', stone:['#6b5b52','#7a675c','#5b4d46'], trim:'#8d7b6e',
      gold:'#e8cf9a', goldHot:'#f6e6c2', coldWin:'#c2cedb',
      road:'#3c414a', kerb:'#666d78', walk:'#575d67', tree:['#33513c','#47694f'],
      signs:['FLEET ST','STRAND','CHEAPSIDE'], mark:'bigben', rain:true },

    { id:'dxb', name:'Dubai', night:true,
      sky:['#12183c','#243056','#5c4a55','#c98a4a'],   // desert night, heat still on the horizon
      towerFar:'#a8865f', towerMid:'#8f6f4c', stone:['#d8b483','#e7c99c','#c6a172'], trim:'#f0dcb8',
      gold:'#ffe8a8', goldHot:'#fffbe0', coldWin:'#7fd0f0',
      road:'#241c30', kerb:'#5c4a55', walk:'#33283c', tree:['#2f5236','#456b44'],
      signs:['SHEIKH ZAYED RD','AL FAHIDI','JUMEIRAH'], mark:'burj', sand:true },

    { id:'mia', name:'Miami', night:true,
      sky:['#2a2f6e','#6b4a94','#c96aa0','#f2a07e'],   // ocean drive, sun just gone
      towerFar:'#4a3f7a', towerMid:'#5c4a86', stone:['#f0dcc8','#e8c8d8','#cfe8e0'], trim:'#ff8fc4',
      gold:'#7ff0e0', goldHot:'#ffb8dc', coldWin:'#a8e8f0',
      road:'#2a2450', kerb:'#6b4a86', walk:'#3f3468', tree:['#2c6b4a','#3f8f5c'],
      signs:['OCEAN DR','COLLINS AVE','ESPANOLA WAY'], mark:'artdeco', palms:true, neon:true },

    { id:'tyo', name:'Tokyo', night:true,
      sky:['#160f2e','#221542','#31205a','#432c72'],   // neon bleeding into the sky
      towerFar:'#2a1c4a', towerMid:'#352257', stone:['#3f2c53','#4c3663','#33234a'], trim:'#6b4a86',
      gold:'#ff8fc4', goldHot:'#8ff0e8', coldWin:'#ffe36b',
      road:'#1a1230', kerb:'#4a2f6b', walk:'#2c1e4a', tree:['#2c5a44','#3f7a5c'],
      signs:['SHIBUYA','SHINJUKU','GINZA'], mark:'tokyotower', neon:true },

    { id:'bom', name:'Mumbai', night:false,
      sky:['#7a4a86','#c4685f','#ef9a5c','#f8caa0'],   // sunset over the Arabian Sea
      towerFar:'#9c8368', towerMid:'#846c53', stone:['#c9a276','#dcbb90','#b18c63'], trim:'#e8d0aa',
      gold:'#ffe0a8', goldHot:'#fff2d6', coldWin:'#a8c8dc',
      road:'#5f4c3a', kerb:'#94795c', walk:'#7f684f', tree:['#3d6b3a','#57894f'],
      signs:['MARINE DR','COLABA','FORT'], mark:'gateway' },

    { id:'sel', name:'Seoul', night:false,
      sky:['#5fa8d8','#86c0e4','#aed6ee','#d4eaf7'],   // crisp bright daylight
      towerFar:'#7e93a8', towerMid:'#68809a', stone:['#b8b0a4','#cbc4b8','#a49c90'], trim:'#dcd6cb',
      gold:'#dce8f0', goldHot:'#f0f6fa', coldWin:'#9fc4dd',
      road:'#5a606b', kerb:'#8d939c', walk:'#787e88', tree:['#2f6b3f','#469a57'],
      signs:['GANGNAM-DAERO','MYEONGDONG','HONGDAE'], mark:'nseoul', mountains:true },

    { id:'bkk', name:'Bangkok', night:false,
      sky:['#d97a4e','#ec9d63','#f5c187','#fadfb6'],   // temple gold at sunset
      towerFar:'#9c7550', towerMid:'#84603f', stone:['#c99a63','#dcb37e','#b0824f'], trim:'#f0d59a',
      gold:'#ffd870', goldHot:'#fff0b0', coldWin:'#a8ccd0',
      road:'#5f4632', kerb:'#96714c', walk:'#816044', tree:['#3a6b34','#548c48'],
      signs:['SUKHUMVIT','SILOM','KHAO SAN'], mark:'watarun' },

    { id:'pek', name:'Beijing', night:false,
      sky:['#b8956a','#cdae86','#dfc7a6','#eddcc4'],   // imperial haze
      towerFar:'#8a7a68', towerMid:'#736450', stone:['#9c4a3c','#b25a46','#843c30'], trim:'#d8b45a',
      gold:'#f0d089', goldHot:'#fae6b8', coldWin:'#b0c4c8',
      road:'#5a4d3e', kerb:'#8a7862', walk:'#786853', tree:['#3f5c34','#587a46'],
      signs:['CHANG AN AVE','QIANMEN','WANGFUJING'], mark:'pagoda' },
  ];
  LEVELS.forEach((L, i) => { L.from = i * SPAN; L.label = `${String(i + 1).padStart(2, '0')} / ${L.name}`; });

  // hex -> [r,g,b] and back, for blending one city's sky into the next
  const hex2 = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const mix = (a, b, k) => {
    const x = hex2(a), y = hex2(b);
    return `rgb(${Math.round(x[0]+(y[0]-x[0])*k)},${Math.round(x[1]+(y[1]-x[1])*k)},${Math.round(x[2]+(y[2]-x[2])*k)})`;
  };;;

  // ---------- state ----------
  const P = { x: 110, y: GROUND, vy: 0, w: 40, h: 46, duck: false, onGround: true };
  let obstacles = [], skyline = [], lamps = [], speed = 6, dist = 0, spawnIn = 90,
      running = false, over = false, paused = false, raf = null, last = 0, tick = 0, loopId = 0;
  let best = 0;
  try { best = parseInt(localStorage.getItem('mindlab.runner.best') || '0', 10) || 0; } catch (e) { best = 0; }

  let cityIdx = 0;
  const level = () => LEVELS[cityIdx];
  const cityAt = (m) => Math.max(0, Math.min(LEVELS.length - 1, Math.floor(m / SPAN)));
  // Last 45m of a city blend into the next, so the sky changes before the
  // buildings do and the handover does not snap.
  function skyAt(i) {
    const L = LEVELS[cityIdx], N = LEVELS[Math.min(LEVELS.length - 1, cityIdx + 1)];
    const into = dist - LEVELS[cityIdx].from, k = into > SPAN - 45 ? (into - (SPAN - 45)) / 45 : 0;
    return k > 0 ? mix(L.sky[i], N.sky[i], Math.min(1, k)) : L.sky[i];
  }
  const duckH = 26;

  // ---------- world building ----------
  const PX = 4;
  const snap = (n) => Math.round(n / PX) * PX;
  // Snap both edges, not the size. Snapping w/h separately from x/y let the far
  // edge cross a grid line on a different frame from the near edge, so shapes
  // visibly changed size by a pixel as they drifted.
  function blk(x, y, w, h, c) {
    const x0 = snap(x), y0 = snap(y);
    ctx.fillStyle = c;
    ctx.fillRect(x0, y0, Math.max(PX, snap(x + w) - x0), Math.max(PX, snap(y + h) - y0));
  }
  // Already grid-aligned: draw without re-snapping.
  function raw(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

  let stars = [], clouds = [], trees = [], props = [], moon = { x: W - 170, y: 54 };

  // Windows are baked in once so the lit pattern travels with its building.
  function makeBuilding(layer, x, w, h, city) {
    const street = layer === 2;
    const CL = LEVELS[city];
    const cols = Math.max(2, Math.floor((w - 10) / (street ? 16 : 13)));
    const rows = Math.max(2, Math.floor((h - (street ? 26 : 20)) / (street ? 20 : 15)));
    // Lights are on at night. By day most glass just reflects the sky.
    const on = CL.night ? (street ? 0.74 : layer === 1 ? 0.6 : 0.42)
                        : (street ? 0.30 : 0.10);
    const r = Math.random();
    const roof = street ? (r < 0.4 ? 'cornice' : 'flat')
      : r < 0.2 ? 'deco' : r < 0.36 ? 'spire' : r < 0.5 ? 'tank' : r < 0.6 ? 'mast' : 'flat';

    // Everything below is measured from the building's own top-left and snapped
    // once, here. At draw time only the origin is snapped, so windows can never
    // drift against the wall they are painted on.
    const top = snap(GROUND - h), wS = Math.max(PX, snap(w)), hS = GROUND - top;
    const padY = street ? 20 : 14;
    const cw = (w - 10) / cols, ch = (h - padY - (street ? 26 : 6)) / rows;
    const ww = Math.max(PX, snap(cw * 0.55)), wh = Math.max(PX, snap(ch * 0.5));
    const cells = [];
    for (let ri = 0; ri < rows; ri++) for (let ci = 0; ci < cols; ci++)
      cells.push({ dx: snap(5 + ci * cw), dy: snap(padY + ri * ch),
                   v: Math.random() < on ? (Math.random() < 0.12 ? 2 : 1) : 0 });

    const shops = [];
    if (street) for (let sx = 7; sx < w - 10; sx += 16)
      shops.push({ dx: snap(sx), dark: Math.random() < 0.10 });
    const awning = street && Math.random() < 0.55
      ? ['#8d3a3a', '#2f5a46', '#2f4a7a', '#7a5a2f'][Math.floor(Math.random() * 4)] : null;
    const flag = street && Math.random() < 0.22;

    return { layer, x, w, h, roof, street, top, wS, hS, ww, wh, cells, shops, awning, flag, city,
             tone: street ? Math.floor(Math.random() * 3) : 0,
             crown: !street && Math.random() < 0.18 };
  }

  function buildSkyline() {
    skyline = [];
    for (const [layer, gap, minH, maxH] of [[0, 52, 74, 150], [1, 60, 120, 215], [2, 58, 86, 132]]) {
      let x = -90;
      while (x < W + 320) {
        const w = (layer === 2 ? 58 : 40) + Math.random() * gap;
        skyline.push(makeBuilding(layer, x, w, minH + Math.random() * (maxH - minH), cityIdx));
        x += w + (layer === 2 ? 2 + Math.random() * 8 : 5 + Math.random() * 12);
      }
    }
    stars = [];
    for (let i = 0; i < 80; i++) stars.push({ x: Math.random() * W, y: Math.random() * 140, t: Math.random() * 6 });
    clouds = [];
    for (let i = 0; i < 5; i++) clouds.push({ x: Math.random() * W, y: 20 + Math.random() * 70, w: 40 + Math.random() * 50 });
    trees = [];
    for (let x = 20; x < W + 260; x += 74 + Math.random() * 60)
      trees.push({ x, h: 30 + Math.random() * 14 });
    lamps = [];
    for (let x = 60; x < W + 260; x += 250) lamps.push({ x, sign: Math.floor(Math.random() * level().signs.length) });
    // one ticker board and one bull somewhere down the street
    props = [{ kind: 'ticker', x: 460 }, { kind: 'mark', x: 1150 }];
  }

  function reset() {
    obstacles = []; speed = 6; dist = 0; spawnIn = 70; over = false; tick = 0; cityIdx = 0;
    P.y = GROUND; P.vy = 0; P.duck = false; P.onGround = true;
    buildSkyline(); paint();
  }

  // ---------- obstacles ----------
  // low  -> a stack of cash on the pavement. Must be jumped.
  // high -> cash blowing at head height. Its underside sits below a standing Σ
  //         but above a ducking one, so ducking is the only way through.
  function spawn() {
    const high = dist > 180 && Math.random() < 0.32;
    if (high) {
      obstacles.push({ type: 'high', x: W + 20, w: 46 + Math.random() * 26, h: 30,
                       y: GROUND - 72, notes: 3 });
    } else {
      const n = 1 + Math.floor(Math.random() * 3);
      obstacles.push({ type: 'low', x: W + 20, w: 20 + n * 14, h: 26 + Math.random() * 14,
                       y: 0, notes: n });
    }
    // Gap shrinks with speed but never below what a jump actually spans. A jump
    // is airborne ~40 frames, so at top speed it covers ~620px; 58 frames keeps a
    // real margin once the obstacle's own width is taken off.
    spawnIn = Math.max(58, Math.round((105 - speed * 3) + Math.random() * 55));
  }

  function hitbox() {
    const h = P.duck ? duckH : P.h, w = P.duck ? P.w + 12 : P.w;
    return { x: P.x - w / 2, y: P.y - h, w, h };
  }
  function box(o) {
    return o.type === 'low'
      ? { x: o.x, y: GROUND - o.h, w: o.w, h: o.h }
      : { x: o.x, y: o.y, w: o.w, h: o.h };
  }
  const overlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------- loop ----------
  function step(dt) {
    tick += dt;
    speed = Math.min(15.5, 6 + dist / 260);
    dist = Math.max(0, dist + (speed * dt) / 12);

    P.vy += 0.62 * dt;
    P.y += P.vy * dt;
    if (P.y >= GROUND) { P.y = GROUND; P.vy = 0; P.onGround = true; }

    if (--spawnIn <= 0) spawn();

    const me = hitbox();
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x -= speed * dt;
      if (o.x + o.w < -40) { obstacles.splice(i, 1); continue; }
      if (overlap(me, box(o))) return end();
    }

    cityIdx = cityAt(dist);

    // Depth: distant towers barely drift, the pavement rushes past. Recycled
    // buildings are rebuilt in the current city, so one skyline scrolls out as
    // the next scrolls in rather than the whole street changing at once.
    const PAR = [0.05, 0.13, 0.30];
    for (const b of skyline) b.x -= speed * dt * PAR[b.layer];
    const right = [-1e9, -1e9, -1e9];
    for (const b of skyline) if (b.x + b.w > right[b.layer]) right[b.layer] = b.x + b.w;
    for (let i = 0; i < skyline.length; i++) {
      const b = skyline[i];
      if (b.x + b.w >= -140) continue;
      const L2 = b.layer;
      const gap = L2 === 2 ? 2 + Math.random() * 8 : 5 + Math.random() * 12;
      const w = (L2 === 2 ? 58 : 40) + Math.random() * (L2 === 0 ? 52 : L2 === 1 ? 60 : 58);
      const [minH, maxH] = L2 === 0 ? [74, 150] : L2 === 1 ? [120, 215] : [86, 132];
      const nb = makeBuilding(L2, right[L2] + gap, w, minH + Math.random() * (maxH - minH), cityIdx);
      skyline[i] = nb;
      right[L2] = nb.x + nb.w;
    }
    for (const l of lamps) { l.x -= speed * dt * 0.72; if (l.x < -200) l.x += W + 320; }
    for (const t0 of trees) { t0.x -= speed * dt * 0.78; if (t0.x < -40) t0.x += W + 300; }
    for (const s of props) { s.x -= speed * dt * 0.34; if (s.x < -280) s.x += W + 900; }

    $('score').textContent = Math.floor(dist);
    if ($('level-label').textContent !== level().label) {
      $('level-label').textContent = level().label;
      announce(`Now entering ${level().name}.`);
    }
  }

  // Exactly one animation loop, ever. Restarting mid-run used to leave the old
  // requestAnimationFrame chain alive alongside the new one, so tick advanced
  // two or three times per displayed frame and every tick-driven animation —
  // the twinkling stars, the roof lights, the ticker — strobed.
  function startLoop() {
    if (raf) cancelAnimationFrame(raf);
    const id = ++loopId;
    last = performance.now();
    const run = (ts) => {
      if (id !== loopId || !running) return;
      try {
      // The timestamp rAF hands the first callback is the frame's start, which
      // can predate the performance.now() taken when the loop was armed. That
      // made dt negative and ran the distance backwards into LEVELS[-1].
      let dt = (ts - last) / 16.67;
      if (!(dt > 0)) dt = 1;
      dt = Math.min(2.6, dt);
      last = ts;
      step(dt);
      if (id !== loopId || !running) return;   // step() may have ended the run
      paint();
      } catch (err) { running = false; return fail('frame', err); }
      raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
  }

  // ---------- drawing ----------
  function roofOf(b, top, c, L, bx) {
    const cx = snap(bx + b.wS / 2);
    if (b.roof === 'deco') {
      raw(bx + snap(b.wS * 0.16), top - 12, snap(b.wS * 0.68), 12, c);
      raw(bx + snap(b.wS * 0.34), top - 22, snap(b.wS * 0.32), 10, c);
      blk(cx - 2, top - 32, 4, 10, c);
    } else if (b.roof === 'spire') {
      blk(cx - 7, top - 13, 14, 13, c);
      blk(cx - 2, top - 33, 4, 20, c);
      if (Math.sin(tick / 20) > 0.3) blk(cx - 2, top - 37, 4, 4, '#e8705f');
    } else if (b.roof === 'tank') {
      const tx = bx + snap(b.wS * 0.58);
      blk(tx, top - 15, 18, 11, c); blk(tx + 2, top - 21, 14, 6, c);
      blk(tx + 3, top - 4, 3, 5, c); blk(tx + 12, top - 4, 3, 5, c);
    } else if (b.roof === 'mast') {
      blk(cx - 1, top - 24, 2, 24, c);
      blk(cx - 5, top - 17, 10, 2, c); blk(cx - 3, top - 22, 6, 2, c);
    } else if (b.roof === 'cornice') {
      raw(bx - PX, top, b.wS + PX * 2, PX * 2, L.trim);
      raw(bx, top - PX, b.wS, PX, L.trim);
    }
  }

  function drawCloud(c, L) {
    const y = c.y;
    ctx.fillStyle = L && !L.night ? 'rgba(255,255,255,.34)' : 'rgba(120,130,200,.20)';
    ctx.fillRect(snap(c.x), snap(y), snap(c.w), PX * 2);
    ctx.fillRect(snap(c.x + c.w * .2), snap(y - PX), snap(c.w * .55), PX * 2);
    ctx.fillRect(snap(c.x + c.w * .35), snap(y - PX * 2), snap(c.w * .3), PX * 2);
  }

  // Rounded canopy in three tones — a flat block reads as a bush, not a tree.
  function drawTree(t0, L) {
    const x = snap(t0.x), base = snap(GROUND - 10), h = snap(t0.h);
    raw(x - PX, base - h * 0.45, PX * 2, h * 0.45, '#3a2b20');
    const cy = base - h;
    raw(x - 16, cy + 10, 32, h * 0.42, L.tree[0]);
    raw(x - 12, cy + PX, 24, h * 0.5, L.tree[0]);
    raw(x - 8, cy - PX * 2, 16, 12, L.tree[0]);
    raw(x - 10, cy + 8, 12, h * 0.28, L.tree[1]);
    raw(x + 2, cy + 14, 8, h * 0.2, L.tree[1]);
    raw(x - 6, cy + PX, 8, 8, L.tree[1]);
  }

  function drawBuilding(b, L) {
    if (b.x > W + 40 || b.x + b.w < -40) return;
    const bx = snap(b.x), top = b.top;                     // <- the only snap
    const CL = LEVELS[b.city] || L;        // a building keeps its own city's colours
    const body = b.street ? CL.stone[b.tone] : (b.layer ? CL.towerMid : CL.towerFar);
    raw(bx, top, b.wS, b.hS, body);
    roofOf(b, top, body, CL, bx);

    if (b.crown) raw(bx + PX, top + PX, b.wS - PX * 2, 12, 'rgba(120,180,240,.30)');

    const alpha = b.layer === 0 ? 0.55 : b.layer === 1 ? 0.8 : 1;
    for (const cell of b.cells) {
      const wx = bx + cell.dx;
      if (wx < -PX * 2 || wx > W + PX * 2) continue;
      if (cell.v === 0) { raw(wx, top + cell.dy, b.ww, b.wh,
        L.night ? 'rgba(12,14,40,.55)' : 'rgba(255,255,255,.13)'); continue; }
      ctx.globalAlpha = alpha;
      raw(wx, top + cell.dy, b.ww, b.wh,
          cell.v === 2 ? CL.coldWin : (b.layer === 0 ? CL.gold : CL.goldHot));
      ctx.globalAlpha = 1;
      // A frame and a centre bar turn a lit rectangle into a window.
      if (b.street && b.ww >= PX * 3) {
        raw(wx, top + cell.dy, b.ww, PX, 'rgba(0,0,0,.34)');
        raw(wx + (b.ww >> 1) - (PX >> 1), top + cell.dy, PX, b.wh, 'rgba(0,0,0,.28)');
      }
    }

    if (b.street) {
      const gy = snap(GROUND - 32);
      raw(bx + PX, gy, b.wS - PX * 2, 24, '#2a2036');
      for (const s of b.shops) {
        raw(bx + s.dx, gy + PX, 12, 16, s.dark ? '#2a2036' : CL.goldHot);
        if (!s.dark) raw(bx + s.dx - PX, gy + 20, 20, 12, 'rgba(246,201,95,.10)');
      }
      raw(bx + PX, gy - PX, b.wS - PX * 2, PX, CL.trim);
      if (b.awning) {                       // striped awning over the shopfront
        raw(bx + PX, gy - PX * 2, b.wS - PX * 2, PX * 2, b.awning);
        for (let sx = bx + PX; sx < bx + b.wS - PX; sx += PX * 4)
          raw(sx, gy - PX * 2, PX * 2, PX * 2, 'rgba(255,255,255,.30)');
      }
      if (b.flag) {                         // pole and banner off the facade
        const fy = top + 18;
        raw(bx + b.wS - PX, fy, PX * 5, PX, '#4a4034');
        raw(bx + b.wS + PX * 3, fy, PX, 14, '#4a4034');
        raw(bx + b.wS + PX * 4, fy + PX, 16, 11, CL.gold);
      }
    }
  }

  const TICKERS = ['AAPL', 'TSLA', 'NVDA', 'SPX', 'DJI', 'MSFT'];

  // One landmark per city, drawn as a silhouette on the far side of the street.
  function drawMark(x, L) {
    const g = GROUND - 10, c = L.towerMid, lit = L.goldHot;
    switch (L.mark) {
      case 'bull':
        raw(x, g - 26, 56, 20, '#8a6a3a'); raw(x + 48, g - 34, 18, 14, '#8a6a3a');
        raw(x + 62, g - 38, 6, 5, '#a8834a'); raw(x + 46, g - 38, 6, 5, '#a8834a');
        for (const dx of [4, 18, 34, 48]) raw(x + dx, g - 8, 7, 9, '#6f5430');
        raw(x - 6, g - 30, 8, 16, '#6f5430'); break;
      case 'bridge': {                                     // Golden Gate
        const o = '#c1440e';
        raw(x, g - 150, 10, 150, o); raw(x + 150, g - 150, 10, 150, o);
        for (const y of [g - 130, g - 108]) { raw(x - 6, y, 22, 5, o); raw(x + 144, y, 22, 5, o); }
        raw(x - 40, g - 62, 240, 5, o);                     // deck
        for (let i = 0; i <= 15; i++) {                     // cables
          const t0 = i / 15, cx = x + 5 + t0 * 150;
          raw(cx, g - 150 + Math.sin(t0 * Math.PI) * 62, 3, 3, o);
          raw(cx, g - 150 + Math.sin(t0 * Math.PI) * 62, 3, 88 - Math.sin(t0 * Math.PI) * 62, 'rgba(193,68,14,.5)');
        }
        break; }
      case 'bigben':
        raw(x, g - 168, 34, 168, '#7a6a52'); raw(x - 4, g - 176, 42, 10, '#8d7b60');
        raw(x + 6, g - 158, 22, 22, '#f4e9c8'); raw(x + 16, g - 152, 3, 10, '#3a3226');
        raw(x + 16, g - 148, 8, 3, '#3a3226');
        raw(x + 8, g - 196, 18, 22, '#6b5c46'); raw(x + 14, g - 208, 6, 12, '#6b5c46'); break;
      case 'burj': {                                        // Burj Khalifa
        let w = 54, y = g;
        for (let i = 0; i < 9; i++) { raw(x + (54 - w) / 2, y - 30, w, 30, c); y -= 30; w = Math.max(8, w - 6); }
        raw(x + 24, y - 46, 5, 46, c); break; }
      case 'artdeco':                                       // Miami hotel facade
        raw(x, g - 92, 130, 92, L.stone[0]);
        raw(x + 46, g - 112, 38, 20, L.stone[0]); raw(x + 60, g - 122, 10, 10, L.stone[0]);
        for (let i = 0; i < 3; i++) raw(x + 8, g - 84 + i * 26, 114, 4, L.trim);
        for (let i = 0; i < 5; i++) raw(x + 14 + i * 24, g - 60, 14, 22, lit);
        raw(x + 30, g - 104, 70, 4, '#7ff0e0'); break;
      case 'tokyotower': {
        const o = '#e2503c'; let w = 62;
        for (let i = 0; i < 6; i++) { const yy = g - 26 - i * 26;
          raw(x + (62 - w) / 2, yy, w, 4, o);
          raw(x + (62 - w) / 2, yy, 4, 26, o); raw(x + (62 - w) / 2 + w - 4, yy, 4, 26, o);
          w = Math.max(10, w - 10); }
        raw(x + 28, g - 210, 5, 30, o); raw(x + 22, g - 196, 18, 6, '#f4f4f4');
        raw(x + 4, g - 26, 54, 26, o); break; }
      case 'gateway':                                       // Gateway of India
        raw(x, g - 88, 120, 88, L.stone[1]);
        raw(x + 38, g - 62, 44, 62, L.road);                // arch opening
        raw(x + 38, g - 62, 44, 8, L.stone[2]);
        raw(x - 6, g - 100, 132, 12, L.stone[1]);
        for (const dx of [2, 106]) { raw(x + dx, g - 122, 14, 22, L.stone[1]); raw(x + dx + 3, g - 130, 8, 8, L.trim); }
        raw(x + 52, g - 118, 16, 18, L.stone[1]); break;
      case 'nseoul':                                        // N Seoul Tower on Namsan
        raw(x - 60, g - 46, 200, 46, L.tree[0]);
        raw(x + 26, g - 130, 12, 90, '#c8ccd2');
        raw(x + 14, g - 152, 36, 24, '#dfe3e8'); raw(x + 18, g - 160, 28, 10, '#c8ccd2');
        raw(x + 30, g - 186, 4, 26, '#c8ccd2'); break;
      case 'watarun': {                                     // Wat Arun prang
        let w = 46, y = g;
        for (let i = 0; i < 5; i++) { raw(x + (46 - w) / 2, y - 22, w, 22, '#e0cba8'); y -= 22; w -= 8; }
        raw(x + 21, y - 34, 5, 34, '#f0d060');
        for (const dx of [-26, 52]) { raw(x + dx, g - 40, 18, 40, '#e0cba8'); raw(x + dx + 7, g - 54, 4, 14, '#f0d060'); }
        break; }
      case 'pagoda':                                        // Forbidden City hall
        raw(x, g - 54, 140, 54, '#9c4a3c');
        for (let i = 0; i < 5; i++) raw(x + 12 + i * 28, g - 44, 14, 34, '#6b2f26');
        raw(x - 10, g - 68, 160, 14, '#d8b45a'); raw(x - 16, g - 62, 172, 6, '#c4a049');
        raw(x + 16, g - 88, 108, 20, '#d8b45a'); raw(x + 10, g - 82, 120, 6, '#c4a049');
        break;
    }
  }

  function drawProp(s, L) {
    if (s.x > W + 260 || s.x < -300) return;
    if (s.kind === 'mark') { drawMark(s.x, L); return; }
    if (!L.ticker) return;
    const w = 210, h = 78, y = GROUND - 150;
    raw(snap(s.x - 6), y - 6, w + 12, h + 12, '#241f33');
    raw(snap(s.x), y, w, h, '#06110b');
    ctx.font = '700 15px "Courier New",monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (let i = 0; i < 3; i++) {
      const sym = TICKERS[(i + Math.floor(tick / 220)) % TICKERS.length];
      const up = ((i + Math.floor(tick / 220)) % 3) !== 1;
      ctx.fillStyle = up ? '#57e08a' : '#e8705f';
      ctx.fillText(`${sym} ${up ? '\u25B2' : '\u25BC'} ${(90 + i * 137 + (Math.floor(tick / 30) % 9)).toFixed(2)}`,
                   snap(s.x + 14), snap(y + 12 + i * 22));
    }
  }

  function paint() {
    const L = level();
    ctx.imageSmoothingEnabled = false;

    const bands = L.sky.length;
    for (let i = 0; i < bands; i++) blk(0, (GROUND / bands) * i, W, GROUND / bands + PX, skyAt(i));

    if (L.night) {
      for (const s of stars) {
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(tick / 40 + s.t));
        ctx.fillStyle = `rgba(232,238,255,${(tw * (1 - s.y / 200)).toFixed(3)})`;
        ctx.fillRect(snap(s.x), snap(s.y), PX, PX);
      }
    }
    for (const c of clouds) drawCloud(c, L);

    if (L.night) {
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.beginPath(); ctx.arc(moon.x, moon.y, 34, 0, Math.PI * 2); ctx.fill();
      blk(moon.x - 18, moon.y - 18, 36, 36, '#f4f6ff');
      blk(moon.x - 22, moon.y - 14, 8, 28, skyAt(0));
      blk(moon.x - 6, moon.y - 10, 8, 8, '#dfe4f5');
      blk(moon.x + 2, moon.y + 4, 5, 5, '#dfe4f5');
    } else {
      ctx.fillStyle = 'rgba(255,240,200,.16)';
      ctx.beginPath(); ctx.arc(moon.x, moon.y + 16, 52, 0, Math.PI * 2); ctx.fill();
      blk(moon.x - 20, moon.y - 4, 40, 40, '#fff6d8');
      blk(moon.x - 26, moon.y + 2, 52, 28, '#fff6d8');
      blk(moon.x - 14, moon.y - 10, 28, 52, '#fff6d8');
    }

    for (const layer of [0, 1, 2]) for (const b of skyline) if (b.layer === layer) drawBuilding(b, L);
    for (const s of props) drawProp(s, L);

    if (L.fog || L.sand) {
      ctx.fillStyle = L.fog ? 'rgba(232,236,244,.20)' : 'rgba(240,214,160,.18)';
      ctx.fillRect(0, snap(GROUND - 130), W, 130);
    }
    blk(0, GROUND - 10, W, 10, L.walk);
    blk(0, GROUND - 12, W, PX, L.kerb);
    for (const t0 of trees) drawTree(t0, L);

    for (const l of lamps) {
      if (l.x < -60 || l.x > W + 60) continue;
      blk(l.x, GROUND - 106, PX, 96, '#2f3050');
      blk(l.x - 3, GROUND - 12, 10, 4, '#2f3050');
      blk(l.x - 5, GROUND - 118, 14, 12, L.goldHot);
      ctx.fillStyle = 'rgba(246,201,95,.13)';
      ctx.beginPath(); ctx.moveTo(l.x - 14, GROUND - 106); ctx.lineTo(l.x + 18, GROUND - 106);
      ctx.lineTo(l.x + 42, GROUND); ctx.lineTo(l.x - 38, GROUND); ctx.closePath(); ctx.fill();
    }

    // Street sign: a tall post carrying two plates at right angles, the way the
    // corner of Wall and Broad actually reads.
    for (const l of lamps) {
      const px = snap(l.x + 96);
      if (px < -80 || px > W + 80) continue;
      raw(px, snap(GROUND - 128), PX, 118, '#2b2f45');
      ctx.font = '700 11px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      for (let i = 0; i < 2; i++) {
        const label = L.signs[(l.sign + i) % L.signs.length];
        const tw = ctx.measureText(label).width, py = snap(GROUND - 128 + i * 20);
        raw(px - (i ? snap(tw) + 6 : 0), py, snap(tw) + 18, 17, '#11142c');
        raw(px - (i ? snap(tw) + 6 : 0), py, snap(tw) + 18, PX, '#4c5d80');
        ctx.fillStyle = '#f2f4ff';
        ctx.fillText(label, snap(px + 6 - (i ? snap(tw) + 6 : 0)), snap(py + 5));
      }
    }

    blk(0, GROUND, W, H - GROUND, L.road);
    for (let x = -((dist * 12) % 74); x < W; x += 74) blk(x, GROUND + 19, 36, PX, '#2e3160');

    for (const o of obstacles) drawCash(o);
    drawSigma();
  }

  // Obstacles have to read on every city: Tokyo's near-black sky and Seoul's
  // bright blue one. So each is a saturated fill with BOTH a dark outline and a
  // light inner rim — one of the two always separates it from the background.
  const OUT = '#1a1208', RIM = '#fff6e2';

  function edged(x, y, w, h, fill) {
    raw(x - PX, y - PX, w + PX * 2, h + PX * 2, OUT);   // dark halo
    raw(x, y, w, h, fill);
  }

  function drawCash(o) {                                 // name kept: collision code calls it
    const b = box(o);
    if (o.type === 'high') drawBirds(b, o);
    else drawCones(b, o);
  }

  // Ground: roadwork barriers. Orange and white is the most legible warning
  // pairing there is, which is exactly why real roads use it.
  function drawCones(b, o) {
    const n = Math.max(1, o.notes);
    const cw = b.w / n;
    for (let i = 0; i < n; i++) {
      const x = snap(b.x + i * cw), w = snap(cw) - PX, top = snap(b.y), h = snap(b.h);
      edged(x, top, w, h, '#ff7a1a');
      raw(x, snap(top + h * 0.36), w, PX * 2, RIM);      // reflective bands
      raw(x, snap(top + h * 0.68), w, PX * 2, RIM);
      raw(x - PX, snap(b.y + h - PX), w + PX * 2, PX, OUT);
    }
  }

  // Air: pigeons. They belong at head height in a city, and a pale body over a
  // dark outline stays visible against anything.
  function drawBirds(b, o) {
    const n = Math.max(1, o.notes), bw = b.w / n;
    for (let i = 0; i < n; i++) {
      const flap = Math.sin(tick / 6 + i * 1.7);
      const x = snap(b.x + i * bw), y = snap(b.y + flap * 3);
      edged(x, y + PX * 2, snap(bw) - PX * 2, PX * 4, RIM);         // body
      raw(snap(x + bw - PX * 3), y + PX, PX * 3, PX * 3, RIM);      // head
      raw(snap(x + bw - PX), snap(y + PX * 2), PX * 2, PX, '#ff7a1a'); // beak
      const wy = snap(y + (flap > 0 ? -PX * 2 : PX * 4));           // wing beat
      edged(snap(x + PX * 2), wy, snap(bw) - PX * 6, PX * 2, '#cfd8e8');
      raw(snap(x - PX * 2), snap(y + PX * 3), PX * 3, PX, RIM);     // tail
    }
  }

  function drawSigma() {
    const h = P.duck ? duckH : P.h;
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(0, 3, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#edece6';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (P.duck) {
      ctx.font = '600 30px Georgia, serif';
      ctx.setTransform(1.5, 0, 0, 0.78, P.x, P.y);
      ctx.fillText('Σ', 0, 0);
    } else {
      // a small tilt while airborne so the jump reads
      const lean = P.onGround ? Math.sin(tick / 5) * 0.04 : -0.16;
      ctx.rotate(lean);
      ctx.font = `600 ${h + 8}px Georgia, serif`;
      ctx.fillText('Σ', 0, 0);
    }
    ctx.restore();
  }

  // ---------- game flow ----------
  function begin() {
    reset(); running = true; over = false; paused = false;
    $('overlay').hidden = true; last = performance.now();
    announce('Running. Jump the barriers, duck the pigeons.');
    startLoop();
  }

  function end() {
    running = false; over = true; loopId++;      // invalidate any in-flight frame
    if (raf) cancelAnimationFrame(raf);
    const m = Math.floor(dist), isBest = m > best;
    if (isBest) { best = m; try { localStorage.setItem('mindlab.runner.best', String(best)); } catch (e) {} }
    showBest();
    $('over-eyebrow').textContent = isBest ? 'New best' : 'Caught by the cash';
    $('over-title').textContent = `${m} m.`;
    $('over-text').textContent = isBest
      ? 'Furthest yet down the Street. Again?'
      : `Best so far: ${best} m. The Street only gets faster.`;
    $('go').innerHTML = 'Run again <span aria-hidden="true">→</span>';
    $('overlay').hidden = false; $('go').focus();
    announce(`Run over at ${m} metres. Best ${best}.`);
    paint();
  }

  function jump() {
    if (!running || over) return;
    if (P.onGround) { P.vy = -12.4; P.onGround = false; P.duck = false; }
  }
  function duck(on) { if (running && !over) P.duck = on && P.onGround ? true : (on ? P.duck : false); }
  function pause(on) {
    if (!running || over) return;
    paused = on;
    if (on) { loopId++; if (raf) cancelAnimationFrame(raf); running = false; $('overlay').hidden = false;
      $('over-eyebrow').textContent = 'Paused'; $('over-title').textContent = 'Held.';
      $('over-text').textContent = 'Press P or the button to keep running.';
      $('go').innerHTML = 'Resume <span aria-hidden="true">→</span>'; }
  }
  function announce(t) { $('announcement').textContent = t; }
  function showBest() { $('best').textContent = best ? `best ${best} m` : ''; }

  // ---------- input ----------
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'arrowup' || k === 'w') { e.preventDefault(); running ? jump() : $('go').click(); }
    else if (k === 'arrowdown' || k === 's') { e.preventDefault(); duck(true); }
    else if (k === 'p') { paused ? $('go').click() : pause(true); }
    else if (k === 'r') { begin(); }
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowdown' || k === 's') duck(false);
  });

  cv.addEventListener('pointerdown', (e) => {
    if (!running) return;
    const r = cv.getBoundingClientRect();
    if ((e.clientY - r.top) / r.height > 0.62) { duck(true); } else jump();
  });
  addEventListener('pointerup', () => duck(false));

  $('btn-jump').addEventListener('click', jump);
  $('btn-duck').addEventListener('pointerdown', () => duck(true));
  $('btn-duck').addEventListener('pointerup', () => duck(false));

  $('go').addEventListener('click', () => {
    try {
      if (paused) { paused = false; running = true; $('overlay').hidden = true; startLoop(); return; }
      begin();
    } catch (err) { fail('start', err); }
  });
  $('reset').addEventListener('click', begin);
  $('rules-toggle').addEventListener('click', () => {
    const show = $('rules').hidden;
    $('rules').hidden = !show;
    $('rules-toggle').setAttribute('aria-expanded', String(show));
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

  // ---------- boot ----------
  $('level-label').textContent = level().label;
  showBest(); reset();
})();
