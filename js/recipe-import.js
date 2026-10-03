// recipe-import.js — автоімпорт рецепта з фото або посилання (стаття / YouTube / TikTok).
// Розбір робить серверна функція Supabase «recipe-import» (backend/edge-recipe-import),
// ключ ШІ лежить на сервері. Доступ: пробний період — FREE_IMPORTS на день, PRO — без ліміту.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './backend-config.js';

const URL_FN = SUPABASE_URL ? SUPABASE_URL + '/functions/v1/recipe-import' : '';

let _ok = null;
// чи розгорнута функція (раз за сесію): 400 no-input = жива, 404 / мережа = ні
export async function importAvailable() {
  if (!URL_FN) return false;
  if (_ok !== null) return _ok;
  try {
    const r = await fetch(URL_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: '{}',
    });
    _ok = r.status !== 404;
  } catch {
    _ok = false;
  }
  return _ok;
}

// фото → JPEG base64 (без префікса), довша сторона ≤ 1280 px — текст має читатись
async function toB64(file, maxSide = 1280) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

// перше посилання з тексту (з «Поділитися» часто приходить «назва + url»)
export function findUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : '';
}

/** Імпорт: { file } або { url }. Повертає recipe-об'єкт для форми або кидає Error(code). */
export async function importRecipe({ file, url, lang }) {
  if (!(await importAvailable())) throw new Error('no-server');
  const body = { lang: lang || 'uk' };
  if (file) body.image = await toB64(file);
  else body.url = url;
  let r;
  try {
    r = await fetch(URL_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('offline');
  }
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.recipe) return d.recipe;
  throw new Error(d.error || 'api-' + r.status);
}

/** Людське повідомлення (ключі i18n — укр. рядки). */
export function importError(e) {
  const m = String((e && e.message) || '');
  if (m === 'no-server') return 'Автоімпорт скоро запрацює — сервер ще підключається';
  if (m === 'offline') return 'Немає інтернету — спробуй пізніше';
  if (m === 'no-recipe') return 'Не знайшов рецепта — у джерелі немає списку інгредієнтів. Додай вручну';
  if (m === 'source-unavailable') return 'Не вдалося відкрити посилання — перевір його або встав текст вручну';
  if (m === 'quota') return 'Забагато імпортів сьогодні — спробуй завтра';
  return 'Не вдалося імпортувати рецепт — спробуй ще раз';
}
