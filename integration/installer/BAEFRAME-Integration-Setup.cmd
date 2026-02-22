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

echo [BAEFRAME Integration Setup]
echo.

echo Running...
if "%~1"=="" (
  "%PS64%" -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1" -Provision
) else (
  "%PS64%" -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1" -Provision %*
)
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% EQU 0 (
  echo [SUCCESS] Integration install completed.
  echo.
  echo If the right-click menu does not show immediately,
  echo restarting Explorer may be required.
  choice /c YN /n /m "Restart Explorer now? [Y/N]: "
  if errorlevel 2 (
    echo Skipped Explorer restart.
  ) else (
    taskkill /f /im explorer.exe >nul 2>&1
    start explorer.exe
  )
) else (
  echo [FAILED] Integration install failed. Check output above.
  echo If the error mentions ".NET 6 Runtime", run BAEFRAME-Install-DotNet6.cmd first.
)

echo.
pause
popd
exit /b %EXIT_CODE%
