import { useEffect, useState } from 'react';
import {
  completeSignIn,
  getLastAuthError,
  mapSessionToUser,
  setLastAuthError,
  subscribeAuthError,
  type AuthUser,
} from '@/lib/auth';
import { log } from '@/lib/log';
import { supabase } from '@/lib/supabase';

/**
 * Live auth state. Also wires the OAuth deep-link callback (Electron only;
 * in a browser tab or the Activity there is simply never a callback).
 */
export function useAuth(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUser(mapSessionToUser(data.session));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(mapSessionToUser(session));
    });

    const unsubscribeCallback =
      typeof window.nightwatch !== 'undefined'
        ? window.nightwatch.onAuthCallback((url) => {
            setLastAuthError(null);
            completeSignIn(url)
              .then(() => setLastAuthError(null))
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                log('error', `Sign-in failed: ${message}`);
                setLastAuthError(message);
              });
          })
        : null;

    // Browser OAuth returns to the same-origin callback route. Electron uses
    // the nightwatch:// deep link above, so this branch is intentionally
    // browser-only and keeps the URL clean after the PKCE exchange.
    if (typeof window.nightwatch === 'undefined' && window.location.pathname.endsWith('/auth/callback')) {
      completeSignIn(window.location.href)
        .then(() => {
          window.history.replaceState({}, document.title, '/');
          setLastAuthError(null);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          log('error', `Browser sign-in failed: ${message}`);
          setLastAuthError(message);
        });
    }

    return () => {
      subscription.unsubscribe();
      unsubscribeCallback?.();
    };
  }, []);

  return user;
}

/** Last sign-in failure message, for UI display (null when none). */
export function useAuthError(): string | null {
  const [error, setError] = useState<string | null>(() => getLastAuthError());
  useEffect(() => subscribeAuthError(setError), []);
  return error;
}
