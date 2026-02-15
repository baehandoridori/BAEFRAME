[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectPath = Join-Path $PSScriptRoot 'BAEFRAME.IntegrationHost\BAEFRAME.IntegrationHost.csproj'
if (-not (Test-Path $projectPath)) {
  throw "Host project file not found: $projectPath"
}

Write-Host "[build-host] Building integration host ($Configuration)..."

dotnet build $projectPath -c $Configuration /p:Platform=x64
if ($LASTEXITCODE -ne 0) {
  throw "dotnet build failed with exit code $LASTEXITCODE"
}

$outputDir = Join-Path $PSScriptRoot "BAEFRAME.IntegrationHost\\bin\\x64\\$Configuration\\net6.0-windows"
$exePath = Join-Path $outputDir 'BAEFRAME.IntegrationHost.exe'

if (-not (Test-Path $exePath)) {
  throw "Host build output missing: $exePath"
}

[ordered]@{
  success = $true
  configuration = $Configuration
  outputDir = $outputDir
  exePath = $exePath
} | ConvertTo-Json -Depth 4

