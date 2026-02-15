[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectPath = Join-Path $PSScriptRoot 'BAEFRAME.ContextMenu\BAEFRAME.ContextMenu.csproj'
if (-not (Test-Path $projectPath)) {
  throw "Project file not found: $projectPath"
}

Write-Host "[build-shell] Building shell extension ($Configuration)..."

dotnet build $projectPath -c $Configuration /p:Platform=x64
if ($LASTEXITCODE -ne 0) {
  throw "dotnet build failed with exit code $LASTEXITCODE"
}

$outputDir = Join-Path $PSScriptRoot "BAEFRAME.ContextMenu\bin\x64\$Configuration\net6.0-windows"
$assemblyPath = Join-Path $outputDir 'BAEFRAME.ContextMenu.dll'
$comHostPath = Join-Path $outputDir 'BAEFRAME.ContextMenu.comhost.dll'

if (-not (Test-Path $assemblyPath)) {
  throw "Build output missing: $assemblyPath"
}

if (-not (Test-Path $comHostPath)) {
  throw "COM host output missing: $comHostPath"
}

[ordered]@{
  success = $true
  configuration = $Configuration
  outputDir = $outputDir
  assemblyPath = $assemblyPath
  comHostPath = $comHostPath
  note = 'Use regsvr32 on .comhost.dll for classic COM registration in development.'
} | ConvertTo-Json -Depth 4
