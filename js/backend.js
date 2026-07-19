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
  return data;
}

export async function saveMyProfile(patch) {
  const sb = await client();
  const session = await getSession();
  if (!sb || !session) throw new Error('Немає сесії');
  const { error } = await sb.from('profiles').update(patch).eq('id', session.user.id);
  if (error) throw new Error(error.message);
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

// ---- пости спільноти (фото з тренувань) ----
export async function listPosts(authorId) {
  const sb = await client();
  let q = sb
    .from('posts')
    .select('*, author:author_id(name,avatar_url,role)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (authorId) q = q.eq('author_id', authorId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}
export async function addPost(blob, caption) {
  const sb = await client();
  const s = await getSession();
  if (!s) throw new Error('Немає сесії');
  const path = `${s.user.id}/${Date.now()}.jpg`;
  const { error: upErr } = await sb.storage
    .from('posts')
    .upload(path, blob, { contentType: 'image/jpeg' });
  if (upErr) throw new Error(upErr.message);
  const { data } = sb.storage.from('posts').getPublicUrl(path);
  const { error } = await sb.from('posts').insert({
    author_id: s.user.id,
    caption: String(caption || '').slice(0, 300),
    photo_url: data.publicUrl,
    photo_path: path,
  });
  if (error) throw new Error(error.message);
}
export async function deletePost(post) {
  const sb = await client();
  const { error } = await sb.from('posts').delete().eq('id', post.id);
  if (error) throw new Error(error.message);
  // фото у сховищі прибираємо теж (не критично, якщо не вдасться)
  if (post.photo_path) {
    try { await sb.storage.from('posts').remove([post.photo_path]); } catch {}
  }
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
export async function listMessages(otherId) {
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
