# NightWatch Development Roadmap

## Current delivery state (2026-07-16)

`v0.1.24` is the public baseline. Phase 29's source-neutral contracts, secure local-file platform, owner-private Library migration `0022`, Google Drive PKCE/encrypted storage/Picker/range streaming, and the initial capability-gated Library frontend are merged. Phase 30 delivers public Drive configuration, searchable help, guided onboarding, a Steam-inspired profile showcase, device-local custom app/profile artwork, denser Settings presentation, and a separately consented read-only YouTube account connection. The active branch passes 292 tests plus Activity and Windows package builds. Room playback remains hidden until `media:v1:*` synchronization is implemented. NightWatch does not download YouTube, extract protected services, bypass DRM, relay participant media, or host a shared catalog. `STATUS.md`, `TASKS.md`, `PHASE_29_BACKEND_STATUS.md`, and `CODEX_HANDOFF.md` remain authoritative for active work.

## Phase 30 — Product guidance and identity presentation

Status: **Frontend implementation complete; reviewed PR delivery pending**

- Searchable FAQ and restartable onboarding tour.
- Safe public Drive configuration in local/Actions Electron builds.
- Library Drive setup/status and privacy explanation.
- Steam-inspired profile showcase with atmosphere or local custom artwork.
- Device-local custom app background with sanitation and reset controls.
- Denser Appearance workspace and reachable mobile navigation.
- Working read-only YouTube account connection with separate consent, encrypted
  credentials, explicit capability gating, and timeout guidance.

## Project Goal

Build a downloadable desktop watch-party application using Electron that allows users to watch YouTube content together in synchronized rooms while remaining compliant with YouTube policies.

---

# Phase 0 — Documentation & Planning

Status: Complete

Goals:

- Finalize product requirements
- Finalize architecture
- Define technical decisions
- Establish development workflow


Deliverables:

- PRODUCT_REQUIREMENTS.md
- ARCHITECTURE.md
- DECISIONS.md
- TASKS.md
- SETUP.md (manual account/credential setup tutorial)


---

# Phase 1 — Desktop Foundation

Status: Complete

Goal:

Create the Electron application foundation.

Features:

- Electron setup
- React renderer
- TypeScript
- Vite
- Secure preload system
- Context isolation
- IPC bridge
- Development scripts
- Build configuration


No application features yet.


---

# Phase 2 — Backend Foundation

Status: Complete (implemented as Supabase Realtime foundation per ADR-004, replacing the Node/Express/Socket.io plan below)

Goal:

Create communication infrastructure.

Features:

- Node.js server
- Express
- Socket.io
- Room service foundation
- Shared types
- Event architecture


---

# Phase 3 — Room System

Status: Complete

Features:

- Create room
- Join room
- Leave room
- Host assignment
- Presence
- Reconnection handling


---

# Phase 4 — YouTube Player Integration

Status: Complete

Features:

- YouTube IFrame API
- URL parsing
- Video loading
- Player abstraction
- Player events


---

# Phase 5 — Playback Synchronization

Status: Complete

Features:

- Play synchronization
- Pause synchronization
- Seek synchronization
- Timestamp synchronization
- Drift correction
- Late join synchronization


---

# Phase 6 — Social Features

Status: Complete

Features:

- Chat
- User presence
- Join notifications


---

# Phase 7 — Reaction System

Status: Complete

Features:

- Timestamp reactions
- Emoji stamps
- Timeline markers
- Animations


---

# Phase 8 — Personalization

Status: Complete

Features:

- Themes
- Local preferences
- Volume settings
- CSS video filters


---

# Phase 9 — UI/UX Polish

Status: Complete

Features:

- UI Verse inspired layouts
- Animations
- Modern dashboard
- Responsive design
- Loading states


---

# Phase 10 — Bonus Features & Engagement

Status: Complete (search Edge Function deployment pending owner's Google API key)

Goal:

Ship the already-scoped-but-unbuilt bonus features (DESCISIONS.md ADR-009, ADR-011) as part of the initial release, before production prep.

Features:

- Discord Rich Presence (ADR-011, ARCHITECTURE.md §7.5)
- In-app YouTube search via Supabase Edge Function proxy (ADR-011, ARCHITECTURE.md §7.6) — requires SETUP.md step 5 (Google Cloud API key) completed first
- Client-side chat profanity filter (ADR-011, ARCHITECTURE.md §7.7)
- Local Engagement Dashboard: achievement engine + User Card view (ADR-009, ARCHITECTURE.md §7.4)


---

# Phase 11 — Auto-Update & App Info

Status: Complete (full update round-trip verified as part of Phase 12 release testing)

Goal:

Give the auto-update mechanism (already architected in ARCHITECTURE.md §2.1/§2.3) a user-facing surface, per ADR-016.

Features:

- "About NightWatch" screen: current version, patch notes/changelog, manual "Check for Updates" button
- Wires the existing `electron-updater` + GitHub Releases mechanism into the UI — no new update mechanism, just the missing UI layer
- Goal: users update from inside the app, never needing to manually revisit GitHub


---

# Phase 12 — Production Preparation

Status: In Progress (code complete; release/install/update verification with the owner)

Features:

- Performance optimization
- Security review
- Packaging
- Windows installer
- Error handling
- Logging
- **International latency verification** (ADR-017, ARCHITECTURE.md §9.2): test drift-correction tolerance against a higher-latency client; tune if needed


---

# Phase 13 — Discord Activity (Future, Post-MVP)

Status: In Progress (code complete: PlatformBridge, Activity build target, Discord SDK bridge; awaiting hosting deploy + portal config + in-Discord verification)

Goal:

Run NightWatch as a Discord Activity (Discord Embedded App SDK) inside a Discord voice/text channel, in addition to the standalone Electron app.

Features:

- Web build target sharing the renderer's core SyncEngine/room/chat/reaction logic via the `PlatformBridge` adapter (see ARCHITECTURE.md §9)
- Discord Activity registration and public hosting
- Discord SDK-based auth/presence/storage adapter implementations
- Responsive layout for in-Discord embedding


Not started until the Electron MVP (Phases 1–12) is complete.


---

# Post-MVP Phases 14+ (all shipped except where noted)

Answers "why NightWatch over Discord Watch Together / YouTube" — see PRODUCT_REQUIREMENTS.md §2.1 and §14. The numbering below drifted from the phases actually built; this section now reflects what shipped. `STATUS.md` and `CODEX_HANDOFF.md` are the authoritative current state.

## Phase 14 — Persistent Community Rooms

Status: **Complete** (ADR-012) — `rooms` table + RLS, Discord PKCE login, My Rooms, reusable codes, scheduling.

## Phase 15 — Collaborative Queue & Voting

Status: **Complete** (ADR-013) — host-authoritative queue, vote-to-reorder, auto-advance.

## Phase 16 — Discovery Hub

Status: **Complete** — trending/search, room history, invite deep links.

## Phase 17 — Creator/Host Tools

Status: **Complete** (ADR-014) — opt-in session insights, premiere events. **Highlight-reel export was scoped here and never built** — the one outstanding item.

## Phase 18 — Deeper Gamification

Status: **Complete** — cross-device achievements (CloudSync), leaderboards, watch streaks.

## Phase 19 — Room Invites & RSVPs

Status: **Complete** — invites, RSVPs, co-watcher suggestions.

## Phase 20 — Social, Messaging, Moments, Creator Club

Status: **Backend complete** (migrations 0006–0013, all applied, all tests green). **No UI exists.** See PHASE_20_UI_BACKEND_HANDOFF.md for the spec and CODEX_HANDOFF.md for what remains.

## Phase 21 — Closing the gaps

Status: In progress — group system messages (0014), `set_conversation_role` (a real hole: group roles could never be set), unit tests + CI gate.

## Unscheduled

No phase is scheduled after 21. Candidates, none committed: mobile/web reach (the Activity build already proves the renderer runs outside Electron), club discovery, highlight-reel export, notification digests.

## Monetization Ideas (documented only — ADR-015, not a scheduled phase)

- Pro room tier (capacity, branding, highlight-export perk)
- In-app sponsorship/banner slots — confined to NightWatch's own UI, never near the player
- B2B creator-analytics subscription (built on Phase 16)
