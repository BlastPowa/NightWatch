import { useEffect, useState, type FormEvent } from 'react';
import {
  getTrending,
  searchYouTube,
  TRENDING_CATEGORIES,
  type SearchResult,
} from '@/lib/search/SearchService';
import { listHistory } from '@/lib/rooms/HistoryService';

interface DiscoveryPanelProps {
  callerId: string;
  isHost: boolean;
  roomCode: string;
  onPlayNow(videoId: string): void;
  onQueueAdd(videoId: string, title: string): boolean;
}

type DiscoveryTab = 'search' | 'trending' | 'history';

const OUTCOME_MESSAGE: Record<string, string> = {
  'not-configured': 'Search is not set up yet (Edge Function not deployed).',
  'rate-limited': 'Daily limit reached — try again tomorrow.',
  error: 'Could not load videos. Check your connection.',
};

/**
 * TEMPORARY Discovery Hub grid (Phase 16) — functional placeholder for the
 * frontend lane to restyle. Search / Trending / Previously-watched with
 * Play now (host) and Add to queue (everyone).
 */
export function DiscoveryPanel({
  callerId,
  isHost,
  roomCode,
  onPlayNow,
  onQueueAdd,
}: DiscoveryPanelProps): JSX.Element {
  const [tab, setTab] = useState<DiscoveryTab>('trending');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);

  async function runTrending(categoryId: string): Promise<void> {
    setLoading(true);
    setMessage(null);
    const outcome = await getTrending(categoryId, callerId);
    setLoading(false);
    if (outcome.status === 'ok') {
      setResults(outcome.results);
      setMessage(outcome.results.length === 0 ? 'Nothing trending right now.' : null);
    } else {
      setResults([]);
      setMessage(OUTCOME_MESSAGE[outcome.status] ?? 'Failed.');
    }
  }

  async function runHistory(): Promise<void> {
    setLoading(true);
    setMessage(null);
    const entries = await listHistory(roomCode);
    setLoading(false);
    setResults(
      entries.map((entry) => ({
        videoId: entry.videoId,
        title: entry.title,
        channelTitle: '',
        thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/mqdefault.jpg`,
        durationText: '',
      })),
    );
    setMessage(
      entries.length === 0
        ? 'No history yet — persistent rooms remember what you watch.'
        : null,
    );
  }

  async function handleSearch(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (loading || query.trim().length === 0) {
      return;
    }
    setLoading(true);
    setMessage(null);
    const outcome = await searchYouTube(query, callerId);
    setLoading(false);
    if (outcome.status === 'ok') {
      setResults(outcome.results);
      setMessage(outcome.results.length === 0 ? 'No results.' : null);
    } else {
      setResults([]);
      setMessage(OUTCOME_MESSAGE[outcome.status] ?? 'Search failed.');
    }
  }

  function switchTab(next: DiscoveryTab): void {
    setTab(next);
    setResults([]);
    setMessage(null);
    if (next === 'trending') {
      void runTrending(category);
    } else if (next === 'history') {
      void runHistory();
    }
  }

  // Initial load: trending.
  useEffect(() => {
    void runTrending('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleQueue(result: SearchResult): void {
    if (onQueueAdd(result.videoId, result.title)) {
      setQueuedId(result.videoId);
      window.setTimeout(() => setQueuedId(null), 1500);
    }
  }

  return (
    <div className="discovery-panel">
      <div className="source-tabs">
        {(['trending', 'search', 'history'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`source-tab${tab === t ? ' source-tab-active' : ''}`}
            onClick={() => switchTab(t)}
          >
            {t === 'trending' ? 'Trending' : t === 'search' ? 'Search' : 'Previously watched'}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <form className="player-form" onSubmit={(e) => void handleSearch(e)}>
          <input
            className="input"
            value={query}
            placeholder="Search YouTube…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="button" disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
      )}

      {tab === 'trending' && (
        <div className="category-chips">
          {TRENDING_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`source-tab${category === c.id ? ' source-tab-active' : ''}`}
              onClick={() => {
                setCategory(c.id);
                void runTrending(c.id);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="player-viewer-note">Loading…</p>}
      {message !== null && <p className="player-viewer-note">{message}</p>}

      {results.length > 0 && (
        <ul className="discovery-grid">
          {results.map((result) => (
            <li key={result.videoId} className="discovery-card">
              {result.thumbnailUrl !== '' && (
                <img className="discovery-thumb" src={result.thumbnailUrl} alt="" />
              )}
              <div className="discovery-info">
                <span className="discovery-title" title={result.title}>
                  {result.title}
                </span>
                <span className="discovery-meta">
                  {result.channelTitle}
                  {result.durationText !== '' && ` · ${result.durationText}`}
                </span>
              </div>
              <div className="discovery-actions">
                {isHost && (
                  <button
                    type="button"
                    className="button button-primary discovery-btn"
                    onClick={() => onPlayNow(result.videoId)}
                  >
                    ▶ Play
                  </button>
                )}
                <button
                  type="button"
                  className="button discovery-btn"
                  onClick={() => handleQueue(result)}
                >
                  {queuedId === result.videoId ? 'Queued ✓' : '+ Queue'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
