@echo off
setlocal EnableExtensions
pushd "%~dp0" >nul 2>&1
if %errorlevel% NEQ 0 (
  echo [FAILED] Failed to open the installer folder.
  echo If you are running from a network path, copy this folder to Desktop and try again.
  echo.
  pause
  exit /b 1
)

set "PS64=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "PS64=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS64%" set "PS64=powershell"

echo [BAEFRAME Integration Setup - Admin]
echo.

rem Admin check via WindowsPrincipal (fltmc can return success even without elevation)
"%PS64%" -NoProfile -ExecutionPolicy Bypass -Command "$id=[Security.Principal.WindowsIdentity]::GetCurrent(); $p=New-Object Security.Principal.WindowsPrincipal($id); if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 0}else{exit 1}"
if %errorlevel% NEQ 0 (
  echo Admin privileges are required.
  echo A UAC prompt will appear. Click "Yes" to continue.
  echo If you do not see the UAC prompt, for example on remote desktop, try Alt+Tab or check the taskbar.
  echo.

  "%PS64%" -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  if %errorlevel% NEQ 0 (
    echo.
    echo [FAILED] Elevation request failed.
    echo Close this window, then right-click this file and choose "Run as administrator".
    echo.
    pause
    exit /b 1
  )

  echo.
  echo After you approve UAC, setup will continue in a new window.
  echo This window will close in 3 seconds.
  timeout /t 3 >nul
  popd
  exit /b 0
)

echo Running...
"%PS64%" -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1" -Provision %*
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% EQU 0 (
  echo [SUCCESS] Integration install completed.
) else (
  echo [FAILED] Integration install failed. Check output above.
  echo If the error mentions ".NET 6 Runtime", run BAEFRAME-Install-DotNet6.cmd first.
)

echo.
pause
popd
exit /b %EXIT_CODE%
