@echo off
:: ============================================
:: baeframe 실행 스크립트
:: - 공유 드라이브 소스를 로컬에 복사
:: - node_modules는 로컬에만 설치 (공유 드라이브 동기화 문제 방지)
:: ============================================

:: UTF-8 인코딩 설정 (한글 깨짐 방지)
chcp 65001 >nul

:: 경로 설정
set SOURCE_DIR=%~dp0
set LOCAL_DIR=%APPDATA%\baeframe

:: 로컬 디렉토리 생성
if not exist "%LOCAL_DIR%" (
    echo [baeframe] 로컬 폴더 생성 중...
    mkdir "%LOCAL_DIR%"
)

:: 소스 파일 동기화 (node_modules, logs, .git 제외)
echo [baeframe] 소스 동기화 중...
robocopy "%SOURCE_DIR%" "%LOCAL_DIR%" /MIR /XD node_modules logs .git /XF *.log /NFL /NDL /NJH /NJS /NC /NS >nul

:: 로컬 디렉토리로 이동
cd /d "%LOCAL_DIR%"

:: node_modules가 없으면 설치
if not exist "node_modules" (
    echo [baeframe] 첫 실행 - 패키지 설치 중... (1-2분 소요)
    call npm install
    if errorlevel 1 (
        echo [오류] 패키지 설치 실패. Node.js가 설치되어 있는지 확인하세요.
        pause
        exit /b 1
    )
    echo [baeframe] 설치 완료!
    echo.
)

:: Electron 실행
echo [baeframe] 앱 시작... (%LOCAL_DIR%)
start "" npx electron .
