# Sparse Package

Windows 11 1차 우클릭 메뉴 노출을 위한 sparse package 구성입니다.

## 파일

- `AppxManifest.xml`
- `install-sparse-package.ps1`
- `uninstall-sparse-package.ps1`
- `assets/*.png`

## 사용

```powershell
# sparse package 등록
powershell -ExecutionPolicy Bypass -File .\integration\package\install-sparse-package.ps1 -AppPath "C:\Program Files\BAEFRAME\BAEFRAME.exe"

# sparse package 해제
powershell -ExecutionPolicy Bypass -File .\integration\package\uninstall-sparse-package.ps1
```

`integration/installer/install-integration.ps1`의 기본 `Auto` 모드에서 이 스크립트를 먼저 호출합니다.

## Troubleshooting

- HRESULT `0x80073D2E`: Windows policy blocks external content deployment. Enable Developer Mode or allow external-content deployment policy, then retry.
