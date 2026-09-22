[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DeploymentRoot,
  [switch]$Apply,
  [string]$ReportPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ExecutableName = 'BFRAME_alpha_v2.exe'
$ArchiveName = '배포 백업 (실행 불가)'
$ResolvedDeploymentRoot = $null
$ResolvedReportPath = $null
$Plan = New-Object 'System.Collections.Generic.List[object]'
$Report = [ordered]@{
  schemaVersion = 1
  status = 'planning'
  apply = [bool]$Apply
  deploymentRoot = $null
  archiveRoot = $null
  startedAtUtc = [DateTime]::UtcNow.ToString('o')
  completedAtUtc = $null
  items = @()
  error = $null
  rollbackErrors = @()
}

function Get-AbsolutePath([string]$Value) {
  return [System.IO.Path]::GetFullPath($Value).TrimEnd([char[]]@('\', '/'))
}

function Assert-WithinDeploymentRoot([string]$Value) {
  $absolute = Get-AbsolutePath $Value
  $prefix = $ResolvedDeploymentRoot + [System.IO.Path]::DirectorySeparatorChar
  if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes deployment root: $absolute"
  }
  return $absolute
}

function Assert-NoReparseAncestors([string]$Value) {
  $current = Get-AbsolutePath $Value
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Reparse point is not allowed: $current"
      }
    }
    $parent = [System.IO.Path]::GetDirectoryName($current)
    if ($parent -eq $current) { break }
    $current = $parent
  }
}

function Test-DeploymentCopyName([string]$Name) {
  if ($Name -ceq '검증용-review-playback-input-20260914') { return $true }
  if ($Name -ceq '.__backup_2.1.0-beta_20260821_173537') { return $true }
  return $Name -match '^테스트버전 빌드(?:\.__(?:backup|retired|staging)_[a-z0-9._-]*\d{8}[-_]\d{6}z?|\.backup-[a-z0-9._-]*\d{8}[-_]\d{6}z?| \d+\.\d+\.\d+-beta)$'
}

function Get-Sha256([string]$FilePath) {
  $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

function Get-TreeSnapshot([string]$Directory) {
  $rootPath = Assert-WithinDeploymentRoot $Directory
  Assert-NoReparseAncestors $rootPath
  $stack = New-Object 'System.Collections.Generic.Stack[string]'
  $files = New-Object 'System.Collections.Generic.List[object]'
  $stack.Push($rootPath)
  [long]$bytes = 0
  while ($stack.Count -gt 0) {
    $current = $stack.Pop()
    foreach ($item in @(Get-ChildItem -LiteralPath $current -Force)) {
      $itemPath = Assert-WithinDeploymentRoot $item.FullName
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Reparse point is not allowed in release contents: $itemPath"
      }
      if ($item.PSIsContainer) {
        $stack.Push($itemPath)
      } else {
        $bytes += [long]$item.Length
        $files.Add([pscustomobject]@{
          relativePath = $itemPath.Substring($rootPath.Length + 1)
          bytes = [long]$item.Length
        })
      }
    }
  }
  return [pscustomobject]@{
    fileCount = $files.Count
    bytes = $bytes
    files = @($files.ToArray() | Sort-Object relativePath)
  }
}

function Assert-MatchingSnapshot($Before, $After, [switch]$Disabled) {
  if ($Before.fileCount -ne $After.fileCount -or $Before.bytes -ne $After.bytes) {
    throw 'Release file count or byte count changed during archiving.'
  }
  $expected = @($Before.files | ForEach-Object {
    $relativePath = $_.relativePath
    if ($Disabled -and $relativePath -ieq $ExecutableName) { $relativePath += '.disabled' }
    [pscustomobject]@{ relativePath = $relativePath; bytes = $_.bytes }
  } | Sort-Object relativePath)
  if ((ConvertTo-Json -InputObject $expected -Compress -Depth 4) -cne
      (ConvertTo-Json -InputObject @($After.files) -Compress -Depth 4)) {
    throw 'Release relative paths or file sizes changed during archiving.'
  }
}

function Assert-NoRunningCopies($Items) {
  if ($Items.Count -eq 0) { return }
  # Reading process paths is mandatory. Never stop or restart an application.
  $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
  foreach ($process in $processes) {
    $processPath = [string]$process.ExecutablePath
    if (-not $processPath) {
      if ($process.Name -ieq $ExecutableName) {
        throw "Cannot verify executable path for running process $($process.ProcessId)."
      }
      continue
    }
    $absolute = Get-AbsolutePath $processPath
    foreach ($item in $Items) {
      if ($absolute.StartsWith($item.source + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release copy has a running process: PID $($process.ProcessId), $absolute"
      }
    }
  }
}

function Undo-ArchiveMoves {
  for ($index = $Plan.Count - 1; $index -ge 0; $index--) {
    $item = $Plan[$index]
    if (-not $item.renamed -and -not $item.moved) { continue }
    try {
      [void](Assert-WithinDeploymentRoot $item.source)
      [void](Assert-WithinDeploymentRoot $item.destination)
      Assert-NoReparseAncestors $item.source
      Assert-NoReparseAncestors $item.destination
      if ($item.moved) {
        if (Test-Path -LiteralPath $item.source) { throw "Rollback collision: $($item.source)" }
        [void](Get-TreeSnapshot $item.destination)
        [System.IO.Directory]::Move($item.destination, $item.source)
        $item.moved = $false
      }
      if ($item.renamed) {
        $originalExe = Join-Path $item.source $ExecutableName
        $disabledExe = $originalExe + '.disabled'
        if (Test-Path -LiteralPath $originalExe) { throw "Rollback executable collision: $originalExe" }
        if ((Get-Sha256 $disabledExe) -cne $item.exeSha256Before) {
          throw "Rollback executable hash mismatch; keep the entry disabled: $disabledExe"
        }
        Rename-Item -LiteralPath $disabledExe -NewName $item.entryName -ErrorAction Stop
        $item.renamed = $false
      }
      Assert-MatchingSnapshot $item.snapshot (Get-TreeSnapshot $item.source)
      $item.state = 'rolled-back'
    } catch {
      $item.state = 'rollback-incomplete'
      $Report.rollbackErrors += $_.Exception.Message
    }
  }
}

try {
  $rootItem = Get-Item -LiteralPath $DeploymentRoot -Force
  if (-not $rootItem.PSIsContainer -or $rootItem.PSProvider.Name -ne 'FileSystem') {
    throw 'DeploymentRoot must be an existing filesystem directory.'
  }
  $ResolvedDeploymentRoot = Get-AbsolutePath $rootItem.FullName
  if ($ResolvedDeploymentRoot -eq (Get-AbsolutePath ([System.IO.Path]::GetPathRoot($rootItem.FullName)))) {
    throw 'A filesystem drive root cannot be used as DeploymentRoot.'
  }
  Assert-NoReparseAncestors $ResolvedDeploymentRoot
  $archiveRoot = Assert-WithinDeploymentRoot (Join-Path $ResolvedDeploymentRoot $ArchiveName)
  Assert-NoReparseAncestors $archiveRoot
  if ((Test-Path -LiteralPath $archiveRoot) -and -not (Get-Item -LiteralPath $archiveRoot -Force).PSIsContainer) {
    throw "Archive root collision: $archiveRoot"
  }
  $Report.deploymentRoot = $ResolvedDeploymentRoot
  $Report.archiveRoot = $archiveRoot

  foreach ($directory in @(Get-ChildItem -LiteralPath $ResolvedDeploymentRoot -Directory -Force | Sort-Object Name)) {
    if (-not (Test-DeploymentCopyName $directory.Name)) { continue }
    $source = Assert-WithinDeploymentRoot $directory.FullName
    Assert-NoReparseAncestors $source
    $entryItems = @(Get-ChildItem -LiteralPath $source -File -Force | Where-Object { $_.Name -ieq $ExecutableName })
    if ($entryItems.Count -eq 0) { continue }
    if ($entryItems.Count -ne 1) { throw "Ambiguous entry executable names: $source" }
    $entryExe = $entryItems[0].FullName
    $destination = Assert-WithinDeploymentRoot (Join-Path $archiveRoot $directory.Name)
    Assert-NoReparseAncestors $destination
    if (Test-Path -LiteralPath $destination) { throw "Archive destination collision: $destination" }
    if (Test-Path -LiteralPath ($entryExe + '.disabled')) { throw "Disabled executable collision: $entryExe.disabled" }
    $Plan.Add([pscustomobject]@{
      name = $directory.Name
      entryName = $entryItems[0].Name
      source = $source
      destination = $destination
      state = 'planned'
      snapshot = $null
      before = $null
      after = $null
      exeSha256Before = $null
      exeSha256After = $null
      renamed = $false
      moved = $false
    })
  }

  if ($ReportPath) {
    $candidateReport = Get-AbsolutePath $ReportPath
    Assert-NoReparseAncestors $candidateReport
    if (Test-Path -LiteralPath $candidateReport) { throw "Report path collision: $candidateReport" }
    if (-not (Test-Path -LiteralPath ([System.IO.Path]::GetDirectoryName($candidateReport)) -PathType Container)) {
      throw 'The report parent directory must already exist.'
    }
    foreach ($item in $Plan) {
      if ($candidateReport.StartsWith($item.source + '\', [StringComparison]::OrdinalIgnoreCase) -or
          $candidateReport.StartsWith($archiveRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The report must be stored outside release copies and the archive.'
      }
    }
    $ResolvedReportPath = $candidateReport
  }

  Assert-NoRunningCopies $Plan
  foreach ($item in $Plan) {
    $item.snapshot = Get-TreeSnapshot $item.source
    $item.before = [pscustomobject]@{ fileCount = $item.snapshot.fileCount; bytes = $item.snapshot.bytes }
    $item.exeSha256Before = Get-Sha256 (Join-Path $item.source $ExecutableName)
  }

  if ($Apply -and $Plan.Count -gt 0) {
    # All candidates have passed preflight before the first filesystem mutation.
    [void](Assert-WithinDeploymentRoot $archiveRoot)
    Assert-NoReparseAncestors $archiveRoot
    [void][System.IO.Directory]::CreateDirectory($archiveRoot)
    foreach ($item in $Plan) {
      [void](Assert-WithinDeploymentRoot $item.source)
      [void](Assert-WithinDeploymentRoot $item.destination)
      Assert-NoReparseAncestors $item.source
      Assert-NoReparseAncestors $item.destination
      Assert-MatchingSnapshot $item.snapshot (Get-TreeSnapshot $item.source)
      if (Test-Path -LiteralPath $item.destination) { throw "Archive destination collision: $($item.destination)" }
      $entryExe = Join-Path $item.source $ExecutableName
      if ((Get-Sha256 $entryExe) -cne $item.exeSha256Before) {
        throw "Executable changed since preflight: $entryExe"
      }
      Rename-Item -LiteralPath $entryExe -NewName ($item.entryName + '.disabled') -ErrorAction Stop
      $item.renamed = $true
      $disabledExe = $entryExe + '.disabled'
      if ((Get-Sha256 $disabledExe) -cne $item.exeSha256Before) {
        throw "Disabled executable hash mismatch: $disabledExe"
      }
      # Directory.Move fails on a collision instead of nesting a source in an existing folder.
      [System.IO.Directory]::Move($item.source, $item.destination)
      $item.moved = $true
      $after = Get-TreeSnapshot $item.destination
      Assert-MatchingSnapshot $item.snapshot $after -Disabled
      $item.exeSha256After = Get-Sha256 (Join-Path $item.destination ($ExecutableName + '.disabled'))
      if ($item.exeSha256Before -cne $item.exeSha256After) { throw 'Archived executable SHA-256 mismatch.' }
      $item.after = [pscustomobject]@{ fileCount = $after.fileCount; bytes = $after.bytes }
      $item.state = 'archived'
    }
  }
  $Report.status = if ($Apply) { 'completed' } else { 'dry-run' }
} catch {
  $Report.status = 'failed'
  $Report.error = $_.Exception.Message
  Undo-ArchiveMoves
}

$Report.completedAtUtc = [DateTime]::UtcNow.ToString('o')
$Report.items = @($Plan | Select-Object name, source, destination, state, before, after, exeSha256Before, exeSha256After)
$json = ConvertTo-Json -InputObject $Report -Depth 8
if ($ResolvedReportPath) {
  try {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $stream = [System.IO.File]::Open($ResolvedReportPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    try {
      $buffer = $encoding.GetBytes($json + [Environment]::NewLine)
      $stream.Write($buffer, 0, $buffer.Length)
    } finally { $stream.Dispose() }
  } catch {
    $Report.status = 'report-write-failed'
    $Report.error = $_.Exception.Message
    $json = ConvertTo-Json -InputObject $Report -Depth 8
  }
}
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::WriteLine($json)
if ($Report.status -eq 'failed' -or $Report.status -eq 'report-write-failed') { exit 1 }
exit 0
