# NightWatch development tasks

Last updated: 2026-07-16 for the v0.1.23 release.

## Phase 29 backend lane (`backend/phase-29-media-library`)

Delivery order is fixed by `PHASE_29_MEDIA_LIBRARY_HANDOFF.md`. Steps 1, 2, and 5
are done; step 3 (Drive) does not begin until steps 1–2 are reviewed.

- [x] Step 1 — shared source/capability/result contracts + unit tests (`shared/media.ts`, 33 tests).
- [x] Step 1 — playback adapter + `media:v1:*` event contracts and validators (`shared/mediaPlayback.ts`, 23 tests).
- [x] Step 2 — typed IPC surface, sender/argument validation, no generic invoke in preload.
- [x] Step 2 — native local-file selection, streaming SHA-256 with progress/cancellation, device-local mapping store (22 tests).
- [x] Step 2 — opaque 128-bit leases and `nightwatch-media://` single-range `206`/`416` streaming (45 tests).
- [x] Step 2 — `PlatformBridge.media`; Discord/web `null` and YouTube-only.
- [x] Step 5 — migration `0022` (owner-private Library, forced RLS, typed RPCs) + `phase29_media_library_test.sql`.
- [x] Repair `main`: add the React Testing Library / user-event / jsdom dev dependencies Phase 28 documented but never added, without which typecheck and tests both failed.
- [x] Owner: run `phase29_media_library_test.sql` and deploy `0022`; both were
  reported successful. Keep capability flags off until UI/package acceptance.
- [x] Review the contracts and threat model before enabling Phase 29 UI.
- [x] Run `npm run build -- --publish never`; installer and blockmap package successfully.
- [x] Merge the reviewed Phase 29 backend/platform branch through PR #39.
- [ ] Owner: packaged Windows acceptance for local playback, range seeking, and app restart.
- [ ] In progress on `backend/phase-29-drive` — step 3: Google Drive system-browser
  PKCE, `safeStorage` refresh tokens, sandboxed Picker, and Drive range streaming.
- [ ] Next branch — step 4: register `media:v1:*` on the room channel and wire the SyncEngine through the adapter.
- [ ] Enable local files first; enable Drive only after OAuth verification and revocation/range tests pass.

## Phase 24 backend lane (`backend/phase-24-ui-support`)

- [x] `sanitizeAvatarUrl` + additive `avatarUrl` on `PresenceMeta`/`RoomMember`; validate on derive, publish validated avatar; carry Discord avatar into presence.
- [x] Migration `0021`: `heartbeat_media_presence`, `get_friend_presence_v2`, `presence_preferences.video_id`, `safe_avatar_url`, `is_youtube_video_id`.
- [x] `FriendMediaPresence` type + `heartbeatMedia`/`getFriendMediaPresence`; `friendMediaPresence` capability probe.
- [x] `search-youtube` `kind: "details"` + typed `getVideoDetails(videoId, callerId)`.
- [x] `sanitizeAvatarUrl` unit tests + `phase24_media_presence_test.sql` (consent, blocks, invalid ids, safe avatar/border, stale parity, old-client compat, no room code).
- [x] Merge current `main` after the Phase 24 shell/Browse PR and preserve both UI and typed backend contracts.
- [ ] Owner: run the SQL test on a disposable DB; deploy `0021` then redeploy `search-youtube`; the client capability gate enables the friend-media shelf only when ready.

## Phase 24 — shell, identity, and Browse

- [x] Create clean frontend/backend phase branches and audit the stale frontend stash.
- [x] Write `PHASE_24_UI_BACKEND_HANDOFF.md` for Claude.
- [x] Add a reusable persistent application shell and centered search across screens.
- [x] Preserve the Activity-provided Discord avatar and add canonical Activity asset resolution.
- [x] Replace result shelves with a dense 3/2/1-column media grid.
- [x] Keep history as an accessible arrow-controlled shelf with touch swiping.
- [x] Add Animation, Documentaries, Cooking, Fitness, Fashion, Podcasts, and Lifestyle queries.
- [x] Preserve stale-request protection, pagination, rate-limit/error states, channel identity, Play, and Queue.
- [x] Add collapsed rail below 900px and mobile navigation below 620px.
- [x] Verify TypeScript, 43 tests, Activity build, and responsive browser layouts.
- [x] Merge Claude's typed avatar/presence/details contracts, then rebase and enable safe dependent UI.
- [x] Run Electron/NSIS packaging and reviewed Phase 24 PR delivery.

## Phase 25 — player-first room

- [x] Build a wide official-iframe stage with trusted metadata and host controls below it.
- [x] Add a responsive Up Next, Chat, People, Moments, and Discovery dock.
- [x] Preserve queue, reactions, notes, schedules, premieres, highlights, insights, sync, and host migration contracts.
- [x] Finish one-border chat composition, real validated participant avatars, and keyboard tab navigation.
- [x] Merge the reviewed Phase 25–28 frontend tree through automated PR #36.

## Phase 26 — profiles, friends, and messaging

- [x] Build banner-led profiles with implemented-data-only tabs and server-validated cosmetics.
- [x] Restyle Friends as searchable responsive cards with explicit relationship state.
- [x] Add a capability-gated, consent-safe Friends Are Watching shelf backed by presence v2 and trusted details.
- [x] Resolve message sender avatars from authorized rosters and polish unread/system/failure/group states.

## Phase 27 — remaining screens and controls

- [x] Unify Creator Club's existing cinematic system with refreshed Parties, lobby/join, About, empty/error states, and settings previews.
- [x] Keep the dependency-free local SVG icon system; no runtime UI package was added.
- [x] Begin stylesheet separation with dedicated social and secondary-screen modules while preserving legacy class/variable contracts.

## Phase 28 — hardening and completion

- [x] Add dev-only React Testing Library, user-event, and jsdom.
- [x] Add shell, avatar, and room-dock keyboard interaction tests; verify responsive layouts and preference variants in code/browser review.
- [x] Fix the composite search focus rectangle and add the labeled theme-driven room action.
- [x] Add capability-gated Friends watching view, expanded categories, full-card hover surfaces, and delayed muted official iframe previews.
- [x] Keep the same room/player instance mounted as a responsive mini-player across non-room screens.
- [x] Add official YouTube caption preference/language/font-size support without scraping or generated subtitles.
- [x] Add Browsing settings, six atmospheres, seven backdrops, four card styles, seven local font profiles, animated secondary colours, rounded scrollbars, and content-only Settings scrolling.
- [x] Run clean install, strict typecheck, 62 tests, Activity build, Electron build, and Windows packaging.
- [ ] Owner: run packaged two-client, real Discord Activity, and updater round-trip acceptance.
- [ ] Owner: confirm real caption-track behavior and mini-player continuity with host/viewer clients.
- [x] Update active documentation; publish only after the remaining owner acceptance.
- [ ] Plan the breaking Electron/Vite/Discord Activity SDK security upgrades as a separate platform PR; do not force them into this UI release.
- [x] Merge the reviewed `frontend/phase-28-control-polish` PR #38; no direct push to `main`.

## Phase 29 — separately gated media library

- [x] Write `PHASE_29_MEDIA_LIBRARY_HANDOFF.md` for Claude on `backend/phase-29-media-library`.
- [x] Add source-neutral playback descriptors/adapters without changing YouTube behavior.
- [x] Add owner-private Library metadata and device-local file mappings.
- [ ] Add Electron-only Google Drive Picker/PKCE/safeStorage/range playback after security review.
- [ ] Never download YouTube, bypass DRM, scrape catalogs, or relay participant media bytes.
