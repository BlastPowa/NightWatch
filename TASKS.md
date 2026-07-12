# NightWatch development tasks

Last updated: 2026-07-12 after `v0.1.21`.

## Runtime QA follow-up

- [x] Guard Browse category/search requests against stale responses.
- [x] Preserve search/history intent when retrying.
- [x] Make Browse actions visible on touch/coarse-pointer devices.
- [x] Make compact navigation scrollable instead of clipping destinations.
- [x] Add confirmation for appearance/all-settings resets.
- [x] Add persistent-message edit/delete and group rename.
- [x] Apply the sender-side profanity preference to persistent messages.
- [x] Make Reactions, Moment Notes, and room Discovery collapsible.
- [x] Run strict typecheck, unit tests, Activity build, Electron build, and NSIS packaging on the complete follow-up diff.
- [ ] Merge the green follow-up PR without starting another release.

## Manual acceptance

- [ ] Review packaged Browse, Room, Messages, Friends, Creator Club, Settings, About, startup, title bar, and installer visuals.
- [ ] Verify desktop, sub-900px, 620px/coarse-pointer, and compact Discord Activity layouts.
- [ ] Run two packaged clients through create/join/leave, sync, queue/voting, reactions, chat, notes, reconnect, and host migration.
- [ ] Test keyboard-only focus order, screen-reader names, touch targets, high contrast, reduced transparency, text scaling, and reduced motion.
- [ ] Verify `v0.1.20` to `v0.1.21` update installation.
- [ ] Confirm the GitHub Release contains installer, blockmap, and `latest.yml`.
- [ ] Complete a real Discord Activity launch and high-latency drift test.

## Backend/UI contract still required

- [ ] Phase 23 privacy-safe public friend profiles with avatars, selected borders, opt-in stats/achievements, mutual rooms, and permissions.
- [ ] Blocked-user listing and complete block/unblock management.
- [ ] Safe conversation-member display names, avatars, and selected borders.
- [ ] Explicit accepted-friend party invite/notification RPC if one-click Invite is retained as a product requirement.

## Deferred or deliberately unavailable

- [ ] YouTube account OAuth only after Google scopes, secure token storage, consent, revocation, and review are approved.
- [ ] Exact Figma node inspection after the Starter MCP quota resets.
- [ ] Code signing when a trusted Windows signing certificate is available.
- [ ] Broader discovery volume after YouTube API quota and pagination deployment are verified.

NightWatch remains the final product name. No rename work remains.
