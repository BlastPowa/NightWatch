# Development Tasks

## Current Phase

Phase 15 — Collaborative Queue & Voting (Phase 14 deliberately sequenced after, owner's choice)


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


## In Progress

- Phase 15: three-client verification
- Pending owner: in-Activity video playback test; Google API key → Edge Function deploy; high-latency drift test


## Blocked
