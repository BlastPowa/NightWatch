# Changelog


## Unreleased


### Added

- Phase 1 desktop foundation: Electron + React 18 + TypeScript (strict) + Vite scaffolding
- Secure Electron main process: context isolation, sandboxed renderer, no node integration, single-instance lock, external-link and navigation guards, CSP in index.html
- Typed IPC layer: shared/ipc.ts contract, preload contextBridge exposing `window.nightwatch`
- Renderer shell showing app/Electron version via IPC round-trip
- Build tooling: dev/build/typecheck scripts, electron-builder Windows NSIS config
- Phase 2 realtime foundation: Supabase client singleton (`@supabase/supabase-js`), typed event envelope + extensible RealtimeEventMap (shared/events.ts), RealtimeService channel wrapper with typed broadcast send/on, channel naming scheme, useConnectionStatus hook, connection indicator in shell, Supabase endpoints allowed in production CSP
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

- Crash on room join: presence listeners are now registered before channel subscribe() (Supabase requirement); added ErrorBoundary so renderer errors show a message instead of a black screen
