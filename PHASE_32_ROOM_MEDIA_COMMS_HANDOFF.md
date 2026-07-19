# Phase 32 — Room Media, Friend Discovery, Screen Share, and Voice Handoff

## Scope

This phase supplies backend/platform capabilities for NightWatch's existing frontend. It must not redesign React components or edit shared visual CSS. All new UI remains capability-gated until the corresponding contract is deployed and verified.

## 1. Versioned room media modes

Add a backward-compatible room media descriptor with three explicit modes:

- `youtube`: existing official YouTube IFrame flow and events remain unchanged.
- `file-watch`: a host selects an authorized local or Google Drive file. Supabase carries only metadata, readiness, and playback state—never file bytes, local paths, OAuth tokens, or Drive URLs containing credentials.
- `live-share`: an ephemeral WebRTC desktop/window stream. It is distinct from synchronized file playback.

For `file-watch`, publish a versioned descriptor containing source kind, stable fingerprint, title, MIME type, size, duration when available, and an opaque Drive file ID only for authorized participants. Every participant independently proves access or matches a local fingerprint. The host may start when the room policy's readiness condition is met. Old clients must reject unsupported descriptors clearly.

Add typed outcomes for `ready`, `missing-file`, `permission-required`, `fingerprint-mismatch`, `unsupported-codec`, `buffering`, `offline`, and `rate-limited`. Preserve all existing YouTube room events.

## 2. Google Drive workspace

Keep OAuth tokens in Electron `safeStorage`. Keep the narrow `drive.file` scope and system-browser PKCE flow.

- Create or reuse an app-created `NightWatch Shared` folder tagged with an app property.
- Return a safe folder ID, display name, and Google Drive web link.
- Let the host choose a file through Picker, then share the folder/file using Google's permission UI or a narrowly scoped Drive permission flow.
- Each viewer signs in with their own Google account and independently obtains permission to the same file.
- Provide capability/status methods for connected, consent-required, permission-required, revoked, and offline states.
- Do not relay or cache media in Supabase, and do not promise that one host upload automatically grants access to viewers.

Add range-stream and token-refresh tests, including revoked access, disabled downloads, expired tokens, file mismatch, and multiple viewers with different permission states.

## 3. Privacy-safe people discovery

Add a rate-limited RPC for finding NightWatch users by an explicit public handle or exact/prefix display-name search:

- Minimum three normalized characters, maximum ten results.
- Exclude the caller, blocked users, and users who opted out of discovery.
- Return only public profile fields, relationship state, validated border, and safe avatar URL.
- Prefer introducing a unique, case-insensitive public handle to avoid ambiguous Discord display names.

Add a room-people RPC that maps current authenticated room members to public profiles and relationship states. It enables Add Friend, Message, Invite, and Block actions directly from the room without exposing private room codes or Discord friend lists.

Group creation continues to accept only accepted friends, with a hard limit of 30 total members. Existing message membership RLS and block rules remain mandatory.

## 4. Screen/window sharing and voice chat

Use WebRTC for media. Supabase Realtime may carry short-lived signaling messages, but never media bytes.

- Electron desktop-capture source selection for screen/window sharing.
- Explicit host start/stop and viewer consent/status states.
- Voice input constraints: `echoCancellation`, `noiseSuppression`, and `autoGainControl` where supported.
- Per-user mute, deafen, speaking state, device loss, permission denial, and reconnect handling.
- Ephemeral SDP/ICE exchange scoped to room membership, with expiry and RLS.
- Short-lived TURN credentials from a server-side function; no permanent TURN secret in the client.
- Use an SFU for rooms beyond a small peer-to-peer limit; document the chosen provider and operating cost before enabling public rooms.
- No recording by default. Display capture/microphone indicators and stop controls at all times.

Add abuse limits, block enforcement, host moderation, secure-context checks, Electron permission handling, and teardown on leave/sign-out/window close.

## 5. Typed capability contract

Expose capability flags and typed services before frontend enablement:

```ts
interface RoomMediaCapabilities {
  fileWatch: boolean;
  driveWorkspace: boolean;
  liveShare: boolean;
  voiceChat: boolean;
  publicUserSearch: boolean;
  roomPeopleActions: boolean;
}
```

Every operation returns an explicit success or one of: `unauthorized`, `forbidden`, `blocked`, `not-supported`, `permission-required`, `rate-limited`, `offline`, or `server-error`.

## Acceptance

- Migration/RLS tests cover membership, blocks, opt-out, stale signaling, and cross-room access.
- Two-client tests cover Drive permission mismatch, local fingerprint matching, host migration, reconnect, and drift.
- Screen/voice tests cover denied permissions, mute/deafen, device removal, TURN failure, stop sharing, and leave cleanup.
- No new capability is enabled until deployed migrations/functions and packaged Electron verification pass.
- Run strict typecheck, tests, Activity build, and Electron build with `--publish never` before handoff.

## 6. Live frontend integration contract — Codex coordination addendum

The frontend acceptance lane is active at:

`C:\Users\Blast\source\repos\NightWatch-acceptance`

Do not edit that worktree. Implement the backend contracts in this Fable worktree and document the exact frontend integration surface in `PHASE_32_IMPLEMENTATION_REPORT.md`.

The frontend needs these deployable, typed operations before controls are enabled:

- `searchPeople(query)` returning a maximum of ten discoverable profiles with `userId`, `publicHandle`, `displayName`, safe `avatarUrl`, server-validated `selectedBorderId`, presence-sharing state, and explicit relationship state.
- `getRoomPeople(roomCode)` returning authenticated current members with public identity, role, presence, and relationship state. It must support Add Friend, Message, Invite, and Block decisions without leaking room codes through reverse discovery.
- `getFriendActivity()` returning accepted-friend activity categorized as `online`, `watching`, `in_party`, or `offline`, with video title/ID only when consent permits it.
- `getRoomMediaCapabilities()` returning all six flags in `RoomMediaCapabilities`; every flag defaults to `false` until its migration/function/platform support is deployed and verified.
- `publishRoomMediaDescriptor`, `getRoomMediaDescriptor`, `reportMediaReadiness`, and `getMediaReadinessRoster` for versioned `youtube`, `file-watch`, and `live-share` modes.
- Drive workspace status and per-viewer file readiness that never exposes access tokens, refresh tokens, local paths, authenticated download URLs, or media bytes.
- WebRTC signaling/TURN methods with explicit permission, device, disconnected, expired, rate-limited, and unsupported results.

Frontend behavior depends on the following rules:

- YouTube Watch retains the existing official IFrame contracts unchanged.
- Movie Watch hides the YouTube queue/link controls and shows only file readiness, synchronized media controls, chat, people, reactions, and timestamp notes.
- Live Share and Voice Chat remain hidden while their capability flags are false.
- The friend activity rail must receive offline friends as well as online/watching friends; presence opt-out must appear as unavailable rather than inferred activity.
- Global user search must be server-side and privacy-safe. The existing frontend list filter is not a substitute.
- Room-member actions require authenticated profile IDs from the server; the frontend must not guess an auth user ID from a display name or Discord ID.

### Migration immutability requirement

Existing numbered migrations are already deployed history and must not receive Phase 32 schema changes. Move every Phase 32 schema/RPC/RLS change into a new additive migration such as:

`supabase/migrations/0026_room_media_comms.sql`

One narrowly scoped exception is approved: the committed `supabase/migrations/0004_gamification.sql` contains the invalid accidental text `default now()ive ran`. Correcting that exact line to `default now()` is a source-integrity repair required for clean database setup. Do not make any other semantic change to migrations `0001`–`0025`. Document this repair separately from Phase 32 schema work. If any other earlier migration was changed during implementation, restore it to the committed version and reproduce the intended change additively in `0026`. Codex will verify this before commit.

### Mandatory owner deployment notice

Before handoff, `PHASE_32_IMPLEMENTATION_REPORT.md` must contain an `OWNER ACTION REQUIRED` section that answers each item explicitly:

1. `SQL deployment required: YES/NO`.
2. Exact new migration filenames, in execution order.
3. Whether each migration is safe to paste into the Supabase SQL Editor.
4. Expected success output and verification queries.
5. Edge Functions requiring deployment and their exact deployment commands.
6. Secrets/environment variables that must be configured first, using names only—never secret values.
7. Google Cloud, TURN, WebRTC, or Supabase dashboard configuration the owner must perform.
8. Capability flags that must remain false until deployment is confirmed.
9. Rollback or disable procedure if verification fails.

Claude must proactively tell the owner when SQL deployment is required. Do not describe a migration as live merely because the SQL file exists locally. Do not ask the owner to deploy any SQL until Codex has reviewed the diff and migration tests.
