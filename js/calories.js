// calories.js — визначення калорійності страви за фото.
// Працює з ключем користувача (зберігається лише на пристрої,
// settings.geminiKey): OpenAI (ChatGPT, ключ sk-…, платний API) або
// Google Gemini (ключ AIza…, безкоштовний tier). Провайдер визначається
// автоматично за форматом ключа.

// моделі в порядку спроб (404 = модель недоступна — пробуємо наступну)
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const OPENAI_MODELS = ['gpt-5-mini', 'gpt-4o-mini'];

/** Стиснути фото до JPEG ≤ maxSide px і повернути чистий base64 (без префікса). */
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
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

function prompt(lang) {
  return `You are a nutrition expert. Look at the photo of food and estimate its nutrition for the WHOLE visible portion.
Reply with ONLY a JSON object, no markdown:
{"is_food": true|false, "dish": "<short dish name in language '${lang}'>", "portion_g": <estimated grams>, "kcal": <kcal>, "protein_g": <g>, "fat_g": <g>, "carb_g": <g>}
If the photo does not show food, set is_food to false and other fields to 0.`;
}

// текст відповіді моделі → результат {isFood, name, portion, kcal, prot, fat, carb}
function parseResult(text) {
  if (!text) throw new Error('parse');
  let j;
  try {
    j = JSON.parse(String(text).replace(/^```json\s*|```\s*$/g, ''));
  } catch (e) {
    throw new Error('parse');
  }
  return {
    isFood: !!j.is_food,
    name: String(j.dish || '').slice(0, 120),
    portion: Math.max(0, Math.round(Number(j.portion_g) || 0)),
    kcal: Math.max(0, Math.round(Number(j.kcal) || 0)),
    prot: Math.max(0, Math.round(Number(j.protein_g) || 0)),
    fat: Math.max(0, Math.round(Number(j.fat_g) || 0)),
    carb: Math.max(0, Math.round(Number(j.carb_g) || 0)),
  };
}

function throwStatus(status) {
  if (status === 400 || status === 401 || status === 403) throw new Error('bad-key');
  if (status === 429) throw new Error('quota');
  throw new Error('api-' + status);
}

async function analyzeGemini(b64, apiKey, lang) {
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: b64 } },
          { text: prompt(lang) },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, response_mime_type: 'application/json' },
  });
  let lastStatus = 0;
  for (const model of GEMINI_MODELS) {
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
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

async function analyzeOpenAI(b64, apiKey, lang) {
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
                { type: 'text', text: prompt(lang) },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
              ],
            },
          ],
          response_format: { type: 'json_object' },
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
 * Аналіз фото страви. Повертає {isFood, name, portion, kcal, prot, fat, carb}.
 * Провайдер за форматом ключа: sk-… → OpenAI (ChatGPT), інакше Gemini.
 * Кидає Error зі зрозумілим (укр.) повідомленням.
 */
export async function analyzeFoodPhoto(file, apiKey, lang) {
  if (!apiKey) throw new Error('no-key');
  const b64 = await toBase64Jpeg(file);
  const l = lang || 'uk';
  return apiKey.startsWith('sk-') ? analyzeOpenAI(b64, apiKey, l) : analyzeGemini(b64, apiKey, l);
}

/** Людське повідомлення про помилку (ключі i18n — укр. рядки). */
export function errorMessage(e) {
  const m = String((e && e.message) || '');
  if (m === 'no-key') return 'Спершу додай ключ API';
  if (m === 'bad-key') return 'Невірний ключ API — перевір його';
  if (m === 'quota') return 'Ліміт запитів вичерпано — спробуй за хвилину';
  if (m === 'offline') return 'Немає з’єднання з інтернетом';
  if (m === 'parse') return 'Не вдалося розібрати відповідь — спробуй ще раз';
  return 'Помилка аналізу';
}
