/**
 * Phase 32 — versioned room media modes and the shared comms outcome model.
 *
 * Builds ON TOP of the Phase 29 contracts in `shared/media.ts` without
 * changing them: YouTube events and schemaVersion-1 descriptors remain
 * exactly as they were, so old clients are untouched. What this module adds:
 *
 *  - an explicit, versioned ROOM MEDIA MODE envelope (`youtube`,
 *    `file-watch`, `live-share`) that travels in room state;
 *  - participant readiness reporting for `file-watch`;
 *  - the Phase 32 capability flags;
 *  - the universal typed outcome every Phase 32 operation returns.
 *
 * Imported by Electron main, preload, renderer, and tests — keep it pure.
 */

import {
  isHtmlMediaDescriptor,
  parseMediaSourceDescriptor,
  type MediaSourceDescriptor,
} from './media';

// ---------------------------------------------------------------------------
// Universal outcomes (handoff §5)
// ---------------------------------------------------------------------------

export type CommsErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'blocked'
  | 'not-supported'
  | 'permission-required'
  | 'rate-limited'
  | 'offline'
  | 'server-error';

export type CommsOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: CommsErrorCode; message: string; retryable: boolean };

const RETRYABLE_COMMS_CODES: ReadonlySet<CommsErrorCode> = new Set<CommsErrorCode>([
  'rate-limited',
  'offline',
  'server-error',
]);

export function commsOk<T>(value: T): CommsOutcome<T> {
  return { ok: true, value };
}

export function commsFail(
  code: CommsErrorCode,
  message: string,
  retryable: boolean = RETRYABLE_COMMS_CODES.has(code),
): CommsOutcome<never> {
  return { ok: false, code, message, retryable };
}

/**
 * Map a PostgREST/Edge error surface onto the universal codes. Centralized so
 * "blocked" can never come back as "server-error" in one service and
 * "forbidden" in another.
 */
export function commsFailFromRpc(error: {
  code?: string | null;
  message?: string | null;
  status?: number;
}): CommsOutcome<never> {
  const message = (error.message ?? '').toLowerCase();
  if (error.code === '42883' || error.code === '42P01') {
    return commsFail('not-supported', 'This feature is not deployed yet.');
  }
  if (message.includes('blocked')) {
    return commsFail('blocked', 'This action is unavailable between you and that user.');
  }
  if (message.includes('rate') || error.status === 429) {
    return commsFail('rate-limited', 'Too many requests — slow down and retry.');
  }
  if (message.includes('unauthenticated') || error.status === 401) {
    return commsFail('unauthorized', 'Sign in to use this feature.');
  }
  if (message.includes('forbidden') || error.status === 403) {
    return commsFail('forbidden', 'You do not have access to that.');
  }
  if (error.status !== undefined && error.status >= 500) {
    return commsFail('server-error', 'The server had a problem — try again.');
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return commsFail('offline', 'You appear to be offline.');
  }
  return commsFail('server-error', 'The request failed — try again.');
}

// ---------------------------------------------------------------------------
// Room media modes (handoff §1)
// ---------------------------------------------------------------------------

/** Wire version for the room media MODE envelope (not the descriptor). */
export type RoomMediaModeVersion = 2;
export const SUPPORTED_ROOM_MEDIA_MODE_VERSIONS: readonly RoomMediaModeVersion[] = [2];

/**
 * The room's active media mode. Version-1 rooms never send this envelope at
 * all (they send bare YouTube events), which is exactly why old clients keep
 * working: absence of the envelope IS the legacy YouTube mode.
 */
export type RoomMediaMode =
  | {
      modeVersion: 2;
      mode: 'youtube';
      /** The existing schemaVersion-1 YouTube descriptor, unchanged. */
      descriptor: Extract<MediaSourceDescriptor, { kind: 'youtube' }>;
    }
  | {
      modeVersion: 2;
      mode: 'file-watch';
      /** Local/Drive schemaVersion-1 descriptor from shared/media.ts. The
       *  Drive fileId inside it is opaque and useless without the viewer's
       *  own authorization — that is the §2 model. */
      descriptor: Extract<MediaSourceDescriptor, { kind: 'local' | 'drive' }>;
      /** Room policy: when may the host start. */
      readiness: 'all-ready' | 'majority-ready' | 'host-only';
    }
  | {
      modeVersion: 2;
      mode: 'live-share';
      /** Ephemeral: identifies the WebRTC share session, never media. */
      sessionId: string;
      sharerId: string;
      sourceLabel: string;
    };

/** Participant readiness for file-watch (handoff §1 outcome list). */
export type FileWatchReadiness =
  | 'ready'
  | 'missing-file'
  | 'permission-required'
  | 'fingerprint-mismatch'
  | 'unsupported-codec'
  | 'buffering'
  | 'offline'
  | 'rate-limited';

export const FILE_WATCH_READINESS_STATES: readonly FileWatchReadiness[] = [
  'ready',
  'missing-file',
  'permission-required',
  'fingerprint-mismatch',
  'unsupported-codec',
  'buffering',
  'offline',
  'rate-limited',
];

export function isFileWatchReadiness(value: unknown): value is FileWatchReadiness {
  return (
    typeof value === 'string' &&
    (FILE_WATCH_READINESS_STATES as readonly string[]).includes(value)
  );
}

const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/;
const SOURCE_LABEL_MAX = 80;

export function isRtcSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

/**
 * Parse an untrusted mode envelope from a room event or stored state.
 *
 * Old-client semantics: a client that does not understand `modeVersion: 2`
 * (i.e. any pre-Phase-32 build) never reaches this function — it sees an
 * unknown event/field and ignores it, keeping its legacy YouTube behaviour.
 * A Phase-32 client receiving a FUTURE version gets an explicit
 * `not-supported`, never a best-effort parse.
 */
export function parseRoomMediaMode(value: unknown): CommsOutcome<RoomMediaMode> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return commsFail('not-supported', 'Room media mode must be an object.');
  }
  const record = value as Record<string, unknown>;

  if (record['modeVersion'] !== 2) {
    return commsFail(
      'not-supported',
      'This room uses a media mode this version of NightWatch does not support. Update the app.',
    );
  }

  switch (record['mode']) {
    case 'youtube': {
      const parsed = parseMediaSourceDescriptor(record['descriptor']);
      if (!parsed.ok || parsed.value.kind !== 'youtube') {
        return commsFail('not-supported', 'Invalid YouTube room media descriptor.');
      }
      return commsOk({ modeVersion: 2, mode: 'youtube', descriptor: parsed.value });
    }

    case 'file-watch': {
      const parsed = parseMediaSourceDescriptor(record['descriptor']);
      if (!parsed.ok || !isHtmlMediaDescriptor(parsed.value)) {
        return commsFail('not-supported', 'Invalid file-watch media descriptor.');
      }
      const readiness = record['readiness'];
      if (
        readiness !== 'all-ready' &&
        readiness !== 'majority-ready' &&
        readiness !== 'host-only'
      ) {
        return commsFail('not-supported', 'Invalid file-watch readiness policy.');
      }
      return commsOk({
        modeVersion: 2,
        mode: 'file-watch',
        descriptor: parsed.value,
        readiness,
      });
    }

    case 'live-share': {
      const sessionId = record['sessionId'];
      const sharerId = record['sharerId'];
      const sourceLabel = record['sourceLabel'];
      if (!isRtcSessionId(sessionId)) {
        return commsFail('not-supported', 'Invalid live-share session id.');
      }
      if (typeof sharerId !== 'string' || sharerId.length === 0 || sharerId.length > 64) {
        return commsFail('not-supported', 'Invalid live-share sharer.');
      }
      if (
        typeof sourceLabel !== 'string' ||
        sourceLabel.length === 0 ||
        sourceLabel.length > SOURCE_LABEL_MAX
      ) {
        return commsFail('not-supported', 'Invalid live-share source label.');
      }
      return commsOk({
        modeVersion: 2,
        mode: 'live-share',
        sessionId,
        sharerId,
        sourceLabel,
      });
    }

    default:
      return commsFail('not-supported', 'Unknown room media mode.');
  }
}

/** May the host start file-watch playback under the given policy? */
export function mayStartFileWatch(
  policy: Extract<RoomMediaMode, { mode: 'file-watch' }>['readiness'],
  readiness: ReadonlyMap<string, FileWatchReadiness>,
  hostId: string,
): boolean {
  const states = [...readiness.values()];
  switch (policy) {
    case 'host-only':
      return readiness.get(hostId) === 'ready';
    case 'all-ready':
      return states.length > 0 && states.every((state) => state === 'ready');
    case 'majority-ready': {
      if (states.length === 0) {
        return false;
      }
      const ready = states.filter((state) => state === 'ready').length;
      return ready * 2 > states.length;
    }
  }
}

// ---------------------------------------------------------------------------
// Capability flags (handoff §5)
// ---------------------------------------------------------------------------

export interface RoomMediaCapabilities {
  fileWatch: boolean;
  driveWorkspace: boolean;
  liveShare: boolean;
  voiceChat: boolean;
  publicUserSearch: boolean;
  roomPeopleActions: boolean;
}

/** Everything off — the only safe default until deployment is verified. */
export function disabledRoomMediaCapabilities(): RoomMediaCapabilities {
  return {
    fileWatch: false,
    driveWorkspace: false,
    liveShare: false,
    voiceChat: false,
    publicUserSearch: false,
    roomPeopleActions: false,
  };
}

// ---------------------------------------------------------------------------
// Persisted room-media snapshots and participant readiness (handoff §6)
// ---------------------------------------------------------------------------

export interface RoomMediaSnapshot {
  revision: number;
  controllerId: string;
  mode: RoomMediaMode;
  updatedAt: string;
}

export interface FileWatchReadinessEntry {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  border: string | null;
  readiness: FileWatchReadiness;
  updatedAt: string | null;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseRoomMediaSnapshot(value: unknown): RoomMediaSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const parsedMode = parseRoomMediaMode(record['mode']);
  const revision = record['revision'];
  const controllerId = record['controllerId'];
  const updatedAt = record['updatedAt'];
  if (
    !parsedMode.ok ||
    !positiveSafeInteger(revision) ||
    typeof controllerId !== 'string' ||
    controllerId.length === 0 ||
    typeof updatedAt !== 'string' ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    return null;
  }
  return { revision, controllerId, mode: parsedMode.value, updatedAt };
}

export function parseFileWatchReadinessEntry(
  value: unknown,
): FileWatchReadinessEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const userId = record['userId'];
  const displayName = record['displayName'];
  const avatarUrl = record['avatarUrl'];
  const border = record['border'];
  const readiness = record['readiness'];
  const updatedAt = record['updatedAt'];
  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    typeof displayName !== 'string' ||
    !isFileWatchReadiness(readiness) ||
    (avatarUrl !== null && typeof avatarUrl !== 'string') ||
    (border !== null && typeof border !== 'string') ||
    (updatedAt !== null && (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))))
  ) {
    return null;
  }
  return { userId, displayName, avatarUrl, border, readiness, updatedAt };
}
