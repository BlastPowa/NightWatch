import { supabase } from '@/lib/supabase';

export interface SearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationText: string;
}

export type SearchOutcome =
  | { status: 'ok'; results: SearchResult[]; nextPageToken: string | null }
  | { status: 'not-configured' }
  | { status: 'rate-limited' }
  | { status: 'error' };

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
      (r): r is Omit<SearchResult, 'channelTitle'> & { channelTitle?: unknown } =>
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

/** Trending grid for the Discovery Hub (Phase 16). categoryId '' = all. */
export async function getTrending(
  categoryId: string,
  callerId: string,
  pageToken?: string,
): Promise<SearchOutcome> {
  return invoke({ kind: 'trending', categoryId, callerId, ...(pageToken ? { pageToken } : {}) });
}
