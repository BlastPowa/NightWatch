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
