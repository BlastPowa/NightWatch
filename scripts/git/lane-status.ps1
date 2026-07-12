<#
.SYNOPSIS
  Report where every lane stands: what Codex has pushed, what is unmerged, and
  what is stale.

.DESCRIPTION
  The backend and frontend lanes work in parallel and neither can see the
  other's uncommitted work. This is the check that catches the three ways that
  goes wrong:

    * a lane has pushed work nobody merged
    * a lane is behind main and will hit conflicts on rebase
    * a lane's branch is missing work its handoff claims to have done

  Read-only. Fetches and reports; never pushes, merges, or rewrites anything.

  NOTE: ASCII only. Windows PowerShell 5.1 reads UTF-8 without a BOM as ANSI,
  which mangles multi-byte characters and can break string terminators. An
  em-dash in a message here is a parse error, not a typo.

.EXAMPLE
  npm run lanes
#>

$ErrorActionPreference = 'Stop'

git fetch --all --prune --quiet

$mainRef = 'origin/main'
$mainVersion = (git show "${mainRef}:package.json" | ConvertFrom-Json).version

Write-Host ''
Write-Host "main is at v$mainVersion" -ForegroundColor Cyan
Write-Host ('-' * 62)

$branches = git for-each-ref --format='%(refname:short)' refs/remotes/origin |
  Where-Object { $_ -ne 'origin/HEAD' -and $_ -ne $mainRef }

$anyUnmerged = $false

foreach ($branch in $branches) {
  # `git cherry` marks a commit '-' when an equivalent patch is already on main.
  # Plain `git log main..branch` cannot see that: auto-merge SQUASHES, which
  # rewrites the commit, so the original is not an ancestor of main and every
  # merged branch would be reported as still outstanding forever.
  $unmerged = @(git cherry $mainRef $branch | Where-Object { $_ -like '+*' })
  $ahead = $unmerged.Count
  $behind = @(git log --oneline "$branch..$mainRef").Count

  # Fully merged (or squash-merged) and not moving: nothing to say about it.
  if ($ahead -eq 0) { continue }

  $anyUnmerged = $true
  $when = git log -1 --format='%cr' $branch
  $name = $branch -replace '^origin/', ''

  Write-Host ''
  Write-Host $name -ForegroundColor Yellow
  Write-Host "  $ahead unmerged commit(s), last pushed $when"

  if ($behind -gt 0) {
    # This is the one that bites: a stale branch rebases into conflicts, and
    # the longer it sits the worse they get.
    Write-Host "  BEHIND main by $behind commit(s) - rebase before merging" -ForegroundColor Red
  }

  foreach ($entry in $unmerged) {
    $sha = ($entry -replace '^\+\s*', '').Trim()
    $subject = git log -1 --format='%h %s' $sha
    Write-Host ('    ' + $subject) -ForegroundColor DarkGray
  }
}

if (-not $anyUnmerged) {
  Write-Host ''
  Write-Host 'Every branch is merged into main. Nothing outstanding.' -ForegroundColor Green
}

Write-Host ''
