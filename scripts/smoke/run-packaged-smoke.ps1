param(
  [string]$Executable = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if ([string]::IsNullOrWhiteSpace($Executable)) {
  $candidate = Join-Path $repoRoot "release\win-unpacked\NightWatch.exe"
} else {
  $candidate = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Executable)
}

if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
  throw "Packaged smoke executable was not found: $candidate"
}

$installer = Get-ChildItem -LiteralPath (Join-Path $repoRoot "release") -Filter "NightWatch-Setup-*.exe" -File |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if ($null -eq $installer -or $installer.Length -lt 10MB) {
  throw "A complete NightWatch installer was not found in release/."
}

$process = Start-Process -FilePath $candidate -ArgumentList "--smoke-test" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) {
  throw "Packaged NightWatch smoke boot failed with exit code $($process.ExitCode)."
}

Write-Output "Packaged smoke passed: $candidate"
Write-Output "Installer verified: $($installer.FullName) ($([Math]::Round($installer.Length / 1MB, 1)) MB)"
