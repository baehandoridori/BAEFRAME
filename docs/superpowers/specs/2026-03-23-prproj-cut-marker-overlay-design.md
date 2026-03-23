# Premiere Pro Cut Marker Overlay

**Date**: 2026-03-23
**Status**: Design
**Branch**: `feature/prproj-cut-markers`

## Problem

애니메이션 스튜디오에서 "애니메이션제목_릴.prproj" 파일에는 중첩 시퀀스(a001, a002...)로 씬/컷 구조가 정의되어 있다. 이 컷 구조를 "애니메이션제목_가편.mp4" 또는 "애니메이션제목_최종.mp4" 등의 영상을 BAEframe에서 리뷰할 때 자동으로 영상 위에 오버레이로 표시하고 싶다.

## Solution

BAEframe UI에서 "릴 가져오기" 버튼으로 .prproj 파일을 선택하면, 해당 파일을 GZip 해제 → XML 파싱하여 메인 시퀀스의 중첩 시퀀스 이름과 타임코드를 추출한다. 추출된 컷 데이터를 영상 위 DOM 오버레이로 표시하며, 표시 여부와 위치를 사용자가 설정할 수 있다.

## Data Flow

```
.prproj (GZip XML)
  → Main Process: gunzip → XML parse → 중첩 시퀀스 추출
  → IPC → Renderer: CutMarker[] 배열 생성
  → .bframe 파일에 cuts 필드로 저장
  → 영상 오버레이 + 타임라인 마커 렌더링
```

## Architecture

### New Modules

#### 1. `main/prproj-parser.js` — .prproj 파싱 (Main Process)

Main 프로세스에서 실행. Node.js `zlib`로 GZip 해제 후 XML 파싱.

**Responsibilities:**
- .prproj 파일 읽기 + GZip 해제
- XML 파싱 (fast-xml-parser)
- ObjectID/ObjectRef/ObjectUID/ObjectURef 참조 그래프 탐색
- 메인 시퀀스 자동 감지 (다른 시퀀스에 중첩되지 않은 최상위 시퀀스)
- 중첩 시퀀스만 필터링 (SequenceSource vs MediaSource 구분)
- tick → 초/프레임 변환 (254,016,000,000 ticks/sec)

**Input:** .prproj 파일 경로
**Output:**
```javascript
{
  sequenceName: "작품명_릴",
  fps: 24,
  duration: 3600,           // seconds
  totalFrames: 86400,
  cuts: [
    { name: "a001", startFrame: 0,    endFrame: 720,  startTime: 0,    endTime: 30 },
    { name: "a002", startFrame: 720,  endFrame: 1200, startTime: 30,   endTime: 50 },
    { name: "a003", startFrame: 1200, endFrame: 1920, startTime: 50,   endTime: 80 },
    // ...
  ]
}
```

**시퀀스 선택 로직:**
1. XML에서 모든 `Sequence` 요소를 수집
2. 다른 시퀀스의 `SequenceSource`로 참조되는 시퀀스들을 "중첩된 시퀀스"로 마킹
3. 참조되지 않는 시퀀스 = 최상위 시퀀스
4. 최상위 시퀀스가 1개면 자동 선택
5. 여러 개면 이름 목록을 Renderer로 전달 → 사용자가 선택

**중첩 시퀀스 탐색 경로:**
```
Sequence → TrackGroups → VideoTrackGroup → Tracks → VideoClipTrack
  → ClipItems → TrackItems → VideoClipTrackItem
    → Start/End (timeline position in ticks)
    → SubClip → VideoClip → Source
      → if SequenceSource: 중첩 시퀀스 (이름 추출)
      → if MediaSource: 일반 미디어 클립 (무시)
```

#### 2. `renderer/scripts/modules/cut-marker-manager.js` — 컷 마커 관리 + 오버레이 (Renderer)

EventTarget 기반. 기존 HighlightManager/CommentManager 패턴을 따름.

**Responsibilities:**
- CutMarker 데이터 클래스 관리
- 영상 위 DOM 오버레이 렌더링 (현재 프레임에 해당하는 컷 이름 표시)
- 위치/표시 설정 반영
- .bframe 저장/로드 연동

**CutMarker 데이터 클래스:**
```javascript
class CutMarker {
  constructor({ name, startFrame, endFrame, startTime, endTime }) {
    this.name = name;           // "a001"
    this.startFrame = startFrame;
    this.endFrame = endFrame;
    this.startTime = startTime; // seconds
    this.endTime = endTime;     // seconds
  }

  containsFrame(frame) {
    return frame >= this.startFrame && frame < this.endFrame;
  }

  toJSON() { /* serialization */ }
  static fromJSON(json) { /* deserialization */ }
}
```

**CutMarkerManager:**
```javascript
class CutMarkerManager extends EventTarget {
  constructor({ overlayContainer, videoPlayer, timeline, settings }) { ... }

  // Data
  markers = [];                    // CutMarker[]
  currentCut = null;               // 현재 프레임의 CutMarker

  // Core methods
  importFromPrproj(parsedData)     // 파싱 결과 적용
  clear()                          // 마커 전체 제거
  getCutAtFrame(frame)             // 특정 프레임의 컷 반환 (binary search)

  // Rendering
  updateOverlay(currentFrame)      // 프레임 변경 시 오버레이 업데이트
  renderTimelineMarkers()          // 타임라인에 구분선 렌더링

  // Settings
  setVisible(show)                 // 표시/숨김
  setPosition(position)            // 오버레이 위치 변경
  setFontSize(size)                // 글자 크기

  // Persistence
  toJSON()                         // .bframe 저장용
  loadFromJSON(json)               // .bframe 로드용
}
```

### Modified Modules

#### 3. `shared/schema.js` — cuts 필드 추가

```javascript
// 기존 BframeData에 추가
cuts: {
  source: string | null,   // .prproj 파일 경로 (참조용)
  sequenceName: string,    // "작품명_릴"
  fps: number,             // 릴의 프레임레이트
  markers: CutMarker[]     // 컷 마커 배열
}
```

마이그레이션: `cuts` 필드가 없는 기존 .bframe 파일은 `cuts: null`로 처리 (하위 호환).

#### 4. `main/ipc-handlers.js` — IPC 핸들러 2개 추가

```javascript
// 1. .prproj 파일 선택 다이얼로그
ipcMain.handle('prproj:open-dialog', async () => {
  return dialog.showOpenDialog(mainWindow, {
    title: 'Premiere Pro 프로젝트 파일 열기',
    filters: [{ name: 'Premiere Pro', extensions: ['prproj'] }],
    properties: ['openFile']
  });
});

// 2. .prproj 파싱 실행
ipcMain.handle('prproj:parse', async (event, filePath) => {
  return parsePrproj(filePath);  // prproj-parser.js
});
```

#### 5. `renderer/scripts/app.js` — 모듈 통합

```javascript
// 초기화
const cutMarkerManager = new CutMarkerManager({
  overlayContainer: elements.cutMarkerOverlay,
  videoPlayer, timeline, userSettings
});

// 이벤트 연결
videoPlayer.addEventListener('timeupdate', (e) => {
  cutMarkerManager.updateOverlay(e.detail.currentFrame);
});

// .bframe 로드 시 컷 데이터 복원
reviewDataManager.addEventListener('dataLoaded', (e) => {
  if (e.detail.data.cuts) {
    cutMarkerManager.loadFromJSON(e.detail.data.cuts);
  }
});
```

#### 6. `renderer/index.html` — DOM 추가

```html
<!-- 영상 오버레이 (video-wrapper 내부) -->
<div id="cutMarkerOverlay" class="cut-marker-overlay">
  <span class="cut-marker-label"></span>
</div>

<!-- 컷 마커 가져오기 버튼 (기존 컨트롤 영역) -->
<button id="importCutMarkersBtn" class="control-btn" title="릴 가져오기 (.prproj)">
  <!-- 아이콘 -->
</button>
```

#### 7. `renderer/styles/main.css` — 오버레이 스타일

```css
.cut-marker-overlay {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  font-family: monospace;
  color: white;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(0,0,0,0.5);
  transition: opacity 0.15s;
}
```

위치는 CSS 클래스로 전환:
- `.cut-marker-pos-top-left`
- `.cut-marker-pos-top-center`
- `.cut-marker-pos-top-right`
- `.cut-marker-pos-bottom-left`
- `.cut-marker-pos-bottom-center`
- `.cut-marker-pos-bottom-right`

#### 8. `user-settings.js` — 설정 3개 추가

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `showCutMarkers` | `true` | 오버레이 표시 여부 |
| `cutMarkerPosition` | `"top-left"` | 오버레이 위치 (6가지) |
| `cutMarkerFontSize` | `"medium"` | 글자 크기 (small/medium/large) |

#### 9. `timeline.js` — 타임라인 컷 구분선

타임라인 룰러 영역에 각 컷의 시작 프레임 위치에 수직 구분선 + 라벨을 렌더링한다. 기존 타임라인의 프레임→픽셀 변환 로직을 재사용.

```
|a001    |a002      |a003  |a004        |a005    |
```

## Overlay Display Behavior

- 영상 재생 중 현재 프레임이 속한 컷의 이름을 오버레이로 표시
- 컷이 바뀔 때 라벨 텍스트가 전환됨
- `getCutAtFrame()`은 정렬된 배열에서 binary search로 O(log n) 탐색
- 50~200개 컷 규모에서 성능 문제 없음

## Error Handling

| 상황 | 처리 |
|------|------|
| .prproj 파일이 GZip이 아닌 경우 | 에러 메시지: "지원하지 않는 프리미어 프로젝트 형식입니다" |
| 중첩 시퀀스가 없는 경우 | "선택한 프로젝트에 중첩 시퀀스가 없습니다" |
| 최상위 시퀀스가 여러 개인 경우 | 드롭다운으로 선택 UI 제공 |
| 릴과 영상의 길이가 다른 경우 | 경고 표시 후 진행 (타임코드는 릴 기준 그대로 적용) |
| XML 파싱 실패 | "프로젝트 파일을 읽을 수 없습니다" |

## Dependencies

- `fast-xml-parser` (npm) — XML 파싱. 경량이고 의존성 없음.
- Node.js 내장 `zlib` — GZip 해제. 추가 설치 불필요.

## Out of Scope

- 프리미어 프로젝트 파일 쓰기/수정
- 중첩 시퀀스 내부의 추가 메타데이터 추출 (마커, 라벨 등)
- 실시간 .prproj 파일 변경 감지 (워치)
- 컷별 영상 분리(split) 기능
