/**
 * Phase 32 — WebRTC signaling, voice, capture, and TURN contracts.
 *
 * WebRTC carries ALL media. Supabase carries only the short-lived signaling
 * envelopes defined here — SDP and ICE strings are opaque payloads with hard
 * size caps, stored with an expiry and RLS, and never anything byte-bearing.
 *
 * Pure module: no DOM, no Electron. The renderer-side sessions and the
 * Electron capture surface import from here; so do the tests.
 */

// ---------------------------------------------------------------------------
// Signaling
// ---------------------------------------------------------------------------

export type RtcSignalKind = 'offer' | 'answer' | 'ice' | 'bye';

export const RTC_SIGNAL_KINDS: readonly RtcSignalKind[] = ['offer', 'answer', 'ice', 'bye'];

/** Hard cap on a single signaling payload (SDP blobs run ~4–8 KB). */
export const RTC_SIGNAL_MAX_PAYLOAD_CHARS = 16_384;

/** Signals older than this are garbage regardless of table expiry. */
export const RTC_SIGNAL_TTL_SECONDS = 60;

/** One session's media purpose. A client may run one of each concurrently. */
export type RtcSessionPurpose = 'voice' | 'screen-share';

/**
 * Peer-to-peer mesh ceiling. Above this, per-sender upload cost is
 * O(members²) and quality collapses; rooms larger than the cap require an
 * SFU, which is a provider/cost decision the owner makes before enabling
 * live-share/voice for public rooms (see the Phase 32 report).
 */
export const RTC_MESH_MAX_PEERS = 8;

export interface RtcSignal {
  kind: RtcSignalKind;
  sessionId: string;
  purpose: RtcSessionPurpose;
  /** Opaque SDP/ICE JSON. Empty for 'bye'. */
  payload: string;
}

export function isRtcSignalKind(value: unknown): value is RtcSignalKind {
  return typeof value === 'string' && (RTC_SIGNAL_KINDS as readonly string[]).includes(value);
}

export function isRtcPurpose(value: unknown): value is RtcSessionPurpose {
  return value === 'voice' || value === 'screen-share';
}

const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/;

export function isSignalPayloadAcceptable(kind: RtcSignalKind, payload: unknown): boolean {
  if (typeof payload !== 'string') {
    return false;
  }
  if (kind === 'bye') {
    return payload.length === 0;
  }
  return payload.length > 0 && payload.length <= RTC_SIGNAL_MAX_PAYLOAD_CHARS;
}

/** Validate an untrusted signal from the wire/table. */
export function parseRtcSignal(value: unknown): RtcSignal | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  const sessionId = record['sessionId'];
  const purpose = record['purpose'];
  const payload = record['payload'];
  if (
    !isRtcSignalKind(kind) ||
    typeof sessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(sessionId) ||
    !isRtcPurpose(purpose) ||
    !isSignalPayloadAcceptable(kind, payload)
  ) {
    return null;
  }
  return { kind, sessionId, purpose, payload: payload as string };
}

// ---------------------------------------------------------------------------
// Voice state
// ---------------------------------------------------------------------------

/**
 * Microphone constraints (handoff §4). `deviceId` optional; the processing
 * flags are requests — the platform reports what it actually honoured via
 * MediaTrackSettings, surfaced in VoiceCapabilityReport.
 */
export interface VoiceInputConstraints {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  deviceId?: string;
}

export const DEFAULT_VOICE_CONSTRAINTS: VoiceInputConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** What the platform actually granted for the active microphone track. */
export interface VoiceCapabilityReport {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  deviceLabel: string;
}

/** Per-user voice presence, exchanged over room presence (counts/flags only). */
export interface VoicePeerState {
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}

export type VoiceSessionPhase =
  | 'idle'
  | 'requesting-permission'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended';

export type VoiceEndReason =
  | 'left'
  | 'permission-denied'
  | 'device-lost'
  | 'room-closed'
  | 'signed-out'
  | 'window-closed'
  | 'peer-limit'
  | 'error';

// ---------------------------------------------------------------------------
// Screen/window capture
// ---------------------------------------------------------------------------

export type CaptureSourceKind = 'screen' | 'window';

/** A capture source as the renderer may see it. No native handles. */
export interface CaptureSourceSummary {
  id: string;
  kind: CaptureSourceKind;
  name: string;
  /** Small data: URL preview, safe to render. Empty when unavailable. */
  thumbnailDataUrl: string;
}

/** Electron desktopCapturer ids look like "screen:0:0" / "window:123:0". */
const CAPTURE_SOURCE_ID_PATTERN = /^(screen|window):[0-9]+:[0-9]+$/;

export function isCaptureSourceId(value: unknown): value is string {
  return typeof value === 'string' && CAPTURE_SOURCE_ID_PATTERN.test(value);
}

export type ShareSessionPhase =
  | 'idle'
  | 'picking-source'
  | 'connecting'
  | 'sharing'
  | 'ended';

export type ShareEndReason =
  | 'stopped'
  | 'source-closed'
  | 'permission-denied'
  | 'viewer-limit'
  | 'signed-out'
  | 'window-closed'
  | 'error';

// ---------------------------------------------------------------------------
// TURN
// ---------------------------------------------------------------------------

/** Short-lived TURN credentials minted server-side (handoff §4). */
export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  /** Unix epoch seconds. */
  expiresAt: number;
}

export const TURN_CREDENTIAL_TTL_SECONDS = 600;

export function parseTurnCredentials(value: unknown): TurnCredentials | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const urls = record['urls'];
  const username = record['username'];
  const credential = record['credential'];
  const expiresAt = record['expiresAt'];
  if (
    !Array.isArray(urls) ||
    urls.length === 0 ||
    urls.length > 8 ||
    !urls.every(
      (url) =>
        typeof url === 'string' &&
        (url.startsWith('turn:') || url.startsWith('turns:') || url.startsWith('stun:')),
    ) ||
    typeof username !== 'string' ||
    username.length === 0 ||
    typeof credential !== 'string' ||
    credential.length === 0 ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }
  return { urls: urls as string[], username, credential, expiresAt };
}

/** Are these credentials still comfortably usable? */
export function turnCredentialsFresh(
  credentials: TurnCredentials,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return credentials.expiresAt - nowEpochSeconds > 30;
}
