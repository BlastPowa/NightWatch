param(
  [Parameter(Mandatory=$true)][string]$Message,
  [switch]$AutoMerge
)
$ErrorActionPreference = 'Stop'
function Run([string]$Command, [string[]]$Arguments) { & $Command @Arguments; if ($LASTEXITCODE) { throw "$Command failed." } }
$branch = (git branch --show-current).Trim()
if ($branch -notmatch '^(frontend|backend|feature|fix)/') { throw 'Use an approved feature branch.' }
if ((git status --porcelain).Count -eq 0) { throw 'There are no changes to finish.' }
$commitArgs = @('commit','-m',$Message)
if ($AutoMerge) { $commitArgs += @('-m','Automerge: reviewed') }
Run git @('add','-A'); Run git $commitArgs; Run git @('fetch','origin','--tags','--prune'); Run git @('rebase','origin/main')
Run npm @('ci')
Run npm @('run','typecheck')
Run npm @('test')
Run npm @('run','build:activity')
Run npm @('run','build','--','--publish','never')
$remote = git ls-remote --heads origin "refs/heads/$branch"
if ($remote) { Run git @('push','--force-with-lease','-u','origin',$branch) } else { Run git @('push','-u','origin',$branch) }
Write-Host "PR: https://github.com/BlastPowa/NightWatch/compare/main...$branch" -ForegroundColor Green
if ($AutoMerge) { Write-Host 'Reviewed automerge requested; the PR still requires a green validation run.' -ForegroundColor Yellow }
else { Write-Host 'The PR will remain open until reviewed and merged.' -ForegroundColor Yellow }
