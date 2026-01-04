# 아키텍처

BAEFRAME의 기술 스택과 동작 원리를 설명합니다.

---

## 목차

- [기술 스택](#기술-스택)
- [시스템 구조](#시스템-구조)
- [폴더 구조](#폴더-구조)
- [데이터 흐름](#데이터-흐름)
- [.bframe 파일](#bframe-파일)
- [서버리스 아키텍처](#서버리스-아키텍처)

---

## 기술 스택

| 구성 요소 | 기술 | 버전 | 역할 |
|-----------|------|------|------|
| 앱 프레임워크 | Electron | 28+ | 데스크톱 앱, IPC 통신 |
| 비디오 플레이어 | mpv | 0.36+ | 고성능 영상 재생 |
| UI | Vanilla JS | ES6+ | 의존성 최소화 |
| 그리기 | Canvas API | - | 벡터 드로잉 |
| 설정 저장 | electron-store | 8.1.0 | 사용자 설정 |

### 왜 이 기술을 선택했나?

**Electron**
- 웹 기술로 데스크톱 앱 개발
- 크로스 플랫폼
- 파일 시스템 접근
- 프로토콜 핸들링 (`baeframe://`)

**mpv**
- MOV PNG 시퀀스 재생 (애니메이션 필수)
- 1-2GB 대용량 파일 지원
- 프레임 단위 정밀 탐색
- 하드웨어 가속

---

## 시스템 구조

```
┌─────────────────────────────────────────────────────────────┐
│                      BAEFRAME 아키텍처                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  데스크톱 앱 (Electron)                │  │
│  │                                                       │  │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────────────┐   │  │
│  │  │  Main   │◄──►│ Preload │◄──►│    Renderer     │   │  │
│  │  │ Process │    │ Script  │    │ (HTML/CSS/JS)   │   │  │
│  │  └────┬────┘    └─────────┘    └────────┬────────┘   │  │
│  │       │                                  │            │  │
│  │       └──────────────┬───────────────────┘            │  │
│  │                      ▼                                │  │
│  │              ┌───────────────┐                        │  │
│  │              │  mpv 플레이어  │                        │  │
│  │              └───────────────┘                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Google Drive                        │  │
│  │           video.mp4    video.bframe                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   웹 뷰어 (Vercel)                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 폴더 구조

```
BAEFRAME/
├── package.json
├── CLAUDE.md              # 개발 가이드
│
├── main/                  # Electron Main Process
│   ├── index.js           # 앱 진입점
│   ├── window.js          # BrowserWindow 관리
│   ├── ipc-handlers.js    # IPC 핸들러
│   └── protocol.js        # baeframe:// 프로토콜
│
├── preload/
│   └── preload.js         # contextBridge API
│
├── renderer/              # UI
│   ├── index.html
│   ├── styles/
│   │   ├── main.css
│   │   ├── viewer.css
│   │   ├── timeline.css
│   │   └── comments.css
│   │
│   └── scripts/
│       ├── app.js         # 앱 초기화
│       ├── modules/       # 기능 모듈
│       │   ├── video-player.js
│       │   ├── drawing-canvas.js
│       │   ├── timeline.js
│       │   └── comments.js
│       ├── services/      # 데이터 로직
│       │   └── bframe-file.js
│       └── utils/
│
├── web-viewer/            # 웹 뷰어
├── mpv/                   # mpv 바이너리
└── wiki/                  # Wiki 마크다운
```

### 모듈 구조

```
             ┌─────────────────┐
             │     app.js      │
             │  (모듈 초기화)   │
             └────────┬────────┘
                      │
     ┌────────────────┼────────────────┐
     ▼                ▼                ▼
┌─────────┐    ┌─────────────┐   ┌──────────┐
│ video-  │    │  drawing-   │   │ comments │
│ player  │    │   canvas    │   │          │
└────┬────┘    └──────┬──────┘   └────┬─────┘
     │                │               │
     └────────────────┼───────────────┘
                      ▼
              ┌───────────────┐
              │ bframe-file   │
              │ (JSON 저장)   │
              └───────────────┘
```

---

## 데이터 흐름

### 이벤트 기반 통신

```javascript
// 비디오 시간 변경 → 다른 모듈 업데이트
videoPlayer.on('timeupdate', (frame, timecode) => {
    timeline.setCurrentFrame(frame);
    comments.highlightAtFrame(frame);
    drawingCanvas.showMarkingsAtFrame(frame);
});

// 새 댓글 추가 → 저장 + UI 업데이트
comments.on('comment:add', (commentData) => {
    bframeFile.addComment(commentData);
    timeline.addMarker(commentData.frame);
});
```

### IPC 통신

```
Main Process                    Renderer Process
     │                               │
     │◄── file:open ─────────────────┤
     │                               │
     ├────── 파일 경로 ──────────────►│
     │                               │
```

---

## .bframe 파일

### JSON 스키마

```json
{
  "version": "1.0.0",
  "videoFile": "EP01_shot_015_v3.mp4",
  "videoPath": "G:/프로젝트/EP01/",
  "fps": 24,
  "totalFrames": 7920,

  "comments": [
    {
      "id": "c_1703067000_hong",
      "frame": 1008,
      "timecode": "00:00:42:00",
      "author": "홍길동",
      "content": "손 위치 어색해요",
      "resolved": false,
      "drawings": [
        {
          "type": "arrow",
          "startX": 0.35, "startY": 0.45,
          "endX": 0.52, "endY": 0.38,
          "color": "#ff4757"
        }
      ],
      "replies": []
    }
  ],

  "versions": [
    { "version": 1, "filename": "..._v1.mp4" },
    { "version": 2, "filename": "..._v2.mp4" }
  ]
}
```

### 좌표 시스템

그리기 좌표는 **0~1 정규화 값**으로 저장됩니다.

```
┌────────────────────────────────────┐
│ (0,0)                      (1,0)   │
│                                    │
│           영상 영역                │
│                                    │
│ (0,1)                      (1,1)   │
└────────────────────────────────────┘

저장: x_normalized = x_pixel / canvas_width
렌더: x_pixel = x_normalized * canvas_width
```

---

## 서버리스 아키텍처

### Google Drive = 서버

```
              ┌──────────────────────┐
              │    Google Drive      │
              │   (공유 폴더)         │
              │                      │
              │  video.mp4           │
              │  video.bframe        │
              └──────────┬───────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │  감독    │  │애니메이터│  │ 웹 뷰어  │
    │ (Desktop)│  │(Desktop) │  │          │
    └──────────┘  └──────────┘  └──────────┘
```

### 장점

- 별도 서버 불필요 (비용 절감)
- 자동 동기화 (Google Drive Sync)
- 권한 관리 (Google 계정)
- 어디서든 접근 (웹 뷰어)

### 충돌 방지

```
저장 전: 최신 버전 fetch
      ↓
댓글 병합: ID 기반 (추가만)
      ↓
저장
```

---

## 참고 자료

- [Electron 공식 문서](https://www.electronjs.org/docs)
- [mpv 매뉴얼](https://mpv.io/manual/)
- [Canvas API - MDN](https://developer.mozilla.org/ko/docs/Web/API/Canvas_API)
- [Google Drive API](https://developers.google.com/drive/api)

---

[Home](Home) · [시작하기](Getting-Started) · [기능 상세](Features) · [웹 뷰어](Web-Viewer)
