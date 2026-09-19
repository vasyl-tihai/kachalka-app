// smart.js — «розумний тренер»: локальний аналіз історії тренувань.
// Нічого не питає в інтернету — рахує все на пристрої по записаних підходах.
//
// Що вміє:
//   1. підбирає ОСОБИСТИЙ інтервал відпочинку для кожної групи мʼязів —
//      дивиться, після скількох днів паузи результат зростав найбільше;
//   2. показує готовність груп сьогодні (скільки днів минуло проти оптимуму);
//   3. під час заняття підказує корекцію режиму (відпочинок, вага, обсяг).
//
// Принцип: для кожної вправи беремо сусідні тренування, рахуємо розрив у днях
// і зміну результату у відсотках. Потім усереднюємо за розривом по групі мʼязів.
import * as S from './store.js';

export const MIN_SAMPLES = 3; // менше пар — вважаємо, що даних ще замало
export const DEFAULT_GAP = 2; // поки даних немає: класичні 48 год між навантаженнями
const MAX_GAP = 7; // розриви більше тижня — це вже перерва, а не відпочинок
const CLAMP = 30; // ±30% на пару: щоб один стрибок ваги не перекосив середнє
const MIN_BUCKET = 2; // скільки пар має бути в кошику, щоб він міг стати «найкращим»

// «Результат» вправи за тренування: найкращий підхід дня.
// Для ваги — оцінка 1ПМ, для власної ваги — просто повторення.
function sessionScore(ex, entry) {
  let best = 0;
  for (const s of entry.sets || []) {
    const reps = Number(s.reps) || 0;
    if (reps <= 0) continue;
    const bw = (s.weightType || (ex && ex.weightType)) === 'bodyweight';
    const w = Number(s.weight) || 0;
    const v = bw || w <= 0 ? reps : S.estimate1RM(w, reps);
    if (v > best) best = v;
  }
  return best;
}

function daysBetween(isoA, isoB) {
  const a = S.isoToDate(isoA).getTime();
  const b = S.isoToDate(isoB).getTime();
  return Math.round((b - a) / 86400000);
}

// Пари «попереднє тренування → наступне» по одній вправі.
// Повертає [{ gap, delta }]: скільки днів відпочивав і на скільки % змінився результат.
function exercisePairs(ex) {
  const rows = S.exerciseHistory(ex.id).slice().reverse(); // від старих до нових
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const gap = daysBetween(prev.iso, cur.iso);
    if (gap < 1 || gap > MAX_GAP) continue;
    const a = sessionScore(ex, prev);
    const b = sessionScore(ex, cur);
    if (a <= 0 || b <= 0) continue;
    let delta = ((b - a) / a) * 100;
    delta = Math.max(-CLAMP, Math.min(CLAMP, delta));
    out.push({ gap, delta, iso: cur.iso });
  }
  return out;
}

// Останній день, коли групу взагалі навантажували
function lastLoadISO(exList) {
  let last = null;
  for (const ex of exList) {
    const rows = S.exerciseHistory(ex.id);
    if (rows.length && (!last || rows[0].iso > last)) last = rows[0].iso;
  }
  return last;
}

/**
 * Профіль відновлення по всіх групах мʼязів, де є хоч один запис.
 * @returns [{ id, label, optimal, best, buckets, samples, lastISO, daysSince, pct, status, nextISO }]
 *   optimal — рекомендована пауза в днях (best.gap або DEFAULT_GAP)
 *   best    — { gap, delta, n } найрезультативніший розрив або null (замало даних)
 *   pct     — готовність 0..100, status — 'rest' | 'soon' | 'ready'
 */
// Профіль перераховується по всій історії, а екран дня й підказки смикають його
// кілька разів поспіль — тримаємо результат 1.5 с, щоб не рахувати те саме.
let _cache = { at: 0, val: null };

export function restProfile() {
  const now = Date.now();
  if (_cache.val && now - _cache.at < 1500) return _cache.val;
  const today = S.todayISO();
  const byMuscle = new Map();
  for (const ex of S.getExercises({ includeArchived: true })) {
    const m = ex.muscle || 'other';
    if (!byMuscle.has(m)) byMuscle.set(m, []);
    byMuscle.get(m).push(ex);
  }

  const out = [];
  for (const [id, exList] of byMuscle) {
    const pairs = exList.flatMap(exercisePairs);
    const lastISO = lastLoadISO(exList);
    // групи без жодної вправи в списку сюди не потрапляють; ті, що є, але ще не
    // тренувалися, показуємо як «готові» — з них і варто почати

    // середня зміна результату за кожним розривом у днях
    const buckets = [];
    for (let gap = 1; gap <= MAX_GAP; gap++) {
      const inGap = pairs.filter((p) => p.gap === gap);
      if (!inGap.length) continue;
      const delta = inGap.reduce((s, p) => s + p.delta, 0) / inGap.length;
      buckets.push({ gap, n: inGap.length, delta });
    }
    let best = null;
    for (const b of buckets) {
      if (b.n < MIN_BUCKET) continue;
      if (!best || b.delta > best.delta) best = b;
    }
    if (pairs.length < MIN_SAMPLES) best = null; // загалом замало спостережень

    const optimal = best ? best.gap : DEFAULT_GAP;
    const daysSince = lastISO ? daysBetween(lastISO, today) : null;
    const pct = daysSince == null ? 100 : Math.max(0, Math.min(100, Math.round((daysSince / optimal) * 100)));
    const status = pct >= 100 ? 'ready' : pct >= 70 ? 'soon' : 'rest';
    const nextISO = lastISO ? S.dateToISO(new Date(S.isoToDate(lastISO).getTime() + optimal * 86400000)) : today;

    out.push({
      id,
      label: S.muscleLabel(id),
      optimal,
      best,
      buckets,
      samples: pairs.length,
      lastISO,
      daysSince,
      pct,
      status,
      nextISO,
    });
  }
  // спершу те, що вже готове й найдовше відпочивало
  out.sort((a, b) => b.pct - a.pct || (b.daysSince || 0) - (a.daysSince || 0));
  _cache = { at: now, val: out };
  return out;
}

// Готовність конкретної групи (для підказок на екрані підходу)
export function muscleReadiness(muscleId) {
  return restProfile().find((m) => m.id === muscleId) || null;
}

/** Що варто качати сьогодні: групи, які вже відновилися. */
export function readyToday() {
  return restProfile().filter((m) => m.status === 'ready');
}

/**
 * Корекція режиму під час заняття. Дивиться підходи, які вже зроблено сьогодні,
 * і той самий момент минулого тренування.
 * @returns { id, text, action } | null — action: { type:'rest'|'weight', value }
 */
export function sessionAdvice(iso, exerciseId, restSeconds) {
  const ex = S.getExercise(exerciseId);
  const entry = S.getEntry(iso, exerciseId);
  if (!ex || !entry) return null;
  const sets = (entry.sets || []).filter((s) => Number(s.reps) > 0);
  const target = Number(entry.targetReps) || 0;
  const bw = entry.weightType === 'bodyweight';

  // 1) повторення просідають у межах заняття → замало відпочинку між підходами
  if (sets.length >= 2) {
    const first = Number(sets[0].reps) || 0;
    const last = Number(sets[sets.length - 1].reps) || 0;
    if (first > 0 && last <= first * 0.8) {
      const drop = Math.round((1 - last / first) * 100);
      const rest = Math.min(180, Math.round((restSeconds || 60) / 15) * 15 + 30);
      return {
        id: 'rest',
        text: `Повторення просіли на ${drop}% (${first}→${last}) — дай собі ${rest} с відпочинку`,
        action: { type: 'rest', value: rest },
      };
    }
  }

  // 2) перший підхід слабший, ніж минулого разу → сьогодні важче, зменшуємо вагу
  const prev = S.prevSessionSets(exerciseId, iso);
  if (sets.length >= 1 && prev && prev.length) {
    const p = Number(prev[0].reps) || 0;
    const c = Number(sets[0].reps) || 0;
    const sameLoad = (Number(sets[0].weight) || 0) >= (Number(prev[0].weight) || 0);
    if (p > 0 && c > 0 && c <= p * 0.85 && sameLoad && !bw) {
      const w = Math.max(0, Math.round(((Number(entry.weight) || 0) * 0.95) / 0.5) * 0.5);
      return {
        id: 'lighter',
        text: `Сьогодні важче за минулий раз (${p}→${c} повт.) — скинь до ${w} кг і дороби обсяг`,
        action: w > 0 ? { type: 'weight', value: w } : null,
      };
    }
  }

  // 3) усе взято з запасом → наступного разу важче
  const targetSets = Number(entry.targetSets) || 0;
  if (targetSets && sets.length >= targetSets && target) {
    const allOk = sets.every((s) => (Number(s.reps) || 0) >= target);
    const lastReps = Number(sets[sets.length - 1].reps) || 0;
    if (allOk && lastReps >= target + 2 && !bw) {
      const step = (Number(entry.weight) || 0) >= 40 ? 5 : 2.5;
      return {
        id: 'heavier',
        text: `Взяв усі підходи з запасом — наступного разу ${(Number(entry.weight) || 0) + step} кг`,
        action: null,
      };
    }
  }

  // 4) група ще не відновилася — попереджаємо на старті вправи
  if (sets.length === 0) {
    const m = muscleReadiness(ex.muscle || 'other');
    if (m && m.status === 'rest' && m.daysSince != null) {
      return {
        id: 'recovery',
        text: `${m.label}: минуло ${m.daysSince} з ${m.optimal} дн. відновлення — сьогодні тримай обсяг легшим`,
        action: null,
      };
    }
  }
  return null;
}
