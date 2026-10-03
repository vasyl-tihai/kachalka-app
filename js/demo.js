// demo.js — вітрина Спільноти, поки справжніх людей мало: офіційні акаунти КАЧАЛКИ
// і ПРИКЛАДИ профілів (позначені «Приклад профілю», не видаються за реальних людей).
// Фото — img/social/<id>.webp (згенеровані); нема файлу — показується градієнт з емодзі.
// Нічого не пише на сервер. Вантажиться ліниво (import).
import { dateToISO } from './store.js';

// запасна «картинка», якщо фото ще не завантажилось / немає
export function fallbackImg(emoji, a = '#1a2b5e', b = '#0b1023') {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='1000' viewBox='0 0 800 1000'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs>
    <rect width='800' height='1000' fill='url(#g)'/>
    <text x='400' y='560' font-size='200' text-anchor='middle'>${emoji}</text>
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
const pic = (id) => `img/social/${id}.webp`;

export function demoData() {
  // official — акаунти самого застосунку; sample — приклад профілю (з позначкою)
  const people = [
    { id: 'kachalka-coach', name: 'Тренер КАЧАЛКИ', city: '', role: 'trainer', official: true, avatar_url: 'icons/icon-192.png' },
    { id: 'kachalka-kitchen', name: 'Кухня КАЧАЛКИ', city: '', role: 'kitchen', official: true, avatar_url: 'icons/icon-192.png' },
    { id: 'sample-t1', name: 'Андрій', city: 'Київ', role: 'trainer', sample: true, avatar_url: pic('sample-t1') },
    { id: 'sample-t2', name: 'Оксана', city: 'Львів', role: 'trainer', sample: true, avatar_url: pic('sample-t2') },
    { id: 'sample-t3', name: 'Олег', city: 'Одеса', role: 'trainer', sample: true, avatar_url: pic('sample-t3') },
    { id: 'sample-t4', name: 'Марта', city: 'Дніпро', role: 'trainer', sample: true, avatar_url: pic('sample-t4') },
    { id: 'sample-a1', name: 'Ірина', city: 'Харків', role: 'client', sample: true, avatar_url: pic('sample-a1') },
    { id: 'sample-a2', name: 'Тарас', city: 'Вінниця', role: 'client', sample: true, avatar_url: pic('sample-a2') },
  ];
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  const bios = {
    'kachalka-coach': 'Офіційний акаунт КАЧАЛКИ: техніка вправ, відновлення, прості плани для залу й дому.',
    'kachalka-kitchen': 'Офіційний акаунт КАЧАЛКИ: 100 рецептів з калоріями й БЖВ — у розділі «Рецепти».',
    'sample-t1': 'Так може виглядати профіль тренера: силові, 8 років досвіду, ранкові групи 💪',
    'sample-t2': 'Приклад профілю тренерки: жіночі групи, техніка з нуля, без страху перед залізом 🙌',
    'sample-t3': 'Приклад профілю: функціональний тренінг і кросфіт, перше заняття безкоштовно 🔥',
    'sample-t4': 'Приклад профілю: мобільність, розтяжка, відновлення після травм.',
    'sample-a1': 'Приклад профілю атлета: пів року в залі, ціль — присід 70 кг.',
    'sample-a2': 'Приклад профілю атлета: пауерліфтинг-аматор, станова — моя любов.',
  };

  // [id, автор, підпис, годин тому, емодзі запасного фото]
  const raw = [
    ['coach-squat', 'kachalka-coach', 'Присід: стопи на ширині плечей, коліна йдуть за носками, спина нейтральна. Глибина — до паралелі або нижче, якщо дозволяє мобільність.', 1, '🏋️'],
    ['sample-t2-p1', 'sample-t2', 'Ранкова жіноча група — техніка румунської тяги 🙌', 3, '💪'],
    ['coach-rest', 'kachalka-coach', 'Відпочинок між підходами: 1–2 хв на легкі вправи, 2–4 хв на важкі базові. Таймер у застосунку підкаже сам.', 5, '⏱'],
    ['sample-a1-p1', 'sample-a1', 'Нарешті 60 кг у присіді! Пів року роботи 🔥', 8, '🏋️‍♀️'],
    ['sample-t1-p1', 'sample-t1', 'Жим лежачи: лопатки зведені, ноги в підлогу, гриф — на нижню частину грудей.', 11, '💪'],
    ['coach-plank', 'kachalka-coach', 'Планка: тіло — одна лінія, сідниці напружені, дихай рівно. Краще 3×30 с правильно, ніж 2 хв із провисанням.', 20, '🧘'],
    ['sample-t3-p1', 'sample-t3', 'Субота — функціональне коло: гирі, канати, скакалка 🔥', 26, '🔥'],
    ['sample-a2-p1', 'sample-a2', 'День спини. Станова 140×3 — новий рекорд 🏆', 30, '🏆'],
    ['coach-mealprep', 'kachalka-coach', 'Їжа на 3 дні за годину: крупа, запечене м’ясо, овочі. Рецепти з калоріями — у розділі «Рецепти».', 40, '🍱'],
    ['sample-t4-p1', 'sample-t4', 'Після тренування — 10 хвилин мобільності для стегон і грудного відділу.', 48, '🧘‍♀️'],
    ['sample-t1-p2', 'sample-t1', 'Новенькі в групі — перше заняття завжди з легкою вагою і відео техніки.', 60, '🏋️'],
    ['coach-water', 'kachalka-coach', 'Вода: 30–35 мл на кг ваги, у дні тренувань більше. Спрага — вже запізнення.', 70, '💧'],
    ['sample-t2-p2', 'sample-t2', 'Гантелі, гумки й килимок — цього досить для повноцінного тренування вдома.', 80, '🏠'],
    ['sample-t3-p2', 'sample-t3', 'Махи гирею: рух іде від стегон, не від рук.', 96, '🔔'],
  ];
  const posts = raw.map(([id, author_id, caption, h, emoji]) => ({
    id, author_id, caption, created_at: hoursAgo(h), photo_url: pic(id), fallback: fallbackImg(emoji),
    photo_path: '', author: byId[author_id],
  }));

  // «як людина тренується» — тренування прикладів профілів
  const sets = (n) => Array.from({ length: n }, () => ({ reps: 10, weight: 0 }));
  const shared = {
    'sample-a1': { data: {
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
    'sample-a2': { data: {
      [dayISO(1)]: [
        { name: 'Станова тяга', weightType: 'barbell', sets: sets(5) },
        { name: 'Підтягування', weightType: 'bodyweight', sets: sets(4) },
      ],
      [dayISO(2)]: [
        { name: 'Жим стоячи', weightType: 'barbell', sets: sets(4) },
        { name: 'Згинання гантель на біцепс', weightType: 'dumbbell', sets: sets(4) },
      ],
    } },
  };

  // вільні слоти прикладів тренерів (на завтра)
  const slots = {
    'sample-t1': [
      { id: 'ds1', starts_at: tomorrowAt(9), duration_min: 60, status: 'free' },
      { id: 'ds2', starts_at: tomorrowAt(18), duration_min: 90, status: 'free' },
    ],
    'sample-t2': [{ id: 'ds3', starts_at: tomorrowAt(10), duration_min: 60, status: 'free' }],
    'sample-t3': [{ id: 'ds4', starts_at: tomorrowAt(19), duration_min: 60, status: 'free' }],
  };

  return { people, byId, bios, posts, shared, slots };
}
