[CmdletBinding()]
param(
  [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$PackageName = 'StudioJBBJ.BAEFRAME.Integration'
$SetupLogPath = Join-Path $env:APPDATA 'baeframe\integration-setup.log'
$ProvisionLogPath = Join-Path $env:APPDATA 'baeframe\integration-provision.log'

function Get-WindowsPowerShellPath64 {
  $sysnative = Join-Path $env:WINDIR 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path $sysnative) {
    return $sysnative
  }

  $system32 = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  return $system32
}

function Write-Section {
  param([string]$Title)
  Write-Host ''
  Write-Host ('=== ' + $Title + ' ===')
}

function Read-TextFileAutoEncoding {
  param([string]$Path)

  $bytes = [System.IO.File]::ReadAllBytes($Path)

  $text = $null
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $text = $utf8.GetString($bytes)
  } catch {
    $text = [System.Text.Encoding]::Default.GetString($bytes)
  }

  if ($text -and $text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) {
    $text = $text.Substring(1)
  }

  return $text
}

function Read-SetupConfigJson {
  param([string]$Path)

  $raw = Read-TextFileAutoEncoding -Path $Path

  try {
    return ($raw | ConvertFrom-Json)
  } catch {
    $fixed = $raw
    $pathKeys = @('certPath', 'testAppPath', 'shareAppPath')
    foreach ($key in $pathKeys) {
      $pattern = '("' + [regex]::Escape($key) + '"\s*:\s*")([^"]*)(")'
      $fixed = [regex]::Replace($fixed, $pattern, {
        param($m)
        $value = $m.Groups[2].Value
        $value = $value -replace '\\', '\\'
        return $m.Groups[1].Value + $value + $m.Groups[3].Value
      })
    }

    return ($fixed | ConvertFrom-Json)
  }
}

function Read-RegistryDwordOrNull {
  param(
    [string]$KeyPath,
    [string]$Name
  )

  try {
    $v = (Get-ItemProperty -Path $KeyPath -Name $Name -ErrorAction Stop).$Name
    return [int]$v
  } catch {
    return $null
  }
}

Write-Host '[BAEFRAME Integration Diagnostics]'
Write-Host ''

Write-Section -Title 'OS / PowerShell'
try {
  $build = [int][Environment]::OSVersion.Version.Build
  Write-Host ("WindowsBuild = $build")
} catch {
  Write-Host ("WindowsBuild = (error) " + $_.Exception.Message)
}
try {
  Write-Host ("PSVersion = " + $PSVersionTable.PSVersion.ToString())
  Write-Host ("ProcessIs64Bit = " + [string][Environment]::Is64BitProcess)
  Write-Host ("PowerShell64Path = " + (Get-WindowsPowerShellPath64))
} catch {
}

Write-Section -Title 'Config (setup-paths)'
$configFile = $null
if ($ConfigPath) {
  $configFile = $ConfigPath
} else {
  $team = Join-Path $PSScriptRoot 'setup-paths.team.json'
  $default = Join-Path $PSScriptRoot 'setup-paths.json'
  if (Test-Path $team) { $configFile = $team } else { $configFile = $default }
}

try {
  $resolvedConfig = if (Test-Path $configFile) { (Resolve-Path $configFile).Path } else { $configFile }
  Write-Host ("ConfigPath = $resolvedConfig")
} catch {
  Write-Host ("ConfigPath = $configFile")
}

$cfg = $null
try {
  if (Test-Path $configFile) {
    $cfg = Read-SetupConfigJson -Path $configFile
  } else {
    Write-Host "Config file not found."
  }
} catch {
  Write-Host ("Config parse failed: " + $_.Exception.Message)
}

if ($cfg) {
  $share = $null
  try { $share = [string]$cfg.shareAppPath } catch { $share = $null }
  $test = $null
  try { $test = [string]$cfg.testAppPath } catch { $test = $null }

  if ($share) {
    Write-Host ("shareAppPath = $share")
    try { Write-Host ("shareAppPath.exists = " + (Test-Path $share)) } catch { }
  }
  if ($test) {
    Write-Host ("testAppPath = $test")
    try { Write-Host ("testAppPath.exists = " + (Test-Path $test)) } catch { }
  }
}

Write-Section -Title 'AppX Package'
try {
  $pkg = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    Write-Host ("Installed = True")
    Write-Host ("PackageFullName = " + $pkg.PackageFullName)
    if ($pkg.InstallLocation) { Write-Host ("InstallLocation = " + $pkg.InstallLocation) }
    if ($pkg.PSObject.Properties.Match('SignatureKind').Count -gt 0) {
      Write-Host ("SignatureKind = " + [string]$pkg.SignatureKind)
    }
    if ($null -ne $pkg.IsDevelopmentMode) {
      Write-Host ("IsDevelopmentMode = " + [string][bool]$pkg.IsDevelopmentMode)
    }
  } else {
    Write-Host ("Installed = False")
  }
} catch {
  Write-Host ("Get-AppxPackage failed: " + $_.Exception.Message)
}

Write-Section -Title 'Policy'
$policyKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Windows\Appx'
$unlockKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'

Write-Host 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Appx'
Write-Host ("AllowAllTrustedApps = " + (Read-RegistryDwordOrNull -KeyPath $policyKey -Name 'AllowAllTrustedApps'))
Write-Host ("AllowDevelopmentWithoutDevLicense = " + (Read-RegistryDwordOrNull -KeyPath $policyKey -Name 'AllowDevelopmentWithoutDevLicense'))
Write-Host ("BlockNonAdminUserInstall = " + (Read-RegistryDwordOrNull -KeyPath $policyKey -Name 'BlockNonAdminUserInstall'))

Write-Host ''
Write-Host 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock'
Write-Host ("AllowAllTrustedApps = " + (Read-RegistryDwordOrNull -KeyPath $unlockKey -Name 'AllowAllTrustedApps'))
Write-Host ("AllowDevelopmentWithoutDevLicense = " + (Read-RegistryDwordOrNull -KeyPath $unlockKey -Name 'AllowDevelopmentWithoutDevLicense'))

Write-Section -Title '.NET Runtime'
try {
  $dotnetExe = $null
  $pfCandidates = @(
    $env:ProgramW6432,
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    'C:\Program Files'
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  foreach ($pf in $pfCandidates) {
    $candidate = Join-Path $pf 'dotnet\dotnet.exe'
    if (Test-Path $candidate) {
      $dotnetExe = $candidate
      break
    }
  }

  if ($dotnetExe -and (Test-Path $dotnetExe)) {
    Write-Host ("dotnet.exe = " + $dotnetExe)
    $lines = & $dotnetExe --list-runtimes 2>$null
    if ($lines) {
      $coreAll = @($lines | Where-Object { $_ -match '^Microsoft\.NETCore\.App\s+' })
      $core6 = @($coreAll | Where-Object { $_ -match '^Microsoft\.NETCore\.App\s+6\.' })
      $desktopAll = @($lines | Where-Object { $_ -match '^Microsoft\.WindowsDesktop\.App\s+' })
      $desktop6 = @($desktopAll | Where-Object { $_ -match '^Microsoft\.WindowsDesktop\.App\s+6\.' })

      if ($coreAll.Count -gt 0) {
        Write-Host 'Microsoft.NETCore.App:'
        $coreAll | ForEach-Object { Write-Host ('  ' + $_) }
      } else {
        Write-Host 'Microsoft.NETCore.App not found in dotnet --list-runtimes output.'
      }

      if ($desktopAll.Count -gt 0) {
        Write-Host 'Microsoft.WindowsDesktop.App:'
        $desktopAll | ForEach-Object { Write-Host ('  ' + $_) }
      }

      if ($core6.Count -eq 0) {
        Write-Host 'Note: .NET 6 runtime (Microsoft.NETCore.App 6.x) was not detected.'
      } elseif ($desktop6.Count -eq 0) {
        Write-Host 'Note: .NET 6 Desktop runtime is not installed, but .NET 6 runtime is present.'
      }
    } else {
      Write-Host 'dotnet --list-runtimes returned no output.'
    }
  } else {
    Write-Host ("dotnet.exe not found. Checked: " + ($pfCandidates | ForEach-Object { Join-Path $_ 'dotnet\dotnet.exe' } | Select-Object -Unique -join '; '))
    Write-Host 'Note: packaged COM activation can fail with HRESULT 0x80008083 if .NET 6 runtime is missing.'
  }
} catch {
  Write-Host (".NET check failed: " + $_.Exception.Message)
}

Write-Section -Title 'Detect Integration'
try {
  $detectScript = Join-Path $PSScriptRoot 'detect-integration.ps1'
  if (Test-Path $detectScript) {
    $psExe = Get-WindowsPowerShellPath64
    $out = & $psExe -NoProfile -ExecutionPolicy Bypass -File $detectScript 2>&1
    if ($out) {
      $out | ForEach-Object { Write-Host $_.ToString() }
    }
  } else {
    Write-Host "Missing file: $detectScript"
  }
} catch {
  Write-Host ("detect-integration failed: " + $_.Exception.Message)
}

Write-Section -Title 'Log Tails'
Write-Host ("setup log: " + $SetupLogPath)
Write-Host ("provision log: " + $ProvisionLogPath)

if (Test-Path $SetupLogPath) {
  Write-Host '--- setup log tail ---'
  try { Get-Content -Path $SetupLogPath -Tail 15 | ForEach-Object { Write-Host $_ } } catch { }
} else {
  Write-Host '(setup log missing)'
}

Write-Host ''
if (Test-Path $ProvisionLogPath) {
  Write-Host '--- provision log tail ---'
  try { Get-Content -Path $ProvisionLogPath -Tail 15 | ForEach-Object { Write-Host $_ } } catch { }
} else {
  Write-Host '(provision log missing)'
}

Write-Host ''
Write-Host 'Done.'
