[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $false)]
  [string]$MsixPath,

  [ValidateSet('StudioJBBJ.BAEFRAME.Integration')]
  [string]$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $resolvedMsixPath = $MsixPath
  if (-not $resolvedMsixPath) {
    $resolvedMsixPath = Join-Path $PSScriptRoot ($PackageName + '.msix')
  }

  if (-not (Test-Path $resolvedMsixPath)) {
    throw "Prebuilt MSIX not found: $resolvedMsixPath"
  }

  $resolvedMsixPath = (Resolve-Path $resolvedMsixPath).Path

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

  if ($PSCmdlet.ShouldProcess($resolvedMsixPath, 'Add-AppxPackage')) {
    Add-AppxPackage -Path $resolvedMsixPath -ErrorAction Stop
  }

  $installed = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ((-not $WhatIfPreference) -and (-not $installed)) {
    throw "MSIX installation did not appear in Get-AppxPackage: $PackageName"
  }

  [ordered]@{
    success = $true
    packageName = $PackageName
    msixPath = $resolvedMsixPath
    installed = [bool]$installed
    packageFullName = if ($installed) { $installed.PackageFullName } else { $null }
    isDevelopmentMode = if ($installed -and $null -ne $installed.IsDevelopmentMode) { [bool]$installed.IsDevelopmentMode } else { $null }
    signatureKind = if ($installed -and $installed.PSObject.Properties.Match('SignatureKind').Count -gt 0) { [string]$installed.SignatureKind } else { $null }
    removeWarnings = $removeWarnings
    dryRun = [bool]$WhatIfPreference
  } | ConvertTo-Json -Depth 5

  exit 0
} catch {
  [ordered]@{
    success = $false
    packageName = $PackageName
    error = $_.Exception.Message
  } | ConvertTo-Json -Depth 4

  exit 1
}
