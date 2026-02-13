# BAEFRAME Windows Integration Installer

Windows 우클릭 진입(이슈 #88) 설치/진단/제거 스크립트입니다.

## 가장 쉬운 실행 방법 (더블클릭)

1. `integration/installer/BAEFRAME-Integration-Setup.cmd` 더블클릭
   - UAC(관리자 권한) 창이 뜨면 `예`를 눌러주세요.
2. 끝나면 Explorer 재시작 여부(Y/N) 선택
3. `.mp4` 파일 우클릭 -> `BAEFRAME로 열기` 확인

## 설치 방식 (자동 선택)

Windows 11 **1차(신규) 우클릭 메뉴** 노출을 목표로 하기 때문에, 기본값은 아래로 동작합니다.

1. `sparse-package` (signed MSIX 기반)만 시도
2. 설치는 성공했는데 Packaged COM 활성화가 실패하면 **실패 처리**하고 자동 롤백(패키지 제거)합니다.

즉, 기본값은 **"2차(추가 옵션 표시) 메뉴에만 뜨는 통합"을 만들지 않습니다.**

원하면 아래 중 하나로 2차 메뉴 fallback을 **명시적으로** 켤 수 있습니다.
- `setup-paths.json`에서 `enableRegistryFallback=true`
- 또는 `mode=Registry` (Appx/sparse 없이 레지스트리 방식만 사용)

`legacy-shell`(클래식 command verb)은 기본값으로는 만들지 않습니다.

## 파일 구성

- `BAEFRAME-Integration-Setup.cmd`
  - 더블클릭용 런처 (관리자 승격 + 인증서/정책 프로비저닝 + 설치 + Explorer 재시작 선택 포함)
- `BAEFRAME-Integration-Setup-Admin.cmd`
  - (선택) 관리자 권한 프로비저닝 + 설치 (동작은 `BAEFRAME-Integration-Setup.cmd`와 동일한 목적)
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
  "sparseInstallMethod": "Msix",
  "enableRegistryFallback": false,
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
  - `Auto` (기본): sparse(signed MSIX)만 시도 (fallback 없음)
  - `Registry`: Appx/sparse 없이 레지스트리 방식만 사용
  - `Sparse`: sparse만 강제(정책 차단 시 실패)
  - `Legacy`: 클래식(2차) 메뉴 방식만 사용
- `sparseInstallMethod`:
  - `Msix` (기본): signed MSIX 기반 설치
  - `Register`: dev-mode `Add-AppxPackage -Register` (Windows 빌드에 따라 1차 메뉴가 안 뜰 수 있어 개발용으로만 권장)
- `enableRegistryFallback`:
  - `true`면 Auto에서 sparse 실패 시 `registry-shell`로 2차 메뉴 fallback 허용

팀 PC에서 정책/권한 제약으로 1차 메뉴가 불가능하면 `mode=Registry`가 차선책입니다.

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
