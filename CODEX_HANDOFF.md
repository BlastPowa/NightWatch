# NightWatch frontend/backend handoff

Last updated: 2026-07-16 from public baseline `v0.1.25`.

## Current integration state

- Phase 29 Drive and initial Library UI are merged through PRs #41 and #42.
- Phase 30 backend account support merged through PR #45; the complete frontend
  guidance/profile/account integration merged through PR #46 and shipped in
  `v0.1.25`.
- Phase 24 frontend is merged through PR #35.
- Phase 24 backend support is merged through PR #34.
- Phases 25–28 are merged through automated PR #36. The final `frontend/phase-28-control-polish` branch is prepared for reviewed PR delivery; it must not be pushed directly to `main`.
- The user-supplied screenshots are the visual hierarchy reference. NightWatch keeps its name, eclipse logo, atmosphere system, official YouTube iframe, and original assets.

## Delivered UI contracts

- The official iframe is unchanged. Trusted video/channel metadata, host controls, reactions, and notes render below it.
- The room companion dock provides working Up Next, Chat, People, Moments, and Discover tabs with keyboard arrow navigation.
- Public/member avatars are rendered only from canonical or server-authorized values; profile borders remain server validated.
- Friends Are Watching uses `get_friend_presence_v2`, `search-youtube` details, and the v2 heartbeat. It never receives or displays room codes.
- Profiles expose only local/authorized stats; Messages resolve people only through the authorized conversation roster.
- Settings retain the existing persistence key and store while adding live preview and custom-palette contrast guidance.
- Search focus now belongs to the rounded composite shell; Browse previews use temporary muted official iframes; and the active watch room reuses its single mounted iframe/sync engine as a mini-player on non-room screens.
- Caption mode/language are official player initialization preferences, while caption size uses YouTube's supported captions option. Availability depends on YouTube-provided tracks.
- Settings add Browsing controls, local/system fonts, six new atmospheres, seven backdrops, four card treatments, rounded scrollbars, and content-pane-only scrolling.
- FAQ and onboarding explain the implemented product and privacy boundaries
  without enabling unfinished controls.
- Public Drive identifiers are available to packaged Electron builds through
  build defines and Actions variables; tokens and the optional client secret are
  never embedded.
- Settings uses the typed read-only YouTube account bridge with real
  Connect/Disconnect and timeout states. It has separate consent and encrypted
  storage from Drive and never changes the official iframe session.
- Profile uses a Steam-inspired artwork showcase. Custom background images are
  resized/sanitized and remain device-local.

## Stable invariants

- Social services return typed explicit outcomes; `not-ready` hides capability-gated navigation.
- Message paging uses `seq`; soft-deleted rows remain tombstone cursor slots.
- Public profiles never invent private stats, achievements, or mutual rooms.
- Presence is consent-safe and never exposes private room codes.
- YouTube content uses the official iframe only; NightWatch synchronizes state and never downloads/proxies video content.
- Client secrets and OAuth refresh tokens remain outside Supabase/browser state.

## Validation and remaining owner gate

- Green on the active Phase 30 branch: strict TypeScript, 292 tests across 28
  files, Activity build, Electron/NSIS build, installer/blockmap, and Drive
  public-config isolation verification.
- Owner deploy: run the Phase 24 SQL test in a disposable database, deploy `0021`, and redeploy `search-youtube`.
- Owner acceptance: packaged two-client regression, real Discord Activity avatar mappings, and installed updater round-trip.
- `v0.1.25` was published through the manual Release workflow with installer,
  blockmap, and updater manifest. Future releases remain intentional; no direct
  push to `main`.

Phase 29 local/Drive playback remains separately gated from this UI completion branch. Claude should follow `C:\Users\Blast\source\repos\NightWatch-fable\PHASE_29_MEDIA_LIBRARY_HANDOFF.md` on `backend/phase-29-media-library`.
