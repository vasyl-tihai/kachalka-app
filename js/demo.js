// demo.js — демо-дані для Спільноти: показати, як виглядатиме стрічка з людьми.
// Нічого не пише на сервер: вигадані люди, дописи-картинки (SVG data-URI),
// тренування і слоти. Вантажиться ліниво (import) лише в демо-режимі.
import { dateToISO } from './store.js';

// «фото» допису: стильна картка-градієнт з великим емодзі (працює офлайн)
function img(emoji, a, b) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='520' viewBox='0 0 800 520'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs>
    <rect width='800' height='520' fill='url(#g)'/>
    <circle cx='650' cy='90' r='160' fill='rgba(255,255,255,0.07)'/>
    <circle cx='140' cy='440' r='210' fill='rgba(0,0,0,0.18)'/>
    <text x='400' y='305' font-size='180' text-anchor='middle'>${emoji}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg).replace(/'/g, '%27');
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const dayISO = (daysBack) => dateToISO(new Date(Date.now() - daysBack * 86400e3));
const tomorrowAt = (hh) => {
  const d = new Date(Date.now() + 86400e3);
  d.setHours(hh, 0, 0, 0);
  return d.toISOString();
};

export function demoData() {
  const people = [
    { id: 'demo-1', name: 'Андрій Коваль', city: 'Київ', role: 'trainer', avatar_url: null },
    { id: 'demo-2', name: 'Марина Шевчук', city: 'Львів', role: 'client', avatar_url: null },
    { id: 'demo-3', name: 'Олег Бондаренко', city: 'Одеса', role: 'trainer', avatar_url: null },
    { id: 'demo-4', name: 'Ірина Мельник', city: 'Харків', role: 'client', avatar_url: null },
    { id: 'demo-5', name: 'Тарас Романюк', city: 'Дніпро', role: 'client', avatar_url: null },
    { id: 'demo-6', name: 'Софія Ткаченко', city: 'Київ', role: 'client', avatar_url: null },
    { id: 'demo-7', name: 'Максим Гриценко', city: 'Львів', role: 'client', avatar_url: null },
    { id: 'demo-8', name: 'Оксана Лисенко', city: 'Вінниця', role: 'trainer', avatar_url: null },
  ];
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  const bios = {
    'demo-1': 'Тренер із силових, 8 років досвіду. Набираю ранкову групу початківців 💪',
    'demo-3': 'Кросфіт і функціоналка. Перше тренування — безкоштовно 🔥',
    'demo-8': 'Тренерка. Жіночі групи, техніка з нуля, без страху перед залізом 🙌',
    'demo-2': 'Пів року в залі. Ціль — присід 70 кг!',
    'demo-5': 'Пауерліфтинг-аматор. Станова — моя любов.',
  };

  const posts = [
    { id: 'dp1', author_id: 'demo-2', caption: 'Нарешті присіла 60 кг! Пів року роботи 🔥', created_at: hoursAgo(2), photo_url: img('🏋️‍♀️', '#1a2b5e', '#0b1023') },
    { id: 'dp2', author_id: 'demo-1', caption: 'Ранкова група відпрацювала на всі 💯. Пишаюсь кожним!', created_at: hoursAgo(4), photo_url: img('💪', '#123c2e', '#07130d') },
    { id: 'dp3', author_id: 'demo-5', caption: 'День спини. Станова 120×5 — новий рекорд 🏆', created_at: hoursAgo(7), photo_url: img('🏆', '#4a3208', '#171004') },
    { id: 'dp4', author_id: 'demo-6', caption: 'Перше тренування після перерви — важко, але я повернулась 🙌', created_at: hoursAgo(9), photo_url: img('⚡', '#3b1a5e', '#12081f') },
    { id: 'dp5', author_id: 'demo-3', caption: 'Субота — день ніг 🦵 Хто зі мною завтра о 9:00?', created_at: hoursAgo(12), photo_url: img('🦵', '#5e2a1a', '#1f0d08') },
    { id: 'dp6', author_id: 'demo-4', caption: 'Кардіо + прес. Мінус 3 кг за місяць 🎉', created_at: hoursAgo(26), photo_url: img('🤸', '#14444d', '#071518') },
    { id: 'dp7', author_id: 'demo-7', caption: 'Новий зал — нові рекорди 😤', created_at: hoursAgo(31), photo_url: img('🔥', '#5e1a3a', '#1f0812') },
  ].map((p) => ({ ...p, photo_path: '', author: byId[p.author_id] }));

  // «як людина тренується» — публічні тренування декого з демо-людей
  const sets = (n) => Array.from({ length: n }, () => ({ reps: 10, weight: 0 }));
  const shared = {
    'demo-2': { data: {
      [dayISO(1)]: [
        { name: 'Присідання із вагою', weightType: 'barbell', sets: sets(4) },
        { name: 'Жим гантель лежачи', weightType: 'dumbbell', sets: sets(4) },
        { name: 'Прес', weightType: 'bodyweight', sets: sets(3) },
      ],
      [dayISO(3)]: [
        { name: 'Станова тяга', weightType: 'barbell', sets: sets(4) },
        { name: 'Тяга гантель в нахилі', weightType: 'dumbbell', sets: sets(4) },
      ],
    } },
    'demo-5': { data: {
      [dayISO(1)]: [
        { name: 'Станова тяга', weightType: 'barbell', sets: sets(5) },
        { name: 'Підтягування', weightType: 'bodyweight', sets: sets(4) },
      ],
      [dayISO(2)]: [
        { name: 'Жим стоячи', weightType: 'barbell', sets: sets(4) },
        { name: 'Згинання гантель на біцепс', weightType: 'dumbbell', sets: sets(4) },
      ],
      [dayISO(4)]: [
        { name: 'Присідання із вагою', weightType: 'barbell', sets: sets(5) },
      ],
    } },
    'demo-1': { data: {
      [dayISO(2)]: [
        { name: 'Жим гантель лежачи', weightType: 'dumbbell', sets: sets(4) },
        { name: 'Віджимання', weightType: 'bodyweight', sets: sets(4) },
      ],
    } },
  };

  // вільні слоти демо-тренерів (на завтра)
  const slots = {
    'demo-1': [
      { id: 'ds1', starts_at: tomorrowAt(9), duration_min: 60, status: 'free' },
      { id: 'ds2', starts_at: tomorrowAt(11), duration_min: 60, status: 'free' },
      { id: 'ds3', starts_at: tomorrowAt(18), duration_min: 90, status: 'free' },
    ],
    'demo-3': [
      { id: 'ds4', starts_at: tomorrowAt(9), duration_min: 60, status: 'free' },
      { id: 'ds5', starts_at: tomorrowAt(19), duration_min: 60, status: 'free' },
    ],
    'demo-8': [
      { id: 'ds6', starts_at: tomorrowAt(10), duration_min: 60, status: 'free' },
    ],
  };

  return { people, byId, bios, posts, shared, slots };
}
