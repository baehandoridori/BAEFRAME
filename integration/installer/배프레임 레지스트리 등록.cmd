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

echo [BAEFRAME Integration Setup - Team]
echo.

if not exist "%~dp0BAEFRAME-Integration-Setup.cmd" (
  echo [FAILED] Missing file: BAEFRAME-Integration-Setup.cmd
  echo You may have extracted only part of the ZIP. Extract the whole folder structure and try again.
  echo.
  pause
  popd
  exit /b 1
)

if not exist "%~dp0setup-paths.team.json" (
  echo [FAILED] Missing config file: setup-paths.team.json
  echo.
  pause
  popd
  exit /b 1
)

rem Use share-drive profile from setup-paths.team.json
call "%~dp0BAEFRAME-Integration-Setup.cmd" -UseSharePath -ConfigPath ".\\setup-paths.team.json" %*
set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%
