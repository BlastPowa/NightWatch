import { useEffect, useState } from 'react';
import { completeSignIn, mapSessionToUser, type AuthUser } from '@/lib/auth';
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
            completeSignIn(url).catch((error: unknown) => {
              log('error', `Sign-in failed: ${String(error)}`);
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
