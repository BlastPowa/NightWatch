import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@shared/room';
import { supabase } from '@/lib/supabase';

/** A persistent room record (ADR-012 + Phase 17 settings). */
export interface PersistentRoom {
  code: string;
  name: string;
  scheduledAt: string | null;
  createdAt: string;
  insightsEnabled: boolean;
  premiereVideoId: string | null;
}

/** Public metadata anyone with the code may see. */
export interface RoomMeta {
  name: string;
  scheduledAt: string | null;
  /** Members must be able to see that insights are on (ADR-014). */
  insightsEnabled: boolean;
  premiereVideoId: string | null;
}

interface RoomRow {
  code: string;
  name: string;
  scheduled_at: string | null;
  created_at: string;
  insights_enabled?: boolean;
  premiere_video_id?: string | null;
}

function toRoom(row: RoomRow): PersistentRoom {
  return {
    code: row.code,
    name: row.name,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    insightsEnabled: row.insights_enabled === true,
    premiereVideoId: row.premiere_video_id ?? null,
  };
}

const ROOM_COLUMNS = 'code, name, scheduled_at, created_at, insights_enabled, premiere_video_id';

export async function listMyRooms(): Promise<PersistentRoom[]> {
  const { data, error } = await supabase
    .from('rooms')
    .select(ROOM_COLUMNS)
    .order('created_at', { ascending: true });
  if (error !== null) {
    throw new Error(error.message);
  }
  return (data as RoomRow[]).map(toRoom);
}

/** Owner-only: update Phase 17 room settings. */
export async function updateRoomSettings(
  code: string,
  settings: { insightsEnabled?: boolean; premiereVideoId?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (settings.insightsEnabled !== undefined) {
    patch['insights_enabled'] = settings.insightsEnabled;
  }
  if (settings.premiereVideoId !== undefined) {
    patch['premiere_video_id'] = settings.premiereVideoId;
  }
  const { error } = await supabase.from('rooms').update(patch).eq('code', code);
  if (error !== null) {
    throw new Error(error.message);
  }
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
  const row = data[0] as {
    name?: unknown;
    scheduled_at?: unknown;
    insights_enabled?: unknown;
    premiere_video_id?: unknown;
  };
  return typeof row.name === 'string'
    ? {
        name: row.name,
        scheduledAt: typeof row.scheduled_at === 'string' ? row.scheduled_at : null,
        insightsEnabled: row.insights_enabled === true,
        premiereVideoId:
          typeof row.premiere_video_id === 'string' ? row.premiere_video_id : null,
      }
    : null;
}
