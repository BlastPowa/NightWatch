import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DriveSession,
  fetchDriveMetadata,
  streamDriveRange,
  validateDriveMetadata,
} from './driveClient';
import type { FetchLike } from './driveAuth';
import { DriveTokenStore, type SecretCipher } from './tokenStore';

const FILE_ID = '1AbCdEfGhIjKlMnOpQrSt';
const MAX_SIZE = 32 * 1024 * 1024 * 1024;
const SHA = 'f'.repeat(64);

function goodMetadata(): Record<string, unknown> {
  return {
    id: FILE_ID,
    name: 'Holiday footage.mp4',
    mimeType: 'video/mp4',
    size: '1048576',
    sha256Checksum: SHA,
    capabilities: { canDownload: true },
    trashed: false,
  };
}

describe('metadata validation', () => {
  it('accepts a well-formed binary video file', () => {
    const result = validateDriveMetadata(goodMetadata(), FILE_ID, MAX_SIZE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        fileId: FILE_ID,
        title: 'Holiday footage.mp4',
        mimeType: 'video/mp4',
        size: 1_048_576,
        fingerprint: `sha256:${SHA}`,
      });
    }
  });

  it('rejects metadata for a different file id — a forged payload', () => {
    const forged = { ...goodMetadata(), id: 'someOtherFileId12345' };
    const result = validateDriveMetadata(forged, FILE_ID, MAX_SIZE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-selection');
    }
  });

  it('rejects a trashed file', () => {
    const result = validateDriveMetadata({ ...goodMetadata(), trashed: true }, FILE_ID, MAX_SIZE);
    if (!result.ok) {
      expect(result.error.code).toBe('drive-file-unavailable');
    }
    expect(result.ok).toBe(false);
  });

  it('respects canDownload = false', () => {
    const restricted = { ...goodMetadata(), capabilities: { canDownload: false } };
    const result = validateDriveMetadata(restricted, FILE_ID, MAX_SIZE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('download-restricted');
    }
  });

  it('treats missing capabilities as restricted, not as permitted', () => {
    const noCaps = { ...goodMetadata() };
    delete noCaps['capabilities'];
    const result = validateDriveMetadata(noCaps, FILE_ID, MAX_SIZE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('download-restricted');
    }
  });

  it('rejects Workspace documents, folders, and shortcuts', () => {
    for (const mime of [
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.folder',
      'application/vnd.google-apps.shortcut',
    ]) {
      const result = validateDriveMetadata({ ...goodMetadata(), mimeType: mime }, FILE_ID, MAX_SIZE);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unsupported-format');
      }
    }
  });

  it('rejects unsupported binary types', () => {
    const result = validateDriveMetadata(
      { ...goodMetadata(), mimeType: 'video/x-matroska' },
      FILE_ID,
      MAX_SIZE,
    );
    expect(result.ok).toBe(false);
  });

  it('requires the SHA-256 and never substitutes anything for it', () => {
    // md5Checksum present, sha256 missing: still fingerprint-unavailable.
    const noSha: Record<string, unknown> = { ...goodMetadata(), md5Checksum: 'abc123' };
    delete noSha['sha256Checksum'];
    const result = validateDriveMetadata(noSha, FILE_ID, MAX_SIZE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('fingerprint-unavailable');
    }
  });

  it('rejects zero, non-numeric, and over-limit sizes', () => {
    for (const size of ['0', '-1', 'big', '', '1.5']) {
      expect(validateDriveMetadata({ ...goodMetadata(), size }, FILE_ID, MAX_SIZE).ok).toBe(false);
    }
    expect(validateDriveMetadata({ ...goodMetadata(), size: '999' }, FILE_ID, 100).ok).toBe(false);
  });

  it('rejects an unusable name', () => {
    expect(validateDriveMetadata({ ...goodMetadata(), name: '   ' }, FILE_ID, MAX_SIZE).ok).toBe(false);
  });
});

describe('metadata fetch', () => {
  it('requests exactly the allowed fields with the bearer token', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const fetchFn: FetchLike = async (url, init) => {
      seenUrl = url;
      seenAuth = (init.headers as Record<string, string>)['Authorization'] ?? '';
      return new Response(JSON.stringify(goodMetadata()), { status: 200 });
    };
    const result = await fetchDriveMetadata(fetchFn, 'access-token-1', FILE_ID, MAX_SIZE);
    expect(result.ok).toBe(true);
    expect(seenAuth).toBe('Bearer access-token-1');
    expect(decodeURIComponent(seenUrl)).toContain(
      'id,name,mimeType,size,sha256Checksum,capabilities(canDownload),trashed',
    );
  });

  it('maps provider statuses to typed codes', async () => {
    const cases: Array<[number, string]> = [
      [401, 'auth-expired'],
      [403, 'permission-denied'],
      [404, 'drive-file-unavailable'],
      [429, 'rate-limited'],
      [500, 'drive-file-unavailable'],
    ];
    for (const [status, code] of cases) {
      const fetchFn: FetchLike = async () => new Response('{}', { status });
      const result = await fetchDriveMetadata(fetchFn, 'at', FILE_ID, MAX_SIZE);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
      }
    }
  });

  it('maps a network failure to offline', async () => {
    const down: FetchLike = async () => {
      throw new Error('ENOTFOUND');
    };
    const result = await fetchDriveMetadata(down, 'at', FILE_ID, MAX_SIZE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('offline');
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe('range streaming', () => {
  it('forwards the exact range and the bearer token upstream', async () => {
    let seenRange: string | null = null;
    let seenAuth = '';
    const fetchFn: FetchLike = async (url, init) => {
      expect(url).toContain('alt=media');
      const headers = init.headers as Record<string, string>;
      seenRange = headers['Range'] ?? null;
      seenAuth = headers['Authorization'] ?? '';
      return new Response('0123456789', {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-9/100', 'Content-Length': '10' },
      });
    };
    const response = await streamDriveRange(
      fetchFn,
      'access-token-2',
      { fileId: FILE_ID, rangeHeader: 'bytes=0-9' },
      'video/mp4',
    );
    expect(seenRange).toBe('bytes=0-9');
    expect(seenAuth).toBe('Bearer access-token-2');
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('0123456789');
  });

  it('never exposes the Authorization header downstream', async () => {
    const fetchFn: FetchLike = async () =>
      new Response('data', {
        status: 200,
        headers: {
          'Content-Length': '4',
          // A hostile/echoing upstream: these must all be stripped.
          Authorization: 'Bearer leaked',
          'x-goog-meta-secret': 'leak',
          'set-cookie': 'session=abc',
        },
      });
    const response = await streamDriveRange(
      fetchFn,
      'at',
      { fileId: FILE_ID, rangeHeader: null },
      'video/mp4',
    );
    expect(response.headers.get('Authorization')).toBeNull();
    expect(response.headers.get('x-goog-meta-secret')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes through 416 and collapses auth errors to 404', async () => {
    const notSatisfiable: FetchLike = async () => new Response(null, { status: 416 });
    expect(
      (await streamDriveRange(notSatisfiable, 'at', { fileId: FILE_ID, rangeHeader: 'bytes=9-1' }, 'video/mp4'))
        .status,
    ).toBe(416);

    // The protocol handler must not teach a probing renderer the difference
    // between "no permission" and "no file".
    for (const status of [401, 403, 404, 429]) {
      const failing: FetchLike = async () => new Response(null, { status });
      expect(
        (await streamDriveRange(failing, 'at', { fileId: FILE_ID, rangeHeader: null }, 'video/mp4')).status,
      ).toBe(404);
    }
  });
});

describe('drive session', () => {
  let workDir: string;

  const cipher: SecretCipher = {
    isEncryptionAvailable: () => true,
    encryptString: (p) => Buffer.from(p),
    decryptString: (e) => e.toString(),
  };
  const config = { clientId: 'client', clientSecret: null };

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'nw-sess-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function tokenResponse(accessToken: string, refreshToken?: string): Response {
    return new Response(
      JSON.stringify({ access_token: accessToken, expires_in: 3600, refresh_token: refreshToken }),
      { status: 200 },
    );
  }

  it('serves the cached token until near expiry, then refreshes', async () => {
    const store = new DriveTokenStore(workDir, cipher);
    await store.write('rt-1', null);
    let refreshCalls = 0;
    const fetchFn: FetchLike = async () => {
      refreshCalls += 1;
      return tokenResponse(`at-${String(refreshCalls)}`);
    };
    const session = new DriveSession(fetchFn, config, store);

    session.adopt('interactive-at', 3600);
    const now = Date.now();
    const cached = await session.getAccessToken(now);
    expect(cached.status).toBe('ok');
    if (cached.status === 'ok') {
      expect(cached.accessToken).toBe('interactive-at');
    }
    expect(refreshCalls).toBe(0);

    // Within the refresh margin: a refresh happens.
    const nearExpiry = now + 3600 * 1000 - 30 * 1000;
    const outcome = await session.getAccessToken(nearExpiry);
    expect(outcome.status).toBe('ok');
    expect(refreshCalls).toBe(1);
  });

  it('serializes concurrent refreshes into one provider call', async () => {
    const store = new DriveTokenStore(workDir, cipher);
    await store.write('rt-1', null);
    let refreshCalls = 0;
    const fetchFn: FetchLike = async () => {
      refreshCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return tokenResponse('at-shared');
    };
    const session = new DriveSession(fetchFn, config, store);

    const results = await Promise.all([
      session.getAccessToken(),
      session.getAccessToken(),
      session.getAccessToken(),
    ]);
    expect(refreshCalls).toBe(1);
    for (const result of results) {
      expect(result.status).toBe('ok');
    }
  });

  it('persists a rotated refresh token', async () => {
    const store = new DriveTokenStore(workDir, cipher);
    await store.write('rt-old', 'user@example.com');
    const fetchFn: FetchLike = async () => tokenResponse('at-1', 'rt-rotated');
    const session = new DriveSession(fetchFn, config, store);

    await session.getAccessToken();
    const read = await store.read();
    if (read.status === 'ok') {
      expect(read.refreshToken).toBe('rt-rotated');
      expect(read.accountEmail).toBe('user@example.com');
    } else {
      expect.unreachable('rotated token should be stored');
    }
  });

  it('clears the stored token and reports auth-expired on invalid_grant', async () => {
    const store = new DriveTokenStore(workDir, cipher);
    await store.write('rt-dead', null);
    const fetchFn: FetchLike = async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    const session = new DriveSession(fetchFn, config, store);

    expect((await session.getAccessToken()).status).toBe('auth-expired');
    expect((await store.read()).status).toBe('absent');
  });

  it('keeps the stored token on a transient failure', async () => {
    const store = new DriveTokenStore(workDir, cipher);
    await store.write('rt-fine', null);
    const fetchFn: FetchLike = async () => new Response('oops', { status: 503 });
    const session = new DriveSession(fetchFn, config, store);

    expect((await session.getAccessToken()).status).toBe('offline');
    expect((await store.read()).status).toBe('ok');
  });

  it('reports auth-required with no stored token and token-store-unavailable without encryption', async () => {
    const emptyStore = new DriveTokenStore(workDir, cipher);
    const fetchFn: FetchLike = async () => tokenResponse('at');
    expect((await new DriveSession(fetchFn, config, emptyStore).getAccessToken()).status).toBe('auth-required');

    const locked = new DriveTokenStore(workDir, { ...cipher, isEncryptionAvailable: () => false });
    expect((await new DriveSession(fetchFn, config, locked).getAccessToken()).status).toBe(
      'token-store-unavailable',
    );
  });
});
