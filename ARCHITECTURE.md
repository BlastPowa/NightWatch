# NightWatch — Architecture

Status: Draft v1 — Phase 0 (Documentation & Planning)
Built from PRODUCT_REQUIREMENTS.md and the decisions logged in DESCISIONS.md (ADR-001 through ADR-017).

This document is the technical blueprint. No code is written here — implementation begins only after this is reviewed.

---

## 1. High-Level Shape

NightWatch is an Electron desktop app with **no custom backend server**. The Electron renderer talks directly to a single external service — **Supabase** — for realtime sync, chat, reactions, presence, and authentication. YouTube playback is handled entirely client-side via the official IFrame Player API, embedded in the renderer.

```
┌─────────────────────────────────────────────────────────┐
│                     Electron App (per user)               │
│                                                             │
│   ┌───────────────┐   IPC (contextBridge)   ┌───────────┐ │
│   │  Main Process  │◄────────────────────────►│ Renderer  │ │
│   │  (Node.js)     │                          │ (React)   │ │
│   └───────────────┘                          └─────┬─────┘ │
│                                                       │       │
└───────────────────────────────────────────────────────┼───────┘
                                                          │
                                    HTTPS/WSS              │
                                                          ▼
                                            ┌─────────────────────┐
                                            │      Supabase        │
                                            │  - Auth (Discord)    │
                                            │  - Realtime          │
                                            │    (Broadcast +      │
                                            │     Presence)        │
                                            └─────────────────────┘

                                            ┌─────────────────────┐
   Renderer also embeds ─────────────────► │ YouTube IFrame Player │
                                            │        API            │
                                            └─────────────────────┘
```

There is exactly one persistent external dependency (Supabase) and one embedded third-party player (YouTube IFrame API). No infrastructure is owned or operated by the project.

---

## 2. Electron Process Architecture

### 2.1 Main Process Responsibilities

The main process is kept intentionally minimal — it does **not** talk to Supabase or hold any application state. Its job is purely OS/window/lifecycle concerns:

- Create and manage the `BrowserWindow` (with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- Load the renderer bundle (Vite dev server in development, built static files in production).
- Handle app lifecycle events (ready, window-all-closed, activate, before-quit).
- Own the `electron-updater` auto-update check/download/install flow (this is the one piece of real "backend-like" logic in main — checking GitHub Releases for a newer version).
- Expose a narrow, explicit set of IPC channels via a preload script — nothing more than what the renderer genuinely needs from the OS layer (e.g., "get app version," "open external link in default browser," "trigger update check").
- Persist local-only client settings (theme, volume, video filters, guest nickname) to disk via a small local store (e.g., `electron-store`), since these are explicitly local/per-device per the PRD (§5.7) and must never touch Supabase.

### 2.2 Renderer Responsibilities

The renderer (React + TypeScript) owns all application logic and UI:

- Supabase client initialization and session management (Auth + Realtime).
- Room creation/join/leave flows.
- YouTube IFrame Player instantiation and event handling.
- Sync engine: translating local player events into Broadcast messages (if host) and translating incoming Broadcast messages into player commands (if viewer).
- Chat UI and message handling.
- Timed reactions UI, timeline markers, and animation triggering.
- Client-side personalization (theme, filters, volume) — read/write through the preload-exposed local settings bridge, never through Supabase.

The renderer runs with `contextIsolation` on and no direct Node.js access — it only reaches the OS layer through the preload bridge described below.

### 2.3 IPC Strategy

A single preload script exposes a minimal, typed API on `window.nightwatch` via `contextBridge.exposeInMainWorld`. Example surface (illustrative, not final naming):

- `nightwatch.settings.get() / set(partial)` — local-only settings persistence (main process reads/writes a local JSON store; renderer never touches the filesystem directly).
- `nightwatch.app.getVersion()`.
- `nightwatch.updates.check() / onUpdateAvailable(callback) / install()` — thin wrapper around `electron-updater` events.
- `nightwatch.shell.openExternal(url)` — for opening links (e.g., "Join Discord," release notes) in the OS default browser rather than in-app.

No IPC channel accepts arbitrary code, file paths, or Supabase credentials from the renderer — the preload surface is deliberately small and purpose-specific, consistent with Electron security best practice and the project's "no Instance/arbitrary references from untrusted input" philosophy (mirrored from the Roblox project's remote-handler discipline, applied here to IPC).

---

## 3. Backend Architecture (Supabase)

There is no custom backend service. "Backend architecture" here means how NightWatch is configured to use Supabase's managed services.

### 3.1 Auth

- Supabase Auth project configured with **Discord** as an OAuth provider (ADR-005).
- Sign-in flow: renderer triggers `supabase.auth.signInWithOAuth({ provider: 'discord' })`; Electron opens the OAuth flow in a system browser window (not an embedded webview, to avoid credential-harvesting concerns and to match Discord's/OAuth best practice for native apps), and the redirect is captured back into the app via a custom protocol handler (e.g., `nightwatch://auth-callback`) registered by the main process.
- **Guest mode**: users may skip Discord entirely and enter a free-text nickname, which is stored only locally (via the settings bridge) and used as the display name in Presence/Broadcast payloads. Guest users have no Supabase Auth session — they still connect to Realtime using the project's public anon key (Realtime access does not require an authenticated user, per ADR-004/005).

### 3.2 Realtime

Two Realtime primitives per room, both scoped to a per-room channel (channel name derived from the room's unique ID/code):

- **Presence**: tracks connected viewers (user id or guest id, display name, avatar if Discord, host flag). Presence automatically handles join/leave detection, which drives the "viewer joined/left" chat notifications and the host-reassignment logic.
- **Broadcast**: carries all transient events —
  - `playback:play` `{ atSeconds, emittedAt }`
  - `playback:pause` `{ atSeconds, emittedAt }`
  - `playback:seek` `{ atSeconds, emittedAt }`
  - `playback:load` `{ videoId, emittedAt }`
  - `chat:message` `{ text, sender, sentAt }`
  - `reaction:place` `{ emoji, atSeconds, sender }`

No Postgres tables are required for MVP room mechanics — rooms are pure Realtime channel state, matching the "room persistence is post-MVP" scope decision. Postgres remains available in the same Supabase project for post-MVP features (watch history, playlists, persistent rooms) without introducing a new service.

### 3.3 Authorization Model (MVP)

- Row Level Security is not the relevant control here since there's no DB table in the loop for room mechanics — the primary MVP control is Presence-derived: only the client currently marked `host: true` in Presence state is expected to emit `playback:*` broadcasts.
- **This is a client-side/soft enforcement**, called out explicitly in DESCISIONS.md ADR-006 and PRD §10 as an accepted MVP risk: a modified client could emit playback broadcasts while not flagged host. Given the target audience (private friend-group rooms, not public/adversarial), this is judged acceptable for MVP. If it needs hardening later, the documented upgrade path is routing `playback:*` broadcasts through a Supabase Edge Function that checks host status server-side before relaying — a change isolated to the sync engine, not a rearchitecture.

---

## 4. Room Lifecycle

1. **Create**: Host generates a room (a short code + Realtime channel name), joins the corresponding Presence/Broadcast channel, and is marked `host: true` in their own Presence payload.
2. **Join**: A viewer enters a room code/link, subscribes to the same channel, and appears in the Presence list as `host: false`.
3. **Late join**: On subscribing, a joining client requests current state (video id, playback position, play/pause state) — implemented as a one-time Broadcast request/response (`state:request` → host responds with `state:sync`) rather than relying on stale Presence metadata, so the joiner always gets a live snapshot from the current host.
4. **Playback control**: Host's local YouTube player events (play/pause/seek/video change) are translated into `playback:*` broadcasts; all other clients apply them to their own local player instance, with drift correction (see §6) rather than blindly re-seeking on every message.
5. **Host disconnect**: Presence's leave event fires for the host; remaining clients deterministically elect a new host (e.g., lowest-joined-timestamp remaining Presence member) and that client updates its own Presence payload to `host: true`. This must be deterministic and computed identically by every client to avoid two clients both believing they're host.
6. **Leave**: Client unsubscribes from the channel; Presence leave fires; if they were host, step 5 runs.
7. **Room end**: Channel simply has zero subscribers — nothing to tear down server-side since there's no server, consistent with the ephemeral/in-memory room model.

---

## 5. YouTube Player Communication Flow

1. Host pastes a YouTube URL into the room's "load video" input.
2. Client-side parsing extracts the video ID from standard (`youtube.com/watch?v=...`) and shortened (`youtu.be/...`) URL formats — no network call needed for this extraction.
3. Host's renderer broadcasts `playback:load { videoId }`.
4. Every client (including host) instantiates/updates its local `YT.Player` instance with that video ID via the official IFrame API.
5. The IFrame Player's own event callbacks (`onStateChange`, `onReady`) are the source of truth for local playback state; the sync engine listens to these callbacks to (a) drive outgoing broadcasts if this client is host, and (b) reconcile against incoming broadcasts if this client is a viewer.
6. Player errors (unembeddable/restricted video, etc. — PRD §10 risk 5) surface via the IFrame API's `onError` callback, which the app must handle by notifying the room (a `chat:message`-style system notice) rather than failing silently.

---

## 6. State Management & Drift Correction

- **Local state**: standard React state/context for UI; a dedicated `SyncEngine` module (renderer-side, framework-agnostic) owns the Realtime channel subscription and player-command translation, decoupled from UI components.
- **Drift correction**: viewers periodically compare their local player's `getCurrentTime()` against the last known host-reported position (extrapolated forward using `emittedAt` timestamps to account for network delay), and only issue a corrective seek if drift exceeds a defined tolerance (e.g., >1.5s). Corrective seeks do **not** re-trigger an outbound broadcast (viewers never broadcast `playback:*`, only the host does), which structurally prevents the feedback-loop risk flagged in PRD §10.2.
- **Chat/reactions state**: append-only local list per room session, populated from incoming Broadcast events; not persisted beyond the session (matches "no room persistence in MVP").

---

## 7. Feature Architecture Additions (Round 2)

Covers the newer MVP features from PRODUCT_REQUIREMENTS.md §5.6–§5.12. None of these introduce a new backend concept — they build on the same Presence/Broadcast/local-settings primitives already defined above.

### 7.1 Viewport Customization & Ad-Safety Layout Rules

- Visual filters (grayscale/inverted/sepia/high-contrast) and theme accents are implemented as CSS classes on a wrapper `<div>` that *contains* the YouTube iframe — the iframe's own DOM subtree is never targeted by filter styles, so YouTube's rendered pixels (including ads) are never visually altered by a filter that could be read as ad-tampering.
- The player wrapper enforces `min-width: 480px; min-height: 270px` as the working target, with an absolute floor of 200×200px per PRD §8.1 — these are CSS constraints on the wrapper itself, not just the iframe, so no parent layout (resizing the window, collapsing the sidebar) can compress the player below that floor.
- Chat sidebar, system log, stamp-reaction containers, and the timeline-tracker overlay all live in sibling DOM nodes positioned beside/around the player wrapper (CSS grid/flex layout) — never `position: absolute` layered on top of the iframe's bounding box. This is a structural rule, not just a styling preference, since it's what makes the "no overlay interference" compliance guardrail (PRD §8.1) enforceable by code review rather than relying on visual inspection alone.
- Native closed-caption toggling uses the IFrame Player's own `player.loadModule('captions')`/caption-track APIs — NightWatch never renders its own subtitle overlay.

### 7.2 Timeline-Tracker & Stamp Reactions

- A `TimelineTracker` component polls the local player's `getCurrentTime()` (already needed for drift correction, §6) and renders tick marks for existing reactions plus a click target for dropping a new one — positioned along a scrubber-adjacent strip, not over the video.
- Dropping a stamp emits `reaction:place { emoji, atSeconds, sender }` (already defined in §3.2). Every client's local `TimelineTracker` watches for its own `getCurrentTime()` crossing any known reaction's `atSeconds` and triggers the animation locally — the animation itself is never broadcast, only the reaction data, keeping payloads small.

### 7.3 System Log Sidebar

- A single `RoomActivityFeed` component consumes the existing Presence join/leave events and `playback:*`/`chat:message` broadcasts already defined in §3.2/§4, formatting them into either a chat bubble (for `chat:message`) or a system log line (for everything else) in one merged, timestamp-ordered list. No new event types are introduced — this is purely a presentation-layer merge of data the SyncEngine already receives.

### 7.4 Engagement Dashboard (Local)

- An `AchievementTracker` module (renderer-side) subscribes to the same local session events the rest of the app already produces (room-joined, room-left with duration, reaction placed, video loaded) and evaluates them against a local achievement rule set, persisting unlocked achievements via the same local settings bridge used for theme/volume (§2.1/§2.3) — no new IPC channel needed beyond the existing `nightwatch.settings.get()/set()`.
- The User Card view reads only from this local store. Per ADR-009, there is no Realtime or Postgres path for this data in MVP, so it cannot be viewed by other room members.

### 7.5 Discord Rich Presence

- Runs in the **main process** (Discord's native/RPC-style presence APIs are not accessible from a sandboxed renderer) using the Discord Application already created for OAuth (ADR-005) — same Client ID, no new Discord app registration.
- The renderer reports current playback state (video title/id, room name) to main via a new narrow IPC channel, e.g. `nightwatch.presence.update({ videoTitle, roomName })`, added to the preload surface defined in §2.3. Main process owns the actual Discord RPC connection lifecycle (connect on app start, update on renderer calls, clear on room leave/app quit).

### 7.6 In-App YouTube Search

- Renderer calls a Supabase Edge Function (e.g. `search-youtube`) rather than calling the YouTube Data API v3 directly — the Edge Function holds the real API key as a Supabase server-side secret and forwards the query to Google, returning only the fields the UI needs (title, thumbnail, video id, duration).
- The Edge Function enforces a per-user/guest-id rate limit (simple counter, resettable daily) to stay inside the free quota regardless of how many Electron installs exist — this is the same "no raw Google key in the shipped binary" principle already flagged in PRD §10.7 and ADR-011.
- This is the **only** case in the architecture where a server-side function is introduced; everything else remains Realtime/Auth/local-only. It's scoped narrowly (one Edge Function, one purpose) rather than growing into a general backend.

### 7.7 Client-Side Chat Profanity Filter

- Outgoing `chat:message` broadcasts are passed through a local word-filter library (e.g. a small offline package such as `obscenity`) in the sender's client before being broadcast — filtering happens once, at the source, so all recipients see the same filtered text without needing their own filter pass. Consistent with the existing client-side/soft-enforcement model already accepted for host authority (ADR-006).

---

## 8. Security Model

- **Electron hardening**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a minimal preload bridge (§2.3), no remote module, no arbitrary `shell.openExternal` targets without validation.
- **OAuth flow**: system-browser based (not embedded webview) with a custom protocol callback, avoiding in-app credential capture.
- **Supabase keys**: only the public anon key ships in the app (safe by design — see PRD §10.7, updated). No service-role key is ever embedded client-side.
- **Input handling**: chat messages and reactions are rendered as text/React nodes, never `dangerouslySetInnerHTML` or equivalent — eliminates the stored-XSS-via-chat surface called out in PRD §10.6.
- **No Instance/arbitrary-reference trust**: mirrors the Roblox project's remote-handler discipline — Broadcast payloads are validated/shape-checked on receipt (expected fields, bounded string lengths for chat/nicknames, numeric bounds for timestamps) before being applied to UI or player state, even though the "server" here is Supabase rather than a custom authority.
- **Rate limiting**: Supabase Realtime's own connection/message quotas provide a coarse backstop; client-side debouncing on chat send and reaction placement prevents accidental self-spam. Deliberate abuse from a modified client is accepted as an MVP-scope limitation per ADR-006, consistent with the private-room threat model.

---

## 9. Future Scalability Considerations

(Not built now — noted so today's choices don't block these later.)

- **Room capacity growth**: if usage approaches Supabase's free-tier 200 concurrent connection ceiling, the direct upgrade path is Supabase's paid tier (pay-per-additional-connection) — no architecture change required.
- **Server-authoritative control**: the Edge Function relay path noted in §3.3 is the designed escape hatch if client-side host enforcement proves insufficient.
- **Persistent rooms / accounts / watch history / playlists**: all map cleanly onto Supabase Postgres tables in the same project, using the Discord-authenticated user id already established by ADR-005 — no new identity system needed.
- **Cross-device Engagement Dashboard**: the local `AchievementTracker` store (§7.4) is designed so its data shape can be mirrored into a Postgres table (`achievements`, `watch_stats`) keyed by the Discord user id, with Row Level Security limiting each user to their own rows — the local module's read/write interface stays the same, only its storage backend changes (ADR-009).
- **Discord Activity (ADR-008)**: the renderer's core modules — `SyncEngine` (§6), `AchievementTracker` (§7.4), room/chat/reaction UI components — are written against a small platform-adapter interface (`PlatformBridge`) for the handful of things that differ between Electron and a browser-hosted Activity: local storage (Electron `electron-store` vs. browser `localStorage`/Discord SDK storage), OAuth flow (system-browser + custom protocol vs. Discord Activity's own auth handshake), and Rich Presence (Electron main-process RPC vs. the Discord Embedded App SDK's built-in Activity status). A future Activity build supplies a different `PlatformBridge` implementation and reuses everything else — this is a *design constraint to honor now*, not implementation work.
- **Cross-platform (desktop)**: main-process/renderer split and the Supabase-only backend have no Windows-specific dependency; adding Mac/Linux targets later is an electron-builder configuration change, not a rearchitecture (ADR-007).
- **Additional media providers**: the `playback:load` broadcast shape already carries a provider-agnostic-enough payload (`videoId`) that a future provider would extend rather than replace, if ever legally pursued.

### 9.1 Post-MVP Differentiation Architecture Notes

Forward-looking notes for PRODUCT_REQUIREMENTS.md §14 — not built now, so a future implementer isn't starting from zero:

- **Persistent Community Rooms (§14.1, ADR-012)**: introduces the first Postgres-backed table in the project — a `rooms` table (owner id, room code/slug, schedule, visibility) that the ephemeral Realtime channel is keyed against, rather than the channel *being* the room. Presence/Broadcast mechanics (§3.2) are unaffected; only room *creation/lookup* gains a persistence step.
- **Collaborative Queue & Voting (§14.2, ADR-013)**: modeled as a new Broadcast event family (`queue:add`, `queue:vote`, `queue:advance`) carrying an ordered array in Presence-adjacent shared state — same pattern as existing `playback:*` events, no new persistence layer.
- **Creator/Host Tools (§14.3, ADR-014)**: requires an opt-in event-logging path — likely a lightweight Edge Function (same pattern as §7.6's search proxy) that a host's client posts anonymized session events to, only when the host has enabled analytics for that room. Never default-on.
- **Deeper Social/Gamification (§14.4)**: direct continuation of the Cross-Device Engagement Dashboard upgrade path already described above in this section.

### 9.2 International Latency Verification (Phase 12)

Supabase's free tier is single-region — there's no free multi-region option. Phase 12 (Production Preparation) should explicitly test the drift-correction tolerance defined in §6 (currently ~1.5s) against a higher-latency client (e.g. a tester on another continent from the project's Supabase region) and confirm it still produces smooth playback without excessive corrective seeking. If it doesn't hold up, the fix is making the tolerance adaptive per client's measured round-trip time rather than switching infrastructure — true multi-region hosting is out of scope without moving to paid tiers (ADR-017).

---

## 10. Open Items Carried Forward

From PRODUCT_REQUIREMENTS.md §11 ("Still Open"), to be resolved before or during Phase 3 (Room System) implementation:

- Room capacity cap per room (independent of the platform-wide 200-connection ceiling).
- Room access model: short code vs. link vs. both, and whether private/password-protected rooms are needed.
- Room lifecycle edge case: any grace period before a room is considered "gone" when it hits zero Presence members, or strictly instantaneous.
- Baseline chat/reaction moderation (e.g., basic profanity filtering) — deferred decision, not blocking architecture.
