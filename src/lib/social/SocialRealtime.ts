import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Message } from '@/lib/social/MessagingService';
import { supabase } from '@/lib/supabase';

/**
 * Phase 20B realtime: live messages and friend requests.
 *
 * Authorisation is entirely server-side. These are `postgres_changes`
 * subscriptions, so Realtime replays committed rows through the same RLS
 * SELECT policies as the REST API — a subscriber cannot receive a row they
 * could not already have fetched, and nothing here trusts a client-supplied
 * payload. Removing someone from a conversation stops their stream with no
 * client cooperation.
 *
 * The row that arrives is the raw table row, which has no display_name (that
 * lives in player_stats). Rather than issue a join per event, names are
 * resolved from a cache the fetch path populates, falling back to 'Someone'.
 */

export type MessageChange =
  | { type: 'insert'; message: Message }
  | { type: 'update'; message: Message };

/** sender_id → display name, populated by MessagingService fetches. */
const nameCache = new Map<string, string>();

export function cacheDisplayName(userId: string, displayName: string): void {
  if (userId !== '' && displayName !== '') {
    nameCache.set(userId, displayName);
  }
}

interface MessageRow {
  id?: unknown;
  seq?: unknown;
  sender_id?: unknown;
  kind?: unknown;
  body?: unknown;
  created_at?: unknown;
  edited_at?: unknown;
  deleted_at?: unknown;
}

function toMessage(row: MessageRow): Message | null {
  if (typeof row.id !== 'string' || typeof row.sender_id !== 'string') {
    return null;
  }
  const deletedAt = typeof row.deleted_at === 'string' ? row.deleted_at : null;
  return {
    id: row.id,
    seq: Number(row.seq ?? 0),
    senderId: row.sender_id,
    displayName: nameCache.get(row.sender_id) ?? 'Someone',
    kind: row.kind === 'system' ? 'system' : 'message',
    // A soft-deleted row still carries its body in the WAL; the REST path
    // blanks it, so the realtime path must blank it too or a deleted message
    // would leak through the live stream.
    body: deletedAt === null && typeof row.body === 'string' ? row.body : '',
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    editedAt: typeof row.edited_at === 'string' ? row.edited_at : null,
    deletedAt,
  };
}

/**
 * Live messages for one conversation. Emits inserts, edits, and soft deletes.
 * Returns an unsubscribe function.
 */
export function subscribeToConversation(
  conversationId: string,
  onChange: (change: MessageChange) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`social:messages:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const message = toMessage(payload.new as MessageRow);
        if (message !== null) {
          onChange({ type: 'insert', message });
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const message = toMessage(payload.new as MessageRow);
        if (message !== null) {
          onChange({ type: 'update', message });
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Live friend-request activity addressed to you. RLS restricts this to rows
 * where you are the sender or recipient, so no filter is needed here — and a
 * blocked user's cancelled request simply stops arriving.
 *
 * Carries no payload beyond "something changed": the UI should re-read
 * getSocialGraph(), which applies the block filter. Acting on the raw row would
 * bypass that.
 */
export function subscribeToFriendRequests(onChange: () => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel('social:friend-requests')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'friend_requests' },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Live notifications (0013). RLS restricts `notifications` to rows addressed to
 * you, so no filter is needed — you cannot subscribe to someone else's bell.
 *
 * INSERT only. Mark-read is an UPDATE the client itself just made, so replaying
 * it would only fight the optimistic state the UI already applied.
 *
 * Like friend requests, this carries no payload beyond "something arrived":
 * re-read listNotifications()/countUnreadNotifications() rather than acting on
 * the raw row, so the badge stays consistent with what the list actually shows.
 */
export function subscribeToNotifications(onArrive: () => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel('social:notifications')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      () => onArrive(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
