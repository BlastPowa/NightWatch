/**
 * Phase 35 — pure invite-token helpers.
 *
 * These live in `shared/` rather than in the renderer service because the
 * Electron main process must parse invite deep links too, and main cannot
 * import anything that pulls in the Supabase client. One implementation, one
 * regex, no drift between the two processes.
 *
 * An invite token is 32 lowercase hex characters produced by
 * `mint_room_invite_token()`. It is opaque: it encodes nothing about the room,
 * so it is safe in a URL, a Discord message, or a Rich Presence payload in a
 * way a room code never is.
 */

export const INVITE_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** Narrow an unknown value to a well-formed invite token. */
export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value);
}

/** Build the deep link a recipient opens. Carries the TOKEN, never a code. */
export function buildInviteTokenLink(token: string): string {
  return `nightwatch://invite/${token}`;
}

/**
 * Extract a token from an invite deep link, or null.
 *
 * Deliberately strict: exact scheme, exact path, exact token shape. Anything
 * else is not our link and must not be treated as one.
 */
export function parseInviteTokenLink(url: string): string | null {
  const match = /^nightwatch:\/\/invite\/([0-9a-f]{32})\/?$/.exec(url.trim());
  return match?.[1] ?? null;
}
