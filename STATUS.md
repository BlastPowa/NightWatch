# NightWatch current status

Last updated: 2026-07-15.

## Release baseline

- Current public release: `v0.1.22`.
- Phase 24 frontend merged through PR #35, Phase 24 backend support merged through PR #34, and the complete Phase 25–28 frontend overhaul merged through PR #36.
- Migration `0021`, privacy-safe media presence, canonical Discord avatars, deeper Browse paging, and `search-youtube` details mode are present on `main`; database/function deployment still requires the owner environment.
- Releases remain intentional GitHub Actions runs after reviewed feature PRs; no direct push to `main`.

## Merged cinematic overhaul

- The reviewed `frontend/phase-25-player-room` tree is merged into `main` through PR #36; there are no outstanding frontend changes on that branch.
- Phase 25: player-first room, official iframe preserved, trusted video/channel details below the player, responsive Up Next/Chat/People/Moments/Discover dock, real member avatars, and keyboard tab navigation.
- Phase 26: banner-led profile, searchable friend cards, authorized-roster message avatars, compact messaging states, consent-safe `Friends are watching` shelf, and v2 media heartbeat publishing.
- Phase 27: live Settings preview, custom-palette contrast guidance, improved backdrop previews, cinematic About/update screen, and refreshed lobby/Parties surfaces.
- Phase 28: dev-only React Testing Library, user-event, and jsdom; interaction coverage for shell search/navigation, avatar fallback, and room dock keyboard behavior.

## Validation completed

- `npm ci` passes.
- Strict TypeScript passes.
- 55/55 tests pass across 10 files.
- Discord Activity production build passes.
- Electron/NSIS build with `--publish never` passes and produces installer + blockmap.
- Responsive browser review passes at 1280x800, 940x600, 820px collapsed rail, and 600px mobile navigation.
- The safe transitive Discord REST/Undici security update is applied; the production audit now has no high-severity finding. Two moderate `uuid` advisories require a breaking Discord Activity SDK upgrade and remain separately gated.

## Required owner/platform acceptance

- Run `supabase/tests/phase24_media_presence_test.sql` against a disposable database, then deploy migration `0021` and redeploy `search-youtube` before relying on the capability-gated friend-media shelf.
- Run a real two-client packaged regression: create/join, playback drift, queue, host migration, chat, reactions, notes, reconnect, invites, messaging, and Creator Club.
- Verify real Discord Activity avatar URL mappings and launch behavior.
- Verify the installed updater round-trip from `v0.1.22` to the eventual overhaul release.
- Phase 29 local/Google Drive media remains separately gated and is not part of the Phase 24–28 completion gate.
