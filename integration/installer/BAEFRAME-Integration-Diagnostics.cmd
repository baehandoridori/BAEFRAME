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

powershell -NoProfile -ExecutionPolicy Bypass -File ".\\diagnose-integration.ps1" %*
set EXIT_CODE=%ERRORLEVEL%

echo.
pause
popd
exit /b %EXIT_CODE%

