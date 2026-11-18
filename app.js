import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import Module from 'manifold-3d';

/* ---------------------------------------------------------------- constants
   Measured from the original pair (Battle-Box-Tray-High.stl / Lid-Blank.stl):
     z 0.00 –  2.40  solid base plate
     z 2.40 –  5.50  base flare / chamfer ring
     z 5.50 – 33.45  constant 8 mm perimeter wall      ← the "middle"
     z 33.45 – 37.50 interlock band + rails            ← kept verbatim
   Footprint 234 × 150 mm. Cavity 218 × 142 mm. Lid 234 × 150 × 6 mm.
*/
const BASE_TOP = 5.5;
const BAND_BOTTOM = 33.45;
const ORIGINAL_H = 37.5;
const CAVITY_FLOOR = 2.5;
const PLA_DENSITY = 1.24;   // g/cm³

const state = { height: ORIGINAL_H, cols: 1, rows: 1, divider: 2.4, margin: 1.0,
                showLid: true, showWire: false,
                mode: 'grid', shape: 'rect', pockets: [], pocketDepth: null };
// pockets: { kind:'rect'|'round', cx, cy, w, h }  (model mm, y-up, centred on the footprint)
// pocketDepth: null = full depth down to the interior floor

/* ---------------------------------------------------------------- three.js */
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(view.clientWidth, view.clientHeight);
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
const camera = new THREE.PerspectiveCamera(38, view.clientWidth / view.clientHeight, 1, 4000);
camera.up.set(0, 0, 1);
camera.position.set(300, -340, 280);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 18);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x1a2430, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 1.55); key.position.set(260, -180, 420); scene.add(key);
const rim = new THREE.DirectionalLight(0x88bbff, 0.5); rim.position.set(-320, 280, 160); scene.add(rim);

const grid = new THREE.GridHelper(600, 24, 0x1e2a38, 0x161f29);
grid.rotation.x = Math.PI / 2; grid.position.z = -0.2; scene.add(grid);

const matBody = new THREE.MeshStandardMaterial({ color: 0x9fb4c9, roughness: 0.6, metalness: 0.12, side: THREE.DoubleSide });
const matLid = new THREE.MeshStandardMaterial({ color: 0x6f8497, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
const matWire = new THREE.MeshBasicMaterial({ color: 0x2b3a4a, wireframe: true, transparent: true, opacity: 0.5 });

const bodyMesh = new THREE.Mesh(new THREE.BufferGeometry(), matBody);
const lidMesh = new THREE.Mesh(new THREE.BufferGeometry(), matLid);
const wireMesh = new THREE.Mesh(new THREE.BufferGeometry(), matWire);
wireMesh.visible = false;
scene.add(bodyMesh, lidMesh, wireMesh);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

/* --------------------------------------------------------------- manifold */
let M = null;                      // wasm module namespace
let baseManifold = null, bandMesh = null, lidGeom = null;
let outerLoop = null, innerLoop = null;
let cavity = { x0: -109, x1: 109, y0: -70, y1: 72 };

const dedupe = (pts) => {
  const out = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-4) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 1e-4) out.pop();
  return out;
};
const signedArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
const ccw = (p) => (signedArea(p) > 0 ? p : [...p].reverse());

function geomToManifoldMesh(bufferGeometry) {
  const pos = bufferGeometry.attributes.position.array;
  const vertProperties = new Float32Array(pos);
  const n = pos.length / 3;
  const triVerts = new Uint32Array(n);
  for (let i = 0; i < n; i++) triVerts[i] = i;
  const mesh = new M.Mesh({ numProp: 3, vertProperties, triVerts });
  mesh.merge();
  return mesh;
}

function manifoldToGeometry(manifold) {
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties, tv = mesh.triVerts;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vp), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(tv), 1));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}

/* ------------------------------------------------------------ build parts */
function ringPrism(z0, depth) {
  const cs = new M.CrossSection([dedupe(ccw(outerLoop)), dedupe(ccw(innerLoop)).reverse()]);
  return M.Manifold.extrude(cs, depth).translate([0, 0, z0]);
}

function layout() {
  const { cols, rows, divider, margin } = state;
  const x0 = cavity.x0 + margin, x1 = cavity.x1 - margin;
  const y0 = cavity.y0 + margin, y1 = cavity.y1 - margin;
  const pw = (x1 - x0 - divider * (cols - 1)) / cols;
  const pd = (y1 - y0 - divider * (rows - 1)) / rows;
  return { x0, x1, y0, y1, pw, pd, cols, rows, divider };
}

function interiorHeight() {
  return BAND_BOTTOM + (state.height - ORIGINAL_H) - 0.4 - CAVITY_FLOOR;
}

function effectiveDepth() {
  const full = interiorHeight();
  return state.pocketDepth == null ? full : Math.min(state.pocketDepth, full);
}

/* Push a loop outward by d mm (radially) so a union with the wall overlaps
   material instead of merely touching a face. */
function growLoop(loop, d) {
  const n = loop.length;
  const cx = loop.reduce((a, p) => a + p[0], 0) / n;
  const cy = loop.reduce((a, p) => a + p[1], 0) / n;
  return loop.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * d, y + (dy / l) * d];
  });
}

/* The source base plate carries an embossed maker logo near one corner of the
   floor (letters at z 2.1–2.45). A flat slab over the cavity floor removes it. */
function floorSlab() {
  const cs = new M.CrossSection([dedupe(ccw(growLoop(innerLoop, 0.25)))]);
  return M.Manifold.extrude(cs, CAVITY_FLOOR - 1.9).translate([0, 0, 1.9]);
}

function buildTray() {
  const dh = state.height - ORIGINAL_H;
  const wall = ringPrism(BASE_TOP - 0.5, BAND_BOTTOM - BASE_TOP + dh + 0.7);
  const band = M.Manifold.ofMesh(bandMesh).translate([0, 0, dh]);
  let tray = M.Manifold.union([baseManifold, floorSlab(), wall, band]);

  if (state.mode === 'draw') return cutPockets(tray);

  const L = layout();
  const { cols, rows, divider } = state;
  const solid = L.pw > 2 && L.pd > 2 && (cols > 1 || rows > 1);
  if (solid) {
    const zBot = 2.2;                            // fuse into the floor plate
    const zTop = BAND_BOTTOM + dh - 0.4;         // stop just under the interlock band
    const h = zTop - zBot, zc = (zTop + zBot) / 2;
    const parts = [];
    for (let c = 1; c < cols; c++) {
      const x = L.x0 + c * (L.pw + divider) - divider / 2;
      parts.push(M.Manifold.cube([divider, L.y1 - L.y0, h], true).translate([x, (L.y0 + L.y1) / 2, zc]));
    }
    for (let r = 1; r < rows; r++) {
      const y = L.y0 + r * (L.pd + divider) - divider / 2;
      parts.push(M.Manifold.cube([L.x1 - L.x0, divider, h], true).translate([(L.x0 + L.x1) / 2, y, zc]));
    }
    if (parts.length) tray = M.Manifold.union([tray, ...parts]);
  }
  return tray;
}

/* Draw mode: the cavity becomes a solid block, then every drawn pocket is cut
   out of it. Pockets are open at the top, never through the base. */
function cutPockets(tray) {
  const dh = state.height - ORIGINAL_H;
  const zTop = BAND_BOTTOM + dh - 0.4;           // rim height of the interior
  const zBot = 2.2;                              // fuse into the floor plate
  const fill = M.Manifold.extrude(new M.CrossSection([dedupe(ccw(growLoop(innerLoop, 0.3)))]), zTop - zBot)
    .translate([0, 0, zBot]);
  let body = M.Manifold.union([tray, fill]);

  const depth = state.pocketDepth == null
    ? zTop - CAVITY_FLOOR
    : Math.min(state.pocketDepth, zTop - CAVITY_FLOOR);
  if (depth <= 0 || !state.pockets.length) return body;

  const cutTop = zTop + 1;                        // cut clean through the top face
  const cutBot = Math.max(CAVITY_FLOOR, zTop - depth);
  const hgt = cutTop - cutBot;
  const cutters = [];
  for (const p of state.pockets) {
    if (p.w < 1.5 || p.h < 1.5) continue;
    if (p.kind === 'round') {
      const r = Math.min(p.w, p.h) / 2;
      if (r < 0.8) continue;
      cutters.push(M.Manifold.cylinder(hgt, r, r, 64).translate([p.cx, p.cy, cutBot]));
    } else {
      cutters.push(M.Manifold.cube([p.w, p.h, hgt], true).translate([p.cx, p.cy, (cutTop + cutBot) / 2]));
    }
  }
  if (cutters.length) body = body.subtract(M.Manifold.union(cutters));
  return body;
}

/* ---------------------------------------------------------------- rebuild */
let building = false, pending = false, framed = false;

function schedule() {
  if (building) { pending = true; return; }
  setTimeout(rebuild, 0);           // not rAF — background tabs suspend it
}

function rebuild() {
  if (!M || !baseManifold) return;
  building = true;
  const t0 = performance.now();
  try {
    const tray = buildTray();
    const geom = manifoldToGeometry(tray);
    bodyMesh.geometry.dispose();
    bodyMesh.geometry = geom;
    wireMesh.geometry = geom;

    const size = geom.boundingBox.getSize(new THREE.Vector3());
    const cm3 = tray.volume() / 1000;
    const L = layout();
    document.getElementById('s-size').textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`;
    document.getElementById('s-vol').textContent = `${cm3.toFixed(0)} cm³ · ${(cm3 * PLA_DENSITY).toFixed(0)} g`;
    document.getElementById('s-pocket').textContent = state.mode === 'draw'
      ? `${state.pockets.length} drawn · ${effectiveDepth().toFixed(1)} mm deep`
      : `${L.pw.toFixed(1)} × ${L.pd.toFixed(1)} × ${(BAND_BOTTOM + (state.height - ORIGINAL_H) - 0.4 - CAVITY_FLOOR).toFixed(1)}`;
    document.getElementById('s-tris').textContent = (geom.index.count / 3).toLocaleString();

    if (state.mode === 'draw') updateDepthUI();

    lidMesh.position.set(0, 0, state.height + 0.4);
    lidMesh.visible = state.showLid;
    frameCamera(size);
    setStatus(`rebuilt in ${((performance.now() - t0) / 1000).toFixed(2)} s · manifold solid`);
  } catch (err) {
    console.error(err);
    setStatus('build failed: ' + err.message);
  } finally {
    building = false;
    if (pending) { pending = false; schedule(); }
  }
}

function frameCamera(size) {
  if (framed) return;
  framed = true;
  const r = Math.max(size.x, size.y, size.z);
  camera.position.set(r * 1.05, -r * 1.15, r * 0.95);
  controls.target.set(0, 0, size.z * 0.35);
  controls.update();
}

/* ------------------------------------------------------------------ export */
function exportSTL(geometry, name) {
  const pos = geometry.attributes.position.array;
  const idx = geometry.index ? geometry.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  const header = name.slice(0, 79);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    const i0 = (idx ? idx[t * 3] : t * 3) * 3;
    const i1 = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3;
    const i2 = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
    const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
    const bx = pos[i1], by = pos[i1 + 1], bz = pos[i1 + 2];
    const cx = pos[i2], cy = pos[i2 + 1], cz = pos[i2 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true);
    dv.setFloat32(o + 24, bx, true); dv.setFloat32(o + 28, by, true); dv.setFloat32(o + 32, bz, true);
    dv.setFloat32(o + 36, cx, true); dv.setFloat32(o + 40, cy, true); dv.setFloat32(o + 44, cz, true);
    o += 50;
  }
  const blob = new Blob([buf], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* --------------------------------------------------------------------- UI */
function setStatus(msg) { document.getElementById('status').textContent = msg; }

const bindings = [
  ['height', 'height', (v) => v.toFixed(1)],
  ['cols', 'cols', (v) => `${v | 0}`],
  ['rows', 'rows', (v) => `${v | 0}`],
  ['divider', 'divider', (v) => v.toFixed(1)],
  ['margin', 'margin', (v) => v.toFixed(1)],
];
for (const [id, keyName, fmt] of bindings) {
  const input = document.getElementById(id);
  const out = document.getElementById(`v-${id}`);
  input.addEventListener('input', () => {
    state[keyName] = parseFloat(input.value);
    out.textContent = fmt(state[keyName]);
    schedule();
  });
  out.textContent = fmt(state[keyName]);
}

document.getElementById('showLid').addEventListener('change', (e) => {
  state.showLid = e.target.checked; lidMesh.visible = state.showLid;
});
document.getElementById('showWire').addEventListener('change', (e) => {
  state.showWire = e.target.checked; wireMesh.visible = e.target.checked;
});
document.getElementById('dl-tray').addEventListener('click', () => {
  const h = state.height.toFixed(1).replace('.', 'p');
  const tag = state.mode === 'draw' ? `draw${state.pockets.length}` : `${state.cols}x${state.rows}`;
  exportSTL(bodyMesh.geometry, `battle-box-tray-${h}mm-${tag}.stl`);
});
document.getElementById('dl-lid').addEventListener('click', () => {
  if (lidGeom) exportSTL(lidGeom, 'battle-box-lid.stl');
});
document.getElementById('reset').addEventListener('click', () => {
  state.height = ORIGINAL_H; state.cols = 1; state.rows = 1; state.divider = 2.4; state.margin = 1.0;
  state.pockets = []; state.pocketDepth = null; state.shape = 'rect';
  setMode('grid');
  for (const [id, keyName, fmt] of bindings) {
    document.getElementById(id).value = state[keyName];
    document.getElementById(`v-${id}`).textContent = fmt(state[keyName]);
  }
  updateShapeUI(); drawPlan(); updatePocketUI();
  framed = false;
  schedule();
});

/* ------------------------------------------------------------------- modes */
const elGrid = document.getElementById('gridctl');
const elDraw = document.getElementById('drawctl');
const btnModeGrid = document.getElementById('mode-grid');
const btnModeDraw = document.getElementById('mode-draw');

function setMode(mode) {
  state.mode = mode;
  elGrid.hidden = mode !== 'grid';
  elDraw.hidden = mode !== 'draw';
  btnModeGrid.classList.toggle('on', mode === 'grid');
  btnModeDraw.classList.toggle('on', mode === 'draw');
  if (mode === 'draw') { drawPlan(); updateDepthUI(); }
  framed = false;
  schedule();
}
btnModeGrid.addEventListener('click', () => setMode('grid'));
btnModeDraw.addEventListener('click', () => setMode('draw'));

const btnShapeRect = document.getElementById('shape-rect');
const btnShapeRound = document.getElementById('shape-round');
function updateShapeUI() {
  btnShapeRect.classList.toggle('on', state.shape === 'rect');
  btnShapeRound.classList.toggle('on', state.shape === 'round');
}
btnShapeRect.addEventListener('click', () => { state.shape = 'rect'; updateShapeUI(); drawPlan(); });
btnShapeRound.addEventListener('click', () => { state.shape = 'round'; updateShapeUI(); drawPlan(); });

/* ------------------------------------------------------- plan editor (2D) */
const plan = document.getElementById('plan');
const ctx = plan.getContext('2d');
const PLAN = { W: 468, H: 300, s: 2 };            // 2 px per mm, footprint 234 × 150

const px = (x) => (x + 117) * PLAN.s;
const py = (y) => (75 - y) * PLAN.s;
const mx = (cx) => cx / PLAN.s - 117;
const my = (cy) => 75 - cy / PLAN.s;

const clampX = (x) => Math.min(cavity.x1 - 0.6, Math.max(cavity.x0 + 0.6, x));
const clampY = (y) => Math.min(cavity.y1 - 0.6, Math.max(cavity.y0 + 0.6, y));

let drag = null;             // { x0, y0, x1, y1 }
let selected = -1;

function sizePlan() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  plan.width = PLAN.W * dpr;
  plan.height = PLAN.H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizePlan();

function drawPlan() {
  ctx.clearRect(0, 0, PLAN.W, PLAN.H);

  // 10 mm grid
  ctx.strokeStyle = '#18222d'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -110; x <= 110; x += 10) { ctx.moveTo(px(x) + 0.5, 0); ctx.lineTo(px(x) + 0.5, PLAN.H); }
  for (let y = -70; y <= 70; y += 10) { ctx.moveTo(0, py(y) + 0.5); ctx.lineTo(PLAN.W, py(y) + 0.5); }
  ctx.stroke();

  // footprint + cavity
  ctx.strokeStyle = '#33475c'; ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, PLAN.W - 2, PLAN.H - 2);
  ctx.strokeStyle = '#4a6a8a'; ctx.lineWidth = 1;
  ctx.strokeRect(px(cavity.x0), py(cavity.y1),
                 (cavity.x1 - cavity.x0) * PLAN.s, (cavity.y1 - cavity.y0) * PLAN.s);

  // pockets
  state.pockets.forEach((p, i) => {
    const sel = i === selected;
    ctx.fillStyle = sel ? 'rgba(77,163,255,.34)' : 'rgba(77,163,255,.18)';
    ctx.strokeStyle = sel ? '#7dc0ff' : '#4da3ff';
    ctx.lineWidth = sel ? 2 : 1.2;
    if (p.kind === 'round') {
      const r = Math.min(p.w, p.h) / 2 * PLAN.s;
      ctx.beginPath(); ctx.arc(px(p.cx), py(p.cy), r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else {
      const w = p.w * PLAN.s, h = p.h * PLAN.s;
      ctx.fillRect(px(p.cx) - w / 2, py(p.cy) - h / 2, w, h);
      ctx.strokeRect(px(p.cx) - w / 2, py(p.cy) - h / 2, w, h);
    }
  });

  // in-progress shape
  if (drag) {
    const w = Math.abs(drag.x1 - drag.x0) * PLAN.s, h = Math.abs(drag.y1 - drag.y0) * PLAN.s;
    const x = px(Math.min(drag.x0, drag.x1)), y = py(Math.max(drag.y0, drag.y1));
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 1.4;
    if (state.shape === 'round') {
      ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeRect(x, y, w, h);
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#9fd0ff'; ctx.font = '11px -apple-system, system-ui, sans-serif';
    ctx.fillText(`${(w / PLAN.s).toFixed(1)} × ${(h / PLAN.s).toFixed(1)} mm`, x + 4, y - 5);
  }
}

function pointFrom(e) {
  const r = plan.getBoundingClientRect();
  const cx = (e.clientX - r.left) * (PLAN.W / r.width);
  const cy = (e.clientY - r.top) * (PLAN.H / r.height);
  return { x: clampX(mx(cx)), y: clampY(my(cy)) };
}

function hitPocket(x, y) {
  for (let i = state.pockets.length - 1; i >= 0; i--) {
    const p = state.pockets[i];
    if (p.kind === 'round') {
      const r = Math.min(p.w, p.h) / 2;
      if (Math.hypot(x - p.cx, y - p.cy) <= r) return i;
    } else if (Math.abs(x - p.cx) <= p.w / 2 && Math.abs(y - p.cy) <= p.h / 2) return i;
  }
  return -1;
}

plan.addEventListener('pointerdown', (e) => {
  try { plan.setPointerCapture(e.pointerId); } catch (_) {}
  const p = pointFrom(e);
  drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  selected = -1;
  drawPlan();
});

plan.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = pointFrom(e);
  drag.x1 = p.x; drag.y1 = p.y;
  drawPlan();
});

plan.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const p = pointFrom(e);
  drag.x1 = p.x; drag.y1 = p.y;
  const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
  if (w >= 2.5 && h >= 2.5) {
    state.pockets.push({
      kind: state.shape,
      cx: (drag.x0 + drag.x1) / 2,
      cy: (drag.y0 + drag.y1) / 2,
      w, h,
    });
    updatePocketUI();
    schedule();
  } else {
    selected = hitPocket(p.x, p.y);   // a tap selects, so you can see what you'll delete
  }
  drag = null;
  drawPlan();
});

plan.addEventListener('dblclick', (e) => {
  const p = pointFrom(e);
  const i = hitPocket(p.x, p.y);
  if (i >= 0) {
    state.pockets.splice(i, 1);
    selected = -1;
    updatePocketUI();
    schedule();
    drawPlan();
  }
});

function updatePocketUI() {
  document.getElementById('pcount').textContent =
    `${state.pockets.length} pocket${state.pockets.length === 1 ? '' : 's'}`;
  document.getElementById('undo').disabled = !state.pockets.length;
  document.getElementById('clear').disabled = !state.pockets.length;
}

document.getElementById('undo').addEventListener('click', () => {
  state.pockets.pop(); selected = -1; updatePocketUI(); schedule(); drawPlan();
});
document.getElementById('clear').addEventListener('click', () => {
  state.pockets = []; selected = -1; updatePocketUI(); schedule(); drawPlan();
});

/* --------------------------------------------------------------- depth ctl */
const depthInput = document.getElementById('depth');
const depthOut = document.getElementById('v-depth');

function updateDepthUI() {
  const full = interiorHeight();
  const max = Math.max(3, Math.round(full * 2) / 2);
  if (state.pocketDepth != null && state.pocketDepth > full) state.pocketDepth = null;
  depthInput.max = max;
  depthInput.value = effectiveDepth();
  depthOut.textContent = state.pocketDepth == null ? 'full' : `${effectiveDepth().toFixed(1)} mm`;
}
depthInput.addEventListener('input', () => {
  state.pocketDepth = parseFloat(depthInput.value);
  const full = interiorHeight();
  depthOut.textContent = state.pocketDepth >= full - 0.01 ? 'full' : `${state.pocketDepth.toFixed(1)} mm`;
  schedule();
});

/* ------------------------------------------------------------- test hooks */
window.__bbx = {
  state, rebuild,
  get ready() { return !!baseManifold; },
  get geometry() { return bodyMesh.geometry; },
  buildGeometry: () => manifoldToGeometry(buildTray()),
  addPocket(kind, cx, cy, w, h) {
    state.pockets.push({ kind, cx, cy, w, h });
    updatePocketUI(); drawPlan(); schedule();
  },
  clearPockets() {
    state.pockets = []; updatePocketUI(); drawPlan(); schedule();
  },
  stats() {
    const tray = buildTray();
    const g = manifoldToGeometry(tray);
    const bb = g.boundingBox;
    return {
      mode: state.mode,
      tris: g.index.count / 3,
      bbox: [bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z],
      volumeCm3: tray.volume() / 1000,
      genus: tray.genus(),
      depth: effectiveDepth(),
      drawn: state.pockets.map((p) => ({ ...p })),
      pockets: layout(),
    };
  },
};

/* ------------------------------------------------------------------- boot */
(async () => {
  try {
    setStatus('loading manifold wasm…');
    M = await Module();
    M.setup();

    const loader = new STLLoader();
    const load = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));
    const [baseGeom, bandGeom, lidGeomLocal, wall] = await Promise.all([
      load('models/base.stl'), load('models/band.stl'), load('models/lid.stl'),
      fetch('models/wall.json').then((r) => r.json()),
    ]);

    baseManifold = M.Manifold.ofMesh(geomToManifoldMesh(baseGeom));
    bandMesh = geomToManifoldMesh(bandGeom);
    lidGeom = lidGeomLocal;
    lidMesh.geometry = lidGeom;
    outerLoop = wall.outer;
    innerLoop = wall.inner;

    const xs = innerLoop.map((p) => p[0]), ys = innerLoop.map((p) => p[1]);
    cavity = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };

    setStatus(`parts ready · cavity ${(cavity.x1 - cavity.x0).toFixed(1)} × ${(cavity.y1 - cavity.y0).toFixed(1)} mm`);
    drawPlan(); updatePocketUI();
    schedule();
  } catch (e) {
    console.error(e);
    setStatus('boot failed: ' + e.message);
  }
})();