import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Trim defensively: CI-provided env values can carry trailing newlines,
// which corrupt the realtime websocket handshake (apikey with %0D%0A).
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase configuration. Copy .env.example to .env and set ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.',
  );
}

/** Single shared Supabase client for the entire renderer. */
export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Desktop OAuth uses the PKCE flow with a nightwatch:// deep link;
    // there is no redirect page to detect a session in.
    flowType: 'pkce',
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
