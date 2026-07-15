# NightWatch development tasks

Last updated: 2026-07-15 during Phase 24 backend integration.

## Phase 24 backend lane (`backend/phase-24-ui-support`)

- [x] `sanitizeAvatarUrl` + additive `avatarUrl` on `PresenceMeta`/`RoomMember`; validate on derive, publish validated avatar; carry Discord avatar into presence.
- [x] Migration `0021`: `heartbeat_media_presence`, `get_friend_presence_v2`, `presence_preferences.video_id`, `safe_avatar_url`, `is_youtube_video_id`.
- [x] `FriendMediaPresence` type + `heartbeatMedia`/`getFriendMediaPresence`; `friendMediaPresence` capability probe.
- [x] `search-youtube` `kind: "details"` + typed `getVideoDetails(videoId, callerId)`.
- [x] `sanitizeAvatarUrl` unit tests + `phase24_media_presence_test.sql` (consent, blocks, invalid ids, safe avatar/border, stale parity, old-client compat, no room code).
- [x] Merge current `main` after the Phase 24 shell/Browse PR and preserve both UI and typed backend contracts.
- [ ] Owner: run the SQL test on a disposable DB; deploy `0021` then redeploy `search-youtube`; enable capability-gated Browse UI.

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
- [ ] Merge Claude's typed avatar/presence/details contracts, then rebase and enable safe dependent UI.
- [ ] Run Electron/NSIS packaging and reviewed Phase 24 PR delivery.

## Phase 25 — player-first room

- [ ] Build a wide official-iframe stage with metadata and host controls below it.
- [ ] Add a responsive Up Next, Chat, People, Moments, and Discovery dock.
- [ ] Preserve queue, reactions, notes, schedules, premieres, highlights, insights, sync, and host migration.
- [ ] Finish one-border chat composition and real validated participant avatars.

## Phase 26 — profiles, friends, and messaging

- [ ] Build banner-led profiles with implemented-data-only tabs and permission-gated actions.
- [ ] Restyle Friends as searchable responsive cards with explicit relationship state.
- [ ] Add the consent-safe desktop activity rail when backend presence v2 is ready.
- [ ] Resolve message sender avatars from authorized rosters and polish unread/system/failure/group states.

## Phase 27 — remaining screens and controls

- [ ] Unify Creator Club, Parties, lobby/join, About, notifications, empty/error states, and settings previews.
- [ ] Expand the local SVG icon system without runtime UI packages.
- [ ] Split global CSS by shell, discovery, room, social, and shared controls while preserving contracts.

## Phase 28 — hardening and completion

- [ ] Add dev-only React Testing Library, user-event, and jsdom.
- [ ] Complete keyboard, screen-reader, touch, contrast, text scale, reduced transparency, and reduced motion checks.
- [ ] Run Electron, Activity, Windows packaging, two-client regression, Discord Activity, and updater round-trip.
- [ ] Update all documentation and publish only after packaged acceptance.

## Phase 29 — separately gated media library

- [ ] Add source-neutral playback descriptors/adapters without changing YouTube behavior.
- [ ] Add owner-private Library metadata and device-local file mappings.
- [ ] Add Electron-only Google Drive Picker/PKCE/safeStorage/range playback after security review.
- [ ] Never download YouTube, bypass DRM, scrape catalogs, or relay participant media bytes.
