[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $false)]
  [string]$AppPath,

  [ValidateSet('Auto', 'Sparse', 'Legacy')]
  [string]$Mode = 'Auto'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SupportedExtensions = @('.mp4', '.mov', '.avi', '.mkv', '.webm')
$VerbKeyName = 'BAEFRAME.Open'
$VerbLabel = ('BAEFRAME' + [string][char]0xB85C + ' ' + [string][char]0xC5F4 + [string][char]0xAE30)
$ShellExtensionClsid = '{E9C6CF8B-0E51-4C3C-83B6-42FEE932E7F4}'
$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$InstallerVersion = '1.2.0'

$AppDataDir = Join-Path $env:APPDATA 'baeframe'
$LogPath = Join-Path $AppDataDir 'integration-setup.log'
$StatePath = Join-Path $AppDataDir 'integration-state.json'
$IntegrationConfigKey = 'Registry::HKEY_CURRENT_USER\Software\BAEFRAME\Integration'
$SparseInstallerScriptPath = Join-Path $PSScriptRoot '..\package\install-sparse-package.ps1'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Write-SetupLog {
  param(
    [string]$Level,
    [string]$Message,
    [hashtable]$Data = @{}
  )

  Ensure-Directory -Path $AppDataDir

  $payload = [ordered]@{
    ts = (Get-Date).ToString('o')
    level = $Level
    message = $Message
    data = $Data
  }

  Add-Content -Path $LogPath -Value ($payload | ConvertTo-Json -Compress) -Encoding UTF8
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
    (Join-Path $PSScriptRoot 'BAEFRAME.exe'),
    (Join-Path (Split-Path -Parent $PSScriptRoot) 'BAEFRAME.exe'),
    (Join-Path $repoRoot 'BAEFRAME.exe'),
    (Join-Path $repoRoot 'dist\win-unpacked\BAEFRAME.exe'),
    (Join-Path $repoRoot 'dist\win-unpacked\baeframe.exe')
  )

  foreach ($pathCandidate in $candidates) {
    if ($pathCandidate -and (Test-Path $pathCandidate)) {
      return (Resolve-Path $pathCandidate).Path
    }
  }

  throw 'Unable to locate BAEFRAME executable. Re-run with -AppPath "C:\path\to\BAEFRAME.exe".'
}

function Test-Windows11 {
  $build = [int][Environment]::OSVersion.Version.Build
  return $build -ge 22000
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

function Register-LegacyShellVerbs {
  param([string]$ResolvedAppPath)

  $escapedCommand = "`"$ResolvedAppPath`" `"%1`""

  foreach ($ext in $SupportedExtensions) {
    $verbKey = "Registry::HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\$ext\shell\$VerbKeyName"
    $commandKey = Join-Path $verbKey 'command'

    if ($PSCmdlet.ShouldProcess($verbKey, "Register context menu for $ext")) {
      New-Item -Path $verbKey -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'MUIVerb' -PropertyType String -Value $VerbLabel -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'Icon' -PropertyType String -Value $ResolvedAppPath -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'MultiSelectModel' -PropertyType String -Value 'Single' -Force | Out-Null

      New-Item -Path $commandKey -Force | Out-Null
      Set-ItemProperty -Path $commandKey -Name '(default)' -Value $escapedCommand -Force

      Write-SetupLog -Level 'INFO' -Message 'Registered legacy extension verb' -Data @{
        extension = $ext
        key = $verbKey
      }
    }
  }
}

try {
  Ensure-Directory -Path $AppDataDir

  Write-SetupLog -Level 'INFO' -Message 'Integration install started' -Data @{
    psVersion = $PSVersionTable.PSVersion.ToString()
    requestedAppPath = $AppPath
    requestedMode = $Mode
  }

  if (-not (Test-Windows11)) {
    throw 'Windows 11 is required for the official integration flow.'
  }

  $resolvedAppPath = Resolve-BaeframePath -Candidate $AppPath
  $resolvedMode = 'legacy-shell'
  $sparseInstall = [ordered]@{
    attempted = $false
    installed = $false
    scriptPath = $SparseInstallerScriptPath
    error = $null
  }

  $preferSparse = $Mode -ne 'Legacy'
  if ($preferSparse) {
    $sparseInstall.attempted = $true

    try {
      $sparseArgs = @('-AppPath', $resolvedAppPath)
      if ($WhatIfPreference) {
        $sparseArgs += '-WhatIf'
      }

      $sparseInstallResult = Invoke-PowerShellFile -ScriptPath $SparseInstallerScriptPath -Arguments $sparseArgs -AllowedExitCodes @(0)
      $sparseInstall.installed = $true
      $resolvedMode = 'sparse-package'

      Write-SetupLog -Level 'INFO' -Message 'Sparse package install completed' -Data @{
        scriptPath = $SparseInstallerScriptPath
        outputTail = ($sparseInstallResult.output | Select-Object -Last 1)
      }
    } catch {
      $sparseInstall.error = $_.Exception.Message

      Write-SetupLog -Level 'WARN' -Message 'Sparse package install failed' -Data @{
        scriptPath = $SparseInstallerScriptPath
        error = $sparseInstall.error
      }

      if ($Mode -eq 'Sparse') {
        throw "Sparse package mode requested but install failed: $($sparseInstall.error)"
      }
    }
  }

  if ($resolvedMode -ne 'sparse-package') {
    Register-LegacyShellVerbs -ResolvedAppPath $resolvedAppPath
    $resolvedMode = 'legacy-shell'
  }

  if ($PSCmdlet.ShouldProcess($IntegrationConfigKey, 'Write integration app path config')) {
    New-Item -Path $IntegrationConfigKey -Force | Out-Null
    New-ItemProperty -Path $IntegrationConfigKey -Name 'AppPath' -PropertyType String -Value $resolvedAppPath -Force | Out-Null
    New-ItemProperty -Path $IntegrationConfigKey -Name 'Mode' -PropertyType String -Value $resolvedMode -Force | Out-Null
    New-ItemProperty -Path $IntegrationConfigKey -Name 'ShellClsid' -PropertyType String -Value $ShellExtensionClsid -Force | Out-Null
    New-ItemProperty -Path $IntegrationConfigKey -Name 'PackageName' -PropertyType String -Value $PackageName -Force | Out-Null
    New-ItemProperty -Path $IntegrationConfigKey -Name 'InstallerVersion' -PropertyType String -Value $InstallerVersion -Force | Out-Null
    New-ItemProperty -Path $IntegrationConfigKey -Name 'InstalledAtUtc' -PropertyType String -Value (Get-Date).ToString('o') -Force | Out-Null
  }

  if ($PSCmdlet.ShouldProcess($StatePath, 'Write integration state file')) {
    $state = [ordered]@{
      installerVersion = $InstallerVersion
      installedAt = (Get-Date).ToString('o')
      mode = $resolvedMode
      requestedMode = $Mode
      windowsBuild = [int][Environment]::OSVersion.Version.Build
      appPath = $resolvedAppPath
      extensions = $SupportedExtensions
      shellClsid = $ShellExtensionClsid
      packageName = $PackageName
      sparseInstall = $sparseInstall
    }

    $state | ConvertTo-Json -Depth 6 | Set-Content -Path $StatePath -Encoding UTF8
  }

  Write-SetupLog -Level 'INFO' -Message 'Integration install completed' -Data @{
    appPath = $resolvedAppPath
    mode = $resolvedMode
    shellClsid = $ShellExtensionClsid
    packageName = $PackageName
  }

  [ordered]@{
    success = $true
    appPath = $resolvedAppPath
    mode = $resolvedMode
    requestedMode = $Mode
    shellClsid = $ShellExtensionClsid
    packageName = $PackageName
    sparseInstall = $sparseInstall
    extensions = $SupportedExtensions
    configKey = $IntegrationConfigKey
    logPath = $LogPath
    statePath = $StatePath
  } | ConvertTo-Json -Depth 6

  exit 0
} catch {
  Write-SetupLog -Level 'ERROR' -Message 'Integration install failed' -Data @{
    error = $_.Exception.Message
    requestedMode = $Mode
  }

  [ordered]@{
    success = $false
    error = $_.Exception.Message
    requestedMode = $Mode
    logPath = $LogPath
  } | ConvertTo-Json -Depth 4

  exit 1
}

