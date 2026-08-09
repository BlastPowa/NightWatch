$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dist = Join-Path $root 'dist-web'

function Require-File([string] $relativePath) {
  $path = Join-Path $dist $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Web build is missing required file: $relativePath"
  }
}

Require-File 'index.html'
Require-File 'installer/index.html'
Require-File 'installer/styles.css'
Require-File 'installer/assets/nightwatch-mark.svg'

$entry = Get-Content -Raw -LiteralPath (Join-Path $dist 'index.html')
foreach ($forbidden in @('frame_id', 'index.discord', 'main.discord')) {
  if ($entry -match [regex]::Escape($forbidden)) {
    throw "Browser build accidentally contains Discord Activity entry marker: $forbidden"
  }
}

$installer = Get-Content -Raw -LiteralPath (Join-Path $dist 'installer/index.html')
if ($installer -notmatch 'NightWatch') {
  throw 'Installer page does not contain the NightWatch product identity.'
}
if ($installer -notmatch 'releases/latest') {
  throw 'Installer page does not link to the latest GitHub release.'
}

Write-Host "Web build smoke passed: browser entry and installer assets are present in $dist"
