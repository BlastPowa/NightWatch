import { supabase } from '@/lib/supabase';

export interface SearchResult {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  durationText: string;
}

export type SearchOutcome =
  | { status: 'ok'; results: SearchResult[] }
  | { status: 'not-configured' }
  | { status: 'rate-limited' }
  | { status: 'error' };

/**
 * In-app YouTube search via the search-youtube Edge Function (§7.6).
 * The Google API key lives server-side only.
 */
export async function searchYouTube(query: string, callerId: string): Promise<SearchOutcome> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { status: 'ok', results: [] };
  }

  try {
    const { data, error } = await supabase.functions.invoke('search-youtube', {
      body: { query: trimmed, callerId },
    });

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

    const results = (data as { results?: SearchResult[] }).results;
    if (!Array.isArray(results)) {
      return { status: 'error' };
    }
    return {
      status: 'ok',
      results: results.filter(
        (r) =>
          typeof r.videoId === 'string' &&
          typeof r.title === 'string' &&
          typeof r.thumbnailUrl === 'string',
      ),
    };
  } catch {
    return { status: 'error' };
  }
}
