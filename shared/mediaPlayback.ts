/**
 * Phase 29 — source-neutral playback abstraction and versioned room events.
 *
 * The existing `playback:*` and `sync:*` events are deliberately untouched and
 * remain YouTube-only. A v0.1.x client that has never heard of custom media
 * must never receive a descriptor down a channel it thinks carries a YouTube
 * id — so custom media gets its own namespace rather than a widened payload.
 *
 * Pure contracts and validation. No Electron, no DOM.
 */

import {
  SUPPORTED_MEDIA_PROTOCOL_VERSIONS,
  mediaFail,
  mediaOk,
  parseMediaSourceDescriptor,
  type HtmlMediaSourceDescriptor,
  type MediaFailure,
  type MediaProtocolVersion,
  type MediaResult,
  type MediaSourceDescriptor,
} from './media';
import { isReactionEmoji, type ReactionEmoji } from './reactions';

// ---------------------------------------------------------------------------
// Playback adapter
// ---------------------------------------------------------------------------

/** Authoritative playback state, as published by the host. */
export interface PlaybackSnapshotV1 {
  protocolVersion: 1;
  sessionId: string;
  sourceKey: string;
  positionSeconds: number;
  durationSeconds: number | null;
  paused: boolean;
  playbackRate: number;
  hostClockMs: number;
  /**
   * Monotonic per-session counter. Receivers drop anything at or below the
   * revision they have already applied, which is what makes a reordered or
   * replayed broadcast harmless.
   */
  revision: number;
}

export type PlaybackAdapterEvent =
  | { type: 'ready'; durationSeconds: number | null }
  | { type: 'state'; snapshot: PlaybackSnapshotV1 }
  | { type: 'buffering' }
  | { type: 'ended' }
  | { type: 'error'; error: MediaFailure };

/**
 * One playback surface, whatever is behind it.
 *
 * `YouTubeAdapter` wraps the existing official iframe and the existing
 * YouTubePlayer — its branding, controls, and ads are not ours to touch.
 * `HtmlMediaAdapter` owns a plain <video> element fed by an opaque
 * `nightwatch-media://stream/{leaseId}` URL. The renderer never learns a path
 * or a token; it only ever holds that URL.
 */
export interface PlaybackAdapter {
  readonly kind: MediaSourceDescriptor['kind'];
  load(source: MediaSourceDescriptor): Promise<MediaResult<void>>;
  play(): Promise<MediaResult<void>>;
  pause(): Promise<MediaResult<void>>;
  seek(positionSeconds: number): Promise<MediaResult<void>>;
  setVolume(volumePercent: number): void;
  getSnapshot(): PlaybackSnapshotV1 | null;
  subscribe(listener: (event: PlaybackAdapterEvent) => void): () => void;
  /** Must abort pending work, revoke the lease, detach listeners, stop media. */
  destroy(): void;
}

export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 4;
/** Bounds a session id to a sane opaque token rather than free text. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SOURCE_KEY_PATTERN = /^(youtube:[A-Za-z0-9_-]{11}|sha256:[0-9a-f]{64}:[0-9]{1,16})$/;

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validate an untrusted snapshot.
 *
 * Non-finite times are rejected rather than clamped: a NaN position that gets
 * coerced to 0 silently yanks every viewer back to the start, which is worse
 * than ignoring the message.
 */
export function parsePlaybackSnapshot(value: unknown): MediaResult<PlaybackSnapshotV1> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return mediaFail('invalid-request', 'Playback state must be an object.');
  }
  const record = value as Record<string, unknown>;

  if (record['protocolVersion'] !== 1) {
    return mediaFail('incompatible-client', 'Unsupported playback protocol version.');
  }
  const sessionId = record['sessionId'];
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return mediaFail('invalid-request', 'Playback state has an invalid session id.');
  }
  const sourceKey = record['sourceKey'];
  if (typeof sourceKey !== 'string' || !SOURCE_KEY_PATTERN.test(sourceKey)) {
    return mediaFail('invalid-request', 'Playback state has an invalid source key.');
  }
  if (!isFiniteNonNegative(record['positionSeconds'])) {
    return mediaFail('invalid-request', 'Playback state has an invalid position.');
  }
  const durationSeconds = record['durationSeconds'];
  if (durationSeconds !== null && !isFiniteNonNegative(durationSeconds)) {
    return mediaFail('invalid-request', 'Playback state has an invalid duration.');
  }
  if (typeof record['paused'] !== 'boolean') {
    return mediaFail('invalid-request', 'Playback state has an invalid paused flag.');
  }
  const playbackRate = record['playbackRate'];
  if (
    typeof playbackRate !== 'number' ||
    !Number.isFinite(playbackRate) ||
    playbackRate < MIN_PLAYBACK_RATE ||
    playbackRate > MAX_PLAYBACK_RATE
  ) {
    return mediaFail('invalid-request', 'Playback state has an invalid rate.');
  }
  if (!isFiniteNonNegative(record['hostClockMs'])) {
    return mediaFail('invalid-request', 'Playback state has an invalid host clock.');
  }
  const revision = record['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return mediaFail('invalid-request', 'Playback state has an invalid revision.');
  }

  return mediaOk({
    protocolVersion: 1,
    sessionId,
    sourceKey,
    positionSeconds: record['positionSeconds'],
    durationSeconds: durationSeconds as number | null,
    paused: record['paused'],
    playbackRate,
    hostClockMs: record['hostClockMs'],
    revision,
  });
}

// ---------------------------------------------------------------------------
// Versioned room events
// ---------------------------------------------------------------------------

/** Why a participant is or is not ready. Never carries provider detail. */
export type MediaReadinessOutcome =
  | 'ready'
  | 'missing-source'
  | 'permission-required'
  | 'unsupported-format'
  | 'source-mismatch'
  | 'incompatible-client';

/**
 * The custom-media event namespace.
 *
 * Kept under its own names so the legacy event payloads never change shape.
 * Phase 31 registers these names alongside the legacy room bindings; old
 * clients simply do not subscribe to names they do not know.
 */
export interface Phase29RealtimeEvents {
  'media:v1:load': {
    sessionId: string;
    source: HtmlMediaSourceDescriptor;
    revision: number;
  };
  'media:v1:ready': {
    sessionId: string;
    sourceKey: string;
    ready: boolean;
    outcome: MediaReadinessOutcome;
  };
  'media:v1:play': PlaybackSnapshotV1;
  'media:v1:pause': PlaybackSnapshotV1;
  'media:v1:seek': PlaybackSnapshotV1;
  'media:v1:snapshot': PlaybackSnapshotV1;
  'media:v1:request-snapshot': { sessionId: string };
  'media:v1:unload': { sessionId: string; revision: number };
  /**
   * Ephemeral room reaction for HTML media. Persistent timeline notes remain
   * separately permissioned and are not smuggled into this event.
   */
  'media:v1:reaction': {
    sessionId: string;
    sourceKey: string;
    emoji: ReactionEmoji;
    positionSeconds: number;
  };
}

export type Phase29EventName = keyof Phase29RealtimeEvents & string;

/** Events only the host may publish. A member sending one is ignored. */
export const HOST_AUTHORITATIVE_MEDIA_EVENTS: readonly Phase29EventName[] = [
  'media:v1:load',
  'media:v1:play',
  'media:v1:pause',
  'media:v1:seek',
  'media:v1:snapshot',
  'media:v1:unload',
];

export const MEDIA_V1_EVENTS: readonly Phase29EventName[] = [
  'media:v1:load',
  'media:v1:ready',
  'media:v1:play',
  'media:v1:pause',
  'media:v1:seek',
  'media:v1:snapshot',
  'media:v1:request-snapshot',
  'media:v1:unload',
  'media:v1:reaction',
];

export function isHostAuthoritativeMediaEvent(name: string): boolean {
  return (HOST_AUTHORITATIVE_MEDIA_EVENTS as readonly string[]).includes(name);
}

const READINESS_OUTCOMES: readonly MediaReadinessOutcome[] = [
  'ready',
  'missing-source',
  'permission-required',
  'unsupported-format',
  'source-mismatch',
  'incompatible-client',
];

export function parseMediaLoadEvent(
  value: unknown,
): MediaResult<Phase29RealtimeEvents['media:v1:load']> {
  if (typeof value !== 'object' || value === null) {
    return mediaFail('invalid-request', 'Load event must be an object.');
  }
  const record = value as Record<string, unknown>;
  const sessionId = record['sessionId'];
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return mediaFail('invalid-request', 'Load event has an invalid session id.');
  }
  const revision = record['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return mediaFail('invalid-request', 'Load event has an invalid revision.');
  }
  const source = parseMediaSourceDescriptor(record['source']);
  if (!source.ok) {
    return source;
  }
  if (source.value.kind === 'youtube') {
    // YouTube keeps its own legacy path; letting it in here would give a room
    // two competing sources of truth for the same video.
    return mediaFail('invalid-request', 'YouTube media does not travel on the media:v1 channel.');
  }
  return mediaOk({ sessionId, source: source.value, revision });
}

export function parseMediaReadyEvent(
  value: unknown,
): MediaResult<Phase29RealtimeEvents['media:v1:ready']> {
  if (typeof value !== 'object' || value === null) {
    return mediaFail('invalid-request', 'Ready event must be an object.');
  }
  const record = value as Record<string, unknown>;
  const sessionId = record['sessionId'];
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return mediaFail('invalid-request', 'Ready event has an invalid session id.');
  }
  const sourceKey = record['sourceKey'];
  if (typeof sourceKey !== 'string' || !SOURCE_KEY_PATTERN.test(sourceKey)) {
    return mediaFail('invalid-request', 'Ready event has an invalid source key.');
  }
  if (typeof record['ready'] !== 'boolean') {
    return mediaFail('invalid-request', 'Ready event has an invalid ready flag.');
  }
  const outcome = record['outcome'];
  if (typeof outcome !== 'string' || !(READINESS_OUTCOMES as readonly string[]).includes(outcome)) {
    return mediaFail('invalid-request', 'Ready event has an unknown outcome.');
  }
  return mediaOk({
    sessionId,
    sourceKey,
    ready: record['ready'],
    outcome: outcome as MediaReadinessOutcome,
  });
}

export function parseMediaRequestSnapshotEvent(
  value: unknown,
): MediaResult<Phase29RealtimeEvents['media:v1:request-snapshot']> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return mediaFail('invalid-request', 'Snapshot request must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'sessionId')) {
    return mediaFail('invalid-request', 'Snapshot request has unexpected fields.');
  }
  const sessionId = record['sessionId'];
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return mediaFail('invalid-request', 'Snapshot request has an invalid session id.');
  }
  return mediaOk({ sessionId });
}

export function parseMediaUnloadEvent(
  value: unknown,
): MediaResult<Phase29RealtimeEvents['media:v1:unload']> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return mediaFail('invalid-request', 'Unload event must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'sessionId' && key !== 'revision')) {
    return mediaFail('invalid-request', 'Unload event has unexpected fields.');
  }
  const sessionId = record['sessionId'];
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return mediaFail('invalid-request', 'Unload event has an invalid session id.');
  }
  const revision = record['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return mediaFail('invalid-request', 'Unload event has an invalid revision.');
  }
  return mediaOk({ sessionId, revision });
}

export function parseMediaReactionEvent(
  value: unknown,
): MediaResult<Phase29RealtimeEvents['media:v1:reaction']> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return mediaFail('invalid-request', 'Media reaction must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        key !== 'sessionId' &&
        key !== 'sourceKey' &&
        key !== 'emoji' &&
        key !== 'positionSeconds',
    )
  ) {
    return mediaFail('invalid-request', 'Media reaction has unexpected fields.');
  }
  const sessionId = record['sessionId'];
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return mediaFail('invalid-request', 'Media reaction has an invalid session id.');
  }
  const sourceKey = record['sourceKey'];
  if (typeof sourceKey !== 'string' || !SOURCE_KEY_PATTERN.test(sourceKey)) {
    return mediaFail('invalid-request', 'Media reaction has an invalid source key.');
  }
  const emoji = record['emoji'];
  if (typeof emoji !== 'string' || !isReactionEmoji(emoji)) {
    return mediaFail('invalid-request', 'Media reaction has an unsupported emoji.');
  }
  const positionSeconds = record['positionSeconds'];
  if (!isFiniteNonNegative(positionSeconds)) {
    return mediaFail('invalid-request', 'Media reaction has an invalid position.');
  }
  return mediaOk({ sessionId, sourceKey, emoji, positionSeconds });
}

/**
 * Validate any untrusted Phase 29/31 room payload before it reaches feature
 * listeners. The return value is intentionally opaque to the room service:
 * feature code receives the original typed envelope only after this succeeds.
 */
export function validatePhase29EventPayload(
  name: Phase29EventName,
  value: unknown,
): MediaResult<unknown> {
  switch (name) {
    case 'media:v1:load':
      return parseMediaLoadEvent(value);
    case 'media:v1:ready':
      return parseMediaReadyEvent(value);
    case 'media:v1:play':
    case 'media:v1:pause':
    case 'media:v1:seek':
    case 'media:v1:snapshot':
      return parsePlaybackSnapshot(value);
    case 'media:v1:request-snapshot':
      return parseMediaRequestSnapshotEvent(value);
    case 'media:v1:unload':
      return parseMediaUnloadEvent(value);
    case 'media:v1:reaction':
      return parseMediaReactionEvent(value);
  }
}

/**
 * Whether a custom-media session may start.
 *
 * Every current participant must advertise protocol version 1. A participant on
 * an older build advertises nothing, so the session does not silently begin
 * without them — the host has to remove or notify them through the existing
 * room controls first.
 */
export function canStartCustomMediaSession(
  participantProtocolVersions: readonly (readonly MediaProtocolVersion[])[],
): boolean {
  if (participantProtocolVersions.length === 0) {
    return false;
  }
  return participantProtocolVersions.every((versions) =>
    versions.some((version) =>
      (SUPPORTED_MEDIA_PROTOCOL_VERSIONS as readonly number[]).includes(version),
    ),
  );
}

/** True when an incoming revision should be applied over the current one. */
export function isFresherRevision(currentRevision: number, incomingRevision: number): boolean {
  return incomingRevision > currentRevision;
}
