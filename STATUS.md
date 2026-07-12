# NightWatch current status

Last updated: 2026-07-12.

## Release state

- Current tag and `main`: `v0.1.21` at `f34963e`.
- The Release GitHub Action completed successfully.
- Phase 22 UI/brand work shipped in `v0.1.20`; `v0.1.21` adds the Windows startup-window fix.
- All earlier frontend and backend lane branches were merged before the runtime-fix follow-up began.

## Shipped UI

- Professional Browse search, fifteen categories, cinematic shelves, explicit arrow navigation, pagination, history, and thumbnail fallbacks.
- Player-first room with the official YouTube iframe, below-player host controls, queue, chat, members, reactions, sync state, schedules/premieres, insights, moment notes, and discovery.
- Friends, persistent DMs/groups, presence preferences, profile borders, notifications, Creator Clubs/bounties/moderation, and highlight timestamps.
- Eight atmospheres, custom accents, glow/radius/density/backdrop, playback filters, privacy, accessibility, and local reset controls.
- New NightWatch eclipse logo family, startup treatment, taskbar icon, Discord/Activity assets, native Windows title bar, and custom NSIS artwork.

## Active branch

`frontend/phase-22-runtime-fixes` addresses runtime defects found after the first visual pass: stale Browse requests, touch/compact navigation, Settings reset safety, persistent collapsible room modules, message edit/delete, group rename, and persistent-message profanity filtering.

## Verified gates

- Phase 22 merge: strict TypeScript, 39 unit tests, Activity build, Electron renderer/main/preload build, and Windows NSIS packaging passed.
- The follow-up branch passes strict TypeScript, the unit suite, Activity build, Electron renderer/main/preload build, and Windows NSIS packaging with `--publish never`.

## Not yet proven

- Hands-on packaged visual review at desktop, sub-900px, and compact Activity sizes.
- Packaged two-client create/join/sync/chat/reactions/queue/host migration/reconnect regression.
- Real Discord Activity launch and high-latency drift verification.
- Installed updater path from `v0.1.20` to `v0.1.21`.
- Release asset presence (`.exe`, `.blockmap`, `latest.yml`) in the GitHub Release entry.
- Rich friend profile/block-management UI, which requires the Phase 23 backend fields in `PHASE_23_SOCIAL_UI_BACKEND_HANDOFF.md`.
