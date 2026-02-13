@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [BAEFRAME Integration Setup]
echo.

rem Admin check (more reliable than `net session`)
fltmc >nul 2>&1
if %errorlevel% NEQ 0 (
  echo Admin privileges are required.
  echo A UAC prompt will appear. Click "Yes" to continue.
  echo If you do not see the UAC prompt, for example on remote desktop, try Alt+Tab or check the taskbar.
  echo.

  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
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
  exit /b 0
)

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
)

echo.
pause
exit /b %EXIT_CODE%
