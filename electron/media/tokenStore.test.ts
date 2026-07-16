import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DriveTokenStore, type SecretCipher } from './tokenStore';

let workDir: string;

/** A reversible stand-in for safeStorage; XOR keeps plaintext off disk. */
function fakeCipher(available = true): SecretCipher {
  const key = 0x5a;
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(Buffer.from(plain).map((b) => b ^ key)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((b) => b ^ key)).toString(),
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'nw-tok-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('round trip', () => {
  it('stores and reads back the refresh token and account email', async () => {
    const store = new DriveTokenStore(workDir, fakeCipher());
    expect(await store.write('refresh-token-1', 'user@example.com')).toBe('ok');
    const read = await store.read();
    expect(read).toEqual({
      status: 'ok',
      refreshToken: 'refresh-token-1',
      accountEmail: 'user@example.com',
    });
  });

  it('reports absent before anything is stored', async () => {
    const store = new DriveTokenStore(workDir, fakeCipher());
    expect((await store.read()).status).toBe('absent');
  });

  it('rotates atomically: the new token fully replaces the old', async () => {
    const store = new DriveTokenStore(workDir, fakeCipher());
    await store.write('old-token', 'user@example.com');
    await store.write('rotated-token', 'user@example.com');
    const read = await store.read();
    if (read.status === 'ok') {
      expect(read.refreshToken).toBe('rotated-token');
    } else {
      expect.unreachable('token should be readable after rotation');
    }
  });
});

describe('no plaintext, ever', () => {
  it('never writes the token in plaintext', async () => {
    const store = new DriveTokenStore(workDir, fakeCipher());
    await store.write('super-secret-refresh-token', 'user@example.com');
    const raw = await readFile(path.join(workDir, 'drive-credentials.bin'));
    expect(raw.toString()).not.toContain('super-secret-refresh-token');
    expect(raw.toString()).not.toContain('user@example.com');
  });

  it('refuses to write when secure encryption is unavailable', async () => {
    // The core rule: unavailable means unavailable, not "fall back to plaintext".
    const store = new DriveTokenStore(workDir, fakeCipher(false));
    expect(await store.write('token', null)).toBe('unavailable');
    await expect(readFile(path.join(workDir, 'drive-credentials.bin'))).rejects.toThrow();
  });

  it('refuses to read when secure encryption is unavailable', async () => {
    const writable = new DriveTokenStore(workDir, fakeCipher());
    await writable.write('token', null);
    const locked = new DriveTokenStore(workDir, fakeCipher(false));
    expect((await locked.read()).status).toBe('unavailable');
  });
});

describe('bad states', () => {
  it('clears an undecryptable file rather than retrying it forever', async () => {
    const store = new DriveTokenStore(workDir, fakeCipher());
    await store.write('token', null);
    // Simulate an OS keychain reset: same file, different key.
    const otherKey: SecretCipher = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('x'),
      decryptString: () => {
        throw new Error('decryption failed');
      },
    };
    const broken = new DriveTokenStore(workDir, otherKey);
    expect((await broken.read()).status).toBe('absent');
    // The corpse is gone.
    await expect(readFile(path.join(workDir, 'drive-credentials.bin'))).rejects.toThrow();
  });

  it('treats an unknown stored version as absent without rewriting it', async () => {
    const cipher = fakeCipher();
    const store = new DriveTokenStore(workDir, cipher);
    const futurePayload = cipher.encryptString(JSON.stringify({ version: 9, refreshToken: 'x' }));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(workDir, 'drive-credentials.bin'), futurePayload);
    expect((await store.read()).status).toBe('absent');
  });

  it('clear is idempotent and safe on a missing file', async () => {
    const store = new DriveTokenStore(workDir, fakeCipher());
    await expect(store.clear()).resolves.toBeUndefined();
    await store.write('token', null);
    await store.clear();
    await store.clear();
    expect((await store.read()).status).toBe('absent');
  });
});
