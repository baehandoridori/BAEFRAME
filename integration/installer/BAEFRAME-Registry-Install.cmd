@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [BAEFRAME Integration Setup - Team]
echo.

rem Use share-drive profile from setup-paths.team.json
call "%~dp0BAEFRAME-Integration-Setup.cmd" -UseSharePath -ConfigPath ".\\setup-paths.team.json" %*
exit /b %ERRORLEVEL%

