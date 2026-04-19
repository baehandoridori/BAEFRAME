# 코멘트 클러스터 UX 재작업 설계

- **작성일**: 2026-04-20
- **작성자**: Claude Code (baehandoridori 협업)
- **상태**: Draft
- **관련 선행 작업**: PR #112 (Mode C 하이브리드 펼침 UI)

---

## 1. 배경 및 목적

PR #112에서 타임라인 구간 코멘트가 겹칠 때 **클러스터 배지 → 펼침 UI (Mode C)**가 도입되었다. 병합 후 후속 사용에서 다음 UX 이슈와 regression이 발견되었다.

### 1.1 관찰된 이슈

| # | 이슈 | 증상 |
|---|------|------|
| A | **코멘트 편집 regression** | 펼친 클러스터 내부의 개별 코멘트에 대해 타임라인 바에서의 드래그/리사이즈 편집이 동작하지 않는다. |
| B | **펼친 상태 즉시 닫힘** | 펼친 클러스터의 개별 코멘트를 이동/리사이즈하려고 `mousedown`하면 클러스터가 즉시 접힌다. |
| C | **배지 시각 혼잡** | 접힌 배지의 세로 3색 스트라이프(`.comment-cluster-stack-hint`)가 시선을 분산시키고, 겹침 개수 숫자가 잘 안 보인다. |
| D | **호버 피드백 부재** | 단일 코멘트 마커에는 호버 툴팁이 있지만, 접힌 클러스터 배지에는 없다 — 내용을 미리 볼 수 없다. |
| E | **접기 버튼 가시성 낮음** | 펼친 상태의 `▲ 접기` 칩이 작고 눈에 띄지 않는다. |
| F | **줌 무시 클러스터링** | 현재 `findRangeClusters`는 프레임 기반만 사용하므로, 타임라인을 많이 확대해도 이미 묶인 클러스터가 그대로 유지된다 (시각적으로 충분히 떨어져 있어도). |

### 1.2 추가 개선 요구

| # | 항목 | 목표 |
|---|------|------|
| G | **댓글 썸네일 정확-프레임** | 사이드바 댓글 목록의 썸네일이 `markerTime`의 가장 가까운 근사 프레임이 아닌 **정확한 startFrame**의 썸네일을 표시. |

---

## 2. 범위

### 2.1 In-Scope

- 이벤트 위임 기반 상호작용 엔진 전환 (A·B·E 해결)
- 클러스터 해제 픽셀 임계값 적용 (F 해결)
- 배지/접기/호버 팝업 재설계 (C·D·E 해결)
- 댓글 썸네일 온디맨드 정확-프레임 캡처 (G 해결)
- 단위 테스트 + 수동 QA 체크리스트

### 2.2 Out-of-Scope

- PR #111 (최근 연 파일) 관련 작업 — 코드는 이미 main에 적용되어 있음
- 클러스터 설정을 사용자가 조정하는 UI
- 마커(점) 클러스터링 (본 스펙은 **구간** 코멘트 클러스터 전용)
- 웹 뷰어(`web-viewer/`) 반영 — 별도 작업

---

## 3. 설계 결정 (요약)

| 결정 | 선택 | 이유 |
|------|------|------|
| 상호작용 아키텍처 | **이벤트 위임** | 재렌더 친화적, 중복 바인딩 무, 클러스터/배지/호버를 한 곳에서 관리 |
| 픽셀 임계값 | **8px** | 코멘트 바 높이보다 약간 작은 균형적 값 |
| 배지 디자인 | **"+N" 텍스트 강조 + 세로줄 제거** | 숫자 가독성 최우선, 시각 잡음 감소 |
| 접기 버튼 | **배지 스타일, 클러스터 오른쪽 상단 고정** | 가시성 확보, 펼침 영역과 명확한 연관 |
| 드래그 중 닫힘 방지 | **`isDraggingComment` 플래그 + 드래그 중 재렌더 억제** | 펼친 상태를 무조건 유지, 사용자 의도 보존 |
| 호버 팝업 적용 범위 | **접힌 배지에만** | 펼친 상태에서는 개별 코멘트 호버로 충분 |
| 썸네일 정확-프레임 | **온디맨드 seek+capture, 재생 중 큐 대기** | 초기 렌더 블로킹 없음, 재생 방해 방지 |

---

## 4. 아키텍처

### 4.1 이벤트 위임 전환

**기존 문제**: `setupCommentRangeInteractions()` (`renderer/scripts/app.js:3097`)가 `.comment-range-item` DOM마다 리스너를 바인딩한다. PR #112 이후 클러스터 펼침 시 DOM이 재생성되는데, 이 함수가 재호출되지 않으면 이벤트가 비어 regression이 발생한다.

**전환**: `commentTrack` 컨테이너 단 1개에 위임 리스너를 단다. 타깃 식별은 `e.target.closest(...)`.

#### 4.1.1 분기 테이블 (위임 핸들러)

| 이벤트 | 대상 셀렉터 | 동작 |
|--------|------------|------|
| `mousedown` | `.comment-handle-left/right` | 리사이즈 드래그 시작 (`isDraggingComment = true`) |
| `mousedown` | `.comment-range-item` (핸들 外) | 이동 드래그 시작 (`isDraggingComment = true`) |
| `mousedown` | `.comment-cluster-badge` | 클러스터 펼침 |
| `mousedown` | `.comment-cluster-close-badge` | 클러스터 접힘 |
| `click` | 트랙 빈 영역 | `!isDraggingComment && !justDragged`일 때만 `expandedClusterId = null` |
| `mouseover` | `.comment-cluster-badge` | 호버 팝업 예약 (300ms 후 표시) |
| `mouseout` | `.comment-cluster-badge` | 호버 팝업 타이머 취소 / 즉시 숨김 |

#### 4.1.1a 기존 리스너 정리 (중요)

`timeline.js:1906-1911` `setCommentTrack()`에 이미 다음 `click` 리스너가 존재한다:

```js
this.commentTrack.addEventListener('click', (e) => {
  if (e.target === this.commentTrack && this.expandedClusterId !== null) {
    this.expandedClusterId = null;
    this.renderCommentRanges(this._lastComments || []);
  }
});
```

이 리스너는 **드래그 가드가 없어** 이슈 B의 원인 중 하나다. **교체 방침**:

1. `setCommentTrack()` 내부의 기존 `click` 리스너 **삭제**
2. 같은 위치에서 `_bindCommentTrackDelegation()`을 호출
3. 새 위임 `click` 핸들러가 `isDraggingComment`/`justDragged` 가드와 함께 동일 동작 수행

또한 `_createClusterBadgeElement()`(라인 2065-2109), `_createCollapseChip()`(라인 2114-2133)에 현재 달려 있는 개별 `addEventListener` 호출도 **모두 제거**한다. 이벤트 라우팅은 위임 핸들러가 전담.

#### 4.1.2 상태 필드 (timeline.js)

```js
this.expandedClusterId    = null;   // 기존 유지
this.isDraggingComment    = false;  // 신규
this.dragContext          = null;   // 신규
this.justDragged          = false;  // 신규 (click 차단용 1-tick 플래그)
this.clusterTooltipTimer  = null;   // 신규
this.clusterTooltipEl     = null;   // 신규 (body에 1개 유지, 재사용)
```

`dragContext` 형태:
```js
{
  mode: 'move' | 'resize-left' | 'resize-right',
  markerId: string,
  layerId: string,
  startX: number,           // clientX 기록
  origStartFrame: number,
  origEndFrame: number,
  element: HTMLElement,     // 드래그 대상 DOM (재렌더 대신 직접 조작)
}
```

### 4.2 드래그 엔진 (재렌더 억제)

**핵심 원칙**: 드래그 **중** 에는 `renderCommentRanges()`를 **절대 호출하지 않는다**.

| 단계 | 동작 |
|------|------|
| `mousedown` | `dragContext` 세팅, `window`에 `mousemove`/`mouseup` 임시 바인딩, `e.preventDefault()` |
| `mousemove` | `Δframe = pxToFrameDelta(clientX - startX)` 계산, `element.style.left/width`만 직접 업데이트 (DOM 교체 금지) |
| `mouseup` (3px 미만 이동) | 클릭으로 처리, `commentManager` 변경 **안 함**, `justDragged = false` |
| `mouseup` (3px 이상 이동) | `commentManager.updateMarker(...)` 호출 → 데이터 이벤트 → 일반 재렌더 경로로 동기화. `justDragged = true`로 1-tick 설정 |
| cleanup | `window`의 `mousemove`/`mouseup` 해제, `isDraggingComment = false`, `dragContext = null` |

### 4.3 클러스터링 로직 확장

#### 4.3.1 기존 파이프라인

```
findRangeClusters(comments)  →  [cluster1, cluster2, ...]
assignLanes(cluster)         →  각 comment._lane 할당
```

#### 4.3.2 신규 순수 함수 추가

```js
// renderer/scripts/modules/comment-cluster.js

/**
 * 클러스터 내부에서 이웃 간 픽셀 거리가 minGapPx 이상이면 분리한다.
 * @param {Array<Array<Comment>>} clusters - findRangeClusters의 반환값
 * @param {{pxPerFrame: number, minGapPx?: number}} opts
 * @returns {Array<Array<Comment>>} 분리된 클러스터 배열 (단일 멤버도 포함 가능)
 */
export function splitClustersByPixelGap(clusters, { pxPerFrame, minGapPx = 8 }) {
  if (!pxPerFrame || pxPerFrame <= 0) return clusters;  // 안전 가드
  const result = [];
  for (const cluster of clusters) {
    if (cluster.length < 2) { result.push(cluster); continue; }
    const sorted = [...cluster].sort((a, b) => a.startFrame - b.startFrame);
    let current = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const gapPx = (curr.startFrame - prev.endFrame) * pxPerFrame;
      if (gapPx >= minGapPx) {
        result.push(current);
        current = [curr];
      } else {
        current.push(curr);
      }
    }
    result.push(current);
  }
  return result;
}
```

#### 4.3.3 호출부 (timeline.js `renderCommentRanges`)

```js
const rawClusters = findRangeClusters(comments);
const trackRect = this.commentTrack.getBoundingClientRect();
const pxPerFrame = trackRect.width / this.totalFrames;
const splitClusters = splitClustersByPixelGap(rawClusters, { pxPerFrame, minGapPx: 8 });

for (const group of splitClusters) {
  if (group.length === 1) {
    // 단일 코멘트 (배지 아님) 렌더
  } else {
    // 클러스터 배지 또는 펼침 렌더
  }
}
```

#### 4.3.4 펼친 상태 유효성 검증 — split 결과 반영 (중요)

기존 `renderCommentRanges` (timeline.js:1948-1956)에 `expandedClusterId` 유효성 검증이 있다:

```js
if (this.expandedClusterId !== null) {
  const stillExists = clusters.some(c =>
    clusterKey(c) === this.expandedClusterId && c.length > 1
  );
  if (!stillExists) {
    this.expandedClusterId = null;
  }
}
```

**split 도입 후 수정**: 이 검증은 `rawClusters`가 아닌 **split 결과**(`splitClusters`)에 대해 수행해야 한다. 줌 변경으로 split 결과가 달라져 펼친 클러스터의 구성원이 쪼개지면 `clusterKey`가 달라지고, 조용히 접힘 상태로 복귀한다 — 이건 의도된 동작이며 UX상 허용된다. 그러나 검증 순서를 반드시 split **이후**로 이동해야 한다.

```js
const splitClusters = splitClustersByPixelGap(rawClusters, { pxPerFrame, minGapPx: 8 });
if (this.expandedClusterId !== null) {
  const stillExists = splitClusters.some(c =>
    clusterKey(c) === this.expandedClusterId && c.length > 1
  );
  if (!stillExists) this.expandedClusterId = null;
}
```

### 4.4 배지/팝업 DOM 구조

#### 4.4.1 배지 (접힌 상태)

**기존** (제거):
```html
<div class="comment-cluster-badge">
  <div class="comment-cluster-stack-hint">
    <div class="stripe" style="background:#f00"></div>
    <div class="stripe" style="background:#0f0"></div>
    <div class="stripe" style="background:#00f"></div>
  </div>
  <div class="comment-cluster-count">⊕3</div>
</div>
```

**신규**:
```html
<div class="comment-cluster-badge" data-cluster-key="...">
  <span class="comment-cluster-badge-label">+3</span>
</div>
```

#### 4.4.2 접기 배지 (펼친 상태)

```html
<div class="comment-cluster-close-badge">× 접기</div>
```

위치: `position: absolute; top: -20px; right: 0; z-index: 25;`

#### 4.4.3 호버 툴팁 (body 레벨)

`body`에 단일 `<div class="comment-cluster-tooltip">`를 유지하고 재사용 (메모리/GC 효율). 내용 구조:

```html
<div class="comment-cluster-tooltip" role="tooltip">
  <div class="tooltip-row">
    <span class="tooltip-color-dot" style="background:#4a9eff"></span>
    <span class="tooltip-author">김민수</span>
    <span class="tooltip-range">120–145</span>
    <span class="tooltip-text">수정 필요한 부분…</span>
  </div>
  <!-- 반복 -->
</div>
```

위치 계산: 배지 `getBoundingClientRect()` 기준 top placement, 뷰포트 상단 160px 미만이면 bottom placement로 폴백.

### 4.5 썸네일 온디맨드 정확-프레임

#### 4.5.1 `thumbnail-generator.js` 신규 API

**실제 속성명**: 클래스는 `extends EventTarget`이며, 내부 비디오 요소의 속성명은 `this.video`(라인 44, 136)다. Phase 2가 완료되면 `_cleanupVideo()`(라인 174)가 `this.video = null`로 설정해 **해제**한다 — 따라서 온디맨드 캡처는 비디오가 해제된 후에도 작동해야 한다.

```js
getThumbnailUrlAtExact(time) {
  const rounded = Math.round(time * 10) / 10;
  return this.thumbnailMap.get(rounded) || null;
}

requestExactCapture(time) {
  const rounded = Math.round(time * 10) / 10;
  if (this.thumbnailMap.has(rounded)) return;
  if (!this._exactQueue) this._exactQueue = new Set();
  if (this._exactQueue.has(rounded)) return;
  this._exactQueue.add(rounded);
  this._drainExactQueue();
}

async _drainExactQueue() {
  if (this._exactDraining) return;
  if (!this.videoSrc) return;  // 아직 영상 로드 전

  // 원본 영상이 재생 중이면 방해하지 않기 위해 대기
  // (메인 player는 timeline.js가 보유하며 여기선 알 수 없으므로, 앱 측에서
  //  pause 훅을 통해 trigger를 넣어준다 — 4.5.1a 참고)

  this._exactDraining = true;
  try {
    // 비디오 요소가 없으면 온디맨드 캡처용으로 재생성 (기존 `generate()` 경로 재사용 금지)
    const needsVideo = !this.video;
    if (needsVideo) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.preload = 'auto';
      await this._loadVideo(this.videoSrc);
    }

    while (this._exactQueue.size > 0) {
      const t = this._exactQueue.values().next().value;
      this._exactQueue.delete(t);
      await this._seekAndCapture(t);
      const dataUrl = this.thumbnailMap.get(t);
      if (dataUrl) this._emit('exactCaptured', { time: t, dataUrl });
    }

    // 임시 비디오였으면 정리 (캐시 재저장 포함)
    if (needsVideo) {
      this._cleanupVideo();
      await this._saveToCache();
    }
  } finally {
    this._exactDraining = false;
  }
}

// 재생 시작 시 앱에서 호출 — 진행 중 while 루프를 다음 iteration에서 중단
_abortExactDrain() {
  this._exactAborted = true;
}
// (while 루프 내에서 `if (this._exactAborted) { this._exactAborted = false; break; }` 체크)
```

#### 4.5.1a 재생 중 캡처 방지 — 앱 측 훅

`thumbnail-generator.js`는 메인 `videoPlayer` 인스턴스에 접근하지 않는다(책임 분리). 따라서 **앱 계층에서 트리거**한다:

- **요청만 쌓기**: `requestExactCapture(time)`은 `_drainExactQueue()`를 즉시 호출하지만, 내부에서 `_exactDraining` 가드로 중복 방지
- **앱 측 drain 조건**: `app.js`에서 `videoPlayer`에 `pause` 이벤트 훅을 추가해 `thumbnailGenerator._drainExactQueue()`를 명시 호출하고, `play` 이벤트에서는 `_exactDraining` 플래그로 진행 중 드레인을 abort (안전하게 현재 `_seekAndCapture` 하나만 끝나고 큐 정지)

간단화를 위해 이번 스코프에서는 **앱 측 조건부 호출**로 구현 (아래는 **의사코드** — 구현 시 `videoPlayer` 래퍼의 실제 이벤트 API를 확인해 `addEventListener`/`on`/직접 콜백 중 적합한 것을 선택):

```js
// app.js 기존 videoPlayer 이벤트 훅 근처에 추가 — 실 API 확인 후 적용
videoPlayerBindOnPause(() => thumbnailGenerator._drainExactQueue?.());
videoPlayerBindOnPlay (() => thumbnailGenerator._abortExactDrain?.());
```

`videoPlayer`가 HTML `<video>` 엘리먼트면 `addEventListener('pause'|'play', ...)`, 자체 래퍼면 래퍼의 구독 메서드를 사용. 구현 단계 첫 태스크에서 확인.

#### 4.5.2 `app.js` 호출부 수정 (라인 ~5300)

```js
const markerTime = marker.startFrame / videoPlayer.fps;
let thumbnailUrl = null;
if (showThumbnails && thumbnailGenerator?.isReady) {
  thumbnailUrl = thumbnailGenerator.getThumbnailUrlAtExact(markerTime);
  if (!thumbnailUrl) {
    thumbnailGenerator.requestExactCapture(markerTime);
    thumbnailUrl = thumbnailGenerator.getThumbnailUrlAt(markerTime);  // 근사 폴백
  }
}
```

#### 4.5.3 정확 캡처 완료 이벤트 처리

`ThumbnailGenerator`는 `extends EventTarget`이며 이벤트 발행은 `dispatchEvent(new CustomEvent(type, { detail }))` (라인 514-518). 따라서 소비자는 **`addEventListener` + `e.detail`** 패턴을 사용한다 (기존 `'progress'` 리스너와 동일한 방식, `app.js:4191-4193` 참고).

```js
thumbnailGenerator.addEventListener('exactCaptured', (e) => {
  const { time, dataUrl } = e.detail;
  const frame = Math.round(time * videoPlayer.fps);
  document.querySelectorAll(
    `.comment-item[data-start-frame="${frame}"] .comment-thumbnail`
  ).forEach(img => { img.src = dataUrl; });
});
```

전체 재렌더가 아닌 **해당 요소의 `img.src`만 교체**하여 부드러운 진적 갱신.

---

## 5. 영향받는 파일

| 파일 | 변경 유형 | 주요 수정 |
|------|----------|----------|
| `renderer/scripts/modules/comment-cluster.js` | 추가 | `splitClustersByPixelGap` 함수 추가 |
| `scripts/tests/comment-cluster.test.js` | 추가 | `splitClustersByPixelGap` 단위 테스트 |
| `renderer/scripts/modules/timeline.js` | 개편 | 위임 핸들러 도입, 드래그 엔진 구현, 클러스터 split 호출, 배지/접기/툴팁 DOM 구조 변경, 상태 필드 추가 |
| `renderer/scripts/app.js` | 삭제+수정 | `setupCommentRangeInteractions` 삭제, 호출부 제거; 썸네일 렌더 부분 수정; `exactCaptured` 이벤트 수신 |
| `renderer/scripts/modules/thumbnail-generator.js` | 추가 | `getThumbnailUrlAtExact`, `requestExactCapture`, `_drainExactQueue` |
| `renderer/styles/main.css` | 개편 | `.comment-cluster-stack-hint` 제거, `.comment-cluster-badge-label` 추가, `.comment-cluster-close-badge` 추가, `.comment-cluster-tooltip` 추가 |

---

## 6. 테스트 전략

### 6.1 단위 테스트 (`scripts/tests/comment-cluster.test.js`)

| 케이스 | 입력 | 기대 |
|--------|------|------|
| 빈 클러스터 목록 | `[]` | `[]` |
| 단일 멤버 클러스터 통과 | `[[c1]]` | `[[c1]]` |
| 모든 gap < 8px | 3개 코멘트, pxPerFrame=1, 모두 간격 5px | 원본 클러스터 그대로 |
| gap 한 지점만 ≥ 8px | 3개 코멘트, 중간만 10px gap | 2개 그룹 분리 |
| 여러 gap ≥ 8px | 4개 코멘트, 2곳 gap 10px | 3개 그룹 분리 |
| 단일 멤버로 쪼개짐 | 2개 코멘트, gap 10px | `[[c1], [c2]]` (각 단일) |
| `pxPerFrame = 0` 방어 | 0 입력 | 원본 그대로 반환 |
| `pxPerFrame` 음수 방어 | -1 입력 | 원본 그대로 반환 |
| `minGapPx` 기본값 | 옵션 생략 | 8px 기준 적용 |

### 6.2 수동 QA 체크리스트 (DEVLOG 첨부)

1. 겹친 코멘트 2/3/5개 → 각각 `+2`/`+3`/`+5` 배지 표시
2. 배지 호버 (접힌 상태) → 300ms 후 세로 리스트 팝업 (작성자 · 프레임 범위 · 본문 1줄)
3. 팝업 위치 top/bottom 폴백 (뷰포트 상단 근처에서 아래로)
4. 배지 클릭 → 펼침, 오른쪽 상단에 접기 배지 명확히 표시
5. 펼친 클러스터 내부 코멘트 바 **중앙 드래그 → 이동**, 펼친 상태 유지
6. 좌/우 핸들 드래그 → `startFrame`/`endFrame` 변경, 펼친 상태 유지
7. 3px 미만 드래그 = 단순 클릭으로 처리 (패널 이동/하이라이트만)
8. 빈 영역 클릭 → 펼친 클러스터 접힘
9. 줌 1× 8px 이내 코멘트 → 클러스터 묶음; **줌 300% 확대 → 자연스레 분리**
10. 댓글 클릭 → 사이드바 썸네일이 근사치 먼저, ≤ 1초 후 **정확한 프레임으로 교체**
11. 재생 중에는 온디맨드 캡처 대기, **일시정지 시 드레인**
12. Regression: 비클러스터 단일 코멘트 편집 정상 동작
13. 실시간 동기화 이벤트 드래그 중 수신돼도 펼친 상태 유지
14. ESC 키로도 클러스터 접힘 (선택적 기능)
15. **펼친 상태에서 줌 변경** → 구성원 동일하면 펼친 상태 유지; split으로 구성원 변하면 자연스럽게 접힘 (regression 없음)
16. Phase 2 완료 후 (`this.video === null` 상태)에도 온디맨드 캡처가 정상 동작 (재생성 경로)

### 6.3 Regression 확인

- 마커(점) 클러스터링 동작 유지 (기존 `marker.addEventListener` 경로)
- 드로잉 모드/댓글 모드 전환 시 이벤트 충돌 없음
- 타임라인 스크롤/줌 중 펼친 상태 유지
- 다중 레이어 필터와의 상호작용

---

## 7. 리스크 및 완화

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| `window` mousemove 리스너 누수 | 중 | `mouseup`/`cleanup`에서 반드시 `removeEventListener`; `init()`에 1회 플래그 |
| 온디맨드 시크가 재생 방해 | 중 | `video.paused === true` 조건에서만 큐 드레인; `pause` 이벤트 훅 |
| 호버 팝업 flicker | 낮 | `mouseover` 300ms 딜레이 + `mouseout` 즉시 타이머 취소 |
| 이벤트 위임 전환이 기존 마커 드래그에 영향 | 중 | `markerTrack`과 `commentTrack`을 분리; 마커 경로는 건드리지 않음 |
| 드래그 중 실시간 동기화 이벤트 수신 | 중 | `isDraggingComment === true`이면 해당 마커 DOM은 건드리지 않음 (다른 마커만 업데이트) |
| 클러스터 split 후 레인 할당 재계산 비용 | 낮 | 분리된 각 그룹에 대해 `assignLanes` 별도 호출; 그룹 크기가 작아 부담 없음 |
| 썸네일 캡처 큐 과다 적재 | 낮 | `Set`으로 중복 방지; 필요 시 상한(예: 100) 적용 |

---

## 8. 롤아웃 계획

1. **단위 테스트 먼저** (`splitClustersByPixelGap` 테스트)
2. **클러스터 로직 + 배지 DOM 구조** 변경 (C, F 해결)
3. **이벤트 위임 엔진** 도입 (A, B, E 해결)
4. **호버 팝업** 구현 (D 해결)
5. **썸네일 정확-프레임** 구현 (G 해결)
6. **수동 QA + DEVLOG 업데이트**
7. 커밋 후 PR 생성

각 단계 완료 시 `npm run lint` 및 관련 테스트 실행.

---

## 9. 참고

- PR #112: [feat: 구간 코멘트 중첩 시 하이브리드 펼침 UI (Mode C)](https://github.com/baehandoridori/BAEFRAME/pull/112)
- 기존 설계: `docs/superpowers/specs/2026-03-23-comment-ux-improvements-design.md`
- 관련 모듈: `renderer/scripts/modules/comment-cluster.js`, `renderer/scripts/modules/timeline.js`
