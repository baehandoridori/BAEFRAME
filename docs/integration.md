# Windows 통합 가이드

> BAEFRAME을 Windows 우클릭 메뉴에 통합하는 방법을 설명합니다.

---

## 1. 개요

BAEFRAME Windows 통합(이슈 #88)은 영상 파일을 우클릭했을 때 "BAEFRAME로 열기" 항목이 나타나도록 Windows Shell에 등록합니다.

### Windows 11 1차 메뉴 vs 2차 메뉴

| 구분 | 방식 | 표시 위치 | 구현 방식 |
|------|------|-----------|-----------|
| 1차 메뉴 (sparse/MSIX) | Package(MSIX) 기반 | 우클릭 즉시 노출 | Packaged COM(IExplorerCommand) |
| 2차 메뉴 (legacy) | 레지스트리 기반 | "추가 옵션 표시" 클릭 후 노출 | 클래식 command verb |

기본 설치 정책은 **1차 메뉴(MSIX) 우선**입니다. MSIX 설치 후 COM 활성화에 실패하면 자동 롤백하며, 2차 메뉴 fallback은 기본값으로 활성화하지 않습니다.

### 지원 기능

- `.mp4`, `.mov` 등 영상 파일 우클릭 → "BAEFRAME로 열기"
- 선택한 파일이 BAEFRAME에 자동으로 전달됨

### 필수 런타임

Windows 11 1차 우클릭 COM 핸들러는 **.NET 6 런타임**이 필요합니다.

- `.NET Runtime 6 (x64)` 또는 `.NET Desktop Runtime 6 (x64)` 중 하나 필요
- 누락 시 증상: 진단에서 `dotnet.exe not found` 출력, COM 활성화 오류 `HRESULT 0x80008083`
- 해결: `integration/installer/BAEFRAME-Install-DotNet6.cmd` 를 먼저 실행해 런타임을 선설치한 뒤 통합 설치를 다시 진행

---

## 2. 빠른 설치

일반 사용자(비개발자)는 아래 파일을 더블클릭하는 것만으로 설치가 완료됩니다.

```
integration/installer/BAEFRAME-Integration-Setup.cmd
```

1. `BAEFRAME-Integration-Setup.cmd` 더블클릭
2. 설치 완료 후 Explorer 재시작 여부(Y/N) 선택
3. `.mp4` 파일 우클릭 → "BAEFRAME로 열기" 항목 확인

설치기는 내부적으로 64비트 PowerShell을 우선 사용하고, MSIX 설치 직후 COM 활성화가 지연될 때를 대비해 자동 재시도(1회)를 수행합니다.

> **주의:** `installer` 폴더만 따로 압축해서 전달하면 설치가 실패합니다. 설치 스크립트가 상위의 `package/` 폴더를 참조하기 때문입니다. 최소한 `integration/` 폴더 전체 또는 `installer/` + `package/` 폴더를 **동일한 구조**로 함께 전달해야 합니다.

---

## 3. 고급 설치 옵션

### 인증서 + 정책 포함 설치 (관리자 권한)

사내 인증서와 정책을 함께 적용하려면 관리자 권한으로 실행합니다.

```powershell
# 관리자 PowerShell에서 실행
Set-ExecutionPolicy -Scope Process Bypass
.\integration\installer\run-integration-setup.ps1 -Provision
```

또는 CMD 런처에 인자를 전달해 동일하게 실행할 수 있습니다.

```cmd
.\integration\installer\BAEFRAME-Integration-Setup.cmd -Provision -UseSharePath -CertPath "\\server\share\certs\StudioJBBJ.BAEFRAME.Integration.cer"
```

공유 드라이브 프로필을 함께 사용하려면:

```powershell
powershell -ExecutionPolicy Bypass -File .\integration\installer\run-integration-setup.ps1 -Provision -UseSharePath -CertPath "\\server\share\certs\StudioJBBJ.BAEFRAME.Integration.cer"
```

`-Provision` 플래그는 내부적으로 `provision-machine-prereqs.ps1`를 먼저 실행합니다.

### 옵션 설명

| 옵션 | 설명 |
|------|------|
| `-Provision` | 인증서 신뢰 등록 및 정책 선적용 (관리자 권한 필요) |
| `-UseSharePath` | `setup-paths.team.json`의 `shareAppPath`를 앱 경로로 사용 |
| `-CertPath` | 사내 서명 인증서(.cer) 경로 지정 |

---

## 4. 수동 설치 및 제거

### install-integration.ps1

```powershell
# 기본 설치 (Auto 모드)
powershell -ExecutionPolicy Bypass -File .\integration\installer\install-integration.ps1 -AppPath "C:\BAEframe\BAEFRAME\dist\win-unpacked\BFRAME_alpha_v2.exe"

# 모드 명시 + 2차 메뉴 fallback 허용
powershell -ExecutionPolicy Bypass -File .\integration\installer\install-integration.ps1 -AppPath "C:\path\to\BFRAME_alpha_v2.exe" -Mode Auto -EnableLegacyFallback
```

지원하는 `-Mode` 값:

| 값 | 동작 |
|----|------|
| `Auto` (기본) | `Package(MSIX)`만 시도, fallback 없음 |
| `Package` | 일반 MSIX만 강제 |
| `Registry` | Appx/sparse 없이 레지스트리 방식(2차 메뉴)만 사용 |
| `Sparse` | sparse만 강제 (Windows 정책/버전에 따라 1차 메뉴 미보장, 개발용) |
| `Legacy` | 클래식 2차 메뉴 방식만 사용 |

### uninstall-integration.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\integration\installer\uninstall-integration.ps1
```

---

## 5. 진단

### detect-integration.ps1

설치 상태를 JSON으로 출력합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\integration\installer\detect-integration.ps1
```

### BAEFRAME-Integration-Diagnostics.cmd

더블클릭으로 실행하는 진단 런처입니다. 설치 실패 PC에서 원인을 확인할 때 사용하고, 출력 내용을 개발자에게 전달합니다.

```
integration/installer/BAEFRAME-Integration-Diagnostics.cmd
```

### 앱 내 진단/복구

BAEFRAME 앱 내에도 통합 상태 확인 및 복구 버튼이 제공됩니다.

---

## 6. 팀 배포

### 일반 팀원 (비개발자)

팀원들에게는 아래 파일 중 하나를 안내합니다.

```
integration/installer/배프레임 레지스트리 등록.cmd
```

파일명이 깨지는 압축/해제 도구를 사용하는 경우 ASCII 파일명 버전을 대신 사용합니다.

```
integration/installer/BAEFRAME-Registry-Install.cmd
```

이 파일들은 내부적으로 `setup-paths.team.json`의 `shareAppPath`에 설정된 경로를 사용해 설치합니다.

기본값은 아래 경로를 기대합니다(Google Drive 공유드라이브 기준).

```
G:/공유 드라이브/JBBJ 자료실/한솔이의 두근두근 실험실/BAEFRAME/테스트버전 빌드/BFRAME_alpha_v2.exe
```

다른 경로에 실행 파일을 올렸다면 `setup-paths.team.json`의 `shareAppPath` 값을 수정합니다.

### IT 배포 시스템(GPO / Intune / SCCM)

팀 전체에 자동으로 적용하려면 개별 CMD 실행 방식 대신 IT 배포 시스템을 사용하는 것이 안정적입니다.

```powershell
# GPO/Intune/SCCM에서 배포할 명령
powershell -ExecutionPolicy Bypass -File .\integration\installer\run-integration-setup.ps1 -Provision
```

정책/권한 제약이 많은 환경에서 1차 메뉴 설치가 불가능할 경우, `setup-paths.json`의 `mode`를 `Registry`로 설정하는 것이 차선책입니다(이 경우 2차 메뉴에 노출됩니다).

---

## 7. 아키텍처

```
integration/
├── shell/      # .NET C# 컨텍스트 메뉴 확장 (IExplorerCommand COM 구현)
├── host/       # .NET C# 통합 호스트
├── installer/  # PowerShell/CMD 설치 스크립트
└── package/    # MSIX 패키징 (매니페스트, 에셋, 설치 스크립트)
```

| 폴더 | 내용 |
|------|------|
| `shell/` | `IExplorerCommand` COM 구현체 (`BAEFRAME.ContextMenu`). 우클릭 메뉴 항목을 실제로 렌더링하고 클릭 이벤트를 처리합니다. |
| `host/` | 통합 호스트 프로세스. 셸 확장에서 BAEFRAME 앱을 실행합니다. |
| `installer/` | PowerShell/CMD 스크립트. 설치, 진단, 제거를 담당합니다. |
| `package/` | MSIX 패키지 정의. Windows 11 1차 우클릭 메뉴 등록에 필요한 매니페스트와 에셋을 포함합니다. |

### setup-paths.json

설치 동작을 제어하는 설정 파일입니다.

```json
{
  "activeProfile": "test",
  "mode": "Auto",
  "sparseInstallMethod": "Msix",
  "enableRegistryFallback": false,
  "enableLegacyFallback": false,
  "provisionPolicyAndCert": false,
  "certPath": "",
  "testAppPath": "C:/BAEframe/BAEFRAME/dist/win-unpacked/BFRAME_alpha_v2.exe",
  "shareAppPath": ""
}
```

| 키 | 설명 |
|----|------|
| `activeProfile` | `test` 또는 `share` — 사용할 AppPath 선택 |
| `mode` | 설치 방식 (`Auto` / `Package` / `Registry` / `Sparse` / `Legacy`) |
| `sparseInstallMethod` | `Msix`(기본, signed MSIX 기반) 또는 `Register`(개발용 dev-mode) |
| `enableRegistryFallback` | `true`면 Auto 모드에서 MSIX 실패 시 레지스트리 방식으로 fallback |
| `enableLegacyFallback` | `true`면 2차(클래식) 메뉴 방식 fallback 허용 |
| `testAppPath` | 로컬 테스트 exe 경로 |
| `shareAppPath` | 공유 드라이브 exe 경로 |

팀 배포용 설정은 `setup-paths.team.json`을 사용합니다. JSON 내 Windows 경로는 `\\` 대신 `/`로 작성해도 됩니다.

---

## 8. 트러블슈팅

### 창이 켜졌다가 바로 꺼짐

압축 파일 내부를 바로 실행하거나, `installer` 폴더만 단독으로 압축 해제한 경우 발생합니다.

- 해결: ZIP 압축을 모두 풀고, `installer/` + `package/` 폴더가 동일한 상위 디렉토리에 있는지 확인한 뒤 다시 실행

### 우클릭 메뉴에 항목이 나타나지 않음 (설치 성공 표시 이후)

Explorer가 이전 상태를 캐시하고 있을 수 있습니다.

- 해결: `BAEFRAME-Integration-Setup.cmd` 실행 후 Explorer 재시작(Y) 선택, 또는 수동으로 작업 관리자에서 Explorer 재시작

### COM 활성화 오류 (HRESULT 0x80008083)

.NET 6 런타임이 없을 때 발생합니다.

- 해결: `integration/installer/BAEFRAME-Install-DotNet6.cmd` 실행 후 통합 설치 재시도

### 정책/권한 오류로 설치 실패

- 해결 1: `BAEFRAME-Integration-Setup-Admin.cmd`를 "관리자 권한으로 실행"
- 해결 2: `setup-paths.json`에서 `mode`를 `Registry`로 변경 후 재설치 (2차 메뉴로 동작)

### 파일명 깨짐 (한글 파일명)

압축/해제 도구가 한글 파일명을 지원하지 않을 때 발생합니다.

- 해결: `BAEFRAME-Registry-Install.cmd`(ASCII 파일명)를 대신 사용

### 진단 정보 수집

설치 실패 원인을 파악하려면 아래 파일을 실행하고 출력 내용을 개발자에게 전달합니다.

```
integration/installer/BAEFRAME-Integration-Diagnostics.cmd
```

또는:

```powershell
powershell -ExecutionPolicy Bypass -File .\integration\installer\detect-integration.ps1
```
