import {
  commsFail,
  commsFailFromRpc,
  commsOk,
  type CommsOutcome,
} from '@shared/roomComms';
import { supabase } from '@/lib/supabase';

/**
 * Phase 32 — privacy-safe people discovery and room-people actions (0026).
 *
 * Discovery returns only public profile fields for users who opted in, never
 * the caller, never anyone in a block relationship with the caller. Room
 * people maps CURRENT authenticated room members to profiles + relationship
 * state; it requires the caller to be a fresh member themselves and never
 * exposes a room code in any output.
 */

export type RelationshipState =
  | 'none'
  | 'friends'
  | 'pending-incoming'
  | 'pending-outgoing'
  | 'self';

export interface PublicPerson {
  userId: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  border: string | null;
  relationship: RelationshipState;
}

const RELATIONSHIPS: readonly RelationshipState[] = [
  'none',
  'friends',
  'pending-incoming',
  'pending-outgoing',
  'self',
];

function normalizePeople(data: unknown): PublicPerson[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .filter(
      (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
    )
    .map((row) => ({
      userId: typeof row['user_id'] === 'string' ? row['user_id'] : '',
      handle: typeof row['handle'] === 'string' ? row['handle'] : null,
      displayName: typeof row['display_name'] === 'string' ? row['display_name'] : 'Player',
      avatarUrl: typeof row['avatar_url'] === 'string' ? row['avatar_url'] : null,
      border: typeof row['border'] === 'string' ? row['border'] : null,
      relationship: RELATIONSHIPS.includes(row['relationship'] as RelationshipState)
        ? (row['relationship'] as RelationshipState)
        : 'none',
    }))
    .filter((person) => person.userId.length > 0);
}

/** Normalize a search query the way the server will (for local UX checks). */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 40);
}

export const SEARCH_MIN_CHARS = 3;

export async function searchPeople(query: string): Promise<CommsOutcome<PublicPerson[]>> {
  const normalized = normalizeSearchQuery(query);
  if (normalized.length < SEARCH_MIN_CHARS) {
    return commsOk([]);
  }
  const { data, error } = await supabase.rpc('search_people', { p_query: normalized });
  if (error !== null) {
    if ((error.message ?? '').includes('query-too-short')) {
      return commsOk([]);
    }
    return commsFailFromRpc(error);
  }
  return commsOk(normalizePeople(data));
}

export async function getRoomPeople(
  roomCode: string,
): Promise<CommsOutcome<PublicPerson[]>> {
  const { data, error } = await supabase.rpc('get_room_people', { p_room_code: roomCode });
  if (error !== null) {
    return commsFailFromRpc(error);
  }
  return commsOk(normalizePeople(data));
}

// -- handle / discoverability -------------------------------------------------

export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

export type SetHandleFailure = 'invalid-handle' | 'handle-taken';

export async function setPublicHandle(
  handle: string | null,
): Promise<CommsOutcome<void> | { ok: false; code: SetHandleFailure; message: string; retryable: false }> {
  if (handle !== null && !HANDLE_PATTERN.test(handle)) {
    return {
      ok: false,
      code: 'invalid-handle',
      message: 'Handles are 3–20 characters: a–z, 0–9, underscore.',
      retryable: false,
    };
  }
  const { error } = await supabase.rpc('set_public_handle', { p_handle: handle ?? '' });
  if (error !== null) {
    const message = error.message ?? '';
    if (message.includes('handle-taken')) {
      return {
        ok: false,
        code: 'handle-taken',
        message: 'That handle is already taken.',
        retryable: false,
      };
    }
    if (message.includes('invalid-handle')) {
      return {
        ok: false,
        code: 'invalid-handle',
        message: 'Handles are 3–20 characters: a–z, 0–9, underscore.',
        retryable: false,
      };
    }
    return commsFailFromRpc(error);
  }
  return commsOk(undefined);
}

export async function setDiscoverable(discoverable: boolean): Promise<CommsOutcome<void>> {
  const { error } = await supabase.rpc('set_discoverable', {
    p_discoverable: discoverable,
  });
  if (error !== null) {
    return commsFailFromRpc(error);
  }
  return commsOk(undefined);
}

/** Guard for UI call sites that must not fire while signed out. */
export async function requireSignedIn(): Promise<CommsOutcome<string>> {
  const { data } = await supabase.auth.getSession();
  if (data.session === null) {
    return commsFail('unauthorized', 'Sign in with Discord to use this.');
  }
  return commsOk(data.session.user.id);
}
