import { useEffect, useState, type FormEvent, type SyntheticEvent } from 'react';
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
  const [visibleCount, setVisibleCount] = useState(11);

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
    setVisibleCount(11);
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

  const featured = tab === 'trending' ? results[0] : undefined;
  const libraryResults = featured === undefined ? results : results.slice(1);
  const visibleResults = libraryResults.slice(0, visibleCount);

  function handleThumbnailError(event: SyntheticEvent<HTMLImageElement>): void {
    event.currentTarget.hidden = true;
    event.currentTarget.parentElement?.classList.add('thumbnail-unavailable');
  }

  return (
    <div className="discovery-panel">
      <header className="discovery-hero">
        <div>
          <span className="eyebrow">NightWatch discovery</span>
          <h2>{tab === 'trending' ? 'What everyone is watching' : tab === 'search' ? 'Find your next watch' : 'Return to room favorites'}</h2>
          <p>Browse together, then play now or build the room queue.</p>
        </div>
        <div className="source-tabs" role="tablist" aria-label="Discovery views">
        {(['trending', 'search', 'history'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`source-tab${tab === t ? ' source-tab-active' : ''}`}
            onClick={() => switchTab(t)}
            role="tab"
            aria-selected={tab === t}
          >
            {t === 'trending' ? 'Trending' : t === 'search' ? 'Search' : 'Previously watched'}
          </button>
        ))}
        </div>
      </header>

      {featured !== undefined && !loading && (
        <section className="discovery-feature" aria-labelledby="featured-title">
          <img src={featured.thumbnailUrl} alt="" className="discovery-feature-art" onError={handleThumbnailError} />
          <div className="discovery-feature-shade" />
          <div className="discovery-feature-content">
            <span className="eyebrow">Featured tonight</span>
            <h3 id="featured-title">{featured.title}</h3>
            <p>{featured.channelTitle || 'Trending on YouTube'}</p>
            <div className="discovery-feature-actions">
              {isHost && <button type="button" className="button button-primary button-lg" onClick={() => onPlayNow(featured.videoId)}>▶ Play now</button>}
              <button type="button" className="button button-lg" onClick={() => handleQueue(featured)}>{queuedId === featured.videoId ? 'Added to queue ✓' : '+ Add to queue'}</button>
            </div>
          </div>
        </section>
      )}

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

      {loading && (
        <div className="discovery-grid" aria-label="Loading videos" aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="discovery-card discovery-skeleton" />
          ))}
        </div>
      )}
      {message !== null && <div className="discovery-empty"><span aria-hidden="true">◌</span><p>{message}</p></div>}

      {libraryResults.length > 0 && (
        <section className="discovery-library" aria-labelledby="library-title">
          <div className="shelf-heading">
            <div><span className="eyebrow">Watch together</span><h3 id="library-title">{tab === 'history' ? 'Previously watched' : tab === 'search' ? `Results for “${query}”` : 'Trending now'}</h3></div>
            <span>{libraryResults.length} videos</span>
          </div>
        <ul className="discovery-grid">
          {visibleResults.map((result) => (
            <li key={result.videoId} className="discovery-card">
              {result.thumbnailUrl !== '' && (
                <div className="discovery-thumb-wrap">
                  <img className="discovery-thumb" src={result.thumbnailUrl} alt="" loading="lazy" onError={handleThumbnailError} />
                  {result.durationText !== '' && <span className="duration-badge">{result.durationText}</span>}
                </div>
              )}
              <div className="discovery-info">
                <span className="channel-avatar" aria-hidden="true">{(result.channelTitle || result.title).slice(0, 1).toUpperCase()}</span>
                <span className="discovery-copy">
                <span className="discovery-title" title={result.title}>
                  {result.title}
                </span>
                <span className="discovery-meta">
                  {result.channelTitle}
                </span>
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
        {visibleCount < libraryResults.length && (
          <button type="button" className="button browse-more" onClick={() => setVisibleCount((count) => count + 12)}>
            Show more videos
          </button>
        )}
        </section>
      )}
    </div>
  );
}
