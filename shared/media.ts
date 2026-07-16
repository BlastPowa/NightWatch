/**
 * Phase 29 — source-neutral media contracts.
 *
 * NightWatch synchronizes playback state only. Every participant obtains the
 * selected media from a file they control or from Google Drive using their own
 * authorization. Nothing in this module — or anything built on it — may
 * download, cache, proxy, or relay media bytes between participants.
 *
 * This module is imported by Electron main, the preload bridge, the renderer,
 * and the tests, so it must stay free of Electron and DOM globals. Keep it
 * pure: types, validation, and normalization only.
 */

/**
 * Wire version for the custom-media room protocol. Bumping this is a breaking
 * change: a client only joins a custom-media session when every participant
 * advertises a version it understands.
 */
export type MediaProtocolVersion = 1;

/** Protocol versions this build can speak. */
export const SUPPORTED_MEDIA_PROTOCOL_VERSIONS: readonly MediaProtocolVersion[] = [1];

/**
 * Container/codec families the first release supports.
 *
 * MIME acceptance is necessary but never sufficient — a file may claim
 * `video/mp4` and carry a codec this build cannot decode. The renderer must
 * also pass `HTMLMediaElement.canPlayType` before the participant reports
 * ready. That check lives in the renderer because it needs a DOM.
 */
export type SupportedHtmlMediaMime = 'video/mp4' | 'video/webm';

export const SUPPORTED_HTML_MEDIA_MIMES: readonly SupportedHtmlMediaMime[] = [
  'video/mp4',
  'video/webm',
];

/** File extensions the native picker offers. Kept in step with the MIME list. */
export const SUPPORTED_MEDIA_EXTENSIONS: readonly string[] = ['mp4', 'webm'];

/**
 * A descriptor is the *public* identity of a piece of media — the only media
 * shape that may travel through a room event. It deliberately cannot express a
 * path, a token, or a lease: those are device-local and never leave the main
 * process.
 */
export type MediaSourceDescriptor =
  | {
      schemaVersion: 1;
      kind: 'youtube';
      videoId: string;
    }
  | {
      schemaVersion: 1;
      kind: 'drive';
      fileId: string;
      fingerprint: MediaFingerprint;
      title: string;
      mimeType: SupportedHtmlMediaMime;
      size: number;
    }
  | {
      schemaVersion: 1;
      kind: 'local';
      fingerprint: MediaFingerprint;
      title: string;
      mimeType: SupportedHtmlMediaMime;
      size: number;
    };

export type MediaFingerprint = `sha256:${string}`;

export type MediaSourceKind = MediaSourceDescriptor['kind'];

/** Any descriptor that plays through an HTML media element rather than the iframe. */
export type HtmlMediaSourceDescriptor = Exclude<MediaSourceDescriptor, { kind: 'youtube' }>;

/**
 * Why a capability is off. The renderer shows the reason rather than a dead
 * control, so every path that disables something has to say which of these it
 * is — "it just didn't appear" is not a state a user can act on.
 */
export type MediaCapabilityReason =
  | 'available'
  | 'unsupported-platform'
  | 'not-configured'
  | 'security-review-required'
  | 'deployment-required'
  | 'disabled-by-owner';

export interface MediaCapabilities {
  /** YouTube is the existing, always-present path. */
  youtube: true;
  htmlMedia: boolean;
  localFiles: boolean;
  googleDrive: boolean;
  library: boolean;
  mediaProtocolVersions: readonly MediaProtocolVersion[];
  reasons: {
    htmlMedia: MediaCapabilityReason;
    localFiles: MediaCapabilityReason;
    googleDrive: MediaCapabilityReason;
    library: MediaCapabilityReason;
  };
}

/**
 * Capabilities for a platform that has no custom-media surface at all (the
 * Discord Activity and the plain web build). It advertises no protocol
 * versions, so it can never be counted as ready for a custom-media session.
 */
export function unsupportedPlatformCapabilities(): MediaCapabilities {
  return {
    youtube: true,
    htmlMedia: false,
    localFiles: false,
    googleDrive: false,
    library: false,
    mediaProtocolVersions: [],
    reasons: {
      htmlMedia: 'unsupported-platform',
      localFiles: 'unsupported-platform',
      googleDrive: 'unsupported-platform',
      library: 'unsupported-platform',
    },
  };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type MediaErrorCode =
  | 'cancelled'
  | 'unsupported-platform'
  | 'capability-disabled'
  | 'invalid-request'
  | 'invalid-selection'
  | 'unsupported-format'
  | 'unsupported-codec'
  | 'file-missing'
  | 'file-changed'
  | 'fingerprint-unavailable'
  | 'fingerprint-failed'
  | 'auth-cancelled'
  | 'auth-timeout'
  | 'auth-required'
  | 'auth-expired'
  | 'token-store-unavailable'
  | 'permission-denied'
  | 'download-restricted'
  | 'drive-file-unavailable'
  | 'picker-failed'
  | 'offline'
  | 'rate-limited'
  | 'quota-exceeded'
  | 'lease-expired'
  | 'range-invalid'
  | 'source-mismatch'
  | 'participant-not-ready'
  | 'incompatible-client'
  | 'aborted'
  | 'internal';

export type MediaResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MediaFailure };

export interface MediaFailure {
  code: MediaErrorCode;
  /**
   * Safe, human-readable text. Never a provider response, file-system error,
   * stack trace, token, absolute path, or lease id — those all leak through
   * error strings if you let them, and error strings end up in logs.
   */
  message: string;
  retryable: boolean;
}

/** Codes where retrying the same request can plausibly succeed. */
const RETRYABLE_CODES: ReadonlySet<MediaErrorCode> = new Set<MediaErrorCode>([
  'offline',
  'rate-limited',
  'quota-exceeded',
  'lease-expired',
  'auth-timeout',
  'auth-expired',
  'drive-file-unavailable',
  'internal',
]);

export function mediaOk<T>(value: T): MediaResult<T> {
  return { ok: true, value };
}

/**
 * Build a failure. `retryable` is derived from the code by default so the same
 * condition never reports as retryable in one place and terminal in another.
 */
export function mediaFail(
  code: MediaErrorCode,
  message: string,
  retryable: boolean = RETRYABLE_CODES.has(code),
): MediaResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
/** Drive file ids are opaque; bound the shape rather than guess the grammar. */
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

export const MEDIA_TITLE_MAX_LENGTH = 300;
/**
 * Ceiling on a selectable file, overridable by the packaged app. Selections
 * above it are refused outright — a truncated video is a corrupt video, and
 * silently truncating one would desynchronize a room with no visible cause.
 */
export const DEFAULT_MAX_MEDIA_SIZE_BYTES = 32 * 1024 * 1024 * 1024;

export function isMediaFingerprint(value: unknown): value is MediaFingerprint {
  return typeof value === 'string' && FINGERPRINT_PATTERN.test(value);
}

export function isSupportedHtmlMediaMime(value: unknown): value is SupportedHtmlMediaMime {
  return (
    typeof value === 'string' &&
    (SUPPORTED_HTML_MEDIA_MIMES as readonly string[]).includes(value)
  );
}

/** Build a fingerprint from a raw hex digest. Rejects anything else. */
export function toMediaFingerprint(hexDigest: string): MediaFingerprint | null {
  const normalized = hexDigest.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? `sha256:${normalized}` : null;
}

/**
 * Normalize a title to trimmed plain text.
 *
 * Titles come from file names and Drive metadata — both attacker-influenced.
 * Control characters are stripped (they let a name lie about its extension in
 * a log or a list), and the result is never treated as HTML anywhere.
 */
export function normalizeMediaTitle(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  // C0/C1 controls, plus the bidi overrides and zero-width joiners that let a
  // file name render in a list as something other than what it is.
  const stripped = value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g,
    '',
  );
  const trimmed = stripped.trim();
  if (trimmed.length === 0 || trimmed.length > MEDIA_TITLE_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

export function isValidMediaSize(
  value: unknown,
  maxBytes: number = DEFAULT_MAX_MEDIA_SIZE_BYTES,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maxBytes
  );
}

/** Reject anything carrying keys we did not ask for. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export interface ParseDescriptorOptions {
  /** Packaged-app size ceiling. Defaults to DEFAULT_MAX_MEDIA_SIZE_BYTES. */
  maxSizeBytes?: number;
}

/**
 * Validate an untrusted descriptor from any boundary — IPC, a room event, or
 * a stored record.
 *
 * This is the single chokepoint. `schemaVersion` must be exactly 1 and is never
 * coerced: a future client sending version 2 gets `incompatible-client`, not a
 * best-effort read of fields that may since have changed meaning. Unknown extra
 * fields are rejected rather than dropped, so a sender cannot smuggle a path
 * alongside a valid descriptor and rely on some later stage reading it.
 */
export function parseMediaSourceDescriptor(
  value: unknown,
  options: ParseDescriptorOptions = {},
): MediaResult<MediaSourceDescriptor> {
  const record = asRecord(value);
  if (record === null) {
    return mediaFail('invalid-request', 'Media source must be an object.');
  }

  if (record['schemaVersion'] !== 1) {
    return mediaFail(
      'incompatible-client',
      'This media source uses a version of the format this app does not support.',
    );
  }

  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_MEDIA_SIZE_BYTES;

  switch (record['kind']) {
    case 'youtube': {
      if (!hasExactKeys(record, ['schemaVersion', 'kind', 'videoId'])) {
        return mediaFail('invalid-request', 'YouTube source has unexpected fields.');
      }
      const videoId = record['videoId'];
      if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
        return mediaFail('invalid-selection', 'That is not a valid YouTube video id.');
      }
      return mediaOk({ schemaVersion: 1, kind: 'youtube', videoId });
    }

    case 'local': {
      if (
        !hasExactKeys(record, ['schemaVersion', 'kind', 'fingerprint', 'title', 'mimeType', 'size'])
      ) {
        return mediaFail('invalid-request', 'Local source has unexpected fields.');
      }
      const common = parseHtmlMediaCommon(record, maxSizeBytes);
      if (!common.ok) {
        return common;
      }
      return mediaOk({ schemaVersion: 1, kind: 'local', ...common.value });
    }

    case 'drive': {
      if (
        !hasExactKeys(record, [
          'schemaVersion',
          'kind',
          'fileId',
          'fingerprint',
          'title',
          'mimeType',
          'size',
        ])
      ) {
        return mediaFail('invalid-request', 'Drive source has unexpected fields.');
      }
      const fileId = record['fileId'];
      if (typeof fileId !== 'string' || !DRIVE_FILE_ID_PATTERN.test(fileId)) {
        return mediaFail('invalid-selection', 'That is not a valid Drive file id.');
      }
      const common = parseHtmlMediaCommon(record, maxSizeBytes);
      if (!common.ok) {
        return common;
      }
      return mediaOk({ schemaVersion: 1, kind: 'drive', fileId, ...common.value });
    }

    default:
      return mediaFail('invalid-request', 'Unknown media source type.');
  }
}

interface HtmlMediaCommon {
  fingerprint: MediaFingerprint;
  title: string;
  mimeType: SupportedHtmlMediaMime;
  size: number;
}

function parseHtmlMediaCommon(
  record: Record<string, unknown>,
  maxSizeBytes: number,
): MediaResult<HtmlMediaCommon> {
  const fingerprint = record['fingerprint'];
  if (!isMediaFingerprint(fingerprint)) {
    return mediaFail('invalid-selection', 'Media fingerprint is missing or malformed.');
  }
  const title = normalizeMediaTitle(record['title']);
  if (title === null) {
    return mediaFail('invalid-selection', 'Media title is missing or too long.');
  }
  const mimeType = record['mimeType'];
  if (!isSupportedHtmlMediaMime(mimeType)) {
    return mediaFail('unsupported-format', 'Only MP4 and WebM video files are supported.');
  }
  if (!isValidMediaSize(record['size'], maxSizeBytes)) {
    return mediaFail('invalid-selection', 'Media file size is invalid or above the limit.');
  }
  return mediaOk({ fingerprint, title, mimeType, size: record['size'] });
}

/** Narrowing helper for the HTML-media descriptors. */
export function isHtmlMediaDescriptor(
  descriptor: MediaSourceDescriptor,
): descriptor is HtmlMediaSourceDescriptor {
  return descriptor.kind !== 'youtube';
}

// ---------------------------------------------------------------------------
// Source identity
// ---------------------------------------------------------------------------

/**
 * Stable public identity of a source, used to tell "are we all on the same
 * media?" without exchanging anything private.
 *
 * Derived only from fields already public in the descriptor, and deliberately
 * NOT from the title — two participants who each hold their own authorized copy
 * of the same file may well have renamed it. Fingerprint is what makes them the
 * same video; the file name is decoration.
 */
export function deriveSourceKey(descriptor: MediaSourceDescriptor): string {
  switch (descriptor.kind) {
    case 'youtube':
      return `youtube:${descriptor.videoId}`;
    case 'drive':
    case 'local':
      // Drive and local collapse to the same key on purpose: a participant
      // playing their own local copy of a file another participant opened from
      // Drive is watching the same thing, and must sync with them.
      return `${descriptor.fingerprint}:${String(descriptor.size)}`;
  }
}

/**
 * True when two descriptors identify the same media.
 *
 * Fingerprint and size only. A filename or size match alone is never
 * sufficient — that is the whole point of hashing, and the check that stops a
 * room from playing two different videos in lockstep.
 */
export function isSameSource(a: MediaSourceDescriptor, b: MediaSourceDescriptor): boolean {
  return deriveSourceKey(a) === deriveSourceKey(b);
}
