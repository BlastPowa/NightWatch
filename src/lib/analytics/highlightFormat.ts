/**
 * Highlight formatting — pure, and deliberately free of any import that reaches
 * the Supabase client.
 *
 * HighlightService imports `@/lib/supabase`, which throws at module load when
 * the env vars are absent. That makes anything importing it untestable in CI,
 * where there is no .env. Keeping the pure half separate means the logic that
 * actually warrants tests can be tested without a database at all.
 *
 * COMPLIANCE: a highlight is a TIMESTAMP, never video. Every link produced here
 * points at the original video on youtube.com with a ?t= offset. Nothing
 * downloads, proxies, clips, or re-encodes a frame — see HighlightService.
 */

export interface Highlight {
  videoId: string;
  /** Where the clip starts — already pulled back by a lead-in server-side. */
  positionSeconds: number;
  /** How many reactions landed in this window. The ranking signal. */
  reactionCount: number;
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
    const reactions =
      highlight.reactionCount === 1 ? '1 reaction' : `${highlight.reactionCount} reactions`;
    return `- [${formatTimestamp(highlight.positionSeconds)}](${highlightLink(highlight)}) — ${reactions}`;
  });
  return `# Highlights\n\n${lines.join('\n')}\n`;
}
