# NightWatch

NightWatch is a desktop and Discord Activity watch-party application for
synchronized YouTube viewing, authorized local/Google Drive playback, room
chat, reactions, queues, and social features.

NightWatch is free and open-source software released under the MIT License.

## One working folder

All frontend, backend, Supabase, Electron, web, installer, documentation, and
release work now lives in this checkout:

```text
C:\Users\Blast\source\repos\NightWatch
```

The repository intentionally uses one local worktree. Frontend and backend
changes still use separate Git branches and pull requests, but contributors
switch branches inside this folder instead of creating additional
`NightWatch-*` directories. Do not edit the same working folder concurrently
from multiple tools.

Verify the workspace at any time:

```powershell
npm run workspace:check
npm run lanes
```

Start a change from the latest `main`:

```powershell
npm run git:start -- -Branch fix/short-description
```

After editing, finish, validate, and push it:

```powershell
npm run git:finish -- -Message "fix: describe the change"
```

The branch push triggers the Feature PR workflow. Merges remain reviewed, and
releases are started intentionally from GitHub Actions after packaged
acceptance. Never push directly to `main`.

## Development

```powershell
npm ci
npm run dev
```

Important validation commands:

```powershell
npm run typecheck
npm test
npm run build:activity
npm run build -- --publish never
npm run smoke:packaged
npm run smoke:web
```

## Project areas

- `src/` - React UI and renderer services.
- `electron/` - Electron main process, preload, OAuth, Drive, and packaging.
- `shared/` - typed contracts shared across processes.
- `supabase/` - migrations, SQL tests, and Edge Functions.
- `docs/installer-site/` - public NightWatch download/product page.
- `.github/workflows/` - feature PR, reviewed automerge, and release pipelines.

Current delivery status is maintained in `STATUS.md` and `TASKS.md`. Historical
branches remain recoverable from Git; the pre-consolidation Movie Watch
worktree is preserved at `origin/archive/phase-31-movie-watch-snapshot`.

## License

NightWatch is licensed under the MIT License. See `LICENSE`.
