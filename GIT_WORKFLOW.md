# NightWatch Git and Release Workflow

Codex and Claude work on separate `frontend/**` and `backend/**` branches. A branch push never merges itself, and pushing `main` never imports another branch.

## Feature work

Run `npm run git:sync` from a clean feature branch before work. When complete, run:

```powershell
npm run git:finish -- -Message "feat: describe the change"
```

The command commits, rebases, validates, and safely pushes. The Feature PR workflow creates or updates one PR and validates it. The Git coordinator reviews the exact head SHA and scope, then applies the `automerge` label. Only a green, non-draft, labeled PR is squash-merged. Unlabeled PRs remain open for owner review.

If automatic PR creation reports a permission error, enable **Settings > Actions > General > Workflow permissions > Allow GitHub Actions to create and approve pull requests**.

## Releases

After all intended PRs are merged, open **Actions > Release > Run workflow**, select `patch`, `minor`, or `major`, and run it on `main`. The workflow validates, creates the version commit/tag, pushes both, and publishes the installer. Never version from a feature branch.
