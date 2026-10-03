// body3d.js — 3D-фігура людини для екрана замірів.
// Фігура збирається з плавних «трубок» з еліптичним перерізом (без готової моделі),
// тож кожен обхват (груди, талія, стегна, біцепс, стегно) прямо задає товщину частини.
// Three.js підвантажується лише тут (vendor/three), щоб не важчав старт застосунку.

let THREE = null;
async function loadThree() {
  if (!THREE) THREE = await import('../vendor/three/three.module.min.js');
  return THREE;
}

// середні значення, від яких рахується фігура, якщо замірів ще немає
export const BODY_BASE = {
  m: { chest: 100, waist: 84, hips: 98, biceps: 33, thigh: 56, bodyWeight: 78, bodyFat: 18 },
  f: { chest: 90, waist: 70, hips: 98, biceps: 27, thigh: 56, bodyWeight: 62, bodyFat: 26 },
};

// на яких частинах показуються мітки (решта метрик — кнопками під фігурою)
export const BODY_PARTS = ['chest', 'waist', 'hips', 'biceps', 'thigh'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// периметр еліпса (Рамануджан) для співвідношення півосей k = a/b при b = 1
function perimFactor(k) {
  return Math.PI * (3 * (k + 1) - Math.sqrt((3 * k + 1) * (k + 3)));
}
// обхват у см → півосі еліпса в метрах (k — ширина/глибина)
function ellipse(cm, k = 1) {
  const b = cm / 100 / perimFactor(k);
  return [b * k, b];
}
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// ---------------------------------------------------------------------
//  Трубка: вузли {x,y,z,a,b} → гладка поверхня із заокругленими кінцями
// ---------------------------------------------------------------------
const RAD = 32; // точок у перерізі
const SUB = 7; // кроків між вузлами
const CAP = 6; // кілець на заокруглення кінця

function sampleNodes(nodes) {
  const out = [];
  const n = nodes.length;
  const at = (i) => nodes[clamp(i, 0, n - 1)];
  for (let i = 0; i < n - 1; i++) {
    const steps = i === n - 2 ? SUB + 1 : SUB;
    for (let s = 0; s < steps; s++) {
      const t = s / SUB;
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const o = {};
      for (const k of ['x', 'y', 'z', 'a', 'b']) o[k] = cr(p0[k], p1[k], p2[k], p3[k], t);
      o.a = Math.max(o.a, 0.004);
      o.b = Math.max(o.b, 0.004);
      out.push(o);
    }
  }
  return out;
}

function ringCount(nodeCount) {
  return (nodeCount - 1) * SUB + 1 + CAP * 2;
}

// заповнює масив позицій (довжина ringCount*RAD*3)
function fillTube(T, pos, nodes) {
  const rings = sampleNodes(nodes);
  const full = [];
  const tan = (i) => {
    const a = rings[Math.max(0, i - 1)];
    const b = rings[Math.min(rings.length - 1, i + 1)];
    const v = new T.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    return v.lengthSq() < 1e-12 ? new T.Vector3(0, -1, 0) : v.normalize();
  };
  // заокруглений початок
  const t0 = tan(0);
  for (let c = CAP; c >= 1; c--) {
    const ang = (c / CAP) * (Math.PI / 2);
    const r = rings[0];
    const d = Math.sin(ang) * Math.min(r.a, r.b);
    full.push({ x: r.x - t0.x * d, y: r.y - t0.y * d, z: r.z - t0.z * d, a: r.a * Math.cos(ang) + 1e-4, b: r.b * Math.cos(ang) + 1e-4, t: t0 });
  }
  rings.forEach((r, i) => full.push({ ...r, t: tan(i) }));
  const tl = tan(rings.length - 1);
  for (let c = 1; c <= CAP; c++) {
    const ang = (c / CAP) * (Math.PI / 2);
    const r = rings[rings.length - 1];
    const d = Math.sin(ang) * Math.min(r.a, r.b);
    full.push({ x: r.x + tl.x * d, y: r.y + tl.y * d, z: r.z + tl.z * d, a: r.a * Math.cos(ang) + 1e-4, b: r.b * Math.cos(ang) + 1e-4, t: tl });
  }
  const Z = new T.Vector3(0, 0, 1);
  const W = new T.Vector3();
  const D = new T.Vector3();
  let k = 0;
  for (const r of full) {
    W.crossVectors(r.t, Z);
    if (W.lengthSq() < 1e-8) W.set(1, 0, 0);
    W.normalize();
    if (W.x < 0) W.negate(); // ширина завжди вздовж +X, інакше переріз перекручується
    D.crossVectors(W, r.t).normalize();
    if (D.z < 0) D.negate();
    for (let j = 0; j < RAD; j++) {
      const th = (j / RAD) * Math.PI * 2;
      const c = Math.cos(th) * r.a;
      const s = Math.sin(th) * r.b;
      pos[k++] = r.x + W.x * c + D.x * s;
      pos[k++] = r.y + W.y * c + D.y * s;
      pos[k++] = r.z + W.z * c + D.z * s;
    }
  }
}

function makeTube(T, nodes, material) {
  const rc = ringCount(nodes.length);
  const pos = new Float32Array(rc * RAD * 3);
  fillTube(T, pos, nodes);
  const idx = [];
  for (let i = 0; i < rc - 1; i++) {
    for (let j = 0; j < RAD; j++) {
      const a = i * RAD + j;
      const b = i * RAD + ((j + 1) % RAD);
      const c = (i + 1) * RAD + j;
      const d = (i + 1) * RAD + ((j + 1) % RAD);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new T.Mesh(g, material);
  // нормалі мають дивитися назовні: перевіряємо одну вершину посередині й за потреби
  // перевертаємо трикутники (напрям обходу залежить від напрямку трубки)
  const mid = Math.floor(rc / 2) * RAD;
  const n = new T.Vector3().fromBufferAttribute(g.attributes.normal, mid);
  const ctr = new T.Vector3();
  for (let j = 0; j < RAD; j++) ctr.add(new T.Vector3().fromBufferAttribute(g.attributes.position, mid + j));
  ctr.divideScalar(RAD);
  const v = new T.Vector3().fromBufferAttribute(g.attributes.position, mid).sub(ctr);
  if (n.dot(v) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  mesh.userData.update = (nn) => {
    fillTube(T, pos, nn);
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  };
  return mesh;
}

// ---------------------------------------------------------------------
//  Пропорції: заміри → вузли всіх частин тіла
// ---------------------------------------------------------------------
function build(sex, vals) {
  const B = BODY_BASE[sex];
  const v = {};
  for (const k of Object.keys(B)) {
    const x = Number(vals[k]);
    v[k] = x > 0 ? clamp(x, B[k] * 0.6, B[k] * 1.8) : B[k];
  }
  const f = sex === 'f';
  // вага й жир трохи міняють частини, які окремо не міряються
  const wf = clamp(Math.sqrt(v.bodyWeight / B.bodyWeight), 0.85, 1.3);
  const belly = clamp((v.bodyFat - B.bodyFat) / 100, -0.06, 0.2);

  const [hipA, hipB] = ellipse(v.hips, f ? 1.42 : 1.34);
  const [waA, waB] = ellipse(v.waist, f ? 1.34 : 1.3);
  const [chA, chB] = ellipse(v.chest, f ? 1.3 : 1.45);
  const under = f ? v.chest * 0.86 : lerp(v.waist, v.chest, 0.6);
  const [unA, unB] = ellipse(under, f ? 1.3 : 1.4);
  const shA = chA * (f ? 1.0 : 1.1);
  const shB = chB * 0.82;
  const neck = (f ? 32 : 38) * wf;
  const [nA, nB] = ellipse(neck, 1.05);

  const torso = [
    { x: 0, y: 0.8, z: 0, a: hipA * 0.86, b: hipB * 0.82 },
    { x: 0, y: 0.9, z: -0.005, a: hipA, b: hipB },
    { x: 0, y: 1.02, z: belly * 0.25, a: waA, b: waB * (1 + belly * 0.6) },
    { x: 0, y: 1.15, z: belly * 0.1, a: unA, b: unB },
    { x: 0, y: 1.27, z: f ? 0.006 : 0.004, a: chA, b: chB },
    { x: 0, y: 1.38, z: -0.008, a: shA, b: shB },
    { x: 0, y: 1.445, z: -0.012, a: shA * 0.8, b: shB * 0.76 },
    { x: 0, y: 1.49, z: -0.01, a: nA * 1.5, b: nB * 1.25 },
  ];
  const neckN = [
    { x: 0, y: 1.47, z: -0.008, a: nA, b: nB },
    { x: 0, y: 1.56, z: 0, a: nA * 0.95, b: nB * 0.95 },
    { x: 0, y: 1.62, z: 0.005, a: nA * 0.9, b: nB * 0.9 },
  ];

  const bR = v.biceps / 100 / (2 * Math.PI);
  const fore = ((f ? 24 : 29) * wf) / 100 / (2 * Math.PI);
  const wrist = ((f ? 15 : 17.5) * Math.sqrt(wf)) / 100 / (2 * Math.PI);
  const sx = shA - bR * 0.15;
  const arm = (s) => [
    { x: s * (sx - 0.015), y: 1.425, z: -0.01, a: bR * 1.18, b: bR * 1.08 },
    { x: s * (sx + 0.012), y: 1.37, z: -0.008, a: bR * 1.08, b: bR * 1.02 },
    { x: s * (sx + 0.03), y: 1.27, z: -0.004, a: bR, b: bR * 1.04 },
    { x: s * (sx + 0.05), y: 1.14, z: -0.01, a: bR * 0.72, b: bR * 0.72 },
    { x: s * (sx + 0.075), y: 1.03, z: 0.008, a: fore * 1.05, b: fore * 0.9 },
    { x: s * (sx + 0.105), y: 0.87, z: 0.024, a: wrist * 1.15, b: wrist * 0.85 },
  ];

  const tR = v.thigh / 100 / (2 * Math.PI);
  const knee = ((f ? 36 : 38) * wf) / 100 / (2 * Math.PI);
  const calf = ((f ? 36 : 38) * wf) / 100 / (2 * Math.PI);
  const ankle = ((f ? 21 : 23) * Math.sqrt(wf)) / 100 / (2 * Math.PI);
  const hx = Math.max(hipA * 0.5, tR * 0.92);
  const leg = (s) => [
    { x: s * hx, y: 0.86, z: 0, a: tR * 1.06, b: tR * 1.04 },
    { x: s * hx * 0.97, y: 0.74, z: 0.004, a: tR, b: tR },
    { x: s * hx * 0.9, y: 0.6, z: 0.006, a: tR * 0.8, b: tR * 0.82 },
    { x: s * hx * 0.82, y: 0.48, z: 0.004, a: knee, b: knee },
    { x: s * hx * 0.8, y: 0.36, z: -0.008, a: calf * 1.02, b: calf * 1.06 },
    { x: s * hx * 0.78, y: 0.2, z: -0.004, a: calf * 0.72, b: calf * 0.72 },
    { x: s * hx * 0.78, y: 0.08, z: 0, a: ankle, b: ankle },
  ];

  return {
    sex, v,
    torso, neck: neckN,
    armL: arm(1), armR: arm(-1),
    legL: leg(1), legR: leg(-1),
    head: { y: 1.7, r: f ? 0.092 : 0.097 },
    bust: f ? clamp(0.034 + (v.chest - under) / 100 * 0.22, 0.03, 0.07) : 0,
    chest: { a: chA, b: chB, z: f ? 0.006 : 0.004 },
    rings: {
      chest: { y: 1.27, x: 0, z: f ? 0.006 : 0.004, a: chA, b: chB },
      waist: { y: 1.02, x: 0, z: belly * 0.25, a: waA, b: waB * (1 + belly * 0.6) },
      hips: { y: 0.9, x: 0, z: -0.005, a: hipA, b: hipB },
      biceps: { y: 1.27, x: sx + 0.03, z: -0.004, a: bR, b: bR * 1.04 },
      thigh: { y: 0.74, x: hx * 0.97, z: 0.004, a: tR, b: tR },
    },
  };
}

// плавний перехід між двома наборами вузлів
function mixShape(a, b, t) {
  const mixNodes = (p, q) => p.map((n, i) => ({
    x: lerp(n.x, q[i].x, t), y: lerp(n.y, q[i].y, t), z: lerp(n.z, q[i].z, t),
    a: lerp(n.a, q[i].a, t), b: lerp(n.b, q[i].b, t),
  }));
  const rings = {};
  for (const k of Object.keys(b.rings)) {
    const p = a.rings[k], q = b.rings[k];
    rings[k] = { y: lerp(p.y, q.y, t), x: lerp(p.x, q.x, t), z: lerp(p.z, q.z, t), a: lerp(p.a, q.a, t), b: lerp(p.b, q.b, t) };
  }
  return {
    ...b,
    torso: mixNodes(a.torso, b.torso), neck: mixNodes(a.neck, b.neck),
    armL: mixNodes(a.armL, b.armL), armR: mixNodes(a.armR, b.armR),
    legL: mixNodes(a.legL, b.legL), legR: mixNodes(a.legR, b.legR),
    head: { y: lerp(a.head.y, b.head.y, t), r: lerp(a.head.r, b.head.r, t) },
    bust: lerp(a.bust, b.bust, t),
    chest: { a: lerp(a.chest.a, b.chest.a, t), b: lerp(a.chest.b, b.chest.b, t), z: lerp(a.chest.z, b.chest.z, t) },
    rings,
  };
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// ---------------------------------------------------------------------
//  Монтування сцени
// ---------------------------------------------------------------------
/**
 * mountBody3D(container, { sex, values, selected, labels, onPick, angle })
 * labels: { metricId: {title, value} } — тексти міток біля частин тіла.
 * Повертає { update(values, sex), select(id), setLabels(l), angle(), destroy() }.
 */
export async function mountBody3D(container, opts) {
  const T = await loadThree();
  const canvas = document.createElement('canvas');
  canvas.className = 'b3d-canvas';
  container.appendChild(canvas);
  const overlay = document.createElement('div');
  overlay.className = 'b3d-overlay';
  container.appendChild(overlay);
  const svgNS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(svgNS, 'svg');
  lines.setAttribute('class', 'b3d-lines');
  overlay.appendChild(lines);

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (e) {
    canvas.remove();
    overlay.remove();
    throw e;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(24, 1, 0.1, 20);
  camera.position.set(0, 0.98, 4.6);
  camera.lookAt(0, 0.9, 0);

  const accent = new T.Color(cssVar('--blue', '#5b9bff'));
  const txt = new T.Color(cssVar('--txt', '#eef1f6'));
  const card = new T.Color(cssVar('--bg-card', '#0d0d10'));
  const skin = txt.clone().lerp(card, 0.42);
  const light = card.getHSL({}).l > 0.5;

  scene.add(new T.HemisphereLight(0xffffff, light ? 0x9a9a9a : 0x202028, light ? 1.4 : 1.15));
  const key = new T.DirectionalLight(0xffffff, light ? 1.5 : 1.9);
  key.position.set(1.6, 2.6, 2.4);
  scene.add(key);
  const rim = new T.DirectionalLight(accent.getHex(), light ? 0.5 : 1.3);
  rim.position.set(-2.2, 1.6, -2.4);
  scene.add(rim);

  const mat = new T.MeshStandardMaterial({ color: skin, roughness: 0.62, metalness: 0.04 });
  const fig = new T.Group();
  scene.add(fig);

  let sex = opts.sex === 'f' ? 'f' : 'm';
  let values = { ...(opts.values || {}) };
  let shape = build(sex, values);

  const parts = {
    torso: makeTube(T, shape.torso, mat),
    neck: makeTube(T, shape.neck, mat),
    armL: makeTube(T, shape.armL, mat),
    armR: makeTube(T, shape.armR, mat),
    legL: makeTube(T, shape.legL, mat),
    legR: makeTube(T, shape.legR, mat),
  };
  parts.torso.userData.metric = 'torso';
  parts.armL.userData.metric = 'biceps';
  parts.armR.userData.metric = 'biceps';
  parts.legL.userData.metric = 'thigh';
  parts.legR.userData.metric = 'thigh';
  Object.values(parts).forEach((m) => fig.add(m));

  const sphere = new T.SphereGeometry(1, 32, 20);
  const head = new T.Mesh(sphere, mat);
  fig.add(head);
  const hands = [new T.Mesh(sphere, mat), new T.Mesh(sphere, mat)];
  const feet = [new T.Mesh(sphere, mat), new T.Mesh(sphere, mat)];
  const bust = [new T.Mesh(sphere, mat), new T.Mesh(sphere, mat)];
  bust.forEach((b) => { b.userData.metric = 'chest'; });
  [...hands, ...feet, ...bust].forEach((m) => fig.add(m));

  // кільця-«сантиметри» в місцях замірів
  const ringGeo = new T.TorusGeometry(1, 0.022, 8, 64);
  const rings = {};
  for (const id of BODY_PARTS) {
    const m = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.3, depthTest: true }));
    m.rotation.x = Math.PI / 2;
    m.scale.set(1, 1, 0.22); // товщина кільця по вертикалі ~5 мм
    const holder = new T.Group();
    holder.add(m);
    fig.add(holder);
    rings[id] = { holder, mesh: m };
  }

  function placeExtras(s) {
    head.position.set(0, s.head.y, 0.008);
    head.scale.set(s.head.r * 0.84, s.head.r * 1.1, s.head.r * 0.96);
    [s.armL, s.armR].forEach((a, i) => {
      const w = a[a.length - 1];
      hands[i].position.set(w.x + (i ? -0.006 : 0.006), w.y - 0.075, w.z + 0.006);
      hands[i].scale.set(0.026, 0.07, 0.036);
    });
    [s.legL, s.legR].forEach((l, i) => {
      const an = l[l.length - 1];
      feet[i].position.set(an.x, 0.035, an.z + 0.055);
      feet[i].scale.set(0.042, 0.034, 0.115);
    });
    bust.forEach((b, i) => {
      b.visible = s.bust > 0;
      if (!b.visible) return;
      const r = s.bust;
      b.position.set((i ? -1 : 1) * s.chest.a * 0.42, 1.25, s.chest.z + s.chest.b - r * 0.95);
      b.scale.set(r * 1.15, r * 0.95, r * 0.75);
    });
    for (const id of BODY_PARTS) {
      const r = s.rings[id];
      const h = rings[id].holder;
      h.position.set(r.x, r.y, r.z);
      h.scale.set(r.a + 0.006, 1, r.b + 0.006);
    }
  }

  function applyShape(s) {
    for (const k of Object.keys(parts)) parts[k].userData.update(s[k]);
    placeExtras(s);
  }
  applyShape(shape);

  // --- мітки з лініями ---
  const LEFT = ['chest', 'waist', 'hips'];
  const labelEls = {};
  let selected = opts.selected || null;
  function makeLabels(l) {
    overlay.querySelectorAll('.b3d-label').forEach((e) => e.remove());
    lines.innerHTML = '';
    for (const id of BODY_PARTS) {
      const info = l[id] || { title: id, value: '—' };
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'b3d-label ' + (LEFT.includes(id) ? 'left' : 'right') + (id === selected ? ' on' : '');
      el.innerHTML = `<span class="b3d-lt"></span><span class="b3d-lv"></span>`;
      el.querySelector('.b3d-lt').textContent = info.title;
      el.querySelector('.b3d-lv').textContent = info.value;
      el.addEventListener('click', (e) => { e.stopPropagation(); opts.onPick && opts.onPick(id); });
      overlay.appendChild(el);
      const ln = document.createElementNS(svgNS, 'path');
      ln.setAttribute('class', 'b3d-ln' + (id === selected ? ' on' : ''));
      lines.appendChild(ln);
      labelEls[id] = { el, ln };
    }
  }
  makeLabels(opts.labels || {});

  let W = 0, H = 0;
  function resize() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // фігура має влазити по висоті й лишати поля для міток з боків
    const fitH = 2.05;
    const fov = 2 * Math.atan(fitH / 2 / camera.position.z) * (180 / Math.PI);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    lines.setAttribute('viewBox', `0 0 ${W} ${H}`);
    lines.setAttribute('width', W);
    lines.setAttribute('height', H);
  }

  const tmp = new T.Vector3();
  function project(x, y, z) {
    tmp.set(x, y, z).applyMatrix4(fig.matrixWorld).project(camera);
    return [(tmp.x * 0.5 + 0.5) * W, (-tmp.y * 0.5 + 0.5) * H, tmp.z];
  }

  function layoutLabels() {
    const slotsY = {};
    for (const id of BODY_PARTS) {
      const r = shape.rings[id];
      const left = LEFT.includes(id);
      // точка кільця, найближча до свого боку екрана
      let best = null;
      for (let j = 0; j < 24; j++) {
        const th = (j / 24) * Math.PI * 2;
        const p = project(r.x + Math.cos(th) * r.a, r.y, r.z + Math.sin(th) * r.b);
        if (!best || (left ? p[0] < best[0] : p[0] > best[0])) best = p;
      }
      slotsY[id] = best;
    }
    // розсунути мітки по вертикалі, щоб не налазили
    for (const side of [LEFT, BODY_PARTS.filter((x) => !LEFT.includes(x))]) {
      const ids = side.slice().sort((a, b) => slotsY[a][1] - slotsY[b][1]);
      let prev = -Infinity;
      for (const id of ids) {
        let y = Math.max(slotsY[id][1], prev + 46);
        slotsY[id].ly = y;
        prev = y;
      }
    }
    for (const id of BODY_PARTS) {
      const { el, ln } = labelEls[id];
      const [ax, ay] = slotsY[id];
      const ly = slotsY[id].ly;
      const left = LEFT.includes(id);
      el.style.top = `${ly}px`;
      const lw = el.offsetWidth || 70;
      const lx = left ? 8 + lw : W - 8 - lw;
      const mx = left ? lx + 10 : lx - 10;
      ln.setAttribute('d', `M${lx} ${ly} L${mx} ${ly} L${ax} ${ay} m-2.5 0 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0`);
    }
  }

  function render() {
    fig.updateMatrixWorld(true);
    renderer.render(scene, camera);
    layoutLabels();
  }

  // --- вибір частини ---
  function select(id) {
    selected = id;
    for (const k of BODY_PARTS) {
      const on = k === id;
      rings[k].mesh.material.opacity = on ? 1 : 0.28;
      labelEls[k].el.classList.toggle('on', on);
      labelEls[k].ln.classList.toggle('on', on);
    }
    render();
  }

  // --- обертання пальцем ---
  let angle = typeof opts.angle === 'number' ? opts.angle : -0.35;
  let vel = 0;
  let raf = 0;
  let morph = null;
  fig.rotation.y = angle;
  function tick() {
    raf = 0;
    let more = false;
    if (!dragging && Math.abs(vel) > 0.0004) {
      angle += vel;
      vel *= 0.92;
      more = true;
    }
    if (morph) {
      const t = clamp((performance.now() - morph.t0) / 320, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      shape = mixShape(morph.from, morph.to, e);
      applyShape(shape);
      if (t >= 1) { shape = morph.to; morph = null; } else more = true;
    }
    fig.rotation.y = angle;
    render();
    if (more) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }

  let dragging = false, sx0 = 0, sy0 = 0, lastX = 0, moved = 0;
  const ray = new T.Raycaster();
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    sx0 = lastX = e.clientX;
    sy0 = e.clientY;
    vel = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved = Math.max(moved, Math.abs(e.clientX - sx0), Math.abs(e.clientY - sy0));
    const d = dx * 0.012;
    angle += d;
    vel = d;
    fig.rotation.y = angle;
    render();
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    if (moved < 6) { vel = 0; pick(e); } else kick();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const p = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(p, camera);
    const hits = ray.intersectObjects([...Object.values(parts), ...bust], false);
    if (!hits.length) return;
    let id = hits[0].object.userData.metric;
    if (id === 'torso') {
      const y = fig.worldToLocal(hits[0].point.clone()).y;
      id = y > 1.17 ? 'chest' : y > 0.96 ? 'waist' : 'hips';
    }
    if (id && opts.onPick) opts.onPick(id);
  }

  const ro = new ResizeObserver(() => { resize(); render(); });
  ro.observe(container);
  resize();
  select(selected);

  return {
    update(nextValues, nextSex) {
      if (nextSex) sex = nextSex === 'f' ? 'f' : 'm';
      values = { ...values, ...nextValues };
      const to = build(sex, values);
      if (to.sex !== shape.sex) { morph = null; shape = to; applyShape(shape); render(); return; }
      morph = { from: shape, to, t0: performance.now() };
      kick();
      // якщо кадрів анімації немає (фонова вкладка) — одразу кінцева форма
      setTimeout(() => {
        if (morph && morph.to === to) { morph = null; shape = to; applyShape(shape); render(); }
      }, 500);
    },
    select,
    setLabels(l) { makeLabels(l); select(selected); },
    angle: () => angle,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      Object.values(parts).forEach((m) => m.geometry.dispose());
      sphere.dispose();
      ringGeo.dispose();
      mat.dispose();
      renderer.dispose();
      container.innerHTML = '';
    },
  };
}
