# FFmpeg 설치 안내

이 폴더에 FFmpeg 바이너리를 복사해주세요.

## 다운로드

1. https://github.com/BtbN/FFmpeg-Builds/releases 접속
2. `ffmpeg-master-latest-win64-gpl.zip` 다운로드
3. 압축 해제

## 필요한 파일

압축 해제 후 `bin/` 폴더에서 다음 파일들을 이 폴더에 복사:

- `ffmpeg.exe` (약 90MB)
- `ffprobe.exe` (약 90MB)

## 최종 구조

```
ffmpeg/
└── win32/
    ├── ffmpeg.exe    ← 필수
    ├── ffprobe.exe   ← 필수
    └── README.md
```

## 대안: 시스템 PATH

FFmpeg가 시스템 PATH에 설치되어 있으면 자동 감지됩니다.

```bash
# 확인 방법
ffmpeg -version
ffprobe -version
```
