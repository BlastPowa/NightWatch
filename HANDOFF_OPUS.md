# NightWatch — Backend Continuity Handoff (for Opus, if Fable doesn't finish)

You are inheriting the **backend/platform lane** of NightWatch. Read CLAUDE.md
first — its workflow is binding (plan → owner approval → complete files, no
placeholders → self-review). Then HANDOFF_FABLE.md (lane ownership) and
FEATURES_UI_BRIEF.md (full feature inventory + frontend interface contracts).

## 1. Project in two sentences

Windows Electron watch-party app (plus Discord Activity build): synchronized
YouTube playback in rooms via Supabase Realtime (zero-cost stack), with chat,
reactions, voting queue, persistent scheduled rooms, Discord login, opt-in
host analytics. Compliance is absolute: official YouTube IFrame API only,
sync state never streams, nothing rendered over the iframe, ads untouched.

## 2. Working layout (two-agent setup with Codex)

- One GitHub repo: https://github.com/BlastPowa/NightWatch — **never commit
  to main, never tag/release** (owner does that via PR merges + tag-triggered
  GitHub Action).
- Two git worktrees of one parent repo:
  - `C:\Users\Blast\source\repos\NightWatch` → branch
    `frontend/nightwatch-cinematic` → **Codex** (components, index.css, brand)
  - `C:\Users\Blast\source\repos\NightWatch-fable` → branch
    `backend/nightwatch-platform` → **you** (electron/**, shared/**,
    src/lib/**, src/platform/**, supabase/**, vite configs, packaging/updater)
- Coordinate (minimal diffs, flag in handback) before touching: App.tsx,
  RoomScreen.tsx, PlayerPanel.tsx, MyRoomsScreen.tsx, electron-builder.yml,
  package manifests, index.css, STATUS/TASKS/CHANGELOG.
- Session start ritual: `git switch backend/nightwatch-platform`,
  `git fetch origin`, `git rebase origin/main`.
- Handback ritual: owner runs `npm ci`, `npm run typecheck`,
  `npm run build:activity`, `npm run build`; review diff; commit; push;
  owner PRs + merges; then owner releases from main (`npm version patch`,
  `git push --follow-tags`, publish the draft). Always end handbacks with
  "Do not release yet; merge this PR first."
- The owner (Unc) executes all git/npm/dashboard commands — give exact
  copy-paste commands. The shell sandbox is typically unavailable.

## 3. State of the backend (all shipped & merged unless noted)

- Phases 1–15 + 16 (Discovery) + 17 (host tools) complete. Release pipeline
  battle-tested (v0.1.x line, silent auto-updates; publisherName must stay
  OUT of electron-builder.yml while unsigned).
- Supabase project eiachttvgojmzvcecszz:
  - Realtime channels: presence + typed broadcasts (shared/events.ts is the
    single event contract; bindings must register BEFORE subscribe).
  - Postgres: rooms (RLS owner-only, 10-cap), room_history (RPC-only),
    room_sessions/session_events (owner-read, service-role writes).
    Migrations in supabase/migrations/ — owner pastes into SQL Editor.
  - Edge Functions (owner deploys via dashboard, Verify JWT OFF):
    search-youtube (search+trending; secret YOUTUBE_API_KEY),
    discord-token (Activity OAuth exchange; DISCORD_CLIENT_ID/SECRET),
    log-session (analytics; no extra secrets).
  - Auth: Discord provider. The SAME Client Secret must exist in THREE
    places: Discord portal, Supabase Auth provider settings, and the
    DISCORD_CLIENT_SECRET function secret. Resetting it in the portal
    silently breaks the other two — this has bitten before.
- Electron specifics that will bite you if unknown:
  - Packaged renderer serves from custom scheme app://nightwatch (fixes
    YouTube error 153). Consequences: YouTube requests from OUR frames get
    Referer/Origin rewritten to the workers.dev domain (frame-scoped only —
    rewriting YouTube's iframe-internal requests breaks playback with 403s);
    Supabase responses get a forced ACAO * via onHeadersReceived (Chromium
    validates CORS against app://, which Supabase won't echo). Electron
    allows ONE onBeforeSendHeaders listener per session — keep rewrites in
    the single existing handler in electron/main.ts.
  - Deep links: nightwatch://auth-callback (OAuth) and nightwatch://join/CODE
    (invites) arrive via second-instance argv; flaky in dev, reliable packaged.
  - CI env values baked by Vite from GitHub repo VARIABLES (not secrets):
    VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_DISCORD_CLIENT_ID.
    A trailing newline in a variable once corrupted the realtime apikey
    (%0D%0A) — supabase.ts trims defensively now.
  - Discord Activity: Cloudflare Worker nightwatch.b00160446.workers.dev,
    build `npm run build:activity` → dist-web, wrangler.jsonc serves it;
    Discord portal URL mappings: / → that domain, /supabase, /youtube,
    /ytimg, /ytstatic (+ /discordcdn). Unverified apps: Activities only in
    DMs or <25-member servers.
- SyncEngine subtleties: host-authoritative (ADR-006), viewers never
  broadcast playback; drift tolerance adapts to latency (ADR-017) with a
  min-offset baseline that cancels clock skew — don't "simplify" that.

## 4. What remains (in priority order)

1. **Verification debts** (owner-run, chase results): Phase 17 end-to-end
   (insights toggle → session → charts; premiere flow); Activity video
   playback inside Discord (flagged risk — YouTube through Discord's proxy;
   fallback documented: sync/chat in Activity, playback on desktop);
   Discord sign-in + Activity identity post secret-sync; high-latency
   friend session (watch the sync-delay readout).
2. **Phase 18 — gamification upgrade (§14.4, last differentiation item):**
   move AchievementTracker's local store to Postgres keyed by Discord user
   id (RLS per user; the local module was designed for a storage-backend
   swap — see ARCHITECTURE.md §9), then friend-group leaderboards, watch
   streaks, shared/room achievements. Needs a plan + owner approval first.
3. **Custom installer UI** (Codex designs pages/branding; you implement via
   electron-builder NSIS `installer.nsh`, must not break silent updates).
4. **Backlog/opportunistic:** schedule reminders/notifications for
   persistent rooms; multi-provider playback (Vimeo/Twitch — ONLY official
   embed APIs; piracy sites were requested once and correctly refused —
   hold that line); code signing (restores publisherName); Mac/Linux
   targets (ADR-007 allows later).

## 5. Owner interaction notes

- Unc approves plans fast, tests thoroughly with real friends, pastes
  screenshots/console output — use that evidence, it has found every real
  bug so far. Provide copy-paste PowerShell blocks for every step, and
  repeat the post-merge release block after each merge (they asked for
  this explicitly).
- Secrets hygiene: anon key + Discord Client ID are the only client-safe
  values. Supabase service/secret keys were exposed in chat early on —
  rotation was advised; re-raise if never done.
- Docs of record: STATUS.md, TASKS.md, CHANGELOG.md — update every change
  set; ROADMAP.md phase statuses when a phase completes.
