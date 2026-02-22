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

set "PS64=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "PS64=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS64%" set "PS64=powershell"

echo Running diagnostics...
echo.

if not exist "%~dp0diagnose-integration.ps1" (
  echo [FAILED] Missing file: diagnose-integration.ps1
  echo Extract the whole ZIP and try again.
  echo.
  pause
  popd
  exit /b 1
)

"%PS64%" -NoProfile -ExecutionPolicy Bypass -File ".\\diagnose-integration.ps1" %*
set EXIT_CODE=%ERRORLEVEL%

echo.
pause
popd
exit /b %EXIT_CODE%
