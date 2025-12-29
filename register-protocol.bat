@echo off
:: ============================================
:: baeframe:// 프로토콜 등록 스크립트
:: 관리자 권한으로 실행해야 합니다 (1회만)
:: ============================================

:: 관리자 권한 확인
net session >nul 2>&1
if errorlevel 1 (
    echo 이 스크립트는 관리자 권한으로 실행해야 합니다.
    echo 파일을 우클릭하고 "관리자 권한으로 실행"을 선택하세요.
    pause
    exit /b 1
)

cd /d "%~dp0"
set "APP_PATH=%~dp0run-baeframe.bat"

echo ============================================
echo   baeframe 프로토콜 등록
echo ============================================
echo.
echo 등록할 경로: %APP_PATH%
echo.

:: baeframe:// 프로토콜 등록
reg add "HKCU\Software\Classes\baeframe" /ve /d "URL:baeframe Protocol" /f
reg add "HKCU\Software\Classes\baeframe" /v "URL Protocol" /d "" /f
reg add "HKCU\Software\Classes\baeframe\shell\open\command" /ve /d "\"%APP_PATH%\" \"%%1\"" /f

if errorlevel 1 (
    echo [오류] 프로토콜 등록 실패
    pause
    exit /b 1
)

echo.
echo ============================================
echo   프로토콜 등록 완료!
echo ============================================
echo.
echo 이제 슬랙 등에서 baeframe://... 링크를 클릭하면
echo baeframe이 자동으로 실행됩니다.
echo.
pause
