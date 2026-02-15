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
$ManifestTemplatePath = Join-Path $PSScriptRoot 'AppxManifest.full.xml'
$AssetsSourceDir = Join-Path $PSScriptRoot 'assets'
$ShellBuildScriptPath = Join-Path $PSScriptRoot '..\shell\build-shell.ps1'
$ShellOutputDir = Join-Path $PSScriptRoot "..\shell\BAEFRAME.ContextMenu\bin\x64\$Configuration\net6.0-windows"
$HostBuildScriptPath = Join-Path $PSScriptRoot '..\host\build-host.ps1'
$HostOutputDir = Join-Path $PSScriptRoot "..\host\BAEFRAME.IntegrationHost\bin\x64\$Configuration\net6.0-windows"
$StageRoot = Join-Path $env:LOCALAPPDATA 'baeframe\integration-msix-package'
$StageAssetsDir = Join-Path $StageRoot 'assets'
$StageManifestPath = Join-Path $StageRoot 'AppxManifest.xml'
$GetBuildToolsScriptPath = Join-Path $PSScriptRoot 'get-windows-sdk-buildtools.ps1'
$CreateCertScriptPath = Join-Path $PSScriptRoot '..\installer\create-team-signing-cert.ps1'
$DefaultCerOutputDir = Join-Path $PSScriptRoot '..\installer\certs'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
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

function Copy-HostArtifacts {
  param(
    [string]$SourceDir,
    [string]$DestinationDir
  )

  $requiredFiles = @(
    'BAEFRAME.IntegrationHost.exe',
    'BAEFRAME.IntegrationHost.dll',
    'BAEFRAME.IntegrationHost.deps.json',
    'BAEFRAME.IntegrationHost.runtimeconfig.json'
  )

  foreach ($fileName in $requiredFiles) {
    $sourcePath = Join-Path $SourceDir $fileName
    if (-not (Test-Path $sourcePath)) {
      throw "Missing host artifact: $sourcePath"
    }

    Copy-Item -Path $sourcePath -Destination (Join-Path $DestinationDir $fileName) -Force
  }
}

function Find-CodeSigningCertificate {
  param(
    [string]$ExpectedSubject,
    [string]$ExpectedThumbprint
  )

  $codeSigningOid = '1.3.6.1.5.5.7.3.3'
  $now = Get-Date
  $storePath = 'Cert:\CurrentUser\My'

  $candidates = @()
  try {
    $candidates = @(Get-ChildItem -Path $storePath -ErrorAction Stop)
  } catch {
    return $null
  }

  if ($ExpectedThumbprint) {
    foreach ($candidate in $candidates) {
      if ($candidate.Thumbprint -eq $ExpectedThumbprint) {
        return $candidate
      }
    }
  }

  foreach ($candidate in ($candidates | Sort-Object NotAfter -Descending)) {
    if ($candidate.Subject -ne $ExpectedSubject) {
      continue
    }

    if ($candidate.NotAfter -le $now.AddDays(1)) {
      continue
    }

    try {
      $ekuExt = $candidate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | Select-Object -First 1
      if ($ekuExt -and $ekuExt.EnhancedKeyUsages -and (@($ekuExt.EnhancedKeyUsages | Where-Object { $_.Value -eq $codeSigningOid }).Count -gt 0)) {
        return $candidate
      }
    } catch {
      continue
    }
  }

  return $null
}

try {
  if (-not (Test-Path $ManifestTemplatePath)) {
    throw "Manifest template not found: $ManifestTemplatePath"
  }

  if (-not (Test-Path $AssetsSourceDir)) {
    throw "Assets directory not found: $AssetsSourceDir"
  }

  if (-not (Test-Path $GetBuildToolsScriptPath)) {
    throw "Build tools resolver script not found: $GetBuildToolsScriptPath"
  }

  if (-not $SkipShellBuild) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ShellBuildScriptPath -Configuration $Configuration | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Shell build failed with exit code $LASTEXITCODE"
    }
  }

  if (-not (Test-Path $ShellOutputDir)) {
    throw "Shell build output dir not found: $ShellOutputDir"
  }

  if (-not $SkipHostBuild) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $HostBuildScriptPath -Configuration $Configuration | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Host build failed with exit code $LASTEXITCODE"
    }
  }

  if (-not (Test-Path $HostOutputDir)) {
    throw "Host build output dir not found: $HostOutputDir"
  }

  if ($PSCmdlet.ShouldProcess($StageRoot, 'Prepare MSIX stage directory')) {
    if (Test-Path $StageRoot) {
      Remove-Item -Path $StageRoot -Recurse -Force
    }

    Ensure-Directory -Path $StageRoot
    Ensure-Directory -Path $StageAssetsDir

    Copy-Item -Path $ManifestTemplatePath -Destination $StageManifestPath -Force
    Copy-Item -Path (Join-Path $AssetsSourceDir '*') -Destination $StageAssetsDir -Recurse -Force
    Copy-ShellArtifacts -SourceDir $ShellOutputDir -DestinationDir $StageRoot
    Copy-HostArtifacts -SourceDir $HostOutputDir -DestinationDir $StageRoot
  }

  $toolArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $GetBuildToolsScriptPath
  )
  if ($BuildToolsVersion) {
    $toolArgs += @('-Version', $BuildToolsVersion)
  }

  $toolsJson = & powershell.exe @toolArgs 2>&1
  $toolsExit = $LASTEXITCODE
  if ($toolsExit -ne 0) {
    throw "Failed to acquire Windows SDK build tools.`n$toolsJson"
  }

  $tools = $toolsJson | ConvertFrom-Json
  if (-not $tools.makeappxPath) { throw 'makeappxPath missing from build tools result.' }
  if (-not $tools.signtoolPath) { throw 'signtoolPath missing from build tools result.' }

  $resolvedMsixPath = $MsixPath
  if (-not $resolvedMsixPath) {
    $resolvedMsixPath = Join-Path $StageRoot 'StudioJBBJ.BAEFRAME.Integration.msix'
  }
  Ensure-Directory -Path (Split-Path -Parent $resolvedMsixPath)

  if ($PSCmdlet.ShouldProcess($resolvedMsixPath, 'makeappx pack')) {
    & $tools.makeappxPath pack /d $StageRoot /p $resolvedMsixPath /nv /o | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "makeappx pack failed with exit code $LASTEXITCODE"
    }
  }

  $selectedCert = $null
  if (-not $SkipSign) {
    $selectedCert = Find-CodeSigningCertificate -ExpectedSubject $CertSubject -ExpectedThumbprint $CertThumbprint

    if (-not $selectedCert) {
      if (-not (Test-Path $CreateCertScriptPath)) {
        throw "Certificate creation script not found: $CreateCertScriptPath"
      }

      Ensure-Directory -Path $DefaultCerOutputDir

      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CreateCertScriptPath -Subject $CertSubject -OutputDir $DefaultCerOutputDir -BaseName 'StudioJBBJ.BAEFRAME.Integration' | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to create a self-signed code signing certificate with subject $CertSubject"
      }

      $selectedCert = Find-CodeSigningCertificate -ExpectedSubject $CertSubject -ExpectedThumbprint $CertThumbprint
      if (-not $selectedCert) {
        throw "Certificate creation succeeded, but no usable certificate was found in Cert:\\CurrentUser\\My for subject $CertSubject"
      }
    }

    if ($PSCmdlet.ShouldProcess($resolvedMsixPath, "signtool sign (thumbprint=$($selectedCert.Thumbprint))")) {
      & $tools.signtoolPath sign /fd SHA256 /sha1 $selectedCert.Thumbprint /s MY $resolvedMsixPath | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "signtool sign failed with exit code $LASTEXITCODE"
      }
    }
  }

  [ordered]@{
    success = $true
    packageName = $PackageName
    stageRoot = $StageRoot
    manifestPath = $StageManifestPath
    msixPath = $resolvedMsixPath
    buildTools = [ordered]@{
      version = $tools.version
      makeappxPath = $tools.makeappxPath
      signtoolPath = $tools.signtoolPath
    }
    signing = [ordered]@{
      skipped = [bool]$SkipSign
      subject = $CertSubject
      thumbprint = if ($selectedCert) { $selectedCert.Thumbprint } else { $null }
    }
    dryRun = [bool]$WhatIfPreference
  } | ConvertTo-Json -Depth 6

  exit 0
} catch {
  [ordered]@{
    success = $false
    error = $_.Exception.Message
    stageRoot = $StageRoot
  } | ConvertTo-Json -Depth 4

  exit 1
}

