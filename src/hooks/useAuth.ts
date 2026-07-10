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
