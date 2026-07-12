# Development Tasks

## 2026-07-12 active frontend gate

- [x] Discord avatar CSP and resilient fallback.
- [x] Friends lifecycle and persistent direct/group Messages.
- [x] Accessible shelf arrows replacing exposed media scrollbars.
- [x] Consent-based friend presence settings.
- [x] Moment Notes with privacy filters, edit/delete, and host-synchronized seek.
- [x] Server-validated achievement profile borders.
- [x] Capability-gated Creator Club, bounty lifecycle, submissions, and voting.
- [x] Notification centre and unknown-kind-safe feed.
- [ ] Group membership/roles and centred `0014` system notices.
- [ ] Friend public profile/presence detail.
- [ ] Creator moderation/report/audit and moderated club discovery contract.
- [ ] Rebase with Phase 21 titlebar/installer branch; packaged two-client regression.
- [ ] Final rename/logo/installer art after owner supplies the exact public name.

## Current Phase

Phase 14 — Persistent Community Rooms


## Backlog

- Phase 12: production prep (packaging, installer, security review, international latency verification — ADR-017)
- Phase 13: Discord Activity (deferred, ADR-008)
- Phases 14-17 (post-MVP differentiation backlog): persistent community rooms, collaborative queue & voting, creator/host tools, deeper social/gamification — see ROADMAP.md and PRODUCT_REQUIREMENTS.md §14
- Deploy search-youtube Edge Function once Google API key exists (SETUP.md step 5)


## Completed

- Phase 1: full desktop foundation (verified)
- Phase 2: realtime foundation (verified)
- Phase 3: room system (verified)
- Phase 4: player integration (verified)
- Phase 5: playback synchronization (verified)
- Phase 6: chat + notifications (verified)
- Phase 7: reactions (verified)
- Phase 8: personalization (verified)
- Phase 9: UI overhaul (verified) — sidebar shell, cards, accent picker, animations, loading states, responsive
- Phase 10: Rich Presence, YouTube search (client + Edge Function code), profanity filter, engagement dashboard
- Phase 11: UpdateManager, update IPC + push channel, About screen, GitHub publish config
- Phase 12: logging, global error handling, security review (SECURITY_REVIEW.md), payload validation, adaptive drift tolerance, packaging polish


- Phase 13: PlatformBridge, Activity build target, Discord SDK bridge, fixed-room flow (deployed; DM launch verified)
- Release pipeline: tag-triggered Action, silent updates, packaged-build connection + playback fixes (v0.1.1–v0.1.6)
- Phase 15: QueueService, useQueue, QueuePanel, auto-advance


- Phase 15: queue & voting (verified) + Play Next
- Phase 14: migration, Discord OAuth deep link, PersistentRoomService, My Rooms UI


## In Progress

- Phase 20B frontend: Discord avatar repair, Friends lifecycle, and persistent realtime Messages implemented on `frontend/phase-20b-profile-social`; presence preferences, group member management, moment notes, and profile borders remain next.
- Phase 21 design/platform: public rename awaits the selected name; Figma node `2235:2839` inspection is quota-blocked; custom Windows title bar and assisted NSIS installer contract delivered to Opus.

- Phase 20A: persistent search, expanded category rail, cinematic video shelves, room-history continuation, collapsible room modules, and chat border correction implemented on `frontend/phase-20a-browse-player`.
- Phase 20B/20C: backend contract delivered in `PHASE_20_UI_BACKEND_HANDOFF.md`; frontend navigation remains hidden until capabilities report deployed support.

- Browse/watch-room overhaul: cinematic featured title, fuller responsive YouTube-style library grid, progressive result reveal, player-first room hierarchy, and clearer queue/chat/member modules on `frontend/browse-room-overhaul`.
- Shell/lobby polish: icon-led responsive navigation, cinematic create/join workspace, clearer queue voting hierarchy, and purposeful chat empty state implemented; visual review pending.
- Settings phase: macOS-style Appearance surface, glow actions, tactile switches, orbit loader, text scaling, transparency/focus accessibility controls, and playback presets implemented; cross-theme visual review pending.
- Backend handoff: paginate `search-youtube` trending/search results (currently hard-capped at 12) so Browse can expose 36–48 results without multiplying automatic quota usage; deploy the updated Edge Function after review.
- Feature PR automation hardening: treat an already-merged branch as a successful no-op instead of a failed PR-creation run.

- Advanced cinematic UI: discovery grid, categorized settings, branded startup, responsive/accessibility polish, and automated PR/release workflow are in review on `frontend/advanced-ui-overhaul`.

- Frontend cinematic polish: brand/shell implementation complete; core-flow visual QA and Figma canvas construction pending review/quota availability.
- Phase 13: owner deploy (Cloudflare Pages) + portal config + in-Discord verification
- Phase 12: owner release/install/update verification; high-latency drift test; Edge Function deployment pending API key
- Phase 14: owner runs migration + adds redirect URL, then sign-in/persistence verification
- Pending owner: in-Activity video playback test; Google API key → Edge Function deploy; high-latency drift test


## Blocked
