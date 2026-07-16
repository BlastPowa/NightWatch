import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaFail, mediaOk } from '@shared/media';

// DriveManager pulls in drivePicker, which imports Electron at module load.
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  session: { fromPartition: vi.fn() },
}));

const { DriveManager } = await import('./driveManager');
const { DriveTokenStore } = await import('./tokenStore');
const { generateState } = await import('./driveAuth');
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const FILE_ID = '1AbCdEfGhIjKlMnOpQrSt';
const SHA = 'a'.repeat(64);

let workDir: string;

const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (p: string) => Buffer.from(p),
  decryptString: (e: Buffer) => e.toString(),
};

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'nw-mgr-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

interface Managed {
  manager: InstanceType<typeof DriveManager>;
  store: InstanceType<typeof DriveTokenStore>;
  fetchCalls: string[];
}

/**
 * A fake Google: answers the token, about, metadata, and revoke endpoints.
 * `completeAuth` simulates the user finishing sign-in in the browser by
 * hitting the loopback redirect the manager opened.
 */
function makeManager(
  options: {
    pickOutcome?: 'picked' | 'cancelled';
    secureStorage?: boolean;
  } = {},
): Managed {
  const store = new DriveTokenStore(
    workDir,
    options.secureStorage === false
      ? { ...cipher, isEncryptionAvailable: () => false }
      : cipher,
  );
  const fetchCalls: string[] = [];

  const fetchFn: FetchLike = async (url) => {
    fetchCalls.push(url);
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({ access_token: 'at-x', expires_in: 3600, refresh_token: 'rt-x' }),
        { status: 200 },
      );
    }
    if (url.includes('/drive/v3/about')) {
      return new Response(JSON.stringify({ user: { emailAddress: 'user@example.com' } }), {
        status: 200,
      });
    }
    if (url.includes('/drive/v3/files/')) {
      return new Response(
        JSON.stringify({
          id: FILE_ID,
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          size: '2048',
          sha256Checksum: SHA,
          capabilities: { canDownload: true },
          trashed: false,
        }),
        { status: 200 },
      );
    }
    if (url.includes('revoke')) {
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  };

  const manager = new DriveManager({
    fetchFn,
    config: { clientId: 'client-id', clientSecret: null },
    pickerApiKey: 'picker-key',
    appId: 'app-id',
    tokenStore: store,
    maxSizeBytes: () => 32 * 1024 * 1024 * 1024,
    // The "browser": completes the flow by calling back the loopback URL.
    openExternal: async (authUrl) => {
      const url = new URL(authUrl);
      const redirect = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      // Detached on purpose: the real browser is not awaited either.
      void fetch(`${redirect}?code=auth-code&state=${state}`).catch(() => {});
    },
    showPicker: async () =>
      options.pickOutcome === 'cancelled'
        ? mediaFail('cancelled', 'No Drive file was selected.')
        : mediaOk(FILE_ID),
  });

  return { manager, store, fetchCalls };
}

describe('connect', () => {
  it('completes the PKCE flow and stores the rotated refresh token encrypted', async () => {
    const { manager, store } = makeManager();
    const result = await manager.connect();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.connected).toBe(true);
      expect(result.value.accountEmail).toBe('user@example.com');
    }
    const stored = await store.read();
    expect(stored.status).toBe('ok');
    if (stored.status === 'ok') {
      expect(stored.refreshToken).toBe('rt-x');
    }
  });

  it('rejects a second concurrent attempt without disturbing the first', async () => {
    const { manager } = makeManager();
    // Start one attempt whose browser never comes back...
    const stalled = new DriveManager({
      fetchFn: async () => new Response(null, { status: 500 }),
      config: { clientId: 'client-id', clientSecret: null },
      pickerApiKey: 'k',
      appId: 'a',
      tokenStore: new DriveTokenStore(workDir, cipher),
      maxSizeBytes: () => 1024,
      openExternal: async () => {}, // user never finishes
    });
    const first = stalled.connect();
    const second = await stalled.connect();
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('invalid-request');
    }
    stalled.abortAuth();
    await first; // resolves via abort; must not hang
    void manager;
  });

  it('keeps the prior valid connection when a new attempt is cancelled', async () => {
    const { manager, store } = makeManager();
    await manager.connect();

    // Second attempt: the "browser" denies.
    const denying = new DriveManager({
      fetchFn: async () => new Response(null, { status: 500 }),
      config: { clientId: 'client-id', clientSecret: null },
      pickerApiKey: 'k',
      appId: 'a',
      tokenStore: store,
      maxSizeBytes: () => 1024,
      openExternal: async (authUrl) => {
        const url = new URL(authUrl);
        const redirect = url.searchParams.get('redirect_uri');
        const state = url.searchParams.get('state');
        void fetch(`${redirect}?error=access_denied&state=${state}`).catch(() => {});
      },
    });
    const result = await denying.connect();
    expect(result.ok).toBe(false);

    // The original stored token is untouched.
    const stored = await store.read();
    expect(stored.status).toBe('ok');
    if (stored.status === 'ok') {
      expect(stored.refreshToken).toBe('rt-x');
    }
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

describe('connection state', () => {
  it('reports disconnected before connect and connected after', async () => {
    const { manager } = makeManager();
    expect((await manager.getConnectionState()).connected).toBe(false);
    await manager.connect();
    const state = await manager.getConnectionState();
    expect(state.connected).toBe(true);
    expect(state.accountEmail).toBe('user@example.com');
  });
});

describe('pick', () => {
  it('re-fetches metadata in main and returns a validated descriptor', async () => {
    const { manager, fetchCalls } = makeManager();
    await manager.connect();
    const picked = await manager.pickFile({ pickerPageUrl: 'app://x/picker.html', parent: null });
    expect(picked.ok).toBe(true);
    if (picked.ok) {
      expect(picked.value.descriptor).toEqual({
        schemaVersion: 1,
        kind: 'drive',
        fileId: FILE_ID,
        fingerprint: `sha256:${SHA}`,
        title: 'clip.mp4',
        mimeType: 'video/mp4',
        size: 2048,
      });
    }
    // The metadata call happened in main, regardless of Picker claims.
    expect(fetchCalls.some((url) => url.includes('/drive/v3/files/'))).toBe(true);
  });

  it('propagates picker cancellation as an ordinary result', async () => {
    const { manager } = makeManager({ pickOutcome: 'cancelled' });
    await manager.connect();
    const picked = await manager.pickFile({ pickerPageUrl: 'app://x/picker.html', parent: null });
    expect(picked.ok).toBe(false);
    if (!picked.ok) {
      expect(picked.error.code).toBe('cancelled');
    }
  });

  it('requires a connection first', async () => {
    const { manager } = makeManager();
    const picked = await manager.pickFile({ pickerPageUrl: 'app://x/picker.html', parent: null });
    expect(picked.ok).toBe(false);
    if (!picked.ok) {
      expect(picked.error.code).toBe('auth-required');
    }
  });
});

describe('lease validation', () => {
  it('accepts a matching descriptor and rejects a fingerprint mismatch', async () => {
    const { manager } = makeManager();
    await manager.connect();

    const matching = await manager.validateForLease({
      schemaVersion: 1,
      kind: 'drive',
      fileId: FILE_ID,
      fingerprint: `sha256:${SHA}`,
      title: 'anything',
      mimeType: 'video/mp4',
      size: 2048,
    });
    expect(matching.ok).toBe(true);

    const mismatched = await manager.validateForLease({
      schemaVersion: 1,
      kind: 'drive',
      fileId: FILE_ID,
      fingerprint: `sha256:${'b'.repeat(64)}`,
      title: 'anything',
      mimeType: 'video/mp4',
      size: 2048,
    });
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.error.code).toBe('source-mismatch');
    }
  });
});

describe('disconnect', () => {
  it('revokes best-effort and always clears the local credential', async () => {
    const { manager, store, fetchCalls } = makeManager();
    await manager.connect();
    const result = await manager.disconnect();
    expect(result.ok).toBe(true);
    expect(fetchCalls.some((url) => url.includes('revoke'))).toBe(true);
    expect((await store.read()).status).toBe('absent');
  });

  it('clears locally even when revocation is unreachable', async () => {
    const store = new DriveTokenStore(workDir, cipher);
    await store.write('rt-1', null);
    const manager = new DriveManager({
      fetchFn: async () => {
        throw new Error('offline');
      },
      config: { clientId: 'c', clientSecret: null },
      pickerApiKey: 'k',
      appId: 'a',
      tokenStore: store,
      maxSizeBytes: () => 1024,
    });
    expect((await manager.disconnect()).ok).toBe(true);
    expect((await store.read()).status).toBe('absent');
  });
});

describe('state randomness across attempts', () => {
  it('uses a fresh state and verifier every time', async () => {
    const states = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const store = new DriveTokenStore(workDir, cipher);
      const manager = new DriveManager({
        fetchFn: async () =>
          new Response(
            JSON.stringify({ access_token: 'at', expires_in: 3600, refresh_token: 'rt' }),
            { status: 200 },
          ),
        config: { clientId: 'c', clientSecret: null },
        pickerApiKey: 'k',
        appId: 'a',
        tokenStore: store,
        maxSizeBytes: () => 1024,
        openExternal: async (authUrl) => {
          const url = new URL(authUrl);
          states.add(url.searchParams.get('state') ?? '');
          const redirect = url.searchParams.get('redirect_uri');
          void fetch(`${redirect}?code=c&state=${url.searchParams.get('state')}`).catch(() => {});
        },
      });
      await manager.connect();
    }
    expect(states.size).toBe(3);
    expect(states.has(generateState())).toBe(false);
  });
});
