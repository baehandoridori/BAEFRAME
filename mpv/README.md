# mpv 설치 안내

baeframe은 비디오 재생을 위해 mpv 플레이어를 사용합니다.

## Windows

1. [mpv 공식 사이트](https://mpv.io/installation/)에서 Windows 빌드 다운로드
2. 또는 [shinchiro builds](https://sourceforge.net/projects/mpv-player-windows/files/)에서 다운로드
3. `mpv.exe`를 `mpv/win32/` 폴더에 복사

### 필요한 파일 구조
```
mpv/
└── win32/
    ├── mpv.exe
    └── mpv-2.dll (있는 경우)
```

## macOS

```bash
brew install mpv
```

## Linux (Ubuntu/Debian)

```bash
sudo apt install mpv
```

## 확인

mpv가 제대로 설치되었는지 확인:

```bash
mpv --version
```

## 참고 자료

- [mpv 공식 문서](https://mpv.io/manual/stable/)
- [mpv.js GitHub](https://github.com/aspect-ratio/mpv.js)
- [node-mpv GitHub](https://github.com/j-holub/Node-MPV)
