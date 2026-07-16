# NightWatch Phase 29 — Authorized Media Library Backend and Platform Handoff

Last updated: 2026-07-16.

## Ownership and delivery rule

Claude owns the backend/platform branch:

```text
backend/phase-29-media-library
```

This branch may change shared TypeScript contracts, Electron main/preload code, platform bridges, Supabase migrations/RLS/RPC tests, and device-local persistence. It must not redesign React screens or edit shared visual CSS. Codex owns the Library and player UI after the typed contracts merge.

Phase 29 is separately gated from the Phase 28 UI release. All new capabilities default to unavailable until the matching platform implementation, security tests, packaged tests, and owner review are complete.

## Non-negotiable boundaries

NightWatch synchronizes playback state only. Every participant obtains the selected media directly from a file they control or from Google Drive using their own authorization.

Phase 29 must never:

- Download, cache, proxy, restream, or replace YouTube media. YouTube remains on the official iframe.
- Extract media from Amazon Prime Video, Netflix, Disney+, Crunchyroll, Max, Hulu, or any other protected service.
- Bypass DRM, copy restrictions, authentication, regional restrictions, advertisements, or provider controls.
- Download from arbitrary websites, scrape streaming catalogs, accept pasted download-site URLs, or provide a general URL downloader.
- Upload pirated media or create a NightWatch-hosted movie/episode catalog.
- Relay media bytes from the host through Supabase, an Edge Function, NightWatch servers, Realtime, WebRTC, or another participant.
- Claim that Google Drive or any cloud provider offers free or unlimited storage, bandwidth, or availability.
- Store local paths, OAuth refresh tokens, access tokens, Picker tokens, or protocol lease URLs in Supabase, room events, analytics, logs, crash reports, or browser storage.

Only user-owned or otherwise authorized local files and files each participant is independently permitted to access in Google Drive are supported.

## Delivery sequence

Claude must implement in this order:

1. Shared source, capability, result, and playback adapter contracts with unit tests.
2. Electron IPC surface, native local-file selection, streaming SHA-256 fingerprints, opaque playback leases, and local range streaming.
3. Google OAuth system-browser PKCE, OS-backed refresh-token storage, isolated Google Picker, Drive metadata validation, and Drive range streaming.
4. Versioned custom-media room events, participant readiness/matching, and old-client compatibility behavior.
5. Owner-private Library metadata migration/RLS/RPCs.
6. Packaged Electron and two-client tests with all capability flags still disabled by default.

Do not start Drive authorization or room synchronization before the contract and local-file security tests are green.

## Shared typed contracts

Place the source-neutral contracts in a shared module that can be imported by Electron main, preload, renderer, and tests without importing Electron or DOM globals.

```ts
export type MediaProtocolVersion = 1;

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
      fingerprint: `sha256:${string}`;
      title: string;
      mimeType: SupportedHtmlMediaMime;
      size: number;
    }
  | {
      schemaVersion: 1;
      kind: 'local';
      fingerprint: `sha256:${string}`;
      title: string;
      mimeType: SupportedHtmlMediaMime;
      size: number;
    };

export type SupportedHtmlMediaMime =
  | 'video/mp4'
  | 'video/webm';

export type MediaCapabilityReason =
  | 'available'
  | 'unsupported-platform'
  | 'not-configured'
  | 'security-review-required'
  | 'deployment-required'
  | 'disabled-by-owner';

export interface MediaCapabilities {
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
```

Validation rules:

- `schemaVersion` must equal `1`; reject unknown versions without coercion.
- YouTube IDs retain the existing strict 11-character validation and existing event path.
- `fileId`, title, MIME type, fingerprint, and size are validated at every IPC and room boundary.
- `fingerprint` is lowercase `sha256:` plus exactly 64 hexadecimal characters.
- `title` is trimmed plain text, 1–300 characters, and never treated as HTML.
- `size` is a safe positive integer. Enforce a configurable packaged-app maximum; do not silently truncate.
- First release supports MP4 H.264/AAC and WebM VP8/VP9/Opus only. MIME acceptance is necessary but not sufficient; the renderer must also pass `HTMLMediaElement.canPlayType`.
- Google Workspace editor documents, shortcuts, folders, encrypted/DRM media, and unsupported codecs are rejected.

Use one explicit result shape across bridge operations:

```ts
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
  message: string;
  retryable: boolean;
}
```

Never return raw provider responses, file-system errors, stack traces, token values, absolute paths, or protocol lease identifiers inside error messages.

## Playback abstraction

Introduce a source-neutral adapter without changing current YouTube behavior:

```ts
export interface PlaybackSnapshotV1 {
  protocolVersion: 1;
  sessionId: string;
  sourceKey: string;
  positionSeconds: number;
  durationSeconds: number | null;
  paused: boolean;
  playbackRate: number;
  hostClockMs: number;
  revision: number;
}

export type PlaybackAdapterEvent =
  | { type: 'ready'; durationSeconds: number | null }
  | { type: 'state'; snapshot: PlaybackSnapshotV1 }
  | { type: 'buffering' }
  | { type: 'ended' }
  | { type: 'error'; error: MediaFailure };

export interface PlaybackAdapter {
  readonly kind: MediaSourceDescriptor['kind'];
  load(source: MediaSourceDescriptor): Promise<MediaResult<void>>;
  play(): Promise<MediaResult<void>>;
  pause(): Promise<MediaResult<void>>;
  seek(positionSeconds: number): Promise<MediaResult<void>>;
  setVolume(volumePercent: number): void;
  getSnapshot(): PlaybackSnapshotV1 | null;
  subscribe(listener: (event: PlaybackAdapterEvent) => void): () => void;
  destroy(): void;
}
```

Implementation rules:

- `YouTubeAdapter` wraps the existing official iframe and existing `YouTubePlayer`; do not alter YouTube branding, controls, ads, or the existing `playback:*` event meanings.
- `HtmlMediaAdapter` owns an ordinary `<video>` element for authorized local/Drive media.
- Renderer code receives only an opaque `nightwatch-media://stream/{leaseId}` playback URL for HTML media. It never receives an absolute path or OAuth token.
- Adapter destruction must abort pending work, revoke the lease, detach listeners, and stop media.

## Electron platform bridge and IPC

Extend `PlatformBridge` with a nullable source-neutral media surface so Discord Activity and plain web builds remain explicit no-op implementations:

```ts
export interface MediaPlatformBridge {
  getCapabilities(): Promise<MediaCapabilities>;
  pickLocalFile(): Promise<MediaResult<SelectedMedia>>;
  resolveLocalMatch(
    descriptor: Extract<MediaSourceDescriptor, { kind: 'local' }>,
  ): Promise<MediaResult<SelectedMedia>>;
  getDriveConnection(): Promise<DriveConnectionState>;
  connectDrive(): Promise<MediaResult<DriveConnectionState>>;
  pickDriveFile(): Promise<MediaResult<SelectedMedia>>;
  disconnectDrive(): Promise<MediaResult<void>>;
  createPlaybackLease(
    descriptor: Exclude<MediaSourceDescriptor, { kind: 'youtube' }>,
  ): Promise<MediaResult<PlaybackLease>>;
  releasePlaybackLease(leaseId: string): Promise<void>;
}

export interface SelectedMedia {
  descriptor: Exclude<MediaSourceDescriptor, { kind: 'youtube' }>;
  localHandle: string;
}

export interface PlaybackLease {
  leaseId: string;
  playbackUrl: string;
  expiresAt: number;
}
```

`localHandle` is a random device-local opaque identifier. It is not a path and is never broadcast. `PlaybackLease.playbackUrl` is renderer-local and must not enter application state that is persisted or synchronized.

IPC requirements:

- Define one named, typed channel per operation in `shared/ipc.ts`; never expose generic `send`, `invoke`, `ipcRenderer`, file-system access, or arbitrary URLs through preload.
- Validate the IPC sender against the expected NightWatch renderer and validate every argument again in the main process.
- Make cancellation an ordinary `MediaResult` rather than an exception.
- Expose progress/cancellation for fingerprinting through a narrowly scoped subscription identified by an opaque operation ID.
- Abort and clean up operations when the owning window is destroyed.
- Return safe, serializable plain objects only.
- Discord and web bridges return `unsupported-platform`; Phase 29 remains Electron-only initially.

## Local-file selection, fingerprinting, and mapping

Use Electron's native `dialog.showOpenDialog` in the main process with `openFile` and filters for `mp4` and `webm`. Do not accept directories or wildcard URLs.

For each explicit selection:

1. Resolve and validate the selected absolute path in the main process.
2. Open the file without executing it.
3. Read metadata and reject zero-byte, changed, inaccessible, unsupported, or over-limit files.
4. Compute SHA-256 using a streaming Node hash/read stream. Never load the whole file into memory.
5. Report bounded progress and support cancellation.
6. Return only the normalized descriptor and opaque local handle.

Persist device-local mappings outside Supabase:

```ts
interface LocalMediaMapping {
  localHandle: string;
  fingerprint: `sha256:${string}`;
  title: string;
  mimeType: SupportedHtmlMediaMime;
  size: number;
  modifiedAtMs: number;
  path: string; // main-process storage only
}
```

- Store mappings under Electron `userData` with restrictive permissions where the OS supports them.
- Never copy mappings to renderer `localStorage`, cloud sync, room metadata, or logs.
- A cached fingerprint may be reused only when canonical path, size, and modification time still match. Any change requires re-hashing.
- On room join, match by fingerprint. If no valid mapping exists, prompt that participant to select their own authorized copy.
- Matching a filename or size alone is never sufficient.

## Google Drive authorization and Picker

Use Google's installed desktop application flow:

- Open the generated Google authorization URL in the system browser.
- Use PKCE S256 with a fresh 43–128 character verifier, a cryptographically random `state`, and one outstanding authorization operation at a time.
- Receive the response on a random `127.0.0.1` loopback port. Do not use out-of-band copy/paste. Close the listener on success, denial, timeout, or app exit.
- Allowlist the authorization and token hosts; never pass an untrusted URL to `shell.openExternal`.
- Request only `https://www.googleapis.com/auth/drive.file`.
- Request offline access only when establishing the stored connection. Do not repeatedly force the consent prompt.
- Use a Desktop OAuth client ID. A client secret is not confidential in a desktop binary and must not be treated as a server secret.

Google recommends `drive.file` with Google Picker for per-file access. References:

- [OAuth 2.0 for desktop apps and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Choose Google Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker](https://developers.google.com/workspace/drive/api/guides/picker)

Picker isolation:

- OAuth occurs in the system browser. The Picker itself may run in a dedicated sandboxed, non-persistent Electron window containing only the packaged Picker page and Google's required HTTPS scripts.
- Use `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, a minimal purpose-built preload, strict navigation/window-open denial, and a restrictive session permission handler.
- Expose only a short-lived access token to this isolated Picker window. Refresh tokens never leave the main process.
- Destroy the Picker window and its non-persistent partition immediately after select/cancel/failure.
- Return only validated selected file IDs to the main process. The main process re-fetches and validates metadata; never trust Picker metadata as authoritative.

For the selected Drive blob request only:

```text
id,name,mimeType,size,sha256Checksum,capabilities(canDownload),trashed
```

- Require a binary Drive file, supported MIME, positive size, `trashed = false`, `capabilities.canDownload = true`, and a valid SHA-256 checksum.
- If Drive does not provide `sha256Checksum`, return `fingerprint-unavailable` in the first release. Do not silently substitute filename, size, MD5, or file ID.
- Each participant must authorize and access the same Drive file themselves, or select a local file with the same SHA-256 fingerprint.
- A Drive file ID is included in the room descriptor for authorized lookup but is not proof of permission; every client must call Drive using its own token.

## Token storage, refresh, and revocation

Use Electron `safeStorage` in the main process:

- Prefer the asynchronous safeStorage API where supported.
- Encrypt the refresh token before writing it beneath `userData`.
- Keep access tokens and PKCE verifier/state in memory only.
- If secure encryption is unavailable, return `token-store-unavailable`. Do not fall back to plaintext refresh-token storage.
- Never put tokens in URLs, renderer state, localStorage, Supabase, Realtime, logs, crash reports, or analytics.
- Refresh shortly before expiry, serialize concurrent refresh attempts, and replace rotated refresh tokens atomically.
- On `invalid_grant`, clear the unusable stored token and return `auth-expired`.
- `disconnectDrive` performs best-effort Google revocation, then always deletes local encrypted credentials and active Drive leases.

Reference: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Private media protocol and byte-range streaming

Register a dedicated privileged scheme before `app.ready`, for example:

```text
nightwatch-media://stream/{leaseId}
```

The scheme may be `standard`, `secure`, and `stream`, but must not use `bypassCSP`. Add only the narrow `media-src nightwatch-media:` CSP allowance required by the packaged renderer.

Lease requirements:

- Generate at least 128 bits of cryptographically random entropy.
- Bind the lease to one normalized source, the current app session, and a short expiry.
- Keep lease records in main-process memory. A persisted library record is not a playback lease.
- Accept only `GET` and `HEAD`.
- Reject malformed paths, unknown/expired leases, unexpected query parameters, invalid ranges, unsupported origins, and changed local files.
- Do not log lease IDs or full protocol URLs.
- Release leases on adapter destroy, sign-out, window destruction, or app exit.

Local streaming:

- Parse a single RFC byte range and return `206`, `Content-Range`, `Accept-Ranges: bytes`, `Content-Length`, and the validated MIME type.
- Return `416` for unsatisfiable or multiple ranges.
- Use a bounded file stream for the requested range; never buffer the complete video.
- Revalidate mapping metadata before opening the stream.

Drive streaming:

- Call `files.get?alt=media` from the main process with that participant's current access token.
- Forward the requested single `Range` header and stream the Drive response body without buffering it in full.
- Pass through only the necessary safe response headers and normalized `200`, `206`, or `416` behavior.
- Re-check `capabilities.canDownload` before the first lease and after permission-related failures.
- Map provider `401`, `403`, `404`, `429`, quota, offline, and revoked-access responses to typed errors.

Google Drive supports `alt=media` and byte ranges; it also requires respecting `capabilities.canDownload`. Reference: [Drive downloads and byte ranges](https://developers.google.com/workspace/drive/api/guides/manage-downloads).

Electron security references:

- [Custom protocol handling](https://www.electronjs.org/docs/latest/api/protocol)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)

## Versioned room synchronization

Do not change the payload or meaning of existing:

```text
playback:load
playback:play
playback:pause
sync:request
sync:state
```

Those remain YouTube-only for backward compatibility.

Add a separate versioned namespace:

```ts
interface Phase29RealtimeEvents {
  'media:v1:load': {
    sessionId: string;
    source: Exclude<MediaSourceDescriptor, { kind: 'youtube' }>;
    revision: number;
  };
  'media:v1:ready': {
    sessionId: string;
    sourceKey: string;
    ready: boolean;
    outcome:
      | 'ready'
      | 'missing-source'
      | 'permission-required'
      | 'unsupported-format'
      | 'source-mismatch'
      | 'incompatible-client';
  };
  'media:v1:play': PlaybackSnapshotV1;
  'media:v1:pause': PlaybackSnapshotV1;
  'media:v1:seek': PlaybackSnapshotV1;
  'media:v1:snapshot': PlaybackSnapshotV1;
  'media:v1:request-snapshot': {
    sessionId: string;
  };
  'media:v1:unload': {
    sessionId: string;
    revision: number;
  };
}
```

Rules:

- `sourceKey` is a deterministic hash of the normalized public descriptor, never a path, token, or lease.
- Only the host can publish load/play/pause/seek/snapshot/unload.
- Readiness is participant-specific and contains no local path, token, or provider error detail.
- Receivers ignore stale revisions, wrong session IDs, non-host authoritative events, non-finite times, or unsupported protocol versions.
- Drift correction follows the existing SyncEngine thresholds but operates through the selected adapter.
- A custom-media session does not begin until all current participants advertise protocol version 1 and report ready, unless the host explicitly removes/notifies unsupported participants through existing room controls.
- Late joiners remain paused locally until they match/authorize the source and receive a fresh host snapshot.
- New clients show `incompatible-client` for unsupported descriptors/versions. Existing clients never misread custom media as YouTube because no custom descriptor is sent through `playback:load`.
- Discord Activity advertises no custom-media protocol versions and remains YouTube-only.

## Owner-private Library persistence

Add cloud metadata only after local and Drive playback contracts are stable:

```sql
media_library_items
  id uuid primary key
  owner_id uuid not null
  source_kind text check in ('youtube', 'drive')
  source_id text not null
  fingerprint text null
  title text not null
  artwork_url text null
  mime_type text null
  size_bytes bigint null
  duration_seconds numeric null
  progress_seconds numeric not null default 0
  status text check in ('saved', 'watch-later', 'in-progress', 'watched')
  saved_at timestamptz not null
  last_played_at timestamptz null
  metadata_refreshed_at timestamptz null
```

Requirements:

- Owner-only select/insert/update/delete RLS with `auth.uid() = owner_id`.
- Unique owner/source-kind/source-ID constraint.
- Local sources and local paths never enter this table.
- Tokens and protocol lease data never enter this table.
- Validate all writes through typed services/RPCs; clamp progress to duration when duration is known.
- Provide owner export and delete operations.
- Refresh or delete stored YouTube API metadata within the policy window required at implementation time; do not store YouTube media bytes.
- Drive metadata is private and does not grant another participant access.

Capability flags remain false until the migration and RLS tests are deployed.

## Failure and recovery behavior

- File removed/renamed/changed: invalidate mapping and lease; ask only that participant to select a matching copy.
- Fingerprint mismatch: do not play and do not allow a filename-based override.
- OAuth cancelled: keep prior valid connection unchanged.
- Token revoked/expired: stop only that participant's Drive playback, clear invalid credentials when appropriate, and offer reconnect.
- Drive permission removed/download disabled: invalidate the lease and return `permission-denied` or `download-restricted`.
- Network loss/quota/rate limit: pause locally, preserve room state, expose retryable typed outcome, and never switch to host relay.
- Unsupported codec: reject before room readiness when `canPlayType` reports no support.
- Buffering: participant reports not-ready/buffering locally; host state remains authoritative.
- App restart: all leases expire. Restore library metadata and local mappings, then create new leases only after revalidation.
- App update/downgrade: unknown schema/event versions are rejected without rewriting stored records.

## Required tests

### Contract and validation

- Every valid descriptor round-trips through serialization.
- Unknown schema versions, invalid fingerprints, unsafe titles, invalid sizes/MIME types, and extra untrusted fields are rejected.
- Existing YouTube events and YouTube player tests remain unchanged.
- Discord/web capabilities stay false for local/Drive.

### Electron IPC and local files

- IPC sender and argument validation.
- Picker cancel, inaccessible file, unsupported extension/MIME/codec, zero-byte, over-limit, and changed-file outcomes.
- Streaming SHA-256 correctness, progress, cancellation, cache reuse, and invalidation.
- No path appears in renderer results, room events, logs, or snapshots.
- Lease entropy, expiry, release, app-exit cleanup, malformed URL, method rejection, `HEAD`, `200`, `206`, and `416`.
- First/middle/final byte ranges match the selected file without whole-file buffering.

### Google Drive

- PKCE verifier/challenge, random state verification, callback timeout, denial, replay, and concurrent-attempt rejection.
- Only `drive.file` is requested.
- Secure-storage unavailable, encrypt/decrypt, rotated token, refresh serialization, `invalid_grant`, disconnect, and revocation cleanup.
- Picker cancellation, forged Picker payload, wrong MIME, missing checksum, trashed file, `canDownload = false`, missing permission, quota, offline, and token expiry.
- Drive range request forwards the exact authorized range and never exposes the Authorization header.
- Tokens do not appear in renderer storage, Supabase payloads, room events, logs, protocol URLs, or crash metadata.

### Room synchronization

- Two local copies with equal fingerprints become ready and remain synchronized.
- Drive/Drive and Drive/local participants with the same SHA-256 source synchronize without exchanging bytes.
- Filename/size match with different fingerprint is rejected.
- Viewer without permission remains paused and receives a typed readiness state.
- Late join, reconnect, host migration, seek while paused, buffering, end, and unload.
- Stale revisions, forged non-host events, invalid times, wrong session IDs, and unknown protocol versions are ignored/rejected.
- An old YouTube-only client never interprets a custom descriptor as a YouTube video.

### Database

- Owner-only Library CRUD and export.
- Cross-user reads/writes/deletes fail under RLS.
- Local paths, tokens, and lease fields cannot be stored.
- Status/progress constraints and unique source behavior.

## Validation and exact handoff checklist

Claude hands the branch back only when every item below is true:

- [ ] Branch is `backend/phase-29-media-library`, rebased on current `origin/main`, with no unrelated visual changes.
- [ ] Shared contracts compile without Electron/DOM imports.
- [ ] Existing YouTube contracts, events, iframe behavior, and tests are unchanged.
- [ ] Electron/web/Discord bridge implementations compile and return explicit capabilities.
- [ ] Local picker, streaming SHA-256, device-only mapping, opaque leases, and range protocol are implemented and tested.
- [ ] System-browser PKCE uses a loopback redirect and requests only `drive.file`.
- [ ] Refresh tokens use async OS-backed `safeStorage`; no plaintext fallback exists.
- [ ] Picker is sandboxed/non-persistent; Drive metadata is revalidated in main.
- [ ] Drive streaming uses each participant's token and forwards byte ranges without whole-file buffering.
- [ ] No path, token, credential, media byte, or lease URL enters Supabase or Realtime.
- [ ] Versioned `media:v1:*` events are host-authoritative and do not alter legacy events.
- [ ] Capability flags default off until migration/deployment and packaged approval.
- [ ] Migration and RLS tests pass against a disposable Supabase database.
- [ ] `npm ci` succeeds.
- [ ] `npm run typecheck` succeeds.
- [ ] `npm test` succeeds with all new and existing tests.
- [ ] `npm run build:activity` succeeds and exposes no local/Drive controls.
- [ ] `npm run build -- --publish never` succeeds.
- [ ] Windows packaged Electron test covers local playback, Drive connect/pick/play/disconnect, range seeking, app restart, and revoked access.
- [ ] Two packaged clients pass local/local, Drive/Drive, and Drive/local fingerprint-matched synchronization.
- [ ] `STATUS.md`, `TASKS.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `CHANGELOG.md` describe the delivered contracts and remaining owner deployment steps.
- [ ] Handoff includes the commit SHA, PR URL, migration filenames, new environment/config keys, Google Cloud setup steps, test output summary, and any capability flags still disabled.

## Merge and rollout order

1. Review the shared contracts and threat model before enabling implementation-dependent UI.
2. Merge Claude's green backend/platform PR.
3. Rebase Codex's Phase 29 frontend branch onto the merged contracts.
4. Deploy the Library migration/RLS, if included, while all new capability flags remain disabled.
5. Configure the production Desktop OAuth client, consent screen, Picker API key/application ID, and allowed origins without committing credentials.
6. Run packaged owner acceptance with two independently authorized accounts/files.
7. Enable local files first.
8. Enable Google Drive only after OAuth verification/configuration and revocation/range tests pass.
9. Keep Discord Activity and browser builds YouTube-only.
10. Trigger a manual Release workflow only after updater round-trip and packaged acceptance.

No direct push to `main`, no automatic release on merge, and no enabling Drive merely because TypeScript builds.
