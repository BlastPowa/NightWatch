/**
 * YouTube URL parsing. Pure functions, no player dependencies — used by
 * the renderer now and by the sync layer in later phases.
 */

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(id: string): boolean {
  return VIDEO_ID_PATTERN.test(id);
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'www.youtube-nocookie.com',
]);

const PATH_PREFIXES = ['/shorts/', '/live/', '/embed/', '/v/'];

/**
 * Extract a video id from user input: a full YouTube URL in any common
 * form (watch, youtu.be, shorts, live, embed) or a raw 11-character id.
 * Returns null if no valid id is found.
 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();

  if (isValidVideoId(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return isValidVideoId(id) ? id : null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname)) {
    return null;
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? '';
    return isValidVideoId(id) ? id : null;
  }

  for (const prefix of PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      const id = url.pathname.slice(prefix.length).split('/')[0] ?? '';
      return isValidVideoId(id) ? id : null;
    }
  }

  return null;
}
