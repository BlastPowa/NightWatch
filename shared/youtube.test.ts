import { describe, expect, it } from 'vitest';
import { extractVideoId, isValidVideoId } from './youtube';

describe('isValidVideoId', () => {
  it('accepts an 11-character id using the full YouTube alphabet', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(isValidVideoId('_-aB3cD4eF5')).toBe(true);
  });

  it('rejects ids of the wrong length', () => {
    expect(isValidVideoId('dQw4w9WgXc')).toBe(false);
    expect(isValidVideoId('dQw4w9WgXcQQ')).toBe(false);
    expect(isValidVideoId('')).toBe(false);
  });

  it('rejects characters outside the id alphabet', () => {
    expect(isValidVideoId('dQw4w9WgXc!')).toBe(false);
    expect(isValidVideoId('dQw4w9WgXc ')).toBe(false);
  });
});

describe('extractVideoId', () => {
  const id = 'dQw4w9WgXcQ';

  it('passes through a bare id', () => {
    expect(extractVideoId(id)).toBe(id);
    expect(extractVideoId(`  ${id}  `)).toBe(id);
  });

  it('reads every link form we advertise support for', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
    expect(extractVideoId(`https://youtu.be/${id}`)).toBe(id);
    expect(extractVideoId(`https://www.youtube.com/shorts/${id}`)).toBe(id);
    expect(extractVideoId(`https://www.youtube.com/live/${id}`)).toBe(id);
    expect(extractVideoId(`https://www.youtube.com/embed/${id}`)).toBe(id);
    expect(extractVideoId(`https://m.youtube.com/watch?v=${id}`)).toBe(id);
    expect(extractVideoId(`https://music.youtube.com/watch?v=${id}`)).toBe(id);
  });

  it('accepts a host-only link with no scheme, as pasted from a browser bar', () => {
    expect(extractVideoId(`youtube.com/watch?v=${id}`)).toBe(id);
  });

  it('keeps the id when extra query parameters ride along', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${id}&t=42s&list=PL123`)).toBe(id);
    expect(extractVideoId(`https://youtu.be/${id}?t=42`)).toBe(id);
  });

  it('refuses a non-YouTube host that merely looks like one', () => {
    // The guard that matters: a lookalike host must not be trusted just
    // because its path shape matches.
    expect(extractVideoId(`https://youtube.com.evil.example/watch?v=${id}`)).toBeNull();
    expect(extractVideoId(`https://notyoutube.com/watch?v=${id}`)).toBeNull();
    expect(extractVideoId(`https://vimeo.com/watch?v=${id}`)).toBeNull();
  });

  it('returns null for junk rather than throwing', () => {
    expect(extractVideoId('')).toBeNull();
    expect(extractVideoId('not a url')).toBeNull();
    expect(extractVideoId('https://www.youtube.com/watch')).toBeNull();
    expect(extractVideoId('https://www.youtube.com/watch?v=tooshort')).toBeNull();
  });
});
