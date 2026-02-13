[CmdletBinding(SupportsShouldProcess = $true)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SupportedExtensions = @('.mp4', '.mov', '.avi', '.mkv', '.webm')
$VerbKeyName = 'BAEFRAME.Open'
$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$ShellExtensionClsid = '{E9C6CF8B-0E51-4C3C-83B6-42FEE932E7F4}'
$RegistryShellInstallDir = Join-Path $env:LOCALAPPDATA 'baeframe\integration-shell'

$AppDataDir = Join-Path $env:APPDATA 'baeframe'
$LogPath = Join-Path $AppDataDir 'integration-setup.log'
$StatePath = Join-Path $AppDataDir 'integration-state.json'
$IntegrationConfigKey = 'Registry::HKEY_CURRENT_USER\Software\BAEFRAME\Integration'
$SparseUninstallScriptPath = Join-Path $PSScriptRoot '..\package\uninstall-sparse-package.ps1'

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

try {
  Write-SetupLog -Level 'INFO' -Message 'Integration uninstall started'

  $sparseUninstall = [ordered]@{
    attempted = $false
    success = $false
    scriptPath = $SparseUninstallScriptPath
    packageName = $PackageName
    error = $null
  }

  if (Test-Path $SparseUninstallScriptPath) {
    $sparseUninstall.attempted = $true

    try {
      $sparseArgs = @('-PackageName', $PackageName)
      if ($WhatIfPreference) {
        $sparseArgs += '-WhatIf'
      }

      $result = Invoke-PowerShellFile -ScriptPath $SparseUninstallScriptPath -Arguments $sparseArgs -AllowedExitCodes @(0)
      $sparseUninstall.success = $true

      Write-SetupLog -Level 'INFO' -Message 'Sparse package uninstall completed' -Data @{
        scriptPath = $SparseUninstallScriptPath
        outputTail = ($result.output | Select-Object -Last 1)
      }
    } catch {
      $sparseUninstall.error = $_.Exception.Message
      Write-SetupLog -Level 'WARN' -Message 'Sparse package uninstall failed' -Data @{ error = $sparseUninstall.error }
    }
  }

  foreach ($ext in $SupportedExtensions) {
    $verbKey = "Registry::HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\$ext\shell\$VerbKeyName"

    if ((Test-Path $verbKey) -and $PSCmdlet.ShouldProcess($verbKey, 'Remove integration verb')) {
      Remove-Item -Path $verbKey -Recurse -Force
      Write-SetupLog -Level 'INFO' -Message 'Removed extension verb' -Data @{ extension = $ext }
    }
  }

  $clsidKey = "Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\$ShellExtensionClsid"
  if ((Test-Path $clsidKey) -and $PSCmdlet.ShouldProcess($clsidKey, 'Remove registry COM registration')) {
    Remove-Item -Path $clsidKey -Recurse -Force
    Write-SetupLog -Level 'INFO' -Message 'Removed registry COM registration' -Data @{ clsid = $ShellExtensionClsid }
  }

  if ((Test-Path $RegistryShellInstallDir) -and $PSCmdlet.ShouldProcess($RegistryShellInstallDir, 'Remove registry shell artifacts')) {
    Remove-Item -Path $RegistryShellInstallDir -Recurse -Force
    Write-SetupLog -Level 'INFO' -Message 'Removed registry shell artifacts' -Data @{ installDir = $RegistryShellInstallDir }
  }

  if ((Test-Path $IntegrationConfigKey) -and $PSCmdlet.ShouldProcess($IntegrationConfigKey, 'Remove integration app config')) {
    Remove-Item -Path $IntegrationConfigKey -Recurse -Force
    Write-SetupLog -Level 'INFO' -Message 'Removed integration config key' -Data @{ key = $IntegrationConfigKey }
  }

  if ((Test-Path $StatePath) -and $PSCmdlet.ShouldProcess($StatePath, 'Remove integration state file')) {
    Remove-Item -Path $StatePath -Force
    Write-SetupLog -Level 'INFO' -Message 'Removed integration state file' -Data @{ statePath = $StatePath }
  }

  [ordered]@{
    success = $true
    removedExtensions = $SupportedExtensions
    removedComClsid = $ShellExtensionClsid
    removedArtifactsDir = $RegistryShellInstallDir
    removedConfigKey = $IntegrationConfigKey
    sparseUninstall = $sparseUninstall
    logPath = $LogPath
  } | ConvertTo-Json -Depth 5

  exit 0
} catch {
  Write-SetupLog -Level 'ERROR' -Message 'Integration uninstall failed' -Data @{ error = $_.Exception.Message }

  [ordered]@{
    success = $false
    error = $_.Exception.Message
    logPath = $LogPath
  } | ConvertTo-Json -Depth 4

  exit 1
}
