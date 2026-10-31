// backend.js — робота із сервером (Supabase): акаунти, профілі.
// Бібліотека вантажиться ліниво (лише коли відкрито «Кабінет тренера»),
// тож офлайн-щоденник стартує швидко і без мережі, як і раніше.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './backend-config.js';

export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let _sb = null;
async function client() {
  if (!configured) return null;
  if (!_sb) {
    const { createClient } = await import('../vendor/supabase/supabase.mjs');
    _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // PKCE: повернення з Google приходить як ?code=... у query (не конфліктує
      // з нашим hash-роутингом) і обмінюється на сесію автоматично
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
    });
  }
  return _sb;
}

// ---- сесія ----
export async function getSession() {
  const sb = await client();
  if (!sb) return null;
  const { data, error } = await sb.auth.getSession();
  if (error) return null;
  return data.session || null;
}

/**
 * Заголовки для викликів Edge Functions (/functions/v1/…): apikey + Authorization: Bearer <JWT користувача>,
 * якщо він увійшов в акаунт. Без входу Authorization немає — функція відповість 401 {error:'auth'}.
 */
export async function functionHeaders() {
  const h = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  try {
    const s = await getSession();
    if (s && s.access_token) h.Authorization = 'Bearer ' + s.access_token;
  } catch (e) { /* без сесії — запит піде без Authorization */ }
  return h;
}

/** Чи є підписка за даними сервера (покупка в Play або тестова підписка, видана SQL): true / false; null — без входу чи сервера. */
export async function hasPremium() {
  const sb = await client();
  if (!sb || !(await getSession())) return null;
  const { data, error } = await sb.rpc('has_premium');
  return error ? null : data === true;
}

export async function signUp(email, password, name) {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) throw new Error(uaAuthError(error));
  return data;
}

export async function signIn(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(uaAuthError(error));
  return data;
}

// лист для відновлення пароля (посилання веде назад у застосунок)
export async function resetPassword(email) {
  const sb = await client();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw new Error(uaAuthError(error));
}

export async function signOut() {
  const sb = await client();
  if (sb) await sb.auth.signOut();
}

// ---- вхід через Google ----
export async function signInWithGoogle() {
  const sb = await client();
  // перевірити на сервері, чи увімкнений Google-провайдер (CORS-friendly endpoint)
  try {
    const st = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    }).then((r) => r.json());
    if (st && st.external && st.external.google === false) {
      throw new Error(uaAuthError({ message: 'provider is not enabled' }));
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Google')) throw e;
    // якщо перевірка не вдалася (офлайн тощо) — не блокуємо, пробуємо перехід
  }
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    // повернутись саме на цю сторінку застосунку (працює і на GitHub Pages)
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(uaAuthError(error));
}

// обробка повернення з Google (?code=... в URL): ініціалізація клієнта
// сама обмінює код на сесію; повертає true, якщо вхід відбувся
export async function handleOAuthReturn() {
  const sb = await client();
  if (!sb) return false;
  try {
    const { data } = await sb.auth.getSession();
    return !!(data && data.session);
  } catch {
    return false;
  }
}

// ---- профіль ----
export async function getMyProfile() {
  const sb = await client();
  const session = await getSession();
  if (!sb || !session) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) throw new Error(error.message);
  // місце, зал, видимість — в окремій приватній таблиці (backend/patch-8-community-security.sql)
  const { data: pl } = await sb.from('profile_place').select('region,district,train_at,gym_id,place_vis,discoverable,stats')
    .eq('id', session.user.id).maybeSingle();
  return { ...data, ...(pl || {}) };
}

// поля місця йдуть у profile_place (бачить лише власник), решта — у profiles
const PLACE_KEYS = ['region', 'district', 'train_at', 'gym_id', 'place_vis', 'discoverable', 'stats'];
export async function saveMyProfile(patch) {
  const sb = await client();
  const session = await getSession();
  if (!sb || !session) throw new Error('Немає сесії');
  const base = {}, place = {};
  for (const [k, v] of Object.entries(patch)) (PLACE_KEYS.includes(k) ? place : base)[k] = v;
  if (Object.keys(base).length) {
    const { error } = await sb.from('profiles').update(base).eq('id', session.user.id);
    if (error) throw new Error(error.message);
  }
  if (Object.keys(place).length) {
    const { error } = await sb.from('profile_place').upsert({ id: session.user.id, ...place });
    if (error) throw new Error(error.message);
  }
}

// ---- послуги тренера ----
export async function listServices(trainerId) {
  const sb = await client();
  const { data, error } = await sb
    .from('trainer_services')
    .select('*')
    .eq('trainer_id', trainerId)
    .eq('is_active', true)
    .order('id');
  if (error) throw new Error(error.message);
  return data || [];
}
export async function addService({ title, price, duration_min }) {
  const sb = await client();
  const s = await getSession();
  const { error } = await sb.from('trainer_services').insert({
    trainer_id: s.user.id,
    title,
    price: Number(price) || 0,
    duration_min: Number(duration_min) || 60,
  });
  if (error) throw new Error(error.message);
}
export async function deleteService(id) {
  const sb = await client();
  const { error } = await sb.from('trainer_services').update({ is_active: false }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- слоти тренера ----
export async function listSlots(trainerId, fromISO) {
  const sb = await client();
  let q = sb.from('trainer_slots').select('*').eq('trainer_id', trainerId).order('starts_at');
  if (fromISO) q = q.gte('starts_at', fromISO);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}
export async function addSlot(startsAtISO, durationMin) {
  const sb = await client();
  const s = await getSession();
  const { error } = await sb.from('trainer_slots').insert({
    trainer_id: s.user.id,
    starts_at: startsAtISO,
    duration_min: Number(durationMin) || 60,
  });
  if (error) throw new Error(error.code === '23505' ? 'Слот на цей час уже є' : error.message);
}
export async function deleteSlot(id) {
  const sb = await client();
  const { error } = await sb.from('trainer_slots').delete().eq('id', id).eq('status', 'free');
  if (error) throw new Error(error.message);
}

// ---- тренери (каталог) ----
export async function listTrainers() {
  const sb = await client();
  const { data, error } = await sb
    .from('profiles')
    .select('id,name,city,bio,contact,avatar_url')
    .eq('role', 'trainer')
    .order('name');
  if (error) throw new Error(error.message);
  return data || [];
}

// ---- спільнота: всі люди (для стрічки і каталогу) ----
export async function listPeople() {
  const sb = await client();
  const { data, error } = await sb
    .from('profiles')
    .select('id,name,city,role,avatar_url')
    .order('name')
    .limit(100);
  if (error) throw new Error(error.message);
  return data || [];
}

// ---- «картки атлета»: публічний вигляд профілів (backend/patch-7-community.sql) ----
// місце вже обрізане сервером за налаштуванням людини (place_vis); контакт — лише в тренерів
const CARD_COLS = 'id,name,role,avatar_url,bio,train_at,stats,region,city,district,gym_id,gym_name,gym_city,contact,created_at,place_vis,my_discoverable,discoverable';
// listed = true — лише ті, хто дозволив себе знаходити (тренери — завжди); для друзів і авторів — без цього
export async function listCards({ ids, role, gymId, city, district, region, q, listed, limit = 100 } = {}) {
  const sb = await client();
  let qq = sb.from('profile_cards').select(CARD_COLS).limit(Math.min(limit, 100));
  if (listed) qq = qq.eq('discoverable', true);
  if (ids) { if (!ids.length) return []; qq = qq.in('id', ids.filter(isUUID)); }
  if (role) qq = qq.eq('role', role);
  if (gymId) qq = qq.eq('gym_id', gymId);
  if (city) qq = qq.ilike('city', likeSafe(city));
  if (district) qq = qq.ilike('district', likeSafe(district));
  if (region) qq = qq.ilike('region', likeSafe(region));
  if (q) qq = qq.ilike('name', '%' + likeSafe(q) + '%');
  const { data, error } = await qq.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
export async function getCard(id) {
  const rows = await listCards({ ids: [id], limit: 1 });
  return rows[0] || null;
}
// % і _ у пошуку — буквально
const likeSafe = (v) => String(v || '').trim().slice(0, 60).replace(/\*/g, '').replace(/[\\%_]/g, (c) => '\\' + c);

// свої лічильники для картки (серія, тренувань за місяць, рекорди) — оновлює застосунок
export async function saveMyStats(stats) {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) return;
  const { error } = await sb.from('profile_place').upsert({ id: s.user.id, stats });
  if (error) throw new Error(error.message);
}

// ---- зали ----
export async function getGym(id) {
  const sb = await client();
  if (!sb || !isUUID(id)) return null;
  const { data } = await sb.from('gyms').select('id,name,city,region,district').eq('id', id).maybeSingle();
  return data || null;
}
export async function searchGyms(q, city) {
  const sb = await client();
  let qq = sb.from('gyms').select('id,name,city,region,district').order('name').limit(30);
  if (q) qq = qq.ilike('name', '%' + likeSafe(q) + '%');
  if (city) qq = qq.ilike('city', likeSafe(city));
  const { data, error } = await qq;
  if (error) throw new Error(error.message);
  return data || [];
}
export async function addGym({ name, city, region, district }) {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) throw new Error('auth');
  const row = { name: String(name || '').trim().slice(0, 80), city: String(city || '').trim().slice(0, 60),
    region: String(region || '').trim().slice(0, 60), district: String(district || '').trim().slice(0, 60), created_by: s.user.id };
  const { data, error } = await sb.from('gyms').insert(row).select('id,name,city,region,district').single();
  if (error && error.code === '23505') {
    const found = await searchGyms(row.name, row.city);
    const same = found.find((g) => g.name.toLowerCase() === row.name.toLowerCase());
    if (same) return same;
  }
  if (error) throw new Error(error.code === '42501' ? 'too-many' : error.message);
  return data;
}

// ---- друзі: запит → прийняти; рядок friendships (requester, addressee, status) ----
export async function myFriendships() {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) return [];
  const { data, error } = await sb.from('friendships').select('*');
  if (error) throw new Error(error.message);
  return data || [];
}
export async function requestFriend(userId) {
  if (!isUUID(userId)) throw new Error('bad id');
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) throw new Error('auth');
  const { error } = await sb.from('friendships').insert({ requester: s.user.id, addressee: userId });
  if (error && error.code !== '23505') throw new Error(error.code === '42501' ? 'too-many' : error.message);
}
export async function acceptFriend(userId) {
  if (!isUUID(userId)) throw new Error('bad id');
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) throw new Error('auth');
  const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('requester', userId).eq('addressee', s.user.id);
  if (error) throw new Error(error.message);
}
export async function removeFriend(userId) {
  if (!isUUID(userId)) throw new Error('bad id');
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) throw new Error('auth');
  const me = s.user.id;
  const { error } = await sb.from('friendships').delete()
    .or(`and(requester.eq.${me},addressee.eq.${userId}),and(requester.eq.${userId},addressee.eq.${me})`);
  if (error) throw new Error(error.message);
}

// ---- дописи спільноти: фото / тренування / рекорд / до-після ----
// автора беремо з profile_cards (таблицю profiles чужі не читають); без patch-7 — як раніше
// без authorId рецепти-дописи (kind = 'recipe', patch-10) у загальну стрічку не йдуть — їх показує «Рецепти → Від людей»
export async function listPosts(authorId) {
  const sb = await client();
  const run = (noRecipes) => {
    let q = sb.from('posts').select('*').order('created_at', { ascending: false }).limit(60);
    if (authorId) q = q.eq('author_id', authorId);
    else if (noRecipes) q = q.neq('kind', 'recipe');
    return q;
  };
  let { data, error } = await run(true);
  if (error && !authorId) ({ data, error } = await run(false)); // сервер без колонки kind (до patch-7)
  if (error) throw new Error(error.message);
  return withAuthors(sb, data || []);
}
// стрічка рецептів від людей: kind = 'recipe' (patch-10). Без patch-10 порожньо (рядків такого виду нема)
export async function listRecipePosts() {
  const sb = await client();
  const { data, error } = await sb.from('posts').select('*').eq('kind', 'recipe')
    .order('created_at', { ascending: false }).limit(60);
  if (error) throw new Error(error.message);
  return withAuthors(sb, (data || []).filter((p) => p.meta && typeof p.meta === 'object'));
}
async function withAuthors(sb, posts) {
  const ids = [...new Set(posts.map((p) => p.author_id))];
  let cards = [];
  try { cards = await listCards({ ids, limit: ids.length || 1 }); }
  catch {
    const { data: old } = await sb.from('posts').select('id, author:author_id(name,avatar_url,role)').in('id', posts.map((p) => p.id));
    const by = new Map((old || []).map((r) => [r.id, r.author]));
    posts.forEach((p) => (p.author = by.get(p.id) || {}));
    return posts;
  }
  const by = new Map(cards.map((c) => [c.id, c]));
  posts.forEach((p) => (p.author = by.get(p.author_id) || {}));
  return posts;
}
// blobs — фото допису: один Blob або масив (до MAX_POST_PHOTOS), необовʼязкове для тренування/рекорду;
// kind/meta — тип допису й дані картки. Перше фото дублюється в photo_url (його читає старий клієнт),
// усі — у posts.photos (backend/patch-9-post-photos.sql). Повертає { saved } — скільки фото потрапило в допис.
export const MAX_POST_PHOTOS = 4;
let photosCol = true; // false — сервер ще без patch-9 (колонки posts.photos немає): пишемо лише перше фото
const isNoPhotosColumn = (e) => !!e && (e.code === 'PGRST204' || e.code === '42703' || (/column/i.test(e.message || '') && /photos/.test(e.message || '')));
export async function addPost(blobs, caption, { kind = 'photo', meta = {} } = {}) {
  const sb = await client();
  const s = await getSession();
  if (!s) throw new Error('Немає сесії');
  const list = (Array.isArray(blobs) ? blobs : blobs ? [blobs] : []).filter(Boolean).slice(0, MAX_POST_PHOTOS);
  const stamp = Date.now();
  const paths = [], urls = [];
  const dropFiles = async (ps) => { if (ps.length) { try { await sb.storage.from('posts').remove(ps); } catch {} } };
  try {
    for (let i = 0; i < list.length; i++) {
      const path = `${s.user.id}/${stamp}${list.length > 1 ? '-' + i : ''}.jpg`;
      const { error: upErr } = await sb.storage.from('posts').upload(path, list[i], { contentType: 'image/jpeg' });
      if (upErr) throw new Error(upErr.message);
      paths.push(path);
      urls.push(sb.storage.from('posts').getPublicUrl(path).data.publicUrl);
    }
  } catch (e) { await dropFiles(paths); throw e; }
  const row = { author_id: s.user.id, caption: String(caption || '').slice(0, 300), photo_url: urls[0] || null, photo_path: paths[0] || '' };
  if (kind !== 'photo' || Object.keys(meta).length) Object.assign(row, { kind, meta });
  let saved = urls.length;
  let { error } = await sb.from('posts').insert(photosCol && urls.length ? { ...row, photos: urls } : row);
  if (error && photosCol && urls.length && isNoPhotosColumn(error)) {
    photosCol = false; // patch-9 ще не накочено — допис із першим фото, зайві файли зі сховища прибираємо
    ({ error } = await sb.from('posts').insert(row));
    if (!error) { saved = 1; await dropFiles(paths.slice(1)); }
  }
  if (error) {
    await dropFiles(paths);
    const err = new Error(error.message);
    err.code = error.code; // 23514 — порушення CHECK (напр. kind = 'recipe' до patch-10)
    throw err;
  }
  return { saved };
}
// шляхи файлів допису у сховищі: photo_path + шляхи з адрес у photos (лише з теки автора)
function postFilePaths(post) {
  const out = new Set();
  if (post.photo_path) out.add(post.photo_path);
  for (const u of Array.isArray(post.photos) ? post.photos : []) {
    const m = typeof u === 'string' && u.match(/\/storage\/v1\/object\/public\/posts\/([A-Za-z0-9_.\/-]+)$/);
    if (m && !m[1].includes('..') && m[1].startsWith(post.author_id + '/')) out.add(m[1]);
  }
  return [...out];
}
export async function deletePost(post) {
  const sb = await client();
  const { error } = await sb.from('posts').delete().eq('id', post.id);
  if (error) throw new Error(error.message);
  // фото у сховищі прибираємо теж (не критично, якщо не вдасться)
  const paths = postFilePaths(post);
  if (paths.length) {
    try { await sb.storage.from('posts').remove(paths); } catch {}
  }
}

// ---- лайки й коментарі (backend/patch-6-likes-comments.sql; лічильники — posts.like_count / comment_count) ----
// які з цих дописів я лайкнув
export async function myLikes(postIds) {
  const sb = await client();
  const s = await getSession();
  const ids = (postIds || []).filter(isUUID);
  if (!sb || !s || !ids.length) return new Set();
  const { data, error } = await sb.from('post_likes').select('post_id').eq('user_id', s.user.id).in('post_id', ids);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.post_id));
}
export async function setLike(postId, on) {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) throw new Error('auth');
  const q = on
    ? sb.from('post_likes').insert({ post_id: postId, user_id: s.user.id })
    : sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', s.user.id);
  const { error } = await q;
  if (error && error.code !== '23505') throw new Error(error.message); // 23505 — уже лайкнуто
}
export async function listComments(postId) {
  const sb = await client();
  const { data, error } = await sb
    .from('post_comments')
    .select('id,post_id,author_id,body,created_at, author:author_id(name,avatar_url,role)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return data || [];
}
export async function addComment(postId, body) {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) throw new Error('auth');
  const { error } = await sb.from('post_comments').insert({
    post_id: postId,
    author_id: s.user.id,
    body: String(body || '').trim().slice(0, 500),
  });
  if (error) throw new Error(/too many/.test(error.message) ? 'too-many' : error.message);
}
export async function deleteComment(id) {
  const sb = await client();
  const { error } = await sb.from('post_comments').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- публічні тренування («як я тренуюсь») — вмикає сам користувач ----
export async function shareTraining(dataJson) {
  const sb = await client();
  const s = await getSession();
  const { error } = await sb.from('shared_training').upsert({
    user_id: s.user.id,
    data: dataJson,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
export async function unshareTraining() {
  const sb = await client();
  const s = await getSession();
  const { error } = await sb.from('shared_training').delete().eq('user_id', s.user.id);
  if (error) throw new Error(error.message);
}
export async function mySharedTraining() {
  const sb = await client();
  const s = await getSession();
  if (!s) return null;
  const { data } = await sb
    .from('shared_training')
    .select('user_id,updated_at')
    .eq('user_id', s.user.id)
    .maybeSingle();
  return data || null;
}
export async function sharedTrainingOf(userId) {
  const sb = await client();
  const { data } = await sb
    .from('shared_training')
    .select('data,updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
}

// ---- бронювання ----
export async function bookSlot(slotId, note) {
  const sb = await client();
  const { data, error } = await sb.rpc('book_slot', { p_slot: slotId, p_note: note || '' });
  if (error) throw new Error(uaAuthError(error));
  return data;
}
export async function setBookingStatus(bookingId, status) {
  const sb = await client();
  const { error } = await sb.rpc('set_booking_status', { p_booking: bookingId, p_status: status });
  if (error) throw new Error(uaAuthError(error));
}
// записи, де я тренер (з ім'ям клієнта і часом слота)
export async function bookingsAsTrainer() {
  const sb = await client();
  const s = await getSession();
  const { data, error } = await sb
    .from('bookings')
    .select('*, client:client_id(name,contact), slot:slot_id(starts_at,duration_min)')
    .eq('trainer_id', s.user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
// мої записи як клієнта (з ім'ям тренера)
export async function bookingsAsClient() {
  const sb = await client();
  const s = await getSession();
  const { data, error } = await sb
    .from('bookings')
    .select('*, trainer:trainer_id(name,contact), slot:slot_id(starts_at,duration_min)')
    .eq('client_id', s.user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// ---- аватар (Supabase Storage) ----
export async function uploadAvatar(file) {
  const sb = await client();
  const s = await getSession();
  if (!s) throw new Error('Немає сесії');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${s.user.id}/avatar.${ext}`;
  const { error } = await sb.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`; // антикеш
  await sb.from('profiles').update({ avatar_url: url }).eq('id', s.user.id);
  return url;
}

// ---- чат ----
export async function myId() {
  const s = await getSession();
  return s ? s.user.id : null;
}
// id співрозмовника йде з адреси (#/chat/<id>) у фільтр PostgREST — лише UUID, інакше можна дописати свої умови
const isUUID = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function listMessages(otherId) {
  if (!isUUID(otherId)) return [];
  const sb = await client();
  const s = await getSession();
  const me = s.user.id;
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .or(`and(from_id.eq.${me},to_id.eq.${otherId}),and(from_id.eq.${otherId},to_id.eq.${me})`)
    .order('created_at');
  if (error) throw new Error(error.message);
  return data || [];
}
export async function sendMessage(toId, text) {
  const sb = await client();
  const s = await getSession();
  const { error } = await sb.from('messages').insert({ from_id: s.user.id, to_id: toId, text });
  if (error) throw new Error(error.message);
}
// realtime-підписка на нові повідомлення в розмові з otherId.
// onNew(msg) викликається для кожного вхідного повідомлення від співрозмовника.
// Повертає { destroy } — відписатися при виході з екрана чату.
export async function subscribeMessages(otherId, onNew) {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) return { destroy() {} };
  const me = s.user.id;
  // Realtime фільтрує рядки за RLS-правилами токена — передати токен явно,
  // щоб не залежати від того, чи встиг спрацювати авто-setAuth клієнта
  sb.realtime.setAuth(s.access_token);
  const ch = sb
    // унікальний суфікс: повторний вхід у чат не конфліктує зі старим каналом,
    // який ще не встиг закритися
    .channel(`chat-${[me, otherId].sort().join('-')}-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_id=eq.${me}` },
      (p) => {
        if (p.new && p.new.from_id === otherId) onNew(p.new);
      }
    )
    .subscribe();
  return {
    destroy() {
      try { sb.removeChannel(ch); } catch {}
    },
  };
}
export async function getProfile(id) {
  const sb = await client();
  const { data, error } = await sb.from('profiles').select('name,contact,avatar_url,role,city,bio').eq('id', id).single();
  if (error) return { name: '', contact: '' };
  return data;
}

// ---- клієнти тренера (з тих, хто записувався) ----
export async function myClients() {
  const rows = await bookingsAsTrainer();
  const seen = new Map();
  for (const b of rows) if (b.client_id && !seen.has(b.client_id)) seen.set(b.client_id, b.client?.name || 'Клієнт');
  return [...seen].map(([id, name]) => ({ id, name }));
}

// ---- призначені тренування (програми) ----
export async function assignWorkout({ clientId, title, workoutJson, weekdays }) {
  const sb = await client();
  const s = await getSession();
  const { error } = await sb.from('assignments').insert({
    trainer_id: s.user.id,
    client_id: clientId,
    title: title || 'Програма',
    workout_json: workoutJson,
    weekdays: weekdays || [],
  });
  if (error) throw new Error(error.message);
}
export async function assignmentsForClient(clientId) {
  const sb = await client();
  const s = await getSession();
  const { data, error } = await sb
    .from('assignments')
    .select('*')
    .eq('trainer_id', s.user.id)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
export async function myAssignments() {
  const sb = await client();
  const s = await getSession();
  const { data, error } = await sb
    .from('assignments')
    .select('*, trainer:trainer_id(name)')
    .eq('client_id', s.user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
export async function deleteAssignment(id) {
  const sb = await client();
  const { error } = await sb.from('assignments').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- прогрес клієнта (звіти по днях) ----
// клієнт відправляє свої логи; trainerId — кому показувати
export async function pushLogs(daysMap, trainerId) {
  const sb = await client();
  const s = await getSession();
  const rows = Object.keys(daysMap).map((iso) => ({
    client_id: s.user.id,
    trainer_id: trainerId,
    day_iso: iso,
    log_json: daysMap[iso],
  }));
  if (!rows.length) return 0;
  const { error } = await sb.from('workout_logs').upsert(rows, { onConflict: 'client_id,day_iso' });
  if (error) throw new Error(error.message);
  return rows.length;
}
export async function clientLogs(clientId) {
  const sb = await client();
  const s = await getSession();
  const { data, error } = await sb
    .from('workout_logs')
    .select('day_iso, log_json')
    .eq('client_id', clientId)
    .eq('trainer_id', s.user.id)
    .order('day_iso', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return data || [];
}

// ---- зрозумілі повідомлення про помилки ----
function uaAuthError(error) {
  const m = String(error.message || '');
  if (m.includes('provider is not enabled') || m.includes('Unsupported provider'))
    return 'Вхід через Google ще не увімкнено на сервері (див. backend/GOOGLE_LOGIN.md)';
  if (m.includes('Invalid login credentials')) return 'Невірна пошта або пароль';
  if (m.includes('already registered')) return 'Ця пошта вже зареєстрована — натисни «Увійти»';
  if (m.includes('at least 6 characters')) return 'Пароль закороткий (мінімум 6 символів)';
  if (m.includes('valid email')) return 'Некоректна адреса пошти';
  if (m.includes('rate limit')) return 'Забагато спроб — зачекай хвилину';
  if (m.toLowerCase().includes('fetch')) return 'Немає з’єднання з сервером — перевір інтернет';
  return m;
}

// ---- блокування, скарги, звернення (backend/patch-5-moderation.sql) ----
// id людей, яких я заблокував (порожньо без входу)
export async function myBlocks() {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) return new Set();
  const { data, error } = await sb.from('blocks').select('blocked_id').eq('blocker_id', s.user.id);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.blocked_id));
}
export async function listBlocked() {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) return [];
  const { data, error } = await sb
    .from('blocks')
    .select('blocked_id, created_at')
    .eq('blocker_id', s.user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data || [];
  // імена — окремим запитом: профіль заблокованого може бути закритий правилами
  const names = {};
  if (rows.length) {
    const { data: ps } = await sb.from('profiles').select('id,name,avatar_url').in('id', rows.map((r) => r.blocked_id));
    for (const p of ps || []) names[p.id] = p;
  }
  return rows.map((r) => ({ id: r.blocked_id, ...(names[r.blocked_id] || { name: '' }) }));
}
export async function blockUser(userId) {
  if (!isUUID(userId)) throw new Error('bad id');
  const sb = await client();
  const s = await getSession();
  const { error } = await sb.from('blocks').upsert({ blocker_id: s.user.id, blocked_id: userId }, { onConflict: 'blocker_id,blocked_id' });
  if (error) throw new Error(error.message);
}
export async function unblockUser(userId) {
  const sb = await client();
  const s = await getSession();
  const { error } = await sb.from('blocks').delete().eq('blocker_id', s.user.id).eq('blocked_id', userId);
  if (error) throw new Error(error.message);
}
// скарга: type — post | user | chat; повторна скарга на те саме — не помилка
export async function report({ type, targetId, userId, reason, note }) {
  const sb = await client();
  const s = await getSession();
  if (!sb || !s) throw new Error('auth');
  const { error } = await sb.from('reports').insert({
    reporter_id: s.user.id,
    target_type: type,
    target_id: String(targetId).slice(0, 64),
    target_user: isUUID(userId) ? userId : null,
    reason,
    note: String(note || '').slice(0, 1000),
  });
  if (error && error.code !== '23505') throw new Error(error.message);
}
// звернення в підтримку: можна без входу. Прямий запит до REST (без supabase-js): стара збережена сесія
// не тримає відправку, а без сервера помилка приходить одразу — тоді звернення чекає в черзі на пристрої
export async function sendSupport({ topic, text, email, version, lang }) {
  if (!configured) throw new Error('no-server');
  let session = null;
  try {
    session = await Promise.race([getSession(), new Promise((ok) => setTimeout(() => ok(null), 2000))]);
  } catch (e) { /* без входу */ }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/support_requests', {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + (session ? session.access_token : SUPABASE_ANON_KEY),
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: session ? session.user.id : null,
        topic,
        text: String(text).slice(0, 3000),
        email: String(email || '').slice(0, 200),
        app_version: String(version || '').slice(0, 40),
        lang: String(lang || '').slice(0, 5),
      }),
    });
    if (!res.ok) throw new Error('http ' + res.status);
  } finally {
    clearTimeout(timer);
  }
}
