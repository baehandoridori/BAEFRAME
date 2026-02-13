@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [BAEFRAME Integration Setup - Admin]
echo.

rem Admin check (more reliable than `net session`)
fltmc >nul 2>&1
if %errorlevel% NEQ 0 (
  echo 관리자 권한이 필요합니다.
  echo 잠시 후 UAC(사용자 계정 컨트롤) 창이 뜨면 "예"를 눌러주세요.
  echo UAC가 안 보이면 Alt+Tab 또는 작업표시줄을 확인하세요.
  echo.

  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%ComSpec%' -ArgumentList '/c','""%~f0""' -Verb RunAs | Out-Null; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
  if %errorlevel% NEQ 0 (
    echo.
    echo [FAILED] 관리자 권한 요청에 실패했습니다.
    echo 이 창을 닫고 파일을 우클릭 -> "관리자 권한으로 실행"으로 다시 시도해 주세요.
    echo.
    pause
    exit /b 1
  )

  echo.
  echo UAC 승인 후 새 창에서 설치가 진행됩니다.
  echo (이 창은 3초 뒤 자동으로 닫힙니다)
  timeout /t 3 >nul
  exit /b 0
)

echo Running...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-integration-setup.ps1" -Provision
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% EQU 0 (
  echo [SUCCESS] Integration install completed.
) else (
  echo [FAILED] Integration install failed. Check output above.
)

echo.
pause
exit /b %EXIT_CODE%
