[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $false)]
  [string]$AppPath,

  [ValidateSet('Auto', 'Package', 'Sparse', 'Registry', 'Legacy')]
  [string]$Mode = 'Auto',

  [ValidateSet('Msix', 'Register')]
  [string]$SparseInstallMethod = 'Msix',

  [switch]$EnableRegistryFallback,

  [switch]$EnableLegacyFallback
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SupportedExtensions = @('.mp4', '.mov', '.avi', '.mkv', '.webm')
$VerbKeyName = 'BAEFRAME.Open'
$VerbLabel = ('BAEFRAME' + [string][char]0xB85C + ' ' + [string][char]0xC5F4 + [string][char]0xAE30)
$ShellExtensionClsid = '{E9C6CF8B-0E51-4C3C-83B6-42FEE932E7F4}'
$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$InstallerVersion = '1.5.0'

$AppDataDir = Join-Path $env:APPDATA 'baeframe'
$LogPath = Join-Path $AppDataDir 'integration-setup.log'
$StatePath = Join-Path $AppDataDir 'integration-state.json'
$IntegrationConfigKey = 'Registry::HKEY_CURRENT_USER\Software\BAEFRAME\Integration'
$SparseInstallerScriptPath = Join-Path $PSScriptRoot '..\package\install-sparse-package.ps1'
$SparseMsixInstallerScriptPath = Join-Path $PSScriptRoot '..\package\install-sparse-msix.ps1'
$SparseUninstallScriptPath = Join-Path $PSScriptRoot '..\package\uninstall-sparse-package.ps1'
$FullMsixInstallerScriptPath = Join-Path $PSScriptRoot '..\package\install-full-msix.ps1'
$PrebuiltMsixInstallerScriptPath = Join-Path $PSScriptRoot '..\package\install-prebuilt-msix.ps1'
$PrebuiltMsixPath = Join-Path $PSScriptRoot ('..\package\' + $PackageName + '.msix')

$ShellBuildScriptPath = Join-Path $PSScriptRoot '..\shell\build-shell.ps1'
$ShellBuildOutputDir = Join-Path $PSScriptRoot '..\shell\BAEFRAME.ContextMenu\bin\x64\Release\net6.0-windows'
$RegistryShellInstallDir = Join-Path $env:LOCALAPPDATA 'baeframe\integration-shell'

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

  Add-Content -Path $LogPath -Value ($payload | ConvertTo-Json -Compress -Depth 6) -Encoding UTF8
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
    (Join-Path $PSScriptRoot 'BFRAME_alpha_v2.exe'),
    (Join-Path (Split-Path -Parent $PSScriptRoot) 'BAEFRAME.exe'),
    (Join-Path (Split-Path -Parent $PSScriptRoot) 'BFRAME_alpha_v2.exe'),
    (Join-Path $repoRoot 'BAEFRAME.exe'),
    (Join-Path $repoRoot 'BFRAME_alpha_v2.exe'),
    (Join-Path $repoRoot 'dist\win-unpacked\BAEFRAME.exe'),
    (Join-Path $repoRoot 'dist\win-unpacked\baeframe.exe'),
    (Join-Path $repoRoot 'dist\win-unpacked\BFRAME_alpha_v2.exe')
  )

  foreach ($pathCandidate in $candidates) {
    if ($pathCandidate -and (Test-Path $pathCandidate)) {
      return (Resolve-Path $pathCandidate).Path
    }
  }

  throw 'Unable to locate app executable. Re-run with -AppPath "C:\path\to\BFRAME_alpha_v2.exe".'
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

function Get-VerbNamesForTestFile {
  param([string]$Extension)

  $testName = "integration_probe$Extension"
  $testPath = Join-Path $env:TEMP $testName

  if (-not (Test-Path $testPath)) {
    New-Item -ItemType File -Path $testPath -Force | Out-Null
  }

  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.Namespace((Split-Path $testPath))
  if ($null -eq $folder) {
    return @()
  }

  $item = $folder.ParseName((Split-Path $testPath -Leaf))
  if ($null -eq $item) {
    return @()
  }

  return @($item.Verbs() | ForEach-Object { $_.Name })
}

function Test-ContextMenuVerbVisible {
  param([string]$Extension = '.mp4')

  try {
    $verbs = Get-VerbNamesForTestFile -Extension $Extension
    return (@($verbs | Where-Object { $_ -match 'BAEFRAME' }).Count -gt 0)
  } catch {
    return $false
  }
}

function Test-ShellArtifactsPresent {
  param([string]$Dir)

  $requiredFiles = @(
    'BAEFRAME.ContextMenu.comhost.dll',
    'BAEFRAME.ContextMenu.dll',
    'BAEFRAME.ContextMenu.deps.json',
    'BAEFRAME.ContextMenu.runtimeconfig.json'
  )

  foreach ($fileName in $requiredFiles) {
    if (-not (Test-Path (Join-Path $Dir $fileName))) {
      return $false
    }
  }

  return $true
}

function Ensure-ShellArtifacts {
  param([string]$OutputDir)

  if (Test-ShellArtifactsPresent -Dir $OutputDir) {
    return
  }

  if (-not (Test-Path $ShellBuildScriptPath)) {
    throw "Shell build script not found: $ShellBuildScriptPath"
  }

  Invoke-PowerShellFile -ScriptPath $ShellBuildScriptPath -Arguments @('-Configuration', 'Release') -AllowedExitCodes @(0) | Out-Null

  if (-not (Test-ShellArtifactsPresent -Dir $OutputDir)) {
    throw "Shell build did not produce required artifacts in: $OutputDir"
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

  Ensure-Directory -Path $DestinationDir

  foreach ($fileName in $requiredFiles) {
    $sourcePath = Join-Path $SourceDir $fileName
    if (-not (Test-Path $sourcePath)) {
      throw "Missing shell artifact: $sourcePath"
    }

    Copy-Item -Path $sourcePath -Destination (Join-Path $DestinationDir $fileName) -Force
  }
}

function Register-RegistryComServer {
  param([string]$ComHostPath)

  $clsidKey = "Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\$ShellExtensionClsid"
  $inprocKey = Join-Path $clsidKey 'InprocServer32'

  if ($PSCmdlet.ShouldProcess($clsidKey, 'Register COM server (HKCU)')) {
    New-Item -Path $clsidKey -Force | Out-Null
    New-Item -Path $inprocKey -Force | Out-Null

    Set-ItemProperty -Path $inprocKey -Name '(default)' -Value $ComHostPath -Force
    New-ItemProperty -Path $inprocKey -Name 'ThreadingModel' -PropertyType String -Value 'Apartment' -Force | Out-Null
  }
}

function Register-RegistryShellVerbs {
  param([string]$ResolvedAppPath)

  foreach ($ext in $SupportedExtensions) {
    $verbKey = "Registry::HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\$ext\shell\$VerbKeyName"
    $commandKey = Join-Path $verbKey 'command'

    if ($PSCmdlet.ShouldProcess($verbKey, "Register ExplorerCommand verb for $ext")) {
      New-Item -Path $verbKey -Force | Out-Null

      if (Test-Path $commandKey) {
        Remove-Item -Path $commandKey -Recurse -Force
      }

      New-ItemProperty -Path $verbKey -Name 'MUIVerb' -PropertyType String -Value $VerbLabel -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'Icon' -PropertyType String -Value ("$ResolvedAppPath,0") -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'ExplorerCommandHandler' -PropertyType String -Value $ShellExtensionClsid -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'CommandStateSync' -PropertyType String -Value '' -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'MultiSelectModel' -PropertyType String -Value 'Single' -Force | Out-Null

      Write-SetupLog -Level 'INFO' -Message 'Registered registry ExplorerCommand verb' -Data @{ extension = $ext; key = $verbKey }
    }
  }
}

function Install-RegistryShellIntegration {
  param([string]$ResolvedAppPath)

  Ensure-ShellArtifacts -OutputDir $ShellBuildOutputDir

  if ($PSCmdlet.ShouldProcess($RegistryShellInstallDir, 'Deploy shell artifacts for registry integration')) {
    if (Test-Path $RegistryShellInstallDir) {
      Remove-Item -Path $RegistryShellInstallDir -Recurse -Force
    }

    Ensure-Directory -Path $RegistryShellInstallDir
    Copy-ShellArtifacts -SourceDir $ShellBuildOutputDir -DestinationDir $RegistryShellInstallDir
  }

  $comHostPath = Join-Path $RegistryShellInstallDir 'BAEFRAME.ContextMenu.comhost.dll'
  Register-RegistryComServer -ComHostPath $comHostPath
  Register-RegistryShellVerbs -ResolvedAppPath $ResolvedAppPath

  if (-not (Test-ContextMenuVerbVisible -Extension '.mp4')) {
    throw 'Registry-based ExplorerCommand handler was installed, but BAEFRAME verb is still not visible. Explorer restart may be required, or the COM server may have failed to load.'
  }
}

function Register-LegacyShellVerbs {
  param([string]$ResolvedAppPath)

  $escapedCommand = "`"$ResolvedAppPath`" `"%1`""

  foreach ($ext in $SupportedExtensions) {
    $verbKey = "Registry::HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\$ext\shell\$VerbKeyName"
    $commandKey = Join-Path $verbKey 'command'

    if ($PSCmdlet.ShouldProcess($verbKey, "Register legacy command verb for $ext")) {
      New-Item -Path $verbKey -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'MUIVerb' -PropertyType String -Value $VerbLabel -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'Icon' -PropertyType String -Value $ResolvedAppPath -Force | Out-Null
      New-ItemProperty -Path $verbKey -Name 'MultiSelectModel' -PropertyType String -Value 'Single' -Force | Out-Null

      New-Item -Path $commandKey -Force | Out-Null
      Set-ItemProperty -Path $commandKey -Name '(default)' -Value $escapedCommand -Force

      Write-SetupLog -Level 'INFO' -Message 'Registered legacy extension verb' -Data @{ extension = $ext; key = $verbKey }
    }
  }
}

function Remove-ClassicShellArtifacts {
  foreach ($ext in $SupportedExtensions) {
    $verbKey = "Registry::HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\$ext\shell\$VerbKeyName"

    if ((Test-Path $verbKey) -and $PSCmdlet.ShouldProcess($verbKey, 'Remove classic registry verb')) {
      Remove-Item -Path $verbKey -Recurse -Force
    }
  }

  $clsidKey = "Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\$ShellExtensionClsid"
  if ((Test-Path $clsidKey) -and $PSCmdlet.ShouldProcess($clsidKey, 'Remove classic registry COM registration')) {
    Remove-Item -Path $clsidKey -Recurse -Force
  }

  if ((Test-Path $RegistryShellInstallDir) -and $PSCmdlet.ShouldProcess($RegistryShellInstallDir, 'Remove classic registry shell artifacts dir')) {
    Remove-Item -Path $RegistryShellInstallDir -Recurse -Force
  }
}

function Test-PackagedComActivation {
  param(
    [string]$PackageFamilyName,
    [string]$AppId = 'BAEFRAME',
    [string]$Clsid = $ShellExtensionClsid
  )

  # Explorer is not inside the package, so the COM server must be activatable from the
  # normal (non-packaged) context. Prefer testing activation directly to avoid relying on
  # Invoke-CommandInDesktopPackage output capture quirks.
  try {
    $t = [type]::GetTypeFromCLSID([guid]$Clsid)
    $obj = [Activator]::CreateInstance($t)
    if ($obj) {
      try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj) } catch { }
    }

    return $true
  } catch {
    $hr = if ($_.Exception -and $null -ne $_.Exception.HResult) { [int]$_.Exception.HResult } else { 0 }
    Write-SetupLog -Level 'WARN' -Message 'Packaged COM activation test failed' -Data @{
      error = $_.Exception.Message
      hr = ('0x{0:X8}' -f $hr)
      packageFamilyName = $PackageFamilyName
      appId = $AppId
      clsid = $Clsid
    }
    return $false
  }
}

try {
  Ensure-Directory -Path $AppDataDir

  Write-SetupLog -Level 'INFO' -Message 'Integration install started' -Data @{
    psVersion = $PSVersionTable.PSVersion.ToString()
    requestedAppPath = $AppPath
    requestedMode = $Mode
    sparseInstallMethod = $SparseInstallMethod
    enableRegistryFallback = [bool]$EnableRegistryFallback
    enableLegacyFallback = [bool]$EnableLegacyFallback
  }

  if (-not (Test-Windows11)) {
    throw 'Windows 11 is required for the official integration flow.'
  }

  $resolvedAppPath = Resolve-BaeframePath -Candidate $AppPath

  $resolvedMode = 'none'

  $sparseInstall = [ordered]@{
    attempted = $false
    installed = $false
    scriptPath = $null
    installMethod = $SparseInstallMethod
    error = $null
  }

  $registryShell = [ordered]@{
    attempted = $false
    installed = $false
    installDir = $RegistryShellInstallDir
    error = $null
  }

  $preferPackage = ($Mode -eq 'Auto' -or $Mode -eq 'Package')
  $preferSparse = ($Mode -eq 'Sparse')

  if ($preferPackage) {
    $sparseInstall.attempted = $true

    try {
      Remove-ClassicShellArtifacts

      $msixArgs = @()
      $installerScript = $FullMsixInstallerScriptPath

      if ((Test-Path $PrebuiltMsixInstallerScriptPath) -and (Test-Path $PrebuiltMsixPath)) {
        $installerScript = $PrebuiltMsixInstallerScriptPath
        $msixArgs += @('-MsixPath', $PrebuiltMsixPath)
        $sparseInstall.installMethod = 'PrebuiltMsix'
      } else {
        $sparseInstall.installMethod = 'FullMsix'
      }

      if ($WhatIfPreference) {
        $msixArgs += '-WhatIf'
      }

      $sparseInstall.scriptPath = $installerScript

      $msixResult = Invoke-PowerShellFile -ScriptPath $installerScript -Arguments $msixArgs -AllowedExitCodes @(0)
      $resolvedMode = 'package-msix'

      Write-SetupLog -Level 'INFO' -Message 'MSIX package install completed' -Data @{
        scriptPath = $installerScript
        outputTail = ($msixResult.output | Select-Object -Last 1)
      }

      $pkg = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
      if ((-not $WhatIfPreference) -and (-not $pkg)) {
        throw "Package did not appear in Get-AppxPackage after install: $PackageName"
      }

      $activationOk = $false
      if ($pkg -and $pkg.PackageFamilyName) {
        $activationOk = Test-PackagedComActivation -PackageFamilyName $pkg.PackageFamilyName
      }

      if (-not $activationOk) {
        $warning = 'MSIX package installed, but packaged COM activation failed. This usually means the Windows 11 modern (primary) context menu integration did not take effect.'
        Write-SetupLog -Level 'WARN' -Message $warning -Data @{
          packageFullName = if ($pkg) { $pkg.PackageFullName } else { $null }
          isDevelopmentMode = if ($pkg -and $null -ne $pkg.IsDevelopmentMode) { [bool]$pkg.IsDevelopmentMode } else { $null }
        }

        try {
          if ($pkg -and $pkg.PackageFullName) {
            Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
          }
        } catch {
          Write-SetupLog -Level 'WARN' -Message 'Package uninstall after activation failure failed' -Data @{ error = $_.Exception.Message }
        }

        $sparseInstall.installed = $false
        $sparseInstall.error = $warning
        $resolvedMode = 'none'

        throw $warning
      }

      $sparseInstall.installed = $true
    } catch {
      $sparseInstall.error = $_.Exception.Message

      Write-SetupLog -Level 'WARN' -Message 'MSIX package install failed' -Data @{
        scriptPath = $sparseInstall.scriptPath
        error = $sparseInstall.error
      }

      if ($Mode -eq 'Package') {
        throw "MSIX package mode requested but install failed: $($sparseInstall.error)"
      }
    }
  }

  if ($preferSparse -and ($resolvedMode -eq 'none')) {
    $sparseInstall.attempted = $true
    $sparseInstall.installMethod = $SparseInstallMethod

    try {
      Remove-ClassicShellArtifacts

      $sparseArgs = @('-AppPath', $resolvedAppPath)
      if ($WhatIfPreference) {
        $sparseArgs += '-WhatIf'
      }

      $installerScript = $SparseInstallerScriptPath
      if ($SparseInstallMethod -eq 'Msix') {
        $installerScript = $SparseMsixInstallerScriptPath
      }
      $sparseInstall.scriptPath = $installerScript

      $sparseInstallResult = Invoke-PowerShellFile -ScriptPath $installerScript -Arguments $sparseArgs -AllowedExitCodes @(0)
      $resolvedMode = 'sparse-package'

      Write-SetupLog -Level 'INFO' -Message 'Sparse package install completed' -Data @{
        installMethod = $SparseInstallMethod
        scriptPath = $installerScript
        outputTail = ($sparseInstallResult.output | Select-Object -Last 1)
      }

      $pkg = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
      if ((-not $WhatIfPreference) -and (-not $pkg)) {
        throw "Sparse package registration did not appear in Get-AppxPackage: $PackageName"
      }

      $activationOk = $false
      if ($pkg -and $pkg.PackageFamilyName) {
        $activationOk = Test-PackagedComActivation -PackageFamilyName $pkg.PackageFamilyName
      }

      if (-not $activationOk) {
        $warning = 'Sparse package installed, but packaged COM activation failed. This usually means the Windows 11 modern (primary) context menu integration did not take effect.'
        Write-SetupLog -Level 'WARN' -Message $warning -Data @{
          installMethod = $SparseInstallMethod
          packageFullName = if ($pkg) { $pkg.PackageFullName } else { $null }
          isDevelopmentMode = if ($pkg -and $null -ne $pkg.IsDevelopmentMode) { [bool]$pkg.IsDevelopmentMode } else { $null }
        }

        if (Test-Path $SparseUninstallScriptPath) {
          try {
            Invoke-PowerShellFile -ScriptPath $SparseUninstallScriptPath -Arguments @('-PackageName', $PackageName) -AllowedExitCodes @(0) | Out-Null
          } catch {
            Write-SetupLog -Level 'WARN' -Message 'Sparse package uninstall after activation failure failed' -Data @{ error = $_.Exception.Message }
          }
        }

        $sparseInstall.installed = $false
        $sparseInstall.error = $warning
        $resolvedMode = 'none'

        throw $warning
      }

      $sparseInstall.installed = $true
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

  $preferRegistry = ($resolvedMode -eq 'none') -and ($Mode -eq 'Registry' -or (($Mode -eq 'Auto') -and $EnableRegistryFallback))
  if ($preferRegistry) {
    $registryShell.attempted = $true

    try {
      Install-RegistryShellIntegration -ResolvedAppPath $resolvedAppPath
      $registryShell.installed = $true
      $resolvedMode = 'registry-shell'

      Write-SetupLog -Level 'INFO' -Message 'Registry-based shell integration completed' -Data @{ installDir = $RegistryShellInstallDir }
    } catch {
      $registryShell.error = $_.Exception.Message

      Write-SetupLog -Level 'WARN' -Message 'Registry-based shell integration failed' -Data @{ error = $registryShell.error }

      if ($Mode -eq 'Registry') {
        throw "Registry mode requested but install failed: $($registryShell.error)"
      }
    }
  }

  if ($resolvedMode -eq 'none') {
    if ($Mode -eq 'Legacy' -or $EnableLegacyFallback) {
      Register-LegacyShellVerbs -ResolvedAppPath $resolvedAppPath
      $resolvedMode = 'legacy-shell'
    } else {
      $details = @()
      if ($sparseInstall.attempted -and $sparseInstall.error) {
        $details += ("Sparse: " + $sparseInstall.error)
      }
      if ($registryShell.attempted -and $registryShell.error) {
        $details += ("Registry: " + $registryShell.error)
      }

      $detailText = if ($details.Count -gt 0) { ' Details: ' + ($details -join ' | ') } else { '' }
      throw ('No context menu was registered. Legacy fallback is disabled.' + $detailText)
    }
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
      sparseInstallMethod = $SparseInstallMethod
      enableRegistryFallback = [bool]$EnableRegistryFallback
      enableLegacyFallback = [bool]$EnableLegacyFallback
      windowsBuild = [int][Environment]::OSVersion.Version.Build
      appPath = $resolvedAppPath
      extensions = $SupportedExtensions
      shellClsid = $ShellExtensionClsid
      packageName = $PackageName
      sparseInstall = $sparseInstall
      registryShell = $registryShell
    }

    $state | ConvertTo-Json -Depth 7 | Set-Content -Path $StatePath -Encoding UTF8
  }

  Write-SetupLog -Level 'INFO' -Message 'Integration install completed' -Data @{
    appPath = $resolvedAppPath
    mode = $resolvedMode
    shellClsid = $ShellExtensionClsid
    packageName = $PackageName
    enableLegacyFallback = [bool]$EnableLegacyFallback
  }

  [ordered]@{
    success = $true
    appPath = $resolvedAppPath
    mode = $resolvedMode
    requestedMode = $Mode
    sparseInstallMethod = $SparseInstallMethod
    enableRegistryFallback = [bool]$EnableRegistryFallback
    enableLegacyFallback = [bool]$EnableLegacyFallback
    shellClsid = $ShellExtensionClsid
    packageName = $PackageName
    sparseInstall = $sparseInstall
    registryShell = $registryShell
    extensions = $SupportedExtensions
    configKey = $IntegrationConfigKey
    logPath = $LogPath
    statePath = $StatePath
  } | ConvertTo-Json -Depth 7

  exit 0
} catch {
  Write-SetupLog -Level 'ERROR' -Message 'Integration install failed' -Data @{
    error = $_.Exception.Message
    requestedMode = $Mode
    enableLegacyFallback = [bool]$EnableLegacyFallback
  }

  [ordered]@{
    success = $false
    error = $_.Exception.Message
    requestedMode = $Mode
    enableLegacyFallback = [bool]$EnableLegacyFallback
    logPath = $LogPath
  } | ConvertTo-Json -Depth 4

  exit 1
}

