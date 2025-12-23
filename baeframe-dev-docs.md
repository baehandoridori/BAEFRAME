# baeframe 개발 문서

> **Version:** 1.0.0-dev  
> **Last Updated:** 2024-12  
> **Target:** Electron + mpv 기반 비디오 리뷰 앱

---

## 📋 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택](#2-기술-스택)
3. [폴더 구조 (모듈화)](#3-폴더-구조-모듈화)
4. [데이터 스키마](#4-데이터-스키마)
5. [기능 명세](#5-기능-명세)
6. [UI/UX 명세](#6-uiux-명세)
7. [디버그 & 로깅 시스템](#7-디버그--로깅-시스템)
8. [에러 핸들링 패턴](#8-에러-핸들링-패턴)
9. [개발 단계 (Phase)](#9-개발-단계-phase)
10. [배포 방식](#10-배포-방식)
11. [참고 자료](#11-참고-자료)

---

## 1. 프로젝트 개요

### 1.1 목적

**baeframe**은 애니메이션 스튜디오 팀(15명)을 위한 비디오 리뷰/피드백 도구입니다.

- Frame.io의 핵심 기능을 로컬 환경에서 구현
- 슬랙 기반 워크플로우와 연동
- Google Drive 공유 폴더를 통한 데이터 동기화 (서버리스)

### 1.2 핵심 요구사항

| 요구사항 | 설명 |
|----------|------|
| 영상 재생 | MP4 H.264/265, MOV PNG 시퀀스 (1-2GB 파일) |
| 프레임 탐색 | ← → 키로 1프레임씩 이동 (24fps 기준) |
| 마킹/그리기 | 화살표, 자유 드로잉을 영상 위에 표시 |
| 타임스탬프 댓글 | 특정 프레임에 피드백 남기기 |
| 링크 공유 | `baeframe://경로` 또는 `.baef` 파일로 슬랙 공유 |
| 버전 관리 | `파일명_v1.mp4`, `파일명_v2.mp4` 자동 인식 |

### 1.3 사용 시나리오

```
[시나리오 1: 피드백 요청]
1. 애니메이터가 작업물(shot_001_v2.mp4)을 G:드라이브에 저장
2. baeframe으로 영상 열기 (드래그 드롭)
3. "링크 복사" 클릭 → 클립보드에 baeframe://G:/... 복사
4. 슬랙에 링크 붙여넣기
5. 감독이 링크 클릭 → baeframe 실행 → 해당 영상 로드

[시나리오 2: 피드백 작성]
1. 영상 재생 중 문제 지점에서 일시정지
2. [D] 키로 그리기 모드 활성화
3. 문제 부분에 화살표로 마킹
4. 댓글 입력 → Enter
5. 자동 저장 (.review.json)

[시나리오 3: 피드백 확인]
1. 애니메이터가 .review.json이 업데이트된 영상 열기
2. 댓글 패널에서 피드백 목록 확인
3. 댓글 클릭 → 해당 프레임으로 이동 + 마킹 표시
4. 수정 완료 후 "해결됨" 체크
```

---

## 2. 기술 스택

### 2.1 핵심 기술

| 구성요소 | 기술 | 버전 | 이유 |
|----------|------|------|------|
| 앱 프레임워크 | Electron | 28+ | 데스크톱 앱 + 웹 기술 |
| 비디오 플레이어 | mpv | 0.36+ | MOV PNG 시퀀스, 하드웨어 가속 |
| mpv 바인딩 | mpv.js 또는 node-mpv | - | Electron에서 mpv 제어 |
| UI | HTML + CSS + Vanilla JS | - | 심플, 의존성 최소화 |
| 그리기 | Canvas API | - | 벡터 드로잉 |

### 2.2 의존성 패키지 (예상)

```json
{
  "dependencies": {
    "electron": "^28.0.0",
    "mpv.js": "^x.x.x",
    "electron-store": "^8.0.0"
  },
  "devDependencies": {
    "electron-builder": "^24.0.0",
    "electron-reload": "^2.0.0"
  }
}
```

### 2.3 mpv 연동 방식

**옵션 A: mpv.js (권장)**
- Electron과의 통합이 잘 되어 있음
- Canvas 오버레이 가능

**옵션 B: node-mpv + IPC**
- mpv를 별도 프로세스로 실행
- JSON IPC로 통신

```
[검증 필요]
- mpv.js가 MOV PNG 시퀀스를 제대로 재생하는지
- Canvas 오버레이가 영상 위에 정확히 겹쳐지는지
- 프레임 단위 탐색 API가 있는지
```

---

## 3. 폴더 구조 (모듈화)

```
baeframe/
├── package.json
├── electron-builder.yml
├── README.md
│
├── main/                      # [Electron Main Process]
│   ├── index.js               # 앱 진입점
│   ├── window.js              # BrowserWindow 관리
│   ├── ipc-handlers.js        # IPC 핸들러 등록
│   ├── protocol.js            # baeframe:// 프로토콜 등록
│   ├── file-association.js    # .baef 파일 연결
│   └── logger.js              # 메인 프로세스 로거
│
├── preload/                   # [Preload Scripts]
│   └── preload.js             # contextBridge API 노출
│
├── renderer/                  # [Electron Renderer Process]
│   ├── index.html             # 메인 HTML
│   ├── styles/
│   │   ├── main.css           # 전역 스타일, CSS 변수
│   │   ├── header.css
│   │   ├── viewer.css
│   │   ├── timeline.css
│   │   ├── comments.css
│   │   └── shortcuts.css
│   │
│   ├── scripts/
│   │   ├── app.js             # 앱 초기화, 모듈 연결
│   │   ├── logger.js          # 렌더러 로거 (★ 디버깅 핵심)
│   │   │
│   │   ├── modules/           # [기능 모듈]
│   │   │   ├── video-player.js      # mpv 제어
│   │   │   ├── drawing-canvas.js    # 그리기 레이어
│   │   │   ├── drawing-tools.js     # 펜, 화살표 도구
│   │   │   ├── timeline.js          # 타임라인 UI
│   │   │   ├── comments.js          # 댓글 패널
│   │   │   ├── version-manager.js   # 버전 감지/관리
│   │   │   ├── shortcuts.js         # 키보드 단축키
│   │   │   └── resizer.js           # 패널 리사이즈
│   │   │
│   │   ├── services/          # [데이터/비즈니스 로직]
│   │   │   ├── review-data.js       # .review.json 읽기/쓰기
│   │   │   ├── user-settings.js     # 사용자 설정 (이름 등)
│   │   │   ├── undo-manager.js      # Undo/Redo 스택
│   │   │   ├── link-generator.js    # baeframe:// 링크 생성
│   │   │   └── slack-integration.js # (추후) Slack API
│   │   │
│   │   └── utils/             # [유틸리티]
│   │       ├── dom.js               # DOM 헬퍼
│   │       ├── time.js              # 타임코드 변환
│   │       ├── path.js              # 경로 처리
│   │       ├── vector-simplify.js   # 드로잉 포인트 단순화
│   │       └── debounce.js          # 디바운스/쓰로틀
│   │
│   └── assets/
│       ├── icons/
│       └── fonts/
│
├── shared/                    # [Main/Renderer 공유]
│   ├── constants.js           # 상수 정의
│   ├── ipc-channels.js        # IPC 채널명 상수
│   └── validators.js          # 데이터 검증
│
├── mpv/                       # [mpv 바이너리]
│   ├── win32/
│   │   └── mpv.exe
│   └── README.md              # mpv 설치 안내
│
└── logs/                      # [로그 파일]
    └── .gitkeep
```

### 3.1 모듈 책임 분리 원칙

```
┌─────────────────────────────────────────────────────────────┐
│                        app.js                                │
│                   (모듈 초기화 & 연결)                        │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  video-player │    │drawing-canvas │    │   comments    │
│    .js        │    │    .js        │    │     .js       │
│               │    │               │    │               │
│ - mpv 초기화  │    │ - Canvas 관리 │    │ - 댓글 렌더링 │
│ - 재생 제어   │    │ - 이벤트 처리 │    │ - CRUD UI     │
│ - 프레임 탐색 │    │ - 좌표 변환   │    │ - 필터링      │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌───────────────────┐
                    │   review-data.js  │
                    │                   │
                    │ - JSON 읽기/쓰기  │
                    │ - 자동 저장       │
                    │ - 데이터 검증     │
                    └───────────────────┘
```

### 3.2 모듈 간 통신

```javascript
// 이벤트 기반 통신 (느슨한 결합)
// app.js에서 EventEmitter 또는 커스텀 이벤트 버스 사용

// 예시: 비디오 시간 변경 → 타임라인 업데이트
videoPlayer.on('timeupdate', (frame, timecode) => {
  timeline.setCurrentFrame(frame);
  comments.highlightAtFrame(frame);
  drawingCanvas.showMarkingsAtFrame(frame);
});

// 예시: 새 댓글 추가 → 데이터 저장
comments.on('comment:add', (commentData) => {
  reviewData.addComment(commentData);
  timeline.addMarker(commentData.frame);
  undoManager.push({ type: 'ADD_COMMENT', data: commentData });
});
```

---

## 4. 데이터 스키마

### 4.1 .review.json 구조

```json
{
  "version": "1.0.0",
  "videoFile": "EP01_shot_015_animation_v3.mp4",
  "videoPath": "G:/프로젝트/스튜디오장삐쭈야/EP01/",
  "createdAt": "2024-12-20T10:30:00Z",
  "updatedAt": "2024-12-20T15:45:00Z",
  "fps": 24,
  "totalFrames": 7920,
  "duration": "00:05:30:00",
  
  "comments": [
    {
      "id": "c_1703067000_hong",
      "frame": 1008,
      "timecode": "00:00:42:00",
      "author": "홍길동",
      "authorId": "hong",
      "content": "캐릭터 손 위치가 조금 어색해 보여요.",
      "resolved": false,
      "createdAt": "2024-12-20T10:30:00Z",
      "updatedAt": "2024-12-20T10:30:00Z",
      "drawings": [
        {
          "id": "d_1703067000_1",
          "type": "arrow",
          "startX": 0.35,
          "startY": 0.45,
          "endX": 0.52,
          "endY": 0.38,
          "color": "#ff4757",
          "width": 3
        },
        {
          "id": "d_1703067000_2",
          "type": "stroke",
          "points": [
            [0.12, 0.34],
            [0.15, 0.36],
            [0.18, 0.35]
          ],
          "color": "#ffd000",
          "width": 2
        }
      ],
      "replies": []
    }
  ],
  
  "versions": [
    {
      "version": 1,
      "filename": "EP01_shot_015_animation_v1.mp4",
      "createdAt": "2024-12-18T09:00:00Z"
    },
    {
      "version": 2,
      "filename": "EP01_shot_015_animation_v2.mp4",
      "createdAt": "2024-12-19T14:00:00Z"
    },
    {
      "version": 3,
      "filename": "EP01_shot_015_animation_v3.mp4",
      "createdAt": "2024-12-20T10:00:00Z"
    }
  ]
}
```

### 4.2 좌표 시스템

```
그리기 좌표는 0~1 사이의 상대값으로 저장 (해상도 독립적)

┌────────────────────────────────────┐
│ (0,0)                        (1,0) │
│                                    │
│         영상 영역                   │
│                                    │
│ (0,1)                        (1,1) │
└────────────────────────────────────┘

변환 공식:
- 저장 시: x_normalized = x_pixel / canvas_width
- 렌더 시: x_pixel = x_normalized * canvas_width
```

### 4.3 포인트 단순화 (Ramer-Douglas-Peucker)

```javascript
// utils/vector-simplify.js

/**
 * 드로잉 포인트를 단순화하여 용량 절감
 * @param {Array} points - [[x,y], [x,y], ...]
 * @param {number} epsilon - 허용 오차 (0.005 권장)
 * @returns {Array} 단순화된 포인트 배열
 */
function simplifyPoints(points, epsilon = 0.005) {
  // RDP 알고리즘 구현
  // 100개 포인트 → 약 20~30개로 축소
}
```

### 4.4 .baef 파일 구조

```json
{
  "baeframe": "1.0.0",
  "videoPath": "G:/프로젝트/스튜디오장삐쭈야/EP01/EP01_shot_015_animation_v3.mp4"
}
```

### 4.5 사용자 설정 (electron-store)

```javascript
// 저장 위치: %APPDATA%/baeframe/config.json

{
  "user": {
    "name": "홍길동",
    "id": "hong"
  },
  "slack": {
    "connected": false,
    "userName": null
  },
  "ui": {
    "panelWidth": 320,
    "timelineHeight": 180,
    "theme": "dark"
  },
  "shortcuts": {
    // 사용자 지정 단축키 (추후)
  }
}
```

---

## 5. 기능 명세

### 5.1 비디오 재생

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 영상 로드 | 드래그 드롭, 파일 열기, 프로토콜 | ★★★ |
| 재생/일시정지 | Space 키, 버튼 클릭 | ★★★ |
| 프레임 단위 이동 | ← → 키 | ★★★ |
| 1초 단위 이동 | Shift + ← → | ★★☆ |
| 처음/끝 이동 | Home / End | ★★☆ |
| 타임라인 클릭 이동 | 클릭한 위치로 점프 | ★★★ |
| 구간 반복 | (추후) | ★☆☆ |

### 5.2 그리기/마킹

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 화살표 그리기 | 드래그로 시작점→끝점 | ★★★ |
| 자유 드로잉 | 펜처럼 자유롭게 | ★★★ |
| 색상 선택 | 빨강, 노랑, 초록, 파랑, 흰색 | ★★★ |
| 굵기 선택 | 1~5px | ★★☆ |
| 실행 취소 | Ctrl+Z | ★★★ |
| 다시 실행 | Ctrl+Y | ★★☆ |
| 전체 지우기 | 현재 프레임 마킹 삭제 | ★★☆ |

### 5.3 댓글

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 댓글 추가 | 현재 프레임에 댓글 | ★★★ |
| 댓글 목록 | 타임스탬프 순 정렬 | ★★★ |
| 댓글 클릭 → 이동 | 해당 프레임으로 점프 | ★★★ |
| 해결됨 토글 | 체크 시 녹색 표시 | ★★★ |
| 필터 | 전체/미해결/해결됨 | ★★☆ |
| 수정/삭제 | 본인 댓글만 | ★★★ |
| 답글 | (추후) | ★☆☆ |

### 5.4 타임라인

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 줌 인/아웃 | Ctrl + 휠 | ★★★ |
| 가로 스크롤 | Shift + 휠 | ★★★ |
| 세로 스크롤 | 휠 (레이어 많을 때) | ★★★ |
| 댓글 마커 표시 | 타임라인 위 마커 | ★★★ |
| 레이어 표시 | 마킹별 레이어 | ★★☆ |
| 플레이헤드 드래그 | 드래그로 위치 이동 | ★★☆ |

### 5.5 버전 관리

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 버전 자동 감지 | 파일명_v1, v2 패턴 | ★★★ |
| 버전 목록 표시 | 드롭다운 또는 패널 | ★★☆ |
| 버전 전환 | 클릭하면 해당 버전 로드 | ★★☆ |

### 5.6 공유

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 링크 복사 | baeframe://경로 | ★★★ |
| 프로토콜 핸들링 | 링크 클릭 시 앱 실행 | ★★★ |
| .baef 파일 연결 | 더블클릭 시 앱 실행 | ★★☆ |
| Slack API 연동 | (추후) | ★☆☆ |

---

## 6. UI/UX 명세

### 6.1 레이아웃

```
┌─────────────────────────────────────────────────────────────────────┐
│  Header (48px)                                                       │
│  [로고] [파일명/경로] [버전배지]              [버전히스토리] [링크복사] │
├─────────────────────────────────────────────────────────────┬───────┤
│                                                             │       │
│                     Video Viewer                            │ 댓글  │
│                   (가변, 최소 300px)                         │ 패널  │
│                   + Drawing Overlay                         │       │
│                   + Drawing Tools                           │ 320px │
│                                                             │ 기본  │
├───────────────────────────────────────────────────── ═══════│ (조절 │
│  Controls Bar (52px)                                        │ 가능) │
│  [⏮][◀][▶][▶][⏭] [타임코드] [fps]        [그리기] [댓글추가] │       │
├─────────────────────────────────────────────────────────────┤       │
│  Timeline (180px 기본, 조절 가능)                            │       │
│  [레이어 헤더] │ [트랙 영역 + 플레이헤드 + 마커]              │       │
└─────────────────────────────────────────────────────────────┴───────┘
```

### 6.2 컬러 시스템

```css
:root {
  /* 배경 */
  --bg-primary: #0a0a0a;
  --bg-secondary: #111111;
  --bg-tertiary: #1a1a1a;
  --bg-elevated: #222222;
  --bg-hover: #2a2a2a;
  
  /* 테두리 */
  --border-subtle: #2a2a2a;
  --border-default: #3a3a3a;
  
  /* 텍스트 */
  --text-primary: #f5f5f5;
  --text-secondary: #a0a0a0;
  --text-tertiary: #666666;
  
  /* 액센트 (노란색) */
  --accent-primary: #ffd000;
  --accent-secondary: #e6bb00;
  --accent-glow: rgba(255, 208, 0, 0.15);
  
  /* 상태 */
  --success: #4ade80;
  --error: #f87171;
  
  /* 그리기 색상 */
  --draw-red: #ff4757;
  --draw-yellow: #ffd000;
  --draw-green: #26de81;
  --draw-blue: #4a9eff;
  --draw-white: #ffffff;
}
```

### 6.3 키보드 단축키

| 키 | 기능 |
|----|------|
| `Space` | 재생/일시정지 |
| `←` | 이전 프레임 |
| `→` | 다음 프레임 |
| `Shift + ←` | 1초 뒤로 |
| `Shift + →` | 1초 앞으로 |
| `Home` | 처음으로 |
| `End` | 끝으로 |
| `D` | 그리기 모드 토글 |
| `C` | 댓글 추가 |
| `Ctrl + Z` | 실행 취소 |
| `Ctrl + Y` | 다시 실행 |
| `Ctrl + Shift + C` | 링크 복사 |
| `Ctrl + 휠` | 타임라인 확대/축소 |
| `\` | 타임라인 전체 보기 |
| `?` | 단축키 메뉴 토글 |

### 6.4 목업 파일

> **참고:** `baeframe-ui-mockup-v2.html` 파일에 전체 UI 목업이 있음.
> 브라우저에서 열어서 인터랙션 확인 가능.

---

## 7. 디버그 & 로깅 시스템

### 7.1 로거 설계

```javascript
// renderer/scripts/logger.js

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(module, options = {}) {
    this.module = module;
    this.level = options.level ?? LOG_LEVELS.DEBUG;
    this.enableConsole = options.console ?? true;
    this.enableFile = options.file ?? false;
    this.enableUI = options.ui ?? true; // 화면 로그 패널
  }

  _format(level, message, data) {
    const timestamp = new Date().toISOString();
    const levelName = Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level);
    return {
      timestamp,
      level: levelName,
      module: this.module,
      message,
      data
    };
  }

  _output(level, message, data) {
    if (level < this.level) return;
    
    const log = this._format(level, message, data);
    
    // 콘솔 출력
    if (this.enableConsole) {
      const style = this._getConsoleStyle(level);
      console.log(
        `%c[${log.timestamp.slice(11, 23)}]%c [${log.module}] %c${log.message}`,
        'color: gray',
        style,
        'color: inherit',
        data ?? ''
      );
    }
    
    // UI 로그 패널 출력
    if (this.enableUI && window.logPanel) {
      window.logPanel.add(log);
    }
    
    // 파일 출력 (IPC를 통해 메인 프로세스로)
    if (this.enableFile && window.electronAPI) {
      window.electronAPI.writeLog(log);
    }
  }

  _getConsoleStyle(level) {
    switch (level) {
      case LOG_LEVELS.DEBUG: return 'color: #888';
      case LOG_LEVELS.INFO: return 'color: #4a9eff';
      case LOG_LEVELS.WARN: return 'color: #ffd000';
      case LOG_LEVELS.ERROR: return 'color: #ff4757; font-weight: bold';
    }
  }

  debug(message, data) { this._output(LOG_LEVELS.DEBUG, message, data); }
  info(message, data) { this._output(LOG_LEVELS.INFO, message, data); }
  warn(message, data) { this._output(LOG_LEVELS.WARN, message, data); }
  error(message, data) { this._output(LOG_LEVELS.ERROR, message, data); }

  // 함수 실행 추적
  trace(fnName) {
    this.debug(`→ ${fnName}() 호출`);
    return {
      end: (result) => this.debug(`← ${fnName}() 완료`, result),
      error: (err) => this.error(`✖ ${fnName}() 실패`, err)
    };
  }
}

// 모듈별 로거 생성
export function createLogger(module) {
  return new Logger(module);
}

// 사용 예시:
// import { createLogger } from './logger.js';
// const log = createLogger('VideoPlayer');
// log.info('영상 로드 시작', { path: videoPath });
```

### 7.2 로그 패널 UI

```javascript
// 개발 모드에서 화면 우측 하단에 로그 패널 표시

class LogPanel {
  constructor() {
    this.logs = [];
    this.maxLogs = 100;
    this.visible = false;
    this.filter = 'all'; // all, debug, info, warn, error
    this.element = this._createPanel();
  }

  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'log-panel';
    panel.innerHTML = `
      <div class="log-panel-header">
        <span>🔍 Debug Log</span>
        <select class="log-filter">
          <option value="all">전체</option>
          <option value="debug">DEBUG</option>
          <option value="info">INFO</option>
          <option value="warn">WARN</option>
          <option value="error">ERROR</option>
        </select>
        <button class="log-clear">지우기</button>
        <button class="log-close">✕</button>
      </div>
      <div class="log-panel-content"></div>
    `;
    // 스타일 및 이벤트 바인딩...
    return panel;
  }

  toggle() {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? 'block' : 'none';
  }

  add(log) {
    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this._render();
  }

  _render() {
    // 로그 렌더링...
  }
}

// Ctrl+Shift+D로 토글
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'D') {
    window.logPanel.toggle();
  }
});
```

### 7.3 로깅 가이드라인

```javascript
// ✅ 좋은 예시
log.info('영상 로드 시작', { path: videoPath, size: fileSize });
log.debug('프레임 이동', { from: oldFrame, to: newFrame });
log.warn('자동 저장 지연', { delay: ms, reason: 'file locked' });
log.error('JSON 파싱 실패', { error: e.message, file: jsonPath });

// ❌ 나쁜 예시
log.info('loading...');
log.debug(videoPath);
console.log('test'); // logger 사용하지 않음
```

### 7.4 에러 발생 시 자동 수집

```javascript
// 전역 에러 핸들러
window.onerror = (message, source, line, col, error) => {
  const log = createLogger('Global');
  log.error('Uncaught Error', {
    message,
    source,
    line,
    col,
    stack: error?.stack
  });
};

window.onunhandledrejection = (event) => {
  const log = createLogger('Global');
  log.error('Unhandled Promise Rejection', {
    reason: event.reason
  });
};
```

---

## 8. 에러 핸들링 패턴

### 8.1 Result 패턴

```javascript
// utils/result.js

export class Result {
  constructor(success, value, error) {
    this.success = success;
    this.value = value;
    this.error = error;
  }

  static ok(value) {
    return new Result(true, value, null);
  }

  static fail(error) {
    return new Result(false, null, error);
  }

  isOk() { return this.success; }
  isFail() { return !this.success; }

  // 체이닝
  map(fn) {
    return this.isOk() ? Result.ok(fn(this.value)) : this;
  }

  // 에러 시 기본값
  unwrapOr(defaultValue) {
    return this.isOk() ? this.value : defaultValue;
  }
}

// 사용 예시
async function loadReviewData(path) {
  const log = createLogger('ReviewData');
  const trace = log.trace('loadReviewData');

  try {
    const content = await fs.readFile(path, 'utf-8');
    const data = JSON.parse(content);
    
    // 데이터 검증
    if (!validateReviewData(data)) {
      trace.error({ reason: 'validation failed' });
      return Result.fail(new Error('Invalid review data format'));
    }
    
    trace.end({ comments: data.comments.length });
    return Result.ok(data);
    
  } catch (e) {
    trace.error(e);
    return Result.fail(e);
  }
}

// 사용
const result = await loadReviewData(jsonPath);
if (result.isFail()) {
  showErrorToast('리뷰 데이터를 불러올 수 없습니다.');
  return;
}
const reviewData = result.value;
```

### 8.2 에러 타입 정의

```javascript
// shared/errors.js

export class BaeframeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BaeframeError';
    this.code = code;
    this.details = details;
  }
}

export const ErrorCodes = {
  // 파일 관련
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
  INVALID_FILE_FORMAT: 'INVALID_FILE_FORMAT',
  
  // 비디오 관련
  VIDEO_LOAD_ERROR: 'VIDEO_LOAD_ERROR',
  VIDEO_CODEC_UNSUPPORTED: 'VIDEO_CODEC_UNSUPPORTED',
  MPV_NOT_FOUND: 'MPV_NOT_FOUND',
  
  // 데이터 관련
  JSON_PARSE_ERROR: 'JSON_PARSE_ERROR',
  DATA_VALIDATION_ERROR: 'DATA_VALIDATION_ERROR',
  
  // 권한 관련
  PERMISSION_DENIED: 'PERMISSION_DENIED',
};

// 에러 메시지 매핑 (사용자 친화적)
export const ErrorMessages = {
  [ErrorCodes.FILE_NOT_FOUND]: '파일을 찾을 수 없습니다.',
  [ErrorCodes.VIDEO_LOAD_ERROR]: '영상을 불러올 수 없습니다.',
  [ErrorCodes.MPV_NOT_FOUND]: 'mpv 플레이어를 찾을 수 없습니다. 설치를 확인해주세요.',
  // ...
};
```

### 8.3 사용자 피드백

```javascript
// modules/toast.js

export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// 사용
showToast('저장되었습니다.', 'success');
showToast('네트워크 오류가 발생했습니다.', 'error');
showToast('이 작업은 취소할 수 없습니다.', 'warn');
```

---

## 9. 개발 단계 (Phase)

### Phase 0: 환경 설정 (1-2일)

- [ ] 프로젝트 초기화 (npm init, electron)
- [ ] 폴더 구조 생성
- [ ] ESLint, Prettier 설정
- [ ] 로거 시스템 구현
- [ ] 개발 모드 핫 리로드 설정
- [ ] mpv 바이너리 포함 및 테스트

**체크포인트:** Electron 창이 열리고 mpv가 로드되는지 확인

### Phase 1: 기본 비디오 재생 (3-5일)

- [ ] mpv.js 또는 node-mpv 연동
- [ ] 영상 파일 로드 (드래그 드롭)
- [ ] 재생/일시정지
- [ ] 프레임 단위 탐색 (← →)
- [ ] 타임코드 표시
- [ ] MOV PNG 시퀀스 재생 테스트

**체크포인트:** 1GB MOV 파일이 끊김 없이 재생되고, 프레임 단위 이동이 되는지 확인

### Phase 2: UI 레이아웃 (2-3일)

- [ ] 헤더 구현
- [ ] 컨트롤 바 구현
- [ ] 댓글 패널 레이아웃
- [ ] 타임라인 레이아웃 (레이어 포함)
- [ ] 패널 리사이저
- [ ] CSS 변수 및 테마 적용

**체크포인트:** 목업과 동일한 레이아웃, 패널 크기 조절 가능

### Phase 3: 그리기 기능 (4-5일)

- [ ] Canvas 오버레이 설정
- [ ] 화살표 그리기
- [ ] 자유 드로잉 (포인트 단순화 포함)
- [ ] 색상/굵기 선택
- [ ] 그리기 데이터 → JSON 변환
- [ ] 프레임별 마킹 표시/숨김

**체크포인트:** 그린 마킹이 해당 프레임에서만 보이고, 다른 프레임으로 이동하면 사라짐

### Phase 4: 댓글 시스템 (3-4일)

- [ ] .review.json 읽기/쓰기
- [ ] 댓글 추가 UI
- [ ] 댓글 목록 렌더링
- [ ] 댓글 클릭 → 프레임 이동
- [ ] 해결됨 토글
- [ ] 필터링 (전체/미해결/해결됨)
- [ ] 본인 댓글만 수정/삭제

**체크포인트:** 댓글이 저장되고, 앱 재시작 후에도 유지됨

### Phase 5: Undo/Redo (2-3일)

- [ ] UndoManager 구현
- [ ] 그리기 Undo/Redo
- [ ] 댓글 Undo/Redo
- [ ] Ctrl+Z / Ctrl+Y 단축키

**체크포인트:** 실행 취소가 제대로 동작하고, 히스토리 스택이 유지됨

### Phase 6: 타임라인 고급 기능 (3-4일)

- [ ] 줌 인/아웃 (Ctrl + 휠)
- [ ] 가로/세로 스크롤
- [ ] 댓글 마커 표시
- [ ] 레이어 표시
- [ ] 플레이헤드 드래그

**체크포인트:** 타임라인 조작이 부드럽고, 마커 클릭으로 이동 가능

### Phase 7: 버전 관리 (2-3일)

- [ ] 파일명에서 버전 파싱 (v1, V2, v03 등)
- [ ] 같은 이름의 버전 파일들 감지
- [ ] 버전 목록 UI
- [ ] 버전 전환

**체크포인트:** shot_001_v1.mp4, shot_001_v2.mp4가 같은 그룹으로 표시됨

### Phase 8: 링크 공유 (2-3일)

- [ ] baeframe:// 프로토콜 등록
- [ ] 링크 복사 기능
- [ ] 프로토콜 핸들링 (앱 실행 + 영상 로드)
- [ ] .baef 파일 생성 및 연결

**체크포인트:** 슬랙에서 링크 클릭 시 앱이 열리고 해당 영상 로드됨

### Phase 9: 사용자 설정 (1-2일)

- [ ] 첫 실행 시 이름 입력
- [ ] Slack 이름 가져오기 (선택적)
- [ ] 설정 저장 (electron-store)
- [ ] 설정 UI

**체크포인트:** 설정한 이름이 댓글에 표시됨

### Phase 10: 마무리 & 테스트 (3-5일)

- [ ] 전체 기능 통합 테스트
- [ ] 에러 핸들링 보강
- [ ] 성능 최적화
- [ ] 배포 스크립트 (포터블)
- [ ] 사용자 가이드 작성

---

## 10. 배포 방식

### 10.1 포터블 배포 (권장)

```
G:/공유드라이브/Tools/baeframe/
├── baeframe.exe              # 또는 electron 폴더
├── resources/
├── mpv/
├── run-baeframe.bat          # 실행 스크립트
└── README.txt
```

```batch
@echo off
:: run-baeframe.bat
cd /d "%~dp0"
start "" "baeframe.exe" %*
```

**팀원 설정:**
1. `G:/공유드라이브/Tools/baeframe/run-baeframe.bat`의 바로가기 생성
2. 바로가기를 바탕화면이나 시작 메뉴에 배치
3. 업데이트 시 폴더만 교체하면 됨

### 10.2 프로토콜 등록

```batch
:: install-protocol.bat (관리자 권한 필요, 1회만 실행)
@echo off
set "APP_PATH=G:\공유드라이브\Tools\baeframe\baeframe.exe"

reg add "HKCU\Software\Classes\baeframe" /ve /d "URL:baeframe Protocol" /f
reg add "HKCU\Software\Classes\baeframe" /v "URL Protocol" /d "" /f
reg add "HKCU\Software\Classes\baeframe\shell\open\command" /ve /d "\"%APP_PATH%\" \"%%1\"" /f

echo 프로토콜 등록 완료!
pause
```

### 10.3 파일 연결 등록

```batch
:: install-baef.bat (관리자 권한 필요, 1회만 실행)
@echo off
set "APP_PATH=G:\공유드라이브\Tools\baeframe\baeframe.exe"

reg add "HKCU\Software\Classes\.baef" /ve /d "baeframe.ReviewFile" /f
reg add "HKCU\Software\Classes\baeframe.ReviewFile" /ve /d "baeframe Review File" /f
reg add "HKCU\Software\Classes\baeframe.ReviewFile\shell\open\command" /ve /d "\"%APP_PATH%\" \"%%1\"" /f

echo .baef 파일 연결 완료!
pause
```

---

## 11. 참고 자료

### 11.1 UI 목업

- `baeframe-ui-mockup-v2.html` - 전체 UI 목업 (인터랙션 포함)

### 11.2 기술 참고

- [Electron 공식 문서](https://www.electronjs.org/docs)
- [mpv.js GitHub](https://github.com/aspect-ratio/mpv.js)
- [node-mpv GitHub](https://github.com/j-holub/Node-MPV)
- [Canvas API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [Ramer-Douglas-Peucker 알고리즘](https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm)

### 11.3 디자인 참고

- Frame.io V4 UI
- Monday.com 비디오 주석
- Premiere Pro 타임라인

---

## 📝 개발 노트

### 바이브 코딩 팁

1. **한 번에 하나의 모듈만** - 모듈 단위로 개발하고 테스트
2. **로그를 많이 남기기** - 문제 발생 시 추적 용이
3. **작은 함수, 명확한 이름** - 코드 이해도 향상
4. **Result 패턴 사용** - 에러 처리 일관성
5. **목업 HTML 참고** - UI 구현 시 참고

### 자주 발생할 수 있는 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| mpv 로드 실패 | 바이너리 경로 오류 | mpv 폴더 위치 확인 |
| MOV 재생 안 됨 | 코덱 미지원 | mpv 설정 확인 |
| Canvas 위치 어긋남 | 비디오 크기 변경 | resize 이벤트 핸들링 |
| JSON 저장 실패 | 파일 잠금 | 재시도 로직 추가 |
| 프로토콜 작동 안 함 | 레지스트리 미등록 | install-protocol.bat 실행 |

---

**문서 끝**
