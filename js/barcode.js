// barcode.js — продукт за штрихкодом: сканування камерою (BarcodeDetector, є в Chrome на Android)
// і пошук у відкритій базі Open Food Facts (безкоштовно, без ключа). На сервер іде лише номер штрихкоду.

const OFF = 'https://world.openfoodfacts.org/api/v2/product/';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export function scanSupported() {
  return 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// лише цифри; EAN-8 / UPC / EAN-13 / ITF-14
export function cleanCode(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 14 ? d : '';
}

// Сканує в <video>, поки не знайде код або не викличуть stop(). Повертає { done: Promise<code>, stop }.
export function startScan(video) {
  let stream = null, stopped = false, timer = 0, cancel = null;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (cancel) cancel(new Error('cancelled')); // завершити очікування, щоб обіцянка не висіла
  };
  const done = (async () => {
    let fmts = FORMATS;
    try {
      const sup = await window.BarcodeDetector.getSupportedFormats();
      fmts = FORMATS.filter((f) => sup.includes(f));
    } catch (e) { /* старі версії — пробуємо як є */ }
    const det = new window.BarcodeDetector({ formats: fmts.length ? fmts : FORMATS });
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    if (stopped) { stop(); throw new Error('cancelled'); }
    video.srcObject = stream;
    video.play().catch(() => {}); // не чекаємо: кадри підуть, коли камера прокинеться
    return await new Promise((resolve, reject) => {
      cancel = reject;
      const tick = async () => {
        if (stopped) return reject(new Error('cancelled'));
        if (video.readyState < 2) { timer = setTimeout(tick, 180); return; } // ще немає кадру
        try {
          const codes = await det.detect(video);
          const c = codes.map((x) => cleanCode(x.rawValue)).find(Boolean);
          if (c) { resolve(c); return stop(); }
        } catch (e) { /* кадр ще не готовий */ }
        timer = setTimeout(tick, 180);
      };
      tick();
    });
  })();
  done.catch(() => stop());
  return { done, stop };
}

// ZXing (vendor/zxing, 360 КБ) вантажиться лише при першому фото штрихкоду
let zxLoad = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return zxLoad || (zxLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/zxing/zxing.min.js';
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => { zxLoad = null; reject(new Error('nolib')); };
    document.head.appendChild(s);
  }));
}

async function loadImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

// Штрихкод із фото (працює на будь-якому телефоні). Повертає цифри або '' — не вдалося прочитати.
export async function decodeImage(file) {
  const img = await loadImage(file);
  if ('BarcodeDetector' in window) {
    try {
      const found = await new window.BarcodeDetector({ formats: FORMATS }).detect(img);
      const c = found.map((x) => cleanCode(x.rawValue)).find(Boolean);
      if (c) return c;
    } catch (e) { /* формат не підтримується — далі ZXing */ }
  }
  const Z = await loadZXing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS,
    [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const W = img.width, H = img.height;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // кілька масштабів і поворот на 90° (штрихкод на фото буває вертикальним)
  for (const side of [1400, 900, 2200]) {
    const k = Math.min(1, side / Math.max(W, H));
    const w = Math.round(W * k), h = Math.round(H * k);
    for (const rot of [false, true]) {
      cv.width = rot ? h : w;
      cv.height = rot ? w : h;
      ctx.save();
      if (rot) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
      const src = new Z.HTMLCanvasElementLuminanceSource(cv);
      for (const Bin of [Z.HybridBinarizer, Z.GlobalHistogramBinarizer]) {
        try {
          const c = cleanCode(reader.decode(new Z.BinaryBitmap(new Bin(src))).getText());
          if (c) return c;
        } catch (e) { /* не знайшли — наступна спроба */ }
      }
    }
  }
  return '';
}

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// { code, name, brand, per100: {kcal, prot, fat, carb}, serving } або null, якщо в базі немає.
// Кидає 'offline', якщо база недоступна.
export async function lookupProduct(code, lang = 'uk') {
  const fields = ['product_name', `product_name_${lang}`, 'product_name_uk', 'product_name_en', 'brands',
    'nutriments', 'serving_quantity'].join(',');
  let r;
  try {
    r = await fetch(`${OFF}${code}.json?fields=${fields}`);
  } catch (e) {
    throw new Error('offline');
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('offline');
  const d = await r.json();
  const p = d && d.product;
  if (!p || d.status === 0) return null;
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (!kcal && n.energy_100g) kcal = num(n.energy_100g) / 4.184; // кДж → ккал
  const name = (p[`product_name_${lang}`] || p.product_name_uk || p.product_name || p.product_name_en || '').trim();
  return {
    code,
    name: name || code,
    brand: String(p.brands || '').split(',')[0].trim(),
    per100: { kcal, prot: num(n.proteins_100g), fat: num(n.fat_100g), carb: num(n.carbohydrates_100g) },
    hasData: kcal > 0,
    serving: Math.round(num(p.serving_quantity)) || 0,
  };
}

// значення на вказану вагу в грамах
export function forGrams(per100, g) {
  const k = (Number(g) || 0) / 100;
  return {
    kcal: Math.round(per100.kcal * k),
    prot: Math.round(per100.prot * k),
    fat: Math.round(per100.fat * k),
    carb: Math.round(per100.carb * k),
  };
}
