@echo off
:: ============================================
:: baeframe 개발 모드 실행 스크립트
:: DevTools가 자동으로 열립니다
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

:: 개발 모드로 Electron 실행 (DevTools 열림)
echo [baeframe] 개발 모드로 앱 시작...
set NODE_ENV=development
npx electron .
