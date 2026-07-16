/**
 * Room domain types and room-code utilities shared across the app.
 * Rooms have no database representation (ADR-004/ADR-009): a room exists
 * as a Supabase Realtime channel and the presence state of its members.
 */

export const ROOM_CODE_LENGTH = 6;

/** Deep-link invite for a room (Phase 16), e.g. nightwatch://join/KX3F9Q */
export function buildInviteLink(code: string): string {
  return `nightwatch://join/${normalizeRoomCode(code)}`;
}

/** Extract a valid room code from a join deep link, else null. */
export function parseJoinLink(url: string): string | null {
  const match = /^nightwatch:\/\/join\/([A-Za-z0-9]{6})\/?$/.exec(url.trim());
  if (match === null || match[1] === undefined) {
    return null;
  }
  const code = normalizeRoomCode(match[1]);
  return isValidRoomCode(code) ? code : null;
}

/** Unambiguous alphabet — no 0/O, 1/I/L to keep codes easy to read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a cryptographically random room code, e.g. "KX3F9Q". */
export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Deterministically derive a room code from a platform-provided seed
 * (e.g. a Discord voice channel id) so everyone in the same channel lands
 * in the same room. Simple FNV-1a hash mapped onto the code alphabet.
 */
export function deriveRoomCode(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[hash % ROOM_CODE_ALPHABET.length];
    hash = Math.imul(hash ^ (hash >>> 13), 0x01000193) >>> 0;
  }
  return code;
}

/** Normalize user input (trim, uppercase) before validation or joining. */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) {
    return false;
  }
  for (const char of code) {
    if (!ROOM_CODE_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}

/**
 * The only avatar host we accept, and the longest URL we will ever store or
 * broadcast. A Discord CDN avatar URL is well under this; the cap stops a
 * crafted presence payload from bloating every peer's member list.
 */
const AVATAR_ALLOWED_HOST = 'cdn.discordapp.com';
const AVATAR_MAX_LENGTH = 256;

/**
 * Reduce an untrusted avatar value to a canonical, safe-to-render URL or null.
 *
 * Presence metadata arrives from other clients and from OAuth sessions, so a
 * value here is never trusted. We accept ONLY `https://cdn.discordapp.com/...`,
 * strip any query/hash (a Discord avatar needs neither, and they are the usual
 * carrier for tracking or cache-busting beacons), reject embedded credentials
 * and non-HTTPS URLs, and cap the length. Anything else becomes null so the
 * caller falls back to the initial. Discord Activity rendering rewrites the
 * canonical host to `/discordcdn/...` at display time — that is a render
 * concern, so this returns the canonical CDN URL unchanged.
 */
export function sanitizeAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > AVATAR_MAX_LENGTH) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== AVATAR_ALLOWED_HOST ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    return null;
  }
  const canonical = `https://${AVATAR_ALLOWED_HOST}${url.pathname}`;
  return canonical.length > AVATAR_MAX_LENGTH ? null : canonical;
}

/** Metadata each member tracks into the room's Presence state. */
export interface PresenceMeta {
  memberId: string;
  displayName: string;
  /** Unix epoch ms when this member joined — drives host assignment. */
  joinedAt: number;
  /** Watch streak in days (Phase 18); optional for older clients. */
  streakDays?: number;
  /**
   * Canonical Discord CDN avatar URL (Phase 24); optional for older clients.
   * Always validate with sanitizeAvatarUrl when consuming — never render raw.
   */
  avatarUrl?: string;
}

/** A member of a room as derived from Presence state. */
export interface RoomMember {
  id: string;
  displayName: string;
  joinedAt: number;
  isHost: boolean;
  streakDays: number;
  /** Validated Discord CDN avatar URL, or null to render the initial. */
  avatarUrl: string | null;
}
