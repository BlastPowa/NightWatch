param([Parameter(Mandatory=$true)][string]$Message)
$ErrorActionPreference = 'Stop'
function Run([string]$Command, [string[]]$Arguments) { & $Command @Arguments; if ($LASTEXITCODE) { throw "$Command failed." } }
$branch = (git branch --show-current).Trim()
if ($branch -notmatch '^(frontend|backend|feature|fix)/') { throw 'Use an approved feature branch.' }
if ((git status --porcelain).Count -eq 0) { throw 'There are no changes to finish.' }
Run git @('add','-A'); Run git @('commit','-m',$Message); Run git @('fetch','origin','--tags','--prune'); Run git @('rebase','origin/main')
Run npm @('ci'); Run npm @('run','typecheck'); Run npm @('run','build:activity'); Run npm @('run','build')
$remote = git ls-remote --heads origin "refs/heads/$branch"
if ($remote) { Run git @('push','--force-with-lease','-u','origin',$branch) } else { Run git @('push','-u','origin',$branch) }
Write-Host "PR: https://github.com/BlastPowa/NightWatch/compare/main...$branch" -ForegroundColor Green
Write-Host 'Do not release until the PR is manually merged.' -ForegroundColor Yellow
