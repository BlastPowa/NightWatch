$ErrorActionPreference = 'Stop'
$branch = (git branch --show-current).Trim()
if (!$branch -or $branch -eq 'main') { throw 'Run this from a feature branch.' }
if ((git status --porcelain).Count -gt 0) { throw 'Commit or stash changes before syncing.' }
git fetch origin --tags --prune
if ($LASTEXITCODE) { throw 'Fetch failed.' }
git rebase origin/main
if ($LASTEXITCODE) { throw 'Rebase needs attention.' }
Write-Host "$branch is current with origin/main." -ForegroundColor Green
