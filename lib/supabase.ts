import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
}
function getAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
}
function getServiceKey() {
  return process.env.SUPABASE_SERVICE_KEY || '';
}

let _supabase: SupabaseClient;
let _supabaseAdmin: SupabaseClient;

export function getSupabase() {
  if (!_supabase) _supabase = createClient(getUrl(), getAnonKey());
  return _supabase;
}

export function getSupabaseAdmin() {
  if (!_supabaseAdmin) _supabaseAdmin = createClient(getUrl(), getServiceKey());
  return _supabaseAdmin;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) { return (getSupabase() as unknown as Record<string, unknown>)[prop as string]; },
});

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) { return (getSupabaseAdmin() as unknown as Record<string, unknown>)[prop as string]; },
});

export function supaFetch(path: string, options: RequestInit = {}, useServiceKey = false) {
  const key = useServiceKey ? getServiceKey() : getAnonKey();
  return fetch(`${getUrl()}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {}),
    },
  });
}
