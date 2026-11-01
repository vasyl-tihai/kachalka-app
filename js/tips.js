// js/tips.js — короткі підказки на головних екранах (31.10, прохання власника: «інструкція окремо під кожне віконце»).
// Замінюють загальну інструкцію першого запуску. На екрані — 1–3 кроки: підсвічений елемент + бульбашка
// («Далі» / «Зрозуміло», маленьке «Пропустити»). Показуються РАЗ на екран: localStorage `kachalka-tips` = JSON-масив id екранів.
// Підключення з app.js: router() після рендеру кличе scheduleTips(); Налаштування → «Показати підказки ще раз» = resetTips().
// Не показуємо: поверх вікна/шторки, одночасно з банером «Калорії готові», коли `kachalka-tips-off` = '1'
// (так сідери знімків і QA вимикають оверлеї; старий `kachalka-tour` людей, що пройшли колишню інструкцію, НЕ гасить —
// тестувальникам підказки теж потрібні), і коли людина вже пішла з екрана.
import { t as T } from './i18n.js';

const KEY = 'kachalka-tips';
const TOUR_KEY = 'kachalka-tips-off';
const sessionSeen = new Set(); // запасний варіант, якщо localStorage недоступний (приватний режим): хоч раз за сесію
let ignoreTour = false; // «Показати підказки ще раз» — явне прохання, прапорець сідерів його не гасить
let timer = 0;
let active = null;

function readSeen() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function markSeen(id) {
  sessionSeen.add(id);
  try {
    const a = readSeen();
    if (!a.includes(id)) { a.push(id); localStorage.setItem(KEY, JSON.stringify(a)); }
  } catch (e) { /* немає сховища — покажеться ще раз у новій сесії */ }
}
function isSeen(id) { return sessionSeen.has(id) || readSeen().includes(id); }
function tourOff() {
  if (ignoreTour) return false;
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch (e) { return false; }
}

// хеш → id екрана, для якого є підказка
function screenOf(h) {
  h = h || '#/today';
  if (h === '#/' || h === '#/today') return 'today';
  if (h === '#/calendar') return 'calendar';
  if (h === '#/workouts') return 'workouts';
  if (h === '#/ai') return 'ai';
  if (h === '#/progress') return 'progress';
  if (h === '#/body') return 'body';
  if (h === '#/community' || h === '#/recipes') return 'community';
  if (h === '#/calories') return 'calories';
  if (/^#\/supps(\/day)?$/.test(h)) return 'supps';
  return '';
}

const vis = (el) => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4;
};
// перша картка рецепта, чия бокова панель зараз на екрані (стрічка гортається картками)
const visibleRail = () => [...document.querySelectorAll('#screen .rc-rail')].find((el) => {
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.top >= 0 && r.bottom <= window.innerHeight;
});

// Кроки екрана. Крок — перелік варіантів [селектор | функція, текст]; береться перший, елемент якого є й видимий
// (немає жодного — крок пропускається). Тексти — T('…') у момент виклику, тож мова береться актуальна.
function defs(id) {
  switch (id) {
    case 'today': return [
      [['.list .ex-card', T('Тапни вправу, обери повтори й вагу й тисни «✓ Виконав підхід» — таймер відпочинку запуститься сам.')],
        ['[data-act="wsel"]', T('Почни тут: обери тренування дня — його вправи зʼявляться списком.')]],
      [['#addDayW', T('Тренуєшся двічі на день? Додай ще одне тренування — воно зʼявиться в цьому ж дні.')]],
    ];
    case 'calendar': return [
      [['.cal-grid:not(.head)', T('Календар показує, коли ти тренувався. Тапни день, щоб переглянути або записати тренування.')]],
      [['.plan-list', T('Тижневий план: тапни день тижня й признач тренування — «Тренування дня» підставиться саме.')]],
    ];
    case 'workouts': return [
      [['.ex-card[data-g]', T('Готові програми для залу й дому. Відкрий, подивись вправи й додай — тренування зʼявляться в «Календарі».')]],
      [['.tpl-grid', T('Шаблони — швидкий старт: один тап, і тренування вже в твоєму списку.')]],
    ];
    case 'ai': return [
      [['#aiKcal', T('Сфотографуй страву або штрихкод — Gym Log порахує калорії й БЖВ.')]],
      [['#aiSmart', T('Розумний тренер підкаже, які мʼязи вже відновились і скільки відпочивати.')]],
    ];
    case 'progress': return [
      [['.ov-grid', T('Тут тоннаж, серії, рекорди й графіки. Вони оживуть, коли назбираються тренування.')]],
      [['#bodyBtn', T('Заміри тіла: вага й обхвати з 3D-фігурою та порівнянням «було / стало».')]],
    ];
    case 'body': return [
      [['#b3dStage', T('Тапни частину тіла на фігурі й впиши замір. Тягни пальцем, щоб повернути.')],
        ['.b3d-chip', T('Тапни замір і впиши число — фігура підлаштується.')]],
      [['#cmpBtn', T('«Було / стало» покаже, як змінилось тіло від першого заміру.')]],
    ];
    case 'community': return [
      [['.rf-tabs', T('Два розділи: Рецепти й Спільнота — дописи, друзі та тренери. Для спільноти потрібен вхід.')]],
      [[visibleRail, T('♡ зберігає рецепт, 📖 відкриває його, ＋ додає страву в калорії.')],
        ['#cAdd', T('＋ — новий допис у Спільноті.')]],
    ];
    case 'calories': return [
      [['#snapBtn', T('Сфотографуй страву. Розпізнавання йде у фоні — можна йти на інші екрани, калорії зʼявляться в списку.')]],
      [['.kc-tools', T('Фото не підходить? Штрихкод, чек для меню на кілька днів або ручний запис.')]],
      [['.kc-hist', T('Тут усе, що зʼїдено за день. Тапни запис, щоб виправити вагу чи склад.')]],
    ];
    case 'supps': return [
      [['#spAdd', T('Додай вітамін чи БАД: назва, час і доза — і відмічай прийоми одним дотиком.')]],
      [['#spRemind', T('⏰ Нагадування: сповіщення від Gym Log прийдуть у потрібний час.')]],
    ];
    default: return [];
  }
}

function findEl(sel) {
  return typeof sel === 'function' ? sel() : document.querySelector('#screen ' + sel);
}
function resolve(id) {
  const out = [];
  for (const cands of defs(id)) {
    for (const [sel, text] of cands) {
      const el = findEl(sel);
      if (vis(el)) { out.push({ sel, text, el }); break; }
    }
  }
  return out;
}

function blocked() {
  return !!document.querySelector('.modal-overlay, .rsheet-ov, .bc-overlay, #kcBanner.show');
}

// ---------- показ ----------
function open(id, steps) {
  const ov = document.createElement('div');
  ov.className = 'gtip-ov';
  ov.innerHTML = `<div class="gtip-hl"></div>
    <div class="gtip-bub" role="dialog" aria-live="polite">
      <i class="gtip-arrow"></i>
      <p class="gtip-txt"></p>
      <div class="gtip-foot">
        <span class="gtip-cnt"></span>
        <button type="button" class="gtip-skip">${T('Пропустити')}</button>
        <button type="button" class="btn primary gtip-next"></button>
      </div>
    </div>`;
  const hl = ov.querySelector('.gtip-hl');
  const bub = ov.querySelector('.gtip-bub');
  const arrow = ov.querySelector('.gtip-arrow');
  const a = { id, steps, i: 0, ov, iv: 0 };

  const tabbarTop = () => {
    const tb = document.getElementById('tabbar');
    const vh = window.innerHeight;
    if (!tb || getComputedStyle(tb).display === 'none') return vh;
    return Math.min(vh, tb.getBoundingClientRect().top);
  };

  // бульбашка біля елемента: під ним, а як немає місця — над ним; не виходить за краї й не лізе під таб-бар
  const place = () => {
    const st = a.steps[a.i];
    if (!st || !vis(st.el)) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = st.el.getBoundingClientRect();
    const m = 6;
    const top = Math.max(r.top - m, 0);
    const bot = Math.min(r.bottom + m, vh);
    const left = Math.max(r.left - m, 0);
    const right = Math.min(r.right + m, vw);
    hl.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bot - top}px`;

    const w = Math.min(320, vw - 24);
    bub.style.width = w + 'px';
    const bh = bub.offsetHeight;
    const cx = (left + right) / 2;
    const bl = Math.max(12, Math.min(cx - w / 2, vw - w - 12));
    const lim = tabbarTop();
    const gap = 12;
    let bt;
    let dir = '';
    if (lim - bot - gap >= bh) { bt = bot + gap; dir = 'up'; } // бульбашка під елементом, стрілка вгору
    else if (top - 8 - gap >= bh) { bt = top - gap - bh; dir = 'down'; } // над елементом
    else bt = Math.max(8, lim - bh - 8); // елемент великий — бульбашка поверх його нижньої частини
    bub.style.left = bl + 'px';
    bub.style.top = bt + 'px';
    bub.dataset.dir = dir;
    arrow.style.left = Math.max(16, Math.min(cx - bl - 6, w - 28)) + 'px';
  };

  const show = (i) => {
    a.i = i;
    const st = a.steps[i];
    // елемент міг бути перемальований — знайти заново
    if (!vis(st.el)) { const el = findEl(st.sel); if (vis(el)) st.el = el; }
    if (!vis(st.el)) { next(); return; }
    // прокрутити до елемента, якщо він поза екраном (у стрічці-на-весь-екран не чіпаємо)
    if (!st.el.closest('.rfeed-wrap')) {
      const r = st.el.getBoundingClientRect();
      if (r.top < 8 || r.bottom > tabbarTop() - 8) {
        const block = r.height > window.innerHeight * 0.45 ? 'start' : 'center';
        try { st.el.scrollIntoView({ block, behavior: 'instant' }); } catch (e) { st.el.scrollIntoView(block === 'start'); }
      }
    }
    ov.querySelector('.gtip-txt').textContent = st.text;
    const last = i === a.steps.length - 1;
    ov.querySelector('.gtip-next').textContent = last ? T('Зрозуміло') : `${T('Далі')} ›`;
    ov.querySelector('.gtip-skip').hidden = last;
    ov.querySelector('.gtip-cnt').textContent = a.steps.length > 1 ? `${i + 1}/${a.steps.length}` : '';
    place();
  };
  const next = () => { if (a.i + 1 >= a.steps.length) close(true); else show(a.i + 1); };

  ov.addEventListener('click', (e) => { if (!e.target.closest('.gtip-bub')) close(true); }); // тап поза бульбашкою = «зрозуміло»
  ov.querySelector('.gtip-next').onclick = next;
  ov.querySelector('.gtip-skip').onclick = () => close(true);
  ov.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  ov.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  a.onKey = (e) => { if (e.key === 'Escape') close(true); };
  a.onResize = () => place();
  a.onHash = () => close(false); // пішла з екрана — не вважаємо показаною
  document.addEventListener('keydown', a.onKey);
  window.addEventListener('resize', a.onResize);
  window.addEventListener('hashchange', a.onHash);

  active = a;
  document.body.appendChild(ov);
  show(0);
  if (!active) return;
  // екран міг перемалюватись (обробники, що викликають render*) або зʼявилось вікно/банер
  a.iv = setInterval(() => {
    if (blocked()) { close(false); return; }
    const st = a.steps[a.i];
    if (!st) return;
    if (!vis(st.el)) {
      const el = findEl(st.sel);
      if (!vis(el)) { close(false); return; }
      st.el = el;
    }
    place();
  }, 350);
  const nb = ov.querySelector('.gtip-next');
  try { nb.focus({ preventScroll: true }); } catch (e) { /* не критично */ }
}

function close(mark) {
  const a = active;
  if (!a) return;
  active = null;
  clearInterval(a.iv);
  document.removeEventListener('keydown', a.onKey);
  window.removeEventListener('resize', a.onResize);
  window.removeEventListener('hashchange', a.onHash);
  a.ov.remove();
  if (mark) markSeen(a.id);
}

function tryShow(id, attempt) {
  if (document.hidden || screenOf(location.hash) !== id || active) return;
  if (isSeen(id) || tourOff()) return;
  const steps = blocked() ? [] : resolve(id);
  if (steps.length) { open(id, steps); return; }
  // вікно/банер ще відкриті або екран домальовується (спільнота, калорії) — спробувати ще
  if (attempt < 3) timer = setTimeout(() => tryShow(id, attempt + 1), 700);
}

// Викликається з router() після рендеру. Затримка ~600 мс: екран має домалюватись і не вискочити поверх швидкої навігації.
export function scheduleTips() {
  clearTimeout(timer);
  const id = screenOf(location.hash);
  if (!id || active || isSeen(id) || tourOff()) return;
  timer = setTimeout(() => tryShow(id, 0), 600);
}

// Налаштування → «Показати підказки ще раз»
export function resetTips() {
  close(false);
  clearTimeout(timer);
  sessionSeen.clear();
  ignoreTour = true;
  try { localStorage.removeItem(KEY); } catch (e) { /* немає сховища — sessionSeen уже очищено */ }
}
