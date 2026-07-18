// service-worker.js — офлайн + доставка оновлень
// Стратегія:
//   • код застосунку (навігація, *.js, *.css) — network-first: свіжа версія підтягується
//     при кожному онлайн-запуску, а офлайн працює з кешу;
//   • іконки/шрифти/маніфест — cache-first (рідко змінюються), із докешуванням у рантаймі.
const CACHE = 'kachalka-v16';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/version.js',
  './js/calories.js',
  './models/pose_landmarker_lite.task',
  './js/store.js',
  './js/timer.js',
  './js/picker.js',
  './js/pose.js',
  './js/formcheck.js',
  './js/i18n.js',
  './js/fx.js',
  './js/backend.js',
  './js/backend-config.js',
  './vendor/supabase/supabase.mjs',
  './vendor/mediapipe/vision_bundle.mjs',
  './manifest.webmanifest',
  './fonts/nunito.css',
  './fonts/nunito-600-cyrillic.woff2',
  './fonts/nunito-600-cyrillic-ext.woff2',
  './fonts/nunito-600-latin.woff2',
  './fonts/nunito-600-latin-ext.woff2',
  './fonts/nunito-700-cyrillic.woff2',
  './fonts/nunito-700-cyrillic-ext.woff2',
  './fonts/nunito-700-latin.woff2',
  './fonts/nunito-700-latin-ext.woff2',
  './fonts/nunito-800-cyrillic.woff2',
  './fonts/nunito-800-cyrillic-ext.woff2',
  './fonts/nunito-800-latin.woff2',
  './fonts/nunito-800-latin-ext.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // по одному ассету: одна 404/збій не зриває весь precache (на відміну від addAll)
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: повз HTTP-кеш браузера (GitHub Pages віддає max-age=600 —
    // без цього телефон міг до 10 хв «оновлюватись» у стару версію)
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    // запасний index.html — лише для навігації, інакше .js/.css отримали б HTML і впали б
    return req.mode === 'navigate' ? (await cache.match('./index.html')) || Response.error() : Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return hit || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // чужі домени не перехоплюємо

  const isAppShell = req.mode === 'navigate' || /\.(?:js|css)$/.test(url.pathname);
  e.respondWith(isAppShell ? networkFirst(req) : cacheFirst(req));
});
