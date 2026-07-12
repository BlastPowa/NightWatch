import { cacheDisplayName } from '@/lib/social/SocialRealtime';
import { ok, toFailure, type SocialResult } from '@/lib/social/types';
import { supabase } from '@/lib/supabase';

/**
 * Phase 20B: direct and group conversations.
 *
 * All authorisation is server-side (0007): direct conversations require an
 * accepted friendship, group invites require friendship with the inviter, the
 * 30-member cap is enforced transactionally, and a block silences a direct
 * conversation that already exists. Deletion is always soft — a removed
 * message keeps its row so message cursors stay stable, but never returns its
 * body.
 */

export type ConversationKind = 'direct' | 'group';
export type MemberRole = 'owner' | 'moderator' | 'member';

export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string | null;
  ownerId: string;
  updatedAt: string;
  unreadCount: number;
}

/**
 * An active member of a conversation. Display names intentionally do not live
 * here: player_stats is private under RLS, so callers should resolve names only
 * from relationships the viewer may already see (for example getSocialGraph).
 */
export interface ConversationMember {
  userId: string;
  role: MemberRole;
  joinedAt: string;
}

export interface Message {
  id: string;
  /**
   * Monotonic order key. Cursor paging uses this, not createdAt: created_at is
   * the transaction timestamp, so two messages can share it exactly, and the
   * UUID tiebreak is random — which made ordering (and therefore paging)
   * non-deterministic under ties.
   */
  seq: number;
  senderId: string;
  displayName: string;
  kind: 'message' | 'system';
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Soft-deleted messages arrive with an empty body and this set. */
  deletedAt: string | null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function listConversations(): Promise<SocialResult<Conversation[]>> {
  const { data, error } = await supabase.rpc('list_conversations');
  if (error !== null) {
    return toFailure(error);
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return ok(
    rows
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: str(row['id']),
        kind: row['kind'] === 'group' ? 'group' : 'direct',
        title: nullableStr(row['title']),
        ownerId: str(row['owner_id']),
        updatedAt: str(row['updated_at']),
        unreadCount: Number(row['unread_count'] ?? 0),
      })),
  );
}

/**
 * List the active roster through conversation_members' member-select policy.
 * RLS permits this only while the caller is themselves an active member; it
 * does not broaden access to private player_stats rows.
 */
export async function listConversationMembers(
  conversationId: string,
): Promise<SocialResult<ConversationMember[]>> {
  const { data, error } = await supabase
    .from('conversation_members')
    .select('user_id, role, joined_at')
    .eq('conversation_id', conversationId)
    .is('left_at', null)
    .order('joined_at', { ascending: true });
  if (error !== null) {
    return toFailure(error);
  }

  const members: ConversationMember[] = [];
  for (const row of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) {
    const role = row['role'];
    if (
      typeof row['user_id'] !== 'string' ||
      (role !== 'owner' && role !== 'moderator' && role !== 'member')
    ) {
      continue;
    }
    members.push({
      userId: row['user_id'],
      role,
      joinedAt: str(row['joined_at']),
    });
  }
  return ok(members);
}

/**
 * Page backwards from a fixed point rather than by offset, so pagination stays
 * stable while new messages arrive. Pass the lowest `seq` you already hold to
 * fetch older messages.
 */
export async function getMessages(
  conversationId: string,
  beforeSeq: number | null = null,
  limit = 50,
): Promise<SocialResult<Message[]>> {
  const { data, error } = await supabase.rpc('get_messages', {
    p_conversation: conversationId,
    p_before_seq: beforeSeq,
    p_limit: limit,
  });
  if (error !== null) {
    return toFailure(error);
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const messages = rows
    .filter((row) => typeof row['id'] === 'string')
    .map((row) => ({
      id: str(row['id']),
      seq: Number(row['seq'] ?? 0),
      senderId: str(row['sender_id']),
      displayName: str(row['display_name'], 'Someone'),
      kind: row['kind'] === 'system' ? ('system' as const) : ('message' as const),
      body: str(row['body']),
      createdAt: str(row['created_at']),
      editedAt: nullableStr(row['edited_at']),
      deletedAt: nullableStr(row['deleted_at']),
    }));

  // Realtime rows are raw table rows with no display_name — seed the cache the
  // live path reads from, so a streamed message shows a name rather than
  // 'Someone'.
  for (const message of messages) {
    cacheDisplayName(message.senderId, message.displayName);
  }
  return ok(messages);
}

export async function createDirectConversation(userId: string): Promise<SocialResult<string>> {
  const { data, error } = await supabase.rpc('create_direct_conversation', { p_user: userId });
  if (error !== null) {
    return toFailure(error);
  }
  return typeof data === 'string' ? ok(data) : { status: 'error' };
}

export async function createGroupConversation(title: string): Promise<SocialResult<string>> {
  const { data, error } = await supabase.rpc('create_group_conversation', { p_title: title });
  if (error !== null) {
    return toFailure(error);
  }
  return typeof data === 'string' ? ok(data) : { status: 'error' };
}

export async function sendMessage(
  conversationId: string,
  body: string,
): Promise<SocialResult<string>> {
  const { data, error } = await supabase.rpc('send_message', {
    p_conversation: conversationId,
    p_body: body,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return typeof data === 'string' ? ok(data) : { status: 'error' };
}

async function transition(fn: string, args: Record<string, unknown>): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc(fn, args);
  return error === null ? ok(undefined) : toFailure(error);
}

export function editMessage(messageId: string, body: string): Promise<SocialResult<void>> {
  return transition('edit_message', { p_message: messageId, p_body: body });
}

export function deleteMessage(messageId: string): Promise<SocialResult<void>> {
  return transition('delete_message', { p_message: messageId });
}

export function markConversationRead(
  conversationId: string,
  messageId: string,
): Promise<SocialResult<void>> {
  return transition('mark_conversation_read', {
    p_conversation: conversationId,
    p_message: messageId,
  });
}

export function renameGroup(conversationId: string, title: string): Promise<SocialResult<void>> {
  return transition('rename_group', { p_conversation: conversationId, p_title: title });
}

export function addGroupMember(
  conversationId: string,
  userId: string,
): Promise<SocialResult<void>> {
  return transition('add_group_member', { p_conversation: conversationId, p_user: userId });
}

export function removeGroupMember(
  conversationId: string,
  userId: string,
): Promise<SocialResult<void>> {
  return transition('remove_group_member', { p_conversation: conversationId, p_user: userId });
}

/**
 * Promote or demote a group moderator. Owner-only: letting moderators appoint
 * moderators is how a group gets taken over by whoever was trusted first.
 * Ownership itself moves through transferOwnership, not this.
 */
export function setConversationRole(
  conversationId: string,
  userId: string,
  role: 'moderator' | 'member',
): Promise<SocialResult<void>> {
  return transition('set_conversation_role', {
    p_conversation: conversationId,
    p_user: userId,
    p_role: role,
  });
}

/** The owner cannot leave — transfer ownership first. */
export function leaveConversation(conversationId: string): Promise<SocialResult<void>> {
  return transition('leave_conversation', { p_conversation: conversationId });
}

export function transferOwnership(
  conversationId: string,
  userId: string,
): Promise<SocialResult<void>> {
  return transition('transfer_conversation_ownership', {
    p_conversation: conversationId,
    p_user: userId,
  });
}
