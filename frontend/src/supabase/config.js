import { createClient } from '@supabase/supabase-js';
import proxyClient from './proxyClient.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
let proxyMode = false;

export function getSupabase() {
  if (supabase) {
    if (proxyMode) return proxyClient;
    return supabase;
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[SUPABASE] Credentials missing, using API proxy');
    proxyMode = true;
    return proxyClient;
  }

  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    supabase.from('users').select('count', { count: 'exact', head: true }).then(r => {
      if (r && r.status === 200) return;
      console.warn('[SUPABASE] Anon key rejected, switching to API proxy');
      proxyMode = true;
      supabase = proxyClient;
    }).catch(() => {
      console.warn('[SUPABASE] Anon key rejected, switching to API proxy');
      proxyMode = true;
      supabase = proxyClient;
    });

    return supabase;
  } catch {
    console.warn('[SUPABASE] Init failed, using API proxy');
    proxyMode = true;
    return proxyClient;
  }
}

export function getSupabaseAdmin() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default getSupabase;
