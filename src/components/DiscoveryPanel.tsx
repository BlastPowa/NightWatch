import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import { getTrending, searchYouTube, type SearchResult } from '@/lib/search/SearchService';
import { listHistory } from '@/lib/rooms/HistoryService';
import { Icon, type IconName } from '@/components/Icon';

interface DiscoveryPanelProps {
  callerId: string;
  isHost: boolean;
  roomCode: string;
  onPlayNow(videoId: string): void;
  onQueueAdd(videoId: string, title: string): boolean;
}

type BrowseMode = 'trending' | 'search' | 'history';
type Category = { id: string; label: string; icon: IconName; query?: string };

const CATEGORIES: readonly Category[] = [
  { id: '', label: 'All', icon: 'sparkle' },
  { id: '10', label: 'Music', icon: 'music' },
  { id: '20', label: 'Gaming', icon: 'gaming' },
  { id: 'live', label: 'Live', icon: 'live', query: 'live now' },
  { id: '1', label: 'Film', icon: 'film' },
  { id: '24', label: 'Entertainment', icon: 'entertainment' },
  { id: '23', label: 'Comedy', icon: 'comedy' },
  { id: '17', label: 'Sports', icon: 'sports' },
  { id: '25', label: 'News', icon: 'news' },
  { id: '27', label: 'Education', icon: 'education' },
  { id: '28', label: 'Science & Tech', icon: 'technology' },
  { id: '19', label: 'Travel', icon: 'travel' },
  { id: '26', label: 'How-to', icon: 'tools' },
  { id: '15', label: 'Pets', icon: 'pets' },
  { id: '2', label: 'Autos', icon: 'autos' },
];

const OUTCOME_MESSAGE: Record<string, string> = {
  'not-configured': 'Video discovery is not configured yet.',
  'rate-limited': 'The daily discovery limit has been reached. Try again tomorrow.',
  error: 'Videos could not be loaded. Check your connection and retry.',
};

export function DiscoveryPanel({ callerId, isHost, roomCode, onPlayNow, onQueueAdd }: DiscoveryPanelProps): JSX.Element {
  const [mode, setMode] = useState<BrowseMode>('trending');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const categoryRef = useRef<HTMLElement | null>(null);
  const [categoryEdges, setCategoryEdges] = useState({ left: false, right: true });

  useEffect(() => {
    const track = categoryRef.current;
    if (track === null) return;
    const update = (): void => setCategoryEdges({
      left: track.scrollLeft > 2,
      right: track.scrollLeft + track.clientWidth < track.scrollWidth - 2,
    });
    update();
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { track.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  function moveCategories(direction: -1 | 1): void {
    const track = categoryRef.current;
    if (track !== null) track.scrollBy({ left: direction * Math.max(260, track.clientWidth * .7), behavior: 'smooth' });
  }

  async function loadTrending(categoryId: string): Promise<void> {
    setMode('trending');
    setLoading(true);
    setMessage(null);
    setNextToken(null);
    const selected = CATEGORIES.find((item) => item.id === categoryId);
    const outcome = selected?.query
      ? await searchYouTube(selected.query, callerId)
      : await getTrending(categoryId, callerId);
    setLoading(false);
    if (outcome.status === 'ok') {
      setResults(outcome.results);
      setNextToken(outcome.nextPageToken);
      setMessage(outcome.results.length === 0 ? 'Nothing is available in this category right now.' : null);
    } else {
      setResults([]);
      setMessage(OUTCOME_MESSAGE[outcome.status] ?? 'Videos could not be loaded.');
    }
  }

  async function loadHistory(): Promise<void> {
    if (roomCode === '') {
      setHistory([]);
      return;
    }
    const entries = await listHistory(roomCode);
    setHistory(entries.map((entry) => ({
      videoId: entry.videoId,
      title: entry.title,
      channelTitle: 'Watched with this room',
      thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/mqdefault.jpg`,
      durationText: '',
    })));
  }

  async function handleSearch(event: FormEvent): Promise<void> {
    event.preventDefault();
    const clean = query.trim();
    if (clean.length === 0 || loading) return;
    setMode('search');
    setActiveQuery(clean);
    setLoading(true);
    setMessage(null);
    setNextToken(null);
    const outcome = await searchYouTube(clean, callerId);
    setLoading(false);
    if (outcome.status === 'ok') {
      setResults(outcome.results);
      setNextToken(outcome.nextPageToken);
      setMessage(outcome.results.length === 0 ? `No videos found for “${clean}”.` : null);
    } else {
      setResults([]);
      setMessage(OUTCOME_MESSAGE[outcome.status] ?? 'Search failed.');
    }
  }

  async function handleShowMore(): Promise<void> {
    if (nextToken === null || loadingMore) return;
    setLoadingMore(true);
    const selected = CATEGORIES.find((item) => item.id === category);
    const outcome = mode === 'search'
      ? await searchYouTube(activeQuery, callerId, nextToken)
      : selected?.query
        ? await searchYouTube(selected.query, callerId, nextToken)
        : await getTrending(category, callerId, nextToken);
    setLoadingMore(false);
    if (outcome.status !== 'ok') {
      setMessage(OUTCOME_MESSAGE[outcome.status] ?? 'More videos could not be loaded.');
      return;
    }
    setResults((current) => {
      const seen = new Set(current.map((item) => item.videoId));
      return [...current, ...outcome.results.filter((item) => !seen.has(item.videoId))];
    });
    setNextToken(outcome.nextPageToken);
  }

  useEffect(() => { void Promise.all([loadTrending(''), loadHistory()]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadHistory(); }, [roomCode]); // eslint-disable-line react-hooks/exhaustive-deps

  function queue(result: SearchResult): void {
    if (onQueueAdd(result.videoId, result.title)) {
      setQueuedId(result.videoId);
      window.setTimeout(() => setQueuedId(null), 1400);
    }
  }

  function thumbnailError(event: SyntheticEvent<HTMLImageElement>): void {
    event.currentTarget.hidden = true;
    event.currentTarget.parentElement?.classList.add('thumbnail-unavailable');
  }

  const firstShelf = results.slice(0, 8);
  const secondShelf = results.slice(8, 16);
  const remainingShelf = results.slice(16);

  return (
    <div className="browse-hub">
      <form className="browse-search" role="search" onSubmit={(event) => void handleSearch(event)}>
        <span><Icon name="search" size={20} /></span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos, creators, and topics" aria-label="Search videos" />
        {query !== '' && <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={16} /></button>}
        <button type="submit" className="button button-primary" disabled={loading || query.trim() === ''}>{loading && mode === 'search' ? 'Searching…' : 'Search'}</button>
      </form>

      <div className="browse-category-row">
        <button type="button" className="category-scroll category-scroll-left" disabled={!categoryEdges.left} onClick={() => moveCategories(-1)} aria-label="Scroll video categories left"><Icon name="chevron-left" /></button>
        <nav className="browse-categories" ref={categoryRef} aria-label="Video categories">
          {CATEGORIES.map((item) => (
            <button key={item.id} type="button" className={mode === 'trending' && category === item.id ? 'category-pill category-pill-active' : 'category-pill'} onClick={() => { setCategory(item.id); void loadTrending(item.id); }}>
              <Icon name={item.icon} size={16} />{item.label}
            </button>
          ))}
        </nav>
        <button type="button" className="category-scroll category-scroll-right" disabled={!categoryEdges.right} onClick={() => moveCategories(1)} aria-label="Scroll video categories right"><Icon name="chevron-right" /></button>
      </div>

      <div className="browse-view-tabs" role="tablist" aria-label="Browse views">
        <button type="button" role="tab" aria-selected={mode !== 'history'} className={mode !== 'history' ? 'browse-view-active' : ''} onClick={() => void loadTrending(category)}>Discover</button>
        <button type="button" role="tab" aria-selected={mode === 'history'} className={mode === 'history' ? 'browse-view-active' : ''} onClick={() => { setMode('history'); setMessage(history.length === 0 ? 'This room has no watch history yet.' : null); }}>Previously watched</button>
      </div>

      {loading && <BrowseLoading />}
      {!loading && message !== null && <div className="discovery-empty" role="status"><Icon name="search" size={28} /><strong>{message}</strong><button type="button" className="button" onClick={() => void loadTrending(category)}>Try again</button></div>}

      {!loading && mode === 'history' && history.length > 0 && <VideoShelf title="Previously watched" eyebrow="Your room history" items={history} isHost={isHost} queuedId={queuedId} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}

      {!loading && mode !== 'history' && results.length > 0 && (
        <div className="browse-shelves">
          {history.length > 0 && <VideoShelf title="Continue watching" eyebrow="Pick up together" items={history.slice(0, 8)} isHost={isHost} queuedId={queuedId} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}
          <VideoShelf title={mode === 'search' ? `Results for “${activeQuery}”` : category === '' ? 'Trending now' : CATEGORIES.find((item) => item.id === category)?.label ?? 'Discover'} eyebrow={mode === 'search' ? 'Search results' : 'Popular right now'} items={firstShelf} isHost={isHost} queuedId={queuedId} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />
          {secondShelf.length > 0 && <VideoShelf title="More to explore" eyebrow="Keep the party going" items={secondShelf} isHost={isHost} queuedId={queuedId} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}
          {remainingShelf.length > 0 && <VideoShelf title="Fresh picks" eyebrow="More from NightWatch discovery" items={remainingShelf} isHost={isHost} queuedId={queuedId} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}
        </div>
      )}

      {nextToken !== null && !loading && mode !== 'history' && <button type="button" className="button browse-load-more" onClick={() => void handleShowMore()} disabled={loadingMore}>{loadingMore ? 'Loading more…' : 'Load more videos'}</button>}
    </div>
  );
}

interface ShelfProps {
  title: string; eyebrow: string; items: readonly SearchResult[]; isHost: boolean; queuedId: string | null;
  onPlay(videoId: string): void; onQueue(result: SearchResult): void; onImageError(event: SyntheticEvent<HTMLImageElement>): void;
}

function VideoShelf({ title, eyebrow, items, isHost, queuedId, onPlay, onQueue, onImageError }: ShelfProps): JSX.Element {
  const trackRef = useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: true });
  useEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    const update = (): void => setEdges({
      left: track.scrollLeft > 2,
      right: track.scrollLeft + track.clientWidth < track.scrollWidth - 2,
    });
    update();
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { track.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [items]);
  function move(direction: -1 | 1): void {
    const track = trackRef.current;
    if (track !== null) track.scrollBy({ left: direction * Math.max(280, track.clientWidth * 0.82), behavior: 'smooth' });
  }
  return <section className="video-shelf" aria-labelledby={`shelf-${title.replace(/\W/g, '-').toLowerCase()}`}>
    <header className="shelf-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id={`shelf-${title.replace(/\W/g, '-').toLowerCase()}`}>{title}</h2></div><div className="shelf-controls"><span>{items.length} videos</span><button type="button" disabled={!edges.left} onClick={() => move(-1)} aria-label={`Scroll ${title} left`}><Icon name="chevron-left" /></button><button type="button" disabled={!edges.right} onClick={() => move(1)} aria-label={`Scroll ${title} right`}><Icon name="chevron-right" /></button></div></header>
    <ul className="shelf-track" ref={trackRef}>
      {items.map((result) => <li key={result.videoId} className="media-card">
        <div className="media-thumb">
          <img src={result.thumbnailUrl} alt="" loading="lazy" onError={onImageError} />
          {result.durationText !== '' && <span className="duration-badge">{result.durationText}</span>}
          <div className="media-card-actions">
            {isHost && <button type="button" className="media-play" onClick={() => onPlay(result.videoId)} aria-label={`Play ${result.title}`}><Icon name="play" size={19} /></button>}
            <button type="button" className="media-queue" onClick={() => onQueue(result)}>{queuedId === result.videoId ? <><Icon name="check" size={15} />Queued</> : <><Icon name="plus" size={15} />Queue</>}</button>
          </div>
        </div>
        <div className="media-card-copy"><span className="channel-avatar" aria-hidden="true">{(result.channelTitle || result.title).slice(0, 1).toUpperCase()}</span><span><strong title={result.title}>{result.title}</strong><small>{result.channelTitle || 'YouTube'}</small></span></div>
      </li>)}
    </ul>
  </section>;
}

function BrowseLoading(): JSX.Element {
  return <div className="browse-loading" aria-busy="true" aria-label="Loading videos"><div className="orbit-loader" aria-hidden="true"><span /><span /><span /></div><div className="shelf-track">{Array.from({ length: 5 }, (_, index) => <div key={index} className="media-card media-card-skeleton" />)}</div></div>;
}
