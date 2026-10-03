// body3d.js — 3D-фігура людини для екрана замірів.
// Модель: Quaternius «Universal Base Characters» (CC0), руки опущені в A-позу й збережені
// в models/body/{m,f}.bin скриптом Blender (позиції + регіон кожної вершини + ваги рук/ніг).
// Обхвати міняють форму так: кінцівки — радіально від осі кістки, тулуб — від осі тіла
// поясами по висоті. Базовий обхват моделі міряється «стрічкою» (опукла оболонка зрізу),
// тож 40 см на біцепсі — це справді 40 см на моделі.
// Three.js і модель підвантажуються лише на цьому екрані.

let THREE = null;
async function loadThree() {
  if (!THREE) THREE = await import('../vendor/three/three.module.min.js');
  return THREE;
}

// середні значення: ними фігура підганяється, поки своїх замірів немає
export const BODY_BASE = {
  m: { neck: 39, shoulders: 118, chest: 100, waist: 84, belly: 88, hips: 98, biceps: 33, forearm: 28, wrist: 17, thigh: 56, calf: 37, ankle: 23, bodyWeight: 78, bodyFat: 18 },
  f: { neck: 33, shoulders: 102, chest: 90, waist: 70, belly: 80, hips: 98, biceps: 27, forearm: 24, wrist: 15, thigh: 56, calf: 35, ankle: 21, bodyWeight: 62, bodyFat: 26 },
};

// заміри, що мають місце на фігурі (решта — кнопками під нею)
export const BODY_PARTS = ['neck', 'shoulders', 'chest', 'waist', 'belly', 'hips', 'biceps', 'forearm', 'wrist', 'thigh', 'calf', 'ankle'];
const LEFT = ['neck', 'shoulders', 'chest', 'waist', 'belly', 'hips'];
const ARM_IDS = ['biceps', 'forearm', 'wrist'];
const LEG_IDS = ['thigh', 'calf', 'ankle'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------
//  Завантаження й розбір моделі
// ---------------------------------------------------------------------
const MODELS = {};
async function loadModel(sex) {
  if (MODELS[sex]) return MODELS[sex];
  const dir = new URL('../models/body/', import.meta.url);
  const [meta, buf] = await Promise.all([
    fetch(new URL(sex + '.json', dir)).then((r) => r.json()),
    fetch(new URL(sex + '.bin', dir)).then((r) => r.arrayBuffer()),
  ]);
  const n = meta.vertices;
  const L = meta.layout;
  const pos = new Float32Array(buf, L.pos, n * 3);
  const uv = new Float32Array(buf, L.uv, n * 2);
  const reg = new Uint8Array(buf, L.region, n);
  const armw = new Uint8Array(buf, L.armw, n);
  const legw = new Uint8Array(buf, L.legw, n);
  const idx = meta.index === 'H' ? new Uint16Array(buf, L.index, meta.triangles * 3) : new Uint32Array(buf, L.index, meta.triangles * 3);
  const model = prepare(meta, pos, reg, armw, legw, idx);
  model.uv = uv;
  model.twins = twins(pos, n);
  // карта нормалей з рельєфом м'язів (з того ж набору Quaternius)
  model.normalMap = await new Promise((res) => {
    new THREE.TextureLoader().load(new URL(sex + '_normal.webp', dir).href, res, undefined, () => res(null));
  });
  MODELS[sex] = model;
  return model;
}

// вершини-двійники на швах UV (та сама точка) — їм треба однакова нормаль, інакше видно шов
function twins(pos, n) {
  const map = new Map();
  const groups = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    const g = map.get(k);
    if (g) g.push(i); else map.set(k, [i]);
  }
  for (const g of map.values()) if (g.length > 1) groups.push(g);
  return groups;
}
function weldNormals(geo, groups) {
  const nr = geo.attributes.normal.array;
  for (const g of groups) {
    let x = 0, y = 0, z = 0;
    for (const i of g) { x += nr[i * 3]; y += nr[i * 3 + 1]; z += nr[i * 3 + 2]; }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of g) { nr[i * 3] = x / l; nr[i * 3 + 1] = y / l; nr[i * 3 + 2] = z / l; }
  }
  geo.attributes.normal.needsUpdate = true;
}

// опукла оболонка (монотонний ланцюг) → [індекси вершин оболонки, периметр]
function hull(pts) {
  if (pts.length < 3) return [pts.map((p) => p[2]), 0];
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let per = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return [h.map((p) => p[2]), per];
}

function prepare(meta, pos, reg, armw, legw, idx) {
  const n = meta.vertices;
  const B = meta.bones;
  const bh = (k) => B[k].h, bt = (k) => B[k].t;

  // ланцюги кінцівок: точки осі, довжини, параметр s (м від початку)
  const chain = (pts) => {
    const segs = [];
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const L = Math.hypot(d[0], d[1], d[2]) || 1e-6;
      segs.push({ a, d: [d[0] / L, d[1] / L, d[2] / L], L, s0: s });
      s += L;
    }
    return { segs, len: s };
  };
  const chains = {
    armL: chain([bh('upperarm_l'), bh('lowerarm_l'), bh('hand_l'), bt('middle_04_leaf_l')]),
    armR: chain([bh('upperarm_r'), bh('lowerarm_r'), bh('hand_r'), bt('middle_04_leaf_r')]),
    legL: chain([bh('thigh_l'), bh('calf_l'), bh('foot_l'), bt('ball_leaf_l')]),
    legR: chain([bh('thigh_r'), bh('calf_r'), bh('foot_r'), bt('ball_leaf_r')]),
  };
  const sideNames = [null, 'armL', 'armR', 'legL', 'legR'];

  // для кожної вершини — проєкція на вісь своєї кінцівки
  const side = new Uint8Array(n);
  const ls = new Float32Array(n);
  const lp = new Float32Array(n * 3);
  const wA = new Float32Array(n), wL = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    wA[i] = armw[i] / 255;
    wL[i] = legw[i] / 255;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let sd = 0;
    if (wA[i] > 0.01) sd = x >= 0 ? 1 : 2;
    else if (wL[i] > 0.01) sd = x >= 0 ? 3 : 4;
    side[i] = sd;
    if (!sd) continue;
    const ch = chains[sideNames[sd]];
    let best = Infinity, bs = 0, bp = null;
    for (const g of ch.segs) {
      const t = clamp((x - g.a[0]) * g.d[0] + (y - g.a[1]) * g.d[1] + (z - g.a[2]) * g.d[2], 0, g.L);
      const p = [g.a[0] + g.d[0] * t, g.a[1] + g.d[1] * t, g.a[2] + g.d[2] * t];
      const dd = (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2;
      if (dd < best) { best = dd; bs = g.s0 + t; bp = p; }
    }
    ls[i] = bs;
    lp[i * 3] = bp[0]; lp[i * 3 + 1] = bp[1]; lp[i * 3 + 2] = bp[2];
  }

  // вісь тулуба: середня глибина (z) по висоті
  const yMax = meta.height + 0.05;
  const bins = Math.ceil(yMax / 0.01) + 1;
  const zs = new Float32Array(bins), zc = new Float32Array(bins);
  for (let i = 0; i < n; i++) {
    if (wA[i] > 0.5) continue;
    const b = clamp(Math.round(pos[i * 3 + 1] / 0.01), 0, bins - 1);
    zs[b] += pos[i * 3 + 2]; zc[b] += 1;
  }
  const raw = new Float32Array(bins);
  let last = 0;
  for (let b = 0; b < bins; b++) { if (zc[b]) last = zs[b] / zc[b]; raw[b] = last; }
  // згладити (±8 см), інакше вісь іде сходинками й на тілі з'являються складки
  const zAxis = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    let sum = 0, cnt = 0;
    for (let j = -8; j <= 8; j++) { const q = b + j; if (q >= 0 && q < bins) { sum += raw[q]; cnt++; } }
    zAxis[b] = sum / cnt;
  }
  const vz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const fb = clamp(pos[i * 3 + 1] / 0.01, 0, bins - 1.001);
    const b0 = Math.floor(fb);
    vz[i] = lerp(zAxis[b0], zAxis[b0 + 1], fb - b0);
  }

  // зрізи: пояс тулуба на висоті y / кінцівка на відстані s
  // точний переріз: перетин ребер трикутників із площиною. Точка зрізу = [i, j, t] —
  // між вершинами i та j, тож після деформації кільце рахується з нових позицій
  const cut = (field, v0, keep, to2d) => {
    const pts = [];
    const edge = (i, j) => {
      const fi = field(i), fj = field(j);
      if ((fi - v0) * (fj - v0) >= 0 || !keep(i) || !keep(j)) return;
      const t = (v0 - fi) / (fj - fi);
      const P = [lerp(pos[i * 3], pos[j * 3], t), lerp(pos[i * 3 + 1], pos[j * 3 + 1], t), lerp(pos[i * 3 + 2], pos[j * 3 + 2], t)];
      const q = to2d(P);
      pts.push([q[0], q[1], [i, j, t]]);
    };
    for (let f = 0; f < idx.length; f += 3) {
      const A = idx[f], Bv = idx[f + 1], C = idx[f + 2];
      edge(A, Bv); edge(Bv, C); edge(C, A);
    }
    return hull(pts);
  };
  const bandSlice = (y, withArms) =>
    cut((i) => pos[i * 3 + 1], y, withArms ? () => true : (i) => wA[i] < 0.5, (P) => [P[0], P[2]]);
  const limbSlice = (sd, s) => {
    const ch = chains[sideNames[sd]];
    const g = ch.segs.find((q) => s >= q.s0 && s <= q.s0 + q.L) || ch.segs[ch.segs.length - 1];
    // базис, перпендикулярний до кістки
    const d = g.d;
    let u = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const dot = u[0] * d[0] + u[1] * d[1] + u[2] * d[2];
    u = [u[0] - d[0] * dot, u[1] - d[1] * dot, u[2] - d[2] * dot];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = u.map((c) => c / ul);
    const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const o = [g.a[0] + d[0] * (s - g.s0), g.a[1] + d[1] * (s - g.s0), g.a[2] + d[2] * (s - g.s0)];
    const wt = sd <= 2 ? wA : wL;
    return cut((i) => ls[i], s, (i) => side[i] === sd && wt[i] > 0.5, (P) => {
      const r = [P[0] - o[0], P[1] - o[1], P[2] - o[2]];
      return [r[0] * u[0] + r[1] * u[1] + r[2] * u[2], r[0] * w[0] + r[1] * w[1] + r[2] * w[2]];
    });
  };
  const search = (from, to, steps, fn, pick) => {
    let best = null;
    for (let k = 0; k <= steps; k++) {
      const v = lerp(from, to, k / steps);
      const [h, per] = fn(v);
      if (h.length < 8) continue;
      if (!best || (pick === 'max' ? per > best.per : per < best.per)) best = { v, h, per };
    }
    return best;
  };

  const arm = chains.armL, leg = chains.legL;
  const aU = arm.segs[0].L, aL = arm.segs[1].L;
  const gT = leg.segs[0].L, gC = leg.segs[1].L;
  const pelvisY = bh('pelvis')[1];
  const sp1 = bh('spine_01')[1], sp2t = bt('spine_02')[1];
  const sp3h = bh('spine_03')[1], sp3t = bt('spine_03')[1];
  const neckY = lerp(bh('neck_01')[1], bt('neck_01')[1], 0.6);
  const shY = bh('upperarm_l')[1] - 0.015;

  const M = {};
  const band = (id, y, withArms = false) => { const [h, per] = bandSlice(y, withArms); M[id] = { id, kind: 'band', y, hull: h, base: per }; };
  const bandFound = (id, r) => { M[id] = { id, kind: 'band', y: r.v, hull: r.h, base: r.per }; };
  const limb = (id, sd, r) => { M[id] = { id, kind: 'limb', side: sd, s: r.v, hull: r.h, base: r.per }; };

  band('neck', neckY);
  band('shoulders', shY, true);
  band('chest', lerp(sp3h, sp3t, 0.2));
  bandFound('waist', search(sp1 + 0.02, sp2t, 20, (y) => bandSlice(y), 'min'));
  band('belly', sp1);
  bandFound('hips', search(pelvisY - 0.1, pelvisY - 0.01, 9, (y) => bandSlice(y), 'max'));
  limb('biceps', 1, search(aU * 0.55, aU * 0.56, 1, (s) => limbSlice(1, s), 'max'));
  limb('forearm', 1, search(aU + aL * 0.12, aU + aL * 0.45, 10, (s) => limbSlice(1, s), 'max'));
  limb('wrist', 1, search(aU + aL * 0.86, aU + aL * 0.97, 6, (s) => limbSlice(1, s), 'min'));
  limb('thigh', 3, search(gT * 0.22, gT * 0.4, 8, (s) => limbSlice(3, s), 'max'));
  limb('calf', 3, search(gT + gC * 0.15, gT + gC * 0.45, 10, (s) => limbSlice(3, s), 'max'));
  limb('ankle', 3, search(gT + gC * 0.84, gT + gC * 0.95, 6, (s) => limbSlice(3, s), 'min'));
  // висота заміру стегна — там згасає пояс «обхват стегон» на ногах
  const h0 = M.thigh.hull[0];
  const thighY = Math.min(lerp(pos[h0[0] * 3 + 1], pos[h0[1] * 3 + 1], h0[2]), M.hips.y - 0.06);

  return {
    meta, n, pos, idx, side, ls, lp, wA, wL, vz, M,
    marks: { neckTop: bt('neck_01')[1] + 0.02, thighY, shX: Math.abs(bh('upperarm_l')[0]), aU, aL, gT, gC,
      armLen: arm.len, legLen: leg.len },
  };
}

// ---------------------------------------------------------------------
//  Деформація: заміри (см) → нові позиції вершин
// ---------------------------------------------------------------------
function factors(model, sex, vals) {
  const B = BODY_BASE[sex];
  const k = {};
  for (const id of BODY_PARTS) {
    const v = Number(vals[id]);
    const target = v > 0 ? v : B[id];
    k[id] = clamp(target / 100 / model.M[id].base, 0.55, 1.7);
  }
  return k;
}

// профіль k уздовж осі з контрольних точок [[t, k], …] — плавні переходи
function profile(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, k0] = points[i], [t1, k1] = points[i + 1];
    if (t <= t1) return lerp(k0, k1, smooth((t - t0) / (t1 - t0 || 1)));
  }
  return points[points.length - 1][1];
}

function deform(model, k, out) {
  const { n, pos, side, ls, lp, wA, wL, vz, M, marks } = model;
  // пояси тулуба (знизу вгору); X і Z окремо — плечі міняють лише ширину
  const kx = [[marks.thighY, 1], [M.hips.y, k.hips], [M.belly.y, k.belly], [M.waist.y, k.waist], [M.chest.y, k.chest],
    [M.shoulders.y, k.shoulders], [M.neck.y, k.neck], [marks.neckTop, 1]].sort((a, b) => a[0] - b[0]);
  const kz = [[marks.thighY, 1], [M.hips.y, k.hips], [M.belly.y, k.belly], [M.waist.y, k.waist], [M.chest.y, k.chest],
    [M.neck.y, k.neck], [marks.neckTop, 1]].sort((a, b) => a[0] - b[0]);
  const { aU, aL, gT, gC } = marks;
  const armP = [[0, (1 + k.biceps) / 2], [M.biceps.s, k.biceps], [aU, (k.biceps + k.forearm) / 2], [M.forearm.s, k.forearm],
    [M.wrist.s, k.wrist], [aU + aL + 0.03, (1 + k.wrist) / 2], [marks.armLen, 1]];
  const legP = [[0, 1], [M.thigh.s, k.thigh], [gT, k.thigh * 0.45 + k.calf * 0.55], [M.calf.s, k.calf],
    [M.ankle.s, k.ankle], [gT + gC + 0.04, (1 + k.ankle) / 2], [marks.legLen, 1]];
  // руки відсуваються, щоб ширші плечі/груди в них не врізались
  const tx = Math.max((profile(kx, M.shoulders.y) - 1) * marks.shX, (profile(kx, M.chest.y) - 1) * marks.shX * 0.75, 0);

  for (let i = 0; i < n; i++) {
    let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const sd = side[i];
    if (sd) {
      const arm = sd <= 2;
      const kk = 1 + (profile(arm ? armP : legP, ls[i]) - 1) * (arm ? wA[i] : wL[i]);
      const px = lp[i * 3], py = lp[i * 3 + 1], pz = lp[i * 3 + 2];
      x = px + (x - px) * kk; y = py + (y - py) * kk; z = pz + (z - pz) * kk;
    }
    const f = 1 - wA[i];
    if (f > 0) {
      const yb = pos[i * 3 + 1];
      x *= 1 + (profile(kx, yb) - 1) * f;
      z = vz[i] + (z - vz[i]) * (1 + (profile(kz, yb) - 1) * f);
    }
    if (wA[i] > 0) x += (pos[i * 3] >= 0 ? 1 : -1) * tx * wA[i];
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
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
  let sex = opts.sex === 'f' ? 'f' : 'm';
  let model = await loadModel(sex);

  const canvas = document.createElement('canvas');
  canvas.className = 'b3d-canvas';
  const overlay = document.createElement('div');
  overlay.className = 'b3d-overlay';
  const svgNS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(svgNS, 'svg');
  lines.setAttribute('class', 'b3d-lines');
  overlay.appendChild(lines);

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  container.appendChild(canvas);
  container.appendChild(overlay);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(24, 1, 0.1, 30);
  camera.position.set(0, 0.95, 5);
  camera.lookAt(0, 0.9, 0);

  const accent = new T.Color(cssVar('--blue', '#5b9bff'));
  const txt = new T.Color(cssVar('--txt', '#eef1f6'));
  const card = new T.Color(cssVar('--bg-card', '#0d0d10'));
  const light = card.getHSL({}).l > 0.5;
  const skin = light ? new T.Color('#c9ccd3') : txt.clone().lerp(card, 0.38);

  scene.add(new T.HemisphereLight(0xffffff, light ? 0x8c8c94 : 0x1a1a22, light ? 1.25 : 1.05));
  const key = new T.DirectionalLight(0xffffff, light ? 1.7 : 2.1);
  key.position.set(1.4, 2.4, 2.6);
  scene.add(key);
  const fill = new T.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-2, 1, 1.5);
  scene.add(fill);
  const rim = new T.DirectionalLight(accent.getHex(), light ? 0.4 : 0.7);
  rim.position.set(-2, 1.2, -3.2);
  scene.add(rim);

  const mat = new T.MeshStandardMaterial({ color: skin, roughness: 0.55, metalness: 0.03 });
  // рельєф м'язів: що менше жиру, то чіткіший (без даних — помірний)
  function setRelief() {
    const tex = model.normalMap;
    if (tex) { tex.colorSpace = T.NoColorSpace; tex.anisotropy = 4; }
    if (mat.normalMap !== tex) { mat.normalMap = tex; mat.needsUpdate = true; }
    const fat = Number(values.bodyFat) || BODY_BASE[sex].bodyFat;
    const r = clamp(1.9 - (fat - 8) * 0.065, 0.25, 1.9);
    mat.normalScale.set(r, r);
  }
  const fig = new T.Group();
  scene.add(fig);

  let values = { ...(opts.values || {}) };
  let geo, mesh, outPos;
  let kNow = factors(model, sex, values);
  function buildMesh() {
    if (mesh) { fig.remove(mesh); geo.dispose(); }
    geo = new T.BufferGeometry();
    outPos = new Float32Array(model.n * 3);
    deform(model, kNow, outPos);
    geo.setAttribute('position', new T.BufferAttribute(outPos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(model.uv, 2));
    geo.setIndex(new T.BufferAttribute(model.idx, 1));
    geo.computeVertexNormals();
    weldNormals(geo, model.twins);
    setRelief();
    mesh = new T.Mesh(geo, mat);
    fig.add(mesh);
  }
  buildMesh();

  // кільця-«сантиметри»: лінія через вершини оболонки зрізу, трохи над шкірою
  const ringMat = {};
  const rings = {};
  function ringPoints(id) {
    const m = model.M[id];
    const pts = m.hull.map(([i, j, t]) => new T.Vector3(
      lerp(outPos[i * 3], outPos[j * 3], t), lerp(outPos[i * 3 + 1], outPos[j * 3 + 1], t), lerp(outPos[i * 3 + 2], outPos[j * 3 + 2], t)));
    const c = pts.reduce((a, p) => a.add(p), new T.Vector3()).divideScalar(pts.length || 1);
    pts.forEach((p) => p.sub(c).multiplyScalar(1.03).add(c));
    return pts;
  }
  function buildRings() {
    for (const id of BODY_PARTS) {
      if (rings[id]) { fig.remove(rings[id]); rings[id].geometry.dispose(); delete rings[id]; }
      const pts = ringPoints(id);
      if (pts.length < 3) continue;
      const curve = new T.CatmullRomCurve3(pts, true, 'centripetal');
      const g = new T.TubeGeometry(curve, 72, 0.0028, 6, true);
      if (!ringMat[id]) ringMat[id] = new T.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.3 });
      rings[id] = new T.Mesh(g, ringMat[id]);
      fig.add(rings[id]);
    }
  }
  buildRings();

  // --- мітки з лініями ---
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
      el.innerHTML = '<span class="b3d-lt"></span><span class="b3d-lv"></span>';
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
    const fitH = 2.02; // скільки метрів по висоті влазить у кадр
    camera.fov = 2 * Math.atan(fitH / 2 / camera.position.z) * (180 / Math.PI);
    camera.updateProjectionMatrix();
    lines.setAttribute('viewBox', `0 0 ${W} ${H}`);
    lines.setAttribute('width', W);
    lines.setAttribute('height', H);
  }

  const tmp = new T.Vector3();
  function project(v) {
    tmp.copy(v).applyMatrix4(fig.matrixWorld).project(camera);
    return [(tmp.x * 0.5 + 0.5) * W, (-tmp.y * 0.5 + 0.5) * H];
  }
  function layoutLabels() {
    const at = {};
    for (const id of BODY_PARTS) {
      const left = LEFT.includes(id);
      let best = null;
      for (const p of ringPoints(id)) {
        const q = project(p);
        if (!best || (left ? q[0] < best[0] : q[0] > best[0])) best = q;
      }
      at[id] = best || [W / 2, H / 2];
    }
    const gap = 56; // мітки ~40 px заввишки + проміжок
    for (const ids of [LEFT, BODY_PARTS.filter((x) => !LEFT.includes(x))]) {
      const order = ids.slice().sort((a, b) => at[a][1] - at[b][1]);
      let prev = -Infinity;
      for (const id of order) { at[id].ly = Math.max(at[id][1], prev + gap, 24); prev = at[id].ly; }
      // якщо низ вилазить за край — підтягнути колонку вгору
      const over = prev - (H - 24);
      if (over > 0) order.forEach((id) => { at[id].ly -= over; });
    }
    for (const id of BODY_PARTS) {
      const { el, ln } = labelEls[id];
      const [ax, ay] = at[id];
      const ly = at[id].ly;
      const left = LEFT.includes(id);
      el.style.top = `${ly}px`;
      const lw = el.offsetWidth || 64;
      const lx = left ? 6 + lw : W - 6 - lw;
      const mx = left ? lx + 8 : lx - 8;
      ln.setAttribute('d', `M${lx} ${ly} L${mx} ${ly} L${ax} ${ay} m-2.5 0 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0`);
    }
  }

  function render() {
    fig.updateMatrixWorld(true);
    renderer.render(scene, camera);
    layoutLabels();
  }

  function select(id) {
    selected = id;
    for (const k of BODY_PARTS) {
      const on = k === id;
      if (ringMat[k]) ringMat[k].opacity = on ? 1 : 0.3;
      labelEls[k].el.classList.toggle('on', on);
      labelEls[k].ln.classList.toggle('on', on);
    }
    render();
  }

  // --- обертання пальцем, плавна зміна форми ---
  let angle = typeof opts.angle === 'number' ? opts.angle : -0.3;
  let vel = 0, raf = 0, morph = null;
  fig.rotation.y = angle;

  function applyK(k) {
    kNow = k;
    deform(model, kNow, outPos);
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    weldNormals(geo, model.twins);
    geo.computeBoundingSphere();
    buildRings();
    select(selected);
  }
  function tick() {
    raf = 0;
    let more = false;
    if (!dragging && Math.abs(vel) > 0.0004) { angle += vel; vel *= 0.92; more = true; }
    fig.rotation.y = angle;
    if (morph) {
      const t = clamp((performance.now() - morph.t0) / 320, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const k = {};
      for (const id of BODY_PARTS) k[id] = lerp(morph.from[id], morph.to[id], e);
      if (t >= 1) morph = null; else more = true;
      applyK(k);
    } else render();
    if (more) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }

  let dragging = false, sx0 = 0, sy0 = 0, lastX = 0, moved = 0;
  const ray = new T.Raycaster();
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0; vel = 0;
    sx0 = lastX = e.clientX; sy0 = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved = Math.max(moved, Math.abs(e.clientX - sx0), Math.abs(e.clientY - sy0));
    const d = dx * 0.012;
    angle += d; vel = d;
    fig.rotation.y = angle;
    render();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (moved < 6) { vel = 0; pick(e); } else kick();
  });
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  // тап по тілу → найближчий замір того ж регіону
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const p = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(p, camera);
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit) return;
    const vi = hit.face.a;
    const sd = model.side[vi];
    const M = model.M;
    let id;
    if (sd && (sd <= 2 ? model.wA[vi] : model.wL[vi]) > 0.5) {
      const ids = sd <= 2 ? ARM_IDS : LEG_IDS;
      id = ids.reduce((a, b) => (Math.abs(M[b].s - model.ls[vi]) < Math.abs(M[a].s - model.ls[vi]) ? b : a));
    } else {
      const y = model.pos[vi * 3 + 1];
      id = LEFT.reduce((a, b) => (Math.abs(M[b].y - y) < Math.abs(M[a].y - y) ? b : a));
    }
    if (opts.onPick) opts.onPick(id);
  }

  const ro = new ResizeObserver(() => { resize(); render(); });
  ro.observe(container);
  resize();
  select(selected);

  return {
    async update(nextValues, nextSex) {
      values = { ...values, ...nextValues };
      if (nextSex && (nextSex === 'f' ? 'f' : 'm') !== sex) {
        sex = nextSex === 'f' ? 'f' : 'm';
        model = await loadModel(sex);
        morph = null;
        kNow = factors(model, sex, values);
        buildMesh();
        buildRings();
        select(selected);
        return;
      }
      setRelief();
      const to = factors(model, sex, values);
      morph = { from: { ...kNow }, to, t0: performance.now() };
      kick();
      // без кадрів анімації (фонова вкладка) — одразу кінцева форма
      setTimeout(() => { if (morph && morph.to === to) { morph = null; applyK(to); } }, 500);
    },
    select,
    setLabels(l) { makeLabels(l); select(selected); },
    angle: () => angle,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      if (geo) geo.dispose();
      Object.values(rings).forEach((m) => m.geometry.dispose());
      Object.values(ringMat).forEach((m) => m.dispose());
      mat.dispose();
      renderer.dispose();
      container.innerHTML = '';
    },
  };
}

