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
    _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

// ---- зрозумілі повідомлення про помилки ----
function uaAuthError(error) {
  const m = String(error.message || '');
  if (m.includes('Invalid login credentials')) return 'Невірна пошта або пароль';
  if (m.includes('already registered')) return 'Ця пошта вже зареєстрована — натисни «Увійти»';
  if (m.includes('at least 6 characters')) return 'Пароль закороткий (мінімум 6 символів)';
  if (m.includes('valid email')) return 'Некоректна адреса пошти';
  if (m.includes('rate limit')) return 'Забагато спроб — зачекай хвилину';
  if (m.toLowerCase().includes('fetch')) return 'Немає з’єднання з сервером — перевір інтернет';
  return m;
}
