/* Apex 3D — a WebGL racer.
 *
 * A real 3D scene: the circuit is a closed spline with elevation, the road is a
 * ribbon mesh built along it, and the camera chases the car in world space. Cars
 * are positioned by (distance along track, lateral offset) and then placed onto
 * the spline, which keeps the handling readable while the rendering stays fully
 * three-dimensional.
 */
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

// ---------- tuning ----------
const ROAD_W = 14;            // metres, half-width
const LAPS = 3;
const FIELD = 5;
const MAX_SPEED = 88;         // m/s ≈ 316 kph
const ACCEL = 15, BRAKE = -38, DRAG = -5, OFF_DRAG = -26, OFF_MAX = 26;
const STEER_RATE = 9;         // metres of lateral travel per second at full lock

let scene, camera, renderer, clock;
let curve, curveLen, roadMesh;
let car, rivals = [], camMode = 0;
let dist = 0, lat = 0, speed = 0, steer = 0, keys = {};
let running = false, started = false, over = false;
let lap = 1, lapTime = 0, best = null, splitT = 0, raf = null, loopId = 0;
let fpsT = 0, fpsN = 0;
try { best = parseFloat(localStorage.getItem('apex3d.best')) || null; } catch (e) {}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function fail(where, err) {
  const msg = `${where}: ${err && err.message ? err.message : err}`;
  try {
    $('p-eyebrow').textContent = 'Something broke';
    $('p-title').textContent = 'It stopped.';
    $('p-text').textContent = msg;
    $('panel').hidden = false;
  } catch (e) {}
  console.error('[apex3d]', msg, err);
}
addEventListener('error', (e) => fail('load', e.error || e.message));

// ---------- circuit ----------
// Control points of a closed circuit, with real elevation change: a downhill
// plunge, a long uphill sweep, and a fast final straight.
const CONTROL = [
  [0, 0, 0], [130, 0, -40], [230, 6, -140], [250, 12, -270], [180, 14, -370],
  [40, 10, -420], [-110, 2, -400], [-200, -6, -310], [-215, -12, -180],
  [-160, -8, -60], [-190, -2, 70], [-150, 4, 190], [-30, 8, 250],
  [110, 6, 230], [190, 2, 140], [150, 0, 60],
];

function buildCircuit() {
  curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'catmullrom', 0.5);
  curveLen = curve.getLength();

  const N = 900;
  const pts = curve.getSpacedPoints(N);
  const tangents = [], normals = [];
  for (let i = 0; i <= N; i++) {
    const t = curve.getTangentAt(i / N).normalize();
    tangents.push(t);
    normals.push(new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 1, 0)).normalize());
  }

  // road + kerbs + verge as one ribbon set
  const road = [], kerbL = [], kerbR = [], verge = [];
  const push = (arr, v) => arr.push(v.x, v.y, v.z);
  for (let i = 0; i <= N; i++) {
    const p = pts[i], n = normals[i];
    const l = p.clone().addScaledVector(n, ROAD_W), r = p.clone().addScaledVector(n, -ROAD_W);
    push(road, l); push(road, r);
    push(kerbL, l); push(kerbL, l.clone().addScaledVector(n, 2.4));
    push(kerbR, r.clone().addScaledVector(n, -2.4)); push(kerbR, r);
    push(verge, l.clone().addScaledVector(n, 2.4).setY(p.y - 0.15));
    push(verge, r.clone().addScaledVector(n, -2.4).setY(p.y - 0.15));
  }

  const ribbon = (flat, colour, extra = {}) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: colour, ...extra }));
  };

  roadMesh = ribbon(road, 0x33363c);
  scene.add(roadMesh);

  // kerbs get alternating red/white by splitting into short runs
  for (const [flat, side] of [[kerbL, 1], [kerbR, -1]]) {
    for (let i = 0; i < N; i += 6) {
      const g = new THREE.BufferGeometry(), sub = [];
      const end = Math.min(N, i + 6);
      for (let j = i; j <= end; j++) sub.push(...flat.slice(j * 6, j * 6 + 6));
      g.setAttribute('position', new THREE.Float32BufferAttribute(sub, 3));
      const idx = [];
      for (let j = 0; j < end - i; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({
        color: (i / 6) % 2 ? 0xdedede : 0xd2372c, side: THREE.DoubleSide })));
    }
  }
  scene.add(ribbon(verge, 0x4a7a3e, { side: THREE.DoubleSide }));

  // armco barriers + advertising boards on the outside of the lap
  const barGeo = new THREE.BoxGeometry(1, 1.1, 1);
  const barMat = new THREE.MeshLambertMaterial({ color: 0xd8dade });
  const adMat = [0xc8342a, 0x1f4f8f, 0x1d6b45].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const bars = new THREE.InstancedMesh(barGeo, barMat, Math.floor(N / 3) * 2 + 4);
  let bi = 0; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (let i = 0; i < N; i += 3) {
    const p = pts[i], n = normals[i], t = tangents[i];
    const seglen = pts[Math.min(N, i + 3)].distanceTo(p) + 0.4;
    for (const s of [1, -1]) {
      const at = p.clone().addScaledVector(n, s * (ROAD_W + 5.2)).setY(p.y + 0.55);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      sc.set(0.5, 1.1, seglen);
      m.compose(at, q, sc);
      bars.setMatrixAt(bi++, m);
    }
    if (i % 24 === 0) {                                   // a board every so often
      const p2 = p.clone().addScaledVector(normals[i], (ROAD_W + 7)).setY(p.y + 2.6);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 16), adMat[(i / 24) % 3]);
      board.position.copy(p2); board.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangents[i]);
      scene.add(board);
    }
  }
  bars.count = bi; bars.instanceMatrix.needsUpdate = true;
  scene.add(bars);

  // trees behind the barriers
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 3, 5);
  const crown = new THREE.ConeGeometry(3.2, 11, 7);
  const tMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1c });
  const cMat = new THREE.MeshLambertMaterial({ color: 0x1f5c2e });
  const nTree = 260;
  const tr = new THREE.InstancedMesh(trunk, tMat, nTree), cr = new THREE.InstancedMesh(crown, cMat, nTree);
  for (let k = 0; k < nTree; k++) {
    const i = Math.floor(Math.random() * N), s = Math.random() < 0.5 ? 1 : -1;
    const off = ROAD_W + 12 + Math.random() * 46;
    const p = pts[i].clone().addScaledVector(normals[i], s * off);
    const h = 0.7 + Math.random() * 0.8;
    m.compose(new THREE.Vector3(p.x, p.y + 1.5 * h, p.z), new THREE.Quaternion(), new THREE.Vector3(h, h, h));
    tr.setMatrixAt(k, m);
    m.compose(new THREE.Vector3(p.x, p.y + 8 * h, p.z), new THREE.Quaternion(), new THREE.Vector3(h, h, h));
    cr.setMatrixAt(k, m);
  }
  scene.add(tr); scene.add(cr);

  // start/finish gantry
  const g0 = curve.getPointAt(0), n0 = normals[0], t0 = tangents[0];
  const gant = new THREE.Group();
  const post = new THREE.BoxGeometry(1, 9, 1), pm = new THREE.MeshLambertMaterial({ color: 0x2b3140 });
  for (const s of [1, -1]) {
    const pp = new THREE.Mesh(post, pm);
    pp.position.copy(g0.clone().addScaledVector(n0, s * (ROAD_W + 2)).setY(g0.y + 4.5));
    gant.add(pp);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((ROAD_W + 2) * 2, 2.2, 1), pm);
  beam.position.copy(g0.clone().setY(g0.y + 9.6));
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t0);
  gant.add(beam);
  scene.add(gant);
}

// ---------- cars ----------
function buildCar(colour, accent) {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: colour });
  const dark = new THREE.MeshLambertMaterial({ color: 0x14181f });
  const trim = new THREE.MeshLambertMaterial({ color: accent });

  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
  };
  add(new THREE.BoxGeometry(1.5, 0.42, 4.4), body, 0, 0.55, 0);          // tub
  add(new THREE.BoxGeometry(0.75, 0.34, 2.0), body, 0, 0.62, -2.6);      // nose
  add(new THREE.BoxGeometry(2.9, 0.12, 0.75), trim, 0, 0.30, -3.5);      // front wing
  add(new THREE.BoxGeometry(2.4, 0.10, 0.5), trim, 0, 0.44, -3.5);
  add(new THREE.BoxGeometry(2.2, 0.5, 1.9), body, 0, 0.5, 0.5);          // sidepods
  add(new THREE.BoxGeometry(0.9, 0.72, 1.5), body, 0, 0.95, 1.35);       // airbox
  add(new THREE.BoxGeometry(2.3, 0.62, 0.16), trim, 0, 1.32, 2.35);      // rear wing
  add(new THREE.BoxGeometry(2.3, 0.12, 0.7), body, 0, 1.02, 2.3);
  add(new THREE.BoxGeometry(0.62, 0.3, 0.62), dark, 0, 0.95, -0.55);     // cockpit
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.055, 6, 14, Math.PI), dark);
  halo.position.set(0, 1.06, -0.5); halo.rotation.x = Math.PI / 2; g.add(halo);

  const tyre = new THREE.CylinderGeometry(0.62, 0.62, 0.52, 14);
  const tm = new THREE.MeshLambertMaterial({ color: 0x0d1014 });
  for (const [x, z] of [[-0.95, -2.3], [0.95, -2.3], [-1.05, 1.9], [1.05, 1.9]]) {
    const w = new THREE.Mesh(tyre, tm);
    w.position.set(x, 0.62, z); w.rotation.z = Math.PI / 2; g.add(w);
  }
  return g;
}

// place a car on the circuit from (distance, lateral offset)
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3();
function placeOnTrack(obj, d, offset, bank = 0) {
  const u = ((d % curveLen) + curveLen) % curveLen / curveLen;
  curve.getPointAt(u, _p);
  curve.getTangentAt(u, _t).normalize();
  _n.crossVectors(_t, new THREE.Vector3(0, 1, 0)).normalize();
  obj.position.copy(_p).addScaledVector(_n, offset);
  obj.position.y += 0.02;
  const look = obj.position.clone().add(_t);
  obj.lookAt(look);
  obj.rotateY(Math.PI);              // models face -z
  obj.rotation.z = bank;
  return { p: _p, t: _t, n: _n };
}

// curvature at a distance: how hard the corner is, signed
// Signed corner severity. Sampled over a longer arc than the car occupies so a
// single tight control point does not read as an impossible spike, then clamped:
// raw values peak near 11 here, which would fling you sideways far faster than
// full steering lock could ever answer.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function curvatureAt(d) {
  const u = (x) => (((x % curveLen) + curveLen) % curveLen) / curveLen;
  curve.getTangentAt(u(d), _a).normalize();
  curve.getTangentAt(u(d + 22), _b).normalize();
  _c.crossVectors(_a, _b);
  return clamp(Math.asin(clamp(_c.y, -1, 1)) * 6, -3, 3);
}

// ---------- scene ----------
function init() {
  const host = $('view');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4e4);
  scene.fog = new THREE.Fog(0x9fc4e4, 220, 620);

  camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.5, 2200);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  host.appendChild(renderer.domElement);
  resize();
  addEventListener('resize', resize);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x40603a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
  sun.position.set(-160, 220, 120);
  scene.add(sun);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshLambertMaterial({ color: 0x4d7c3f }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -14;
  scene.add(ground);

  // far hills, so the horizon is not empty
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x5c7f6b });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, r = 900 + Math.random() * 300;
    const h = new THREE.Mesh(new THREE.ConeGeometry(120 + Math.random() * 150, 90 + Math.random() * 140, 6), hillMat);
    h.position.set(Math.cos(a) * r, -14, Math.sin(a) * r);
    scene.add(h);
  }

  buildCircuit();

  car = buildCar(0x1f6f5c, 0x2fe0b0);
  scene.add(car);
  const hues = [[0xc8342a, 0xf0a020], [0x1f4f8f, 0xffffff], [0xe0a01c, 0x202020],
                [0x6b3a8f, 0xd0b0ff], [0x1d6b45, 0xa8f0c0]];
  for (let i = 0; i < FIELD; i++) {
    const r = buildCar(hues[i][0], hues[i][1]);
    scene.add(r);
    rivals.push({ obj: r, d: (i + 1) * 34, lat: (i % 2 ? 1 : -1) * (2 + Math.random() * 4),
                  speed: MAX_SPEED * (0.78 + Math.random() * 0.12), lap: 1, prev: 0,
                  name: ['VOSS', 'RAINE', 'KOVA', 'ADLER', 'SOLIS'][i] });
  }

  reset();
  renderFrame(0);
}

function resize() {
  const s = $('stage');
  const w = s.clientWidth || 960, h = s.clientHeight || 540;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---------- simulation ----------
function reset() {
  dist = 0; lat = 0; speed = 0; steer = 0;
  lap = 1; lapTime = 0; over = false; started = false;
  rivals.forEach((r, i) => { r.d = (i + 1) * 34; r.lap = 1; r.prev = 0; });
  syncWorld(0);
}

function syncWorld(dt) {
  const info = placeOnTrack(car, dist, lat, -steer * 0.05);
  for (const r of rivals) placeOnTrack(r.obj, r.d, r.lat);

  // chase camera, or cockpit
  const u = ((dist % curveLen) + curveLen) % curveLen / curveLen;
  const ahead = curve.getPointAt((u + 0.012) % 1);
  if (camMode === 0) {
    const back = info.t.clone().multiplyScalar(-9.4);
    const want = car.position.clone().add(back).add(new THREE.Vector3(0, 3.6, 0))
      .addScaledVector(info.n, lat * -0.12);
    camera.position.lerp(want, dt ? clamp(dt * 7, 0, 1) : 1);
    camera.lookAt(ahead.x, ahead.y + 1.6, ahead.z);
  } else {
    const want = car.position.clone().addScaledVector(info.t, 0.2).add(new THREE.Vector3(0, 1.35, 0));
    camera.position.copy(want);
    camera.lookAt(ahead.x, ahead.y + 1.2, ahead.z);
  }
}

function step(dt) {
  const k = curvatureAt(dist);
  if (started && !over) {
    steer = lerp(steer, (keys.left ? -1 : 0) + (keys.right ? 1 : 0), clamp(dt * 12, 0, 1));
    const grip = 1 - (speed / MAX_SPEED) * 0.35;
    lat += steer * STEER_RATE * grip * dt;
    // Cornering force goes with speed squared, which is what makes braking for a
    // corner the right move rather than a suggestion.
    const v = speed / MAX_SPEED;
    lat += k * v * v * 3.2 * dt;

    if (keys.gas) speed += ACCEL * dt;
    else if (keys.brake) speed += BRAKE * dt;
    else speed += DRAG * dt;

    if (Math.abs(lat) > ROAD_W && speed > OFF_MAX) speed += OFF_DRAG * dt;
    lat = clamp(lat, -ROAD_W - 9, ROAD_W + 9);
    speed = clamp(speed, 0, MAX_SPEED);

    lapTime += dt;
  } else if (over) speed = Math.max(0, speed + DRAG * 2 * dt);

  const prev = dist;
  dist += speed * dt;
  if (dist >= curveLen) {
    dist -= curveLen;
    if (lap >= LAPS) finish();
    else {
      if (best === null || lapTime < best) {
        best = lapTime;
        try { localStorage.setItem('apex3d.best', String(best)); } catch (e) {}
      }
      showSplit(lapTime);
      lap++; lapTime = 0;
    }
  }

  for (const r of rivals) {
    const rk = Math.abs(curvatureAt(r.d));
    r.speed = lerp(r.speed, MAX_SPEED * (0.80 + Math.random() * 0.12) * (1 - Math.min(0.42, rk * 0.17)), dt * 1.4);
    r.lat = lerp(r.lat, clamp(-curvatureAt(r.d) * 3.4, -ROAD_W + 3, ROAD_W - 3), dt * 1.2);
    r.prev = r.d;
    r.d += r.speed * dt;
    if (r.d >= curveLen) { r.d -= curveLen; r.lap++; }
    // contact
    const gap = Math.abs(((r.d - dist + curveLen * 1.5) % curveLen) - curveLen * 0.5);
    if (gap < 4.2 && Math.abs(r.lat - lat) < 2.2 && started && !over) {
      speed *= 0.72; lat += (lat > r.lat ? 1 : -1) * 1.4;
    }
  }
  syncWorld(dt);
}

function position() {
  const mine = (lap - 1) * curveLen + dist;
  let n = 1;
  for (const r of rivals) if ((r.lap - 1) * curveLen + r.d > mine) n++;
  return n;
}

// ---------- HUD ----------
const fmt = (t) => {
  if (t == null) return '—:—.—';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
const ord = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

function drawTacho(pct) {
  const t = $('tacho'), g = t.getContext('2d'), S = t.width, r = S / 2 - 16;
  g.clearRect(0, 0, S, S);
  g.lineWidth = 14; g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.12)';
  g.beginPath(); g.arc(S / 2, S / 2, r, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
  g.strokeStyle = pct > 0.9 ? '#ff3b30' : pct > 0.7 ? '#ffcc00' : '#39d98a';
  g.beginPath(); g.arc(S / 2, S / 2, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * clamp(pct, 0, 1)); g.stroke();
}

function hud(dt) {
  const pct = speed / MAX_SPEED;
  $('kph').textContent = Math.round(speed * 3.6);
  $('gear').textContent = clamp(Math.ceil(pct * 8), 1, 8);
  $('lap').innerHTML = `${Math.min(lap, LAPS)}<i>/${LAPS}</i>`;
  const p = position();
  $('pos').textContent = p; $('posord').textContent = ord(p);
  $('cur').textContent = fmt(lapTime);
  $('best').textContent = fmt(best);
  drawTacho(pct);
  if (splitT > 0) { splitT -= dt; if (splitT <= 0) $('split').className = 'split'; }
}

function showSplit(t) {
  const el = $('split'), d = best === null ? 0 : t - best;
  el.textContent = (d <= 0 ? '−' : '+') + fmt(Math.abs(d)).replace('0:', '');
  el.className = 'split show ' + (d <= 0 ? 'down' : 'up');
  splitT = 3;
}

// ---------- loop ----------
function renderFrame() { renderer.render(scene, camera); }

function startLoop() {
  if (raf) cancelAnimationFrame(raf);
  const id = ++loopId;
  let last = performance.now();
  const run = (ts) => {
    if (id !== loopId || !running) return;
    let dt = (ts - last) / 1000;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(0.05, dt);
    last = ts;
    try {
      step(dt); renderFrame(); hud(dt);
      fpsN++; fpsT += dt;
      if (fpsT >= 0.5) { $('fps').textContent = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
    } catch (err) { running = false; return fail('frame', err); }
    raf = requestAnimationFrame(run);
  };
  raf = requestAnimationFrame(run);
}

function lights() {
  const box = $('lights'), bulbs = [...box.children];
  box.hidden = false; bulbs.forEach((b) => (b.className = ''));
  let i = 0;
  const tick = () => {
    if (i < 5) { bulbs[i].className = 'on'; i++; setTimeout(tick, 680); return; }
    bulbs.forEach((b) => (b.className = 'go'));
    started = true;
    $('say').textContent = 'Green.';
    setTimeout(() => { box.hidden = true; }, 650);
  };
  setTimeout(tick, 500);
}

function begin() {
  reset(); running = true;
  $('panel').hidden = true; $('hud').hidden = false;
  startLoop(); lights();
}

function finish() {
  over = true; started = false;
  const p = position();
  $('p-eyebrow').textContent = 'Chequered flag';
  $('p-title').textContent = p === 1 ? 'Won it.' : `P${p}.`;
  $('p-text').textContent = `${LAPS} laps. Best lap ${fmt(best)}.`;
  $('go').innerHTML = 'Race again <span aria-hidden="true">→</span>';
  $('panel').hidden = false;
}

// ---------- input ----------
const KEY = { ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake',
              ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') return begin();
  if (e.code === 'KeyC') { camMode = camMode ? 0 : 1; return; }
  const k = KEY[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
  else if (e.code === 'Space' && !$('panel').hidden) { e.preventDefault(); $('go').click(); }
});
addEventListener('keyup', (e) => { const k = KEY[e.code]; if (k) { keys[k] = false; e.preventDefault(); } });
addEventListener('blur', () => { keys = {}; });

for (const [id, k] of [['p-gas', 'gas'], ['p-brake', 'brake'], ['p-left', 'left'], ['p-right', 'right']]) {
  const el = $(id); if (!el) continue;
  const on = (e) => { e.preventDefault(); keys[k] = true; };
  const off = (e) => { e.preventDefault(); keys[k] = false; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off);
}
$('go').addEventListener('click', begin);

// ---------- boot ----------
try {
  init();
  $('best').textContent = fmt(best);
  window.__apexBooted = true;
} catch (err) { fail('init', err); }
