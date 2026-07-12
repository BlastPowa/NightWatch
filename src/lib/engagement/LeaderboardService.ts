import { supabase } from '@/lib/supabase';

/** Friend-group leaderboards (Phase 18). Opt-in rows only (share_stats). */

export type LeaderboardMetric =
  | 'watch_seconds'
  | 'rooms_joined'
  | 'reactions_sent'
  | 'streak_days';

export const LEADERBOARD_METRICS: ReadonlyArray<{ id: LeaderboardMetric; label: string }> = [
  { id: 'watch_seconds', label: 'Watch time' },
  { id: 'streak_days', label: 'Streaks' },
  { id: 'rooms_joined', label: 'Rooms' },
  { id: 'reactions_sent', label: 'Reactions' },
];

export interface LeaderboardEntry {
  displayName: string;
  value: number;
  isSelf: boolean;
}

/**
 * Phase 19: 'friends' ranks you against people you have actually shared a
 * persistent room with; 'global' ranks every opted-in player. Friends is the
 * default — it is what the UI has always promised — but it is empty until you
 * co-watch with someone, so the global board stays available as a fallback.
 */
export type LeaderboardScope = 'friends' | 'global';

function normalizeEntries(data: unknown): LeaderboardEntry[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .filter(
      (row): row is { display_name: string; value: number; is_self?: unknown } =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as { display_name?: unknown }).display_name === 'string' &&
        typeof (row as { value?: unknown }).value === 'number',
    )
    .map((row) => ({
      displayName: row.display_name,
      value: row.value,
      isSelf: row.is_self === true,
    }));
}

export async function getLeaderboard(
  metric: LeaderboardMetric,
  scope: LeaderboardScope = 'friends',
): Promise<LeaderboardEntry[]> {
  const rpc = scope === 'friends' ? 'get_friend_leaderboard' : 'get_leaderboard';
  const { data, error } = await supabase.rpc(rpc, { metric });
  if (error !== null) {
    return [];
  }
  return normalizeEntries(data);
}

/** Room milestones (shared achievements surface). */
export interface RoomStats {
  videosPlayed: number;
  sessionsCount: number;
  totalMinutes: number;
}

export async function getRoomStats(roomCode: string): Promise<RoomStats | null> {
  const { data, error } = await supabase.rpc('get_room_stats', { p_room_code: roomCode });
  if (error !== null || !Array.isArray(data) || data.length === 0) {
    return null;
  }
  const row = data[0] as {
    videos_played?: unknown;
    sessions_count?: unknown;
    total_minutes?: unknown;
  };
  return {
    videosPlayed: Number(row.videos_played ?? 0),
    sessionsCount: Number(row.sessions_count ?? 0),
    totalMinutes: Number(row.total_minutes ?? 0),
  };
}
