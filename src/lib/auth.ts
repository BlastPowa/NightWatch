import type { Session } from '@supabase/supabase-js';
import { log } from '@/lib/log';
import { supabase } from '@/lib/supabase';

/** Signed-in Discord user, mapped from the Supabase session. */
export interface AuthUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export function mapSessionToUser(session: Session | null): AuthUser | null {
  if (session === null) {
    return null;
  }
  const meta = session.user.user_metadata as Record<string, unknown>;
  const name =
    (typeof meta['full_name'] === 'string' && meta['full_name']) ||
    (typeof meta['name'] === 'string' && meta['name']) ||
    'Discord user';
  return {
    id: session.user.id,
    name: name.slice(0, 24),
    avatarUrl: typeof meta['avatar_url'] === 'string' ? meta['avatar_url'] : null,
  };
}

/**
 * Start Discord sign-in: Supabase builds the PKCE authorization URL and we
 * open it in the SYSTEM browser (window.open is converted to
 * shell.openExternal by the main process — never an embedded webview, §8).
 * Discord redirects to nightwatch://auth-callback, which arrives via the
 * platform deep link and is completed by completeSignIn().
 */
export async function signInWithDiscord(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: 'nightwatch://auth-callback',
      skipBrowserRedirect: true,
    },
  });
  if (error !== null || !data.url) {
    throw new Error(error?.message ?? 'Could not start Discord sign-in.');
  }
  window.open(data.url);
}

/** Complete sign-in from the deep-link callback URL. */
export async function completeSignIn(callbackUrl: string): Promise<void> {
  const code = new URL(callbackUrl).searchParams.get('code');
  if (code === null) {
    log('warn', 'OAuth callback without code parameter');
    return;
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error !== null) {
    log('error', `OAuth code exchange failed: ${error.message}`);
    throw new Error(error.message);
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
