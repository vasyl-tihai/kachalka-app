// billing.js — пробний період, підписка й денні ліміти.
//
// Єдине джерело правди про те, що користувачу зараз дозволено:
//   status()      → 'trial' | 'active' | 'expired'
//   photoQuota()  → скільки фото-аналізів лишилось сьогодні
//   locked()      → чи вже треба показувати пейвол замість застосунку
//
// ВАЖЛИВО. Усе, що тут, — зручність, а не захист: дані лежать у localStorage
// і очищаються разом із даними сайту. Реальний бар'єр — на сервері: функція
// калорій рахує ліміт сама й вимагає дійсну підписку (backend/SUBSCRIPTION.md).
// Тут ми лише не даємо витрачати запити й показуємо чесний стан.
import * as S from './store.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './backend-config.js';

const VERIFY_URL = SUPABASE_URL ? SUPABASE_URL + '/functions/v1/subscription' : '';

export const TRIAL_DAYS = 7; // скільки днів працює безкоштовно після встановлення
export const FREE_PHOTOS = 3; // фото-аналізів на день у пробному періоді
export const PRO_PHOTOS = 0; // 0 = без обмежень для підписників
export const WARN_DAYS = 2; // за скільки днів до кінця нагадати

// товари: ті самі id треба завести в Google Play Console і в веб-оплаті
export const PRODUCTS = [
  { id: 'kachalka_pro_monthly', label: 'Місяць', period: 'міс' },
  { id: 'kachalka_pro_yearly', label: 'Рік', period: 'рік', note: 'вигідніше' },
];
export const PLAY_BILLING = 'https://play.google.com/billing';
// сторінка веб-оплати (Stripe/Paddle/LiqPay) — підставляється, коли її заведуть
export const WEB_CHECKOUT = '';

function todayISO() {
  return S.todayISO();
}

// Блок білінгу в налаштуваннях; створюється на першому запуску.
function data() {
  const s = S.getSettings();
  let b = s.billing;
  if (!b || typeof b !== 'object') {
    b = { installedAt: todayISO(), sub: null, photoISO: todayISO(), photoN: 0 };
    S.updateSettings({ billing: b });
  }
  return b;
}

function save(patch) {
  const b = { ...data(), ...patch };
  S.updateSettings({ billing: b });
  return b;
}

function daysSince(iso) {
  const a = S.isoToDate(iso).getTime();
  const b = S.isoToDate(todayISO()).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Скільки днів пробного лишилось (0 — вичерпано). */
export function trialLeft() {
  return Math.max(0, TRIAL_DAYS - daysSince(data().installedAt));
}

/** Чи підписка зараз дійсна (перевіряється й датою закінчення). */
export function subActive() {
  const sub = data().sub;
  if (!sub || !sub.until) return false;
  return sub.until >= todayISO();
}

/** 'active' — підписка, 'trial' — пробний період, 'expired' — все вийшло. */
export function status() {
  if (subActive()) return 'active';
  return trialLeft() > 0 ? 'trial' : 'expired';
}

/** Чи показувати пейвол замість застосунку. */
export function locked() {
  return status() === 'expired';
}

/** Ліміт фото на сьогодні: { used, limit, left } (limit 0 = без обмежень). */
export function photoQuota() {
  const b = data();
  const used = b.photoISO === todayISO() ? Number(b.photoN) || 0 : 0;
  const limit = status() === 'active' ? PRO_PHOTOS : FREE_PHOTOS;
  return { used, limit, left: limit === 0 ? Infinity : Math.max(0, limit - used) };
}

export function canAnalyzePhoto() {
  return !locked() && photoQuota().left > 0;
}

/** Зарахувати витрачене фото (викликається після успішного розпізнавання). */
export function usePhoto() {
  const b = data();
  const same = b.photoISO === todayISO();
  save({ photoISO: todayISO(), photoN: same ? (Number(b.photoN) || 0) + 1 : 1 });
}

/** Записати підписку локально (після покупки або відповіді сервера). */
export function setSubscription(sub) {
  save({ sub: sub && sub.until ? { ...sub } : null });
}

// ---------- Google Play Billing (працює всередині TWA-обгортки) ----------

let _dgs = null; // сервіс цифрових товарів Play; null — ще не питали
export async function playService() {
  if (_dgs !== null) return _dgs;
  _dgs = false;
  try {
    if (window.getDigitalGoodsService) _dgs = await window.getDigitalGoodsService(PLAY_BILLING);
  } catch (e) {
    _dgs = false; // не TWA або Play недоступний
  }
  return _dgs;
}

/** Ціни з Play (у валюті користувача) або [] — тоді показуємо свої підписи. */
export async function playPrices() {
  const svc = await playService();
  if (!svc) return [];
  try {
    const items = await svc.getDetails(PRODUCTS.map((p) => p.id));
    return items.map((i) => ({ id: i.itemId, price: i.price ? `${i.price.value} ${i.price.currency}` : '' }));
  } catch (e) {
    return [];
  }
}

/**
 * Купівля підписки. У TWA — через Google Play, інакше — веб-оплата.
 * @returns {Promise<{ok:boolean, reason?:string, token?:string}>}
 */
export async function buy(productId) {
  const svc = await playService();
  if (svc && window.PaymentRequest) {
    try {
      const req = new PaymentRequest(
        [{ supportedMethods: PLAY_BILLING, data: { sku: productId } }],
        { total: { label: 'КАЧАЛКА Pro', amount: { currency: 'UAH', value: '0' } } }
      );
      const res = await req.show();
      const token = res.details && res.details.purchaseToken;
      await res.complete('success');
      // підтвердження покупки має робити сервер після звірки з Google
      return { ok: true, token, source: 'play', productId };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : 'скасовано' };
    }
  }
  if (WEB_CHECKOUT) {
    window.open(`${WEB_CHECKOUT}?product=${encodeURIComponent(productId)}`, '_blank', 'noopener');
    return { ok: false, reason: 'web-checkout' };
  }
  return { ok: false, reason: 'no-billing' };
}

/** Відновлення покупок: питаємо Play, що вже куплено на цьому акаунті. */
export async function restore() {
  const svc = await playService();
  if (!svc) return { ok: false, reason: 'no-billing' };
  try {
    const list = await svc.listPurchases();
    const active = list.find((p) => PRODUCTS.some((x) => x.id === p.itemId));
    if (!active) return { ok: false, reason: 'not-found' };
    return { ok: true, token: active.purchaseToken, productId: active.itemId, source: 'play' };
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : 'error' };
  }
}

/**
 * Звірка покупки з сервером: Edge Function «subscription» питає Google Play
 * Developer API і повертає дату, до якої підписка дійсна.
 * Поки функцію не розгорнули (404) — довіряємо відповіді Play на пристрої,
 * щоб застосунок не був зламаний до підняття бекенду.
 */
export async function verify({ token, productId, source }) {
  const fallback = { until: S.dateToISO(new Date(Date.now() + 31 * 86400000)), productId, source, unverified: true };
  if (!VERIFY_URL || !token) return fallback;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ token, productId, source }),
    });
    if (res.status === 404) return fallback; // функції ще немає
    const data = await res.json();
    if (!res.ok || !data.until) return { error: (data && data.error) || 'verify-failed' };
    return { until: data.until, productId, source };
  } catch (e) {
    return fallback; // немає мережі — не блокуємо того, хто щойно заплатив
  }
}
