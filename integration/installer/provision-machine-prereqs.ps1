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

function Resolve-CertificatePath {
  param([string]$Candidate)

  if ($Candidate) {
    if (-not (Test-Path $Candidate)) {
      throw "Specified certificate path does not exist: $Candidate"
    }

    return (Resolve-Path $Candidate).Path
  }

  $candidates = @(
    (Join-Path $PSScriptRoot 'certs\StudioJBBJ.BAEFRAME.Integration.cer'),
    (Join-Path $PSScriptRoot 'certs\studiojbbj-baeframe-integration.cer'),
    (Join-Path $PSScriptRoot 'certs\BAEFRAME-Integration.cer')
  )

  foreach ($pathCandidate in $candidates) {
    if (Test-Path $pathCandidate) {
      return (Resolve-Path $pathCandidate).Path
    }
  }

  throw 'Certificate file not found. Re-run with -CertPath "C:\path\to\StudioJBBJ.BAEFRAME.Integration.cer".'
}

function Set-DwordValue {
  param(
    [string]$Path,
    [string]$Name,
    [int]$Value
  )

  if ($PSCmdlet.ShouldProcess("$Path::$Name", "Set DWORD value to $Value")) {
    if (-not (Test-Path $Path)) {
      New-Item -Path $Path -Force | Out-Null
    }

    New-ItemProperty -Path $Path -Name $Name -PropertyType DWord -Value $Value -Force | Out-Null
  }
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
  }

  if (-not $SkipCertificateInstall) {
    $resolvedCertPath = Resolve-CertificatePath -Candidate $CertPath
    $certificateResult.attempted = $true
    $certificateResult.path = $resolvedCertPath

    $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($resolvedCertPath)
    $certificateResult.thumbprint = $certificate.Thumbprint

    $targetStores = @(
      'Cert:\LocalMachine\Root',
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
