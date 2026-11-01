// backend-config.js — підключення до сервера (Supabase).
// anon/publishable-ключ публічний за дизайном: безпеку забезпечують
// RLS-правила бази (backend/schema.sql), а не секретність ключа.
export const SUPABASE_URL = 'https://hniapnuppftdhnopmdpt.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_uOR5Gw-AffLRCUaTaG3CDw_t4fXl9Te';

// Web Push: публічний VAPID-ключ (приватний — лише секрет функції push у Supabase, VAPID_KEYS)
export const VAPID_PUBLIC_KEY = 'BETE_b19r_DsttCwHzojABHnAP_nhiEGjW9OCGc_3ChlF62cTPyLsC0BVK42GbeONWHRgBb01nhUE9VsCtBLcCI';
