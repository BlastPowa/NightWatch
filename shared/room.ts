/**
 * Room domain types and room-code utilities shared across the app.
 * Rooms have no database representation (ADR-004/ADR-009): a room exists
 * as a Supabase Realtime channel and the presence state of its members.
 */

export const ROOM_CODE_LENGTH = 6;

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

/** Metadata each member tracks into the room's Presence state. */
export interface PresenceMeta {
  memberId: string;
  displayName: string;
  /** Unix epoch ms when this member joined — drives host assignment. */
  joinedAt: number;
}

/** A member of a room as derived from Presence state. */
export interface RoomMember {
  id: string;
  displayName: string;
  joinedAt: number;
  isHost: boolean;
}
