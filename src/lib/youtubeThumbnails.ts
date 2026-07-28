/**
 * YouTube's search response commonly supplies `mqdefault` (320px wide),
 * which is suitable for small result rows but becomes visibly soft when used
 * in a Browse card or the cinematic feature stage.  Build a conservative
 * fallback chain from the video id instead.  Not every upload has a maxres
 * asset, so callers must move through this list on image load failure. Cards
 * deliberately use the same high-to-low chain: Browse cards grow well past
 * 480px on desktop and a 480px `hqdefault` source is visibly soft there.
 */
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export type YouTubeThumbnailKind = 'hero' | 'card';

export function getYouTubeThumbnailCandidates(
  videoId: string,
  suppliedUrl: string,
  kind: YouTubeThumbnailKind,
): string[] {
  if (!YOUTUBE_VIDEO_ID.test(videoId)) return suppliedUrl === '' ? [] : [suppliedUrl];

  const base = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}`;
  const variants = kind === 'hero'
    ? ['maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg', 'mqdefault.jpg']
    : ['maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg', 'mqdefault.jpg'];

  // Keep an API-provided non-standard thumbnail as a final escape hatch, but
  // do not request the same URL twice.
  return [...new Set([...variants.map((variant) => `${base}/${variant}`), suppliedUrl].filter(Boolean))];
}
