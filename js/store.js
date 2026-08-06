// store.js — локальне сховище даних (localStorage) + стан додатку
// Уся інформація зберігається на пристрої, працює офлайн.
import { dateNames } from './i18n.js';

const KEY = 'kachalka.v2';

// ----- допоміжні функції дат (локальний час, без UTC-зсувів) -----
export function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function todayISO() {
  return dateToISO(new Date());
}
export function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function prettyDate(iso) {
  const d = isoToDate(iso);
  const names = dateNames(); // назви днів/місяців поточною мовою
  return `${names.dows[d.getDay()]}, ${d.getDate()} ${names.monthsShort[d.getMonth()]}`;
}

const uid = () =>
  (crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));

// ----- типи ваги -----
export const WEIGHT_TYPES = [
  { id: 'dumbbell', label: 'Гантель', icon: '🏋️' },
  { id: 'barbell', label: 'Штанга', icon: '🏋️‍♂️' },
  { id: 'kettlebell', label: 'Гиря', icon: '🔔' },
  { id: 'bodyweight', label: 'Вага тіла', icon: '🤸' },
];

// ----- групи м'язів (для аналітики за групами) -----
export const MUSCLE_GROUPS = [
  { id: 'legs', label: 'Ноги' },
  { id: 'back', label: 'Спина' },
  { id: 'chest', label: 'Груди' },
  { id: 'shoulders', label: 'Плечі' },
  { id: 'arms', label: 'Руки' },
  { id: 'core', label: 'Прес' },
  { id: 'full', label: 'Все тіло' },
  { id: 'other', label: 'Інше' },
];
export function muscleLabel(id) {
  const g = MUSCLE_GROUPS.find((x) => x.id === id);
  return g ? g.label : 'Інше';
}

// ----- метрики замірів тіла -----
export const BODY_METRICS = [
  { id: 'bodyWeight', label: 'Вага тіла', unit: 'кг' },
  { id: 'chest', label: 'Груди', unit: 'см' },
  { id: 'waist', label: 'Талія', unit: 'см' },
  { id: 'hips', label: 'Стегна', unit: 'см' },
  { id: 'biceps', label: 'Біцепс', unit: 'см' },
  { id: 'thigh', label: 'Стегно', unit: 'см' },
  { id: 'bodyFat', label: 'Жир', unit: '%' },
];

// ----- оцінка 1ПМ (одноповторного максимуму), формула Бжицького -----
export function estimate1RM(weight, reps) {
  weight = Number(weight) || 0;
  reps = Number(reps) || 0;
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  const r = Math.min(reps, 12); // понад ~12 повт. формула неточна
  return weight / (1.0278 - 0.0278 * r);
}

// ----- цілочисельний номер дня / тижня (для серій і періодів) -----
function dayNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function weekIndex(iso) {
  // індекс тижня (понеділок — перший день)
  const [y, m, d] = iso.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = понеділок
  return Math.floor((dayNum(iso) - dow) / 7);
}

// ----- стартові вправи (з фото щоденника) -----
function seedExercises() {
  const base = [
    { name: 'Присідання із вагою', icon: '🦵', weightType: 'barbell', weight: 30, targetSets: 4, targetReps: 12, muscle: 'legs' },
    { name: 'Тяга гантель в нахилі', icon: '🪨', weightType: 'dumbbell', weight: 12, targetSets: 4, targetReps: 12, muscle: 'back' },
    { name: 'Жим гантель лежачи', icon: '💪', weightType: 'dumbbell', weight: 14, targetSets: 4, targetReps: 12, muscle: 'chest' },
    { name: 'Згинання гантель на біцепс', icon: '💪', weightType: 'dumbbell', weight: 9, targetSets: 4, targetReps: 16, muscle: 'arms' },
    { name: 'Прес', icon: '🔥', weightType: 'bodyweight', weight: 0, targetSets: 3, targetReps: 20, muscle: 'core' },
    { name: 'Станова тяга', icon: '🏋️‍♂️', weightType: 'barbell', weight: 30, targetSets: 4, targetReps: 10, muscle: 'back' },
  ];
  return base.map((e, i) => ({ id: uid(), order: i, archived: false, ...e }));
}

function defaultState() {
  const ex = seedExercises();
  return {
    exercises: ex, // бібліотека вправ (спільна для всіх тренувань)
    workouts: [{ id: uid(), name: 'Моє тренування', items: ex.map((e) => e.id), order: 0 }],
    entries: {}, // { 'YYYY-MM-DD': { exerciseId: entry } }
    dayStacks: {}, // { 'YYYY-MM-DD': [workoutId] } — тренування, призначені на конкретну дату
    schedule: {}, // { '0'..'6' (день тижня, 0=Нд): [workoutId] } — тижневий план
    measurements: {}, // { 'YYYY-MM-DD': { metricId: число } } — заміри тіла
    progression: {}, // { exerciseId: { programId, goal, testMax, level, day, … } } — програми власної ваги
    calories: {}, // { 'YYYY-MM-DD': [ {id, name, kcal, prot, fat, carb} ] } — журнал їжі за фото
    settings: {
      restSeconds: 60,
      restStep: 30,
      lang: 'uk', // мова інтерфейсу
      soundOn: true, // звук у кінці відпочинку
      soundId: 'triple', // яка мелодія ('custom' — свій звук)
      vibrateOn: true, // вібрація
      flashOn: true, // світлова сигналізація (спалах екрана)
      flashColor: '#ff2f2f', // колір спалаху
      customSoundName: '', // назва завантаженого файлу звуку
    },
  };
}

// ----- нормалізація стану (захист від битих/чужих даних) -----
function normalizeExercise(e, i) {
  return {
    id: e && e.id ? e.id : uid(),
    order: e && typeof e.order === 'number' ? e.order : i,
    archived: !!(e && e.archived),
    name: e && e.name != null ? String(e.name) : 'Без назви',
    icon: (e && e.icon) || '💪',
    weightType: (e && e.weightType) || 'dumbbell',
    weight: Number(e && e.weight) || 0,
    targetSets: Number(e && e.targetSets) || 4,
    targetReps: Number(e && e.targetReps) || 10,
    muscle: (e && e.muscle) || 'other',
    // progOn: false — користувач вимкнув програму прогресії для цієї вправи
    // (undefined = авто: увімкнена, якщо вага тіла й назва відома)
    ...(e && e.progOn === false ? { progOn: false } : {}),
  };
}

function normalizeWorkout(w, i, exIds) {
  const items = Array.isArray(w && w.items) ? w.items.filter((id) => exIds.has(id)) : [];
  return {
    id: w && w.id ? w.id : uid(),
    name: w && w.name != null ? String(w.name) : `Тренування ${i + 1}`,
    items,
    order: w && typeof w.order === 'number' ? w.order : i,
    // progId — тренування-програма (вага тіла): відкривається екраном програми
    ...(w && w.progId ? { progId: String(w.progId) } : {}),
  };
}

function normalizeState(raw) {
  const def = defaultState();
  if (!raw || typeof raw !== 'object') return def;
  const s = {
    exercises:
      Array.isArray(raw.exercises) && raw.exercises.length ? raw.exercises.map(normalizeExercise) : def.exercises,
    entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {},
    dayStacks: raw.dayStacks && typeof raw.dayStacks === 'object' ? raw.dayStacks : {},
    // глибоке злиття налаштувань — нові ключі не губляться зі старих копій
    settings: { ...def.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) },
    progression: raw.progression && typeof raw.progression === 'object' ? raw.progression : {},
  };

  // тренування (+ міграція зі старого поля stack)
  const exIds = new Set(s.exercises.map((e) => e.id));
  if (Array.isArray(raw.workouts) && raw.workouts.length) {
    s.workouts = raw.workouts.map((w, i) => normalizeWorkout(w, i, exIds));
  } else {
    const base = Array.isArray(raw.stack) ? raw.stack.filter((id) => exIds.has(id)) : s.exercises.map((e) => e.id);
    s.workouts = [{ id: uid(), name: 'Моє тренування', items: base, order: 0 }];
  }

  // dayStacks зберігає СПИСОК тренувань на день (масив id); міграція зі старого одиночного рядка
  const wIds = new Set(s.workouts.map((w) => w.id));
  const ds = {};
  for (const iso of Object.keys(s.dayStacks)) {
    const v = s.dayStacks[iso];
    let arr = null;
    if (typeof v === 'string' && wIds.has(v)) arr = [v];
    else if (Array.isArray(v)) arr = v.filter((x) => typeof x === 'string' && wIds.has(x));
    if (arr) ds[iso] = arr; // навіть [] — це явний вибір «день без тренувань»
  }
  s.dayStacks = ds;

  // тижневий план: { '0'..'6': [workoutId] }, лише валідні id
  const sch = {};
  if (raw.schedule && typeof raw.schedule === 'object' && !Array.isArray(raw.schedule)) {
    for (const dow of Object.keys(raw.schedule)) {
      if (!/^[0-6]$/.test(dow)) continue;
      const v = raw.schedule[dow];
      if (Array.isArray(v)) sch[dow] = v.filter((x) => typeof x === 'string' && wIds.has(x));
    }
  }
  s.schedule = sch;

  // записи тренувань
  for (const iso of Object.keys(s.entries)) {
    const byEx = s.entries[iso];
    if (!byEx || typeof byEx !== 'object') {
      delete s.entries[iso];
      continue;
    }
    for (const exId of Object.keys(byEx)) {
      const en = byEx[exId];
      if (!en || typeof en !== 'object') {
        delete byEx[exId];
        continue;
      }
      en.weightType = en.weightType || 'dumbbell';
      en.weight = Number(en.weight) || 0;
      en.targetSets = Number(en.targetSets) || 4;
      en.targetReps = Number(en.targetReps) || 10;
      en.sets = Array.isArray(en.sets)
        ? en.sets.map((st) => ({
            reps: st && st.reps != null ? Number(st.reps) : null,
            weight: st && st.weight != null ? Number(st.weight) : en.weight,
            weightType: (st && st.weightType) || en.weightType,
          }))
        : [];
    }
  }
  s.settings.restSeconds = Number(s.settings.restSeconds) || 60;
  s.settings.restStep = Number(s.settings.restStep) || 30;

  // заміри тіла (нове поле — старі копії його не мають)
  const meas = {};
  const rawMeas =
    raw.measurements && typeof raw.measurements === 'object' && !Array.isArray(raw.measurements)
      ? raw.measurements
      : {};
  for (const iso of Object.keys(rawMeas)) {
    const m = rawMeas[iso];
    if (!m || typeof m !== 'object') continue;
    const clean = {};
    for (const k of Object.keys(m)) {
      const raw0 = m[k];
      if (raw0 == null || raw0 === '') continue; // порожнє/null — це «немає значення», а не 0
      const v = Number(raw0);
      if (!Number.isNaN(v)) clean[k] = v;
    }
    if (Object.keys(clean).length) meas[iso] = clean;
  }
  s.measurements = meas;

  // журнал калорій (нове поле — старі копії його не мають)
  const cal = {};
  const rawCal =
    raw.calories && typeof raw.calories === 'object' && !Array.isArray(raw.calories) ? raw.calories : {};
  for (const iso of Object.keys(rawCal)) {
    const list = rawCal[iso];
    if (!Array.isArray(list)) continue;
    const clean = list
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        id: e.id ? String(e.id) : uid(),
        name: String(e.name || '').slice(0, 120),
        kcal: Number(e.kcal) || 0,
        prot: Number(e.prot) || 0,
        fat: Number(e.fat) || 0,
        carb: Number(e.carb) || 0,
      }));
    if (clean.length) cal[iso] = clean;
  }
  s.calories = cal;

  // одноразова міграція: раніше кількість підходів помилково дорівнювала кільк. повторень
  // (напр. 12). Реальні підходи — це 3–5, тож завищені значення (>6) знижуємо до 4.
  if (!s.settings.migratedSets) {
    for (const e of s.exercises) if (e.targetSets > 6) e.targetSets = 4;
    for (const iso of Object.keys(s.entries)) {
      for (const en of Object.values(s.entries[iso])) if (en.targetSets > 6) en.targetSets = 4;
    }
    s.settings.migratedSets = true;
  }

  return s;
}

// ----- завантаження / збереження -----
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    console.warn('Не вдалося прочитати дані, починаємо з чистого', e);
    return defaultState();
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Помилка збереження', e);
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 120);
}
function saveNow() {
  clearTimeout(saveTimer);
  persist();
}
export { saveNow as flush };

// надійно зберегти, коли застосунок згортають/закривають (Android може заморозити вкладку)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', saveNow);
}

// ----- доступ до даних -----
export function getState() {
  return state;
}
export function getSettings() {
  return state.settings;
}
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  save();
}

// ----- калорії (журнал їжі за фото) -----
export function caloriesForDay(iso) {
  return state.calories[iso] || [];
}
export function addCalorieEntry(iso, entry) {
  const list = state.calories[iso] || (state.calories[iso] = []);
  list.push({
    id: uid(),
    name: String(entry.name || '').slice(0, 120),
    kcal: Math.max(0, Math.round(Number(entry.kcal) || 0)),
    prot: Math.max(0, Math.round(Number(entry.prot) || 0)),
    fat: Math.max(0, Math.round(Number(entry.fat) || 0)),
    carb: Math.max(0, Math.round(Number(entry.carb) || 0)),
  });
  save();
}
export function deleteCalorieEntry(iso, id) {
  const list = state.calories[iso];
  if (!list) return;
  state.calories[iso] = list.filter((e) => e.id !== id);
  if (!state.calories[iso].length) delete state.calories[iso];
  save();
}
export function calorieDayTotal(iso) {
  const t = { kcal: 0, prot: 0, fat: 0, carb: 0 };
  for (const e of state.calories[iso] || []) {
    t.kcal += e.kcal; t.prot += e.prot; t.fat += e.fat; t.carb += e.carb;
  }
  return t;
}

// --- свій звук сигналу (dataURL; окремий ключ, щоб не роздувати основні дані) ---
const SOUND_KEY = KEY + '.sound';
export function getCustomSound() {
  try {
    return localStorage.getItem(SOUND_KEY) || null;
  } catch {
    return null;
  }
}
export function setCustomSoundData(dataUrl) {
  try {
    if (dataUrl) localStorage.setItem(SOUND_KEY, dataUrl);
    else localStorage.removeItem(SOUND_KEY);
    return true;
  } catch {
    return false; // не вмістилось у сховище
  }
}

// --- вправи ---
export function getExercises({ includeArchived = false } = {}) {
  const list = state.exercises.filter((e) => includeArchived || !e.archived);
  return list.sort((a, b) => a.order - b.order);
}
export function getExercise(id) {
  return state.exercises.find((e) => e.id === id);
}
export function addExercise(data) {
  const maxOrder = state.exercises.reduce((m, e) => Math.max(m, e.order), -1);
  const ex = {
    id: uid(),
    order: maxOrder + 1,
    archived: false,
    icon: '💪',
    weightType: 'dumbbell',
    weight: 0,
    targetSets: 4,
    targetReps: 10,
    ...data,
  };
  state.exercises.push(ex);
  save();
  return ex;
}
export function updateExercise(id, patch) {
  const ex = getExercise(id);
  if (ex) Object.assign(ex, patch);
  save();
  return ex;
}
export function deleteExercise(id) {
  state.exercises = state.exercises.filter((e) => e.id !== id);
  // прибрати вправу з усіх тренувань
  for (const w of state.workouts) w.items = w.items.filter((x) => x !== id);
  // прибрати осиротілі записи тренувань цієї вправи
  for (const iso of Object.keys(state.entries)) {
    if (state.entries[iso]) {
      delete state.entries[iso][id];
      if (Object.keys(state.entries[iso]).length === 0) delete state.entries[iso];
    }
  }
  saveNow();
}

// --- тренування (іменовані набори вправ) ---
export function getWorkouts() {
  return [...state.workouts].sort((a, b) => a.order - b.order);
}
export function getWorkout(id) {
  return state.workouts.find((w) => w.id === id);
}
export function addWorkout(name) {
  const maxOrder = state.workouts.reduce((m, w) => Math.max(m, w.order), -1);
  const w = {
    id: uid(),
    name: (name && name.trim()) || `Тренування ${state.workouts.length + 1}`,
    items: [],
    order: maxOrder + 1,
  };
  state.workouts.push(w);
  save();
  return w;
}
export function updateWorkout(id, patch) {
  const w = getWorkout(id);
  if (w) Object.assign(w, patch);
  save();
  return w;
}
export function deleteWorkout(id) {
  state.workouts = state.workouts.filter((w) => w.id !== id);
  for (const iso of Object.keys(state.dayStacks)) {
    const v = state.dayStacks[iso];
    if (Array.isArray(v)) {
      const arr = v.filter((x) => x !== id);
      if (arr.length) state.dayStacks[iso] = arr;
      else delete state.dayStacks[iso];
    } else if (v === id) {
      delete state.dayStacks[iso];
    }
  }
  // прибрати з тижневого плану
  for (const dow of Object.keys(state.schedule)) {
    state.schedule[dow] = (state.schedule[dow] || []).filter((x) => x !== id);
  }
  saveNow();
}
export function reorderWorkouts(ids) {
  ids.forEach((id, i) => {
    const w = getWorkout(id);
    if (w) w.order = i;
  });
  save();
}
export function setWorkoutItems(id, itemIds) {
  const w = getWorkout(id);
  if (w) w.items = itemIds.filter((x) => getExercise(x));
  save();
  return w;
}
export function addItemToWorkout(id, exId) {
  const w = getWorkout(id);
  if (w && !w.items.includes(exId)) w.items.push(exId);
  save();
  return w;
}
export function removeItemFromWorkout(id, index) {
  const w = getWorkout(id);
  if (w) w.items.splice(index, 1);
  save();
  return w;
}

// --- тижневий план (день тижня → тренування) ---
export function getSchedule() {
  return state.schedule || {};
}
export function setScheduleDay(dow, ids) {
  if (!state.schedule) state.schedule = {};
  state.schedule[String(dow)] = ids.filter((id) => getWorkout(id));
  save();
}
export function scheduleHasAny() {
  const sch = state.schedule || {};
  return Object.values(sch).some((arr) => Array.isArray(arr) && arr.length > 0);
}

// --- які тренування на конкретний день (кілька) ---
export function getDayWorkoutIds(iso) {
  const v = state.dayStacks[iso];
  if (Array.isArray(v)) return v.filter((id) => getWorkout(id)); // явний вибір для дати (може бути порожнім)
  // далі — тижневий план: якщо він налаштований, беремо тренування дня тижня
  if (scheduleHasAny()) {
    const dow = String(isoToDate(iso).getDay());
    const planned = (state.schedule[dow] || []).filter((id) => getWorkout(id));
    return planned; // порожньо = вихідний за планом
  }
  // плану немає → за замовч. перше ЗВИЧАЙНЕ тренування (програми лише за планом/вибором)
  const list = getWorkouts();
  const first = list.find((w) => !w.progId) || list[0];
  return first ? [first.id] : [];
}
export function setDayWorkouts(iso, ids) {
  state.dayStacks[iso] = ids.filter((id) => getWorkout(id));
  save();
}
export function toggleDayWorkout(iso, workoutId) {
  const cur = getDayWorkoutIds(iso).slice();
  const i = cur.indexOf(workoutId);
  if (i >= 0) cur.splice(i, 1);
  else cur.push(workoutId);
  setDayWorkouts(iso, cur);
  return cur;
}
// згруповано по тренуваннях: [{ workout, items:[exId] }]
export function getDayGroups(iso) {
  return getDayWorkoutIds(iso)
    .map((id) => {
      const w = getWorkout(id);
      return w ? { workout: w, items: w.items.filter((x) => getExercise(x)) } : null;
    })
    .filter(Boolean);
}
// плоский список усіх вправ дня (для сумісності)
export function getDayStack(iso) {
  const seen = new Set();
  const out = [];
  for (const g of getDayGroups(iso)) {
    for (const id of g.items) if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

// --- записи тренувань ---
// entry = { weight, weightType, targetSets, targetReps, sets: [{reps, weight}] }
export function getEntry(iso, exerciseId) {
  return state.entries[iso] && state.entries[iso][exerciseId];
}
// «почати з того, де зупинився»: ціль повторень нового дня — це повторення
// останнього записаного підходу з найближчого попереднього тренування вправи.
// Зробив 6 замість 12 → завтра ціль 6 (не 12).
function carriedTargetReps(exerciseId, iso) {
  let bestIso = null;
  let reps = null;
  for (const [dIso, byEx] of Object.entries(state.entries)) {
    if (dIso >= iso) continue; // лише дні до поточного
    if (bestIso != null && dIso < bestIso) continue;
    const e = byEx[exerciseId];
    if (!e || !Array.isArray(e.sets) || !e.sets.length) continue;
    // останній підхід із зазначеними повтореннями (0/порожні пропускаємо)
    for (let i = e.sets.length - 1; i >= 0; i--) {
      const r = Number(e.sets[i] && e.sets[i].reps) || 0;
      if (r > 0) {
        bestIso = dIso;
        reps = r;
        break;
      }
    }
  }
  return reps;
}
// підходи найближчого попереднього тренування вправи (лише з повтореннями >0) —
// для підказки «минулого разу» і цілей по кожному підходу
export function prevSessionSets(exerciseId, iso) {
  let bestIso = null;
  let sets = null;
  for (const [dIso, byEx] of Object.entries(state.entries)) {
    if (dIso >= iso) continue;
    if (bestIso != null && dIso < bestIso) continue;
    const e = byEx[exerciseId];
    if (!e || !Array.isArray(e.sets) || !e.sets.length) continue;
    const valid = e.sets.filter((s) => (Number(s.reps) || 0) > 0);
    if (!valid.length) continue;
    bestIso = dIso;
    sets = valid;
  }
  return sets; // масив {reps, weight, ...} або null
}

export function ensureEntry(iso, exerciseId) {
  if (!state.entries[iso]) state.entries[iso] = {};
  let entry = state.entries[iso][exerciseId];
  const ex = getExercise(exerciseId) || {};
  if (!entry) {
    entry = {
      weight: ex.weight ?? 0,
      weightType: ex.weightType ?? 'dumbbell',
      targetSets: ex.targetSets ?? 4,
      targetReps: carriedTargetReps(exerciseId, iso) ?? ex.targetReps ?? 10,
      autoGoal: true, // ціль виставлено автоматично (не вручну через редактор)
      sets: [],
    };
    state.entries[iso][exerciseId] = entry;
    save();
  } else if (entry.autoGoal && (!entry.sets || !entry.sets.length)) {
    // запис створили заздалегідь (зазирнули на день наперед) — поки не зроблено
    // жодного підходу, тримаємо авто-ціль свіжою (після того дня могли ще тренуватись)
    const t = carriedTargetReps(exerciseId, iso) ?? ex.targetReps ?? 10;
    if (t !== entry.targetReps) {
      entry.targetReps = t;
      save();
    }
  }
  return entry;
}
export function updateEntry(iso, exerciseId, patch) {
  const entry = ensureEntry(iso, exerciseId);
  Object.assign(entry, patch);
  save();
  return entry;
}
export function addSet(iso, exerciseId, set) {
  const entry = ensureEntry(iso, exerciseId);
  entry.sets.push({
    reps: set.reps ?? null,
    weight: set.weight ?? entry.weight,
    weightType: set.weightType ?? entry.weightType,
    // sec — скільки тривала робота (секундомір підходу); 0/не міряли → null
    sec: Number(set.sec) > 0 ? Math.round(set.sec) : null,
  });
  saveNow(); // запис підходу — критична дія, зберігаємо одразу
  return entry;
}
export function removeSet(iso, exerciseId, index) {
  const entry = getEntry(iso, exerciseId);
  if (entry) {
    entry.sets.splice(index, 1);
    saveNow();
  }
  return entry;
}

// --- обсяг (тоннаж) — як рахують пауерліфтери: Σ(вага × повторення) ---
// за один запис вправи; вага тіла в тоннаж не йде (лише повторення)
export function entryVolume(entry) {
  let tonnage = 0;
  let reps = 0;
  if (!entry || !Array.isArray(entry.sets)) return { tonnage: 0, reps: 0 };
  for (const s of entry.sets) {
    const r = Number(s.reps) || 0;
    if (r <= 0) continue;
    reps += r;
    const bw = (s.weightType || entry.weightType) === 'bodyweight';
    tonnage += bw ? 0 : r * (Number(s.weight) || 0);
  }
  return { tonnage, reps };
}
// сумарний обсяг усього дня
export function dayVolume(iso) {
  let tonnage = 0;
  let reps = 0;
  for (const en of Object.values(state.entries[iso] || {})) {
    const v = entryVolume(en);
    tonnage += v.tonnage;
    reps += v.reps;
  }
  return { tonnage, reps };
}

// --- дні з тренуваннями (для календаря) ---
export function trainedDays() {
  const set = new Set();
  for (const [iso, byEx] of Object.entries(state.entries)) {
    const hasSets = Object.values(byEx).some((e) => e.sets && e.sets.length > 0);
    if (hasSets) set.add(iso);
  }
  return set;
}
export function dayHasTraining(iso) {
  const byEx = state.entries[iso];
  if (!byEx) return false;
  return Object.values(byEx).some((e) => e.sets && e.sets.length > 0);
}

// --- історія по вправі ---
export function exerciseHistory(exerciseId) {
  const rows = [];
  for (const [iso, byEx] of Object.entries(state.entries)) {
    const e = byEx[exerciseId];
    if (e && e.sets && e.sets.length > 0) {
      rows.push({ iso, ...e });
    }
  }
  rows.sort((a, b) => (a.iso < b.iso ? 1 : -1)); // новіші зверху
  return rows;
}

// --- рекорди по вправі (PR) ---
// Найкращі показники по всіх записах. Для ваги тіла рахуємо лише повторення.
export function exerciseBests(exerciseId) {
  const ex = getExercise(exerciseId);
  const exBw = !!(ex && ex.weightType === 'bodyweight');
  let maxWeight = 0, maxReps = 0, max1RM = 0, count = 0;
  const dates = { weight: null, reps: null, orm: null };
  for (const [iso, byEx] of Object.entries(state.entries)) {
    const e = byEx[exerciseId];
    if (!e || !Array.isArray(e.sets)) continue;
    for (const s of e.sets) {
      const w = Number(s.weight) || 0;
      const reps = Number(s.reps) || 0;
      if (reps <= 0) continue;
      count++;
      // тип беремо з самого підходу (на екрані тип можна перемкнути для конкретного запису)
      const setBw = (s.weightType || (ex && ex.weightType)) === 'bodyweight';
      if (reps > maxReps) { maxReps = reps; dates.reps = iso; }
      if (!setBw) {
        if (w > maxWeight) { maxWeight = w; dates.weight = iso; }
        const orm = estimate1RM(w, reps);
        if (orm > max1RM) { max1RM = orm; dates.orm = iso; }
      }
    }
  }
  // для відображення: «вага тіла», якщо вправа така й немає жодного вагового рекорду
  const bodyweight = exBw && maxWeight === 0;
  return { maxWeight, maxReps, max1RM, count, bodyweight, dates };
}

// найкращі підйоми по всіх вправах (для списку рекордів)
export function topLifts() {
  const out = [];
  for (const ex of getExercises({ includeArchived: true })) {
    const b = exerciseBests(ex.id);
    if (b.count > 0) out.push({ ex, ...b });
  }
  // вагові вправи зверху (за 1ПМ), вправи з вагою тіла — за повтореннями (різні одиниці не змішуємо)
  out.sort((a, b) => {
    const aw = a.bodyweight ? 0 : 1;
    const bw = b.bodyweight ? 0 : 1;
    if (aw !== bw) return bw - aw;
    return aw === 1 ? b.max1RM - a.max1RM : b.maxReps - a.maxReps;
  });
  return out;
}

// --- серія тренувань (streak) ---
export function streakStats() {
  const days = [...trainedDays()].sort(); // ISO за зростанням
  if (!days.length) return { current: 0, longest: 0, weeks: 0 };
  let longest = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    if (dayNum(days[i]) - dayNum(days[i - 1]) === 1) { run++; if (run > longest) longest = run; }
    else run = 1;
  }
  // поточна серія днів — якщо останнє тренування сьогодні або вчора
  const todayN = dayNum(todayISO());
  const lastN = dayNum(days[days.length - 1]);
  let current = 0;
  if (todayN - lastN <= 1) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (dayNum(days[i]) - dayNum(days[i - 1]) === 1) current++;
      else break;
    }
  }
  // серія тижнів — послідовні тижні з ≥1 тренуванням
  const weekSet = new Set(days.map(weekIndex));
  const curWeek = weekIndex(todayISO());
  let start = weekSet.has(curWeek) ? curWeek : weekSet.has(curWeek - 1) ? curWeek - 1 : null;
  let weeks = 0;
  if (start != null) {
    let w = start;
    while (weekSet.has(w)) { weeks++; w--; }
  }
  return { current, longest, weeks };
}

// --- обсяг тренувань (тоннаж) за період ---
export function volumeStats(days = 7) {
  const cutoff = dayNum(todayISO()) - (days - 1);
  let tonnage = 0, sets = 0, reps = 0;
  const sessions = new Set();
  for (const [iso, byEx] of Object.entries(state.entries)) {
    if (dayNum(iso) < cutoff) continue;
    for (const [exId, e] of Object.entries(byEx)) {
      if (!e || !Array.isArray(e.sets) || !e.sets.length) continue;
      const exType = (getExercise(exId) || {}).weightType;
      for (const s of e.sets) {
        const r = Number(s.reps) || 0;
        if (r <= 0) continue;
        sets++;
        reps += r;
        const setBw = (s.weightType || exType) === 'bodyweight';
        tonnage += r * (setBw ? 0 : Number(s.weight) || 0);
        sessions.add(iso);
      }
    }
  }
  return { tonnage: Math.round(tonnage), sets, reps, sessions: sessions.size, days };
}

// тоннаж по тижнях (для графіка)
export function weeklyTonnage(weeks = 8) {
  const curWeek = weekIndex(todayISO());
  const buckets = {};
  for (const [iso, byEx] of Object.entries(state.entries)) {
    const wi = weekIndex(iso);
    if (wi < curWeek - (weeks - 1) || wi > curWeek) continue;
    let t = 0;
    for (const [exId, e] of Object.entries(byEx)) {
      if (!e || !Array.isArray(e.sets)) continue;
      const exType = (getExercise(exId) || {}).weightType;
      for (const s of e.sets) {
        const setBw = (s.weightType || exType) === 'bodyweight';
        t += (Number(s.reps) || 0) * (setBw ? 0 : Number(s.weight) || 0);
      }
    }
    buckets[wi] = (buckets[wi] || 0) + t;
  }
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const wi = curWeek - i;
    out.push({ tonnage: Math.round(buckets[wi] || 0) });
  }
  return out;
}

// тоннаж за групами м'язів (за період)
export function muscleTonnage(days = 30) {
  const cutoff = dayNum(todayISO()) - (days - 1);
  const map = {};
  for (const [iso, byEx] of Object.entries(state.entries)) {
    if (dayNum(iso) < cutoff) continue;
    for (const [exId, e] of Object.entries(byEx)) {
      if (!e || !Array.isArray(e.sets)) continue;
      const ex = getExercise(exId);
      if (!ex) continue;
      let t = 0;
      for (const s of e.sets) {
        const setBw = (s.weightType || ex.weightType) === 'bodyweight';
        t += (Number(s.reps) || 0) * (setBw ? 0 : Number(s.weight) || 0);
      }
      const g = ex.muscle || 'other';
      map[g] = (map[g] || 0) + t;
    }
  }
  return MUSCLE_GROUPS.map((g) => ({ ...g, tonnage: Math.round(map[g.id] || 0) }))
    .filter((x) => x.tonnage > 0)
    .sort((a, b) => b.tonnage - a.tonnage);
}

// =====================================================================
//  ПРОГРАМИ ПРОГРЕСІЇ З ВАГОЮ ТІЛА (прес, турнік, віджимання, присідання)
//  Тут немає ваги, тому прогресія — це ОБСЯГ: скільки повторень за заняття.
//  Принципи взяті з класичних програм власної ваги (Steve Speirs
//  «200/300 Sit-Ups», «100 Push-Ups»; армійські Armstrong / Recon Ron
//  для підтягувань):
//   • вхідний тест максимуму за раз задає стартові числа;
//   • рівень = 3 заняття (день 1/2/3), між заняттями день відпочинку;
//   • день = 5 фіксованих підходів + фінальний «максимум, не менше N»;
//   • до відказу — лише останній підхід (запобіжник від перетренування);
//   • обсяг дня росте на ~7% за заняття (≈ +22% за рівень);
//   • кожен 4-й рівень — розгрузка (60% обсягу);
//   • не витягнув день — повторюєш той самий день, а не йдеш далі;
//   • кожні 2 рівні — новий тест максимуму;
//   • стеля — цільова кількість (прес 300, турнік 20, віджимання 100…).
// =====================================================================
export const PROGRAMS = [
  { id: 'abs', label: 'Прес', goal: 300, keys: ['прес', 'скручув', 'abs', 'crunch', 'sit-up', 'situp'] },
  { id: 'pullup', label: 'Підтягування', goal: 20, keys: ['підтягув', 'турнік', 'pull-up', 'pullup', 'chin-up'] },
  { id: 'pushup', label: 'Віджимання', goal: 100, keys: ['віджим', 'push-up', 'pushup'] },
  { id: 'squat', label: 'Присідання', goal: 200, keys: ['присід', 'squat', 'air squat'] },
];

const DAYS_PER_LEVEL = 3; // рівень = 3 заняття
const STEP_GROWTH = 1.07; // +7% обсягу за заняття
const DELOAD_LEVEL = 4; // кожен 4-й рівень — розгрузка
const DELOAD_K = 0.6;
const TEST_EVERY = 2; // ретест максимуму кожні 2 рівні
// частки обсягу для 5 фіксованих підходів; решта (~22%) — фінальний «максимум»
const SET_SHARE = [0.14, 0.18, 0.18, 0.14, 0.14];

/** Чи є для такої НАЗВИ програма прогресії (без огляду на тип ваги). */
export function matchProgram(name) {
  const n = String(name || '').toLowerCase();
  return PROGRAMS.find((p) => p.keys.some((k) => n.includes(k))) || null;
}
/** Програма для вправи: лише вага тіла + відома назва + не вимкнено вручну. */
export function programFor(ex) {
  if (!ex || ex.progOn === false) return null;
  if (ex.weightType !== 'bodyweight') return null;
  return matchProgram(ex.name);
}

/** Обсяг заняття (повторень) для рівня/дня за максимумом із тесту. */
function progDayVolume(testMax, level, day, goal) {
  const step = (level - 1) * DAYS_PER_LEVEL + (day - 1);
  let v = Math.max(1, testMax) * 2 * Math.pow(STEP_GROWTH, step);
  if (level % DELOAD_LEVEL === 0) v *= DELOAD_K; // розгрузочний рівень
  return Math.max(6, Math.min(goal, Math.round(v)));
}

/** Скільки всього рівнів до цілі за поточного максимуму (для «Рівень 3 з 12»). */
function levelsToGoal(testMax, goal) {
  for (let lv = 1; lv <= 60; lv++) {
    if (progDayVolume(testMax, lv, DAYS_PER_LEVEL, goal) >= goal) return lv;
  }
  return 60;
}

/**
 * План заняття: підходи (останній — «максимум, не менше N»), обсяг, відпочинок.
 * @returns {{sets:Array<{reps:number,max:boolean}>, total:number, rest:number,
 *            level:number, day:number, levels:number, goal:number}}
 */
export function progressionPlan({ testMax, level, day, goal }) {
  const v = progDayVolume(testMax, level, day, goal);
  const fixed = SET_SHARE.map((k) => Math.max(1, Math.round(v * k)));
  const restReps = v - fixed.reduce((a, b) => a + b, 0);
  // фінальний підхід не менший за найважчий фіксований — це «максимум»
  const last = Math.max(Math.max(...fixed), restReps);
  const sets = fixed.map((reps) => ({ reps, max: false }));
  sets.push({ reps: last, max: true });
  const total = sets.reduce((a, s) => a + s.reps, 0);
  // відпочинок за обсягом: малі обсяги — 45с, середні — 60с, великі — 90с
  const rest = total < 40 ? 45 : total < 120 ? 60 : 90;
  return { sets, total, rest, level, day, levels: levelsToGoal(testMax, goal), goal };
}

export function progressionState(exerciseId) {
  return (state.progression && state.progression[exerciseId]) || null;
}
/** Запустити програму після вхідного тесту (максимум повторень за раз). */
export function startProgression(exerciseId, testMax, iso) {
  const ex = getExercise(exerciseId);
  const pgm = programFor(ex) || matchProgram(ex && ex.name);
  if (!pgm) return null;
  if (!state.progression) state.progression = {};
  state.progression[exerciseId] = {
    programId: pgm.id,
    goal: pgm.goal,
    testMax: Math.max(1, Math.round(testMax) || 1),
    level: 1,
    day: 1,
    startedISO: iso || todayISO(),
    lastDoneISO: null,
    testedLevel: 1,
    done: false,
  };
  saveNow();
  return state.progression[exerciseId];
}
export function stopProgression(exerciseId) {
  if (state.progression && state.progression[exerciseId]) {
    delete state.progression[exerciseId];
    saveNow();
  }
}
/** Час нового тесту максимуму? (кожні 2 рівні, на початку рівня) */
export function needTest(exerciseId) {
  const p = progressionState(exerciseId);
  if (!p || p.done) return false;
  return p.level > 1 && (p.level - 1) % TEST_EVERY === 0 && p.testedLevel !== p.level;
}
/** Записати результат тесту (максимум не знижуємо — програма не має відкочуватись). */
export function markTested(exerciseId, testMax) {
  const p = progressionState(exerciseId);
  if (!p) return null;
  p.testedLevel = p.level;
  const m = Math.round(testMax) || 0;
  if (m > p.testMax) p.testMax = m;
  saveNow();
  return p;
}
/**
 * Заняття завершено: ok=true → наступний день/рівень, ok=false → повтор дня.
 * За одну дату рухаємось лише раз (перезапис підходів не крутить програму).
 */
export function advanceProgression(exerciseId, iso, ok) {
  const p = progressionState(exerciseId);
  if (!p || p.done) return null;
  if (p.lastDoneISO === iso) return null; // за цю дату вже порухали (додаткові підходи не крутять програму)
  p.lastDoneISO = iso;
  if (!ok) {
    saveNow();
    return { ...p, repeat: true };
  }
  // обсяг цього дня вже на цілі → програму пройдено
  if (progDayVolume(p.testMax, p.level, p.day, p.goal) >= p.goal) {
    p.done = true;
    saveNow();
    return { ...p, finished: true };
  }
  p.day += 1;
  if (p.day > DAYS_PER_LEVEL) {
    p.day = 1;
    p.level += 1;
  }
  saveNow();
  return p;
}
/**
 * Який рівень/день і з яким показником виконувався цей запис — знімок дня,
 * щоб числа заняття не «стрибали» назад, коли показник підіймається.
 */
export function ensureProgDay(iso, exerciseId) {
  const p = progressionState(exerciseId);
  if (!p || p.done) return null;
  const entry = ensureEntry(iso, exerciseId);
  if (!entry.prog || !entry.prog.level) {
    entry.prog = { level: p.level, day: p.day, testMax: p.testMax };
    save();
  } else if (!entry.prog.testMax) {
    entry.prog.testMax = p.testMax; // запис зі старої версії
    save();
  }
  return entry.prog;
}

/**
 * Фінальний підхід «максимум» перевищив тестовий показник → піднімаємо показник
 * (програма підстроюється під форму без окремого тесту). Крок обмежено +25% за
 * раз: людина зробила це на втомі, тож числа підтягуються, але без шоку.
 */
export function bumpTestMax(exerciseId, maxSetReps) {
  const p = progressionState(exerciseId);
  if (!p || p.done) return null;
  const r = Math.round(Number(maxSetReps) || 0);
  if (r <= p.testMax) return null;
  const from = p.testMax;
  p.testMax = Math.min(r, Math.max(from + 1, Math.round(from * 1.25)));
  p.testedLevel = p.level; // свіжий показник є — окремий ретест не потрібен
  saveNow();
  return { from, to: p.testMax };
}

// --- ОКРЕМІ ТРЕНУВАННЯ-ПРОГРАМИ ---
// Кожна програма — самостійне тренування з ОДНІЄЇ вправи (прес — тільки прес),
// окремо від звичайних тренувань зі снарядами.
export const PROG_ICONS = { abs: '🔥', pullup: '🤸', pushup: '💪', squat: '🦵' };
const PROG_EX = {
  abs: { name: 'Прес', icon: PROG_ICONS.abs, muscle: 'core' },
  pullup: { name: 'Підтягування', icon: PROG_ICONS.pullup, muscle: 'back' },
  pushup: { name: 'Віджимання', icon: PROG_ICONS.pushup, muscle: 'chest' },
  squat: { name: 'Присідання', icon: PROG_ICONS.squat, muscle: 'legs' },
};
export function programById(id) {
  return PROGRAMS.find((p) => p.id === id) || null;
}
/** Вправа програми: наявна (вага тіла + відома назва) або створена під програму. */
export function ensureProgramExercise(programId) {
  const pgm = programById(programId);
  if (!pgm) return null;
  const found = findProgramExercise(programId);
  if (found) return found;
  const tpl = PROG_EX[programId] || {};
  return addExercise({
    name: tpl.name || pgm.label,
    icon: tpl.icon || '💪',
    weightType: 'bodyweight',
    weight: 0,
    targetSets: 6,
    targetReps: 10,
    muscle: tpl.muscle || 'core',
  });
}
function findProgramExercise(programId) {
  return (
    state.exercises.find(
      (e) => !e.archived && e.weightType === 'bodyweight' && (matchProgram(e.name) || {}).id === programId
    ) || null
  );
}
/** Тренування програми — містить ЛИШЕ її вправу. */
export function ensureProgramWorkout(programId) {
  const pgm = programById(programId);
  if (!pgm) return null;
  const ex = ensureProgramExercise(programId);
  const name = `${pgm.label} до ${pgm.goal}`;
  let w = state.workouts.find((x) => x.progId === programId);
  if (!w) w = addWorkout(name);
  w.progId = programId;
  w.name = name;
  w.items = [ex.id]; // тільки ця вправа — програма не мішається зі звичайним тренуванням
  saveNow();
  return { workout: w, exercise: ex };
}
/** Стан програми для списку/екрана: вправа, тренування, рівень/день, план заняття. */
export function programSummary(programId) {
  const pgm = programById(programId);
  if (!pgm) return null;
  const ex = findProgramExercise(programId);
  const st = ex ? progressionState(ex.id) : null;
  const plan =
    st && !st.done ? progressionPlan({ testMax: st.testMax, level: st.level, day: st.day, goal: st.goal }) : null;
  const workout = state.workouts.find((x) => x.progId === programId) || null;
  return { program: pgm, exercise: ex, state: st, plan, workout };
}

// --- підказка прогресії (офлайн-евристика) ---
// Якщо 2 останні тренування на одній вазі закрили ціль — пропонуємо додати вагу.
export function suggestProgression(exerciseId) {
  const ex = getExercise(exerciseId);
  if (!ex || ex.weightType === 'bodyweight') return null;
  const hist = exerciseHistory(exerciseId); // новіші зверху
  if (hist.length < 2) return null;
  const recent = hist.slice(0, 2);
  // робоча вага сесії = максимальна вага серед підходів (а не типове поле запису)
  const workWeight = (r) => Math.max(0, ...r.sets.map((s) => Number(s.weight) || 0));
  const w = workWeight(recent[0]);
  if (w <= 0) return null;
  const ok = recent.every((r) => {
    if (Math.abs(workWeight(r) - w) > 0.01) return false;
    // порівнюємо з ПЛАНОВОЮ ціллю з бібліотеки, а не з перенесеною
    // (ціль дня самозанижується після невдалого дня — інакше підказка
    // радила б додати вагу тому, хто відкотився з 12 до 6 повторень)
    const ts = ex.targetSets || r.targetSets;
    const tr = ex.targetReps || r.targetReps;
    if (r.sets.length < ts) return false;
    return r.sets.every((s) => (Number(s.reps) || 0) >= tr);
  });
  if (!ok) return null;
  const step = { dumbbell: 1, barbell: 2.5, kettlebell: 2 }[ex.weightType] || 2.5;
  return { newWeight: Math.round((w + step) * 10) / 10, oldWeight: w };
}

// --- заміри тіла ---
export function getMeasurement(iso) {
  return state.measurements[iso] || {};
}
export function setMeasurement(iso, patch) {
  const next = { ...(state.measurements[iso] || {}) };
  for (const [k, v] of Object.entries(patch)) {
    const num = Number(v);
    if (v == null || v === '' || Number.isNaN(num)) delete next[k];
    else next[k] = num;
  }
  if (Object.keys(next).length) state.measurements[iso] = next;
  else delete state.measurements[iso];
  saveNow();
}
export function deleteMeasurement(iso) {
  delete state.measurements[iso];
  saveNow();
}
export function measurementDates() {
  return Object.keys(state.measurements).sort((a, b) => (a < b ? 1 : -1)); // новіші зверху
}
export function measurementHistory(metricId) {
  const rows = [];
  for (const [iso, m] of Object.entries(state.measurements)) {
    if (m && m[metricId] != null) rows.push({ iso, value: m[metricId] });
  }
  rows.sort((a, b) => (a.iso < b.iso ? -1 : 1)); // старіші першими (для графіка)
  return rows;
}
export function latestMeasurement(metricId) {
  const rows = measurementHistory(metricId);
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const first = rows[0];
  return { value: last.value, iso: last.iso, delta: rows.length > 1 ? Math.round((last.value - first.value) * 10) / 10 : 0, count: rows.length };
}

// --- для кабінету тренера: логи для надсилання + імпорт програми ---
// { 'YYYY-MM-DD': [{ name, weightType, sets:[{reps,weight}] }] } за останні days днів
export function exportRecentLogs(days = 14) {
  const out = {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  for (const [iso, byEx] of Object.entries(state.entries)) {
    if (isoToDate(iso) < cutoff) continue;
    const items = [];
    for (const [exId, en] of Object.entries(byEx)) {
      if (!en.sets || !en.sets.length) continue;
      const ex = getExercise(exId);
      items.push({
        name: ex ? ex.name : 'Вправа',
        weightType: en.weightType,
        sets: en.sets.map((s) => ({ reps: s.reps, weight: s.weight })),
      });
    }
    if (items.length) out[iso] = items;
  }
  return out;
}
// створити локальне тренування з призначеної тренером програми
export function importWorkoutFromPlan(title, exList) {
  const ids = [];
  for (const e of exList || []) {
    const ex = addExercise({
      name: e.name || 'Вправа',
      icon: e.icon || '💪',
      weightType: e.weightType || 'dumbbell',
      weight: Number(e.weight) || 0,
      targetSets: Number(e.targetSets) || 4,
      targetReps: Number(e.targetReps) || 10,
      muscle: e.muscle || 'other',
    });
    ids.push(ex.id);
  }
  const w = addWorkout(title || 'Програма від тренера');
  setWorkoutItems(w.id, ids);
  saveNow();
  return w;
}

// --- експорт / імпорт усіх даних ---
export function exportData() {
  return JSON.stringify(state, null, 2);
}
const BAK_KEY = KEY + '.bak';
export function importData(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  // перевірка, що це справді наша резервна копія, а не випадковий файл
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Array.isArray(parsed.exercises) ||
    !(parsed.entries && typeof parsed.entries === 'object')
  ) {
    throw new Error('Файл не схожий на резервну копію КАЧАЛКА');
  }
  const next = normalizeState(parsed);
  // знімок поточних даних для можливості відкату
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) localStorage.setItem(BAK_KEY, cur);
  } catch (e) {
    /* не критично */
  }
  state = next;
  saveNow();
}
export function hasBackup() {
  try {
    return !!localStorage.getItem(BAK_KEY);
  } catch {
    return false;
  }
}
export function restoreBackup() {
  let bak = null;
  try {
    bak = localStorage.getItem(BAK_KEY);
  } catch {
    return false;
  }
  if (!bak) return false;
  let parsed;
  try {
    parsed = JSON.parse(bak);
  } catch {
    try { localStorage.removeItem(BAK_KEY); } catch {}
    return false; // бита резервна копія — нічого не чіпаємо
  }
  state = normalizeState(parsed);
  try {
    localStorage.removeItem(BAK_KEY);
  } catch {}
  saveNow();
  return true;
}
export function wipeAll() {
  state = defaultState();
  saveNow();
}
