// push.js — сповіщення-нагадування від самого Gym Log (Web Push, без входу в акаунт; рішення 31.10).
//
// Як це працює: застосунок сам рахує КОНКРЕТНІ моменти на 14 днів уперед (прийоми вітамінів за розкладом, етапами й
// курсами; тренування з часом тижневого плану; мінус «Нагадати за») і шле їх у функцію `push` (backend/edge-push,
// backend/PUSH.md). Сервер розкладів не знає — лише «о такій-то годині UTC — такий текст». Тому розклад пересилається
// при запуску й після кожної зміни даних (store.js диспатчить `kachalka-saved`), а застосунок треба відкривати хоч раз на 2 тижні.
// Календарні нагадування (js/remind.js) лишаються запасним варіантом.
import * as S from './store.js';
import { t as T, getLang } from './i18n.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './backend-config.js';

const FLAG = 'kachalka-push'; // '1' — людина ввімкнула
const SYNC_KEY = 'kachalka-push-sync'; // { h: хеш останнього надісланого, t: коли }
const DAYS = 14;
const MAX_ITEMS = 200; // стільки сервер приймає за раз
const MIN_GAP = 30000; // не частіше разу на 30 с
const SAME_FOR = 6 * 3600000; // нічого не змінилось — перешлемо хоч раз на 6 год (вікно в 14 днів зсувається)

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* приватний режим */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* — */ } };

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
    && 'Notification' in window && !!VAPID_PUBLIC_KEY;
}
/** Ввімкнено: людина натиснула «Увімкнути» і дозвіл на сповіщення досі є (сама підписка перевіряється при sync). */
export function pushEnabled() {
  try {
    return pushSupported() && lsGet(FLAG) === '1' && Notification.permission === 'granted';
  } catch (e) { return false; }
}

function keyBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function getSub(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    const opts = { userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) };
    try {
      sub = await reg.pushManager.subscribe(opts);
    } catch (e) {
      // стара підписка з іншим ключем → скасувати й підписатися наново
      const old = await reg.pushManager.getSubscription();
      if (!old) throw e;
      await old.unsubscribe();
      sub = await reg.pushManager.subscribe(opts);
    }
  }
  return sub;
}

// ---------- що й коли нагадувати ----------
const pad = (n) => String(n).padStart(2, '0');
// 'YYYY-MM-DD' + 'HH:MM' у місцевому часі пристрою → мс (UTC)
function localMs(iso, hhmm) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/**
 * Моменти нагадувань на 14 днів уперед від `now`: [{ at (ISO UTC), title, body, url }], за часом, ≤ 200.
 * Вітаміни — один пункт на один час з переліком назв (відмічені вже прийоми пропускаємо), тренування — дні тижневого
 * плану з часом у settings.planTimes. Усе мінус settings.remindMin хвилин; що вже в минулому — не шлемо.
 */
export function buildPushItems(now = new Date()) {
  const remind = (Number(S.getSettings().remindMin) || 0) * 60000;
  const planTimes = S.getSettings().planTimes || {};
  const sch = S.getSchedule();
  const nowMs = now.getTime();
  const out = [];
  for (let k = 0; k < DAYS; k++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, 12, 0, 0);
    const iso = S.dateToISO(day);

    // вітаміни: за часом прийому
    const byTime = new Map(); // 'HH:MM' → Set(назви)
    for (const x of S.suppDosesOn(iso)) {
      if (x.taken || !/^\d\d:\d\d$/.test(x.time)) continue;
      if (!byTime.has(x.time)) byTime.set(x.time, new Set());
      byTime.get(x.time).add(x.it.name);
    }
    for (const [tm, names] of byTime) {
      const at = localMs(iso, tm) - remind;
      if (at <= nowMs) continue;
      out.push({ at, title: `💊 ${tm} — ${[...names].join(', ')}`, body: T('Відміть прийом у Gym Log'), url: '#/supps' });
    }

    // тренування: день тижневого плану з поставленим часом
    const dow = String(day.getDay());
    const tm = planTimes[dow];
    if (tm && /^\d\d:\d\d$/.test(tm)) {
      const ws = (sch[dow] || []).map((id) => S.getWorkout(id)).filter(Boolean);
      if (ws.length) {
        const at = localMs(iso, tm) - remind;
        if (at > nowMs) {
          const names = [...new Set(ws.map((w) => T(w.name)))].join(' + ');
          out.push({ at, title: `🏋️ ${T('Час тренування')} · ${tm}`, body: names, url: '#/today' });
        }
      }
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out.slice(0, MAX_ITEMS).map((x) => ({ ...x, at: new Date(x.at).toISOString() }));
}

// ---------- сервер ----------
async function post(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

let lastTry = 0;
let trail = null;
let busy = false;

/** Переслати розклад на сервер (якщо сповіщення ввімкнено). Тихо ковтає помилки (офлайн). force — без пропусків і ліміту. */
export async function syncPush(opts = {}) {
  try {
    if (!pushEnabled() || busy) return false;
    const wait = lastTry + MIN_GAP - Date.now();
    if (!opts.force && wait > 0) { // надто часто — одна відкладена спроба, щоб зміни не загубились
      clearTimeout(trail);
      trail = setTimeout(() => syncPush(), wait + 50);
      return false;
    }
    busy = true;
    try {
      const sub = await getSub(false);
      if (!sub) { lsDel(FLAG); return false; } // підписку скасовано з браузера
      const items = buildPushItems();
      const json = sub.toJSON();
      const h = JSON.stringify([json.endpoint, getLang(), items]);
      let prev = null;
      try { prev = JSON.parse(lsGet(SYNC_KEY) || 'null'); } catch (e) { /* — */ }
      if (!opts.force && prev && prev.h === h && Date.now() - prev.t < SAME_FOR) return true;
      lastTry = Date.now();
      const ok = await post({ op: 'register', sub: { endpoint: json.endpoint, keys: json.keys }, lang: getLang(), items });
      if (ok) lsSet(SYNC_KEY, JSON.stringify({ h, t: Date.now() }));
      return ok;
    } finally {
      busy = false;
    }
  } catch (e) {
    return false; // офлайн / сервер не відповів — наступного разу
  }
}

/** Увімкнути: дозвіл → підписка → розклад на сервер. Повертає { ok } або { ok:false, reason:'denied'|'unsupported'|'error' }. */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied' };
    const sub = await getSub(true);
    if (!sub) return { ok: false, reason: 'error' };
    lsSet(FLAG, '1');
    lsDel(SYNC_KEY);
    await syncPush({ force: true }); // без мережі підписка лишається, розклад піде при наступному запуску
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
}

/** Вимкнути: прибрати підписку в браузері й на сервері. */
export async function disablePush() {
  lsDel(FLAG);
  lsDel(SYNC_KEY);
  clearTimeout(trail);
  try {
    const sub = await getSub(false);
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      try { await post({ op: 'unregister', endpoint }); } catch (e) { /* сервер дочистить 404/410 сам */ }
    }
  } catch (e) { /* — */ }
  return { ok: true };
}

// ---------- автосинхронізація ----------
// store.js після кожного збереження диспатчить `kachalka-saved` (без імпорту звідси — щоб не було циклу)
let debounce = null;
if (typeof window !== 'undefined') {
  window.addEventListener('kachalka-saved', () => {
    if (!pushEnabled()) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => syncPush(), 3000);
  });
  setTimeout(() => syncPush(), 4000); // при запуску застосунку
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncPush(); // повернення в застосунок (SAME_FOR не дасть слати зайве)
  });
}
