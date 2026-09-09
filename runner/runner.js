/* The runner — an endless runner. You are Σ. Jump the cash on the ground,
   duck the cash in the air.

   Levels are data, not code, so adding level two is a new entry in LEVELS
   rather than a new branch in the draw loop. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, GROUND = 268;

  const LEVELS = [{
    id: 'wallst',
    name: 'Wall Street',
    label: '01 / Wall Street',
    // Deep indigo night, warming toward the horizon.
    sky: ['#171a4a', '#1e2358', '#282e6b', '#343b7d'],
    towerFar: '#252a5e', towerMid: '#2b3068',      // blue-violet skyscrapers
    stone: ['#6d5a46', '#7d6a52', '#5d4c3c'],      // tan street-level blocks
    trim: '#8a7660',
    gold: '#f6c95f', goldHot: '#ffe6a0', coldWin: '#8fc0f0',
    road: '#141634', kerb: '#3a3a5e', walk: '#232544',
    tree: ['#1c4a33', '#276b46'],
    signs: ['WALL ST', 'BROAD ST', 'NASSAU ST', 'EXCHANGE PL'],
    tickers: ['AAPL', 'TSLA', 'NVDA', 'SPX', 'DJI', 'MSFT'],
    from: 0
  }];;

  // ---------- state ----------
  const P = { x: 110, y: GROUND, vy: 0, w: 40, h: 46, duck: false, onGround: true };
  let obstacles = [], skyline = [], lamps = [], speed = 6, dist = 0, spawnIn = 90,
      running = false, over = false, paused = false, raf = null, last = 0, tick = 0, loopId = 0;
  let best = 0;
  try { best = parseInt(localStorage.getItem('mindlab.runner.best') || '0', 10) || 0; } catch (e) { best = 0; }

  const level = () => LEVELS[0];
  const duckH = 26;

  // ---------- world building ----------
  const PX = 4;
  const snap = (n) => Math.round(n / PX) * PX;
  function blk(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(snap(x), snap(y), snap(w), snap(h)); }

  let stars = [], clouds = [], trees = [], props = [], moon = { x: W - 170, y: 54 };

  // Windows are baked in once so the lit pattern travels with its building.
  function makeBuilding(layer, x, w, h) {
    const street = layer === 2;
    const cols = Math.max(2, Math.floor((w - 10) / (street ? 16 : 13)));
    const rows = Math.max(2, Math.floor((h - (street ? 26 : 20)) / (street ? 20 : 15)));
    const win = [];
    // The reference is densely lit — most windows are on.
    const on = street ? 0.74 : layer === 1 ? 0.6 : 0.42;
    for (let i = 0; i < cols * rows; i++)
      win.push(Math.random() < on ? (Math.random() < 0.12 ? 2 : 1) : 0);
    const r = Math.random();
    const roof = street ? (r < 0.4 ? 'cornice' : 'flat')
      : r < 0.2 ? 'deco' : r < 0.36 ? 'spire' : r < 0.5 ? 'tank' : r < 0.6 ? 'mast' : 'flat';
    return { layer, x, w, h, cols, rows, win, roof, street,
             tone: street ? Math.floor(Math.random() * 3) : 0,
             shops: street ? Array.from({length: 12}, () => Math.random() < 0.12) : null,
             crown: !street && Math.random() < 0.18 };   // blue-lit crown, as in the reference
  }

  function buildSkyline() {
    skyline = [];
    for (const [layer, gap, minH, maxH] of [[0, 52, 74, 150], [1, 60, 120, 215], [2, 58, 86, 132]]) {
      let x = -90;
      while (x < W + 320) {
        const w = (layer === 2 ? 66 : 40) + Math.random() * gap;
        skyline.push(makeBuilding(layer, x, w, minH + Math.random() * (maxH - minH)));
        x += w + (layer === 2 ? 4 + Math.random() * 26 : 5 + Math.random() * 12);
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
    props = [{ kind: 'ticker', x: 420 }, { kind: 'bull', x: 1180 }];
  }

  function reset() {
    obstacles = []; speed = 6; dist = 0; spawnIn = 70; over = false; tick = 0;
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
    dist += (speed * dt) / 12;

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

    // Depth: distant towers barely drift, the pavement rushes past.
    const PAR = [0.05, 0.13, 0.30];
    for (const b of skyline) { b.x -= speed * dt * PAR[b.layer]; if (b.x + b.w < -140) b.x += W + 420; }
    for (const l of lamps) { l.x -= speed * dt * 0.72; if (l.x < -200) l.x += W + 320; }
    for (const t0 of trees) { t0.x -= speed * dt * 0.78; if (t0.x < -40) t0.x += W + 300; }
    for (const s of props) { s.x -= speed * dt * 0.34; if (s.x < -280) s.x += W + 900; }

    $('score').textContent = Math.floor(dist);
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
      const dt = Math.min(2.6, (ts - last) / 16.67 || 1);
      last = ts;
      step(dt);
      if (id !== loopId || !running) return;   // step() may have ended the run
      paint();
      raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
  }

  // ---------- drawing ----------
  function roofOf(b, top, c, L) {
    const cx = b.x + b.w / 2;
    if (b.roof === 'deco') {
      blk(b.x + b.w * 0.16, top - 12, b.w * 0.68, 12, c);
      blk(b.x + b.w * 0.34, top - 22, b.w * 0.32, 10, c);
      blk(cx - 2, top - 32, 4, 10, c);
    } else if (b.roof === 'spire') {
      blk(cx - 7, top - 13, 14, 13, c);
      blk(cx - 2, top - 33, 4, 20, c);
      if (Math.sin(tick / 20) > 0.3) blk(cx - 2, top - 37, 4, 4, '#e8705f');
    } else if (b.roof === 'tank') {
      const tx = b.x + b.w * 0.58;
      blk(tx, top - 15, 18, 11, c); blk(tx + 2, top - 21, 14, 6, c);
      blk(tx + 3, top - 4, 3, 5, c); blk(tx + 12, top - 4, 3, 5, c);
    } else if (b.roof === 'mast') {
      blk(cx - 1, top - 24, 2, 24, c);
      blk(cx - 5, top - 17, 10, 2, c); blk(cx - 3, top - 22, 6, 2, c);
    } else if (b.roof === 'cornice') {
      blk(b.x - 3, top, b.w + 6, 6, L.trim);
      blk(b.x - 1, top - 4, b.w + 2, 4, L.trim);
    }
  }

  function drawCloud(c) {
    const y = c.y;
    ctx.fillStyle = 'rgba(120,130,200,.20)';
    ctx.fillRect(snap(c.x), snap(y), snap(c.w), PX * 2);
    ctx.fillRect(snap(c.x + c.w * .2), snap(y - PX), snap(c.w * .55), PX * 2);
    ctx.fillRect(snap(c.x + c.w * .35), snap(y - PX * 2), snap(c.w * .3), PX * 2);
  }

  function drawTree(t0, L) {
    const x = t0.x, base = GROUND - 10, h = t0.h;
    blk(x - 2, base - h * 0.42, 5, h * 0.42, '#3a2b20');            // trunk
    blk(x - 13, base - h, 26, h * 0.6, L.tree[0]);                  // canopy
    blk(x - 9, base - h - 6, 18, 8, L.tree[0]);
    blk(x - 10, base - h + 2, 12, h * 0.3, L.tree[1]);              // highlight
  }

  function drawBuilding(b, L) {
    const top = GROUND - b.h;
    if (b.x > W + 40 || b.x + b.w < -40) return;
    const body = b.street ? L.stone[b.tone] : (b.layer ? L.towerMid : L.towerFar);
    blk(b.x, top, b.w, b.h, body);
    roofOf(b, top, body, L);

    // a blue-lit crown on a few towers, like the glass skyscrapers in the reference
    if (b.crown) blk(b.x + 3, top + 4, b.w - 6, 14, 'rgba(120,180,240,.30)');

    const padY = b.street ? 20 : 14;
    const cw = (b.w - 10) / b.cols, ch = (b.h - padY - (b.street ? 26 : 6)) / b.rows;
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
      const v = b.win[r * b.cols + c];
      const wx = b.x + 5 + c * cw, wy = top + padY + r * ch;
      if (wx < -8 || wx > W + 8) continue;
      if (v === 0) { blk(wx, wy, cw * 0.55, ch * 0.5, 'rgba(12,14,40,.55)'); continue; }
      const col = v === 2 ? L.coldWin : (b.layer === 0 ? L.gold : L.goldHot);
      ctx.globalAlpha = b.layer === 0 ? 0.55 : b.layer === 1 ? 0.8 : 1;
      blk(wx, wy, cw * 0.55, ch * 0.5, col);
      ctx.globalAlpha = 1;
    }

    // lit shopfronts along the pavement
    if (b.street) {
      const gy = GROUND - 32;
      blk(b.x + 3, gy, b.w - 6, 22, '#2a2036');
      let si = 0;
      for (let x = b.x + 7; x < b.x + b.w - 10; x += 16, si++) {
        // shuttered or lit is decided once per shop, not re-rolled every frame
        blk(x, gy + 3, 11, 15, b.shops[si % b.shops.length] ? '#2a2036' : L.goldHot);
        ctx.fillStyle = 'rgba(246,201,95,.10)';
        ctx.fillRect(snap(x - 4), snap(gy + 18), snap(19), snap(14));   // spill onto pavement
      }
      blk(b.x + 3, gy - 4, b.w - 6, 4, L.trim);
    }
  }

  function drawProp(s, L) {
    if (s.x > W + 200 || s.x < -260) return;
    if (s.kind === 'ticker') {
      const w = 210, h = 78, y = GROUND - 150;
      blk(s.x - 6, y - 6, w + 12, h + 12, '#241f33');
      blk(s.x, y, w, h, '#06110b');
      ctx.font = '700 15px "Courier New",monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      for (let i = 0; i < 3; i++) {
        const sym = L.tickers[(i + Math.floor(tick / 220)) % L.tickers.length];
        const up = ((i + Math.floor(tick / 220)) % 3) !== 1;
        ctx.fillStyle = up ? '#57e08a' : '#e8705f';
        ctx.fillText(`${sym} ${up ? '\u25B2' : '\u25BC'} ${(90 + i * 137 + (Math.floor(tick / 30) % 9)).toFixed(2)}`,
                     snap(s.x + 14), snap(y + 12 + i * 22));
      }
    } else if (s.kind === 'bull') {
      const x = s.x, y = GROUND - 10;
      blk(x, y - 26, 54, 20, '#8a6a3a');            // body
      blk(x + 46, y - 34, 18, 14, '#8a6a3a');       // head
      blk(x + 60, y - 38, 6, 5, '#a8834a');         // horn
      blk(x + 44, y - 38, 6, 5, '#a8834a');
      blk(x + 4, y - 8, 7, 9, '#6f5430'); blk(x + 18, y - 8, 7, 9, '#6f5430');
      blk(x + 34, y - 8, 7, 9, '#6f5430'); blk(x + 46, y - 8, 7, 9, '#6f5430');
      blk(x - 6, y - 30, 8, 16, '#6f5430');         // tail
    }
  }

  function paint() {
    const L = level();
    ctx.imageSmoothingEnabled = false;

    const bands = L.sky.length;
    for (let i = 0; i < bands; i++) blk(0, (GROUND / bands) * i, W, GROUND / bands + PX, L.sky[i]);

    for (const s of stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(tick / 40 + s.t));
      ctx.fillStyle = `rgba(232,238,255,${(tw * (1 - s.y / 200)).toFixed(3)})`;
      ctx.fillRect(snap(s.x), snap(s.y), PX, PX);
    }
    for (const c of clouds) drawCloud(c);

    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.arc(moon.x, moon.y, 34, 0, Math.PI * 2); ctx.fill();
    blk(moon.x - 18, moon.y - 18, 36, 36, '#f4f6ff');
    blk(moon.x - 22, moon.y - 14, 8, 28, L.sky[0]);
    blk(moon.x - 6, moon.y - 10, 8, 8, '#dfe4f5');
    blk(moon.x + 2, moon.y + 4, 5, 5, '#dfe4f5');

    for (const layer of [0, 1, 2]) for (const b of skyline) if (b.layer === layer) drawBuilding(b, L);
    for (const s of props) drawProp(s, L);

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
      const label = L.signs[l.sign];
      ctx.font = '700 10px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const tw = ctx.measureText(label).width;
      blk(l.x + 6, GROUND - 100, tw + 14, 17, '#12142e');
      blk(l.x + 6, GROUND - 100, tw + 14, PX, '#4a4d80');
      ctx.fillStyle = '#eef1ff'; ctx.fillText(label, snap(l.x + 13), snap(GROUND - 95));
    }

    blk(0, GROUND, W, H - GROUND, L.road);
    for (let x = -((dist * 12) % 74); x < W; x += 74) blk(x, GROUND + 19, 36, PX, '#2e3160');

    for (const o of obstacles) drawCash(o);
    drawSigma();
  }

  function drawCash(o) {
    const b = box(o);
    if (o.type === 'high') {
      // loose notes tumbling at head height
      for (let i = 0; i < o.notes; i++) {
        const nx = b.x + i * (b.w / o.notes), ny = b.y + Math.sin(tick / 9 + i) * 4;
        note(nx, ny, b.w / o.notes - 4, b.h - 6, (Math.sin(tick / 14 + i) * 0.22));
      }
    } else {
      const nh = b.h / o.notes;
      for (let i = 0; i < o.notes; i++) note(b.x, b.y + i * nh + 1, b.w, nh - 2, 0);
    }
  }

  function note(x, y, w, h, rot) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot); ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = '#8fbf9f'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5f8f70'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.fillStyle = '#456b52';
    ctx.font = `${Math.max(9, Math.min(15, h - 8))}px Georgia`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$', w / 2, h / 2 + 0.5);
    ctx.restore();
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
    announce('Running. Jump the cash on the ground, duck the cash in the air.');
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
    if (paused) { paused = false; running = true; $('overlay').hidden = true; startLoop(); return; }
    begin();
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
