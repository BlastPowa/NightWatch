# NightWatch — Handoff Brief for Sol

Audience: Sol, joining as a second developer focused on **frontend polish, UI upgrades, and branding (logo)** while the other agent continues **backend/platform work**. Read CLAUDE.md first — its workflow (plan → approval → complete files only, one phase at a time, never regenerate unchanged files) is binding for all contributors.

---

## 1. What NightWatch is

A Windows Electron desktop watch-party app: friends join 6-character room codes and watch YouTube together in perfect sync, with chat, emoji reactions, themes, and a Discord Activity build that runs inside Discord voice channels. Zero-cost infrastructure: Supabase Realtime (free tier) for all sync, no custom server, no database writes in MVP.

**Compliance is non-negotiable** (CLAUDE.md COMPLIANCE section): playback uses only the official YouTube IFrame Player API; we sync playback *state*, never streams; nothing is ever rendered **over** the video iframe (reaction overlay is pointer-events:none inside the frame container; timeline markers are our own strip *below* the player); ads and YouTube branding are never hidden or altered.

## 2. Architecture in one minute

- **Electron** (main: `electron/`) + **React 18 / TS strict / Vite** renderer (`src/`), shared types in `shared/`.
- **Supabase Realtime** channels per room: Presence (member list, deterministic host = earliest joiner) + Broadcast (typed events in `shared/events.ts`: playback, chat, reactions, sync snapshots).
- **SyncEngine** (`src/lib/sync/SyncEngine.ts`): host broadcasts native player-control changes; viewers apply with latency compensation + adaptive drift correction (ADR-017).
- **PlatformBridge** (`src/platform/`): electron / discord / web adapters — renderer core never touches Electron APIs directly.
- **Two build targets:** `npm run dev`/`build` (Electron) and `npm run dev:activity`/`build:activity` → `dist-web/` (Discord Activity, deployed on Cloudflare Workers at `nightwatch.b00160446.workers.dev`).
- Docs of record: `ROADMAP.md`, `DESCISIONS.md` (ADRs), `ARCHITECTURE.md`, `STATUS.md`, `TASKS.md`, `SECURITY_REVIEW.md`, `CHANGELOG.md`. Update STATUS/TASKS/CHANGELOG with every change set.

## 3. Where we are (2026-07-10)

Phases 0–12 (full MVP) code-complete and largely user-verified; Phase 13 (Discord Activity) code-complete and mid-verification:

- ✅ Rooms/presence/host migration, playback sync, chat (+profanity filter), reactions + timeline markers, themes/accent picker/volume/CSS filters, engagement dashboard (local achievements), Discord Rich Presence, About screen + auto-update (GitHub Releases, Action `release.yml` publishes on `v*` tags — green), production logging/error handling/security pass.
- 🔄 In verification by owner (Unc): auto-update loop 0.1.0 → 0.1.1; Discord Activity launch (blocked in big servers — unverified apps need <25-member server or DM launch); **YouTube playback inside the Activity is the open risk item**.
- ⏳ Pending external setup: `search-youtube` Supabase Edge Function deploy (needs owner's Google API key; client + function code done — search shows "not set up yet" until then).

## 4. Division of work

**Sol (frontend/UI/branding) — your lane:**

1. **Logo & app icon** — design a NightWatch logo (crescent/eye/night motif fits the existing `◗` placeholder brand mark); produce `build/icon.ico` (256px multi-size) for electron-builder (`electron-builder.yml` currently uses the default icon — add `icon` config), plus SVG/PNG for the in-app brand mark and Discord Art Assets (512×512 app icon, 1024×576 activity cover).
2. **UI upgrades** — current design system: CSS variables in `src/index.css` (tokens at top; three themes via `[data-theme]`; accent set at runtime as `--nw-accent`). Owner's design references: uiverse.io (vesper-2 system, odd-bobcat buttons, shaggy-eel media buttons, wicked-lionfish glow button), shadesbyjay.site, flowbite, daisyUI text/transitions, plus Stow-style sidebar (already implemented). Improvement areas: typography (consider bundling a local font — no CDNs, CSP), empty states, Activity-viewport responsive layout (<900px is currently a basic collapse), settings page layout, member avatars.
3. **Frontend hardening** — accessibility (focus states, aria labels, keyboard nav), reduced-motion media query for animations, contrast checks on all three themes × 8 accents.

**Rules for Sol:** components + CSS only. Do **not** modify `src/lib/**` (sync/room/chat/reaction/player logic), `shared/**` event contracts, `electron/**`, or CSP/vite configs without coordinating — those are the backend lane. Keep all existing CSS class names used by components working. No new runtime dependencies without owner approval. localStorage keys in use: `nightwatch:identity`, `nightwatch:settings`, `nightwatch:engagement`.

**Backend lane (other agent):** Edge Function deploy + Discord-identity OAuth token exchange for the Activity, Activity playback debugging, then Phase 14+ (persistent rooms — first Postgres/RLS work, ADR-012), queue/voting (ADR-013).

## 5. Working agreements

- Follow CLAUDE.md exactly: implementation plan → owner approval → complete files (no placeholders/TODOs) → self-review.
- One phase/change-set at a time; only output changed files.
- `npm run typecheck` must pass (TS strict, `noUncheckedIndexedAccess`).
- Test in Electron (`npm run dev`) **and** a browser tab (`localhost:5173`) — the app must degrade gracefully outside Electron (PlatformBridge handles this).
- Release flow: `npm version patch` → `git push --follow-tags` → GitHub Action builds/publishes. Never hand-create releases.
- Secrets: only the Supabase **anon** key and Discord **Client ID** may appear client-side. Google API key lives only as an Edge Function secret. `.env` is gitignored.

## 6. Quick start

```
git clone https://github.com/BlastPowa/NightWatch.git
npm install
# create .env with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_DISCORD_CLIENT_ID (ask Unc)
npm run dev
```

Two-client testing: run the Electron app + open http://localhost:5173 in a browser with a different display name.
