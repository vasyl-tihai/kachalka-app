// app.js — головний модуль: роутер + усі екрани
import * as S from './store.js';
import { RingTimer } from './timer.js';
import { NumberWheel } from './picker.js';
import { getLandmarker, drawPose } from './pose.js';
import * as FC from './formcheck.js';
import { t as T, setLang, LANGS, plural as PL, dateNames } from './i18n.js';
import * as FX from './fx.js';
import * as BE from './backend.js';

// мова інтерфейсу — із налаштувань (до першого рендеру)
setLang(S.getSettings().lang);

const screenEl = document.getElementById('screen');
const tabbarEl = document.getElementById('tabbar');

// поточно вибрана дата (для головного екрана / запису)
let selectedISO = S.todayISO();

// крок зміни ваги за типом снаряда (кг)
const WEIGHT_STEP = { dumbbell: 1, barbell: 2.5, kettlebell: 2, bodyweight: 1 };

// чи треба синхронізувати місяць календаря з вибраною датою при наступному вході
let calNeedsSync = true;

// режим редагування на екрані тренування (за замовч. лише перегляд)
let workoutEditMode = false;
// id тренування, яке треба відкрити одразу в редагуванні (переживає одну навігацію)
let pendingWorkoutEdit = null;
// чи розгорнутий селектор «Тренування дня» на головному екрані
let workoutSelOpen = false;

// екран замірів тіла: обрана метрика і дата запису
let bodyMetric = 'bodyWeight';
let bodyDate = null;

// активні «живі» компоненти, які треба знищувати при зміні екрана
let live = { timer: null, wheel: null, camera: null };
function clearLive() {
  if (live.timer) live.timer.destroy();
  if (live.wheel && live.wheel.destroy) live.wheel.destroy();
  if (live.camera && live.camera.destroy) live.camera.destroy();
  live = { timer: null, wheel: null, camera: null };
}

// ---------- маршрутизація ----------
const routes = [
  { re: /^#\/set\/(.+)$/, render: renderSet },
  { re: /^#\/camera\/(.+)$/, render: renderCamera },
  { re: /^#\/calendar$/, render: renderCalendar },
  { re: /^#\/workouts$/, render: renderWorkouts },
  { re: /^#\/workout\/(.+)$/, render: renderWorkoutDetail },
  { re: /^#\/progress$/, render: renderProgress },
  { re: /^#\/body$/, render: renderBody },
  { re: /^#\/history(?:\/(.+))?$/, render: renderHistory },
  { re: /^#\/settings$/, render: renderSettings },
  { re: /^#\/coach$/, render: renderCoach },
  { re: /^#\/today$/, render: renderToday },
];

function router() {
  clearLive();
  calNeedsSync = true; // нова навігація → календар синхронізує місяць із вибраною датою
  workoutEditMode = false; // тренування завжди відкривається в режимі перегляду
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
  { hash: '#/progress', icon: '📈', label: 'Прогрес' },
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
      (b.dataset.hash === '#/today' && hash === '#/') ||
      (b.dataset.hash === '#/workouts' && hash.startsWith('#/workout')) ||
      (b.dataset.hash === '#/progress' && (hash.startsWith('#/history') || hash.startsWith('#/body')));
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
  return `
    <button class="ex-card ${complete ? 'done' : ''}" data-id="${id}">
      <span class="ex-ico"><span class="glyph">${ex.icon || '💪'}</span></span>
      <span class="ex-main">
        <span class="ex-name">${esc(ex.name)}</span>
        <span class="ex-sub">${esc(typeLabel(wt))} · ${wText}</span>
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
    <div class="day-actions">
      <button class="btn ghost" id="manageW">${single ? '✏️ ' + T('Редагувати це тренування') : '🏋️ ' + T('Керувати тренуваннями')}</button>
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
  const entry = S.ensureEntry(iso, exerciseId);
  const settings = S.getSettings();
  const wStep = WEIGHT_STEP[entry.weightType] || 2.5;
  const curType = S.WEIGHT_TYPES.find((t) => t.id === entry.weightType) || S.WEIGHT_TYPES[0];
  const bests = S.exerciseBests(exerciseId);
  const prog = S.suggestProgression(exerciseId);
  const plannedW = ex.weight || 0; // «планова» вага з бібліотеки — для підсвітки збільшення
  const markWeightUp = () => {
    const sv = screenEl.querySelector('#stepVal');
    if (sv) sv.classList.toggle('w-up', entry.weightType !== 'bodyweight' && entry.weight > plannedW);
  };

  screenEl.innerHTML = `
    <div class="set-screen">
      <header class="set-top">
        <button class="icon-btn" id="backBtn">‹</button>
        <div class="set-ico"><span class="glyph big">${ex.icon || '💪'}</span></div>
        <div class="set-titles">
          <div class="set-name">${esc(ex.name)}</div>
          <div class="set-date">${S.prettyDate(iso)}</div>
        </div>
        <button class="icon-btn" id="camBtn" title="${T('Камера-тренер')}">📹</button>
        <button class="icon-btn" id="cfgBtn" title="${T('Ціль і налаштування')}">⚙️</button>
      </header>

      <!-- ВАГА -->
      <section class="card weight-card">
        <div class="wt-head">
          <span class="card-label wt-label">${T('Вага')}</span>
          <button class="wt-current" id="wtCurrent" title="${T('Змінити снаряд')}">${curType.icon} ${T(curType.label)} <span class="wt-caret">▾</span></button>
        </div>
        <div class="type-chips" id="typeChips" hidden>
          ${S.WEIGHT_TYPES.map((wt) => `<button class="tchip ${wt.id === entry.weightType ? 'on' : ''}" data-t="${wt.id}">${wt.icon} ${T(wt.label)}</button>`).join('')}
        </div>
        <div class="stepper" id="weightStepper" ${entry.weightType === 'bodyweight' ? 'hidden' : ''}>
          <button class="step-btn" data-d="-${wStep}">−</button>
          <div class="step-val" id="stepVal" title="${T('Двічі торкнись, щоб увести вручну')}"><span id="wVal">${entry.weight}</span> <small>${T('кг')}</small></div>
          <button class="step-btn" data-d="${wStep}">+</button>
        </div>
        ${prog ? `<button class="hint-chip" id="progHint">💡 ${T('Час додати вагу — спробуй')} <b>${prog.newWeight} ${T('кг')}</b></button>` : ''}
      </section>

      <!-- ТАЙМЕР ВІДПОЧИНКУ -->
      <section class="card timer-card">
        <div class="wt-head">
          <span class="card-label wt-label">${T('Відпочинок між підходами')}</span>
          <button class="wt-current" id="restEdit" title="${T('Увести час вручну')}">✏️ ${T('Час')}</button>
        </div>
        <div class="timer-row">
          <button class="rest-step" data-d="-${settings.restStep}">−${settings.restStep}</button>
          <div id="ringMount" class="ring-mount"></div>
          <button class="rest-step" data-d="${settings.restStep}">+${settings.restStep}</button>
        </div>
      </section>

      <!-- ЦІЛЬ + БАРАБАН -->
      <section class="card target-card">
        <div class="card-label">${T('Підхід')} <span id="setNo">${entry.sets.length + 1}</span> ${T('з')} <span id="setTarget">${entry.targetSets}</span> · ${T('ціль повторень')}</div>
        <div class="target-big glow" id="targetBig">${entry.targetReps}</div>
        <div class="wheel-label">${T('Скільки повторень зробив')}</div>
        <div id="wheelMount"></div>
        <div class="wheel-hint">${T('Обери повторення й натисни')} <b>＋</b> ${T('нижче, щоб записати підхід')}</div>
      </section>

      <!-- ВИКОНАНІ ПІДХОДИ -->
      <section class="card sets-card">
        <div class="card-label">${T('Виконані підходи')} <span class="muted" id="setsSummary"></span></div>
        <div class="bests-line" id="bestsLine">${bests.count > 0 ? bestsText(bests) : ''}</div>
        <div class="dots" id="dots"></div>
        <div class="sets-list" id="setsList"></div>
      </section>
    </div>
  `;

  // ----- події -----
  screenEl.querySelector('#backBtn').onclick = () => go('#/today');
  screenEl.querySelector('#camBtn').onclick = () => go('#/camera/' + exerciseId);
  screenEl.querySelector('#cfgBtn').onclick = () => openTargetEditor(iso, exerciseId);

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
    seconds: settings.restSeconds,
    // усі ефекти «кінець відпочинку» — за налаштуваннями користувача
    onFinishFx: () => {
      const st = S.getSettings();
      FX.playSound(st);
      FX.vibrateFinish(st);
      if (st.flashOn !== false) flashAlarm(st.flashColor);
    },
    onDone: () => {},
  });
  screenEl.querySelectorAll('.rest-step').forEach((b) =>
    b.addEventListener('click', () => {
      live.timer.add(parseInt(b.dataset.d, 10));
      // запам'ятати як новий стандарт відпочинку
      S.updateSettings({ restSeconds: Math.round(live.timer.total) });
    })
  );
  // ручне введення часу — окрема кнопка, не конфліктує зі стартом/паузою по колу
  screenEl.querySelector('#restEdit').onclick = () => openRestEditor();

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

  refreshSets(iso, exerciseId);
  markWeightUp();
}

// додати виконаний підхід: бере повторення з барабана, святкує рекорди, стартує відпочинок
function logSet(iso, exerciseId) {
  const ex = S.getExercise(exerciseId);
  const entry = S.ensureEntry(iso, exerciseId);
  const reps = live.wheel ? live.wheel.getValue() : entry.targetReps;
  const pre = S.exerciseBests(exerciseId); // знімок рекордів ДО запису
  S.addSet(iso, exerciseId, { reps, weight: entry.weight });
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

  const setNoEl = screenEl.querySelector('#setNo');
  if (setNoEl) setNoEl.textContent = done + 1;
  const sumEl = screenEl.querySelector('#setsSummary');
  if (sumEl) {
    const totalReps = entry.sets.reduce((s, x) => s + (x.reps || 0), 0);
    sumEl.textContent = `· ${done} / ${target}` + (totalReps ? ` · ${totalReps} ${T('повт.')}` : '');
  }

  const bestsEl = screenEl.querySelector('#bestsLine');
  if (bestsEl) {
    const b = S.exerciseBests(exerciseId);
    bestsEl.innerHTML = b.count > 0 ? bestsText(b) : '';
  }

  const dotsEl = screenEl.querySelector('#dots');
  if (dotsEl) {
    // показуємо лише зроблені підходи (зайві понад ціль — помаранчеві) + кнопку «+»
    let html = '';
    for (let i = 0; i < done; i++) {
      html += `<span class="dot fill ${i >= target ? 'extra' : ''}"></span>`;
    }
    html += `<button class="dot-add" id="addSetDot" title="${T('Додати підхід')}">＋</button>`;
    dotsEl.innerHTML = html;
    const addBtn = dotsEl.querySelector('#addSetDot');
    if (addBtn) addBtn.onclick = () => logSet(iso, exerciseId);
  }

  const listEl = screenEl.querySelector('#setsList');
  if (listEl) {
    listEl.innerHTML = entry.sets
      .map((s, i) => {
        const isBw = (s.weightType || entry.weightType) === 'bodyweight';
        const heavier = !isBw && s.weight > plannedW; // важче за план → жовтим
        const w = isBw ? '' : ` · <span class="${heavier ? 'w-up' : ''}">${s.weight}${T('кг')}</span>`;
        const extra = i >= target ? 'extra' : ''; // понад ціль → помаранчевим
        return `<div class="set-pill ${extra}">
          <b>${i + 1}</b><span>${s.reps} ${T('повт.')}${w}</span>
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
      S.updateEntry(iso, exerciseId, { targetSets: ts, targetReps: tr });
      closeModal();
      renderSet(exerciseId);
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
    (p) => `<button class="pchip ${p.id === pattern.id ? 'on' : ''}" data-p="${p.id}">${p.icon} ${esc(p.label)}</button>`
  ).join('');

  screenEl.innerHTML = `
    <div class="cam-screen">
      <header class="set-top">
        <button class="icon-btn" id="backBtn">‹</button>
        <div class="set-titles">
          <div class="set-name">${esc(ex.name)}</div>
          <div class="set-date">Камера-тренер · на пристрої</div>
        </div>
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

  const stop = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  };
  live.camera = { destroy: stop };

  screenEl.querySelector('#backBtn').onclick = () => { stop(); go('#/set/' + exerciseId); };
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
      stream = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
    } catch (err) {
      statusEl.textContent = err && err.name === 'NotAllowedError'
        ? 'Доступ до камери заборонено. Дозволь камеру у браузері та онови сторінку.'
        : 'Не вдалося увімкнути камеру.';
      statusEl.classList.add('err');
      return;
    }
    // встигли піти з екрана, поки висів дозвіл → не лишати камеру ввімкненою
    if (!running) { stream.getTracks().forEach((t) => t.stop()); stream = null; return; }
    try {
      video.srcObject = stream;
      await video.play();
    } catch (e) { /* play може відхилитись на деяких пристроях — не критично */ }
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
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

  function loop() {
    if (!running || !landmarker) return;
    rafId = requestAnimationFrame(loop);
    if (video.readyState < 2) return;
    const ts = performance.now();
    if (ts <= lastTs) return; // timestamp має строго зростати
    lastTs = ts;
    let res;
    try {
      res = landmarker.detectForVideo(video, ts);
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
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    const poses = res && res.landmarks;
    if (!poses || !poses.length) {
      statusEl.textContent = 'Не бачу людину в кадрі';
      statusEl.classList.remove('hide');
      angleEl.textContent = '';
      return;
    }
    const norm = poses[0];
    const world = res.worldLandmarks && res.worldLandmarks[0];
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

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = S.dateToISO(new Date(calYear, calMonth, d));
    const t = trained.has(iso);
    const isToday = iso === todayIso;
    cells += `<button class="cal-cell ${t ? 'trained' : ''} ${isToday ? 'today' : ''}" data-iso="${iso}">
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
      const preview = exs.slice(0, 4).map((e) => e.icon || '💪').join(' ');
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
  screenEl.querySelector('#addW').onclick = () => openNewWorkout();
  screenEl.querySelector('#histBtn').onclick = () => go('#/history');
  screenEl.querySelectorAll('.plan-row').forEach((r) =>
    r.addEventListener('click', () => openDayPlanEditor(parseInt(r.dataset.dow, 10)))
  );
  screenEl.querySelectorAll('.tpl').forEach((b) =>
    b.addEventListener('click', () => addTemplate(TEMPLATES[parseInt(b.dataset.i, 10)]))
  );
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
        <span class="ex-ico">${ex.icon || '💪'}</span>
        <span class="ex-main">
          <span class="ex-name">${esc(ex.name)}</span>
          <span class="ex-sub">${esc(typeLabel(ex.weightType))} · ${ex.weightType === 'bodyweight' ? T('вага тіла') : ex.weight + ' ' + T('кг')} · ${ex.targetSets}×${ex.targetReps}</span>
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
      : `<div class="day-actions"><button class="btn primary" id="editBtn">✏️ ${T('Редагувати')}</button></div>`}
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

function openAddExercise(workoutId) {
  const w = S.getWorkout(workoutId);
  const inWorkout = new Set(w.items);
  const avail = S.getExercises().filter((e) => !inWorkout.has(e.id));
  const body = avail.length
    ? avail
        .map((ex) => `<label class="pick-row">
          <input type="checkbox" data-id="${ex.id}"/>
          <span class="pick-ico">${ex.icon || '💪'}</span>
          <span class="pick-name">${esc(ex.name)} <span class="muted">· ${ex.weightType === 'bodyweight' ? T('вага тіла') : ex.weight + ' ' + T('кг')}</span></span>
        </label>`)
        .join('')
    : `<p class="muted">${T('Усі вправи з бібліотеки вже у цьому тренуванні. Створи нову.')}</p>`;
  openModal(T('Додати вправу'), `<div class="pick-list">${body}</div>`, [
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
              return `<div class="rec-row"><span class="rec-ico">${l.ex.icon || '💪'}</span>
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
    .map((ex) => `<button class="hchip ${ex.id === current ? 'on' : ''}" data-id="${ex.id}">${ex.icon} ${esc(ex.name)}</button>`)
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
      <button class="btn primary" id="saveSet">${T('Зберегти')}</button>
    </section>

    <section class="card">
      <div class="card-label">${T('Сигнал у кінці відпочинку')}</div>
      <label class="pick-row"><input type="checkbox" id="soundOn" ${s.soundOn ? 'checked' : ''}/><span class="pick-ico">🔊</span><span class="pick-name">${T('Звук')}</span></label>
      <div class="field" style="margin-top:10px"><label>${T('Мелодія')}</label>
        <div class="type-chips" style="margin-top:6px">
          ${soundChips}
          <button class="tchip ${s.soundId === 'custom' ? 'on' : ''}" data-snd="custom" ${hasCustom ? '' : 'disabled'}>🎵 ${T('Свій звук')}${s.customSoundName ? ` (${esc(s.customSoundName)})` : ''}</button>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn ghost" id="previewSnd">▶ ${T('Прослухати')}</button>
        <button class="btn ghost" id="pickSnd">🎵 ${T('Обрати файл')}</button>
        ${hasCustom ? `<button class="btn ghost" id="delSnd">✕ ${T('Прибрати')}</button>` : ''}
      </div>
      <input type="file" id="sndFile" accept="audio/*" hidden/>
      <label class="pick-row" style="margin-top:10px"><input type="checkbox" id="vibrOn" ${s.vibrateOn ? 'checked' : ''}/><span class="pick-ico">📳</span><span class="pick-name">${T('Вібрація')}</span></label>
      <label class="pick-row"><input type="checkbox" id="flashOn" ${s.flashOn ? 'checked' : ''}/><span class="pick-ico">🟥</span><span class="pick-name">${T('Спалах екрана')}</span></label>
      <div class="field" style="margin-top:10px"><label>${T('Колір спалаху')}</label>
        <div class="swatches">${swatches}
          <input type="color" id="flashColor" value="${s.flashColor || '#ff2f2f'}" title="${T('Колір спалаху')}"/>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-label">🧑‍🏫 Кабінет тренера <span class="muted">(бета)</span></div>
      <button class="btn ghost" id="coachBtn">Відкрити кабінет</button>
    </section>

    <section class="card">
      <div class="card-label">${T('Дані')}</div>
      <button class="btn ghost" id="exportBtn">⬇️ ${T('Експорт (резервна копія)')}</button>
      <button class="btn ghost" id="importBtn">⬆️ ${T('Імпорт з файлу')}</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden/>
      ${S.hasBackup() ? `<button class="btn ghost" id="undoBtn">↩️ ${T('Відмінити останній імпорт')}</button>` : ''}
      <button class="btn danger" id="wipeBtn">🗑️ ${T('Стерти всі дані')}</button>
    </section>
    <p class="muted center">КАЧАЛКА · ${T('щоденник тренувань · усі дані лише на цьому пристрої')}</p>
  `;
  screenEl.querySelector('#backBtn').onclick = () => history.back();
  screenEl.querySelector('#coachBtn').onclick = () => go('#/coach');

  // мова — застосовується одразу
  screenEl.querySelector('#langSel').onchange = (e) => {
    S.updateSettings({ lang: e.target.value });
    setLang(e.target.value);
    renderTabbar();
    renderSettings();
  };

  screenEl.querySelector('#saveSet').onclick = () => {
    S.updateSettings({
      restSeconds: parseInt(screenEl.querySelector('#rest').value, 10) || 60,
      restStep: parseInt(screenEl.querySelector('#step').value, 10) || 30,
    });
    toast(T('Збережено'));
  };

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
//  ЕКРАН: КАБІНЕТ ТРЕНЕРА (бета) — акаунт на сервері
// =====================================================================
function coachShell(inner) {
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">🧑‍🏫 Кабінет тренера</div>
        <div class="appbar-title">КАЧАЛКА</div></div>
    </header>
    <div id="coachBody">${inner}</div>`;
  screenEl.querySelector('#backBtn').onclick = () => go('#/settings');
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
  coachShell(`
    <section class="card">
      <div class="card-label">Мій профіль <span class="muted">· ${esc(session.user.email || '')}</span></div>
      <div class="field"><label>Роль</label>
        <div class="type-chips" style="margin-top:6px">
          <button class="tchip ${prof.role === 'trainer' ? 'on' : ''}" data-role="trainer">🧑‍🏫 Тренер</button>
          <button class="tchip ${prof.role === 'client' ? 'on' : ''}" data-role="client">🏋️ Клієнт</button>
        </div>
      </div>
      <div class="field"><label>Ім'я</label><input type="text" id="pName" value="${esc(prof.name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || '')}"/></div>
      <div class="field"><label>Місто</label><input type="text" id="pCity" value="${esc(prof.city || '')}"/></div>
      <div class="field"><label>Про себе</label><input type="text" id="pBio" value="${esc(prof.bio || '')}" placeholder="Досвід, спеціалізація…"/></div>
      <div class="field"><label>Контакт (телефон/Telegram)</label><input type="text" id="pContact" value="${esc(prof.contact || '')}"/></div>
      <button class="btn primary" id="saveProf">Зберегти профіль</button>
      <button class="btn ghost" id="logoutBtn">Вийти з акаунта</button>
    </section>
    <section class="card">
      <div class="card-label">Далі в розробці</div>
      <p class="muted">📅 Календар слотів і запис клієнтів · 🏋️ призначення тренувань клієнтам · 📈 перегляд їхнього прогресу · 💬 чат.</p>
    </section>`);
  let role = prof.role || 'client';
  screenEl.querySelectorAll('.tchip[data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      role = b.dataset.role;
      screenEl.querySelectorAll('.tchip[data-role]').forEach((c) => c.classList.toggle('on', c === b));
    })
  );
  screenEl.querySelector('#saveProf').onclick = async () => {
    try {
      await BE.saveMyProfile({
        role,
        name: screenEl.querySelector('#pName').value.trim(),
        city: screenEl.querySelector('#pCity').value.trim(),
        bio: screenEl.querySelector('#pBio').value.trim(),
        contact: screenEl.querySelector('#pContact').value.trim(),
      });
      toast(T('Збережено'));
    } catch (e) { alert('⚠️ ' + e.message); }
  };
  screenEl.querySelector('#logoutBtn').onclick = async () => {
    await BE.signOut();
    renderCoach();
  };
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
