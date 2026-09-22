// photos.js — фото дня: знімки, які користувач зробив у залі того дня.
//
// Чому окреме сховище: у localStorage лежить увесь щоденник і там ~5 МБ на все,
// одне фото зʼїло б відчутну частину. Тому знімки живуть в IndexedDB, а в стані
// застосунку про них нічого немає. Перед записом фото стискається (довга сторона
// до 1440 px, JPEG ~0.72) — з 4 МБ виходить приблизно 200–350 КБ.

const DB_NAME = 'kachalka-photos';
const STORE = 'photos';
const MAX_SIDE = 1440;
const QUALITY = 0.72;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('iso', 'iso', { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Зменшити й стиснути знімок перед збереженням.
function compress(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.round(img.width * k);
      const h = Math.round(img.height * k);
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(
        (blob) => (blob ? resolve({ blob, w, h }) : reject(new Error('compress-failed'))),
        'image/jpeg',
        QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad-image'));
    };
    img.src = url;
  });
}

/** Додати фото до дня. @returns {Promise<{id, iso, ts}>} */
export async function add(iso, file) {
  const { blob, w, h } = await compress(file);
  const rec = { id: uid(), iso, ts: Date.now(), blob, w, h };
  const store = await tx('readwrite');
  await new Promise((resolve, reject) => {
    const r = store.add(rec);
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
  return { id: rec.id, iso: rec.iso, ts: rec.ts };
}

/** Усі фото дня, старіші спершу. @returns {Promise<Array<{id, ts, url}>>} */
export async function listByDay(iso) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const out = [];
    const req = store.index('iso').openCursor(IDBKeyRange.only(iso));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) {
        out.sort((a, b) => a.ts - b.ts);
        resolve(out);
        return;
      }
      const v = cur.value;
      out.push({ id: v.id, ts: v.ts, url: URL.createObjectURL(v.blob) });
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Скільки фото в дні (без читання самих знімків). */
export async function countByDay(iso) {
  const store = await tx('readonly');
  return new Promise((resolve) => {
    const req = store.index('iso').count(IDBKeyRange.only(iso));
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => resolve(0);
  });
}

export async function remove(id) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const r = store.delete(id);
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
}

/** Дні, у яких є хоч одне фото — щоб позначати їх у календарі. */
export async function daysWithPhotos() {
  const store = await tx('readonly');
  return new Promise((resolve) => {
    const days = new Set();
    const req = store.index('iso').openKeyCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) {
        resolve(days);
        return;
      }
      days.add(cur.key);
      cur.continue();
    };
    req.onerror = () => resolve(days);
  });
}
