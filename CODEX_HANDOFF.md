# NightWatch frontend/backend handoff

Last updated: 2026-07-15 from `v0.1.22` (`6bb11fb`).

## Lane ownership

- Codex owns `frontend/phase-24-cinematic-shell` and the visual Phases 24–28.
- Claude owns `backend/phase-24-ui-support`; its exact typed contract is in `PHASE_24_UI_BACKEND_HANDOFF.md` in the backend worktree.
- Claude must not edit React visual components or shared CSS. Codex does not alter room event contracts, RLS, Electron bridges, or Edge Function security without the typed handoff.
- Feature PRs validate automatically. Reviewed automerge uses the repository trailer. Releases are manual Actions runs after packaged acceptance.

## Frontend direction

The user-supplied screenshots replace further Figma inspection. Adapt their compact shell, centered search, media hierarchy, player/recommendation relationship, banner profiles, hover actions, and purple-glass depth to NightWatch variables. Do not copy Papaya branding/assets. Preserve the NightWatch name, eclipse logo, 13 atmospheres, Custom Atmosphere, accessibility settings, and local/system fonts.

Browse is grid-first for discovery/search and uses shelves only for activity/history. The official YouTube iframe remains unchanged. No enabled control may be decorative or fake.

## Backend support required before dependent UI is enabled

1. `PlatformIdentity.avatarUrl` retains a canonical Discord CDN value and the platform resolver rewrites it for Activity.
2. `PresenceMeta` and `RoomMember` gain backward-compatible optional `avatarUrl`; public borders remain server validated.
3. `heartbeat_media_presence` publishes a coarse state plus optional safe title and strict 11-character YouTube ID.
4. `get_friend_presence_v2` respects explicit sharing and blocks, can return a safe avatar/border/video ID, and never returns room codes.
5. `search-youtube` `kind: "details"` returns the normalized media result shape with caching, quota accounting, and explicit unavailable/rate-limited outcomes.
6. Add migration/RLS tests for consent, blocks, invalid identifiers, and old-client compatibility.

## Stable invariants

- Social services return typed explicit outcomes; `not-ready` hides capability-gated navigation.
- Message paging uses `seq`; soft-deleted rows remain tombstone cursor slots.
- Public profiles never invent private stats, achievements, or mutual rooms.
- Presence is consent-safe and never exposes private room codes.
- YouTube content uses the official iframe only; NightWatch synchronizes state and never downloads/proxies video content.
- Client secrets and OAuth refresh tokens remain outside Supabase/browser state.

## Validation and merge order

1. Merge Claude's typed support contracts and tests.
2. Rebase the frontend phase onto current `main`.
3. Run `npm ci`, typecheck, tests, Activity build, Electron build with `--publish never`, and Windows packaging.
4. Review packaged desktop/compact visuals and two-client behavior.
5. Merge the reviewed frontend PR and deploy migrations/functions before enabling their UI.
6. Trigger Release manually only after acceptance.

Phase 29 local/Drive playback remains separately gated from the Phases 24–28 UI completion goal.
