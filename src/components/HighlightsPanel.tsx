import { useEffect, useState } from 'react';
import {
  exportHighlightsMarkdown,
  formatTimestamp,
  getSessionHighlights,
  highlightLink,
  type Highlight,
} from '@/lib/analytics/HighlightService';

/**
 * TEMPORARY SCAFFOLD — Phase 21. Structure is real; the styling is not.
 *
 * FOR THE FRONTEND LANE: restyle freely. Everything below the data layer is
 * yours to throw away. What is worth keeping:
 *
 *   - `useHighlights` holds all the data logic and returns plain state. Rebuild
 *     the markup around it and you do not have to touch a single call.
 *   - The class names (`highlights-*`) are placeholders. Rename them.
 *   - An empty reel is a real, common state, not an error: most rooms never
 *     react in a cluster. Design for it rather than hiding it.
 *
 * COMPLIANCE — do not "improve" this into a clip exporter. A highlight is a
 * TIMESTAMP, never video. Play seeks the official IFrame player; Export copies
 * youtube.com links with a ?t= offset. Nothing downloads, proxies, or
 * re-encodes a frame, and adding an affordance that implies otherwise puts the
 * project out of policy (CLAUDE.md), not merely out of scope.
 */

interface HighlightsPanelProps {
  /** The recorded session to derive a reel from. */
  sessionId: string;
  /** Seek the room's player. Absent for a viewer, who cannot drive playback. */
  onSeek?: (videoId: string, positionSeconds: number) => void;
}

function useHighlights(sessionId: string): { highlights: Highlight[]; loading: boolean } {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getSessionHighlights(sessionId).then((result) => {
      if (active) {
        setHighlights(result);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [sessionId]);

  return { highlights, loading };
}

export function HighlightsPanel({ sessionId, onSeek }: HighlightsPanelProps): JSX.Element {
  const { highlights, loading } = useHighlights(sessionId);
  const [copied, setCopied] = useState(false);

  async function copyReel(): Promise<void> {
    try {
      await navigator.clipboard.writeText(exportHighlightsMarkdown(highlights));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; failing silently beats a scary dialog
      // over a convenience feature.
    }
  }

  if (loading) {
    return <p className="highlights-empty">Finding the moments the room reacted to…</p>;
  }

  if (highlights.length === 0) {
    return (
      <p className="highlights-empty">
        No highlights yet — a moment needs more than one reaction to count as one.
      </p>
    );
  }

  return (
    <section className="highlights">
      <header className="highlights-head">
        <h3>Highlights</h3>
        <button type="button" className="button" onClick={() => void copyReel()}>
          {copied ? 'Copied' : 'Copy reel'}
        </button>
      </header>

      <ol className="highlights-list">
        {highlights.map((highlight) => (
          <li key={`${highlight.videoId}-${highlight.positionSeconds}`} className="highlights-item">
            <span className="highlights-time">{formatTimestamp(highlight.positionSeconds)}</span>
            <span className="highlights-count">
              {highlight.reactionCount} {highlight.reactionCount === 1 ? 'reaction' : 'reactions'}
            </span>
            {onSeek !== undefined ? (
              <button
                type="button"
                className="button"
                onClick={() => onSeek(highlight.videoId, highlight.positionSeconds)}
              >
                Play
              </button>
            ) : (
              // No player to drive: fall back to the original video on YouTube.
              <a
                className="button"
                href={highlightLink(highlight)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
