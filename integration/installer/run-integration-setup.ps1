[CmdletBinding()]
param(
  [string]$AppPath,
  [switch]$UseSharePath,
  [switch]$EnableLegacyFallback
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$configPath = Join-Path $PSScriptRoot 'setup-paths.json'
$installScriptPath = Join-Path $PSScriptRoot 'install-integration.ps1'

if (-not (Test-Path $installScriptPath)) {
  throw "Installer script not found: $installScriptPath"
}

$config = [ordered]@{
  activeProfile = 'test'
  mode = 'Auto'
  enableLegacyFallback = $false
  testAppPath = ''
  shareAppPath = ''
}

if (Test-Path $configPath) {
  try {
    $loaded = Get-Content -Raw $configPath | ConvertFrom-Json
    if ($loaded.activeProfile) { $config.activeProfile = [string]$loaded.activeProfile }
    if ($loaded.mode) { $config.mode = [string]$loaded.mode }
    if ($null -ne $loaded.enableLegacyFallback) { $config.enableLegacyFallback = [bool]$loaded.enableLegacyFallback }
    if ($loaded.testAppPath) { $config.testAppPath = [string]$loaded.testAppPath }
    if ($loaded.shareAppPath) { $config.shareAppPath = [string]$loaded.shareAppPath }
  } catch {
    throw "Failed to read setup config: $configPath"
  }
}

$resolvedAppPath = $null
$candidatePaths = @()

if ($AppPath) {
  $candidatePaths += $AppPath
} else {
  if ($UseSharePath -or $config.activeProfile -eq 'share') {
    if ($config.shareAppPath) { $candidatePaths += $config.shareAppPath }
    if ($config.testAppPath) { $candidatePaths += $config.testAppPath }
  } else {
    if ($config.testAppPath) { $candidatePaths += $config.testAppPath }
    if ($config.shareAppPath) { $candidatePaths += $config.shareAppPath }
  }
}

$candidatePaths = $candidatePaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

foreach ($candidate in $candidatePaths) {
  if (Test-Path $candidate) {
    $resolvedAppPath = (Resolve-Path $candidate).Path
    break
  }
}

if (-not $resolvedAppPath) {
  $joinedCandidates = if ($candidatePaths.Count -gt 0) { ($candidatePaths -join '; ') } else { '(no configured paths)' }
  throw "No runnable app path found. Checked: $joinedCandidates"
}

$mode = if ($config.mode) { [string]$config.mode } else { 'Auto' }
$allowLegacyFallback = if ($EnableLegacyFallback) { $true } else { [bool]$config.enableLegacyFallback }

$installArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $installScriptPath,
  '-AppPath', $resolvedAppPath,
  '-Mode', $mode
)

if ($allowLegacyFallback) {
  $installArgs += '-EnableLegacyFallback'
}

Write-Host "[integration-setup] AppPath = $resolvedAppPath"
Write-Host "[integration-setup] Mode = $mode"
Write-Host "[integration-setup] EnableLegacyFallback = $allowLegacyFallback"

& powershell.exe @installArgs
exit $LASTEXITCODE
