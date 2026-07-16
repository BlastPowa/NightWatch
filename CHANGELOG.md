# Changelog


## Unreleased

### Phase 29 authorized media backend contracts (branch `backend/phase-29-media-library`)

Backend/platform only. No React screens or shared CSS were touched, and every new
capability ships disabled — this branch stops at the documented capability handoff
gate so the contracts can be reviewed before any UI is enabled.

- Added source-neutral media contracts (`shared/media.ts`): `MediaSourceDescriptor`
  for YouTube/Drive/local, `MediaCapabilities` with typed reasons, `MediaResult`/
  `MediaFailure`, and a single validation chokepoint that rejects unknown schema
  versions without coercion, malformed fingerprints, unsafe titles, invalid sizes
  and MIME types, and any extra untrusted field.
- Added the playback abstraction and versioned room-event contracts
  (`shared/mediaPlayback.ts`): `PlaybackAdapter`, `PlaybackSnapshotV1`, and the
  `media:v1:*` namespace with validators. The legacy `playback:*`/`sync:*` events
  are unchanged and remain YouTube-only, so old clients can never read a custom
  descriptor as a YouTube id.
- Added the typed IPC surface: one named channel per operation, no generic
  `send`/`invoke`/`ipcRenderer` in preload, sender and argument validation in main.
- Added the Electron local-media platform: native `openFile` selection, streaming
  SHA-256 with bounded progress and cancellation, device-local handle→path mapping
  under `userData` (never in the renderer, cloud, or logs), opaque 128-bit playback
  leases, and the private `nightwatch-media://` scheme with single-range `206`/`416`
  streaming. The scheme is registered without `bypassCSP`; the renderer CSP gains
  only `media-src nightwatch-media:`.
- Added `PlatformBridge.media`, nullable. Discord Activity and the web build are
  `null` and advertise no protocol version, so they stay YouTube-only and a room
  containing one never silently starts a custom-media session without them.
- Hardened local playback leases so a same-size file replacement invalidates the
  active lease instead of serving bytes that no longer match the agreed fingerprint.
- Ensured media protocol and IPC initialization completes before the first renderer
  window opens, removing a startup race where capability calls could arrive before
  their handlers were registered.
- Added migration `0022_media_library.sql`: owner-private `media_library_items`
  with owner-only RLS on all four verbs, a unique owner/kind/source constraint,
  typed save/progress/export/delete RPCs, and progress clamped to duration. Local
  sources, paths, tokens, and leases are rejected by the schema itself.
- Fixed a real bug caught by the new capability tests: `NIGHTWATCH_MAX_MEDIA_BYTES`
  parsed `'1.5'` as `1`, which would have silently capped every file at one byte.
- Restored the dev-only React Testing Library, user-event, and jsdom dependencies
  that Phase 28 documented but never added to `package.json`. Without them
  `npm run typecheck` and `npm test` were both failing on `main`.

Google Drive is **not** implemented on this branch. Its contract surface exists and
returns typed `capability-disabled`/`not-configured` failures, and the capability
reports `security-review-required`, per the Phase 29 delivery order: Drive
authorization does not begin until the contract and local-file security tests are
green and reviewed.

### Phase 28 control, Browse, mini-player, and caption completion

- Rebuilt the composite global search focus treatment so enhanced keyboard focus appears on the rounded search shell without drawing a second rectangle inside the text field.
- Replaced the circular top-room icon with a labeled atmosphere-driven action, restyled Browse views as a segmented control, expanded official-content categories, and added complete hover/focus card surfaces.
- Added delayed desktop YouTube previews through official muted `youtube-nocookie` iframes; previews cleanly unmount on pointer exit, remain disabled for touch/reduced-motion/compact layouts, and never place NightWatch controls over the iframe.
- Added a responsive mini-player presentation that reuses the same mounted room, iframe, and sync engine across Browse, Friends, Messages, Profile, Settings, and other non-room screens.
- Added official YouTube caption preferences for follow/prefer behavior, language, and supported caption font sizes; NightWatch does not scrape or generate subtitles.
- Added a Browsing settings section, six atmosphere presets, seven animated/static backdrop styles, four card-surface treatments, seven local/system font profiles, rounded theme scrollbars, and styled progress/range controls.
- Fixed Settings workspace scrolling so the category rail remains stationary while only the active content pane scrolls.
- Hardened `git:finish` so it runs the test suite and always packages Electron with `--publish never`, preventing feature completion from attempting a GitHub release without a token.
- Expanded interaction coverage to 62 passing tests across 12 files and revalidated Activity plus Electron/NSIS production builds with publishing disabled.

### Phases 25-28 cinematic UI completion

- Rebuilt the watch room around a responsive Up Next, Chat, People, Moments, and Discover dock while preserving the untouched official YouTube iframe and every existing room/sync contract.
- Added trusted details-mode title, channel avatar, channel name, and duration below arbitrary loaded YouTube videos; room members now use validated Discord avatars with stable fallbacks.
- Added a capability-gated Friends Are Watching shelf backed by consent-safe presence v2, trusted video details, and media heartbeats that never expose room codes.
- Rebuilt Profile as an atmosphere-generated banner dashboard; restyled Friends as searchable relationship cards; and resolved Message avatars from authorized conversation rosters with clearer unread, system, failure, group, and compact states.
- Added a live Settings mini-shell, custom-palette contrast/separation guidance, improved backdrop previews, refreshed Parties/lobby surfaces, and a cinematic About/update journal.
- Added dev-only React Testing Library, user-event, and jsdom with shell navigation/search, avatar fallback, and keyboard-operable room-dock tests; the full suite now contains 55 passing tests.
- Applied the non-breaking Discord REST/Undici security update, removing the production high-severity audit finding without forcing breaking Electron, Vite, or Activity SDK upgrades.

### Browse variety and infinite scroll

- Rebuilt trending as a deep, shuffled pool (up to four cheap `mostPopular` pages / ~200 videos) that reshuffles each cache refresh and rotates to a random start per open, so Browse no longer shows the same handful every launch and pages much deeper. Search remains relevance-ordered and quota-protected.
- Added scroll-triggered loading to the Browse hub (IntersectionObserver sentinel) so more videos load as you scroll; the explicit "Load more" button stays as a keyboard/fallback control.

### Phase 24 backend: identity, friend media presence, video details

- Added `sanitizeAvatarUrl` (canonical Discord-CDN-only, query/hash/credential/port-stripped, length-capped) and additive `avatarUrl` on `PresenceMeta`/`RoomMember`; room presence now publishes and validates a member avatar, with the Discord OAuth / Activity avatar carried into presence non-persistently.
- Added migration `0021`: `heartbeat_media_presence` (status + validated 11-char video id) and `get_friend_presence_v2` (safe avatar, validated border, and the video id only when a friend shares activity), plus a nullable `presence_preferences.video_id`. Existing `heartbeat_presence`/`get_friend_presence` are unchanged for v0.1.22 clients, and no presence surface ever stores or returns a room code.
- Added a `friendMediaPresence` capability probe (gates the Browse "watch with a friend" shelf until `0021` is deployed) and `FriendMediaPresence` types + `heartbeatMedia`/`getFriendMediaPresence` in the presence service.
- Extended the `search-youtube` function with `kind: "details"` (strict id, one `videos.list` + batched channel avatar, 30-minute cache, quota accounting, explicit unavailable/rate-limited/not-configured outcomes) and a typed `getVideoDetails(videoId, callerId)` search-service method.
- Added `sanitizeAvatarUrl` unit tests and a `phase24_media_presence` SQL/RLS test (consent combinations, blocks both directions, friendship transitions, invalid ids, safe avatar/border, stale-presence parity, old-client compatibility, and the no-room-code guarantee).

### Browse, profile, and atmosphere polish

- Removed the nested focus rectangle inside the composite Browse search control while preserving the visible outer focus state.
- Added real YouTube channel thumbnails to search/trending results through one cached, batched channels lookup with initial fallbacks.
- Replaced the circular card Play control with a conventional labeled action and rebuilt My Card as a responsive two-column dashboard with a six-stat grid.
- Added Avengers: Doomsday, Spider-Man: Brand New Day, Alien X, and Obsidian Black atmosphere palettes.
- Added a backward-compatible Custom Atmosphere builder for canvas, surface, and panel colours, plus visual Backdrop cards.

### Runtime QA follow-up

- Prevented stale Browse category/search/pagination responses from replacing the current view and made retry preserve search/history intent.
- Kept video actions visible on touch devices and made compact navigation scroll instead of clipping capability-gated destinations.
- Added two-step Settings reset confirmation and compact category labels.
- Added persistent-message edit/delete, group rename, and sender-side profanity filtering.
- Made Reactions, Moment Notes, and room Discovery independently collapsible without adding iframe overlays.

### Phase 22 cinematic UI completion

- Reworked Browse into denser cinematic shelves with labeled search, keyboard-focusable tracks, edge fades, arrow-only navigation, responsive cards, and clearer channel identity.
- Rebuilt the watch room around an iframe-first stage with host controls below YouTube, persistent collapsible Queue/Chat/Members panels, a single-border chat composer, and refined reaction/moment timelines.
- Expanded Settings with eight descriptive atmosphere cards, accessible ranges and switches, pressed states, readable scaling previews, stronger focus, and reduced-motion/transparency/high-contrast treatment.
- Replaced the NightWatch monogram with a clearer eclipse `NW` mark and regenerated taskbar, favicon, Discord, Activity-cover, and multi-resolution Windows icon assets.
- Added custom NSIS installer sidebar/header artwork while retaining owner-initiated releases.
- Gated automatic PR merging behind an explicit coordinator-applied `automerge` label after scope and head-SHA review.

### Phase 21 frontend integration

- Added capability-gated public club discovery, join/open actions, and owner-controlled public/private directory listing.
- Added notification dismissal and clear-read controls while preserving unread retention.
- Added group membership administration with accepted-friend invites, 30-member limit feedback, role promotion/demotion, ownership transfer, removal, and leave flow.
- Added compliant reaction-based highlight reels with official-player seeking and Markdown link export; no video downloading, clipping, proxying, or re-encoding.
- Integrated the native Windows titlebar overlay with the cinematic shell without replacing OS window controls or Snap Layouts.

### Phase 20B social frontend

- Fixed packaged Discord avatars by allowing Discord CDN images in the production CSP and adding stable initial fallbacks across every account surface.
- Added capability-gated Friends navigation with accepted friends, incoming/outgoing requests, co-watcher suggestions, realtime refresh, and working lifecycle actions.
- Added persistent direct/group Messages UI with unread counts, sequence-safe paging state, realtime delivery, soft-delete tombstones, group creation, and direct-message launch from Friends.
- Replaced exposed horizontal video scrollbars with accessible left/right shelf controls, smooth page-sized movement, and snap-aligned media cards.
- Added consent-based friend presence controls with privacy-first defaults and no room-code exposure.
- Added privacy-safe presence heartbeats and live friend status labels without exposing party access codes.
- Replaced prototype glyph controls with a dependency-free NightWatch SVG icon system across navigation, Browse categories, shelf controls, media actions, Settings, room actions, and notifications.
- Replaced the category scrollbar with accessible left/right category controls and smooth snap-aligned navigation.
- Rebuilt Messages as a proper workspace with conversation search, a collapsible group creator, stable older-message paging, live near-bottom scrolling, centred system notices, delivery feedback, and responsive compact navigation.
- Added Creator Club human moderation: member report submission, staff-only report queue, action/dismiss controls, and append-only audit history.
- Added persistent Moment Notes below the official player with private/friends/party visibility, emoji stamps, filters, edit/delete, and host-synchronized seeking.
- Added server-validated achievement profile borders with a cinematic profile studio and selected-border preview.
- Added a capability-gated Creator Club workspace with club creation, bounty lifecycle, YouTube submissions, and one-vote-per-bounty judging.
- Added a realtime notification centre with unread counts, safe unknown-event fallback copy, and individual or bulk read controls.

### Phase 20A — Browse and player shell

- Replaced the featured-billboard Browse page with persistent video search, fifteen working category filters, paginated cinematic shelves, room-history continuation, and compact media actions.
- Expanded the working navigation language to Browse, Room, Parties, Profile, Settings, and About while keeping backend-gated social and creator destinations hidden.
- Refined the watch room with collapsible Queue and Members modules, a player-first hierarchy, and a consolidated chat surface without double borders.
- Added a signed-in profile dock and grouped sidebar navigation, plus a dedicated below-player reaction/moment surface that preserves YouTube control boundaries.

### Advanced UI and workflow

- Added an OTT-inspired discovery experience, advanced categorized settings, responsive density and backdrop controls, accessibility preferences, and branded startup treatment.
- Added automatic feature validation/PR creation and an intentional Actions-driven versioned release workflow.
- Rebuilt Browse around a cinematic featured title, channel-forward media cards, responsive shelves, and progressive result reveal; reshaped the room around a player-first stage with clearer queue, conversation, member, and host/viewer hierarchy.
- Fixed feature validation reporting a failure when its branch had already been merged before the PR-opening step completed.
- Added graceful thumbnail fallbacks for removed, private, or temporarily unavailable YouTube preview images.
- Redesigned the app navigation, create/join lobby, queue interactions, and chat empty state with a more cinematic media-app hierarchy and compact icon navigation.
- Expanded accessibility with interface text scaling, reduced transparency, and enhanced keyboard focus; added playback volume shortcuts and Neutral/Cinema/Vivid picture presets.
- Refined Settings with macOS-inspired glass depth, luminous accent actions, tactile switches, and a reduced-motion-aware orbit loading treatment.
- Expanded Atmosphere from three themes to eight with Moonlit Violet, Crimson Theatre, Oceanic, Evergreen, and Rose Noir presets.
- Added a Browse profile toolbar with working room/settings shortcuts and robust Discord avatar metadata fallbacks.

### Backend/platform

- Phase 17 creator/host tools (ADR-014): opt-in per-room session insights (anonymized viewer-count/playback/reaction events; host-side recorder; log-session Edge Function with service-role writes; owner-only RLS reads; in-room "Session insights on" transparency notice), temporary Insights view (retention + reaction-density charts), premiere events (per-room premiere video + countdown banner + host "Start the premiere"), room settings management in My Rooms — migration 0003_session_analytics.sql

- Discover is now the app's home page: full-page video grid (Trending with category chips / Search / Previously watched) with room chat alongside, so the group can discuss picks; Play routes into the Room page (creating a room on the fly if needed), Queue keeps you browsing. Temporary layout — frontend lane restyles per FEATURES_UI_BRIEF.md
- Phase 16 Discovery Hub services: search-youtube Edge Function extended with trending (mostPopular, category filter, 10-min cache) and channelTitle; room_history table + capped/deduped RPCs (0002_room_history.sql) with automatic host-side watch recording; invite deep links (nightwatch://join/CODE — buildInviteLink, main-process routing, join:link IPC, auto-join flow); FEATURES_UI_BRIEF.md interface contract for the frontend grid

- Fixed packaged-build Supabase CORS (re-applied: no Origin rewrite for Supabase; response-side ACAO override) — restores REST calls (room banner lookup, auth token exchange) under the app:// scheme
- OAuth callback errors (e.g. provider secret mismatch) are now parsed, logged, and shown on the My Rooms sign-in screen instead of failing silently

- Activity Discord identity: discord-token Edge Function (OAuth code exchange, Client Secret server-side only), SDK authorize/authenticate in the Discord bridge, PlatformBridge.getPlatformIdentity, auto-join with real Discord name inside Activities (guest fallback preserved)
- Windows app icon wired into packaging (build/icon.ico from the frontend lane)
- Docs: packaged update round trip marked verified (0.1.4–0.1.11 evidence), reconciling STATUS/ROADMAP

### Cinematic frontend

- Added NightWatch NW monogram assets for in-app branding, favicons, Discord art, and Electron packaging.
- Added responsive cinematic room/lobby treatments, member initials, accessible form feedback, and reduced-motion support.
- Added a dedicated backend/platform handoff and two-worktree collaboration layout for Fable.
- Refined the app shell, watch room, player framing, settings guidance, focus states, and compact Activity layout.


### Added

- Phase 14 persistent rooms (ADR-012): Discord sign-in (PKCE, system browser + nightwatch:// deep link), rooms table with RLS + 10-room cap + code-only public lookup, My Rooms screen (create/schedule/join/delete), persistent room name/schedule banner in the room header

- Queue: host "Play next" button — manually skip to the top-voted entry (needed for livestreams, which never fire the ended event)
- Phase 15 collaborative queue (ADR-013): shared room queue with voting (votes reorder, host-authoritative snapshots, 50-entry cap, per-member rate limit), add-by-link for all members, own/host entry removal, auto-advance to top-voted entry when the current video ends, late-join queue sync

- Phase 1 desktop foundation: Electron + React 18 + TypeScript (strict) + Vite scaffolding
- Secure Electron main process: context isolation, sandboxed renderer, no node integration, single-instance lock, external-link and navigation guards, CSP in index.html
- Typed IPC layer: shared/ipc.ts contract, preload contextBridge exposing `window.nightwatch`
- Renderer shell showing app/Electron version via IPC round-trip
- Build tooling: dev/build/typecheck scripts, electron-builder Windows NSIS config
- Phase 2 realtime foundation: Supabase client singleton (`@supabase/supabase-js`), typed event envelope + extensible RealtimeEventMap (shared/events.ts), RealtimeService channel wrapper with typed broadcast send/on, channel naming scheme, useConnectionStatus hook, connection indicator in shell, Supabase endpoints allowed in production CSP
- Phase 13 Discord Activity: PlatformBridge platform adapter with electron/discord/web implementations, Activity web build target (dist-web), Discord Embedded App SDK bootstrap with proxy URL mappings, voice-channel-fixed room codes
- Phase 12 production prep: local file logging (main + renderer, rotating, telemetry-free), global error handlers with user-visible dialog, security review pass with broadcast/IPC payload validation (SECURITY_REVIEW.md), adaptive drift tolerance + viewer sync-delay readout (ADR-017), reaction animation cap, sourcemap-free production renderer, installer polish (shortcuts, publisher, versioned artifact)
- Phase 11 auto-update & app info: electron-updater wired to GitHub Releases (auto-check on launch in packaged builds), update:check/install/status IPC, About screen with version info, bundled patch notes, manual Check for Updates with live progress and Restart & Update
- Phase 10 bonus features: Discord Rich Presence (main-process RPC, silent degrade), in-app YouTube search via search-youtube Supabase Edge Function (server-held API key, rate-limited) with host Link/Search tabs, chat profanity filter (obscenity, source-side), local Engagement Dashboard (stats, 8 achievements, My Card view, unlock toasts)
- Phase 9 UI/UX: sidebar app shell, mac-style cards, glossy/gradient-border buttons, accent color picker (8 swatches), shimmer hero title + entrance/pop animations, player skeleton shimmer, responsive layout
- Phase 8 personalization: local settings store (localStorage, sanitized), Electric Teal / Shiny Gold / Legacy themes via CSS variables, persisted volume through official player API, brightness/contrast/saturation video filters with reset, settings panel
- Phase 7 reactions: emoji palette with wire validation, rate-limited ReactionService, floating reaction animations over the player, timestamp timeline marker strip, reaction bar for all members
- Phase 6 social features: ephemeral chat over room channel (rate-limited, 200-entry cap), join/leave/host-change system notices derived from presence diffs, ChatPanel with smart auto-scroll, two-column room layout
- Phase 5 playback sync: playback/sync event contract, pre-subscribe broadcast bindings in RealtimeService, RoomService typed send/on registry, SyncEngine (host native-control broadcast, viewer latency-compensated apply, 5s drift correction, late-join/reconnect snapshot sync), host-only playback controls per ADR-006
- Phase 4 player integration: YouTube URL/id parsing (shared/youtube.ts), official IFrame API loader, YouTubePlayer abstraction with typed states/errors, PlayerPanel (URL input + embedded player) in room screen, YouTube origins added to production CSP
- Phase 3 room system: crypto-random room codes (shared/room.ts), persistent guest identity (ADR-005 fallback), Presence support in RealtimeService, RoomService with presence-derived members + deterministic host assignment and migration + reconnection status, useRoom hook, HomeScreen (create/join) and RoomScreen (member list, host badge, copy code, leave)


### Changed


### Fixed

- Rich Presence: room code no longer shown in Discord status (it's the room's access credential); added Settings toggle to disable Rich Presence entirely (clears immediately when switched off)
- Video not loading in packaged builds: Origin/Referer rewrite now applies only to app-initiated and frame-document requests, leaving YouTube's iframe-internal API calls untouched (they were being 403'd)
- Chat: profanity filter can now be toggled per user in Settings (sender-side; English wordlist)
- Packaged-build realtime failure: app:// origin was rejected by Supabase's websocket handshake — Origin/Referer normalized to a stable https origin for Supabase and YouTube requests (single merged webRequest handler; channel errors now logged with detail)
- Silent auto-update install (no NSIS wizard on Restart & Update)
- YouTube error 153 hardening: Referer/Origin header shim for YouTube requests in packaged builds (on top of the app:// protocol fix); path-containment guard on the app:// handler
- Realtime connection errors are now written to the local log for diagnosis
- Crash on room join: presence listeners are now registered before channel subscribe() (Supabase requirement); added ErrorBoundary so renderer errors show a message instead of a black screen
