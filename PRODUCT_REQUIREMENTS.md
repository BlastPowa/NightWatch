# NightWatch — Product Requirements Document

Status: Draft v1 — Phase 0 (Documentation & Planning)
Prepared by: Senior Product Manager / Software Architect role (per CLAUDE.md)

---

## 1. Product Overview

**NightWatch** is a downloadable desktop application (built with Electron) that lets groups of people watch YouTube videos together in real-time, synchronized rooms.

The application does not stream, download, proxy, or modify YouTube content in any way. All video playback is rendered through the official YouTube IFrame Player API. NightWatch's sole technical contribution is synchronizing *playback state* (play, pause, seek, current video) across everyone in a room, plus a layer of social features (chat, reactions, personalization) around that shared viewing experience.

Distribution model: a native Windows executable (installer), built and packaged via Electron, rather than a browser-hosted web app. This is a deliberate choice (see ADR-001) to give the product a "real app" feel and a persistent taskbar presence, while still relying on browser-grade web technology (YouTube IFrame API) for the actual video content.

---

## 2. Goals

- Let a group of friends watch YouTube together as if they were in the same room, regardless of physical location.
- Keep playback perfectly (or near-perfectly) in sync across all viewers, including viewers who join late.
- Provide lightweight social features (chat, timed reactions) that make the shared experience feel alive without interfering with the video itself.
- Remain fully compliant with YouTube's Developer Policies and Terms of Service at all times — compliance is a hard constraint, not a nice-to-have.
- Ship as a polished, installable desktop app rather than a bookmarked website.

### Non-Goals (explicitly out of scope for the product, not just MVP)

- NightWatch is not a video hosting, downloading, or streaming-proxy service.
- NightWatch is not a general-purpose media player (no local file playback, no non-YouTube sources in MVP).
- NightWatch is not a monetized ad-replacement product — it must never interfere with YouTube's own monetization or advertising.

---

## 3. Target Users

- Friend groups who want to watch YouTube content (videos, let's-plays, music, reaction content, etc.) together while physically apart.
- Small-to-medium groups per room (exact cap is an open question — see §9).
- Users comfortable installing a desktop application (as opposed to purely browser-based tools).

---

## 4. Core User Experience

The intended flow is simple and low-friction:

1. User opens the NightWatch desktop app.
2. User creates a room, or joins an existing room (e.g., via room code/link).
3. The room host pastes a standard or shortened YouTube URL.
4. The app extracts the video ID and loads it into the official YouTube IFrame Player.
5. Everyone in the room watches the same video, in sync.
6. When the host (or any authorized viewer, depending on room permission model — see open questions) plays, pauses, or seeks, all connected viewers stay in sync automatically.
7. Users can chat and drop timed reactions without disrupting playback sync for anyone else.
8. Users can personalize their own local viewing experience (theme, volume, video filters) without affecting other viewers.

The experience should feel responsive, reliable, and modern — sync lag and jitter are treated as critical quality bars, not cosmetic issues.

---

## 5. MVP Feature Set

### 5.1 Room System

- Create a room.
- Join a room (via code or link).
- Leave a room.
- Host assignment on room creation.
- Automatic host transfer if the host disconnects.
- Viewer presence (who's currently in the room).
- Late-join synchronization — a user joining mid-video is brought to the correct playback position and state immediately.

### 5.2 Official YouTube Playback

- Uses only the official YouTube IFrame Player API — no alternative playback mechanism.
- Accepts standard YouTube URLs and shortened (`youtu.be`) URLs.
- Player behavior:
  - Initializes dynamically per room/video.
  - Detects playback state changes (play/pause/buffering/ended).
  - Detects seek events.
  - Tracks current playback position.
  - Preserves native YouTube player controls.
  - Preserves ads and required branding — never hidden, blocked, or skipped programmatically.

### 5.3 Playback Synchronization

Synchronized across all viewers in a room:

- Play
- Pause
- Seek
- Load video (host changes the video)
- Playback position
- Late-join state

Includes drift correction to keep viewers aligned over time without causing visible stutter, unnecessary re-seeking, or feedback loops (e.g., client A's correction should not trigger a correction on client B that bounces back to A).

### 5.4 Real-Time Communication Layer

- Socket.io, using room-based channels/namespaces.
- Event-driven, lightweight message payloads (state deltas, not full state dumps, where practical).

### 5.5 Chat

Real-time text chat scoped to a room — usernames, message timestamps, emoji support, and join/leave notifications. Expanded into a combined chat/system-log sidebar in §5.8 below.

### 5.6 Timestamped Stamp Reactions

- A timeline-tracker overlay sits around/beside the video scrubber, monitoring the current timestamp.
- Users can click a floating reaction button (or drop a short text snippet) to attach an emoji/text reaction to the exact current timestamp.
- When shared playback crosses that timestamp for any connected viewer, the reaction animates for everyone — floats up or flashes in a reaction panel positioned adjacent to, never on top of, the video frame (see §8 ad-safety guardrails).
- Reactions render as a brief animation (not a persistent UI element).
- A timeline marker indicates where reactions are anchored on the video scrubber.

### 5.7 Individualized Viewport Customization (Client-Side Only)

Entirely local, never synchronized, never visible to other viewers, and never applied to the YouTube player itself:

- **Visual filters**: toggleable CSS overlays on a wrapper *around* the iframe only — Grayscale/Monochrome, Inverted Colors, Sepia, High Contrast.
- **UI theme accents**: switch the client dashboard skin between **Electric Teal** (base), **Shiny Gold**, and **Legacy** layout — all free for every user (see DESCISIONS.md ADR-010), purely cosmetic naming, no access gating.
- **Independent audio & captions**: local volume slider, local mute, and toggling the YouTube IFrame Player's own native closed-caption tracks — not a custom subtitle system, just exposing the official player's existing CC controls per-user.
- Locally persisted settings (per device/user), stored the same way as room-independent preferences already covered above.

### 5.8 Watch Party Rooms & System Log Sidebar

Refines and extends §5.5 Chat:

- Host-driven playback engine: play, scrub, and video-change actions trigger instant state broadcasts to the room (see ARCHITECTURE.md §3.2 for the underlying event shape).
- A sidebar merges the real-time group chat from §5.5 with automated system log lines — e.g., "User joined room", "Host jumped to 04:20", "Video swapped to ID: [x]" — generated from the same room/playback events, not a separate system.

### 5.9 Engagement Dashboard (Local, Gamified Activity Profile)

- **Achievement engine**: local milestones tracked as the user interacts with the app — e.g., time spent in a room, distinct videos watched, reactions dropped — persisted via the same local settings store as theme/volume (no server round-trip).
- **User Card view**: a separate tab showing the user's own local achievements and a short bio. In MVP this is private to the user's own device — it is *not* a shared/public profile visible to other room members, since that would require the cross-device persistence explicitly deferred to Future Expansion (see §6, DESCISIONS.md ADR-009).

### 5.10 Discord Rich Presence

- While in a room, the user's Discord status shows "Watching [video] on NightWatch."
- Uses the same Discord Application already configured for OAuth sign-in (DESCISIONS.md ADR-005) — no separate account or credential needed.

### 5.11 In-App YouTube Search

- Users can search YouTube from within the app instead of only pasting a URL.
- Backed by the free YouTube Data API v3 tier, accessed through a server-side proxy (a Supabase Edge Function holding the real API key) rather than embedding the key in the distributed Electron binary — see PRD §10.7 and ARCHITECTURE.md for the key-handling rationale.
- Rate-limited per user/guest id to stay comfortably within the free daily quota.

### 5.12 Client-Side Chat Profanity Filter

- A lightweight, offline word-filter library checks outgoing chat messages at send-time in the sender's own client, consistent with the existing client-side/soft-enforcement model (DESCISIONS.md ADR-006).
- No external API or cost — resolves the previously open moderation-baseline question (§11) as "basic client-side filtering, yes" for MVP.

---

## 6. Future Expansion (Explicitly Post-MVP)

Architecture should not preclude these, but none are to be designed or implemented as part of MVP:

- Playback queue (multiple videos queued in sequence).
- Persistent rooms (surviving app restarts / long-term).
- Friends lists.
- Advanced moderation tools (kick/ban, moderator roles) — beyond the basic client-side profanity filter already in MVP (§5.12).
- Watch history.
- Playlists.
- Database-backed room storage.
- **Cross-device Engagement Dashboard** — syncing achievements/user card via Supabase Postgres + Row Level Security, upgrading the local-only MVP version (§5.9, DESCISIONS.md ADR-009) to a shared/public profile visible to others.
- **Discord Activity support** — running NightWatch inside Discord itself via the Discord Embedded App SDK, with a responsive layout inside a Discord text or voice-channel Activity. Deferred per DESCISIONS.md ADR-008; the MVP renderer is kept platform-adapter-decoupled so this can be built as a web target later without a rewrite of sync/room/UI logic.
- Mobile optimization.
- Progressive Web App support.
- Analytics.
- Additional media providers, if legally and contractually supportable.

---

## 7. Technical Principles (Product-Level, Non-Implementation)

- Modular, scalable, strongly typed, and production-ready by construction — not retrofitted later.
- Architecture should support the Future Expansion list above without major rewrites.
- Desktop-first distribution (Electron), while keeping the playback/sync core close enough to standard web technology that a future browser-hosted version isn't foreclosed.

*(Concrete technology choices, folder structure, and implementation architecture are explicitly out of scope for this document — they belong in ARCHITECTURE.md.)*

---

## 8. Compliance Requirements (Hard Constraints)

NightWatch must remain compliant with YouTube's Developer Policies and Terms of Service at all times:

- Playback occurs exclusively through the official YouTube IFrame Player API.
- No downloading of video or audio content.
- No proxying or restreaming of YouTube content.
- No modification of player internals.
- No hiding, skipping, or blocking of advertisements.
- No blocking or interfering with monetization.
- No removal or obscuring of required YouTube branding/attribution.
- Only playback *state* is synchronized between clients — never the media stream itself.

These constraints take precedence over feature convenience. Any feature idea that would require violating one of these must be rejected or redesigned.

### 8.1 Concrete Guardrails (Acceptance Criteria)

The rules above translate into specific, testable UI rules that apply to every feature involving the player (chat sidebar, stamp reactions, system log, viewport filters):

- **No overlay interference (ad safety)**: chat panels, floating stamp-reaction containers, and the system log sidebar must render outside or around the iframe's bounding box — never as a layer positioned on top of the video, whether transparent or opaque, since that could intercept clicks on or obscure a displayed advertisement.
- **Preserve native controls**: the IFrame Player's standard controls, watermark, corporate branding, and the "Watch on YouTube" redirect must stay fully visible and uncropped at all times — never hidden or clipped via CSS (`overflow: hidden` cropping, `display:none` on child nodes, or similar).
- **Viewport minimum boundaries**: the player container must enforce a hard floor of 200×200px (YouTube's documented minimum) with a practical target minimum of 480×270px, implemented as `min-width`/`min-height` on the player wrapper — the video box must never be compressible below this regardless of window resize.
- **No audio-only hiding**: the player element must never be sized to 0px, moved off-screen, or set to `display:none` while media is playing — the visual player component must stay rendered on-screen at all times during playback, so NightWatch can never function as a disguised audio-only stream.

---

## 9. Non-Functional Requirements

- **Reliability** — sync and connection state should degrade gracefully (e.g., on network hiccups), not silently desync.
- **Performance** — low CPU/memory overhead for an always-could-be-running desktop app.
- **Low-latency synchronization** — sync events should feel near-instant to participants.
- **Security** — validated, authorized actions only (e.g., only a host — or authorized role — can load a new video); no arbitrary code execution surface from chat or reactions (e.g., no unsanitized HTML rendering).
- **Accessibility** — reasonable keyboard navigation and readable contrast in themes.
- **Responsive UI** — the app window should behave well across reasonable desktop window sizes.
- **Maintainability** — strong TypeScript typing throughout, clean separation of concerns.
- **Installability** — must package into a distributable Windows executable/installer.

---

## 10. Known Architectural Risks & Edge Cases

Flagging these now so they can be deliberately addressed in ARCHITECTURE.md rather than discovered mid-build:

1. **Hosting model ambiguity.** ROADMAP.md (Phase 2) calls for a "Node.js server" with Socket.io. For a desktop app, it must be decided whether this server is a centrally hosted cloud service (all installs connect to one backend) or something else. A peer-to-peer / locally-hosted model is not realistic for a general watch-party product and is **not recommended** — this PRD assumes a centrally hosted backend service unless otherwise decided.
2. **Drift-correction feedback loops.** Naively re-seeking every client on every drift check can cause cascading corrections across viewers. Needs a deliberate tolerance/threshold and correction-authority model (who is allowed to "correct" whom).
3. **Host disconnect / reassignment race conditions.** If the host disconnects mid-seek or mid-video-load, the app needs a defined resolution order to avoid divergent room state.
4. **Late joiners during active seeking/buffering.** A user joining while the host is actively scrubbing needs a defined "settle" behavior rather than joining into a moving target.
5. **YouTube playback restrictions.** Some videos are unembeddable, age-restricted, region-locked, or owner-disabled for embedding. The product needs defined behavior (error state, host notified, room notified) rather than silent failure.
6. **Abuse/spam surface.** Chat and reactions are unauthenticated-by-default in MVP (no accounts) — needs at least basic rate-limiting and input sanitization to prevent spam/XSS-style payloads in chat.
7. **API key handling in a distributed executable.** With the Supabase-based backend (ADR-004), the Electron app ships with a Supabase project URL and *anon* public key — this is safe to embed by design (Supabase's anon key is meant to be public; access control is enforced via Row Level Security / Realtime authorization rules, not by keeping the key secret). If a YouTube Data API key is added later for metadata/thumbnail lookups, that key would need its own handling review since Google API keys are not designed to be embedded client-side the same way.
8. **Auto-update strategy.** Since this ships as an installed `.exe`, there's no implicit "refresh the page to get the latest version" — an update mechanism (or accepted manual-reinstall policy) needs to be decided before Phase 10.

---

## 11. Open Questions

### Resolved (see DESCISIONS.md ADR-004 through ADR-011)

1. **Backend hosting:** Resolved — no self-hosted server. Uses **Supabase Realtime** (Broadcast + Presence channels) as the sync/chat/reactions layer. See ADR-004.
4. **Host authority model:** Resolved — **host-only** playback control (play/pause/seek/load) for MVP, enforced client-side via Presence host flag. See ADR-006.
5. **Identity in MVP:** Resolved — **Supabase Auth with Discord OAuth** as the primary sign-in method (matches the target audience of Discord-using friend groups), with a **guest/plain-username fallback** that skips authentication entirely. See ADR-005.
6. **YouTube API key requirements:** Resolved — the official IFrame Player API remains keyless for MVP. A YouTube Data API v3 key is now planned for §5.11 In-App YouTube Search, but proxied through a Supabase Edge Function rather than embedded in the Electron binary. See ADR-011.
7. **Platform scope:** Resolved — **Windows-only** initial target. See ADR-007.
9. **Reaction/chat moderation baseline:** Resolved — a basic client-side chat profanity filter is in MVP scope (§5.12). See ADR-011. Advanced moderation tools (kick/ban, roles) remain post-MVP (§6).

### Still Open (smaller, can be resolved during architecture/implementation)

2. **Room capacity:** Is there a maximum number of viewers per room for MVP? (Supabase free tier caps at 200 *total* concurrent Realtime connections across all rooms combined, so this also has a practical ceiling worth planning around.)
3. **Room identity/access:** Are rooms joined via a short code, a shareable link, or both? Do rooms require a password/private option, or are they open-by-link only?
8. **Room lifecycle:** Do rooms persist only while at least one participant is connected (in-memory, ephemeral — consistent with "Room persistence" being listed as post-MVP), or is there any expectation of a room surviving an empty period?

---

## 12. What Happens Next (Process, Not Architecture)

Per the phased workflow defined in CLAUDE.md: this PRD is the functional source of truth going forward. The core open questions in §11 are now resolved (ADR-004 through ADR-007 in DESCISIONS.md), and **ARCHITECTURE.md** has been drafted on that basis — covering the Electron main/renderer split, IPC strategy, Supabase-based backend architecture, room lifecycle, and security model. The remaining "Still Open" items in §11 are small enough to resolve during Phase 3 (Room System) implementation rather than blocking architecture.

No code has been written; only planning/architecture documents exist so far.
