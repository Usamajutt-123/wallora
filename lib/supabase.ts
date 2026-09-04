import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function safeSupabaseUrl(value: string | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return null;
    return endpoint.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

const url = safeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const serviceKey = rawServiceKey && (process.env.NODE_ENV !== 'production' || rawServiceKey.length >= 32)
  ? rawServiceKey
  : '';

/** True once valid Supabase endpoint and public key values are configured. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

let _anon: SupabaseClient | null = null;
/** Public read client (respects RLS). Null when Supabase isn't configured. */
export function getAnonSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!_anon) _anon = createClient(url!, anonKey, { auth: { persistSession: false } });
  return _anon;
}

let _service: SupabaseClient | null = null;
/** Server-only privileged client (bypasses RLS). Null without a strong service key. */
export function getServiceSupabase(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  if (!_service) _service = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _service;
}

export function serviceKeyConfigured(): boolean {
  return Boolean(url && serviceKey);
}
