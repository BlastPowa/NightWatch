import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaFingerprint } from '@shared/media';
import {
  MappingStore,
  fingerprintFile,
  isMappingStillValid,
  readFileIdentity,
  type LocalMediaMapping,
} from './mappingStore';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'nw-media-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeVideo(name: string, bytes: Buffer): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, bytes);
  return filePath;
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function mappingFor(filePath: string, fingerprint: string, size: number, mtime: number): LocalMediaMapping {
  return {
    localHandle: randomBytes(16).toString('hex'),
    fingerprint: `sha256:${fingerprint}` as MediaFingerprint,
    title: 'Clip',
    mimeType: 'video/mp4',
    size,
    modifiedAtMs: mtime,
    path: filePath,
  };
}

describe('streaming fingerprints', () => {
  it('computes the same digest node computes in one shot', async () => {
    const bytes = randomBytes(300_000);
    const filePath = await writeVideo('clip.mp4', bytes);
    const outcome = await fingerprintFile(filePath, bytes.length);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.fingerprint).toBe(`sha256:${sha256Of(bytes)}`);
    }
  });

  it('produces a lowercase sha256: prefixed digest', async () => {
    const bytes = randomBytes(1024);
    const filePath = await writeVideo('clip.mp4', bytes);
    const outcome = await fingerprintFile(filePath, bytes.length);
    if (outcome.status === 'ok') {
      expect(outcome.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('reports bounded, monotonic progress that ends at the total', async () => {
    // Larger than the 1 MiB read buffer, so progress fires more than once.
    const bytes = randomBytes(3 * 1024 * 1024);
    const filePath = await writeVideo('big.mp4', bytes);
    const seen: number[] = [];
    await fingerprintFile(filePath, bytes.length, {
      onProgress: (hashed, total) => {
        expect(total).toBe(bytes.length);
        expect(hashed).toBeGreaterThan(0);
        expect(hashed).toBeLessThanOrEqual(total);
        seen.push(hashed);
      },
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(bytes.length);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it('cancels mid-hash and reports cancelled, not a failure', async () => {
    const bytes = randomBytes(8 * 1024 * 1024);
    const filePath = await writeVideo('big.mp4', bytes);
    const controller = new AbortController();
    const promise = fingerprintFile(filePath, bytes.length, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    expect((await promise).status).toBe('cancelled');
  });

  it('reports cancelled when the signal is already aborted', async () => {
    const bytes = randomBytes(1024);
    const filePath = await writeVideo('clip.mp4', bytes);
    const controller = new AbortController();
    controller.abort();
    const outcome = await fingerprintFile(filePath, bytes.length, { signal: controller.signal });
    expect(outcome.status).toBe('cancelled');
  });

  it('fails cleanly on a missing file rather than throwing', async () => {
    const outcome = await fingerprintFile(path.join(workDir, 'gone.mp4'), 10);
    expect(outcome.status).toBe('failed');
  });

  it('hashes an empty file without crashing', async () => {
    const filePath = await writeVideo('empty.mp4', Buffer.alloc(0));
    const outcome = await fingerprintFile(filePath, 0);
    expect(outcome.status).toBe('ok');
  });

  it('gives different files different fingerprints', async () => {
    const a = await writeVideo('a.mp4', Buffer.from('aaaa'));
    const b = await writeVideo('b.mp4', Buffer.from('bbbb'));
    const fa = await fingerprintFile(a, 4);
    const fb = await fingerprintFile(b, 4);
    if (fa.status === 'ok' && fb.status === 'ok') {
      expect(fa.fingerprint).not.toBe(fb.fingerprint);
    }
  });

  it('gives identical bytes under different names the same fingerprint', async () => {
    // The property the whole matching design rests on.
    const bytes = randomBytes(2048);
    const a = await writeVideo('host-copy.mp4', bytes);
    const b = await writeVideo('my-download.mp4', bytes);
    const fa = await fingerprintFile(a, bytes.length);
    const fb = await fingerprintFile(b, bytes.length);
    if (fa.status === 'ok' && fb.status === 'ok') {
      expect(fa.fingerprint).toBe(fb.fingerprint);
    }
  });
});

describe('cache validity', () => {
  it('accepts a mapping whose size and mtime still match', async () => {
    const bytes = randomBytes(512);
    const filePath = await writeVideo('clip.mp4', bytes);
    const identity = await readFileIdentity(filePath);
    expect(identity).not.toBeNull();
    const mapping = mappingFor(filePath, sha256Of(bytes), identity!.size, identity!.modifiedAtMs);
    expect(isMappingStillValid(mapping, identity!)).toBe(true);
  });

  it('rejects a mapping when the size changed', async () => {
    const filePath = await writeVideo('clip.mp4', randomBytes(512));
    const identity = await readFileIdentity(filePath);
    const mapping = mappingFor(filePath, 'a'.repeat(64), 999, identity!.modifiedAtMs);
    expect(isMappingStillValid(mapping, identity!)).toBe(false);
  });

  it('rejects a mapping when the file was touched, even at the same size', async () => {
    // Same length, different bytes — the case a size check alone would miss.
    const filePath = await writeVideo('clip.mp4', Buffer.alloc(512, 1));
    const before = await readFileIdentity(filePath);
    const mapping = mappingFor(filePath, 'a'.repeat(64), before!.size, before!.modifiedAtMs);

    await writeFile(filePath, Buffer.alloc(512, 2));
    const future = new Date(Date.now() + 10_000);
    await utimes(filePath, future, future);

    const after = await readFileIdentity(filePath);
    expect(after!.size).toBe(before!.size);
    expect(isMappingStillValid(mapping, after!)).toBe(false);
  });

  it('returns null identity for a missing file and for a directory', async () => {
    expect(await readFileIdentity(path.join(workDir, 'nope.mp4'))).toBeNull();
    expect(await readFileIdentity(workDir)).toBeNull();
  });
});

describe('mapping store', () => {
  it('round-trips a mapping across a restart', async () => {
    const store = new MappingStore(workDir);
    await store.load();
    const mapping = mappingFor(path.join(workDir, 'clip.mp4'), 'a'.repeat(64), 100, 5);
    await store.put(mapping);

    const reloaded = new MappingStore(workDir);
    await reloaded.load();
    expect(reloaded.get(mapping.localHandle)).toEqual(mapping);
  });

  it('finds a mapping by fingerprint', async () => {
    const store = new MappingStore(workDir);
    await store.load();
    const mapping = mappingFor(path.join(workDir, 'clip.mp4'), 'b'.repeat(64), 100, 5);
    await store.put(mapping);
    expect(store.findByFingerprint(`sha256:${'b'.repeat(64)}`)).toEqual(mapping);
    expect(store.findByFingerprint(`sha256:${'c'.repeat(64)}`)).toBeNull();
  });

  it('reuses the handle for a path already known', async () => {
    const store = new MappingStore(workDir);
    await store.load();
    const filePath = path.join(workDir, 'clip.mp4');
    const mapping = mappingFor(filePath, 'a'.repeat(64), 100, 5);
    await store.put(mapping);
    expect(store.findByPath(filePath)?.localHandle).toBe(mapping.localHandle);
  });

  it('removes a mapping', async () => {
    const store = new MappingStore(workDir);
    await store.load();
    const mapping = mappingFor(path.join(workDir, 'clip.mp4'), 'a'.repeat(64), 100, 5);
    await store.put(mapping);
    await store.remove(mapping.localHandle);
    expect(store.get(mapping.localHandle)).toBeNull();
  });

  it('ignores a file written by an unknown future version rather than rewriting it', async () => {
    // Downgrade must not corrupt an upgrade.
    const filePath = path.join(workDir, 'media-mappings.json');
    await writeFile(filePath, JSON.stringify({ version: 99, mappings: [] }));
    const store = new MappingStore(workDir);
    await store.load();
    expect(store.findByFingerprint(`sha256:${'a'.repeat(64)}`)).toBeNull();
    // Still on disk, untouched.
    expect(JSON.parse(await readFile(filePath, 'utf8')).version).toBe(99);
  });

  it('survives a corrupt store file', async () => {
    await writeFile(path.join(workDir, 'media-mappings.json'), 'not json{{');
    const store = new MappingStore(workDir);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('drops stored entries that fail validation', async () => {
    await writeFile(
      path.join(workDir, 'media-mappings.json'),
      JSON.stringify({
        version: 1,
        mappings: [
          { localHandle: 'not-a-handle', fingerprint: 'sha256:zz', title: 'x' },
          { localHandle: 'a'.repeat(32), fingerprint: `sha256:${'a'.repeat(64)}`, title: 'ok', mimeType: 'application/x-msdownload', size: 1, modifiedAtMs: 1, path: 'C:/x.exe' },
        ],
      }),
    );
    const store = new MappingStore(workDir);
    await store.load();
    expect(store.get('a'.repeat(32))).toBeNull();
    expect(store.findByFingerprint(`sha256:${'a'.repeat(64)}`)).toBeNull();
  });

  it('serializes concurrent writes without corrupting the file', async () => {
    const store = new MappingStore(workDir);
    await store.load();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.put(mappingFor(path.join(workDir, `clip${String(i)}.mp4`), String(i).padStart(64, '0'), 100 + i, i)),
      ),
    );
    const reloaded = new MappingStore(workDir);
    await reloaded.load();
    for (let i = 0; i < 25; i++) {
      expect(reloaded.findByFingerprint(`sha256:${String(i).padStart(64, '0')}`)).not.toBeNull();
    }
  });

  it('writes the store with owner-only permissions where the OS supports them', async () => {
    const store = new MappingStore(workDir);
    await store.load();
    await store.put(mappingFor(path.join(workDir, 'clip.mp4'), 'a'.repeat(64), 100, 5));
    const stats = await stat(path.join(workDir, 'media-mappings.json'));
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o077).toBe(0);
    } else {
      expect(stats.isFile()).toBe(true);
    }
  });
});
