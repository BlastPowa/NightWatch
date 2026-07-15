import { ok, toFailure, type SocialResult } from '@/lib/social/types';
import { supabase } from '@/lib/supabase';

/**
 * Phase 20B: friend presence, consent-gated.
 *
 * Both consent flags default FALSE (0006) — you are invisible until you say
 * otherwise. share_online exposes a coarse status; share_activity additionally
 * exposes the video title. The room code is NEVER exposed: presence tells your
 * friends that you are watching, not where to walk in on you.
 */

export type PresenceStatus = 'offline' | 'online' | 'watching' | 'in_party';

export interface FriendPresence {
  userId: string;
  displayName: string;
  status: PresenceStatus;
  /** Only present when that friend enabled share_activity. */
  videoTitle: string | null;
  updatedAt: string;
}

export interface PresencePreferences {
  shareOnline: boolean;
  shareActivity: boolean;
}

/**
 * Phase 24: a friend's presence enriched for the Browse "watch with a friend"
 * shelf. videoId is present only when that friend shares activity AND is
 * actually watching something; a room code is never part of this shape.
 */
export interface FriendMediaPresence {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  selectedBorderId: string | null;
  status: PresenceStatus;
  videoTitle: string | null;
  videoId: string | null;
  updatedAt: string;
}

/** Exactly an 11-character YouTube id, matching the server-side check. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Read the caller's consent flags. Missing rows use the privacy-first defaults. */
export async function getPresencePreferences(): Promise<SocialResult<PresencePreferences>> {
  const { data, error } = await supabase
    .from('presence_preferences')
    .select('share_online, share_activity')
    .maybeSingle();
  if (error !== null) {
    return toFailure(error);
  }
  const row = data as { share_online?: unknown; share_activity?: unknown } | null;
  return ok({
    shareOnline: row?.share_online === true,
    shareActivity: row?.share_activity === true,
  });
}

function toStatus(value: unknown): PresenceStatus {
  return value === 'online' || value === 'watching' || value === 'in_party' ? value : 'offline';
}

/** Publish your own status. A no-op server-side if you share nothing. */
export async function heartbeat(
  status: PresenceStatus,
  videoTitle: string | null = null,
): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc('heartbeat_presence', {
    p_status: status,
    p_video_title: videoTitle,
  });
  return error === null ? ok(undefined) : toFailure(error);
}

/**
 * Phase 24 heartbeat: publishes status plus, optionally, the video the caller
 * is watching. videoId is validated client-side before the call and again by
 * the RPC. Falls back to the coarse heartbeat contract when no id is shared.
 */
export async function heartbeatMedia(
  status: PresenceStatus,
  videoTitle: string | null = null,
  videoId: string | null = null,
): Promise<SocialResult<void>> {
  const safeId = typeof videoId === 'string' && YOUTUBE_ID.test(videoId) ? videoId : null;
  const { error } = await supabase.rpc('heartbeat_media_presence', {
    p_status: status,
    p_video_title: videoTitle,
    p_video_id: safeId,
  });
  return error === null ? ok(undefined) : toFailure(error);
}

/** Accepted friends only; consent- and block-filtered; may carry a video id. */
export async function getFriendMediaPresence(): Promise<SocialResult<FriendMediaPresence[]>> {
  const { data, error } = await supabase.rpc('get_friend_presence_v2');
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
        const rawId = r['video_id'];
        return {
          userId: row.user_id,
          displayName: typeof r['display_name'] === 'string' ? r['display_name'] : 'Someone',
          avatarUrl: typeof r['avatar_url'] === 'string' && r['avatar_url'] !== '' ? r['avatar_url'] : null,
          selectedBorderId:
            typeof r['selected_border_id'] === 'string' && r['selected_border_id'] !== ''
              ? r['selected_border_id']
              : null,
          status: toStatus(r['status']),
          videoTitle: typeof r['video_title'] === 'string' ? r['video_title'] : null,
          // Defend the client too: only surface an id the server shape-checks pass.
          videoId: typeof rawId === 'string' && YOUTUBE_ID.test(rawId) ? rawId : null,
          updatedAt: typeof r['updated_at'] === 'string' ? r['updated_at'] : '',
        };
      }),
  );
}

export async function setPresencePreferences(
  preferences: PresencePreferences,
): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc('set_presence_preferences', {
    p_share_online: preferences.shareOnline,
    p_share_activity: preferences.shareActivity,
  });
  return error === null ? ok(undefined) : toFailure(error);
}

/** Accepted friends only, filtered by their consent and by blocks. */
export async function getFriendPresence(): Promise<SocialResult<FriendPresence[]>> {
  const { data, error } = await supabase.rpc('get_friend_presence');
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
          status: toStatus(r['status']),
          videoTitle: typeof r['video_title'] === 'string' ? r['video_title'] : null,
          updatedAt: typeof r['updated_at'] === 'string' ? r['updated_at'] : '',
        };
      }),
  );
}
