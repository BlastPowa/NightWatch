import { isValidRoomCode, normalizeRoomCode } from '@shared/room';
import { supabase } from '@/lib/supabase';

/** Scheduled watch parties + RSVPs (Phase 19). */

export type Rsvp = 'going' | 'maybe' | 'declined';

/** RSVP states a user can pick, in display order. */
export const RSVP_OPTIONS: ReadonlyArray<{ id: Rsvp; label: string }> = [
  { id: 'going', label: 'Going' },
  { id: 'maybe', label: 'Maybe' },
  { id: 'declined', label: "Can't make it" },
];

export interface UpcomingRoom {
  code: string;
  name: string;
  scheduledAt: string;
  /** The caller's RSVP, or null when they have not responded yet. */
  rsvp: Rsvp | null;
  isOwner: boolean;
}

export interface RsvpEntry {
  displayName: string;
  rsvp: Rsvp;
}

function toRsvp(value: unknown): Rsvp | null {
  return value === 'going' || value === 'maybe' || value === 'declined' ? value : null;
}

/** Rooms you own or RSVP'd to that are scheduled within the next week. */
export async function listUpcomingRooms(): Promise<UpcomingRoom[]> {
  const { data, error } = await supabase.rpc('get_upcoming_rooms');
  if (error !== null || !Array.isArray(data)) {
    return [];
  }
  return data
    .filter(
      (row): row is { code: string; name: string; scheduled_at: string } =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as { code?: unknown }).code === 'string' &&
        typeof (row as { scheduled_at?: unknown }).scheduled_at === 'string',
    )
    .map((row) => ({
      code: row.code,
      name: typeof row.name === 'string' ? row.name : 'Untitled room',
      scheduledAt: row.scheduled_at,
      rsvp: toRsvp((row as { rsvp?: unknown }).rsvp),
      isOwner: (row as { is_owner?: unknown }).is_owner === true,
    }));
}

/**
 * Set the signed-in user's RSVP. The room_invites FK means this only succeeds
 * for a persistent room that actually exists — an invented code is rejected by
 * the database rather than silently creating a dangling invite.
 */
export async function setRsvp(roomCode: string, rsvp: Rsvp): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  if (!isValidRoomCode(code)) {
    throw new Error('That is not a valid room code.');
  }
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (userId === undefined) {
    throw new Error('Sign in to RSVP.');
  }
  const { error } = await supabase
    .from('room_invites')
    .upsert({ room_code: code, user_id: userId, rsvp }, { onConflict: 'room_code,user_id' });
  if (error !== null) {
    throw new Error('Could not save your RSVP. Check the room code.');
  }
}

/** Owner-only guest list for one of your rooms. */
export async function listRsvps(roomCode: string): Promise<RsvpEntry[]> {
  const { data, error } = await supabase.rpc('get_room_rsvps', { p_room_code: roomCode });
  if (error !== null || !Array.isArray(data)) {
    return [];
  }
  return data
    .map((row) => ({
      displayName:
        typeof (row as { display_name?: unknown }).display_name === 'string'
          ? (row as { display_name: string }).display_name
          : 'Someone',
      rsvp: toRsvp((row as { rsvp?: unknown }).rsvp),
    }))
    .filter((entry): entry is RsvpEntry => entry.rsvp !== null);
}
