# NightWatch Development Roadmap

## Project Goal

Build a downloadable desktop watch-party application using Electron that allows users to watch YouTube content together in synchronized rooms while remaining compliant with YouTube policies.

---

# Phase 0 — Documentation & Planning

Status: Not Started

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

Status: Not Started

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

Status: Not Started

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

Status: Not Started

Features:

- Create room
- Join room
- Leave room
- Host assignment
- Presence
- Reconnection handling


---

# Phase 4 — YouTube Player Integration

Status: Not Started

Features:

- YouTube IFrame API
- URL parsing
- Video loading
- Player abstraction
- Player events


---

# Phase 5 — Playback Synchronization

Status: Not Started

Features:

- Play synchronization
- Pause synchronization
- Seek synchronization
- Timestamp synchronization
- Drift correction
- Late join synchronization


---

# Phase 6 — Social Features

Status: Not Started

Features:

- Chat
- User presence
- Join notifications


---

# Phase 7 — Reaction System

Status: Not Started

Features:

- Timestamp reactions
- Emoji stamps
- Timeline markers
- Animations


---

# Phase 8 — Personalization

Status: Not Started

Features:

- Themes
- Local preferences
- Volume settings
- CSS video filters


---

# Phase 9 — UI/UX Polish

Status: Not Started

Features:

- UI Verse inspired layouts
- Animations
- Modern dashboard
- Responsive design
- Loading states


---

# Phase 10 — Bonus Features & Engagement

Status: Not Started

Goal:

Ship the already-scoped-but-unbuilt bonus features (DESCISIONS.md ADR-009, ADR-011) as part of the initial release, before production prep.

Features:

- Discord Rich Presence (ADR-011, ARCHITECTURE.md §7.5)
- In-app YouTube search via Supabase Edge Function proxy (ADR-011, ARCHITECTURE.md §7.6) — requires SETUP.md step 5 (Google Cloud API key) completed first
- Client-side chat profanity filter (ADR-011, ARCHITECTURE.md §7.7)
- Local Engagement Dashboard: achievement engine + User Card view (ADR-009, ARCHITECTURE.md §7.4)


---

# Phase 11 — Auto-Update & App Info

Status: Not Started

Goal:

Give the auto-update mechanism (already architected in ARCHITECTURE.md §2.1/§2.3) a user-facing surface, per ADR-016.

Features:

- "About NightWatch" screen: current version, patch notes/changelog, manual "Check for Updates" button
- Wires the existing `electron-updater` + GitHub Releases mechanism into the UI — no new update mechanism, just the missing UI layer
- Goal: users update from inside the app, never needing to manually revisit GitHub


---

# Phase 12 — Production Preparation

Status: Not Started

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

Status: Not Started (deferred — see DESCISIONS.md ADR-008)

Goal:

Run NightWatch as a Discord Activity (Discord Embedded App SDK) inside a Discord voice/text channel, in addition to the standalone Electron app.

Features:

- Web build target sharing the renderer's core SyncEngine/room/chat/reaction logic via the `PlatformBridge` adapter (see ARCHITECTURE.md §9)
- Discord Activity registration and public hosting
- Discord SDK-based auth/presence/storage adapter implementations
- Responsive layout for in-Discord embedding


Not started until the Electron MVP (Phases 1–12) is complete.


---

# Post-MVP Differentiation Backlog (Phases 14+, not yet scheduled)

Answers "why NightWatch over Discord Watch Together / YouTube" — see PRODUCT_REQUIREMENTS.md §2.1 and §14 for full detail. Priority order confirmed by the project owner:

## Phase 14 — Persistent Community Rooms

Status: Backlog (ADR-012)

- Permanent/reusable room links
- Scheduled watch parties
- Cross-Discord-server room access
- First feature requiring a Postgres-backed room record — see ARCHITECTURE.md §9.1

## Phase 15 — Collaborative Queue & Voting

Status: Backlog (ADR-013)

- Shared video queue, voting/reordering, auto-advance
- Stays within the existing Realtime Broadcast model

## Phase 16 — Creator/Host Tools

Status: Backlog (ADR-014)

- Host analytics (watch-time retention, reaction density by timestamp)
- Highlight-reel export
- Premiere-style scheduled events
- Requires opt-in telemetry persistence — never default-on

## Phase 17 — Deeper Social & Gamification

Status: Backlog

- Cross-device Engagement Dashboard (Postgres + RLS upgrade of Phase 10's local version)
- Cross-friend-group leaderboards, watch streaks, shared achievements

## Monetization Ideas (documented only — ADR-015, not a scheduled phase)

- Pro room tier (capacity, branding, highlight-export perk)
- In-app sponsorship/banner slots — confined to NightWatch's own UI, never near the player
- B2B creator-analytics subscription (built on Phase 16)