# Integration Workspace

Windows 통합(이슈 #88) 관련 아티팩트입니다.

## 구성

- `installer/`
  - 설치/진단/제거 PowerShell 스크립트
  - `Auto` 모드에서 sparse 우선 + legacy fallback
- `shell/`
  - `IExplorerCommand` COM 구현 (`BAEFRAME.ContextMenu`)
- `package/`
  - sparse package 매니페스트/에셋/등록 스크립트

## 빠른 빌드/검증

```powershell
# 셸 확장 빌드
powershell -ExecutionPolicy Bypass -File .\integration\shell\build-shell.ps1

# 통합 설치 (Auto)
powershell -ExecutionPolicy Bypass -File .\integration\installer\install-integration.ps1

# 통합 진단
powershell -ExecutionPolicy Bypass -File .\integration\installer\detect-integration.ps1

# 통합 제거
powershell -ExecutionPolicy Bypass -File .\integration\installer\uninstall-integration.ps1
```
