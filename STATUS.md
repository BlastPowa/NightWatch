# NightWatch current status

Last updated: 2026-07-15.

## Release baseline

- Current public release and clean implementation baseline: `v0.1.22` at `6bb11fb`.
- Strict TypeScript and all 43 unit tests pass on that baseline.
- Phase 20 social, messaging, moment-note, presence, Creator Club, notification, and profile contracts are merged. Capability checks still hide unavailable server surfaces.
- Releases remain intentional GitHub Actions runs after reviewed feature PRs; no direct push to `main`.

## Active delivery

- Phase 24 frontend branch: `frontend/phase-24-cinematic-shell`.
- Phase 24 backend-support branch: `backend/phase-24-ui-support`.
- Supplied Papaya-style screenshots are the visual hierarchy reference. NightWatch retains its name, eclipse logo, atmosphere system, official YouTube iframe, and original assets.
- Phase 24 builds a persistent shell, centered global search, grid-first Browse, arrow-controlled history shelves, expanded categories, canonical/proxied avatar assets, and responsive rail/mobile navigation.
- Phase 25–28 cover the player dock, social/profile screens, Creator/settings consistency, and packaged accessibility/regression hardening.
- Phase 29 local and Google Drive media is separately gated and is not part of the current UI completion goal.

## Phase 24 verified so far

- Strict TypeScript passes.
- All 43 unit tests pass.
- Discord Activity production build passes.
- Browser visual review passes at 1280×800, 940×600, 820px collapsed rail, and 600px mobile navigation.
- Global search submission, result replacement, category controls, pagination UI, and zero horizontal page overflow were verified.

## Required external/platform delivery

- Preserve Activity identity `avatarUrl`, normalize Discord CDN URLs, and expose optional validated member avatars.
- Add privacy-safe media presence and friend presence v2 without room codes.
- Add cached `search-youtube` details mode for trusted metadata on arbitrary YouTube URLs.
- Deploy migrations/functions and URL mappings before enabling dependent UI.

## Still not proven

- Packaged two-client create/join/sync/chat/reactions/queue/notes/host-migration/reconnect regression on the Phase 24–28 result.
- Real Discord Activity launch, avatar mappings, and high-latency drift.
- Installed updater round-trip from `v0.1.22` to the final overhaul release.
- Phase 28 accessibility matrix and packaged visual sign-off.
