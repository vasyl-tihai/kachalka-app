// receipt.js — «Чек → меню»: фото чека → список продуктів → меню на 3/5/7 днів лише з куплених продуктів
// (+ за бажанням «докупити»). Розпізнавання й меню від ШІ — серверна функція Supabase «receipt-plan»
// (backend/edge-receipt-plan, ключ ШІ на сервері). Без сервера — запасний планувальник на телефоні:
// підбирає вбудовані рецепти (js/recipes-data.js), для яких є всі продукти. Ліміт — BILL.receiptQuota().
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './backend-config.js';
import { RECIPES } from './recipes-data.js';
import { t as T } from './i18n.js';

const URL_FN = SUPABASE_URL ? SUPABASE_URL + '/functions/v1/receipt-plan' : '';

let _ok = null;
// чи розгорнута функція (раз за сесію): 400 no-input = жива, 404 / мережа = ні
export async function serverAvailable() {
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

// фото чека → JPEG base64 (без префікса); довга сторона до 1600 px — дрібний шрифт чека має читатись
async function toB64(file, maxSide = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

async function call(body) {
  if (!(await serverAvailable())) throw new Error('no-server');
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
  if (!r.ok) throw new Error(d.error || 'api-' + r.status);
  return d;
}

/** Фото чека (1–3) → [{name, qty}] — лише їжа, без пакетів, побутової хімії тощо. */
export async function recognize(files, lang) {
  const images = [];
  for (const f of files.slice(0, 3)) images.push(await toB64(f));
  const d = await call({ mode: 'recognize', images, lang: lang || 'uk' });
  if (!Array.isArray(d.products) || !d.products.length) throw new Error('no-products');
  return d.products;
}

/** Меню від ШІ: { days:[{meals}], buy:[{name, why}] }. */
export async function planAI({ products, days, extra, lang }) {
  const d = await call({ mode: 'plan', products, days, extra: !!extra, lang: lang || 'uk' });
  if (!d.plan || !Array.isArray(d.plan.days) || !d.plan.days.length) throw new Error('no-plan');
  return { ...d.plan, source: 'ai', created: Date.now() };
}

/** Людське повідомлення (ключі i18n — укр. рядки). */
export function errorText(e) {
  const m = String((e && e.message) || '');
  if (m === 'no-server') return 'Розпізнавання чека скоро запрацює — поки впиши продукти вручну';
  if (m === 'offline') return 'Немає інтернету — спробуй пізніше';
  if (m === 'no-products') return 'Не знайшов продуктів на фото — сфотографуй чек ближче й рівно';
  if (m === 'few-products') return 'Замало продуктів для меню — додай ще або увімкни «Можна докупити»';
  if (m === 'quota') return 'Забагато запитів сьогодні — спробуй завтра';
  return 'Не вдалося скласти меню — спробуй ще раз';
}

// =====================================================================
//  Запасний планувальник (без сервера): вбудовані рецепти, для яких є продукти
// =====================================================================
// те, що вважаємо «вдома завжди є» (перевіряється по українському тексту інгредієнта)
const PANTRY = /сіль|^перець|, перець|чорний перець|спеці|приправ|олі[яї]|^вода|вода\b|кориц|ванілін|підсолоджувач|розпушувач|сода|оцет|паприк|куркум|орегано|прованськ|лавров|сушен.*часник|кмин|кунжут|^зелень|^зелен[ьі] /i;
const STOP = new Set(['або', 'для', 'без', 'шт', 'мл', 'гр', 'кг', 'упак', 'пак', 'ваг', 'свіж', 'свіжий', 'свіжі',
  'заморожені', 'знежирений', 'нежирний', 'вищий', 'ґатунок', 'клас', 'жменя', 'щіпка', 'скибки', 'скибка', 'мірна',
  'ложка', 'ложки', 'чайна', 'столова', 'or', 'for', 'the', 'and', 'with', 'fresh', 'frozen', 'pcs', 'pinch', 'handful']);

function words(s) {
  return String(s || '').toLowerCase().replace(/ʼ|'/g, '').split(/[^a-zа-яіїєґäöüßàâçéèêëîïôûùüÿñæœąćęłńóśźż]+/i)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w));
}
// однакові слова з різними закінченнями: спільний початок ≥ 4 літер (огірки/огірок, банани/банан),
// а для коротких слів (яйця/яйце, сир, рис, «мол.» з чека) — ≥ 3
const SYN = [[/^кур(к|ят|оч)/, 'куряч'], [/^яєч/, 'яйц'], [/^chick/, 'chicken']];
const norm = (w) => { for (const [re, to] of SYN) if (re.test(w)) return to; return w; };
function same(a, b) {
  const x = norm(a), y = norm(b);
  let cp = 0;
  while (cp < x.length && cp < y.length && x[cp] === y[cp]) cp++;
  return cp >= 4 || (cp >= 3 && Math.min(x.length, y.length) <= 4);
}
const core = (ing) => String(ing).split(/\s[—–-]\s/)[0].trim(); // «Яйця — 2 шт.» → «Яйця»

// чи є інгредієнт серед продуктів. Однослівний — досить збігу з будь-яким словом продукту. Багатослівний
// («Куряче філе», «Філе лосося») — продукт з одного слова збігається з першим або останнім словом, а з кількох
// слів — має збігтися і з першим, і з останнім: інакше «Філе лосося» = «Філе куряче». Дужки не рахуємо.
function matches(prods, text) {
  const ws = words(core(text).replace(/\(.*?\)/g, ' '));
  if (!ws.length) return false;
  const f = ws[0], l = ws[ws.length - 1];
  return prods.some((pw) => {
    if (!pw.length) return false;
    const has = (w) => pw.some((x) => same(x, w));
    if (ws.length === 1) return has(f);
    if (pw.length === 1) return has(f) || has(l);
    return has(f) && has(l);
  });
}

const SLOT_CATS = { breakfast: ['breakfast', 'shake'], lunch: ['main'], dinner: ['main'], snack: ['snack', 'shake'] };

// ---------- «тарілка» з того, що є: білок + гарнір + овочі ----------
// Коли жоден рецепт не складається з куплених продуктів. Поживність — орієнтовна, на 100 г (крупи й макарони —
// сухі), порція — грами. Розпізнаємо за початком слова (укр. / англ.), як і решту.
const FOOD = [
  // [ключі, група, ккал, Б, Ж, В, порція]
  [['куряч', 'chick'], 'prot', 110, 23, 2, 0, 150],
  [['індич', 'turkey'], 'prot', 115, 24, 2, 0, 150],
  [['яйц', 'egg'], 'prot', 155, 13, 11, 1, 120],
  [['кисломол', 'творог', 'cottage'], 'prot', 120, 17, 5, 2, 150],
  [['тунец', 'тунц', 'tuna'], 'prot', 100, 23, 1, 0, 120],
  [['лосос', 'сьомг', 'форел', 'salmon'], 'prot', 200, 20, 13, 0, 150],
  [['риба', 'рибне', 'хек', 'минта', 'тріск', 'fish', 'cod'], 'prot', 80, 17, 1, 0, 150],
  [['яловичин', 'телятин', 'beef'], 'prot', 190, 19, 12, 0, 150],
  [['свинин', 'pork'], 'prot', 240, 17, 19, 0, 150],
  [['фарш', 'mince'], 'prot', 220, 17, 16, 0, 150],
  [['квасол', 'beans'], 'prot', 100, 7, 1, 17, 150],
  [['нут', 'chickpea'], 'prot', 120, 7, 2, 20, 150],
  [['рис', 'rice'], 'carb', 345, 7, 1, 76, 70],
  [['греч', 'buckwheat'], 'carb', 330, 12, 3, 62, 70],
  [['макарон', 'спагет', 'паста', 'pasta', 'spaghetti'], 'carb', 350, 12, 2, 71, 80],
  [['картопл', 'potato'], 'carb', 77, 2, 0, 17, 250],
  [['булгур', 'bulgur'], 'carb', 340, 12, 1, 70, 70],
  [['кус', 'couscous'], 'carb', 360, 13, 1, 72, 70],
  [['перлов', 'пшен', 'ячн'], 'carb', 330, 10, 1, 70, 70],
  [['хліб', 'bread'], 'carb', 240, 9, 3, 45, 80],
  [['помідор', 'томат', 'tomato'], 'veg', 20, 1, 0, 4, 150],
  [['огір', 'cucumber'], 'veg', 15, 1, 0, 3, 150],
  [['капуст', 'cabbage'], 'veg', 27, 2, 0, 5, 150],
  [['морк', 'carrot'], 'veg', 35, 1, 0, 8, 100],
  [['броколі', 'broccoli'], 'veg', 34, 3, 0, 7, 150],
  [['болгар', 'pepper'], 'veg', 27, 1, 0, 6, 120],
  [['цукін', 'кабач', 'zucchini'], 'veg', 17, 1, 0, 3, 150],
  [['шпинат', 'spinach'], 'veg', 23, 3, 0, 4, 80],
  [['салат', 'lettuce'], 'veg', 15, 1, 0, 3, 80],
  [['буряк', 'beet'], 'veg', 43, 2, 0, 10, 120],
];
// назва продукту з чека без ваги, відсотків і цифр: «ФІЛЕ КУРЯЧЕ 1КГ» → «філе куряче»
const shortName = (n) => words(n).slice(0, 2).join(' ');

function plateParts(products) {
  const parts = { prot: [], carb: [], veg: [] };
  for (const p of products) {
    const ws = words(p.name);
    const f = FOOD.find(([keys]) => ws.some((w) => keys.some((k) => norm(w).startsWith(k))));
    if (!f) continue;
    const [, grp, kcal, pr, fat, carb, g] = f;
    if (!parts[grp].some((x) => x.name === shortName(p.name))) parts[grp].push({ name: shortName(p.name), kcal, p: pr, f: fat, c: carb, g, grp });
  }
  return parts;
}

// k — порядковий номер тарілки: білки, гарніри й овочі чергуються, щоб страви не повторювались
function makePlate(parts, k, type) {
  if (!parts.prot.length || !(parts.carb.length || parts.veg.length)) return null;
  const pick = (arr, i) => (arr.length ? arr[i % arr.length] : null);
  const items = [pick(parts.prot, k), pick(parts.carb, k + (type === 'dinner' ? 1 : 0)), pick(parts.veg, k), pick(parts.veg, k + 1)]
    .filter((x, i, a) => x && a.indexOf(x) === i);
  const sum = (key) => Math.round(items.reduce((a, x) => a + x[key] * x.g / 100, 0));
  const steps = items.map((x) => (x.grp === 'prot' ? T('Запечи або обсмаж {x} до готовності (12–15 хв)', { x: x.name })
    : x.grp === 'carb' ? T('Відвари {x} до готовності', { x: x.name }) : T('Наріж {x} на салат', { x: x.name })));
  return {
    type, name: `${T('Тарілка')}: ${items.map((x) => x.name).join(' · ')}`,
    kcal: sum('kcal'), p: sum('p'), f: sum('f'), c: sum('c'),
    ing: items.map((x) => `${x.name} — ${x.g} ${T('г')}${x.grp === 'carb' && x.g <= 80 ? ` (${T('сухої ваги')})` : ''}`),
    steps: [...steps, T('Посоли, поперчи, додай ложку олії до овочів')],
  };
}

/**
 * Меню з вбудованих рецептів. recipes — allRecipes(lang) (вбудовані з перекладом; власні відкидаємо).
 * Повертає { days, buy, source:'local' } або кидає Error('few-products').
 */
export function planLocal({ products, days, extra, recipes }) {
  const prodWords = products.map((p) => words(p.name));
  const byId = new Map(recipes.filter((r) => !r.own).map((r) => [r.id, r]));
  // покриття кожного рецепта: які «не базові» інгредієнти є, яких бракує
  const info = RECIPES.map((base) => {
    const r = byId.get(base.id) || base;
    const miss = [];
    let need = 0;
    base.ing.forEach((ingUk, i) => {
      if (PANTRY.test(core(ingUk))) return;
      need++;
      const tr = r.ing && r.ing[i] ? r.ing[i] : ingUk;
      if (!matches(prodWords, ingUk) && !matches(prodWords, tr)) miss.push(core(tr));
    });
    return { r, base, need, miss, cov: need ? (need - miss.length) / need : 0 };
  }).filter((x) => x.need > 0);

  const ok = (x) => x.miss.length === 0 || (extra && x.cov >= 0.5 && x.miss.length <= 2);
  const used = new Map();
  const out = [];
  const parts = plateParts(products);
  let plateN = 0;
  for (let d = 0; d < days; d++) {
    const meals = [];
    const today = new Set();
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
      const cand = info
        .filter((x) => SLOT_CATS[slot].includes(x.base.cat) && ok(x) && !today.has(x.base.id))
        .map((x) => ({ x, score: x.cov * 10 - (used.get(x.base.id) || 0) * 4 - x.miss.length * 2 + ((x.base.id.length * 7 + d * 3) % 5) * 0.1 }))
        .sort((a, b) => b.score - a.score);
      // обід / вечеря: якщо рецепта немає або він уже був — «тарілка» з того, що є
      if ((slot === 'lunch' || slot === 'dinner') && (!cand.length || used.get(cand[0].x.base.id))) {
        const pl = makePlate(parts, plateN, slot);
        if (pl) { plateN++; meals.push(pl); continue; }
      }
      if (!cand.length) continue;
      const { x } = cand[0];
      today.add(x.base.id);
      used.set(x.base.id, (used.get(x.base.id) || 0) + 1);
      meals.push({ type: slot, name: x.r.name, kcal: x.base.kcal, p: x.base.p, f: x.base.f, c: x.base.c,
        ing: x.r.ing || x.base.ing, steps: x.r.steps || x.base.steps, rid: x.base.id, miss: x.miss });
    }
    out.push({ meals });
  }
  if (!out.some((d) => d.meals.length)) throw new Error('few-products');

  // «докупити»: спершу те, чого бракує для страв у меню, потім — що відкриє найбільше нових рецептів
  const buy = new Map();
  for (const d of out) for (const m of d.meals) for (const n of m.miss || []) {
    const k = n.toLowerCase();
    if (!buy.has(k)) buy.set(k, { name: n, why: '', dishes: new Set() });
    buy.get(k).dishes.add(m.name);
  }
  const unlock = new Map();
  for (const x of info) {
    if (x.miss.length !== 1 || x.cov < 0.5) continue;
    const k = x.miss[0].toLowerCase();
    if (!unlock.has(k)) unlock.set(k, { name: x.miss[0], n: 0 });
    unlock.get(k).n++;
  }
  const extraBuy = [...unlock.entries()].filter(([k]) => !buy.has(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  const list = [
    ...[...buy.values()].map((b) => ({ name: b.name, dishes: [...b.dishes].slice(0, 2), kind: 'need' })),
    ...extraBuy.map(([, u]) => ({ name: u.name, n: u.n, kind: 'unlock' })),
  ].slice(0, 10);
  for (const d of out) for (const m of d.meals) delete m.miss;
  return { days: out, buy: list, source: 'local', created: Date.now() };
}
