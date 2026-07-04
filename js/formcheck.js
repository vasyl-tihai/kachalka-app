// formcheck.js — кути суглобів, підрахунок повторень і перевірка ракурсу.
// Чиста логіка БЕЗ залежності від MediaPipe (легко тестувати окремо).
// Працює з точками BlazePose (33): normalized — для видимості/малювання,
// worldLandmarks (метри) — для кутів (точніше й стійкіше до ракурсу).

// індекси ключових точок BlazePose
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

// рухові патерни: лічильник рахує цикл «розгин → згин → розгин» по куту суглоба.
// open = кут у «розігнутій» фазі (верх), closed = поріг «зігнутої» фази (низ),
// depthGoal = бажана глибина (кут ≤ goal вважається повною амплітудою).
export const PATTERNS = [
  { id: 'squat',  label: 'Присідання', icon: '🦵', joint: 'knee',  open: 165, closed: 110, depthGoal: 100, view: 'side',
    tipDeep: 'Глибина до паралелі 👍', tipShallow: 'Сідай глибше — до паралелі' },
  { id: 'pushup', label: 'Віджимання', icon: '🤸', joint: 'elbow', open: 160, closed: 95,  depthGoal: 95,  view: 'side',
    tipDeep: 'Гарна глибина 👍', tipShallow: 'Опускайся нижче' },
  { id: 'press',  label: 'Жим',        icon: '🏋️', joint: 'elbow', open: 160, closed: 105, depthGoal: 85,  view: 'side',
    tipDeep: 'Повна амплітуда 👍', tipShallow: 'Опускай нижче — до плечей' },
  { id: 'curl',   label: 'Біцепс',     icon: '💪', joint: 'elbow', open: 150, closed: 60,  depthGoal: 55,  view: 'front',
    tipDeep: 'Повне скорочення 👍', tipShallow: 'Дотискай до кінця' },
];
export function patternById(id) {
  return PATTERNS.find((p) => p.id === id) || PATTERNS[0];
}

// підбір патерна за групою м'язів / назвою вправи (евристика)
export function guessPattern(exercise) {
  const m = (exercise && exercise.muscle) || '';
  const n = ((exercise && exercise.name) || '').toLowerCase();
  if (/присід|squat|випад/.test(n) || m === 'legs') return 'squat';
  if (/біцепс|curl|згинан/.test(n)) return 'curl';
  if (/віджим|push|жим лежач|груд/.test(n) || m === 'chest') return 'pushup';
  if (/жим|press|плеч|shoulder/.test(n) || m === 'shoulders') return 'press';
  if (m === 'arms') return 'curl';
  return 'squat';
}

// які три точки утворюють кут для суглоба, на заданому боці ('L'|'R')
function jointTriplet(joint, side) {
  const s = side === 'L'
    ? { sh: LM.L_SHOULDER, el: LM.L_ELBOW, wr: LM.L_WRIST, hip: LM.L_HIP, kn: LM.L_KNEE, an: LM.L_ANKLE }
    : { sh: LM.R_SHOULDER, el: LM.R_ELBOW, wr: LM.R_WRIST, hip: LM.R_HIP, kn: LM.R_KNEE, an: LM.R_ANKLE };
  if (joint === 'knee') return [s.hip, s.kn, s.an];
  if (joint === 'elbow') return [s.sh, s.el, s.wr];
  if (joint === 'hip') return [s.sh, s.hip, s.kn];
  return [s.hip, s.kn, s.an];
}

// 3D-кут у точці b між векторами b→a та b→c (точки {x,y,z}); градуси
export function angle3D(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const cb = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const dot = ab[0] * cb[0] + ab[1] * cb[1] + ab[2] * cb[2];
  const m1 = Math.hypot(ab[0], ab[1], ab[2]);
  const m2 = Math.hypot(cb[0], cb[1], cb[2]);
  if (!m1 || !m2) return null;
  let cos = dot / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

// середня видимість набору точок (normalized landmarks мають .visibility 0..1)
function visOf(norm, idxs) {
  let s = 0, n = 0;
  for (const i of idxs) {
    const p = norm[i];
    if (p) { s += p.visibility != null ? p.visibility : 0; n++; }
  }
  return n ? s / n : 0;
}

// обрати бік (L/R) з кращою видимістю суглоба патерна.
// prev + margin дають гістерезис: бік міняється лише коли інший помітно видніший
// (інакше при майже однаковій видимості бік «мерехтів» би кадр-у-кадр).
export function pickSide(norm, joint, prev, margin = 0.12) {
  const l = visOf(norm, jointTriplet(joint, 'L'));
  const r = visOf(norm, jointTriplet(joint, 'R'));
  if (prev === 'L') return r > l + margin ? 'R' : 'L';
  if (prev === 'R') return l > r + margin ? 'L' : 'R';
  return l >= r ? 'L' : 'R';
}

// поточний кут суглоба + перевірка, чи достатньо видно точки.
// world = worldLandmarks (метри), norm = normalized landmarks (для видимості).
// opts.lockSide — зафіксувати бік (під час повторення), opts.prevSide — для гістерезису.
export function readJoint(world, norm, pattern, opts = {}) {
  const side = opts.lockSide === 'L' || opts.lockSide === 'R'
    ? opts.lockSide
    : pickSide(norm, pattern.joint, opts.prevSide);
  const tri = jointTriplet(pattern.joint, side);
  const v = visOf(norm, tri);
  if (v < 0.5 || !world[tri[0]] || !world[tri[1]] || !world[tri[2]]) {
    return { ok: false, side, visibility: v, angle: null };
  }
  const ang = angle3D(world[tri[0]], world[tri[1]], world[tri[2]]);
  return { ok: ang != null, side, visibility: v, angle: ang, triplet: tri };
}

// лічильник повторень: цикл open(розгин) → closed(згин) → open
export class RepCounter {
  constructor(pattern) {
    this.p = pattern;
    this.reset();
  }
  reset() {
    this.reps = 0;
    this.state = 'open';
    this.primed = false; // зарахуємо повторення лише після того, як хоч раз побачили «розгин» (верх)
    this.minInRep = 180;
    this.lastDepth = null;
    this.lastGood = null;
  }
  // повертає { rep:true, depth, good } коли завершено повторення, інакше null
  push(angle) {
    if (angle == null) return null;
    const p = this.p;
    if (this.state === 'open') {
      if (angle > p.open) this.primed = true; // користувач у верхній (розігнутій) позиції
      // у «згин» переходимо лише якщо вже були нагорі — інакше старт із низу дав би фантомне повторення
      if (this.primed && angle < p.closed) { this.state = 'closed'; this.minInRep = angle; }
    } else {
      if (angle < this.minInRep) this.minInRep = angle;
      if (angle > p.open) {
        const depth = this.minInRep;
        const good = depth <= p.depthGoal;
        this.reps++;
        this.state = 'open';
        this.lastDepth = depth;
        this.lastGood = good;
        this.minInRep = 180;
        return { rep: true, depth, good };
      }
    }
    return null;
  }
}
