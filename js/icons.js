// icons.js — власні іконки Gym Log замість системних емодзі (11.10.2026).
// Емодзі в текстах лишаються (так їх простіше писати й перекладати), а на екрані їх
// підміняє MutationObserver: кожен текстовий вузол із відомим емодзі ділиться на текст + <svg class="ic">.
// Малюнки — js/icons-data.js (збирається з tools/icons/src/*.json скриптом tools/icons/build.py).
// Новий емодзі в інтерфейсі — додати сюди в EMOJI (інакше лишиться системним).
import { SVG } from './icons-data.js';

// емодзі → 'назва[:тон]'; тон фарбує іконку (warn / ok / bad / gold / like), без тону — колір акценту теми
const EMOJI = {
  // тренування й тіло
  '💪': 'muscle', '🏋': 'dumbbell', '🏋‍♀': 'dumbbell', '🏋‍♂': 'barbell', '🔔': 'kettlebell', '🤸': 'bodyweight',
  '🦵': 'leg', '🪨': 'back', '🏃': 'run', '🚴': 'bike', '🏊': 'swim', '🧎': 'kneel', '🤾': 'bodyweight',
  '🥊': 'boxing', '🧗': 'climb', '🧘': 'stretch', '🧘‍♀': 'stretch', '🔥': 'flame:warn', '⚡': 'bolt:gold',
  '🎯': 'target', '🏆': 'trophy:gold', '⏱': 'timer', '🏁': 'finish', '📏': 'ruler', '⚖': 'scale', '🌱': 'sprout:ok',
  '🌿': 'sprout:ok', '🌸': 'flower', '🌺': 'flower', '🧠': 'brain', '♡': 'heart', '♥': 'heart:like', '😴': 'moon',
  '🌞': 'sun:gold', '⛰': 'mountain', '🧩': 'puzzle', '↕': 'arrows-v', '🔀': 'shuffle', '🧑‍🏫': 'coach',
  // інтерфейс
  '⚠': 'warn:warn', '✅': 'check-circle:ok', '🚫': 'ban:bad', '📅': 'calendar', '🗓': 'calendar', '📆': 'calendar',
  '📋': 'clipboard', '🗑': 'trash', '💬': 'chat', '💊': 'pill', '📈': 'chart-up', '📉': 'chart-down', '📊': 'chart-bar',
  '👥': 'users', '👤': 'user', '🎉': 'party:gold', '✨': 'sparkle:gold', '📷': 'camera', '📸': 'camera', '🤳': 'camera',
  '🖼': 'image', '📹': 'video', '🎥': 'video', '📖': 'book', '📘': 'book', '📚': 'book', '🔎': 'search', '🔍': 'search',
  '🗂': 'folder', '👍': 'thumbs-up', '🤖': 'bot', '⚙': 'gear', '💡': 'bulb:gold', '✉': 'mail', '📧': 'mail',
  '📮': 'mail', '📭': 'mail', '📤': 'upload', '📥': 'download', '⬇': 'download', '⬆': 'upload', '➕': 'plus',
  '🧾': 'receipt', '🎁': 'gift:gold', '🏠': 'home', '🏢': 'building', '🔒': 'lock', '🔑': 'key', '🟢': 'dot:ok',
  '🟡': 'dot:gold', '🔴': 'dot:bad', '🟥': 'dot:bad', '🚩': 'flag:bad', '🕒': 'clock', '⏳': 'hourglass', '🛒': 'cart',
  '🧺': 'cart', '💧': 'drop', '💉': 'syringe', '💾': 'save', '🔁': 'repeat', '🔄': 'repeat', '📌': 'pin', '📍': 'pin',
  '🔊': 'sound', '📳': 'vibrate', '🎵': 'music', '📱': 'phone', '📞': 'phone', '➡': 'arrow-right', '↩': 'undo',
  '👀': 'eye', '👋': 'hand', '🙌': 'hand', '🏷': 'tag', '🐞': 'bug', '💳': 'card', '✏': 'edit', '🛎': 'bell',
  '▶': 'play', '⏸': 'pause', '⏹': 'stop', '🧰': 'tools', '🧴': 'bottle', '🥄': 'spoon', '👨‍🍳': 'chef',
  '👩‍🍳': 'chef', '🍽': 'plate',
  // їжа
  '🍎': 'apple', '🍏': 'apple', '🍳': 'egg', '🥚': 'egg', '🍗': 'meat', '🥩': 'meat', '🍖': 'meat', '🍢': 'meat',
  '🐟': 'fish', '🐠': 'fish', '🍤': 'fish', '🍣': 'fish', '🥕': 'carrot', '🥔': 'carrot', '🍠': 'carrot', '🎃': 'carrot',
  '🥒': 'leafy', '🥬': 'leafy', '🥦': 'leafy', '🥗': 'salad', '🍅': 'pepper', '🌶': 'pepper', '🫑': 'pepper',
  '🥣': 'bowl', '🍚': 'bowl', '🍝': 'bowl', '🍜': 'bowl', '🍛': 'bowl', '🍲': 'bowl', '🥘': 'bowl', '🍱': 'bowl',
  '🍥': 'bowl', '🥞': 'dessert', '🧁': 'dessert', '🍰': 'dessert', '🍮': 'dessert', '🍪': 'dessert', '🍫': 'dessert',
  '🍨': 'dessert', '🍯': 'dessert', '🫐': 'fruit', '🍓': 'fruit', '🍑': 'fruit', '🥭': 'fruit', '🥝': 'fruit',
  '🥑': 'fruit', '🍌': 'banana', '🥜': 'nut', '🥛': 'glass', '🥤': 'glass', '☕': 'cup', '🥪': 'sandwich',
  '🍔': 'sandwich', '🌯': 'sandwich', '🌮': 'sandwich', '🥙': 'sandwich', '🧆': 'sandwich', '🧀': 'cheese',
};

const VS = String.fromCharCode(0xfe0f); // variation selector-16 (емодзі-вигляд)
const strip = (s) => s.split(VS).join('');
// ZWJ-ланцюжки (невидимий U+200D легко загубити при редагуванні — збираємо кодом)
const ZWJ = String.fromCharCode(0x200d);
const zw = (...cps) => cps.map((c) => String.fromCodePoint(c)).join(ZWJ);
Object.assign(EMOJI, {
  [zw(0x1f3cb, 0x2642)]: 'barbell', [zw(0x1f3cb, 0x2640)]: 'dumbbell', [zw(0x1f9d8, 0x2640)]: 'stretch',
  [zw(0x1f9d1, 0x1f3eb)]: 'coach', [zw(0x1f468, 0x1f373)]: 'chef', [zw(0x1f469, 0x1f373)]: 'chef',
});
for (const k of Object.keys(EMOJI)) if (k !== strip(k)) { EMOJI[strip(k)] = EMOJI[k]; delete EMOJI[k]; }
// регулярка: найдовші ланцюжки першими (🏋+ZWJ+♂ раніше за 🏋); після кожного символу може стояти U+FE0F
const esc = (cp) => cp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SRC = Object.keys(EMOJI)
  .sort((a, b) => [...b].length - [...a].length)
  .map((k) => [...k].map((cp) => esc(cp) + VS + '?').join(''))
  .join('|');
const RE = new RegExp(SRC, 'gu'); // для matchAll / replace
const HAS = new RegExp(SRC, 'u'); // для перевірки (без lastIndex)

export function hasIcon(name) {
  return !!SVG[name];
}
/** <svg> іконки рядком (для шаблонів). */
export function icon(name, cls = '') {
  const body = SVG[name];
  if (!body) return '';
  return `<svg class="ic ic-${name}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
/** Емодзі → рядок <svg> (або сам емодзі, якщо іконки немає). */
export function emojiIcon(e) {
  const v = EMOJI[strip(String(e || ''))];
  if (!v) return e;
  const [name, tone] = v.split(':');
  return icon(name, tone ? 't-' + tone : '') || e;
}

// --- підміна в DOM ---
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'TITLE', 'NOSCRIPT']);
// чужий текст (повідомлення, дописи, опис профілю) лишаємо як є
const NO_ICON = '[data-noicon], .bubble, .post-cap, .profile-bio, svg';
const cache = new Map();
function svgNode(key) {
  let n = cache.get(key);
  if (!n) {
    const t = document.createElement('template');
    t.innerHTML = emojiIcon(key);
    n = t.content.firstChild;
    cache.set(key, n);
  }
  return n.cloneNode(true);
}
function skipNode(el) {
  return !el || SKIP.has(el.nodeName) || el.isContentEditable || (el.closest && el.closest(NO_ICON));
}
function swapText(tn) {
  const s = tn.nodeValue;
  if (!s || !HAS.test(s)) return;
  const parent = tn.parentNode;
  if (!parent || skipNode(parent)) return;
  if (parent.nodeName === 'OPTION') { // у <select> svg не показати — прибираємо емодзі
    tn.nodeValue = s.replace(RE, '').replace(/^\s+/, '');
    return;
  }
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of s.matchAll(RE)) {
    if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
    frag.appendChild(svgNode(strip(m[0])));
    last = m.index + m[0].length;
  }
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  parent.replaceChild(frag, tn);
}
export function iconize(root) {
  if (!root) return;
  if (root.nodeType === 3) return swapText(root);
  if (root.nodeType !== 1 || skipNode(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (HAS.test(n.nodeValue)) list.push(n);
  for (const n of list) swapText(n);
}
/** Запустити підміну для всього документа (раз, на старті). */
export function startIcons() {
  iconize(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') swapText(m.target);
      else for (const n of m.addedNodes) iconize(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
