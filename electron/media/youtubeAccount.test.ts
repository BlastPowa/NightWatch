import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}));

const { YouTubeAccountManager } = await import('./youtubeAccount');
const { DriveTokenStore } = await import('./tokenStore');
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

let workDir: string;

const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (p: string) => Buffer.from(Buffer.from(p).map((b) => b ^ 0x2f)),
  decryptString: (e: Buffer) => Buffer.from(e.map((b) => b ^ 0x2f)).toString(),
};

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'nw-yt-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeManager(
  options: {
    channelTitle?: string;
    denyAuth?: boolean;
    secureStorage?: boolean;
  } = {},
) {
  const store = new DriveTokenStore(
    workDir,
    options.secureStorage === false
      ? { ...cipher, isEncryptionAvailable: () => false }
      : cipher,
    'youtube-credentials.bin',
  );
  const authUrls: string[] = [];
  const fetchCalls: string[] = [];

  const fetchFn: FetchLike = async (url) => {
    fetchCalls.push(url);
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({ access_token: 'yt-at', expires_in: 3600, refresh_token: 'yt-rt' }),
        { status: 200 },
      );
    }
    if (url.includes('/youtube/v3/channels')) {
      return new Response(
        JSON.stringify({ items: [{ snippet: { title: options.channelTitle ?? 'My Channel' } }] }),
        { status: 200 },
      );
    }
    if (url.includes('revoke')) {
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  };

  const manager = new YouTubeAccountManager({
    fetchFn,
    config: { clientId: 'client-id', clientSecret: null },
    tokenStore: store,
    openExternal: async (authUrl) => {
      authUrls.push(authUrl);
      const url = new URL(authUrl);
      const redirect = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      const suffix = options.denyAuth ? `error=access_denied&state=${state}` : `code=c&state=${state}`;
      void fetch(`${redirect}?${suffix}`).catch(() => {});
    },
  });

  return { manager, store, authUrls, fetchCalls };
}

describe('connect', () => {
  it('requests only youtube.readonly, never the Drive scope', async () => {
    const { manager, authUrls } = makeManager();
    await manager.connect();
    const scope = new URL(authUrls[0]!).searchParams.get('scope');
    expect(scope).toBe('https://www.googleapis.com/auth/youtube.readonly');
    expect(scope).not.toContain('drive');
  });

  it('connects, stores the encrypted refresh token, and reports the channel', async () => {
    const { manager, store } = makeManager({ channelTitle: 'Shonen Warrior' });
    const result = await manager.connect();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ connected: true, channelTitle: 'Shonen Warrior', reason: null });
    }
    const stored = await store.read();
    expect(stored.status).toBe('ok');
    if (stored.status === 'ok') {
      expect(stored.refreshToken).toBe('yt-rt');
    }
    // The credential file never contains the token in plaintext.
    const raw = await readFile(path.join(workDir, 'youtube-credentials.bin'));
    expect(raw.toString()).not.toContain('yt-rt');
  });

  it('normalizes a hostile channel title before it can reach the UI', async () => {
    const { manager } = makeManager({ channelTitle: 'evil‮ltitle' });
    const result = await manager.connect();
    if (result.ok) {
      expect(result.value.channelTitle).toBe('evilltitle');
    }
    expect(result.ok).toBe(true);
  });

  it('a denied sign-in leaves no credential behind', async () => {
    const { manager, store } = makeManager({ denyAuth: true });
    const result = await manager.connect();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth-cancelled');
    }
    expect((await store.read()).status).toBe('absent');
  });

  it('rejects a concurrent attempt and resolves on abort', async () => {
    const store = new DriveTokenStore(workDir, cipher, 'youtube-credentials.bin');
    const stalled = new YouTubeAccountManager({
      fetchFn: async () => new Response(null, { status: 500 }),
      config: { clientId: 'client-id', clientSecret: null },
      tokenStore: store,
      openExternal: async () => {}, // user never finishes
    });
    const first = stalled.connect();
    const second = await stalled.connect();
    expect(second.ok).toBe(false);
    stalled.abortAuth();
    const settled = await first;
    expect(settled.ok).toBe(false);
  });

  it('revokes a newly granted token when secure storage cannot persist it', async () => {
    const { manager, store, fetchCalls } = makeManager({ secureStorage: false });
    const result = await manager.connect();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('token-store-unavailable');
    }
    expect(fetchCalls.some((url) => url.includes('revoke'))).toBe(true);
    expect((await store.read()).status).toBe('unavailable');
  });
});

describe('state and disconnect', () => {
  it('reports disconnected, then connected, then disconnected again', async () => {
    const { manager, fetchCalls } = makeManager();
    expect((await manager.getState()).connected).toBe(false);

    await manager.connect();
    const connected = await manager.getState();
    expect(connected.connected).toBe(true);
    expect(connected.channelTitle).toBe('My Channel');

    const result = await manager.disconnect();
    expect(result.ok).toBe(true);
    expect(fetchCalls.some((url) => url.includes('revoke'))).toBe(true);
    expect((await manager.getState()).connected).toBe(false);
  });

  it('keeps the YouTube credential file separate from Drive', async () => {
    const { manager } = makeManager();
    await manager.connect();
    // Drive's default file name is untouched by a YouTube connect.
    await expect(readFile(path.join(workDir, 'drive-credentials.bin'))).rejects.toThrow();
  });

  it('reports token-store-unavailable without OS encryption', async () => {
    const locked = new DriveTokenStore(
      workDir,
      { ...cipher, isEncryptionAvailable: () => false },
      'youtube-credentials.bin',
    );
    const manager = new YouTubeAccountManager({
      fetchFn: async () => new Response(null, { status: 500 }),
      config: { clientId: 'c', clientSecret: null },
      tokenStore: locked,
    });
    expect((await manager.getState()).reason).toBe('token-store-unavailable');
  });
});
