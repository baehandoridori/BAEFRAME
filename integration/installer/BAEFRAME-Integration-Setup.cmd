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

echo [BAEFRAME Integration Setup]
echo.

echo Running...
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1" -Provision
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1" -Provision %*
)
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% EQU 0 (
  echo [SUCCESS] Integration install completed.
  echo.
  echo If the right-click menu does not show immediately,
  echo restarting Explorer may be required.
  choice /c YN /n /m "Restart Explorer now? [Y/N]: "
  if errorlevel 2 goto :after_restart
  taskkill /f /im explorer.exe >nul 2>&1
  start explorer.exe
  :after_restart
) else (
  echo [FAILED] Integration install failed. Check output above.
  echo If the error mentions ".NET 6 Runtime", run BAEFRAME-Install-DotNet6.cmd first.
)

echo.
pause
popd
exit /b %EXIT_CODE%
