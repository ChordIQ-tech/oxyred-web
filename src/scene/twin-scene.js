/**
 * Camada de renderização: cena three.js do reator Oxy-Red.
 *
 * Porte do módulo 3D de referência (digital-solutions/modules/oxyred.html) para
 * um módulo isolado, sem painéis nem estado global. A cena expõe uma API
 * pequena (`createTwinScene`); tudo o que é regra de negócio mora em
 * `src/domain/*`.
 *
 * Depende de `window.THREE` (r128, carregado por <script> no index.html).
 */

import { GEOMETRY } from '../domain/params.js';
import { STEPS, OVERVIEW, stepAt, FLOW_KEYS } from '../domain/process-steps.js';
import { wearRamp, NODATA_RGB } from '../domain/wear.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const gauss = (x, c, w) => Math.exp(-((x - c) ** 2) / (2 * w * w));
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Constrói a cena completa. Devolve a API pública usada pelo HMI. */
export function createTwinScene(options = {}) {
  const THREE = options.THREE || globalThis.THREE;
  if (!THREE) throw new Error('three.js não carregado (window.THREE ausente).');

  const container = options.container;
  if (!container) throw new Error('createTwinScene: container obrigatório.');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- auxiliares
  const isRotated = () => window.matchMedia('(max-width:820px) and (orientation:portrait)').matches;
  const viewportSize = () => ({ w: container.clientWidth || window.innerWidth, h: container.clientHeight || window.innerHeight });
  let zoomK = 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0b0d);
  scene.fog = new THREE.FogExp2(0x0a0b0d, 0.011);

  const vp0 = viewportSize();
  const camera = new THREE.PerspectiveCamera(42, vp0.w / vp0.h, 0.1, 300);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(vp0.w, vp0.h);
  container.appendChild(renderer.domElement);

  const WS = 0.5;
  const worldGroup = new THREE.Group();
  worldGroup.scale.setScalar(WS);
  scene.add(worldGroup);

  scene.add(new THREE.AmbientLight(0x445566, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 0.55);
  dl.position.set(6, 12, 5);
  scene.add(dl);
  const warmLight = new THREE.PointLight(0xff7a3d, 1.3, 14);
  warmLight.position.set(0, 3.4 * WS, 0);
  scene.add(warmLight);
  const coolLight = new THREE.PointLight(0x7fd0ff, 0.7, 40);
  coolLight.position.set(8 * WS, 12 * WS, 6 * WS);
  scene.add(coolLight);

  function glowTexture(hex) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, `${hex}ff`);
    g.addColorStop(0.5, `${hex}55`);
    g.addColorStop(1, `${hex}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  function circleTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, '#ffffff');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function heatTexture() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(120,20,10,0)');
    g.addColorStop(0.45, 'rgba(179,38,30,0.45)');
    g.addColorStop(0.8, 'rgba(255,90,40,0.85)');
    g.addColorStop(1, 'rgba(255,140,60,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    return new THREE.CanvasTexture(c);
  }
  const spriteTex = circleTexture();
  const V2 = arr => arr.map(([r, y]) => new THREE.Vector2(r, y));

  function edgeLines(geo, thr, op) {
    return new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, thr || 20),
      new THREE.LineBasicMaterial({ color: 0x5ce1e6, transparent: true, opacity: op || 0.2 })
    );
  }

  const rand = mulberry(20260806);

  // caminho com tabela de comprimento de arco (rápido para muitas partículas)
  function makePath(pts, n, type) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, type || 'centripetal');
    n = n || 300;
    const sp = curve.getSpacedPoints(n);
    const arr = new Float32Array((n + 1) * 3);
    sp.forEach((p, i) => {
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    });
    return {
      curve,
      len: curve.getLength(),
      at(u, o) {
        const f = clamp(u, 0, 1) * n;
        const i = Math.min(n - 1, Math.floor(f));
        const t = f - i;
        const a = i * 3;
        const b = a + 3;
        o[0] = arr[a] + (arr[b] - arr[a]) * t;
        o[1] = arr[a + 1] + (arr[b + 1] - arr[a + 1]) * t;
        o[2] = arr[a + 2] + (arr[b + 2] - arr[a + 2]) * t;
        return o;
      }
    };
  }
  function makePoints(count, size, o) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    if (o.vc) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const m = new THREE.PointsMaterial({
      size,
      map: spriteTex,
      transparent: true,
      opacity: o.op ?? 0.85,
      vertexColors: !!o.vc,
      color: o.vc ? 0xffffff : (o.color ?? 0xffffff),
      blending: o.normal ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = o.ro ?? 3;
    p.userData.baseOp = m.opacity;
    worldGroup.add(p);
    return p;
  }
  function rod(a, b, r, mat, seg) {
    const A = new THREE.Vector3(a[0], a[1], a[2]);
    const B = new THREE.Vector3(b[0], b[1], b[2]);
    const d = B.clone().sub(A);
    const L = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, seg || 12, 1, false), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    worldGroup.add(m);
    return m;
  }
  function tube(path, r, mat, seg) {
    const m = new THREE.Mesh(new THREE.TubeGeometry(path.curve, seg || 64, r, 10, false), mat);
    worldGroup.add(m);
    return m;
  }
  function box(w, h, d, x, y, z, mat, edgeOp) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    worldGroup.add(m);
    if (edgeOp) {
      const e = edgeLines(g, 1, edgeOp);
      e.position.copy(m.position);
      worldGroup.add(e);
    }
    return m;
  }
  function cyl(r0, r1, h, x, y, z, mat, edgeOp, open, seg) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg || 32, 1, !!open);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    worldGroup.add(m);
    if (edgeOp) {
      const e = edgeLines(g, 25, edgeOp);
      e.position.copy(m.position);
      worldGroup.add(e);
    }
    return m;
  }

  const COL = {
    ore: new THREE.Color(0xa5532f),
    feS: new THREE.Color(0xa3a9b0),
    feHot: new THREE.Color(0xffd7a8),
    feL: new THREE.Color(0xf3f6ff),
    o2: new THREE.Color(0x78b4ff),
    co: new THREE.Color(0xffb347),
    co2: new THREE.Color(0x9aa1a8),
    ch4: new THREE.Color(0x4cc46a),
    h2: new THREE.Color(0xc8f5c8)
  };

  // ============================================================ geometria
  const R_IN = GEOMETRY.rInner;
  const R_SHELL = GEOMETRY.rShell;
  const Y_FOUND = 0.55;
  const Y_HEARTH = GEOMETRY.yHearth;
  const Y_TUY = GEOMETRY.yTuyere;
  const Y_STOCK = GEOMETRY.yStock;
  const N_TUY = GEOMETRY.nTuyeres;
  const TUY_TH = Array.from({ length: N_TUY }, (_, k) => ((k + 0.5) / N_TUY) * TAU);
  const TH0 = -Math.PI / 2;
  const polar = (r, t, y, o) => {
    const a = TH0 + t;
    o[0] = r * Math.cos(a);
    o[1] = y;
    o[2] = -r * Math.sin(a);
    return o;
  };
  const polarV = (r, t, y) => {
    const a = TH0 + t;
    return new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a));
  };
  function rInAt(y) {
    if (y <= 4.0) return R_IN;
    if (y <= 7.5) return R_IN - (0.09 * (y - 4.0)) / 3.5;
    if (y <= 11.0) return 1.71 - (0.09 * (y - 7.5)) / 3.5;
    return 1.62 - 0.9 * clamp((y - 11.0) / 0.85, 0, 1);
  }
  const RING_R = 2.85;
  const Y_O2RING = 3.75;
  const Y_GASRING = 2.75;
  const ELV = { x: -3.35, z: -1.65 };
  const ASU_X = -5.7;
  const SEP_X = 6.5;
  const CLN_X = 4.25;

  const steelMat = op => new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.55, metalness: 0.45, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false });
  const tintMat = (c, op) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.45, transparent: true, opacity: op, depthWrite: false });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.8, metalness: 0.3, transparent: true, opacity: 0.85 });

  // chão
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(15, 64),
    new THREE.MeshBasicMaterial({ map: glowTexture('#5ce1e6'), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(1.8, -0.02, 0);
  worldGroup.add(pad);
  const grid = new THREE.GridHelper(40, 40, 0x2a6f75, 0x1a2226);
  grid.position.set(1.8, -0.01, 0);
  worldGroup.add(grid);

  // reator
  cyl(2.75, 2.85, Y_FOUND, 0, Y_FOUND / 2, 0, darkMat, 0.18);
  const shellOuter = [[0, Y_FOUND], [2.36, Y_FOUND], [2.36, 2.6], [2.3, 2.9], [2.3, 10.9], [1.42, 11.9], [0.95, 12.15], [0.95, 12.4]];
  const shellInner = [[0.72, 12.4], [0.72, 11.85], [1.62, 11.0], [1.71, 7.5], [1.8, 4.0], [1.8, Y_HEARTH], [0, Y_HEARTH]];
  const shellGeo = new THREE.LatheGeometry(V2([...shellOuter, ...shellInner]), 72);
  const shellMesh = new THREE.Mesh(shellGeo, steelMat(0.1));
  worldGroup.add(shellMesh);
  worldGroup.add(edgeLines(shellGeo, 30, 0.22));
  [5.2, 8.0].forEach(y => {
    const b = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.045, 6, 72), tintMat(0x5c6066, 0.6));
    b.rotation.x = Math.PI / 2;
    b.position.y = y;
    worldGroup.add(b);
  });

  const o2Ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.12, 10, 80), tintMat(0x5f86c8, 0.6));
  o2Ring.rotation.x = Math.PI / 2;
  o2Ring.position.y = Y_O2RING;
  worldGroup.add(o2Ring);
  const gasRing = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.12, 10, 80), tintMat(0x7d8a55, 0.6));
  gasRing.rotation.x = Math.PI / 2;
  gasRing.position.y = Y_GASRING;
  worldGroup.add(gasRing);
  const tuyMat = tintMat(0x6a7078, 0.75);
  TUY_TH.forEach(t => {
    const a = polarV(1.72, t, Y_TUY);
    const b = polarV(RING_R, t, Y_TUY);
    rod([a.x, a.y, a.z], [b.x, b.y, b.z], 0.075, tuyMat, 10);
    const d0 = polarV(RING_R, t, Y_GASRING);
    const d1 = polarV(RING_R, t, Y_O2RING);
    rod([d0.x, d0.y, d0.z], [d1.x, d1.y, d1.z], 0.05, tuyMat, 8);
  });

  const heap = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 0.42, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x7a3e24, roughness: 0.9, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
  );
  heap.position.y = Y_STOCK + 0.21;
  worldGroup.add(heap);
  cyl(0.26, 0.26, 0.4, 0, 12.45, 0, steelMat(0.45), 0.2, true, 20);
  const hopper = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.2, 28, 1, true), steelMat(0.32));
  hopper.rotation.z = Math.PI;
  hopper.position.y = 13.25;
  worldGroup.add(hopper);
  const hopEdge = edgeLines(hopper.geometry, 25, 0.25);
  hopEdge.rotation.z = Math.PI;
  hopEdge.position.y = 13.25;
  worldGroup.add(hopEdge);

  // elevador de briquetes
  box(0.7, 14.2, 0.7, ELV.x, 7.1, ELV.z, steelMat(0.18), 0.28);
  box(1.0, 0.75, 0.95, ELV.x, 14.55, ELV.z, steelMat(0.35), 0.28);
  rod([ELV.x + 0.45, 14.4, ELV.z + 0.25], [-0.55, 13.8, -0.3], 0.14, steelMat(0.4), 10);

  // furo de corrida, canal e granulação
  const tapPos = polarV(R_SHELL + 0.03, 0, 1.15);
  const tapRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.04, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8 })
  );
  tapRing.position.copy(tapPos);
  worldGroup.add(tapRing);
  const runner = box(0.5, 0.22, 1.7, 0, 0.75, 3.25, darkMat, 0.2);
  runner.rotation.x = 0.12;
  const GRAN = new THREE.Vector3(0, 0.5, 4.95);
  cyl(0.95, 0.95, 1.0, GRAN.x, GRAN.y, GRAN.z, steelMat(0.35), 0.3, true, 36);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.93, 36),
    new THREE.MeshStandardMaterial({ color: 0x1d4a6b, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.7 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(GRAN.x, 0.92, GRAN.z);
  worldGroup.add(water);

  // separação de ar (O₂) e tanque de N₂ — o N₂ nunca entra no reator
  box(1.4, 7.6, 1.4, ASU_X, 3.8, 0, steelMat(0.22), 0.3);
  cyl(0.32, 0.32, 7.0, ASU_X, 3.6, -0.2, steelMat(0.4), 0.2, false, 20);
  rod([ASU_X + 0.7, Y_O2RING, 0], [-RING_R, Y_O2RING, 0], 0.13, tintMat(0x5f86c8, 0.6), 14);
  const N2P = new THREE.Vector3(-7.25, 0, 1.7);
  const n2Mat = tintMat(0x3557b0, 0.6);
  cyl(0.62, 0.62, 3.0, N2P.x, 1.7, N2P.z, n2Mat, 0.25, false, 28);
  const n2Dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 12, 0, TAU, 0, Math.PI / 2), n2Mat);
  n2Dome.position.set(N2P.x, 3.2, N2P.z);
  worldGroup.add(n2Dome);
  cyl(0.7, 0.7, 0.2, N2P.x, 0.1, N2P.z, darkMat, 0.15);
  rod([ASU_X - 0.5, 1.1, 0.7], [N2P.x + 0.45, 1.1, N2P.z - 0.3], 0.07, n2Mat, 8);

  // gás de topo → limpeza → separação
  const offtakePath = makePath([[1.15, 11.55, 0], [1.9, 12.4, 0], [2.5, 13.2, 0], [3.3, 13.45, 0], [4.2, 13.2, 0], [4.25, 12.0, 0], [4.25, 10.2, 0]], 200);
  tube(offtakePath, 0.28, steelMat(0.38), 80);
  cyl(0.8, 0.8, 2.6, CLN_X, 8.9, 0, steelMat(0.3), 0.3, false, 32);
  cyl(0.8, 0.2, 1.0, CLN_X, 7.1, 0, steelMat(0.3), 0.25, true, 32);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => rod([CLN_X + sx * 0.55, 0, sz * 0.55], [CLN_X + sx * 0.55, 7.6, sz * 0.55], 0.05, darkMat, 6));
  rod([CLN_X + 0.75, 9.5, 0], [SEP_X - 0.6, 9.5, 0], 0.22, steelMat(0.4), 14);
  cyl(0.62, 0.62, 9.5, SEP_X, 5.25, 0, steelMat(0.3), 0.3, false, 32);
  const sepDome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 12, 0, TAU, 0, Math.PI / 2), steelMat(0.3));
  sepDome.position.set(SEP_X, 10.0, 0);
  worldGroup.add(sepDome);
  [2.5, 4.5, 6.5, 8.5].forEach(y => {
    const b = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.03, 6, 40), tintMat(0x5c6066, 0.6));
    b.rotation.x = Math.PI / 2;
    b.position.set(SEP_X, y, 0);
    worldGroup.add(b);
  });

  const co2Path = makePath([[SEP_X, 3.2, 0], [6.8, 2.6, -0.5], [7.35, 1.8, -1.3], [7.9, 1.4, -1.65], [8.5, 1.35, -1.65], [9.1, 1.35, -1.65], [9.7, 1.35, -1.0], [10.05, 1.4, -0.45]], 200);
  const h2Path = makePath([[SEP_X, 3.2, 0], [6.8, 2.6, 0.5], [7.35, 1.8, 1.3], [7.9, 1.4, 1.65], [8.5, 1.35, 1.65], [9.1, 1.35, 1.65], [9.7, 1.35, 1.0], [10.05, 1.4, 0.45]], 200);
  const recPath = makePath([[SEP_X, 3.2, 0], [6.2, 2.45, 0], [5.6, 2.4, -1.2], [4.5, 2.5, -2.1], [3.3, 2.65, -2.2], [2.45, Y_GASRING, -1.45]], 200);
  tube(co2Path, 0.11, steelMat(0.4), 80);
  tube(h2Path, 0.11, steelMat(0.4), 80);
  tube(recPath, 0.13, tintMat(0x7d8a55, 0.55), 80);

  function hTank(x, y, z, r, len, color, op) {
    const mat = tintMat(color, op);
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 28, 1, true), mat);
    c.rotation.z = Math.PI / 2;
    g.add(c);
    [-1, 1].forEach(s => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, TAU, 0, Math.PI / 2), mat);
      h.rotation.z = -s * Math.PI / 2;
      h.position.x = (s * len) / 2;
      g.add(h);
    });
    [-0.5, 0.5].forEach(s => {
      const sd = new THREE.Mesh(new THREE.BoxGeometry(0.16, y - r * 0.6, r * 1.4), darkMat);
      sd.position.set(s * len * 0.7, -(y - r * 0.6) / 2 - r * 0.6 + 0.02, 0);
      g.add(sd);
    });
    g.position.set(x, y, z);
    worldGroup.add(g);
    return g;
  }
  hTank(8.5, 1.35, -1.65, 0.55, 1.5, 0x9aa1a8, 0.42);
  hTank(8.5, 1.35, 1.65, 0.55, 1.5, 0xc8f5c8, 0.34);
  box(1.3, 2.4, 2.2, 10.75, 1.2, 0, darkMat, 0.25);
  const urDome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, TAU, 0, Math.PI / 2), tintMat(0x8a8e94, 0.5));
  urDome.position.set(10.75, 2.4, 0);
  worldGroup.add(urDome);

  // referência angular (setores do revestimento)
  const AZ_Y = Y_FOUND + 0.03;
  const AZ_R = 3.15;
  (function azimuthRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(AZ_R - 0.015, AZ_R + 0.015, 128),
      new THREE.MeshBasicMaterial({ color: 0x5ce1e6, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = AZ_Y;
    worldGroup.add(ring);
    const pts = [];
    for (let a = 0; a < 360; a += 10) {
      const t = (a * Math.PI) / 180;
      const big = a % 90 === 0;
      const r0 = AZ_R - (big ? 0.22 : 0.1);
      const r1 = AZ_R + (big ? 0.12 : 0.05);
      pts.push(polarV(r0, t, AZ_Y), polarV(r1, t, AZ_Y));
    }
    worldGroup.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x5ce1e6, transparent: true, opacity: 0.45 })
    ));
  })();

  // banho: ferro líquido embaixo, escória por cima
  const ironMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.77, 1.77, 1, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff0dc, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  ironMesh.renderOrder = 3;
  worldGroup.add(ironMesh);
  const ironSurf = new THREE.Mesh(
    new THREE.CircleGeometry(1.77, 48),
    new THREE.MeshBasicMaterial({ map: glowTexture('#fff4e0'), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  ironSurf.rotation.x = -Math.PI / 2;
  ironSurf.renderOrder = 3;
  worldGroup.add(ironSurf);
  const slagMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.77, 1.77, 1, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x2e6b4c, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
  );
  slagMesh.renderOrder = 4;
  worldGroup.add(slagMesh);
  const slagSurf = new THREE.Mesh(
    new THREE.CircleGeometry(1.77, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a6146, roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
  );
  slagSurf.rotation.x = -Math.PI / 2;
  slagSurf.renderOrder = 4;
  worldGroup.add(slagSurf);
  let ironL = 1.55;
  let slagL = 1.91;
  function setPool() {
    slagL = ironL + 0.36;
    ironMesh.scale.y = ironL - Y_HEARTH;
    ironMesh.position.y = (ironL + Y_HEARTH) / 2;
    ironSurf.position.y = ironL;
    slagMesh.scale.y = slagL - ironL;
    slagMesh.position.y = (slagL + ironL) / 2;
    slagSurf.position.y = slagL;
  }
  setPool();

  const heatCol = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.74, 4.6, 40, 1, true),
    new THREE.MeshBasicMaterial({ map: heatTexture(), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  heatCol.position.y = Y_HEARTH + 0.95 + 2.3;
  heatCol.renderOrder = 2;
  worldGroup.add(heatCol);
  const flashTex = glowTexture('#ff8a3a');
  const flashes = TUY_TH.map(t => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(polarV(1.38, t, Y_TUY + 0.12));
    s.renderOrder = 3;
    worldGroup.add(s);
    return s;
  });

  // ============================================================ partículas
  const tmp = [0, 0, 0];
  const chargePath = makePath([[ELV.x, 0.5, ELV.z], [ELV.x, 7.5, ELV.z], [ELV.x, 14.3, ELV.z], [ELV.x + 0.5, 14.6, ELV.z + 0.3], [-1.4, 14.05, -0.7], [-0.45, 13.7, -0.25], [0, 13.1, 0], [0, 12.2, 0], [0, 11.3, 0], [0, 10.75, 0]], 500);
  const CH_N = 150;
  const chPts = makePoints(CH_N, 0.2, { color: 0xa5532f, normal: true, op: 0.95 });
  const chU = new Float32Array(CH_N);
  const chA = new Float32Array(CH_N);
  const chS = new Float32Array(CH_N);
  for (let i = 0; i < CH_N; i++) {
    chU[i] = i / CH_N;
    chA[i] = rand() * TAU;
    chS[i] = rand();
  }

  const yMelt = rf => 2.75 + 0.65 * (1 - rf);
  const BED_N = 950;
  const bedPts = makePoints(BED_N, 0.18, { vc: true, normal: true, op: 0.9 });
  const bedY = new Float32Array(BED_N);
  const bedA = new Float32Array(BED_N);
  const bedR = new Float32Array(BED_N);
  const bedV = new Float32Array(BED_N);
  function spawnBed(i, anywhere) {
    bedA[i] = rand() * TAU;
    bedR[i] = Math.sqrt(rand());
    bedV[i] = 0.18 + 0.1 * rand();
    const top = Y_STOCK + 0.38 * (1 - bedR[i]);
    bedY[i] = anywhere ? lerp(yMelt(bedR[i]), top, rand()) : top - rand() * 0.15;
  }
  for (let i = 0; i < BED_N; i++) spawnBed(i, true);

  const GI_N = 360;
  const giPts = makePoints(GI_N, 0.15, { vc: true, op: 0.85 });
  const giY = new Float32Array(GI_N);
  const giA = new Float32Array(GI_N);
  const giR = new Float32Array(GI_N);
  const giRT = new Float32Array(GI_N);
  const giV = new Float32Array(GI_N);
  function spawnGi(i, anywhere) {
    const k = Math.floor(rand() * N_TUY);
    giA[i] = TUY_TH[k] + (rand() - 0.5) * 0.45;
    giR[i] = 1.0 + rand() * 0.6;
    giRT[i] = 0.2 + rand() * 1.3;
    giV[i] = 1.3 + rand() * 0.8;
    giY[i] = anywhere ? lerp(Y_TUY, Y_STOCK, rand()) : Y_TUY + rand() * 0.3;
  }
  for (let i = 0; i < GI_N; i++) spawnGi(i, true);

  const JPER = 18;
  const JT_N = N_TUY * JPER;
  const jtPts = makePoints(JT_N, 0.14, { vc: true, op: 0.95 });
  const jtS = new Float32Array(JT_N);
  const jtSp = new Uint8Array(JT_N);
  const jtJ = new Float32Array(JT_N);
  for (let i = 0; i < JT_N; i++) {
    jtS[i] = rand();
    jtJ[i] = rand() - 0.5;
    jtSp[i] = i % 3 < 2 ? 0 : (i % 2 ? 1 : 2);
  }

  const DR_N = 110;
  const drPts = makePoints(DR_N, 0.14, { color: 0xfff6e8, op: 0.95 });
  const drY = new Float32Array(DR_N);
  const drA = new Float32Array(DR_N);
  const drR = new Float32Array(DR_N);
  const drV = new Float32Array(DR_N);
  function spawnDrop(i, anywhere) {
    drR[i] = Math.sqrt(rand()) * 0.85;
    drA[i] = rand() * TAU;
    drV[i] = 0.2 + rand() * 0.4;
    drY[i] = anywhere ? lerp(slagL, yMelt(drR[i]), rand()) : yMelt(drR[i]) - rand() * 0.15;
  }
  for (let i = 0; i < DR_N; i++) spawnDrop(i, true);

  const jetPath = makePath([[0, 1.15, 2.25], [0, 1.2, 2.75], [0, 1.0, 3.3], [0, 0.82, 3.9], [0, 0.66, 4.45], [0, 0.45, 4.85]], 200);
  const TP_N = 170;
  const tpPts = makePoints(TP_N, 0.19, { vc: true, op: 0.95 });
  const tpU = new Float32Array(TP_N);
  const tpJ = new Float32Array(TP_N * 2);
  for (let i = 0; i < TP_N; i++) {
    tpU[i] = rand();
    tpJ[i * 2] = rand() - 0.5;
    tpJ[i * 2 + 1] = rand() - 0.5;
  }
  const ST_N = 46;
  const stPts = makePoints(ST_N, 0.6, { color: 0xffffff, op: 0.16 });
  const stU = new Float32Array(ST_N);
  const stA = new Float32Array(ST_N);
  const stR = new Float32Array(ST_N);
  for (let i = 0; i < ST_N; i++) {
    stU[i] = rand();
    stA[i] = rand() * TAU;
    stR[i] = rand() * 0.7;
  }

  const offgasPath = makePath([[0, 11.2, 0], [0.8, 11.4, 0], [1.5, 11.8, 0], [1.9, 12.4, 0], [2.5, 13.2, 0], [3.3, 13.45, 0], [4.2, 13.2, 0], [4.25, 12.0, 0], [4.25, 10.4, 0], [4.25, 9.6, 0], [4.9, 9.5, 0], [5.6, 9.5, 0], [SEP_X, 9.2, 0], [SEP_X, 6.5, 0], [SEP_X, 3.2, 0]], 600);
  const GAS_N = 560;
  const gasPts = makePoints(GAS_N, 0.17, { vc: true, op: 0.9 });
  const gasU = new Float32Array(GAS_N);
  const gasSp = new Uint8Array(GAS_N);
  const gasO = new Float32Array(GAS_N * 3);
  const SPEC = [COL.co, COL.co2, COL.h2, COL.ch4];
  for (let i = 0; i < GAS_N; i++) {
    const r = rand();
    gasSp[i] = r < 0.35 ? 0 : r < 0.62 ? 1 : r < 0.82 ? 2 : 3;
    gasU[i] = rand();
    gasO[i * 3] = rand() - 0.5;
    gasO[i * 3 + 1] = rand() - 0.5;
    gasO[i * 3 + 2] = rand() - 0.5;
  }
  const branchOf = sp => (sp === 1 ? co2Path : sp === 2 ? h2Path : recPath);

  const o2Path = makePath([[ASU_X + 0.7, Y_O2RING, 0], [-3.9, Y_O2RING, 0], [-RING_R, Y_O2RING, 0]], 60);
  const OP_N = 60;
  const opPts = makePoints(OP_N, 0.16, { color: 0x78b4ff, op: 0.95 });
  const opU = new Float32Array(OP_N);
  for (let i = 0; i < OP_N; i++) opU[i] = rand();
  const RG_N = 90;
  const o2rPts = makePoints(RG_N, 0.15, { color: 0x78b4ff, op: 0.9 });
  const gsrPts = makePoints(RG_N, 0.15, { vc: true, op: 0.9 });
  const rgA = new Float32Array(RG_N);
  for (let i = 0; i < RG_N; i++) rgA[i] = (i / RG_N) * TAU;
  (function colorGasRing() {
    const ca = gsrPts.geometry.attributes.color;
    for (let i = 0; i < RG_N; i++) {
      const c = i % 2 ? COL.co : COL.ch4;
      ca.array[i * 3] = c.r;
      ca.array[i * 3 + 1] = c.g;
      ca.array[i * 3 + 2] = c.b;
    }
    ca.needsUpdate = true;
  })();

  const FLOW_OBJS = [chPts, bedPts, giPts, jtPts, drPts, tpPts, stPts, gasPts, opPts, o2rPts, gsrPts, heatCol, ...flashes];

  // ============================================================ briquete
  const BRQ_C = new THREE.Vector3(-6.0, 11.2, 2.6);
  const briqGroup = new THREE.Group();
  briqGroup.position.copy(BRQ_C);
  worldGroup.add(briqGroup);
  const BQA = new THREE.Vector3(1.05, 0.62, 0.72);
  const bqMats = {
    ore: new THREE.MeshStandardMaterial({ color: 0x8c3f24, roughness: 0.75, metalness: 0.1, transparent: true, opacity: 0 }),
    coal: new THREE.MeshStandardMaterial({ color: 0x45474d, roughness: 0.3, metalness: 0.45, transparent: true, opacity: 0 }),
    lime: new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0 })
  };
  const bqDefs = [
    { key: 'ore', n: 322, geo: new THREE.OctahedronGeometry(0.095, 0) },
    { key: 'coal', n: 106, geo: new THREE.SphereGeometry(0.072, 10, 8) },
    { key: 'lime', n: 32, geo: new THREE.BoxGeometry(0.1, 0.1, 0.1) }
  ];
  const bqSets = bqDefs.map(d => {
    const mesh = new THREE.InstancedMesh(d.geo, bqMats[d.key], d.n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    briqGroup.add(mesh);
    const tgt = new Float32Array(d.n * 3);
    const sc = new Float32Array(d.n * 3);
    const ax = [];
    const del = new Float32Array(d.n);
    for (let i = 0; i < d.n; i++) {
      let x;
      let y;
      let z;
      do {
        x = rand() * 2 - 1;
        y = rand() * 2 - 1;
        z = rand() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      tgt[i * 3] = x * BQA.x;
      tgt[i * 3 + 1] = y * BQA.y;
      tgt[i * 3 + 2] = z * BQA.z;
      const r = 1.5 + rand() * 1.1;
      const th = rand() * TAU;
      const ph = Math.acos(rand() * 2 - 1);
      sc[i * 3] = r * Math.sin(ph) * Math.cos(th);
      sc[i * 3 + 1] = r * Math.cos(ph) * 0.7;
      sc[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      ax.push(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize());
      del[i] = rand();
    }
    return { mesh, n: d.n, tgt, sc, ax, del };
  });
  const bqOutline = new THREE.Group();
  briqGroup.add(bqOutline);
  function ellipseLoop(plane, k) {
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const t = (i / 72) * TAU;
      const c = Math.cos(t) * k;
      const s = Math.sin(t) * k;
      pts.push(plane === 'xz'
        ? new THREE.Vector3(c * BQA.x, 0, s * BQA.z)
        : plane === 'xy'
          ? new THREE.Vector3(c * BQA.x, s * BQA.y, 0)
          : new THREE.Vector3(0, c * BQA.y, s * BQA.z));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5ce1e6, transparent: true, opacity: 0 }));
  }
  const bqLoops = [ellipseLoop('xz', 1.06), ellipseLoop('yz', 1.06), ellipseLoop('xy', 1.06)];
  bqLoops.forEach(l => bqOutline.add(l));
  const ringGroup = new THREE.Group();
  ringGroup.position.copy(BRQ_C);
  worldGroup.add(ringGroup);
  const RING_PARTS = [
    { f: 0.70, c: 0xa5532f, t: '70% minério', css: '#d0835c' },
    { f: 0.23, c: 0x6a6d75, t: '23% carvão', css: '#c3c7cf' },
    { f: 0.07, c: 0xe9e9e4, t: '7% cal', css: '#ffffff' }
  ];
  const ringArcs = [];
  const ringAnchors = [];
  (function buildBriquetteRing() {
    let a0 = Math.PI / 2;
    const gap = 0.05;
    RING_PARTS.forEach(p => {
      const arc = p.f * TAU - gap;
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.045, 6, 96, arc),
        new THREE.MeshBasicMaterial({ color: p.c, transparent: true, opacity: 0 })
      );
      m.rotation.z = a0 + gap / 2;
      ringGroup.add(m);
      ringArcs.push(m);
      const mid = a0 + (p.f * TAU) / 2;
      const an = new THREE.Object3D();
      an.position.set(1.78 * Math.cos(mid), 1.78 * Math.sin(mid), 0);
      ringGroup.add(an);
      ringAnchors.push(an);
      a0 += p.f * TAU;
    });
  })();
  const briqLight = new THREE.PointLight(0xffffff, 0, 6);
  briqLight.position.copy(BRQ_C).add(new THREE.Vector3(1.4, 1.6, 2.4)).multiplyScalar(WS);
  scene.add(briqLight);
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  // ============================================================ revestimento
  const ZONES = {
    cuba_superior: { nome: 'Cuba superior · topo', prof: [[1.71, 7.5], [1.62, 11.0], [0.72, 11.85]], conv: 'parede' },
    cuba_inferior: { nome: 'Cuba inferior · redução', prof: [[1.80, 4.0], [1.71, 7.5]], conv: 'parede' },
    ventaneiras: { nome: 'Zona das ventaneiras', prof: [[1.80, 2.6], [1.80, 4.0]], conv: 'parede' },
    cadinho_parede: { nome: 'Cadinho · parede', prof: [[1.80, Y_HEARTH], [1.80, 2.6]], conv: 'parede' },
    soleira: { nome: 'Cadinho · soleira', prof: [[0, Y_HEARTH], [1.80, Y_HEARTH]], conv: 'soleira' }
  };
  const ZONE_ORDER = ['cuba_superior', 'cuba_inferior', 'ventaneiras', 'cadinho_parede', 'soleira'];
  ZONE_ORDER.forEach(k => {
    const z = ZONES[k];
    z.cum = [0];
    for (let i = 1; i < z.prof.length; i++) {
      z.cum.push(z.cum[i - 1] + Math.hypot(z.prof[i][0] - z.prof[i - 1][0], z.prof[i][1] - z.prof[i - 1][1]));
    }
  });
  function sampleProf(z, s) {
    const L = z.cum[z.cum.length - 1];
    const d = clamp(s, 0, 1) * L;
    for (let k = 1; k < z.cum.length; k++) {
      if (d <= z.cum[k] + 1e-9) {
        const seg = z.cum[k] - z.cum[k - 1] || 1;
        const t = (d - z.cum[k - 1]) / seg;
        return [z.prof[k - 1][0] + (z.prof[k][0] - z.prof[k - 1][0]) * t, z.prof[k - 1][1] + (z.prof[k][1] - z.prof[k - 1][1]) * t];
      }
    }
    const e = z.prof[z.prof.length - 1];
    return [e[0], e[1]];
  }
  function cellCorners(zk, i, j, N, M, inset) {
    const z = ZONES[zk];
    const s0 = (i + inset) / N;
    const s1 = (i + 1 - inset) / N;
    const t0 = ((j + inset) / M) * TAU;
    const t1 = ((j + 1 - inset) / M) * TAU;
    const P = (s, t) => {
      const rp = sampleProf(z, s);
      const yy = zk === 'soleira' ? rp[1] + 0.012 : rp[1];
      return polarV(zk === 'soleira' ? rp[0] : rp[0] - 0.012, t, yy);
    };
    return [P(s0, t0), P(s0, t1), P(s1, t1), P(s1, t0)];
  }

  const zoneMeshes = {};
  let cutView = true;
  let wearOn = true;
  const zoneSide = () => (cutView ? THREE.BackSide : THREE.FrontSide);
  function makeZoneMesh(zk, N, M) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * M * 12);
    const col = new Float32Array(N * M * 12);
    const idx = new Uint32Array(N * M * 6);
    let q = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const c = cellCorners(zk, i, j, N, M, 0.05);
        for (let k = 0; k < 4; k++) {
          pos[q * 12 + k * 3] = c[k].x;
          pos[q * 12 + k * 3 + 1] = c[k].y;
          pos[q * 12 + k * 3 + 2] = c[k].z;
        }
        idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
        q++;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, side: zoneSide(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { zk, N, M };
    mesh.renderOrder = 1;
    mesh.visible = wearOn;
    worldGroup.add(mesh);
    return mesh;
  }
  function disposeZone(zk) {
    const m = zoneMeshes[zk];
    if (!m) return;
    worldGroup.remove(m);
    m.geometry.dispose();
    m.material.dispose();
    delete zoneMeshes[zk];
  }

  let DS = null;
  let snapIdx = 0;
  let liningK = 1;

  function refreshColors() {
    if (!DS) return;
    const snap = DS.snaps[snapIdx];
    Object.values(zoneMeshes).forEach(m => {
      const { zk, N, M } = m.userData;
      const arr = snap.wear[zk];
      const ca = m.geometry.attributes.color;
      let q = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
          const w = arr ? arr[i][j] : null;
          const c = w === null ? NODATA_RGB : wearRamp(w / DS.escalaMax);
          for (let k = 0; k < 4; k++) {
            ca.array[q * 12 + k * 3] = c[0];
            ca.array[q * 12 + k * 3 + 1] = c[1];
            ca.array[q * 12 + k * 3 + 2] = c[2];
          }
          q++;
        }
      }
      ca.needsUpdate = true;
    });
  }

  function applyDataset(ds) {
    DS = ds;
    ZONE_ORDER.forEach(zk => {
      const dm = DS.dims[zk];
      const m = zoneMeshes[zk];
      if (!dm) {
        disposeZone(zk);
        return;
      }
      if (m && (m.userData.N !== dm[0] || m.userData.M !== dm[1])) disposeZone(zk);
      if (!zoneMeshes[zk]) zoneMeshes[zk] = makeZoneMesh(zk, dm[0], dm[1]);
    });
    snapIdx = DS.snaps.length - 1;
    Object.values(zoneMeshes).forEach(m => {
      m.userData.op = 0.95;
      m.material.opacity = m.userData.op * liningK;
    });
    refreshColors();
    return true;
  }

  // ============================================================ rótulos 3D
  const labelLayer = document.createElement('div');
  labelLayer.className = 'label-layer';
  container.appendChild(labelLayer);

  const LBL = [
    { t: 'Briquete autorredutor · ampliado', p: [-4.7, 12.35, 2.6], s: [0, 1], cls: 'big', a: () => bAlpha },
    { t: 'Elevador de briquetes', p: [-3.8, 9.6, ELV.z], s: [2], rt: true },
    { t: 'Tremonha · carga pelo topo', p: [1.25, 13.65, 0], s: [2] },
    { t: 'Cuba · redução em estado sólido', p: [2.4, 7.4, 0], s: [2, 3], main: true },
    { t: 'Ventaneiras · O₂ + gás recirculado', p: [3.05, 3.25, 0.7], s: [3, 5], main: true },
    { t: 'Cadinho · ferro e escória', p: [2.5, 1.6, 0.9], s: [6, 7], main: true },
    { t: 'Furo de corrida', p: [0.35, 1.3, 2.55], s: [6, 7] },
    { t: 'Granulação do ferro', p: [1.05, 1.15, 4.95], s: [7], main: true },
    { t: 'Gás de topo · sem chaminé', p: [3.1, 13.95, 0], s: [4, 7], main: true },
    { t: 'Limpeza do gás', p: [5.15, 8.7, 0], s: [4] },
    { t: 'Separação de gases', p: [7.25, 6.2, 0], s: [4], main: true },
    { t: 'CO₂ capturado', p: [8.5, 2.15, -1.65], s: [4] },
    { t: 'H₂ capturado', p: [8.5, 2.15, 1.65], s: [4] },
    { t: 'Amônia e ureia', p: [11.5, 2.2, 0], s: [4, 7], main: true },
    { t: 'Recirculação · CO + CH₄', p: [4.4, 2.95, -2.15], s: [4, 5] },
    { t: 'Separação de ar · O₂ puro', p: [-6.5, 7.8, 0], s: [3], main: true, rt: true },
    { t: 'N₂ · tanque externo', p: [-7.95, 3.3, 1.7], s: [3], rt: true },
    ...[0, 90, 180, 270].map(a => ({
      t: a === 0 ? '0° · furo' : `${a}°`,
      cls: 'az',
      p: (() => {
        const v = polarV(AZ_R + 0.35, (a * Math.PI) / 180, AZ_Y);
        return [v.x, v.y, v.z];
      })(),
      s: 'all',
      base: 0.8
    })),
    ...RING_PARTS.map((r, k) => ({ t: r.t, cls: 'pct', obj: ringAnchors[k], s: 'all', color: r.css, a: () => ringA }))
  ];
  const _lv = new THREE.Vector3();
  LBL.forEach(d => {
    const el = document.createElement('div');
    el.className = `label3d${d.cls ? ` ${d.cls}` : ''}${d.rt ? ' rt' : ''}`;
    el.textContent = d.t;
    if (d.color) el.style.color = d.color;
    el.style.left = '0px';
    el.style.top = '0px';
    labelLayer.appendChild(el);
    d.el = el;
    d.cur = 0;
    if (d.p) d.v = new THREE.Vector3(d.p[0], d.p[1], d.p[2]);
  });

  let labelsVisible = true;
  function updateLabels(dt) {
    const vp = viewportSize();
    const k = 1 - Math.exp(-dt * 4);
    LBL.forEach(d => {
      let tgt;
      if (!labelsVisible) tgt = 0;
      else if (d.s === 'all') tgt = (d.base ?? 0.95) * (d.cls === 'az' ? (wearOn ? 1 : 0) : 1);
      else if (stepIdx < 0) tgt = d.main ? 0.9 : 0;
      else tgt = d.s.includes(stepIdx) ? 0.97 : 0;
      if (d.a) tgt *= d.a();
      d.cur += (tgt - d.cur) * k;
      if (d.obj) d.obj.getWorldPosition(_lv);
      else worldGroup.localToWorld(_lv.copy(d.v));
      _lv.project(camera);
      const x = (_lv.x * 0.5 + 0.5) * vp.w;
      const y = (1 - (_lv.y * 0.5 + 0.5)) * vp.h;
      if (_lv.z > 1 || d.cur < 0.03) {
        d.el.style.display = 'none';
        return;
      }
      d.el.style.display = 'block';
      d.el.style.opacity = d.cur.toFixed(2);
      if (d.rt && !d.w) d.w = d.el.offsetWidth;
      const off = d.rt ? -(d.w + 16) : (d.cls === 'az' ? -8 : (d.cls === 'pct' ? -30 : 16));
      d.el.style.transform = `translate(${x + off}px, ${y - 7}px)`;
    });
  }

  // ============================================================ câmera
  const camLook = new THREE.Vector3(OVERVIEW.cam.look[0] * WS, OVERVIEW.cam.look[1] * WS, OVERVIEW.cam.look[2] * WS);
  let camRad = OVERVIEW.cam.r * WS;
  let camTh = OVERVIEW.cam.th;
  let camPh = OVERVIEW.cam.ph;
  let camFollow = true;
  let userZoom = 1;
  const _tv = new THREE.Vector3();
  function updateCamera(dt, time) {
    if (camFollow) {
      const c = stepDef(stepIdx).cam;
      const k = 1 - Math.exp(-dt * 1.5);
      _tv.set(c.look[0] * WS, c.look[1] * WS, c.look[2] * WS);
      camLook.lerp(_tv, k);
      camRad += (c.r * WS - camRad) * k;
      camTh += angDiff(c.th + (reduceMotion ? 0 : 0.2 * Math.sin(time * 0.13)), camTh) * k;
      camPh += (c.ph - camPh) * k;
    }
    const R = camRad * userZoom * zoomK;
    camera.position.set(
      camLook.x + R * Math.sin(camPh) * Math.cos(camTh),
      camLook.y + R * Math.cos(camPh),
      camLook.z + R * Math.sin(camPh) * Math.sin(camTh)
    );
    camera.lookAt(camLook);
  }

  const ptrs = new Map();
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let pinch0 = 0;
  let zoom0 = 1;
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      cv.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    if (ptrs.size === 1) {
      dragging = true;
      moved = false;
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
    } else if (ptrs.size === 2) {
      dragging = false;
      moved = true;
      const [a, b] = [...ptrs.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      zoom0 = userZoom;
    }
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) userZoom = clamp((zoom0 * pinch0) / d, 0.4, 1.9);
      return;
    }
    if (!dragging) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
      moved = true;
      camFollow = false;
    }
    const dxReal = e.clientX - lastX;
    const dyReal = e.clientY - lastY;
    const dxLocal = isRotated() ? dyReal : dxReal;
    const dyLocal = isRotated() ? -dxReal : dyReal;
    if (moved) {
      camTh += dxLocal * 0.005;
      camPh = clamp(camPh - dyLocal * 0.005, 0.35, 2.05);
    }
    lastX = e.clientX;
    lastY = e.clientY;
  });
  function endPtr(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) dragging = false;
  }
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    userZoom = clamp(userZoom * (1 + e.deltaY * 0.001), 0.4, 1.9);
  }, { passive: false });

  function applyCompact() {
    const v = viewportSize();
    container.classList.toggle('compact', v.h < 560 || v.w < 760);
    zoomK = v.h < 520 ? 1.22 : 1;
  }
  applyCompact();

  const onResize = () => {
    const vp = viewportSize();
    camera.aspect = vp.w / vp.h;
    camera.updateProjectionMatrix();
    renderer.setSize(vp.w, vp.h);
    applyCompact();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

  // ============================================================ animação
  const clock = new THREE.Clock();
  let flowsOn = true;
  let tapT = 0;
  let tapA = 0;
  let telT = 0;
  const TAP_PERIOD = 36;
  const TAP_OPEN = 12;
  let simTime = 0;
  let visualScale = 1;
  let stepIdx = -1;
  let stepT = 0;
  let tourPlaying = !reduceMotion;
  let bAlpha = 0;
  let ringA = 0;
  let heatBoost = 0;
  const Wt = {};
  FLOW_KEYS.forEach(k => { Wt[k] = 1; });
  const stepDef = i => stepAt(i);

  function setFlowOpacity() {
    chPts.material.opacity = chPts.userData.baseOp * Wt.charge;
    bedPts.material.opacity = bedPts.userData.baseOp * Math.max(Wt.bed, 0.35);
    giPts.material.opacity = giPts.userData.baseOp * Wt.gasIn;
    jtPts.material.opacity = jtPts.userData.baseOp * Math.max(Wt.o2, Wt.recirc);
    drPts.material.opacity = drPts.userData.baseOp * Wt.melt;
    tpPts.material.opacity = tpPts.userData.baseOp * Math.max(Wt.tap, 0.5);
    stPts.material.opacity = stPts.userData.baseOp * tapA * Wt.tap;
    gasPts.material.opacity = gasPts.userData.baseOp * Math.max(Wt.offgas, Wt.recirc * 0.8);
    opPts.material.opacity = opPts.userData.baseOp * Wt.o2;
    o2rPts.material.opacity = o2rPts.userData.baseOp * Wt.o2;
    gsrPts.material.opacity = gsrPts.userData.baseOp * Wt.recirc;
  }

  function updateFlows(dt, time) {
    const vs = visualScale;
    {
      const pa = chPts.geometry.attributes.position.array;
      for (let i = 0; i < CH_N; i++) {
        chU[i] += (dt * 2.6 * vs) / chargePath.len;
        if (chU[i] > 1) chU[i] -= 1;
        const u = chU[i];
        chargePath.at(u, tmp);
        const sp = smooth(0.86, 1, u) * 1.3 * chS[i];
        pa[i * 3] = tmp[0] + Math.cos(chA[i]) * sp;
        pa[i * 3 + 1] = tmp[1];
        pa[i * 3 + 2] = tmp[2] + Math.sin(chA[i]) * sp;
      }
      chPts.geometry.attributes.position.needsUpdate = true;
    }
    {
      const pa = bedPts.geometry.attributes.position.array;
      const ca = bedPts.geometry.attributes.color.array;
      const c = new THREE.Color();
      for (let i = 0; i < BED_N; i++) {
        bedY[i] -= bedV[i] * dt * vs * (0.8 + 0.5 * (1 - bedR[i]));
        if (bedY[i] < yMelt(bedR[i])) spawnBed(i, false);
        const y = bedY[i];
        const r = bedR[i] * (rInAt(y) - 0.16);
        polar(r, bedA[i], y, tmp);
        pa[i * 3] = tmp[0];
        pa[i * 3 + 1] = tmp[1];
        pa[i * 3 + 2] = tmp[2];
        c.copy(COL.ore).lerp(COL.feS, smooth(8.6, 5.2, y)).lerp(COL.feHot, smooth(4.7, 3.1, y));
        ca[i * 3] = c.r;
        ca[i * 3 + 1] = c.g;
        ca[i * 3 + 2] = c.b;
      }
      bedPts.geometry.attributes.position.needsUpdate = true;
      bedPts.geometry.attributes.color.needsUpdate = true;
    }
    {
      const pa = giPts.geometry.attributes.position.array;
      const ca = giPts.geometry.attributes.color.array;
      const c = new THREE.Color();
      for (let i = 0; i < GI_N; i++) {
        giY[i] += giV[i] * dt * vs;
        giR[i] += (giRT[i] - giR[i]) * dt * 0.35;
        if (giY[i] > Y_STOCK + 0.4) spawnGi(i, false);
        const y = giY[i];
        const r = Math.min(giR[i], rInAt(y) - 0.18);
        polar(r, giA[i] + 0.25 * Math.sin(time * 0.7 + i), y, tmp);
        pa[i * 3] = tmp[0];
        pa[i * 3 + 1] = tmp[1];
        pa[i * 3 + 2] = tmp[2];
        const fade = 1 - smooth(Y_STOCK - 0.6, Y_STOCK + 0.4, y);
        c.copy(COL.co).lerp(COL.co2, smooth(4.5, 10.5, y) * 0.65).multiplyScalar(fade);
        ca[i * 3] = c.r;
        ca[i * 3 + 1] = c.g;
        ca[i * 3 + 2] = c.b;
      }
      giPts.geometry.attributes.position.needsUpdate = true;
      giPts.geometry.attributes.color.needsUpdate = true;
    }
    {
      const pa = jtPts.geometry.attributes.position.array;
      const ca = jtPts.geometry.attributes.color.array;
      for (let i = 0; i < JT_N; i++) {
        jtS[i] += dt * (1.3 + 0.5 * Math.abs(jtJ[i])) * vs;
        if (jtS[i] > 1) jtS[i] -= 1;
        const s = jtS[i];
        const k = Math.floor(i / JPER);
        polar(lerp(1.95, 1.0, s), TUY_TH[k] + jtJ[i] * 0.16 * s, Y_TUY + 0.22 * s * s + jtJ[i] * 0.08, tmp);
        pa[i * 3] = tmp[0];
        pa[i * 3 + 1] = tmp[1];
        pa[i * 3 + 2] = tmp[2];
        const c = jtSp[i] === 0 ? COL.o2 : jtSp[i] === 1 ? COL.co : COL.ch4;
        const f = 1 - 0.7 * s;
        ca[i * 3] = c.r * f;
        ca[i * 3 + 1] = c.g * f;
        ca[i * 3 + 2] = c.b * f;
      }
      jtPts.geometry.attributes.position.needsUpdate = true;
      jtPts.geometry.attributes.color.needsUpdate = true;
    }
    {
      const pa = drPts.geometry.attributes.position.array;
      for (let i = 0; i < DR_N; i++) {
        drV[i] += 5.5 * dt;
        drY[i] -= drV[i] * dt * vs;
        if (drY[i] < slagL) spawnDrop(i, false);
        polar(drR[i] * 1.6, drA[i], drY[i], tmp);
        pa[i * 3] = tmp[0];
        pa[i * 3 + 1] = tmp[1];
        pa[i * 3 + 2] = tmp[2];
      }
      drPts.geometry.attributes.position.needsUpdate = true;
    }
    {
      const pa = tpPts.geometry.attributes.position.array;
      const ca = tpPts.geometry.attributes.color.array;
      const c = new THREE.Color();
      for (let i = 0; i < TP_N; i++) {
        tpU[i] += (dt * 3.2) / jetPath.len;
        if (tpU[i] > 1) tpU[i] -= 1;
        const u = tpU[i];
        jetPath.at(u, tmp);
        const w = 0.05 + 0.12 * u;
        pa[i * 3] = tmp[0] + tpJ[i * 2] * w;
        pa[i * 3 + 1] = tmp[1] + Math.abs(tpJ[i * 2 + 1]) * w * 0.6;
        pa[i * 3 + 2] = tmp[2];
        c.copy(COL.feL).lerp(COL.feHot, u * 0.8).multiplyScalar(tapA);
        ca[i * 3] = c.r;
        ca[i * 3 + 1] = c.g;
        ca[i * 3 + 2] = c.b;
      }
      tpPts.geometry.attributes.position.needsUpdate = true;
      tpPts.geometry.attributes.color.needsUpdate = true;
      const sa = stPts.geometry.attributes.position.array;
      for (let i = 0; i < ST_N; i++) {
        stU[i] += dt * 0.35;
        if (stU[i] > 1) {
          stU[i] -= 1;
          stA[i] = rand() * TAU;
          stR[i] = rand() * 0.7;
        }
        const u = stU[i];
        const r = stR[i] + u * 0.9;
        sa[i * 3] = GRAN.x + Math.cos(stA[i]) * r;
        sa[i * 3 + 1] = 0.95 + u * 2.4;
        sa[i * 3 + 2] = GRAN.z + Math.sin(stA[i]) * r;
      }
      stPts.geometry.attributes.position.needsUpdate = true;
    }
    {
      const pa = gasPts.geometry.attributes.position.array;
      const ca = gasPts.geometry.attributes.color.array;
      const L1 = offgasPath.len;
      for (let i = 0; i < GAS_N; i++) {
        const br = branchOf(gasSp[i]);
        const L = L1 + br.len;
        const f = L1 / L;
        gasU[i] += (dt * 2.3 * vs) / L;
        if (gasU[i] > 1) gasU[i] -= 1;
        const u = gasU[i];
        if (u < f) offgasPath.at(u / f, tmp);
        else br.at((u - f) / (1 - f), tmp);
        const j = u < f ? (tmp[1] > 9.6 && tmp[1] < 13 && tmp[0] > 3.9 ? 0.55 : 0.18) : 0.12;
        pa[i * 3] = tmp[0] + gasO[i * 3] * j;
        pa[i * 3 + 1] = tmp[1] + gasO[i * 3 + 1] * j;
        pa[i * 3 + 2] = tmp[2] + gasO[i * 3 + 2] * j;
        const c = SPEC[gasSp[i]];
        ca[i * 3] = c.r;
        ca[i * 3 + 1] = c.g;
        ca[i * 3 + 2] = c.b;
      }
      gasPts.geometry.attributes.position.needsUpdate = true;
      gasPts.geometry.attributes.color.needsUpdate = true;
    }
    {
      const pa = opPts.geometry.attributes.position.array;
      for (let i = 0; i < OP_N; i++) {
        opU[i] += (dt * 2.2 * vs) / o2Path.len;
        if (opU[i] > 1) opU[i] -= 1;
        o2Path.at(opU[i], tmp);
        pa[i * 3] = tmp[0];
        pa[i * 3 + 1] = tmp[1] + Math.sin(i * 7.1) * 0.05;
        pa[i * 3 + 2] = tmp[2] + Math.cos(i * 3.3) * 0.05;
      }
      opPts.geometry.attributes.position.needsUpdate = true;
      const a1 = o2rPts.geometry.attributes.position.array;
      const a2 = gsrPts.geometry.attributes.position.array;
      for (let i = 0; i < RG_N; i++) {
        rgA[i] += dt * 0.8;
        const a = rgA[i];
        const b = -rgA[i] * 0.9 + 0.3;
        a1[i * 3] = RING_R * Math.cos(a);
        a1[i * 3 + 1] = Y_O2RING;
        a1[i * 3 + 2] = -RING_R * Math.sin(a);
        a2[i * 3] = RING_R * Math.cos(b);
        a2[i * 3 + 1] = Y_GASRING;
        a2[i * 3 + 2] = -RING_R * Math.sin(b);
      }
      o2rPts.geometry.attributes.position.needsUpdate = true;
      gsrPts.geometry.attributes.position.needsUpdate = true;
    }
    const hb = 0.6 + 0.8 * heatBoost;
    heatCol.material.opacity = (0.12 + 0.2 * heatBoost) * Wt.heat;
    flashes.forEach((s, k) => {
      const fl = 0.55 + 0.45 * Math.sin(time * 9.3 + k * 1.7) * Math.sin(time * 5.1 + k);
      const sc = (0.9 + 0.6 * heatBoost) * (0.85 + 0.35 * fl) * visualScale;
      s.scale.set(sc, sc, 1);
      s.material.opacity = (0.3 + 0.35 * fl) * hb * Math.max(Wt.heat, Wt.o2 * 0.7);
    });
  }

  function updateBriquette(dt, time) {
    const kk = 1 - Math.exp(-dt * 3);
    const tA = stepIdx === 0 || stepIdx === 1 ? 1 : 0;
    bAlpha += (tA - bAlpha) * kk;
    ringA += ((stepIdx === 1 ? smooth(0.05, 0.35, stepT / STEPS[1].dur) : 0) - ringA) * kk;
    briqLight.intensity = 0.75 * bAlpha;
    const vis = bAlpha > 0.005;
    briqGroup.visible = vis;
    ringGroup.visible = ringA > 0.005;
    if (ringGroup.visible) {
      ringGroup.quaternion.copy(camera.quaternion);
      ringArcs.forEach(m => { m.material.opacity = 0.95 * ringA; });
    }
    if (!vis) return;
    Object.values(bqMats).forEach(m => {
      m.opacity = bAlpha;
      m.depthWrite = bAlpha > 0.9;
    });
    const asm = stepIdx === 0 ? smooth(0.06, 0.72, stepT / STEPS[0].dur) : 1;
    const cut = stepIdx === 1 ? smooth(0.1, 0.5, stepT / STEPS[1].dur) : 0;
    briqGroup.rotation.y = time * 0.22;
    briqGroup.rotation.x = 0.18 * Math.sin(time * 0.3);
    bqLoops.forEach((l, k) => {
      l.material.opacity = bAlpha * (k === 2 ? 0.25 + 0.55 * cut : 0.3 * smooth(0.6, 1, asm) * (1 - 0.6 * cut));
    });
    bqSets.forEach(S => {
      for (let i = 0; i < S.n; i++) {
        const a = smooth(0, 1, clamp((asm - S.del[i] * 0.35) / 0.65, 0, 1));
        const tx = S.tgt[i * 3];
        const ty = S.tgt[i * 3 + 1];
        const tz = S.tgt[i * 3 + 2];
        _p.set(lerp(S.sc[i * 3], tx, a), lerp(S.sc[i * 3 + 1], ty, a), lerp(S.sc[i * 3 + 2], tz, a));
        _q.setFromAxisAngle(S.ax[i], (1 - a) * time * 1.6 + S.del[i] * 6);
        const hide = tz > 0.02 ? cut : 0;
        _s.setScalar(Math.max(0.0001, 1 - hide));
        _m4.compose(_p, _q, _s);
        S.mesh.setMatrixAt(i, _m4);
      }
      S.mesh.instanceMatrix.needsUpdate = true;
    });
  }

  let onTelemetry = null;
  let lastTapState = null;

  function tick(dt, render) {
    simTime += dt;
    const time = simTime;

    if (tourPlaying) {
      stepT += dt;
      if (stepT >= stepDef(stepIdx).dur) {
        stepIdx = stepIdx + 1 >= STEPS.length ? -1 : stepIdx + 1;
        stepT = 0;
        camFollow = true;
        emitStep();
      }
    } else {
      stepT = Math.min(stepT + dt, stepDef(stepIdx).dur * 0.999);
    }

    const focus = stepDef(stepIdx).focus;
    const kw = 1 - Math.exp(-dt * 3);
    FLOW_KEYS.forEach(k => {
      const t = !focus || focus.includes(k) ? 1 : 0.14;
      Wt[k] += (t - Wt[k]) * kw;
    });
    heatBoost += ((stepIdx === 5 ? 1 : 0) - heatBoost) * kw;
    const wearFocus = !cutView;
    const lt = wearFocus ? 1 : (stepIdx < 0 ? 0.8 : 0.42);
    if (Math.abs(lt - liningK) > 0.002) {
      liningK += (lt - liningK) * kw;
      Object.values(zoneMeshes).forEach(m => {
        m.material.opacity = (m.userData.op ?? 0.97) * liningK;
      });
    }

    tapT = (tapT + dt) % TAP_PERIOD;
    const tapOpen = stepIdx === 7 || tapT > TAP_PERIOD - TAP_OPEN;
    tapA += ((tapOpen ? 1 : 0) - tapA) * (1 - Math.exp(-dt * 2.5));
    ironL = clamp(ironL + (tapOpen ? -0.024 : 0.011) * dt, 1.38, 1.78);
    setPool();
    ironSurf.material.opacity = 0.75 + 0.15 * Math.sin(time * 2.6);
    warmLight.intensity = 1.1 + 0.5 * heatBoost + 0.15 * Math.sin(time * 3.1);

    updateCamera(dt, time);
    if (flowsOn) {
      setFlowOpacity();
      updateFlows(dt, time);
    }
    updateBriquette(dt, time);
    tapRing.material.opacity = 0.5 + 0.45 * tapA;
    updateLabels(dt);

    if (onTelemetry) {
      telT += dt;
      const tapElapsed = tapOpen ? Math.min(tapT, TAP_OPEN) : 0;
      if (tapElapsed !== lastTapState || tapOpen !== lastTapState || telT > 0.25) {
        telT = 0;
        lastTapState = tapElapsed;
        const levelPct = 55 + 40 * clamp((ironL - 1.38) / (1.78 - 1.38), 0, 1);
        onTelemetry({
          stepIdx,
          stepName: stepDef(stepIdx).name,
          tapOpen,
          tapElapsed,
          metalLevelPct: levelPct,
          ironLevelM: ironL,
          slagLevelM: slagL,
          tourPlaying,
          stepProgress: stepT / stepDef(stepIdx).dur,
          simTime
        });
      }
    }

    if (render) renderer.render(scene, camera);
  }

  let rafId = 0;
  function loop() {
    rafId = requestAnimationFrame(loop);
    tick(Math.min(clock.getDelta(), 0.1), true);
  }

  // ============================================================ API pública
  let onStepChange = null;
  function emitStep() {
    if (onStepChange) {
      onStepChange({
        index: stepIdx,
        total: STEPS.length,
        step: stepDef(stepIdx),
        playing: tourPlaying
      });
    }
  }

  const api = {
    applyDataset,
    setWearSnapshot(index) {
      if (!DS) return;
      snapIdx = clamp(index, 0, DS.snaps.length - 1);
      refreshColors();
    },
    getWearSnapshot: () => snapIdx,
    setCutView(on) {
      cutView = !!on;
      Object.values(zoneMeshes).forEach(m => {
        m.material.side = zoneSide();
        m.material.needsUpdate = true;
      });
      shellMesh.material.opacity = cutView ? 0.1 : 0.26;
    },
    isCutView: () => cutView,
    setFlowsVisible(on) {
      flowsOn = !!on;
      FLOW_OBJS.forEach(o => { o.visible = flowsOn; });
    },
    areFlowsVisible: () => flowsOn,
    setWearVisible(on) {
      wearOn = !!on;
      Object.values(zoneMeshes).forEach(m => { m.visible = wearOn; });
    },
    isWearVisible: () => wearOn,
    setLabelsVisible(on) {
      labelsVisible = !!on;
    },
    goStep(i) {
      stepIdx = i;
      stepT = 0;
      camFollow = true;
      emitStep();
    },
    nextStep() {
      api.goStep(stepIdx + 1 >= STEPS.length ? -1 : stepIdx + 1);
    },
    prevStep() {
      if (stepT > 1.5) {
        api.goStep(stepIdx);
        return;
      }
      api.goStep(stepIdx - 1 < -1 ? STEPS.length - 1 : stepIdx - 1);
    },
    setPlaying(on) {
      tourPlaying = !!on;
      if (tourPlaying) camFollow = true;
      emitStep();
    },
    isPlaying: () => tourPlaying,
    onStep(cb) {
      onStepChange = cb;
      emitStep();
    },
    onTelemetry(cb) {
      onTelemetry = cb;
    },
    setVisualScale(k) {
      visualScale = clamp(Number(k) || 1, 0.4, 1.9);
    },
    resetCamera() {
      camFollow = true;
      userZoom = 1;
    },
    start() {
      if (!rafId) loop();
    },
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    resize: onResize,
    dispose() {
      api.stop();
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (renderer.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
      labelLayer.remove();
    },
    _internals: { scene, camera, renderer, worldGroup, zoneMeshes, ZONES }
  };

  return api;
}
