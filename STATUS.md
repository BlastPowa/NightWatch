# Current Status

**Released: `v0.1.18`.** See `CODEX_HANDOFF.md` for the live working state — it is kept current and supersedes this file where they disagree.

Current Phase:
Phase 21 — finishing the gaps left inside shipped phases (backend lane: `backend/phase-21-completion`).

**The critical gap:** released `main` still has no Phase 20 UI, but `frontend/phase-20b-profile-social` now does (Friends, Messages, presence consent, Moment Notes, borders, Creator Club). The bottleneck has moved from *building* to *merging*: until that branch and `backend/phase-21-completion` both land, everything both lanes have built is invisible to every user. They do not depend on each other and can merge in either order.

Frontend Track: Phase 20A Browse/player shell is on `frontend/phase-20a-browse-player`, still unmerged.

Parallel Frontend Track: Cinematic midnight brand/shell on `frontend/nightwatch-cinematic`, still unmerged. Figma canvas construction is paused at discovery — the Starter-plan MCP quota was reached.

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

✅ Phase 13 — Discord Activity (deployed to Cloudflare Workers; DM launch verified; in-Activity video playback still to verify)
✅ Release pipeline hardened through v0.1.6 (tag-triggered Action, silent updates, unsigned-updater fix, CI env newline fix, app:// origin fixes for Supabase + YouTube)
✅ Chat profanity filter toggle (per-sender, Settings)
✅ Phase 15: queue events, host-authoritative QueueService (add/vote/remove, 50-entry cap, rate limits, late-join snapshot), useQueue, QueuePanel (vote to reorder), host auto-advance on video end

✅ Phase 15 — queue & voting (verified) + host Play Next; Rich Presence privacy (no room code) + toggle
✅ Phase 14: rooms table migration + RLS + 10-room cap + get_room_by_code (supabase/migrations/0001_rooms.sql)
✅ Discord login: PKCE OAuth via system browser + nightwatch:// deep link (main-process protocol handling, auth:callback push channel)
✅ PersistentRoomService (CRUD + code-collision retry + meta lookup), useAuth, My Rooms screen (create/schedule/join/delete, sign in/out)
✅ Persistent room name + schedule banner in room header
✅ Packaged update round trip VERIFIED (0.1.4 → … → 0.1.11 including silent installs; reconciles the earlier STATUS/ROADMAP conflict — evidence: owner's release log 2026-07-10)
✅ Backend batch 1 (branch backend/nightwatch-platform): Windows icon wired (build/icon.ico from frontend lane), discord-token Edge Function (server-held Client Secret), Activity Discord identity (authorize → exchange → authenticate, guest fallback), auto-join in Activity (identity + channel room = no prompts)

✅ Phase 16 backend (Discovery Hub): trending endpoint + channelTitle in search-youtube, room_history migration/RPCs + automatic host-side recording, invite deep links (nightwatch://join/CODE) with auto-join, typed interfaces published in FEATURES_UI_BRIEF.md

✅ Phase 16 shipped (Discover home grid + chat, trending/search/history, invite links)
✅ Phase 17 (ADR-014): opt-in session insights (log-session Edge Function, host-side recorder, owner-only reads, member-visible notice), temporary insights charts, premiere events (countdown + host start button), room settings in My Rooms

✅ Phase 18 — gamification upgrade (cross-device achievements via CloudSync, leaderboards, room streaks/milestones)
✅ Phase 19 — room invites, RSVPs, scheduled-room surface, co-watcher suggestions
✅ Search/browse paging (search-youtube Edge Function: 48-result cached fetch, zero-quota Show More, daily unit budget)
✅ Phase 20B — friends, blocks, presence consent, DMs/groups, moment notes, profile borders (migrations 0006–0010, applied; RLS test green)
✅ Phase 20C — creator clubs, bounties, submissions, voting, moderation queue, append-only audit log (0011–0012, applied; test green)
✅ Phase 20D — notification emitters + bell, with realtime (0013, applied; test green)
✅ Phase 21 (backend) — group system messages (0014, applied), set_conversation_role RPC, vitest suite + CI gate
✅ Phase 21 (platform) — custom title bar (native overlay controls, so Snap Layouts survives), typed window IPC, branded assisted installer
✅ Phase 21 (features) — club discovery with moderation (0015), highlight reels (0016), unwinnable-border fix (0017)

Current Work:
Owner: merge `backend/phase-21-completion` and redeploy the `log-session` Edge Function (highlights return nothing without it); hand-verify the installer round trip. Realtime publication VERIFIED 2026-07-12 — messages, friend_requests, and notifications are all in `supabase_realtime`; the backend has no unverified assumptions left. Blocked on owner: the public rename (exact name + trademark/domain checks) and the installer sidebar/header BMPs (brand pack).

Codex: building the Phase 20 UI on `frontend/phase-20b-profile-social` — FriendsScreen, MessagesScreen, and a capabilities hook are in flight. See `CODEX_HANDOFF.md`.

Blocked:
None. But nothing from Phase 20 is user-visible until the frontend lane ships.

Next:
No phases are scheduled after 21. Everything beyond it is unscoped — mobile/web reach, or a Pro tier (ADR-015, documented but never scheduled). Do not start one while Phase 20 remains invisible.
