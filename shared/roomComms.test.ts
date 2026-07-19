import { describe, expect, it } from 'vitest';
import {
  commsFailFromRpc,
  disabledRoomMediaCapabilities,
  mayStartFileWatch,
  parseFileWatchReadinessEntry,
  parseRoomMediaMode,
  parseRoomMediaSnapshot,
  type FileWatchReadiness,
} from './roomComms';

const YT = { schemaVersion: 1, kind: 'youtube', videoId: 'dQw4w9WgXcQ' };
const LOCAL = {
  schemaVersion: 1,
  kind: 'local',
  fingerprint: `sha256:${'a'.repeat(64)}`,
  title: 'Movie Night.mp4',
  mimeType: 'video/mp4',
  size: 1024,
};

describe('parseRoomMediaMode', () => {
  it('accepts a v2 youtube mode wrapping the v1 descriptor unchanged', () => {
    const result = parseRoomMediaMode({ modeVersion: 2, mode: 'youtube', descriptor: YT });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.mode === 'youtube') {
      expect(result.value.descriptor.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  it('accepts file-watch with a readiness policy', () => {
    const result = parseRoomMediaMode({
      modeVersion: 2,
      mode: 'file-watch',
      descriptor: LOCAL,
      readiness: 'all-ready',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects file-watch wrapping a youtube descriptor', () => {
    const result = parseRoomMediaMode({
      modeVersion: 2,
      mode: 'file-watch',
      descriptor: YT,
      readiness: 'all-ready',
    });
    expect(result.ok).toBe(false);
  });

  it('accepts live-share with a valid session id and bounded label', () => {
    const result = parseRoomMediaMode({
      modeVersion: 2,
      mode: 'live-share',
      sessionId: 'f'.repeat(32),
      sharerId: 'user-1',
      sourceLabel: 'Screen 1',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a future mode version explicitly as not-supported', () => {
    const result = parseRoomMediaMode({ modeVersion: 3, mode: 'youtube', descriptor: YT });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not-supported');
    }
  });

  it('rejects unknown modes and malformed envelopes', () => {
    expect(parseRoomMediaMode(null).ok).toBe(false);
    expect(parseRoomMediaMode({ modeVersion: 2, mode: 'torrent' }).ok).toBe(false);
    expect(
      parseRoomMediaMode({
        modeVersion: 2,
        mode: 'live-share',
        sessionId: 'nope',
        sharerId: 'u',
        sourceLabel: 'x',
      }).ok,
    ).toBe(false);
  });
});

describe('mayStartFileWatch', () => {
  const ready = (states: Record<string, FileWatchReadiness>) => new Map(Object.entries(states));

  it('host-only requires only the host', () => {
    expect(mayStartFileWatch('host-only', ready({ h: 'ready', v: 'missing-file' }), 'h')).toBe(
      true,
    );
    expect(mayStartFileWatch('host-only', ready({ h: 'buffering' }), 'h')).toBe(false);
  });

  it('all-ready requires everyone', () => {
    expect(mayStartFileWatch('all-ready', ready({ h: 'ready', v: 'ready' }), 'h')).toBe(true);
    expect(mayStartFileWatch('all-ready', ready({ h: 'ready', v: 'offline' }), 'h')).toBe(false);
    expect(mayStartFileWatch('all-ready', new Map(), 'h')).toBe(false);
  });

  it('majority-ready is a strict majority', () => {
    expect(
      mayStartFileWatch('majority-ready', ready({ a: 'ready', b: 'ready', c: 'offline' }), 'a'),
    ).toBe(true);
    expect(
      mayStartFileWatch('majority-ready', ready({ a: 'ready', b: 'offline' }), 'a'),
    ).toBe(false);
  });
});

describe('commsFailFromRpc', () => {
  it('maps undeployed functions to not-supported', () => {
    const outcome = commsFailFromRpc({ code: '42883', message: 'function does not exist' });
    expect(!outcome.ok && outcome.code).toBe('not-supported');
  });

  it('maps blocked / rate / auth messages onto their codes', () => {
    expect(!commsFailFromRpc({ message: 'blocked' }).ok).toBe(true);
    const blocked = commsFailFromRpc({ message: 'blocked' });
    if (!blocked.ok) {
      expect(blocked.code).toBe('blocked');
    }
    const rate = commsFailFromRpc({ message: 'rate limit exceeded' });
    if (!rate.ok) {
      expect(rate.code).toBe('rate-limited');
      expect(rate.retryable).toBe(true);
    }
    const auth = commsFailFromRpc({ message: 'unauthenticated' });
    if (!auth.ok) {
      expect(auth.code).toBe('unauthorized');
    }
  });
});

describe('disabledRoomMediaCapabilities', () => {
  it('has every flag off', () => {
    expect(Object.values(disabledRoomMediaCapabilities()).every((flag) => flag === false)).toBe(
      true,
    );
  });
});

describe('persisted room media parsing', () => {
  it('accepts a valid server snapshot and rejects malformed revisions', () => {
    const valid = parseRoomMediaSnapshot({
      revision: 2,
      controllerId: '00000000-0000-0000-0000-0000000000a1',
      mode: { modeVersion: 2, mode: 'youtube', descriptor: YT },
      updatedAt: '2026-07-19T12:00:00.000Z',
    });
    expect(valid?.revision).toBe(2);
    expect(parseRoomMediaSnapshot({ ...valid, revision: 0 })).toBeNull();
  });

  it('validates normalized readiness roster entries', () => {
    expect(
      parseFileWatchReadinessEntry({
        userId: 'user-1',
        displayName: 'Viewer',
        avatarUrl: null,
        border: null,
        readiness: 'ready',
        updatedAt: '2026-07-19T12:00:00.000Z',
      })?.readiness,
    ).toBe('ready');
    expect(
      parseFileWatchReadinessEntry({
        userId: 'user-1',
        displayName: 'Viewer',
        avatarUrl: null,
        border: null,
        readiness: 'unknown',
        updatedAt: null,
      }),
    ).toBeNull();
  });
});
