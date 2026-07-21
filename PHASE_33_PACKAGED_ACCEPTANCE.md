# Phase 33 — Packaged Two-Client Acceptance Checklist

Run against **two packaged Windows builds on different machines and, for the
relay tests, different networks** (one on mobile hotspot/VPN is enough to
force a TURN path). Nothing in Phase 32/33 may be declared complete on the
strength of passing tests alone — this checklist is the completion gate.

Record: build version, date, both network types, and pass/fail per row.

## Preconditions

- [ ] Migrations `0001`–`0027` deployed; `phase32_rls_test.sql` passes on a
      disposable database.
- [ ] `turn-credentials` deployed with **Verify JWT ON** and either the
      Cloudflare pair (`CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`)
      or the coturn pair (`TURN_SHARED_SECRET`, `TURN_URLS`).
- [ ] `getTurnDiagnostics()` reports `configured: true` and the expected
      provider on both clients.
- [ ] Both Google accounts are OAuth test users (until verification).

## A. YouTube regression (must never break)

- [ ] Create room, join by code, load video, play/pause/seek mirror.
- [ ] Queue add/vote/reorder; auto-advance on end; host "Play next".
- [ ] Host migration (close host) — new host controls playback.
- [ ] Reconnect after network drop; drift correction settles without seek-thrash.
- [ ] Chat, reactions, timeline markers, moment notes.
- [ ] An **older client** (pre-Phase-32 build, if available) still joins and
      plays a YouTube room unchanged.

## B. Room media modes

- [ ] Publish a `file-watch` descriptor; both clients read the same revision.
- [ ] Concurrent publish → revision conflict surfaces and recovers.
- [ ] Controller/host migration republishes; viewers follow.
- [ ] A forged/unknown `modeVersion` is rejected with an update prompt.

## C. File watch (local)

- [ ] Viewer with the same file (same hash) → `ready`, playback syncs.
- [ ] Viewer with a same-name different file → `fingerprint-mismatch`.
- [ ] Viewer with no copy → `missing-file` with the "select your own copy" path.
- [ ] Unsupported container/codec → `unsupported-codec` (no permission chase).
- [ ] Start policies: `host-only`, `all-ready`, `majority-ready` each gate the
      host Start control correctly.
- [ ] Drift correction and pause/seek mirror across both clients.

## D. Google Drive shared viewing

- [ ] Host: connect Drive → workspace folder created/reused (app property).
- [ ] Host adds an MP4/WebM in Drive; opens Google sharing controls.
- [ ] Viewer BEFORE being granted access → `permission-required`; after being
      granted and retrying → `ready`.
- [ ] Range playback works on both clients (seek mid-file).
- [ ] Token refresh mid-session (leave running past expiry) — playback survives.
- [ ] Revoke access mid-session → viewer degrades to `permission-required`,
      no crash, no silent re-grant.
- [ ] Download-disabled file → `permission-required`, never "ready".
- [ ] Offline client → `offline`; recovers on reconnect.

## E. Voice

- [ ] Permission denied → typed `permission-required`, no dead UI.
- [ ] Two clients connect; audio both ways; speaking indicator tracks speech.
- [ ] Mute, unmute, deafen (implies mute), undeafen — reflected on both sides.
- [ ] Unplug/disable the microphone mid-call → `device-lost`, session ends cleanly.
- [ ] Network drop → `reconnecting` → recovers, or ends with a reason.
- [ ] **Cross-network call succeeds via TURN relay** (this is the relay proof).
- [ ] Leaving the room ends the call and releases the mic on both clients.
- [ ] Microphone indicator with a stop control is visible for the whole call.

## F. Screen / window share

- [ ] Source list shows screens and windows with thumbnails.
- [ ] Cancelling the picker leaves no capture running.
- [ ] Sharing starts only after an explicit in-app pick (single-use, 30 s).
- [ ] Viewer sees the stream after an explicit click (consent).
- [ ] Closing the captured window → `source-closed`; capture stops.
- [ ] "Stop sharing" (in-app and OS-level) both end the share everywhere.
- [ ] 8th viewer is refused with a "share is full" state.
- [ ] Sharing indicator with a stop control is visible for the whole share.
- [ ] Cross-network share succeeds via relay.

## G. People, privacy, blocks

- [ ] Handle creation (unique, lowercase grammar) and rejection of duplicates.
- [ ] Discoverability defaults OFF; opting in makes the user findable.
- [ ] Search: <3 chars returns nothing; opted-out users never appear; caller
      never appears; results cap at 10.
- [ ] Room people lists members with correct relationship states; a non-member
      cannot enumerate the room.
- [ ] Friend request → accept/decline/remove; direct message; 2–30-person group.
- [ ] Block: blocked users cannot discover, invite, message, signal, see
      presence, or read friends-only notes — in **both** directions.
- [ ] Presence exposes only consented status/avatar/border (+ optional safe
      video id) and **never a room code**.

## H. Lifecycle and cleanup

- [ ] Room leave: voice + share both stop.
- [ ] Sign-out: voice + share both stop.
- [ ] Window close / `pagehide`: capture and mic released (verify the OS
      indicator disappears).
- [ ] Host migration: share stops, **voice continues**.

## I. Compliance sweep

- [ ] No interactive UI is rendered over the official YouTube iframe.
- [ ] No recording control exists anywhere.
- [ ] Supabase carries no media bytes, Drive tokens, file paths, or raw room
      codes (spot-check the network tab and the `rtc_signals` table).

## Automated gates (must be green in the same session)

```powershell
npm ci
npm run typecheck
npm test
npm run build:activity
npm run build -- --publish never
```

## Sign-off

Only after A–I pass on packaged builds may these flags be enabled:
`fileWatch`, `driveWorkspace`, `voiceChat`, `liveShare`. Rooms remain capped
at 8 peers until an SFU is chosen and costed.
