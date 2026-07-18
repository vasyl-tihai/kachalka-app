// exicons.js — анімовані іконки вправ.
// Плавний рух: кожна частина фігурки морфиться між позами A і B через SMIL
// (<animate> на points/cx/cy) з ease-in-out і короткою «фіксацією» у верхній
// точці — виглядає як живе повторення. Без бібліотек і ліцензій, працює офлайн.

// поважаємо системне «менше руху»: тоді іконки статичні (поза A)
const REDUCED =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// таймінг циклу: A → (ease) → B → пауза → (ease) → A
const EASE =
  'calcMode="spline" keyTimes="0;0.42;0.58;1" keySplines="0.45 0 0.55 1;0 0 1 1;0.45 0 0.55 1"';
const animAttr = (name, a, b, dur) =>
  a === b ? '' : `<animate attributeName="${name}" values="${a};${b};${b};${a}" dur="${dur}" repeatCount="indefinite" ${EASE}/>`;

// --- примітиви (класи: b — тіло, bf — голова, w/wf — вага, f — фон) ---
// статична полілінія / коло
const PL = (pts, cls = 'b') => `<polyline class="${cls}" points="${pts}"/>`;
const C = (x, y, r, cls = 'bf') => `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`;
// анімовані: пливуть між позами A і B (кількість точок МАЄ збігатися)
const APL = (a, b, cls, dur) => `<polyline class="${cls}" points="${a}">${animAttr('points', a, b, dur)}</polyline>`;
const AC = (ax, ay, bx, by, r, cls, dur) =>
  `<circle class="${cls}" cx="${ax}" cy="${ay}" r="${r}">${animAttr('cx', ax, bx, dur)}${animAttr('cy', ay, by, dur)}</circle>`;

// --- набір іконок: dur — тривалість «повторення», parts — збірка сцени ---
const ICONS = {
  // присідання зі штангою на плечах (вид спереду)
  squat: {
    dur: '1.8s',
    parts: (d) =>
      AC(24, 8, 24, 17, 3.2, 'bf', d) +
      APL('24,12 24,25', '24,21 24,31', 'b', d) +
      APL('9,15 39,15', '9,24 39,24', 'w', d) +
      AC(9, 15, 9, 24, 2.6, 'wf', d) + AC(39, 15, 39, 24, 2.6, 'wf', d) +
      APL('24,17 17,15', '24,26 17,24', 'b', d) +
      APL('24,17 31,15', '24,26 31,24', 'b', d) +
      APL('24,25 21.5,32 19,39', '24,31 16,33 20,40', 'b', d) +
      APL('24,25 26.5,32 29,39', '24,31 32,33 28,40', 'b', d),
  },
  // жим лежачи (вид збоку): лава, рука вижимає вагу
  bench: {
    dur: '1.5s',
    parts: (d) =>
      PL('10,33 38,33', 'f') + PL('14,33 14,39', 'f') + PL('34,33 34,39', 'f') +
      C(12, 29, 3) + PL('16,30 33,30') + PL('33,30 37,34 37,39') +
      APL('22,30 22,24', '22,30 22,18', 'b', d) +
      AC(22, 21, 22, 15, 3.4, 'wf', d),
  },
  // тяга в нахилі (вид збоку): корпус нахилений, рука тягне гантель
  row: {
    dur: '1.4s',
    parts: (d) =>
      PL('15,39 17,29') + PL('17,29 29,21') + C(33, 19, 3) +
      APL('27,22 27,33', '27,22 27,26', 'b', d) +
      AC(27, 36, 27, 29, 3.2, 'wf', d),
  },
  // станова тяга: нахил зі штангою на землі → випрямлення
  deadlift: {
    dur: '2s',
    parts: (d) =>
      APL('18,39 18,29', '20,39 20,27', 'b', d) +
      APL('18,29 28,21', '20,27 20,15', 'b', d) +
      AC(32, 19, 20, 11, 3, 'bf', d) +
      APL('26,22 26,34', '20,17 27,28', 'b', d) +
      APL('18,36 34,36', '19,29 35,29', 'w', d) +
      AC(18, 36, 19, 29, 2.6, 'wf', d) + AC(34, 36, 35, 29, 2.6, 'wf', d),
  },
  // згинання на біцепс (вид збоку): передпліччя з гантелею вгору-вниз
  curl: {
    dur: '1.3s',
    parts: (d) =>
      PL('22,39 22,28') + PL('22,28 22,15') + C(22, 10.5, 3.2) +
      PL('22,18 28,23') +
      APL('28,23 31,31', '28,23 30,15', 'b', d) +
      AC(31.8, 33, 30.4, 12.8, 3, 'wf', d),
  },
  // прес (скручування): корпус піднімається з підлоги
  abs: {
    dur: '1.6s',
    parts: (d) =>
      PL('8,39 40,39', 'f') +
      APL('13,37 27,37', '17,27 27,37', 'b', d) +
      AC(10.5, 35, 15, 24.5, 3, 'bf', d) +
      PL('27,37 32,29 37,37'),
  },
  // жим стоячи: штанга від плечей вгору над головою
  ohp: {
    dur: '1.6s',
    parts: (d) =>
      C(24, 9, 3.2) + PL('24,13 24,27') +
      PL('24,27 20,39') + PL('24,27 28,39') +
      APL('13,16 35,16', '13,5 35,5', 'w', d) +
      AC(13, 16, 13, 5, 2.4, 'wf', d) + AC(35, 16, 35, 5, 2.4, 'wf', d) +
      APL('24,15 17,16', '24,13 18,6', 'b', d) +
      APL('24,15 31,16', '24,13 30,6', 'b', d),
  },
  // підтягування: вис → підборіддя над перекладиною
  pullup: {
    dur: '1.8s',
    parts: (d) =>
      PL('12,7 36,7', 'w') +
      APL('18,7 21,16', '18,7 21,10', 'b', d) +
      APL('30,7 27,16', '30,7 27,10', 'b', d) +
      AC(24, 12.5, 24, 6.5, 3, 'bf', d) +
      APL('24,16 24,28', '24,10 24,22', 'b', d) +
      APL('24,28 22.5,33 21,38', '24,22 20,28 22,34', 'b', d) +
      APL('24,28 25.5,33 27,38', '24,22 28,28 26,34', 'b', d),
  },
  // запасна: гантель «пульсує» вгору-вниз
  generic: {
    dur: '1.5s',
    parts: (d) =>
      APL('16,30 32,30', '16,23 32,21', 'w', d) +
      AC(16, 30, 16, 23, 4, 'wf', d) + AC(32, 30, 32, 21, 4, 'wf', d),
  },
};

// --- підбір іконки за назвою вправи (укр/англ), далі — за групою м'язів ---
const NAME_RULES = [
  [/станов|deadlift|румун/i, 'deadlift'],
  [/присід|squat|випад|lunge/i, 'squat'],
  [/підтяг|pull.?up/i, 'pullup'],
  [/жим.*(леж|bench)|bench/i, 'bench'],
  [/віджим|push.?up/i, 'bench'],
  [/жим|press/i, 'ohp'],
  [/біцепс|згинан|curl/i, 'curl'],
  [/прес|скруч|crunch|планк|plank|abs/i, 'abs'],
  [/тяга|row/i, 'row'],
];
const MUSCLE_FALLBACK = {
  legs: 'squat',
  back: 'row',
  chest: 'bench',
  shoulders: 'ohp',
  arms: 'curl',
  core: 'abs',
};

function guessIcon(ex) {
  const name = String((ex && ex.name) || '');
  for (const [re, id] of NAME_RULES) if (re.test(name)) return id;
  return MUSCLE_FALLBACK[ex && ex.muscle] || null; // full/other → емодзі користувача
}

/** Анімована SVG-іконка вправи або null (тоді показуємо емодзі вправи). */
export function exIconHTML(ex) {
  const id = guessIcon(ex);
  if (!id) return null;
  const ic = ICONS[id];
  let inner = ic.parts(ic.dur);
  if (REDUCED) inner = inner.replace(/<animate[^>]*\/>/g, ''); // статична поза A
  return `<svg class="ai ai-${id}" viewBox="0 0 48 48" aria-hidden="true">${inner}</svg>`;
}
