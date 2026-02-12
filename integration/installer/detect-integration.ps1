[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SupportedExtensions = @('.mp4', '.mov', '.avi', '.mkv', '.webm')
$VerbKeyName = 'BAEFRAME.Open'
$IntegrationConfigKey = 'Registry::HKEY_CURRENT_USER\Software\BAEFRAME\Integration'
$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$AppDataDir = Join-Path $env:APPDATA 'baeframe'
$StatePath = Join-Path $AppDataDir 'integration-state.json'

function Get-AppPathFromCommand {
  param([string]$CommandText)

  if (-not $CommandText) {
    return $null
  }

  if ($CommandText -match '^"([^"]+)"') {
    return $matches[1]
  }

  return $null
}

$build = [int][Environment]::OSVersion.Version.Build
$osSupported = $build -ge 22000

$extensions = [ordered]@{}
$appPath = $null
$configMode = $null
$shellClsid = $null
$missing = @()

if (Test-Path $IntegrationConfigKey) {
  try {
    $configProps = Get-ItemProperty -Path $IntegrationConfigKey
    $appPath = $configProps.AppPath
    $configMode = $configProps.Mode
    $shellClsid = $configProps.ShellClsid
  } catch {
    # ignore config read errors
  }
}

foreach ($ext in $SupportedExtensions) {
  $verbKey = "Registry::HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\$ext\shell\$VerbKeyName"
  $commandKey = Join-Path $verbKey 'command'

  $present = (Test-Path $verbKey) -and (Test-Path $commandKey)
  $command = $null

  if ($present) {
    try {
      $commandItem = Get-Item -Path $commandKey
      $command = $commandItem.GetValue('')

      if (-not $appPath) {
        $appPath = Get-AppPathFromCommand -CommandText $command
      }
    } catch {
      $present = $false
    }
  }

  if (-not $present) {
    $missing += $ext
  }

  $extensions[$ext] = [ordered]@{
    present = $present
    command = $command
  }
}

if ((-not $appPath) -and (Test-Path $StatePath)) {
  try {
    $state = Get-Content -Raw $StatePath | ConvertFrom-Json

    if ($state.appPath) {
      $appPath = [string]$state.appPath
    }
    if ((-not $configMode) -and $state.mode) {
      $configMode = [string]$state.mode
    }
    if ((-not $shellClsid) -and $state.shellClsid) {
      $shellClsid = [string]$state.shellClsid
    }
  } catch {
    # Ignore malformed state file
  }
}

$sparsePackage = $null
try {
  $sparsePackage = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
} catch {
  $sparsePackage = $null
}

$sparseInstalled = $null -ne $sparsePackage
$legacyInstalled = ($missing.Count -eq 0)
$installed = $sparseInstalled -or $legacyInstalled
$mode = 'none'

if ($sparseInstalled) {
  $mode = 'sparse-package'
} elseif ($legacyInstalled) {
  if ($configMode) {
    $mode = [string]$configMode
  } else {
    $mode = 'legacy-shell'
  }
}

$result = [ordered]@{
  success = $true
  osSupported = $osSupported
  windowsBuild = $build
  installed = $installed
  mode = $mode
  appPath = $appPath
  appPathExists = if ($appPath) { Test-Path $appPath } else { $false }
  shellClsid = $shellClsid
  packageName = $PackageName
  sparsePackage = [ordered]@{
    installed = $sparseInstalled
    fullName = if ($sparseInstalled) { $sparsePackage.PackageFullName } else { $null }
    installLocation = if ($sparseInstalled) { $sparsePackage.InstallLocation } else { $null }
  }
  legacyShell = [ordered]@{
    installed = $legacyInstalled
    missingExtensions = $missing
    extensions = $extensions
  }
  configKey = $IntegrationConfigKey
  statePath = $StatePath
}

$result | ConvertTo-Json -Depth 8
if ($installed) { exit 0 } else { exit 1 }
