import { isValidVideoId } from '@shared/youtube';
import { isValidRoomCode, normalizeRoomCode } from '@shared/room';
import { supabase } from '@/lib/supabase';

/** One "previously watched" entry for a persistent room (Phase 16). */
export interface HistoryEntry {
  videoId: string;
  title: string;
  watchedAt: string;
}

/**
 * Record a watch in a persistent room's history. Fire-and-forget: the
 * server ignores ephemeral codes, dedupes consecutive repeats, and caps
 * the log at 50 entries. Call from the HOST only (one write per room).
 */
export function recordWatch(roomCode: string, videoId: string, title: string | null): void {
  const code = normalizeRoomCode(roomCode);
  if (!isValidRoomCode(code) || !isValidVideoId(videoId)) {
    return;
  }
  void supabase
    .rpc('add_room_history', {
      p_room_code: code,
      p_video_id: videoId,
      p_title: title ?? 'Untitled',
    })
    .then(undefined, () => {});
}

/** Newest-first history for a room (empty for ephemeral rooms). */
export async function listHistory(roomCode: string): Promise<HistoryEntry[]> {
  const code = normalizeRoomCode(roomCode);
  if (!isValidRoomCode(code)) {
    return [];
  }
  const { data, error } = await supabase.rpc('get_room_history', { p_room_code: code });
  if (error !== null || !Array.isArray(data)) {
    return [];
  }
  return data
    .filter(
      (row): row is { video_id: string; title: string; watched_at: string } =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as { video_id?: unknown }).video_id === 'string' &&
        typeof (row as { title?: unknown }).title === 'string',
    )
    .map((row) => ({
      videoId: row.video_id,
      title: row.title,
      watchedAt: row.watched_at,
    }));
}
