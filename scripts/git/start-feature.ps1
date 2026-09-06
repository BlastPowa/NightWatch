param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^(frontend|backend|feature|fix)/[a-z0-9][a-z0-9._-]*$')]
  [string]$Branch
)

$ErrorActionPreference = 'Stop'

function Run([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE) { throw "$Command failed." }
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
if (!$repoRoot) { throw 'Run this command inside the NightWatch repository.' }
if ((git status --porcelain).Count -gt 0) {
  throw 'Commit or stash the current changes before switching work.'
}

Run git @('fetch','origin','--tags','--prune')

$localBranch = git branch --list $Branch
if ($localBranch) {
  Run git @('switch',$Branch)
  Run git @('rebase','origin/main')
} else {
  Run git @('switch','-c',$Branch,'origin/main')
}

Write-Host "Ready in $repoRoot" -ForegroundColor Green
Write-Host "Active branch: $Branch" -ForegroundColor Cyan
Write-Host 'Use npm run git:finish -- -Message "..." when the change is ready.' -ForegroundColor Yellow
