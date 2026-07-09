// Supabase Edge Function: search-youtube (§7.6, ADR-011)
//
// Proxies YouTube Data API v3 search so the Google API key never ships in
// the Electron binary. Deploy:
//   supabase functions deploy search-youtube --no-verify-jwt
//   supabase secrets set YOUTUBE_API_KEY=<your key>
//
// Request:  POST { query: string, callerId: string }
// Response: { results: { videoId, title, thumbnailUrl, durationText }[] }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESULTS = 8;
const DAILY_LIMIT_PER_CALLER = 50;

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('YOUTUBE_API_KEY');
  if (apiKey === undefined || apiKey.length === 0) {
    return new Response(JSON.stringify({ error: 'not-configured' }), {
      status: 503,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let body: { query?: unknown; callerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad-request' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : '';
  const callerId = typeof body.callerId === 'string' ? body.callerId.slice(0, 64) : '';
  if (query.length === 0 || callerId.length === 0) {
    return new Response(JSON.stringify({ error: 'bad-request' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (isRateLimited(callerId)) {
    return new Response(JSON.stringify({ error: 'rate-limited' }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('maxResults', String(MAX_RESULTS));
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('key', apiKey);

  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) {
    return new Response(JSON.stringify({ error: 'upstream-error' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  const searchData = (await searchResponse.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } };
    }>;
  };

  const items = (searchData.items ?? []).filter(
    (item) => typeof item.id?.videoId === 'string',
  );
  const ids = items.map((item) => item.id!.videoId!).join(',');

  const durations = new Map<string, string>();
  if (ids.length > 0) {
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.searchParams.set('part', 'contentDetails');
    videosUrl.searchParams.set('id', ids);
    videosUrl.searchParams.set('key', apiKey);
    const videosResponse = await fetch(videosUrl);
    if (videosResponse.ok) {
      const videosData = (await videosResponse.json()) as {
        items?: Array<{ id?: string; contentDetails?: { duration?: string } }>;
      };
      for (const video of videosData.items ?? []) {
        if (typeof video.id === 'string' && typeof video.contentDetails?.duration === 'string') {
          durations.set(video.id, parseIsoDuration(video.contentDetails.duration));
        }
      }
    }
  }

  const results = items.map((item) => ({
    videoId: item.id!.videoId!,
    title: item.snippet?.title ?? 'Untitled',
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? '',
    durationText: durations.get(item.id!.videoId!) ?? '',
  }));

  return new Response(JSON.stringify({ results }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
