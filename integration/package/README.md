# Integration Package (MSIX)

Windows 11 1차 우클릭 메뉴 노출을 위한 MSIX 패키지 아티팩트입니다.

## 권장: Full MSIX (ExternalLocation 없음)

- `AppxManifest.full.xml`
- `build-full-msix.ps1`
- `install-full-msix.ps1`
- `assets/*.png`

```powershell
# Full MSIX 설치(권장)
powershell -ExecutionPolicy Bypass -File .\integration\package\install-full-msix.ps1
```

## 참고: Sparse Package (ExternalLocation)

구버전/참고용으로 sparse 패키지 스크립트도 유지합니다.
Windows 정책/보안/버전에 따라 external content 기반 sparse 패키지에서는 `windows.comServer` 등록이 제한되어
Windows 11 1차 메뉴가 안 뜨는 케이스가 있습니다.

- `AppxManifest.xml`
- `install-sparse-package.ps1`
- `install-sparse-msix.ps1`
- `build-sparse-msix.ps1`
- `uninstall-sparse-package.ps1`

```powershell
# (개발용) sparse package 등록 (dev-mode register)
powershell -ExecutionPolicy Bypass -File .\integration\package\install-sparse-package.ps1 -AppPath "C:\Program Files\BAEFRAME\BFRAME_alpha_v2.exe"

# (권장) signed MSIX 기반 sparse package 설치
powershell -ExecutionPolicy Bypass -File .\integration\package\install-sparse-msix.ps1 -AppPath "C:\Program Files\BAEFRAME\BFRAME_alpha_v2.exe"

# sparse package 해제
powershell -ExecutionPolicy Bypass -File .\integration\package\uninstall-sparse-package.ps1
```

## Troubleshooting

- `0x800B0109`: Certificate trust failure. Install the signing certificate to TrustedPeople/TrustedPublisher and retry (see `integration/installer/provision-machine-prereqs.ps1`).
- HRESULT `0x80073D2E`: External content deployment is blocked. (Sparse package only) Enable Developer Mode or the policy that allows external content deployment.

