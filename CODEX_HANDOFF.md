# NightWatch frontend/backend handoff

Last updated: 2026-07-13 after `main` reached `285c0be`.

## Current coordination state

- Phase 23 backend and UI are merged into `main` through PRs #31 and #32.
- The active frontend branch is `frontend/phase-22-card-theme-polish`. Do not edit its Browse, Settings, UserCard, SearchService, `discordBridge`, or `search-youtube` files from another lane.
- NightWatch is the final product name.
- Reviewed lane commits use the `Automerge: reviewed` trailer; ordinary pushes remain open. Releases are owner-initiated through **Actions > Release**.
- Never replace, obscure, proxy, or place interactive controls over the official YouTube iframe.

## Active frontend polish

This branch adds:

- a clean composite Browse focus state and conventional labeled Play button;
- real YouTube channel thumbnails through one cached, batched channels lookup, with initial fallbacks;
- a responsive My Card dashboard grid and six-column statistics;
- Avengers: Doomsday, Spider-Man: Brand New Day, Alien X, and Obsidian Black presets;
- a backward-compatible Custom Atmosphere builder for canvas/surface/panel colours;
- visual Midnight, Aurora, and Studio Backdrop choices.

Do not duplicate these changes in the backend lane.

## Phase 23 contracts now available

`SocialProfileService` exposes privacy-safe social profiles, blocked-user management, conversation-member presentation, and persistent-room invitations. `Relation` carries `avatarUrl` and `selectedBorderId`.

Rules the UI must preserve:

1. Missing stats, achievements, or mutual rooms mean they are private; never render invented zero values.
2. Blocked profiles return `blocked`, not an empty profile shell.
3. Stats and achievements have separate opt-ins.
4. Selected borders are server-validated; null means no valid public border.
5. Public avatars are restricted to Discord CDN URLs.
6. Invitations expire after seven days, are revocable/audited, and are limited to 20 per day.
7. Presence never exposes room codes and suggestions are not automatic friends.

## Owner/deployment steps before v0.1.22

1. Apply Phase 23 migration `0020` and run `supabase/tests/phase23_profiles_test.sql`. Until then the new social surfaces correctly hide behind `not-ready`.
2. Deploy the updated YouTube function for channel avatars:
   `supabase functions deploy search-youtube --no-verify-jwt`
3. Add `/ytchannel` -> `yt3.ggpht.com` to Discord Developer Portal URL Mappings before the next Activity deploy.
4. Verify migration `0019_list_my_clubs_visibility.sql` and redeploy `log-session` if highlights return no data.
5. Run packaged two-client create/join/sync/chat/reaction/queue/host-migration/reconnect tests.
6. Run a real Discord Activity launch, high-latency drift test, and updater verification.
7. Trigger the next release only after both the database and frontend polish are merged and verified.

## Stable invariants

- Social services return `SocialResult<T>`; `not-ready` means hide the feature.
- Message paging uses `seq`; soft-deleted rows remain tombstone cursor slots.
- Do not derive private/server-filtered state from directory search results.
- Highlights are timestamps and official-player seeks, never downloadable video.
- Client secrets and OAuth tokens remain server-side.

Exact Figma node inspection remains blocked by the Starter MCP quota; supplied screenshots and existing design references remain the visual source.
