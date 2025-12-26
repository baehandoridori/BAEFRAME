@echo off
:: ============================================
:: baeframe 실행 스크립트
:: 이 파일의 바로가기를 만들어 바탕화면에 두세요
:: ============================================

:: UTF-8 인코딩 설정 (한글 깨짐 방지)
chcp 65001 >nul

cd /d "%~dp0"

:: node_modules가 없으면 먼저 설치
if not exist "node_modules" (
    echo [baeframe] 첫 실행 - 패키지 설치 중...
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
echo [baeframe] 앱 시작...
start "" /B npx electron .

:: 창을 바로 닫지 않고 잠시 대기 (로그 확인용, 필요시 제거)
:: timeout /t 2 /nobreak >nul
