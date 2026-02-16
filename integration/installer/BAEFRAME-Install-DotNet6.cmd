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

echo [BAEFRAME .NET 6 Runtime Setup]
echo.
echo Running...

powershell -NoProfile -ExecutionPolicy Bypass -File ".\provision-machine-prereqs.ps1" -SkipCertificateInstall -SkipPolicySetup
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% EQU 0 (
  echo [SUCCESS] .NET runtime check/install completed.
) else (
  echo [FAILED] .NET runtime setup failed. Check output above.
)

echo.
pause
popd
exit /b %EXIT_CODE%

