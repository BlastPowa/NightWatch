# NightWatch frontend/backend handoff

Last updated: 2026-07-15 from public baseline `v0.1.22`.

## Current integration state

- Phase 24 frontend is merged through PR #35.
- Phase 24 backend support is merged through PR #34.
- Phases 25–28 are merged through automated PR #36. Its source branch and `main` trees match exactly, with no outstanding frontend files.
- The user-supplied screenshots are the visual hierarchy reference. NightWatch keeps its name, eclipse logo, atmosphere system, official YouTube iframe, and original assets.

## Delivered UI contracts

- The official iframe is unchanged. Trusted video/channel metadata, host controls, reactions, and notes render below it.
- The room companion dock provides working Up Next, Chat, People, Moments, and Discover tabs with keyboard arrow navigation.
- Public/member avatars are rendered only from canonical or server-authorized values; profile borders remain server validated.
- Friends Are Watching uses `get_friend_presence_v2`, `search-youtube` details, and the v2 heartbeat. It never receives or displays room codes.
- Profiles expose only local/authorized stats; Messages resolve people only through the authorized conversation roster.
- Settings retain the existing persistence key and store while adding live preview and custom-palette contrast guidance.

## Stable invariants

- Social services return typed explicit outcomes; `not-ready` hides capability-gated navigation.
- Message paging uses `seq`; soft-deleted rows remain tombstone cursor slots.
- Public profiles never invent private stats, achievements, or mutual rooms.
- Presence is consent-safe and never exposes private room codes.
- YouTube content uses the official iframe only; NightWatch synchronizes state and never downloads/proxies video content.
- Client secrets and OAuth refresh tokens remain outside Supabase/browser state.

## Validation and remaining owner gate

- Green: clean install, strict TypeScript, 55 tests, Activity build, Electron/NSIS build, installer/blockmap, and responsive browser review at 1280x800, 940x600, 820px, and 600px.
- Owner deploy: run the Phase 24 SQL test in a disposable database, deploy `0021`, and redeploy `search-youtube`.
- Owner acceptance: packaged two-client regression, real Discord Activity avatar mappings, and installed updater round-trip.
- Release through the manual Actions workflow only after those checks. No direct push to `main`.

Phase 29 local/Drive playback remains separately gated from this UI completion branch.
