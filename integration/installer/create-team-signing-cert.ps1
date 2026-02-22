[CmdletBinding()]
param(
  [string]$Subject = 'CN=StudioJBBJ',
  [int]$ValidYears = 5,
  [string]$OutputDir = (Join-Path $PSScriptRoot 'certs'),
  [string]$BaseName = 'StudioJBBJ.BAEFRAME.Integration',
  [string]$PfxPassword,
  [switch]$ForceNew
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Find-CodeSigningCertificate {
  param([string]$ExpectedSubject)

  $codeSigningOid = '1.3.6.1.5.5.7.3.3'
  $now = Get-Date

  try {
    $candidates = @(Get-ChildItem -Path 'Cert:\CurrentUser\My' -ErrorAction Stop | Where-Object {
        $_.Subject -eq $ExpectedSubject -and $_.NotAfter -gt $now.AddDays(1)
      })
  } catch {
    return $null
  }

  foreach ($candidate in ($candidates | Sort-Object NotAfter -Descending)) {
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
  if ($ValidYears -lt 1) {
    throw 'ValidYears must be at least 1.'
  }

  Ensure-Directory -Path $OutputDir

  $existingCert = $null
  if (-not $ForceNew) {
    $existingCert = Find-CodeSigningCertificate -ExpectedSubject $Subject
  }

  $cert = $existingCert
  $created = $false

  if (-not $cert) {
    $notAfter = (Get-Date).AddYears($ValidYears)
    $cert = New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject $Subject `
      -HashAlgorithm 'SHA256' `
      -KeyAlgorithm 'RSA' `
      -KeyLength 4096 `
      -KeyExportPolicy Exportable `
      -CertStoreLocation 'Cert:\CurrentUser\My' `
      -NotAfter $notAfter

    $created = $true
  }

  $cerPath = Join-Path $OutputDir ($BaseName + '.cer')
  Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null

  $pfxPath = $null
  if ($PfxPassword) {
    $securePassword = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
    $pfxPath = Join-Path $OutputDir ($BaseName + '.pfx')
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword -Force | Out-Null
  }

  [ordered]@{
    success = $true
    created = $created
    subject = $cert.Subject
    thumbprint = $cert.Thumbprint
    notAfter = $cert.NotAfter.ToString('o')
    certStore = 'Cert:\CurrentUser\My'
    cerPath = $cerPath
    pfxPath = $pfxPath
    note = 'Do not commit .pfx files to source control.'
  } | ConvertTo-Json -Depth 4

  exit 0
} catch {
  [ordered]@{
    success = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Depth 3

  exit 1
}

