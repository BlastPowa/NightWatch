# Current Status

Current Phase:
Phase 13 — Discord Activity

Completed:
✅ Phase 0 — documentation & planning
✅ Phase 1 — desktop foundation (verified)
✅ Phase 2 — realtime foundation (verified: live "Connected" indicator)
✅ Room codes (crypto-random, unambiguous alphabet, validation) — shared/room.ts
✅ Guest identity with localStorage persistence (src/lib/identity.ts, ADR-005 fallback)
✅ RealtimeService extended with Presence (track / sync / state)
✅ RoomService: join/leave, presence-derived member list, deterministic host assignment (earliest joinedAt), host migration on leave, reconnection status
✅ Phase 3 — room system (verified: two clients, presence, host)
✅ YouTube URL/id parsing for all common link forms (shared/youtube.ts)
✅ IFrame API loader — official API, idempotent injection (src/lib/player/youtubeApi.ts)
✅ YouTubePlayer abstraction (load/play/pause/seek/state/events — YT.Player never leaks out)
✅ PlayerPanel in room screen (URL input, embedded player, error surface)
✅ Phase 4 — player integration (verified: URL load + playback)
✅ Playback event contract (load/play/pause + sync request/state) in shared/events.ts
✅ Pre-subscribe broadcast bindings + RoomService typed send/on event registry
✅ SyncEngine: host broadcasts native-control changes; viewers apply with latency compensation, drift correction (5s check, 1.5s tolerance), late-join/reconnect snapshot sync
✅ Phase 5 — playback synchronization (verified: mirror, late join, host migration)
✅ Ephemeral chat (chat:message event, ChatService with rate limit + capped log)
✅ System notices from presence diffs (joined / left / new host)
✅ Phase 6 — chat + notifications (verified)
✅ Reaction palette + wire validation (shared/reactions.ts)
✅ ReactionService (rate-limited send, validated receive) on room channel
✅ Floating emoji animation overlay (pointer-events: none over the player)
✅ Timeline marker strip below the player (own strip — never drawn over YouTube's UI)
✅ Phase 7 — reactions (verified)
✅ Local settings store with sanitized persistence (src/lib/settings.ts, ADR-009)
✅ Three themes via CSS variable sets + data-theme switch (ADR-010: all free)
✅ Volume slider applied through official player API, persisted
✅ Video filter sliders (brightness/contrast/saturation) + reset — CSS-only, local-only
✅ Phase 8 — personalization (verified)
✅ Sidebar app shell (Stow-inspired): brand, nav, current-room card, status footer
✅ Mac-style cards, glossy buttons, animated gradient-border Load button
✅ Accent color picker (8 swatches, runtime CSS variable) + background/theme swatches
✅ Fluid text: shimmering hero title, fade-up entrances, chat pop-in, reaction button springs
✅ Loading states: skeleton shimmer on empty player, pulsing connect dot
✅ Responsive: sidebar collapses, chat stacks below player under 900px

✅ Phase 9 — UI overhaul (verified)
✅ Discord Rich Presence: main-process RPC manager (silent-degrade, retry), presence:update IPC, renderer reporting (room + video title via official getVideoData)
✅ In-app YouTube search: search-youtube Edge Function (server-held key, per-caller daily limit), SearchService, host Link/Search tabs with thumbnail results
✅ Chat profanity filter: obscenity, censored at source before broadcast (§7.7)
✅ Engagement Dashboard: AchievementTracker (5 stats, 8 achievements, batched watch-time), My Card view, unlock toast (ADR-009: device-local only)

✅ Phase 10 — bonus features (Rich Presence verified; search pending Edge Function deploy)
✅ UpdateManager (electron-updater, packaged-only, auto-check on launch + manual)
✅ update:check / update:install / update:status IPC (first push channel, locked in preload)
✅ electron-builder GitHub Releases publish config (BlastPowa/NightWatch)
✅ About screen: version info, bundled patch notes (CHANGELOG.md), Check for Updates with progress + Restart & Update

✅ Phase 11 — About + auto-update (dev-mode verified)
✅ Local file logging (main + renderer via log:write IPC; 512KB rotation, no telemetry)
✅ Global error handling (uncaughtException/unhandledRejection → log + dialog; ErrorBoundary logs)
✅ Security review pass — findings fixed (broadcast envelope + payload validation everywhere); documented in SECURITY_REVIEW.md
✅ Adaptive drift tolerance (base 1.5s + measured latency, capped +2s) with viewer sync-delay readout (ADR-017)
✅ Perf/packaging: reaction burst cap, no renderer sourcemaps in prod, sourcemaps excluded from installer, NSIS shortcuts + publisher + versioned artifact name

✅ Phase 12 — production prep (code complete; release verification with owner)
✅ PlatformBridge adapter (§9): electron / discord / web implementations; presence+log+app-info routed through it
✅ Activity build target: index.discord.html, main.discord.tsx bootstrap, vite.config.web.ts → dist-web (scripts: dev:activity / build:activity)
✅ Discord SDK bridge: patchUrlMappings (supabase/youtube/ytimg/ytstatic), voice-channel-derived fixed room code (deriveRoomCode), locked home screen ("Join the Watch Party")

Current Work:
Owner setup: Cloudflare Pages deploy of dist-web, portal URL mappings + enable Activities, in-Discord verification (YouTube-through-proxy is the known-risk item)

Blocked:
None (search Edge Function deploy still pending owner's Google API key)

Next:
Phase 13 verification, then Phases 14+ backlog (persistent rooms first, ADR-012)
