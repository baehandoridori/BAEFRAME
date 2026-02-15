[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$PackageName = 'StudioJBBJ.BAEFRAME.Integration',
  [switch]$KeepStageFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$StageRoot = Join-Path $env:LOCALAPPDATA 'baeframe\integration-sparse-package'

try {
  $removed = @()
  $existingPackages = @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue)

  foreach ($pkg in $existingPackages) {
    if ($PSCmdlet.ShouldProcess($pkg.PackageFullName, 'Remove sparse package registration')) {
      Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
      $removed += $pkg.PackageFullName
    }
  }

  if ((-not $KeepStageFiles) -and (Test-Path $StageRoot) -and $PSCmdlet.ShouldProcess($StageRoot, 'Remove sparse package stage files')) {
    Remove-Item -Path $StageRoot -Recurse -Force
  }

  [ordered]@{
    success = $true
    packageName = $PackageName
    removedCount = $removed.Count
    removedPackages = $removed
    stageRoot = $StageRoot
    stageExists = Test-Path $StageRoot
    dryRun = [bool]$WhatIfPreference
  } | ConvertTo-Json -Depth 5

  exit 0
} catch {
  [ordered]@{
    success = $false
    packageName = $PackageName
    error = $_.Exception.Message
    stageRoot = $StageRoot
  } | ConvertTo-Json -Depth 4

  exit 1
}
