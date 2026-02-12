@echo off
setlocal
cd /d "%~dp0"

echo [BAEFRAME Integration Setup]
echo Running...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% EQU 0 (
  echo [SUCCESS] Integration install completed.
) else (
  echo [FAILED] Integration install failed. Check output above.
)

echo.
pause
exit /b %EXIT_CODE%
