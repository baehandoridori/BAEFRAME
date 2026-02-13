@echo off
setlocal
cd /d "%~dp0"

echo [BAEFRAME Integration Setup - Admin]

:: Admin check
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  echo Requesting administrator privileges (UAC)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%ComSpec%' -ArgumentList '/c','""%~f0""' -Verb RunAs"
  exit /b 0
)

echo Running...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1" -Provision
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
