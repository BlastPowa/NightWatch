/**
 * Phase 29 — the media surface a host platform may offer.
 *
 * This is the boundary between "what the renderer may know" and "what only the
 * main process may know". Everything crossing it is a plain, serializable
 * object. Paths, OAuth tokens, and Picker tokens stay on the main side; the
 * renderer receives an opaque handle and an opaque playback URL, and can do
 * nothing with either except hand them back.
 */

import type {
  HtmlMediaSourceDescriptor,
  MediaCapabilities,
  MediaResult,
  MediaSourceDescriptor,
} from './media';

/**
 * A file the user explicitly chose, as seen by the renderer.
 *
 * `localHandle` is a random device-local identifier, not a path and not
 * derived from one. It is never broadcast, never persisted to the cloud, and
 * meaningless on any other machine — so leaking it into a room event would be
 * useless to a recipient rather than dangerous. It is still treated as private.
 */
export interface SelectedMedia {
  descriptor: HtmlMediaSourceDescriptor;
  localHandle: string;
}

/**
 * Permission to stream one source, for a short while, in this app session.
 *
 * `playbackUrl` is renderer-local. It must never enter persisted or
 * synchronized application state: a lease is a capability, and a capability in
 * a database is a capability someone else can use.
 */
export interface PlaybackLease {
  leaseId: string;
  /** Always `nightwatch-media://stream/{leaseId}`. */
  playbackUrl: string;
  /** Unix epoch ms. */
  expiresAt: number;
}

/** Whether this device has a usable Drive connection. Carries no token. */
export interface DriveConnectionState {
  connected: boolean;
  /** The signed-in account's email, for display only. Null when disconnected. */
  accountEmail: string | null;
  /** Set when the connection exists but cannot currently be used. */
  reason: 'not-configured' | 'token-store-unavailable' | 'auth-expired' | null;
}

export function disconnectedDriveState(
  reason: DriveConnectionState['reason'] = null,
): DriveConnectionState {
  return { connected: false, accountEmail: null, reason };
}

/** Progress while hashing a selected file. Bounded, and cancellable. */
export interface FingerprintProgress {
  /** Opaque id tying this progress to one pickLocalFile call. */
  operationId: string;
  bytesHashed: number;
  totalBytes: number;
}

/**
 * The optional media surface on a platform bridge.
 *
 * Null on any platform without one (the Discord Activity, the web build), so
 * the renderer keys off null and renders nothing rather than dead controls.
 */
export interface MediaPlatformBridge {
  getCapabilities(): Promise<MediaCapabilities>;
  pickLocalFile(): Promise<MediaResult<SelectedMedia>>;
  /**
   * Find this device's own authorized copy of a source another participant
   * loaded. Matching is by fingerprint — never by name or size.
   */
  resolveLocalMatch(
    descriptor: Extract<MediaSourceDescriptor, { kind: 'local' }>,
  ): Promise<MediaResult<SelectedMedia>>;
  getDriveConnection(): Promise<DriveConnectionState>;
  connectDrive(): Promise<MediaResult<DriveConnectionState>>;
  pickDriveFile(): Promise<MediaResult<SelectedMedia>>;
  disconnectDrive(): Promise<MediaResult<void>>;
  createPlaybackLease(descriptor: HtmlMediaSourceDescriptor): Promise<MediaResult<PlaybackLease>>;
  releasePlaybackLease(leaseId: string): Promise<void>;
  /** Subscribe to fingerprint progress. Returns an unsubscribe function. */
  onFingerprintProgress(callback: (progress: FingerprintProgress) => void): () => void;
  /** Cancel an in-flight fingerprint. Resolves the pick as `cancelled`. */
  cancelFingerprint(operationId: string): Promise<void>;
}

/** The private scheme the renderer plays HTML media from. */
export const MEDIA_STREAM_SCHEME = 'nightwatch-media';
export const MEDIA_STREAM_URL_PREFIX = `${MEDIA_STREAM_SCHEME}://stream/`;

/** Lease ids are 128 bits of randomness, hex-encoded. */
const LEASE_ID_PATTERN = /^[0-9a-f]{32}$/;

export function isLeaseId(value: unknown): value is string {
  return typeof value === 'string' && LEASE_ID_PATTERN.test(value);
}

export function buildPlaybackUrl(leaseId: string): string {
  return `${MEDIA_STREAM_URL_PREFIX}${leaseId}`;
}

/**
 * Extract the lease id from a playback URL, or null.
 *
 * Deliberately strict: exact prefix, exact id shape, and nothing after it. A
 * query string or a path segment on a privileged scheme is how a request
 * handler gets talked into serving something it did not mean to.
 */
export function parsePlaybackUrl(url: string): string | null {
  if (!url.startsWith(MEDIA_STREAM_URL_PREFIX)) {
    return null;
  }
  const rest = url.slice(MEDIA_STREAM_URL_PREFIX.length);
  return isLeaseId(rest) ? rest : null;
}

/** Local handles are 128 bits of randomness, hex-encoded. */
const LOCAL_HANDLE_PATTERN = /^[0-9a-f]{32}$/;

export function isLocalHandle(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_HANDLE_PATTERN.test(value);
}
