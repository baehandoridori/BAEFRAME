[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release',

  [string]$MsixPath,

  [string]$CertThumbprint,

  [string]$CertSubject = 'CN=StudioJBBJ',

  [switch]$SkipShellBuild,

  [switch]$SkipHostBuild,

  [switch]$SkipSign,

  [string]$BuildToolsVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$BuildScriptPath = Join-Path $PSScriptRoot 'build-full-msix.ps1'
$StageRoot = Join-Path $env:LOCALAPPDATA 'baeframe\integration-msix-package'

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

  if ($MsixPath) { $buildArgs += @('-MsixPath', $MsixPath) }
  if ($CertThumbprint) { $buildArgs += @('-CertThumbprint', $CertThumbprint) }
  if ($CertSubject) { $buildArgs += @('-CertSubject', $CertSubject) }
  if ($SkipShellBuild) { $buildArgs += '-SkipShellBuild' }
  if ($SkipHostBuild) { $buildArgs += '-SkipHostBuild' }
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

  $removeWarnings = @()
  $existingPackages = @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue)
  foreach ($pkg in $existingPackages) {
    if ($PSCmdlet.ShouldProcess($pkg.PackageFullName, 'Remove existing package before MSIX install')) {
      try {
        Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
      } catch {
        $message = $_.Exception.Message
        if ($message -match '0x80073CF1') {
          $removeWarnings += ("Remove-AppxPackage skipped for " + $pkg.PackageFullName + " (0x80073CF1)")
        } else {
          throw
        }
      }
    }
  }

  if ($PSCmdlet.ShouldProcess($buildResult.msixPath, 'Add-AppxPackage')) {
    Add-AppxPackage -Path $buildResult.msixPath -ErrorAction Stop
  }

  $installed = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ((-not $WhatIfPreference) -and (-not $installed)) {
    throw "MSIX installation did not appear in Get-AppxPackage: $PackageName"
  }

  [ordered]@{
    success = $true
    packageName = $PackageName
    msixPath = $buildResult.msixPath
    stageRoot = $StageRoot
    installed = [bool]$installed
    packageFullName = if ($installed) { $installed.PackageFullName } else { $null }
    isDevelopmentMode = if ($installed -and $null -ne $installed.IsDevelopmentMode) { [bool]$installed.IsDevelopmentMode } else { $null }
    signatureKind = if ($installed -and $installed.PSObject.Properties.Match('SignatureKind').Count -gt 0) { [string]$installed.SignatureKind } else { $null }
    removeWarnings = $removeWarnings
    dryRun = [bool]$WhatIfPreference
  } | ConvertTo-Json -Depth 6

  exit 0
} catch {
  $errorMessage = $_.Exception.Message

  [ordered]@{
    success = $false
    packageName = $PackageName
    error = $errorMessage
    stageRoot = $StageRoot
  } | ConvertTo-Json -Depth 5

  exit 1
}
