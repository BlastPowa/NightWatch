import { supabase } from '@/lib/supabase';

export interface SearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  channelThumbnailUrl: string;
  thumbnailUrl: string;
  durationText: string;
}

export type SearchOutcome =
  | { status: 'ok'; results: SearchResult[]; nextPageToken: string | null }
  | { status: 'not-configured' }
  | { status: 'rate-limited' }
  | { status: 'error' };

/** A single video's details (Phase 24). Same item shape as a search result. */
export type VideoDetails = SearchResult;

export type VideoDetailsOutcome =
  | { status: 'ok'; details: VideoDetails }
  | { status: 'unavailable' }
  | { status: 'not-configured' }
  | { status: 'rate-limited' }
  | { status: 'error' };

/** Exactly an 11-character YouTube id, matching the Edge Function's check. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function normalizeResult(value: unknown): SearchResult | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const r = value as Record<string, unknown>;
  if (typeof r['videoId'] !== 'string' || typeof r['title'] !== 'string' || typeof r['thumbnailUrl'] !== 'string') {
    return null;
  }
  return {
    videoId: r['videoId'],
    title: r['title'],
    channelTitle: typeof r['channelTitle'] === 'string' ? r['channelTitle'] : '',
    channelThumbnailUrl: typeof r['channelThumbnailUrl'] === 'string' ? r['channelThumbnailUrl'] : '',
    thumbnailUrl: r['thumbnailUrl'],
    durationText: typeof r['durationText'] === 'string' ? r['durationText'] : '',
  };
}

/** Trending category chips (YouTube category ids). '' = all. */
export const TRENDING_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: '', label: 'All' },
  { id: '10', label: 'Music' },
  { id: '20', label: 'Gaming' },
  { id: '24', label: 'Entertainment' },
  { id: '17', label: 'Sports' },
  { id: '1', label: 'Film' },
  { id: '28', label: 'Tech & Science' },
];

function normalizeResults(data: unknown): SearchResult[] | null {
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    return null;
  }
  return results
    .filter(
      (r): r is Omit<SearchResult, 'channelTitle' | 'channelThumbnailUrl' | 'durationText'> & { channelTitle?: unknown; channelThumbnailUrl?: unknown; durationText?: unknown } =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as SearchResult).videoId === 'string' &&
        typeof (r as SearchResult).title === 'string' &&
        typeof (r as SearchResult).thumbnailUrl === 'string',
    )
    .map((r) => ({
      videoId: r.videoId,
      title: r.title,
      channelTitle: typeof r.channelTitle === 'string' ? r.channelTitle : '',
      channelThumbnailUrl: typeof r.channelThumbnailUrl === 'string' ? r.channelThumbnailUrl : '',
      thumbnailUrl: r.thumbnailUrl,
      durationText: typeof r.durationText === 'string' ? r.durationText : '',
    }));
}

async function invoke(body: Record<string, unknown>): Promise<SearchOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('search-youtube', { body });
    if (error !== null) {
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 503 || status === 404) {
        return { status: 'not-configured' };
      }
      if (status === 429) {
        return { status: 'rate-limited' };
      }
      return { status: 'error' };
    }
    const results = normalizeResults(data);
    if (results === null) {
      return { status: 'error' };
    }
    const token = (data as { nextPageToken?: unknown }).nextPageToken;
    return {
      status: 'ok',
      results,
      nextPageToken: typeof token === 'string' && token.length > 0 ? token : null,
    };
  } catch {
    return { status: 'error' };
  }
}

/**
 * In-app YouTube search via the search-youtube Edge Function (§7.6).
 * Pass the previous outcome's nextPageToken to append the next page — the
 * function serves those from its cache, so paging costs no YouTube quota.
 */
export async function searchYouTube(
  query: string,
  callerId: string,
  pageToken?: string,
): Promise<SearchOutcome> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { status: 'ok', results: [], nextPageToken: null };
  }
  return invoke({ kind: 'search', query: trimmed, callerId, ...(pageToken ? { pageToken } : {}) });
}

/**
 * Fetch one video's details via the search-youtube Edge Function (Phase 24).
 * Used to hydrate a shared video id (e.g. a friend's presence) into a card.
 * Never changes the search/trending signatures.
 */
export async function getVideoDetails(
  videoId: string,
  callerId: string,
): Promise<VideoDetailsOutcome> {
  if (!YOUTUBE_ID.test(videoId)) {
    return { status: 'unavailable' };
  }
  try {
    const { data, error } = await supabase.functions.invoke('search-youtube', {
      body: { kind: 'details', videoId, callerId },
    });
    if (error !== null) {
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 503) {
        return { status: 'not-configured' };
      }
      if (status === 429) {
        return { status: 'rate-limited' };
      }
      if (status === 404) {
        return { status: 'unavailable' };
      }
      return { status: 'error' };
    }
    const details = normalizeResult((data as { result?: unknown }).result);
    return details === null ? { status: 'error' } : { status: 'ok', details };
  } catch {
    return { status: 'error' };
  }
}

/** Trending grid for the Discovery Hub (Phase 16). categoryId '' = all. */
export async function getTrending(
  categoryId: string,
  callerId: string,
  pageToken?: string,
): Promise<SearchOutcome> {
  return invoke({ kind: 'trending', categoryId, callerId, ...(pageToken ? { pageToken } : {}) });
}
