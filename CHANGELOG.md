# Changelog


## Unreleased


### Added

- Phase 1 desktop foundation: Electron + React 18 + TypeScript (strict) + Vite scaffolding
- Secure Electron main process: context isolation, sandboxed renderer, no node integration, single-instance lock, external-link and navigation guards, CSP in index.html
- Typed IPC layer: shared/ipc.ts contract, preload contextBridge exposing `window.nightwatch`
- Renderer shell showing app/Electron version via IPC round-trip
- Build tooling: dev/build/typecheck scripts, electron-builder Windows NSIS config
- Phase 2 realtime foundation: Supabase client singleton (`@supabase/supabase-js`), typed event envelope + extensible RealtimeEventMap (shared/events.ts), RealtimeService channel wrapper with typed broadcast send/on, channel naming scheme, useConnectionStatus hook, connection indicator in shell, Supabase endpoints allowed in production CSP
- Phase 3 room system: crypto-random room codes (shared/room.ts), persistent guest identity (ADR-005 fallback), Presence support in RealtimeService, RoomService with presence-derived members + deterministic host assignment and migration + reconnection status, useRoom hook, HomeScreen (create/join) and RoomScreen (member list, host badge, copy code, leave)


### Changed


### Fixed

- Crash on room join: presence listeners are now registered before channel subscribe() (Supabase requirement); added ErrorBoundary so renderer errors show a message instead of a black screen
