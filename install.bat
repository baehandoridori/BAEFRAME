@echo off
:: ============================================
:: baeframe 설치 스크립트
:: Node.js가 설치되어 있어야 합니다
:: ============================================

cd /d "%~dp0"

echo ============================================
echo   baeframe 설치
echo ============================================
echo.

:: Node.js 확인
where node >nul 2>nul
if errorlevel 1 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo https://nodejs.org 에서 Node.js LTS를 설치해주세요.
    echo.
    pause
    exit /b 1
)

:: Node 버전 표시
echo [확인] Node.js 버전:
node --version
echo.

:: npm install 실행
echo [설치] 패키지 설치 중...
call npm install
if errorlevel 1 (
    echo [오류] 패키지 설치 실패
    pause
    exit /b 1
)

echo.
echo ============================================
echo   설치 완료!
echo ============================================
echo.
echo 실행 방법:
echo   1. run-baeframe.bat 더블클릭
echo   2. 또는 run-baeframe.bat의 바로가기를 바탕화면에 만드세요
echo.
pause
