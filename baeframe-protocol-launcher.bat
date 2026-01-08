@echo off
:: ============================================
:: baeframe:// 프로토콜 런처
:: - 프로토콜 링크 클릭 시 이 파일이 실행됨
:: - 소스 동기화 후 electron 실행
:: ============================================

:: UTF-8 인코딩
chcp 65001 >nul

:: 전달받은 URL 저장
set PROTOCOL_URL=%1

:: 경로 설정
set SOURCE_DIR=%~dp0
set SOURCE_DIR=%SOURCE_DIR:~0,-1%
set LOCAL_DIR=%APPDATA%\baeframe

:: 로컬 디렉토리 생성
if not exist "%LOCAL_DIR%" mkdir "%LOCAL_DIR%"

:: 소스 파일 동기화 (빠른 동기화 - 변경된 파일만)
robocopy "%SOURCE_DIR%" "%LOCAL_DIR%" /MIR /XD node_modules logs .git settings /XF *.log .package-hash /NFL /NDL /NJH /NJS /NP >nul 2>&1

:: 로컬 디렉토리로 이동
cd /d "%LOCAL_DIR%"

:: node_modules가 없으면 설치
if not exist "%LOCAL_DIR%\node_modules" (
    call npm install >nul 2>&1
)

:: Electron 실행 (URL 전달)
start "" "%LOCAL_DIR%\node_modules\electron\dist\electron.exe" "%LOCAL_DIR%" %PROTOCOL_URL%
