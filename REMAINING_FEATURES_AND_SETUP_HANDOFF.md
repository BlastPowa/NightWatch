# NightWatch — Remaining Features and Setup Handoff

Updated: 2026-07-20  
Repository: `C:\Users\Blast\source\repos\NightWatch-fable`  
Baseline: `main` at `v0.1.26`; Phase 32 merged through PRs #51 and #52.

## Instructions for Claude/Fable

Read these files before changing anything:

1. `AGENTS.md` and `CLAUDE.md` if present.
2. `STATUS.md`, `TASKS.md`, `ROADMAP.md`, and `CHANGELOG.md`.
3. `PHASE_32_IMPLEMENTATION_REPORT.md`.
4. `PHASE_32_ROOM_MEDIA_COMMS_HANDOFF.md`.
5. This file.

Work only in the Fable repository and use a new backend/platform feature
branch from current `origin/main`. Do not redesign React components or shared
visual CSS. Do not push directly to `main`. Report any SQL that the owner must
run, including its exact file path and expected success result.

If shell/Git access is unavailable, modify the files only and update this
handoff with an exact changed-file list. Codex will review, validate, commit,
push, open the PR, inspect Actions, and merge.

## Completed Baseline

- Migrations `0026_room_media_comms.sql` and
  `0027_fix_room_media_validator.sql` are deployed.
- `phase32_rls_test.sql` passes.
- TypeScript, 364 tests, Activity build, Electron build, Windows packaging,
  Feature PR checks, and Workers build pass.
- Room media v2, file readiness, people discovery, room-people lookup,
  room-scoped signaling, Drive workspace support, capture plumbing, TURN
  contracts, voice/share service foundations, and capability gates are merged.
- Existing YouTube room events and the official iframe boundary remain intact.

## Priority 1 — TURN and WebRTC Deployment

- Choose and document one TURN provider:
  - Preferred: Cloudflare Realtime TURN.
  - Alternative: self-hosted coturn.
- For Cloudflare, the owner must provide Edge Function secrets:
  - `CLOUDFLARE_TURN_KEY_ID`
  - `CLOUDFLARE_TURN_API_TOKEN`
- For coturn, the owner must provide:
  - `TURN_SHARED_SECRET`
  - `TURN_URLS`
- Deploy `supabase/functions/turn-credentials` with JWT verification enabled.
- Verify unauthorized users, outsiders, stale members, and rate-limited users
  cannot obtain credentials.
- Add safe diagnostics that confirm configured TURN without exposing secrets.
- Keep `voiceChat` and `liveShare` false until packaged two-client testing
  succeeds across different networks.

## Priority 2 — Phase 32 Frontend Integration Contracts

Prepare typed integration guidance and any missing non-visual services for:

- Publishing and receiving `RoomMediaMode` changes.
- Host/controller migration and revision-conflict recovery.
- File-watch readiness roster and start-policy evaluation.
- Local file and Google Drive source matching by SHA-256 fingerprint.
- Explicit missing-file, permission-required, mismatch, codec, buffering,
  offline, and rate-limit states.
- Current-room people actions: friend request, message, invite, and block.
- Voice join/leave, microphone permission, mute, deafen, speaking state,
  device loss, reconnect, and permanent active-call indicator state.
- Screen/window source selection, consent, start/stop, viewer cap, source loss,
  reconnect, and permanent sharing indicator state.
- Cleanup on room leave, sign-out, page hide, window close, and host migration.

No media bytes, Drive tokens, local paths, raw room codes, or recording data
may pass through Supabase.

## Priority 3 — Google Drive Shared Viewing Completion

- Confirm the app-created `NightWatch Shared` folder is reused safely.
- Provide a typed flow for the host to:
  1. Connect Google Drive.
  2. Open/create the NightWatch folder.
  3. Add a supported MP4/WebM file.
  4. Open Google sharing controls.
  5. Share access with each viewer.
  6. Select the file and publish its descriptor to the room.
- Every viewer must authenticate independently and prove access to the same
  Drive file. NightWatch must never grant access silently.
- Verify token refresh, revocation, consent cancellation, expired sessions,
  download-disabled files, range requests, quota errors, offline state, and
  per-viewer permission differences.
- Local-file paths stay device-only. Local copies may match Drive files only
  through fingerprint and size.

## Priority 4 — People, Friends, Messages, and Presence

- Wire public-handle creation and opt-in discoverability into account/profile
  services without changing privacy defaults.
- Ensure room members can be resolved into safe profiles and relationship
  states without leaking room codes.
- Verify friend request, accept, decline, remove, block, unblock, direct
  message, and 2–30-person group conversation flows against deployed RLS.
- Presence remains consent-based and may expose only online/watching/in-party
  status, safe avatar, validated border, and optionally safe YouTube video ID.
- Blocked users must not discover, invite, message, signal, view presence, or
  read friends-only moment notes.
- Add or extend backend diagnostics for disabled controls so the frontend can
  show an actionable reason instead of silently failing.

## Priority 5 — Local File Watch and Live Share

- Finish the source-neutral room event integration for:
  - `youtube`
  - `file-watch`
  - `live-share`
- Older clients must reject unsupported media modes clearly.
- File watch uses `HtmlMediaAdapter` and supports only validated MP4/WebM
  formats the local Chromium build can decode.
- Live share uses WebRTC only; Supabase carries signaling, never media.
- Mesh remains capped at eight total peers. Document the SFU decision point
  for larger rooms; do not claim large-room support yet.
- No recording, protected-service capture bypass, DRM circumvention, YouTube
  downloading, or NightWatch-hosted media relay.

## Priority 6 — Packaged Acceptance

Run or prepare a checklist for two packaged clients covering:

- YouTube create/join/load/play/pause/seek/queue/host migration/reconnect.
- File-watch descriptor publish, viewer matching, readiness, drift correction,
  mismatch, missing permission, and host migration.
- Drive range playback and token refresh on both clients.
- Voice permission, mute/deafen, speaking, device removal, reconnect, leave,
  and cross-network TURN relay.
- Screen/window sharing consent, source selection, stop, source closure,
  viewer limit, reconnect, and leave cleanup.
- Friends, room-member discovery, messaging, blocking, and privacy opt-out.
- No interactive UI over the official YouTube iframe.

Required automated gates:

```powershell
npm ci
npm run typecheck
npm test
npm run build:activity
npm run build -- --publish never
```

## Still Needed in the Frontend Lane

Claude should provide contracts and backend readiness only; Codex owns these
visual integrations:

- YouTube Watch / Movie Watch / Live Share room-mode selector.
- File readiness roster and permission guidance.
- Custom HTML media controls and subtitle-track UI for authorized files.
- Voice and screen-share controls with always-visible privacy indicators.
- Current-room friend/message actions and friend-activity sidebar.
- Drive workspace page, folder/share guidance, access states, and open-Drive
  actions.
- Remaining responsive layout, Settings scrolling, compact-window controls,
  movable/collapsible mini-player, icons, logo polish, and visual QA.

## External Owner Setup Still Required

- Supply TURN provider credentials and approve Edge Function deployment.
- Keep Google OAuth test users configured until public verification is done.
- Complete Google OAuth consent-screen verification before public account
  connection is advertised.
- Provide a public HTTPS home page, privacy policy, and terms page for Google
  verification (Vercel is acceptable).
- Test Drive and YouTube OAuth with a non-owner Google test account.
- Approve an SFU provider and cost model before rooms larger than eight peers.

## Completion Report Required from Claude

When finished, update this file or create a report containing:

- Branch name and base commit.
- Exact files created and modified.
- Migration order and every SQL file the owner must run.
- Edge Functions and secrets required.
- Tests executed and exact results.
- Capability flags safe to enable and flags that must remain false.
- Known limitations and security/privacy decisions.
- Exact handoff instructions for Codex.

Do not mark voice, screen sharing, or shared file playback complete merely
because contracts compile. Completion requires deployment plus packaged
two-client verification.
