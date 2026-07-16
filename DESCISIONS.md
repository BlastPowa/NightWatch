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


---

## ADR-012

Decision:

Persistent/scheduled community rooms (Phase 14, post-MVP) require a Postgres-backed room record (room metadata, ownership, schedule) instead of the pure ephemeral Realtime-channel model used everywhere else.

Reason:

Rooms that must exist before anyone joins, survive being empty, and be reachable by a stable link cannot live purely in Realtime Presence/Broadcast state, which only exists while at least one client is subscribed. This is the first feature to require room data outside the ephemeral model — the rest of the architecture (Presence/Broadcast mechanics, sync engine) is unaffected and continues to run against whatever room record exists.


---

## ADR-013

Decision:

Collaborative queue & voting (Phase 15, post-MVP) is implemented within the existing Realtime Broadcast model — the queue is synced state (an ordered list) broadcast the same way `playback:*` events are, not a new Postgres-backed system.

Reason:

Unlike persistent rooms, a queue only needs to exist while people are actively in the room together — it doesn't need to survive an empty room. Keeping it in Broadcast avoids introducing persistence and Row Level Security work for a feature that doesn't need it.


---

## ADR-014

Decision:

Creator/host analytics (Phase 16, post-MVP) requires persisting session event data to Supabase Postgres, and must be explicitly opt-in per host/room.

Reason:

This is the first feature in the product that constitutes real telemetry/analytics — the original PRD explicitly scoped analytics as out-of-MVP (§6) specifically because no data collection existed. Introducing it later for a specific, valuable use case (host insight into their own audience) must not become silent/default data collection; hosts must opt in per room.


---

## ADR-015

Decision:

Monetization ideas (Pro room tier, in-app sponsorship/banner slots, B2B creator-analytics subscription) are documented for future consideration only. None are designed or built as part of this planning pass or the MVP.

Reason:

The user confirmed monetization is worth noting but not a current build priority. Documenting the ideas now (rather than omitting them) preserves the option without committing engineering time. Any future ad/sponsorship placement must stay confined to NightWatch's own UI (e.g. lobby/home screen) — never on, over, or near the YouTube player — to remain consistent with the existing ad-safety compliance guardrails (PRODUCT_REQUIREMENTS.md §8.1).


---

## ADR-016

Decision:

Add a dedicated in-app "About NightWatch" UI (Phase 11) that surfaces app version, patch notes/changelog, and a manual "Check for Updates" action, backed by the `electron-updater` + GitHub Releases mechanism already architected in ARCHITECTURE.md §2.1/§2.3.

Reason:

The auto-update mechanism itself was already planned (main-process `electron-updater` checking GitHub Releases), but had no user-facing surface — users would be updated silently at best, with no way to see what changed or manually trigger a check. This ADR adds the missing UI layer; it introduces no new update mechanism.


---

## ADR-017

Decision:

Acknowledge Supabase's free-tier single-region Realtime hosting as an MVP limitation for international users. Near-term mitigation is verifying and, if needed, tuning the drift-correction tolerance (ARCHITECTURE.md §6) during Phase 12 (Production Preparation) rather than pursuing multi-region infrastructure.

Reason:

There is no free multi-region low-latency option, so true global parity isn't achievable within the current zero-cost infrastructure constraint. The existing drift-correction tolerance already absorbs moderate latency; validating it against higher round-trip times (and considering an adaptive, per-client tolerance instead of a fixed constant) is a reasonable, low-cost mitigation. True multi-region support is documented as Future Expansion, contingent on moving to paid infrastructure.
---

## ADR-018

Decision:

Phase 29 custom media travels in its own versioned `media:v1:*` event namespace rather than by widening the existing `playback:*` / `sync:*` payloads, and those legacy events stay YouTube-only and byte-identical.

Reason:

A v0.1.x client binds `playback:load` expecting `{ videoId }`. Widening that payload to carry a local/Drive descriptor means an old client either misreads a fingerprint as a YouTube id or silently plays the wrong thing — a desync with no visible cause and no way for the old client to report it. A separate namespace makes an old client simply not hear the event, which is the correct behavior: it advertises no protocol version, so the host cannot start a custom-media session without first removing or notifying it. `ROOM_EVENTS` is asserted in tests to exclude `media:v1:*` so this cannot be undone by accident.

---

## ADR-019

Decision:

The renderer never receives a filesystem path or an OAuth token for custom media. It holds an opaque device-local handle and an opaque `nightwatch-media://stream/{leaseId}` URL; the main process alone maps those to real bytes, and the private scheme is registered without `bypassCSP`.

Reason:

The renderer is the part of the app that runs untrusted-ish content and is the realistic compromise target. A path in renderer state is a path in a crash report, a log line, or a room event the first time someone serializes application state without thinking about it — and the descriptor type is deliberately unable to express one, so that mistake will not typecheck. Leases live only in main-process memory and die with the process: a capability in a database is a capability someone else can use. `bypassCSP` is refused because the scheme needs exactly one privilege, `media-src`, and a general CSP escape reachable from renderer content is worth more to an attacker than the feature is to us.

---

## ADR-020

Decision:

Media identity is the SHA-256 fingerprint of the bytes plus the size. Never the filename, never the size alone. Local and Drive copies of identical bytes collapse to the same source key.

Reason:

Two participants each hold their own authorized copy of a file and will have renamed it differently; the filename is decoration. Matching on name or size would let a room play two different videos in lockstep and call it synchronized, which is worse than refusing to start, because it looks like it worked. Collapsing local and Drive to one key is what lets a Drive viewer and a local viewer sync without exchanging a single byte. A cached fingerprint is reused only when canonical path, size, and mtime all still match; anything else re-hashes.
