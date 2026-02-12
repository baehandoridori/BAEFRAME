[CmdletBinding()]
param(
  [string]$Subject = 'CN=StudioJBBJ Development Team',
  [int]$ValidYears = 5,
  [string]$OutputDir = (Join-Path $PSScriptRoot 'certs'),
  [string]$PfxPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

try {
  if ($ValidYears -lt 1) {
    throw 'ValidYears must be at least 1.'
  }

  Ensure-Directory -Path $OutputDir

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

  $baseName = ('baeframe-team-signing-' + (Get-Date).ToString('yyyyMMdd-HHmmss'))
  $cerPath = Join-Path $OutputDir ($baseName + '.cer')
  Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null

  $pfxPath = $null
  if ($PfxPassword) {
    $securePassword = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
    $pfxPath = Join-Path $OutputDir ($baseName + '.pfx')
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword -Force | Out-Null
  }

  [ordered]@{
    success = $true
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
