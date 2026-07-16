import { describe, expect, it } from 'vitest';
import { ROOM_EVENTS } from './events';
import { deriveSourceKey } from './media';
import {
  HOST_AUTHORITATIVE_MEDIA_EVENTS,
  MEDIA_V1_EVENTS,
  canStartCustomMediaSession,
  isFresherRevision,
  isHostAuthoritativeMediaEvent,
  parseMediaLoadEvent,
  parseMediaReadyEvent,
  parsePlaybackSnapshot,
  type PlaybackSnapshotV1,
} from './mediaPlayback';

const HASH = 'c'.repeat(64);

const localSource = {
  schemaVersion: 1 as const,
  kind: 'local' as const,
  fingerprint: `sha256:${HASH}` as const,
  title: 'Home video',
  mimeType: 'video/mp4' as const,
  size: 4096,
};

const snapshot: PlaybackSnapshotV1 = {
  protocolVersion: 1,
  sessionId: 'session_abcd1234',
  sourceKey: deriveSourceKey(localSource),
  positionSeconds: 12.5,
  durationSeconds: 600,
  paused: false,
  playbackRate: 1,
  hostClockMs: 1_700_000_000_000,
  revision: 3,
};

describe('legacy events are untouched', () => {
  it('does not add media:v1 events to the existing room event registry', () => {
    // A v0.1.x client binds exactly these names. Adding to this list would put
    // a custom descriptor on a channel old clients read as YouTube.
    for (const name of MEDIA_V1_EVENTS) {
      expect(ROOM_EVENTS).not.toContain(name);
    }
  });

  it('keeps the legacy playback and sync events exactly as they were', () => {
    expect(ROOM_EVENTS).toEqual([
      'playback:load',
      'playback:play',
      'playback:pause',
      'chat:message',
      'reaction:stamp',
      'queue:add',
      'queue:vote',
      'queue:remove',
      'queue:state',
      'sync:request',
      'sync:state',
    ]);
  });
});

describe('snapshot validation', () => {
  it('accepts a well-formed snapshot round-tripped through the wire', () => {
    const parsed = parsePlaybackSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(snapshot);
    }
  });

  it('accepts a null duration (live or not yet known)', () => {
    expect(parsePlaybackSnapshot({ ...snapshot, durationSeconds: null }).ok).toBe(true);
  });

  it('rejects an unsupported protocol version', () => {
    const parsed = parsePlaybackSnapshot({ ...snapshot, protocolVersion: 2 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('incompatible-client');
    }
  });

  it('rejects non-finite times rather than coercing them to zero', () => {
    // Coercing NaN to 0 would yank every viewer back to the start.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, '5']) {
      expect(parsePlaybackSnapshot({ ...snapshot, positionSeconds: bad }).ok).toBe(false);
    }
    expect(parsePlaybackSnapshot({ ...snapshot, hostClockMs: Number.NaN }).ok).toBe(false);
    expect(parsePlaybackSnapshot({ ...snapshot, durationSeconds: Number.NaN }).ok).toBe(false);
  });

  it('rejects an out-of-range playback rate', () => {
    expect(parsePlaybackSnapshot({ ...snapshot, playbackRate: 0 }).ok).toBe(false);
    expect(parsePlaybackSnapshot({ ...snapshot, playbackRate: 16 }).ok).toBe(false);
    expect(parsePlaybackSnapshot({ ...snapshot, playbackRate: Number.NaN }).ok).toBe(false);
  });

  it('rejects an invalid session id or source key', () => {
    expect(parsePlaybackSnapshot({ ...snapshot, sessionId: 'x' }).ok).toBe(false);
    expect(parsePlaybackSnapshot({ ...snapshot, sourceKey: 'C:/videos/clip.mp4' }).ok).toBe(false);
    expect(parsePlaybackSnapshot({ ...snapshot, sourceKey: '' }).ok).toBe(false);
  });

  it('rejects an invalid revision', () => {
    expect(parsePlaybackSnapshot({ ...snapshot, revision: -1 }).ok).toBe(false);
    expect(parsePlaybackSnapshot({ ...snapshot, revision: 1.5 }).ok).toBe(false);
  });

  it('rejects a non-boolean paused flag', () => {
    expect(parsePlaybackSnapshot({ ...snapshot, paused: 'true' }).ok).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 'snapshot', 5, []]) {
      expect(parsePlaybackSnapshot(value).ok).toBe(false);
    }
  });
});

describe('load event validation', () => {
  it('accepts a local source', () => {
    const parsed = parseMediaLoadEvent({
      sessionId: 'session_abcd1234',
      source: localSource,
      revision: 1,
    });
    expect(parsed.ok).toBe(true);
  });

  it('refuses YouTube on the media:v1 channel', () => {
    // YouTube keeps its legacy path; two sources of truth is a desync bug.
    const parsed = parseMediaLoadEvent({
      sessionId: 'session_abcd1234',
      source: { schemaVersion: 1, kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
      revision: 1,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('invalid-request');
    }
  });

  it('rejects a smuggled path field on the source', () => {
    const parsed = parseMediaLoadEvent({
      sessionId: 'session_abcd1234',
      source: { ...localSource, path: 'C:/Users/me/clip.mp4' },
      revision: 1,
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a bad session id or revision', () => {
    expect(parseMediaLoadEvent({ sessionId: '!', source: localSource, revision: 1 }).ok).toBe(
      false,
    );
    expect(
      parseMediaLoadEvent({ sessionId: 'session_abcd1234', source: localSource, revision: -2 }).ok,
    ).toBe(false);
  });
});

describe('ready event validation', () => {
  it('accepts each known outcome', () => {
    for (const outcome of [
      'ready',
      'missing-source',
      'permission-required',
      'unsupported-format',
      'source-mismatch',
      'incompatible-client',
    ]) {
      const parsed = parseMediaReadyEvent({
        sessionId: 'session_abcd1234',
        sourceKey: deriveSourceKey(localSource),
        ready: outcome === 'ready',
        outcome,
      });
      expect(parsed.ok).toBe(true);
    }
  });

  it('rejects an unknown outcome', () => {
    const parsed = parseMediaReadyEvent({
      sessionId: 'session_abcd1234',
      sourceKey: deriveSourceKey(localSource),
      ready: false,
      outcome: 'disk-error: C:/Users/me/clip.mp4 not found',
    });
    expect(parsed.ok).toBe(false);
  });
});

describe('host authority', () => {
  it('marks exactly the authoritative events', () => {
    for (const name of HOST_AUTHORITATIVE_MEDIA_EVENTS) {
      expect(isHostAuthoritativeMediaEvent(name)).toBe(true);
    }
    // Readiness is per-participant, so members must be able to send it.
    expect(isHostAuthoritativeMediaEvent('media:v1:ready')).toBe(false);
    expect(isHostAuthoritativeMediaEvent('media:v1:request-snapshot')).toBe(false);
  });
});

describe('session gating', () => {
  it('starts only when every participant speaks version 1', () => {
    expect(canStartCustomMediaSession([[1], [1]])).toBe(true);
  });

  it('does not start when a participant advertises nothing (old client)', () => {
    expect(canStartCustomMediaSession([[1], []])).toBe(false);
  });

  it('does not start when a participant only speaks a future version', () => {
    expect(canStartCustomMediaSession([[1], [2 as 1]])).toBe(false);
  });

  it('does not start with no participants', () => {
    expect(canStartCustomMediaSession([])).toBe(false);
  });
});

describe('revisions', () => {
  it('applies only strictly newer revisions', () => {
    expect(isFresherRevision(3, 4)).toBe(true);
    expect(isFresherRevision(3, 3)).toBe(false);
    expect(isFresherRevision(3, 2)).toBe(false);
  });
});
