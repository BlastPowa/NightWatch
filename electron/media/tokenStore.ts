/**
 * Phase 29 — OS-backed refresh-token storage.
 *
 * The refresh token is the only credential that persists, and it persists in
 * exactly one place: encrypted by Electron `safeStorage` (DPAPI on Windows,
 * Keychain on macOS, libsecret on Linux) in a file under `userData`.
 *
 * If secure encryption is unavailable, the answer is `token-store-unavailable`
 * — there is no plaintext fallback, deliberately. A plaintext refresh token on
 * disk outlives every other mitigation in this phase.
 *
 * Access tokens and the PKCE verifier/state never come near this file; they
 * live in main-process memory and die with it.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The slice of Electron safeStorage this store uses. Injected for tests. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const TOKEN_FILE_NAME = 'drive-credentials.bin';

export type TokenStoreReadOutcome =
  | { status: 'ok'; refreshToken: string; accountEmail: string | null }
  | { status: 'absent' }
  | { status: 'unavailable' };

export type TokenStoreWriteOutcome = 'ok' | 'unavailable' | 'failed';

interface StoredPayload {
  version: 1;
  refreshToken: string;
  /** Display only; shown in settings so the user knows which account. */
  accountEmail: string | null;
}

export class DriveTokenStore {
  constructor(
    private readonly userDataDir: string,
    private readonly cipher: SecretCipher,
  ) {}

  private get filePath(): string {
    return path.join(this.userDataDir, TOKEN_FILE_NAME);
  }

  async read(): Promise<TokenStoreReadOutcome> {
    if (!this.cipher.isEncryptionAvailable()) {
      return { status: 'unavailable' };
    }
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch {
      return { status: 'absent' };
    }
    try {
      const parsed: unknown = JSON.parse(this.cipher.decryptString(encrypted));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as StoredPayload).version !== 1 ||
        typeof (parsed as StoredPayload).refreshToken !== 'string' ||
        (parsed as StoredPayload).refreshToken.length === 0
      ) {
        // Unknown version or shape: treat as absent rather than guessing.
        return { status: 'absent' };
      }
      const payload = parsed as StoredPayload;
      return {
        status: 'ok',
        refreshToken: payload.refreshToken,
        accountEmail: typeof payload.accountEmail === 'string' ? payload.accountEmail : null,
      };
    } catch {
      // Undecryptable (OS keychain reset, copied from another machine): the
      // credential is unusable. Delete it so we stop trying.
      await this.clear();
      return { status: 'absent' };
    }
  }

  /**
   * Store (or rotate) the refresh token. Write-then-rename so a crash
   * mid-rotation leaves the previous valid token, not half a new one —
   * Google rotates refresh tokens, and losing both sides of a rotation
   * forces the user through consent again.
   */
  async write(refreshToken: string, accountEmail: string | null): Promise<TokenStoreWriteOutcome> {
    if (!this.cipher.isEncryptionAvailable()) {
      return 'unavailable';
    }
    try {
      const payload: StoredPayload = { version: 1, refreshToken, accountEmail };
      const encrypted = this.cipher.encryptString(JSON.stringify(payload));
      await mkdir(this.userDataDir, { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, encrypted, { mode: 0o600 });
      await rename(tempPath, this.filePath);
      try {
        await chmod(this.filePath, 0o600);
      } catch {
        // Windows ignores POSIX modes; userData is already per-user there.
      }
      return 'ok';
    } catch {
      return 'failed';
    }
  }

  /** Delete the stored credential. Always succeeds from the caller's view. */
  async clear(): Promise<void> {
    try {
      await rm(this.filePath, { force: true });
    } catch {
      // A file we cannot delete is a file that was not there.
    }
  }
}
