# BAEFRAME Windows Integration Installer

Windows 우클릭 진입(이슈 #88) 설치/진단/제거 스크립트입니다.

## 가장 쉬운 실행 방법 (프로그램처럼 실행)

1. `integration/installer/BAEFRAME-Integration-Setup.cmd`를 더블클릭
2. 콘솔 창에서 결과(JSON + 성공/실패 문구) 확인

이 런처는 `run-integration-setup.ps1`를 호출하며, 기본적으로 **Win11 1차 우클릭(sparse package)만** 시도합니다.
정책 때문에 sparse가 막히면 실패하며, 자동으로 legacy 메뉴를 만들지 않습니다.

## 파일 구성

- `BAEFRAME-Integration-Setup.cmd`
  - 더블클릭용 런처 (프로그램 실행 방식)
- `run-integration-setup.ps1`
  - 경로 프리셋(`setup-paths.json`)을 읽어 자동 설치 실행
- `setup-paths.json`
  - 테스트/공유 드라이브 exe 경로 프리셋
- `install-integration.ps1`
  - 실제 설치 엔진
- `detect-integration.ps1`
  - 설치 상태 JSON 출력
- `uninstall-integration.ps1`
  - 설치 해제

## 기본 정책

- 기본 모드: `Auto` (sparse 우선)
- 기본값은 `EnableLegacyFallback=false`
- 즉, sparse 실패 시 설치 실패 처리(요구사항: 2차 메뉴보다 차라리 미설치)

legacy가 꼭 필요할 때만 명시적으로 허용:

```powershell
.\install-integration.ps1 -AppPath "C:\path\to\BFRAME_alpha_v2.exe" -Mode Auto -EnableLegacyFallback
```

## setup-paths.json (현재 테스트 경로)

```json
{
  "activeProfile": "test",
  "mode": "Auto",
  "enableLegacyFallback": false,
  "testAppPath": "C:\\BAEframe\\BAEFRAME\\dist\\win-unpacked\\BFRAME_alpha_v2.exe",
  "shareAppPath": ""
}
```

- 지금은 `testAppPath`가 우선 사용됩니다.
- 테스트 완료 후 `shareAppPath`를 채우고 `activeProfile`을 `share`로 바꾸면 됩니다.

## 수동 실행

```powershell
# 설치 (sparse-only 기본)
.\install-integration.ps1 -AppPath "C:\BAEframe\BAEFRAME\dist\win-unpacked\BFRAME_alpha_v2.exe"

# 진단
.\detect-integration.ps1

# 제거
.\uninstall-integration.ps1
```

## 정책 관련 주의

- `0x80073D2E`가 나오면 Windows 정책에서 external content deployment가 막힌 상태입니다.
- 이 정책은 우회할 수 없고, 관리자 정책/Developer Mode 허용이 필요합니다.
