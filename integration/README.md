# Integration Workspace

Windows 통합(이슈 #88) 관련 아티팩트입니다.

## 구성

- `installer/`
  - 설치/진단/제거 스크립트
  - 더블클릭 런처: `BAEFRAME-Integration-Setup.cmd`
  - 기본 정책: sparse 우선 + legacy 자동생성 비활성화
  - 옵션: 인증서/정책 프로비저닝(`-Provision`)
- `shell/`
  - `IExplorerCommand` COM 구현 (`BAEFRAME.ContextMenu`)
- `package/`
  - sparse package 매니페스트/에셋/등록 스크립트

## 빠른 실행

```powershell
# 1) 셸 확장 빌드
powershell -ExecutionPolicy Bypass -File .\integration\shell\build-shell.ps1

# 2) 설치 (프로그램처럼 실행)
.\integration\installer\BAEFRAME-Integration-Setup.cmd

# 3) 사내 정책/인증서까지 포함한 설치 (관리자 PowerShell)
powershell -ExecutionPolicy Bypass -File .\integration\installer\run-integration-setup.ps1 -Provision

# 4) 상태 확인
powershell -ExecutionPolicy Bypass -File .\integration\installer\detect-integration.ps1

# 5) 제거
powershell -ExecutionPolicy Bypass -File .\integration\installer\uninstall-integration.ps1
```

## 팀 배포 권장

팀 전체 자동 반영은 개별 더블클릭이 아니라 IT 배포 시스템(GPO/Intune/SCCM)으로
`run-integration-setup.ps1 -Provision -UseSharePath`를 배포하는 방식이 안정적입니다.
