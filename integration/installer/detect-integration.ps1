[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SupportedExtensions = @('.mp4', '.mov', '.avi', '.mkv', '.webm')
$ProjectFileAssociations = @(
  @{
    extension = '.bframe'
    progId = 'BAEFRAME.Review'
  },
  @{
    extension = '.bplaylist'
    progId = 'BAEFRAME.Playlist'
  }
)
$VerbKeyName = 'BAEFRAME.Open'
$IntegrationConfigKey = 'Registry::HKEY_CURRENT_USER\Software\BAEFRAME\Integration'
$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$ShellClsidDefault = '{E9C6CF8B-0E51-4C3C-83B6-42FEE932E7F4}'
$AppDataDir = Join-Path $env:APPDATA 'baeframe'
$StatePath = Join-Path $AppDataDir 'integration-state.json'

function Get-WindowsPowerShellPath64 {
  $sysnative = Join-Path $env:WINDIR 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path $sysnative) {
    return $sysnative
  }

  $system32 = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  return $system32
}

function Test-PackagedComActivation {
  param([string]$Clsid)

  try {
    if ([Environment]::Is64BitProcess) {
      $t = [type]::GetTypeFromCLSID([guid]$Clsid)
      $obj = [Activator]::CreateInstance($t)
      if ($obj) {
        try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj) } catch { }
      }
      return [ordered]@{ ok = $true; error = $null }
    }

    $psExe = Get-WindowsPowerShellPath64
    $probe = @(
      '$ErrorActionPreference = ''Stop'''
      ('$t = [type]::GetTypeFromCLSID([guid]''' + $Clsid + ''')')
      '$obj = [Activator]::CreateInstance($t)'
      'if ($obj) { try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj) } catch { } }'
    ) -join '; '

    $out = & $psExe -NoProfile -ExecutionPolicy Bypass -Command $probe 2>&1
    if ($LASTEXITCODE -ne 0) {
      $message = ($out | ForEach-Object { $_.ToString() }) -join "`n"
      return [ordered]@{ ok = $false; error = $message }
    }

    return [ordered]@{ ok = $true; error = $null }
  } catch {
    return [ordered]@{ ok = $false; error = $_.Exception.Message }
  }
}

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
$missingLegacy = @()
$missingRegistry = @()
$projectFiles = [ordered]@{}
$missingProjectFiles = @()

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

if (-not $shellClsid) {
  $shellClsid = $ShellClsidDefault
}

foreach ($ext in $SupportedExtensions) {
  $verbKey = "Registry::HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\$ext\shell\$VerbKeyName"
  $commandKey = Join-Path $verbKey 'command'

  $legacyPresent = (Test-Path $verbKey) -and (Test-Path $commandKey)
  $legacyCommand = $null

  if ($legacyPresent) {
    try {
      $commandItem = Get-Item -Path $commandKey
      $legacyCommand = $commandItem.GetValue('')

      if (-not $appPath) {
        $appPath = Get-AppPathFromCommand -CommandText $legacyCommand
      }
    } catch {
      $legacyPresent = $false
      $legacyCommand = $null
    }
  }

  $registryPresent = $false
  $explorerCommandHandler = $null

  if (Test-Path $verbKey) {
    try {
      $props = Get-ItemProperty -Path $verbKey
      $explorerCommandHandler = $props.ExplorerCommandHandler
      if ($explorerCommandHandler -and (-not [string]::IsNullOrWhiteSpace([string]$explorerCommandHandler))) {
        $registryPresent = $true
      }
    } catch {
      $registryPresent = $false
      $explorerCommandHandler = $null
    }
  }

  if (-not $legacyPresent) {
    $missingLegacy += $ext
  }
  if (-not $registryPresent) {
    $missingRegistry += $ext
  }
  if (-not ($legacyPresent -or $registryPresent)) {
    $missing += $ext
  }

  $extensions[$ext] = [ordered]@{
    present = ($legacyPresent -or $registryPresent)
    legacyPresent = $legacyPresent
    legacyCommand = $legacyCommand
    registryPresent = $registryPresent
    explorerCommandHandler = $explorerCommandHandler
  }
}

foreach ($association in $ProjectFileAssociations) {
  $extension = [string]$association.extension
  $progId = [string]$association.progId
  $extensionKey = "Registry::HKEY_CURRENT_USER\Software\Classes\$extension"
  $progIdKey = "Registry::HKEY_CURRENT_USER\Software\Classes\$progId"
  $commandKey = "Registry::HKEY_CURRENT_USER\Software\Classes\$progId\shell\open\command"

  $extensionProgId = $null
  $label = $null
  $command = $null
  $present = $false

  if (Test-Path $extensionKey) {
    try {
      $extensionItem = Get-Item -Path $extensionKey
      $extensionProgId = $extensionItem.GetValue('')
    } catch {
      $extensionProgId = $null
    }
  }

  if (Test-Path $progIdKey) {
    try {
      $progIdItem = Get-Item -Path $progIdKey
      $label = $progIdItem.GetValue('')
    } catch {
      $label = $null
    }
  }

  if (Test-Path $commandKey) {
    try {
      $commandItem = Get-Item -Path $commandKey
      $command = $commandItem.GetValue('')

      if (-not $appPath) {
        $appPath = Get-AppPathFromCommand -CommandText $command
      }
    } catch {
      $command = $null
    }
  }

  $present = ($extensionProgId -eq $progId) -and (-not [string]::IsNullOrWhiteSpace([string]$command))
  if (-not $present) {
    $missingProjectFiles += $extension
  }

  $projectFiles[$extension] = [ordered]@{
    present = $present
    progId = $progId
    extensionProgId = $extensionProgId
    label = $label
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
    # ignore malformed state file
  }
}

$sparsePackage = $null
try {
  $sparsePackage = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
} catch {
  $sparsePackage = $null
}

$sparseInstalled = $null -ne $sparsePackage
$legacyInstalled = ($missingLegacy.Count -eq 0)

$packagedCom = Test-PackagedComActivation -Clsid $shellClsid

$comInprocKey = "Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\$shellClsid\InprocServer32"
$comInprocExists = Test-Path $comInprocKey
$comHostPath = $null
if ($comInprocExists) {
  try {
    $inproc = Get-Item -Path $comInprocKey
    $comHostPath = $inproc.GetValue('')
  } catch {
    $comHostPath = $null
  }
}

$registryInstalled = ($missingRegistry.Count -eq 0) -and $comInprocExists
$projectFileInstalled = ($missingProjectFiles.Count -eq 0)
$installed = $sparseInstalled -or $registryInstalled -or $legacyInstalled -or $projectFileInstalled

$mode = 'none'
if ($configMode) {
  $mode = [string]$configMode
} elseif ($sparseInstalled) {
  $mode = 'sparse-package'
} elseif ($registryInstalled) {
  $mode = 'registry-shell'
} elseif ($legacyInstalled) {
  $mode = 'legacy-shell'
} elseif ($projectFileInstalled) {
  $mode = 'project-files'
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
  processIs64Bit = [Environment]::Is64BitProcess
  packageName = $PackageName
  sparsePackage = [ordered]@{
    installed = $sparseInstalled
    fullName = if ($sparseInstalled) { $sparsePackage.PackageFullName } else { $null }
    installLocation = if ($sparseInstalled) { $sparsePackage.InstallLocation } else { $null }
  }
  packagedCom = $packagedCom
  registryShell = [ordered]@{
    installed = $registryInstalled
    comInprocKey = $comInprocKey
    comHostPath = $comHostPath
    missingExtensions = $missingRegistry
  }
  legacyShell = [ordered]@{
    installed = $legacyInstalled
    missingExtensions = $missingLegacy
    extensions = $extensions
  }
  projectFiles = [ordered]@{
    installed = $projectFileInstalled
    missingProjectFiles = $missingProjectFiles
    associations = $projectFiles
  }
  configKey = $IntegrationConfigKey
  statePath = $StatePath
}

$result | ConvertTo-Json -Depth 10
if ($installed) { exit 0 } else { exit 1 }
