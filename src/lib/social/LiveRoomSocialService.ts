import { ok, toFailure, type SocialResult } from '@/lib/social/types';
import { supabase } from '@/lib/supabase';
import { isValidRoomCode, normalizeRoomCode } from '@shared/room';

/**
 * Phase 31: live-room co-watcher discovery (0023).
 *
 * Ephemeral six-character rooms never create room_participants rows (that
 * table is keyed to persistent rooms), so two signed-in people watching
 * together could not find each other in Friends suggestions. These RPCs keep a
 * short-lived, HMAC-keyed presence row per (room, user) — the raw room code is
 * never stored server-side and never appears in any response.
 *
 * Contract highlights the UI must respect:
 *   * heartbeat at most every ~60s; the server treats a room SWITCH more often
 *     than every 10s as scanning and raises 'rate-limited'.
 *   * listing requires the caller's own fresh (≤2min) heartbeat for the same
 *     room, so results are only available while actually in the room.
 *   * results already exclude blocks (both directions), accepted friends, and
 *     users with a pending request either way — they are pure suggestions and
 *     feed the existing block-aware send_friend_request flow.
 */

export interface LiveRoomCoWatcher {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  selectedBorderId: string | null;
}

/** Matches the server-side presence id rule exactly. */
const PRESENCE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function validCode(roomCode: string): string | null {
  const code = normalizeRoomCode(roomCode);
  return isValidRoomCode(code) ? code : null;
}

/** Announce (or refresh) presence in a live room. Call on join and ~every 60s. */
export async function heartbeatLiveRoomSocial(
  roomCode: string,
  presenceId: string,
): Promise<SocialResult<void>> {
  const code = validCode(roomCode);
  if (code === null || !PRESENCE_ID.test(presenceId)) {
    return { status: 'forbidden' };
  }
  const { error } = await supabase.rpc('heartbeat_live_room_social', {
    p_room_code: code,
    p_presence_id: presenceId,
  });
  return error === null ? ok(undefined) : toFailure(error);
}

/**
 * Other fresh, signed-in co-watchers in the same room. 'forbidden' also means
 * the caller's own heartbeat went stale — heartbeat again, then retry.
 */
export async function listLiveRoomCoWatchers(
  roomCode: string,
): Promise<SocialResult<LiveRoomCoWatcher[]>> {
  const code = validCode(roomCode);
  if (code === null) {
    return { status: 'forbidden' };
  }
  const { data, error } = await supabase.rpc('list_live_room_co_watchers', {
    p_room_code: code,
  });
  if (error !== null) {
    return toFailure(error);
  }
  const rows = Array.isArray(data) ? data : [];
  return ok(
    rows
      .filter(
        (row): row is { user_id: string } =>
          typeof row === 'object' &&
          row !== null &&
          typeof (row as { user_id?: unknown }).user_id === 'string',
      )
      .map((row) => {
        const r = row as Record<string, unknown>;
        return {
          userId: row.user_id,
          displayName: typeof r['display_name'] === 'string' ? r['display_name'] : 'Someone',
          avatarUrl:
            typeof r['avatar_url'] === 'string' && r['avatar_url'] !== '' ? r['avatar_url'] : null,
          selectedBorderId:
            typeof r['selected_border_id'] === 'string' && r['selected_border_id'] !== ''
              ? r['selected_border_id']
              : null,
        };
      }),
  );
}

/** Withdraw from discovery immediately on leaving the room. Best-effort. */
export async function leaveLiveRoomSocial(roomCode: string): Promise<SocialResult<void>> {
  const code = validCode(roomCode);
  if (code === null) {
    return { status: 'forbidden' };
  }
  const { error } = await supabase.rpc('leave_live_room_social', { p_room_code: code });
  return error === null ? ok(undefined) : toFailure(error);
}
