import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@shared/room';
import { supabase } from '@/lib/supabase';

/** A persistent room record (ADR-012). */
export interface PersistentRoom {
  code: string;
  name: string;
  scheduledAt: string | null;
  createdAt: string;
}

/** Public metadata anyone with the code may see. */
export interface RoomMeta {
  name: string;
  scheduledAt: string | null;
}

interface RoomRow {
  code: string;
  name: string;
  scheduled_at: string | null;
  created_at: string;
}

function toRoom(row: RoomRow): PersistentRoom {
  return {
    code: row.code,
    name: row.name,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
  };
}

export async function listMyRooms(): Promise<PersistentRoom[]> {
  const { data, error } = await supabase
    .from('rooms')
    .select('code, name, scheduled_at, created_at')
    .order('created_at', { ascending: true });
  if (error !== null) {
    throw new Error(error.message);
  }
  return (data as RoomRow[]).map(toRoom);
}

/** Create a persistent room; retries on the (rare) code collision. */
export async function createRoom(
  name: string,
  scheduledAt: string | null,
): Promise<PersistentRoom> {
  const cleanName = name.trim().slice(0, 50);
  if (cleanName.length === 0) {
    throw new Error('Room name is required.');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await supabase
      .from('rooms')
      .insert({ code, name: cleanName, scheduled_at: scheduledAt })
      .select('code, name, scheduled_at, created_at')
      .single();
    if (error === null) {
      return toRoom(data as RoomRow);
    }
    if (!error.message.includes('duplicate')) {
      throw new Error(error.message);
    }
  }
  throw new Error('Could not allocate a room code — try again.');
}

export async function setRoomSchedule(
  code: string,
  scheduledAt: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('rooms')
    .update({ scheduled_at: scheduledAt })
    .eq('code', code);
  if (error !== null) {
    throw new Error(error.message);
  }
}

export async function deleteRoom(code: string): Promise<void> {
  const { error } = await supabase.from('rooms').delete().eq('code', code);
  if (error !== null) {
    throw new Error(error.message);
  }
}

/** Look up a room's public metadata by code; null for ephemeral codes. */
export async function getRoomMeta(code: string): Promise<RoomMeta | null> {
  const normalized = normalizeRoomCode(code);
  if (!isValidRoomCode(normalized)) {
    return null;
  }
  const { data, error } = await supabase.rpc('get_room_by_code', {
    room_code: normalized,
  });
  if (error !== null || !Array.isArray(data) || data.length === 0) {
    return null;
  }
  const row = data[0] as { name?: unknown; scheduled_at?: unknown };
  return typeof row.name === 'string'
    ? {
        name: row.name,
        scheduledAt: typeof row.scheduled_at === 'string' ? row.scheduled_at : null,
      }
    : null;
}
