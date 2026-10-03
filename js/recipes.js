// recipes.js — рецепти: вбудовані + власні, переклади, фото власних рецептів (IndexedDB),
// посилання на відео. Екран стрічки — renderRecipes у app.js.
import * as S from './store.js';
import { RECIPES } from './recipes-data.js';

// ---------- переклади вбудованих рецептів ----------
const TEXTS = {};
export async function loadTexts(lang) {
  if (lang === 'uk') return null;
  if (TEXTS[lang] !== undefined) return TEXTS[lang];
  try {
    TEXTS[lang] = (await import(`./recipes-i18n/${lang}.js`)).default;
  } catch {
    TEXTS[lang] = null; // перекладу немає — показуємо українською
  }
  return TEXTS[lang];
}

// усі рецепти поточною мовою: власні (новіші першими) + вбудовані
export function allRecipes(lang) {
  const tr = lang !== 'uk' ? TEXTS[lang] : null;
  const builtIn = RECIPES.map((r) => {
    const t = tr && tr[r.id];
    return t ? { ...r, name: t.name, ing: t.ing, steps: t.steps } : r;
  });
  return [...S.ownRecipes(), ...builtIn];
}

// «Для тебе»: порядок перемішується раз на день, власні рецепти — серед перших
export function feedOrder(list) {
  const day = Math.floor(Date.now() / 864e5);
  const rnd = (s) => { const x = Math.sin(s * 9301 + day * 49297) * 233280; return x - Math.floor(x); };
  const hash = (id) => [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 100000;
  const own = list.filter((r) => r.own);
  const rest = list.filter((r) => !r.own).sort((a, b) => rnd(hash(a.id)) - rnd(hash(b.id)));
  return [...own.slice(0, 3), ...rest, ...own.slice(3)];
}

// ---------- відео ----------
// id ролика YouTube з посилання (watch, youtu.be, shorts, embed) або null
export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}

// ---------- фото власних рецептів (IndexedDB, не localStorage) ----------
const DB_NAME = 'kachalka-recipes';
const STORE = 'photos';
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  return dbp;
}
async function tx(mode) {
  return (await db()).transaction(STORE, mode).objectStore(STORE);
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// стиснути фото до ~1080 px по довшій стороні (JPEG), щоб база не розросталась
export async function compressPhoto(file, max = 1080) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.82));
}
export async function putPhoto(id, blob) {
  await req2p((await tx('readwrite')).put({ id, blob }));
}
export async function delPhoto(id) {
  await req2p((await tx('readwrite')).delete(id));
}
const urlCache = new Map();
// object-URL фото рецепта (кешується до перезавантаження сторінки)
export async function photoUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  try {
    const rec = await req2p((await tx('readonly')).get(id));
    const url = rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
    urlCache.set(id, url);
    return url;
  } catch {
    return null;
  }
}
export function forgetPhoto(id) {
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
}
