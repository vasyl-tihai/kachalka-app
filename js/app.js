// app.js — головний модуль: роутер + усі екрани
import * as S from './store.js';
import { RingTimer, WorkStopwatch } from './timer.js';
import { NumberWheel } from './picker.js';
import { getLandmarker, drawPose } from './pose.js';
import * as FC from './formcheck.js';
import { t as T, setLang, LANGS, plural as PL, dateNames } from './i18n.js';
import { exIconHTML, patternIconHTML } from './exicons.js';
import * as FX from './fx.js';
import * as BE from './backend.js';
import { APP_VERSION } from './version.js';
import * as CAL from './calories.js';

// мова інтерфейсу — із налаштувань (до першого рендеру)
setLang(S.getSettings().lang);

const screenEl = document.getElementById('screen');
const tabbarEl = document.getElementById('tabbar');

// поточно вибрана дата (для головного екрана / запису)
let selectedISO = S.todayISO();

// авто-перехід на новий день: якщо застосунок «прожив ніч» у фоні,
// при поверненні показуємо вже новий день — прогрес підходів починається з нуля
// (учорашні записи лишаються на вчорашній даті).
let lastSeenToday = S.todayISO();
// звірити дату; true — день змінився і selectedISO переставлено на новий «сьогодні»
function syncToday() {
  const now = S.todayISO();
  if (now === lastSeenToday) return false;
  const wasOnToday = selectedISO === lastSeenToday;
  lastSeenToday = now;
  if (!wasOnToday) return false; // користувач свідомо дивиться іншу дату — не чіпаємо
  selectedISO = now;
  return true;
}
function rolloverDay() {
  if (!syncToday()) return;
  closeModal(); // відкрита модалка тримає стару дату в замиканні — закриваємо
  if (location.hash.startsWith('#/set/') || location.hash.startsWith('#/camera/')) {
    location.hash = '#/today'; // екран підходу відкритий на вчора → на «Сьогодні»
  } else {
    router(); // той самий екран, але вже з новою датою
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') rolloverDay();
});
window.addEventListener('focus', rolloverDay);
window.addEventListener('pageshow', rolloverDay);
// якщо застосунок лишили відкритим через північ — перевіряємо раз на хвилину,
// але не смикаємо активний екран підходу/камери (переключиться при навігації)
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (location.hash.startsWith('#/set/') || location.hash.startsWith('#/camera/')) return;
  rolloverDay();
}, 60000);

// крок зміни ваги за типом снаряда (кг)
const WEIGHT_STEP = { dumbbell: 1, barbell: 2.5, kettlebell: 2, bodyweight: 1 };

// чи треба синхронізувати місяць календаря з вибраною датою при наступному вході
let calNeedsSync = true;

// режим редагування на екрані тренування (за замовч. лише перегляд)
let workoutEditMode = false;
// режим редагування профілю в кабінеті (за замовч. — перегляд)
let coachEdit = false;
// id тренування, яке треба відкрити одразу в редагуванні (переживає одну навігацію)
let pendingWorkoutEdit = null;
// чи розгорнутий селектор «Тренування дня» на головному екрані
let workoutSelOpen = false;
// екран підходу: тап «+ Додатковий підхід» повертає кнопку «Виконав підхід»
// для ще одного підходу понад ціль (скидається після запису підходу)
let extraSetArmed = false;
// авто-перехід після відпочинку: на наступній вправі секундомір роботи стартує сам
// (велика кнопка «Почати підхід» потрібна лише для найпершого підходу тренування)
let autoStartWork = false;
// демо-режим спільноти: показує вигаданих людей і дописи (нічого не пише на сервер)
let communityDemo = false;

// екран замірів тіла: обрана метрика і дата запису
let bodyMetric = 'bodyWeight';
let bodyDate = null;

// активні «живі» компоненти, які треба знищувати при зміні екрана
let live = { timer: null, work: null, wheel: null, camera: null, chat: null };
function clearLive() {
  if (live.timer) live.timer.destroy();
  if (live.work) live.work.destroy();
  if (live.wheel && live.wheel.destroy) live.wheel.destroy();
  if (live.camera && live.camera.destroy) live.camera.destroy();
  if (live.chat && live.chat.destroy) live.chat.destroy();
  live = { timer: null, work: null, wheel: null, camera: null, chat: null };
}

// ---------- маршрутизація ----------
const routes = [
  { re: /^#\/set\/(.+)$/, render: renderSet },
  { re: /^#\/camera\/(.+)$/, render: renderCamera },
  { re: /^#\/formcheck$/, render: renderFormcheck },
  { re: /^#\/calendar$/, render: renderCalendar },
  { re: /^#\/workouts$/, render: renderWorkouts },
  { re: /^#\/workout\/(.+)$/, render: renderWorkoutDetail },
  { re: /^#\/programs$/, render: renderPrograms },
  { re: /^#\/program\/(.+)$/, render: renderProgram },
  { re: /^#\/progress$/, render: renderProgress },
  { re: /^#\/body$/, render: renderBody },
  { re: /^#\/history(?:\/(.+))?$/, render: renderHistory },
  { re: /^#\/settings$/, render: renderSettings },
  { re: /^#\/coach$/, render: renderCoach },
  { re: /^#\/community$/, render: renderCommunity },
  { re: /^#\/user\/(.+)$/, render: renderUserProfile },
  { re: /^#\/client\/(.+)$/, render: renderClientManage },
  { re: /^#\/chat\/(.+)$/, render: renderChat },
  { re: /^#\/calories$/, render: renderCalories },
  { re: /^#\/today$/, render: renderToday },
];

function router() {
  syncToday(); // після півночі будь-яка навігація веде вже на новий день
  clearLive();
  calNeedsSync = true; // нова навігація → календар синхронізує місяць із вибраною датою
  workoutEditMode = false; // тренування завжди відкривається в режимі перегляду
  coachEdit = false; // кабінет відкривається в режимі перегляду профілю
  kcalKeyEdit = false; // екран калорій — без форми ключа
  bodyDate = null; // екран замірів щоразу відкривається на сьогодні (вибір дати живе лише в межах екрана)
  const hash = location.hash || '#/today';
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) {
      r.render(...m.slice(1));
      updateTabbar(hash);
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/today';
}
window.addEventListener('hashchange', router);

function go(hash) {
  location.hash = hash;
}

// ---------- нижня навігація ----------
const TABS = [
  { hash: '#/today', icon: '🏋️', label: 'Сьогодні' },
  { hash: '#/calendar', icon: '📅', label: 'Календар' },
  { hash: '#/workouts', icon: '📋', label: 'Тренування' },
  { hash: '#/formcheck', icon: '📷', label: 'Аналіз' },
  { hash: '#/progress', icon: '📈', label: 'Прогрес' },
  { hash: '#/community', icon: '👥', label: 'Спільнота' },
];
function renderTabbar() {
  tabbarEl.innerHTML = TABS.map(
    (tb) => `<button class="tab" data-hash="${tb.hash}">
      <span class="tab-ico">${tb.icon}</span><span class="tab-lbl">${T(tb.label)}</span></button>`
  ).join('');
  tabbarEl.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.hash))
  );
}
function updateTabbar(hash) {
  tabbarEl.querySelectorAll('.tab').forEach((b) => {
    const active =
      hash.startsWith(b.dataset.hash) ||
      (b.dataset.hash === '#/today' && (hash === '#/' || hash === '#/calories')) ||
      (b.dataset.hash === '#/workouts' && hash.startsWith('#/workout')) ||
      (b.dataset.hash === '#/progress' && (hash.startsWith('#/history') || hash.startsWith('#/body'))) ||
      (b.dataset.hash === '#/community' &&
        (hash.startsWith('#/user') || hash.startsWith('#/coach') || hash.startsWith('#/chat') || hash.startsWith('#/client')));
    b.classList.toggle('active', active);
  });
  // ховаємо таб-бар на повноекранних екранах (підхід, камера)
  tabbarEl.style.display = hash.startsWith('#/set/') || hash.startsWith('#/camera/') ? 'none' : '';
}

// ---------- утиліти ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function unitFor(type) {
  return type === 'bodyweight' ? '' : T('кг');
}
function typeLabel(id) {
  const wt = S.WEIGHT_TYPES.find((x) => x.id === id);
  return wt ? T(wt.label) : '';
}
function fmtKg(n) {
  // компактний тоннаж: 1234 → «1.2 т», 850 → «850 кг»
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')} т`;
  return `${Math.round(n)} кг`;
}
// час у секундах → «хв:сек» (або просто секунди, якщо < 60)
function fmtMMSS(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
}
// час роботи підходу — завжди «хв:сек» (0:34), як на секундомірі
function fmtWork(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
// парсинг введеного часу: «90» → 90с, «1:30» → 90с
function parseDuration(str) {
  str = String(str).trim();
  if (str.includes(':')) {
    const [m, s] = str.split(':');
    return (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0);
  }
  return parseInt(str, 10) || 0;
}

// смужка зі статистикою (серія + тиждень) — на «Сьогодні» і «Прогрес»
function statStrip() {
  const stk = S.streakStats();
  const wk = S.volumeStats(7);
  const streakChip =
    stk.current > 0
      ? `<div class="stat-chip flame"><b>🔥 ${stk.current}</b><span>${plural(stk.current, 'день', 'дні', 'днів')} ${T('поспіль')}</span></div>`
      : `<div class="stat-chip"><b>🔥</b><span>${T('почни серію')}</span></div>`;
  const weekChip = `<div class="stat-chip"><b>${wk.sessions}</b><span>${T('тренувань за тиждень')}</span></div>`;
  const weeksChip =
    stk.weeks > 1
      ? `<div class="stat-chip"><b>${stk.weeks}</b><span>${plural(stk.weeks, 'тиждень', 'тижні', 'тижнів')} ${T('поспіль')}</span></div>`
      : '';
  return `<div class="stat-strip">${streakChip}${weekChip}${weeksChip}</div>`;
}

// стовпчиковий графік (значення → висоти), повертає HTML
function barsChart(values, labelFor) {
  const max = Math.max(...values, 1);
  return values
    .map((v, i) => {
      const h = v > 0 ? Math.max(6, Math.round((v / max) * 100)) : 2;
      const title = labelFor ? labelFor(v, i) : String(v);
      return `<span class="bar ${v > 0 ? '' : 'bar-empty'}" style="height:${h}%" title="${esc(title)}"></span>`;
    })
    .join('');
}

// лінійний графік (SVG) для замірів тіла
function lineChartSVG(rows) {
  if (!rows || rows.length < 2) return '<p class="muted center">Замало даних для графіка — потрібно ≥2 записи.</p>';
  const vals = rows.map((r) => r.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.1 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const W = 300, H = 110;
  const n = rows.length;
  const x = (i) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v) => H - ((v - lo) / (hi - lo || 1)) * H;
  const line = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.value).toFixed(1)}`).join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  const dots = rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.value).toFixed(1)}" r="3"/>`).join('');
  return `<svg class="line-chart" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <polyline class="lc-area" points="${area}"/>
    <polyline class="lc-line" points="${line}"/>
    ${dots}
  </svg>`;
}

// текст рядка рекордів на екрані підходу
function bestsText(b) {
  return (
    `🏆 ${T('Рекорд')}: ` +
    (b.bodyweight
      ? `${b.maxReps} ${T('повт.')}`
      : `${b.maxWeight} ${T('кг')} · ${b.maxReps} ${T('повт.')} · ${T('1ПМ')} ≈${Math.round(b.max1RM)} ${T('кг')}`)
  );
}

// святкування нового рекорду
function celebratePRs(records, ex) {
  if (!records.length) return;
  const parts = records.map((r) => {
    if (r.type === 'weight') return `${r.value} кг`;
    if (r.type === 'reps') return `${r.value} повт.`;
    if (r.type === 'orm') return `≈${r.value} кг (1ПМ)`;
    return '';
  });
  toast(`🏆 Новий рекорд! <b>${esc(ex.name)}</b><br>${parts.join(' · ')}`, 'pr');
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
}

// =====================================================================
//  ЕКРАН: СЬОГОДНІ
// =====================================================================
function exCard(iso, id) {
  const ex = S.getExercise(id);
  if (!ex) return '';
  const entry = S.getEntry(iso, id);
  const done = entry ? entry.sets.length : 0;
  const target = (entry && entry.targetSets) || ex.targetSets;
  const w = entry ? entry.weight : ex.weight;
  const wt = entry ? entry.weightType : ex.weightType;
  const wText = wt === 'bodyweight' ? 'вага тіла' : `${w} кг`;
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const complete = done >= target && target > 0;
  const anim = exIconHTML(ex); // анімована іконка вправи; немає — емодзі
  // виконаний обсяг (тоннаж) — видно, скільки роботи вже зроблено
  const v = entry ? S.entryVolume(entry) : { tonnage: 0, reps: 0 };
  const volTxt = v.tonnage > 0 ? ` · ⚡ ${fmtKg(v.tonnage)}` : v.reps > 0 ? ` · ⚡ ${v.reps} ${T('повт.')}` : '';
  return `
    <button class="ex-card ${complete ? 'done' : ''}" data-id="${id}">
      <span class="ex-ico">${anim || `<span class="glyph">${ex.icon || '💪'}</span>`}</span>
      <span class="ex-main">
        <span class="ex-name">${esc(ex.name)}</span>
        <span class="ex-sub">${progSubLabel(id) || `${esc(typeLabel(wt))} · ${wText}`}${volTxt}</span>
      </span>
      <span class="ex-meta">
        <span class="ex-count ${complete ? 'glow' : ''}">${done}/${target}</span>
        <span class="ex-bar"><i style="width:${pct}%"></i></span>
      </span>
    </button>`;
}

function renderToday() {
  const iso = selectedISO;
  const isToday = iso === S.todayISO();
  const workouts = S.getWorkouts();
  const dayWIds = S.getDayWorkoutIds(iso);
  const sel = new Set(dayWIds);
  const groups = S.getDayGroups(iso);

  const wChips = workouts.length
    ? workouts
        .map((w) => `<button class="wchip ${sel.has(w.id) ? 'on' : ''}" data-w="${w.id}">${esc(w.name)}</button>`)
        .join('')
    : `<span class="muted">${T('Немає тренувань — додай у вкладці «Тренування»')}</span>`;

  const summary = groups.length ? groups.map((g) => esc(g.workout.name)).join(' + ') : T('Обрати тренування');

  const listHtml = groups.length
    ? groups
        .map((g) => {
          const head =
            groups.length > 1
              ? `<button class="grp-head" data-w="${g.workout.id}"><span>${esc(g.workout.name)}</span><span class="grp-edit">✏️</span></button>`
              : '';
          const cards = g.items.map((id) => exCard(iso, id)).join('') || `<p class="muted side">${T('Порожнє тренування')}</p>`;
          return `<div class="grp">${head}${cards}</div>`;
        })
        .join('')
    : emptyToday();

  const single = dayWIds.length === 1 ? dayWIds[0] : null;

  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles">
        <div class="appbar-kicker">${isToday ? T('Сьогодні') : T('Тренування')}</div>
        <div class="appbar-title">${S.prettyDate(iso)}</div>
      </div>
      <button class="icon-btn" id="dateBtn" title="${T('Обрати дату')}">📅</button>
    </header>
    <div class="day-nav">
      <button class="chip" id="prevDay">‹</button>
      <input type="date" id="datePick" value="${iso}" class="date-input"/>
      <button class="chip" id="nextDay">›</button>
      <button class="chip ghost" id="todayBtn">${T('Сьогодні')}</button>
    </div>
    ${statStrip()}
    <div class="wsel ${workoutSelOpen ? 'open' : ''}">
      <button class="wsel-head" id="wselToggle">
        <span class="wsel-label">${T('Тренування дня')}</span>
        <span class="wsel-sum">${summary}</span>
        <span class="wsel-chev">▾</span>
      </button>
      <div class="wchips">${wChips}</div>
    </div>
    <div class="list">${listHtml}</div>
    ${(() => {
      const dv = S.dayVolume(iso);
      if (!dv.reps) return '';
      const t = dv.tonnage > 0 ? `${fmtKg(dv.tonnage)} · ` : '';
      return `<div class="day-volume">⚡ ${T('Обсяг тренування')}: <b>${t}${dv.reps} ${T('повт.')}</b></div>`;
    })()}
    <div class="day-actions">
      <button class="btn ghost" id="manageW">${single ? '✏️ ' + T('Редагувати це тренування') : '🏋️ ' + T('Керувати тренуваннями')}</button>
      <button class="btn ghost" id="kcalBtn">🍎 ${T('Калорії')}: ${S.calorieDayTotal(iso).kcal} ${T('ккал')} ›</button>
    </div>
  `;

  screenEl.querySelectorAll('.ex-card').forEach((c) =>
    c.addEventListener('click', () => go(`#/set/${c.dataset.id}`))
  );
  screenEl.querySelectorAll('.grp-head').forEach((h) =>
    h.addEventListener('click', () => go('#/workout/' + h.dataset.w))
  );
  screenEl.querySelector('#wselToggle').onclick = () => {
    workoutSelOpen = !workoutSelOpen;
    renderToday();
  };
  screenEl.querySelectorAll('.wchip').forEach((b) =>
    b.addEventListener('click', () => {
      S.toggleDayWorkout(iso, b.dataset.w);
      renderToday();
    })
  );
  screenEl.querySelector('#prevDay').onclick = () => shiftDay(-1);
  screenEl.querySelector('#nextDay').onclick = () => shiftDay(1);
  screenEl.querySelector('#todayBtn').onclick = () => {
    selectedISO = S.todayISO();
    router();
  };
  const dp = screenEl.querySelector('#datePick');
  dp.onchange = () => {
    if (dp.value) {
      selectedISO = dp.value;
      router();
    }
  };
  screenEl.querySelector('#dateBtn').onclick = () => dp.showPicker?.() || dp.focus();
  screenEl.querySelector('#manageW').onclick = () => go(single ? '#/workout/' + single : '#/workouts');
  screenEl.querySelector('#kcalBtn').onclick = () => go('#/calories');
}

function emptyToday() {
  return `<div class="empty">
    <div class="empty-ico">🗓️</div>
    <p>${T('На цей день не обрано тренування.')}</p>
    <button class="btn" onclick="document.getElementById('wselToggle').click()">${T('Обрати тренування')}</button>
  </div>`;
}

function shiftDay(delta) {
  const d = S.isoToDate(selectedISO);
  d.setDate(d.getDate() + delta);
  selectedISO = S.dateToISO(d);
  router();
}

// =====================================================================
//  ЕКРАН: ПІДХІД (головний, як на макеті)
// =====================================================================
function renderSet(exerciseId) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const iso = params.get('date') || selectedISO;
  selectedISO = iso;
  const ex = S.getExercise(exerciseId);
  if (!ex) return go('#/today');

  clearLive(); // знищити попередні таймер/барабан (захист від витоку при повторному renderSet)
  extraSetArmed = false; // свіжий екран — додатковий підхід не «озброєний»
  const entry = S.ensureEntry(iso, exerciseId);
  const settings = S.getSettings();
  const wStep = WEIGHT_STEP[entry.weightType] || 2.5;
  const curType = S.WEIGHT_TYPES.find((t) => t.id === entry.weightType) || S.WEIGHT_TYPES[0];
  const bests = S.exerciseBests(exerciseId);
  const prog = S.suggestProgression(exerciseId);
  const plannedW = ex.weight || 0; // «планова» вага з бібліотеки — для підсвітки збільшення
  // ПРОГРАМА ПРОГРЕСІЇ (вага тіла): план заняття замість «ціль = минулий раз +1–2»
  const pgm = S.programFor(ex); // {id,label,goal} або null
  const pday = pgm ? S.ensureProgDay(iso, exerciseId) : null; // {level,day} цього запису
  const pstate = pgm ? S.progressionState(exerciseId) : null;
  const plan = pday
    ? S.progressionPlan({
        // показник беремо зі знімка дня — числа заняття не міняються заднім числом
        testMax: pday.testMax || pstate.testMax,
        level: pday.level,
        day: pday.day,
        goal: pstate.goal,
      })
    : null;
  if (plan && entry.targetSets !== plan.sets.length) {
    S.updateEntry(iso, exerciseId, { targetSets: plan.sets.length });
    entry.targetSets = plan.sets.length;
  }
  const dateLine = plan
    ? `${S.prettyDate(iso)} · ${T('Рівень')} ${plan.level} · ${T('День')} ${plan.day}/3`
    : S.prettyDate(iso);
  const markWeightUp = () => {
    const sv = screenEl.querySelector('#stepVal');
    if (sv) sv.classList.toggle('w-up', entry.weightType !== 'bodyweight' && entry.weight > plannedW);
  };

  screenEl.innerHTML = `
    <div class="set-screen">
      <header class="set-top">
        <button class="icon-btn" id="backBtn">‹</button>
        <div class="set-ico">${exIconHTML(ex) || `<span class="glyph big">${ex.icon || '💪'}</span>`}</div>
        <div class="set-titles">
          <div class="set-name">${esc(ex.name)}</div>
          <div class="set-date">${dateLine}</div>
        </div>
        <button class="icon-btn" id="camBtn" title="${T('Камера-тренер')}">📹</button>
        <button class="icon-btn" id="cfgBtn" title="${T('Ціль і налаштування')}">⚙️</button>
      </header>

      ${plan ? `
      <!-- ПЛАН ЗАНЯТТЯ (програма прогресії): підходи дня + сумарний обсяг -->
      <section class="card plan-card">
        <div class="plan-chips" id="planChips"></div>
        <div class="plan-total" id="planTotal"></div>
      </section>` : ''}
      ${pgm && !pstate ? `
      <!-- вправа з програмою, але програму ще не запускали (напр. додали у своє тренування) -->
      <button class="prog-start" id="progStart">🎯 ${T('Програма прогресії')}: ${T(pgm.label)} ${T('до')} ${pgm.goal} — ${T('почати')}</button>` : ''}
      ${pstate && pstate.done ? `<div class="prog-done">🏆 ${T('Ціль досягнута')}: ${pstate.goal} ${T('повт.')}</div>` : ''}

      <!-- ВАГА (компактний рядок) -->
      <section class="card weight-card" ${plan ? 'hidden' : ''}>
        <div class="wt-head">
          <span class="card-label wt-label">${T('Вага')}</span>
          <div class="stepper" id="weightStepper" ${entry.weightType === 'bodyweight' ? 'hidden' : ''}>
            <button class="step-btn" data-d="-${wStep}">−</button>
            <div class="step-val" id="stepVal" title="${T('Двічі торкнись, щоб увести вручну')}"><span id="wVal">${entry.weight}</span> <small>${T('кг')}</small></div>
            <button class="step-btn" data-d="${wStep}">+</button>
          </div>
          <button class="wt-current" id="wtCurrent" title="${T('Змінити снаряд')}">${curType.icon} ${T(curType.label)} <span class="wt-caret">▾</span></button>
        </div>
        <div class="type-chips" id="typeChips" hidden>
          ${S.WEIGHT_TYPES.map((wt) => `<button class="tchip ${wt.id === entry.weightType ? 'on' : ''}" data-t="${wt.id}">${wt.icon} ${T(wt.label)}</button>`).join('')}
        </div>
        ${prog ? `<button class="hint-chip" id="progHint">💡 ${T('Час додати вагу — спробуй')} <b>${prog.newWeight} ${T('кг')}</b></button>` : ''}
      </section>

      <!-- ТАЙМЕР ВІДПОЧИНКУ (після останнього підходу — очікування перед наступною вправою) -->
      <section class="card timer-card" id="timerCard">
        <div class="wt-head">
          <span class="card-label wt-label" id="restLabel">${T('Відпочинок між підходами')}</span>
          <button class="wt-current" id="restEdit" title="${T('Увести час вручну')}">✏️ ${T('Час')}</button>
        </div>
        <div class="timer-row">
          <button class="rest-step" data-d="-${settings.restStep}">−${settings.restStep}</button>
          <div id="ringMount" class="ring-mount"></div>
          <button class="rest-step" data-d="${settings.restStep}">+${settings.restStep}</button>
        </div>
        <div class="next-up" id="nextUp" hidden></div>
      </section>

      <!-- ПОВТОРЕННЯ: барабан + кнопка «Виконав підхід» -->
      <section class="card target-card">
        <div class="tc-head">
          <span class="set-label" id="setLabel"></span>
          <button class="goal-chip" id="goalChip" title="${T('Ціль і налаштування')}">🎯 ${T('Ціль')}: <b id="goalVal">${entry.targetReps}</b></button>
        </div>
        <div class="set-progress" id="setProgress"></div>
        <div class="prev-line" id="prevLine" hidden></div>
        <div id="wheelMount"></div>
        <!-- секундомір роботи: скільки триває сам підхід -->
        <div class="work-row" id="workMount"></div>
        <button class="btn primary log-btn" id="logBtn">✓ ${T('Виконав підхід')}</button>
      </section>

      <!-- ВИКОНАНІ ПІДХОДИ -->
      <section class="card sets-card">
        <div class="card-label">${T('Виконані підходи')} <span class="muted" id="setsSummary"></span></div>
        <div class="vol-line" id="volLine" hidden></div>
        <div class="bests-line" id="bestsLine">${bests.count > 0 ? bestsText(bests) : ''}</div>
        <div class="sets-list" id="setsList"></div>
        <button class="btn log-btn extra" id="extraBtn" hidden>＋ ${T('Додатковий підхід')}</button>
      </section>
    </div>
  `;

  // ----- події -----
  screenEl.querySelector('#backBtn').onclick = () => go('#/today');
  screenEl.querySelector('#camBtn').onclick = () => go('#/camera/' + exerciseId);
  screenEl.querySelector('#cfgBtn').onclick = () => openTargetEditor(iso, exerciseId);
  screenEl.querySelector('#goalChip').onclick = () => openTargetEditor(iso, exerciseId);
  // головна дія: обрав повторення на барабані → «Виконав підхід»
  screenEl.querySelector('#logBtn').onclick = () => logSet(iso, exerciseId);
  // додатковий підхід понад ціль — кнопка внизу, біля виконаних підходів.
  // Не записує одразу: повертає «Виконав підхід», щоб обрати повторення і підтвердити
  screenEl.querySelector('#extraBtn').onclick = () => {
    extraSetArmed = true;
    refreshSets(iso, exerciseId);
  };

  // компактний вибір снаряда: показуємо лише поточний; тап відкриває решту
  const wtCurrentBtn = screenEl.querySelector('#wtCurrent');
  const typeChipsEl = screenEl.querySelector('#typeChips');
  wtCurrentBtn.onclick = () => {
    typeChipsEl.hidden = !typeChipsEl.hidden;
  };
  typeChipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.tchip');
    if (!b) return;
    const tp = b.dataset.t;
    S.updateEntry(iso, exerciseId, { weightType: tp });
    entry.weightType = tp;
    typeChipsEl.querySelectorAll('.tchip').forEach((c) => c.classList.toggle('on', c.dataset.t === tp));
    const ct = S.WEIGHT_TYPES.find((x) => x.id === tp) || S.WEIGHT_TYPES[0];
    wtCurrentBtn.innerHTML = `${ct.icon} ${T(ct.label)} <span class="wt-caret">▾</span>`;
    typeChipsEl.hidden = true; // згорнути після вибору
    const stepper = screenEl.querySelector('#weightStepper');
    if (stepper) {
      stepper.hidden = tp === 'bodyweight';
      const step = WEIGHT_STEP[tp] || 2.5;
      const btns = stepper.querySelectorAll('.step-btn');
      if (btns[0]) btns[0].dataset.d = -step;
      if (btns[1]) btns[1].dataset.d = step;
    }
    markWeightUp();
  });

  // степер ваги (+/−)
  screenEl.querySelector('#weightStepper')?.addEventListener('click', (e) => {
    const b = e.target.closest('.step-btn');
    if (!b) return;
    const d = parseFloat(b.dataset.d);
    const v = Math.max(0, Math.round((entry.weight + d) * 10) / 10);
    S.updateEntry(iso, exerciseId, { weight: v });
    entry.weight = v;
    const wv = screenEl.querySelector('#wVal');
    if (wv) wv.textContent = v;
    markWeightUp();
  });

  // подвійний тап по вазі — ручне введення потрібного значення
  const stepValEl = screenEl.querySelector('#stepVal');
  stepValEl?.addEventListener('dblclick', () => {
    if (stepValEl.querySelector('input')) return;
    stepValEl.innerHTML = `<input type="number" id="wInput" value="${entry.weight}" step="0.5" min="0" inputmode="decimal"/>`;
    const inp = stepValEl.querySelector('#wInput');
    inp.focus();
    inp.select();
    const commit = () => {
      const v = Math.max(0, Math.round((parseFloat(inp.value) || 0) * 10) / 10);
      S.updateEntry(iso, exerciseId, { weight: v });
      entry.weight = v;
      stepValEl.innerHTML = `<span id="wVal">${v}</span> <small>${T('кг')}</small>`;
      markWeightUp();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        inp.blur();
      }
    });
  });

  // таймер
  const ringMount = screenEl.querySelector('#ringMount');
  live.timer = new RingTimer(ringMount, {
    // у програмі прогресії відпочинок задає план заняття, а не загальні налаштування
    seconds: plan ? plan.rest : settings.restSeconds,
    // усі ефекти «кінець відпочинку» — за налаштуваннями користувача
    onFinishFx: () => {
      const st = S.getSettings();
      FX.playSound(st);
      FX.vibrateFinish(st);
      if (st.flashOn !== false) flashAlarm(st.flashColor);
    },
    // відпочинок після ОСТАННЬОГО підходу закінчився → авто-перехід далі
    onDone: () => {
      const en = S.getEntry(iso, exerciseId);
      const allDone = !!(en && en.targetSets && en.sets.length >= en.targetSets);
      // кінець відпочинку = час працювати: секундомір роботи стартує сам
      if ((!allDone || extraSetArmed) && live.work) {
        live.work.reset();
        live.work.start();
      }
      if (extraSetArmed) return; // користувач готує додатковий підхід — не смикаємо
      if (!allDone) return; // ще не всі підходи
      const nextId = nextUnfinishedId(iso, exerciseId);
      if (nextId) {
        const nx = S.getExercise(nextId);
        autoStartWork = true; // відпочинок вийшов → на новій вправі секундомір іде сам
        toast(`➡️ ${T('Наступна вправа')}: <b>${esc(nx ? nx.name : '')}</b>`);
        go('#/set/' + nextId);
      } else {
        toast(`🎉 ${T('Тренування виконано!')}`);
        go('#/today');
      }
    },
  });
  screenEl.querySelectorAll('.rest-step').forEach((b) =>
    b.addEventListener('click', () => {
      live.timer.add(parseInt(b.dataset.d, 10));
      // запам'ятати як новий стандарт відпочинку (у програмі — ні: там час із плану)
      if (!plan) S.updateSettings({ restSeconds: Math.round(live.timer.total) });
    })
  );
  // ручне введення часу — окрема кнопка, не конфліктує зі стартом/паузою по колу
  screenEl.querySelector('#restEdit').onclick = () => openRestEditor();

  // секундомір роботи (скільки триває підхід) — зупиняє його запис підходу
  live.work = new WorkStopwatch(screenEl.querySelector('#workMount'));
  // прийшли сюди авто-переходом після відпочинку → одразу працюємо, без тапу
  if (autoStartWork) {
    autoStartWork = false;
    live.work.reset();
    live.work.start();
  }

  // барабан повторень (target — щоб фарбувати: менше цілі біле, більше — жовте)
  const wheelMount = screenEl.querySelector('#wheelMount');
  const tReps = entry.targetReps || 10;
  live.wheel = new NumberWheel(wheelMount, {
    min: 1,
    max: Math.max(40, tReps + 15),
    value: tReps,
    target: tReps,
  });

  // підказка прогресії — застосувати запропоновану вагу
  const progBtn = screenEl.querySelector('#progHint');
  if (progBtn) {
    progBtn.onclick = () => {
      const v = prog.newWeight;
      S.updateEntry(iso, exerciseId, { weight: v });
      entry.weight = v;
      const wv = screenEl.querySelector('#wVal');
      if (wv) wv.textContent = v;
      progBtn.remove();
      toast(`${T('Вага оновлена')}: ${v} ${T('кг')}`);
      markWeightUp();
    };
  }

  // запуск програми просто з екрана вправи (вхідний тест)
  screenEl.querySelector('#progStart')?.addEventListener('click', () => openProgStart(iso, exerciseId));

  refreshSets(iso, exerciseId);
  markWeightUp();

  // час ретесту максимуму (кожні 2 рівні) — питаємо один раз на рівень
  if (plan && S.needTest(exerciseId) && !entry.sets.length) openProgTest(iso, exerciseId, true);
}

// контекст програми для поточного запису: план дня + ціль поточного підходу
function progCtx(iso, exerciseId) {
  const ex = S.getExercise(exerciseId);
  const pgm = S.programFor(ex);
  if (!pgm) return null;
  const p = S.progressionState(exerciseId);
  if (!p || p.done) return null;
  const entry = S.getEntry(iso, exerciseId);
  const pd = (entry && entry.prog) || { level: p.level, day: p.day, testMax: p.testMax };
  const plan = S.progressionPlan({
    testMax: pd.testMax || p.testMax,
    level: pd.level,
    day: pd.day,
    goal: p.goal,
  });
  return { pgm, state: p, plan };
}

// вхідний тест: скільки повторень за раз — від нього залежать усі числа програми
function openProgStart(iso, exerciseId, after) {
  const ex = S.getExercise(exerciseId);
  const pgm = S.matchProgram(ex && ex.name);
  if (!pgm) return;
  openModal(`${T('Програма прогресії')}: ${T(pgm.label)}`, `
    <p class="muted">${T('Програма веде від твого поточного рівня до цілі: {n} повторень за заняття. Рівень — 3 заняття, у кожному 5 підходів за планом і фінальний «максимум».', { n: pgm.goal })}</p>
    <div class="field"><label>${T('Скільки повторень зробиш за раз (максимум)')}</label>
      <input type="number" id="progMax" value="${Math.max(1, S.exerciseBests(exerciseId).maxReps || 10)}" min="1" max="300" inputmode="numeric"/></div>
  `, [
    { label: T('Почати програму'), class: 'primary', onClick: (root) => {
      const m = Math.max(1, parseInt(root.querySelector('#progMax').value, 10) || 10);
      S.startProgression(exerciseId, m, iso);
      closeModal();
      if (after) after();
      else renderSet(exerciseId);
      toast(`🎯 ${T('Програма почалась')} — ${T('Рівень')} 1, ${T('День')} 1`);
    } },
  ]);
}

// ретест максимуму на початку рівня (кожні 2 рівні)
function openProgTest(iso, exerciseId, auto = false, after) {
  const p = S.progressionState(exerciseId);
  if (!p) return;
  openModal(T('Час перевірити максимум'), `
    <p class="muted">${T('Зроби один підхід на максимум (без плану) і впиши результат — програма перерахує числа під твою нову форму.')}</p>
    <div class="field"><label>${T('Скільки повторень зробиш за раз (максимум)')}</label>
      <input type="number" id="progMax" value="${p.testMax}" min="1" max="300" inputmode="numeric"/></div>
  `, [
    ...(auto ? [{ label: T('Пізніше'), class: 'ghost', onClick: () => {
      S.markTested(exerciseId, 0); // не нагадувати до наступного вікна тесту
      closeModal();
    } }] : []),
    { label: T('Зберегти'), class: 'primary', onClick: (root) => {
      const m = Math.max(1, parseInt(root.querySelector('#progMax').value, 10) || p.testMax);
      S.markTested(exerciseId, m);
      closeModal();
      if (after) after();
      else renderSet(exerciseId);
    } },
  ]);
}

// скільки підходів уже записано цього дня (0 → тренування ще не почалось)
function dayLoggedSets(iso) {
  let n = 0;
  for (const id of S.getDayStack(iso)) {
    const en = S.getEntry(iso, id);
    if (en && en.sets) n += en.sets.length;
  }
  return n;
}

// наступна НЕвиконана вправа далі за списком дня (null — далі нічого немає)
function nextUnfinishedId(iso, exerciseId) {
  const stack = S.getDayStack(iso);
  const i = stack.indexOf(exerciseId);
  for (let k = i + 1; k < stack.length; k++) {
    const en = S.getEntry(iso, stack[k]);
    const ex = S.getExercise(stack[k]);
    const tg = (en && en.targetSets) || (ex && ex.targetSets) || 0;
    if (!tg || !en || en.sets.length < tg) return stack[k];
  }
  return null;
}

// Після останнього підходу таймер уже не «між підходами», а очікування ПЕРЕД
// наступною вправою: інший колір (фіолетовий) + назва тієї вправи під кільцем.
function updateRestMode(iso, exerciseId, waiting) {
  const cardEl = screenEl.querySelector('#timerCard');
  const labelEl = screenEl.querySelector('#restLabel');
  const nextEl = screenEl.querySelector('#nextUp');
  if (!cardEl || !labelEl || !nextEl) return;
  const nextId = waiting ? nextUnfinishedId(iso, exerciseId) : null;
  const nx = nextId ? S.getExercise(nextId) : null;
  cardEl.classList.toggle('waiting', waiting);
  labelEl.textContent = waiting
    ? (nextId ? T('Очікування перед наступною вправою') : T('Відпочинок'))
    : T('Відпочинок між підходами');
  nextEl.hidden = !waiting;
  if (!waiting) {
    nextEl.innerHTML = '';
    return;
  }
  nextEl.innerHTML = nextId
    ? `<span class="nu-lab">➡️ ${T('Далі')}:</span> ${nx ? exIconHTML(nx) || `<span class="glyph">${nx.icon || '💪'}</span>` : ''} <b>${esc(nx ? nx.name : '')}</b>`
    : `<span class="nu-lab">🎉 ${T('Це остання вправа')}</span>`;
}

// додати виконаний підхід: бере повторення з барабана, святкує рекорди, стартує відпочинок
function logSet(iso, exerciseId) {
  const ex = S.getExercise(exerciseId);
  const entry = S.ensureEntry(iso, exerciseId);
  const reps = live.wheel ? live.wheel.getValue() : entry.targetReps;
  const pre = S.exerciseBests(exerciseId); // знімок рекордів ДО запису
  // секундомір роботи: час цього підходу йде в запис, потім секундомір на нуль
  const workSec = live.work ? live.work.seconds : 0;
  S.addSet(iso, exerciseId, { reps, weight: entry.weight, sec: workSec });
  if (live.work) live.work.reset();
  extraSetArmed = false; // підхід записано — наступний додатковий знову через «+»
  refreshSets(iso, exerciseId);
  // перевірка нового рекорду (лише якщо раніше вже були записи)
  let celebrated = false;
  if (pre.count > 0) {
    const recs = [];
    const setBw = entry.weightType === 'bodyweight';
    const w = setBw ? 0 : entry.weight;
    if (!setBw && w > 0 && w > pre.maxWeight) recs.push({ type: 'weight', value: w });
    if (reps > pre.maxReps) recs.push({ type: 'reps', value: reps });
    if (!setBw) {
      const orm = S.estimate1RM(w, reps);
      if (orm > pre.max1RM && orm > 0) recs.push({ type: 'orm', value: Math.round(orm) });
    }
    if (recs.length) {
      celebratePRs(recs, ex);
      celebrated = true;
    }
  }
  if (!celebrated && navigator.vibrate) navigator.vibrate(40);

  // ПРОГРАМА ПРОГРЕСІЇ: усі підходи дня зроблено → рухаємо день/рівень.
  // Закритим день вважається, коли КОЖЕН підхід виконано не менше плану
  // (фінальний — «максимум, не менше N»); інакше наступного разу повтор дня.
  const pc = progCtx(iso, exerciseId);
  if (pc) {
    const en = S.getEntry(iso, exerciseId);
    const planSets = pc.plan.sets;
    if (en && en.sets.length >= planSets.length) {
      const ok = planSets.every((s, i) => (Number(en.sets[i] && en.sets[i].reps) || 0) >= s.reps);
      const res = S.advanceProgression(exerciseId, iso, ok);
      if (res) {
        // фінальний «максимум» переріс показник → програма сама підтягує числа
        const lastReps = Number(en.sets[planSets.length - 1] && en.sets[planSets.length - 1].reps) || 0;
        const bump = S.bumpTestMax(exerciseId, lastReps);
        const bTxt = bump ? ` · 💪 ${T('показник')} ${bump.from}→${bump.to}` : '';
        if (res.finished) {
          toast(`🏆 ${T('Ціль досягнута')}: ${pc.state.goal} ${T('повт.')}`);
        } else if (res.repeat) {
          toast(`↻ ${T('День не закрито — наступного разу повтори його')}${bTxt}`);
        } else {
          toast(`✅ ${T('День виконано')} · ${T('далі')}: ${T('Рівень')} ${res.level}, ${T('День')} ${res.day}${bTxt}`);
        }
      }
    }
  }

  // авто-старт таймера відпочинку
  if (live.timer) {
    live.timer.reset();
    live.timer.start();
  }
}

function refreshSets(iso, exerciseId) {
  const entry = S.getEntry(iso, exerciseId);
  if (!entry) return;
  const exLib = S.getExercise(exerciseId);
  const plannedW = exLib ? exLib.weight || 0 : 0; // планова вага — для підсвітки збільшення
  const target = entry.targetSets || 0;
  const done = entry.sets.length;
  const complete = target > 0 && done >= target;

  // «озброєний» додатковий підхід: користувач натиснув «+», обирає повторення
  const armed = extraSetArmed && complete;

  // таймер: «між підходами» → «перед наступною вправою» (інший колір + назва)
  updateRestMode(iso, exerciseId, complete && !armed);

  const setLabelEl = screenEl.querySelector('#setLabel');
  if (setLabelEl) {
    setLabelEl.innerHTML = complete && !armed
      ? `<span class="done-txt">✓ ${T('Виконано')}</span> · ${done} ${T('з')} ${target}`
      : `${T('Підхід')} <b>${done + 1}</b> ${T('з')} ${target}`;
  }

  // «минулого разу» + ціль поточного підходу:
  // барабан = скільки зробив у ЦЬОМУ Ж підході минулого тренування,
  // ціль = ЗАВЖДИ на 1–2 повторення більше за минулий раз (є історія —
  // ручне число з редактора слугує лише кількості підходів і першому тренуванню)
  const prevAll = S.prevSessionSets(exerciseId, iso);
  const prevSets = prevAll;
  const idx = Math.min(done, prevSets ? prevSets.length - 1 : 0); // поточний підхід
  let suggest = entry.targetReps;
  let goalTxt = String(entry.targetReps);
  let goalNum = entry.targetReps;
  if (prevSets && prevSets.length) {
    const prevReps = Number(prevSets[idx].reps) || entry.targetReps;
    suggest = prevReps;
    goalNum = prevReps + 1;
    goalTxt = `${prevReps + 1}–${prevReps + 2}`;
  }
  // ПРОГРАМА ПРОГРЕСІЇ: ціль підходу диктує план заняття, а не історія
  const pc = progCtx(iso, exerciseId);
  let curMax = false;
  if (pc) {
    const pi = Math.min(done, pc.plan.sets.length - 1);
    const ps = pc.plan.sets[pi];
    curMax = ps.max;
    suggest = ps.reps;
    goalNum = ps.reps;
    goalTxt = ps.max ? `≥ ${ps.reps}` : String(ps.reps);
  }
  const goalEl = screenEl.querySelector('#goalVal');
  if (goalEl) goalEl.textContent = goalTxt;
  const goalChipEl = screenEl.querySelector('#goalChip');
  if (goalChipEl && pc) {
    goalChipEl.innerHTML = `🎯 ${curMax ? T('Максимум') : T('Ціль')}: <b id="goalVal">${goalTxt}</b>`;
  }
  // чіпи підходів дня + сумарний обсяг (замість сегментного бару)
  const chipsEl = screenEl.querySelector('#planChips');
  if (chipsEl && pc) {
    chipsEl.innerHTML = pc.plan.sets
      .map((s, i) => {
        const st = i < done ? 'done' : i === done && (!complete || armed) ? 'cur' : '';
        return `<span class="pl-chip ${st}${s.max ? ' max' : ''}">${s.reps}${s.max ? '+' : ''}</span>`;
      })
      .join('');
    const totEl = screenEl.querySelector('#planTotal');
    if (totEl) {
      totEl.innerHTML = `${T('Всього')}: <b>${pc.plan.total}</b> · ${T('Рівень')} ${pc.plan.level}/${pc.plan.levels}`
        + ` · ${T('ціль')} ${pc.state.goal}`;
    }
  }
  // сегментний прогрес-бар підходів: зроблені світяться, понад ціль — помаранчеві;
  // всі підходи виконано → бар перефарбовується зеленим
  const segEl = screenEl.querySelector('#setProgress');
  if (segEl) {
    let segs = '';
    const totalSegs = Math.max(target, done);
    for (let i = 0; i < totalSegs; i++) {
      segs += `<i class="${i < done ? 'on' : ''}${i >= target ? ' extra' : ''}"></i>`;
    }
    segEl.innerHTML = segs;
    segEl.classList.toggle('complete', complete);
    segEl.hidden = !!pc; // у програмі прогресії його заміняють чіпи плану
  }
  const prevEl = screenEl.querySelector('#prevLine');
  if (prevEl) {
    if (pc) {
      prevEl.hidden = true; // числа дає план, історія тут тільки заплутає
    } else if (prevSets && prevSets.length) {
      prevEl.hidden = false;
      prevEl.innerHTML = `${T('Минулого разу')}: ` + prevSets
        .map((s, i) => `<span class="${i === idx && (!complete || armed) ? 'pv-cur' : ''}">${s.reps}</span>`)
        .join(' · ');
    } else {
      prevEl.hidden = true;
    }
  }
  // барабан підказує повторення поточного підходу (не смикаємо виконану вправу)
  if (live.wheel && (!complete || armed)) {
    live.wheel.setRange(1, Math.max(40, goalNum + 15));
    live.wheel.setTarget(goalNum);
    live.wheel.setValue(suggest, false);
  }
  // до цілі — велика синя «Виконав підхід» під барабаном; після виконання вона
  // ховається, а внизу (біля виконаних підходів) зʼявляється «+ додатковий підхід».
  // Тап по «+» повертає «Виконав підхід» для запису ще одного підходу.
  const logBtn = screenEl.querySelector('#logBtn');
  if (logBtn) logBtn.hidden = complete && !armed;
  // секундомір роботи ховається разом із кнопкою (вправу вже виконано)
  const workRow = screenEl.querySelector('#workMount');
  if (workRow) workRow.hidden = complete && !armed;
  // велика кнопка старту — тільки на НАЙПЕРШОМУ підході тренування;
  // далі кожен підхід стартує сам, коли добігає відпочинок
  if (live.work) live.work.setBig(done === 0 && dayLoggedSets(iso) === 0);
  const extraBtn = screenEl.querySelector('#extraBtn');
  if (extraBtn) extraBtn.hidden = !complete || armed;

  const sumEl = screenEl.querySelector('#setsSummary');
  if (sumEl) {
    const totalReps = entry.sets.reduce((s, x) => s + (x.reps || 0), 0);
    const totalSec = entry.sets.reduce((s, x) => s + (x.sec || 0), 0); // сумарний час під вагою
    sumEl.textContent = `· ${done} / ${target}`
      + (totalReps ? ` · ${totalReps} ${T('повт.')}` : '')
      + (totalSec ? ` · ⏱ ${fmtWork(totalSec)}` : '');
  }

  // обсяг (тоннаж) вправи за сьогодні + порівняння з минулим тренуванням
  const volEl = screenEl.querySelector('#volLine');
  if (volEl) {
    const v = S.entryVolume(entry);
    let prevT = 0;
    let prevR = 0;
    if (prevAll) {
      for (const s of prevAll) {
        const r = Number(s.reps) || 0;
        prevR += r;
        const bw = (s.weightType || entry.weightType) === 'bodyweight';
        prevT += bw ? 0 : r * (Number(s.weight) || 0);
      }
    }
    if (v.tonnage > 0) {
      const diff = prevT > 0 ? Math.round(v.tonnage - prevT) : null;
      volEl.hidden = false;
      volEl.innerHTML = `⚡ ${T('Обсяг')}: <b>${fmtKg(v.tonnage)}</b>` +
        (diff != null && diff !== 0
          ? ` <span class="vol-diff ${diff > 0 ? 'up' : 'down'}" title="${T('Минулого разу')}: ${fmtKg(prevT)}">${diff > 0 ? '↗ +' : '↘ −'}${fmtKg(Math.abs(diff))}</span>`
          : '');
    } else if (v.reps > 0) {
      const diff = prevR > 0 ? v.reps - prevR : null;
      volEl.hidden = false;
      volEl.innerHTML = `⚡ ${T('Обсяг')}: <b>${v.reps} ${T('повт.')}</b>` +
        (diff ? ` <span class="vol-diff ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '↗ +' : '↘ −'}${Math.abs(diff)}</span>` : '');
    } else {
      volEl.hidden = true;
    }
  }

  const bestsEl = screenEl.querySelector('#bestsLine');
  if (bestsEl) {
    const b = S.exerciseBests(exerciseId);
    bestsEl.innerHTML = b.count > 0 ? bestsText(b) : '';
  }

  const listEl = screenEl.querySelector('#setsList');
  if (listEl) {
    listEl.innerHTML = entry.sets
      .map((s, i) => {
        const isBw = (s.weightType || entry.weightType) === 'bodyweight';
        const heavier = !isBw && s.weight > plannedW; // важче за план → жовтим
        const w = isBw ? '' : ` · <span class="${heavier ? 'w-up' : ''}">${s.weight}${T('кг')}</span>`;
        const sec = s.sec > 0 ? ` · <span class="s-sec">⏱ ${fmtWork(s.sec)}</span>` : ''; // час роботи
        const extra = i >= target ? 'extra' : ''; // понад ціль → помаранчевим
        return `<div class="set-pill ${extra}">
          <b>${i + 1}</b><span>${s.reps} ${T('повт.')}${w}${sec}</span>
          <button class="set-del" data-i="${i}" title="${T('Видалити')}">✕</button>
        </div>`;
      })
      .join('');
    listEl.querySelectorAll('.set-del').forEach((b) =>
      b.addEventListener('click', () => {
        S.removeSet(iso, exerciseId, parseInt(b.dataset.i, 10));
        refreshSets(iso, exerciseId);
      })
    );
  }
}

function openTargetEditor(iso, exerciseId) {
  // у програмі прогресії числа задає план — показуємо стан програми, а не поля цілі
  const pc = progCtx(iso, exerciseId);
  if (pc) {
    openModal(`${T('Програма прогресії')}: ${T(pc.pgm.label)}`, `
      <p><b>${T('Рівень')} ${pc.plan.level}/${pc.plan.levels}</b> · ${T('День')} ${pc.plan.day}/3</p>
      <p class="muted">${T('Всього')}: ${pc.plan.total} ${T('повт.')} · ${T('відпочинок')} ${pc.plan.rest} ${T('сек')}
        · ${T('ціль')}: ${pc.state.goal}</p>
      <p class="muted">${T('Максимум із тесту')}: ${pc.state.testMax} ${T('повт.')}</p>
      <p class="muted">${T('Числа підходів задає програма — вручну їх не редагують.')}</p>
    `, [
      { label: T('Новий тест'), class: 'ghost', onClick: () => {
        closeModal();
        openProgTest(iso, exerciseId);
      } },
      { label: T('Скинути програму'), class: 'danger', onClick: () => {
        S.stopProgression(exerciseId);
        closeModal();
        renderSet(exerciseId);
      } },
    ]);
    return;
  }
  const entry = S.ensureEntry(iso, exerciseId);
  openModal(T('Ціль на цю вправу'), `
    <div class="field"><label>${T('Бажано підходів')}</label>
      <input type="number" id="tSets" value="${entry.targetSets}" min="1" max="50"/></div>
    <div class="field"><label>${T('Бажано повторень у підході')}</label>
      <input type="number" id="tReps" value="${entry.targetReps}" min="1" max="100"/></div>
    <p class="muted">${T('Зміни стосуються лише цього дня.')}</p>
  `, [
    { label: T('Готово'), class: 'primary', onClick: (root) => {
      const ts = Math.max(1, parseInt(root.querySelector('#tSets').value, 10) || entry.targetSets);
      const tr = Math.max(1, parseInt(root.querySelector('#tReps').value, 10) || entry.targetReps);
      // autoGoal:false — ціль виставлено вручну, авто-підказки її більше не чіпають
      S.updateEntry(iso, exerciseId, { targetSets: ts, targetReps: tr, autoGoal: false });
      closeModal();
      // точкове оновлення (замість повного перерендеру — не збиває таймер відпочинку);
      // чип цілі і барабан оновить refreshSets
      refreshSets(iso, exerciseId);
    } },
  ]);
}

// ручне введення часу відпочинку (окремо від старту/паузи по колу)
function openRestEditor() {
  const cur = live.timer ? Math.round(live.timer.total) : S.getSettings().restSeconds;
  openModal(T('Час відпочинку'), `
    <div class="field"><label>${T('Час (секунди або хв:сек)')}</label>
      <input type="text" id="restInput" value="${fmtMMSS(cur)}" inputmode="numeric" placeholder="${T('напр. 90 або 1:30')}"/></div>
    <div class="rest-presets">
      ${[30, 60, 90, 120, 180].map((s) => `<button type="button" class="chip" data-s="${s}">${fmtMMSS(s)}</button>`).join('')}
    </div>
    <p class="muted">${T('Задає тривалість відпочинку й скидає відлік на це значення.')}</p>
  `, [
    { label: T('Готово'), class: 'primary', onClick: (root) => {
      const sec = parseDuration(root.querySelector('#restInput').value);
      if (sec > 0) {
        if (live.timer) live.timer.setDuration(sec);
        S.updateSettings({ restSeconds: Math.max(5, Math.round(sec)) });
      }
      closeModal();
    } },
  ]);
  const presets = document.querySelector('.rest-presets');
  presets?.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) document.querySelector('#restInput').value = fmtMMSS(+b.dataset.s);
  });
}

// =====================================================================
//  ЕКРАН: КАМЕРА-ТРЕНЕР (MediaPipe Pose, на пристрої)
// =====================================================================
function renderCamera(exerciseId) {
  const ex = S.getExercise(exerciseId);
  if (!ex) return go('#/today');
  const iso = selectedISO;
  let pattern = FC.patternById(FC.guessPattern(ex));
  let counter = new FC.RepCounter(pattern);

  const chips = FC.PATTERNS.map(
    (p) => `<button class="pchip ${p.id === pattern.id ? 'on' : ''}" data-p="${p.id}">${patternIconHTML(p.id)} ${esc(p.label)}</button>`
  ).join('');

  screenEl.innerHTML = `
    <div class="cam-screen">
      <header class="set-top">
        <button class="icon-btn" id="backBtn">‹</button>
        <div class="set-titles">
          <div class="set-name">${esc(ex.name)}</div>
          <div class="set-date">Камера-тренер · на пристрої</div>
        </div>
        <button class="icon-btn" id="flipCam" title="${T('Перемкнути камеру')}">🤳</button>
      </header>
      <div class="cam-stage">
        <video id="camVideo" playsinline muted></video>
        <canvas id="camCanvas"></canvas>
        <div class="cam-rep"><span id="repN">0</span><small>повт.</small></div>
        <div class="cam-angle" id="camAngle"></div>
        <div class="cam-status" id="camStatus">Завантаження моделі…</div>
      </div>
      <div class="pchips" id="pchips">${chips}</div>
      <div class="cam-fb" id="camFb"></div>
      <div class="day-actions">
        <button class="btn primary" id="camLog">✓ Записати повторення</button>
        <button class="btn ghost" id="camReset">↺ Скинути лічильник</button>
      </div>
    </div>`;

  const video = screenEl.querySelector('#camVideo');
  const canvas = screenEl.querySelector('#camCanvas');
  const cctx = canvas.getContext('2d');
  const repN = screenEl.querySelector('#repN');
  const statusEl = screenEl.querySelector('#camStatus');
  const angleEl = screenEl.querySelector('#camAngle');
  const fbEl = screenEl.querySelector('#camFb');

  let stream = null, landmarker = null, rafId = null, running = true, lastTs = -1;
  let curSide = null, failCount = 0;
  // якість картинки: детекція не частіше ~30/с (на 90/120 Гц екранах щокадру —
  // конвеєр захлинається), скелет згладжується, коротка втрата пози не блимає
  let lastDetect = 0, lastGood = 0, smooth = null;
  const DETECT_MS = 33, GRACE_MS = 700;
  // фронтальна («селфі») чи задня камера; вибір запамʼятовується
  let facing = S.getSettings().camFacing || 'environment';

  const applyMirror = () => {
    // селфі-режим показуємо дзеркально (як звикли у фронталці) —
    // і відео, і канвас зі скелетом однаково
    const m = facing === 'user';
    video.classList.toggle('mirrored', m);
    canvas.classList.toggle('mirrored', m);
  };
  const startStream = async () => {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    stream = await navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* деякі пристрої відхиляють play — не критично */ }
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    applyMirror();
  };

  const stop = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  };
  live.camera = { destroy: stop };

  // назад — туди, звідки прийшли (екран підходу або вкладка «Аналіз»)
  screenEl.querySelector('#backBtn').onclick = () => { stop(); history.back(); };
  screenEl.querySelector('#flipCam').onclick = async () => {
    facing = facing === 'user' ? 'environment' : 'user';
    S.updateSettings({ camFacing: facing });
    smooth = null;
    try {
      await startStream();
    } catch (e) {
      statusEl.textContent = T('Не вдалося перемкнути камеру');
      statusEl.classList.remove('hide');
      statusEl.classList.add('err');
    }
  };
  screenEl.querySelector('#camReset').onclick = () => {
    counter.reset();
    curSide = null;
    repN.textContent = '0';
    fbEl.textContent = '';
    fbEl.className = 'cam-fb';
  };
  screenEl.querySelector('#camLog').onclick = () => {
    const n = counter.reps;
    if (n <= 0) { toast('Ще немає зарахованих повторень'); return; }
    const entry = S.ensureEntry(iso, exerciseId);
    S.addSet(iso, exerciseId, { reps: n, weight: entry.weight });
    if (navigator.vibrate) navigator.vibrate(40);
    stop();
    const wTxt = entry.weightType === 'bodyweight' ? 'вага тіла' : entry.weight + ' кг';
    toast(`Записано ${n} ${plural(n, 'повторення', 'повторення', 'повторень')} · ${wTxt}`);
    go('#/set/' + exerciseId);
  };
  screenEl.querySelector('#pchips').addEventListener('click', (e) => {
    const b = e.target.closest('.pchip');
    if (!b) return;
    pattern = FC.patternById(b.dataset.p);
    counter = new FC.RepCounter(pattern);
    curSide = null;
    repN.textContent = '0';
    fbEl.textContent = '';
    fbEl.className = 'cam-fb';
    screenEl.querySelectorAll('.pchip').forEach((c) => c.classList.toggle('on', c.dataset.p === pattern.id));
  });

  // запуск камери + моделі
  (async () => {
    // камера потребує захищеного контексту (https або localhost)
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusEl.textContent = 'Камера потребує HTTPS (або localhost). Відкрий застосунок захищеним з’єднанням.';
      statusEl.classList.add('err');
      return;
    }
    // 1) камера
    try {
      await startStream();
    } catch (err) {
      statusEl.textContent = err && err.name === 'NotAllowedError'
        ? 'Доступ до камери заборонено. Дозволь камеру у браузері та онови сторінку.'
        : 'Не вдалося увімкнути камеру.';
      statusEl.classList.add('err');
      return;
    }
    // встигли піти з екрана, поки висів дозвіл → не лишати камеру ввімкненою
    if (!running) { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; return; }
    // 2) модель
    statusEl.textContent = 'Завантаження AI-моделі…';
    try {
      landmarker = await getLandmarker('VIDEO');
    } catch (err) {
      statusEl.textContent = navigator.onLine
        ? 'Не вдалося завантажити AI-модель. Онови сторінку.'
        : 'Перший запуск камери потребує інтернету (завантажити модель ~17 МБ). Увімкни мережу один раз.';
      statusEl.classList.add('err');
      stop();
      return;
    }
    if (!running) return;
    statusEl.textContent = 'Стань боком до камери, у повний зріст';
    loop();
  })();

  // згладжений скелет: EMA прибирає тремтіння точок між кадрами
  function smoothNorm(norm) {
    if (!smooth || smooth.length !== norm.length) {
      smooth = norm.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }));
    } else {
      const k = 0.55;
      for (let i = 0; i < norm.length; i++) {
        const s = smooth[i], p = norm[i];
        s.x += (p.x - s.x) * k;
        s.y += (p.y - s.y) * k;
        s.z += (p.z - s.z) * k;
        s.visibility = p.visibility;
      }
    }
    return smooth;
  }

  function loop() {
    if (!running || !landmarker) return;
    rafId = requestAnimationFrame(loop);
    if (video.readyState < 2) return;
    const now = performance.now();
    if (now - lastDetect < DETECT_MS) return; // ~30 детекцій/с достатньо
    lastDetect = now;
    if (now <= lastTs) return; // timestamp має строго зростати
    lastTs = now;
    let res;
    try {
      res = landmarker.detectForVideo(video, now);
      failCount = 0;
    } catch (e) {
      // не крутити вічно мертвий конвеєр (втрата GPU-контексту тощо)
      if (++failCount >= 30) {
        stop();
        statusEl.textContent = 'Помилка розпізнавання. Перезайди на екран камери.';
        statusEl.classList.remove('hide');
        statusEl.classList.add('err');
      }
      return;
    }
    const poses = res && res.landmarks;
    if (!poses || !poses.length) {
      // коротку втрату пози (1-2 кадри) пережити мовчки з останнім скелетом —
      // інакше картинка «блимає»
      if (now - lastGood > GRACE_MS) {
        cctx.clearRect(0, 0, canvas.width, canvas.height);
        smooth = null;
        statusEl.textContent = 'Не бачу людину в кадрі';
        statusEl.classList.remove('hide');
        angleEl.textContent = '';
      }
      return;
    }
    lastGood = now;
    const norm = smoothNorm(poses[0]);
    const world = res.worldLandmarks && res.worldLandmarks[0];
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!world) {
      drawPose(cctx, norm);
      statusEl.textContent = 'Не вдається оцінити кут';
      statusEl.classList.remove('hide');
      angleEl.textContent = '';
      return;
    }
    // бік фіксуємо на час повторення (state==='closed'), поза ним — з гістерезисом
    const reading = FC.readJoint(world, norm, pattern, {
      prevSide: curSide,
      lockSide: counter.state === 'closed' ? curSide : null,
    });
    drawPose(cctx, norm, { highlight: reading.triplet });
    if (!reading.ok) {
      statusEl.textContent = pattern.view === 'side' ? 'Стань боком — не видно суглобів' : 'Зайди повністю в кадр';
      statusEl.classList.remove('hide');
      angleEl.textContent = '';
      return;
    }
    curSide = reading.side;
    statusEl.classList.add('hide');
    angleEl.textContent = Math.round(reading.angle) + '°';
    const r = counter.push(reading.angle);
    if (r) {
      repN.textContent = counter.reps;
      fbEl.textContent = r.good ? pattern.tipDeep : pattern.tipShallow;
      fbEl.className = 'cam-fb ' + (r.good ? 'good' : 'warn');
      if (navigator.vibrate) navigator.vibrate(r.good ? 30 : [20, 40, 20]);
    }
  }
}

// =====================================================================
//  ЕКРАН: КАЛЕНДАР
// =====================================================================
let calYear, calMonth;
function renderCalendar() {
  // при вході з іншого екрана показуємо місяць вибраної дати; гортання ‹/› далі не скидається
  if (calNeedsSync || calYear == null) {
    const base = selectedISO ? S.isoToDate(selectedISO) : new Date();
    calYear = base.getFullYear();
    calMonth = base.getMonth();
    calNeedsSync = false;
  }
  const trained = S.trainedDays();
  const monthsFull = dateNames().monthsFull; // назви місяців поточною мовою
  const first = new Date(calYear, calMonth, 1);
  let startDow = first.getDay(); // 0=Нд
  startDow = startDow === 0 ? 6 : startDow - 1; // понеділок першим
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayIso = S.todayISO();

  // план: дні тижня з налаштувань + дні з тижневого плану тренувань
  // (де на день тижня призначено тренування) → зробив/пропустив/заплановано
  const plan = new Set(S.getSettings().trainDays || []);
  const sched = S.getSchedule();
  for (const dow of Object.keys(sched)) if ((sched[dow] || []).length) plan.add(Number(dow));
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(calYear, calMonth, d);
    const iso = S.dateToISO(dt);
    const t = trained.has(iso);
    const planned = plan.has(dt.getDay());
    const isToday = iso === todayIso;
    let cls = '';
    if (t) cls = 'trained';
    else if (planned && iso < todayIso) cls = 'missed'; // день минув без тренування
    else if (planned) cls = 'planned'; // сьогодні (ще попереду) або майбутнє
    cells += `<button class="cal-cell ${cls} ${isToday ? 'today' : ''}" data-iso="${iso}">
      <span>${d}</span>${t ? '<i class="cal-dot"></i>' : ''}</button>`;
  }

  // підрахунок місяця
  const monthTrained = [...trained].filter((iso) => {
    const dt = S.isoToDate(iso);
    return dt.getFullYear() === calYear && dt.getMonth() === calMonth;
  }).length;
  const stk = S.streakStats();

  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles"><div class="appbar-kicker">${T('Календар')}</div>
        <div class="appbar-title">${monthsFull[calMonth]} ${calYear}</div></div>
    </header>
    <div class="cal-nav">
      <button class="chip" id="prevM">‹</button>
      <div class="cal-stat">🔥 ${monthTrained} ${plural(monthTrained, 'тренування', 'тренування', 'тренувань')}</div>
      <button class="chip" id="nextM">›</button>
    </div>
    <div class="stat-strip">
      <div class="stat-chip flame"><b>🔥 ${stk.current}</b><span>${plural(stk.current, 'день', 'дні', 'днів')} ${T('поспіль')}</span></div>
      <div class="stat-chip"><b>${stk.longest}</b><span>${T('рекорд серії')}</span></div>
      ${stk.weeks > 1 ? `<div class="stat-chip"><b>${stk.weeks}</b><span>${plural(stk.weeks, 'тиждень', 'тижні', 'тижнів')} ${T('поспіль')}</span></div>` : ''}
    </div>
    <div class="cal-grid head">
      ${dateNames().dowsMon.map((d) => `<div class="cal-dow">${d}</div>`).join('')}
    </div>
    <div class="cal-grid">${cells}</div>
    ${plan.size
      ? `<div class="cal-legend">
          <span><i class="lg done"></i>${T('зробив')}</span>
          <span><i class="lg miss"></i>${T('пропустив')}</span>
          <span><i class="lg plan"></i>${T('заплановано')}</span>
        </div>`
      : ''}
    <p class="muted center">${T('Натисни на день, щоб переглянути або записати тренування.')}</p>
  `;
  screenEl.querySelector('#prevM').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); };
  screenEl.querySelector('#nextM').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); };
  screenEl.querySelectorAll('.cal-cell[data-iso]').forEach((c) =>
    c.addEventListener('click', () => { selectedISO = c.dataset.iso; go('#/today'); })
  );
}
function plural(n, one, few, many) {
  return PL(n, one, few, many); // форми українською; переклад — усередині i18n
}

// =====================================================================
//  ЕКРАН: ТРЕНУВАННЯ (список іменованих тренувань)
// =====================================================================
function renderWorkouts() {
  const list = S.getWorkouts();
  const rows = list
    .map((w) => {
      const exs = w.items.map((id) => S.getExercise(id)).filter(Boolean);
      const preview = exs.slice(0, 4).map((e) => exIconHTML(e) || (e.icon || '💪')).join(' ');
      // тренування-програма (вага тіла) відкривається екраном програми, не редактором
      if (w.progId) {
        const s = S.programSummary(w.progId);
        const sub = !s || !s.state
          ? T('Не почато')
          : s.state.done
            ? `🏆 ${T('Ціль досягнута')}`
            : `${T('Рівень')} ${s.plan.level}/${s.plan.levels} · ${T('День')} ${s.plan.day}/3 · ${T('Всього')} ${s.plan.total}`;
        return `
      <button class="ex-card" data-p="${w.progId}">
        <span class="ex-ico"><span class="glyph">${S.PROG_ICONS[w.progId] || '🤸'}</span></span>
        <span class="ex-main">
          <span class="ex-name">🎯 ${esc(w.name)}</span>
          <span class="ex-sub">${sub}</span>
        </span>
        <span class="ex-meta"><span class="chev">›</span></span>
      </button>`;
      }
      return `
      <button class="ex-card" data-w="${w.id}">
        <span class="ex-ico"><span class="glyph">🏋️</span></span>
        <span class="ex-main">
          <span class="ex-name">${esc(w.name)}</span>
          <span class="ex-sub">${exs.length} ${plural(exs.length, 'вправа', 'вправи', 'вправ')}${preview ? ' · ' + preview : ''}</span>
        </span>
        <span class="ex-meta"><span class="chev">›</span></span>
      </button>`;
    })
    .join('');

  // тижневий план: Пн..Нд → назви призначених тренувань
  const sch = S.getSchedule();
  const hasPlan = S.scheduleHasAny();
  const dowNums = [1, 2, 3, 4, 5, 6, 0]; // понеділок першим
  const dowNames = dateNames().dowsMon;
  const planRows = dowNums
    .map((dow, i) => {
      const ids = (sch[String(dow)] || []).filter((id) => S.getWorkout(id));
      const names = ids.map((id) => esc(S.getWorkout(id).name)).join(' + ');
      const txt = names || (hasPlan ? `<span class="muted">${T('Вихідний')}</span>` : '<span class="muted">—</span>');
      return `<button class="plan-row" data-dow="${dow}">
        <span class="plan-day">${dowNames[i]}</span>
        <span class="plan-names">${txt}</span>
        <span class="chev">›</span>
      </button>`;
    })
    .join('');

  const tplChips = TEMPLATES.map(
    (tp, i) => `<button class="tpl" data-i="${i}">${tp.icon} ${T(tp.name)}</button>`
  ).join('');

  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles"><div class="appbar-kicker">${T('Мої тренування')}</div>
        <div class="appbar-title">${T('Тренування')}</div></div>
      <button class="icon-btn" id="addW" title="${T('Нове тренування')}">＋</button>
    </header>
    <p class="muted side">${T('Збери різні тренування (напр. «Акцент на руках», «V-подібний»). Натисни, щоб переглянути; змінювати — після кнопки «Редагувати».')}</p>
    <div class="list">${rows || `<div class="empty"><div class="empty-ico">🏋️</div><p>${T('Немає тренувань.')}</p></div>`}</div>

    <section class="card" style="margin-top:16px">
      <div class="card-label">📅 ${T('Тижневий план')}</div>
      <p class="muted" style="margin:0 0 10px">${T('Признач тренування на дні тижня — «Тренування дня» підставиться автоматично.')}</p>
      <div class="plan-list">${planRows}</div>
    </section>

    <button class="prog-start" id="progsBtn" style="margin-top:16px">🎯 ${T('Програми')} ${T('до')} 300 ${T('повт.')} —
      ${T('Прес')}, ${T('Підтягування')}, ${T('Віджимання')}, ${T('Присідання')}</button>

    <section class="card" style="margin-top:12px">
      <div class="card-label">✨ ${T('Шаблони тренувань')}</div>
      <p class="muted" style="margin:0 0 10px">${T('З практики атлетів: важкі/легкі дні та кардіо.')}</p>
      <div class="tpl-grid">${tplChips}</div>
    </section>

    <div class="day-actions"><button class="btn ghost" id="histBtn">📈 ${T('Історія по вправах')}</button></div>
  `;
  screenEl.querySelectorAll('.ex-card[data-w]').forEach((c) =>
    c.addEventListener('click', () => go('#/workout/' + c.dataset.w))
  );
  screenEl.querySelectorAll('.ex-card[data-p]').forEach((c) =>
    c.addEventListener('click', () => go('#/program/' + c.dataset.p))
  );
  screenEl.querySelector('#progsBtn').onclick = () => go('#/programs');
  screenEl.querySelector('#addW').onclick = () => openNewWorkout();
  screenEl.querySelector('#histBtn').onclick = () => go('#/history');
  screenEl.querySelectorAll('.plan-row').forEach((r) =>
    r.addEventListener('click', () => openDayPlanEditor(parseInt(r.dataset.dow, 10)))
  );
  screenEl.querySelectorAll('.tpl').forEach((b) =>
    b.addEventListener('click', () => addTemplate(TEMPLATES[parseInt(b.dataset.i, 10)]))
  );
}

// =====================================================================
//  ЕКРАНИ: ПРОГРАМИ З ВАГОЮ ТІЛА (окремі тренування — «тільки прес» тощо)
// =====================================================================
function renderPrograms() {
  const rows = S.PROGRAMS.map((p) => {
    const s = S.programSummary(p.id);
    const ico = S.PROG_ICONS[p.id] || '🤸';
    let sub;
    if (!s.state) sub = `${T('Не почато')} · ${T('ціль')} ${p.goal} ${T('повт.')}`;
    else if (s.state.done) sub = `🏆 ${T('Ціль досягнута')}: ${p.goal} ${T('повт.')}`;
    else sub = `${T('Рівень')} ${s.plan.level}/${s.plan.levels} · ${T('День')} ${s.plan.day}/3 · ${T('Всього')} ${s.plan.total}`;
    const pct = s.state && !s.state.done ? Math.round((s.plan.total / p.goal) * 100) : s.state ? 100 : 0;
    return `<button class="ex-card" data-p="${p.id}">
      <span class="ex-ico"><span class="glyph">${ico}</span></span>
      <span class="ex-main">
        <span class="ex-name">${T(p.label)} ${T('до')} ${p.goal}</span>
        <span class="ex-sub">${sub}</span>
        <span class="prog-bar"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></span>
      </span>
      <span class="ex-meta"><span class="chev">›</span></span>
    </button>`;
  }).join('');

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backP">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">${T('Вага тіла')}</div>
        <div class="appbar-title">${T('Програми')}</div></div>
    </header>
    <p class="muted side">${T('Окрема програма на одну річ: качаєш її до цілі за рівнями й днями. Ваги тут немає — росте кількість повторень.')}</p>
    <div class="list">${rows}</div>
  `;
  screenEl.querySelector('#backP').onclick = () => go('#/workouts');
  screenEl.querySelectorAll('.ex-card[data-p]').forEach((c) =>
    c.addEventListener('click', () => go('#/program/' + c.dataset.p))
  );
}

function renderProgram(programId) {
  const s = S.programSummary(programId);
  if (!s) return go('#/programs');
  const p = s.program;
  const ico = S.PROG_ICONS[programId] || '🤸';
  const sch = S.getSchedule();
  const wid = s.workout ? s.workout.id : null;
  const onPlan = !!wid && PROG_DOWS.every((d) => (sch[String(d)] || []).includes(wid));

  const chips = s.plan
    ? s.plan.sets
        .map((x) => `<span class="pl-chip${x.max ? ' max' : ''}">${x.reps}${x.max ? '+' : ''}</span>`)
        .join('')
    : '';

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backP">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">${T('Програма')}</div>
        <div class="appbar-title">${T(p.label)} ${T('до')} ${p.goal}</div></div>
    </header>

    ${s.state && s.state.done ? `<div class="prog-done">🏆 ${T('Ціль досягнута')}: ${p.goal} ${T('повт.')}</div>` : ''}

    <section class="card">
      <div class="prog-hero">
        <span class="prog-hero-ico">${ico}</span>
        <div>
          <div class="prog-hero-main">${s.plan ? `${T('Рівень')} ${s.plan.level}/${s.plan.levels}` : T('Не почато')}</div>
          <div class="prog-hero-sub">${s.plan
            ? `${T('День')} ${s.plan.day}/3 · ${T('Максимум із тесту')}: ${s.state.testMax} ${T('повт.')}`
            : `${T('ціль')}: ${p.goal} ${T('повт.')} ${T('за заняття')}`}</div>
        </div>
      </div>
      ${s.plan ? `
      <div class="card-div"></div>
      <div class="card-label">${T('Заняття сьогодні')}</div>
      <div class="plan-chips">${chips}</div>
      <div class="plan-total">${T('Всього')}: <b>${s.plan.total}</b> · ${T('відпочинок')} ${s.plan.rest} ${T('сек')}</div>` : ''}
    </section>

    <div class="day-actions">
      ${s.state && !s.state.done
        ? `<button class="btn primary" id="goSession">▶ ${T('Почати заняття')}</button>`
        : ''}
      ${!s.state ? `<button class="btn primary" id="startProg">🎯 ${T('Почати програму')}</button>` : ''}
    </div>

    ${s.state && !s.state.done ? `
    <label class="share-row" style="margin-top:12px">
      <input type="checkbox" id="progPlan" ${onPlan ? 'checked' : ''}/>
      <span>📅 ${T('3 заняття на тиждень (Пн · Ср · Пт)')}
        <small class="muted">${T('додає цю програму в тижневий план — між заняттями день відпочинку')}</small></span>
    </label>
    <div class="btn-col" style="margin-top:12px">
      <button class="btn ghost" id="newTest">${T('Новий тест')}</button>
      <button class="btn danger" id="resetProg">${T('Скинути програму')}</button>
    </div>` : ''}

    <section class="card" style="margin-top:16px">
      <div class="card-label">📖 ${T('Як це працює')}</div>
      <p class="muted" style="margin:0">${T('Рівень — 3 заняття. Обсяг росте на ~7% за заняття, кожен 4-й рівень легший (розгрузка), кожні 2 рівні — новий тест максимуму. Не закрив день — наступного разу повторюєш його.')}</p>
    </section>
  `;

  screenEl.querySelector('#backP').onclick = () => go('#/programs');
  screenEl.querySelector('#startProg')?.addEventListener('click', () => {
    const ex = S.ensureProgramExercise(programId);
    openProgStart(S.todayISO(), ex.id, () => {
      S.ensureProgramWorkout(programId);
      renderProgram(programId);
    });
  });
  screenEl.querySelector('#goSession')?.addEventListener('click', () => {
    const iso = S.todayISO();
    selectedISO = iso;
    // якщо вправа програми вже є в тренуванні цього дня (користувач додав її
    // у своє тренування) — просто відкриваємо її, окреме тренування не плодимо
    if (s.exercise && S.getDayStack(iso).includes(s.exercise.id)) return go('#/set/' + s.exercise.id);
    const link = S.ensureProgramWorkout(programId);
    const ids = S.getDayWorkoutIds(iso);
    if (!ids.includes(link.workout.id)) S.setDayWorkouts(iso, [...ids, link.workout.id]);
    go('#/set/' + link.exercise.id);
  });
  screenEl.querySelector('#progPlan')?.addEventListener('change', (e) => {
    const link = S.ensureProgramWorkout(programId);
    setProgramSchedule(link.workout.id, e.target.checked);
    toast(e.target.checked ? `📅 ${T('Додано в тижневий план')}` : `📅 ${T('Прибрано з плану')}`);
  });
  screenEl.querySelector('#newTest')?.addEventListener('click', () => {
    if (s.exercise) openProgTest(S.todayISO(), s.exercise.id, false, () => renderProgram(programId));
  });
  screenEl.querySelector('#resetProg')?.addEventListener('click', () => {
    if (s.exercise) S.stopProgression(s.exercise.id);
    renderProgram(programId);
  });
}

const PROG_DOWS = [1, 3, 5]; // Пн · Ср · Пт — між заняттями день відпочинку
function setProgramSchedule(workoutId, on) {
  // Якщо тижневого плану ще не було, спершу закріплюємо поточну поведінку:
  // без плану «Тренування дня» брало перше звичайне тренування ЩОДНЯ. Інакше
  // вмикання плану лише для програми зробило б решту днів вихідними.
  if (on && !S.scheduleHasAny()) {
    const st = S.getSettings();
    const days = Array.isArray(st.trainDays) && st.trainDays.length ? st.trainDays : [0, 1, 2, 3, 4, 5, 6];
    const base = S.getWorkouts().find((w) => !w.progId);
    if (base) for (const d of days) S.setScheduleDay(d, [base.id]);
  }
  const sch = S.getSchedule();
  for (const dow of PROG_DOWS) {
    const cur = (sch[String(dow)] || []).filter((id) => S.getWorkout(id));
    const i = cur.indexOf(workoutId);
    if (on && i < 0) cur.push(workoutId);
    if (!on && i >= 0) cur.splice(i, 1);
    S.setScheduleDay(dow, cur);
  }
}

// редактор плану на день тижня: які тренування робити цього дня щотижня
function openDayPlanEditor(dow) {
  const dowNames = dateNames().dowsMon;
  const idx = [1, 2, 3, 4, 5, 6, 0].indexOf(dow);
  const cur = new Set((S.getSchedule()[String(dow)] || []));
  const body = S.getWorkouts()
    .map(
      (w) => `<label class="pick-row">
        <input type="checkbox" data-id="${w.id}" ${cur.has(w.id) ? 'checked' : ''}/>
        <span class="pick-ico">🏋️</span>
        <span class="pick-name">${esc(w.name)}</span>
      </label>`
    )
    .join('');
  openModal(`${T('Тижневий план')} · ${dowNames[idx]}`, `
    <div class="pick-list">${body}</div>
    <p class="muted">${T('Нічого не обрано = вихідний. Конкретну дату можна змінити на екрані «Сьогодні».')}</p>
  `, [
    { label: T('Готово'), class: 'primary', onClick: (root) => {
      const ids = Array.from(root.querySelectorAll('input:checked')).map((i) => i.dataset.id);
      S.setScheduleDay(dow, ids);
      closeModal();
      renderWorkouts();
    } },
  ]);
}

// ----- шаблони тренувань (практика важкої та легкої атлетики) -----
const TEMPLATES = [
  {
    name: 'Важкий день (сила)', icon: '🏋️‍♂️',
    items: [
      { name: 'Присідання зі штангою', icon: '🦵', wt: 'barbell', w: 40, sets: 5, reps: 5, m: 'legs' },
      { name: 'Станова тяга', icon: '🏋️‍♂️', wt: 'barbell', w: 50, sets: 3, reps: 5, m: 'back' },
      { name: 'Жим штанги лежачи', icon: '💪', wt: 'barbell', w: 30, sets: 5, reps: 5, m: 'chest' },
      { name: 'Тяга штанги в нахилі', icon: '🪨', wt: 'barbell', w: 25, sets: 3, reps: 8, m: 'back' },
    ],
  },
  {
    name: 'Легкий день (відновлення)', icon: '🤸',
    items: [
      { name: 'Легкі присідання', icon: '🦵', wt: 'bodyweight', w: 0, sets: 3, reps: 15, m: 'legs' },
      { name: 'Віджимання', icon: '💪', wt: 'bodyweight', w: 0, sets: 3, reps: 12, m: 'chest' },
      { name: 'Планка (секунди)', icon: '🔥', wt: 'bodyweight', w: 0, sets: 3, reps: 40, m: 'core' },
      { name: 'Розтяжка (хвилини)', icon: '🤸', wt: 'bodyweight', w: 0, sets: 1, reps: 10, m: 'other' },
    ],
  },
  {
    name: 'Біг', icon: '🏃',
    items: [
      { name: 'Біг (хвилини)', icon: '🏃', wt: 'bodyweight', w: 0, sets: 1, reps: 30, m: 'legs' },
      { name: 'Спринт (секунди)', icon: '⚡', wt: 'bodyweight', w: 0, sets: 8, reps: 30, m: 'legs' },
    ],
  },
  {
    name: 'Велосипед', icon: '🚴',
    items: [{ name: 'Велосипед (хвилини)', icon: '🚴', wt: 'bodyweight', w: 0, sets: 1, reps: 45, m: 'legs' }],
  },
  {
    name: 'Плавання', icon: '🏊',
    items: [{ name: 'Плавання (хвилини)', icon: '🏊', wt: 'bodyweight', w: 0, sets: 1, reps: 30, m: 'full' }],
  },
  {
    name: 'Кругове (все тіло)', icon: '⚡',
    items: [
      { name: 'Берпі', icon: '🔥', wt: 'bodyweight', w: 0, sets: 3, reps: 15, m: 'full' },
      { name: 'Скакалка (секунди)', icon: '⚡', wt: 'bodyweight', w: 0, sets: 3, reps: 60, m: 'legs' },
      { name: 'Віджимання', icon: '💪', wt: 'bodyweight', w: 0, sets: 3, reps: 15, m: 'chest' },
      { name: 'Скручування (прес)', icon: '🔥', wt: 'bodyweight', w: 0, sets: 3, reps: 20, m: 'core' },
      { name: 'Випади', icon: '🦵', wt: 'bodyweight', w: 0, sets: 3, reps: 12, m: 'legs' },
    ],
  },
];

// створити тренування з шаблону: наявні вправи (за назвою) перевикористовуються
function addTemplate(tpl) {
  const w = S.addWorkout(T(tpl.name));
  const ids = tpl.items.map((it) => {
    const nm = T(it.name);
    const existing = S.getExercises().find((e) => e.name === nm);
    if (existing) return existing.id;
    return S.addExercise({
      name: nm,
      icon: it.icon,
      weightType: it.wt,
      weight: it.w,
      targetSets: it.sets,
      targetReps: it.reps,
      muscle: it.m,
    }).id;
  });
  S.setWorkoutItems(w.id, ids);
  toast(`${T('Додано')}: ${esc(w.name)}`);
  renderWorkouts();
}

function openNewWorkout() {
  openModal(T('Нове тренування'), `
    <div class="field"><label>${T('Назва тренування')}</label>
      <input type="text" id="wName" placeholder="${T('Напр. Акцент на руках')}"/></div>
  `, [
    { label: T('Створити'), class: 'primary', onClick: (root) => {
      const w = S.addWorkout(root.querySelector('#wName').value);
      closeModal();
      pendingWorkoutEdit = w.id; // одразу відкрити в редагуванні, щоб додати вправи
      go('#/workout/' + w.id);
    } },
  ]);
}

// =====================================================================
//  ЕКРАН: ТРЕНУВАННЯ — ДЕТАЛІ (перегляд / редагування за кнопкою)
// =====================================================================
function renderWorkoutDetail(workoutId) {
  const w = S.getWorkout(workoutId);
  if (!w) return go('#/workouts');
  if (pendingWorkoutEdit === workoutId) {
    workoutEditMode = true;
    pendingWorkoutEdit = null;
  }
  const edit = workoutEditMode;
  const items = w.items.map((id) => S.getExercise(id)).filter(Boolean);

  const rows = items
    .map((ex, i) => `
      <div class="ex-row" data-id="${ex.id}">
        <span class="ex-ico">${exIconHTML(ex) || `<span class="glyph">${ex.icon || '💪'}</span>`}</span>
        <span class="ex-main">
          <span class="ex-name">${esc(ex.name)}</span>
          <span class="ex-sub">${progSubLabel(ex.id)
            || `${esc(typeLabel(ex.weightType))} · ${ex.weightType === 'bodyweight' ? T('вага тіла') : ex.weight + ' ' + T('кг')} · ${ex.targetSets}×${ex.targetReps}`}</span>
        </span>
        ${edit ? `<span class="ex-order">
          <button class="mini" data-act="up" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="mini" data-act="down" ${i === items.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="mini" data-act="edit">✏️</button>
          <button class="mini danger" data-act="remove">✕</button>
        </span>` : ''}
      </div>`)
    .join('');

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backW">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">${T('Тренування')}</div>
        <div class="appbar-title">${edit ? T('Редагування') : esc(w.name)}</div></div>
      <button class="icon-btn ${edit ? 'on' : ''}" id="toggleEdit" title="${edit ? T('Готово') : T('Редагувати')}">${edit ? '✓' : '✏️'}</button>
    </header>
    ${edit ? `<div class="field" style="margin-bottom:12px"><label>${T('Назва тренування')}</label>
      <input type="text" id="wNameEdit" value="${esc(w.name)}"/></div>` : ''}
    ${edit ? '' : `<p class="muted side">${T('Лише перегляд. Натисни ✏️, щоб змінити вправи, порядок і назву.')}</p>`}
    <div class="list ex-list">${rows || `<div class="empty"><div class="empty-ico">📋</div><p>${T('Поки немає вправ.')}</p></div>`}</div>
    ${edit
      ? `<div class="day-actions">
          <button class="btn ghost" id="addItem">＋ ${T('Додати вправу')}</button>
          <button class="btn ghost" id="dupWorkout">⧉ ${T('Дублювати')}</button>
          <button class="btn danger" id="delWorkout">🗑 ${T('Видалити тренування')}</button>
        </div>`
      : `<div class="day-actions">
          <button class="btn primary" id="editBtn">✏️ ${T('Редагувати')}</button>
          <button class="btn danger" id="delWorkoutView">🗑 ${T('Видалити тренування')}</button>
        </div>`}
  `;

  const saveName = () => {
    const inp = screenEl.querySelector('#wNameEdit');
    if (inp) S.updateWorkout(workoutId, { name: inp.value.trim() || w.name });
  };
  screenEl.querySelector('#backW').onclick = () => {
    if (edit) saveName();
    workoutEditMode = false;
    go('#/workouts');
  };
  const enterEdit = () => { workoutEditMode = true; renderWorkoutDetail(workoutId); };
  const exitEdit = () => { saveName(); workoutEditMode = false; renderWorkoutDetail(workoutId); };
  screenEl.querySelector('#toggleEdit').onclick = () => (edit ? exitEdit() : enterEdit());
  screenEl.querySelector('#editBtn')?.addEventListener('click', enterEdit);
  // видалення доступне і з перегляду (не треба заходити в редагування)
  screenEl.querySelector('#delWorkoutView')?.addEventListener('click', () => {
    if (confirm(T('Видалити тренування «{name}»? Вправи в бібліотеці залишаться.', { name: w.name }))) {
      S.deleteWorkout(workoutId);
      workoutEditMode = false;
      go('#/workouts');
    }
  });

  if (edit) {
    const nameInp = screenEl.querySelector('#wNameEdit');
    nameInp?.addEventListener('change', saveName);
    screenEl.querySelector('#addItem').onclick = () => openAddExercise(workoutId);
    // дублювати: швидко зробити варіант (напр. «легкий день» з меншими вагами)
    screenEl.querySelector('#dupWorkout').onclick = () => {
      saveName();
      const src = S.getWorkout(workoutId);
      const copy = S.addWorkout(`${src.name} (${T('копія')})`);
      S.setWorkoutItems(copy.id, src.items);
      pendingWorkoutEdit = copy.id; // відкрити копію одразу в редагуванні
      workoutEditMode = false;
      go('#/workout/' + copy.id);
    };
    screenEl.querySelector('#delWorkout').onclick = () => {
      if (confirm(T('Видалити тренування «{name}»? Вправи в бібліотеці залишаться.', { name: w.name }))) {
        S.deleteWorkout(workoutId);
        workoutEditMode = false;
        go('#/workouts');
      }
    };
    screenEl.querySelectorAll('.ex-row').forEach((row) => {
      const id = row.dataset.id;
      row.querySelectorAll('.mini').forEach((b) =>
        b.addEventListener('click', () => {
          const act = b.dataset.act;
          if (act === 'edit') return openExerciseForm(id, { onChange: () => renderWorkoutDetail(workoutId) });
          if (act === 'remove') {
            const idx = S.getWorkout(workoutId).items.indexOf(id);
            S.removeItemFromWorkout(workoutId, idx);
            return renderWorkoutDetail(workoutId);
          }
          const ids = S.getWorkout(workoutId).items.slice();
          const idx = ids.indexOf(id);
          const ni = act === 'up' ? idx - 1 : idx + 1;
          if (ni < 0 || ni >= ids.length) return;
          [ids[idx], ids[ni]] = [ids[ni], ids[idx]];
          S.setWorkoutItems(workoutId, ids);
          renderWorkoutDetail(workoutId);
        })
      );
    });
  }
}

// короткий підпис вправи, якщо в неї є програма прогресії («🎯 Прес до 300 · Рівень 1 · День 1/3»)
function progSubLabel(exerciseId) {
  const ex = S.getExercise(exerciseId);
  const pgm = ex && S.programFor(ex);
  if (!pgm) return '';
  const p = S.progressionState(exerciseId);
  if (!p) return `🎯 ${T(pgm.label)} ${T('до')} ${pgm.goal}`;
  if (p.done) return `🏆 ${T('Ціль досягнута')}: ${p.goal}`;
  const plan = S.progressionPlan({ testMax: p.testMax, level: p.level, day: p.day, goal: p.goal });
  return `🎯 ${T(pgm.label)} ${T('до')} ${p.goal} · ${T('Рівень')} ${plan.level} · ${T('День')} ${plan.day}/3 · ${plan.total} ${T('повт.')}`;
}

function openAddExercise(workoutId) {
  const w = S.getWorkout(workoutId);
  const inWorkout = new Set(w.items);
  // вправи з програмою не дублюються у звичайному списку — вони в секції «Програми»
  const avail = S.getExercises().filter((e) => !inWorkout.has(e.id) && !S.programFor(e));
  // програми з вагою тіла — їх можна поставити у своє тренування як звичайну вправу
  const progs = S.PROGRAMS.filter((p) => {
    const ex = S.getExercises().find((e) => e.weightType === 'bodyweight' && (S.matchProgram(e.name) || {}).id === p.id);
    return !ex || !inWorkout.has(ex.id);
  });
  const progBody = progs.length
    ? `<div class="side-label card-label">🎯 ${T('Програми')}</div>
       <div class="pick-list">${progs
        .map((p) => `<button type="button" class="pick-row prog-pick" data-p="${p.id}">
          <span class="pick-ico">${S.PROG_ICONS[p.id] || '🤸'}</span>
          <span class="pick-name">${T(p.label)} ${T('до')} ${p.goal}
            <span class="muted">· ${T('план підходів, без ваги')}</span></span>
          <span class="chev">＋</span>
        </button>`)
        .join('')}</div>
       <div class="card-div"></div>`
    : '';
  const body = avail.length
    ? avail
        .map((ex) => `<label class="pick-row">
          <input type="checkbox" data-id="${ex.id}"/>
          <span class="pick-ico">${exIconHTML(ex) || ex.icon || '💪'}</span>
          <span class="pick-name">${esc(ex.name)} <span class="muted">· ${ex.weightType === 'bodyweight' ? T('вага тіла') : ex.weight + ' ' + T('кг')}</span></span>
        </label>`)
        .join('')
    : `<p class="muted">${T('Усі вправи з бібліотеки вже у цьому тренуванні. Створи нову.')}</p>`;
  openModal(T('Додати вправу'), `${progBody}<div class="pick-list">${body}</div>`, [
    { label: '＋ ' + T('Нова вправа'), class: 'ghost', onClick: () => {
      closeModal();
      openExerciseForm(null, {
        onChange: (newId) => {
          if (newId) S.addItemToWorkout(workoutId, newId);
          renderWorkoutDetail(workoutId);
        },
      });
    } },
    { label: T('Додати'), class: 'primary', onClick: (root) => {
      Array.from(root.querySelectorAll('input:checked')).forEach((i) => S.addItemToWorkout(workoutId, i.dataset.id));
      closeModal();
      renderWorkoutDetail(workoutId);
    } },
  ]);
  // тап по програмі: створює (за потреби) її вправу, кладе в тренування
  // і одразу пропонує вхідний тест, якщо програму ще не запускали
  document.querySelectorAll('.prog-pick').forEach((b) =>
    b.addEventListener('click', () => {
      const pid = b.dataset.p;
      const ex = S.ensureProgramExercise(pid);
      S.addItemToWorkout(workoutId, ex.id);
      closeModal();
      if (!S.progressionState(ex.id)) {
        openProgStart(S.todayISO(), ex.id, () => renderWorkoutDetail(workoutId));
      } else {
        renderWorkoutDetail(workoutId);
      }
    })
  );
}

const EMOJI = ['💪', '🦵', '🏋️', '🏋️‍♂️', '🔔', '🤸', '🔥', '🧎', '🪨', '🚴', '🏃', '🤾', '⚡', '🎯', '🥊', '🧗'];
function openExerciseForm(id, opts = {}) {
  const ex = id ? S.getExercise(id) : null;
  const e = ex || { name: '', icon: '💪', weightType: 'dumbbell', weight: 10, targetSets: 4, targetReps: 12, muscle: 'other' };
  openModal(id ? T('Редагувати вправу') : T('Нова вправа'), `
    <div class="field"><label>${T('Назва')}</label>
      <input type="text" id="exName" value="${esc(e.name)}" placeholder="${T('Напр. Жим гантель лежачи')}"/></div>
    <div class="field"><label>${T('Значок')}</label>
      <div class="emoji-grid" id="emojiGrid">
        ${EMOJI.map((em) => `<button type="button" class="em ${em === e.icon ? 'on' : ''}" data-em="${em}">${em}</button>`).join('')}
      </div></div>
    <div class="field-row">
      <div class="field"><label>${T('Тип ваги')}</label>
        <select id="exType">${S.WEIGHT_TYPES.map((wt) => `<option value="${wt.id}" ${wt.id === e.weightType ? 'selected' : ''}>${T(wt.label)}</option>`).join('')}</select></div>
      <div class="field"><label>${T("М'язова група")}</label>
        <select id="exMuscle">${S.MUSCLE_GROUPS.map((g) => `<option value="${g.id}" ${g.id === (e.muscle || 'other') ? 'selected' : ''}>${T(g.label)}</option>`).join('')}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>${T('Вага (кг)')}</label><input type="number" id="exWeight" value="${e.weight}" min="0" step="0.5"/></div>
      <div class="field"><label>${T('Підходів')}</label><input type="number" id="exSets" value="${e.targetSets}" min="1"/></div>
      <div class="field"><label>${T('Повторень')}</label><input type="number" id="exReps" value="${e.targetReps}" min="1"/></div>
    </div>
    ${S.matchProgram(e.name) ? `
    <label class="share-row prog-switch">
      <input type="checkbox" id="exProg" ${e.progOn === false ? '' : 'checked'}/>
      <span>${T('Програма прогресії')} — ${T(S.matchProgram(e.name).label)} ${T('до')} ${S.matchProgram(e.name).goal}
        <small class="muted">${T('лише для типу «вага тіла»: план підходів замість ваги')}</small></span>
    </label>` : ''}
  `, [
    ...(id ? [{ label: T('Видалити'), class: 'danger', onClick: () => {
      if (confirm(T('Видалити вправу «{name}»? Вона зникне з усіх тренувань та історії.', { name: e.name }))) {
        S.deleteExercise(id);
        closeModal();
        opts.onChange && opts.onChange();
      }
    } }] : []),
    { label: T('Зберегти'), class: 'primary', onClick: (root) => {
      const data = {
        name: root.querySelector('#exName').value.trim() || T('Без назви'),
        icon: root.querySelector('.em.on')?.dataset.em || '💪',
        weightType: root.querySelector('#exType').value,
        muscle: root.querySelector('#exMuscle').value,
        weight: parseFloat(root.querySelector('#exWeight').value) || 0,
        targetSets: parseInt(root.querySelector('#exSets').value, 10) || 10,
        targetReps: parseInt(root.querySelector('#exReps').value, 10) || 10,
      };
      const progBox = root.querySelector('#exProg');
      if (progBox) data.progOn = progBox.checked ? true : false;
      let savedId = id;
      if (id) S.updateExercise(id, data);
      else savedId = S.addExercise(data).id;
      closeModal();
      opts.onChange && opts.onChange(savedId);
    } },
  ]);
  // вибір емодзі
  const grid = document.querySelector('#emojiGrid');
  grid?.addEventListener('click', (ev) => {
    const b = ev.target.closest('.em');
    if (!b) return;
    grid.querySelectorAll('.em').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  });
}

// =====================================================================
//  ЕКРАН: ПРОГРЕС (огляд)
// =====================================================================
function renderProgress() {
  const w7 = S.volumeStats(7);
  const w30 = S.volumeStats(30);
  const weekly = S.weeklyTonnage(8);
  const muscles = S.muscleTonnage(30);
  const lifts = S.topLifts().slice(0, 6);
  const bw = S.latestMeasurement('bodyWeight');

  const weeklyVals = weekly.map((w) => w.tonnage);
  const weeklyChart = weeklyVals.some((v) => v > 0)
    ? `<div class="chart-card">
        <div class="card-label">Тоннаж по тижнях (останні 8)</div>
        <div class="bars">${barsChart(weeklyVals, (v) => fmtKg(v))}</div>
      </div>`
    : '';

  const maxMus = muscles.length ? muscles[0].tonnage : 1;
  const muscleRows = muscles.length
    ? `<div class="chart-card">
        <div class="card-label">Навантаження за групами (30 днів)</div>
        ${muscles
          .map(
            (m) => `<div class="mus-row">
              <span class="mus-name">${esc(m.label)}</span>
              <span class="mus-bar"><i style="width:${Math.max(4, Math.round((m.tonnage / maxMus) * 100))}%"></i></span>
              <span class="mus-val">${fmtKg(m.tonnage)}</span>
            </div>`
          )
          .join('')}
      </div>`
    : '';

  const liftsRows = lifts.length
    ? `<div class="chart-card">
        <div class="card-label">🏆 Рекорди</div>
        <div class="rec-list">
          ${lifts
            .map((l) => {
              const val = l.bodyweight ? `${l.maxReps} повт.` : `${l.maxWeight} кг · 1ПМ ≈${Math.round(l.max1RM)} кг`;
              return `<div class="rec-row"><span class="rec-ico">${exIconHTML(l.ex) || l.ex.icon || '💪'}</span>
                <span class="rec-name">${esc(l.ex.name)}</span>
                <span class="rec-val">${val}</span></div>`;
            })
            .join('')}
        </div>
      </div>`
    : '';

  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles"><div class="appbar-kicker">Прогрес</div>
        <div class="appbar-title">Огляд</div></div>
      <button class="icon-btn" id="setBtn" title="Налаштування">⚙️</button>
    </header>
    ${statStrip()}
    <div class="ov-grid">
      <div class="ov-card"><div class="ov-val">${fmtKg(w7.tonnage)}</div><div class="ov-lbl">тоннаж за тиждень</div></div>
      <div class="ov-card"><div class="ov-val">${fmtKg(w30.tonnage)}</div><div class="ov-lbl">тоннаж за місяць</div></div>
      <div class="ov-card"><div class="ov-val">${w30.sets}</div><div class="ov-lbl">підходів за місяць</div></div>
      <div class="ov-card"><div class="ov-val">${w30.reps}</div><div class="ov-lbl">повторень за місяць</div></div>
    </div>
    ${weeklyChart}
    ${muscleRows}
    ${liftsRows}
    <div class="day-actions">
      <button class="btn ghost" id="bodyBtn">📏 Заміри тіла${bw ? ` · ${bw.value} кг` : ''}</button>
      <button class="btn ghost" id="histBtn">📈 Історія по вправах</button>
    </div>
  `;
  screenEl.querySelector('#setBtn').onclick = () => go('#/settings');
  screenEl.querySelector('#bodyBtn').onclick = () => go('#/body');
  screenEl.querySelector('#histBtn').onclick = () => go('#/history');
}

// =====================================================================
//  ЕКРАН: ЗАМІРИ ТІЛА
// =====================================================================
function renderBody() {
  if (!S.BODY_METRICS.some((m) => m.id === bodyMetric)) bodyMetric = 'bodyWeight';
  const dateISO = bodyDate || S.todayISO();
  const existing = S.getMeasurement(dateISO);
  const metric = S.BODY_METRICS.find((m) => m.id === bodyMetric) || S.BODY_METRICS[0];
  const rows = S.measurementHistory(bodyMetric);
  const latest = S.latestMeasurement(bodyMetric);
  const dates = S.measurementDates();

  const chips = S.BODY_METRICS.map(
    (m) => `<button class="hchip ${m.id === bodyMetric ? 'on' : ''}" data-m="${m.id}">${esc(m.label)}</button>`
  ).join('');

  const inputs = S.BODY_METRICS.map(
    (m) => `<div class="field"><label>${esc(m.label)} <span class="muted">${m.unit}</span></label>
      <input type="number" inputmode="decimal" step="0.1" min="0" data-metric="${m.id}" value="${existing[m.id] != null ? existing[m.id] : ''}" placeholder="—"/></div>`
  ).join('');

  let deltaHtml = '';
  if (latest) {
    const d = latest.delta;
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
    const sign = d > 0 ? '+' : '';
    deltaHtml = `<div class="body-latest">
      <span class="bl-val">${latest.value} <small>${metric.unit}</small></span>
      ${latest.count > 1 ? `<span class="bl-delta ${cls}">${sign}${d} ${metric.unit} від старту</span>` : '<span class="muted">перший запис</span>'}
    </div>`;
  }

  const histList = dates.length
    ? dates
        .map((iso) => {
          const m = S.getMeasurement(iso);
          const parts = S.BODY_METRICS.filter((mt) => m[mt.id] != null).map((mt) => `${esc(mt.label)} ${m[mt.id]}${mt.unit}`);
          return `<div class="bhist-row"><span class="bhist-date">${S.prettyDate(iso)}</span>
            <span class="bhist-vals">${parts.join(' · ')}</span>
            <button class="set-del" data-iso="${iso}" title="Видалити">✕</button></div>`;
        })
        .join('')
    : '';

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">Прогрес</div>
        <div class="appbar-title">Заміри тіла</div></div>
    </header>
    <div class="hchips">${chips}</div>
    <div class="chart-card">
      <div class="card-label">${esc(metric.label)}, ${metric.unit}</div>
      ${deltaHtml}
      ${lineChartSVG(rows)}
    </div>
    <section class="card">
      <div class="card-label">Записати заміри</div>
      <div class="field"><label>Дата</label><input type="date" id="bDate" value="${dateISO}" class="date-input"/></div>
      <div class="metric-grid">${inputs}</div>
      <button class="btn primary" id="saveBody">Зберегти заміри</button>
    </section>
    ${histList ? `<div class="card-label bhist-title">Історія замірів</div><div class="bhist">${histList}</div>` : ''}
  `;

  screenEl.querySelector('#backBtn').onclick = () => go('#/progress');
  screenEl.querySelectorAll('.hchip').forEach((b) =>
    b.addEventListener('click', () => { bodyMetric = b.dataset.m; renderBody(); })
  );
  const dateInp = screenEl.querySelector('#bDate');
  dateInp.onchange = () => { bodyDate = dateInp.value || S.todayISO(); renderBody(); };
  screenEl.querySelector('#saveBody').onclick = () => {
    const patch = {};
    screenEl.querySelectorAll('[data-metric]').forEach((inp) => { patch[inp.dataset.metric] = inp.value; });
    S.setMeasurement(dateInp.value || dateISO, patch);
    toast('Заміри збережено');
    renderBody();
  };
  screenEl.querySelectorAll('.bhist-row .set-del').forEach((b) =>
    b.addEventListener('click', () => {
      const iso = b.dataset.iso;
      if (confirm(`Видалити заміри за ${S.prettyDate(iso)}?`)) {
        S.deleteMeasurement(iso);
        renderBody();
      }
    })
  );
}

// бейдж рекордів для екрана історії по вправі
function renderBestsCard(exerciseId) {
  const b = S.exerciseBests(exerciseId);
  if (b.count === 0) return '';
  const items = b.bodyweight
    ? [['Макс. повторень', `${b.maxReps}`]]
    : [['Макс. вага', `${b.maxWeight} кг`], ['Макс. повт.', `${b.maxReps}`], ['1ПМ ≈', `${Math.round(b.max1RM)} кг`]];
  return `<div class="chart-card"><div class="card-label">🏆 Рекорди</div>
    <div class="best-grid">${items.map(([k, v]) => `<div class="best-cell"><div class="best-v">${v}</div><div class="best-k">${k}</div></div>`).join('')}</div>
  </div>`;
}

// =====================================================================
//  ЕКРАН: ІСТОРІЯ
// =====================================================================
function renderHistory(exerciseId) {
  const list = S.getExercises({ includeArchived: true });
  const current = exerciseId || (list[0] && list[0].id);

  const chips = list
    .map((ex) => `<button class="hchip ${ex.id === current ? 'on' : ''}" data-id="${ex.id}">${exIconHTML(ex) || ex.icon} ${esc(ex.name)}</button>`)
    .join('');

  const ex = S.getExercise(current);
  const rows = current ? S.exerciseHistory(current) : [];
  let table = '';
  if (rows.length === 0) {
    table = `<div class="empty"><div class="empty-ico">📭</div><p>Поки немає записів для цієї вправи.</p></div>`;
  } else {
    table = `<div class="hist-table">
      <div class="hist-head"><span>Дата</span><span>Вага</span><span>Підходи (повт.)</span></div>
      ${rows.map((r) => {
        const w = r.weightType === 'bodyweight' ? '—' : `${r.weight} кг`;
        const sets = r.sets.map((s) => s.reps).join(' · ');
        return `<div class="hist-row">
          <span class="hist-date">${S.prettyDate(r.iso)}</span>
          <span class="hist-w">${w}</span>
          <span class="hist-sets">${sets}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">Історія по вправі</div>
        <div class="appbar-title">${ex ? esc(ex.name) : 'Вправи'}</div></div>
      <button class="icon-btn" id="setBtn" title="Налаштування">⚙️</button>
    </header>
    <div class="hchips">${chips}</div>
    ${current ? renderBestsCard(current) : ''}
    ${current ? renderMiniChart(current) : ''}
    ${table}
  `;
  screenEl.querySelector('#backBtn').onclick = () => go('#/progress');
  screenEl.querySelectorAll('.hchip').forEach((b) =>
    b.addEventListener('click', () => go('#/history/' + b.dataset.id))
  );
  screenEl.querySelector('#setBtn').onclick = () => go('#/settings');
}

function renderMiniChart(exerciseId) {
  const rows = S.exerciseHistory(exerciseId).slice(0, 12).reverse();
  if (rows.length < 2) return '';
  const vols = rows.map((r) => r.sets.reduce((s, x) => s + (x.reps || 0) * (r.weightType === 'bodyweight' ? 1 : r.weight || 1), 0));
  const max = Math.max(...vols, 1);
  const bars = vols
    .map((v, i) => `<span class="bar" style="height:${Math.max(6, Math.round((v / max) * 100))}%" title="${S.prettyDate(rows[i].iso)}: обсяг ${Math.round(v)}"></span>`)
    .join('');
  return `<div class="chart-card"><div class="card-label">Динаміка обсягу (вага×повт.)</div><div class="bars">${bars}</div></div>`;
}

// =====================================================================
//  ЕКРАН: НАЛАШТУВАННЯ
// =====================================================================
const FLASH_COLORS = ['#ff2f2f', '#ff8a3d', '#ffc24b', '#36d77a', '#5b9bff', '#c05bff'];
function renderSettings() {
  const s = S.getSettings();
  const soundChips = FX.SOUNDS.map(
    (sn) => `<button class="tchip ${s.soundId === sn.id ? 'on' : ''}" data-snd="${sn.id}">${T(sn.label)}</button>`
  ).join('');
  const hasCustom = !!S.getCustomSound();
  // дні тижня, коли планую тренуватися (значення getDay(): 0=Нд … 6=Сб)
  const tdays = new Set(s.trainDays || []);
  const DOW_VALS = [1, 2, 3, 4, 5, 6, 0]; // порядок Пн..Нд
  const dayChips = dateNames()
    .dowsMon.map((label, i) => `<button class="tchip ${tdays.has(DOW_VALS[i]) ? 'on' : ''}" data-day="${DOW_VALS[i]}">${label}</button>`)
    .join('');
  const vibSel = s.vibratePattern || 'pulse';
  const vibeChips = FX.VIBES.map(
    (v) => `<button class="tchip ${vibSel === v.id ? 'on' : ''}" data-vib="${v.id}">${T(v.label)}</button>`
  ).join('');
  const swatches = FLASH_COLORS.map(
    (c) => `<button class="swatch ${s.flashColor === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`
  ).join('');
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">${T('Налаштування')}</div>
        <div class="appbar-title">КАЧАЛКА</div></div>
    </header>

    <section class="card">
      <div class="card-label">${T('Мова')}</div>
      <select id="langSel" class="sel">
        ${LANGS.map((l) => `<option value="${l.id}" ${s.lang === l.id ? 'selected' : ''}>${l.label}</option>`).join('')}
      </select>
    </section>

    <section class="card">
      <div class="card-label">${T('Таймер')}</div>
      <div class="field-row">
        <div class="field"><label>${T('Відпочинок (сек)')}</label><input type="number" id="rest" value="${s.restSeconds}" min="5" step="5"/></div>
        <div class="field"><label>${T('Крок ± (сек)')}</label><input type="number" id="step" value="${s.restStep}" min="5" step="5"/></div>
      </div>
    </section>

    <section class="card">
      <div class="card-label">📅 ${T('Дні тренувань')}</div>
      <div class="type-chips">${dayChips}</div>
      <p class="muted hint">${T('Обери дні тижня, коли плануєш тренуватися — календар підсвітить зроблені, пропущені й заплановані')}
        ${T('Дні з тижневого плану у вкладці «Тренування» враховуються автоматично.')}</p>
    </section>

    <section class="card">
      <div class="card-label">${T('Сигнал у кінці відпочинку')}</div>
      <div class="pick-list">
        <label class="pick-row"><input type="checkbox" id="soundOn" ${s.soundOn ? 'checked' : ''}/><span class="pick-ico">🔊</span><span class="pick-name">${T('Звук')}</span></label>
        <label class="pick-row"><input type="checkbox" id="vibrOn" ${s.vibrateOn ? 'checked' : ''}/><span class="pick-ico">📳</span><span class="pick-name">${T('Вібрація')}</span></label>
        <label class="pick-row"><input type="checkbox" id="flashOn" ${s.flashOn ? 'checked' : ''}/><span class="pick-ico">🟥</span><span class="pick-name">${T('Спалах екрана')}</span></label>
      </div>
      <div class="card-div"></div>
      <div class="field"><label>${T('Мелодія')}</label>
        <div class="type-chips">
          ${soundChips}
          <button class="tchip ${s.soundId === 'custom' ? 'on' : ''}" data-snd="custom" ${hasCustom ? '' : 'disabled'}>🎵 ${T('Свій звук')}${s.customSoundName ? ` (${esc(s.customSoundName)})` : ''}</button>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn ghost" id="previewSnd">▶ ${T('Прослухати')}</button>
        <button class="btn ghost" id="pickSnd">📱 ${T('Додати з телефона')}</button>
        ${hasCustom ? `<button class="btn ghost" id="delSnd">✕ ${T('Прибрати')}</button>` : ''}
      </div>
      <input type="file" id="sndFile" accept="audio/*" hidden/>
      <div class="card-div"></div>
      <div class="field"><label>${T('Тип вібрації')}</label>
        <div class="type-chips">${vibeChips}</div>
      </div>
      <div class="card-div"></div>
      <div class="field"><label>${T('Колір спалаху')}</label>
        <div class="swatches">${swatches}
          <input type="color" id="flashColor" value="${s.flashColor || '#ff2f2f'}" title="${T('Колір спалаху')}"/>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-label">👥 ${T('Спільнота')} <span class="muted">(бета)</span></div>
      <button class="btn ghost" id="coachBtn">${T('Відкрити спільноту')}</button>
    </section>

    <section class="card">
      <div class="card-label">${T('Дані')}</div>
      <div class="btn-col">
        <button class="btn ghost" id="exportBtn">⬇️ ${T('Експорт (резервна копія)')}</button>
        <button class="btn ghost" id="importBtn">⬆️ ${T('Імпорт з файлу')}</button>
        ${S.hasBackup() ? `<button class="btn ghost" id="undoBtn">↩️ ${T('Відмінити останній імпорт')}</button>` : ''}
        <button class="btn danger" id="wipeBtn">🗑️ ${T('Стерти всі дані')}</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden/>
    </section>
    <p class="muted center">КАЧАЛКА · ${T('щоденник тренувань · усі дані лише на цьому пристрої')}<br/>
      <small>${T('версія')}: ${esc(APP_VERSION)}</small></p>
  `;
  screenEl.querySelector('#backBtn').onclick = () => history.back();
  screenEl.querySelector('#coachBtn').onclick = () => go('#/community');

  // мова — застосовується одразу
  screenEl.querySelector('#langSel').onchange = (e) => {
    S.updateSettings({ lang: e.target.value });
    setLang(e.target.value);
    renderTabbar();
    renderSettings();
  };

  // таймер зберігається одразу при зміні — як і решта налаштувань
  const saveTimer = () => {
    S.updateSettings({
      restSeconds: parseInt(screenEl.querySelector('#rest').value, 10) || 60,
      restStep: parseInt(screenEl.querySelector('#step').value, 10) || 30,
    });
    toast(T('Збережено'));
  };
  screenEl.querySelector('#rest').onchange = saveTimer;
  screenEl.querySelector('#step').onchange = saveTimer;

  // --- сигнал: звук/мелодія/свій файл/вібрація/спалах ---
  screenEl.querySelector('#soundOn').onchange = (e) => S.updateSettings({ soundOn: e.target.checked });
  screenEl.querySelector('#vibrOn').onchange = (e) => S.updateSettings({ vibrateOn: e.target.checked });
  screenEl.querySelector('#flashOn').onchange = (e) => S.updateSettings({ flashOn: e.target.checked });

  screenEl.querySelectorAll('.tchip[data-snd]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.disabled) return;
      S.updateSettings({ soundId: b.dataset.snd });
      screenEl.querySelectorAll('.tchip[data-snd]').forEach((c) => c.classList.toggle('on', c === b));
      FX.playSound(S.getSettings(), b.dataset.snd); // одразу почути вибір
    })
  );
  screenEl.querySelectorAll('.tchip[data-day]').forEach((b) =>
    b.addEventListener('click', () => {
      const cur = new Set(S.getSettings().trainDays || []);
      const v = Number(b.dataset.day);
      if (cur.has(v)) cur.delete(v);
      else cur.add(v);
      S.updateSettings({ trainDays: [...cur] });
      b.classList.toggle('on');
    })
  );

  screenEl.querySelectorAll('.tchip[data-vib]').forEach((b) =>
    b.addEventListener('click', () => {
      S.updateSettings({ vibratePattern: b.dataset.vib });
      screenEl.querySelectorAll('.tchip[data-vib]').forEach((c) => c.classList.toggle('on', c === b));
      FX.vibrateFinish(S.getSettings(), b.dataset.vib); // одразу відчути вибір
    })
  );

  screenEl.querySelector('#previewSnd').onclick = () => {
    const st = S.getSettings();
    FX.playSound(st, st.soundId || 'triple');
    FX.vibrateFinish(st);
    if (st.flashOn !== false) flashAlarm(st.flashColor);
  };

  const sndFile = screenEl.querySelector('#sndFile');
  screenEl.querySelector('#pickSnd').onclick = () => sndFile.click();
  sndFile.onchange = () => {
    const f = sndFile.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      alert(T('Файл завеликий (макс. 2 МБ)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (S.setCustomSoundData(reader.result)) {
        FX.setCustomSound(reader.result);
        S.updateSettings({ soundId: 'custom', customSoundName: f.name });
        toast(T('Звук додано'));
        renderSettings();
        FX.playSound(S.getSettings(), 'custom');
      } else {
        alert(T('Файл завеликий (макс. 2 МБ)'));
      }
    };
    reader.readAsDataURL(f);
  };
  screenEl.querySelector('#delSnd')?.addEventListener('click', () => {
    S.setCustomSoundData(null);
    FX.setCustomSound(null);
    const st = S.getSettings();
    S.updateSettings({ customSoundName: '', soundId: st.soundId === 'custom' ? 'triple' : st.soundId });
    renderSettings();
  });

  const paintSwatches = () => {
    const cur = S.getSettings().flashColor;
    screenEl.querySelectorAll('.swatch').forEach((sw) => sw.classList.toggle('on', sw.dataset.c === cur));
  };
  screenEl.querySelectorAll('.swatch').forEach((sw) =>
    sw.addEventListener('click', () => {
      S.updateSettings({ flashColor: sw.dataset.c });
      screenEl.querySelector('#flashColor').value = sw.dataset.c;
      paintSwatches();
      flashAlarm(sw.dataset.c); // показати, як виглядатиме
    })
  );
  screenEl.querySelector('#flashColor').onchange = (e) => {
    S.updateSettings({ flashColor: e.target.value });
    paintSwatches();
    flashAlarm(e.target.value);
  };
  screenEl.querySelector('#exportBtn').onclick = () => {
    const blob = new Blob([S.exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kachalka-backup-${S.todayISO()}.json`;
    a.click();
  };
  const fileInput = screenEl.querySelector('#importFile');
  screenEl.querySelector('#importBtn').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        S.importData(reader.result);
        toast(T('Імпортовано'));
        renderSettings(); // показати кнопку «Відмінити»
      } catch (e) {
        alert(e && e.message ? e.message : T('Не вдалося прочитати файл'));
      }
    };
    reader.readAsText(f);
  };
  screenEl.querySelector('#undoBtn')?.addEventListener('click', () => {
    if (S.restoreBackup()) {
      toast(T('Імпорт відмінено'));
      renderSettings();
    }
  });
  screenEl.querySelector('#wipeBtn').onclick = () => {
    if (confirm(T('Стерти всі тренування та повернути стандартні вправи?'))) {
      S.wipeAll(); go('#/today');
    }
  };
}

// =====================================================================
//  ЕКРАН: СПІЛЬНОТА — стрічка фото з тренувань + люди
// =====================================================================
// стиснути фото до maxDim px по більшій стороні (JPEG) — не роздуваємо сховище
function downscalePhoto(file, maxDim = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Не вдалося обробити фото'))), 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не вдалося прочитати фото'));
    };
    img.src = url;
  });
}

// дата допису: «18 лип · 14:05»
function postDate(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const names = dateNames();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${names.monthsShort[d.getMonth()]} · ${hh}:${mm}`;
}

async function renderCommunity() {
  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles">
        <div class="appbar-kicker">👥 ${T('Спільнота')}</div>
        <div class="appbar-title">КАЧАЛКА</div>
      </div>
      <button class="icon-btn" id="myCab" title="${T('Мій кабінет')}">👤</button>
    </header>
    <div id="commBody"><section class="card"><p class="muted">Завантаження…</p></section></div>`;
  screenEl.querySelector('#myCab').onclick = () => go('#/coach');
  const body = () => screenEl.querySelector('#commBody');

  if (communityDemo) return renderCommunityDemo();

  if (!BE.configured) {
    body().innerHTML = `<section class="card"><p class="muted">Сервер ще не підключено (див. backend/SUPABASE_SETUP.md).</p></section>`;
    return;
  }
  let session = null;
  try { session = await BE.getSession(); } catch { /* нижче — запрошення увійти */ }
  if (location.hash !== '#/community') return;

  if (!session) {
    body().innerHTML = `
      <section class="card">
        <div class="card-label">👥 ${T('Спільнота')} КАЧАЛКИ</div>
        <p class="muted">Публікуй фото з тренувань, дивись, як тренуються інші,
        і записуйся на тренування до тренерів.</p>
        <button class="btn primary" id="commLogin">Увійти / Створити акаунт</button>
        <button class="btn ghost" id="commDemo" style="margin-top:8px">👀 Подивитися демо</button>
      </section>`;
    body().querySelector('#commLogin').onclick = () => go('#/coach');
    body().querySelector('#commDemo').onclick = () => { communityDemo = true; renderCommunity(); };
    return;
  }

  let posts = [], people = [], shared = null;
  try {
    [posts, people, shared] = await Promise.all([
      BE.listPosts(),
      BE.listPeople(),
      BE.mySharedTraining().catch(() => null),
    ]);
  } catch (e) {
    if (location.hash !== '#/community') return;
    body().innerHTML = `<section class="card"><p class="muted">⚠️ ${esc(e.message)}</p>
      <p class="muted">Якщо це перший запуск спільноти — власнику треба застосувати
      <b>backend/patch-3-social.sql</b> у Supabase.</p></section>`;
    return;
  }
  if (location.hash !== '#/community') return;
  const meId = session.user.id;
  // якщо ділюся тренуваннями — тихо освіжити знімок останніх 14 днів
  if (shared) BE.shareTraining(S.exportRecentLogs(14)).catch(() => {});

  const postCard = (p) => {
    const a = p.author || {};
    const mine = p.author_id === meId;
    return `<section class="card post-card">
      <div class="post-head">
        <button class="post-user" data-u="${p.author_id}">${avatarHtml(a)}</button>
        <button class="post-author" data-u="${p.author_id}">${esc(a.name || 'Без імені')}</button>
        <span class="post-date muted">${postDate(p.created_at)}</span>
        ${mine ? `<button class="set-del post-del" data-id="${p.id}" data-path="${esc(p.photo_path || '')}" title="${T('Видалити')}">✕</button>` : ''}
      </div>
      <img class="post-img" src="${esc(p.photo_url)}" alt="" loading="lazy"/>
      ${p.caption ? `<p class="post-cap">${esc(p.caption)}</p>` : ''}
    </section>`;
  };
  const personRow = (p) => `
    <button class="pick-row fc-row person-row" data-u="${p.id}">
      ${avatarHtml(p)}
      <span class="pick-name">${esc(p.name || 'Без імені')}${p.city ? ` <span class="muted">· ${esc(p.city)}</span>` : ''}</span>
      ${p.role === 'trainer' ? `<span class="fc-pat">🧑‍🏫 Тренер</span>` : ''}
    </button>`;

  body().innerHTML = `
    <section class="card">
      <div class="wt-head">
        <span class="card-label wt-label">📸 ${T('Фото з тренувань')}</span>
        <button class="wt-current" id="addPost">＋ ${T('Додати фото')}</button>
      </div>
    </section>
    <label class="card share-row">
      <input type="checkbox" id="shareTr" ${shared ? 'checked' : ''}/>
      <span>🏋️ ${T('Ділитися моїми тренуваннями')}</span>
    </label>
    <div class="feed">${posts.length ? posts.map(postCard).join('') : `<p class="muted center">${T('Ще немає дописів — будь першим!')}</p>`}</div>
    <section class="card">
      <div class="card-label">${T('Люди')}</div>
      <div class="pick-list">
        ${people.filter((p) => p.id !== meId).map(personRow).join('') || `<p class="muted">Поки нікого немає.</p>`}
      </div>
    </section>
    <button class="btn ghost" id="commDemo">👀 Подивитися демо (як виглядатиме з людьми)</button>`;
  body().querySelector('#commDemo').onclick = () => { communityDemo = true; renderCommunity(); };

  // переходи на сторінку людини (з допису або списку)
  body().querySelectorAll('[data-u]').forEach((el) =>
    el.addEventListener('click', () => go('#/user/' + el.dataset.u))
  );
  // видалити свій допис
  body().querySelectorAll('.post-del').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Видалити цей допис?')) return;
      try {
        await BE.deletePost({ id: b.dataset.id, photo_path: b.dataset.path });
        toast('Допис видалено');
        renderCommunity();
      } catch (err) { toast('⚠️ ' + err.message); }
    })
  );
  // перемикач «ділитися тренуваннями»
  body().querySelector('#shareTr').onchange = async (e) => {
    try {
      if (e.target.checked) {
        await BE.shareTraining(S.exportRecentLogs(14));
        toast('🏋️ Тепер інші бачать твої тренування');
      } else {
        await BE.unshareTraining();
        toast('Тренування приховано');
      }
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast('⚠️ ' + err.message);
    }
  };
  // новий допис: фото + підпис
  body().querySelector('#addPost').onclick = () => {
    openModal(T('Додати фото'), `
      <div class="field"><label>Фото</label>
        <input type="file" id="postFile" accept="image/*"/></div>
      <div class="field"><label>${T('Підпис (необовʼязково)')}</label>
        <input type="text" id="postCap" maxlength="200" placeholder="Як пройшло тренування?"/></div>
    `, [
      { label: T('Опублікувати'), class: 'primary', onClick: async (root) => {
        const f = root.querySelector('#postFile').files[0];
        if (!f) { toast('Спершу обери фото'); return; }
        toast('Завантажую фото…');
        try {
          const blob = await downscalePhoto(f);
          await BE.addPost(blob, root.querySelector('#postCap').value.trim());
          closeModal();
          toast('📸 Опубліковано!');
          renderCommunity();
        } catch (err) { toast('⚠️ ' + err.message); }
      } },
    ]);
  };
}

// ---- ДЕМО спільноти: вигадані люди й дописи (нічого не пише на сервер) ----
async function renderCommunityDemo() {
  const body = screenEl.querySelector('#commBody');
  const { demoData } = await import('./demo.js');
  if (location.hash !== '#/community' || !communityDemo) return;
  const D = demoData();

  const postCard = (p) => `
    <section class="card post-card">
      <div class="post-head">
        <button class="post-user" data-u="${p.author_id}">${avatarHtml(p.author)}</button>
        <button class="post-author" data-u="${p.author_id}">${esc(p.author.name)}</button>
        <span class="post-date muted">${postDate(p.created_at)}</span>
      </div>
      <img class="post-img" src="${p.photo_url}" alt="" loading="lazy"/>
      ${p.caption ? `<p class="post-cap">${esc(p.caption)}</p>` : ''}
    </section>`;
  const personRow = (p) => `
    <button class="pick-row fc-row person-row" data-u="${p.id}">
      ${avatarHtml(p)}
      <span class="pick-name">${esc(p.name)} <span class="muted">· ${esc(p.city)}</span></span>
      ${p.role === 'trainer' ? `<span class="fc-pat">🧑‍🏫 Тренер</span>` : ''}
    </button>`;

  body.innerHTML = `
    <div class="demo-banner">👀 Це демо — так виглядатиме спільнота з людьми
      <button class="mini" id="demoOff">Вийти</button></div>
    <div class="feed">${D.posts.map(postCard).join('')}</div>
    <section class="card">
      <div class="card-label">${T('Люди')}</div>
      <div class="pick-list">${D.people.map(personRow).join('')}</div>
    </section>`;
  body.querySelector('#demoOff').onclick = () => { communityDemo = false; renderCommunity(); };
  body.querySelectorAll('[data-u]').forEach((el) =>
    el.addEventListener('click', () => go('#/user/' + el.dataset.u))
  );
}

// демо-сторінка людини (профіль/тренування/слоти з demo.js)
async function renderDemoUser(userId) {
  const { demoData } = await import('./demo.js');
  if (!location.hash.startsWith('#/user/')) return;
  const D = demoData();
  const prof = D.byId[userId];
  if (!prof) return go('#/community');
  const titleEl = screenEl.querySelector('#uTitle');
  if (titleEl) titleEl.textContent = prof.name;
  const uBody = screenEl.querySelector('#uBody');
  const posts = D.posts.filter((p) => p.author_id === userId);
  const sharedTr = D.shared[userId];
  const slots = D.slots[userId] || [];
  const slotRow = (s) => {
    const d = new Date(s.starts_at);
    const when = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `<div class="slot-row"><span>🕒 ${when} · ${s.duration_min} хв</span>
      <button class="mini ok demo-book">${T('Записатися')}</button></div>`;
  };
  let trainHtml = '';
  if (sharedTr) {
    const days = Object.keys(sharedTr.data).sort().reverse();
    trainHtml = `<section class="card">
      <div class="card-label">🏋️ ${T('Останні тренування')}</div>
      <div class="bhist">
        ${days.map((iso) => {
          const txt = sharedTr.data[iso].map((it) => `${esc(it.name)} ${it.sets.length}×`).join(', ');
          return `<div class="bhist-row"><span class="bhist-date">${S.prettyDate(iso)}</span>
            <span class="bhist-vals">${txt}</span></div>`;
        }).join('')}
      </div>
    </section>`;
  }
  uBody.innerHTML = `
    <div class="demo-banner">👀 Демо-профіль</div>
    <section class="card profile-card">
      <div class="profile-head">
        ${avatarHtml(prof, true)}
        <div>
          <div class="profile-name">${esc(prof.name)}</div>
          <div class="profile-role">${prof.role === 'trainer' ? '🧑‍🏫 Тренер' : '🏋️ Атлет'} · ${esc(prof.city)}</div>
        </div>
      </div>
      ${D.bios[userId] ? `<p class="profile-bio">${esc(D.bios[userId])}</p>` : ''}
      <div class="btn-row"><button class="btn ghost demo-chat">💬 Написати</button></div>
    </section>
    ${prof.role === 'trainer' ? `<section class="card">
      <div class="card-label">📅 ${T('Записатися на тренування')}</div>
      <div class="slot-list">${slots.map(slotRow).join('')}</div>
    </section>` : ''}
    ${trainHtml}
    ${posts.length ? `<div class="card-label side-label">📸 ${T('Фото з тренувань')}</div>
      <div class="feed">${posts.map((p) => `<section class="card post-card">
        <div class="post-head"><span class="post-date muted">${postDate(p.created_at)}</span></div>
        <img class="post-img" src="${p.photo_url}" alt=""/>
        ${p.caption ? `<p class="post-cap">${esc(p.caption)}</p>` : ''}
      </section>`).join('')}</div>` : ''}
  `;
  uBody.querySelectorAll('.demo-book, .demo-chat').forEach((b) =>
    b.addEventListener('click', () => toast('👀 Це демо-профіль — тут буде справжня дія'))
  );
}

// ---- сторінка людини: профіль, запис до тренера, тренування, дописи ----
async function renderUserProfile(userId) {
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles">
        <div class="appbar-kicker">👥 ${T('Спільнота')}</div>
        <div class="appbar-title" id="uTitle">…</div>
      </div>
    </header>
    <div id="uBody"><section class="card"><p class="muted">Завантаження…</p></section></div>`;
  screenEl.querySelector('#backBtn').onclick = () => go('#/community');
  if (userId.startsWith('demo-')) return renderDemoUser(userId); // демо-профілі — без сервера
  if (!BE.configured) return go('#/community');
  const session = await BE.getSession().catch(() => null);
  if (!session) return go('#/community');

  let prof = null, posts = [], sharedTr = null, slots = [];
  try {
    prof = await BE.getProfile(userId);
    [posts, sharedTr] = await Promise.all([
      BE.listPosts(userId).catch(() => []),
      BE.sharedTrainingOf(userId).catch(() => null),
    ]);
    if (prof.role === 'trainer') {
      slots = await BE.listSlots(userId, new Date().toISOString()).catch(() => []);
    }
  } catch (e) {
    prof = prof || { name: '' };
  }
  if (!location.hash.startsWith('#/user/')) return;
  const uBody = screenEl.querySelector('#uBody');
  const titleEl = screenEl.querySelector('#uTitle');
  if (titleEl) titleEl.textContent = prof.name || 'Без імені';

  const freeSlots = (slots || []).filter((s) => s.status === 'free').slice(0, 8);
  const slotRow = (s) => {
    const d = new Date(s.starts_at);
    const when = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `<div class="slot-row"><span>🕒 ${when} · ${s.duration_min} хв</span>
      <button class="mini ok book-slot" data-id="${s.id}">${T('Записатися')}</button></div>`;
  };

  // «як людина тренується» — якщо відкрила доступ
  let trainHtml = '';
  if (sharedTr && sharedTr.data && Object.keys(sharedTr.data).length) {
    const days = Object.keys(sharedTr.data).sort().reverse().slice(0, 7);
    trainHtml = `<section class="card">
      <div class="card-label">🏋️ ${T('Останні тренування')}</div>
      <div class="bhist">
        ${days.map((iso) => {
          const items = sharedTr.data[iso] || [];
          const txt = items.map((it) => `${esc(it.name)} ${it.sets.length}×`).join(', ');
          return `<div class="bhist-row"><span class="bhist-date">${S.prettyDate(iso)}</span>
            <span class="bhist-vals">${txt}</span></div>`;
        }).join('')}
      </div>
    </section>`;
  }

  uBody.innerHTML = `
    <section class="card profile-card">
      <div class="profile-head">
        ${avatarHtml(prof, true)}
        <div>
          <div class="profile-name">${esc(prof.name || 'Без імені')}</div>
          <div class="profile-role">${prof.role === 'trainer' ? '🧑‍🏫 Тренер' : '🏋️ Атлет'}${prof.city ? ' · ' + esc(prof.city) : ''}</div>
        </div>
      </div>
      ${prof.bio ? `<p class="profile-bio">${esc(prof.bio)}</p>` : ''}
      <div class="btn-row">
        <button class="btn ghost" id="chatBtn">💬 Написати</button>
      </div>
    </section>
    ${prof.role === 'trainer' ? `<section class="card">
      <div class="card-label">📅 ${T('Записатися на тренування')}</div>
      ${freeSlots.length ? `<div class="slot-list">${freeSlots.map(slotRow).join('')}</div>`
        : `<p class="muted">Немає вільних слотів — напиши тренеру в чат.</p>`}
    </section>` : ''}
    ${trainHtml}
    ${posts.length ? `<div class="card-label side-label">📸 ${T('Фото з тренувань')}</div>
      <div class="feed">${posts.map((p) => `<section class="card post-card">
        <div class="post-head"><span class="post-date muted">${postDate(p.created_at)}</span></div>
        <img class="post-img" src="${esc(p.photo_url)}" alt="" loading="lazy"/>
        ${p.caption ? `<p class="post-cap">${esc(p.caption)}</p>` : ''}
      </section>`).join('')}</div>` : ''}
  `;
  uBody.querySelector('#chatBtn').onclick = () => go('#/chat/' + userId);
  uBody.querySelectorAll('.book-slot').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await BE.bookSlot(b.dataset.id, '');
        toast('✅ Заявку надіслано! Тренер підтвердить запис.');
        renderUserProfile(userId);
      } catch (err) {
        b.disabled = false;
        toast('⚠️ ' + err.message);
      }
    })
  );
}

// =====================================================================
//  ЕКРАН: КАБІНЕТ ТРЕНЕРА (бета) — акаунт на сервері
// =====================================================================
function coachShell(inner) {
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">👤 ${T('Мій кабінет')}</div>
        <div class="appbar-title">КАЧАЛКА</div></div>
    </header>
    <div id="coachBody">${inner}</div>`;
  screenEl.querySelector('#backBtn').onclick = () => go('#/community');
}

async function renderCoach() {
  if (!BE.configured) {
    coachShell(`
      <section class="card">
        <div class="card-label">Сервер ще не підключено</div>
        <p class="muted">Кабінет тренера — це записи клієнтів, призначення тренувань і
        контроль прогресу. Для цього потрібен безкоштовний сервер.</p>
        <p class="muted">Власнику: створи проєкт за інструкцією
        <b>backend/SUPABASE_SETUP.md</b> (на ПК) і надішли Claude два рядки —
        Project URL і anon-ключ. Після цього тут з'явиться вхід.</p>
      </section>`);
    return;
  }

  coachShell('<section class="card"><p class="muted">Завантаження…</p></section>');
  let session = null;
  try {
    session = await BE.getSession();
  } catch (e) {
    /* показуємо форму входу */
  }
  if (location.hash !== '#/coach') return; // користувач уже пішов з екрана

  if (!session) {
    coachShell(`
      <section class="card">
        <div class="card-label">Вхід або реєстрація</div>
        <button class="btn google" id="googleBtn"><span class="g-badge">G</span> Увійти через Google</button>
        <div class="or-line"><span>або через пошту</span></div>
        <div class="field"><label>Ім'я (для нових)</label><input type="text" id="cName" placeholder="Як тебе звати"/></div>
        <div class="field"><label>Пошта</label><input type="email" id="cEmail" inputmode="email" autocomplete="email"/></div>
        <div class="field"><label>Пароль (від 6 символів)</label><input type="password" id="cPass" autocomplete="current-password"/></div>
        <div class="btn-row">
          <button class="btn primary" id="loginBtn">Увійти</button>
          <button class="btn ghost" id="signupBtn">Зареєструватися</button>
        </div>
        <p class="muted" id="authMsg"></p>
      </section>`);
    const msg = (t2) => { const el = screenEl.querySelector('#authMsg'); if (el) el.textContent = t2; };
    screenEl.querySelector('#googleBtn').onclick = async () => {
      msg('Відкриваю Google…');
      try {
        await BE.signInWithGoogle(); // перенаправить на сторінку Google
      } catch (e) { msg('⚠️ ' + e.message); }
    };
    const getCreds = () => ({
      name: screenEl.querySelector('#cName').value.trim(),
      email: screenEl.querySelector('#cEmail').value.trim(),
      pass: screenEl.querySelector('#cPass').value,
    });
    screenEl.querySelector('#loginBtn').onclick = async () => {
      const { email, pass } = getCreds();
      if (!email || !pass) return msg('Вкажи пошту і пароль');
      msg('Входжу…');
      try {
        await BE.signIn(email, pass);
        renderCoach();
      } catch (e) { msg('⚠️ ' + e.message); }
    };
    screenEl.querySelector('#signupBtn').onclick = async () => {
      const { name, email, pass } = getCreds();
      if (!email || !pass) return msg('Вкажи пошту і пароль');
      msg('Реєструю…');
      try {
        const data = await BE.signUp(email, pass, name);
        if (data.session) renderCoach();
        else msg('📧 Перевір пошту й підтверди реєстрацію, потім натисни «Увійти».');
      } catch (e) { msg('⚠️ ' + e.message); }
    };
    return;
  }

  // --- увійшли: профіль ---
  let prof = null;
  try {
    prof = await BE.getMyProfile();
  } catch (e) {
    coachShell(`<section class="card"><p class="muted">⚠️ ${esc(e.message)}</p></section>`);
    return;
  }
  if (location.hash !== '#/coach') return;
  // якщо профіль порожній (щойно зареєструвався) — одразу форма
  if (!prof.name) coachEdit = true;
  if (coachEdit) renderProfileEdit(prof, session);
  else renderProfileView(prof, session);
}

// кружечок аватарки: фото або ініціал
function avatarHtml(prof, big) {
  const cls = big ? 'avatar avatar-lg' : 'avatar';
  if (prof.avatar_url) return `<span class="${cls}" style="background-image:url('${esc(prof.avatar_url)}')"></span>`;
  const ini = (prof.name || '?').trim().charAt(0).toUpperCase();
  return `<span class="${cls}">${esc(ini)}</span>`;
}

// профіль — режим ПЕРЕГЛЯДУ (як у соцмережі)
function renderProfileView(prof, session) {
  const roleLabel = prof.role === 'trainer' ? '🧑‍🏫 Тренер' : '🏋️ Клієнт';
  coachShell(`
    <section class="card profile-card">
      <div class="profile-head">
        ${avatarHtml(prof, true)}
        <div class="profile-id">
          <div class="profile-name">${esc(prof.name || 'Без імені')}</div>
          <div class="profile-role">${roleLabel}${prof.city ? ' · 📍 ' + esc(prof.city) : ''}</div>
        </div>
      </div>
      ${prof.bio ? `<p class="profile-bio">${esc(prof.bio)}</p>` : ''}
      ${prof.contact ? `<p class="profile-contact">📞 ${esc(prof.contact)}</p>` : ''}
      <div class="profile-meta muted">${esc(session.user.email || '')}</div>
      <button class="btn primary" id="editProf">✏️ Редагувати профіль</button>
      <button class="btn ghost" id="logoutBtn">Вийти з акаунта</button>
    </section>
    <div id="roleArea"></div>`);
  screenEl.querySelector('#editProf').onclick = () => { coachEdit = true; renderCoach(); };
  screenEl.querySelector('#logoutBtn').onclick = async () => { await BE.signOut(); renderCoach(); };
  renderCoachRole(prof);
}

// профіль — режим РЕДАГУВАННЯ (форма)
function renderProfileEdit(prof, session) {
  const nameVal = prof.name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
  coachShell(`
    <section class="card">
      <div class="card-label">Редагування профілю <span class="muted">· ${esc(session.user.email || '')}</span></div>
      <div class="avatar-edit">
        <span id="avatarPreview">${avatarHtml({ ...prof, name: nameVal }, true)}</span>
        <button class="btn ghost" id="pickAvatar">📷 Фото</button>
        <input type="file" id="avatarFile" accept="image/*" hidden/>
      </div>
      <div class="field"><label>Роль</label>
        <div class="type-chips" style="margin-top:6px">
          <button class="tchip ${prof.role === 'trainer' ? 'on' : ''}" data-role="trainer">🧑‍🏫 Тренер</button>
          <button class="tchip ${prof.role !== 'trainer' ? 'on' : ''}" data-role="client">🏋️ Клієнт</button>
        </div>
      </div>
      <div class="field"><label>Ім'я</label><input type="text" id="pName" value="${esc(nameVal)}"/></div>
      <div class="field"><label>Місто</label><input type="text" id="pCity" value="${esc(prof.city || '')}"/></div>
      <div class="field"><label>Про себе</label><input type="text" id="pBio" value="${esc(prof.bio || '')}" placeholder="Досвід, спеціалізація…"/></div>
      <div class="field"><label>Контакт (телефон/Telegram)</label><input type="text" id="pContact" value="${esc(prof.contact || '')}"/></div>
      <button class="btn primary" id="saveProf">Зберегти</button>
      ${prof.name ? '<button class="btn ghost" id="cancelEdit">Скасувати</button>' : ''}
    </section>`);
  let role = prof.role || 'client';
  screenEl.querySelectorAll('.tchip[data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      role = b.dataset.role;
      screenEl.querySelectorAll('.tchip[data-role]').forEach((c) => c.classList.toggle('on', c === b));
    })
  );
  const fileInput = screenEl.querySelector('#avatarFile');
  screenEl.querySelector('#pickAvatar').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return alert('Фото завелике (макс. 3 МБ)');
    toast('Завантаження фото…');
    try {
      const url = await BE.uploadAvatar(f);
      prof.avatar_url = url;
      screenEl.querySelector('#avatarPreview').innerHTML = avatarHtml(prof, true);
      toast('Фото оновлено');
    } catch (e) { alert('⚠️ ' + e.message); }
  };
  screenEl.querySelector('#saveProf').onclick = async () => {
    try {
      const patch = {
        role,
        name: screenEl.querySelector('#pName').value.trim(),
        city: screenEl.querySelector('#pCity').value.trim(),
        bio: screenEl.querySelector('#pBio').value.trim(),
        contact: screenEl.querySelector('#pContact').value.trim(),
      };
      await BE.saveMyProfile(patch);
      Object.assign(prof, patch);
      toast(T('Збережено'));
      coachEdit = false;
      renderCoach();
    } catch (e) { alert('⚠️ ' + e.message); }
  };
  screenEl.querySelector('#cancelEdit')?.addEventListener('click', () => { coachEdit = false; renderCoach(); });
}

// дата+час у людський вигляд «Пн, 7 лип · 18:30»
function prettyDateTime(iso) {
  const d = new Date(iso);
  const names = dateNames();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${names.dows[d.getDay()]}, ${d.getDate()} ${names.monthsShort[d.getMonth()]} · ${hh}:${mm}`;
}
// дні тижня для програм (JS getDay: 0=Нд); порядок Пн→Нд
const WEEKDAYS = [
  { d: 1, label: 'Пн' }, { d: 2, label: 'Вт' }, { d: 3, label: 'Ср' },
  { d: 4, label: 'Чт' }, { d: 5, label: 'Пт' }, { d: 6, label: 'Сб' }, { d: 0, label: 'Нд' },
];
function weekdaysLabel(arr) {
  if (!arr || !arr.length) return 'будь-коли';
  return WEEKDAYS.filter((w) => arr.includes(w.d)).map((w) => w.label).join(', ');
}
const BK_STATUS = {
  requested: '⏳ очікує',
  confirmed: '✅ підтверджено',
  declined: '✕ відхилено',
  cancelled: '✕ скасовано',
  done: '🏁 завершено',
};

// секції кабінету залежно від ролі
async function renderCoachRole(prof) {
  const area = () => screenEl.querySelector('#roleArea');
  if (!area()) return;
  if (prof.role === 'trainer') {
    area().innerHTML = `
      <section class="card"><div class="card-label">📅 Мій розклад</div>
        <div class="field"><label>Тривалість заняття (яку задаю я)</label>
          <div class="type-chips" id="durChips" style="margin-top:6px">
            ${[15, 30, 60, 90, 120].map((m) => `<button class="tchip ${m === 60 ? 'on' : ''}" data-dur="${m}">${durLabel(m)}</button>`).join('')}
          </div>
        </div>
        <div class="day-strip" id="dayStrip"></div>
        <p class="muted side" style="margin:8px 4px">Обери день → торкайся вільних годин, щоб відкрити запис. Клієнт зможе записатися лише на позначені години й саме на цю тривалість.</p>
        <div id="hourGrid" class="hour-grid"><p class="muted">Завантаження…</p></div>
      </section>
      <section class="card"><div class="card-label">🔔 Заявки на тренування</div>
        <div id="reqList"><p class="muted">Завантаження…</p></div>
      </section>
      <section class="card"><div class="card-label">👥 Мої клієнти</div>
        <div id="clientList"><p class="muted">Завантаження…</p></div>
      </section>`;
    wireTrainerSlots(prof);
    wireTrainerRequests(prof);
    wireTrainerClients();
  } else {
    area().innerHTML = `
      <section class="card"><div class="card-label">🧑‍🏫 Знайти тренера й записатися</div>
        <div id="trainerList"><p class="muted">Завантаження…</p></div>
      </section>
      <section class="card"><div class="card-label">📋 Мої записи</div>
        <div id="myBookings"><p class="muted">Завантаження…</p></div>
      </section>
      <section class="card"><div class="card-label">🏋️ Програми від тренера</div>
        <div id="myPrograms"><p class="muted">Завантаження…</p></div>
        <button class="btn ghost" id="shareProgress" style="margin-top:10px">📤 Поділитися прогресом із тренером</button>
      </section>`;
    wireClientTrainers();
    wireClientBookings();
    wireClientPrograms();
  }
}

// підпис тривалості: 15→«15 хв», 60→«1 год», 90→«1,5 год», 120→«2 год»
function durLabel(m) {
  if (m < 60) return `${m} хв`;
  if (m % 60 === 0) return `${m / 60} год`;
  return `${(m / 60).toFixed(1).replace('.', ',')} год`;
}
const SLOT_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
function localISO(dayISO, hour) {
  const [y, m, d] = dayISO.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
}

async function wireTrainerSlots(prof) {
  let selDur = 60;
  let selDay = S.todayISO();
  let all = [];

  const load = async () => {
    try { all = await BE.listSlots(prof.id, S.isoToDate(S.todayISO()).toISOString()); }
    catch (e) { all = []; }
  };

  const renderDayStrip = () => {
    const strip = screenEl.querySelector('#dayStrip');
    if (!strip) return;
    const names = dateNames();
    let html = '';
    for (let i = 0; i < 14; i++) {
      const d = S.isoToDate(S.todayISO());
      d.setDate(d.getDate() + i);
      const iso = S.dateToISO(d);
      const cnt = all.filter((s) => S.dateToISO(new Date(s.starts_at)) === iso).length; // за локальною датою (як і сітка)
      html += `<button class="day-chip ${iso === selDay ? 'on' : ''}" data-d="${iso}">
        <span class="dc-dow">${names.dows[d.getDay()]}</span><span class="dc-num">${d.getDate()}</span>
        ${cnt ? `<span class="dc-dot">${cnt}</span>` : ''}</button>`;
    }
    strip.innerHTML = html;
    strip.querySelectorAll('.day-chip').forEach((b) =>
      b.addEventListener('click', () => { selDay = b.dataset.d; renderDayStrip(); renderHours(); })
    );
  };

  const renderHours = () => {
    const grid = screenEl.querySelector('#hourGrid');
    if (!grid) return;
    grid.innerHTML = SLOT_HOURS.map((h) => {
      // слот, що починається в цю годину цього дня
      const slot = all.find((s) => {
        const t = new Date(s.starts_at);
        return S.dateToISO(t) === selDay && t.getHours() === h;
      });
      const hh = String(h).padStart(2, '0') + ':00';
      if (slot) {
        const booked = slot.status === 'booked';
        return `<div class="hour-row ${booked ? 'booked' : 'open'}" data-id="${slot.id}" data-free="${!booked}">
          <span class="hr-time">${hh}</span>
          <span class="hr-info">${booked ? '🔒 зайнято' : '🟢 відкрито'} · ${durLabel(slot.duration_min)}</span>
          ${booked ? '' : '<span class="hr-x">✕</span>'}
        </div>`;
      }
      return `<div class="hour-row empty" data-h="${h}"><span class="hr-time">${hh}</span><span class="hr-info muted">+ відкрити (${durLabel(selDur)})</span></div>`;
    }).join('');
    grid.querySelectorAll('.hour-row').forEach((row) => {
      row.addEventListener('click', async () => {
        try {
          if (row.classList.contains('empty')) {
            await BE.addSlot(localISO(selDay, +row.dataset.h), selDur);
          } else if (row.dataset.free === 'true') {
            await BE.deleteSlot(+row.dataset.id);
          } else {
            return; // зайнятий — не чіпаємо
          }
          await load();
          renderDayStrip();
          renderHours();
        } catch (e) { alert('⚠️ ' + e.message); }
      });
    });
  };

  screenEl.querySelectorAll('#durChips [data-dur]').forEach((b) =>
    b.addEventListener('click', () => {
      selDur = +b.dataset.dur;
      screenEl.querySelectorAll('#durChips [data-dur]').forEach((c) => c.classList.toggle('on', c === b));
      renderHours();
    })
  );

  await load();
  renderDayStrip();
  renderHours();
}

async function wireTrainerRequests(prof) {
  try {
    const rows = await BE.bookingsAsTrainer();
    const el = screenEl.querySelector('#reqList');
    if (!el) return;
    el.innerHTML = rows.length
      ? rows
          .map(
            (b) => `<div class="req-row">
              <div><b>${esc(b.client?.name || 'Клієнт')}</b> — ${b.slot ? prettyDateTime(b.slot.starts_at) : ''}
                <div class="muted">${BK_STATUS[b.status] || b.status}${b.client?.contact ? ' · ' + esc(b.client.contact) : ''}</div>
                ${b.note ? `<div class="muted">«${esc(b.note)}»</div>` : ''}</div>
              <div class="req-actions">
                <button class="mini" data-msg="${b.client_id}" title="Написати">💬</button>
                ${b.status === 'requested'
                  ? `<button class="mini ok" data-ok="${b.id}">✓</button><button class="mini danger" data-no="${b.id}">✕</button>`
                  : b.status === 'confirmed'
                  ? `<button class="mini" data-done="${b.id}">🏁</button>`
                  : ''}
              </div>
            </div>`
          )
          .join('')
      : '<p class="muted">Заявок поки немає.</p>';
    const act = async (id, st) => { try { await BE.setBookingStatus(id, st); wireTrainerRequests(prof); } catch (e) { alert('⚠️ ' + e.message); } };
    el.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => act(+b.dataset.ok, 'confirmed')));
    el.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => act(+b.dataset.no, 'declined')));
    el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => act(+b.dataset.done, 'done')));
    el.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', () => go('#/chat/' + b.dataset.msg)));
  } catch (e) {
    if (screenEl.querySelector('#reqList')) screenEl.querySelector('#reqList').innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
  }
}

async function wireClientTrainers() {
  try {
    const trainers = await BE.listTrainers();
    const el = screenEl.querySelector('#trainerList');
    if (!el) return;
    el.innerHTML = trainers.length
      ? trainers
          .map(
            (tr) => `<button class="ex-card" data-tr="${tr.id}">
              <span class="ex-ico"><span class="glyph">🧑‍🏫</span></span>
              <span class="ex-main"><span class="ex-name">${esc(tr.name || 'Тренер')}</span>
                <span class="ex-sub">${esc(tr.city || '')}${tr.bio ? ' · ' + esc(tr.bio) : ''}</span></span>
              <span class="chev">›</span></button>`
          )
          .join('')
      : '<p class="muted">Поки немає тренерів у каталозі.</p>';
    el.querySelectorAll('[data-tr]').forEach((b) => b.addEventListener('click', () => openTrainerBooking(b.dataset.tr)));
  } catch (e) {
    if (screenEl.querySelector('#trainerList')) screenEl.querySelector('#trainerList').innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
  }
}

async function openTrainerBooking(trainerId) {
  let slots = [];
  try {
    slots = (await BE.listSlots(trainerId, new Date().toISOString())).filter((s) => s.status === 'free');
  } catch (e) { return alert('⚠️ ' + e.message); }
  const body = slots.length
    ? `<p class="muted">Обери вільний час:</p><div class="slot-list">${slots
        .map((s) => `<label class="pick-row"><input type="radio" name="slot" value="${s.id}"/><span class="pick-name">${prettyDateTime(s.starts_at)} · ${s.duration_min} хв</span></label>`)
        .join('')}</div>
      <div class="field" style="margin-top:10px"><label>Коментар (необов'язково)</label><input type="text" id="bkNote" placeholder="Напр. перше тренування"/></div>`
    : '<p class="muted">У цього тренера поки немає вільних слотів.</p>';
  openModal('Запис на тренування', body, slots.length ? [
    { label: 'Записатися', class: 'primary', onClick: async (root) => {
      const sel = root.querySelector('input[name="slot"]:checked');
      if (!sel) return;
      try {
        await BE.bookSlot(+sel.value, root.querySelector('#bkNote').value.trim());
        closeModal();
        toast('Заявку надіслано ✅');
        wireClientBookings();
      } catch (e) { alert('⚠️ ' + e.message); }
    } },
  ] : []);
}

async function wireClientBookings() {
  try {
    const rows = await BE.bookingsAsClient();
    const el = screenEl.querySelector('#myBookings');
    if (!el) return;
    el.innerHTML = rows.length
      ? rows
          .map(
            (b) => `<div class="req-row">
              <div><b>${esc(b.trainer?.name || 'Тренер')}</b> — ${b.slot ? prettyDateTime(b.slot.starts_at) : ''}
                <div class="muted">${BK_STATUS[b.status] || b.status}${b.status === 'confirmed' && b.trainer?.contact ? ' · ' + esc(b.trainer.contact) : ''}</div></div>
              <div class="req-actions">
                <button class="mini" data-msg="${b.trainer_id}" title="Написати">💬</button>
                ${b.status === 'requested' || b.status === 'confirmed' ? `<button class="mini danger" data-cancel="${b.id}">Скасувати</button>` : ''}
              </div>
            </div>`
          )
          .join('')
      : '<p class="muted">Ти ще нікуди не записаний.</p>';
    el.querySelectorAll('[data-cancel]').forEach((b) =>
      b.addEventListener('click', async () => { try { await BE.setBookingStatus(+b.dataset.cancel, 'cancelled'); wireClientBookings(); } catch (e) { alert('⚠️ ' + e.message); } })
    );
    el.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', () => go('#/chat/' + b.dataset.msg)));
  } catch (e) {
    if (screenEl.querySelector('#myBookings')) screenEl.querySelector('#myBookings').innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
  }
}

// список клієнтів тренера
async function wireTrainerClients() {
  try {
    const clients = await BE.myClients();
    const el = screenEl.querySelector('#clientList');
    if (!el) return;
    el.innerHTML = clients.length
      ? clients
          .map(
            (c) => `<button class="ex-card" data-c="${c.id}">
              <span class="ex-ico"><span class="glyph">🏋️</span></span>
              <span class="ex-main"><span class="ex-name">${esc(c.name)}</span>
                <span class="ex-sub">програми · прогрес · чат</span></span>
              <span class="chev">›</span></button>`
          )
          .join('')
      : '<p class="muted">Клієнти зʼявляться тут після їхніх записів до тебе.</p>';
    el.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => go('#/client/' + b.dataset.c)));
  } catch (e) {
    if (screenEl.querySelector('#clientList')) screenEl.querySelector('#clientList').innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
  }
}

// програми клієнта від тренера + поділитися прогресом
async function wireClientPrograms() {
  let rows = [];
  try {
    rows = await BE.myAssignments();
    const el = screenEl.querySelector('#myPrograms');
    if (el)
      el.innerHTML = rows.length
        ? rows
            .map((a) => {
              const n = (a.workout_json || []).length;
              return `<div class="req-row">
                <div><b>${esc(a.title)}</b> <span class="muted">· ${esc(a.trainer?.name || 'тренер')}</span>
                  <div class="muted">📅 ${weekdaysLabel(a.weekdays)} · ${n} ${plural(n, 'вправа', 'вправи', 'вправ')}</div></div>
                <button class="mini ok" data-imp="${a.id}" title="Додати в щоденник">＋</button>
              </div>`;
            })
            .join('')
        : '<p class="muted">Тренер ще не призначив програму.</p>';
    el?.querySelectorAll('[data-imp]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = rows.find((x) => String(x.id) === b.dataset.imp);
        if (!a) return;
        S.importWorkoutFromPlan(a.title, a.workout_json);
        toast('Додано в щоденник ✅');
      })
    );
  } catch (e) {
    if (screenEl.querySelector('#myPrograms')) screenEl.querySelector('#myPrograms').innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
  }
  screenEl.querySelector('#shareProgress')?.addEventListener('click', async () => {
    try {
      if (!rows.length) rows = await BE.myAssignments();
      const trainerId = rows[0]?.trainer_id;
      if (!trainerId) return toast('Спершу тренер має призначити програму');
      const logs = S.exportRecentLogs(21);
      const n = await BE.pushLogs(logs, trainerId);
      toast(n ? `Надіслано днів: ${n} ✅` : 'Немає записів за останні 3 тижні');
    } catch (e) { alert('⚠️ ' + e.message); }
  });
}

// =====================================================================
//  ЕКРАН: КЕРУВАННЯ КЛІЄНТОМ (тренер призначає програму й бачить прогрес)
// =====================================================================
async function renderClientManage(clientId) {
  if (!BE.configured) return go('#/coach');
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backC">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">Клієнт</div><div class="appbar-title" id="cName">…</div></div>
      <button class="icon-btn" id="msgC" title="Написати">💬</button>
    </header>
    <section class="card"><div class="card-label">➕ Призначити програму</div>
      <div class="field"><label>Тренування (з моїх)</label><select id="asgW" class="sel"></select></div>
      <div class="field"><label>Назва програми</label><input type="text" id="asgTitle" placeholder="Напр. Важкий день"/></div>
      <div class="field"><label>Дні тижня</label>
        <div class="type-chips" id="asgDays" style="margin-top:6px">
          ${WEEKDAYS.map((w) => `<button class="tchip" data-wd="${w.d}">${w.label}</button>`).join('')}
        </div></div>
      <button class="btn primary" id="asgBtn">Призначити</button>
    </section>
    <section class="card"><div class="card-label">Призначені програми</div><div id="asgList"><p class="muted">…</p></div></section>
    <section class="card"><div class="card-label">📈 Прогрес клієнта</div><div id="logList"><p class="muted">…</p></div></section>`;
  screenEl.querySelector('#backC').onclick = () => go('#/coach');
  screenEl.querySelector('#msgC').onclick = () => go('#/chat/' + clientId);
  try {
    const p = await BE.getProfile(clientId);
    const nm = screenEl.querySelector('#cName');
    if (nm) nm.textContent = p.name || 'Клієнт';
  } catch (e) {}

  const myW = S.getWorkouts();
  const sel = screenEl.querySelector('#asgW');
  sel.innerHTML = myW.length
    ? myW.map((w) => `<option value="${w.id}">${esc(w.name)} (${w.items.length})</option>`).join('')
    : '<option value="">— спершу створи тренування —</option>';
  const titleInp = screenEl.querySelector('#asgTitle');
  if (myW[0]) titleInp.value = myW[0].name;
  sel.onchange = () => { titleInp.value = S.getWorkout(sel.value)?.name || ''; };
  const days = new Set();
  screenEl.querySelectorAll('#asgDays [data-wd]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = +b.dataset.wd;
      if (days.has(d)) { days.delete(d); b.classList.remove('on'); }
      else { days.add(d); b.classList.add('on'); }
    })
  );
  screenEl.querySelector('#asgBtn').onclick = async () => {
    const w = S.getWorkout(sel.value);
    if (!w) return toast('Немає тренування — створи у вкладці «Тренування»');
    const exList = w.items
      .map((id) => S.getExercise(id))
      .filter(Boolean)
      .map((e) => ({ name: e.name, icon: e.icon, weightType: e.weightType, weight: e.weight, targetSets: e.targetSets, targetReps: e.targetReps, muscle: e.muscle }));
    try {
      await BE.assignWorkout({ clientId, title: titleInp.value.trim() || w.name, workoutJson: exList, weekdays: [...days] });
      toast('Програму призначено ✅');
      loadAsg();
    } catch (e) { alert('⚠️ ' + e.message); }
  };

  const loadAsg = async () => {
    try {
      const rows = await BE.assignmentsForClient(clientId);
      const el = screenEl.querySelector('#asgList');
      if (!el) return;
      el.innerHTML = rows.length
        ? rows
            .map((a) => `<div class="req-row"><div><b>${esc(a.title)}</b>
              <div class="muted">📅 ${weekdaysLabel(a.weekdays)} · ${(a.workout_json || []).length} вправ</div></div>
              <button class="mini danger" data-del="${a.id}">✕</button></div>`)
            .join('')
        : '<p class="muted">Ще нічого не призначено.</p>';
      el.querySelectorAll('[data-del]').forEach((b) =>
        b.addEventListener('click', async () => { try { await BE.deleteAssignment(+b.dataset.del); loadAsg(); } catch (e) { alert('⚠️ ' + e.message); } })
      );
    } catch (e) {
      const el = screenEl.querySelector('#asgList');
      if (el) el.innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
    }
  };
  const loadLogs = async () => {
    try {
      const rows = await BE.clientLogs(clientId);
      const el = screenEl.querySelector('#logList');
      if (!el) return;
      el.innerHTML = rows.length
        ? rows
            .map((r) => {
              const items = (r.log_json || [])
                .map((it) => {
                  const reps = (it.sets || []).map((s) => s.reps).join('/');
                  const w = it.weightType !== 'bodyweight' && it.sets && it.sets.length ? ' · ' + Math.max(...it.sets.map((s) => s.weight || 0)) + 'кг' : '';
                  return `${esc(it.name)}: ${reps}${w}`;
                })
                .join('<br>');
              return `<div class="req-row"><div><b>${S.prettyDate(r.day_iso)}</b><div class="muted">${items}</div></div></div>`;
            })
            .join('')
        : '<p class="muted">Клієнт ще не поділився прогресом (він тисне «📤 Поділитися прогресом» у себе).</p>';
    } catch (e) {
      const el = screenEl.querySelector('#logList');
      if (el) el.innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
    }
  };
  loadAsg();
  loadLogs();
}

// =====================================================================
//  ЕКРАН: ЧАТ
// =====================================================================
async function renderChat(otherId) {
  if (!BE.configured) return go('#/coach');
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backChat">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">Повідомлення</div>
        <div class="appbar-title" id="chatName">…</div></div>
      <button class="icon-btn" id="refreshChat" title="Оновити">↻</button>
    </header>
    <div class="chat-log" id="chatLog"><p class="muted center">Завантаження…</p></div>
    <div class="chat-input">
      <input type="text" id="chatText" placeholder="Напиши повідомлення…" autocomplete="off"/>
      <button class="btn primary" id="chatSend">▶</button>
    </div>`;
  screenEl.querySelector('#backChat').onclick = () => history.back();

  let me = null;
  try { me = await BE.myId(); } catch (e) {}
  if (!me) return go('#/coach');

  try {
    const p = await BE.getProfile(otherId);
    const nm = screenEl.querySelector('#chatName');
    if (nm) nm.textContent = p.name || 'Співрозмовник';
  } catch (e) {}

  const load = async () => {
    try {
      const msgs = await BE.listMessages(otherId);
      const log = screenEl.querySelector('#chatLog');
      if (!log) return;
      log.innerHTML = msgs.length
        ? msgs
            .map((m) => `<div class="bubble ${m.from_id === me ? 'mine' : 'their'}">${esc(m.text)}</div>`)
            .join('')
        : '<p class="muted center">Повідомлень ще немає. Напиши першим 👋</p>';
      log.scrollTop = log.scrollHeight;
    } catch (e) {
      const log = screenEl.querySelector('#chatLog');
      if (log) log.innerHTML = `<p class="muted center">⚠️ ${esc(e.message)}</p>`;
    }
  };

  const send = async () => {
    const inp = screenEl.querySelector('#chatText');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    try { await BE.sendMessage(otherId, text); await load(); }
    catch (e) { alert('⚠️ ' + e.message); }
  };
  screenEl.querySelector('#chatSend').onclick = send;
  screenEl.querySelector('#chatText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
  screenEl.querySelector('#refreshChat').onclick = load;
  await load();

  // realtime: нові повідомлення від співрозмовника з'являються самі
  const sub = await BE.subscribeMessages(otherId, (m) => {
    const log = screenEl.querySelector('#chatLog');
    if (!log) return;
    if (log.querySelector('.muted')) { load(); return; } // прибрати «Повідомлень ще немає»
    const d = document.createElement('div');
    d.className = 'bubble their';
    d.textContent = m.text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  });
  // якщо за час підключення користувач уже пішов з чату — одразу відписатися
  if (location.hash === '#/chat/' + otherId) live.chat = sub;
  else sub.destroy();
}

// =====================================================================
//  ЕКРАН: АНАЛІЗ ТЕХНІКИ (вибір вправи для камери)
// =====================================================================
function renderFormcheck() {
  const exs = S.getExercises();
  const rows = exs
    .map((e) => {
      const p = FC.patternById(FC.guessPattern(e));
      return `<button class="pick-row fc-row" data-id="${e.id}">
        <span class="pick-ico">${exIconHTML(e) || e.icon}</span>
        <span class="pick-name">${esc(e.name)}</span>
        <span class="fc-pat">${patternIconHTML(p.id)} ${T(p.label)}</span></button>`;
    })
    .join('');
  const kcalToday = S.calorieDayTotal(S.todayISO()).kcal;
  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles"><div class="appbar-kicker">📷 ${T('Аналіз')}</div>
        <div class="appbar-title">КАЧАЛКА</div></div>
    </header>

    <p class="muted side">🍎 ${T('Їжа')}</p>
    <div class="pick-list" style="margin-bottom:16px">
      <button class="pick-row fc-row" id="fcCalories">
        <span class="pick-ico">🍎</span>
        <span class="pick-name">${T('Калорії по фото')}</span>
        <span class="fc-pat">${kcalToday} ${T('ккал')} ›</span>
      </button>
    </div>

    <p class="muted side">🏋️ ${T('Аналіз техніки')} — ${T('Обери вправу — камера стежитиме за технікою, підкаже глибину і порахує повторення')}</p>
    <div class="pick-list">${rows || `<p class="muted center">${T('Немає тренувань — додай у вкладці «Тренування»')}</p>`}</div>`;
  screenEl.querySelector('#fcCalories').onclick = () => go('#/calories');
  screenEl.querySelectorAll('.fc-row[data-id]').forEach((b) =>
    b.addEventListener('click', () => go('#/camera/' + b.dataset.id))
  );
}

// =====================================================================
//  ЕКРАН: КАЛОРІЇ ПО ФОТО
// =====================================================================
let kcalKeyEdit = false;
async function renderCalories() {
  const iso = selectedISO;
  const st = S.getSettings();
  const key = (st.geminiKey || '').trim();
  const list = S.caloriesForDay(iso);
  const tot = S.calorieDayTotal(iso);
  // сервер власника (ключ-секрет на Supabase) — тоді користувачу ключ не потрібен
  const proxyOk = key ? false : await CAL.proxyAvailable();
  if (location.hash !== '#/calories') return; // за час перевірки пішли з екрана
  const canAnalyze = !!key || proxyOk;
  const showKeyForm = kcalKeyEdit || !canAnalyze;

  const rows = list
    .map(
      (e) => `<div class="kcal-row"><span class="kcal-nm">${esc(e.name)}</span>
        <b>${e.kcal} ${T('ккал')}</b>
        <button class="icon-btn kcal-del" data-id="${e.id}">✕</button></div>`
    )
    .join('');

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backKcal">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">🍎 ${T('Калорії по фото')}</div>
        <div class="appbar-title">${S.prettyDate(iso)}</div></div>
      <button class="icon-btn" id="keyBtn" title="${T('Ключ API (ChatGPT або Gemini)')}">🔑</button>
    </header>

    ${showKeyForm
      ? `<section class="card">
          <div class="card-label">🔑 ${T('Ключ API (ChatGPT або Gemini)')}</div>
          <p class="muted hint">${T('Встав ключ OpenAI (ChatGPT) з platform.openai.com/api-keys — потрібен невеликий баланс на API, фото коштує копійки. Або безкоштовний ключ Google Gemini з aistudio.google.com/apikey. Застосунок сам розпізнає, який це ключ; зберігається він лише на цьому пристрої.')}</p>
          <div class="btn-col" style="margin-top:12px">
            <a class="btn ghost" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">🤖 OpenAI (ChatGPT): platform.openai.com/api-keys</a>
            <a class="btn ghost" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">🌐 Gemini (${T('безкоштовно')}): aistudio.google.com/apikey</a>
          </div>
          <div class="field" style="margin-top:10px">
            <input type="password" id="gemKey" value="${esc(key)}" placeholder="sk-… / AIza…" autocomplete="off"/>
          </div>
          <div class="btn-col" style="margin-top:10px">
            <button class="btn primary" id="saveKey">${T('Зберегти ключ')}</button>
          </div>
        </section>`
      : ''}

    ${canAnalyze && !showKeyForm
      ? `<section class="card">
          <div class="card-label">📷 ${T('Нова страва')}</div>
          <p class="muted hint">${T('Сфотографуй страву — ШІ оцінить калорійність і БЖВ')}</p>
          <div class="btn-row">
            <button class="btn ghost" id="snapBtn">📷 ${T('Сфотографувати страву')}</button>
            <button class="btn ghost" id="galBtn">🖼 ${T('З галереї')}</button>
          </div>
          <input type="file" id="foodCam" accept="image/*" capture="environment" hidden/>
          <input type="file" id="foodGal" accept="image/*" hidden/>
          <div id="analyzeBox"></div>
        </section>`
      : ''}

    <section class="card">
      <div class="card-label">${T('Зʼїдено за день')}</div>
      ${list.length ? rows : `<p class="muted">${T('Записів ще немає')}</p>`}
      <div class="card-div"></div>
      <div class="kcal-total"><b>${T('Разом')}: ${tot.kcal} ${T('ккал')}</b>
        <span class="muted">${T('Б')} ${tot.prot} · ${T('Ж')} ${tot.fat} · ${T('В')} ${tot.carb} г</span></div>
    </section>`;

  screenEl.querySelector('#backKcal').onclick = () => history.back();
  screenEl.querySelector('#keyBtn').onclick = () => { kcalKeyEdit = !kcalKeyEdit; renderCalories(); };

  const saveKeyBtn = screenEl.querySelector('#saveKey');
  if (saveKeyBtn)
    saveKeyBtn.onclick = () => {
      S.updateSettings({ geminiKey: screenEl.querySelector('#gemKey').value.trim() });
      kcalKeyEdit = false;
      toast(T('Збережено'));
      renderCalories();
    };

  screenEl.querySelectorAll('.kcal-del').forEach((b) =>
    b.addEventListener('click', () => { S.deleteCalorieEntry(iso, b.dataset.id); renderCalories(); })
  );

  const box = () => screenEl.querySelector('#analyzeBox');
  const analyze = async (file) => {
    if (!file || !box()) return;
    const url = URL.createObjectURL(file);
    box().innerHTML = `<img class="food-prev" src="${url}" alt=""/><p class="muted center">🔎 ${T('Аналізую…')}</p>`;
    try {
      const r = await CAL.analyzeFoodPhoto(file, key, S.getSettings().lang);
      if (!box()) return; // користувач уже пішов з екрана
      if (!r.isFood) {
        box().innerHTML = `<img class="food-prev" src="${url}" alt=""/>
          <p class="muted center">${T('Не схоже на їжу — спробуй інше фото')}</p>`;
        return;
      }
      box().innerHTML = `
        <img class="food-prev" src="${url}" alt=""/>
        <div class="kcal-res">
          <div class="kcal-name">${esc(r.name)}${r.portion ? ` <span class="muted">· ${T('порція')} ~${r.portion} г</span>` : ''}</div>
          <div class="kcal-big">${r.kcal} ${T('ккал')}</div>
          <div class="muted">${T('Б')} ${r.prot} г · ${T('Ж')} ${r.fat} г · ${T('В')} ${r.carb} г</div>
        </div>
        <div class="btn-col" style="margin-top:10px">
          <button class="btn primary" id="addKcal">➕ ${T('Додати в день')}</button>
        </div>`;
      box().querySelector('#addKcal').onclick = () => {
        S.addCalorieEntry(iso, r);
        toast(T('Збережено'));
        renderCalories();
      };
    } catch (e) {
      if (box()) box().innerHTML = `<p class="muted center">⚠️ ${esc(T(CAL.errorMessage(e)))}</p>`;
    }
  };
  const cam = screenEl.querySelector('#foodCam');
  const gal = screenEl.querySelector('#foodGal');
  if (cam) {
    screenEl.querySelector('#snapBtn').onclick = () => cam.click();
    screenEl.querySelector('#galBtn').onclick = () => gal.click();
    cam.onchange = () => analyze(cam.files[0]);
    gal.onchange = () => analyze(gal.files[0]);
  }
}

// =====================================================================
//  МОДАЛКА + ТОСТ
// =====================================================================
function openModal(title, bodyHtml, actions = []) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" id="mClose">✕</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot"></div>
    </div>`;
  document.body.appendChild(overlay);
  const root = overlay.querySelector('.modal');
  const foot = overlay.querySelector('.modal-foot');
  actions.forEach((a) => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (a.class || 'ghost');
    btn.textContent = a.label;
    btn.onclick = () => a.onClick(root);
    foot.appendChild(btn);
  });
  overlay.querySelector('#mClose').onclick = closeModal;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  requestAnimationFrame(() => overlay.classList.add('show'));
}
function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach((o) => o.remove());
}
let toastTimer;
function toast(msg, variant) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = variant ? variant : '';
  t.innerHTML = msg; // динамічні частини екрануються в місці виклику
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), variant === 'pr' ? 2800 : 1600);
}

// світлова сигналізація в кінці відпочинку (~2.6с); колір — з налаштувань
let alarmTimer;
function flashAlarm(color) {
  let el = document.getElementById('alarmFlash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'alarmFlash';
    document.body.appendChild(el);
  }
  el.style.background = color || '#ff2f2f';
  el.classList.remove('show');
  void el.offsetWidth; // перезапустити анімацію
  el.classList.add('show');
  clearTimeout(alarmTimer);
  alarmTimer = setTimeout(() => el.classList.remove('show'), 2700);
}

// ---------- запуск ----------
FX.initFx(S.getCustomSound); // аудіо розблоковується першим дотиком
renderTabbar();
router();

// повернення після входу через Google: в URL є ?code=... — обміняти на сесію
if (BE.configured && (location.search.includes('code=') || location.search.includes('error_description='))) {
  BE.handleOAuthReturn().finally(() => {
    // прибрати службові параметри з адреси й показати кабінет
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    go('#/coach');
  });
}

// реєстрація service worker (офлайн)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
