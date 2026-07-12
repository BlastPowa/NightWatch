# Development Tasks

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
