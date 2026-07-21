import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { getTrending, getVideoDetails, searchYouTube, type SearchResult } from '@/lib/search/SearchService';
import { listHistory } from '@/lib/rooms/HistoryService';
import { Icon, type IconName } from '@/components/Icon';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { resolveExternalAssetUrl } from '@/lib/assets';
import { getFriendMediaPresence, type FriendMediaPresence } from '@/lib/social/PresenceService';
import { useSettings } from '@/hooks/useSettings';

interface DiscoveryPanelProps {
  callerId: string;
  isHost: boolean;
  roomCode: string;
  searchRequest: { query: string; nonce: number } | null;
  resetNonce?: number;
  friendMediaPresence: boolean;
  onSearchBusyChange?(busy: boolean): void;
  onPlayNow(videoId: string, title: string): void;
  onQueueAdd(videoId: string, title: string): boolean;
}

type BrowseMode = 'trending' | 'search' | 'friends' | 'history';
type Category = { id: string; label: string; icon: IconName; query?: string };
type BrowseItem = SearchResult & { friendActivity?: FriendMediaPresence };

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
  { id: 'anime', label: 'Anime', icon: 'sparkle', query: 'official anime clips trailers' },
  { id: 'marvel', label: 'Marvel', icon: 'entertainment', query: 'Marvel official trailers clips' },
  { id: 'tv-shows', label: 'TV Shows', icon: 'film', query: 'official TV show trailers clips' },
  { id: 'trailers', label: 'Movie Trailers', icon: 'play', query: 'official movie trailers' },
];

const OUTCOME_MESSAGE: Record<string, string> = {
  'not-configured': 'Video discovery is not configured yet.',
  'rate-limited': 'The daily discovery limit has been reached. Try again tomorrow.',
  error: 'Videos could not be loaded. Check your connection and retry.',
};

export function DiscoveryPanel({ callerId, isHost, roomCode, searchRequest, resetNonce = 0, friendMediaPresence, onSearchBusyChange, onPlayNow, onQueueAdd }: DiscoveryPanelProps): JSX.Element {
  const [mode, setMode] = useState<BrowseMode>('trending');
  const [activeQuery, setActiveQuery] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<SearchResult[]>([]);
  const [friendResults, setFriendResults] = useState<BrowseItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const categoryRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const requestGenerationRef = useRef(0);
  const [categoryEdges, setCategoryEdges] = useState({ left: false, right: true });
  const settings = useSettings();
  const previewAllowed = useHoverPreviewAllowed(
    settings.hoverPreviewEnabled && !settings.reduceMotion,
  );

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

  function showFriends(): void {
    ++requestGenerationRef.current;
    setMode('friends');
    setLoading(false);
    setLoadingMore(false);
    setNextToken(null);
    setMessage(friendResults.length === 0 ? 'No friends are sharing a video right now.' : null);
  }

  useEffect(() => { void Promise.all([loadTrending(''), loadHistory()]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadHistory(); }, [roomCode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    if (!friendMediaPresence) {
      setFriendResults([]);
      return () => { active = false; };
    }
    const refresh = async (): Promise<void> => {
      const presenceResult = await getFriendMediaPresence();
      if (!active || presenceResult.status !== 'ok') return;
      const watching = presenceResult.data.filter((friend) => friend.videoId !== null && (friend.status === 'watching' || friend.status === 'in_party'));
      const hydrated = await Promise.all(watching.map(async (friend): Promise<BrowseItem | null> => {
        if (friend.videoId === null) return null;
        const details = await getVideoDetails(friend.videoId, callerId);
        return details.status === 'ok' ? { ...details.details, friendActivity: friend } : null;
      }));
      if (active) setFriendResults(hydrated.filter((item): item is BrowseItem => item !== null));
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [callerId, friendMediaPresence]);
  useEffect(() => {
    if (mode === 'friends') {
      setMessage(friendResults.length === 0 ? 'No friends are sharing a video right now.' : null);
    }
  }, [friendResults, mode]);
  useEffect(() => {
    if (searchRequest !== null) void loadSearch(searchRequest.query);
  }, [searchRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (resetNonce === 0) return;
    setCategory('');
    setActiveQuery('');
    void Promise.all([loadTrending(''), loadHistory()]);
  }, [resetNonce]); // eslint-disable-line react-hooks/exhaustive-deps

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

      <div
        className="browse-view-tabs"
        role="tablist"
        aria-label="Browse views"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          const tabs = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
          );
          const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
          if (currentIndex < 0 || tabs.length === 0) return;
          event.preventDefault();
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
          next?.focus();
          next?.click();
        }}
      >
        <button type="button" role="tab" aria-selected={mode === 'trending' || mode === 'search'} className={mode === 'trending' || mode === 'search' ? 'browse-view-active' : ''} onClick={() => void loadTrending(category)}>Discover</button>
        {friendMediaPresence && <button type="button" role="tab" aria-selected={mode === 'friends'} className={mode === 'friends' ? 'browse-view-active' : ''} onClick={showFriends}>Friends watching</button>}
        <button type="button" role="tab" aria-selected={mode === 'history'} className={mode === 'history' ? 'browse-view-active' : ''} onClick={showHistory}>Previously watched</button>
      </div>

      {loading && <BrowseLoading />}
      {!loading && message !== null && <div className="discovery-empty" role="status"><Icon name="search" size={28} /><strong>{message}</strong><button type="button" className="button" onClick={() => mode === 'friends' ? void loadTrending(category) : void retryCurrentView()}>{mode === 'history' ? 'Refresh history' : mode === 'friends' ? 'Back to discover' : 'Try again'}</button></div>}

      {!loading && friendResults.length > 0 && mode !== 'history' && <VideoShelf title="Friends are watching" eyebrow="Shared by friends" items={friendResults} isHost={isHost} queuedId={queuedId} previewAllowed={previewAllowed} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}

      {!loading && mode === 'history' && history.length > 0 && <VideoShelf title="Previously watched" eyebrow="Your room history" items={history} isHost={isHost} queuedId={queuedId} previewAllowed={previewAllowed} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}

      {!loading && (mode === 'trending' || mode === 'search') && results.length > 0 && (
        <div className="browse-results">
          {history.length > 0 && <VideoShelf title="Continue watching" eyebrow="Pick up together" items={history.slice(0, 8)} isHost={isHost} queuedId={queuedId} previewAllowed={previewAllowed} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />}
          <VideoGrid title={mode === 'search' ? `Results for “${activeQuery}”` : category === '' ? 'Trending now' : CATEGORIES.find((item) => item.id === category)?.label ?? 'Discover'} eyebrow={mode === 'search' ? 'Search results' : 'Popular right now'} items={results} isHost={isHost} queuedId={queuedId} previewAllowed={previewAllowed} onPlay={onPlayNow} onQueue={queue} onImageError={thumbnailError} />
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
  title: string; eyebrow: string; items: readonly BrowseItem[]; isHost: boolean; queuedId: string | null;
  previewAllowed: boolean;
  onPlay(videoId: string, title: string): void; onQueue(result: BrowseItem): void; onImageError(event: SyntheticEvent<HTMLImageElement>): void;
}

function VideoShelf({ title, eyebrow, items, isHost, queuedId, previewAllowed, onPlay, onQueue, onImageError }: ShelfProps): JSX.Element {
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
      {items.map((result) => <MediaCard key={`${result.videoId}-${result.friendActivity?.userId ?? 'media'}`} result={result} isHost={isHost} queued={queuedId === result.videoId} previewAllowed={previewAllowed} onPlay={onPlay} onQueue={onQueue} onImageError={onImageError} />)}
    </ul>
    </div>
  </section>;
}

function VideoGrid({ title, eyebrow, items, isHost, queuedId, previewAllowed, onPlay, onQueue, onImageError }: ShelfProps): JSX.Element {
  const headingId = `grid-${title.replace(/\W/g, '-').toLowerCase()}`;
  return <section className="video-grid-section" aria-labelledby={headingId}>
    <header className="shelf-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id={headingId}>{title}</h2></div><span className="result-count">{items.length} videos · YouTube</span></header>
    <ul className="media-grid">
      {items.map((result) => <MediaCard key={`${result.videoId}-${result.friendActivity?.userId ?? 'media'}`} result={result} isHost={isHost} queued={queuedId === result.videoId} previewAllowed={previewAllowed} onPlay={onPlay} onQueue={onQueue} onImageError={onImageError} />)}
    </ul>
  </section>;
}

function MediaCard({ result, isHost, queued, previewAllowed, onPlay, onQueue, onImageError }: { result: BrowseItem; isHost: boolean; queued: boolean; previewAllowed: boolean; onPlay(videoId: string, title: string): void; onQueue(result: BrowseItem): void; onImageError(event: SyntheticEvent<HTMLImageElement>): void }): JSX.Element {
  const [previewing, setPreviewing] = useState(false);
  const previewTimerRef = useRef<number | null>(null);

  function clearPreviewTimer(): void {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }

  function startPreview(): void {
    if (!previewAllowed || previewing) return;
    clearPreviewTimer();
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      setPreviewing(true);
    }, 800);
  }

  function stopPreview(): void {
    clearPreviewTimer();
    setPreviewing(false);
  }

  useEffect(() => {
    if (!previewAllowed) stopPreview();
    return clearPreviewTimer;
  }, [previewAllowed]); // eslint-disable-line react-hooks/exhaustive-deps

  return <li className={`media-card${previewing ? ' media-card-previewing' : ''}`} onPointerEnter={startPreview} onPointerLeave={stopPreview}>
    <div className="media-thumb">
      <img src={resolveExternalAssetUrl(result.thumbnailUrl) ?? ''} alt="" loading="lazy" onError={onImageError} />
      {previewing && (
        <iframe
          className="media-hover-preview"
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(result.videoId)}?autoplay=1&mute=1&controls=1&playsinline=1&rel=0`}
          title={`Preview ${result.title}`}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      {result.durationText !== '' && <span className="duration-badge">{result.durationText}</span>}
      {result.friendActivity !== undefined && <span className="friend-watch-chip"><ProfileAvatar src={result.friendActivity.avatarUrl} name={result.friendActivity.displayName} className={result.friendActivity.selectedBorderId !== null ? `friend-watch-avatar border-${result.friendActivity.selectedBorderId}` : 'friend-watch-avatar'} /><span><strong>{result.friendActivity.displayName}</strong><small>watching now</small></span></span>}
      <div className="media-card-actions">
        {isHost && <button type="button" className="media-play" onClick={() => onPlay(result.videoId, result.title)} aria-label={`Play ${result.title}`}><Icon name="play" size={15} />Play now</button>}
        <button type="button" className="media-queue" onClick={() => onQueue(result)}>{queued ? <><Icon name="check" size={15} />Queued</> : <><Icon name="plus" size={15} />Queue</>}</button>
      </div>
    </div>
    <div className={`media-card-copy${previewing ? ' media-card-copy-previewing' : ''}`}>
      {previewing ? (
        <div className="media-preview-actions" aria-label={`Actions for ${result.title}`}>
          {isHost && <button type="button" className="media-play" onClick={() => onPlay(result.videoId, result.title)}><Icon name="play" size={15} />Play now</button>}
          <button type="button" className="media-queue" onClick={() => onQueue(result)}>{queued ? <><Icon name="check" size={15} />Queued</> : <><Icon name="plus" size={15} />Queue</>}</button>
        </div>
      ) : (
        <>
          <ChannelAvatar name={result.channelTitle || result.title} src={result.channelThumbnailUrl} />
          <span><strong title={result.title}>{result.title}</strong><small title={result.channelTitle || 'YouTube'}>{result.channelTitle || 'YouTube'}</small></span>
        </>
      )}
    </div>
  </li>;
}

function useHoverPreviewAllowed(enabled: boolean): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setAllowed(false);
      return;
    }
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const viewport = window.matchMedia('(min-width: 900px)');
    const update = (): void => setAllowed(pointer.matches && viewport.matches);
    update();
    pointer.addEventListener('change', update);
    viewport.addEventListener('change', update);
    return () => {
      pointer.removeEventListener('change', update);
      viewport.removeEventListener('change', update);
    };
  }, [enabled]);

  return allowed;
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
