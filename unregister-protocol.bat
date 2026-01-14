@echo off
:: ============================================
:: baeframe:// 프로토콜 핸들러 제거
:: 관리자 권한으로 실행해야 합니다
:: ============================================

:: 관리자 권한 확인
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ============================================
    echo   관리자 권한이 필요합니다
    echo ============================================
    echo.
    echo 이 파일을 마우스 오른쪽 버튼으로 클릭하고
    echo "관리자 권한으로 실행"을 선택해주세요.
    echo.
    pause
    exit /b 1
)

echo ============================================
echo   baeframe:// 프로토콜 핸들러 제거
echo ============================================
echo.

:: 레지스트리 삭제
echo [제거] HKEY_CLASSES_ROOT\baeframe 삭제 중...
reg delete "HKEY_CLASSES_ROOT\baeframe" /f >nul 2>&1

if %errorLevel% neq 0 (
    echo [정보] 레지스트리 키가 존재하지 않거나 이미 삭제됨
) else (
    echo [완료] 프로토콜 핸들러 제거됨
)

echo.
pause
