import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlMediaSourceDescriptor } from '@shared/media';

// The service reaches for Electron at import time. Only the pieces the
// streaming path touches need to exist; anything this test calls that is not
// stubbed here should fail loudly rather than silently no-op.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: { fromWebContents: () => null, fromId: () => null },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
}));

vi.mock('../logger', () => ({
  logger: { write: vi.fn(), init: vi.fn() },
}));

const { LeaseRegistry } = await import('./leases');
const { MediaService } = await import('./service');

let workDir: string;
let leases: InstanceType<typeof LeaseRegistry>;
let service: InstanceType<typeof MediaService>;
let videoPath: string;
let videoBytes: Buffer;
let videoModifiedAtMs: number;

const SIZE = 4096;

function descriptorFor(size: number): HtmlMediaSourceDescriptor {
  return {
    schemaVersion: 1,
    kind: 'local',
    fingerprint: `sha256:${'e'.repeat(64)}`,
    title: 'Clip',
    mimeType: 'video/mp4',
    size,
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'nw-svc-'));
  videoBytes = randomBytes(SIZE);
  videoPath = path.join(workDir, 'clip.mp4');
  await writeFile(videoPath, videoBytes);
  videoModifiedAtMs = (await stat(videoPath)).mtimeMs;

  leases = new LeaseRegistry();
  service = new MediaService(workDir, () => true, leases);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function leaseUrl(size = SIZE, filePath = videoPath): string {
  return leases.create(descriptorFor(size), 1, {
    localPath: filePath,
    localModifiedAtMs: videoModifiedAtMs,
  }).playbackUrl;
}

async function bodyOf(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe('method handling', () => {
  it('rejects every method except GET and HEAD', async () => {
    const url = leaseUrl();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const response = await service.handleStreamRequest(new Request(url, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET, HEAD');
    }
  });

  it('answers HEAD with headers and no body', async () => {
    const response = await service.handleStreamRequest(new Request(leaseUrl(), { method: 'HEAD' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe(String(SIZE));
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect((await bodyOf(response)).length).toBe(0);
  });

  it('answers a ranged HEAD with 206 and no body', async () => {
    const response = await service.handleStreamRequest(
      new Request(leaseUrl(), { method: 'HEAD', headers: { Range: 'bytes=0-99' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(`bytes 0-99/${String(SIZE)}`);
    expect((await bodyOf(response)).length).toBe(0);
  });
});

describe('lease enforcement', () => {
  it('404s an unknown lease', async () => {
    const response = await service.handleStreamRequest(
      new Request(`nightwatch-media://stream/${'0'.repeat(32)}`),
    );
    expect(response.status).toBe(404);
  });

  it('404s an expired lease, indistinguishably from an unknown one', async () => {
    // A probe must not learn whether a lease ever existed.
    const lease = leases.create(descriptorFor(SIZE), 1, { localPath: videoPath }, 0);
    const response = await service.handleStreamRequest(new Request(lease.playbackUrl));
    expect(response.status).toBe(404);
  });

  it('404s a released lease', async () => {
    const lease = leases.create(descriptorFor(SIZE), 1, { localPath: videoPath });
    leases.release(lease.leaseId);
    expect((await service.handleStreamRequest(new Request(lease.playbackUrl))).status).toBe(404);
  });

  it('404s a malformed url and never touches the disk', async () => {
    for (const url of [
      'nightwatch-media://stream/short',
      `nightwatch-media://stream/${'a'.repeat(32)}?x=1`,
      'nightwatch-media://stream/',
      'nightwatch-media://other/aaaa',
    ]) {
      expect((await service.handleStreamRequest(new Request(url))).status).toBe(404);
    }
  });

  it('404s and revokes when the file has vanished', async () => {
    const url = leaseUrl();
    await rm(videoPath);
    expect((await service.handleStreamRequest(new Request(url))).status).toBe(404);
    // Revoked, so a later request cannot race a recreated file into the lease.
    expect((await service.handleStreamRequest(new Request(url))).status).toBe(404);
  });

  it('404s and revokes when the file changed size under the lease', async () => {
    const url = leaseUrl();
    await writeFile(videoPath, randomBytes(SIZE * 2));
    expect((await service.handleStreamRequest(new Request(url))).status).toBe(404);
  });

  it('404s and revokes when same-size bytes replace the leased file', async () => {
    const url = leaseUrl();
    await writeFile(videoPath, randomBytes(SIZE));
    const future = new Date(Date.now() + 10_000);
    await utimes(videoPath, future, future);
    expect((await service.handleStreamRequest(new Request(url))).status).toBe(404);
    expect((await service.handleStreamRequest(new Request(url))).status).toBe(404);
  });
});

describe('full reads', () => {
  it('serves the whole file with 200 when no range is asked for', async () => {
    const response = await service.handleStreamRequest(new Request(leaseUrl()));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe(String(SIZE));
    expect(await bodyOf(response)).toEqual(videoBytes);
  });

  it('never caches media bytes', async () => {
    const response = await service.handleStreamRequest(new Request(leaseUrl()));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('range reads return exactly the requested bytes', () => {
  it('serves the first bytes', async () => {
    const response = await service.handleStreamRequest(
      new Request(leaseUrl(), { headers: { Range: 'bytes=0-99' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Length')).toBe('100');
    expect(response.headers.get('Content-Range')).toBe(`bytes 0-99/${String(SIZE)}`);
    expect(await bodyOf(response)).toEqual(videoBytes.subarray(0, 100));
  });

  it('serves a middle range', async () => {
    const response = await service.handleStreamRequest(
      new Request(leaseUrl(), { headers: { Range: 'bytes=1000-1999' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(`bytes 1000-1999/${String(SIZE)}`);
    expect(await bodyOf(response)).toEqual(videoBytes.subarray(1000, 2000));
  });

  it('serves the final bytes', async () => {
    const response = await service.handleStreamRequest(
      new Request(leaseUrl(), { headers: { Range: `bytes=${String(SIZE - 10)}-` } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(await bodyOf(response)).toEqual(videoBytes.subarray(SIZE - 10));
  });

  it('serves a suffix range', async () => {
    const response = await service.handleStreamRequest(
      new Request(leaseUrl(), { headers: { Range: 'bytes=-10' } }),
    );
    expect(response.status).toBe(206);
    expect(await bodyOf(response)).toEqual(videoBytes.subarray(SIZE - 10));
  });

  it('serves a single-byte range', async () => {
    // Note this asserts correctness, not that the read was bounded. The
    // no-whole-file-buffering guarantee comes from passing start/end to
    // createReadStream; asserting it here would mean measuring memory, which is
    // too flaky to be worth it. The packaged test in the handoff covers it.
    const response = await service.handleStreamRequest(
      new Request(leaseUrl(), { headers: { Range: 'bytes=0-0' } }),
    );
    const body = await bodyOf(response);
    expect(body.length).toBe(1);
    expect(body[0]).toBe(videoBytes[0]);
  });

  it('416s an unsatisfiable range with the full size', async () => {
    const response = await service.handleStreamRequest(
      new Request(leaseUrl(), { headers: { Range: 'bytes=99999-100000' } }),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe(`bytes */${String(SIZE)}`);
  });

  it('416s multiple ranges', async () => {
    const response = await service.handleStreamRequest(
      new Request(leaseUrl(), { headers: { Range: 'bytes=0-99,200-299' } }),
    );
    expect(response.status).toBe(416);
  });
});

describe('leak checks', () => {
  it('never puts a path or lease id in a response header', async () => {
    const url = leaseUrl();
    const response = await service.handleStreamRequest(new Request(url, { method: 'HEAD' }));
    const serialized = JSON.stringify([...response.headers.entries()]);
    expect(serialized).not.toContain('clip.mp4');
    expect(serialized).not.toContain(workDir);
    expect(serialized).not.toContain(url.split('/').pop());
  });
});

describe('shutdown', () => {
  it('drops every lease so nothing survives an app restart', async () => {
    const url = leaseUrl();
    service.shutdown();
    expect((await service.handleStreamRequest(new Request(url))).status).toBe(404);
  });

  it('drops leases owned by a destroyed window', async () => {
    const url = leaseUrl();
    service.handleWindowDestroyed(1);
    expect((await service.handleStreamRequest(new Request(url))).status).toBe(404);
  });
});
