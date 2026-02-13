@echo off
setlocal
cd /d "%~dp0"

echo [BAEFRAME Integration Setup]
echo Running...
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1" %*
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
)

echo.
pause
exit /b %EXIT_CODE%
