import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { getTrending, searchYouTube, type SearchResult } from '@/lib/search/SearchService';
import { listHistory } from '@/lib/rooms/HistoryService';
import { Icon, type IconName } from '@/components/Icon';
import { resolveExternalAssetUrl } from '@/lib/assets';

interface DiscoveryPanelProps {
  callerId: string;
  isHost: boolean;
  roomCode: string;
  searchRequest: { query: string; nonce: number } | null;
  onSearchBusyChange?(busy: boolean): void;
  onPlayNow(videoId: string, title: string): void;
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
  { id: 'animation', label: 'Animation', icon: 'film', query: 'animation' },
  { id: 'documentaries', label: 'Documentaries', icon: 'news', query: 'documentary' },
  { id: 'cooking', label: 'Cooking', icon: 'sparkle', query: 'cooking recipes' },
  { id: 'fitness', label: 'Fitness', icon: 'sports', query: 'fitness workout' },
  { id: 'fashion', label: 'Fashion', icon: 'profile', query: 'fashion style' },
  { id: 'podcasts', label: 'Podcasts', icon: 'live', query: 'video podcast' },
  { id: 'lifestyle', label: 'Lifestyle', icon: 'home', query: 'lifestyle' },
];

const OUTCOME_MESSAGE: Record<string, string> = {
  'not-configured': 'Video discovery is not configured yet.',
  'rate-limited': 'The daily discovery limit has been reached. Try again tomorrow.',
  error: 'Videos could not be loaded. Check your connection and retry.',
};

export function DiscoveryPanel({ callerId, isHost, roomCode, searchRequest, onSearchBusyChange, onPlayNow, onQueueAdd }: DiscoveryPanelProps): JSX.Element {
  const [mode, setMode] = useState<BrowseMode>('trending');
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
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const requestGenerationRef = useRef(0);
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
    const generation = ++requestGenerationRef.current;
    setMode('trending');
    setLoading(true);
    setLoadingMore(false);
    setMessage(null);
    setNextToken(null);
    const selected = CATEGORIES.find((item) => item.id === categoryId);
    const outcome = selected?.query
      ? await searchYouTube(selected.query, callerId)
      : await getTrending(categoryId, callerId);
    if (generation !== requestGenerationRef.current) return;
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

  async function loadHistory(): Promise<SearchResult[]> {
    if (roomCode === '') {
      setHistory([]);
      return [];
    }
    const entries = await listHistory(roomCode);
    const nextHistory = entries.map((entry) => ({
      videoId: entry.videoId,
      title: entry.title,
      channelTitle: 'Watched with this room',
      channelThumbnailUrl: '',
      thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/mqdefault.jpg`,
      durationText: '',
    }));
    setHistory(nextHistory);
    return nextHistory;
  }

  async function loadSearch(clean: string): Promise<void> {
    const generation = ++requestGenerationRef.current;
    setMode('search');
    setActiveQuery(clean);
    setLoading(true);
    setLoadingMore(false);
    setMessage(null);
    setNextToken(null);
    onSearchBusyChange?.(true);
    const outcome = await searchYouTube(clean, callerId);
    if (generation !== requestGenerationRef.current) {
      onSearchBusyChange?.(false);
      return;
    }
    setLoading(false);
    onSearchBusyChange?.(false);
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
    const generation = requestGenerationRef.current;
    setLoadingMore(true);
    const selected = CATEGORIES.find((item) => item.id === category);
    const outcome = mode === 'search'
      ? await searchYouTube(activeQuery, callerId, nextToken)
      : selected?.query
        ? await searchYouTube(selected.query, callerId, nextToken)
        : await getTrending(category, callerId, nextToken);
    if (generation !== requestGenerationRef.current) return;
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

  async function retryCurrentView(): Promise<void> {
    if (mode === 'search' && activeQuery !== '') {
      await loadSearch(activeQuery);
      return;
    }
    if (mode === 'history') {
      const generation = ++requestGenerationRef.current;
      setLoading(true);
      setMessage(null);
      const refreshedHistory = await loadHistory();
      if (generation !== requestGenerationRef.current) return;
      setLoading(false);
      setMessage(refreshedHistory.length === 0 ? 'This room has no watch history yet.' : null);
      return;
    }
    await loadTrending(category);
  }

  function showHistory(): void {
    ++requestGenerationRef.current;
    setMode('history');
    setLoading(false);
    setLoadingMore(false);
    setNextToken(null);
    setMessage(history.length === 0 ? 'This room has no watch history yet.' : null);
  }

  useEffect(() => { void Promise.all([loadTrending(''), loadHistory()]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadHistory(); }, [roomCode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (searchRequest !== null) void loadSearch(searchRequest.query);
  }, [searchRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll: when the sentinel near the end of the list scrolls into
  // view, pull the next page automatically. The button below stays as a
  // no-JS/observer-less fallback and for keyboard users.
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (sentinel === null || nextToken === null || loading || mode === 'history') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void handleShowMore();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextToken, loading, loadingMore, mode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="browse-hub">
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
        <button type="button" role="tab" aria-selected={mode === 'history'} className={mode === 'history' ? 'browse-view-active' : ''} onClick={showHistory}>Previously watched</button>
      </div>

      {loading && <BrowseLoading />}
      {!loading && message !== null && <div className="discovery-empty" role="status"><Icon name="search" size={28} /><strong>{message}</strong><button type="button" className="button" onClick={() => void retryCurrentView()}>{mode === 'history' ? 'Refresh history' : 'Try again'}</button></div>}

      {!loading && mode === 'history' && history.length > 0 && <VideoShelf title="Previously watched" eyebrow="Your room history" items={history} isHost={isHost} queuedId={queuedId} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}

      {!loading && mode !== 'history' && results.length > 0 && (
        <div className="browse-results">
          {history.length > 0 && <VideoShelf title="Continue watching" eyebrow="Pick up together" items={history.slice(0, 8)} isHost={isHost} queuedId={queuedId} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}
          <VideoGrid title={mode === 'search' ? `Results for “${activeQuery}”` : category === '' ? 'Trending now' : CATEGORIES.find((item) => item.id === category)?.label ?? 'Discover'} eyebrow={mode === 'search' ? 'Search results' : 'Popular right now'} items={results} isHost={isHost} queuedId={queuedId} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />
        </div>
      )}

      {nextToken !== null && !loading && mode !== 'history' && (
        <>
          <div ref={loadMoreRef} className="browse-load-sentinel" aria-hidden="true" />
          <button type="button" className="button browse-load-more" onClick={() => void handleShowMore()} disabled={loadingMore}>{loadingMore ? 'Loading more…' : 'Load more videos'}</button>
        </>
      )}
    </div>
  );
}

interface ShelfProps {
  title: string; eyebrow: string; items: readonly SearchResult[]; isHost: boolean; queuedId: string | null;
  onPlay(videoId: string, title: string): void; onQueue(result: SearchResult): void; onImageError(event: SyntheticEvent<HTMLImageElement>): void;
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
    <div className="shelf-viewport" data-can-scroll-left={edges.left} data-can-scroll-right={edges.right}>
    <ul className="shelf-track" ref={trackRef} tabIndex={0} aria-label={`${title} videos`}>
      {items.map((result) => <MediaCard key={result.videoId} result={result} isHost={isHost} queued={queuedId === result.videoId} onPlay={onPlay} onQueue={onQueue} onImageError={onImageError} />)}
    </ul>
    </div>
  </section>;
}

function VideoGrid({ title, eyebrow, items, isHost, queuedId, onPlay, onQueue, onImageError }: ShelfProps): JSX.Element {
  const headingId = `grid-${title.replace(/\W/g, '-').toLowerCase()}`;
  return <section className="video-grid-section" aria-labelledby={headingId}>
    <header className="shelf-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id={headingId}>{title}</h2></div><span className="result-count">{items.length} videos · YouTube</span></header>
    <ul className="media-grid">
      {items.map((result) => <MediaCard key={result.videoId} result={result} isHost={isHost} queued={queuedId === result.videoId} onPlay={onPlay} onQueue={onQueue} onImageError={onImageError} />)}
    </ul>
  </section>;
}

function MediaCard({ result, isHost, queued, onPlay, onQueue, onImageError }: { result: SearchResult; isHost: boolean; queued: boolean; onPlay(videoId: string, title: string): void; onQueue(result: SearchResult): void; onImageError(event: SyntheticEvent<HTMLImageElement>): void }): JSX.Element {
  return <li className="media-card">
    <div className="media-thumb">
      <img src={resolveExternalAssetUrl(result.thumbnailUrl) ?? ''} alt="" loading="lazy" onError={onImageError} />
      {result.durationText !== '' && <span className="duration-badge">{result.durationText}</span>}
      <div className="media-card-actions">
        {isHost && <button type="button" className="media-play" onClick={() => onPlay(result.videoId, result.title)} aria-label={`Play ${result.title}`}><Icon name="play" size={15} />Play now</button>}
        <button type="button" className="media-queue" onClick={() => onQueue(result)}>{queued ? <><Icon name="check" size={15} />Queued</> : <><Icon name="plus" size={15} />Queue</>}</button>
      </div>
    </div>
    <div className="media-card-copy"><ChannelAvatar name={result.channelTitle || result.title} src={result.channelThumbnailUrl} /><span><strong title={result.title}>{result.title}</strong><small title={result.channelTitle || 'YouTube'}>{result.channelTitle || 'YouTube'}</small></span></div>
  </li>;
}

function ChannelAvatar({ name, src }: { name: string; src: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const seed = Array.from(name).reduce((value, character) => ((value * 31) + character.charCodeAt(0)) % 360, 217);
  const style = { '--channel-hue': seed } as CSSProperties;
  const resolved = resolveExternalAssetUrl(src);
  return <span className="channel-avatar" style={style} aria-hidden="true">{resolved !== null && resolved !== '' && !failed ? <img src={resolved} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{name.trim().slice(0, 1).toUpperCase() || 'N'}</span>}</span>;
}

function BrowseLoading(): JSX.Element {
  return <div className="browse-loading" aria-busy="true" aria-label="Loading videos"><div className="orbit-loader" aria-hidden="true"><span /><span /><span /></div><div className="shelf-track">{Array.from({ length: 5 }, (_, index) => <div key={index} className="media-card media-card-skeleton" />)}</div></div>;
}
