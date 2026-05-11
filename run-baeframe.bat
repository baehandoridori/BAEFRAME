@echo off
rem ============================================
rem baeframe launcher
rem - Mirrors source files to a local AppData folder.
rem - Keeps node_modules local to avoid sync issues.
rem - Runs npm install when package.json changes.
rem ============================================

set "SOURCE_DIR=%~dp0"
set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"
set "LOCAL_DIR=%APPDATA%\baeframe"

echo [baeframe] Source: %SOURCE_DIR%
echo [baeframe] Local: %LOCAL_DIR%

if not exist "%LOCAL_DIR%" (
    echo [baeframe] Creating local folder...
    mkdir "%LOCAL_DIR%"
)

set NEED_INSTALL=0
if exist "%LOCAL_DIR%\node_modules" (
    rem Check whether package.json changed.
    if exist "%LOCAL_DIR%\.package-hash" (
        certutil -hashfile "%SOURCE_DIR%\package.json" MD5 2>nul | findstr /v ":" > "%TEMP%\baeframe-new-hash.txt"
        fc /b "%LOCAL_DIR%\.package-hash" "%TEMP%\baeframe-new-hash.txt" >nul 2>&1
        if errorlevel 1 (
            echo [baeframe] package.json changed. Updating dependencies...
            set NEED_INSTALL=1
        )
    ) else (
        set NEED_INSTALL=1
    )
) else (
    set NEED_INSTALL=1
)

echo [baeframe] Syncing source files...
robocopy "%SOURCE_DIR%" "%LOCAL_DIR%" /MIR /XD node_modules logs .git settings transcoded thumbnails ffmpeg recent-thumbs blob_storage Cache "Code Cache" DawnCache Dictionaries GPUCache "Local Storage" Network "Session Storage" "Shared Dictionary" /XF *.log .package-hash baeframe-auth.dat recent-files.json "Local State" Preferences .git /NFL /NDL /NJH /NJS

rem Robocopy success can return 0-7.
if errorlevel 8 (
    echo [error] Source sync failed.
    pause
    exit /b 1
)

rem FFmpeg binaries are git-ignored, so feature worktrees may not have them.
rem Keep existing local FFmpeg files unless the source has real binaries.
set SOURCE_HAS_FFMPEG=0
if exist "%SOURCE_DIR%\ffmpeg\win32\ffmpeg.exe" (
    if exist "%SOURCE_DIR%\ffmpeg\win32\ffprobe.exe" (
        set SOURCE_HAS_FFMPEG=1
    )
)

set LOCAL_HAS_FFMPEG=0
if exist "%LOCAL_DIR%\ffmpeg\win32\ffmpeg.exe" (
    if exist "%LOCAL_DIR%\ffmpeg\win32\ffprobe.exe" (
        set LOCAL_HAS_FFMPEG=1
    )
)

if "%SOURCE_HAS_FFMPEG%"=="1" (
    echo [baeframe] Syncing FFmpeg binaries...
    robocopy "%SOURCE_DIR%\ffmpeg" "%LOCAL_DIR%\ffmpeg" /MIR /NFL /NDL /NJH /NJS
    if errorlevel 8 (
        echo [error] FFmpeg sync failed.
        pause
        exit /b 1
    )
) else (
    if "%LOCAL_HAS_FFMPEG%"=="1" (
        echo [baeframe] Keeping existing local FFmpeg binaries.
    ) else (
        echo [warning] FFmpeg binaries were not found. Transcoding will be unavailable.
        echo [warning] Add ffmpeg\win32\ffmpeg.exe and ffprobe.exe.
    )
)

if not exist "%LOCAL_DIR%\package.json" (
    echo [error] package.json was not copied.
    echo Source path: %SOURCE_DIR%
    pause
    exit /b 1
)

cd /d "%LOCAL_DIR%"

if %NEED_INSTALL%==1 (
    if exist "node_modules" (
        echo [baeframe] Updating dependencies...
    ) else (
        echo [baeframe] Installing dependencies... This can take 1-2 minutes.
    )
    call npm install
    if errorlevel 1 (
        echo [error] npm install failed. Check that Node.js is installed.
        pause
        exit /b 1
    )
    certutil -hashfile "%LOCAL_DIR%\package.json" MD5 2>nul | findstr /v ":" > "%LOCAL_DIR%\.package-hash"
    echo [baeframe] Dependencies ready.
    echo.
)

if exist "%APPDATA%\Electron\Cache" (
    echo [baeframe] Clearing Electron cache...
    rd /s /q "%APPDATA%\Electron\Cache" 2>nul
)

echo [baeframe] Starting app... (%LOCAL_DIR%)
echo.
echo ============================================
echo   Debug log
echo ============================================
echo.
npx electron .
