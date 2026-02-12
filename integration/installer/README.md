# BAEFRAME Windows Integration Installer

Windows 우클릭 진입(이슈 #88) 설치/진단/제거 스크립트입니다.

## 스크립트

- `install-integration.ps1`
  - 기본 모드: `Auto` (`sparse-package` 우선 시도, 실패 시 `legacy-shell` fallback)
  - 지원 확장자(`.mp4/.mov/.avi/.mkv/.webm`) 통합 등록
  - 앱 경로/모드 상태 저장:
    - `HKCU\Software\BAEFRAME\Integration`
- `detect-integration.ps1`
  - 설치 상태 JSON 출력 (`installed`, `mode`, `sparsePackage`, `legacyShell` 등)
- `uninstall-integration.ps1`
  - sparse package 제거 시도 + legacy 컨텍스트 메뉴/상태 제거

## 설치 모드

- `Auto` (기본): sparse package 등록 우선, 실패 시 legacy shell 등록
- `Sparse`: sparse package만 시도 (실패 시 에러 반환)
- `Legacy`: 레지스트리 기반 legacy shell만 등록

## 사용

```powershell
# 설치 (Auto)
.\install-integration.ps1

# 설치 (강제 sparse)
.\install-integration.ps1 -Mode Sparse -AppPath "C:\Program Files\BAEFRAME\BAEFRAME.exe"

# 설치 (강제 legacy)
.\install-integration.ps1 -Mode Legacy

# 진단
.\detect-integration.ps1

# 제거
.\uninstall-integration.ps1
```

## 로그/상태 파일

- 로그: `%APPDATA%\baeframe\integration-setup.log`
- 상태: `%APPDATA%\baeframe\integration-state.json`

## 참고

- Win11 1차 우클릭 목표 경로는 `sparse package + IExplorerCommand`입니다.
- sparse package 등록 스크립트는 `integration/package/install-sparse-package.ps1`에 있습니다.
