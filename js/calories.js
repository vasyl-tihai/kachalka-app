// calories.js — визначення калорійності страви за фото.
// Використовує Google Gemini API з БЕЗКОШТОВНИМ ключем користувача
// (aistudio.google.com/apikey). Ключ зберігається лише на пристрої
// (settings.geminiKey) і надсилається тільки в Google.

// моделі в порядку спроб (безкоштовний tier; назви можуть відрізнятись за акаунтом)
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

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

/**
 * Аналіз фото страви. Повертає {isFood, name, portion, kcal, prot, fat, carb}.
 * Кидає Error зі зрозумілим (укр.) повідомленням.
 */
export async function analyzeFoodPhoto(file, apiKey, lang) {
  if (!apiKey) throw new Error('no-key');
  const b64 = await toBase64Jpeg(file);
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: b64 } },
          { text: prompt(lang || 'uk') },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, response_mime_type: 'application/json' },
  });

  let lastStatus = 0;
  for (const model of MODELS) {
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
      if (!text) throw new Error('parse');
      let j;
      try {
        j = JSON.parse(text.replace(/^```json\s*|```\s*$/g, ''));
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
    lastStatus = res.status;
    // 404 = модель недоступна на цьому акаунті — пробуємо наступну; решта — стоп
    if (res.status !== 404) break;
  }
  if (lastStatus === 400 || lastStatus === 401 || lastStatus === 403) throw new Error('bad-key');
  if (lastStatus === 429) throw new Error('quota');
  throw new Error('api-' + lastStatus);
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
