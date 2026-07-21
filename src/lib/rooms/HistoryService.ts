import { isValidVideoId } from '@shared/youtube';
import { isValidRoomCode, normalizeRoomCode } from '@shared/room';
import { supabase } from '@/lib/supabase';

/** One "previously watched" entry for a persistent room (Phase 16). */
export interface HistoryEntry {
  videoId: string;
  title: string;
  watchedAt: string;
}

const sessionHistory = new Map<string, HistoryEntry[]>();

function sessionKey(roomCode: string): string {
  const normalized = normalizeRoomCode(roomCode);
  return normalized === '' ? roomCode.trim().toUpperCase() : normalized;
}

/**
 * Record what this mounted room played even when it is an ephemeral room.
 * This deliberately stays in memory: it is room-session history, not a new
 * cloud persistence contract. The persistent backend remains the durable seed.
 */
export function recordSessionWatch(roomCode: string, videoId: string, title: string | null): void {
  if (!isValidVideoId(videoId)) return;
  const key = sessionKey(roomCode);
  if (key === '') return;
  const entry: HistoryEntry = {
    videoId,
    title: title?.trim() || 'Untitled',
    watchedAt: new Date().toISOString(),
  };
  const current = sessionHistory.get(key) ?? [];
  sessionHistory.set(
    key,
    [entry, ...current.filter((item) => item.videoId !== videoId)].slice(0, 50),
  );
}

/**
 * Record a watch in a persistent room's history. Fire-and-forget: the
 * server ignores ephemeral codes, dedupes consecutive repeats, and caps
 * the log at 50 entries. Call from the HOST only (one write per room).
 */
export function recordWatch(roomCode: string, videoId: string, title: string | null): void {
  recordSessionWatch(roomCode, videoId, title);
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
  const local = sessionHistory.get(sessionKey(roomCode)) ?? [];
  if (!isValidRoomCode(code)) {
    return local;
  }
  const { data, error } = await supabase.rpc('get_room_history', { p_room_code: code });
  if (error !== null || !Array.isArray(data)) {
    return local;
  }
  const remote = data
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
  const seen = new Set(local.map((entry) => entry.videoId));
  return [...local, ...remote.filter((entry) => !seen.has(entry.videoId))].slice(0, 50);
}
