import { getCloudSyncState, whenSyncReady } from '@/lib/engagement/CloudSync';
import { supabase } from '@/lib/supabase';

/**
 * Phase 19: the co-watcher graph behind the friend leaderboard.
 *
 * "Friends" are simply the people you have shared a persistent room with. That
 * relationship is the only thing recorded — never what you watched, never when
 * beyond a last-seen timestamp.
 *
 * Consent (see 0005_social.sql): we write a participation row only for a
 * signed-in user who has opted into sharing stats. Guests and opted-out users
 * leave no trace, which does mean their leaderboard stays empty — that is the
 * intended trade, not a bug.
 */

/** Rooms we have already recorded this session; avoids redundant upserts. */
const recorded = new Set<string>();

export function resetParticipationCache(): void {
  recorded.clear();
}

/**
 * Note that the signed-in user was present in a room. Ephemeral rooms have no
 * `rooms` row, so the foreign key rejects them and nothing is recorded — the
 * friend graph is built from persistent rooms only. Failures are deliberately
 * silent: this is ambient bookkeeping and must never break joining a room.
 */
export async function recordParticipation(roomCode: string): Promise<void> {
  if (recorded.has(roomCode)) {
    return;
  }
  // Consent is only knowable once the cloud row has loaded. Joining via a deep
  // link on a cold start beats sign-in to this point, and shareStats defaults
  // to true — so without this gate an opted-out user could be recorded.
  await whenSyncReady();

  const { synced, shareStats } = getCloudSyncState();
  if (!synced || !shareStats || recorded.has(roomCode)) {
    return;
  }
  recorded.add(roomCode);

  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (userId === undefined) {
    recorded.delete(roomCode);
    return;
  }

  const { error } = await supabase.from('room_participants').upsert(
    { room_code: roomCode, user_id: userId, last_seen_at: new Date().toISOString() },
    { onConflict: 'room_code,user_id' },
  );
  if (error !== null) {
    // Ephemeral room (FK violation) or offline — retry is pointless either way,
    // but allow a later attempt in this session.
    recorded.delete(roomCode);
  }
}
