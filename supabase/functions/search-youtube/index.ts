// Supabase Edge Function: search-youtube (§7.6, ADR-011 + Phase 16 + Phase 18)
//
// Proxies YouTube Data API v3 so the Google API key never ships in the
// Electron binary. Handles both search and trending (Discovery Hub).
// Deploy:
//   supabase functions deploy search-youtube --no-verify-jwt
//   supabase secrets set YOUTUBE_API_KEY=<your key>
//
// Request:  POST { kind?: 'search' | 'trending', query?: string,
//                  categoryId?: string, pageToken?: string, callerId: string }
//           (kind defaults to 'search' for backward compatibility)
// Response: { results: VideoResult[], nextPageToken?: string }
//           (nextPageToken is absent on the last page; old clients ignore it)
//
// QUOTA MODEL (the whole point of the paging design below)
// --------------------------------------------------------
// The free tier is 10,000 units/day. search.list costs 100 units *regardless
// of maxResults* (cap 50); videos.list costs 1 unit. So paginating by calling
// search.list again with YouTube's own pageToken would cost 100 units *per
// Show More click* — the fastest way to burn the free quota.
//
// Instead we fetch wide once (48 items, one search.list = the same 100 units a
// 12-item search already cost), cache that set, and serve it to the client in
// pages of 12. Every Show More is a cache slice and costs ZERO units. Browse is
// hard-capped at those 48 results, so a single query can never cost more than
// 102 units (including one batched channel-avatar lookup) no matter how many
// times the user pages. On top of that, a global
// daily unit budget stops us calling YouTube at all once the day's spend is up.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

/** Items pulled from YouTube in one shot. 50 is the API's hard cap. */
const UPSTREAM_FETCH = 48;
/** Items handed to the client per page. Page 1 matches the pre-Phase-18 size. */
const PAGE_SIZE = 12;

/** Quota unit costs, per the YouTube Data API v3 cost table. */
const COST_SEARCH_LIST = 100;
const COST_VIDEOS_LIST = 1;
const COST_CHANNELS_LIST = 1;

/**
 * Stop calling YouTube once the day's estimated spend passes this. The free
 * allowance is 10,000 units/day; the headroom absorbs other instances, since
 * this counter is per-instance and cannot see them.
 */
const DAILY_UNIT_BUDGET = 9_000;

/** Per-caller daily caps. Only upstream calls consume the expensive budget. */
const UPSTREAM_SEARCHES_PER_CALLER = 25;
const REQUESTS_PER_CALLER = 300;

const SEARCH_CACHE_MS = 30 * 60 * 1000;
const TRENDING_CACHE_MS = 10 * 60 * 1000;

interface VideoResult {
  videoId: string;
  title: string;
  channelTitle: string;
  channelThumbnailUrl: string;
  thumbnailUrl: string;
  durationText: string;
}

/** A full 48-item result set, paged out of memory rather than re-fetched. */
interface CachedSet {
  at: number;
  results: VideoResult[];
}

const searchCache = new Map<string, CachedSet>();
const trendingCache = new Map<string, CachedSet>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Quota accounting. All state is per-instance and resets when the instance
// recycles — coarse by design (ADR-011), but it is the backstop that keeps the
// project inside the free tier.
// ---------------------------------------------------------------------------

const spend = { day: today(), units: 0 };

function unitsRemaining(): number {
  if (spend.day !== today()) {
    spend.day = today();
    spend.units = 0;
  }
  return DAILY_UNIT_BUDGET - spend.units;
}

function chargeUnits(units: number): void {
  unitsRemaining();
  spend.units += units;
}

interface CallerUsage {
  day: string;
  requests: number;
  upstreamSearches: number;
}

const usage = new Map<string, CallerUsage>();

function callerUsage(callerId: string): CallerUsage {
  const day = today();
  const entry = usage.get(callerId);
  if (entry === undefined || entry.day !== day) {
    const fresh: CallerUsage = { day, requests: 0, upstreamSearches: 0 };
    usage.set(callerId, fresh);
    return fresh;
  }
  return entry;
}

/** Cheap ceiling on total calls, so cached paging still cannot be abused. */
function isRateLimited(callerId: string): boolean {
  const entry = callerUsage(callerId);
  entry.requests += 1;
  return entry.requests > REQUESTS_PER_CALLER;
}

/** May this caller trigger a 100-unit search.list right now? */
function canSpendOnSearch(callerId: string): boolean {
  return (
    callerUsage(callerId).upstreamSearches < UPSTREAM_SEARCHES_PER_CALLER &&
    unitsRemaining() >= COST_SEARCH_LIST + COST_VIDEOS_LIST + COST_CHANNELS_LIST
  );
}

// ---------------------------------------------------------------------------
// Continuation tokens. These are OURS, not YouTube's: they address an offset
// into a cached result set, which is what makes Show More free. They carry the
// query so a page can be rebuilt if the instance recycled and lost its cache.
// ---------------------------------------------------------------------------

interface PageCursor {
  kind: 'search' | 'trending';
  query: string;
  categoryId: string;
  offset: number;
}

function encodeCursor(cursor: PageCursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeCursor(token: string): PageCursor | null {
  try {
    const parsed = JSON.parse(atob(token)) as Partial<PageCursor>;
    const kind = parsed.kind === 'trending' ? 'trending' : 'search';
    const offset = Number(parsed.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset >= UPSTREAM_FETCH) {
      return null;
    }
    return {
      kind,
      query: typeof parsed.query === 'string' ? parsed.query.slice(0, 120) : '',
      categoryId: typeof parsed.categoryId === 'string' ? parsed.categoryId.slice(0, 4) : '',
      offset,
    };
  } catch {
    return null;
  }
}

function parseIsoDuration(iso: string): string {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (match === null) {
    return '';
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Not a type predicate on purpose: a *stale* entry is still a CachedSet, and we
 * fall back to serving one when the quota budget is spent.
 */
function isFresh(entry: CachedSet | undefined, ttlMs: number): boolean {
  return entry !== undefined && Date.now() - entry.at < ttlMs;
}

async function fetchDurations(apiKey: string, ids: string[]): Promise<Map<string, string>> {
  const durations = new Map<string, string>();
  if (ids.length === 0) {
    return durations;
  }
  // One videos.list call covers up to 50 ids for a flat 1 unit.
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('id', ids.slice(0, 50).join(','));
  url.searchParams.set('key', apiKey);
  chargeUnits(COST_VIDEOS_LIST);
  const response = await fetch(url);
  if (!response.ok) {
    return durations;
  }
  const data = (await response.json()) as {
    items?: Array<{ id?: string; contentDetails?: { duration?: string } }>;
  };
  for (const video of data.items ?? []) {
    if (typeof video.id === 'string' && typeof video.contentDetails?.duration === 'string') {
      durations.set(video.id, parseIsoDuration(video.contentDetails.duration));
    }
  }
  return durations;
}

/** Resolve up to 50 channel avatars in one 1-unit channels.list call. */
async function fetchChannelThumbnails(
  apiKey: string,
  ids: string[],
): Promise<Map<string, string>> {
  const thumbnails = new Map<string, string>();
  const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))].slice(0, 50);
  if (uniqueIds.length === 0) {
    return thumbnails;
  }
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', uniqueIds.join(','));
  url.searchParams.set('key', apiKey);
  chargeUnits(COST_CHANNELS_LIST);
  const response = await fetch(url);
  if (!response.ok) {
    return thumbnails;
  }
  const data = (await response.json()) as {
    items?: Array<{
      id?: string;
      snippet?: { thumbnails?: { default?: { url?: string }; medium?: { url?: string } } };
    }>;
  };
  for (const channel of data.items ?? []) {
    const thumbnail = channel.snippet?.thumbnails?.medium?.url
      ?? channel.snippet?.thumbnails?.default?.url;
    if (typeof channel.id === 'string' && typeof thumbnail === 'string') {
      thumbnails.set(channel.id, thumbnail);
    }
  }
  return thumbnails;
}

/** Fetch the full 48-item set for a query (100 search + 1 durations + 1 channels). */
async function fetchSearchSet(apiKey: string, query: string): Promise<VideoResult[]> {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('maxResults', String(UPSTREAM_FETCH));
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('key', apiKey);

  chargeUnits(COST_SEARCH_LIST);
  const response = await fetch(searchUrl);
  if (!response.ok) {
    throw new Error('upstream');
  }
  const data = (await response.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelId?: string;
        channelTitle?: string;
        thumbnails?: { medium?: { url?: string } };
      };
    }>;
  };

  const items = (data.items ?? []).filter((item) => typeof item.id?.videoId === 'string');
  const [durations, channelThumbnails] = await Promise.all([
    fetchDurations(apiKey, items.map((item) => item.id!.videoId!)),
    fetchChannelThumbnails(apiKey, items.map((item) => item.snippet?.channelId ?? '')),
  ]);

  return items.map((item) => ({
    videoId: item.id!.videoId!,
    title: item.snippet?.title ?? 'Untitled',
    channelTitle: item.snippet?.channelTitle ?? '',
    channelThumbnailUrl: channelThumbnails.get(item.snippet?.channelId ?? '') ?? '',
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? '',
    durationText: durations.get(item.id!.videoId!) ?? '',
  }));
}

/** Fetch the full 48-item trending set for a category (1 unit). */
async function fetchTrendingSet(apiKey: string, categoryId: string): Promise<VideoResult[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('chart', 'mostPopular');
  url.searchParams.set('maxResults', String(UPSTREAM_FETCH));
  url.searchParams.set('regionCode', 'US');
  if (categoryId !== '') {
    url.searchParams.set('videoCategoryId', categoryId);
  }
  url.searchParams.set('key', apiKey);

  chargeUnits(COST_VIDEOS_LIST);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('upstream');
  }
  const data = (await response.json()) as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        channelId?: string;
        channelTitle?: string;
        thumbnails?: { medium?: { url?: string } };
      };
      contentDetails?: { duration?: string };
    }>;
  };

  const items = (data.items ?? []).filter((item) => typeof item.id === 'string');
  const channelThumbnails = await fetchChannelThumbnails(
    apiKey,
    items.map((item) => item.snippet?.channelId ?? ''),
  );

  return items
    .map((item) => ({
      videoId: item.id!,
      title: item.snippet?.title ?? 'Untitled',
      channelTitle: item.snippet?.channelTitle ?? '',
      channelThumbnailUrl: channelThumbnails.get(item.snippet?.channelId ?? '') ?? '',
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? '',
      durationText:
        typeof item.contentDetails?.duration === 'string'
          ? parseIsoDuration(item.contentDetails.duration)
          : '',
    }));
}

/** Resolve the cached set for a cursor, fetching upstream only if we must. */
async function resolveSet(
  apiKey: string,
  callerId: string,
  cursor: PageCursor,
): Promise<VideoResult[] | 'rate-limited'> {
  if (cursor.kind === 'trending') {
    const key = cursor.categoryId === '' ? 'all' : cursor.categoryId;
    const cached = trendingCache.get(key);
    if (cached !== undefined && isFresh(cached, TRENDING_CACHE_MS)) {
      return cached.results;
    }
    if (unitsRemaining() < COST_VIDEOS_LIST + COST_CHANNELS_LIST) {
      // Budget gone: stale results beat a quota breach.
      return cached?.results ?? 'rate-limited';
    }
    const results = await fetchTrendingSet(apiKey, cursor.categoryId);
    trendingCache.set(key, { at: Date.now(), results });
    return results;
  }

  const cached = searchCache.get(cursor.query);
  if (cached !== undefined && isFresh(cached, SEARCH_CACHE_MS)) {
    return cached.results;
  }
  if (!canSpendOnSearch(callerId)) {
    return cached?.results ?? 'rate-limited';
  }
  callerUsage(callerId).upstreamSearches += 1;
  const results = await fetchSearchSet(apiKey, cursor.query);
  searchCache.set(cursor.query, { at: Date.now(), results });
  return results;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method-not-allowed' }, 405);
  }

  const apiKey = Deno.env.get('YOUTUBE_API_KEY');
  if (apiKey === undefined || apiKey.length === 0) {
    return jsonResponse({ error: 'not-configured' }, 503);
  }

  let body: {
    kind?: unknown;
    query?: unknown;
    categoryId?: unknown;
    pageToken?: unknown;
    callerId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad-request' }, 400);
  }

  const callerId = typeof body.callerId === 'string' ? body.callerId.slice(0, 64) : '';
  if (callerId.length === 0) {
    return jsonResponse({ error: 'bad-request' }, 400);
  }
  if (isRateLimited(callerId)) {
    return jsonResponse({ error: 'rate-limited' }, 429);
  }

  // A page token fully describes the page being asked for; without one this is
  // a fresh page-1 request built from the body.
  let cursor: PageCursor;
  if (typeof body.pageToken === 'string' && body.pageToken.length > 0) {
    const decoded = decodeCursor(body.pageToken);
    if (decoded === null) {
      return jsonResponse({ error: 'bad-request' }, 400);
    }
    cursor = decoded;
  } else {
    const kind = body.kind === 'trending' ? 'trending' : 'search';
    cursor = {
      kind,
      query: typeof body.query === 'string' ? body.query.trim().slice(0, 120) : '',
      categoryId:
        typeof body.categoryId === 'string' ? body.categoryId.replace(/\D/g, '').slice(0, 4) : '',
      offset: 0,
    };
  }

  if (cursor.kind === 'search' && cursor.query.length === 0) {
    return jsonResponse({ error: 'bad-request' }, 400);
  }

  try {
    const set = await resolveSet(apiKey, callerId, cursor);
    if (set === 'rate-limited') {
      return jsonResponse({ error: 'rate-limited' }, 429);
    }

    const page = set.slice(cursor.offset, cursor.offset + PAGE_SIZE);
    const nextOffset = cursor.offset + PAGE_SIZE;
    const hasMore = nextOffset < Math.min(set.length, UPSTREAM_FETCH);

    return jsonResponse({
      results: page,
      ...(hasMore ? { nextPageToken: encodeCursor({ ...cursor, offset: nextOffset }) } : {}),
    });
  } catch {
    return jsonResponse({ error: 'upstream-error' }, 502);
  }
});
