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

function Get-WindowsPowerShellPath64 {
  $sysnative = Join-Path $env:WINDIR 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path $sysnative) {
    return $sysnative
  }

  $system32 = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  return $system32
}

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

function Read-TextFileAutoEncoding {
  param([string]$Path)

  $bytes = [System.IO.File]::ReadAllBytes($Path)

  # Prefer UTF-8 because our config files contain Korean paths and are normally stored as UTF-8.
  # Fall back to the system default encoding if the file is not valid UTF-8 (e.g., saved as ANSI).
  $text = $null
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $text = $utf8.GetString($bytes)
  } catch {
    $text = [System.Text.Encoding]::Default.GetString($bytes)
  }

  # Strip BOM if present.
  if ($text -and $text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) {
    $text = $text.Substring(1)
  }

  return $text
}

function Read-SetupConfigJson {
  param([string]$Path)

  $raw = Read-TextFileAutoEncoding -Path $Path

  try {
    return ($raw | ConvertFrom-Json)
  } catch {
    # Common user mistake: writing Windows paths with single backslashes in JSON.
    # Example: "C:\Temp\app.exe" (invalid JSON) should be "C:\\Temp\\app.exe" or "C:/Temp/app.exe".
    # Attempt a targeted repair on known path fields, then re-parse.
    $fixed = $raw
    $pathKeys = @('certPath', 'testAppPath', 'shareAppPath')
    foreach ($key in $pathKeys) {
      $pattern = '("' + [regex]::Escape($key) + '"\s*:\s*")([^"]*)(")'
      $fixed = [regex]::Replace($fixed, $pattern, {
        param($m)
        $value = $m.Groups[2].Value
        $value = $value -replace '\\', '\\'
        return $m.Groups[1].Value + $value + $m.Groups[3].Value
      })
    }

    return ($fixed | ConvertFrom-Json)
  }
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
    $loaded = Read-SetupConfigJson -Path $configFilePath
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
    throw "Failed to read setup config: $configFilePath`n$($_.Exception.Message)"
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

$candidatePaths = @($candidatePaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

foreach ($candidate in $candidatePaths) {
  $resolved = Resolve-ExistingPath -PathCandidate $candidate -RelativeBase $PSScriptRoot
  if ($resolved) {
    $resolvedAppPath = $resolved
    break
  }
}

if (-not $resolvedAppPath) {
  $joinedCandidates = if (@($candidatePaths).Count -gt 0) { (@($candidatePaths) -join '; ') } else { '(no configured paths)' }
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
  $psExe = Get-WindowsPowerShellPath64
  $provisionOutput = & $psExe @provisionArgs 2>&1
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

$psExe = Get-WindowsPowerShellPath64
$installOutput = & $psExe @installArgs 2>&1
$installExitCode = $LASTEXITCODE

if ($installOutput) {
  $installOutput | ForEach-Object { Write-Host $_ }
}

if ($installExitCode -ne 0) {
  $installOutputText = ($installOutput | ForEach-Object { $_.ToString() }) -join "`n"
  $shouldRetry = $false
  if ($installOutputText -match 'Packaged COM activation failed') { $shouldRetry = $true }
  if ($installOutputText -match 'No context menu was registered') { $shouldRetry = $true }

  if ($shouldRetry) {
    Write-Host '[integration-setup] First install attempt failed. Retrying once after a short delay...'
    Start-Sleep -Seconds 3

    $retryOutput = & $psExe @installArgs 2>&1
    $retryExitCode = $LASTEXITCODE
    if ($retryOutput) {
      $retryOutput | ForEach-Object { Write-Host $_ }
    }

    exit $retryExitCode
  }
}

exit $installExitCode
