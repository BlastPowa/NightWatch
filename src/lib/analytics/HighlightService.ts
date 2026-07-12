import { supabase } from '@/lib/supabase';

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
 */

export interface Highlight {
  videoId: string;
  /** Where the clip starts — already pulled back by a lead-in server-side. */
  positionSeconds: number;
  /** How many reactions landed in this window. The ranking signal. */
  reactionCount: number;
}

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

/** "1:04:07" / "4:07" — YouTube's own convention, so it reads as expected. */
export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(secs).padStart(2, '0')}`;
}

/** A deep link into the original video at the highlight. Never a media URL. */
export function highlightLink(highlight: Highlight): string {
  return `https://www.youtube.com/watch?v=${highlight.videoId}&t=${Math.floor(
    highlight.positionSeconds,
  )}s`;
}

/**
 * The exported reel: Markdown, because it pastes into a Discord message, a
 * YouTube description, or a stream's show notes without conversion — which is
 * what people actually do with a highlight list.
 */
export function exportHighlightsMarkdown(highlights: readonly Highlight[]): string {
  if (highlights.length === 0) {
    return '# Highlights\n\nNo highlights — the room never reacted in a cluster.\n';
  }
  const lines = highlights.map((highlight) => {
    const reactions = highlight.reactionCount === 1 ? '1 reaction' : `${highlight.reactionCount} reactions`;
    return `- [${formatTimestamp(highlight.positionSeconds)}](${highlightLink(highlight)}) — ${reactions}`;
  });
  return `# Highlights\n\n${lines.join('\n')}\n`;
}
