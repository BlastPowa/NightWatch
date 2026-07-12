import { ok, toFailure, type SocialResult } from '@/lib/social/types';
import { supabase } from '@/lib/supabase';

/**
 * Phase 23: privacy-safe social profiles, block management, conversation member
 * profiles, and friend-to-room invitations.
 *
 * Every field on a profile is separately permitted server-side. Nothing here
 * hands you "the user row" to filter yourself — if a field is absent, you were
 * not allowed to see it, and there is no client-side way to recover it.
 */

export interface ProfileStats {
  roomsJoined: number;
  watchSeconds: number;
  reactionsSent: number;
  streakDays: number;
}

export interface ProfileAchievement {
  id: string;
  unlockedAt: string;
}

export interface MutualRoom {
  code: string;
  name: string;
}

export interface SocialProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  selectedBorderId: string | null;
  isSelf: boolean;
  isFriend: boolean;
  /** Whether you may DM them. False for non-friends. */
  canMessage: boolean;
  /** Whether you may invite them to a persistent room. */
  canInvite: boolean;
  sharesStats: boolean;
  sharesAchievements: boolean;
  /** Absent unless they opted in (or it is you). */
  stats?: ProfileStats;
  /** Absent unless they opted in (or it is you). */
  achievements?: ProfileAchievement[];
  /** Rooms you can BOTH reach. Absent for non-friends. */
  mutualRooms?: MutualRoom[];
}

export interface BlockedUser {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
}

export interface ConversationMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  selectedBorderId: string | null;
  role: 'owner' | 'moderator' | 'member';
  joinedAt: string;
}

export interface RoomInvite {
  id: string;
  roomCode: string;
  roomName: string;
  inviterId: string;
  inviterName: string;
  inviterAvatar: string | null;
  createdAt: string;
  expiresAt: string;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

async function transition(fn: string, args: Record<string, unknown>): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc(fn, args);
  return error === null ? ok(undefined) : toFailure(error);
}

/**
 * A profile. Returns `blocked` when a block stands between you — not an empty
 * profile, because the existence of the row is itself information.
 */
export async function getSocialProfile(userId: string): Promise<SocialResult<SocialProfile>> {
  const { data, error } = await supabase.rpc('get_social_profile', { p_user: userId });
  if (error !== null) {
    return toFailure(error);
  }
  const raw = (data ?? {}) as Record<string, unknown>;
  return ok({
    userId: str(raw['userId'], userId),
    displayName: str(raw['displayName'], 'Someone'),
    avatarUrl: nullableStr(raw['avatarUrl']),
    selectedBorderId: nullableStr(raw['selectedBorderId']),
    isSelf: raw['isSelf'] === true,
    isFriend: raw['isFriend'] === true,
    canMessage: raw['canMessage'] === true,
    canInvite: raw['canInvite'] === true,
    sharesStats: raw['sharesStats'] === true,
    sharesAchievements: raw['sharesAchievements'] === true,
    ...(raw['stats'] !== undefined ? { stats: raw['stats'] as ProfileStats } : {}),
    ...(raw['achievements'] !== undefined
      ? { achievements: raw['achievements'] as ProfileAchievement[] }
      : {}),
    ...(raw['mutualRooms'] !== undefined
      ? { mutualRooms: raw['mutualRooms'] as MutualRoom[] }
      : {}),
  });
}

/** The real block list. Do not keep a client-side shadow copy — it goes stale
 *  the moment the user blocks someone on another device. */
export async function listBlockedUsers(): Promise<SocialResult<BlockedUser[]>> {
  const { data, error } = await supabase.rpc('list_blocked_users');
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['user_id'] === 'string')
      .map((row) => ({
        userId: str(row['user_id']),
        displayName: str(row['display_name'], 'Someone'),
        avatarUrl: nullableStr(row['avatar_url']),
        blockedAt: str(row['blocked_at']),
      })),
  );
}

/** Members of a group you are in. Membership is the authorisation, so removal
 *  revokes it. No more shortened-UUID fallback for non-friends. */
export async function getConversationMembers(
  conversationId: string,
): Promise<SocialResult<ConversationMember[]>> {
  const { data, error } = await supabase.rpc('get_conversation_members', {
    p_conversation: conversationId,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['user_id'] === 'string')
      .map((row) => ({
        userId: str(row['user_id']),
        displayName: str(row['display_name'], 'Someone'),
        avatarUrl: nullableStr(row['avatar_url']),
        selectedBorderId: nullableStr(row['selected_border_id']),
        role: (row['role'] === 'owner' || row['role'] === 'moderator'
          ? row['role']
          : 'member') as ConversationMember['role'],
        joinedAt: str(row['joined_at']),
      })),
  );
}

/* --------------------------- Room invitations ------------------------------ */

/** Invite a friend to a persistent room you can reach. Expires in 7 days. */
export async function inviteFriendToRoom(
  roomCode: string,
  userId: string,
): Promise<SocialResult<string>> {
  const { data, error } = await supabase.rpc('invite_friend_to_room', {
    p_room: roomCode,
    p_user: userId,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return ok(String(data ?? ''));
}

export function respondToRoomInvite(
  inviteId: string,
  accept: boolean,
): Promise<SocialResult<void>> {
  return transition('respond_room_invite', { p_invite: inviteId, p_accept: accept });
}

/** The inviter withdrawing an invitation they sent. Idempotent. */
export function revokeRoomInvite(inviteId: string): Promise<SocialResult<void>> {
  return transition('revoke_room_invite', { p_invite: inviteId });
}

/** Pending invitations addressed to you. Expired ones never appear. */
export async function listRoomInvites(): Promise<SocialResult<RoomInvite[]>> {
  const { data, error } = await supabase.rpc('list_room_invites');
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: str(row['id']),
        roomCode: str(row['room_code']),
        roomName: str(row['room_name']),
        inviterId: str(row['inviter_id']),
        inviterName: str(row['inviter_name'], 'Someone'),
        inviterAvatar: nullableStr(row['inviter_avatar']),
        createdAt: str(row['created_at']),
        expiresAt: str(row['expires_at']),
      })),
  );
}

/* ------------------------------ Own profile -------------------------------- */

/** Publish your Discord avatar. The server enforces a host allowlist: an
 *  arbitrary URL would be a tracking beacon in other users' clients. */
export function setProfileAvatar(url: string | null): Promise<SocialResult<void>> {
  return transition('set_profile_avatar', { p_url: url });
}

/** Opt in/out of showing your achievements. Separate from stats consent. */
export function setShareAchievements(share: boolean): Promise<SocialResult<void>> {
  return transition('set_share_achievements', { p_share: share });
}
