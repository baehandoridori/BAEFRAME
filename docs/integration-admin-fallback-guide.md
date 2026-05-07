# BAEFRAME 우클릭 등록 문제 PC 복구 가이드

이 문서는 특정 PC에서 BAEFRAME 우클릭 등록이 실패할 때 사용하는 복구 절차입니다.

대상 증상:

- `.NET 6 Runtime`은 설치되어 있는데 우클릭 등록이 실패함
- `0x800B0109` 인증서 신뢰 오류가 나옴
- `No runnable app path found`가 나옴
- `MSIX package installed, but packaged COM activation failed`가 나옴

## 1. 먼저 관리자 CMD를 직접 열기

자동으로 관리자 권한 창을 띄우는 방식은 일부 PC나 공유드라이브 환경에서 실패할 수 있습니다.
문제 PC에서는 사용자가 직접 관리자 CMD를 먼저 여는 방식이 가장 안정적입니다.

1. 시작 메뉴에서 `cmd` 검색
2. `명령 프롬프트`를 우클릭
3. `관리자 권한으로 실행` 선택
4. 열린 창 제목에 `관리자:`가 붙어있는지 확인

## 2. 공유드라이브 배포 폴더로 이동

관리자 CMD에서 아래 명령을 실행합니다.

```cmd
cd /d "G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\BAEFRAME\테스트버전 빌드\BAEFRAME-Integration-Installer_2026-02-16_220610\installer"
```

정상이라면 프롬프트가 아래처럼 `G:\...installer>`로 바뀝니다.

```cmd
G:\공유 드라이브\...\installer>
```

만약 관리자 CMD에서 `G:` 드라이브로 이동할 수 없다면, 해당 PC의 관리자 권한 환경에서 Google Drive가 보이지 않는 상태입니다.
이 경우 `BAEFRAME-Integration-Installer_2026-02-16_220610` 폴더 전체를 바탕화면 같은 로컬 폴더로 복사한 뒤, 그 로컬 경로에서 실행합니다.

## 3. 기본 관리자 설치 시도

먼저 팀용 설정 파일을 명시해서 관리자 설치를 실행합니다.

```cmd
BAEFRAME-Integration-Setup-Admin.cmd -UseSharePath -ConfigPath ".\setup-paths.team.json"
```

정상 흐름에서는 출력에 아래 내용이 보여야 합니다.

```text
[integration-setup] AppPath = G:\...\BFRAME_alpha_v2.exe
"isAdmin": true
"Cert:\\LocalMachine\\TrustedPeople"
"Cert:\\LocalMachine\\TrustedPublisher"
```

이 상태까지 나오면 인증서와 관리자 권한 문제는 통과한 것입니다.

## 4. 1차 우클릭 메뉴가 실패하면 fallback 설치

아래 오류가 나오면 MSIX 설치와 인증서는 통과했지만, Windows 11의 1차 우클릭 메뉴용 COM 모듈 활성화가 실패한 상태입니다.

```text
MSIX package installed, but packaged COM activation failed.
```

이 경우 같은 관리자 CMD에서 fallback 옵션을 켜고 다시 실행합니다.

```cmd
BAEFRAME-Integration-Setup-Admin.cmd -UseSharePath -ConfigPath ".\setup-paths.team.json" -EnableRegistryFallback -EnableLegacyFallback
```

이 명령은 아래 순서로 등록을 시도합니다.

1. Windows 11 1차 우클릭 메뉴 등록
2. 실패하면 레지스트리 방식으로 등록
3. 그래도 실패하면 구형 우클릭 메뉴 방식으로 등록

fallback 방식으로 성공한 PC에서는 메뉴가 바로 보이지 않고 `추가 옵션 표시` 안에 나타날 수 있습니다.

## 5. 설치 후 확인

1. `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm` 파일을 우클릭합니다.
2. `BAEFRAME로 열기`가 바로 보이는지 확인합니다.
3. 바로 보이지 않으면 `추가 옵션 표시` 안에서 확인합니다.
4. 메뉴를 눌렀을 때 BAEFRAME이 선택한 영상 파일로 열리면 정상입니다.

메뉴가 바로 보이지 않으면 Explorer 캐시 문제일 수 있습니다.
작업 관리자에서 `Windows 탐색기`를 다시 시작하거나 PC를 재부팅한 뒤 다시 확인합니다.

## 6. 에러별 의미

### `No runnable app path found`

설치 스크립트가 앱 실행 파일 경로를 잘못 보고 있는 상태입니다.
팀 배포에서는 반드시 아래 인자가 들어가야 합니다.

```cmd
-UseSharePath -ConfigPath ".\setup-paths.team.json"
```

관리자 창을 자동으로 새로 띄우는 과정에서 이 인자가 빠지면 기본 로컬 경로인 `C:/BAEframe/...`를 찾다가 실패합니다.

### `0x800B0109`

MSIX 서명 인증서를 Windows가 신뢰하지 않는 상태입니다.
관리자 권한으로 설치해서 인증서가 아래 저장소에 들어가야 합니다.

```text
Cert:\LocalMachine\TrustedPeople
Cert:\LocalMachine\TrustedPublisher
```

`CurrentUser` 저장소에만 들어간 경우 특정 PC에서는 MSIX 설치가 계속 실패할 수 있습니다.

### `MSIX package installed, but packaged COM activation failed`

MSIX 설치는 됐지만 Windows가 우클릭 메뉴용 COM 모듈을 실행하지 못한 상태입니다.
이 경우 fallback 명령을 사용합니다.

```cmd
BAEFRAME-Integration-Setup-Admin.cmd -UseSharePath -ConfigPath ".\setup-paths.team.json" -EnableRegistryFallback -EnableLegacyFallback
```

## 7. 배포 파일 관리 주의점

문제 PC에는 `installer` 폴더만 따로 보내면 안 됩니다.
설치 스크립트가 상위의 `package` 폴더와 MSIX 파일을 함께 참조하기 때문입니다.

ZIP으로 전달해야 한다면 아래 배포 폴더 전체를 압축합니다.

```text
BAEFRAME-Integration-Installer_2026-02-16_220610
```

폴더 안에는 최소한 아래 구조가 같이 있어야 합니다.

```text
BAEFRAME-Integration-Installer_2026-02-16_220610/
  installer/
  package/
```

이미 공유드라이브 경로가 잡혀 있는 팀 환경에서는 새 ZIP을 개인에게 따로 보내기보다, 공유드라이브의 기존 배포 폴더에 수정 파일을 덮어쓴 뒤 같은 경로에서 다시 실행하게 하는 편이 안전합니다.
