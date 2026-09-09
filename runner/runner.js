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
    sky: ['#0d1b2f', '#132740'],
    far: '#16273d', near: '#1b3050', road: '#0b1524',
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
  function buildSkyline() {
    skyline = [];
    for (const [layer, gap, minH, maxH] of [[0, 74, 70, 150], [1, 52, 100, 210]]) {
      let x = -60;
      while (x < W + 260) {
        const w = 34 + Math.random() * gap;
        skyline.push({ layer, x, w, h: minH + Math.random() * (maxH - minH), lit: Math.random() });
        x += w + 8 + Math.random() * 20;
      }
    }
    lamps = [];
    for (let x = 0; x < W + 200; x += 210) lamps.push({ x, sign: Math.floor(Math.random() * level().signs.length) });
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

    for (const b of skyline) { b.x -= speed * dt * (b.layer ? 0.22 : 0.1); if (b.x + b.w < -80) b.x += W + 320; }
    for (const l of lamps) { l.x -= speed * dt * 0.55; if (l.x < -140) l.x += W + 280; }

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
  function paint() {
    const L = level();
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, L.sky[0]); g.addColorStop(1, L.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND);

    for (const b of skyline) {
      ctx.fillStyle = b.layer ? L.near : L.far;
      const top = GROUND - b.h;
      ctx.fillRect(b.x, top, b.w, b.h);
      // lit windows
      ctx.fillStyle = b.layer ? 'rgba(174,200,237,.13)' : 'rgba(174,200,237,.07)';
      for (let y = top + 12; y < GROUND - 14; y += 16)
        for (let x = b.x + 7; x < b.x + b.w - 8; x += 13)
          if (((x * 7 + y * 3 + b.lit * 90) | 0) % 5 < 2) ctx.fillRect(x, y, 5, 7);
    }

    for (const l of lamps) {
      ctx.fillStyle = '#22364f';
      ctx.fillRect(l.x, GROUND - 96, 3, 96);
      ctx.fillRect(l.x - 26, GROUND - 96, 55, 3);
      ctx.fillStyle = 'rgba(174,200,237,.55)';
      ctx.font = '10px Arial'; ctx.textAlign = 'left';
      ctx.fillText(L.signs[l.sign], l.x - 24, GROUND - 100);
    }

    ctx.fillStyle = L.road; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = '#2a3d57'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, GROUND + 1); ctx.lineTo(W, GROUND + 1); ctx.stroke();
    ctx.fillStyle = '#1d2c42';
    for (let x = -((dist * 12) % 60); x < W; x += 60) ctx.fillRect(x, GROUND + 16, 30, 3);

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
