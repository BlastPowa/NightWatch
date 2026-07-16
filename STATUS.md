# NightWatch current status

Last updated: 2026-07-16.

## Phase 29 authorized media (backend merged)

- PR #39 merged the Phase 29 typed contracts, the Electron
  local-media platform, and migration `0022`. It stops at the capability handoff
  gate: every new capability defaults to off and no UI is wired. See
  `PHASE_29_BACKEND_STATUS.md`.
- Green on the merged local-media baseline: strict typecheck, 197 tests,
  Discord Activity build, and the full Windows installer/blockmap package.
- Migration `0022` and its RLS tests were deployed and passed in the owner
  environment on 2026-07-16.
- `backend/phase-29-drive` adds system-browser PKCE with a loopback redirect and
  `drive.file` only, `safeStorage`-encrypted refresh tokens with no plaintext
  fallback, a sandboxed non-persistent Picker whose metadata is revalidated in
  main, and per-participant Drive range streaming.
- Drive still defaults off and requires the owner flag plus Google Cloud
  configuration. Packaged Drive acceptance and two-client custom-media
  synchronization remain outstanding.
- Drive validation now passes strict typecheck, all 265 tests across 22 files,
  the Discord Activity build, and Windows Electron/NSIS packaging.
- Fixed on this branch: `main` could not typecheck or test at all, because Phase 28
  added component tests importing React Testing Library / user-event / jsdom without
  ever adding those dev dependencies to `package.json`.

## Release baseline

- Current public release: `v0.1.23`.
- Phase 24 frontend merged through PR #35, Phase 24 backend support merged through PR #34, and the complete Phase 25–28 frontend overhaul merged through PR #36.
- Migration `0021`, privacy-safe media presence, canonical Discord avatars, deeper Browse paging, and `search-youtube` details mode are present on `main`; database/function deployment still requires the owner environment.
- Releases remain intentional GitHub Actions runs after reviewed feature PRs; no direct push to `main`.
- The Phase 28 control/settings completion pass merged through PR #38 and Phase 29
  backend/platform support merged through PR #39.

## Merged cinematic overhaul

- The reviewed `frontend/phase-25-player-room` tree is merged into `main` through PR #36; there are no outstanding frontend changes on that branch.
- Phase 25: player-first room, official iframe preserved, trusted video/channel details below the player, responsive Up Next/Chat/People/Moments/Discover dock, real member avatars, and keyboard tab navigation.
- Phase 26: banner-led profile, searchable friend cards, authorized-roster message avatars, compact messaging states, consent-safe `Friends are watching` shelf, and v2 media heartbeat publishing.
- Phase 27: live Settings preview, custom-palette contrast guidance, improved backdrop previews, cinematic About/update screen, and refreshed lobby/Parties surfaces.
- Phase 28: dev-only React Testing Library, user-event, and jsdom; interaction coverage for shell search/navigation, avatar fallback, and room dock keyboard behavior.
- Phase 28 completion pass: composite-search focus fix, labeled glowing room action, segmented Browse views, expanded official-content categories, full-card hover surfaces, muted official iframe previews, same-instance mini-player presentation, YouTube caption preferences, seven local font profiles, six additional atmospheres, seven backdrops, four card treatments, animated secondary backdrop colour, and rounded theme scrollbars.
- The Settings rail now remains fixed while only the active settings pane scrolls; all new settings remain backward-compatible under `nightwatch:settings`.

## Validation completed

- `npm ci` passes.
- Strict TypeScript passes.
- 62/62 tests pass across 12 files, including Browse preview/friend-view, caption-player, settings migration, labeled room action, and same-instance mini-player presentation coverage.
- Discord Activity production build passes.
- Electron/NSIS build with `--publish never` passes after the clean install and produces installer + blockmap.
- Responsive browser review passes at 1600x900, 1280x800 Settings, 940x600 collapsed rail, and 620px mobile navigation; the rounded settings scrollbar, fixed settings rail, progress controls, backdrop grid, and card-style grid were visually checked.
- The safe transitive Discord REST/Undici security update is applied; the production audit now has no high-severity finding. Two moderate `uuid` advisories require a breaking Discord Activity SDK upgrade and remain separately gated.

## Required owner/platform acceptance

- Run `supabase/tests/phase24_media_presence_test.sql` against a disposable database, then deploy migration `0021` and redeploy `search-youtube` before relying on the capability-gated friend-media shelf.
- Run a real two-client packaged regression: create/join, playback drift, queue, host migration, chat, reactions, notes, reconnect, invites, messaging, and Creator Club.
- Verify real Discord Activity avatar URL mappings and launch behavior.
- Verify the installed updater round-trip from `v0.1.22` to the eventual overhaul release.
- Verify the same-instance mini-player with two packaged clients and real YouTube caption tracks/languages; automated tests cover presentation continuity and official caption parameters, but live provider behavior remains an owner acceptance item.
- Claude's separately gated Phase 29 handoff is ready at `C:\Users\Blast\source\repos\NightWatch-fable\PHASE_29_MEDIA_LIBRARY_HANDOFF.md` for `backend/phase-29-media-library`; it explicitly excludes protected-service downloads, DRM extraction, media relays, and free-unlimited-cloud claims.
- Phase 29 local/Google Drive media remains separately gated and is not part of the Phase 24–28 completion gate.
