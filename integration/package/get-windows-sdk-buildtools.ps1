[CmdletBinding()]
param(
  [string]$Version,
  [string]$CacheDir = (Join-Path $env:LOCALAPPDATA 'baeframe\\windows-sdk-buildtools'),
  [switch]$ForceDownload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Get-LatestBuildToolsVersion {
  try {
    $index = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/index.json'
    if ($index.versions -and $index.versions.Count -gt 0) {
      return [string]$index.versions[-1]
    }
  } catch {
    return $null
  }

  return $null
}

function Find-Tool {
  param(
    [string]$Root,
    [string]$FileName
  )

  if (-not (Test-Path $Root)) {
    return $null
  }

  try {
    $matches = @(Get-ChildItem -Path $Root -Recurse -Filter $FileName -ErrorAction SilentlyContinue)
    if ($matches.Count -eq 0) {
      return $null
    }

    $x64Matches = @($matches | Where-Object { $_.FullName -match '\\\\x64\\\\' })
    if ($x64Matches.Count -gt 0) {
      return ($x64Matches | Sort-Object -Descending -Property FullName | Select-Object -First 1).FullName
    }

    return ($matches | Sort-Object -Descending -Property FullName | Select-Object -First 1).FullName
  } catch {
    return $null
  }

  return $null
}

function Find-WindowsKitTool {
  param([string]$FileName)

  $roots = @(
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
    'C:\\Program Files\\Windows Kits\\10\\bin'
  )

  foreach ($root in $roots) {
    if (-not (Test-Path $root)) {
      continue
    }

    try {
      $matches = @(Get-ChildItem -Path $root -Recurse -Filter $FileName -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\\\x64\\\\' })
      if ($matches.Count -eq 0) {
        continue
      }

      $selected = $matches | Sort-Object -Descending -Property FullName | Select-Object -First 1
      if ($selected) {
        return $selected.FullName
      }
    } catch {
      continue
    }
  }

  return $null
}

try {
  Ensure-Directory -Path $CacheDir

  $systemMakeappx = Find-WindowsKitTool -FileName 'makeappx.exe'
  $systemSigntool = Find-WindowsKitTool -FileName 'signtool.exe'

  if ($systemMakeappx -and $systemSigntool) {
    [ordered]@{
      success = $true
      version = 'system'
      cacheDir = $CacheDir
      toolRoot = $null
      makeappxPath = $systemMakeappx
      signtoolPath = $systemSigntool
    } | ConvertTo-Json -Depth 4

    exit 0
  }

  $resolvedVersion = $Version
  if (-not $resolvedVersion) {
    $resolvedVersion = Get-LatestBuildToolsVersion
  }
  if (-not $resolvedVersion) {
    $resolvedVersion = '10.0.26100.0'
  }

  $toolRoot = Join-Path $CacheDir $resolvedVersion

  $makeappxPath = $null
  $signtoolPath = $null

  if ((-not $ForceDownload) -and (Test-Path $toolRoot)) {
    $makeappxPath = Find-Tool -Root $toolRoot -FileName 'makeappx.exe'
    $signtoolPath = Find-Tool -Root $toolRoot -FileName 'signtool.exe'
  }

  if ((-not $makeappxPath) -or (-not $signtoolPath)) {
    if (Test-Path $toolRoot) {
      Remove-Item -Path $toolRoot -Recurse -Force
    }

    Ensure-Directory -Path $toolRoot

    $packageId = 'microsoft.windows.sdk.buildtools'
    $versionLower = $resolvedVersion.ToLowerInvariant()
    # PowerShell 5.1 Expand-Archive only accepts .zip extension.
    $zipPath = Join-Path $CacheDir ("$packageId.$versionLower.zip")
    $downloadUrl = "https://api.nuget.org/v3-flatcontainer/$packageId/$versionLower/$packageId.$versionLower.nupkg"

    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $zipPath -ErrorAction Stop
    Expand-Archive -Path $zipPath -DestinationPath $toolRoot -Force

    $makeappxPath = Find-Tool -Root $toolRoot -FileName 'makeappx.exe'
    $signtoolPath = Find-Tool -Root $toolRoot -FileName 'signtool.exe'
  }

  if (-not $makeappxPath) {
    throw "makeappx.exe was not found after installing build tools: $toolRoot"
  }
  if (-not $signtoolPath) {
    throw "signtool.exe was not found after installing build tools: $toolRoot"
  }

  [ordered]@{
    success = $true
    version = $resolvedVersion
    cacheDir = $CacheDir
    toolRoot = $toolRoot
    makeappxPath = $makeappxPath
    signtoolPath = $signtoolPath
  } | ConvertTo-Json -Depth 4

  exit 0
} catch {
  [ordered]@{
    success = $false
    error = $_.Exception.Message
    cacheDir = $CacheDir
    requestedVersion = $Version
  } | ConvertTo-Json -Depth 4

  exit 1
}
