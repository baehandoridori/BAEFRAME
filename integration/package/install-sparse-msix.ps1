[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $false)]
  [string]$AppPath,

  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release',

  [string]$MsixPath,

  [string]$CertThumbprint,

  [string]$CertSubject = 'CN=StudioJBBJ',

  [switch]$SkipShellBuild,

  [switch]$SkipSign,

  [string]$BuildToolsVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$BuildScriptPath = Join-Path $PSScriptRoot 'build-sparse-msix.ps1'
$StageRoot = Join-Path $env:LOCALAPPDATA 'baeframe\integration-sparse-package'

function Get-TroubleshootingHint {
  param([string]$Message)

  if (-not $Message) {
    return $null
  }

  if ($Message -match '0x800B0109') {
    return 'Certificate trust failed (0x800B0109). Install the signing certificate into TrustedPeople/TrustedPublisher (CurrentUser or LocalMachine) and retry.'
  }

  if ($Message -match '0x80073D2E') {
    return 'External content deployment is blocked (0x80073D2E). Enable Developer Mode or allow external content deployment policy, then retry.'
  }

  return $null
}

try {
  if (-not (Test-Path $BuildScriptPath)) {
    throw "Build script not found: $BuildScriptPath"
  }

  $buildArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $BuildScriptPath,
    '-Configuration', $Configuration
  )

  if ($AppPath) { $buildArgs += @('-AppPath', $AppPath) }
  if ($MsixPath) { $buildArgs += @('-MsixPath', $MsixPath) }
  if ($CertThumbprint) { $buildArgs += @('-CertThumbprint', $CertThumbprint) }
  if ($CertSubject) { $buildArgs += @('-CertSubject', $CertSubject) }
  if ($SkipShellBuild) { $buildArgs += '-SkipShellBuild' }
  if ($SkipSign) { $buildArgs += '-SkipSign' }
  if ($BuildToolsVersion) { $buildArgs += @('-BuildToolsVersion', $BuildToolsVersion) }
  if ($WhatIfPreference) { $buildArgs += '-WhatIf' }

  $buildOutput = & powershell.exe @buildArgs 2>&1
  $buildExit = $LASTEXITCODE
  $buildText = ($buildOutput | ForEach-Object { $_.ToString() }) -join "`n"

  if ($buildExit -ne 0) {
    throw "MSIX build failed with exit code $buildExit.`n$buildText"
  }

  $buildResult = $buildText | ConvertFrom-Json
  if (-not $buildResult.msixPath) { throw 'Build result missing msixPath.' }
  if (-not $buildResult.externalLocation) { throw 'Build result missing externalLocation.' }

  $existingPackages = @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue)
  foreach ($pkg in $existingPackages) {
    if ($PSCmdlet.ShouldProcess($pkg.PackageFullName, 'Remove existing package before MSIX install')) {
      Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
    }
  }

  if ($PSCmdlet.ShouldProcess($buildResult.msixPath, "Add-AppxPackage -ExternalLocation $($buildResult.externalLocation)")) {
    Add-AppxPackage -Path $buildResult.msixPath -ExternalLocation $buildResult.externalLocation -ErrorAction Stop
  }

  $installed = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ((-not $WhatIfPreference) -and (-not $installed)) {
    throw "MSIX installation did not appear in Get-AppxPackage: $PackageName"
  }

  [ordered]@{
    success = $true
    packageName = $PackageName
    appPath = $buildResult.appPath
    externalLocation = $buildResult.externalLocation
    msixPath = $buildResult.msixPath
    stageRoot = $StageRoot
    installed = [bool]$installed
    packageFullName = if ($installed) { $installed.PackageFullName } else { $null }
    isDevelopmentMode = if ($installed -and $null -ne $installed.IsDevelopmentMode) { [bool]$installed.IsDevelopmentMode } else { $null }
    signatureKind = if ($installed -and $installed.PSObject.Properties.Match('SignatureKind').Count -gt 0) { [string]$installed.SignatureKind } else { $null }
    dryRun = [bool]$WhatIfPreference
  } | ConvertTo-Json -Depth 6

  exit 0
} catch {
  $errorMessage = $_.Exception.Message

  [ordered]@{
    success = $false
    packageName = $PackageName
    error = $errorMessage
    hint = Get-TroubleshootingHint -Message $errorMessage
    stageRoot = $StageRoot
  } | ConvertTo-Json -Depth 5

  exit 1
}

