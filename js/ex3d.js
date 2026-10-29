// ex3d.js — «Як виконувати» в 3D (28.10.2026): той самий персонаж і рух, що на картинках, але крутиться пальцем.
// Дані — models/ex3d/ (tools/exercise3d/export3d.py з тих самих поз, що render.py): char.bin/json — персонаж один раз
// (вершини, нормалі, трикутники, 4 кістки на вершину), <id>.json — 9 кадрів кісток і обладнання.
// Координати Blender (Z угору) — уся сцена в групі, поверненій на −90° навколо X.
// Рух — як CSS exRun у картинок: пауза на старті → до фіналу → пауза → назад, 2,6 с.
// Тап — пауза / далі. Three.js вантажиться лише тут; без WebGL mountEx3D кидає помилку — лишається картинка.

export const EX3D_V = 1; // підняти після перевивантаження models/ex3d (SW віддає їх із кешу)
const BASE = 'models/ex3d/';
let THREE = null;
let charP = null;

async function loadThree() {
  if (!THREE) THREE = await import('../vendor/three/three.module.min.js');
  return THREE;
}
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}
function loadChar() {
  if (!charP) {
    charP = Promise.all([
      getJSON(`${BASE}char.json?v=${EX3D_V}`),
      fetch(`${BASE}char.bin?v=${EX3D_V}`).then((r) => { if (!r.ok) throw new Error('char.bin'); return r.arrayBuffer(); }),
    ]).then(([meta, buf]) => {
      const n = meta.verts;
      let o = 0;
      const pos = new Float32Array(buf, o, n * 3); o += n * 12;
      const nrm = new Int8Array(buf, o, n * 3); o += n * 3; o += (4 - (o % 4)) % 4;
      const si = new Uint8Array(buf, o, n * 4); o += n * 4;
      const sw = new Uint8Array(buf, o, n * 4); o += n * 4;
      const idx = new Uint16Array(buf, o, meta.tris * 3);
      return { meta, pos, nrm, si, sw, idx };
    }).catch((e) => { charP = null; throw e; });
  }
  return charP;
}
let glOk = null;
export function hasWebGL() { // один раз: кожен getContext — новий контекст, а їх у браузера обмаль
  if (glOk === null) {
    try {
      const c = document.createElement('canvas');
      glOk = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
      glOk = false;
    }
  }
  return glOk;
}
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
// пауза на старті → рух → пауза на фіналі → назад (частки циклу як у @keyframes exRun)
function phaseU(p) {
  if (p < 0.18) return 0;
  if (p < 0.5) return (p - 0.18) / 0.32;
  if (p < 0.68) return 1;
  return 1 - (p - 0.68) / 0.32;
}

/**
 * Змонтувати 3D-перегляд вправи в container.
 * Повертає { destroy() }.
 */
export async function mountEx3D(container, id) {
  const [T, ch, ex] = await Promise.all([loadThree(), loadChar(), getJSON(`${BASE}${id}.json?v=${EX3D_V}`)]);
  const canvas = document.createElement('canvas');
  canvas.className = 'ex3d-canvas';
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  container.appendChild(canvas);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, 1, 0.05, 40);
  const accent = new T.Color(cssVar('--blue', '#c6f84e'));
  const txt = new T.Color(cssVar('--txt', '#eef1f6'));
  const card = new T.Color(cssVar('--bg-card', '#0d0d10'));
  const light = card.getHSL({}).l > 0.5;
  const skin = light ? new T.Color('#b9bdc7') : txt.clone().lerp(card, 0.4);

  scene.add(new T.HemisphereLight(0xffffff, light ? 0x8c8c94 : 0x1a1a22, light ? 1.2 : 1.0));
  const key = new T.DirectionalLight(0xffffff, light ? 1.6 : 2.0);
  const rim = new T.DirectionalLight(accent.getHex(), light ? 0.5 : 0.9);
  scene.add(key, rim);

  const G = new T.Group();
  G.rotation.x = -Math.PI / 2;
  scene.add(G);

  // персонаж: SkinnedMesh, кістки — плоскі діти групи (позиція й поворот у світі Blender)
  const { meta } = ch;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(ch.pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(ch.nrm, 3, true));
  geo.setAttribute('skinIndex', new T.BufferAttribute(ch.si, 4));
  geo.setAttribute('skinWeight', new T.BufferAttribute(ch.sw, 4, true));
  geo.setIndex(new T.BufferAttribute(ch.idx, 1));
  const bodyMat = new T.MeshStandardMaterial({ color: skin, roughness: 0.6, metalness: 0.03 });
  const mesh = new T.SkinnedMesh(geo, bodyMat);
  mesh.frustumCulled = false; // межі рахуються з пози спокою — лежачи фігуру обрізало б
  const bones = meta.bones.map(() => new T.Bone());
  const setTRS = (o, f, off = 0) => {
    o.position.set(f[off], f[off + 1], f[off + 2]);
    o.quaternion.set(f[off + 4], f[off + 5], f[off + 6], f[off + 3]); // у Blender w — першим
  };
  bones.forEach((b, i) => { setTRS(b, meta.rest[i]); G.add(b); });
  G.add(mesh);
  G.updateMatrixWorld(true);
  mesh.bind(new T.Skeleton(bones));

  // обладнання: циліндри й коробки з розмірами з Blender
  const mats = {
    bar: new T.MeshStandardMaterial({ color: light ? 0x9aa0ad : 0xc9ccd6, roughness: 0.3, metalness: 0.6 }),
    plate: new T.MeshStandardMaterial({ color: light ? 0x2a2d38 : txt.clone().lerp(card, 0.87), roughness: 0.5 }),
    dark: new T.MeshStandardMaterial({ color: light ? 0x4a4e5c : txt.clone().lerp(card, 0.85), roughness: 0.75 }),
  };
  const geos = [];
  const props = ex.shapes.map((s) => {
    let g;
    if (s.k === 'cyl') {
      g = new T.CylinderGeometry(s.d[0] / 2, s.d[0] / 2, s.d[2], 28);
      g.rotateX(Math.PI / 2); // у Blender циліндр уздовж Z
    } else g = new T.BoxGeometry(s.d[0], s.d[1], s.d[2]);
    geos.push(g);
    const m = new T.Mesh(g, mats[s.m] || mats.dark);
    G.add(m);
    return m;
  });

  // тінь під ногами — м'яка пляма на підлозі
  const [lo, hi] = ex.box;
  const sh = document.createElement('canvas');
  sh.width = sh.height = 64;
  const sx = sh.getContext('2d');
  const grd = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, light ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = grd;
  sx.fillRect(0, 0, 64, 64);
  const shTex = new T.CanvasTexture(sh);
  const shGeo = new T.PlaneGeometry(1, 1);
  const shMat = new T.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false });
  const shadow = new T.Mesh(shGeo, shMat);
  shadow.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, Math.max(0, lo[2]) + 0.002);
  shadow.scale.set((hi[0] - lo[0]) * 1.5 + 0.3, (hi[1] - lo[1]) * 1.3 + 0.3, 1);
  G.add(shadow);

  // камера: орбіта навколо центру сцени; відстань — щоб влізло з будь-якого боку
  const c = new T.Vector3((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, -(lo[1] + hi[1]) / 2);
  const rh = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]) / 2;
  const hz = (hi[2] - lo[2]) / 2;
  const v = ex.view; // ракурс з poses.py (Blender) → Three: (x, z, −y)
  let az = Math.atan2(v[0], -v[1]);
  let el = Math.atan2(v[2], Math.hypot(v[0], v[1]));
  const az0 = az, el0 = el;
  const EL_MIN = -0.15, EL_MAX = 1.2;
  function place() {
    const tan = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
    const ext = Math.max(rh, hz * Math.cos(el) + rh * Math.sin(Math.abs(el)));
    const dist = rh * 0.5 + ext / tan * 1.02; // ближня половина сцени крупніша — запас на неї
    camera.position.set(
      c.x + dist * Math.cos(el) * Math.sin(az),
      c.y + dist * Math.sin(el),
      c.z + dist * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(c);
    key.position.copy(camera.position).add(new T.Vector3(1.5, 2.5, 0.5));
    rim.position.set(c.x - 3 * Math.sin(az), c.y + 1.5, c.z - 3 * Math.cos(az));
  }

  // кадр руху: u 0..1 → між сусідніми кадрами (кістки — slerp, предмети — так само)
  const N = ex.frames.length;
  const qa = new T.Quaternion(), qb = new T.Quaternion();
  function poseAt(u) {
    const x = Math.min(N - 1, Math.max(0, u * (N - 1)));
    const i = Math.min(N - 2, Math.floor(x));
    const t = x - i;
    const A = ex.frames[i], B = ex.frames[i + 1];
    bones.forEach((b, k) => {
      const a = A[k], d = B[k];
      b.position.set(a[0] + (d[0] - a[0]) * t, a[1] + (d[1] - a[1]) * t, a[2] + (d[2] - a[2]) * t);
      qa.set(a[4], a[5], a[6], a[3]);
      qb.set(d[4], d[5], d[6], d[3]);
      b.quaternion.slerpQuaternions(qa, qb, t);
    });
    const PA = ex.props[i], PB = ex.props[i + 1];
    props.forEach((m, k) => {
      const a = PA[k], d = PB[k];
      m.position.set(a[0] + (d[0] - a[0]) * t, a[1] + (d[1] - a[1]) * t, a[2] + (d[2] - a[2]) * t);
      qa.set(a[4], a[5], a[6], a[3]);
      qb.set(d[4], d[5], d[6], d[3]);
      m.quaternion.slerpQuaternions(qa, qb, t);
      m.scale.set(a[7], a[8], a[9]);
    });
  }

  function resize() {
    const w = container.clientWidth || 300, h = container.clientHeight || w;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paused = reduce, raf = 0, t0 = performance.now(), pT = 0, vel = 0;
  function frame(now) {
    raf = 0;
    if (!paused) pT = ((now - t0) / 2600) % 1;
    if (Math.abs(vel) > 0.0005 && !dragging) { az += vel; vel *= 0.92; }
    place();
    poseAt(phaseU(pT));
    renderer.render(scene, camera);
    if (!paused || (Math.abs(vel) > 0.0005 && !dragging)) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  // крутити пальцем: вбік — навколо, вгору-вниз — нахил; тап — пауза
  let dragging = false, lx = 0, ly = 0, moved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0; vel = 0; lx = e.clientX; ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    az -= dx * 0.011; vel = -dx * 0.011;
    el = Math.min(EL_MAX, Math.max(EL_MIN, el + dy * 0.008));
    kick();
  });
  const up = () => {
    if (!dragging) return;
    dragging = false;
    if (moved < 6) {
      vel = 0;
      paused = !paused;
      if (!paused) t0 = performance.now() - pT * 2600;
    }
    kick();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('dblclick', () => { az = az0; el = el0; vel = 0; kick(); });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); kick(); }) : null;
  if (ro) ro.observe(container);
  resize();
  kick();

  return {
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      geo.dispose(); bodyMat.dispose(); shGeo.dispose(); shMat.dispose(); shTex.dispose();
      geos.forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
}
