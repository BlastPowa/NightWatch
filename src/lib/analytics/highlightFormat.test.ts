import { describe, expect, it } from 'vitest';
// Imports the PURE module, not HighlightService. HighlightService reaches the
// Supabase client, which throws at module load when env vars are absent — that
// is exactly how this suite broke CI once. Do not "tidy" this back.
import {
  exportHighlightsMarkdown,
  formatTimestamp,
  highlightLink,
  type Highlight,
} from './highlightFormat';

const highlight = (over: Partial<Highlight> = {}): Highlight => ({
  videoId: 'dQw4w9WgXcQ',
  positionSeconds: 85,
  reactionCount: 4,
  ...over,
});

describe('formatTimestamp', () => {
  it('drops the hour when there is none, like YouTube does', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(9)).toBe('0:09');
    expect(formatTimestamp(85)).toBe('1:25');
    expect(formatTimestamp(600)).toBe('10:00');
  });

  it('zero-pads the minutes only once an hour is shown', () => {
    // 1:04:07, not 1:4:07 — the padding rule changes when hours appear.
    expect(formatTimestamp(3847)).toBe('1:04:07');
    expect(formatTimestamp(3600)).toBe('1:00:00');
  });

  it('does not produce a negative or fractional timestamp', () => {
    expect(formatTimestamp(-10)).toBe('0:00');
    expect(formatTimestamp(85.9)).toBe('1:25');
  });
});

describe('highlightLink', () => {
  it('deep-links into the original video, never to media', () => {
    // Compliance: this must always be a youtube.com watch URL. A change that
    // makes this point at a file, a clip, or a proxy is out of policy.
    const link = highlightLink(highlight());
    expect(link).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=85s');
    expect(link.startsWith('https://www.youtube.com/watch')).toBe(true);
  });

  it('floors a fractional position, because ?t= wants whole seconds', () => {
    expect(highlightLink(highlight({ positionSeconds: 85.7 }))).toContain('&t=85s');
  });
});

describe('exportHighlightsMarkdown', () => {
  it('renders one linked line per highlight', () => {
    const output = exportHighlightsMarkdown([
      highlight({ positionSeconds: 85, reactionCount: 4 }),
      highlight({ positionSeconds: 295, reactionCount: 2 }),
    ]);
    expect(output).toContain('- [1:25](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=85s) — 4 reactions');
    expect(output).toContain('- [4:55](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=295s) — 2 reactions');
  });

  it('says "1 reaction", not "1 reactions"', () => {
    expect(exportHighlightsMarkdown([highlight({ reactionCount: 1 })])).toContain('— 1 reaction');
  });

  it('explains an empty reel rather than exporting a bare heading', () => {
    const output = exportHighlightsMarkdown([]);
    expect(output).toContain('No highlights');
  });
});
