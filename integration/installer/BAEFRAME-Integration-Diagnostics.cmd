@echo off
setlocal EnableExtensions
pushd "%~dp0" >nul 2>&1
if %errorlevel% NEQ 0 (
  echo [FAILED] Failed to open the installer folder.
  echo Copy this folder to Desktop and try again.
  echo.
  pause
  exit /b 1
)

echo [BAEFRAME Integration Diagnostics]
echo.

echo [1/5] OS check
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$b=[Environment]::OSVersion.Version.Build; Write-Host ('WindowsBuild = ' + $b)"

echo.
echo [2/5] Config check (setup-paths.team.json)
if exist "%~dp0setup-paths.team.json" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$cfg = Get-Content -Raw '.\\setup-paths.team.json' | ConvertFrom-Json; " ^
    "$p = [string]$cfg.shareAppPath; " ^
    "Write-Host ('shareAppPath = ' + $p); " ^
    "Write-Host ('exists = ' + (Test-Path $p));"
) else (
  echo Missing file: setup-paths.team.json
)

echo.
echo [3/5] Detect integration
if exist "%~dp0detect-integration.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\\detect-integration.ps1"
) else (
  echo Missing file: detect-integration.ps1
)

echo.
echo [4/5] Policy snapshot
echo HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Appx
reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Appx" /v AllowAllTrustedApps 2>nul
reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Appx" /v AllowDevelopmentWithoutDevLicense 2>nul
reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Appx" /v BlockNonAdminUserInstall 2>nul

echo.
echo HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock
reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock" /v AllowAllTrustedApps 2>nul
reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock" /v AllowDevelopmentWithoutDevLicense 2>nul

echo.
echo [.NET runtime check]
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$base='HKLM:\\SOFTWARE\\dotnet\\Setup\\InstalledVersions\\x64\\sharedfx\\Microsoft.WindowsDesktop.App'; " ^
  "if (Test-Path $base) { " ^
  "  $v = Get-ChildItem $base | Select-Object -ExpandProperty PSChildName; " ^
  "  if ($v) { Write-Host ('Microsoft.WindowsDesktop.App = ' + ($v -join ', ')) } else { Write-Host 'Microsoft.WindowsDesktop.App = (none)' } " ^
  "} else { Write-Host 'Microsoft.WindowsDesktop.App = (not found)' }"

echo.
echo [5/5] Log tails
set SETUP_LOG=%APPDATA%\\baeframe\\integration-setup.log
set PROVISION_LOG=%APPDATA%\\baeframe\\integration-provision.log
echo setup log: %SETUP_LOG%
echo provision log: %PROVISION_LOG%

if exist "%SETUP_LOG%" (
  echo --- setup log tail ---
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path (Join-Path $env:APPDATA 'baeframe\\integration-setup.log') -Tail 15"
) else (
  echo (setup log missing)
)

echo.
if exist "%PROVISION_LOG%" (
  echo --- provision log tail ---
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path (Join-Path $env:APPDATA 'baeframe\\integration-provision.log') -Tail 15"
) else (
  echo (provision log missing)
)

echo.
echo Done.
echo.
pause
popd
exit /b 0
