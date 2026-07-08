# Changelog


## Unreleased


### Added

- Phase 1 desktop foundation: Electron + React 18 + TypeScript (strict) + Vite scaffolding
- Secure Electron main process: context isolation, sandboxed renderer, no node integration, single-instance lock, external-link and navigation guards, CSP in index.html
- Typed IPC layer: shared/ipc.ts contract, preload contextBridge exposing `window.nightwatch`
- Renderer shell showing app/Electron version via IPC round-trip
- Build tooling: dev/build/typecheck scripts, electron-builder Windows NSIS config


### Changed


### Fixed
