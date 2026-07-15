# NightWatch development tasks

Last updated: 2026-07-15 during Phase 24 backend lane.

## Phase 24 backend lane (`backend/phase-24-ui-support`)

- [x] `sanitizeAvatarUrl` + additive `avatarUrl` on `PresenceMeta`/`RoomMember`; validate on derive, publish validated avatar; carry Discord avatar into presence.
- [x] Migration `0021`: `heartbeat_media_presence`, `get_friend_presence_v2`, `presence_preferences.video_id`, `safe_avatar_url`, `is_youtube_video_id`.
- [x] `FriendMediaPresence` type + `heartbeatMedia`/`getFriendMediaPresence`; `friendMediaPresence` capability probe.
- [x] `search-youtube` `kind: "details"` + typed `getVideoDetails(videoId, callerId)`.
- [x] `sanitizeAvatarUrl` unit tests + `phase24_media_presence_test.sql` (consent, blocks, invalid ids, safe avatar/border, stale parity, old-client compat, no room code).
- [ ] Owner: run the SQL test on a disposable DB; deploy `0021` then redeploy `search-youtube`; enable capability-gated Browse UI.

## Runtime QA follow-up

- [x] Remove the nested Browse search focus rectangle.
- [x] Add real YouTube channel avatars with a resilient fallback.
- [x] Rebuild My Card panels and statistics as responsive grids.
- [x] Replace the circular Browse Play control with a conventional labeled button.
- [x] Add four atmosphere presets, a Custom Atmosphere builder, and visual Backdrop choices.
- [ ] Deploy the updated `search-youtube` Edge Function for channel avatars.
- [ ] Add the Discord Activity `/ytchannel` URL mapping for `yt3.ggpht.com`.

- [x] Guard Browse category/search requests against stale responses.
- [x] Preserve search/history intent when retrying.
- [x] Make Browse actions visible on touch/coarse-pointer devices.
- [x] Make compact navigation scrollable instead of clipping destinations.
- [x] Add confirmation for appearance/all-settings resets.
- [x] Add persistent-message edit/delete and group rename.
- [x] Apply the sender-side profanity preference to persistent messages.
- [x] Make Reactions, Moment Notes, and room Discovery collapsible.
- [x] Run strict typecheck, unit tests, Activity build, Electron build, and NSIS packaging on the complete follow-up diff.
- [x] Merge the green runtime follow-up PR without starting another release.

## Manual acceptance

- [ ] Review packaged Browse, Room, Messages, Friends, Creator Club, Settings, About, startup, title bar, and installer visuals.
- [ ] Verify desktop, sub-900px, 620px/coarse-pointer, and compact Discord Activity layouts.
- [ ] Run two packaged clients through create/join/leave, sync, queue/voting, reactions, chat, notes, reconnect, and host migration.
- [ ] Test keyboard-only focus order, screen-reader names, touch targets, high contrast, reduced transparency, text scaling, and reduced motion.
- [ ] Verify `v0.1.20` to `v0.1.21` update installation.
- [ ] Confirm the GitHub Release contains installer, blockmap, and `latest.yml`.
- [ ] Complete a real Discord Activity launch and high-latency drift test.

## Phase 23 deployment

- [x] Privacy-safe public profiles, blocked-user management, member presentation, and persistent-room invitation backend.
- [x] Phase 23 Friends/Profile/Invitations frontend.
- [ ] Apply migration `0020` and run `supabase/tests/phase23_profiles_test.sql`.

## Deferred or deliberately unavailable

- [ ] YouTube account OAuth only after Google scopes, secure token storage, consent, revocation, and review are approved.
- [ ] Exact Figma node inspection after the Starter MCP quota resets.
- [ ] Code signing when a trusted Windows signing certificate is available.
- [ ] Broader discovery volume after YouTube API quota and pagination deployment are verified.

NightWatch remains the final product name. No rename work remains.
