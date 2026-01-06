@echo off
:: ============================================
:: baeframe 실행 스크립트
:: - 공유 드라이브 소스를 로컬에 복사
:: - node_modules는 로컬에만 설치 (공유 드라이브 동기화 문제 방지)
:: - package.json 변경 시 자동으로 npm install 실행
:: ============================================

:: UTF-8 인코딩 설정 (한글 깨짐 방지)
chcp 65001 >nul

:: 경로 설정 (trailing backslash 제거)
set SOURCE_DIR=%~dp0
set SOURCE_DIR=%SOURCE_DIR:~0,-1%
set LOCAL_DIR=%APPDATA%\baeframe

echo [baeframe] 소스 경로: %SOURCE_DIR%
echo [baeframe] 로컬 경로: %LOCAL_DIR%

:: 로컬 디렉토리 생성
if not exist "%LOCAL_DIR%" (
    echo [baeframe] 로컬 폴더 생성 중...
    mkdir "%LOCAL_DIR%"
)

:: package.json 해시 비교를 위해 현재 해시 저장
set NEED_INSTALL=0
if exist "%LOCAL_DIR%\node_modules" (
    :: node_modules 존재 - package.json 변경 확인
    if exist "%LOCAL_DIR%\.package-hash" (
        :: 이전 해시와 현재 해시 비교
        certutil -hashfile "%SOURCE_DIR%\package.json" MD5 2>nul | findstr /v ":" > "%TEMP%\baeframe-new-hash.txt"
        fc /b "%LOCAL_DIR%\.package-hash" "%TEMP%\baeframe-new-hash.txt" >nul 2>&1
        if errorlevel 1 (
            echo [baeframe] package.json이 변경되었습니다. 의존성을 업데이트합니다.
            set NEED_INSTALL=1
        )
    ) else (
        :: 해시 파일 없음 - 첫 해시 생성 필요
        set NEED_INSTALL=1
    )
) else (
    :: node_modules 없음 - 설치 필요
    set NEED_INSTALL=1
)

:: 소스 파일 동기화 (node_modules, logs, .git, settings 제외)
echo [baeframe] 소스 동기화 중...
robocopy "%SOURCE_DIR%" "%LOCAL_DIR%" /MIR /XD node_modules logs .git settings /XF *.log .package-hash /NFL /NDL /NJH /NJS

:: robocopy는 성공해도 errorlevel이 0이 아닐 수 있음 (1-7은 정상)
if errorlevel 8 (
    echo [오류] 파일 복사 실패
    pause
    exit /b 1
)

:: 복사 확인
if not exist "%LOCAL_DIR%\package.json" (
    echo [오류] package.json이 복사되지 않았습니다.
    echo 소스 경로를 확인하세요: %SOURCE_DIR%
    pause
    exit /b 1
)

:: 로컬 디렉토리로 이동
cd /d "%LOCAL_DIR%"

:: npm install 실행 (필요한 경우)
if %NEED_INSTALL%==1 (
    if exist "node_modules" (
        echo [baeframe] 의존성 업데이트 중...
    ) else (
        echo [baeframe] 첫 실행 - 패키지 설치 중... (1-2분 소요)
    )
    call npm install
    if errorlevel 1 (
        echo [오류] 패키지 설치 실패. Node.js가 설치되어 있는지 확인하세요.
        pause
        exit /b 1
    )
    :: 설치 완료 후 해시 저장
    certutil -hashfile "%LOCAL_DIR%\package.json" MD5 2>nul | findstr /v ":" > "%LOCAL_DIR%\.package-hash"
    echo [baeframe] 설치 완료!
    echo.
)

:: Electron 캐시 정리 (버전 업데이트 문제 방지)
if exist "%APPDATA%\Electron\Cache" (
    echo [baeframe] Electron 캐시 정리 중...
    rd /s /q "%APPDATA%\Electron\Cache" 2>nul
)

:: Electron 실행 (같은 창에서 디버그 로그 표시)
echo [baeframe] 앱 시작... (%LOCAL_DIR%)
echo.
echo ============================================
echo   디버그 로그 (앱 종료 시 창이 닫힙니다)
echo ============================================
echo.
npx electron .
