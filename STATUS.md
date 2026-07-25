# NightWatch current status

Last updated: 2026-07-25.

## Phase 34 backend (merged through PR #55)

- `backend/phase-34-production-parity` carries: migration `0028`
  (`runtime_capabilities_v2` + two locked-down helpers), two SQL/RLS test
  scripts, the safe-diagnostic and runtime-manifest contracts, the
  session-settle capability service, the Phase 37 Drive workspace contracts,
  and release-candidate smoke support.
- Fixes the packaged auth bug at its cause: capability detection raced
  Supabase's persisted-session restore, so signed-in users were reported as
  signed out with no stated reason.
- Codex fixed the service's pre-initialization session-settle deadlock and ran
  the complete code gate: strict typecheck, 439 tests across 48 files, Activity
  build, and Windows Electron/NSIS packaging all pass.
- The two SQL scripts remain unexecuted on this machine because no Supabase CLI
  or owner-approved database URL is available.
- Owner database work: deploy `supabase/migrations/0028_runtime_capabilities_v2.sql`
  (functions only — no table, RLS policy, or publication change), then run
  `supabase/tests/phase34_runtime_capabilities_test.sql` and
  `supabase/tests/phase34_social_contract_test.sql`.
- Phase 34 enables **no** capability flag. Detail: `PHASE_34_COMPLETION_REPORT.md`.

## Phase 34 frontend (code/build validated from v0.1.27)

- Clean frontend/backend lanes now start at public `v0.1.27` (`944462f`);
  obsolete conflicting PRs #44 and #48 were closed as superseded by the
  evolved Drive and Phase 33 implementation in `main`.
- Backend PR #55 is merged: migration `0028`, the versioned capability
  manifest, safe diagnostics, Drive workspace contracts, SQL/RLS verification
  scripts, and release-smoke contracts passed GitHub's complete feature gate.
  The owner still needs to deploy `0028` and execute both Phase 34 SQL scripts.
- Frontend capability detection now consumes one read-only versioned manifest,
  with the existing `social_diagnostics` RPC as a migration fallback. It no
  longer executes feature operations as deployment probes and rechecks after
  auth, reconnect, focus, and resume.
- Friends now uses `search_people` for opted-in public discovery and
  `get_room_people` for authenticated current-room members. Existing graph
  filtering remains, and a v0.1.27 co-watcher fallback covers the rollout.
- Messaging now has RPC acknowledgement, reload-after-send, periodic/focus/
  online fallback refresh, retry controls, and privacy-safe action diagnostics.
- Custom Atmosphere now persists canvas, surface, panel, primary glow, and
  secondary glow. Duplicate backdrop selectors were removed and every backdrop
  uses the same live root variables, including device-local artwork.
- Release validation now runs all tests, builds an unpublished Windows
  candidate, and boots the packaged main process in smoke mode before any
  version commit or tag is created.
- Frontend evidence on 2026-07-25 after rebasing onto PR #55: strict typecheck;
  all 443 tests across 49 files; Activity build (333 modules); Windows
  Electron/NSIS package (81.8 MB
  installer); and packaged smoke all pass. Browser verification covered search
  reset, signed-out Friends guidance, the live Aurora backdrop, 940x600 and
  620px layouts without horizontal overflow, and zero console errors.
- Owner two-account packaged acceptance and the Phase 34 database deployment/
  SQL verification remain mandatory before a v0.1.28 Release workflow run.

## Runtime repair and Phase 33 integration

- PR #53 merged the reviewed Phase 33 backend/platform contracts into `main`.
- Strict typecheck, 389 tests, Activity production build, and Windows NSIS
  packaging pass on the Phase 33 backend baseline.
- The frontend runtime-repair lane restores explicit chat/reaction delivery
  feedback, Drive connection/workspace controls, stale Browse reset and local
  Previously watched fallback, group composer layout, friend activity, room
  code copying, responsive shell/settings/room behavior, movable mini-player,
  and the refreshed moon/play brand assets.
- Phase 33 voice, screen share, and synchronized file-watch UI remains hidden:
  TURN deployment and the packaged two-client acceptance checklist are still
  required before those capability flags can be enabled.

## Phase 33 remaining-features lane (backend implemented and validated)

- Answers `REMAINING_FEATURES_AND_SETUP_HANDOFF.md` Priorities 1–4 plus the
  non-visual half of 5–6 on top of the merged `v0.1.26` Phase 32 baseline.
- Added: secret-free TURN diagnostics (function + client), typed
  capability-disabled reasons, the Google Drive shared-viewing host flow,
  file-watch readiness evaluation, and a central voice/share teardown
  authority for leave / sign-out / page-hide / window-close / host-migration.
- Delivered as documents: `PHASE_33_FRONTEND_CONTRACTS.md` (Codex integration
  guidance), `PHASE_33_PACKAGED_ACCEPTANCE.md` (two-client completion gate),
  `PHASE_33_COMPLETION_REPORT.md` (full report).
- No new migrations. `turn-credentials` must be redeployed for diagnostics.
- Validation state: strict typecheck, 389 tests, Activity build, and Windows
  Electron/NSIS packaging pass. PR #53 merged after green GitHub Actions.
- Voice, screen sharing, and shared file playback are **not complete** and
  their flags stay false until TURN is deployed and the packaged two-client
  checklist passes across different networks.

## Phase 32 room media & comms (merged; database verified; RTC gated)

- PR #51 merged the backend/platform implementation into `main`: versioned
  room media modes, people discovery, room-people
  actions, ephemeral WebRTC signaling, TURN credential minting, Electron
  capture + Drive shared-workspace support, and unit/SQL tests.
- Migrations `0026` and corrective `0027` are deployed. The owner confirmed
  `supabase/tests/phase32_rls_test.sql` passes on 2026-07-19.
- Strict typecheck, all 364 tests, Activity build, Electron build, Windows
  packaging, Feature PR checks, and Cloudflare Workers build passed.
- Voice/live-share remain capability-gated until `turn-credentials` is
  deployed with provider secrets and packaged two-client verification passes.
  Full detail: `PHASE_32_IMPLEMENTATION_REPORT.md`.
- Also fixed in this branch: migration `0004` contained accidental stray text
  ("ive ran") inside the `player_stats` DDL that would break fresh deploys.

## Phase 30 account/platform support

- PR #45 merged the Phase 30 backend Electron bridge
  for an optional read-only YouTube account connection. It uses a separate
  `youtube.readonly` consent grant and a separate encrypted credential file;
  it never changes the official player session.
- The shared Google PKCE flow now accepts only the two explicitly supported
  scopes (`drive.file` and `youtube.readonly`) and revokes a new grant if
  secure token persistence fails.
- Backend validation passed strict typecheck, all 283 tests across 25 files, the
  Discord Activity production build, and Windows Electron/NSIS packaging with
  publishing disabled.
- The frontend now uses this bridge in Settings with real Connect/Disconnect,
  connected-channel, capability-disabled, secure-storage, and retryable
  loopback-timeout presentation. It remains separate from the iframe session.
- Google Cloud and release-variable setup is documented in
  `GOOGLE_MEDIA_SETUP.md`. No credential values are committed.

## Phase 30 guidance, Drive delivery, and profile presentation

- PR #46 merged the searchable, categorized FAQ and a
  restartable first-run tour with real control highlighting, screen navigation,
  keyboard progress, persistent skip/finish state, responsive positioning, and
  reduced-motion handling.
- Google Drive's safe public desktop configuration is now injected into the
  Electron main bundle for local and Actions builds. Seven repository variables
  are configured; tokens and the optional client secret are not embedded.
- The Library now explains system-browser OAuth, Picker-only file grants,
  `safeStorage`, per-participant authorization, and actionable disabled versus
  incomplete configuration states without displaying credential values.
- Profile is rebuilt as a full-width Steam-inspired showcase with a wide
  atmosphere/artwork banner, profile level, real achievement highlight, activity
  grid, community sidebar, responsive cosmetics, and no invented stats.
- Appearance settings now accept a resized device-local JPEG/PNG/WebP background
  for the app and/or Profile. Images are sanitized, size-capped, never uploaded,
  and reset through the existing local settings store.
- The Settings workspace uses more of the available viewport, denser adaptive
  theme/backdrop grids, top-aligned cards, and a compact content pane so Appearance
  no longer stretches smaller cards inside oversized rows.
- Small-window breakpoints now collapse the Settings rail earlier, stack dense
  panes, compact short-height windows, keep every mobile destination scrollable,
  and expose a working Account-to-Library Drive shortcut.
- The official-player source mark now uses an atmosphere-driven glowing action
  treatment, and the Settings gear animates on hover/focus with reduced-motion
  fallbacks.
- Green locally: strict typecheck, 292 tests across 28 files, Discord Activity
  build, and Windows Electron/NSIS packaging. The packaged main bundle contains
  all three public Google identifiers and the enabled YouTube-account gate; the
  Activity bundle contains none of the Google identifiers.
- The Release workflow published `v0.1.25` with the installer, blockmap, and
  `latest.yml`.

## Phase 29 authorized media (backend and initial frontend merged)

- PR #39 merged the Phase 29 typed contracts, the Electron
  local-media platform, and migration `0022`. Every capability still defaults
  off. See
  `PHASE_29_BACKEND_STATUS.md`.
- Green on the merged local-media baseline: strict typecheck, 197 tests,
  Discord Activity build, and the full Windows installer/blockmap package.
- Migration `0022` and its RLS tests were deployed and passed in the owner
  environment on 2026-07-16.
- `backend/phase-29-drive` adds system-browser PKCE with a loopback redirect and
  `drive.file` only, `safeStorage`-encrypted refresh tokens with no plaintext
  fallback, a sandboxed non-persistent Picker whose metadata is revalidated in
  main, and per-participant Drive range streaming.
- Drive remains owner-gated and requires packaged OAuth acceptance plus
  two-client custom-media synchronization before room playback is enabled.
- Drive validation now passes strict typecheck, all 265 tests across 22 files,
  the Discord Activity build, and Windows Electron/NSIS packaging.
- `frontend/phase-29-library-ui` adds capability-gated navigation, local/Drive
  selection, fingerprint progress/cancellation, opaque lease playback, and
  native HTML video controls. The combined suite passes 268 tests across 23 files.
- Fixed on this branch: `main` could not typecheck or test at all, because Phase 28
  added component tests importing React Testing Library / user-event / jsdom without
  ever adding those dev dependencies to `package.json`.

## Release baseline

- Current public release: `v0.1.25`.
- Phase 24 frontend merged through PR #35, Phase 24 backend support merged through PR #34, and the complete Phase 25–28 frontend overhaul merged through PR #36.
- Migration `0021`, privacy-safe media presence, canonical Discord avatars, deeper Browse paging, and `search-youtube` details mode are present on `main`; database/function deployment still requires the owner environment.
- Releases remain intentional GitHub Actions runs after reviewed feature PRs; no direct push to `main`.
- The Phase 28 control/settings completion pass merged through PR #38 and Phase 29
  backend/platform support merged through PR #39.
- Google Drive support merged through PR #41 and the capability-gated Library
  frontend merged through PR #42.

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
- Verify the installed updater round-trip from `v0.1.23` to the next approved release.
- Verify the same-instance mini-player with two packaged clients and real YouTube caption tracks/languages; automated tests cover presentation continuity and official caption parameters, but live provider behavior remains an owner acceptance item.
- Claude's separately gated Phase 29 handoff is ready at `C:\Users\Blast\source\repos\NightWatch-fable\PHASE_29_MEDIA_LIBRARY_HANDOFF.md` for `backend/phase-29-media-library`; it explicitly excludes protected-service downloads, DRM extraction, media relays, and free-unlimited-cloud claims.
- Phase 29 local/Google Drive media remains separately gated and is not part of the Phase 24–28 completion gate.
