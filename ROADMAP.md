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

# Phase 10 — Production Preparation

Status: Not Started

Features:

- Performance optimization
- Security review
- Packaging
- Windows installer
- Error handling
- Logging


---

# Phase 11 — Discord Activity (Future, Post-MVP)

Status: Not Started (deferred — see DESCISIONS.md ADR-008)

Goal:

Run NightWatch as a Discord Activity (Discord Embedded App SDK) inside a Discord voice/text channel, in addition to the standalone Electron app.

Features:

- Web build target sharing the renderer's core SyncEngine/room/chat/reaction logic via the `PlatformBridge` adapter (see ARCHITECTURE.md §9)
- Discord Activity registration and public hosting
- Discord SDK-based auth/presence/storage adapter implementations
- Responsive layout for in-Discord embedding


Not started until the Electron MVP (Phases 1–10) is complete.