import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  exportHighlightsMarkdown,
  formatTimestamp,
  getSessionHighlights,
  type Highlight,
} from '@/lib/analytics/HighlightService';

interface HighlightReelPanelProps {
  sessionId: string;
  onSeek: (videoId: string, seconds: number) => void;
}

type CopyState = 'idle' | 'copied' | 'error';

/**
 * A timestamp-only highlight reel. Playback always stays in the official
 * player through onSeek; this component never fetches or exports video media.
 */
export function HighlightReelPanel({
  sessionId,
  onSeek,
}: HighlightReelPanelProps): JSX.Element {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  useEffect(() => {
    let active = true;

    setLoading(true);
    setLoadError(false);
    setCopyState('idle');

    void getSessionHighlights(sessionId)
      .then((nextHighlights) => {
        if (active) {
          setHighlights(nextHighlights);
        }
      })
      .catch(() => {
        if (active) {
          setHighlights([]);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [sessionId]);

  async function copyMarkdown(): Promise<void> {
    try {
      await navigator.clipboard.writeText(exportHighlightsMarkdown(highlights));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <section className="highlight-reel-panel card" aria-labelledby="highlight-reel-title">
      <header className="highlight-reel-header">
        <div>
          <span className="eyebrow">Reaction peaks</span>
          <h2 id="highlight-reel-title">Highlight reel</h2>
          <p>Jump back to the moments that got the room reacting.</p>
        </div>
        {!loading && !loadError && highlights.length > 0 && (
          <button
            type="button"
            className="button highlight-reel-copy"
            onClick={() => void copyMarkdown()}
          >
            <Icon name={copyState === 'copied' ? 'check' : 'send'} size={16} />
            {copyState === 'copied' ? 'Copied Markdown' : 'Copy Markdown'}
          </button>
        )}
      </header>

      {loading && (
        <div className="highlight-reel-state highlight-reel-loading" role="status">
          <span className="loader-orbit" />
          Loading highlights…
        </div>
      )}

      {!loading && loadError && (
        <div className="highlight-reel-state highlight-reel-error" role="alert">
          <Icon name="info" size={24} />
          <strong>Highlights could not be loaded</strong>
          <p>Try opening this session again.</p>
        </div>
      )}

      {!loading && !loadError && highlights.length === 0 && (
        <div className="highlight-reel-state highlight-reel-empty" role="status">
          <Icon name="sparkle" size={26} />
          <strong>No highlights yet</strong>
          <p>A reel appears when reactions cluster around the same moment.</p>
        </div>
      )}

      {!loading && !loadError && highlights.length > 0 && (
        <ol className="highlight-reel-list">
          {highlights.map((highlight, index) => (
            <li
              key={`${highlight.videoId}-${highlight.positionSeconds}-${index}`}
              className="highlight-reel-item"
            >
              <span className="highlight-reel-rank">{String(index + 1).padStart(2, '0')}</span>
              <div className="highlight-reel-details">
                <strong>{formatTimestamp(highlight.positionSeconds)}</strong>
                <small>
                  {highlight.reactionCount} reaction{highlight.reactionCount === 1 ? '' : 's'}
                </small>
              </div>
              <button
                type="button"
                className="button button-primary highlight-reel-play"
                onClick={() => onSeek(highlight.videoId, highlight.positionSeconds)}
                aria-label={`Play highlight ${index + 1} from ${formatTimestamp(highlight.positionSeconds)}`}
              >
                <Icon name="play" size={16} />
                Play
              </button>
            </li>
          ))}
        </ol>
      )}

      {copyState === 'error' && (
        <p className="highlight-reel-copy-error" role="alert">
          Clipboard access failed. Check the app's clipboard permission and try again.
        </p>
      )}
    </section>
  );
}
