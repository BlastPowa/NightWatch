// Supabase Edge Function: search-youtube (§7.6, ADR-011 + Phase 16)
//
// Proxies YouTube Data API v3 so the Google API key never ships in the
// Electron binary. Handles both search and trending (Discovery Hub).
// Deploy:
//   supabase functions deploy search-youtube --no-verify-jwt
//   supabase secrets set YOUTUBE_API_KEY=<your key>
//
// Request:  POST { kind?: 'search' | 'trending', query?: string,
//                  categoryId?: string, callerId: string }
//           (kind defaults to 'search' for backward compatibility)
// Response: { results: { videoId, title, channelTitle, thumbnailUrl,
//                        durationText }[] }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const MAX_RESULTS = 12;
const DAILY_LIMIT_PER_CALLER = 80;
const TRENDING_CACHE_MS = 10 * 60 * 1000;

// Coarse per-instance rate limit (resets when the instance recycles and
// daily). Good enough to protect the free quota per ADR-011.
const usage = new Map<string, { day: string; count: number }>();

function isRateLimited(callerId: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const entry = usage.get(callerId);
  if (entry === undefined || entry.day !== today) {
    usage.set(callerId, { day: today, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > DAILY_LIMIT_PER_CALLER;
}

// Trending barely changes minute-to-minute; a small cache keeps the whole
// friend group browsing off ~1 quota unit per 10 minutes per category.
const trendingCache = new Map<string, { at: number; results: VideoResult[] }>();

interface VideoResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationText: string;
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

async function fetchDurations(apiKey: string, ids: string[]): Promise<Map<string, string>> {
  const durations = new Map<string, string>();
  if (ids.length === 0) {
    return durations;
  }
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('id', ids.join(','));
  url.searchParams.set('key', apiKey);
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

async function handleSearch(apiKey: string, query: string): Promise<VideoResult[]> {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('maxResults', String(MAX_RESULTS));
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('key', apiKey);

  const response = await fetch(searchUrl);
  if (!response.ok) {
    throw new Error('upstream');
  }
  const data = (await response.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        thumbnails?: { medium?: { url?: string } };
      };
    }>;
  };

  const items = (data.items ?? []).filter((item) => typeof item.id?.videoId === 'string');
  const durations = await fetchDurations(
    apiKey,
    items.map((item) => item.id!.videoId!),
  );

  return items.map((item) => ({
    videoId: item.id!.videoId!,
    title: item.snippet?.title ?? 'Untitled',
    channelTitle: item.snippet?.channelTitle ?? '',
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? '',
    durationText: durations.get(item.id!.videoId!) ?? '',
  }));
}

async function handleTrending(apiKey: string, categoryId: string): Promise<VideoResult[]> {
  const cacheKey = categoryId === '' ? 'all' : categoryId;
  const cached = trendingCache.get(cacheKey);
  if (cached !== undefined && Date.now() - cached.at < TRENDING_CACHE_MS) {
    return cached.results;
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('chart', 'mostPopular');
  url.searchParams.set('maxResults', String(MAX_RESULTS));
  url.searchParams.set('regionCode', 'US');
  if (categoryId !== '') {
    url.searchParams.set('videoCategoryId', categoryId);
  }
  url.searchParams.set('key', apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('upstream');
  }
  const data = (await response.json()) as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        channelTitle?: string;
        thumbnails?: { medium?: { url?: string } };
      };
      contentDetails?: { duration?: string };
    }>;
  };

  const results = (data.items ?? [])
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({
      videoId: item.id!,
      title: item.snippet?.title ?? 'Untitled',
      channelTitle: item.snippet?.channelTitle ?? '',
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? '',
      durationText:
        typeof item.contentDetails?.duration === 'string'
          ? parseIsoDuration(item.contentDetails.duration)
          : '',
    }));

  trendingCache.set(cacheKey, { at: Date.now(), results });
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

  let body: { kind?: unknown; query?: unknown; categoryId?: unknown; callerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad-request' }, 400);
  }

  const kind = body.kind === 'trending' ? 'trending' : 'search';
  const callerId = typeof body.callerId === 'string' ? body.callerId.slice(0, 64) : '';
  if (callerId.length === 0) {
    return jsonResponse({ error: 'bad-request' }, 400);
  }
  if (isRateLimited(callerId)) {
    return jsonResponse({ error: 'rate-limited' }, 429);
  }

  try {
    if (kind === 'trending') {
      const categoryId =
        typeof body.categoryId === 'string' ? body.categoryId.replace(/\D/g, '').slice(0, 4) : '';
      return jsonResponse({ results: await handleTrending(apiKey, categoryId) });
    }

    const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : '';
    if (query.length === 0) {
      return jsonResponse({ error: 'bad-request' }, 400);
    }
    return jsonResponse({ results: await handleSearch(apiKey, query) });
  } catch {
    return jsonResponse({ error: 'upstream-error' }, 502);
  }
});
