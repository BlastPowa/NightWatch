$ErrorActionPreference = 'Stop'

$repoRoot = (git rev-parse --show-toplevel).Trim()
if (!$repoRoot) { throw 'Run this command inside the NightWatch repository.' }

$gitCommon = (git rev-parse --git-common-dir).Trim()
$worktrees = @(git worktree list --porcelain | Where-Object { $_ -like 'worktree *' })
$origin = (git remote get-url origin).Trim()
$branch = (git branch --show-current).Trim()
$dirty = @(git status --porcelain)

if ($worktrees.Count -ne 1) {
  throw "NightWatch expects one working folder, but Git reports $($worktrees.Count) worktrees. Run 'git worktree list' and consolidate before continuing."
}
if ($origin -ne 'https://github.com/BlastPowa/NightWatch.git') {
  throw "Unexpected origin: $origin"
}

Write-Host ''
Write-Host 'NightWatch workspace is consolidated.' -ForegroundColor Green
Write-Host "  Folder: $repoRoot"
Write-Host "  Branch: $branch"
Write-Host "  Git data: $gitCommon"
Write-Host "  Origin: $origin"
if ($dirty.Count -eq 0) {
  Write-Host '  Working tree: clean' -ForegroundColor Green
} else {
  Write-Host "  Working tree: $($dirty.Count) changed path(s)" -ForegroundColor Yellow
}
Write-Host ''
