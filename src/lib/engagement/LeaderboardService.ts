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
}

export async function getLeaderboard(metric: LeaderboardMetric): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', { metric });
  if (error !== null || !Array.isArray(data)) {
    return [];
  }
  return data
    .filter(
      (row): row is { display_name: string; value: number } =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as { display_name?: unknown }).display_name === 'string' &&
        typeof (row as { value?: unknown }).value === 'number',
    )
    .map((row) => ({ displayName: row.display_name, value: row.value }));
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
