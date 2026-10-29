// calories.js — визначення калорійності страви за фото.
// Порядок: якщо на пристрої є ключ користувача (settings.geminiKey) —
// прямий запит (sk-… → OpenAI, AIza… → Gemini). Якщо ключа немає —
// серверна функція-посередник (Supabase Edge Function «calories»),
// де ключ OpenAI власника лежить секретом і в браузер не потрапляє.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './backend-config.js';

const PROXY_URL = SUPABASE_URL ? SUPABASE_URL + '/functions/v1/calories' : '';

// моделі в порядку спроб (404 = модель недоступна — пробуємо наступну)
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const OPENAI_MODELS = ['gpt-5-mini', 'gpt-4o-mini'];

// чи розгорнута серверна функція (перевіряємо раз за сесію)
let _proxyOk = null;
export async function proxyAvailable() {
  if (!PROXY_URL) return false;
  if (_proxyOk !== null) return _proxyOk;
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: '{}',
    });
    // 400 (no-image) = функція жива; 404 = ще не розгорнута
    _proxyOk = res.status !== 404;
  } catch {
    _proxyOk = false;
  }
  return _proxyOk;
}

async function analyzeProxy(b64, lang, hint) {
  let res;
  try {
    // сервер вимагає вхід в акаунт: Authorization: Bearer <JWT> (без входу відповість 401)
    const { functionHeaders } = await import('./backend.js');
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: await functionHeaders(),
      body: JSON.stringify({ image: b64, lang, hint }),
    });
  } catch (e) {
    throw new Error('offline');
  }
  if (res.ok) {
    const d = await res.json();
    return parseResult(d.result);
  }
  if (res.status === 404) throw new Error('no-proxy');
  if (res.status === 401) throw new Error('auth');
  if (res.status === 402) throw new Error('premium'); // пробний тиждень минув, підписки немає
  if (res.status === 429) {
    // {error:'limit'} — наш денний ліміт; інакше «зачекай» від ШІ
    const d = await res.json().catch(() => ({}));
    throw new Error(d && d.error === 'limit' ? 'limit' : 'quota');
  }
  throw new Error('api-' + res.status);
}

/** Стиснути фото до JPEG ≤ maxSide px і повернути чистий base64 (без префікса).
 *  768 px (29.10, було 512): на 512 губляться дрібниці — шар масла, сир, соус. */
async function toBase64Jpeg(file, maxSide = 768) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

// підказка людини — лише текст, без лапок і переносів (як cleanHint на сервері)
export function cleanHint(v) {
  return String(v || '').replace(/[\u0000-\u001f"`\\<>{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// той самий запит, що й у серверної функції (backend/edge-calories/index.ts) — для власного ключа людини
function prompt(lang, hint) {
  return `You are a registered dietitian estimating the nutrition of a meal from one photo.
1) Identify every component separately: main foods, sides, bread, sauces, dressings, toppings, drinks in the frame.
   Also add cooking fat (oil, butter) or sauce that is very likely used but not visible, with "hidden": true.
2) Estimate the weight in grams of each component from visual cues: plate size (a dinner plate is about 26 cm),
   cutlery, hands, cups, packaging and typical serving sizes. Weigh what is on the plate, not the whole pot.
3) For each component give typical nutrition per 100 g for that preparation (boiled, fried, raw...), consistent with
   kcal100 = 4*p100 + 4*c100 + 9*f100 (approximately).
If it is a packaged product with a visible label or barcode, set "packaged": true.
${hint ? `The user describes the meal as: "${hint}". Trust this for what the food is and for any amounts it states.\n` : ''}Names ("dish" and "name") in language '${lang}'. If the photo does not show food: "is_food": false and "items": [].
Reply with ONLY a JSON object, no markdown:
{"is_food": bool, "dish": string, "packaged": bool, "items": [{"name": string, "grams": number, "kcal100": number, "p100": number, "f100": number, "c100": number, "hidden": bool}]}`;
}

// складник → межі значень; ккал на 100 г, що не сходиться з БЖВ (>25 %), замінюємо формулою 4Б+4В+9Ж
function cleanItem(x) {
  const num = (v, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(0, n)) : 0; };
  const p100 = num(x && x.p100, 100), f100 = num(x && x.f100, 100), c100 = num(x && x.c100, 100);
  let kcal100 = num(x && x.kcal100, 900);
  const calc = 4 * p100 + 4 * c100 + 9 * f100;
  if (calc > 0 && Math.abs(kcal100 - calc) / calc > 0.25) kcal100 = calc;
  return {
    name: String((x && x.name) || '').slice(0, 60),
    grams: Math.round(num(x && x.grams, 3000)),
    kcal100, p100, f100, c100,
    hidden: !!(x && x.hidden),
  };
}
/** Суми за складниками: { g, kcal, prot, fat, carb } (округлені). */
export function itemsTotal(items) {
  const t = { g: 0, kcal: 0, prot: 0, fat: 0, carb: 0 };
  for (const x of items) {
    const k = x.grams / 100;
    t.g += x.grams; t.kcal += x.kcal100 * k; t.prot += x.p100 * k; t.fat += x.f100 * k; t.carb += x.c100 * k;
  }
  for (const key of Object.keys(t)) t[key] = Math.round(t[key]);
  return t;
}

// текст відповіді моделі → { isFood, name, packaged, items, portion, kcal, prot, fat, carb }.
// Суми рахуємо самі зі складників; стара відповідь без складників (сервер до 29.10) — один складник «уся порція»
function parseResult(text) {
  if (!text) throw new Error('parse');
  let j;
  try {
    j = JSON.parse(String(text).replace(/^```json\s*|```\s*$/g, ''));
  } catch (e) {
    throw new Error('parse');
  }
  const name = String(j.dish || '').slice(0, 120);
  let items = (Array.isArray(j.items) ? j.items : []).slice(0, 12).map(cleanItem).filter((x) => x.name && x.grams > 0);
  if (!items.length && Number(j.portion_g) > 0 && Number(j.kcal) > 0) {
    const g = Number(j.portion_g);
    items = [cleanItem({ name: name || '—', grams: g, kcal100: (j.kcal * 100) / g,
      p100: (j.protein_g * 100) / g, f100: (j.fat_g * 100) / g, c100: (j.carb_g * 100) / g })];
  }
  const t = itemsTotal(items);
  return {
    isFood: !!j.is_food && items.length > 0,
    name,
    packaged: !!j.packaged,
    items,
    portion: t.g,
    kcal: t.kcal,
    prot: t.prot,
    fat: t.fat,
    carb: t.carb,
  };
}

function throwStatus(status) {
  if (status === 400 || status === 401 || status === 403) throw new Error('bad-key');
  if (status === 429) throw new Error('quota');
  throw new Error('api-' + status);
}

async function analyzeGemini(b64, apiKey, lang, hint) {
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: b64 } },
          { text: prompt(lang, hint) },
        ],
      },
    ],
    generationConfig: { temperature: 0, response_mime_type: 'application/json' },
  });
  let lastStatus = 0;
  for (const model of GEMINI_MODELS) {
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        // ключ — у заголовку, не в адресі (адреси потрапляють у журнали)
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body }
      );
    } catch (e) {
      throw new Error('offline');
    }
    if (res.ok) {
      const data = await res.json();
      const text =
        data && data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text;
      return parseResult(text);
    }
    lastStatus = res.status;
    if (res.status !== 404) break; // 404 = модель недоступна — наступна
  }
  throwStatus(lastStatus);
}

async function analyzeOpenAI(b64, apiKey, lang, hint) {
  let lastStatus = 0;
  for (const model of OPENAI_MODELS) {
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt(lang, hint) },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64, detail: 'high' } },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          // моделі gpt-5 приймають лише типову температуру
          ...(model.startsWith('gpt-4') ? { temperature: 0 } : {}),
        }),
      });
    } catch (e) {
      throw new Error('offline');
    }
    if (res.ok) {
      const data = await res.json();
      const text =
        data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return parseResult(text);
    }
    lastStatus = res.status;
    if (res.status !== 404) break; // 404 = модель недоступна — наступна
  }
  throwStatus(lastStatus);
}

/**
 * Аналіз фото страви. Повертає {isFood, name, packaged, items, portion, kcal, prot, fat, carb}.
 * hint — необов'язковий опис від людини («гречка з куркою, 1 ст. л. олії»).
 * Провайдер за форматом ключа: sk-… → OpenAI (ChatGPT), інакше Gemini.
 * Кидає Error зі зрозумілим (укр.) повідомленням.
 */
export async function analyzeFoodPhoto(file, apiKey, lang, hint) {
  const b64 = await toBase64Jpeg(file);
  const l = lang || 'uk';
  const h = cleanHint(hint);
  if (!apiKey) {
    // без власного ключа — через сервер власника застосунку
    if (PROXY_URL) return analyzeProxy(b64, l, h);
    throw new Error('no-key');
  }
  // розпізнаємо провайдера за форматом; незнайомий формат — чесно кажемо одразу
  const isOpenAI = apiKey.startsWith('sk-');
  const isGemini = apiKey.startsWith('AIza');
  if (!isOpenAI && !isGemini) throw new Error('bad-format');
  return isOpenAI ? analyzeOpenAI(b64, apiKey, l, h) : analyzeGemini(b64, apiKey, l, h);
}

/** Людське повідомлення про помилку (ключі i18n — укр. рядки). */
export function errorMessage(e) {
  const m = String((e && e.message) || '');
  if (m === 'no-key') return 'Спершу додай ключ API';
  if (m === 'no-proxy') return 'Сервер аналізу ще не налаштований — додай свій ключ через 🔑';
  if (m === 'bad-format') return 'Це не схоже на ключ OpenAI (sk-…) чи Gemini (AIza…) — перевір, звідки ти його скопіював';
  if (m === 'bad-key') return 'Невірний ключ API — перевір його';
  if (m === 'quota') return 'Ліміт запитів вичерпано — спробуй за хвилину';
  if (m === 'auth') return 'Увійди в акаунт (вкладка «Спільнота»), щоб користуватись цим';
  if (m === 'limit') return 'Ліміт на сьогодні вичерпано — спробуй завтра';
  if (m === 'premium') return 'Пробний тиждень закінчився — далі з підпискою';
  if (m === 'offline') return 'Немає з’єднання з інтернетом';
  if (m === 'parse') return 'Не вдалося розібрати відповідь — спробуй ще раз';
  return 'Помилка аналізу';
}
