# Architecture Decisions

## Decision Log


## ADR-001

Decision:

Use Electron instead of a browser-only application.

Reason:

The application requires a downloadable desktop experience while still using browser-compatible YouTube playback.


---

## ADR-002

Decision:

Use official YouTube IFrame Player API.

Reason:

Maintains compliance with YouTube policies.


---

## ADR-003

Decision:

Synchronize playback state instead of video streams.

Reason:

Avoids illegal streaming behavior and reduces infrastructure complexity.


---

## ADR-004

Decision:

Use Supabase Realtime (Broadcast + Presence channels) instead of a self-hosted Node.js + Socket.io server for room sync, chat, and reactions.

Reason:

No permanent free host exists anymore for an always-on WebSocket server (Render free tier sleeps after 15 minutes idle and drops connections; Fly.io removed its free tier in 2024). Supabase Realtime's free tier (200 concurrent connections, 2M messages/month, no spin-down) covers MVP needs at zero cost, removes an entire server component to build/deploy/maintain, and the team already has Supabase experience.


---

## ADR-005

Decision:

Use Supabase Auth with Discord as the primary OAuth provider, with a guest/plain-username fallback that skips authentication entirely.

Reason:

The target audience is Discord-using friend groups. Supabase Auth supports Discord OAuth natively in the same project already used for Realtime, avoiding a separate identity service. Guest mode is retained so a Discord account is never a hard requirement to join a room.


---

## ADR-006

Decision:

Only the current room host may control playback (play, pause, seek, load video) for MVP. Enforced client-side by checking the Presence-assigned host flag before emitting control broadcasts.

Reason:

Matches typical watch-party UX (e.g. Discord Watch Together, Teleparty) and avoids conflict-resolution complexity from multiple simultaneous controllers. Accepted as a soft/client-side enforcement for MVP since Realtime Broadcast has no built-in per-message server-side authorization; if this needs hardening later, the upgrade path is a Supabase Edge Function acting as an authorization relay without changing the rest of the architecture.


---

## ADR-007

Decision:

Target Windows only for the initial build and installer.

Reason:

Matches ROADMAP.md Phase 10 ("Windows installer"). Electron-builder still allows Mac/Linux targets to be added later without a rewrite, so this does not foreclose cross-platform support.


---

## ADR-008

Decision:

Defer Discord Activity support (running inside Discord via the Discord Embedded App SDK) to a future phase. MVP targets the Electron desktop app only. The renderer's core logic (SyncEngine, room/chat/reaction components) is kept decoupled from Electron-only APIs (IPC, local file settings) behind a thin platform-adapter interface.

Reason:

A Discord Activity is a publicly-hosted web app embedded in an iframe — a fundamentally different runtime and hosting requirement than a locally-run Electron app (ADR-001). Building both at once significantly expands MVP scope before the desktop app itself exists. Keeping the renderer core platform-adapter-decoupled now avoids a rewrite if/when a future web/Activity build is undertaken.


---

## ADR-009

Decision:

Engagement Dashboard data (achievements, watch-time milestones, user card) is stored local-only for MVP, using the same local settings store as theme/volume/filters. No Supabase Postgres tables for this in MVP.

Reason:

Keeps the "zero Postgres writes in MVP" architecture (ADR-004/§3.2) intact and avoids taking on database schema and Row Level Security design before the core sync/room features are built. Cross-device sync is a clean upgrade path later since Postgres already lives in the same Supabase project.


---

## ADR-010

Decision:

All UI themes (Electric Teal, Shiny Gold, Legacy) are free and available to every user in MVP. No monetization or payment gating.

Reason:

Keeps the project entirely within free-tier infrastructure with no payment processing integration, matching the stated goal of building NightWatch without ongoing cost. "Premium" in the theme name describes its visual style, not an access tier.


---

## ADR-011

Decision:

Add three MVP bonus features, all free-tier: Discord Rich Presence (via the same Discord Application used for OAuth), in-app YouTube search (via the free YouTube Data API v3 tier, proxied through a Supabase Edge Function that holds the API key server-side and rate-limits per user/guest id), and a client-side chat profanity filter (offline word-filter library, no API).

Reason:

All three were explicitly requested and confirmed as in-scope. None require new paid infrastructure — Rich Presence reuses the existing Discord Application, YouTube search proxying stays inside the already-free Supabase stack (and avoids shipping a raw Google API key inside the Electron binary, an extraction risk noted in PRODUCT_REQUIREMENTS.md §10.7), and the profanity filter is a local library with no external dependency.