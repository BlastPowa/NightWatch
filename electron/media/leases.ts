/**
 * Playback leases and byte-range parsing.
 *
 * A lease is short-lived permission to stream one source in this app session.
 * It lives in main-process memory only and dies with the process — a persisted
 * library record is not a lease, and a lease in a database would be a
 * capability someone else could use.
 */

import { randomBytes } from 'node:crypto';
import { buildPlaybackUrl, type PlaybackLease } from '@shared/mediaBridge';
import type { HtmlMediaSourceDescriptor } from '@shared/media';

/** Long enough to start a film, short enough that a leaked id is stale fast. */
export const LEASE_TTL_MS = 8 * 60 * 60 * 1000;

export interface LeaseRecord {
  leaseId: string;
  descriptor: HtmlMediaSourceDescriptor;
  /** Resolved absolute path for local sources. Never leaves the main process. */
  localPath: string | null;
  /** Drive file id for drive sources. */
  driveFileId: string | null;
  expiresAt: number;
  /** The window that owns this lease, so it dies when the window does. */
  windowId: number;
}

export class LeaseRegistry {
  private readonly leases = new Map<string, LeaseRecord>();

  /** 128 bits of entropy — not a counter, not a hash of the path. */
  private newLeaseId(): string {
    return randomBytes(16).toString('hex');
  }

  create(
    descriptor: HtmlMediaSourceDescriptor,
    windowId: number,
    source: { localPath?: string; driveFileId?: string },
    now: number = Date.now(),
  ): PlaybackLease {
    const leaseId = this.newLeaseId();
    const expiresAt = now + LEASE_TTL_MS;
    this.leases.set(leaseId, {
      leaseId,
      descriptor,
      localPath: source.localPath ?? null,
      driveFileId: source.driveFileId ?? null,
      expiresAt,
      windowId,
    });
    return { leaseId, playbackUrl: buildPlaybackUrl(leaseId), expiresAt };
  }

  /** Resolve a lease, treating expiry as absence. */
  resolve(leaseId: string, now: number = Date.now()): LeaseRecord | null {
    const record = this.leases.get(leaseId);
    if (record === undefined) {
      return null;
    }
    if (record.expiresAt <= now) {
      this.leases.delete(leaseId);
      return null;
    }
    return record;
  }

  release(leaseId: string): void {
    this.leases.delete(leaseId);
  }

  /** Drop every lease owned by a window that has gone away. */
  releaseForWindow(windowId: number): void {
    for (const [leaseId, record] of this.leases) {
      if (record.windowId === windowId) {
        this.leases.delete(leaseId);
      }
    }
  }

  releaseAll(): void {
    this.leases.clear();
  }

  get size(): number {
    return this.leases.size;
  }
}

export interface ByteRange {
  start: number;
  end: number;
}

export type RangeParseResult =
  | { kind: 'none' }
  | { kind: 'ok'; range: ByteRange }
  | { kind: 'unsatisfiable' };

/**
 * Parse a single RFC 7233 byte range.
 *
 * Exactly one range. Multiple ranges are refused rather than partially served:
 * a multipart/byteranges response is a different response shape, and quietly
 * answering only the first range gives the player bytes it did not ask for.
 */
export function parseByteRange(header: string | null | undefined, size: number): RangeParseResult {
  if (header === null || header === undefined || header.trim() === '') {
    return { kind: 'none' };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return { kind: 'unsatisfiable' };
  }

  const [, rawStart = '', rawEnd = ''] = match;

  if (rawStart === '' && rawEnd === '') {
    return { kind: 'unsatisfiable' };
  }

  // Suffix form: "bytes=-500" means the last 500 bytes.
  if (rawStart === '') {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: 'unsatisfiable' };
    }
    const start = Math.max(0, size - suffixLength);
    return { kind: 'ok', range: { start, end: size - 1 } };
  }

  const start = Number.parseInt(rawStart, 10);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return { kind: 'unsatisfiable' };
  }

  if (rawEnd === '') {
    return { kind: 'ok', range: { start, end: size - 1 } };
  }

  const requestedEnd = Number.parseInt(rawEnd, 10);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { kind: 'unsatisfiable' };
  }
  // A player may ask past the end; clamping is correct here, unlike a start
  // past the end, which is a real 416.
  return { kind: 'ok', range: { start, end: Math.min(requestedEnd, size - 1) } };
}
