/**
 * Device-local mapping from an opaque handle to a real file on this machine.
 *
 * This file is the reason a path never has to leave the main process. The
 * renderer holds a handle; the room holds a fingerprint; only this store knows
 * that handle `9f2c…` means `D:\Videos\holiday.mp4`, and it never travels: not
 * to localStorage, not to Supabase, not to a room event, not to a log line.
 *
 * It lives under Electron `userData` with owner-only permissions where the OS
 * offers them.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isMediaFingerprint,
  toMediaFingerprint,
  type MediaFingerprint,
  type SupportedHtmlMediaMime,
} from '@shared/media';
import { isLocalHandle } from '@shared/mediaBridge';

export interface LocalMediaMapping {
  localHandle: string;
  fingerprint: MediaFingerprint;
  title: string;
  mimeType: SupportedHtmlMediaMime;
  size: number;
  modifiedAtMs: number;
  /** Main-process storage only. Never serialized outside this file. */
  path: string;
}

interface MappingFile {
  version: 1;
  mappings: LocalMediaMapping[];
}

const MAPPING_FILE_NAME = 'media-mappings.json';
/** Bound the store so a long-lived install cannot grow it without limit. */
const MAX_MAPPINGS = 500;

export class MappingStore {
  private mappings = new Map<string, LocalMediaMapping>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly userDataDir: string) {}

  private get filePath(): string {
    return path.join(this.userDataDir, MAPPING_FILE_NAME);
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as MappingFile).version !== 1 ||
        !Array.isArray((parsed as MappingFile).mappings)
      ) {
        // An unknown version is not rewritten or guessed at — it is ignored,
        // and re-selection rebuilds it. Downgrade must not corrupt an upgrade.
        return;
      }
      for (const entry of (parsed as MappingFile).mappings) {
        const mapping = validateStoredMapping(entry);
        if (mapping !== null) {
          this.mappings.set(mapping.localHandle, mapping);
        }
      }
    } catch {
      // Missing or unreadable: start empty. The user re-picks their file.
    }
  }

  get(localHandle: string): LocalMediaMapping | null {
    return this.mappings.get(localHandle) ?? null;
  }

  /**
   * Find this device's copy of a source by fingerprint.
   *
   * Fingerprint only. Matching on name or size would let a room play two
   * different videos in lockstep and call it synchronized.
   */
  findByFingerprint(fingerprint: MediaFingerprint): LocalMediaMapping | null {
    for (const mapping of this.mappings.values()) {
      if (mapping.fingerprint === fingerprint) {
        return mapping;
      }
    }
    return null;
  }

  /** Reuse an existing handle for the same path so the store does not grow. */
  findByPath(filePath: string): LocalMediaMapping | null {
    const canonical = path.resolve(filePath);
    for (const mapping of this.mappings.values()) {
      if (mapping.path === canonical) {
        return mapping;
      }
    }
    return null;
  }

  async put(mapping: LocalMediaMapping): Promise<void> {
    this.mappings.set(mapping.localHandle, mapping);
    if (this.mappings.size > MAX_MAPPINGS) {
      const oldest = this.mappings.keys().next();
      if (!oldest.done) {
        this.mappings.delete(oldest.value);
      }
    }
    await this.persist();
  }

  async remove(localHandle: string): Promise<void> {
    if (this.mappings.delete(localHandle)) {
      await this.persist();
    }
  }

  /**
   * Serialize writes.
   *
   * Two concurrent picks writing the same file is a corrupt file, and a corrupt
   * mapping store loses every saved selection at once.
   */
  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.writeNow()).catch(() => {});
    return this.writeChain;
  }

  private async writeNow(): Promise<void> {
    const payload: MappingFile = {
      version: 1,
      mappings: [...this.mappings.values()],
    };
    await mkdir(this.userDataDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    // Write-then-rename: a crash mid-write leaves the previous good file, not
    // a half-written one.
    await writeFile(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, this.filePath);
    try {
      await chmod(this.filePath, 0o600);
    } catch {
      // Windows ignores POSIX modes; the userData directory is already
      // per-user there. Not fatal.
    }
  }
}

function validateStoredMapping(value: unknown): LocalMediaMapping | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  if (
    !isLocalHandle(entry['localHandle']) ||
    !isMediaFingerprint(entry['fingerprint']) ||
    typeof entry['title'] !== 'string' ||
    (entry['mimeType'] !== 'video/mp4' && entry['mimeType'] !== 'video/webm') ||
    typeof entry['size'] !== 'number' ||
    !Number.isSafeInteger(entry['size']) ||
    entry['size'] <= 0 ||
    typeof entry['modifiedAtMs'] !== 'number' ||
    !Number.isFinite(entry['modifiedAtMs']) ||
    typeof entry['path'] !== 'string' ||
    entry['path'].length === 0
  ) {
    return null;
  }
  return {
    localHandle: entry['localHandle'],
    fingerprint: entry['fingerprint'],
    title: entry['title'],
    mimeType: entry['mimeType'],
    size: entry['size'],
    modifiedAtMs: entry['modifiedAtMs'],
    path: entry['path'],
  };
}

export interface FileIdentity {
  size: number;
  modifiedAtMs: number;
}

/** Read the identity we revalidate a cached fingerprint against. */
export async function readFileIdentity(filePath: string): Promise<FileIdentity | null> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return { size: stats.size, modifiedAtMs: stats.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Whether a cached fingerprint may be trusted without re-hashing.
 *
 * Canonical path, size, and mtime must all still match. Anything else and we
 * re-hash: a file whose bytes changed under a stale fingerprint is exactly the
 * case that desynchronizes a room with no visible cause.
 */
export function isMappingStillValid(
  mapping: LocalMediaMapping,
  identity: FileIdentity,
): boolean {
  return mapping.size === identity.size && mapping.modifiedAtMs === identity.modifiedAtMs;
}

export interface FingerprintOptions {
  onProgress?: (bytesHashed: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

export type FingerprintOutcome =
  | { status: 'ok'; fingerprint: MediaFingerprint }
  | { status: 'cancelled' }
  | { status: 'failed' };

/**
 * Stream a file through SHA-256.
 *
 * A read stream, never readFile: these are movies. Loading one into memory to
 * hash it would spike RSS by gigabytes and, on a large enough file, throw
 * outright.
 */
export async function fingerprintFile(
  filePath: string,
  totalBytes: number,
  options: FingerprintOptions = {},
): Promise<FingerprintOutcome> {
  const { onProgress, signal } = options;
  if (signal?.aborted) {
    return { status: 'cancelled' };
  }

  return new Promise<FingerprintOutcome>((resolve) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    let hashed = 0;
    let settled = false;

    const finish = (outcome: FingerprintOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      stream.destroy();
      resolve(outcome);
    };

    const onAbort = (): void => {
      finish({ status: 'cancelled' });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk);
      hashed += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      onProgress?.(Math.min(hashed, totalBytes), totalBytes);
    });

    stream.on('error', () => {
      finish({ status: 'failed' });
    });

    stream.on('end', () => {
      if (settled) {
        return;
      }
      const fingerprint = toMediaFingerprint(hash.digest('hex'));
      finish(fingerprint === null ? { status: 'failed' } : { status: 'ok', fingerprint });
    });
  });
}
