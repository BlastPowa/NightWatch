# NightWatch single-workspace policy

## Canonical checkout

Use only:

```text
C:\Users\Blast\source\repos\NightWatch
```

The former `NightWatch-acceptance`, `NightWatch-fable`, `NightWatch-ui`,
`NightWatch-movie-watch`, `NightWatch-drive-review`,
`NightWatch-phase29-review`, and `NightWatch-release` worktrees were retired on
2026-09-06. Their Git branches were not deleted. The only dirty legacy worktree
was committed and pushed as `origin/archive/phase-31-movie-watch-snapshot`
before its folder was removed.

## Working agreement

1. Fetch and begin every task from `origin/main` with `npm run git:start`.
2. Use an approved `frontend/`, `backend/`, `feature/`, or `fix/` branch.
3. Only one developer or agent edits the local checkout at a time.
4. Use `npm run git:finish` to commit, rebase, validate, and push.
5. Let the Feature PR workflow create/update the pull request.
6. Merge only after review and green validation.
7. Start Release manually only after packaged owner acceptance.

Backend and frontend ownership is expressed by branch and file scope, not by
separate folders. Handoff documents must reference the canonical checkout.
