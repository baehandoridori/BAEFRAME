[CmdletBinding()]
param(
  [string]$AppPath,
  [string]$ConfigPath,
  [switch]$UseSharePath,
  [ValidateSet('Msix', 'Register')]
  [string]$SparseInstallMethod,
  [switch]$EnableRegistryFallback,
  [switch]$EnableLegacyFallback,
  [switch]$Provision,
  [string]$CertPath,
  [switch]$SkipCertificateInstall,
  [switch]$SkipPolicySetup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$configFilePath = Join-Path $PSScriptRoot 'setup-paths.json'
$installScriptPath = Join-Path $PSScriptRoot 'install-integration.ps1'
$provisionScriptPath = Join-Path $PSScriptRoot 'provision-machine-prereqs.ps1'

function Resolve-ExistingPath {
  param(
    [string]$PathCandidate,
    [string]$RelativeBase
  )

  if ([string]::IsNullOrWhiteSpace($PathCandidate)) {
    return $null
  }

  if (Test-Path $PathCandidate) {
    return (Resolve-Path $PathCandidate).Path
  }

  if (-not [System.IO.Path]::IsPathRooted($PathCandidate)) {
    $relativeCandidate = Join-Path $RelativeBase $PathCandidate
    if (Test-Path $relativeCandidate) {
      return (Resolve-Path $relativeCandidate).Path
    }
  }

  return $null
}

if ($ConfigPath) {
  $resolvedConfigPath = Resolve-ExistingPath -PathCandidate $ConfigPath -RelativeBase $PSScriptRoot
  if (-not $resolvedConfigPath) {
    throw "Config file not found: $ConfigPath"
  }

  $configFilePath = $resolvedConfigPath
}

if (-not (Test-Path $installScriptPath)) {
  throw "Installer script not found: $installScriptPath"
}

$config = [ordered]@{
  activeProfile = 'test'
  mode = 'Auto'
  sparseInstallMethod = 'Msix'
  enableRegistryFallback = $false
  enableLegacyFallback = $false
  provisionPolicyAndCert = $false
  certPath = ''
  testAppPath = ''
  shareAppPath = ''
}

if (Test-Path $configFilePath) {
  try {
    $loaded = Get-Content -Raw $configFilePath | ConvertFrom-Json
    if ($loaded.activeProfile) { $config.activeProfile = [string]$loaded.activeProfile }
    if ($loaded.mode) { $config.mode = [string]$loaded.mode }
    if ($loaded.sparseInstallMethod) { $config.sparseInstallMethod = [string]$loaded.sparseInstallMethod }
    if ($null -ne $loaded.enableRegistryFallback) { $config.enableRegistryFallback = [bool]$loaded.enableRegistryFallback }
    if ($null -ne $loaded.enableLegacyFallback) { $config.enableLegacyFallback = [bool]$loaded.enableLegacyFallback }
    if ($null -ne $loaded.provisionPolicyAndCert) { $config.provisionPolicyAndCert = [bool]$loaded.provisionPolicyAndCert }
    if ($loaded.certPath) { $config.certPath = [string]$loaded.certPath }
    if ($loaded.testAppPath) { $config.testAppPath = [string]$loaded.testAppPath }
    if ($loaded.shareAppPath) { $config.shareAppPath = [string]$loaded.shareAppPath }
  } catch {
    throw "Failed to read setup config: $configFilePath"
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
  $resolved = Resolve-ExistingPath -PathCandidate $candidate -RelativeBase $PSScriptRoot
  if ($resolved) {
    $resolvedAppPath = $resolved
    break
  }
}

if (-not $resolvedAppPath) {
  $joinedCandidates = if ($candidatePaths.Count -gt 0) { ($candidatePaths -join '; ') } else { '(no configured paths)' }
  throw "No runnable app path found. Checked: $joinedCandidates"
}

$mode = if ($config.mode) { [string]$config.mode } else { 'Auto' }
$resolvedSparseMethod = if ($SparseInstallMethod) { [string]$SparseInstallMethod } elseif ($config.sparseInstallMethod) { [string]$config.sparseInstallMethod } else { 'Msix' }
$allowRegistryFallback = if ($EnableRegistryFallback) { $true } else { [bool]$config.enableRegistryFallback }
$allowLegacyFallback = if ($EnableLegacyFallback) { $true } else { [bool]$config.enableLegacyFallback }
$runProvision = if ($Provision) { $true } else { [bool]$config.provisionPolicyAndCert }
$certPathInput = if ($CertPath) { $CertPath } elseif ($config.certPath) { [string]$config.certPath } else { $null }
$resolvedCertPath = Resolve-ExistingPath -PathCandidate $certPathInput -RelativeBase $PSScriptRoot

Write-Host "[integration-setup] AppPath = $resolvedAppPath"
Write-Host "[integration-setup] ConfigPath = $configFilePath"
Write-Host "[integration-setup] Mode = $mode"
Write-Host "[integration-setup] SparseInstallMethod = $resolvedSparseMethod"
Write-Host "[integration-setup] EnableRegistryFallback = $allowRegistryFallback"
Write-Host "[integration-setup] EnableLegacyFallback = $allowLegacyFallback"
Write-Host "[integration-setup] ProvisionPolicyAndCert = $runProvision"
if ($resolvedCertPath) {
  Write-Host "[integration-setup] CertPath = $resolvedCertPath"
}

if ($runProvision) {
  if (-not (Test-Path $provisionScriptPath)) {
    throw "Provision script not found: $provisionScriptPath"
  }

  $provisionArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $provisionScriptPath
  )

  if ($resolvedCertPath) {
    $provisionArgs += @('-CertPath', $resolvedCertPath)
  } elseif ($certPathInput) {
    $provisionArgs += @('-CertPath', $certPathInput)
  }

  if ($SkipCertificateInstall) {
    $provisionArgs += '-SkipCertificateInstall'
  }

  if ($SkipPolicySetup) {
    $provisionArgs += '-SkipPolicySetup'
  }

  Write-Host '[integration-setup] Provision step started'
  $provisionOutput = & powershell.exe @provisionArgs 2>&1
  $provisionExitCode = $LASTEXITCODE

  if ($provisionOutput) {
    $provisionOutput | ForEach-Object { Write-Host $_ }
  }

  if ($provisionExitCode -ne 0) {
    throw "Provision step failed with exit code $provisionExitCode"
  }
}

$installArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $installScriptPath,
  '-AppPath', $resolvedAppPath,
  '-Mode', $mode,
  '-SparseInstallMethod', $resolvedSparseMethod
)

if ($allowRegistryFallback) {
  $installArgs += '-EnableRegistryFallback'
}

if ($allowLegacyFallback) {
  $installArgs += '-EnableLegacyFallback'
}

& powershell.exe @installArgs
exit $LASTEXITCODE
