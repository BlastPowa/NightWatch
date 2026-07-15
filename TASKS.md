# NightWatch development tasks

Last updated: 2026-07-15 during Phases 25-28 integration.

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
- [x] Run clean install, strict typecheck, 55 tests, Activity build, Electron build, and Windows packaging.
- [ ] Owner: run packaged two-client, real Discord Activity, and updater round-trip acceptance.
- [x] Update active documentation; publish only after the remaining owner acceptance.
- [ ] Plan the breaking Electron/Vite/Discord Activity SDK security upgrades as a separate platform PR; do not force them into this UI release.

## Phase 29 — separately gated media library

- [ ] Add source-neutral playback descriptors/adapters without changing YouTube behavior.
- [ ] Add owner-private Library metadata and device-local file mappings.
- [ ] Add Electron-only Google Drive Picker/PKCE/safeStorage/range playback after security review.
- [ ] Never download YouTube, bypass DRM, scrape catalogs, or relay participant media bytes.
