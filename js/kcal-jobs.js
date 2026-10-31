// kcal-jobs.js — розпізнавання страви за фото у фоні (31.10, відгук тестувальників: «фото губиться, коли
// перемикаєш вкладку»). Запит живе на рівні модуля, а не екрана: людина фоткає, іде геть — результат сам
// зʼявляється записом у журналі калорій дня, а зверху виринає банер «Калорії готові».
//
// Зберігання:
//   • мініатюра ~320 px — IndexedDB `kachalka-kcal` / `thumbs` (ключ = id запису; у localStorage фото не влізуть);
//   • список робіт (pending / error) — localStorage `kachalka-kcal-jobs`;
//   • готовий запис — звичайний запис калорій у store.js з тим самим id (S.addCalorieEntry).
// Подія `kcal-jobs` (window) — на кожну зміну списку; `kcal-done` — коли робота завершилась (detail: {ok, id, iso, name, kcal, err}).
import * as S from './store.js';
import * as CAL from './calories.js';
import * as BILL from './billing.js';
import { t as T } from './i18n.js';

const JOBS_KEY = 'kachalka-kcal-jobs';
const NOTIF_KEY = 'kachalka-kcal-notif'; // дозвіл на сповіщення просимо лише раз
const DB_NAME = 'kachalka-kcal';
const STORE = 'thumbs';
const THUMB_SIDE = 320;

export const MSG_NOT_FOOD = 'Не схоже на їжу — спробуй інше фото';
export const MSG_INTERRUPTED = 'Обробку перервано — сфотографуй ще раз';

// ---------- IndexedDB: мініатюри ----------
let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-idb')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const os = db.transaction(STORE, mode).objectStore(STORE);
    const r = fn(os);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const urls = new Map(); // id → blob: адреса (щоб не плодити однакові)

/** Мініатюра запису → адреса для <img> або null. */
export async function thumbURL(id) {
  if (urls.has(id)) return urls.get(id);
  try {
    const blob = await idb('readonly', (os) => os.get(id));
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.set(id, u);
    return u;
  } catch (e) {
    return null;
  }
}
/** Стерти мініатюру (запис або роботу видалили). */
export async function delThumb(id) {
  const u = urls.get(id);
  if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* уже звільнено */ } urls.delete(id); }
  try { await idb('readwrite', (os) => os.delete(id)); } catch (e) { /* немає сховища — нема що стирати */ }
}
async function putThumb(id, blob) {
  try { await idb('readwrite', (os) => os.put(blob, id)); return true; } catch (e) { return false; }
}

// фото → JPEG-мініатюра (довга сторона 320 px)
async function makeThumb(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, THUMB_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((resolve, reject) =>
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('thumb'))), 'image/jpeg', 0.72));
}

// ---------- список робіт ----------
let jobs = [];
function persist() {
  try {
    if (jobs.length) localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
    else localStorage.removeItem(JOBS_KEY);
  } catch (e) { /* приватний режим — лишається в памʼяті */ }
}
function emit() {
  persist();
  try { window.dispatchEvent(new CustomEvent('kcal-jobs')); } catch (e) { /* без вікна (тест) */ }
}
// старт модуля: усе, що лишилось «в обробці» від минулого запуску, вже не дочекається відповіді
(function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]');
    jobs = (Array.isArray(raw) ? raw : [])
      .filter((j) => j && /^[\w-]{1,64}$/.test(String(j.id)) && /^\d{4}-\d{2}-\d{2}$/.test(String(j.iso)))
      .map((j) => ({
        id: String(j.id),
        iso: String(j.iso),
        status: 'error', // pending з минулого запуску теж стає помилкою (нижче — текст)
        at: Number(j.at) || Date.now(),
        err: j.status === 'error' && j.err ? String(j.err).slice(0, 200) : MSG_INTERRUPTED,
      }));
    persist();
  } catch (e) { jobs = []; }
})();

/** Роботи дня (pending і error), нові — першими. */
export function jobsFor(iso) {
  return jobs.filter((j) => j.iso === iso).slice().sort((a, b) => b.at - a.at);
}
export function pendingCount() {
  return jobs.filter((j) => j.status === 'pending').length;
}
/** Прибрати роботу з помилкою (✕ у списку) разом з мініатюрою. */
export function dismissJob(id) {
  const i = jobs.findIndex((j) => j.id === id);
  if (i < 0) return;
  jobs.splice(i, 1);
  delThumb(id);
  emit();
}

// ---------- підгонка складників (памʼять виправлень ваги живе в app.js) ----------
let adjust = null;
/** fn(r) → складники (можливо з виправленою вагою) для результату CAL.analyzeFoodPhoto. */
export function setItemsAdjuster(fn) { adjust = typeof fn === 'function' ? fn : null; }

// ---------- сповіщення ----------
function askNotifyOnce() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    if (localStorage.getItem(NOTIF_KEY)) return;
    localStorage.setItem(NOTIF_KEY, '1');
    const p = Notification.requestPermission();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* без сповіщень застосунок працює як працював */ }
}
function osNotify(title, body, id) {
  try {
    if (!document.hidden) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then((r) =>
      r.showNotification(title, { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: 'kcal-' + id, data: { hash: '#/calories' } })
    ).catch(() => {});
  } catch (e) { /* не вийшло — банер у застосунку все одно буде */ }
}
function done(detail) {
  try { window.dispatchEvent(new CustomEvent('kcal-done', { detail })); } catch (e) { /* без вікна */ }
  if (detail.ok) osNotify(`✅ ${T('Калорії готові')}`, `${detail.name} — ${detail.kcal} ${T('ккал')}`, detail.id);
  else osNotify(`⚠️ ${T('Не вдалося розпізнати страву')}`, T(detail.err), detail.id);
}

// ---------- запуск ----------
const hhmm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const newId = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

function fail(job, msg) {
  job.status = 'error';
  job.err = msg;
  emit();
  done({ ok: false, id: job.id, iso: job.iso, err: msg });
}

async function run(job, file, key, hint) {
  try {
    const r = await CAL.analyzeFoodPhoto(file, key, S.getSettings().lang, hint);
    if (!key) BILL.usePhoto(); // запит пішов через наш сервер — рахуємо
    if (!r.isFood) { fail(job, MSG_NOT_FOOD); return; }
    let items = r.items;
    if (adjust) { try { items = adjust(r) || items; } catch (e) { items = r.items; } }
    const tot = CAL.itemsTotal(items);
    const name = (r.name || (items[0] && items[0].name) || T('Страва')).slice(0, 120);
    S.addCalorieEntry(job.iso, {
      id: job.id, name, kcal: tot.kcal, prot: tot.prot, fat: tot.fat, carb: tot.carb, g: tot.g,
      items, t: hhmm(), photo: true,
    });
    const i = jobs.findIndex((j) => j.id === job.id);
    if (i >= 0) jobs.splice(i, 1);
    emit();
    done({ ok: true, id: job.id, iso: job.iso, name, kcal: tot.kcal });
  } catch (e) {
    fail(job, CAL.errorMessage(e));
  }
}

/**
 * Віддати фото на розпізнавання у фоні.
 * @returns {Promise<{ok: true, id: string} | {ok: false, reason: 'unavailable' | 'limit'}>} — вже після того, як робота зʼявилась у списку.
 */
export async function startJob(file, { iso, hint } = {}) {
  const key = (S.getSettings().geminiKey || '').trim();
  if (!key && !(await CAL.proxyAvailable())) return { ok: false, reason: 'unavailable' };
  if (!key && !BILL.canAnalyzePhoto()) return { ok: false, reason: 'limit' };
  const id = newId();
  // мініатюру робимо одразу: вона ж читає файл, поки він точно доступний
  let thumb = null;
  try { thumb = await makeThumb(file); } catch (e) { thumb = null; }
  if (thumb) await putThumb(id, thumb);
  const job = { id, iso: iso || S.todayISO(), status: 'pending', at: Date.now(), err: '' };
  jobs.push(job);
  emit();
  askNotifyOnce();
  run(job, file, key, hint); // навмисно без await — працює далі, поки людина ходить екранами
  return { ok: true, id };
}
