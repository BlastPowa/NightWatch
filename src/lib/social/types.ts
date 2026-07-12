import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Phase 20B: the single result union every social service returns.
 *
 * The RPCs signal failure by raising a bare message ('blocked', 'forbidden',
 * …); this maps those onto a closed set the UI can exhaustively handle, so a
 * new backend error can never reach the user as a raw Postgres string.
 */
export type SocialResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'blocked' }
  | { status: 'rate-limited' }
  | { status: 'offline' }
  | { status: 'not-ready' }
  | { status: 'error' };

export type SocialFailure = Exclude<SocialResult<never>, { status: 'ok' }>;

/** Messages raised by the Phase 20B RPCs, mapped to their result status. */
const RAISED_STATUS: Record<string, SocialFailure['status']> = {
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  blocked: 'blocked',
  'rate-limited': 'rate-limited',
  'not-ready': 'not-ready',
};

/**
 * A missing function/table means the migration has not been deployed — that is
 * 'not-ready', not an error, and it is what keeps SocialCapabilities false.
 */
const NOT_READY_CODES = new Set(['42883', '42P01']);

export function toFailure(error: PostgrestError | null): SocialFailure {
  if (error === null) {
    return { status: 'error' };
  }
  const raised = RAISED_STATUS[error.message.trim()];
  if (raised !== undefined) {
    return { status: raised };
  }
  if (NOT_READY_CODES.has(error.code)) {
    return { status: 'not-ready' };
  }
  // A fetch that never reached Postgres has no code.
  if (error.code === '' || error.code === undefined) {
    return { status: 'offline' };
  }
  return { status: 'error' };
}

export function ok<T>(data: T): SocialResult<T> {
  return { status: 'ok', data };
}
