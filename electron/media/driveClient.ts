/**
 * Phase 29 — Google Drive metadata validation and byte-range streaming.
 *
 * Two rules shape everything here:
 *
 *  - Every participant calls Drive with their OWN token. A file id in a room
 *    descriptor is a lookup hint, never proof of permission.
 *  - Bytes flow from Drive to the local <video> element and nowhere else.
 *    The response body is streamed through, never buffered in full, and never
 *    relayed to another participant.
 *
 * Picker metadata is advisory only: the main process re-fetches metadata for
 * any selected file id and validates it here before anything is trusted.
 */

import {
  isSupportedHtmlMediaMime,
  isValidMediaSize,
  mediaFail,
  mediaOk,
  normalizeMediaTitle,
  toMediaFingerprint,
  type MediaFingerprint,
  type MediaResult,
  type SupportedHtmlMediaMime,
} from '@shared/media';
import {
  refreshAccessToken,
  type FetchLike,
  type OAuthClientConfig,
} from './driveAuth';
import type { DriveTokenStore } from './tokenStore';

const DRIVE_API_ORIGIN = 'https://www.googleapis.com';
/** Exactly the fields the handoff allows us to request. */
const METADATA_FIELDS = 'id,name,mimeType,size,sha256Checksum,capabilities(canDownload),trashed';

export interface ValidatedDriveFile {
  fileId: string;
  title: string;
  mimeType: SupportedHtmlMediaMime;
  size: number;
  fingerprint: MediaFingerprint;
}

/** Map a Drive HTTP status to a typed outcome. No provider text escapes. */
function driveHttpFailure(status: number): MediaResult<never> {
  switch (status) {
    case 401:
      return mediaFail('auth-expired', 'Your Google Drive sign-in has expired.');
    case 403:
      return mediaFail('permission-denied', 'You do not have access to this Drive file.');
    case 404:
      return mediaFail('drive-file-unavailable', 'This Drive file is unavailable.');
    case 429:
      return mediaFail('rate-limited', 'Google Drive is rate-limiting requests. Try again shortly.');
    default:
      return status >= 500
        ? mediaFail('drive-file-unavailable', 'Google Drive is having trouble right now.')
        : mediaFail('internal', 'The Drive request failed.');
  }
}

export async function fetchDriveMetadata(
  fetchFn: FetchLike,
  accessToken: string,
  fileId: string,
  maxSizeBytes: number,
): Promise<MediaResult<ValidatedDriveFile>> {
  const url = `${DRIVE_API_ORIGIN}/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(METADATA_FIELDS)}`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return mediaFail('offline', 'Google Drive could not be reached.');
  }

  if (!response.ok) {
    return driveHttpFailure(response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return mediaFail('internal', 'The Drive response could not be read.');
  }

  return validateDriveMetadata(payload, fileId, maxSizeBytes);
}

/**
 * Validate a files.get response. Exported separately so the tests can throw
 * forged payloads at it without a fetch stub in the way.
 */
export function validateDriveMetadata(
  payload: unknown,
  expectedFileId: string,
  maxSizeBytes: number,
): MediaResult<ValidatedDriveFile> {
  if (typeof payload !== 'object' || payload === null) {
    return mediaFail('internal', 'The Drive response could not be read.');
  }
  const record = payload as Record<string, unknown>;

  if (record['id'] !== expectedFileId) {
    // Metadata for a different file than we asked about is a forged payload.
    return mediaFail('invalid-selection', 'The Drive response did not match the selected file.');
  }

  if (record['trashed'] === true) {
    return mediaFail('drive-file-unavailable', 'This Drive file is in the trash.');
  }

  const capabilities = record['capabilities'];
  const canDownload =
    typeof capabilities === 'object' &&
    capabilities !== null &&
    (capabilities as Record<string, unknown>)['canDownload'] === true;
  if (!canDownload) {
    // The owner disabled download/print/copy. That is their call; respect it.
    return mediaFail('download-restricted', 'The owner of this file has restricted downloading.');
  }

  const mimeType = record['mimeType'];
  if (typeof mimeType !== 'string') {
    return mediaFail('internal', 'The Drive response could not be read.');
  }
  // Workspace editor documents, shortcuts, and folders are not binary media.
  if (mimeType.startsWith('application/vnd.google-apps')) {
    return mediaFail('unsupported-format', 'Google Docs, folders, and shortcuts cannot be played.');
  }
  if (!isSupportedHtmlMediaMime(mimeType)) {
    return mediaFail('unsupported-format', 'Only MP4 and WebM video files are supported.');
  }

  // Drive reports size as a string.
  const rawSize = record['size'];
  const size =
    typeof rawSize === 'string' && /^[0-9]+$/.test(rawSize) ? Number.parseInt(rawSize, 10) : null;
  if (size === null || !isValidMediaSize(size, maxSizeBytes)) {
    return mediaFail('invalid-selection', 'This Drive file has an invalid or unsupported size.');
  }

  const title = normalizeMediaTitle(record['name']);
  if (title === null) {
    return mediaFail('invalid-selection', 'This Drive file name cannot be used as a title.');
  }

  // No checksum, no fingerprint, no playback — the first release does not
  // substitute filename, size, MD5, or the file id. Without the SHA-256 there
  // is no way to know two participants are watching the same bytes.
  const checksum = record['sha256Checksum'];
  const fingerprint = typeof checksum === 'string' ? toMediaFingerprint(checksum) : null;
  if (fingerprint === null) {
    return mediaFail(
      'fingerprint-unavailable',
      'Google Drive has not finished processing this file. Try again later.',
    );
  }

  return mediaOk({ fileId: expectedFileId, title, mimeType, size, fingerprint });
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** Response headers that may pass through to the media element. Nothing else. */
const SAFE_STREAM_HEADERS = ['content-length', 'content-range'] as const;

export interface DriveStreamRequest {
  fileId: string;
  /** The single validated Range header value, or null for a full read. */
  rangeHeader: string | null;
}

/**
 * Stream one ranged read of one Drive file.
 *
 * The requested Range is forwarded verbatim and the response body is passed
 * through as a stream. The Authorization header exists only on the outgoing
 * Drive request; the response handed to the media element carries the safe
 * headers and the validated MIME type, nothing from Drive's header bag.
 */
export async function streamDriveRange(
  fetchFn: FetchLike,
  accessToken: string,
  request: DriveStreamRequest,
  mimeType: SupportedHtmlMediaMime,
): Promise<Response> {
  const url = `${DRIVE_API_ORIGIN}/drive/v3/files/${encodeURIComponent(request.fileId)}?alt=media`;
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (request.rangeHeader !== null) {
    headers['Range'] = request.rangeHeader;
  }

  let upstream: Response;
  try {
    upstream = await fetchFn(url, { method: 'GET', headers });
  } catch {
    return new Response(null, { status: 503 });
  }

  if (upstream.status === 200 || upstream.status === 206) {
    const outHeaders: Record<string, string> = {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    for (const name of SAFE_STREAM_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) {
        outHeaders[name] = value;
      }
    }
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  }

  if (upstream.status === 416) {
    return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes' } });
  }

  // Auth/permission/quota problems all collapse to 404 toward the media
  // element — the typed detail belongs to the bridge result path, and a
  // probing renderer learns nothing from the protocol handler.
  return new Response(null, { status: 404 });
}

// ---------------------------------------------------------------------------
// Session: access-token cache with serialized refresh
// ---------------------------------------------------------------------------

/** Refresh this long before nominal expiry. */
const REFRESH_MARGIN_MS = 60 * 1000;

export type AccessTokenOutcome =
  | { status: 'ok'; accessToken: string }
  | { status: 'auth-required' }
  | { status: 'auth-expired' }
  | { status: 'token-store-unavailable' }
  | { status: 'offline' };

/**
 * Holds the in-memory access token and mediates refreshes.
 *
 * Concurrent callers share one in-flight refresh rather than racing several —
 * Google rotates refresh tokens, and two parallel refreshes can invalidate
 * each other's rotation.
 */
export class DriveSession {
  private accessToken: string | null = null;
  private expiresAtMs = 0;
  private inflightRefresh: Promise<AccessTokenOutcome> | null = null;

  constructor(
    private readonly fetchFn: FetchLike,
    private readonly config: OAuthClientConfig,
    private readonly tokenStore: DriveTokenStore,
  ) {}

  /** Adopt tokens from a fresh interactive sign-in. */
  adopt(accessToken: string, expiresInSeconds: number): void {
    this.accessToken = accessToken;
    this.expiresAtMs = Date.now() + expiresInSeconds * 1000;
  }

  /** Drop everything in memory (disconnect, app sign-out). */
  invalidate(): void {
    this.accessToken = null;
    this.expiresAtMs = 0;
  }

  async getAccessToken(now: number = Date.now()): Promise<AccessTokenOutcome> {
    if (this.accessToken !== null && now < this.expiresAtMs - REFRESH_MARGIN_MS) {
      return { status: 'ok', accessToken: this.accessToken };
    }
    // Everyone who arrives during a refresh waits on the same one.
    this.inflightRefresh ??= this.refresh().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private async refresh(): Promise<AccessTokenOutcome> {
    const stored = await this.tokenStore.read();
    if (stored.status === 'unavailable') {
      return { status: 'token-store-unavailable' };
    }
    if (stored.status === 'absent') {
      return { status: 'auth-required' };
    }

    const outcome = await refreshAccessToken(this.fetchFn, this.config, stored.refreshToken);
    if (outcome.status === 'invalid-grant') {
      // The stored token is dead. Clear it so we stop presenting a corpse.
      await this.tokenStore.clear();
      this.invalidate();
      return { status: 'auth-expired' };
    }
    if (outcome.status === 'offline') {
      return { status: 'offline' };
    }
    if (outcome.status === 'failed') {
      // Transient server-side failure: keep the stored token, report offline-ish.
      return { status: 'offline' };
    }

    this.adopt(outcome.tokens.accessToken, outcome.tokens.expiresInSeconds);
    if (outcome.tokens.refreshToken !== null) {
      // Rotation: the write is atomic (write-then-rename) in the store.
      await this.tokenStore.write(outcome.tokens.refreshToken, stored.accountEmail);
    }
    return { status: 'ok', accessToken: outcome.tokens.accessToken };
  }
}
