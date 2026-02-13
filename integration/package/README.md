# Sparse Package

Windows 11 1차 우클릭 메뉴 노출을 위한 sparse package 구성입니다.

## 파일

- `AppxManifest.xml`
- `install-sparse-package.ps1`
- `install-sparse-msix.ps1`
- `build-sparse-msix.ps1`
- `get-windows-sdk-buildtools.ps1`
- `uninstall-sparse-package.ps1`
- `assets/*.png`

## 사용

```powershell
# (개발용) sparse package 등록 (dev-mode register)
powershell -ExecutionPolicy Bypass -File .\integration\package\install-sparse-package.ps1 -AppPath "C:\Program Files\BAEFRAME\BFRAME_alpha_v2.exe"

# (권장) signed MSIX 기반 sparse package 설치
# - Windows SDK가 없으면 NuGet(Microsoft.Windows.SDK.BuildTools)에서 makeappx/signtool을 자동으로 내려받아 사용합니다.
powershell -ExecutionPolicy Bypass -File .\integration\package\install-sparse-msix.ps1 -AppPath "C:\Program Files\BAEFRAME\BFRAME_alpha_v2.exe"

# sparse package 해제
powershell -ExecutionPolicy Bypass -File .\integration\package\uninstall-sparse-package.ps1
```

`integration/installer/install-integration.ps1`의 기본 `Auto` 모드에서 이 스크립트를 먼저 호출합니다.

## Troubleshooting

- HRESULT `0x80073D2E`: Windows policy blocks external content deployment. Enable Developer Mode or allow external-content deployment policy, then retry.
- `0x800B0109`: Certificate trust failure. Install the signing certificate to TrustedPeople/TrustedPublisher and retry (see `integration/installer/provision-machine-prereqs.ps1`).

