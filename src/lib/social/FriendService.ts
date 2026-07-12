import { getCloudSyncState, whenSyncReady } from '@/lib/engagement/CloudSync';
import { ok, toFailure, type SocialResult } from '@/lib/social/types';
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

/* -------------------------------------------------------------------------
 * Phase 20B: the real friend graph — requests, friendships, blocks.
 * Every transition is idempotent and block-aware server-side (0007); this
 * layer only maps results onto the typed union.
 * ---------------------------------------------------------------------- */

/** A person in your social graph, and how they relate to you. */
export type RelationKind = 'friend' | 'incoming' | 'outgoing' | 'suggestion';

export interface Relation {
  kind: RelationKind;
  userId: string;
  displayName: string;
  /** Present for incoming/outgoing requests only. */
  requestId: string | null;
  createdAt: string;
}

export interface SocialGraph {
  friends: Relation[];
  incoming: Relation[];
  outgoing: Relation[];
  /** Phase 19 co-watchers who are not yet friends. */
  suggestions: Relation[];
}

interface GraphRow {
  kind?: unknown;
  user_id?: unknown;
  display_name?: unknown;
  request_id?: unknown;
  created_at?: unknown;
}

function toRelation(row: GraphRow): Relation | null {
  const kind = row.kind;
  if (
    (kind !== 'friend' && kind !== 'incoming' && kind !== 'outgoing' && kind !== 'suggestion') ||
    typeof row.user_id !== 'string'
  ) {
    return null;
  }
  return {
    kind,
    userId: row.user_id,
    displayName: typeof row.display_name === 'string' ? row.display_name : 'Someone',
    requestId: typeof row.request_id === 'string' ? row.request_id : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

/**
 * The four collections the handoff requires, kept separate: a suggestion is
 * not a friend, and the UI must not conflate them.
 */
export async function getSocialGraph(): Promise<SocialResult<SocialGraph>> {
  const { data, error } = await supabase.rpc('get_social_graph');
  if (error !== null) {
    return toFailure(error);
  }

  const graph: SocialGraph = { friends: [], incoming: [], outgoing: [], suggestions: [] };
  for (const row of Array.isArray(data) ? (data as GraphRow[]) : []) {
    const relation = toRelation(row);
    if (relation === null) {
      continue;
    }
    if (relation.kind === 'friend') {
      graph.friends.push(relation);
    } else if (relation.kind === 'incoming') {
      graph.incoming.push(relation);
    } else if (relation.kind === 'outgoing') {
      graph.outgoing.push(relation);
    } else {
      graph.suggestions.push(relation);
    }
  }
  return ok(graph);
}

async function transition(fn: string, args: Record<string, unknown>): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc(fn, args);
  return error === null ? ok(undefined) : toFailure(error);
}

export function sendFriendRequest(userId: string): Promise<SocialResult<void>> {
  return transition('send_friend_request', { p_recipient: userId });
}

export function acceptFriendRequest(senderId: string): Promise<SocialResult<void>> {
  return transition('accept_friend_request', { p_sender: senderId });
}

export function declineFriendRequest(senderId: string): Promise<SocialResult<void>> {
  return transition('decline_friend_request', { p_sender: senderId });
}

export function cancelFriendRequest(recipientId: string): Promise<SocialResult<void>> {
  return transition('cancel_friend_request', { p_recipient: recipientId });
}

export function removeFriend(userId: string): Promise<SocialResult<void>> {
  return transition('remove_friend', { p_user: userId });
}

/** Severs the friendship and any pending requests, in both directions. */
export function blockUser(userId: string): Promise<SocialResult<void>> {
  return transition('block_user', { p_user: userId });
}

/** Unblocking does not restore the friendship — it must be re-requested. */
export function unblockUser(userId: string): Promise<SocialResult<void>> {
  return transition('unblock_user', { p_user: userId });
}
