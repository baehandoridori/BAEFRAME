@echo off
:: ============================================
:: baeframe:// 프로토콜 핸들러 등록
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

:: 현재 디렉토리로 이동
cd /d "%~dp0"

echo ============================================
echo   baeframe:// 프로토콜 핸들러 등록
echo ============================================
echo.

:: VBScript 래퍼 경로
set "LAUNCHER=%~dp0protocol-launcher.vbs"

:: VBScript 파일 존재 확인
if not exist "%LAUNCHER%" (
    echo [오류] protocol-launcher.vbs 파일을 찾을 수 없습니다.
    echo        %LAUNCHER%
    pause
    exit /b 1
)

echo [정보] 래퍼 스크립트: %LAUNCHER%
echo.

:: 레지스트리 등록
echo [등록] HKEY_CLASSES_ROOT\baeframe 생성 중...

:: 프로토콜 루트 키 생성
reg add "HKEY_CLASSES_ROOT\baeframe" /ve /d "URL:BAEFRAME Protocol" /f >nul
reg add "HKEY_CLASSES_ROOT\baeframe" /v "URL Protocol" /d "" /f >nul

:: 아이콘 (선택사항 - exe가 있으면 사용)
if exist "%~dp0dist\win-unpacked\BFRAME_alpha_v2.exe" (
    reg add "HKEY_CLASSES_ROOT\baeframe\DefaultIcon" /ve /d "\"%~dp0dist\win-unpacked\BFRAME_alpha_v2.exe\",0" /f >nul
)

:: 핵심: VBScript 래퍼를 통해 실행
:: wscript.exe는 %XX를 환경변수로 해석하지 않음
reg add "HKEY_CLASSES_ROOT\baeframe\shell\open\command" /ve /d "wscript.exe \"%LAUNCHER%\" \"%%1\"" /f >nul

if %errorLevel% neq 0 (
    echo [오류] 레지스트리 등록 실패
    pause
    exit /b 1
)

echo.
echo ============================================
echo   등록 완료!
echo ============================================
echo.
echo 이제 baeframe:// 링크가 올바르게 작동합니다.
echo 한글 경로가 포함된 URL도 정상 처리됩니다.
echo.
echo 테스트 방법:
echo   1. Win+R 실행
echo   2. baeframe://G:/테스트/test.bframe 입력
echo   3. 앱이 열리고 파일이 로드되는지 확인
echo.
pause
