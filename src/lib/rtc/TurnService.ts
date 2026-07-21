import {
  commsFail,
  commsOk,
  type CommsOutcome,
} from '@shared/roomComms';
import {
  parseTurnCredentials,
  turnCredentialsFresh,
  type TurnCredentials,
} from '@shared/rtc';
import { supabase } from '@/lib/supabase';

/** Phase 32 — short-lived TURN credentials from the Edge Function. Cached
 *  per room while fresh; the shared secret never exists client-side. */

let cached: { roomCode: string; credentials: TurnCredentials } | null = null;

/** Secret-free relay diagnostics (remaining-features handoff, Priority 1). */
export interface TurnDiagnostics {
  configured: boolean;
  provider: 'cloudflare' | 'coturn' | null;
}

export async function getTurnDiagnostics(): Promise<TurnDiagnostics> {
  try {
    const { data, error } = await supabase.functions.invoke('turn-credentials', {
      body: { action: 'diagnostics' },
    });
    if (error !== null) {
      return { configured: false, provider: null };
    }
    const record = data as { configured?: unknown; provider?: unknown } | null;
    const provider =
      record?.provider === 'cloudflare' || record?.provider === 'coturn'
        ? record.provider
        : null;
    return { configured: record?.configured === true && provider !== null, provider };
  } catch {
    return { configured: false, provider: null };
  }
}

export async function getTurnCredentials(
  roomCode: string,
): Promise<CommsOutcome<TurnCredentials>> {
  if (
    cached !== null &&
    cached.roomCode === roomCode &&
    turnCredentialsFresh(cached.credentials)
  ) {
    return commsOk(cached.credentials);
  }

  try {
    const { data, error } = await supabase.functions.invoke('turn-credentials', {
      body: { roomCode },
    });
    if (error !== null) {
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 503 || status === 404) {
        return commsFail('not-supported', 'Voice/share relay is not set up yet.');
      }
      if (status === 401) {
        return commsFail('unauthorized', 'Sign in to use voice and sharing.');
      }
      if (status === 403) {
        return commsFail('forbidden', 'Join the room before starting voice or sharing.');
      }
      if (status === 429) {
        return commsFail('rate-limited', 'Too many relay requests — try again shortly.');
      }
      return commsFail('server-error', 'Could not obtain relay credentials.');
    }
    const credentials = parseTurnCredentials(data);
    if (credentials === null) {
      return commsFail('server-error', 'Relay credentials were malformed.');
    }
    cached = { roomCode, credentials };
    return commsOk(credentials);
  } catch {
    return commsFail('offline', 'Could not reach the relay service.');
  }
}

/** Drop the cache (sign-out / leaving the room). */
export function clearTurnCredentials(): void {
  cached = null;
}
