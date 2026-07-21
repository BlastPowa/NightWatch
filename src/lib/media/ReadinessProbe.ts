import type { DriveFileAccessState } from '@shared/ipc';
import type { MediaSourceDescriptor, MediaResult } from '@shared/media';
import type { SelectedMedia } from '@shared/mediaBridge';
import type { FileWatchReadiness } from '@shared/roomComms';

/**
 * Remaining-features handoff, Priorities 2/3/5 — turn a published file-watch
 * descriptor into THIS participant's readiness state.
 *
 * The rules, in order, are deliberately explicit so the roster never shows a
 * vague "not ready":
 *
 *   offline              — the device cannot reach Drive at all
 *   permission-required  — Drive says this viewer must be granted access
 *   missing-file         — no local copy matches, or Drive cannot see the file
 *   fingerprint-mismatch — a local file matched by name/size but NOT by hash
 *   unsupported-codec    — the container is fine but this build cannot decode
 *   buffering            — matched and decodable, still preparing
 *   ready                — playable now
 *
 * Pure decision logic; all I/O is injected so it is unit-testable and so this
 * module stays importable from any platform.
 */

export interface ReadinessDeps {
  /** Drive access probe for this viewer (null on non-Drive descriptors). */
  probeDriveAccess(fileId: string): Promise<DriveFileAccessState>;
  /** Device-local fingerprint match for a local descriptor. */
  resolveLocalMatch(
    descriptor: Extract<MediaSourceDescriptor, { kind: 'local' }>,
  ): Promise<MediaResult<SelectedMedia>>;
  /**
   * Can this Chromium build decode the container/codec?
   * Wraps HTMLMediaElement.canPlayType — supplied by the renderer.
   */
  canPlayType(mimeType: string): boolean;
  /** Is the device online? Defaults to navigator.onLine when omitted. */
  isOnline?(): boolean;
}

export interface ReadinessResult {
  readiness: FileWatchReadiness;
  /** Present when the participant can act (grant request, locate file…). */
  detail: string | null;
}

const DRIVE_ACCESS_TO_READINESS: Record<DriveFileAccessState, FileWatchReadiness> = {
  accessible: 'ready',
  'permission-required': 'permission-required',
  revoked: 'permission-required',
  'not-found': 'missing-file',
  offline: 'offline',
};

export async function evaluateReadiness(
  descriptor: MediaSourceDescriptor,
  deps: ReadinessDeps,
): Promise<ReadinessResult> {
  if (descriptor.kind === 'youtube') {
    // YouTube needs no per-participant authorization; it is always ready.
    return { readiness: 'ready', detail: null };
  }

  const online = deps.isOnline?.() ?? (typeof navigator === 'undefined' || navigator.onLine);

  // Codec support is a local fact — check it before any network work so an
  // undecodable file never sends the viewer chasing permissions.
  if (!deps.canPlayType(descriptor.mimeType)) {
    return {
      readiness: 'unsupported-codec',
      detail: 'This device cannot play this file’s video format.',
    };
  }

  if (descriptor.kind === 'drive') {
    if (!online) {
      return { readiness: 'offline', detail: 'You appear to be offline.' };
    }
    const access = await deps.probeDriveAccess(descriptor.fileId);
    const readiness = DRIVE_ACCESS_TO_READINESS[access];
    return {
      readiness,
      detail:
        readiness === 'permission-required'
          ? 'Ask the host to share this file with your Google account, then retry.'
          : readiness === 'missing-file'
            ? 'This file is not visible to your Google account.'
            : null,
    };
  }

  // Local: the viewer must hold their OWN copy, matched by fingerprint.
  const match = await deps.resolveLocalMatch(descriptor);
  if (match.ok) {
    return { readiness: 'ready', detail: null };
  }
  switch (match.error.code) {
    case 'file-changed':
      return {
        readiness: 'fingerprint-mismatch',
        detail: 'Your copy of this file does not match the one the host loaded.',
      };
    case 'unsupported-codec':
    case 'unsupported-format':
      return {
        readiness: 'unsupported-codec',
        detail: 'This device cannot play this file’s video format.',
      };
    case 'offline':
      return { readiness: 'offline', detail: 'You appear to be offline.' };
    case 'rate-limited':
      return { readiness: 'rate-limited', detail: 'Too many attempts — retry shortly.' };
    default:
      return {
        readiness: 'missing-file',
        detail: 'Select your own copy of this file to join the watch.',
      };
  }
}
