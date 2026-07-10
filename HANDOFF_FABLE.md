# NightWatch — Backend/Platform Handoff for Fable

## Workspaces

- Frontend: `C:\Users\Blast\source\repos\NightWatch` on `frontend/nightwatch-cinematic`
- Backend: `C:\Users\Blast\source\repos\NightWatch-fable` on `backend/nightwatch-platform`
- Both worktrees belong to the same Git repository. Commit and push from the owning worktree; never copy uncommitted files between them.

## Fable ownership

- Discord Activity verification and debugging: `src/platform/discordBridge.ts`, `src/main.discord.tsx`, `index.discord.html`, `vite.config.web.ts`, Discord portal, and Cloudflare configuration.
- Supabase `search-youtube` function deployment and verification. Keep `YOUTUBE_API_KEY` only in Supabase secrets.
- Electron main/preload, packaging, updater verification, release workflow, and `electron-builder.yml`.
- Fresh evidence for the packaged update round trip and international/high-latency synchronization test.
- Phases 14–17 only after MVP verification: persistent rooms/RLS, queue and voting, opt-in analytics, and cross-device achievements.

## Boundaries and coordination

- Backend-owned: `electron/**`, `shared/**`, `src/lib/**`, `src/platform/**`, `supabase/**`, Vite configs, Discord entry HTML, and release workflows.
- Frontend-owned: `src/components/**`, `src/index.css`, and `public/brand/**`.
- Coordinate before touching `src/App.tsx`, `RoomScreen.tsx`, `PlayerPanel.tsx`, `electron-builder.yml`, package manifests, or status documents.
- The frontend branch provides `build/icon.ico`; Fable should add the corresponding Windows icon configuration in `electron-builder.yml` and verify the packaged executable/installer icon.
- Preserve the official YouTube IFrame API boundary: synchronize state only; never proxy streams, obscure ads or branding, or add interactive overlays above the iframe.
- Provide typed interface changes before implementing anything consumed directly by the frontend.

## Verification

```text
npm ci
npm run typecheck
npm run build:activity
npm run build
npm run dev:activity
npm run dev
```

Activity acceptance also requires deploying `dist-web`, matching Discord URL mappings, enabling Activities, and launching in a DM or a server with fewer than 25 members while the app remains unverified.

The updater documentation currently conflicts: `STATUS.md` says the round trip remains in verification, while `ROADMAP.md` reports it verified. Run the packaged flow again and reconcile both documents using fresh evidence.
