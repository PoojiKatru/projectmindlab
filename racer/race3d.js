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
const STEER_RATE = 9;
const DRIFT_YAW = 1.05;      // extra rotation the back end gives you on the handbrake

let scene, camera, renderer, clock;
let curve, curveLen, roadMesh;
let car, rivals = [], cockpit = null, camMode = 0;   // 0 = cockpit
let dist = 0, lat = 0, speed = 0, steer = 0, yaw = 0, slip = 0, keys = {};
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

// ---------- procedural textures ----------
// Flat colour is what makes a low-poly scene read as a toy. Noise, a lane line
// and kerb stripes cost nothing and do most of the work.
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tx = new THREE.CanvasTexture(c);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(rx, ry);
  tx.anisotropy = 8;
  return tx;
}

function asphaltTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#14141c'; g.fillRect(0, 0, w, h);
    // wet sheen: long smears of reflected neon down the lane
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, len = 20 + Math.random() * 90;
      g.fillStyle = ['rgba(255,60,160,.05)', 'rgba(60,230,255,.05)', 'rgba(160,90,255,.05)'][i % 3];
      g.fillRect(x, Math.random() * h, 3 + Math.random() * 5, len);
    }
    for (let i = 0; i < 7000; i++) {                       // aggregate
      const v = 16 + Math.random() * 26;
      g.fillStyle = `rgba(${v},${v},${v + 8},${0.3 + Math.random() * 0.5})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    g.fillStyle = 'rgba(255,240,210,.8)';                      // centre dashes
    g.fillRect(w / 2 - 3, 0, 6, h * 0.42);
    g.fillStyle = 'rgba(255,255,255,.65)';                     // edges
    g.fillRect(3, 0, 5, h); g.fillRect(w - 8, 0, 5, h);
  });
}

// Not grass any more — this is the wet concrete run-off either side of a city
// street at night, picking up a little of the neon around it.
function grassTex(rx, ry) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#191a24'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(38,40,56,.6)' : 'rgba(70,60,95,.35)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = ['rgba(255,60,160,.06)', 'rgba(60,230,255,.06)'][i % 2];
      g.fillRect(Math.random() * w, Math.random() * h, 4, 22);
    }
  }, rx, ry);
}

function kerbTex() {
  return canvasTex(64, 64, (g, w, h) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#ff2fa0' : '#26e8ff';     // neon kerbing
      g.fillRect(0, i * (h / 4), w, h / 4);
    }
  }, 1, 1);
}

function skyDome() {
  const tx = canvasTex(8, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0.00, '#05030f');
    grd.addColorStop(0.45, '#140a2c');
    grd.addColorStop(0.78, '#3a1350');
    grd.addColorStop(1.00, '#6b1f52');            // neon haze on the horizon
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {                // stars, thinning toward the glow
      const y = Math.random() * h * 0.55;
      g.fillStyle = `rgba(220,230,255,${(0.7 - y / h).toFixed(2)})`;
      g.fillRect(Math.random() * w, y, 1, 1);
    }
  });
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1700, 24, 16),
    new THREE.MeshBasicMaterial({ map: tx, side: THREE.BackSide, fog: false }));
  return m;
}

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
  const road = [], kerbL = [], kerbR = [], verge = [], uv = [];
  const push = (arr, v) => arr.push(v.x, v.y, v.z);
  for (let i = 0; i <= N; i++) {
    const p = pts[i], n = normals[i];
    const l = p.clone().addScaledVector(n, ROAD_W), r = p.clone().addScaledVector(n, -ROAD_W);
    push(road, l); push(road, r);
    uv.push(0, i * 0.35, 1, i * 0.35);
    push(kerbL, l); push(kerbL, l.clone().addScaledVector(n, 2.4));
    push(kerbR, r.clone().addScaledVector(n, -2.4)); push(kerbR, r);
    push(verge, l.clone().addScaledVector(n, 2.4).setY(p.y - 0.15));
    push(verge, r.clone().addScaledVector(n, -2.4).setY(p.y - 0.15));
  }

  // Surface normals are written explicitly as the true road normal (tangent
  // crossed with the lateral). Letting computeVertexNormals guess produced
  // downward normals on this winding, which rendered the tarmac black and let
  // back-face culling cut holes in it.
  const ribbon = (flat, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    const nrm = [];
    for (let i = 0; i <= N; i++) {
      const up = new THREE.Vector3().crossVectors(normals[i], tangents[i]).normalize();
      if (up.y < 0) up.negate();
      nrm.push(up.x, up.y, up.z, up.x, up.y, up.z);
    }
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return new THREE.Mesh(g, mat);
  };

  roadMesh = ribbon(road, new THREE.MeshLambertMaterial({
    color: 0xffffff, map: asphaltTex(), side: THREE.DoubleSide }));
  scene.add(roadMesh);

  const kerbMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: kerbTex(), side: THREE.DoubleSide });
  for (const flat of [kerbL, kerbR]) scene.add(ribbon(flat, kerbMat));
  scene.add(ribbon(verge, new THREE.MeshLambertMaterial({
    color: 0xffffff, map: grassTex(6, 40), side: THREE.DoubleSide })));

  // armco barriers + advertising boards on the outside of the lap
  const barGeo = new THREE.BoxGeometry(1, 1.1, 1);
  const barMat = new THREE.MeshLambertMaterial({ color: 0x2b2340, emissive: 0x2a0f3d });
  const adMat = [0xff2fa0, 0x26e8ff, 0xb44cff].map((c) => new THREE.MeshBasicMaterial({ color: c }));
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

  // City blocks pressed right up against the barriers, so the circuit runs
  // through streets rather than past scenery.
  const NEON = [0xff2fa0, 0x26e8ff, 0xb44cff, 0xffd23f, 0x3fff9e];
  const blockMat = new THREE.MeshLambertMaterial({ color: 0x1b1730 });
  const nBlocks = 150;
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), blockMat, nBlocks);
  const winMats = NEON.map((c) => new THREE.MeshBasicMaterial({ color: c, fog: true }));
  const strips = NEON.map((c, i) => new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1), winMats[i], 90));
  const stripN = NEON.map(() => 0);

  for (let bIdx = 0; bIdx < nBlocks; bIdx++) {
    const i = Math.floor(Math.random() * N), s = Math.random() < 0.5 ? 1 : -1;
    const off = ROAD_W + 11 + Math.random() * 26;
    const p = pts[i].clone().addScaledVector(normals[i], s * off);
    const hgt = 16 + Math.random() * 62, wid = 12 + Math.random() * 16, dep = 12 + Math.random() * 20;
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangents[i]);
    m.compose(new THREE.Vector3(p.x, p.y + hgt / 2, p.z), q, new THREE.Vector3(wid, hgt, dep));
    blocks.setMatrixAt(bIdx, m);

    // a vertical neon sign down the face that looks at the road
    const ci = Math.floor(Math.random() * NEON.length);
    if (stripN[ci] < 90) {
      const sh = hgt * (0.3 + Math.random() * 0.45);
      const at = p.clone().addScaledVector(normals[i], -s * (wid / 2 + 0.3));
      m.compose(new THREE.Vector3(at.x, at.y + hgt * 0.55, at.z), q,
                new THREE.Vector3(0.5, sh, 1.6 + Math.random() * 2.2));
      strips[ci].setMatrixAt(stripN[ci]++, m);
    }
  }
  blocks.instanceMatrix.needsUpdate = true;
  scene.add(blocks);
  strips.forEach((sm, i) => { sm.count = stripN[i]; sm.instanceMatrix.needsUpdate = true; scene.add(sm); });

  // overhead neon gates every so often, straddling the street
  for (let i = 0; i < N; i += 90) {
    const p = pts[i], nn = normals[i];
    const bar = new THREE.Mesh(new THREE.BoxGeometry((ROAD_W + 6) * 2, 0.7, 0.7),
      new THREE.MeshBasicMaterial({ color: NEON[(i / 90) % NEON.length] }));
    bar.position.copy(p).setY(p.y + 7.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), nn);
    scene.add(bar);
  }

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
function placeOnTrack(obj, d, offset, yaw = 0, bank = 0) {
  const u = ((d % curveLen) + curveLen) % curveLen / curveLen;
  curve.getPointAt(u, _p);
  curve.getTangentAt(u, _t).normalize();
  _n.crossVectors(_t, new THREE.Vector3(0, 1, 0)).normalize();
  obj.position.copy(_p).addScaledVector(_n, offset);
  obj.position.y += 0.02;
  const look = obj.position.clone().add(_t);
  obj.lookAt(look);
  // three.js lookAt swaps target and position for non-cameras, so a mesh ends up
  // facing +z — the opposite of a camera. The models are nose-first down -z, so
  // the half turn is required. Verified rather than reasoned: without it the
  // nose reads (0,0,-1) while travelling toward +z.
  obj.rotateY(Math.PI);
  // Negated: after that flip a positive rotateY turns the nose away from +lat,
  // which would point the car opposite to the way it slides.
  if (yaw) obj.rotateY(-yaw);
  if (bank) obj.rotateZ(bank);       // rotateZ, not rotation.z — assigning the
                                     // euler would discard what lookAt wrote
  // Return copies. These scratch vectors are overwritten by the next call, and
  // the camera used to be built from a rival's frame because of it.
  return { p: _p.clone(), t: _t.clone(), n: _n.clone() };
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

// ---------- cockpit ----------
// Parented to the camera, so it stays locked to your eyeline exactly the way a
// real car does. This is what turns "watching a car" into "driving one".
let wheelMesh = null;
function buildCockpit() {
  const g = new THREE.Group();
  const carbon = new THREE.MeshLambertMaterial({ color: 0x15181e });
  const body = new THREE.MeshLambertMaterial({ color: 0x1f6f5c });
  const accent = new THREE.MeshLambertMaterial({ color: 0x2fe0b0 });

  // nose stretching away in front of you
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.2, 2.6), body);
  nose.position.set(0, -0.62, -2.15); g.add(nose);
  const wingF = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.42), accent);
  wingF.position.set(0, -0.72, -3.35); g.add(wingF);

  // front wheels in the corners of your vision
  const tyre = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 14);
  const tm = new THREE.MeshLambertMaterial({ color: 0x0d1014 });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(tyre, tm);
    w.position.set(s * 0.78, -0.56, -1.65); w.rotation.z = Math.PI / 2; g.add(w);
  }

  // halo, exactly where it sits in your view in a modern car
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 22, Math.PI * 1.15), carbon);
  halo.position.set(0, -0.02, -0.62); halo.rotation.x = Math.PI / 2; halo.rotation.z = Math.PI;
  g.add(halo);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), carbon);
  strut.position.set(0, -0.06, -0.92); g.add(strut);

  // cockpit sides
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 1.5), body);
    side.position.set(s * 0.42, -0.55, -0.9); g.add(side);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.11, 0.05), carbon);
    mir.position.set(s * 0.62, -0.3, -0.95); g.add(mir);
  }

  // steering wheel, which turns with your input
  wheelMesh = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.026, 8, 20), carbon);
  wheelMesh.add(rim);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.05, 0.03), carbon);
  wheelMesh.add(bar);
  const disp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.012),
    new THREE.MeshBasicMaterial({ color: 0x39d98a }));
  disp.position.set(0, 0.005, 0.02); wheelMesh.add(disp);
  wheelMesh.position.set(0, -0.36, -0.52);
  wheelMesh.rotation.x = -0.5;
  g.add(wheelMesh);

  g.renderOrder = 10;
  return g;
}

// ---------- scene ----------
function init() {
  const host = $('view');
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a0f3d, 120, 620);   // neon haze eats the distance

  camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.4, 2600);
  scene.add(skyDome());

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  host.appendChild(renderer.domElement);
  resize();
  addEventListener('resize', resize);

  // City light, not daylight: a cool wash from above, magenta bounce from below,
  // and two coloured keys so everything picks up a pink or cyan edge.
  scene.add(new THREE.HemisphereLight(0x5a4a9a, 0xff2f8a, 0.85));
  const k1 = new THREE.DirectionalLight(0xff5fc0, 1.05); k1.position.set(-180, 140, 90);
  const k2 = new THREE.DirectionalLight(0x40d8ff, 0.9); k2.position.set(170, 120, -140);
  scene.add(k1); scene.add(k2);
  scene.add(new THREE.AmbientLight(0x2a2050, 0.7));

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshLambertMaterial({ color: 0x0d0d16 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -14;
  scene.add(ground);

  // far hills, so the horizon is not empty
  // distant skyline instead of hills
  const farMat = new THREE.MeshLambertMaterial({ color: 0x140f28 });
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + Math.random() * 0.05, r = 780 + Math.random() * 420;
    const hh = 90 + Math.random() * 300;
    const b = new THREE.Mesh(new THREE.BoxGeometry(40 + Math.random() * 70, hh, 40 + Math.random() * 70), farMat);
    b.position.set(Math.cos(a) * r, -14 + hh / 2, Math.sin(a) * r);
    scene.add(b);
  }

  buildCircuit();

  car = buildCar(0x1f6f5c, 0x2fe0b0);
  scene.add(car);
  cockpit = buildCockpit();
  camera.add(cockpit);
  scene.add(camera);           // camera must be in the graph for its child to render
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
  dist = 0; lat = 0; speed = 0; steer = 0; yaw = 0; slip = 0;
  lap = 1; lapTime = 0; over = false; started = false;
  rivals.forEach((r, i) => { r.d = (i + 1) * 34; r.lap = 1; r.prev = 0; });
  syncWorld(0);
}

function syncWorld(dt) {
  const info = placeOnTrack(car, dist, lat, yaw + slip, -steer * 0.06 - slip * 0.10);
  for (const r of rivals) placeOnTrack(r.obj, r.d, r.lat);

  // chase camera, or cockpit
  const u = ((dist % curveLen) + curveLen) % curveLen / curveLen;
  const ahead = curve.getPointAt((u + 0.012) % 1);
  const v = speed / MAX_SPEED;
  // Field of view opens up with speed. It is the cheapest and most convincing
  // sense of velocity there is.
  const wantFov = (camMode === 0 ? 68 : 62) + v * 16;
  if (Math.abs(camera.fov - wantFov) > 0.05) {
    camera.fov += (wantFov - camera.fov) * (dt ? clamp(dt * 3, 0, 1) : 1);
    camera.updateProjectionMatrix();
  }
  const rough = (Math.abs(lat) > ROAD_W ? 0.06 : 0.012) * v;

  if (camMode === 0) {
    car.visible = false; cockpit.visible = true;
    // Sit in the car and take its orientation, so the view swings with the nose
    // instead of always facing down the track no matter which way you point.
    camera.quaternion.copy(car.quaternion);
    camera.position.copy(car.position).add(new THREE.Vector3(0, 1.12, 0));
    camera.translateZ(0.35);
    camera.position.x += (Math.random() - 0.5) * rough;
    camera.position.y += (Math.random() - 0.5) * rough;
    camera.rotateZ(-steer * 0.05);                  // leans as you turn
  } else {
    car.visible = true; cockpit.visible = false;
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
    const want = car.position.clone().addScaledVector(back, 8.6).add(new THREE.Vector3(0, 3.1, 0));
    camera.position.lerp(want, dt ? clamp(dt * 6, 0, 1) : 1);
    camera.lookAt(car.position.x, car.position.y + 1.1, car.position.z);
  }
  if (wheelMesh) wheelMesh.rotation.z = -steer * 1.5;
}

function step(dt) {
  const k = curvatureAt(dist);
  if (started && !over) {
    steer = lerp(steer, (keys.left ? -1 : 0) + (keys.right ? 1 : 0), clamp(dt * 10, 0, 1));
    const v = speed / MAX_SPEED;

    // Steering points the car; the car then travels where its nose points. The
    // old model slid you sideways regardless of heading, which is why it felt
    // like dragging a sprite rather than driving. Turn-in needs speed — a
    // stationary car does not change direction, and grip falls away as you go
    // faster, so you understeer if you ask too much.
    const bite = clamp(speed / 26, 0, 1) * (1 - v * 0.34);
    yaw += steer * bite * 1.9 * dt;
    yaw -= yaw * dt * 2.4;                    // self-centres, as a real car does
    // Cornering load goes with speed squared: that is what makes braking for a
    // corner the right move rather than a suggestion.
    yaw += k * v * v * 0.30 * dt;             // the corner pushes the nose wide
    // Handbrake breaks the back end loose. Slip is the angle the car is rotated
    // beyond where it is actually travelling — so you point into the corner and
    // keep the throttle on, which is the whole appeal.
    const wantSlip = keys.drift && speed > 22 ? steer * DRIFT_YAW : 0;
    slip = lerp(slip, wantSlip, clamp(dt * (keys.drift ? 3.4 : 2.6), 0, 1));
    if (keys.drift) speed += -7 * dt;                  // sliding scrubs some speed
    yaw = clamp(yaw, -0.62, 0.62);
    lat += Math.sin(yaw) * speed * dt;

    if (keys.gas) speed += ACCEL * dt;
    else if (keys.brake) speed += BRAKE * dt;
    else speed += DRAG * dt;

    if (Math.abs(lat) > ROAD_W && speed > OFF_MAX) speed += OFF_DRAG * dt;
    lat = clamp(lat, -ROAD_W - 9, ROAD_W + 9);
    speed = clamp(speed, 0, MAX_SPEED);

    lapTime += dt;
  } else if (over) { speed = Math.max(0, speed + DRAG * 2 * dt); yaw *= 0.94; }

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
              ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
              Space: 'drift', ShiftLeft: 'drift' };
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') return begin();
  if (e.code === 'KeyC') { camMode = camMode ? 0 : 1; return; }   // cockpit <-> chase
  if (e.code === 'Space' && !$('panel').hidden) { e.preventDefault(); return $('go').click(); }
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
