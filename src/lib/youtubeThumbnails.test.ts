import { describe, expect, it } from 'vitest';
import { getYouTubeThumbnailCandidates } from '@/lib/youtubeThumbnails';

describe('getYouTubeThumbnailCandidates', () => {
  const videoId = 'abcdefghijk';

  it('uses a high-resolution-first chain for a featured hero', () => {
    expect(getYouTubeThumbnailCandidates(videoId, `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, 'hero')).toEqual([
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hq720.jpg`,
      `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    ]);
  });

  it('uses the highest available image chain for Browse cards', () => {
    expect(getYouTubeThumbnailCandidates(videoId, '', 'card')).toEqual([
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hq720.jpg`,
      `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    ]);
  });

  it('does not manufacture YouTube URLs for invalid ids', () => {
    expect(getYouTubeThumbnailCandidates('not a video', 'https://example.test/image.jpg', 'card')).toEqual([
      'https://example.test/image.jpg',
    ]);
  });
});
