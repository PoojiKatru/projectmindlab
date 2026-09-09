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
    sky: ['#0b1729', '#1d3352', '#3c4f6b'],   // night -> horizon haze
    band: ['#101f36', '#17293f', '#1e3450'],  // far / mid / near silhouettes
    lit: ['#f2d08a', '#ffe6a8', '#aec8ed'],   // window colours
    road: '#0b1524', kerb: '#1c2b41', walk: '#16233a',
    signs: ['WALL ST', 'BROAD ST', 'NYSE', 'EXCHANGE PL'],
    from: 0            // metres at which this level starts
  }];

  // ---------- state ----------
  const P = { x: 110, y: GROUND, vy: 0, w: 40, h: 46, duck: false, onGround: true };
  let obstacles = [], skyline = [], lamps = [], speed = 6, dist = 0, spawnIn = 90,
      running = false, over = false, paused = false, raf = null, last = 0, tick = 0;
  let best = 0;
  try { best = parseInt(localStorage.getItem('mindlab.runner.best') || '0', 10) || 0; } catch (e) { best = 0; }

  const level = () => LEVELS[0];
  const duckH = 26;

  // ---------- world building ----------
  const PX = 4;                              // pixel block size
  const snap = (n) => Math.round(n / PX) * PX;
  function blk(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(snap(x), snap(y), snap(w), snap(h)); }

  let stars = [], moon = { x: W - 150, y: 52 };

  // A building is generated once, windows included, so the lit pattern scrolls
  // with the building instead of shimmering as it moves.
  function makeBuilding(layer, x, w, h) {
    const cols = Math.max(1, Math.floor((w - 12) / 12));
    const rows = Math.max(1, Math.floor((h - 22) / 14));
    const win = [];
    const density = layer === 0 ? 0.22 : layer === 1 ? 0.38 : 0.5;
    for (let i = 0; i < cols * rows; i++)
      win.push(Math.random() < density ? (Math.random() < 0.22 ? 2 : Math.random() < 0.5 ? 1 : 0) : -1);
    const r = Math.random();
    const roof = layer === 0 ? 'flat'
      : r < 0.22 ? 'deco' : r < 0.4 ? 'spire' : r < 0.58 ? 'tank' : r < 0.72 ? 'mast' : 'flat';
    return { layer, x, w, h, cols, rows, win, roof, ticker: layer === 2 && Math.random() < 0.3 };
  }

  function buildSkyline() {
    skyline = [];
    // layer, spacing, min height, max height
    for (const [layer, gap, minH, maxH] of [[0, 60, 60, 130], [1, 54, 110, 200], [2, 70, 140, 245]]) {
      let x = -80;
      while (x < W + 300) {
        const w = 44 + Math.random() * gap;
        skyline.push(makeBuilding(layer, x, w, minH + Math.random() * (maxH - minH)));
        x += w + (layer === 2 ? 26 + Math.random() * 60 : 6 + Math.random() * 14);
      }
    }
    stars = [];
    for (let i = 0; i < 70; i++)
      stars.push({ x: Math.random() * W, y: Math.random() * 150, t: Math.random() * 6 });
    lamps = [];
    for (let x = 40; x < W + 240; x += 240)
      lamps.push({ x, sign: Math.floor(Math.random() * level().signs.length) });
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

    const PAR = [0.06, 0.16, 0.34];
    for (const b of skyline) { b.x -= speed * dt * PAR[b.layer]; if (b.x + b.w < -120) b.x += W + 380; }
    for (const l of lamps) { l.x -= speed * dt * 0.62; if (l.x < -180) l.x += W + 300; }

    $('score').textContent = Math.floor(dist);
  }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min(2.6, (ts - last) / 16.67 || 1);
    last = ts;
    step(dt); paint();
    if (running) raf = requestAnimationFrame(frame);
  }

  // ---------- drawing ----------
  // Roof shapes. Art-deco setbacks, spires, water tanks and radio masts are what
  // make a New York skyline read as one rather than a row of boxes.
  function roofOf(b, top, c, L) {
    const cx = b.x + b.w / 2;
    if (b.roof === 'deco') {
      blk(b.x + b.w * 0.16, top - 12, b.w * 0.68, 12, c);
      blk(b.x + b.w * 0.32, top - 22, b.w * 0.36, 10, c);
      blk(cx - 2, top - 34, 4, 12, c);
    } else if (b.roof === 'spire') {
      blk(cx - 6, top - 14, 12, 14, c);
      blk(cx - 2, top - 34, 4, 20, c);
      if (b.layer === 2) blk(cx - 2, top - 38, 4, 4, '#d9a28d');   // aircraft light
    } else if (b.roof === 'tank') {
      const tx = b.x + b.w * 0.6;
      blk(tx, top - 16, 18, 12, c);
      blk(tx + 2, top - 22, 14, 6, c);
      blk(tx + 3, top - 4, 3, 6, c); blk(tx + 12, top - 4, 3, 6, c);
    } else if (b.roof === 'mast') {
      blk(cx - 1, top - 26, 2, 26, c);
      blk(cx - 5, top - 18, 10, 2, c);
      blk(cx - 3, top - 24, 6, 2, c);
      if (b.layer === 2 && Math.sin(tick / 22) > 0.4) blk(cx - 2, top - 30, 4, 4, '#d9a28d');
    }
  }

  function paint() {
    const L = level();
    ctx.imageSmoothingEnabled = false;

    // --- sky: banded, not a smooth gradient. Bands read as pixel art. ---
    const bands = L.sky.length;
    for (let i = 0; i < bands; i++)
      blk(0, (GROUND / bands) * i, W, GROUND / bands + PX, L.sky[i]);

    // --- stars, fading out toward the horizon glow ---
    for (const s of stars) {
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(tick / 40 + s.t));
      ctx.fillStyle = `rgba(226,236,250,${(tw * (1 - s.y / 190)).toFixed(3)})`;
      ctx.fillRect(snap(s.x), snap(s.y), PX, PX);
    }

    // --- moon, built from blocks with a bite taken out ---
    blk(moon.x - 16, moon.y - 16, 32, 32, '#e8eef7');
    blk(moon.x - 20, moon.y - 12, 8, 24, L.sky[0]);
    blk(moon.x - 4, moon.y - 8, 8, 8, '#d3dced');
    blk(moon.x + 4, moon.y + 4, 4, 4, '#d3dced');

    // --- buildings, far to near ---
    for (const layer of [0, 1, 2]) {
      for (const b of skyline) {
        if (b.layer !== layer) continue;
        const top = GROUND - b.h, c = L.band[layer];
        blk(b.x, top, b.w, b.h, c);
        roofOf(b, top, c, L);
        if (layer === 0) continue;

        // windows
        const cw = (b.w - 12) / b.cols, ch = (b.h - 22) / b.rows;
        for (let r = 0; r < b.rows; r++) for (let cI = 0; cI < b.cols; cI++) {
          const v = b.win[r * b.cols + cI];
          if (v < 0) continue;
          const wx = b.x + 6 + cI * cw, wy = top + 14 + r * ch;
          if (wx < -PX || wx > W) continue;
          ctx.fillStyle = v === 0 ? 'rgba(10,20,36,.75)'
            : `rgba(${v === 2 ? '174,200,237' : '242,208,138'},${layer === 1 ? .5 : .82})`;
          ctx.fillRect(snap(wx), snap(wy), PX * 2, PX * 2);
        }

        // a lit marquee band on some near buildings
        if (b.ticker && b.w > 70) {
          blk(b.x + 4, top + b.h - 46, b.w - 8, 12, '#0d1c31');
          const off = (tick * 1.3) % 24;
          for (let x = b.x + 6 - off; x < b.x + b.w - 8; x += 12)
            if (x > b.x + 4) blk(x, top + b.h - 43, 6, 6, Math.random() < .5 ? '#8fbf9f' : '#d9a28d');
        }
      }
    }

    // --- pavement and road ---
    blk(0, GROUND - 10, W, 10, L.walk);
    blk(0, GROUND - 10, W, PX, L.kerb);
    blk(0, GROUND, W, H - GROUND, L.road);
    for (let x = -((dist * 12) % 72); x < W; x += 72) blk(x, GROUND + 18, 34, PX, '#22344c');
    // kerb ticks, moving with the road so speed reads at ground level
    for (let x = -((dist * 12) % 36); x < W; x += 36) blk(x, GROUND - 4, 12, PX, '#243b55');

    // --- lampposts and street signs ---
    for (const l of lamps) {
      blk(l.x, GROUND - 104, PX, 104, '#22364f');
      blk(l.x - 20, GROUND - 108, 48, PX, '#22364f');
      blk(l.x - 24, GROUND - 112, 12, 8, '#f2d08a');           // lamp head
      ctx.fillStyle = 'rgba(242,208,138,.10)';
      ctx.beginPath(); ctx.moveTo(l.x - 18, GROUND - 104);
      ctx.lineTo(l.x + 26, GROUND - 104); ctx.lineTo(l.x + 46, GROUND); ctx.lineTo(l.x - 38, GROUND);
      ctx.closePath(); ctx.fill();
      // sign plate
      const label = L.signs[l.sign];
      ctx.font = '700 9px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const tw = ctx.measureText(label).width;
      blk(l.x + 4, GROUND - 96, tw + 12, 16, '#16324e');
      blk(l.x + 4, GROUND - 96, tw + 12, PX, '#2c4a6b');
      ctx.fillStyle = '#aec8ed';
      ctx.fillText(label, snap(l.x + 10), snap(GROUND - 92));
    }

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
    raf = requestAnimationFrame(frame);
  }

  function end() {
    running = false; over = true;
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
    if (on) { if (raf) cancelAnimationFrame(raf); running = false; $('overlay').hidden = false;
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
    if (paused) { paused = false; running = true; $('overlay').hidden = true; last = performance.now(); raf = requestAnimationFrame(frame); return; }
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
