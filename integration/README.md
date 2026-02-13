# Integration Workspace

Windows 통합(이슈 #88) 관련 아티팩트입니다.

## 구성

- `installer/`
  - 설치/진단/제거 스크립트
  - 더블클릭 런처: `BAEFRAME-Integration-Setup.cmd`
- `shell/`
  - `IExplorerCommand` COM 구현 (`BAEFRAME.ContextMenu`)
- `package/`
  - (선택) sparse package 매니페스트/에셋/등록 스크립트

## 빠른 실행 (코딩 몰라도 되는 방법)

1. `integration/installer/BAEFRAME-Integration-Setup.cmd` 더블클릭
2. 끝나면 Explorer 재시작 여부(Y/N) 선택
3. `.mp4` 파일 우클릭 -> `BAEFRAME로 열기` 확인

## 개발자용

```powershell
# 셸 확장 빌드(필요 시)
powershell -ExecutionPolicy Bypass -File .\integration\shell\build-shell.ps1

# 설치/진단/제거
powershell -ExecutionPolicy Bypass -File .\integration\installer\install-integration.ps1
powershell -ExecutionPolicy Bypass -File .\integration\installer\detect-integration.ps1
powershell -ExecutionPolicy Bypass -File .\integration\installer\uninstall-integration.ps1
```

## 팀 배포 권장

팀 전체 자동 반영은 개별 더블클릭이 아니라 IT 배포 시스템(GPO/Intune/SCCM)으로
`run-integration-setup.ps1` 실행을 배포하는 방식이 안정적입니다.

정책 제약이 많은 환경에서는 `setup-paths.json`의 `mode`를 `Registry`로 고정하는 구성이 운영이 쉽습니다.
