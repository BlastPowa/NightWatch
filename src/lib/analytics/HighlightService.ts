import { supabase } from '@/lib/supabase';
import type { Highlight } from '@/lib/analytics/highlightFormat';

/**
 * Highlight reels (Phase 21, closing the Phase 16 gap).
 *
 * A highlight is the moment the room reacted hardest, derived server-side from
 * reaction density.
 *
 * COMPLIANCE — read before extending. A "reel" is a list of TIMESTAMPS, never
 * video. Nothing here downloads, proxies, clips, or re-encodes a frame:
 * playing a highlight seeks the official IFrame player, and exporting one
 * produces youtube.com links carrying a ?t= offset. The feature's name invites
 * exactly the mistake this comment exists to prevent — if a future change makes
 * bytes of video move through NightWatch, it is out of policy (CLAUDE.md), not
 * merely out of scope.
 *
 * The pure formatting lives in ./highlightFormat, which imports nothing: this
 * module reaches the Supabase client, and that throws at load when env vars are
 * absent, which would make anything importing it untestable in CI.
 */

export {
  exportHighlightsMarkdown,
  formatTimestamp,
  highlightLink,
  type Highlight,
} from '@/lib/analytics/highlightFormat';

/**
 * Highlights for one recorded session. Room owner only, enforced server-side.
 * Empty for a session with no clustered reactions — one person reacting once is
 * not a highlight, and a room that never reacted has no reel to show.
 */
export async function getSessionHighlights(
  sessionId: string,
  limit = 10,
): Promise<Highlight[]> {
  const { data, error } = await supabase.rpc('get_session_highlights', {
    p_session: sessionId,
    p_limit: limit,
  });
  if (error !== null || !Array.isArray(data)) {
    return [];
  }
  return (data as Record<string, unknown>[])
    .filter((row) => typeof row['video_id'] === 'string')
    .map((row) => ({
      videoId: String(row['video_id']),
      positionSeconds: Number(row['position_seconds'] ?? 0),
      reactionCount: Number(row['reaction_count'] ?? 0),
    }));
}
