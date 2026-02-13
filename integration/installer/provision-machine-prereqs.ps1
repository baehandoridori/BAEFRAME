[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $false)]
  [string]$CertPath,

  [switch]$SkipCertificateInstall,
  [switch]$SkipPolicySetup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AppDataDir = Join-Path $env:APPDATA 'baeframe'
$LogPath = Join-Path $AppDataDir 'integration-provision.log'
$PolicyKeyPath = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Windows\Appx'
$UnlockKeyPath = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
$CreateCertScriptPath = Join-Path $PSScriptRoot 'create-team-signing-cert.ps1'
$DefaultCertPath = Join-Path $PSScriptRoot 'certs\StudioJBBJ.BAEFRAME.Integration.cer'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Write-ProvisionLog {
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

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-DwordValue {
  param(
    [string]$Path,
    [string]$Name,
    [int]$Value
  )

  if (-not (Test-Path $Path)) {
    if ($PSCmdlet.ShouldProcess($Path, 'Create registry key')) {
      New-Item -Path $Path -Force | Out-Null
    }
  }

  $current = $null
  try {
    $current = (Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue).$Name
  } catch {
    $current = $null
  }

  if ($null -eq $current -or [int]$current -ne $Value) {
    if ($PSCmdlet.ShouldProcess("$Path\\$Name", "Set DWORD value to $Value")) {
      New-ItemProperty -Path $Path -Name $Name -PropertyType DWord -Value $Value -Force | Out-Null
    }
  }
}

function Resolve-ExistingPath {
  param([string]$PathCandidate)

  if ([string]::IsNullOrWhiteSpace($PathCandidate)) {
    return $null
  }

  if (Test-Path $PathCandidate) {
    return (Resolve-Path $PathCandidate).Path
  }

  if (-not [System.IO.Path]::IsPathRooted($PathCandidate)) {
    $relativeCandidate = Join-Path $PSScriptRoot $PathCandidate
    if (Test-Path $relativeCandidate) {
      return (Resolve-Path $relativeCandidate).Path
    }
  }

  return $null
}

function Resolve-CertificatePath {
  param([string]$Candidate)

  if ($Candidate) {
    $resolved = Resolve-ExistingPath -PathCandidate $Candidate
    if (-not $resolved) {
      throw "Specified certificate path does not exist: $Candidate"
    }

    return $resolved
  }

  $candidates = @(
    (Join-Path $PSScriptRoot 'certs\\StudioJBBJ.BAEFRAME.Integration.cer'),
    (Join-Path $PSScriptRoot 'certs\\studiojbbj-baeframe-integration.cer'),
    (Join-Path $PSScriptRoot 'certs\\BAEFRAME-Integration.cer')
  )

  foreach ($pathCandidate in $candidates) {
    if (Test-Path $pathCandidate) {
      return (Resolve-Path $pathCandidate).Path
    }
  }

  return $null
}

try {
  Ensure-Directory -Path $AppDataDir

  Write-ProvisionLog -Level 'INFO' -Message 'Provisioning started' -Data @{
    requestedCertPath = $CertPath
    skipCertificateInstall = [bool]$SkipCertificateInstall
    skipPolicySetup = [bool]$SkipPolicySetup
  }

  $isAdmin = Test-IsAdministrator
  if (-not $isAdmin) {
    throw 'Administrator privileges are required. Right-click CMD/PowerShell and run as administrator.'
  }

  $certificateResult = [ordered]@{
    attempted = $false
    path = $null
    thumbprint = $null
    installedTo = @()
    skipped = [bool]$SkipCertificateInstall
    skippedReason = $null
  }

  if (-not $SkipCertificateInstall) {
    $resolvedCertPath = Resolve-CertificatePath -Candidate $CertPath

    if (-not $resolvedCertPath) {
      Write-ProvisionLog -Level 'WARN' -Message 'Certificate not found. Creating a self-signed team certificate.' -Data @{
        defaultCertPath = $DefaultCertPath
        createScriptPath = $CreateCertScriptPath
      }

      if (-not (Test-Path $CreateCertScriptPath)) {
        throw "Certificate creation script not found: $CreateCertScriptPath"
      }

      $createOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CreateCertScriptPath -Subject 'CN=StudioJBBJ' -OutputDir (Split-Path -Parent $DefaultCertPath) -BaseName 'StudioJBBJ.BAEFRAME.Integration' 2>&1
      $createExit = $LASTEXITCODE
      if ($createOutput) {
        $createOutput | ForEach-Object { Write-ProvisionLog -Level 'INFO' -Message 'create-team-signing-cert output' -Data @{ line = $_.ToString() } }
      }
      if ($createExit -ne 0) {
        throw "Self-signed certificate creation failed with exit code $createExit."
      }

      $resolvedCertPath = Resolve-CertificatePath -Candidate $DefaultCertPath
      if (-not $resolvedCertPath) {
        throw "Certificate creation reported success, but .cer file is still missing: $DefaultCertPath"
      }
    }

    $certificateResult.attempted = $true
    $certificateResult.path = $resolvedCertPath

    $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($resolvedCertPath)
    $certificateResult.thumbprint = $certificate.Thumbprint

    $targetStores = @(
      'Cert:\CurrentUser\Root',
      'Cert:\CurrentUser\TrustedPeople',
      'Cert:\CurrentUser\TrustedPublisher',
      'Cert:\LocalMachine\Root',
      'Cert:\LocalMachine\TrustedPeople',
      'Cert:\LocalMachine\TrustedPublisher'
    )

    foreach ($store in $targetStores) {
      $exists = Get-ChildItem -Path $store | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint }
      if (-not $exists) {
        if ($PSCmdlet.ShouldProcess($store, "Import certificate $($certificate.Thumbprint)")) {
          Import-Certificate -FilePath $resolvedCertPath -CertStoreLocation $store | Out-Null
        }
      }

      $certificateResult.installedTo += $store
    }
  }

  $policyResult = [ordered]@{
    attempted = $false
    skipped = [bool]$SkipPolicySetup
    appxPolicy = [ordered]@{
      allowAllTrustedApps = 1
      allowDevelopmentWithoutDevLicense = 1
      blockNonAdminUserInstall = 0
      allowDeploymentInSpecialProfiles = 1
    }
    appModelUnlock = [ordered]@{
      allowAllTrustedApps = 1
      allowDevelopmentWithoutDevLicense = 1
    }
  }

  if (-not $SkipPolicySetup) {
    $policyResult.attempted = $true

    Set-DwordValue -Path $PolicyKeyPath -Name 'AllowAllTrustedApps' -Value 1
    Set-DwordValue -Path $PolicyKeyPath -Name 'AllowDevelopmentWithoutDevLicense' -Value 1
    Set-DwordValue -Path $PolicyKeyPath -Name 'BlockNonAdminUserInstall' -Value 0
    Set-DwordValue -Path $PolicyKeyPath -Name 'AllowDeploymentInSpecialProfiles' -Value 1

    Set-DwordValue -Path $UnlockKeyPath -Name 'AllowAllTrustedApps' -Value 1
    Set-DwordValue -Path $UnlockKeyPath -Name 'AllowDevelopmentWithoutDevLicense' -Value 1
  }

  Write-ProvisionLog -Level 'INFO' -Message 'Provisioning completed' -Data @{
    certificate = $certificateResult
    policy = $policyResult
  }

  [ordered]@{
    success = $true
    isAdmin = $true
    certificate = $certificateResult
    policy = $policyResult
    logPath = $LogPath
  } | ConvertTo-Json -Depth 6

  exit 0
} catch {
  Write-ProvisionLog -Level 'ERROR' -Message 'Provisioning failed' -Data @{
    error = $_.Exception.Message
    requestedCertPath = $CertPath
    skipCertificateInstall = [bool]$SkipCertificateInstall
    skipPolicySetup = [bool]$SkipPolicySetup
  }

  [ordered]@{
    success = $false
    error = $_.Exception.Message
    logPath = $LogPath
  } | ConvertTo-Json -Depth 4

  exit 1
}


