import { describe, expect, it } from 'vitest';
import { parsePlaybackUrl } from '@shared/mediaBridge';
import type { HtmlMediaSourceDescriptor } from '@shared/media';
import { LEASE_TTL_MS, LeaseRegistry, parseByteRange } from './leases';

const descriptor: HtmlMediaSourceDescriptor = {
  schemaVersion: 1,
  kind: 'local',
  fingerprint: `sha256:${'d'.repeat(64)}`,
  title: 'Clip',
  mimeType: 'video/mp4',
  size: 1000,
};

describe('lease issuance', () => {
  it('mints 128 bits of entropy, hex encoded', () => {
    const registry = new LeaseRegistry();
    const lease = registry.create(descriptor, 1, { localPath: 'C:/videos/clip.mp4' });
    expect(lease.leaseId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never repeats a lease id', () => {
    const registry = new LeaseRegistry();
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(registry.create(descriptor, 1, { localPath: 'C:/videos/clip.mp4' }).leaseId);
    }
    expect(seen.size).toBe(500);
  });

  it('does not derive the lease id from the path or fingerprint', () => {
    const registry = new LeaseRegistry();
    const a = registry.create(descriptor, 1, { localPath: 'C:/videos/clip.mp4' });
    const b = registry.create(descriptor, 1, { localPath: 'C:/videos/clip.mp4' });
    // Same file, same window: still two unrelated capabilities.
    expect(a.leaseId).not.toBe(b.leaseId);
  });

  it('builds a playback url that round-trips to the lease id', () => {
    const registry = new LeaseRegistry();
    const lease = registry.create(descriptor, 1, { localPath: 'C:/videos/clip.mp4' });
    expect(lease.playbackUrl).toBe(`nightwatch-media://stream/${lease.leaseId}`);
    expect(parsePlaybackUrl(lease.playbackUrl)).toBe(lease.leaseId);
  });

  it('never puts the path in the lease it hands back', () => {
    const registry = new LeaseRegistry();
    const lease = registry.create(descriptor, 1, { localPath: 'C:/videos/secret-holiday.mp4' });
    expect(JSON.stringify(lease)).not.toContain('secret-holiday');
    expect(JSON.stringify(lease)).not.toContain('C:');
  });
});

describe('lease resolution', () => {
  it('resolves a live lease', () => {
    const registry = new LeaseRegistry();
    const lease = registry.create(descriptor, 7, { localPath: 'C:/videos/clip.mp4' });
    const record = registry.resolve(lease.leaseId);
    expect(record?.localPath).toBe('C:/videos/clip.mp4');
    expect(record?.windowId).toBe(7);
  });

  it('treats an expired lease as absent and drops it', () => {
    const registry = new LeaseRegistry();
    const now = 1_000_000;
    const lease = registry.create(descriptor, 1, { localPath: 'C:/videos/clip.mp4' }, now);
    expect(registry.resolve(lease.leaseId, now + LEASE_TTL_MS - 1)).not.toBeNull();
    expect(registry.resolve(lease.leaseId, now + LEASE_TTL_MS)).toBeNull();
    expect(registry.size).toBe(0);
  });

  it('returns null for an unknown lease', () => {
    const registry = new LeaseRegistry();
    expect(registry.resolve('0'.repeat(32))).toBeNull();
  });

  it('forgets a released lease', () => {
    const registry = new LeaseRegistry();
    const lease = registry.create(descriptor, 1, { localPath: 'C:/videos/clip.mp4' });
    registry.release(lease.leaseId);
    expect(registry.resolve(lease.leaseId)).toBeNull();
  });
});

describe('lease cleanup', () => {
  it('drops every lease belonging to a destroyed window, and no others', () => {
    const registry = new LeaseRegistry();
    const a = registry.create(descriptor, 1, { localPath: 'C:/videos/a.mp4' });
    const b = registry.create(descriptor, 1, { localPath: 'C:/videos/b.mp4' });
    const other = registry.create(descriptor, 2, { localPath: 'C:/videos/c.mp4' });

    registry.releaseForWindow(1);

    expect(registry.resolve(a.leaseId)).toBeNull();
    expect(registry.resolve(b.leaseId)).toBeNull();
    expect(registry.resolve(other.leaseId)).not.toBeNull();
  });

  it('drops everything on app exit', () => {
    const registry = new LeaseRegistry();
    registry.create(descriptor, 1, { localPath: 'C:/videos/a.mp4' });
    registry.create(descriptor, 2, { localPath: 'C:/videos/b.mp4' });
    registry.releaseAll();
    expect(registry.size).toBe(0);
  });
});

describe('playback url parsing', () => {
  const id = 'a'.repeat(32);

  it('accepts exactly the canonical form', () => {
    expect(parsePlaybackUrl(`nightwatch-media://stream/${id}`)).toBe(id);
  });

  it('rejects anything else', () => {
    // Each of these is a way a handler gets talked into serving the wrong thing.
    const bad = [
      `nightwatch-media://stream/${id}?range=0-1`,
      `nightwatch-media://stream/${id}/../../etc/passwd`,
      `nightwatch-media://stream/${id}extra`,
      `nightwatch-media://stream/${'A'.repeat(32)}`,
      `nightwatch-media://stream/${'a'.repeat(31)}`,
      `nightwatch-media://other/${id}`,
      `nightwatch-media://stream/`,
      `https://evil.example/stream/${id}`,
      `file:///C:/videos/clip.mp4`,
      '',
    ];
    for (const url of bad) {
      expect(parsePlaybackUrl(url)).toBeNull();
    }
  });
});

describe('byte range parsing', () => {
  const size = 1000;

  it('reports no range when the header is absent or blank', () => {
    expect(parseByteRange(null, size).kind).toBe('none');
    expect(parseByteRange(undefined, size).kind).toBe('none');
    expect(parseByteRange('   ', size).kind).toBe('none');
  });

  it('parses the first bytes', () => {
    expect(parseByteRange('bytes=0-99', size)).toEqual({
      kind: 'ok',
      range: { start: 0, end: 99 },
    });
  });

  it('parses a middle range', () => {
    expect(parseByteRange('bytes=500-599', size)).toEqual({
      kind: 'ok',
      range: { start: 500, end: 599 },
    });
  });

  it('parses an open-ended range to the final byte', () => {
    expect(parseByteRange('bytes=900-', size)).toEqual({
      kind: 'ok',
      range: { start: 900, end: 999 },
    });
  });

  it('parses a suffix range as the last N bytes', () => {
    expect(parseByteRange('bytes=-100', size)).toEqual({
      kind: 'ok',
      range: { start: 900, end: 999 },
    });
  });

  it('clamps a suffix longer than the file to the whole file', () => {
    expect(parseByteRange('bytes=-5000', size)).toEqual({
      kind: 'ok',
      range: { start: 0, end: 999 },
    });
  });

  it('clamps an end past the file, which players legitimately ask for', () => {
    expect(parseByteRange('bytes=0-99999', size)).toEqual({
      kind: 'ok',
      range: { start: 0, end: 999 },
    });
  });

  it('rejects a start at or past the end as unsatisfiable', () => {
    // Unlike an end past the file, this one is a real 416.
    expect(parseByteRange('bytes=1000-', size).kind).toBe('unsatisfiable');
    expect(parseByteRange('bytes=5000-6000', size).kind).toBe('unsatisfiable');
  });

  it('rejects a reversed range', () => {
    expect(parseByteRange('bytes=500-100', size).kind).toBe('unsatisfiable');
  });

  it('refuses multiple ranges rather than serving only the first', () => {
    // Answering just the first range gives the player bytes it did not ask for.
    expect(parseByteRange('bytes=0-99,200-299', size).kind).toBe('unsatisfiable');
  });

  it('rejects malformed and non-byte units', () => {
    for (const header of [
      'bytes=',
      'bytes=-',
      'bytes=abc-def',
      'items=0-99',
      'bytes 0-99',
      'bytes=0-99;boom',
      'bytes=-0',
      'bytes=0-99 ,',
    ]) {
      expect(parseByteRange(header, size).kind).toBe('unsatisfiable');
    }
  });
});
