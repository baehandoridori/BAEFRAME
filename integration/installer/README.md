# BAEFRAME Windows Integration Installer

Windows 우클릭 진입(이슈 #88) 설치/진단/제거 스크립트입니다.

## 가장 쉬운 실행 방법 (더블클릭)

1. `integration/installer/BAEFRAME-Integration-Setup.cmd` 더블클릭
2. 끝나면 Explorer 재시작 여부(Y/N) 선택
3. `.mp4` 파일 우클릭 -> `BAEFRAME로 열기` 확인

## 설치 방식 (자동 선택)

설치기는 Windows 환경/정책에 따라 아래 순서로 자동 시도합니다.

1. `sparse-package` (Windows 11 신규 우클릭 모델)
2. sparse가 정책/환경 때문에 막히거나 메뉴가 보이지 않으면 자동으로 `registry-shell`로 전환
   - 사용자(HKCU) 범위로 COM(`IExplorerCommand`) + 우클릭 Verb를 등록합니다.
   - 관리자 권한/정책 변경 없이도 동작하도록 만든 플로우입니다.

`legacy-shell`(추가 옵션 표시/클래식 메뉴)은 기본값으로는 만들지 않습니다.

## 파일 구성

- `BAEFRAME-Integration-Setup.cmd`
  - 더블클릭용 런처 (설치 후 Explorer 재시작 선택 포함)
- `BAEFRAME-Integration-Setup-Admin.cmd`
  - (선택) 관리자 권한 프로비저닝 + 설치
  - 원격(예: Parsec) 환경에서는 UAC 보안 데스크톱 때문에 창이 안 보일 수 있습니다.
- `run-integration-setup.ps1`
  - 경로 프리셋(`setup-paths.json`) 기반 자동 설치
  - `-Provision`으로 인증서/정책 선적용 가능
- `install-integration.ps1`
  - 실제 통합 설치 엔진
  - 모드: `Auto` / `Sparse` / `Registry` / `Legacy`
- `detect-integration.ps1`
  - 설치 상태 JSON 출력
- `uninstall-integration.ps1`
  - 설치 해제

## setup-paths.json

```json
{
  "activeProfile": "test",
  "mode": "Auto",
  "enableLegacyFallback": false,
  "provisionPolicyAndCert": false,
  "certPath": "",
  "testAppPath": "C:\\BAEframe\\BAEFRAME\\dist\\win-unpacked\\BFRAME_alpha_v2.exe",
  "shareAppPath": ""
}
```

- `activeProfile=test|share`: 기본 AppPath 선택
- `testAppPath`: 로컬 테스트 exe 경로
- `shareAppPath`: 공유 드라이브 exe 경로
- `mode`:
  - `Auto` (기본): sparse 시도 -> 안 되면 registry-shell로 자동 전환
  - `Registry`: Appx/sparse 없이 레지스트리 방식만 사용
  - `Sparse`: sparse만 강제(정책 차단 시 실패)
  - `Legacy`: 클래식(2차) 메뉴 방식만 사용

팀 PC에서 정책 이슈를 피하려면 `mode=Registry`로 고정하는 것을 권장합니다.

## (선택) 인증서 + 정책까지 한 번에 적용 (관리자 권한)

사내 배포용으로 인증서 신뢰 등록과 정책 적용을 같이 하려면 관리자 권한으로 실행합니다.

```powershell
# 관리자 PowerShell에서 실행
Set-ExecutionPolicy -Scope Process Bypass
.\integration\installer\run-integration-setup.ps1 -Provision
```

또는 CMD 런처에 인자를 전달해서 동일하게 실행할 수 있습니다.

```cmd
.\integration\installer\BAEFRAME-Integration-Setup.cmd -Provision -UseSharePath -CertPath "\\server\share\certs\StudioJBBJ.BAEFRAME.Integration.cer"
```

`-Provision`은 내부적으로 `provision-machine-prereqs.ps1`를 먼저 실행합니다.

## 수동 실행

```powershell
# 설치
.\integration\installer\install-integration.ps1 -AppPath "C:\\BAEframe\\BAEFRAME\\dist\\win-unpacked\\BFRAME_alpha_v2.exe" -Mode Auto

# 진단
.\integration\installer\detect-integration.ps1

# 제거
.\integration\installer\uninstall-integration.ps1
```
