import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Trim defensively: CI-provided env values can carry trailing newlines,
// which corrupt the realtime websocket handshake (apikey with %0D%0A).
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/**
 * Backend configuration is optional at process start. NightWatch has useful
 * local/solo functionality (local media, settings, ScreenWatch capture setup,
 * discovery UI) that should remain available even when an install has not yet
 * been connected to Supabase. Feature services use this flag to expose an
 * offline/deployment state instead of crashing during module evaluation.
 */
export const supabaseConfigured = url.length > 0 && anonKey.length > 0;

// @supabase/supabase-js requires a syntactically valid URL/key even when no
// network-backed feature will be used. Keep one inert local client so legacy
// service modules can still import the shared singleton safely; capability
// gates prevent intentional requests while configuration is absent.
const clientUrl = supabaseConfigured ? url : 'http://127.0.0.1:54321';
const clientKey = supabaseConfigured ? anonKey : 'nightwatch-unconfigured';

/** Single shared Supabase client for the entire renderer. */
export const supabase: SupabaseClient = createClient(clientUrl, clientKey, {
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
