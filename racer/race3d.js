/* Apex 3D — a WebGL racer.
 *
 * A real 3D scene: the circuit is a closed spline with elevation, the road is a
 * ribbon mesh built along it, and the camera chases the car in world space. Cars
 * are positioned by (distance along track, lateral offset) and then placed onto
 * the spline, which keeps the handling readable while the rendering stays fully
 * three-dimensional.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';

const $ = (id) => document.getElementById(id);

// ---------- tuning ----------
const ROAD_W = 14;            // metres, half-width
const LAPS = 3;
const FIELD = 5;
const MAX_SPEED = 88;         // m/s ≈ 316 kph
const ACCEL = 15, BRAKE = -38, DRAG = -5, OFF_DRAG = -26, OFF_MAX = 26;
const STEER_RATE = 9;
const DRIFT_YAW = 1.05;      // extra rotation the back end gives you on the handbrake

let scene, camera, renderer, composer, bloom, trail, envMap;
let curve, curveLen, roadMesh;
let car, rivals = [], cockpit = null, camMode = 0;   // 0 = cockpit
let dist = 0, lat = 0, speed = 0, steer = 0, yaw = 0, slip = 0, hitWall = 0, keys = {};
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
  const R = TR.road;
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = R.base; g.fillRect(0, 0, w, h);
    if (R.wet) for (let i = 0; i < 90; i++) {          // reflected neon smears
      const x = Math.random() * w, len = 20 + Math.random() * 90;
      g.fillStyle = ['rgba(255,60,160,.06)', 'rgba(60,230,255,.06)', 'rgba(160,90,255,.06)'][i % 3];
      g.fillRect(x, Math.random() * h, 3 + Math.random() * 5, len);
    }
    for (let i = 0; i < 7000; i++) {                       // aggregate
      const v = R.grain + Math.random() * 26;
      g.fillStyle = `rgba(${v},${v},${v + 8},${0.3 + Math.random() * 0.5})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    // Fat, bright markings. These are the only cue for where the road goes, so
    // they are deliberately louder than reality.
    g.fillStyle = R.line;
    g.fillRect(w / 2 - 4, 0, 8, h * 0.45);
    g.fillStyle = R.edge;
    g.fillRect(4, 0, 7, h); g.fillRect(w - 11, 0, 7, h);
  });
}

// Not grass any more — this is the wet concrete run-off either side of a city
// street at night, picking up a little of the neon around it.
function grassTex(rx, ry) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = TR.verge; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(255,255,255,${(Math.random() * 0.06).toFixed(3)})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  }, rx, ry);
}

function kerbTex() {
  return canvasTex(64, 64, (g, w, h) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? TR.kerb[0] : TR.kerb[1];
      g.fillRect(0, i * (h / 4), w, h / 4);
    }
  }, 1, 1);
}

function skyDome() {
  const tx = canvasTex(8, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    TR.sky.forEach((c, i) => grd.addColorStop(i / (TR.sky.length - 1), c));
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    if (TR.stars) for (let i = 0; i < 90; i++) {
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

// ---------- circuits ----------
const TRACKS = [
  {
    id: 'shibuya', name: 'Shibuya', when: '2am, raining', env: 'neon', rain: true,
    control: [
      [0,0,0],[130,0,-40],[230,6,-140],[250,12,-270],[180,14,-370],[40,10,-420],
      [-110,2,-400],[-200,-6,-310],[-215,-12,-180],[-160,-8,-60],[-190,-2,70],
      [-150,4,190],[-30,8,250],[110,6,230],[190,2,140],[150,0,60],
    ],
    sky: ['#07050f', '#180c30', '#3d1553', '#7d2a5e'],
    stars: true,
    fog: [0x2a0f3d, 150, 700],
    // Brighter than a real night street on purpose: at true darkness the road
    // disappeared and you could not see where you were going.
    road: { base: '#2b2b36', grain: 22, line: 'rgba(255,246,214,.95)', edge: 'rgba(255,255,255,.85)',
            rough: 0.34, metal: 0.24, wet: true },
    kerb: ['#ff2fa0', '#26e8ff'], kerbGlow: 1.0,
    verge: '#20212e',
    ground: 0x101018,
    lights: { hemi: [0x6a5ab0, 0xff3f96, 1.25], amb: [0x3a3068, 1.0],
              keys: [[0xff6fc8, 1.15, [-180, 140, 90], true], [0x58dcff, 1.05, [170, 120, -140], false]] },
    bloom: 1.15, exposure: 1.18,
  },
  {
    id: 'monaco', name: 'Monte Carlo', when: 'afternoon', env: 'riviera', rain: false,
    // Tight, walled, and climbing: short bursts between corners rather than
    // long sweeps, with a real hill up the back and a plunge to the harbour.
    control: [
      [0,0,0],[95,4,-55],[150,14,-140],[120,26,-215],[35,34,-250],[-60,38,-215],
      [-105,34,-135],[-80,24,-60],[-120,14,20],[-205,8,70],[-250,2,155],
      [-205,-2,235],[-95,-4,255],[35,-2,225],[120,0,150],[110,0,70],
    ],
    sky: ['#1d63b8', '#4d94d8', '#93c4e8', '#d8ecf7'],
    stars: false,
    fog: [0xc8e0f0, 420, 1500],
    road: { base: '#7b7c82', grain: 40, line: 'rgba(255,255,255,.95)', edge: 'rgba(255,255,255,.9)',
            rough: 0.72, metal: 0.06, wet: false },
    kerb: ['#d92b2b', '#f4f4f4'], kerbGlow: 0.0,
    verge: '#8d8f8a',
    ground: 0x6f8f5a,
    lights: { hemi: [0xdff0ff, 0x6b7a55, 1.35], amb: [0xffffff, 0.5],
              keys: [[0xfff4dc, 2.1, [-220, 300, 160], true], [0x9fc8ee, 0.5, [180, 120, -160], false]] },
    bloom: 0.34, exposure: 1.05,
  },
];
// Chosen before anything is built, from the URL or from last time. Switching
// reloads rather than tearing the scene down — the whole world (lighting, fog,
// tone mapping, textures, environment) derives from this, so a rebuild in place
// would be far more to get wrong than a reload is to sit through.
let TR = TRACKS[0];
(() => {
  let want = new URLSearchParams(location.search).get('track');
  if (!want) { try { want = localStorage.getItem('apex3d.track'); } catch (e) {} }
  const found = TRACKS.find((x) => x.id === want);
  if (found) TR = found;
})();
const CONTROL = null;   // superseded by TR.control

function buildCircuit() {
  curve = new THREE.CatmullRomCurve3(
    TR.control.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'catmullrom', 0.5);
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

  roadMesh = ribbon(road, new THREE.MeshStandardMaterial({
    color: 0xffffff, map: asphaltTex(), side: THREE.DoubleSide,
    roughness: 0.34, metalness: 0.22, envMapIntensity: 1.3 }));
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  // Emissive kerbs so bloom catches them and they read as lit strips.
  const kerbMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: kerbTex(), emissiveMap: kerbTex(),
    emissive: 0xffffff, emissiveIntensity: TR.kerbGlow * 0.85,
    roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });
  for (const flat of [kerbL, kerbR]) scene.add(ribbon(flat, kerbMat));
  const vg = ribbon(verge, new THREE.MeshStandardMaterial({
    color: 0xffffff, map: grassTex(6, 40), side: THREE.DoubleSide,
    roughness: 0.55, metalness: 0.1 }));
  vg.receiveShadow = true; scene.add(vg);

  // armco barriers + advertising boards on the outside of the lap
  const barGeo = new THREE.BoxGeometry(1, 1.1, 1);
  const barMat = new THREE.MeshStandardMaterial({ color: 0x2b2340, roughness: 0.6, metalness: 0.35 });
  const adMat = (TR.env === 'neon' ? [0xff2fa0, 0x26e8ff, 0xb44cff] : [0xc8342a, 0x1f4f8f, 0xd8b23a])
    .map((c) => TR.env === 'neon' ? new THREE.MeshBasicMaterial({ color: c })
                                  : new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
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

  const NEON = [0xff2fa0, 0x26e8ff, 0xb44cff, 0xffd23f, 0x3fff9e];

  // The circuit doubles back on itself, so "25m to the side of segment 400" can
  // land squarely on segment 90. Every candidate is checked against the whole
  // centreline — that is why buildings used to stand in the middle of the road.
  const clearOf = (v, need) => {
    for (let j = 0; j < N; j += 2) {
      const dx = v.x - pts[j].x, dz = v.z - pts[j].z;
      if (dx * dx + dz * dz < need * need) return false;
    }
    return true;
  };

  if (TR.env === 'neon') {
    const blockMat = new THREE.MeshStandardMaterial({ color: 0x241f3d, roughness: 0.92, metalness: 0.08 });
    const nBlocks = 150;
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), blockMat, nBlocks);
    const strips = NEON.map((c) => new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: c }), 90));
    const stripN = NEON.map(() => 0);
    let placed = 0;
    for (let attempt = 0; attempt < nBlocks * 14 && placed < nBlocks; attempt++) {
      const i = Math.floor(Math.random() * N), s = Math.random() < 0.5 ? 1 : -1;
      const p = pts[i].clone().addScaledVector(normals[i], s * (ROAD_W + 13 + Math.random() * 24));
      const hgt = 16 + Math.random() * 62, wid = 12 + Math.random() * 16, dep = 12 + Math.random() * 20;
      if (!clearOf(p, ROAD_W + 9 + Math.hypot(wid, dep) / 2)) continue;
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangents[i]);
      m.compose(new THREE.Vector3(p.x, p.y + hgt / 2, p.z), q, new THREE.Vector3(wid, hgt, dep));
      blocks.setMatrixAt(placed++, m);
      const ci = Math.floor(Math.random() * NEON.length);
      if (stripN[ci] < 90) {
        const at = p.clone().addScaledVector(normals[i], -s * (wid / 2 + 0.3));
        m.compose(new THREE.Vector3(at.x, at.y + hgt * 0.55, at.z), q,
                  new THREE.Vector3(0.5, hgt * (0.3 + Math.random() * 0.45), 1.6 + Math.random() * 2.2));
        strips[ci].setMatrixAt(stripN[ci]++, m);
      }
    }
    blocks.count = placed; blocks.instanceMatrix.needsUpdate = true; scene.add(blocks);
    strips.forEach((sm, i) => { sm.count = stripN[i]; sm.instanceMatrix.needsUpdate = true; scene.add(sm); });

    // Street lamps down both sides. Mostly these exist so you can see the road.
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2740, roughness: 0.7, metalness: 0.4 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0 });
    for (let i = 0; i < N; i += 18) {
      const s = (i / 18) % 2 ? 1 : -1;
      const base = pts[i].clone().addScaledVector(normals[i], s * (ROAD_W + 5.6));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 8, 6), lampMat);
      post.position.copy(base).setY(base.y + 4); scene.add(post);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 0.16), lampMat);
      arm.position.copy(base.clone().addScaledVector(normals[i], -s * 1.7)).setY(base.y + 7.9);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), normals[i]); scene.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.28, 0.7), headMat);
      head.position.copy(base.clone().addScaledVector(normals[i], -s * 3.2)).setY(base.y + 7.7);
      scene.add(head);
    }

    for (let i = 0; i < N; i += 90) {                 // overhead neon gates
      const p = pts[i];
      const bar = new THREE.Mesh(new THREE.BoxGeometry((ROAD_W + 6) * 2, 0.7, 0.7),
        new THREE.MeshBasicMaterial({ color: NEON[(i / 90) % NEON.length] }));
      bar.position.copy(p).setY(p.y + 7.5);
      bar.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), normals[i]);
      scene.add(bar);
    }
  } else {
    // Monte Carlo: pale apartment blocks stacked up the hillside, palms, and a
    // harbour full of boats on the low side of the lap.
    const wallCols = [0xe8dcc4, 0xdcc9ab, 0xe6d2be, 0xcfae91, 0xf0e4d2];
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xa8563c, roughness: 0.85 });
    const shutter = new THREE.MeshStandardMaterial({ color: 0x3c5a6b, roughness: 0.7 });
    let placed = 0;
    for (let attempt = 0; attempt < 1400 && placed < 130; attempt++) {
      const i = Math.floor(Math.random() * N), s = Math.random() < 0.5 ? 1 : -1;
      const p = pts[i].clone().addScaledVector(normals[i], s * (ROAD_W + 12 + Math.random() * 30));
      const hgt = 14 + Math.random() * 40, wid = 14 + Math.random() * 14, dep = 14 + Math.random() * 16;
      if (!clearOf(p, ROAD_W + 9 + Math.hypot(wid, dep) / 2)) continue;
      placed++;
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangents[i]);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(wid, hgt, dep),
        new THREE.MeshStandardMaterial({ color: wallCols[placed % wallCols.length], roughness: 0.88 }));
      wall.position.copy(p).setY(p.y + hgt / 2); wall.quaternion.copy(q);
      wall.castShadow = true; wall.receiveShadow = true; scene.add(wall);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(wid + 1.2, 0.8, dep + 1.2), roofMat);
      roof.position.copy(p).setY(p.y + hgt + 0.4); roof.quaternion.copy(q); scene.add(roof);
      for (let f = 1; f * 4 < hgt - 3; f++) {          // shuttered windows
        for (let c = -1; c <= 1; c++) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.3), shutter);
          win.position.copy(p.clone().addScaledVector(normals[i], -s * (wid / 2 + 0.1))
            .addScaledVector(tangents[i], c * (dep / 3.4))).setY(p.y + f * 4);
          win.quaternion.copy(q); scene.add(win);
        }
      }
    }
    // palms
    const palmTrunk = new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.9 });
    const frond = new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < N; i += 26) {
      const s = (i / 26) % 2 ? 1 : -1;
      const base = pts[i].clone().addScaledVector(normals[i], s * (ROAD_W + 7.5));
      if (!clearOf(base, ROAD_W + 5)) continue;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 9, 6), palmTrunk);
      tr.position.copy(base).setY(base.y + 4.5); tr.castShadow = true; scene.add(tr);
      for (let f = 0; f < 7; f++) {
        const fr = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.1), frond);
        fr.position.copy(base).setY(base.y + 9);
        fr.rotation.set(-0.62, (f / 7) * Math.PI * 2, 0);
        fr.translateX(2.4); scene.add(fr);
      }
    }
    // harbour: water plane and boats beside the lowest part of the lap
    let lowI = 0;
    for (let i = 0; i < N; i++) if (pts[i].y < pts[lowI].y) lowI = i;
    const harbour = pts[lowI].clone().addScaledVector(normals[lowI], -(ROAD_W + 70));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(320, 260),
      new THREE.MeshStandardMaterial({ color: 0x2b7fb8, roughness: 0.08, metalness: 0.55, envMapIntensity: 2 }));
    water.rotation.x = -Math.PI / 2; water.position.copy(harbour).setY(pts[lowI].y - 5);
    scene.add(water);
    const hull = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.35, metalness: 0.2 });
    for (let b = 0; b < 22; b++) {
      const bx = harbour.x + (Math.random() - 0.5) * 250, bz = harbour.z + (Math.random() - 0.5) * 200;
      const len = 10 + Math.random() * 22;
      const boat = new THREE.Mesh(new THREE.BoxGeometry(len * 0.3, 2.2, len), hull);
      boat.position.set(bx, pts[lowI].y - 4, bz); boat.rotation.y = Math.random() * Math.PI;
      scene.add(boat);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.22, 1.8, len * 0.35), hull);
      cabin.position.set(bx, pts[lowI].y - 2.2, bz); cabin.rotation.y = boat.rotation.y; scene.add(cabin);
    }
  }

  // ---------- pit straight: grandstand, pit buildings, crowd ----------
  // Placed by walking forward from the line, so they line the main straight
  // instead of landing wherever a random segment happened to be.
  const conc = new THREE.MeshStandardMaterial({ color: 0x232436, roughness: 0.9, metalness: 0.06 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x18324a, roughness: 0.12, metalness: 0.85, envMapIntensity: 1.5 });

  const standStart = 12, standLen = 150;
  const crowdGeo = new THREE.BoxGeometry(0.5, 0.62, 0.5);
  const crowdMats = [0xe8e2d8, 0x2b3a55, 0xa8324a, 0x2f6b4a, 0xd8a03a]
    .map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  const crowds = crowdMats.map((mm) => new THREE.InstancedMesh(crowdGeo, mm, 900));
  const crowdN = crowdMats.map(() => 0);

  for (let i = standStart; i < standStart + standLen; i += 5) {
    const p = pts[i], nn = normals[i], tt = tangents[i];
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tt);

    // grandstand on the left: stepped tiers
    for (let tier = 0; tier < 6; tier++) {
      const outw = ROAD_W + 8 + tier * 2.1;
      const y = p.y + 1.2 + tier * 1.5;
      const step = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.5, 5.2), conc);
      step.position.copy(p.clone().addScaledVector(nn, outw)).setY(y);
      step.quaternion.copy(q); step.receiveShadow = true; scene.add(step);
      for (let c = 0; c < 4; c++) {                       // people on the tier
        if (Math.random() < 0.25) continue;
        const ci = Math.floor(Math.random() * crowdMats.length);
        if (crowdN[ci] >= 900) continue;
        const at = p.clone().addScaledVector(nn, outw + (Math.random() - 0.5) * 1.4)
          .addScaledVector(tt, (c - 1.5) * 1.25).setY(y + 1.06);
        m.compose(at, q, new THREE.Vector3(1, 0.85 + Math.random() * 0.3, 1));
        crowds[ci].setMatrixAt(crowdN[ci]++, m);
      }
    }
    // roof over the stand
    if (i % 25 === standStart % 25) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, 25), conc);
      roof.position.copy(p.clone().addScaledVector(nn, ROAD_W + 15)).setY(p.y + 12.5);
      roof.quaternion.copy(q); scene.add(roof);
    }

    // pit building on the right, with a glazed upper deck
    const pit = new THREE.Mesh(new THREE.BoxGeometry(9, 7, 5.2), conc);
    pit.position.copy(p.clone().addScaledVector(nn, -(ROAD_W + 9))).setY(p.y + 3.5);
    pit.quaternion.copy(q); pit.receiveShadow = true; scene.add(pit);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9.2, 2.2, 5.3), glassMat);
    deck.position.copy(p.clone().addScaledVector(nn, -(ROAD_W + 9))).setY(p.y + 8.2);
    deck.quaternion.copy(q); scene.add(deck);
    // garage opening facing the track
    const bay = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 3.6),
      new THREE.MeshBasicMaterial({ color: NEON[(i / 5) % NEON.length] }));
    bay.position.copy(p.clone().addScaledVector(nn, -(ROAD_W + 4.6))).setY(p.y + 1.9);
    bay.quaternion.copy(q); scene.add(bay);
  }
  crowds.forEach((cm, i) => { cm.count = crowdN[i]; cm.instanceMatrix.needsUpdate = true; scene.add(cm); });

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
function buildCar(colour, accent, isPlayer = false) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: colour, roughness: 0.20, metalness: 0.78, envMapIntensity: 1.6 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 0.42, metalness: 0.62 });
  const trim = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.28, metalness: 0.45, emissive: accent, emissiveIntensity: 0.45 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.94, metalness: 0.02 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.16, metalness: 0.95 });

  const put = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true; g.add(mesh); return mesh;
  };

  // Tub: a capsule, so the body has a rounded section instead of a slab side.
  const tub = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 2.4, 6, 14), paint);
  put(tub, 0, 0.58, 0.1, Math.PI / 2);

  // Nose cone, tapered with a lathe rather than a box.
  const noseProfile = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    noseProfile.push(new THREE.Vector2(0.06 + Math.pow(1 - u, 1.5) * 0.32, u * 2.0));
  }
  const nose = new THREE.Mesh(new THREE.LatheGeometry(noseProfile, 14), paint);
  put(nose, 0, 0.58, -1.55, Math.PI / 2);

  // Wings, bevelled so the edges catch light.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(-1.5, 0); wingShape.lineTo(1.5, 0);
  wingShape.lineTo(1.5, 0.07); wingShape.lineTo(-1.5, 0.07); wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.55, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 2 });
  put(new THREE.Mesh(wingGeo, trim), 0, 0.20, -3.55, -0.16);
  const rw = new THREE.Mesh(wingGeo, trim);
  rw.scale.set(0.78, 1, 1.1);
  put(rw, 0, 1.34, 2.32, 0.22);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.62, 0.42), carbon), -0.86, 1.05, 2.3);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.62, 0.42), carbon), 0.86, 1.05, 2.3);

  // Sidepods with a swept inlet.
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.5, 5, 12), paint);
    put(pod, s * 0.82, 0.5, 0.55, Math.PI / 2, 0, s * 0.06);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.5), carbon), s * 1.06, 0.56, -0.35);
  }

  // Engine cover tapering into the airbox.
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.42, 1.7, 12), paint);
  put(cover, 0, 0.86, 1.35, Math.PI / 2 + 0.06);
  const airbox = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), carbon);
  put(airbox, 0, 1.06, 0.55, -0.25);

  // Halo and cockpit surround.
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 8, 20, Math.PI * 1.2), carbon);
  put(halo, 0, 1.0, -0.5, Math.PI / 2, 0, Math.PI);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), carbon), 0, 1.0, -0.86);

  // Driver: helmet and shoulders, so there is somebody in there.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), new THREE.MeshStandardMaterial({
    color: 0xf2f3f6, roughness: 0.22, metalness: 0.3 }));
  put(helmet, 0, 1.02, -0.28);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 10, 0, Math.PI, 1.1, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x16202c, roughness: 0.08, metalness: 0.9 }));
  put(visor, 0, 1.02, -0.28, 0, Math.PI);
  put(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.34, 4, 10), carbon), 0, 0.86, -0.05, 0, 0, Math.PI / 2);

  // Wheels with rims, and visible suspension arms.
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.56, 20), rubber);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.58, 16), chrome);
  for (const [x, z, front] of [[-1.02, -2.3, 1], [1.02, -2.3, 1], [-1.08, 2.0, 0], [1.08, 2.0, 0]]) {
    const w = tyre.clone(); put(w, x, 0.66, z, 0, 0, Math.PI / 2);
    const r = rim.clone(); put(r, x, 0.66, z, 0, 0, Math.PI / 2);
    const sgn = Math.sign(x);
    for (const dy of [-0.16, 0.2]) {                       // wishbones
      const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x) - 0.42, 0.055, 0.055), carbon);
      put(arm, x - sgn * (Math.abs(x) - 0.42) / 2, 0.66 + dy, z + (front ? 0.16 : -0.16), 0, sgn * 0.16);
    }
  }

  // Lights.
  if (isPlayer) {
    for (const s of [-1, 1]) {
      const beam = new THREE.SpotLight(0xfff0d0, 24, 120, 0.52, 0.45, 1.4);
      beam.position.set(s * 0.3, 0.66, -2.9);
      beam.target.position.set(s * 0.3, 0.0, -40);
      g.add(beam); g.add(beam.target);
      put(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff4dc })), s * 0.3, 0.62, -2.92);
    }
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xff2418 }));
  put(tail, 0, 0.82, 2.5);
  g.userData.tail = tail;
  // Only the player carries a real light. Six point lights plus two spots would
  // push the shader past a sensible budget for no visible gain — the rivals'
  // emissive panels already read as lights once bloom hits them.
  if (isPlayer) {
    const glow = new THREE.PointLight(0xff2418, 2.4, 16, 2);
    glow.position.set(0, 0.82, 2.7); g.add(glow);
    g.userData.glow = glow;
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

// ---------- engine audio ----------
// Synthesised, not sampled — there are no sound files here. Stacked sawtooths
// an octave and a fifth apart give an engine its harmonic character; the
// resonant filter opening with throttle is what makes it sound like it is
// working rather than just droning.
const Audio = (() => {
  let ctx = null, master, engA, engB, engC, engGain, filt, windGain, squealGain;
  let ready = false;

  function noiseBuffer(c) {
    const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function start() {
    if (ready) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.26; master.connect(ctx.destination);

      filt = ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 700; filt.Q.value = 7;
      engGain = ctx.createGain(); engGain.gain.value = 0;
      filt.connect(engGain); engGain.connect(master);

      const mk = (type, detune) => {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = 60; o.detune.value = detune;
        o.connect(filt); o.start(); return o;
      };
      engA = mk('sawtooth', 0);
      engB = mk('sawtooth', 7);        // slightly out, so it beats like a real engine
      engC = mk('square', -1200);      // an octave down for weight

      const wind = ctx.createBufferSource();
      wind.buffer = noiseBuffer(ctx); wind.loop = true;
      const wf = ctx.createBiquadFilter(); wf.type = 'highpass'; wf.frequency.value = 900;
      windGain = ctx.createGain(); windGain.gain.value = 0;
      wind.connect(wf); wf.connect(windGain); windGain.connect(master); wind.start();

      const sq = ctx.createBufferSource();
      sq.buffer = noiseBuffer(ctx); sq.loop = true;
      const sf = ctx.createBiquadFilter(); sf.type = 'bandpass';
      sf.frequency.value = 2400; sf.Q.value = 9;
      squealGain = ctx.createGain(); squealGain.gain.value = 0;
      sq.connect(sf); sf.connect(squealGain); squealGain.connect(master); sq.start();

      ready = true;
      if (muted) master.gain.value = 0;
    } catch (e) { console.warn('[apex3d] audio unavailable', e); }
  }

  // rpm climbs through a gear then drops on the change, so you hear the shift
  function update(v, throttle, slipAmt, offTrack) {
    if (!ready) return;
    const gears = 8;
    const g = clamp(Math.floor(v * gears) + 1, 1, gears);   // floor, so revs drop on the shift
    const inGear = clamp(v * gears - (g - 1), 0, 1);
    const rpm = 0.28 + inGear * 0.72;
    const f = 42 + rpm * 168;
    const now = ctx.currentTime, k = 0.06;
    engA.frequency.setTargetAtTime(f, now, k);
    engB.frequency.setTargetAtTime(f * 1.5, now, k);
    engC.frequency.setTargetAtTime(f * 0.5, now, k);
    filt.frequency.setTargetAtTime(420 + rpm * 2600 + throttle * 900, now, k);
    engGain.gain.setTargetAtTime(0.10 + rpm * 0.5 * (0.55 + throttle * 0.45), now, k);
    windGain.gain.setTargetAtTime(v * v * 0.16, now, 0.12);
    squealGain.gain.setTargetAtTime(Math.min(0.16, slipAmt * 0.22 + (offTrack ? 0.09 : 0)), now, 0.05);
  }

  function stop() { if (ready) { engGain.gain.value = 0; windGain.gain.value = 0; squealGain.gain.value = 0; } }
  // Muting rides the master gain rather than suspending the context, so the
  // engine is already at the right note when you turn it back on.
  let muted = false;
  function setMuted(m) {
    muted = m;
    if (ready) master.gain.setTargetAtTime(m ? 0 : 0.26, ctx.currentTime, 0.02);
    try { localStorage.setItem('apex3d.muted', m ? '1' : '0'); } catch (e) {}
  }
  function isMuted() { return muted; }
  try { muted = localStorage.getItem('apex3d.muted') === '1'; } catch (e) {}
  return { start, update, stop, setMuted, isMuted };
})();

// ---------- rain and spray ----------
// Rain is a block of streaks that follows the camera, so a few thousand lines
// cover the whole world. Spray is a cloud of points that gets kicked up behind
// whichever car is throwing water at you.
let rain = null, spray = null, sprayVel = null;

function buildWeather() {
  const N = 2600, pos = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() - 0.5) * 150, y = Math.random() * 60, z = (Math.random() - 0.5) * 150;
    const len = 1.4 + Math.random() * 2.2;
    pos.set([x, y, z, x + 0.1, y - len, z + 0.35], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
    color: 0xbcd4ff, transparent: true, opacity: 0.34, fog: false }));
  rain.frustumCulled = false;
  scene.add(rain);

  const S = 700, sp = new Float32Array(S * 3);
  sprayVel = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) sp.set([0, -999, 0], i * 3);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  spray = new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xdfe8ff, size: 0.5, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  spray.frustumCulled = false;
  scene.add(spray);
}

let sprayNext = 0;
function updateWeather(dt) {
  if (!rain) return;
  // Move the rain volume with the camera and slide it down; the streaks lean
  // backwards as you go faster, which is most of the sense of driving into it.
  rain.position.set(camera.position.x, camera.position.y - 26, camera.position.z);
  rain.rotation.z = -(speed / MAX_SPEED) * 0.5;
  const rp = rain.geometry.attributes.position, arr = rp.array;
  const fall = 78 * dt;
  for (let i = 0; i < arr.length; i += 6) {
    arr[i + 1] -= fall; arr[i + 4] -= fall;
    if (arr[i + 4] < 0) { const up = 58 + Math.random() * 6; arr[i + 1] += up; arr[i + 4] += up; }
  }
  rp.needsUpdate = true;

  // spray thrown up by the cars in front of you
  const sp = spray.geometry.attributes.position, sa = sp.array;
  for (let i = 0; i < sa.length; i += 3) {
    if (sa[i + 1] < -900) continue;
    sa[i] += sprayVel[i] * dt; sa[i + 1] += sprayVel[i + 1] * dt; sa[i + 2] += sprayVel[i + 2] * dt;
    sprayVel[i + 1] -= 14 * dt;
    if (sa[i + 1] < -1) sa[i + 1] = -999;
  }
  for (const r of rivals) {
    const ahead = ((r.d - dist + curveLen) % curveLen);
    if (ahead > 90 || r.speed < 20) continue;
    for (let k = 0; k < 3; k++) {
      const i = (sprayNext = (sprayNext + 1) % (sa.length / 3)) * 3;
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(r.obj.quaternion);
      sa[i] = r.obj.position.x + back.x * 2.6 + (Math.random() - 0.5);
      sa[i + 1] = r.obj.position.y + 0.4;
      sa[i + 2] = r.obj.position.z + back.z * 2.6 + (Math.random() - 0.5);
      sprayVel[i] = back.x * 9 + (Math.random() - 0.5) * 5;
      sprayVel[i + 1] = 5 + Math.random() * 5;
      sprayVel[i + 2] = back.z * 9 + (Math.random() - 0.5) * 5;
    }
  }
  sp.needsUpdate = true;
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
  scene.fog = new THREE.Fog(TR.fog[0], TR.fog[1], TR.fog[2]);

  camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.4, 2600);
  scene.add(skyDome());

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  // Filmic tone mapping and a correct colour space. Without these, bright neon
  // clips to flat white and everything else reads washed out and plasticky.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TR.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  // Bloom is what makes neon look like light rather than like coloured plastic.
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1024, 576), TR.bloom, 0.62, 0.68);
    composer.addPass(bloom);
    // Motion trail. Held near zero at low speed so the picture stays crisp, then
    // opened up as you get quick — this is the smear at the edge of vision.
    trail = new AfterimagePass(0.72);
    composer.addPass(trail);
    composer.addPass(new SMAAPass(1024, 576));
  } catch (e) {
    // If post-processing is unavailable, draw straight to the screen rather
    // than losing the whole game to a missing effect.
    composer = null; bloom = null;
    console.warn('[apex3d] post-processing unavailable, rendering direct', e);
  }

  // A cheap environment map off the sky dome, so wet tarmac and car paint have
  // something to reflect instead of being uniformly matte.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(skyDome());
  envMap = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = envMap;

  resize();
  addEventListener('resize', resize);

  // City light, not daylight: a cool wash from above, magenta bounce from below,
  // and two coloured keys so everything picks up a pink or cyan edge.
  const L = TR.lights;
  scene.add(new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]));
  scene.add(new THREE.AmbientLight(L.amb[0], L.amb[1]));
  const k1 = new THREE.DirectionalLight(L.keys[0][0], L.keys[0][1]);
  k1.position.set(...L.keys[0][2]);
  k1.castShadow = true;
  k1.shadow.mapSize.set(1024, 1024);
  k1.shadow.camera.near = 20; k1.shadow.camera.far = 620;
  k1.shadow.camera.left = -180; k1.shadow.camera.right = 180;
  k1.shadow.camera.top = 180; k1.shadow.camera.bottom = -180;
  const k2 = new THREE.DirectionalLight(L.keys[1][0], L.keys[1][1]);
  k2.position.set(...L.keys[1][2]);
  scene.add(k1); scene.add(k2);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ color: TR.ground, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -14;
  scene.add(ground);

  // far hills, so the horizon is not empty
  // distant skyline instead of hills
  const farMat = new THREE.MeshStandardMaterial({ color: TR.env === 'neon' ? 0x140f28 : 0x8a9a7c, roughness: 0.95 });
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + Math.random() * 0.05, r = 780 + Math.random() * 420;
    const hh = 90 + Math.random() * 300;
    const b = new THREE.Mesh(new THREE.BoxGeometry(40 + Math.random() * 70, hh, 40 + Math.random() * 70), farMat);
    b.position.set(Math.cos(a) * r, -14 + hh / 2, Math.sin(a) * r);
    scene.add(b);
  }

  buildCircuit();
  if (TR.rain) buildWeather();

  car = buildCar(0x1f6f5c, 0x2fe0b0, true);
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
  if (composer) composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---------- simulation ----------
function reset() {
  dist = 0; lat = 0; speed = 0; steer = 0; yaw = 0; slip = 0; hitWall = 0;
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
  hitWall = Math.max(0, hitWall - (dt || 0) * 2.2);
  const rough = (Math.abs(lat) > ROAD_W ? 0.06 : 0.012) * v + hitWall * 0.28;

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
  // brake lights
  const braking = keys.brake ? 1 : 0;
  if (car.userData.tail) car.userData.tail.material.color.setHex(braking ? 0xff5a4a : 0xff2418);
  if (car.userData.glow) car.userData.glow.intensity = braking ? 6.5 : 2.4;
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
    const bite = clamp(speed / 26, 0, 1) * (1 - v * 0.30);
    yaw += steer * bite * 2.6 * dt;
    // Weaker self-centring than before. At 2.4 the car snapped back to following
    // the road the instant you let go, which is why it felt like it was driving
    // itself — your input barely outlived the key press.
    yaw -= yaw * dt * 1.5;
    // Cornering load goes with speed squared, and hard enough that a corner
    // genuinely throws you at the wall if you do not fight it.
    yaw += k * v * v * 0.52 * dt;
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

    // The wall. Without something to hit, running wide cost you nothing and the
    // corner did all the work — this is what makes staying on the road your job.
    const WALL = ROAD_W + 5;
    if (Math.abs(lat) > WALL) {
      const into = Math.min(1, (Math.abs(lat) - WALL) / 3);
      lat = Math.sign(lat) * WALL;
      speed *= 1 - 0.55 * into;                  // scrubs most of your speed
      yaw = -yaw * 0.35;                         // snaps the nose back off the barrier
      hitWall = 0.7;
    }
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
  updateWeather(dt);
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
  $('gear').textContent = clamp(Math.floor(pct * 8) + 1, 1, 8);
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
function renderFrame() {
  // Bloom rises with speed, so the lights smear as you get quicker.
  const vv = speed / MAX_SPEED;
  if (bloom) bloom.strength = TR.bloom * (0.82 + vv * 0.55);
  if (trail) trail.uniforms.damp.value = 0.55 + Math.pow(vv, 2) * 0.33;
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

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
      Audio.update(speed / MAX_SPEED, keys.gas ? 1 : keys.brake ? 0 : 0.25,
                   Math.abs(slip), Math.abs(lat) > ROAD_W);
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
  Audio.start();                 // must follow a user gesture
  reset(); running = true;
  $('panel').hidden = true; $('hud').hidden = false;
  startLoop(); lights();
}

function finish() {
  over = true; started = false; Audio.stop();
  const p = position();
  $('p-eyebrow').textContent = 'Chequered flag';
  $('tracks').hidden = true;
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
  if (e.code === 'KeyM') { Audio.setMuted(!Audio.isMuted()); paintMute(); return; }
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
function paintMute() {
  const b = $('mute');
  if (b) b.setAttribute('aria-pressed', String(Audio.isMuted()));
}
$('mute').addEventListener('click', (e) => {
  e.preventDefault();
  Audio.setMuted(!Audio.isMuted());
  paintMute();
});
paintMute();

// circuit picker
(() => {
  const host = $('tracks');
  if (!host) return;
  for (const trk of TRACKS) {
    const b = document.createElement('button');
    b.innerHTML = `<b>${trk.name}</b><small>${trk.when}</small>`;
    b.setAttribute('aria-pressed', String(trk.id === TR.id));
    b.addEventListener('click', () => {
      if (trk.id === TR.id) return;
      try { localStorage.setItem('apex3d.track', trk.id); } catch (e) {}
      location.search = '?track=' + trk.id;
    });
    host.appendChild(b);
  }
})();

$('go').addEventListener('click', begin);

// ---------- boot ----------
try {
  $('p-eyebrow').textContent = `Circuit · ${TR.name}, ${TR.when}`;
  $('p-text').innerHTML = TR.env === 'neon'
    ? 'Sound on. Three laps through the neon. Hold <b>SPACE</b> into a corner to kick the back out.'
    : 'Sound on. Three laps round the harbour. Walls on both sides — there is no run-off here.';
  init();
  $('best').textContent = fmt(best);
  window.__apexBooted = true;
} catch (err) { fail('init', err); }
