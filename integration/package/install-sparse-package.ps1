[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $false)]
  [string]$AppPath,

  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release',

  [switch]$SkipShellBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$ManifestTemplatePath = Join-Path $PSScriptRoot 'AppxManifest.xml'
$AssetsSourceDir = Join-Path $PSScriptRoot 'assets'
$ShellBuildScriptPath = Join-Path $PSScriptRoot '..\shell\build-shell.ps1'
$ShellOutputDir = Join-Path $PSScriptRoot "..\shell\BAEFRAME.ContextMenu\bin\x64\$Configuration\net6.0-windows"
$StageRoot = Join-Path $env:LOCALAPPDATA 'baeframe\integration-sparse-package'
$StageAssetsDir = Join-Path $StageRoot 'assets'
$StageManifestPath = Join-Path $StageRoot 'AppxManifest.xml'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Resolve-BaeframePath {
  param([string]$Candidate)

  if ($Candidate) {
    if (-not (Test-Path $Candidate)) {
      throw "Specified app path does not exist: $Candidate"
    }

    $resolvedCandidate = (Resolve-Path $Candidate).Path
    if ([System.IO.Path]::GetExtension($resolvedCandidate).ToLowerInvariant() -ne '.exe') {
      throw "App path must point to an executable: $resolvedCandidate"
    }

    return $resolvedCandidate
  }

  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $candidates = @(
    (Join-Path $repoRoot 'BAEFRAME.exe'),
    (Join-Path $repoRoot 'BFRAME_alpha_v2.exe'),
    (Join-Path $repoRoot 'dist\win-unpacked\BAEFRAME.exe'),
    (Join-Path $repoRoot 'dist\win-unpacked\baeframe.exe'),
    (Join-Path $repoRoot 'dist\win-unpacked\BFRAME_alpha_v2.exe')
  )

  foreach ($candidatePath in $candidates) {
    if ($candidatePath -and (Test-Path $candidatePath)) {
      return (Resolve-Path $candidatePath).Path
    }
  }

  throw 'Unable to locate app executable. Re-run with -AppPath "C:\path\to\BFRAME_alpha_v2.exe".'
}

function Invoke-PowerShellFile {
  param(
    [string]$ScriptPath,
    [string[]]$Arguments = @(),
    [int[]]$AllowedExitCodes = @(0)
  )

  if (-not (Test-Path $ScriptPath)) {
    throw "Script not found: $ScriptPath"
  }

  $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + $Arguments
  $output = & powershell.exe @psArgs 2>&1
  $exitCode = $LASTEXITCODE
  $outputText = ($output | ForEach-Object { $_.ToString() }) -join "`n"

  if ($AllowedExitCodes -notcontains $exitCode) {
    $message = "Script failed ($ScriptPath) with exit code $exitCode."
    if ($outputText) {
      $message += "`n$outputText"
    }
    throw $message
  }

  return [ordered]@{
    exitCode = $exitCode
    output = $outputText
  }
}

function Copy-ShellArtifacts {
  param(
    [string]$SourceDir,
    [string]$DestinationDir
  )

  $requiredFiles = @(
    'BAEFRAME.ContextMenu.comhost.dll',
    'BAEFRAME.ContextMenu.dll',
    'BAEFRAME.ContextMenu.deps.json',
    'BAEFRAME.ContextMenu.runtimeconfig.json'
  )

  foreach ($fileName in $requiredFiles) {
    $sourcePath = Join-Path $SourceDir $fileName
    if (-not (Test-Path $sourcePath)) {
      throw "Missing shell artifact: $sourcePath"
    }

    Copy-Item -Path $sourcePath -Destination (Join-Path $DestinationDir $fileName) -Force
  }
}

function Get-TroubleshootingHint {
  param([string]$Message)

  if (-not $Message) {
    return $null
  }

  if ($Message -match '0x80073D2E') {
    return 'External content deployment is blocked (HRESULT 0x80073D2E). Enable Developer Mode or the policy that allows external content deployment.'
  }

  if ($Message -match '0x80080204') {
    return 'AppxManifest schema validation failed (HRESULT 0x80080204). Validate Verb Id/Clsid format, namespaces, and file paths.'
  }

  return $null
}

try {
  $resolvedAppPath = Resolve-BaeframePath -Candidate $AppPath
  $externalLocation = Split-Path -Parent $resolvedAppPath
  $appExecutableName = Split-Path -Leaf $resolvedAppPath

  if (-not (Test-Path $ManifestTemplatePath)) {
    throw "Manifest template not found: $ManifestTemplatePath"
  }

  if (-not (Test-Path $AssetsSourceDir)) {
    throw "Assets directory not found: $AssetsSourceDir"
  }

  if (-not $SkipShellBuild) {
    Invoke-PowerShellFile -ScriptPath $ShellBuildScriptPath -Arguments @('-Configuration', $Configuration) -AllowedExitCodes @(0) | Out-Null
  }

  if ($PSCmdlet.ShouldProcess($StageRoot, 'Prepare sparse package stage directory')) {
    if (Test-Path $StageRoot) {
      Remove-Item -Path $StageRoot -Recurse -Force
    }

    Ensure-Directory -Path $StageRoot
    Ensure-Directory -Path $StageAssetsDir

    $manifestContent = Get-Content -Path $ManifestTemplatePath -Raw
    $manifestContent = [regex]::Replace($manifestContent, 'Executable="[^"]+"', ('Executable="{0}"' -f $appExecutableName), 1)
    Set-Content -Path $StageManifestPath -Value $manifestContent -Encoding UTF8

    Copy-Item -Path (Join-Path $AssetsSourceDir '*') -Destination $StageAssetsDir -Recurse -Force
    Copy-ShellArtifacts -SourceDir $ShellOutputDir -DestinationDir $StageRoot
  }

  $existingPackages = @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue)
  foreach ($pkg in $existingPackages) {
    if ($PSCmdlet.ShouldProcess($pkg.PackageFullName, 'Remove existing sparse package before re-register')) {
      Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
    }
  }

  if ($PSCmdlet.ShouldProcess($StageManifestPath, "Register sparse package (ExternalLocation=$externalLocation)")) {
    Add-AppxPackage -Register $StageManifestPath -ExternalLocation $externalLocation -ErrorAction Stop
  }

  $installedPackage = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ((-not $WhatIfPreference) -and (-not $installedPackage)) {
    throw "Sparse package registration did not appear in Get-AppxPackage: $PackageName"
  }

  [ordered]@{
    success = $true
    packageName = $PackageName
    appPath = $resolvedAppPath
    externalLocation = $externalLocation
    stageRoot = $StageRoot
    manifestPath = $StageManifestPath
    installed = [bool]$installedPackage
    packageFullName = if ($installedPackage) { $installedPackage.PackageFullName } else { $null }
    dryRun = [bool]$WhatIfPreference
  } | ConvertTo-Json -Depth 5

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

