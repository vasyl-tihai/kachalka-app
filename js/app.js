// app.js — головний модуль: роутер + усі екрани
import * as S from './store.js';
import { RingTimer, WorkStopwatch } from './timer.js';
import * as SM from './smart.js';
import * as BILL from './billing.js';
import * as PH from './photos.js';
import { NumberWheel } from './picker.js';
import { getLandmarker, drawPose } from './pose.js';
import * as FC from './formcheck.js';
import { t as T, setLang, LANGS, plural as PL, dateNames } from './i18n.js';
import { mountBody3D, BODY_PARTS, BODY_BASE } from './body3d.js';
import * as RC from './recipes.js';
import * as RI from './recipe-import.js';
import { exIconHTML, patternIconHTML } from './exicons.js';
import * as FX from './fx.js';
import * as BE from './backend.js';
import { APP_VERSION } from './version.js';
import * as CAL from './calories.js';
import * as BC from './barcode.js';
import * as GD from './guides.js';
import * as RCP from './receipt.js';
import { RECIPES } from './recipes-data.js';

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

// екран замірів тіла: обрана метрика і дата запису
let bodyMetric = 'chest';
let bodyAngle = -0.35; // поворот 3D-фігури між заходами на екран
let bodyCompare = false; // «було/стало» на екрані замірів
let bodyDate = null;

// активні «живі» компоненти, які треба знищувати при зміні екрана
let live = { timer: null, work: null, wheel: null, camera: null, chat: null, body3d: null };
function clearLive() {
  if (live.timer) live.timer.destroy();
  if (live.work) live.work.destroy();
  if (live.wheel && live.wheel.destroy) live.wheel.destroy();
  if (live.camera && live.camera.destroy) live.camera.destroy();
  if (live.chat && live.chat.destroy) live.chat.destroy();
  if (live.body3d) { bodyAngle = live.body3d.angle(); live.body3d.destroy(); }
  live = { timer: null, work: null, wheel: null, camera: null, chat: null, body3d: null };
}

// ---------- маршрутизація ----------
const routes = [
  { re: /^#\/set\/(.+)$/, render: renderSet },
  { re: /^#\/camera\/(.+)$/, render: renderCamera },
  { re: /^#\/formcheck$/, render: () => renderAI(true) },
  { re: /^#\/ai$/, render: () => renderAI(false) },
  { re: /^#\/guides$/, render: renderGuides },
  { re: /^#\/guide\/([\w-]+)$/, render: renderGuide },
  { re: /^#\/calendar$/, render: renderCalendar },
  { re: /^#\/workouts$/, render: renderWorkouts },
  { re: /^#\/workout\/(.+)$/, render: renderWorkoutDetail },
  { re: /^#\/programs$/, render: renderPrograms },
  { re: /^#\/program\/(.+)$/, render: renderProgram },
  { re: /^#\/progress$/, render: renderProgress },
  { re: /^#\/smart$/, render: renderSmart },
  { re: /^#\/pro$/, render: renderPro },
  { re: /^#\/body$/, render: renderBody },
  { re: /^#\/history(?:\/(.+))?$/, render: renderHistory },
  { re: /^#\/settings$/, render: renderSettings },
  { re: /^#\/coach$/, render: renderCoach },
  { re: /^#\/community$/, render: renderCommunityHub },
  { re: /^#\/user\/(.+)$/, render: renderUserProfile },
  { re: /^#\/client\/(.+)$/, render: renderClientManage },
  { re: /^#\/chat\/(.+)$/, render: renderChat },
  { re: /^#\/calories$/, render: renderCalories },
  { re: /^#\/mealplan$/, render: renderMealPlan },
  { re: /^#\/meal\/(\d+)\/(\d+)$/, render: renderMeal },
  { re: /^#\/supps$/, render: renderSupps },
  { re: /^#\/supp\/([\w-]+)$/, render: renderSuppEdit },
  { re: /^#\/recipes$/, render: () => { commSeg = 'recipes'; return renderRecipes(); } },
  { re: /^#\/recipe-new$/, render: () => renderRecipeEdit(null) },
  { re: /^#\/recipe-edit\/(.+)$/, render: renderRecipeEdit },
  { re: /^#\/today$/, render: renderToday },
];

function router() {
  syncToday(); // після півночі будь-яка навігація веде вже на новий день
  clearLive();
  calNeedsSync = true; // нова навігація → календар синхронізує місяць із вибраною датою
  workoutEditMode = false; // тренування завжди відкривається в режимі перегляду
  coachEdit = false; // кабінет відкривається в режимі перегляду профілю
  bodyDate = null; // екран замірів щоразу відкривається на сьогодні (вибір дати живе лише в межах екрана)
  let hash = location.hash || '#/today';
  // пробний період вийшов, підписки немає → усе веде на екран підписки
  // (налаштування лишаємо доступними: там мова, експорт даних і сам статус)
  if (BILL.locked() && hash !== '#/pro' && hash !== '#/settings') {
    if (location.hash !== '#/pro') location.hash = '#/pro';
    hash = '#/pro';
  }
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

// Одне нагадування на день, коли пробний період добігає кінця.
function trialReminder() {
  if (!BILL.ENFORCE) return; // оплата ще не підключена — не нагадуємо
  if (BILL.status() !== 'trial') return;
  const left = BILL.trialLeft();
  if (left > BILL.WARN_DAYS) return;
  const iso = S.todayISO();
  const s = S.getSettings();
  if (s.trialNoticeISO === iso) return;
  S.updateSettings({ trialNoticeISO: iso });
  setTimeout(() => toast(`🎁 ${T('Пробний період')}: ${T('ще')} ${dayWord(left)}`), 1200);
}

// ---------- теми оформлення ----------
// Класична — те, як було; решта задаються атрибутом data-theme на <html>.
const THEMES = [
  { id: 'neon', label: 'Неон', hint: 'темна, один кислотний акцент' },
  { id: 'classic', label: 'Класична', hint: 'синьо-фіолетова, як було' },
  { id: 'tablo', label: 'Табло', hint: 'чорна, великі числа, прямі кути' },
  { id: 'light', label: 'Світла', hint: 'світле тло, видно вдень' },
];
const THEME_BAR = { classic: '#000000', neon: '#0B0B10', tablo: '#000000', light: '#F4F4F0' };

function applyTheme(id) {
  const t = THEMES.some((x) => x.id === id) ? id : 'neon';
  if (t === 'classic') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  // колір системної смуги браузера — щоб не світився чорний над світлою темою
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_BAR[t] || '#000000');
}

// ---------- нижня навігація ----------
const TABS = [
  { hash: '#/today', icon: '🏋️', label: 'Сьогодні' },
  { hash: '#/calendar', icon: '📅', label: 'Календар' }, // + мої тренування й тижневий план
  { hash: '#/workouts', icon: '📋', label: 'Тренування' }, // програми й шаблони
  { hash: '#/ai', icon: '🤖', label: 'ШІ' }, // калорії, тренер, техніка, імпорт рецепта
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
  // день, відкритий з календаря, — це ще перегляд календаря, а не «Сьогодні»
  const otherDay = (hash === '#/today' || hash === '#/') && selectedISO !== S.todayISO();
  tabbarEl.querySelectorAll('.tab').forEach((b) => {
    const active = otherDay
      ? b.dataset.hash === '#/calendar'
      : hash.startsWith(b.dataset.hash) ||
      (b.dataset.hash === '#/today' && hash === '#/') ||
      (b.dataset.hash === '#/calendar' && hash.startsWith('#/workout/')) ||
      (b.dataset.hash === '#/workouts' && hash.startsWith('#/program')) ||
      (b.dataset.hash === '#/ai' && (hash === '#/calories' || hash === '#/mealplan' || hash.startsWith('#/meal/') || hash.startsWith('#/supp') || hash === '#/smart' || hash === '#/formcheck' || hash.startsWith('#/guide'))) ||
      (b.dataset.hash === '#/progress' && (hash.startsWith('#/history') || hash.startsWith('#/body'))) ||
      (b.dataset.hash === '#/community' &&
        (hash.startsWith('#/user') || hash.startsWith('#/recipe') || hash.startsWith('#/coach') || hash.startsWith('#/chat') || hash.startsWith('#/client')));
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

// Фото дня: знімки, зроблені в залі. Лежать в IndexedDB (js/photos.js),
// у щоденник не потрапляють — тому картка наповнюється вже після малювання.
function photosCard(iso) {
  return `<section class="card photos-card" id="photosCard" data-iso="${iso}">
    <div class="card-label">📸 ${T('Фото дня')} <span class="muted" id="phCount"></span></div>
    <div class="ph-strip" id="phStrip"></div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn ghost" id="phCam">📷 ${T('Зняти')}</button>
      <button class="btn ghost" id="phGal">🖼 ${T('З галереї')}</button>
    </div>
    <input type="file" id="phCamIn" accept="image/*" capture="environment" hidden/>
    <input type="file" id="phGalIn" accept="image/*" multiple hidden/>
  </section>`;
}

// Наповнити смужку знімками (і перемалювати після додавання чи видалення).
async function refreshPhotos(iso) {
  const strip = screenEl.querySelector('#phStrip');
  const cnt = screenEl.querySelector('#phCount');
  if (!strip) return;
  let list = [];
  try {
    list = await PH.listByDay(iso);
  } catch (e) {
    strip.innerHTML = `<p class="muted">${T('Сховище фото недоступне')}</p>`;
    return;
  }
  if (!screenEl.querySelector('#phStrip')) return; // екран уже змінився
  if (cnt) cnt.textContent = list.length ? `· ${list.length}` : '';
  strip.innerHTML = list.length
    ? list.map((p) => `<button class="ph-thumb" data-id="${p.id}"><img src="${p.url}" alt=""/></button>`).join('')
    : `<p class="muted">${T('Фото ще немає')}</p>`;
  strip.querySelectorAll('.ph-thumb').forEach((b) =>
    b.addEventListener('click', () => openPhoto(list.find((x) => x.id === b.dataset.id), iso))
  );
}

// Перегляд на весь екран: тап по тлу закриває, кошик видаляє.
function openPhoto(photo, iso) {
  if (!photo) return;
  const box = document.createElement('div');
  box.className = 'ph-view';
  box.innerHTML = `<img src="${photo.url}" alt=""/>
    <button class="ph-del" title="${T('Видалити')}">🗑</button>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.tagName === 'IMG') close();
  });
  box.querySelector('.ph-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(T('Видалити це фото?'))) return;
    await PH.remove(photo.id);
    close();
    refreshPhotos(iso);
  });
}

// Події картки фото — чіпляються після того, як екран намальовано.
function bindPhotos(iso) {
  const card = screenEl.querySelector('#photosCard');
  if (!card) return;
  const camIn = screenEl.querySelector('#phCamIn');
  const galIn = screenEl.querySelector('#phGalIn');
  screenEl.querySelector('#phCam').onclick = () => camIn.click();
  screenEl.querySelector('#phGal').onclick = () => galIn.click();
  const take = async (files) => {
    for (const f of files) {
      try {
        await PH.add(iso, f);
      } catch (e) {
        toast(`⚠️ ${T('Не вдалося зберегти фото')}`);
      }
    }
    refreshPhotos(iso);
  };
  camIn.onchange = () => { if (camIn.files[0]) take([camIn.files[0]]); camIn.value = ''; };
  galIn.onchange = () => { if (galIn.files.length) take([...galIn.files]); galIn.value = ''; };
  refreshPhotos(iso);
}

// Підсумок дня для перегляду з календаря: що саме було зроблено того дня.
function dayStatsCard(iso) {
  const stack = S.getDayStack(iso);
  let sets = 0, reps = 0, tonnage = 0, secs = 0, doneEx = 0;
  const rows = [];
  for (const id of stack) {
    const en = S.getEntry(iso, id);
    if (!en || !en.sets || !en.sets.length) continue;
    const ex = S.getExercise(id);
    const v = S.entryVolume(en);
    doneEx++;
    sets += en.sets.length;
    reps += v.reps;
    tonnage += v.tonnage;
    for (const st of en.sets) secs += Number(st.sec) || 0;
    rows.push(`<div class="ds-row"><span class="ds-nm">${esc(ex ? ex.name : '')}</span>
      <span class="ds-val">${en.sets.map((x) => x.reps).join(' · ')}</span></div>`);
  }
  if (!sets) {
    return `<section class="card day-stats empty-day">
      <div class="ds-none">😴 ${T('Того дня тренування не було')}</div>
    </section>`;
  }
  const mm = Math.floor(secs / 60);
  return `<section class="card day-stats">
    <div class="card-label">📊 ${T('Підсумок дня')}</div>
    <div class="ds-grid">
      <div class="ds-cell"><b>${tonnage > 0 ? fmtKg(tonnage) : '—'}</b><span>${T('обсяг')}</span></div>
      <div class="ds-cell"><b>${sets}</b><span>${T('підходів')}</span></div>
      <div class="ds-cell"><b>${reps}</b><span>${T('повторень')}</span></div>
      <div class="ds-cell"><b>${secs > 0 ? mm + ' ' + T('хв') : '—'}</b><span>${T('під вагою')}</span></div>
    </div>
    <div class="ds-list">${rows.join('')}</div>
  </section>`;
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
  const isPast = iso < S.todayISO(); // минулий день — це перегляд, а не планування

  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles">
        <div class="appbar-kicker">${isToday ? T('Сьогодні') : T('Календар')}</div>
        <div class="appbar-title">${S.prettyDate(iso)}</div>
      </div>
    </header>
    <div class="day-nav">
      <button class="chip" id="prevDay">‹</button>
      <input type="date" id="datePick" value="${iso}" class="date-input"/>
      <button class="chip" id="nextDay">›</button>
      ${isToday ? '' : `<button class="chip ghost" id="todayBtn">${T('Сьогодні')}</button>`}
      <button class="chip cal-btn" id="calBtn" title="${T('До календаря')}" aria-label="${T('До календаря')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <rect x="3" y="5" width="18" height="16" rx="3"></rect>
          <path d="M8 3v4M16 3v4M3 10h18"></path>
          <circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"></circle>
          <circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none"></circle>
          <circle cx="15.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"></circle>
        </svg>
      </button>
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
    ${isPast ? dayStatsCard(iso) : ''}
    ${suppsCard(iso)}
    ${photosCard(iso)}
    <div class="day-actions">
      ${isPast ? '' : `<button class="btn ghost" id="manageW">${single ? '✏️ ' + T('Редагувати це тренування') : '🏋️ ' + T('Керувати тренуваннями')}</button>`}

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
  const todayBtn = screenEl.querySelector('#todayBtn');
  if (todayBtn)
    todayBtn.onclick = () => {
      selectedISO = S.todayISO();
      router();
    };
  screenEl.querySelector('#calBtn').onclick = () => go('#/calendar');
  bindSuppsCard(iso);
  const dp = screenEl.querySelector('#datePick');
  dp.onchange = () => {
    if (dp.value) {
      selectedISO = dp.value;
      router();
    }
  };

  bindPhotos(iso);
  const manageBtn = screenEl.querySelector('#manageW');
  if (manageBtn) manageBtn.onclick = () => go(single ? '#/workout/' + single : '#/calendar');
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
          ${GD.guideFor(ex) ? `<button class="how-link" id="howBtn">ℹ️ ${T('Як виконувати')}</button>` : ''}
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

      <!-- ФІНАЛ ДНЯ: наступної вправи немає → таймер ховаємо, роботу завершено -->
      <section class="card fin-card" id="finCard" hidden>
        <div class="fin-txt">🎉 ${T('Тренування виконано!')}</div>
        <button class="btn primary" id="finBtn">${T('Сьогодні')} ›</button>
      </section>

      <!-- ПОВТОРЕННЯ: барабан + кнопка «Виконав підхід» -->
      <section class="card target-card">
        <div class="tc-head">
          <span class="set-label" id="setLabel"></span>
          <button class="goal-chip" id="goalChip" title="${T('Ціль і налаштування')}">🎯 ${T('Ціль')}: <b id="goalVal">${entry.targetReps}</b></button>
        </div>
        <div class="set-progress" id="setProgress"></div>
        <div class="prev-line" id="prevLine" hidden></div>
        <!-- порада аналітика: відпочинок/вага/обсяг за твоєю ж історією -->
        <button class="hint-chip smart" id="smartHint" hidden></button>
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
  const howBtn = screenEl.querySelector('#howBtn');
  if (howBtn) howBtn.onclick = () => go('#/guide/' + GD.guideFor(ex));
  screenEl.querySelector('#cfgBtn').onclick = () => openTargetEditor(iso, exerciseId);
  screenEl.querySelector('#goalChip').onclick = () => openTargetEditor(iso, exerciseId);
  // головна дія: обрав повторення на барабані → «Виконав підхід»
  screenEl.querySelector('#logBtn').onclick = () => logSet(iso, exerciseId);
  screenEl.querySelector('#finBtn').onclick = () => go('#/today');
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

// Підпис фіналу. Програма власної ваги (одна вправа) — «Заняття завершено · наступне — Пн»:
// день береться з тижневого плану, а без плану — через день (м'язам треба відпочити).
function finCaption(iso, exerciseId) {
  const ex = S.getExercise(exerciseId);
  if (!ex || !S.programFor(ex)) return `🎉 ${T('Тренування виконано!')}`;
  const p = S.progressionState(exerciseId);
  if (p && p.done) return `🏆 ${T('Ціль досягнута')}`;
  const w = S.getWorkouts().find((x) => x.progId && x.items.includes(exerciseId));
  const sched = S.getSchedule();
  const base = S.isoToDate(iso);
  let next = null;
  for (let k = 1; k <= 7 && w; k++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + k);
    if ((sched[String(d.getDay())] || []).includes(w.id)) { next = d; break; }
  }
  if (!next) next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 2);
  const day = dateNames().dows[next.getDay()];
  const lvl = p ? `<div class="fin-sub">${T('Рівень')} ${p.level} · ${T('День')} ${p.day}/3</div>` : '';
  return `✅ ${T('Заняття завершено')} · ${T('наступне')} — ${day}${lvl}`;
}

// Після останнього підходу таймер уже не «між підходами», а очікування ПЕРЕД
// наступною вправою: інший колір (фіолетовий) + назва тієї вправи під кільцем.
function updateRestMode(iso, exerciseId, waiting) {
  const cardEl = screenEl.querySelector('#timerCard');
  const labelEl = screenEl.querySelector('#restLabel');
  const nextEl = screenEl.querySelector('#nextUp');
  const finEl = screenEl.querySelector('#finCard');
  if (!cardEl || !labelEl || !nextEl) return;
  const nextId = waiting ? nextUnfinishedId(iso, exerciseId) : null;
  const nx = nextId ? S.getExercise(nextId) : null;
  // Остання вправа дня: чекати нема чого — таймер прибираємо зовсім
  // (і глушимо, якщо він уже йшов), лишається тільки «виконано».
  const finished = waiting && !nextId;
  if (finished && live.timer) live.timer.reset();
  cardEl.hidden = finished;
  if (finEl) finEl.hidden = !finished;
  if (finished && finEl) {
    let cap;
    try { cap = finCaption(iso, exerciseId); } catch { cap = `🎉 ${T('Тренування виконано!')}`; }
    finEl.querySelector('.fin-txt').innerHTML = cap;
  }
  cardEl.classList.toggle('waiting', waiting && !finished);
  labelEl.textContent = waiting
    ? T('Очікування перед наступною вправою')
    : T('Відпочинок між підходами');
  nextEl.hidden = !waiting || finished;
  if (!waiting || finished) {
    nextEl.innerHTML = '';
    return;
  }
  nextEl.innerHTML = `<span class="nu-lab">➡️ ${T('Далі')}:</span> ${nx ? exIconHTML(nx) || `<span class="glyph">${nx.icon || '💪'}</span>` : ''} <b>${esc(nx ? nx.name : '')}</b>`;
}

// Порада «розумного тренера» на екрані підходу: коротка дія, яку можна застосувати
// одним тапом (довший відпочинок / менша вага). Рахується локально по історії.
function updateSmartHint(iso, exerciseId) {
  const el = screenEl.querySelector('#smartHint');
  if (!el) return;
  let adv = null;
  try {
    adv = SM.sessionAdvice(iso, exerciseId, live.timer ? live.timer.total : S.getSettings().restSeconds);
  } catch (e) {
    adv = null;
  }
  if (!adv) {
    el.hidden = true;
    el.onclick = null;
    return;
  }
  el.hidden = false;
  el.innerHTML = `🧠 ${esc(adv.text)}${adv.action ? ` <b>— ${T('застосувати')}</b>` : ''}`;
  el.classList.toggle('actionable', !!adv.action);
  el.onclick = !adv.action
    ? null
    : () => {
        if (adv.action.type === 'rest') {
          if (live.timer) live.timer.setDuration(adv.action.value);
          S.updateSettings({ restSeconds: adv.action.value });
          toast(`⏱️ ${T('Відпочинок')}: ${adv.action.value} ${T('сек')}`);
        } else if (adv.action.type === 'weight') {
          S.updateEntry(iso, exerciseId, { weight: adv.action.value });
          const wv = screenEl.querySelector('#wVal');
          if (wv) wv.textContent = adv.action.value;
          toast(`${T('Вага оновлена')}: ${adv.action.value} ${T('кг')}`);
        }
        el.hidden = true;
      };
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

  // авто-старт таймера відпочинку — але НЕ після останнього підходу дня:
  // далі вправи немає, відпочивати нема перед чим, робота просто завершена
  const enNow = S.getEntry(iso, exerciseId);
  const allDone = !!(enNow && enNow.targetSets && enNow.sets.length >= enNow.targetSets);
  if (allDone && !nextUnfinishedId(iso, exerciseId)) {
    if (live.timer) live.timer.reset();
    if (live.work) live.work.reset();
    toast(`🎉 ${T('Тренування виконано!')}`);
    return;
  }
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
  updateSmartHint(iso, exerciseId);

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
    ${myWorkoutsHTML()}
  `;
  bindMyWorkouts();
  screenEl.querySelector('#prevM').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); };
  screenEl.querySelector('#nextM').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); };
  screenEl.querySelectorAll('.cal-cell[data-iso]').forEach((c) =>
    c.addEventListener('click', () => { selectedISO = c.dataset.iso; go('#/today'); })
  );
  // дні з фото — маленька позначка в кутку (фото в IndexedDB, тому вже після малювання)
  PH.daysWithPhotos().then((days) => {
    if (location.hash !== '#/calendar') return;
    let any = false;
    screenEl.querySelectorAll('.cal-cell[data-iso]').forEach((c) => {
      if (days.has(c.dataset.iso)) { c.classList.add('has-photo'); c.title = T('Є фото'); any = true; }
    });
    if (any) {
      let lg = screenEl.querySelector('.cal-legend');
      if (!lg) { lg = document.createElement('div'); lg.className = 'cal-legend'; screenEl.querySelector('.cal-grid:not(.head)').after(lg); }
      lg.insertAdjacentHTML('beforeend', `<span><i class="lg photo"></i>${T('фото')}</span>`);
    }
  }).catch(() => {});
}
function plural(n, one, few, many) {
  return PL(n, one, few, many); // форми українською; переклад — усередині i18n
}

// =====================================================================
//  ЕКРАН: ТРЕНУВАННЯ (список іменованих тренувань)
// =====================================================================
// мої тренування + тижневий план — блок екрана «Календар»
function myWorkoutsHTML() {
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

  return `
    <div class="sec-head">
      <h2 class="sec-title">🏋️ ${T('Мої тренування')}</h2>
      <button class="icon-btn" id="addW" title="${T('Нове тренування')}">＋</button>
    </div>
    <p class="muted side">${T('Збери різні тренування (напр. «Акцент на руках», «V-подібний»). Натисни, щоб переглянути; змінювати — після кнопки «Редагувати».')}</p>
    <div class="list">${rows || `<div class="empty"><div class="empty-ico">🏋️</div><p>${T('Немає тренувань.')}</p></div>`}</div>

    <section class="card" style="margin-top:16px">
      <div class="card-label">📅 ${T('Тижневий план')}</div>
      <p class="muted" style="margin:0 0 10px">${T('Признач тренування на дні тижня — «Тренування дня» підставиться автоматично.')}</p>
      <div class="plan-list">${planRows}</div>
    </section>`;
}
function bindMyWorkouts() {
  screenEl.querySelectorAll('.ex-card[data-w]').forEach((c) =>
    c.addEventListener('click', () => go('#/workout/' + c.dataset.w))
  );
  screenEl.querySelectorAll('.ex-card[data-p]').forEach((c) =>
    c.addEventListener('click', () => go('#/program/' + c.dataset.p))
  );
  screenEl.querySelector('#addW').onclick = () => openNewWorkout();
  screenEl.querySelectorAll('.plan-row').forEach((r) =>
    r.addEventListener('click', () => openDayPlanEditor(parseInt(r.dataset.dow, 10)))
  );
}

// вкладка «Тренування»: програми з вагою тіла + шаблони (свої тренування — у «Календарі»)
function renderWorkouts() {
  const tplChips = TEMPLATES.map(
    (tp, i) => `<button class="tpl" data-i="${i}">${tp.icon} ${T(tp.name)}</button>`
  ).join('');
  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles"><div class="appbar-kicker">${T('Програми')}</div>
        <div class="appbar-title">${T('Тренування')}</div></div>
    </header>
    <p class="muted side">🎯 ${T('Окрема програма на одну річ: качаєш її до цілі за рівнями й днями. Ваги тут немає — росте кількість повторень.')}</p>
    <div class="list">${programRowsHTML()}</div>

    <section class="card" style="margin-top:16px">
      <div class="card-label">✨ ${T('Шаблони тренувань')}</div>
      <p class="muted" style="margin:0 0 10px">${T('З практики атлетів: важкі/легкі дні та кардіо.')}</p>
      <div class="tpl-grid">${tplChips}</div>
    </section>
    <p class="muted side">${T('Свої тренування й тижневий план — у вкладці «Календар».')}</p>
  `;
  screenEl.querySelectorAll('.ex-card[data-p]').forEach((c) =>
    c.addEventListener('click', () => go('#/program/' + c.dataset.p))
  );
  screenEl.querySelectorAll('.tpl').forEach((b) =>
    b.addEventListener('click', () => addTemplate(TEMPLATES[parseInt(b.dataset.i, 10)]))
  );
}

// =====================================================================
//  ЕКРАНИ: ПРОГРАМИ З ВАГОЮ ТІЛА (окремі тренування — «тільки прес» тощо)
// =====================================================================
function programRowsHTML() {
  return S.PROGRAMS.map((p) => {
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
}
function renderPrograms() {
  const rows = programRowsHTML();
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
      router();
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
  toast(`${T('Додано в «Мої тренування»')}: ${esc(w.name)}`);
  router();
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
  if (!w) return go('#/calendar');
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
    go('#/calendar');
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
      go('#/calendar');
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
        go('#/calendar');
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
        <div class="card-label">🏆 ${T('Рекорди')}</div>
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
      <button class="btn ghost" id="bodyBtn">📏 ${T('Заміри тіла')}${bw ? ` · ${bw.value} ${T('кг')}` : ''}</button>
      <button class="btn ghost" id="histBtn">📈 ${T('Історія по вправах')}</button>
      <button class="btn ghost" id="smartBtn2">🧠 ${T('Розумний тренер — відновлення')}</button>
      <button class="btn ghost" id="kcalBtn2">🍎 ${T('Калорії по фото')}</button>
    </div>
  `;
  screenEl.querySelector('#setBtn').onclick = () => go('#/settings');
  screenEl.querySelector('#bodyBtn').onclick = () => go('#/body');
  screenEl.querySelector('#histBtn').onclick = () => go('#/history');
  screenEl.querySelector('#smartBtn2').onclick = () => go('#/smart');
  screenEl.querySelector('#kcalBtn2').onclick = () => go('#/calories');
}

// Значок підписки — намальований, щоб не залежати від емодзі системи.
function proIcon(size = 20) {
  return `<svg class="ico-pro" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 8.5l3.8 2.6L12 5l4.2 6.1L20 8.5l-1.6 9H5.6L4 8.5z"></path>
    <path d="M5.6 20.5h12.8" stroke-linecap="round"></path>
  </svg>`;
}

// Акаунт у налаштуваннях: реєстрація й вхід через Google (та вихід).
// Малюється окремо, бо стан сесії приходить із сервера вже після екрана.
async function renderAccountBox() {
  const box = () => screenEl.querySelector('#acctBody');
  if (!box()) return;
  if (!BE.configured) {
    box().innerHTML = `<p class="muted">${T('Сервер ще не підключено — акаунт і спільнота поки недоступні')}</p>`;
    return;
  }
  let session = null;
  try {
    session = await BE.getSession();
  } catch (e) {
    /* немає звʼязку — покажемо кнопку входу */
  }
  if (!box()) return;
  if (session && session.user) {
    const email = session.user.email || '';
    box().innerHTML = `
      <div class="acct-row">
        <span class="acct-ava">${esc((email[0] || '?').toUpperCase())}</span>
        <span class="acct-mail">${esc(email)}</span>
      </div>
      <button class="btn ghost" id="acctOut" style="margin-top:10px">${T('Вийти')}</button>`;
    screenEl.querySelector('#acctOut').onclick = async () => {
      await BE.signOut();
      renderAccountBox();
    };
    return;
  }
  box().innerHTML = `
    <p class="muted">${T('Реєстрація потрібна лише для спільноти й синхронізації — щоденник працює без неї')}</p>
    <button class="btn google" id="gSignIn" style="margin-top:12px"><span class="g-badge">G</span> ${T('Продовжити з Google')}</button>
    <button class="btn ghost" id="mailSignIn" style="margin-top:8px">${T('Пошта і пароль')}</button>`;
  screenEl.querySelector('#gSignIn').onclick = async () => {
    try {
      await BE.signInWithGoogle();
    } catch (e) {
      toast(`⚠️ ${esc(T(String(e.message || e)))}`);
    }
  };
  screenEl.querySelector('#mailSignIn').onclick = () => go('#/community');
}

// =====================================================================
//  ЕКРАН: ПІДПИСКА (пробний період, покупка, відновлення)
// =====================================================================
async function renderPro() {
  const st = BILL.status();
  const days = BILL.trialLeft();
  const sub = S.getSettings().billing && S.getSettings().billing.sub;
  const head = st === 'active'
    ? { ico: proIcon(34), title: T('Підписка активна'), sub: sub && sub.until ? `${T('діє до')} ${S.prettyDate(sub.until)}` : '' }
    : st === 'trial'
      ? { ico: '🎁', title: `${T('Пробний період')}: ${T('ще')} ${dayWord(days)}`, sub: T('Далі — за підпискою') }
      : { ico: '🔒', title: T('Пробний період закінчився'), sub: T('Оформи підписку, щоб продовжити') };

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backPro" ${BILL.locked() ? 'hidden' : ''}>‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">Gym Log PRO</div>
        <div class="appbar-title">${T('Підписка')}</div></div>
    </header>

    <section class="card pro-hero">
      <div class="pro-ico">${head.ico}</div>
      <div>
        <div class="pro-title">${esc(head.title)}</div>
        ${head.sub ? `<div class="pro-sub">${esc(head.sub)}</div>` : ''}
      </div>
    </section>

    <section class="card">
      <div class="card-label">${T('Що входить')}</div>
      <ul class="pro-list">
        <li>📷 ${T('Калорії по фото без обмежень')} <span class="muted">(${T('безкоштовно')} — ${BILL.FREE_PHOTOS} ${T('на день')})</span></li>
        <li>🧠 ${T('Розумний тренер: аналіз відновлення')}</li>
        <li>🎯 ${T('Програми власної ваги до 300 повторень')}</li>
        <li>📹 ${T('Камера-тренер і аналіз техніки')}</li>
        <li>📈 ${T('Уся історія, рекорди й графіки')}</li>
      </ul>
    </section>

    <section class="card" id="planCard">
      <div class="card-label">${T('Обери період')}</div>
      <div class="plan-list" id="planList">
        ${BILL.PRODUCTS.map((pr) => `
          <button class="plan-opt" data-p="${pr.id}">
            <span class="po-lab">${T(pr.label)}</span>
            <span class="po-price" data-price="${pr.id}">—</span>
            ${pr.note ? `<span class="po-note">${T(pr.note)}</span>` : ''}
          </button>`).join('')}
      </div>
      <p class="muted side" id="payHint" style="margin-top:10px"></p>
      <button class="btn ghost" id="restoreBtn" style="margin-top:10px">${T('Відновити покупку')}</button>
    </section>

    <p class="muted side">${T('Підписка списується через Google Play і скасовується там само. Дані тренувань залишаються на пристрої й після закінчення підписки.')}</p>
  `;

  const back = screenEl.querySelector('#backPro');
  if (back) back.onclick = () => history.back();

  // ціни з Play, якщо застосунок запущено з Google Play
  const prices = await BILL.playPrices();
  if (location.hash !== '#/pro') return;
  const hint = screenEl.querySelector('#payHint');
  if (prices.length) {
    prices.forEach((p) => {
      const el = screenEl.querySelector(`[data-price="${p.id}"]`);
      if (el && p.price) el.textContent = p.price;
    });
  } else if (hint) {
    hint.textContent = BILL.WEB_CHECKOUT
      ? T('Оплата карткою у вікні, що відкриється')
      : T('Оплату ще не підключено — з’явиться у версії з Google Play');
  }

  screenEl.querySelectorAll('.plan-opt').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      const res = await BILL.buy(b.dataset.p);
      b.disabled = false;
      if (!res.ok) {
        if (res.reason === 'no-billing') toast(`⚠️ ${T('Оплату ще не підключено — з’явиться у версії з Google Play')}`);
        else if (res.reason !== 'web-checkout') toast(`⚠️ ${T('Покупку скасовано')}`);
        return;
      }
      await applyPurchase(res);
    })
  );

  screenEl.querySelector('#restoreBtn').onclick = async () => {
    const res = await BILL.restore();
    if (!res.ok) {
      toast(`⚠️ ${res.reason === 'not-found' ? T('Активних покупок не знайдено') : T('Оплату ще не підключено — з’явиться у версії з Google Play')}`);
      return;
    }
    await applyPurchase(res);
  };
}

// Спільне для покупки й відновлення: звірити з сервером і записати підписку.
async function applyPurchase(res) {
  const ver = await BILL.verify(res);
  if (ver.error) {
    toast(`⚠️ ${T('Не вдалося підтвердити покупку')}`);
    return;
  }
  BILL.setSubscription(ver);
  toast(`${proIcon(16)} ${T('Підписка активна')}`);
  go('#/today');
}

// =====================================================================
//  ЕКРАН: РОЗУМНИЙ ТРЕНЕР (аналіз відновлення, все рахується на пристрої)
// =====================================================================
const SMART_STATUS = {
  ready: { ico: '🟢', lab: 'готово' },
  soon: { ico: '🟡', lab: 'майже' },
  rest: { ico: '🔴', lab: 'відпочинок' },
};

// «3 спостереження» / «7 спостережень» — щоб підпис читався як людський текст
function smartObsWord(n) {
  const d = n % 10, dd = n % 100;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} спостереження`;
  return `${n} спостережень`;
}

function smartGapWord(n) {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} день`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} дні`;
  return `${n} днів`;
}

function renderSmart() {
  const prof = SM.restProfile();
  const ready = prof.filter((m) => m.status === 'ready');

  const readyRows = prof
    .map((m) => {
      const st = SMART_STATUS[m.status];
      const since = m.daysSince == null ? 'ще не тренував' : `${smartGapWord(m.daysSince)} тому`;
      return `<div class="mus-row rd-row">
        <span class="mus-name">${esc(m.label)}</span>
        <span class="mus-bar"><i class="rd-${m.status}" style="width:${Math.max(4, m.pct)}%"></i></span>
        <span class="mus-val">${st.ico} ${m.pct}%</span>
        <span class="rd-sub">${since} · оптимум ${smartGapWord(m.optimal)}${m.status === 'ready' ? '' : ` · далі ${S.prettyDate(m.nextISO)}`}</span>
      </div>`;
    })
    .join('');

  const gapRows = prof
    .map((m) => {
      const bars = m.buckets
        .map((b) => {
          const sign = b.delta > 0 ? '+' : '';
          const cls = b.delta > 0.5 ? 'up' : b.delta < -0.5 ? 'down' : '';
          const on = m.best && b.gap === m.best.gap ? ' on' : '';
          return `<span class="gap-chip${on} ${cls}">${b.gap}д <b>${sign}${b.delta.toFixed(1)}%</b><small>×${b.n}</small></span>`;
        })
        .join('');
      const verdict = m.best
        ? `найкраще через <b>${smartGapWord(m.best.gap)}</b> · ${m.best.delta > 0 ? '+' : ''}${m.best.delta.toFixed(1)}% за ${smartObsWord(m.samples)}`
        : m.samples === 0
          ? `даних ще немає — поки ${smartGapWord(SM.DEFAULT_GAP)}`
          : `замало даних (${m.samples} з ${SM.MIN_SAMPLES}) — поки ${smartGapWord(SM.DEFAULT_GAP)}`;
      return `<div class="gap-block">
        <div class="gap-head"><span>${esc(m.label)}</span><span class="muted">${verdict}</span></div>
        ${bars ? `<div class="gap-chips">${bars}</div>` : ''}
      </div>`;
    })
    .join('');

  const advice = ready.length
    ? `<b>${ready.slice(0, 3).map((m) => esc(m.label)).join(', ')}</b>${ready.length > 3 ? ` та ще ${ready.length - 3}` : ''} — вже відновилися, сьогодні можна навантажувати.`
    : prof.length
      ? `Усі групи ще відновлюються. Найближча — <b>${esc(prof[0].label)}</b> (${S.prettyDate(prof[0].nextISO)}).`
      : 'Записуй підходи — після кількох тренувань тут зʼявиться твій особистий графік відновлення.';

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">Розумний тренер</div>
        <div class="appbar-title">Відновлення</div></div>
    </header>
    <section class="card smart-tip"><div class="st-ico">🧠</div><div class="st-txt">${advice}</div></section>
    ${prof.length ? `
    <section class="card">
      <div class="card-label">Готовність груп сьогодні</div>
      ${readyRows}
    </section>
    <section class="card">
      <div class="card-label">Твій інтервал відпочинку</div>
      <p class="muted side">Скільки в середньому додавав результат після паузи в N днів. Зелене — твій найкращий інтервал.</p>
      ${gapRows}
    </section>` : ''}
    <p class="muted side">Рахується на пристрої: для кожної вправи беруться сусідні тренування — розрив у днях і зміна найкращого підходу (1ПМ або повторення). Значення усереднюються по групі мʼязів. Потрібно щонайменше ${SM.MIN_SAMPLES} пари, інакше показується типова пауза ${smartGapWord(SM.DEFAULT_GAP)}.</p>
  `;
  screenEl.querySelector('#backBtn').onclick = () => go('#/progress');
}

// =====================================================================
//  ЕКРАН: ЗАМІРИ ТІЛА
// =====================================================================
// назва заміру: «Біцепс Л» / «Литка П» (short — коротка для міток)
function metricName(m, short) {
  const base = T(short ? m.short || m.label : m.label);
  return m.side ? `${base} ${T(m.side === 'L' ? 'Л' : 'П')}` : base;
}

function renderBody() {
  if (!S.BODY_METRICS.some((m) => m.id === bodyMetric)) bodyMetric = 'chest';
  const sex = S.getSettings().sex === 'f' ? 'f' : 'm';
  const extra = S.BODY_METRICS.filter((m) => !BODY_PARTS.includes(m.id));

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">${T('Прогрес')}</div>
        <div class="appbar-title">${T('Заміри тіла')}</div></div>
    </header>
    <section class="b3d-card">
      <button class="b3d-cmp ${bodyCompare ? 'on' : ''}" id="cmpBtn">${T('Було / стало')}</button>
      <div class="b3d-seg" id="sexSeg">
        <button data-sex="m" class="${sex === 'm' ? 'on' : ''}">${T('Чоловік')}</button>
        <button data-sex="f" class="${sex === 'f' ? 'on' : ''}">${T('Жінка')}</button>
      </div>
      <div class="b3d-stage" id="b3dStage"></div>
      <div class="b3d-hint" id="b3dHint">${T('Тягни, щоб повернути · тапни на частину тіла')}</div>
      <div class="b3d-cmp-note" id="cmpNote"></div>
      <div class="b3d-extra" id="b3dExtra">${extra
        .map((m) => `<button class="b3d-chip" data-m="${m.id}"><span>${esc(metricName(m))}</span><b></b></button>`)
        .join('')}</div>
    </section>
    <div id="weightCard"></div>
    <div id="bodyDetails"></div>
  `;

  screenEl.querySelector('#backBtn').onclick = () => go('#/progress');

  const latestVals = () => {
    const v = {};
    S.BODY_METRICS.forEach((m) => { const l = S.latestMeasurement(m.id); if (l) v[m.id] = l.value; });
    return v;
  };
  const labelsFor = (v) => {
    const l = {};
    BODY_PARTS.forEach((id) => {
      const m = S.BODY_METRICS.find((x) => x.id === id);
      const lt = S.latestMeasurement(id);
      l[id] = {
        title: metricName(m, true),
        value: v[id] != null ? `${v[id]} ${T(m.unit)}` : '—',
        delta: lt && lt.count > 1 ? lt.delta : 0,
      };
    });
    return l;
  };
  const paintExtra = (v) => {
    screenEl.querySelectorAll('.b3d-chip').forEach((b) => {
      const m = S.BODY_METRICS.find((x) => x.id === b.dataset.m);
      const lt = S.latestMeasurement(m.id);
      const d = lt && lt.count > 1 && lt.delta ? ` ${lt.delta > 0 ? '▲' : '▼'}${Math.abs(lt.delta)}` : '';
      b.querySelector('b').textContent = (v[m.id] != null ? `${v[m.id]} ${T(m.unit)}` : '—') + d;
      b.classList.toggle('on', m.id === bodyMetric);
    });
  };

  const selectMetric = (id) => {
    bodyMetric = id;
    if (live.body3d) live.body3d.select(BODY_PARTS.includes(id) ? id : null);
    paintExtra(latestVals());
    paintBodyDetails();
  };
  screenEl.querySelectorAll('.b3d-chip').forEach((b) => b.addEventListener('click', () => selectMetric(b.dataset.m)));

  screenEl.querySelectorAll('#sexSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      S.updateSettings({ sex: b.dataset.sex });
      screenEl.querySelectorAll('#sexSeg button').forEach((x) => x.classList.toggle('on', x === b));
      if (live.body3d) live.body3d.update({}, b.dataset.sex);
    })
  );

  // нижня частина: редактор вибраного заміру, графік, історія
  function paintBodyDetails() {
    const box = screenEl.querySelector('#bodyDetails');
    if (!box) return;
    const dateISO = bodyDate || S.todayISO();
    const metric = S.BODY_METRICS.find((m) => m.id === bodyMetric);
    const unit = T(metric.unit);
    const onDate = S.getMeasurement(dateISO)[metric.id];
    const latest = S.latestMeasurement(metric.id);
    const startVal = onDate != null ? onDate : latest ? latest.value : '';
    const rows = S.measurementHistory(metric.id);
    const dates = S.measurementDates();

    let deltaHtml = '';
    if (latest) {
      const d = latest.delta;
      const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
      const sign = d > 0 ? '+' : '';
      deltaHtml = `<div class="body-latest">
        <span class="bl-val">${latest.value} <small>${unit}</small></span>
        ${latest.count > 1 ? `<span class="bl-delta ${cls}">${sign}${d} ${unit} ${T('від старту')}</span>` : `<span class="muted">${T('перший запис')}</span>`}
      </div>`;
    }
    const histList = dates
      .map((iso) => {
        const m = S.getMeasurement(iso);
        const parts = S.BODY_METRICS.filter((mt) => m[mt.id] != null).map((mt) => `${esc(metricName(mt, true))} ${m[mt.id]}${T(mt.unit)}`);
        return `<div class="bhist-row"><span class="bhist-date">${S.prettyDate(iso)}</span>
          <span class="bhist-vals">${parts.join(' · ')}</span>
          <button class="set-del" data-iso="${iso}" title="${T('Видалити')}">✕</button></div>`;
      })
      .join('');

    box.innerHTML = `
      <section class="card b3d-editor">
        <div class="b3d-ed-head">
          <span class="b3d-ed-title">${esc(metricName(metric))}</span>
          <input type="date" id="bDate" value="${dateISO}" class="date-input b3d-date"/>
        </div>
        <div class="b3d-ed-row">
          <button class="b3d-step" id="bMinus" aria-label="−">−</button>
          <div class="b3d-val"><input type="number" inputmode="decimal" step="0.1" min="0" id="bVal" value="${startVal}" placeholder="—"/><span>${unit}</span></div>
          <button class="b3d-step" id="bPlus" aria-label="+">+</button>
        </div>
        <button class="btn primary" id="saveBody">${T('Зберегти')}</button>
      </section>
      <div class="chart-card">
        <div class="card-label">${esc(metricName(metric))}, ${unit}</div>
        ${deltaHtml}
        ${lineChartSVG(rows)}
      </div>
      ${histList ? `<div class="card-label bhist-title">${T('Історія замірів')}</div><div class="bhist">${histList}</div>` : ''}
    `;

    const valInp = box.querySelector('#bVal');
    // фігура міняється одразу, ще до збереження
    const preview = () => {
      const n = Number(valInp.value);
      if (live.body3d && n > 0) live.body3d.update({ [metric.id]: n });
    };
    const step = (d) => {
      const n = Number(valInp.value) || (latest ? latest.value : BODY_BASE[sex][metric.base || metric.id]) || 0;
      valInp.value = Math.max(0, Math.round((n + d) * 10) / 10);
      preview();
    };
    box.querySelector('#bMinus').onclick = () => step(-0.5);
    box.querySelector('#bPlus').onclick = () => step(0.5);
    valInp.oninput = preview;
    const dateInp = box.querySelector('#bDate');
    dateInp.onchange = () => { bodyDate = dateInp.value || S.todayISO(); paintBodyDetails(); };
    const refresh = () => {
      const v = latestVals();
      if (live.body3d) { live.body3d.setLabels(labelsFor(v)); live.body3d.update(v); if (bodyCompare) live.body3d.setGhost(firstVals()); }
      paintExtra(v);
      paintWeight();
      paintBodyDetails();
    };
    box.querySelector('#saveBody').onclick = () => {
      S.setMeasurement(dateInp.value || dateISO, { [metric.id]: valInp.value });
      toast(T('Заміри збережено'));
      refresh();
    };
    box.querySelectorAll('.bhist-row .set-del').forEach((b) =>
      b.addEventListener('click', () => {
        const iso = b.dataset.iso;
        if (confirm(`${T('Видалити заміри за')} ${S.prettyDate(iso)}?`)) {
          S.deleteMeasurement(iso);
          refresh();
        }
      })
    );
  }

  // перші значення кожного заміру — силует «було»
  function firstVals() {
    const v = {};
    S.BODY_METRICS.forEach((m) => { const h = S.measurementHistory(m.id); if (h.length) v[m.id] = h[0].value; });
    return v;
  }
  const firstDate = () => { const d = S.measurementDates(); return d.length ? d[d.length - 1] : null; };
  function paintCompare() {
    const note = screenEl.querySelector('#cmpNote');
    const btn = screenEl.querySelector('#cmpBtn');
    btn.classList.toggle('on', bodyCompare);
    note.textContent = bodyCompare && firstDate() ? `${T('Силует — перший замір')}: ${S.prettyDate(firstDate())}` : '';
    if (live.body3d) live.body3d.setGhost(bodyCompare ? firstVals() : null);
  }
  screenEl.querySelector('#cmpBtn').onclick = () => {
    if (!bodyCompare && S.measurementDates().length < 2) { toast(T('Потрібно щонайменше два заміри в різні дні')); return; }
    bodyCompare = !bodyCompare;
    paintCompare();
  };

  // картка ваги: старт → зараз → ціль
  function paintWeight() {
    const box = screenEl.querySelector('#weightCard');
    const rows = S.measurementHistory('bodyWeight');
    const target = Number(S.getSettings().targetWeight) || null;
    const kg = T('кг');
    const fmt = (x) => Math.round(x * 10) / 10;
    let inner;
    if (!rows.length) {
      inner = `<p class="muted wc-empty">${T('Додай вагу — тапни «Вага тіла» під фігурою')}</p>`;
    } else {
      const start = rows[0].value, now = rows[rows.length - 1].value;
      const d = fmt(now - start);
      let bar = '';
      if (target && target !== start) {
        const prog = Math.max(0, Math.min(1, (start - now) / (start - target)));
        const left = fmt(Math.abs(target - now));
        const done = (start > target && now <= target) || (start < target && now >= target);
        bar = `<div class="wc-bar"><i style="width:${Math.round(prog * 100)}%"></i></div>
          <div class="wc-left">${done ? T('Ціль досягнуто!') : `${T('Залишилось')} ${left} ${kg}`} · ${Math.round(prog * 100)}%</div>`;
      }
      inner = `
        <div class="wc-row">
          <div><small>${T('Старт')}</small><b>${start}</b><span>${kg}</span></div>
          <div><small>${T('Зараз')}</small><b>${now}</b><span>${kg}</span>${d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</em>` : ''}</div>
          <div><small>${T('Ціль')}</small><b>${target || '—'}</b><span>${target ? kg : ''}</span></div>
        </div>
        ${bar}
        ${rows.length > 1 ? lineChartSVG(rows) : ''}`;
    }
    box.innerHTML = `
      <section class="card wcard">
        <div class="wc-head"><span class="card-label">${T('Вага тіла')}</span>
          <button class="wc-target" id="wTargetBtn">🎯 ${target ? T('Змінити ціль') : T('Вказати ціль')}</button></div>
        <div class="wc-edit" id="wTargetEdit" hidden>
          <input type="number" inputmode="decimal" step="0.1" min="20" id="wTargetInp" value="${target || ''}" placeholder="${T('Цільова вага')}, ${kg}"/>
          <button class="btn primary" id="wTargetSave">${T('Зберегти')}</button>
        </div>
        ${inner}
      </section>`;
    box.querySelector('#wTargetBtn').onclick = () => {
      const ed = box.querySelector('#wTargetEdit');
      ed.hidden = !ed.hidden;
      if (!ed.hidden) box.querySelector('#wTargetInp').focus();
    };
    box.querySelector('#wTargetSave').onclick = () => {
      const v = Number(box.querySelector('#wTargetInp').value);
      S.updateSettings({ targetWeight: v > 0 ? Math.round(v * 10) / 10 : null });
      toast(T('Ціль збережено'));
      paintWeight();
    };
  }

  const vals = latestVals();
  paintExtra(vals);
  paintWeight();
  paintBodyDetails();

  const stage = screenEl.querySelector('#b3dStage');
  const hash = location.hash;
  mountBody3D(stage, {
    sex,
    values: vals,
    selected: BODY_PARTS.includes(bodyMetric) ? bodyMetric : null,
    labels: labelsFor(vals),
    angle: bodyAngle,
    onPick: selectMetric,
  })
    .then((b3d) => {
      // користувач міг піти з екрана, поки вантажився Three.js
      if (location.hash !== hash || !stage.isConnected) { b3d.destroy(); return; }
      live.body3d = b3d;
      paintCompare();
    })
    .catch((err) => {
      console.warn('3D-фігура:', err);
      // без WebGL — звичайний список частин тіла замість фігури
      stage.classList.add('b3d-fallback');
      screenEl.querySelector('#b3dHint').textContent = T('3D-фігура недоступна на цьому пристрої');
      const ex = screenEl.querySelector('#b3dExtra');
      ex.insertAdjacentHTML('afterbegin', BODY_PARTS.map((id) => {
        const m = S.BODY_METRICS.find((x) => x.id === id);
        return `<button class="b3d-chip" data-m="${id}"><span>${esc(metricName(m, true))}</span><b></b></button>`;
      }).join(''));
      ex.querySelectorAll('.b3d-chip').forEach((b) => { b.onclick = () => selectMetric(b.dataset.m); });
      paintExtra(latestVals());
    });
}

// бейдж рекордів для екрана історії по вправі
function renderBestsCard(exerciseId) {
  const b = S.exerciseBests(exerciseId);
  if (b.count === 0) return '';
  const items = b.bodyweight
    ? [[T('Макс. повторень'), `${b.maxReps}`]]
    : [[T('Макс. вага'), `${b.maxWeight} ${T('кг')}`], [T('Макс. повт.'), `${b.maxReps}`], [T('1ПМ ≈'), `${Math.round(b.max1RM)} ${T('кг')}`]];
  return `<div class="chart-card"><div class="card-label">🏆 ${T('Рекорди')}</div>
    <div class="best-grid">${items.map(([k, v]) => `<div class="best-cell"><div class="best-v">${v}</div><div class="best-k">${k}</div></div>`).join('')}</div>
  </div>`;
}

// =====================================================================
//  ЕКРАН: ІСТОРІЯ
// =====================================================================
function renderHistory(exerciseId) {
  const list = S.getExercises({ includeArchived: true });
  // без вибору — остання вправа, яку робили (перша в списку часто ще без записів → порожній екран)
  const lastIso = (id) => (S.exerciseHistory(id)[0] || {}).iso || '';
  const recent = list.filter((x) => lastIso(x.id)).sort((x, y) => lastIso(y.id).localeCompare(lastIso(x.id)))[0];
  const current = exerciseId || (recent || list[0] || {}).id;

  const chips = list
    .map((ex) => `<button class="hchip ${ex.id === current ? 'on' : ''}" data-id="${ex.id}">${exIconHTML(ex) || ex.icon} ${esc(ex.name)}</button>`)
    .join('');

  const ex = S.getExercise(current);
  const rows = current ? S.exerciseHistory(current) : [];
  let table = '';
  if (rows.length === 0) {
    table = `<div class="empty"><div class="empty-ico">📭</div><p>${T('Поки немає записів для цієї вправи.')}</p></div>`;
  } else {
    table = `<div class="hist-table">
      <div class="hist-head"><span>${T('Дата')}</span><span>${T('Вага')}</span><span>${T('Підходи (повт.)')}</span></div>
      ${rows.map((r) => {
        const w = r.weightType === 'bodyweight' ? '—' : `${r.weight} ${T('кг')}`;
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
      <div class="appbar-titles"><div class="appbar-kicker">${T('Історія по вправі')}</div>
        <div class="appbar-title">${ex ? esc(ex.name) : T('Вправи')}</div></div>
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
  return `<div class="chart-card"><div class="card-label">${T('Динаміка обсягу (вага×повт.)')}</div><div class="bars">${bars}</div></div>`;
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
        <div class="appbar-title">Gym Log</div></div>
    </header>

    <section class="card">
      <div class="card-label">${T('Мова')}</div>
      <select id="langSel" class="sel">
        ${LANGS.map((l) => `<option value="${l.id}" ${s.lang === l.id ? 'selected' : ''}>${l.label}</option>`).join('')}
      </select>
    </section>

    <section class="card" id="acctCard">
      <div class="card-label">${T('Акаунт')}</div>
      <div id="acctBody"><p class="muted">${T('Перевіряю…')}</p></div>
    </section>

    <section class="card">
      <div class="card-label">${T('Підписка')}</div>
      <button class="btn ghost" id="proBtn">${
        BILL.status() === 'active'
          ? `${proIcon()} ${T('Підписка активна')} ›`
          : `${proIcon()} ${T('Оформити підписку')} ›`
      }</button>
      <p class="muted side" style="margin:8px 4px 0">${T('Безкоштовно')}: ${BILL.FREE_PHOTOS} ${T('фото на день')}</p>
    </section>

    <section class="card">
      <div class="card-label">${T('Вигляд')}</div>
      <div class="type-chips" id="themeChips">
        ${THEMES.map((th) => `<button class="tchip ${(s.theme || 'neon') === th.id ? 'on' : ''}" data-th="${th.id}">${T(th.label)}</button>`).join('')}
      </div>
      <p class="muted side" style="margin:8px 4px 0">${T((THEMES.find((th) => th.id === (s.theme || 'neon')) || THEMES[0]).hint)}</p>
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
    <p class="muted center">Gym Log · ${T('щоденник тренувань · усі дані лише на цьому пристрої')}<br/>
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

  // тема — застосовується миттєво, без перезавантаження
  screenEl.querySelector('#proBtn').onclick = () => go('#/pro');
  renderAccountBox();
  screenEl.querySelector('#themeChips').addEventListener('click', (e) => {
    const b = e.target.closest('.tchip');
    if (!b) return;
    S.updateSettings({ theme: b.dataset.th });
    applyTheme(b.dataset.th);
    renderSettings();
  });

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

// розділ вкладки «Спільнота»: Рецепти (стрічка як у TikTok) | Стрічка (дописи з фото) | Люди
let commSeg = 'recipes';
const CSEGS = [['recipes', 'Рецепти'], ['feed', 'Стрічка'], ['people', 'Люди']];
function commSegHTML(cls) {
  return `<div class="${cls}">${CSEGS.map(([id, l]) =>
    `<button class="${commSeg === id ? 'on' : ''}" data-seg="${id}">${T(l)}</button>`).join('')}</div>`;
}
function bindCommSeg(root) {
  root.querySelectorAll('[data-seg]').forEach((b) => (b.onclick = () => {
    if (commSeg === b.dataset.seg) return;
    commSeg = b.dataset.seg;
    recipeAt = null;
    if (location.hash !== '#/community') go('#/community');
    else renderCommunityHub();
  }));
}
function renderCommunityHub() {
  return commSeg === 'recipes' ? renderRecipes() : renderCommunity();
}

// лайки — поки без сервера, лише на цьому пристрої
const LIKES_KEY = 'kachalka-likes';
function likedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(LIKES_KEY) || '[]')); } catch { return new Set(); }
}
function toggleLike(id) {
  const s = likedSet();
  const on = !s.has(id);
  if (on) s.add(id); else s.delete(id);
  try { localStorage.setItem(LIKES_KEY, JSON.stringify([...s])); } catch { /* приватний режим — лайк живе до перезавантаження */ }
  return on;
}

// позначка біля імені: офіційний акаунт Gym Log або приклад профілю
function personBadge(a) {
  if (a.official) return `<span class="badge-off" title="${T('Офіційний акаунт')}">✔</span>`;
  if (a.sample) return `<span class="badge-sample">${T('Приклад профілю')}</span>`;
  return '';
}
function roleLabel(p) {
  return p.role === 'trainer' ? `🧑‍🏫 ${T('Тренер')}` : p.role === 'kitchen' ? `🍳 ${T('Рецепти')}` : `🏋️ ${T('Атлет')}`;
}

function postCardHTML(p, meId, liked) {
  const a = p.author || {};
  const mine = meId && p.author_id === meId;
  const on = liked.has(p.id);
  const fb = p.fallback ? ` onerror="this.onerror=null;this.src='${p.fallback}'"` : '';
  return `<section class="card post-card">
    <div class="post-head">
      <button class="post-user" data-u="${esc(p.author_id)}">${avatarHtml(a)}</button>
      <button class="post-author" data-u="${esc(p.author_id)}">${esc(T(a.name || 'Без імені'))}${personBadge(a)}</button>
      <span class="post-date muted">${postDate(p.created_at)}</span>
      ${mine ? `<button class="set-del post-del" data-id="${p.id}" data-path="${esc(p.photo_path || '')}" title="${T('Видалити')}">✕</button>` : ''}
    </div>
    <img class="post-img" src="${esc(p.photo_url)}" alt="" loading="lazy"${fb}/>
    <div class="post-acts">
      <button class="post-act ${on ? 'on' : ''}" data-like="${esc(p.id)}">${on ? '♥' : '♡'}</button>
      <button class="post-act" data-share="${esc(p.id)}">↗</button>
    </div>
    ${p.caption ? `<p class="post-cap">${esc(p.official || a.official || a.sample ? T(p.caption) : p.caption)}</p>` : ''}
  </section>`;
}

function personRowHTML(p) {
  return `<button class="pick-row fc-row person-row" data-u="${esc(p.id)}">
    ${avatarHtml(p)}
    <span class="pick-name">${esc(T(p.name || 'Без імені'))}${personBadge(p)}${p.city ? ` <span class="muted">· ${esc(T(p.city))}</span>` : ''}</span>
    <span class="fc-pat">${roleLabel(p)}</span>
  </button>`;
}

async function renderCommunity() {
  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles">
        <div class="appbar-kicker">👥 ${T('Спільнота')}</div>
        <div class="appbar-title">Gym Log</div>
      </div>
      <button class="icon-btn" id="myCab" title="${T('Мій кабінет')}">👤</button>
    </header>
    ${commSegHTML('cseg')}
    <div id="commBody"><section class="card"><p class="muted">${T('Завантаження…')}</p></section></div>`;
  screenEl.querySelector('#myCab').onclick = () => go('#/coach');
  bindCommSeg(screenEl);
  const seg = commSeg;
  const alive = () => location.hash === '#/community' && commSeg === seg;

  const { demoData } = await import('./demo.js');
  const D = demoData();
  let session = null, posts = [], people = [], shared = null, loadErr = null;
  if (BE.configured) {
    try { session = await BE.getSession(); } catch { /* нижче — запрошення увійти */ }
    if (session) {
      try {
        [posts, people, shared] = await Promise.all([
          BE.listPosts(),
          BE.listPeople(),
          BE.mySharedTraining().catch(() => null),
        ]);
      } catch (e) { loadErr = e; }
    }
  }
  if (!alive()) return;
  const meId = session ? session.user.id : null;
  // якщо ділюся тренуваннями — тихо освіжити знімок останніх 14 днів
  if (shared) BE.shareTraining(S.exportRecentLogs(14)).catch(() => {});

  // верх: публікація (є вхід) / запрошення увійти / сервер ще не підключено
  let top = '';
  if (session) {
    top = seg === 'feed' ? `
      <section class="card">
        <div class="wt-head">
          <span class="card-label wt-label">📸 ${T('Фото з тренувань')}</span>
          <button class="wt-current" id="addPost">＋ ${T('Додати фото')}</button>
        </div>
      </section>
      <label class="card share-row">
        <input type="checkbox" id="shareTr" ${shared ? 'checked' : ''}/>
        <span>🏋️ ${T('Ділитися моїми тренуваннями')}</span>
      </label>` : '';
  } else if (BE.configured) {
    top = `<section class="card">
      <p class="muted">${T('Публікуй фото з тренувань, дивись, як тренуються інші, і записуйся на тренування до тренерів.')}</p>
      <div class="auth-box">${authCardHTML()}</div>
    </section>`;
  } else {
    top = `<section class="card comm-note"><p class="muted">${T('Публікувати свої фото можна буде після входу — сервер спільноти ще підключається. Поки тут дописи Gym Log і приклади профілів.')}</p></section>`;
  }
  if (loadErr) top += `<section class="card"><p class="muted">⚠️ ${esc(loadErr.message)}</p></section>`;

  const liked = likedSet();
  const realPeople = people.filter((p) => p.id !== meId);
  const official = D.people.filter((p) => p.official);
  // приклади профілів — лише поки справжніх людей менше 5
  const showSamples = realPeople.length < 5;
  const samples = showSamples ? D.people.filter((p) => p.sample) : [];
  let content;
  if (seg === 'feed') {
    const demoPosts = D.posts.filter((p) => showSamples || !p.author.sample);
    const all = [...posts, ...demoPosts].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    content = `<div class="feed">${all.map((p) => postCardHTML(p, meId, liked)).join('')}</div>`;
  } else {
    content = `
      <section class="card">
        <div class="card-label">${T('Офіційні акаунти')}</div>
        <div class="pick-list">${official.map(personRowHTML).join('')}</div>
      </section>
      ${realPeople.length ? `<section class="card">
        <div class="card-label">${T('Люди')}</div>
        <div class="pick-list">${realPeople.map(personRowHTML).join('')}</div>
      </section>` : ''}
      ${samples.length ? `<section class="card">
        <div class="card-label">${T('Приклади профілів')}</div>
        <p class="muted small">${T('Так виглядатимуть сторінки тренерів і атлетів. Приклади зникнуть, коли зареєструються справжні люди.')}</p>
        <div class="pick-list">${samples.map(personRowHTML).join('')}</div>
      </section>` : ''}`;
  }
  const body = screenEl.querySelector('#commBody');
  body.innerHTML = top + content;
  if (!session && BE.configured) bindAuthCard(body, () => renderCommunity());

  // переходи на сторінку людини (з допису або списку)
  body.querySelectorAll('[data-u]').forEach((el) =>
    el.addEventListener('click', () => go('#/user/' + el.dataset.u))
  );
  const byPost = (id) => posts.find((p) => p.id === id) || D.posts.find((p) => p.id === id);
  body.querySelectorAll('[data-like]').forEach((b) => (b.onclick = () => {
    const on = toggleLike(b.dataset.like);
    b.classList.toggle('on', on);
    b.textContent = on ? '♥' : '♡';
  }));
  body.querySelectorAll('[data-share]').forEach((b) => (b.onclick = () => {
    const p = byPost(b.dataset.share);
    if (!p) return;
    const a = p.author || {};
    const text = `${T(a.name || '')}: ${a.official || a.sample ? T(p.caption || '') : p.caption || ''}\n\n— Gym Log`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard.writeText(text).then(() => toast(T('Скопійовано')), () => {});
  }));
  // видалити свій допис
  body.querySelectorAll('.post-del').forEach((b) =>
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
  const shareTr = body.querySelector('#shareTr');
  if (shareTr) shareTr.onchange = async (e) => {
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
  const addPost = body.querySelector('#addPost');
  if (addPost) addPost.onclick = () => {
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

// сторінка офіційного акаунта / прикладу профілю (дані з demo.js, без сервера)
async function renderDemoUser(userId) {
  const { demoData } = await import('./demo.js');
  if (!location.hash.startsWith('#/user/')) return;
  const D = demoData();
  const prof = D.byId[userId];
  if (!prof) return go('#/community');
  const titleEl = screenEl.querySelector('#uTitle');
  if (titleEl) titleEl.textContent = T(prof.name);
  const uBody = screenEl.querySelector('#uBody');
  const posts = D.posts.filter((p) => p.author_id === userId);
  const sharedTr = D.shared[userId];
  const slots = D.slots[userId] || [];
  const slotRow = (s) => {
    const d = new Date(s.starts_at);
    const when = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `<div class="slot-row"><span>🕒 ${when} · ${s.duration_min} ${T('хв')}</span>
      <button class="mini ok demo-act">${T('Записатися')}</button></div>`;
  };
  let trainHtml = '';
  if (sharedTr) {
    const days = Object.keys(sharedTr.data).sort().reverse();
    trainHtml = `<section class="card">
      <div class="card-label">🏋️ ${T('Останні тренування')}</div>
      <div class="bhist">
        ${days.map((iso) => {
          const txt = sharedTr.data[iso].map((it) => `${esc(T(it.name))} ${it.sets.length}×`).join(', ');
          return `<div class="bhist-row"><span class="bhist-date">${S.prettyDate(iso)}</span>
            <span class="bhist-vals">${txt}</span></div>`;
        }).join('')}
      </div>
    </section>`;
  }
  const kitchen = prof.role === 'kitchen';
  uBody.innerHTML = `
    ${prof.sample ? `<div class="demo-banner">👀 ${T('Приклад профілю — так виглядатиме сторінка справжньої людини')}</div>` : ''}
    <section class="card profile-card">
      <div class="profile-head">
        ${avatarHtml(prof, true)}
        <div>
          <div class="profile-name">${esc(T(prof.name))}${personBadge(prof)}</div>
          <div class="profile-role">${roleLabel(prof)}${prof.city ? ` · ${esc(T(prof.city))}` : ''}</div>
        </div>
      </div>
      ${D.bios[userId] ? `<p class="profile-bio">${esc(T(D.bios[userId]))}</p>` : ''}
      <div class="btn-row">
        ${kitchen ? `<button class="btn primary" id="toRecipes">📖 ${T('Відкрити рецепти')}</button>`
          : `<button class="btn ghost demo-act">＋ ${T('Стежити')}</button>`}
      </div>
    </section>
    ${slots.length ? `<section class="card">
      <div class="card-label">📅 ${T('Записатися на тренування')}</div>
      <div class="slot-list">${slots.map(slotRow).join('')}</div>
    </section>` : ''}
    ${trainHtml}
    ${posts.length ? `<div class="pgrid">${posts.map((p) =>
      `<img src="${esc(p.photo_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${p.fallback}'"/>`).join('')}</div>` : ''}
  `;
  const toR = uBody.querySelector('#toRecipes');
  if (toR) toR.onclick = () => { commSeg = 'recipes'; go('#/community'); };
  uBody.querySelectorAll('.demo-act').forEach((b) =>
    b.addEventListener('click', () => toast(prof.sample ? T('Це приклад профілю — тут буде справжня дія') : T('Стрічка підписок з’явиться разом із сервером спільноти')))
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
  if (/^(demo-|sample-|kachalka-)/.test(userId)) return renderDemoUser(userId); // вітрина — без сервера
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

// ---------- вхід / реєстрація (Спільнота й кабінет) ----------
// Google — одна кнопка; пошта — розгортається. onDone() — після успішного входу.
function authCardHTML() {
  return `
    <button class="btn google" id="googleBtn"><span class="g-badge">G</span> ${T('Продовжити з Google')}</button>
    <div class="or-line"><span>${T('або через пошту')}</span></div>
    <div class="auth-mail">
      <div class="field auth-new" hidden><label>${T("Ім'я")}</label><input type="text" id="cName" placeholder="${T('Як тебе звати')}" autocomplete="name"/></div>
      <div class="field"><label>${T('Пошта')}</label><input type="email" id="cEmail" inputmode="email" autocomplete="email"/></div>
      <div class="field"><label>${T('Пароль (від 6 символів)')}</label><input type="password" id="cPass" autocomplete="current-password"/></div>
      <button class="btn primary" id="loginBtn">${T('Увійти')}</button>
      <div class="auth-links">
        <button class="link-btn" id="modeBtn">${T('Немає акаунта? Зареєструватися')}</button>
        <button class="link-btn" id="forgotBtn">${T('Забули пароль?')}</button>
      </div>
    </div>
    <p class="muted auth-msg" id="authMsg"></p>`;
}
function bindAuthCard(root, onDone) {
  const $ = (q) => root.querySelector(q);
  let signup = false;
  const msg = (t2) => { const el = $('#authMsg'); if (el) el.textContent = t2; };
  // мережеві збої (сервер ще не налаштований / немає інтернету) — зрозумілими словами
  const fail = (e) => {
    const m = String((e && e.message) || e);
    msg('⚠️ ' + (/fetch|network|load failed|NAME_NOT/i.test(m) ? T('Сервер спільноти тимчасово недоступний — спробуй пізніше') : m));
  };
  $('#googleBtn').onclick = async () => {
    msg(T('Відкриваю Google…'));
    try { await BE.signInWithGoogle(); } catch (e) { fail(e); }
  };
  $('#modeBtn').onclick = () => {
    signup = !signup;
    $('.auth-new').hidden = !signup;
    $('#loginBtn').textContent = signup ? T('Зареєструватися') : T('Увійти');
    $('#modeBtn').textContent = signup ? T('Вже є акаунт? Увійти') : T('Немає акаунта? Зареєструватися');
    $('#cPass').autocomplete = signup ? 'new-password' : 'current-password';
    msg('');
  };
  $('#forgotBtn').onclick = async () => {
    const email = $('#cEmail').value.trim();
    if (!email) return msg(T('Вкажи пошту — надішлемо посилання для нового пароля'));
    msg(T('Надсилаю…'));
    try { await BE.resetPassword(email); msg('📧 ' + T('Перевір пошту — там посилання для нового пароля')); } catch (e) { fail(e); }
  };
  $('#loginBtn').onclick = async () => {
    const name = $('#cName').value.trim();
    const email = $('#cEmail').value.trim();
    const pass = $('#cPass').value;
    if (!email || !pass) return msg(T('Вкажи пошту і пароль'));
    if (signup && pass.length < 6) return msg(T('Пароль — щонайменше 6 символів'));
    msg(signup ? T('Реєструю…') : T('Входжу…'));
    try {
      if (signup) {
        const data = await BE.signUp(email, pass, name);
        if (data.session) onDone();
        else msg('📧 ' + T('Перевір пошту й підтверди реєстрацію, потім натисни «Увійти».'));
      } else {
        await BE.signIn(email, pass);
        onDone();
      }
    } catch (e) { fail(e); }
  };
}

// =====================================================================
//  ЕКРАН: КАБІНЕТ ТРЕНЕРА (бета) — акаунт на сервері
// =====================================================================
function coachShell(inner) {
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">👤 ${T('Мій кабінет')}</div>
        <div class="appbar-title">Gym Log</div></div>
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
        <div class="card-label">${T('Вхід або реєстрація')}</div>
        ${authCardHTML()}
      </section>`);
    bindAuthCard(screenEl, () => renderCoach());
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
//  ЕКРАНИ: «ЯК ВИКОНУВАТИ» (js/guides.js, ілюстрації img/exercises/<id>_0|1.webp)
// =====================================================================
const GUIDE_TITLES = {
  squat: 'Присідання зі штангою', squat_bw: 'Присідання з вагою тіла', bench_bb: 'Жим штанги лежачи',
  bench_db: 'Жим гантелей лежачи', row_bb: 'Тяга штанги в нахилі', row_db: 'Тяга гантелей у нахилі',
  deadlift: 'Станова тяга', curl: 'Згинання на біцепс', crunch: 'Скручування', pushup: 'Віджимання',
  pullup: 'Підтягування', plank: 'Планка', lunge: 'Випади', ohp: 'Жим стоячи', burpee: 'Берпі',
};
const guideTexts = {}; // мова → переклад (вантажиться за потреби)
async function guideText(id) {
  const lang = S.getSettings().lang || 'uk';
  const base = GD.GUIDES[id];
  if (!base || lang === 'uk') return base;
  try {
    if (!guideTexts[lang]) guideTexts[lang] = (await import(`./guides-i18n/${lang}.js`)).default;
    return { ...base, ...(guideTexts[lang][id] || {}) };
  } catch (e) {
    return base; // перекладу немає — українською
  }
}
const EX_IMG_V = 6; // підняти після перерендеру img/exercises — SW віддає їх із кешу (cache-first)
function guideMediaHTML(id, cls = '') {
  // мініатюра — перший кадр; велика — смужка з 9 кадрів (tools/exercise3d/anim.py), рух туди-назад робить CSS
  // (@keyframes exRun). Немає файлу — блок ховається
  if (cls === 'mini') {
    return `<div class="guide-media mini"><img src="img/exercises/${id}_0.webp?v=${EX_IMG_V}" alt="" loading="lazy" onerror="this.parentNode.remove()"/></div>`;
  }
  const src = `img/exercises/${id}_anim.webp?v=${EX_IMG_V}`;
  return `<div class="guide-media"><div class="gm-anim" style="background-image:url('${src}')"></div>
    <img src="${src}" alt="" hidden onerror="this.parentNode.remove()"/></div>`;
}

async function renderGuides() {
  const ids = Object.keys(GD.GUIDES);
  const texts = await Promise.all(ids.map(guideText));
  if (location.hash !== '#/guides') return;
  const rows = ids.map((id, i) => `
    <button class="pick-row aih-row guide-row" data-g="${id}">
      ${guideMediaHTML(id, 'mini')}
      <span class="aih-txt"><b>${T(GUIDE_TITLES[id])}</b><span class="muted">${esc(texts[i].muscles)}</span></span>
      <span class="fc-pat">›</span>
    </button>`).join('');
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backG">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">📘 ${T('Як виконувати')}</div>
        <div class="appbar-title">${T('Техніка вправ')}</div></div>
    </header>
    <div class="pick-list">${rows}</div>`;
  screenEl.querySelector('#backG').onclick = () => history.back();
  screenEl.querySelectorAll('.guide-row').forEach((b) => b.addEventListener('click', () => go('#/guide/' + b.dataset.g)));
}

async function renderGuide(id) {
  const g = await guideText(id);
  if (!g) return go('#/guides');
  if (location.hash !== '#/guide/' + id) return; // поки вантажився переклад, пішли з екрана
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join('');
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backG">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">📘 ${T('Як виконувати')}</div>
        <div class="appbar-title">${T(GUIDE_TITLES[id])}</div></div>
    </header>
    ${guideMediaHTML(id)}
    <section class="card">
      <div class="card-label">💪 ${T('Що працює')}</div>
      <p class="guide-muscles">${esc(g.muscles)}</p>
    </section>
    <section class="card">
      <div class="card-label">📋 ${T('Техніка')}</div>
      <ol class="guide-steps">${li(g.steps)}</ol>
    </section>
    <section class="card">
      <div class="card-label">⚠️ ${T('Часті помилки')}</div>
      <ul class="guide-mistakes">${li(g.mistakes)}</ul>
    </section>
    ${g.tip ? `<section class="card guide-tip"><b>💡</b> ${esc(g.tip)}</section>` : ''}`;
  screenEl.querySelector('#backG').onclick = () => history.back();
}

// =====================================================================
//  ЕКРАН: ШІ — розумні помічники + аналіз техніки
function renderAI(toForm) {
  const kcalToday = S.calorieDayTotal(S.todayISO()).kcal;
  const exs = S.getExercises();
  const fcRows = exs
    .map((e) => {
      const pid = FC.matchPattern(e);
      const p = pid ? FC.patternById(pid) : null;
      return `<button class="pick-row fc-row" data-id="${e.id}">
        <span class="pick-ico">${exIconHTML(e) || e.icon}</span>
        <span class="pick-name">${esc(e.name)}</span>
        <span class="fc-pat">${p ? `${patternIconHTML(p.id)} ${T(p.label)}` : T('обрати рух')}</span></button>`;
    })
    .join('');
  const item = (id, ico, title, sub, right = '›') => `
      <button class="pick-row aih-row" id="${id}">
        <span class="pick-ico">${ico}</span>
        <span class="aih-txt"><b>${title}</b><span class="muted">${sub}</span></span>
        <span class="fc-pat">${right}</span>
      </button>`;
  screenEl.innerHTML = `
    <header class="appbar">
      <div class="appbar-titles"><div class="appbar-kicker">🤖 ${T('ШІ')}</div>
        <div class="appbar-title">${T('Розумні помічники')}</div></div>
    </header>
    <div class="pick-list aih-list">
      ${item('aiKcal', '🍎', T('Калорії'), T('Фото страви або штрихкод — калорії й БЖВ'), `${kcalToday} ${T('ккал')} ›`)}
      ${item('aiSmart', '🧠', T('Розумний тренер'), T('Які мʼязи вже відновились і скільки відпочивати'))}
      ${item('aiGuides', '📘', T('Техніка вправ'), T('Як виконувати: кроки, помилки й 3D-ілюстрації'))}
      ${item('aiSupps', '💊', T('Вітаміни й добавки'), T('Графік прийому, уколи й курси — відмічай, що вже прийняв'), suppsToday())}
      ${item('aiImport', '📥', T('Рецепт з посилання або фото'), T('TikTok, YouTube, сайт чи сторінка з книги — запишеться сам'))}
    </div>

    <p class="muted side fc-head" id="fcList">🎥 ${T('Аналіз техніки')} — ${T('Обери вправу — камера стежитиме за технікою, підкаже глибину і порахує повторення')}</p>
    <div class="pick-list">${fcRows || `<p class="muted center">${T('Немає тренувань — додай у вкладці «Календар»')}</p>`}</div>
    <p class="muted side fc-note">${T('Відео не записується і нікуди не надсилається — аналіз іде на телефоні.')}</p>`;
  screenEl.querySelector('#aiKcal').onclick = () => go('#/calories');
  screenEl.querySelector('#aiSmart').onclick = () => go('#/smart');
  screenEl.querySelector('#aiGuides').onclick = () => go('#/guides');
  screenEl.querySelector('#aiSupps').onclick = () => go('#/supps');
  screenEl.querySelectorAll('.fc-row[data-id]').forEach((b) =>
    b.addEventListener('click', () => go('#/camera/' + b.dataset.id))
  );
  if (toForm) screenEl.querySelector('#fcList').scrollIntoView({ block: 'start' });
  screenEl.querySelector('#aiImport').onclick = () => go('#/recipe-new');
}

// =====================================================================
//  ЕКРАН: РЕЦЕПТИ — стрічка як у TikTok (Спільнота → Рецепти)
// =====================================================================
let recipeTab = 'feed'; // feed | fav | mine
let recipeFilter = 'all'; // all | breakfast | main | snack | shake | mass | cut
let recipeAt = null; // id картки, на якій зупинились (повернення з форми/шторки)
const RCAT = { breakfast: 'Сніданки', main: 'Основні страви', snack: 'Перекуси', shake: 'Шейки й десерти' };
const RCAT1 = { breakfast: 'Сніданок', main: 'Основна страва', snack: 'Перекус', shake: 'Шейк / десерт' };
const RGOAL = { mass: '💪 Маса', cut: '🔥 Сушка' };

function recipeList() {
  const lang = S.getSettings().lang || 'uk';
  let list = RC.allRecipes(lang);
  if (recipeTab === 'fav') {
    const fav = S.recipeFavs();
    list = fav.map((id) => list.find((r) => r.id === id)).filter(Boolean);
  } else if (recipeTab === 'mine') list = list.filter((r) => r.own);
  else list = RC.feedOrder(list);
  if (recipeFilter in RGOAL) list = list.filter((r) => r.goal === recipeFilter || r.goal === 'any');
  else if (recipeFilter !== 'all') list = list.filter((r) => r.cat === recipeFilter);
  return list;
}

function recipeCardHTML(r) {
  const yt = r.own ? RC.youtubeId(r.video) : null;
  const fav = S.isRecipeFav(r.id);
  const bg = r.bg || ['#2b2b3d', '#15151e'];
  // власне фото — з IndexedDB; вбудований рецепт — img/recipes/<id>.webp (немає файлу — лишається емодзі)
  const media = r.own
    ? (r.photo ? `<img class="rc-photo" data-photo="${esc(r.id)}" alt=""/>` : '')
    : `<img class="rc-photo" src="img/recipes/${esc(r.id)}.webp" loading="lazy" alt="" onerror="this.remove()"/>`;
  const tags = [r.time ? `⏱ ${r.time} ${T('хв')}` : '', T(RCAT1[r.cat] || ''), r.goal !== 'any' ? T(RGOAL[r.goal]) : '', r.own ? `👤 ${T('Мій')}` : '']
    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  return `<article class="rcard" data-id="${esc(r.id)}" ${yt ? `data-yt="${yt}"` : ''}>
    <div class="rc-bg" style="background:linear-gradient(160deg, ${bg[0]}, ${bg[1]})">
      ${(r.own && r.photo) || yt ? '' : `<span class="rc-emoji">${r.emoji || '🍽'}</span><span class="rc-pattern">${(r.emoji || '🍽').repeat(18)}</span>`}
      ${media}<div class="rc-video"></div>
    </div>
    <div class="rc-shade"></div>
    <div class="rc-info">
      ${r.own ? '' : `<div class="rc-author"><span class="rc-ava">👨‍🍳</span>${T('Кухня Gym Log')}</div>`}
      <div class="rc-tags">${tags}</div>
      <h2 class="rc-name">${esc(r.name)}</h2>
      ${r.kcal ? `<div class="rc-macros"><b>${r.kcal}</b> ${T('ккал')} · ${T('Б')} ${r.p} · ${T('Ж')} ${r.f} · ${T('В')} ${r.c}</div>` : ''}
      ${r.ing && r.ing.length ? `<p class="rc-ing">${esc(r.ing.map((x) => x.split(' — ')[0]).join(', '))}</p>` : ''}
      <button class="rc-more" data-act="open">${T('Рецепт')} ›</button>
    </div>
    <div class="rc-rail">
      <button class="rc-act ${fav ? 'on' : ''}" data-act="fav"><span>${fav ? '♥' : '♡'}</span><small>${T('Зберегти')}</small></button>
      <button class="rc-act" data-act="open"><span>📖</span><small>${T('Рецепт')}</small></button>
      ${r.video ? `<button class="rc-act" data-act="video"><span>▶</span><small>${T('Відео')}</small></button>` : ''}
      <button class="rc-act" data-act="kcal"><span>＋</span><small>${T('В калорії')}</small></button>
      <button class="rc-act" data-act="share"><span>↗</span><small>${T('Поділитися')}</small></button>
    </div>
  </article>`;
}

async function renderRecipes() {
  await RC.loadTexts(S.getSettings().lang || 'uk');
  if (location.hash !== '#/recipes' && !(location.hash === '#/community' && commSeg === 'recipes')) return;
  const list = recipeList();
  // fav / mine — окремі добірки, решта — фільтри стрічки «Для тебе»
  const chips = [['all', 'Усі'], ['fav', '♡ Обране'], ['mine', '👤 Мої'], ...Object.entries(RCAT), ...Object.entries(RGOAL)];
  const chipOn = (id) => (id === 'fav' || id === 'mine' ? recipeTab === id : recipeTab === 'feed' && recipeFilter === id);
  let empty = '';
  if (!list.length) {
    empty = recipeTab === 'fav'
      ? `<div class="rf-empty"><div class="rf-empty-ico">♡</div><p>${T('Тисни ♡ на рецепті — він з’явиться тут')}</p></div>`
      : recipeTab === 'mine'
        ? `<div class="rf-empty"><div class="rf-empty-ico">👩‍🍳</div><p>${T('Тут будуть твої рецепти — з фото, інгредієнтами й відео')}</p>
            <button class="btn primary" id="rfAddEmpty">＋ ${T('Додати свій рецепт')}</button></div>`
        : `<div class="rf-empty"><div class="rf-empty-ico">🍽</div><p>${T('Нічого не знайдено — зміни фільтр')}</p></div>`;
  }
  screenEl.innerHTML = `
    <div class="rfeed-wrap">
      <div class="rfeed" id="rfeed">${list.map(recipeCardHTML).join('')}${empty}</div>
      <div class="rf-top">
        <div class="rf-row">
          <span class="rf-ico rf-ghost"></span>
          ${commSegHTML('rf-tabs')}
          <button class="rf-ico rf-add" id="rfAdd" aria-label="${T('Додати свій рецепт')}">＋</button>
        </div>
        <div class="rf-chips">${chips.map(([id, l]) => `<button class="${chipOn(id) ? 'on' : ''}" data-f="${id}">${T(l)}</button>`).join('')}</div>
      </div>
    </div>`;

  const feed = screenEl.querySelector('#rfeed');
  bindCommSeg(screenEl);
  screenEl.querySelector('#rfAdd').onclick = () => go('#/recipe-new');
  const addEmpty = screenEl.querySelector('#rfAddEmpty');
  if (addEmpty) addEmpty.onclick = () => go('#/recipe-new');
  screenEl.querySelectorAll('.rf-chips button').forEach((b) => (b.onclick = () => {
    const f = b.dataset.f;
    if (f === 'fav' || f === 'mine') { recipeTab = f; recipeFilter = 'all'; } else { recipeTab = 'feed'; recipeFilter = f; }
    recipeAt = null;
    renderRecipes();
  }));

  // фото власних рецептів — з IndexedDB
  screenEl.querySelectorAll('img[data-photo]').forEach(async (img) => {
    const url = await RC.photoUrl(img.dataset.photo);
    if (url) img.src = url; else img.remove();
  });

  // відео YouTube грає без звуку лише на видимій картці
  const io = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      const card = e.target;
      if (e.isIntersecting) recipeAt = card.dataset.id;
      const yt = card.dataset.yt;
      if (!yt) return;
      const box = card.querySelector('.rc-video');
      if (e.isIntersecting && !box.firstChild) {
        box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&mute=1&playsinline=1&loop=1&playlist=${yt}&controls=0&rel=0" allow="autoplay; encrypted-media" title="video"></iframe>`;
      } else if (!e.isIntersecting) box.innerHTML = '';
    });
  }, { root: feed, threshold: 0.6 });
  feed.querySelectorAll('.rcard').forEach((c) => io.observe(c));
  live.camera = { destroy: () => io.disconnect() }; // прибирається при зміні екрана

  if (recipeAt) {
    const c = feed.querySelector(`.rcard[data-id="${CSS.escape(recipeAt)}"]`);
    if (c) feed.scrollTop = c.offsetTop;
  }

  const byId = (id) => list.find((r) => r.id === id);
  feed.querySelectorAll('.rcard').forEach((card) => {
    const r = byId(card.dataset.id);
    card.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => recipeAction(b.dataset.act, r, b);
    });
    // подвійний тап по картці — в обране, як у TikTok
    let last = 0;
    card.querySelector('.rc-bg').addEventListener('click', () => {
      const now = Date.now();
      if (now - last < 320) {
        if (!S.isRecipeFav(r.id)) recipeAction('fav', r, card.querySelector('[data-act="fav"]'));
        card.classList.remove('rc-pop'); void card.offsetWidth; card.classList.add('rc-pop');
      }
      last = now;
    });
  });
}

function recipeAction(act, r, btn) {
  if (act === 'fav') {
    const on = S.toggleRecipeFav(r.id);
    if (btn) { btn.classList.toggle('on', on); btn.querySelector('span').textContent = on ? '♥' : '♡'; }
    if (!on && recipeTab === 'fav') renderRecipes();
  } else if (act === 'open') openRecipeSheet(r);
  else if (act === 'video') {
    if (r.video) window.open(r.video, '_blank', 'noopener');
  } else if (act === 'kcal') {
    if (!r.kcal) { toast(T('У рецепті не вказано калорійність')); return; }
    S.addCalorieEntry(S.todayISO(), { name: r.name, kcal: r.kcal, prot: r.p, fat: r.f, carb: r.c });
    toast(`＋ ${r.kcal} ${T('ккал')} — ${T('додано в калорії дня')}`);
  } else if (act === 'share') {
    const text = `${r.name}\n${r.kcal ? `${r.kcal} ${T('ккал')} · ${T('Б')} ${r.p} · ${T('Ж')} ${r.f} · ${T('В')} ${r.c}\n` : ''}\n${(r.ing || []).map((x) => '• ' + x).join('\n')}\n\n${(r.steps || []).map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n— Gym Log`;
    if (navigator.share) navigator.share({ title: r.name, text }).catch(() => {});
    else navigator.clipboard.writeText(text).then(() => toast(T('Рецепт скопійовано')), () => {});
  }
}

// шторка знизу з повним рецептом
function openRecipeSheet(r) {
  document.querySelector('.rsheet-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'rsheet-ov';
  ov.innerHTML = `
    <div class="rsheet">
      <div class="rsheet-grip"></div>
      <h3>${esc(r.name)}</h3>
      ${r.kcal ? `<div class="rs-macros">
        <div><b>${r.kcal}</b><small>${T('ккал')}</small></div><div><b>${r.p}</b><small>${T('білки')}</small></div>
        <div><b>${r.f}</b><small>${T('жири')}</small></div><div><b>${r.c}</b><small>${T('вуглеводи')}</small></div></div>` : ''}
      ${r.time ? `<p class="muted">⏱ ${r.time} ${T('хв')} · ${T('на 1 порцію')}</p>` : ''}
      ${r.ing && r.ing.length ? `<div class="card-label">${T('Інгредієнти')}</div>
        <ul class="rs-ing">${r.ing.map((x) => `<li><label><input type="checkbox"/> <span>${esc(x)}</span></label></li>`).join('')}</ul>` : ''}
      ${r.steps && r.steps.length ? `<div class="card-label">${T('Приготування')}</div>
        <ol class="rs-steps">${r.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
      <div class="btn-col">
        ${r.video ? `<button class="btn primary" data-act="video">▶ ${T('Дивитися відео')}</button>` : ''}
        <button class="btn ${r.video ? 'ghost' : 'primary'}" data-act="kcal">＋ ${T('Додати в калорії дня')}</button>
        ${r.own ? `<div class="btn-row"><button class="btn ghost" id="rsEdit">✏️ ${T('Редагувати')}</button>
          <button class="btn ghost" id="rsDel">🗑 ${T('Видалити')}</button></div>` : ''}
      </div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('open'));
  const close = () => { ov.classList.remove('open'); setTimeout(() => ov.remove(), 250); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => recipeAction(b.dataset.act, r, null)));
  const ed = ov.querySelector('#rsEdit');
  if (ed) ed.onclick = () => { ov.remove(); go('#/recipe-edit/' + encodeURIComponent(r.id)); };
  const del = ov.querySelector('#rsDel');
  if (del) del.onclick = async () => {
    if (!confirm(T('Видалити цей рецепт?'))) return;
    S.deleteOwnRecipe(r.id);
    RC.forgetPhoto(r.id);
    await RC.delPhoto(r.id).catch(() => {});
    ov.remove();
    toast(T('Рецепт видалено'));
    renderRecipes();
  };
}

// форма: новий / редагувати свій рецепт
async function renderRecipeEdit(idEnc) {
  const id = idEnc ? decodeURIComponent(idEnc) : null;
  const r = id ? S.ownRecipes().find((x) => x.id === id) : null;
  if (id && !r) { go('#/recipes'); return; }
  const v = r || { name: '', cat: 'main', goal: 'any', time: '', kcal: '', p: '', f: '', c: '', ing: [], steps: [], video: '' };
  const num = (x) => (x ? x : '');
  let newPhoto = null; // Blob, якщо обрали нове фото
  let dropPhoto = false;
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">📖 ${T('Рецепти')}</div>
        <div class="appbar-title">${r ? T('Редагувати рецепт') : T('Новий рецепт')}</div></div>
    </header>
    ${r ? '' : `<section class="card re-import">
      <div class="card-label">✨ ${T('Автоімпорт рецепта')}</div>
      <p class="muted small">${T('Кинь фото рецепта або посилання на статтю, YouTube чи TikTok — заповню все сам')}</p>
      <div class="ri-row">
        <input type="url" id="riUrl" placeholder="${T('Посилання на рецепт або відео')}"/>
        <button class="btn primary" id="riGo">→</button>
      </div>
      <button class="btn ghost" id="riPhoto">📷 ${T('Фото рецепта')}</button>
      <input type="file" id="riPhotoIn" accept="image/*" hidden/>
      <p class="muted small" id="riQuota"></p>
    </section>`}
    <section class="card">
      <div class="re-photo" id="rePhoto"><span>📷 ${T('Додати фото страви')}</span><img alt="" hidden/></div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn ghost" id="reCam">📷 ${T('Камера')}</button>
        <button class="btn ghost" id="reGal">🖼 ${T('З галереї')}</button>
      </div>
      <input type="file" id="reCamIn" accept="image/*" capture="environment" hidden/>
      <input type="file" id="reGalIn" accept="image/*" hidden/>
    </section>
    <section class="card">
      <div class="field"><label>${T('Назва')} *</label><input type="text" id="reName" maxlength="120" value="${esc(v.name)}" placeholder="${T('Наприклад: Курка теріякі з рисом')}"/></div>
      <div class="re-grid2">
        <div class="field"><label>${T('Категорія')}</label><select id="reCat">${Object.entries(RCAT1).map(([k, l]) => `<option value="${k}" ${v.cat === k ? 'selected' : ''}>${T(l)}</option>`).join('')}</select></div>
        <div class="field"><label>${T('Мета')}</label><select id="reGoal">
          <option value="any" ${v.goal === 'any' ? 'selected' : ''}>${T('Будь-яка')}</option>
          <option value="mass" ${v.goal === 'mass' ? 'selected' : ''}>${T('💪 Маса')}</option>
          <option value="cut" ${v.goal === 'cut' ? 'selected' : ''}>${T('🔥 Сушка')}</option></select></div>
      </div>
      <div class="card-label" style="margin-top:6px">${T('На 1 порцію')}</div>
      <div class="re-grid5">
        <div class="field"><label>${T('ккал')}</label><input type="number" inputmode="numeric" id="reK" value="${num(v.kcal)}"/></div>
        <div class="field"><label>${T('Б')}, г</label><input type="number" inputmode="numeric" id="reP" value="${num(v.p)}"/></div>
        <div class="field"><label>${T('Ж')}, г</label><input type="number" inputmode="numeric" id="reF" value="${num(v.f)}"/></div>
        <div class="field"><label>${T('В')}, г</label><input type="number" inputmode="numeric" id="reC" value="${num(v.c)}"/></div>
        <div class="field"><label>⏱ ${T('хв')}</label><input type="number" inputmode="numeric" id="reT" value="${num(v.time)}"/></div>
      </div>
      <div class="field"><label>${T('Інгредієнти')} <span class="muted">${T('(кожен з нового рядка)')}</span></label>
        <textarea id="reIng" rows="5" placeholder="${T('Куряче філе — 200 г')}">${esc(v.ing.join('\n'))}</textarea></div>
      <div class="field"><label>${T('Приготування')} <span class="muted">${T('(кожен крок з нового рядка)')}</span></label>
        <textarea id="reSteps" rows="5">${esc(v.steps.join('\n'))}</textarea></div>
      <div class="field"><label>${T('Посилання на відео')} <span class="muted">YouTube / TikTok / Instagram</span></label>
        <input type="url" id="reVideo" value="${esc(v.video)}" placeholder="https://youtube.com/shorts/…"/></div>
      <button class="btn primary" id="reSave">${T('Зберегти рецепт')}</button>
    </section>`;

  screenEl.querySelector('#backBtn').onclick = () => history.back();
  const prev = screenEl.querySelector('#rePhoto img');
  const showPrev = (url) => { prev.src = url; prev.hidden = false; screenEl.querySelector('#rePhoto span').hidden = true; };
  if (r && r.photo) RC.photoUrl(r.id).then((u) => u && showPrev(u));
  const pick = async (inp) => {
    const f = inp.files[0];
    if (!f) return;
    try { newPhoto = await RC.compressPhoto(f); dropPhoto = false; showPrev(URL.createObjectURL(newPhoto)); }
    catch { toast(T('Не вдалося відкрити фото')); }
  };
  const cam = screenEl.querySelector('#reCamIn'), gal = screenEl.querySelector('#reGalIn');
  screenEl.querySelector('#reCam').onclick = () => cam.click();
  screenEl.querySelector('#reGal').onclick = () => gal.click();
  cam.onchange = () => pick(cam);
  gal.onchange = () => pick(gal);

  // ---- автоімпорт (лише для нового рецепта) ----
  const riGo = screenEl.querySelector('#riGo');
  if (riGo) {
    const urlIn = screenEl.querySelector('#riUrl');
    const photoBtn = screenEl.querySelector('#riPhoto');
    const photoIn = screenEl.querySelector('#riPhotoIn');
    const paintQuota = () => {
      const q = BILL.importQuota();
      const st = BILL.status();
      screenEl.querySelector('#riQuota').textContent = st === 'active' ? T('Підписка — без обмежень')
        : q.limit === 0 ? T('Пробний тиждень закінчився — далі з підпискою')
          : `${T('Безкоштовно сьогодні')}: ${q.left} ${T('з')} ${q.limit} · ${T('пробний тиждень, далі — підписка')}`;
    };
    paintQuota();
    const fill = (rec) => {
      const set = (q, x) => { if (x !== undefined && x !== null && x !== '' && x !== 0) screenEl.querySelector(q).value = x; };
      set('#reName', rec.name); set('#reCat', rec.cat); set('#reGoal', rec.goal);
      set('#reK', rec.kcal); set('#reP', rec.p); set('#reF', rec.f); set('#reC', rec.c); set('#reT', rec.time);
      set('#reIng', (rec.ing || []).join('\n')); set('#reSteps', (rec.steps || []).join('\n'));
      set('#reVideo', rec.video);
    };
    const run = async (input, btn) => {
      if (BILL.importQuota().left <= 0) {
        if (BILL.importQuota().limit === 0) { toast(T('Пробний тиждень закінчився — далі з підпискою')); go('#/pro'); }
        else toast(T('Ліміт на сьогодні вичерпано — далі потрібна підписка'));
        return;
      }
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳';
      toast(T('Розбираю рецепт…'));
      try {
        const rec = await RI.importRecipe({ ...input, lang: S.getSettings().lang || 'uk' });
        fill(rec);
        BILL.useImport();
        paintQuota();
        toast(T('Готово — перевір і збережи'));
        screenEl.querySelector('#reName').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        toast(T(RI.importError(e)));
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    };
    riGo.onclick = () => {
      const url = RI.findUrl(urlIn.value);
      if (!url) { toast(T('Встав посилання на рецепт або відео')); return; }
      run({ url }, riGo);
    };
    photoBtn.onclick = () => photoIn.click();
    photoIn.onchange = () => { if (photoIn.files[0]) run({ file: photoIn.files[0] }, photoBtn); };
    // прийшли з «Поділитися» (TikTok / YouTube / браузер)
    if (pendingShare) {
      urlIn.value = pendingShare;
      pendingShare = '';
      run({ url: urlIn.value }, riGo);
    }
  }

  screenEl.querySelector('#reSave').onclick = async () => {
    const val = (q) => screenEl.querySelector(q).value;
    const name = val('#reName').trim();
    if (!name) { toast(T('Вкажи назву рецепта')); return; }
    const saved = S.saveOwnRecipe({
      id: r ? r.id : null, name, cat: val('#reCat'), goal: val('#reGoal'),
      kcal: val('#reK'), p: val('#reP'), f: val('#reF'), c: val('#reC'), time: val('#reT'),
      ing: val('#reIng'), steps: val('#reSteps'), video: val('#reVideo').trim(),
      photo: newPhoto ? true : r ? r.photo && !dropPhoto : false,
    });
    if (newPhoto) {
      try { await RC.putPhoto(saved.id, newPhoto); RC.forgetPhoto(saved.id); }
      catch { toast(T('Фото не збереглося — забагато даних на пристрої')); }
    }
    toast(T('Рецепт збережено'));
    recipeTab = 'mine';
    recipeFilter = 'all';
    recipeAt = saved.id;
    go('#/recipes');
  };
}

// =====================================================================
//  ЕКРАН: КАЛОРІЇ ПО ФОТО
// =====================================================================
// Картка стану на вкладці калорій: скільки фото лишилось і що з підпискою.
function kcalStatusCard() {
  const q = BILL.photoQuota();
  const own = !!(S.getSettings().geminiKey || '').trim();
  if (own) {
    return `<section class="card kcal-status">
      <div class="ks-main">🔑 ${T('Працює на твоєму ключі')}</div>
      <div class="ks-sub">${T('Ліміти застосунку не діють — запити оплачуєш ти сам')}</div>
    </section>`;
  }
  if (BILL.status() === 'active') {
    return `<section class="card kcal-status pro">
      <div class="ks-main">${proIcon(18)} ${T('Підписка активна')}</div>
      <div class="ks-sub">${T('Фото без обмежень')}</div>
    </section>`;
  }
  const left = q.left === Infinity ? '∞' : q.left;
  const out = q.left <= 0;
  return `<section class="card kcal-status ${out ? 'out' : ''}">
    <div class="ks-main">📷 ${T('Безкоштовно сьогодні')}: <b>${left}</b> ${T('з')} ${BILL.FREE_PHOTOS}</div>
    <div class="ks-sub">${out
      ? T('Ліміт на сьогодні вичерпано — далі потрібна підписка')
      : T('Наступні фото — завтра або за підпискою')}</div>
  </section>`;
}

// «1 день / 2 дні / 5 днів» — щоб підпис читався як речення
function dayWord(n) {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} ${T('день')}`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} ${T('дні')}`;
  return `${n} ${T('днів')}`;
}

async function renderCalories() {
  const iso = selectedISO;
  const st = S.getSettings();
  const key = (st.geminiKey || '').trim();
  const list = S.caloriesForDay(iso);
  const tot = S.calorieDayTotal(iso);
  // сервер власника (ключ-секрет на Supabase) — тоді користувачу ключ не потрібен
  const proxyOk = key ? false : await CAL.proxyAvailable();
  if (location.hash !== '#/calories') return; // за час перевірки пішли з екрана
  const quota = BILL.photoQuota();
  // ключ користувача — обхід наших лімітів: він платить за запити сам
  const ownKey = !!key;

  const rows = list
    .map(
      (e) => `<div class="kcal-row"><span class="kcal-nm">${esc(e.name)}${e.g ? ` <span class="muted">· ${e.g} ${T('г')}</span>` : ''}</span>
        <b>${e.kcal} ${T('ккал')}</b>
        <button class="icon-btn kcal-del" data-id="${e.id}">✕</button></div>`
    )
    .join('');

  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backKcal">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">🍎 ${T('Калорії')}</div>
        <div class="appbar-title">${S.prettyDate(iso)}</div></div>
    </header>

    ${kcalStatusCard()}

    <section class="card">
          <div class="card-label">📷 ${T('Нова страва')}</div>
          <p class="muted hint">${T('Сфотографуй страву — ШІ оцінить калорійність і БЖВ')}</p>
          <div class="btn-row">
            <button class="btn ghost" id="snapBtn">📷 ${T('Сфотографувати страву')}</button>
            <button class="btn ghost" id="galBtn">🖼 ${T('З галереї')}</button>
          </div>
          <input type="file" id="foodCam" accept="image/*" capture="environment" hidden/>
          <input type="file" id="foodGal" accept="image/*" hidden/>
          <div id="analyzeBox"></div>
        </section>

    <section class="card">
      <div class="cseg kseg">
        <button class="${kcalPane === 'bc' ? 'on' : ''}" data-kp="bc">🏷 ${T('Штрихкод')}</button>
        <button class="${kcalPane === 'rc' ? 'on' : ''}" data-kp="rc">🧾 ${T('Чек → меню')}</button>
      </div>
      <div id="paneBc" ${kcalPane === 'bc' ? '' : 'hidden'}>
      <p class="muted hint">${T('Відскануй штрихкод на упаковці — калорії й БЖВ підтягнуться з бази продуктів')}</p>
      <div class="btn-row bc-btns">
        <button class="btn ghost" id="bcPhoto">📷 ${T('Сфотографувати штрихкод')}</button>
        ${BC.scanSupported() ? `<button class="btn ghost" id="bcScan">▥ ${T('Сканувати камерою')}</button>` : ''}
      </div>
      <input type="file" id="bcFile" accept="image/*" capture="environment" hidden/>
      <div class="bc-manual">
        <input id="bcCode" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="${T('Цифри штрихкоду')}"/>
        <button class="btn ghost" id="bcFind">${T('Знайти')}</button>
      </div>
      <div id="bcBox"></div>
      </div>
      ${receiptPaneHTML()}
    </section>

    <section class="card">
      <div class="card-label">${T('Зʼїдено за день')}</div>
      ${list.length ? rows : `<p class="muted">${T('Записів ще немає')}</p>`}
      <div class="card-div"></div>
      <div class="kcal-total"><b>${T('Разом')}: ${tot.kcal} ${T('ккал')}</b>
        <span class="muted">${T('Б')} ${tot.prot} · ${T('Ж')} ${tot.fat} · ${T('В')} ${tot.carb} г</span></div>
    </section>`;

  screenEl.querySelector('#backKcal').onclick = () => history.back();

  screenEl.querySelectorAll('.kcal-del').forEach((b) =>
    b.addEventListener('click', () => { S.deleteCalorieEntry(iso, b.dataset.id); renderCalories(); })
  );

  const box = () => screenEl.querySelector('#analyzeBox');
  const analyze = async (file) => {
    if (!file || !box()) return;
    if (!ownKey && !proxyOk) {
      box().innerHTML = `<p class="muted center">⚠️ ${T('Розпізнавання тимчасово недоступне — спробуй трохи пізніше')}</p>`;
      return;
    }
    if (!ownKey && !BILL.canAnalyzePhoto()) {
      toast(`📷 ${T('Ліміт на сьогодні вичерпано — далі потрібна підписка')}`);
      return;
    }
    const url = URL.createObjectURL(file);
    box().innerHTML = `<img class="food-prev" src="${url}" alt=""/><p class="muted center">🔎 ${T('Аналізую…')}</p>`;
    try {
      const r = await CAL.analyzeFoodPhoto(file, key, S.getSettings().lang);
      if (!ownKey) BILL.usePhoto(); // запит пішов через наш сервер — рахуємо
      if (!box()) return; // користувач уже пішов з екрана
      if (!r.isFood) {
        box().innerHTML = `<img class="food-prev" src="${url}" alt=""/>
          <p class="muted center">${T('Не схоже на їжу — спробуй інше фото')}</p>`;
        return;
      }
      // ШІ оцінює порцію в грамах — від неї рахуємо «на 100 г», щоб вагу можна було виправити
      const portion = Math.round(Number(r.portion) || 0);
      const per100 = portion
        ? { kcal: r.kcal * 100 / portion, prot: r.prot * 100 / portion, fat: r.fat * 100 / portion, carb: r.carb * 100 / portion }
        : null;
      box().innerHTML = `
        <img class="food-prev" src="${url}" alt=""/>
        ${kcalResultHTML(r.name, r, portion)}`;
      bindKcalResult(box(), per100, (v, g) => {
        S.addCalorieEntry(iso, { ...r, ...v, g });
        toast(T('Збережено'));
        renderCalories();
      });
    } catch (e) {
      if (box()) box().innerHTML = `<p class="muted center">⚠️ ${esc(T(CAL.errorMessage(e)))}</p>`;
    }
  };
  // ---------- штрихкод ----------
  const bcBox = () => screenEl.querySelector('#bcBox');
  const findProduct = async (raw) => {
    const code = BC.cleanCode(raw);
    if (!code) { toast(T('Штрихкод — від 8 до 14 цифр')); return; }
    if (!bcBox()) return;
    bcBox().innerHTML = `<p class="muted center">🔎 ${T('Шукаю продукт…')}</p>`;
    try {
      const p = await BC.lookupProduct(code, S.getSettings().lang);
      if (!bcBox()) return;
      if (!p) {
        bcBox().innerHTML = `<p class="muted center">${T('Продукту немає в базі — спробуй інший штрихкод або сфотографуй страву')}</p>`;
        return;
      }
      if (!p.hasData) {
        bcBox().innerHTML = `<p class="muted center"><b>${esc(p.name)}</b><br/>${T('У базі немає калорійності цього продукту')}</p>`;
        return;
      }
      const g = p.serving || 100;
      const title = p.brand && !p.name.includes(p.brand) ? `${p.name} · ${p.brand}` : p.name;
      bcBox().innerHTML = `
        ${kcalResultHTML(title, BC.forGrams(p.per100, g), g)}
        <p class="muted hint">${T('На 100 г')}: ${Math.round(p.per100.kcal)} ${T('ккал')} · ${T('Б')} ${Math.round(p.per100.prot)} · ${T('Ж')} ${Math.round(p.per100.fat)} · ${T('В')} ${Math.round(p.per100.carb)} ${T('г')}
          <br/><span class="bc-src">${T('Дані: Open Food Facts')}</span></p>`;
      bindKcalResult(bcBox(), p.per100, (v, grams) => {
        S.addCalorieEntry(iso, { name: title, ...v, g: grams });
        toast(T('Збережено'));
        renderCalories();
      });
    } catch (e) {
      if (bcBox()) bcBox().innerHTML = `<p class="muted center">⚠️ ${T('Не вдалося перевірити штрихкод — потрібен інтернет')}</p>`;
    }
  };
  const codeIn = screenEl.querySelector('#bcCode');
  screenEl.querySelector('#bcFind').onclick = () => findProduct(codeIn.value);
  codeIn.onkeydown = (e) => { if (e.key === 'Enter') findProduct(codeIn.value); };
  // фото штрихкоду — працює на будь-якому телефоні (ZXing), живий сканер — лише де є BarcodeDetector
  const bcFile = screenEl.querySelector('#bcFile');
  screenEl.querySelector('#bcPhoto').onclick = () => bcFile.click();
  bcFile.onchange = async () => {
    const f = bcFile.files[0];
    bcFile.value = ''; // щоб те саме фото можна було вибрати ще раз
    if (!f || !bcBox()) return;
    bcBox().innerHTML = `<p class="muted center">🔎 ${T('Розпізнаю штрихкод…')}</p>`;
    let code = '';
    try { code = await BC.decodeImage(f); } catch (e) { /* бібліотека не завантажилась — нижче підказка */ }
    if (!bcBox()) return;
    if (!code) {
      bcBox().innerHTML = `<p class="muted center">${T('Не вдалося прочитати штрихкод — сфотографуй ближче й рівно або введи цифри')}</p>`;
      return;
    }
    codeIn.value = code;
    findProduct(code);
  };
  const scanBtn = screenEl.querySelector('#bcScan');
  if (scanBtn) scanBtn.onclick = () => openBarcodeScanner((code) => { codeIn.value = code; findProduct(code); });
  // перемикач «Штрихкод · Чек» — без перемальовування екрана
  screenEl.querySelectorAll('[data-kp]').forEach((b) => (b.onclick = () => {
    kcalPane = b.dataset.kp;
    screenEl.querySelectorAll('[data-kp]').forEach((x) => x.classList.toggle('on', x === b));
    screenEl.querySelector('#paneBc').hidden = kcalPane !== 'bc';
    screenEl.querySelector('#paneRc').hidden = kcalPane !== 'rc';
  }));
  bindReceiptPane();

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
//  «ЧЕК → МЕНЮ» (js/receipt.js): фото чека → продукти → меню на 3/5/7 днів
// =====================================================================
let kcalPane = 'bc'; // відкрита вкладка картки на екрані калорій: bc — штрихкод, rc — чек
const MEAL_LABEL = { breakfast: 'Сніданок', lunch: 'Обід', dinner: 'Вечеря', snack: 'Перекус' };

function receiptPaneHTML() {
  const mp = S.getMealPlan();
  return `<div id="paneRc" ${kcalPane === 'rc' ? '' : 'hidden'}>
    <p class="muted hint">${T('Сфотографуй чек — складемо меню на кілька днів лише з того, що ти купив')}</p>
    <div class="btn-row">
      <button class="btn ghost" id="rcSnap">📷 ${T('Сфотографувати чек')}</button>
      <button class="btn ghost" id="rcGal">🖼 ${T('З галереї')}</button>
    </div>
    <input type="file" id="rcCam" accept="image/*" capture="environment" hidden/>
    <input type="file" id="rcFiles" accept="image/*" multiple hidden/>
    <div id="rcStatus"></div>
    <div class="rc-head">${T('Продукти')} <span class="muted" id="rcCount"></span></div>
    <div class="rc-list" id="rcList"></div>
    <div class="bc-manual">
      <input id="rcAdd" autocomplete="off" maxlength="160" placeholder="${T('Додати продукт, напр. «куряче філе 1 кг»')}"/>
      <button class="btn ghost" id="rcAddBtn">＋</button>
    </div>
    <div class="rc-opts">
      <span class="muted">${T('Меню на')}</span>
      ${[3, 5, 7].map((n) => `<button class="tchip ${mp.days === n ? 'on' : ''}" data-rd="${n}">${n} ${PL(n, 'день', 'дні', 'днів')}</button>`).join('')}
    </div>
    <label class="share-row">
      <input type="checkbox" id="rcExtra" ${mp.extra ? 'checked' : ''}/>
      <span>🛒 ${T('Можна докупити')}
        <small class="muted">${T('вимкнено — страви лише з того, що є (сіль, олія, спеції — вважаємо, що вдома є)')}</small></span>
    </label>
    <div class="btn-col">
      <button class="btn primary" id="rcPlan">🍽 ${T('Скласти меню')}</button>
      ${mp.plan ? `<button class="btn ghost" id="rcOpen">📋 ${T('Відкрити збережене меню')}</button>` : ''}
    </div>
    <p class="muted small" id="rcQuota"></p>
  </div>`;
}

function bindReceiptPane() {
  const root = screenEl.querySelector('#paneRc');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const status = (html) => { const el = screenEl.querySelector('#rcStatus'); if (el) el.innerHTML = html; };
  const lang = () => S.getSettings().lang;
  const update = (patch) => S.setMealPlan({ ...S.getMealPlan(), ...patch });

  const renderList = () => {
    const list = $('#rcList');
    if (!list) return;
    const pr = S.getMealPlan().products;
    $('#rcCount').textContent = pr.length ? `· ${pr.length}` : '';
    list.innerHTML = pr.length
      ? pr.map((x, i) => `<span class="rc-chip">${esc(x.name)}${x.qty ? ` <span class="muted">${esc(x.qty)}</span>` : ''}
          <button class="rc-del" data-i="${i}" aria-label="✕">✕</button></span>`).join('')
      : `<p class="muted small">${T('Поки порожньо — сфотографуй чек або впиши продукти')}</p>`;
    list.querySelectorAll('.rc-del').forEach((b) => (b.onclick = () => {
      const pr2 = S.getMealPlan().products.slice();
      pr2.splice(Number(b.dataset.i), 1);
      update({ products: pr2 });
      renderList();
    }));
  };
  const addProducts = (items) => {
    const cur = S.getMealPlan().products.slice();
    const seen = new Set(cur.map((x) => x.name.toLowerCase()));
    let n = 0;
    for (const it of items) {
      const name = String(it.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      cur.push({ name, qty: String(it.qty || '').trim() });
      n++;
    }
    update({ products: cur });
    renderList();
    return n;
  };
  renderList();

  // квота / режим
  RCP.serverAvailable().then((srv) => {
    const q = $('#rcQuota');
    if (!q) return;
    if (!srv) { q.textContent = T('Поки без ШІ: меню складається з наших рецептів під продукти, що є'); return; }
    const qt = BILL.receiptQuota();
    q.textContent = qt.limit === 0 && qt.left === Infinity ? T('Підписка — без обмежень')
      : qt.left === 0 && qt.limit === 0 ? T('Пробний тиждень закінчився — далі з підпискою')
        : `${T('Запитів до ШІ сьогодні')}: ${qt.left} ${T('з')} ${qt.limit} · ${T('пробний тиждень, далі — підписка')}`;
  });

  // ручне додавання: можна кілька через кому або з нового рядка
  const addIn = $('#rcAdd');
  const addManual = () => {
    const parts = addIn.value.split(/[;\n]+|,(?!\d)/).map((x) => x.trim()).filter(Boolean); // «2,5%» не ділимо
    if (!parts.length) return;
    addProducts(parts.map((name) => ({ name })));
    addIn.value = '';
  };
  $('#rcAddBtn').onclick = addManual;
  addIn.onkeydown = (e) => { if (e.key === 'Enter') addManual(); };

  root.querySelectorAll('[data-rd]').forEach((b) => (b.onclick = () => {
    update({ days: Number(b.dataset.rd) });
    root.querySelectorAll('[data-rd]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#rcExtra').onchange = (e) => update({ extra: e.target.checked });

  // фото чека → продукти (ШІ на сервері)
  const recognize = async (files) => {
    files = [...(files || [])].filter(Boolean);
    if (!files.length) return;
    if (!(await RCP.serverAvailable())) { status(`<p class="muted center">ℹ️ ${T(RCP.errorText(new Error('no-server')))}</p>`); return; }
    if (BILL.receiptQuota().left <= 0) { toast(`🧾 ${T('Ліміт на сьогодні вичерпано — далі потрібна підписка')}`); return; }
    status(`<p class="muted center">🔎 ${T('Розпізнаю чек…')}</p>`);
    try {
      const pr = await RCP.recognize(files, lang());
      BILL.useReceipt();
      const n = addProducts(pr);
      status(`<p class="muted center">✅ ${T('Додано продуктів')}: ${n}</p>`);
    } catch (e) {
      status(`<p class="muted center">⚠️ ${esc(T(RCP.errorText(e)))}</p>`);
    }
  };
  const cam = $('#rcCam'), gal = $('#rcFiles');
  $('#rcSnap').onclick = () => cam.click();
  $('#rcGal').onclick = () => gal.click();
  cam.onchange = () => { const f = [...cam.files]; cam.value = ''; recognize(f); };
  gal.onchange = () => { const f = [...gal.files]; gal.value = ''; recognize(f); };

  // скласти меню: ШІ (якщо сервер є й ліміт не вичерпано), інакше — з вбудованих рецептів
  $('#rcPlan').onclick = async () => {
    const mp = S.getMealPlan();
    if (!mp.products.length) { toast(T('Спершу додай продукти — сфотографуй чек або впиши вручну')); return; }
    const btn = $('#rcPlan');
    btn.disabled = true;
    status(`<p class="muted center">🍳 ${T('Складаю меню…')}</p>`);
    let plan = null;
    try {
      if ((await RCP.serverAvailable()) && BILL.receiptQuota().left > 0) {
        try {
          plan = await RCP.planAI({ products: mp.products, days: mp.days, extra: mp.extra, lang: lang() });
          BILL.useReceipt();
        } catch (e) {
          plan = null; // ШІ не відповів — складемо з наших рецептів
        }
      }
      if (!plan) {
        await RC.loadTexts(lang());
        plan = RCP.planLocal({ products: mp.products, days: mp.days, extra: mp.extra, recipes: RC.allRecipes(lang()) });
        plan.buy = plan.buy.map((b) => ({
          name: b.name,
          why: b.kind === 'need' ? `${T('для')}: ${b.dishes.join(', ')}` : `${T('ще рецептів із ним')}: ${b.n}`,
        }));
      }
    } catch (e) {
      btn.disabled = false;
      status(`<p class="muted center">⚠️ ${esc(T(RCP.errorText(e)))}</p>`);
      return;
    }
    update({ plan });
    go('#/mealplan');
  };
  const openBtn = $('#rcOpen');
  if (openBtn) openBtn.onclick = () => go('#/mealplan');
}

function renderMealPlan() {
  const mp = S.getMealPlan();
  const pl = mp.plan;
  if (!pl) { kcalPane = 'rc'; go('#/calories'); return; }
  const macro = (x) => `${x.kcal} ${T('ккал')} · ${T('Б')} ${x.p} · ${T('Ж')} ${x.f} · ${T('В')} ${x.c}`;
  const days = pl.days.map((d, i) => {
    const tot = d.meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.p, f: a.f + m.f, c: a.c + m.c }), { kcal: 0, p: 0, f: 0, c: 0 });
    return `<section class="card mp-day">
      <div class="mp-day-head"><b>📅 ${T('День')} ${i + 1}</b><span class="muted">${macro(tot)}</span></div>
      ${d.meals.map((m, j) => `<a class="mp-meal" href="#/meal/${i}/${j}">
        <span class="mp-type">${T(MEAL_LABEL[m.type])}</span>
        <span class="mp-name">${esc(m.name)}</span><span class="muted mp-kcal">${macro(m)}</span>
        <span class="mp-go">${T('Рецепт')} ›</span>
      </a>`).join('') || `<p class="muted">${T('На цей день страв не вистачило')}</p>`}
    </section>`;
  }).join('');
  const buy = pl.buy.length ? `<section class="card">
      <div class="card-label">🛒 ${T('Варто докупити')}</div>
      <p class="muted hint">${mp.extra ? T('Для страв у меню й для різноманіття') : T('Меню складене лише з того, що є. Ці продукти додадуть різноманіття')}</p>
      <ul class="mp-buy">${pl.buy.map((b) => `<li><b>${esc(b.name)}</b>${b.why ? ` <span class="muted">— ${esc(b.why)}</span>` : ''}</li>`).join('')}</ul>
    </section>` : '';
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backMp">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">🧾 ${T('Меню з чека')}</div>
        <div class="appbar-title">${T('Меню на')} ${pl.days.length} ${PL(pl.days.length, 'день', 'дні', 'днів')}</div></div>
    </header>
    <p class="muted hint mp-src">${pl.source === 'ai' ? `🤖 ${T('Склав ШІ з продуктів твого чека')}` : `📚 ${T('Зібрано з рецептів Gym Log під твої продукти')}`}</p>
    ${days}
    ${buy}
    <div class="btn-col">
      <button class="btn ghost" id="mpAgain">🔄 ${T('Змінити продукти й скласти заново')}</button>
      <button class="btn ghost" id="mpDel">🗑 ${T('Видалити меню')}</button>
    </div>`;
  screenEl.querySelector('#backMp').onclick = () => history.back();
  screenEl.querySelector('#mpAgain').onclick = () => { kcalPane = 'rc'; go('#/calories'); };
  screenEl.querySelector('#mpDel').onclick = () => {
    if (!confirm(T('Видалити меню? Список продуктів залишиться.'))) return;
    S.setMealPlan({ ...S.getMealPlan(), plan: null });
    kcalPane = 'rc';
    go('#/calories');
  };
}

// рецепт однієї страви з меню чека: склад, кроки, час; фото — якщо це вбудований рецепт
function renderMeal(di, mi) {
  const pl = S.getMealPlan().plan;
  const day = pl && pl.days[Number(di)];
  const m = day && day.meals[Number(mi)];
  if (!m) { go('#/mealplan'); return; }
  const base = m.rid ? RECIPES.find((r) => r.id === m.rid) : null;
  const plate = !m.rid && pl.source !== 'ai';
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backMeal">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">📅 ${T('День')} ${Number(di) + 1} · ${T(MEAL_LABEL[m.type])}</div>
        <div class="appbar-title">${T('Рецепт')}</div></div>
    </header>
    ${base ? `<div class="ml-photo" style="background:linear-gradient(135deg,${base.bg[0]},${base.bg[1]})"><span>${base.emoji}</span>
      <img src="img/recipes/${base.id}.webp" alt="" loading="lazy" onerror="this.remove()"/></div>` : ''}
    <section class="card">
      <h2 class="ml-name">${esc(m.name)}</h2>
      <div class="ml-macros">
        <div><b>${m.kcal}</b><span>${T('ккал')}</span></div>
        <div><b>${m.p}</b><span>${T('Б')}, ${T('г')}</span></div>
        <div><b>${m.f}</b><span>${T('Ж')}, ${T('г')}</span></div>
        <div><b>${m.c}</b><span>${T('В')}, ${T('г')}</span></div>
      </div>
      ${m.time ? `<p class="muted ml-time">⏱ ${T('Готування')}: ~${m.time} ${T('хв')}</p>` : ''}
      ${plate ? `<p class="muted hint">${T('Проста страва з твоїх продуктів: білок, гарнір і овочі. Готуй усе паралельно — кроки йдуть від найдовшого.')}</p>` : ''}
    </section>
    ${m.ing.length ? `<section class="card"><div class="card-label">🧺 ${T('Що потрібно')}</div>
      <ul class="ml-ing">${m.ing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
    ${m.steps.length ? `<section class="card"><div class="card-label">👨‍🍳 ${T('Як приготувати')}</div>
      <ol class="ml-steps">${m.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>` : ''}
    <div class="btn-col">
      <button class="btn" id="mlAdd">➕ ${T('Додати в калорії сьогодні')}</button>
      <button class="btn ghost" id="mlPlan">📋 ${T('До меню')}</button>
    </div>`;
  screenEl.querySelector('#backMeal').onclick = () => history.back();
  screenEl.querySelector('#mlPlan').onclick = () => go('#/mealplan');
  screenEl.querySelector('#mlAdd').onclick = () => {
    S.addCalorieEntry(S.todayISO(), { name: m.name, kcal: m.kcal, prot: m.p, fat: m.f, carb: m.c });
    toast(`✅ ${T('Додано в калорії')}`);
  };
}

// =====================================================================
//  ВІТАМІНИ Й ДОБАВКИ — особистий нагадувач (що, скільки, коли; курс; уколи)
//  Застосунок нічого не радить: дозування й курс — від лікаря, людина лише записує. Гормонів/стероїдів у підказках немає.
// =====================================================================
const SUPP_FORMS = { tab: ['💊', 'Таблетка'], cap: ['🟡', 'Капсула'], drop: ['💧', 'Краплі'], powder: ['🥄', 'Порошок'], inj: ['💉', 'Укол'], other: ['🧴', 'Інше'] };
const SUPP_UNITS = ['мг', 'мкг', 'МО', 'г', 'мл', 'шт', 'крап.', 'од.'];
const SUPP_FOOD = { '': 'Будь-коли', before: 'До їжі', with: 'Під час їжі', after: 'Після їжі' };
const SUPP_ROUTE = { im: 'У мʼяз', sc: 'Під шкіру' };
// лише назви для швидкого вводу — без доз (дозу людина пише сама зі слів лікаря)
const SUPP_NAMES = ['Вітамін D3', 'Вітамін C', 'Вітамін B12', 'Вітаміни групи B', 'Вітамін E', 'Фолієва кислота', 'Омега-3', 'Магній', 'Цинк',
  'Залізо', 'Кальцій', 'Калій', 'Йод', 'Мультивітаміни', 'Креатин', 'Колаген', 'Пробіотик'];
let suppDay = null; // день на екрані вітамінів (null = сьогодні)

const suppsToday = () => { const d = S.suppDosesOn(S.todayISO()); return d.length ? `${d.filter((x) => x.taken).length}/${d.length} ›` : '›'; };
const suppIcon = (it) => (SUPP_FORMS[it.form] || SUPP_FORMS.other)[0];
const suppDose = (it) => (it.dose ? `${esc(it.dose)} ${T(it.unit)}` : '');
function suppSchedText(it) {
  const sc = it.sched;
  let s = sc.type === 'every' ? (sc.n === 2 ? T('через день') : T('кожні {n} дн.', { n: sc.n }))
    : sc.type === 'week' ? sc.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => dateNames().dows[d]).join(', ')
      : T('щодня');
  s += ` · ${it.times.join(', ')}`;
  if (it.food) s += ` · ${T(SUPP_FOOD[it.food]).toLowerCase()}`;
  return s;
}
function suppCourseText(it, iso) {
  if (!it.len) return '';
  const d = S.suppCourseDay(it, iso);
  if (d) return T('день {d} з {n}', { d, n: it.len });
  return iso < it.start ? T('курс з {d}', { d: S.prettyDate(it.start) }) : T('курс завершено');
}

// рядок прийому з галочкою (екран вітамінів і картка «Сьогодні»)
function suppDoseRow(iso, x) {
  const extra = [suppDose(x.it), x.it.form === 'inj' && x.it.route ? T(SUPP_ROUTE[x.it.route]) : '', x.it.food ? T(SUPP_FOOD[x.it.food]) : '']
    .filter(Boolean).join(' · ');
  return `<button class="sp-dose ${x.taken ? 'on' : ''}" data-id="${x.it.id}" data-i="${x.i}" data-iso="${iso}">
      <span class="sp-time">${x.time}</span>
      <span class="sp-ico">${suppIcon(x.it)}</span>
      <span class="sp-txt"><b>${esc(x.it.name)}</b>${extra ? `<span class="muted">${extra}</span>` : ''}</span>
      <span class="sp-check">${x.taken ? '✓' : ''}</span>
    </button>`;
}
function bindSuppDoses(root, after) {
  root.querySelectorAll('.sp-dose').forEach((b) => (b.onclick = () => {
    const on = S.toggleSuppDose(b.dataset.iso, b.dataset.id, Number(b.dataset.i));
    if (on && navigator.vibrate) navigator.vibrate(15);
    after();
  }));
}

// картка на «Сьогодні»: лише якщо на цей день є прийоми
function suppsCard(iso) {
  const doses = S.suppDosesOn(iso);
  if (!doses.length) return '';
  const done = doses.filter((x) => x.taken).length;
  return `<section class="card sp-card" id="suppCard">
    <div class="sp-card-head"><div class="card-label">💊 ${T('Вітаміни й добавки')} <span class="muted">${done}/${doses.length}</span></div>
      <a class="sp-all" href="#/supps">${T('Усі')} ›</a></div>
    ${doses.map((x) => suppDoseRow(iso, x)).join('')}
  </section>`;
}
function bindSuppsCard(iso) {
  const card = screenEl.querySelector('#suppCard');
  if (!card) return;
  bindSuppDoses(card, () => {
    const html = suppsCard(iso);
    const cur = screenEl.querySelector('#suppCard');
    if (!cur) return;
    cur.outerHTML = html;
    bindSuppsCard(iso);
  });
}

function renderSupps() {
  const today = S.todayISO();
  const iso = suppDay || today;
  const doses = S.suppDosesOn(iso);
  const items = S.getSupps();
  const done = doses.filter((x) => x.taken).length;
  screenEl.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="backSp">‹</button>
      <div class="appbar-titles"><div class="appbar-kicker">💊 ${T('Здоровʼя')}</div>
        <div class="appbar-title">${T('Вітаміни й добавки')}</div></div>
    </header>
    <section class="card sp-warn">
      <b>⚠️ ${T('Не медична порада')}</b>
      <p>${T('Gym Log не лікар і не підказує, що, скільки й як приймати. Це лише твій нагадувач: дозування, курс і уколи — тільки за призначенням лікаря.')}</p>
    </section>
    ${items.length ? `<section class="card">
      <div class="day-nav sp-nav">
        <button class="chip" id="spPrev">‹</button>
        <div class="sp-day"><b>${iso === today ? T('Сьогодні') : S.prettyDate(iso)}</b>
          <span class="muted">${doses.length ? `${T('прийнято')} ${done}/${doses.length}` : T('прийомів немає')}</span></div>
        <button class="chip" id="spNext">›</button>
      </div>
      ${doses.length ? `<div class="sp-bar"><i style="width:${Math.round((done / doses.length) * 100)}%"></i></div>` : ''}
      <div id="spDoses">${doses.map((x) => suppDoseRow(iso, x)).join('')}</div>
    </section>` : ''}
    <div class="card-label side-label">${T('Мій список')}</div>
    <div class="pick-list">
      ${items.map((it) => {
        const c = suppCourseText(it, today);
        return `<button class="pick-row aih-row sp-item" data-id="${it.id}">
          <span class="pick-ico">${suppIcon(it)}</span>
          <span class="aih-txt"><b>${esc(it.name)}${it.dose ? ` · ${suppDose(it)}` : ''}</b>
            <span class="muted">${esc(suppSchedText(it))}${c ? ` · ${c}` : ''}</span></span>
          <span class="fc-pat">›</span>
        </button>`;
      }).join('') || `<p class="muted center">${T('Тут поки порожньо. Додай вітамін, добавку чи укол — і відмічай прийоми щодня.')}</p>`}
    </div>
    <div class="btn-col"><button class="btn primary" id="spAdd">＋ ${T('Додати')}</button></div>`;
  screenEl.querySelector('#backSp').onclick = () => history.back();
  screenEl.querySelector('#spAdd').onclick = () => go('#/supp/new');
  screenEl.querySelectorAll('.sp-item').forEach((b) => (b.onclick = () => go('#/supp/' + b.dataset.id)));
  const shift = (k) => {
    const d = S.isoToDate(iso);
    d.setDate(d.getDate() + k);
    suppDay = S.dateToISO(d);
    renderSupps();
  };
  const p = screenEl.querySelector('#spPrev');
  if (p) {
    p.onclick = () => shift(-1);
    screenEl.querySelector('#spNext').onclick = () => shift(1);
    bindSuppDoses(screenEl.querySelector('#spDoses'), renderSupps);
  }
}

function renderSuppEdit(id) {
  const old = id === 'new' ? null : S.getSupp(id);
  if (id !== 'new' && !old) { go('#/supps'); return; }
  const it = old ? JSON.parse(JSON.stringify(old)) : { name: '', form: 'tab', dose: '', unit: 'мг', times: ['09:00'], food: '', sched: { type: 'daily', n: 2, days: [1, 3, 5] }, start: S.todayISO(), len: 0, route: '', note: '' };
  if (!it.sched.days.length) it.sched.days = [1, 3, 5];
  const dn = dateNames().dows;
  const draw = () => {
    const tchips = (attr, map, cur) => Object.entries(map).map(([k, v]) => `<button class="tchip ${cur === k ? 'on' : ''}" data-${attr}="${k}">${Array.isArray(v) ? `${v[0]} ${T(v[1])}` : T(v)}</button>`).join('');
    screenEl.innerHTML = `
      <header class="appbar">
        <button class="icon-btn" id="backSe">‹</button>
        <div class="appbar-titles"><div class="appbar-kicker">💊 ${T('Вітаміни й добавки')}</div>
          <div class="appbar-title">${old ? T('Редагувати') : T('Новий запис')}</div></div>
      </header>
      <section class="card sp-form">
        <div class="field"><label>${T('Що це')}</label><div class="type-chips">${tchips('form', SUPP_FORMS, it.form)}</div></div>
        <div class="field"><label>${T('Назва')}</label>
          <input id="seName" maxlength="80" list="seNames" value="${esc(it.name)}" placeholder="${T('напр. Вітамін D3')}"/>
          <datalist id="seNames">${SUPP_NAMES.map((n) => `<option value="${esc(T(n))}"></option>`).join('')}</datalist></div>
        <div class="field-row">
          <div class="field"><label>${T('Доза за раз')}</label><input id="seDose" inputmode="decimal" maxlength="12" value="${esc(it.dose)}" placeholder="${T('як призначив лікар')}"/></div>
          <div class="field sp-unit"><label>${T('Одиниці')}</label><select id="seUnit">${SUPP_UNITS.map((u) => `<option value="${u}" ${it.unit === u ? 'selected' : ''}>${T(u)}</option>`).join('')}</select></div>
        </div>
        ${it.form === 'inj' ? `<div class="field"><label>${T('Як колоти')}</label><div class="type-chips">${tchips('route', { '': 'Не вказано', ...SUPP_ROUTE }, it.route)}</div></div>` : ''}
        <div class="field"><label>${T('Коли за день')}</label>
          <div class="sp-times">${it.times.map((t, i) => `<span class="sp-tm"><input type="time" data-ti="${i}" value="${t}"/>${it.times.length > 1 ? `<button class="rc-del" data-tdel="${i}">✕</button>` : ''}</span>`).join('')}
            ${it.times.length < 6 ? `<button class="tchip" id="seTimeAdd">＋ ${T('ще прийом')}</button>` : ''}</div></div>
        <div class="field"><label>${T('Їжа')}</label><div class="type-chips">${tchips('food', SUPP_FOOD, it.food)}</div></div>
        <div class="field"><label>${T('Як часто')}</label><div class="type-chips">${tchips('sched', { daily: 'Щодня', every: 'Раз на кілька днів', week: 'Дні тижня' }, it.sched.type)}</div>
          ${it.sched.type === 'every' ? `<div class="sp-inline">${T('кожні')} <input id="seN" type="number" inputmode="numeric" min="2" max="60" value="${it.sched.n}"/> ${T('дн.')}</div>` : ''}
          ${it.sched.type === 'week' ? `<div class="type-chips">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="tchip ${it.sched.days.includes(d) ? 'on' : ''}" data-wd="${d}">${dn[d]}</button>`).join('')}</div>` : ''}</div>
        <div class="field-row">
          <div class="field"><label>${T('Початок курсу')}</label><input id="seStart" type="date" value="${it.start}"/></div>
          <div class="field"><label>${T('Тривалість, днів')}</label><input id="seLen" type="number" inputmode="numeric" min="0" max="3650" value="${it.len || ''}" placeholder="${T('без кінця')}"/></div>
        </div>
        <div class="field"><label>${T('Нотатка')}</label><textarea id="seNote" maxlength="300" rows="2" placeholder="${T('напр. хто призначив і що сказав лікар')}">${esc(it.note)}</textarea></div>
      </section>
      <p class="muted side small">⚠️ ${T('Записуй лише те, що призначив лікар. Gym Log не перевіряє дози й сумісність препаратів.')}</p>
      <div class="btn-col">
        <button class="btn primary" id="seSave">💾 ${T('Зберегти')}</button>
        ${old ? `<button class="btn ghost" id="seDel">🗑 ${T('Видалити')}</button>` : ''}
      </div>`;
    const $ = (s) => screenEl.querySelector(s);
    // поля вводу — у чернетку перед кожним перемальовуванням (щоб чипи не стирали введене)
    const pull = () => {
      it.name = $('#seName').value.trim();
      it.dose = $('#seDose').value.trim();
      it.unit = $('#seUnit').value;
      it.times = [...screenEl.querySelectorAll('[data-ti]')].map((x) => x.value || '09:00');
      it.start = $('#seStart').value || S.todayISO();
      it.len = Number($('#seLen').value) || 0;
      it.note = $('#seNote').value.trim();
      if ($('#seN')) it.sched.n = Number($('#seN').value) || 2;
    };
    // спершу забрати введене, потім змінити й перемалювати
    const on = (sel, fn) => screenEl.querySelectorAll(sel).forEach((b) => (b.onclick = () => { pull(); fn(b.dataset); draw(); }));
    $('#backSe').onclick = () => history.back();
    on('[data-form]', (d) => { if (d.form === 'inj' && it.form !== 'inj' && it.unit === 'мг') it.unit = 'мл'; it.form = d.form; });
    on('[data-route]', (d) => { it.route = d.route; });
    on('[data-food]', (d) => { it.food = d.food; });
    on('[data-sched]', (d) => { it.sched.type = d.sched; });
    on('[data-wd]', (d) => {
      const w = Number(d.wd);
      const a = it.sched.days;
      if (a.includes(w)) { if (a.length > 1) a.splice(a.indexOf(w), 1); } else a.push(w);
    });
    on('[data-tdel]', (d) => { it.times.splice(Number(d.tdel), 1); });
    const add = $('#seTimeAdd');
    if (add) add.onclick = () => {
      pull();
      const last = it.times[it.times.length - 1] || '09:00';
      const h = Math.min(23, Number(last.slice(0, 2)) + 4);
      it.times.push(`${String(h).padStart(2, '0')}:${last.slice(3)}`);
      draw();
    };
    $('#seSave').onclick = () => {
      pull();
      if (!it.name) { toast(T('Впиши назву')); $('#seName').focus(); return; }
      S.saveSupp(it);
      toast(`✅ ${T('Збережено')}`);
      go('#/supps');
    };
    const del = $('#seDel');
    if (del) del.onclick = () => {
      if (!confirm(T('Видалити «{x}» разом з відмітками прийому?', { x: it.name }))) return;
      S.deleteSupp(old.id);
      go('#/supps');
    };
  };
  draw();
}

// результат «страва / продукт»: назва, калорії, БЖВ і поле ваги (якщо відомо, від чого рахувати)
function kcalResultHTML(name, v, g) {
  return `<div class="kcal-res">
      <div class="kcal-name">${esc(name)}</div>
      <div class="kcal-big"><span class="kr-kcal">${v.kcal}</span> ${T('ккал')}</div>
      <div class="muted">${T('Б')} <span class="kr-p">${v.prot}</span> ${T('г')} · ${T('Ж')} <span class="kr-f">${v.fat}</span> ${T('г')} · ${T('В')} <span class="kr-c">${v.carb}</span> ${T('г')}</div>
    </div>
    ${g ? `<label class="kcal-g"><span>${T('Вага, г')}</span>
      <input class="kr-g" type="number" inputmode="numeric" min="1" max="5000" value="${g}"/></label>` : ''}
    <div class="btn-col" style="margin-top:10px">
      <button class="btn primary kr-add">➕ ${T('Додати в день')}</button>
    </div>`;
}
// per100 = null → вагу не змінити (ШІ не оцінив порцію), додаємо як є
function bindKcalResult(root, per100, onAdd) {
  const gIn = root.querySelector('.kr-g');
  const cur = () => {
    const g = gIn ? Math.max(0, Math.round(Number(gIn.value) || 0)) : 0;
    if (!per100 || !g) return { g, v: null };
    return { g, v: BC.forGrams(per100, g) };
  };
  if (gIn && per100) {
    gIn.oninput = () => {
      const { v } = cur();
      if (!v) return;
      root.querySelector('.kr-kcal').textContent = v.kcal;
      root.querySelector('.kr-p').textContent = v.prot;
      root.querySelector('.kr-f').textContent = v.fat;
      root.querySelector('.kr-c').textContent = v.carb;
    };
  }
  root.querySelector('.kr-add').onclick = () => {
    const { g, v } = cur();
    if (gIn && !g) { toast(T('Вкажи вагу в грамах')); return; }
    onAdd(v || {}, g);
  };
}

// повноекранний сканер штрихкоду (камера + рамка); onCode(code) — коли знайшли
function openBarcodeScanner(onCode) {
  const ov = document.createElement('div');
  ov.className = 'bc-overlay';
  ov.innerHTML = `<video playsinline muted></video><div class="bc-frame"></div>
    <p class="bc-tip">${T('Наведи камеру на штрихкод на упаковці')}</p>
    <button class="btn ghost bc-close">${T('Закрити')}</button>`;
  document.body.appendChild(ov);
  const sc = BC.startScan(ov.querySelector('video'));
  const close = () => { sc.stop(); ov.remove(); window.removeEventListener('hashchange', close); };
  window.addEventListener('hashchange', close);
  ov.querySelector('.bc-close').onclick = close;
  sc.done.then((code) => {
    if (navigator.vibrate) navigator.vibrate(60);
    close();
    onCode(code);
  }).catch((e) => {
    if (!document.body.contains(ov)) return; // закрили самі
    close();
    if (String(e && e.message) !== 'cancelled') toast(T('Камера недоступна — введи цифри штрихкоду вручну'));
  });
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
applyTheme(S.getSettings().theme); // тема з налаштувань — до першого малювання
trialReminder(); // за 2 дні до кінця пробного — одне ненав'язливе нагадування
renderTabbar();
// «Поділитися» з TikTok / YouTube / браузера → імпорт рецепта (share_target у маніфесті)
let pendingShare = '';
{
  const sp = new URLSearchParams(location.search);
  if (sp.has('url') || sp.has('text')) {
    pendingShare = RI.findUrl(sp.get('url')) || RI.findUrl(sp.get('text')) || RI.findUrl(sp.get('title'));
    history.replaceState(null, '', location.pathname + '#/recipe-new');
  }
}
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

// Android тримає застосунок згорнутим у пам'яті — при поверненні він показував би стару версію.
// Коли екран знову видно: звіряємо js/version.js із сайтом і, якщо вийшла новіша, перезавантажуємось
// (не під час підходу й камери — щоб не збити таймер).
let verCheckAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  if (Date.now() - verCheckAt < 60000) return;
  verCheckAt = Date.now();
  try {
    const txt = await fetch('./js/version.js', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''));
    const m = txt.match(/APP_VERSION\s*=\s*'([^']+)'/);
    const busy = location.hash.startsWith('#/set/') || location.hash.startsWith('#/camera/');
    if (m && m[1] !== APP_VERSION && !busy) location.reload();
  } catch (e) { /* немає мережі — спробуємо наступного разу */ }
});
