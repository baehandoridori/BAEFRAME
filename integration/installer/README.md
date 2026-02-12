# BAEFRAME Windows Integration Installer

Windows 우클릭 진입(이슈 #88) 설치/진단/제거 스크립트입니다.

## 가장 쉬운 실행 방법 (프로그램처럼 실행)

1. `integration/installer/BAEFRAME-Integration-Setup.cmd` 더블클릭
2. 콘솔 창 결과(JSON + 성공/실패 문구) 확인

기본 실행은 `run-integration-setup.ps1`를 호출하며, **Win11 1차 우클릭(sparse package)만** 시도합니다.
정책 때문에 sparse가 막히면 실패하고, 기본값으로는 legacy(2차 메뉴)를 자동 생성하지 않습니다.

## 인증서 + 정책까지 한 번에 적용 (관리자 권한)

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

공유 드라이브 경로와 인증서 파일을 지정하려면:

```powershell
.\integration\installer\run-integration-setup.ps1 `
  -Provision `
  -UseSharePath `
  -CertPath "\\server\share\certs\StudioJBBJ.BAEFRAME.Integration.cer"
```

`-Provision`은 내부적으로 `provision-machine-prereqs.ps1`를 먼저 실행합니다.

- 인증서 설치: `LocalMachine\Root`, `LocalMachine\TrustedPublisher`
- 정책 설정:
  - `HKLM\SOFTWARE\Policies\Microsoft\Windows\Appx\AllowAllTrustedApps=1`
  - `HKLM\SOFTWARE\Policies\Microsoft\Windows\Appx\AllowDevelopmentWithoutDevLicense=1`
  - `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock\AllowAllTrustedApps=1`
  - `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock\AllowDevelopmentWithoutDevLicense=1`

## 사내용 자체서명 인증서 만들기

배포 담당자가 1회 생성해서 공유 드라이브에 배포할 수 있습니다.

```powershell
# .cer + .pfx 생성 (pfx는 절대 저장소 커밋 금지)
.\integration\installer\create-team-signing-cert.ps1 -PfxPassword "강한비밀번호"
```

생성된 `.cer`를 각 PC에 신뢰 배포하고, 패키지 서명은 `.pfx`로 수행합니다.
기본 보관 위치는 `integration/installer/certs`입니다.

## 파일 구성

- `BAEFRAME-Integration-Setup.cmd`
  - 더블클릭용 런처, 인자 전달 지원
- `run-integration-setup.ps1`
  - 경로 프리셋(`setup-paths.json`) 기반 자동 설치
  - `-Provision`으로 인증서/정책 선적용 가능
- `provision-machine-prereqs.ps1`
  - 관리자 권한에서 인증서/정책 적용
- `create-team-signing-cert.ps1`
  - 사내용 코드서명 인증서(.cer/.pfx) 생성
- `setup-paths.json`
  - 테스트/공유 드라이브 exe 경로 + 프로비저닝 기본값
- `certs/`
  - 사내 `.cer` 보관 경로
- `install-integration.ps1`
  - 실제 통합 설치 엔진
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

- `provisionPolicyAndCert`를 `true`로 바꾸면 런처 기본 실행만으로도 프로비저닝을 먼저 시도합니다.
- `activeProfile=share` + `shareAppPath` 설정 시 공유 드라이브 실행파일을 기본 사용합니다.

## 기본 정책

- 기본 모드: `Auto` (sparse 우선)
- 기본값: `EnableLegacyFallback=false`
- 즉, sparse 실패 시 설치 실패 처리(요구사항: 2차 메뉴보다 미설치 선호)

legacy가 꼭 필요할 때만 명시적으로 허용:

```powershell
.\install-integration.ps1 -AppPath "C:\path\to\BFRAME_alpha_v2.exe" -Mode Auto -EnableLegacyFallback
```

## 수동 실행

```powershell
# 설치 (sparse-only 기본)
.\install-integration.ps1 -AppPath "C:\BAEframe\BAEFRAME\dist\win-unpacked\BFRAME_alpha_v2.exe"

# 진단
.\detect-integration.ps1

# 제거
.\uninstall-integration.ps1
```

## 팀 전체 자동 배포

`CMD 1회 실행`은 해당 PC에만 적용됩니다.
팀 전체 자동 배포는 IT가 GPO/Intune/SCCM으로 다음을 배포해야 합니다.

1. 인증서 신뢰 배포 (`Root`, `TrustedPublisher`)
2. Appx 정책 배포 (`AllowAllTrustedApps` 등)
3. 이 런처 실행 (`run-integration-setup.ps1 -Provision -UseSharePath`)

## 정책 관련 주의

- `0x80073D2E`는 external content deployment 정책 차단 상태입니다.
- 우회 방식은 없고, 관리자 정책 허용이 필요합니다.

