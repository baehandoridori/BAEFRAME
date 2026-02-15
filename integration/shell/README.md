# BAEFRAME Shell Extension (IExplorerCommand)

Windows 11 1차 우클릭 메뉴용 셸 확장 COM 서버입니다.

## 구현 상태

- COM 클래스: `BaeframeExplorerCommand`
- CLSID: `{E9C6CF8B-0E51-4C3C-83B6-42FEE932E7F4}`
- 명령 라벨: `BAEFRAME로 열기`
- 노출 조건:
  - 단일 선택
  - 실제 파일
  - `.mp4/.mov/.avi/.mkv/.webm`
- 동작:
  - `BAEFRAME.exe "<absolute_file_path>"` 실행

## 프로젝트

- `BAEFRAME.ContextMenu/BAEFRAME.ContextMenu.csproj`
- `BAEFRAME.ContextMenu/BaeframeExplorerCommand.cs`

## 빌드

```powershell
powershell -ExecutionPolicy Bypass -File .\integration\shell\build-shell.ps1
```

빌드 산출물:

- `BAEFRAME.ContextMenu.dll`
- `BAEFRAME.ContextMenu.comhost.dll`

## 패키지 연동 (권장)

`integration/package/install-sparse-package.ps1`가 빌드 산출물을 stage에 복사하고 `Add-AppxPackage -Register -ExternalLocation`로 등록합니다.

## 개발 등록(클래식 COM)

```powershell
regsvr32 .\BAEFRAME.ContextMenu.comhost.dll
```

해제:

```powershell
regsvr32 /u .\BAEFRAME.ContextMenu.comhost.dll
```
