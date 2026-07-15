# NightWatch current status

Last updated: 2026-07-15.

## Phase 24 backend lane (in progress)

- Branch `backend/phase-24-ui-support` off `main` @ `v0.1.22`: identity/presence avatar contracts, consent-safe friend media presence (migration `0021`), and `search-youtube` video details. All additive; typecheck, JS tests (49), `build:activity`, and Electron `build --publish never` are green.
- Pending owner (database/deploy): run `supabase/tests/phase24_media_presence_test.sql` against a disposable DB, then deploy migration `0021` → redeploy `search-youtube` → enable capability-gated Browse UI. No new API keys required (`YOUTUBE_API_KEY` already covers `kind: "details"`).

## Release state

- Current tag: `v0.1.21` at `f34963e`. Current `main`: `285c0be`, including runtime fixes and the Phase 23 backend/UI.
- The Release GitHub Action completed successfully.
- Phase 22 UI/brand work shipped in `v0.1.20`; `v0.1.21` adds the Windows startup-window fix.
- All earlier frontend and backend lane branches were merged before the runtime-fix follow-up began.

## Shipped UI

- Professional Browse search, fifteen categories, cinematic shelves, explicit arrow navigation, pagination, history, and thumbnail fallbacks.
- Player-first room with the official YouTube iframe, below-player host controls, queue, chat, members, reactions, sync state, schedules/premieres, insights, moment notes, and discovery.
- Friends, persistent DMs/groups, presence preferences, profile borders, notifications, Creator Clubs/bounties/moderation, and highlight timestamps.
- Thirteen atmosphere choices (including Obsidian and Custom), custom accents, glow/radius/density/backdrop, playback filters, privacy, accessibility, and local reset controls after the active polish branch merges.
- New NightWatch eclipse logo family, startup treatment, taskbar icon, Discord/Activity assets, native Windows title bar, and custom NSIS artwork.

## Active branch

`frontend/phase-22-card-theme-polish` fixes Browse search focus, real YouTube channel avatars, conventional card Play actions, the My Card dashboard grid, four new presets, Custom Atmosphere, and visual Backdrop choices.

## Verified gates

- Phase 22 merge: strict TypeScript, 39 unit tests, Activity build, Electron renderer/main/preload build, and Windows NSIS packaging passed.
- The active polish branch passes strict TypeScript, 43 unit tests, Activity build, Electron renderer/main/preload build, and Windows NSIS packaging with `--publish never`.

## Not yet proven

- Hands-on packaged visual review at desktop, sub-900px, and compact Activity sizes.
- Packaged two-client create/join/sync/chat/reactions/queue/host migration/reconnect regression.
- Real Discord Activity launch and high-latency drift verification.
- Installed updater path from `v0.1.20` to `v0.1.21`.
- Release asset presence (`.exe`, `.blockmap`, `latest.yml`) in the GitHub Release entry.
- Phase 23 migration `0020` and its acceptance test have not yet been verified against the live Supabase project.
