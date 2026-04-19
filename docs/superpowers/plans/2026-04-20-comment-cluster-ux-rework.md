# 코멘트 클러스터 UX 재작업 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR #112에서 도입된 Mode C 하이브리드 펼침 UI의 후속 개선 — 이벤트 위임 기반 상호작용 엔진, 픽셀 기반 클러스터 해제, 배지/접기/호버 팝업 재설계, 댓글 썸네일 정확-프레임 캡처.

**Architecture:** 기존 `.comment-range-item` 개별 리스너 방식을 `commentTrack` 컨테이너 1개에 위임하는 구조로 전환. 순수 함수 `splitClustersByPixelGap`을 기존 `findRangeClusters` 파이프라인에 추가. 썸네일은 EventTarget `exactCaptured` 이벤트로 진적 갱신.

**Tech Stack:** Electron + vanilla JS ES modules, node-tap(`npm run test:*`), ESLint, Prettier.

**Spec reference:** `docs/superpowers/specs/2026-04-20-comment-cluster-ux-rework-design.md`

---

## 파일 구조

| 파일 | 변경 유형 | 책임 |
|------|----------|------|
| `renderer/scripts/modules/comment-cluster.js` | 추가 | 클러스터링 순수 함수 모음 — `splitClustersByPixelGap` 추가 |
| `scripts/tests/comment-cluster.test.js` | 추가 | 클러스터링 순수 함수 단위 테스트 |
| `renderer/scripts/modules/timeline.js` | 개편 | 이벤트 위임 엔진, 드래그 엔진, split 호출, DOM 구조 변경 |
| `renderer/scripts/app.js` | 삭제+수정 | `setupCommentRangeInteractions` 삭제, 썸네일 호출부 수정, `exactCaptured` 리스너 |
| `renderer/scripts/modules/thumbnail-generator.js` | 추가 | 온디맨드 정확-프레임 API |
| `renderer/styles/main.css` | 개편 | stack-hint 제거, label/close-badge/tooltip 추가 |
| `DEVLOG/2026-04-20-코멘트-클러스터-UX-재작업.md` | 신규 | 작업 로그 + QA 체크리스트 |

---

## Chunk 1: Phase 1 — 클러스터 split 로직 (TDD)

### Task 1.1: `splitClustersByPixelGap` 실패 테스트 작성

**Files:**
- Modify: `scripts/tests/comment-cluster.test.js`

- [ ] **Step 1: 기존 테스트 파일 확인**

Run: `cat scripts/tests/comment-cluster.test.js | head -30`
Expected: 기존 `findRangeClusters`, `assignLanes`, `clusterKey` 테스트 확인

- [ ] **Step 2: `splitClustersByPixelGap` import 및 기본 케이스 테스트 추가**

파일 상단 import:
```js
import { splitClustersByPixelGap } from '../../renderer/scripts/modules/comment-cluster.js';
```

파일 하단 새 describe 블록:
```js
describe('splitClustersByPixelGap', () => {
  test('빈 배열 입력 → 빈 배열 반환', () => {
    const result = splitClustersByPixelGap([], { pxPerFrame: 1, minGapPx: 8 });
    expect(result).toEqual([]);
  });

  test('단일 멤버 클러스터는 그대로 통과', () => {
    const c = [{ markerId: 'a', startFrame: 0, endFrame: 10 }];
    const result = splitClustersByPixelGap([c], { pxPerFrame: 1 });
    expect(result).toEqual([c]);
  });

  test('모든 gap이 minGapPx 미만 → 원본 클러스터 그대로', () => {
    const cluster = [
      { markerId: 'a', startFrame: 0,  endFrame: 10 },
      { markerId: 'b', startFrame: 12, endFrame: 20 }, // gap=2 frames * 1px = 2px < 8px
    ];
    const result = splitClustersByPixelGap([cluster], { pxPerFrame: 1, minGapPx: 8 });
    expect(result.length).toBe(1);
    expect(result[0]).toEqual(cluster);
  });

  test('한 지점만 gap ≥ minGapPx → 2개로 분리', () => {
    const cluster = [
      { markerId: 'a', startFrame: 0,  endFrame: 10 },
      { markerId: 'b', startFrame: 20, endFrame: 30 }, // gap=10 frames * 1px = 10px ≥ 8px
    ];
    const result = splitClustersByPixelGap([cluster], { pxPerFrame: 1, minGapPx: 8 });
    expect(result.length).toBe(2);
    expect(result[0]).toEqual([cluster[0]]);
    expect(result[1]).toEqual([cluster[1]]);
  });

  test('여러 gap ≥ minGapPx → N+1개로 분리', () => {
    const cluster = [
      { markerId: 'a', startFrame: 0,  endFrame: 5  },
      { markerId: 'b', startFrame: 15, endFrame: 20 }, // gap=10
      { markerId: 'c', startFrame: 30, endFrame: 35 }, // gap=10
    ];
    const result = splitClustersByPixelGap([cluster], { pxPerFrame: 1, minGapPx: 8 });
    expect(result.length).toBe(3);
  });

  test('pxPerFrame = 0 → 원본 그대로 (안전 가드)', () => {
    const cluster = [
      { markerId: 'a', startFrame: 0,  endFrame: 10 },
      { markerId: 'b', startFrame: 100, endFrame: 110 },
    ];
    const result = splitClustersByPixelGap([cluster], { pxPerFrame: 0, minGapPx: 8 });
    expect(result.length).toBe(1);
    expect(result[0]).toEqual(cluster);
  });

  test('pxPerFrame 음수 → 원본 그대로', () => {
    const cluster = [
      { markerId: 'a', startFrame: 0,  endFrame: 10 },
      { markerId: 'b', startFrame: 100, endFrame: 110 },
    ];
    const result = splitClustersByPixelGap([cluster], { pxPerFrame: -1, minGapPx: 8 });
    expect(result).toEqual([cluster]);
  });

  test('minGapPx 옵션 생략 → 기본 8px 적용', () => {
    const cluster = [
      { markerId: 'a', startFrame: 0,  endFrame: 10 },
      { markerId: 'b', startFrame: 20, endFrame: 30 }, // gap=10px ≥ 8px
    ];
    const result = splitClustersByPixelGap([cluster], { pxPerFrame: 1 });
    expect(result.length).toBe(2);
  });

  test('정렬되지 않은 멤버도 처리', () => {
    const cluster = [
      { markerId: 'b', startFrame: 20, endFrame: 30 },
      { markerId: 'a', startFrame: 0,  endFrame: 10 },
    ];
    const result = splitClustersByPixelGap([cluster], { pxPerFrame: 1, minGapPx: 8 });
    expect(result.length).toBe(2);
    expect(result[0][0].markerId).toBe('a');
    expect(result[1][0].markerId).toBe('b');
  });
});
```

### Task 1.2: 테스트 실행하여 실패 확인

- [ ] **Step 1: 테스트 실행**

Run: `npm test -- --grep "splitClustersByPixelGap"` 또는 `npm run test`
Expected: FAIL — `splitClustersByPixelGap is not defined` 또는 import 에러

### Task 1.3: `splitClustersByPixelGap` 함수 구현

**Files:**
- Modify: `renderer/scripts/modules/comment-cluster.js`

- [ ] **Step 1: 파일 끝에 함수 추가**

```js
/**
 * 클러스터 내부에서 이웃 간 픽셀 거리가 minGapPx 이상이면 분리한다.
 * 줌에 따라 pxPerFrame이 커지면 같은 클러스터가 자연스럽게 분리된다.
 *
 * @param {Array<Array<Comment>>} clusters - findRangeClusters의 반환값
 * @param {{pxPerFrame: number, minGapPx?: number}} opts
 * @returns {Array<Array<Comment>>} 분리된 클러스터 배열 (단일 멤버도 포함 가능)
 */
export function splitClustersByPixelGap(clusters, { pxPerFrame, minGapPx = 8 } = {}) {
  if (!pxPerFrame || pxPerFrame <= 0) return clusters;
  const result = [];
  for (const cluster of clusters) {
    if (!cluster || cluster.length < 2) {
      result.push(cluster);
      continue;
    }
    const sorted = [...cluster].sort((a, b) => a.startFrame - b.startFrame);
    let current = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const gapFrames = curr.startFrame - prev.endFrame;
      const gapPx = gapFrames * pxPerFrame;
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

### Task 1.4: 테스트 통과 확인

- [ ] **Step 1: 테스트 재실행**

Run: `npm test`
Expected: PASS — 신규 9개 케이스 모두 통과

### Task 1.5: 커밋

- [ ] **Step 1: 변경 확인**

Run: `git status`
Expected: `renderer/scripts/modules/comment-cluster.js` + `scripts/tests/comment-cluster.test.js` 수정 표시

- [ ] **Step 2: 커밋**

```bash
git add renderer/scripts/modules/comment-cluster.js scripts/tests/comment-cluster.test.js
git commit -m "feat: 픽셀 간격 기반 클러스터 분리 순수 함수 추가

splitClustersByPixelGap(clusters, {pxPerFrame, minGapPx=8})
- 줌에 따라 pxPerFrame이 커지면 같은 프레임 클러스터를 자연스럽게 분리
- 단위 테스트 9건 추가 (엣지 케이스 포함)"
```

---

## Chunk 2: Phase 2 — 배지/접기/툴팁 CSS + DOM

### Task 2.1: 기존 stack-hint 스타일 제거 및 label 추가

**Files:**
- Modify: `renderer/styles/main.css` (라인 ~3041-3062)

- [ ] **Step 1: 기존 스타일 확인**

Read `renderer/styles/main.css:3040-3065`로 기존 `.comment-cluster-stack-hint`, `.comment-cluster-count` 규칙 파악.

- [ ] **Step 2: `.comment-cluster-stack-hint` 블록 삭제**

- [ ] **Step 3: `.comment-cluster-count` 블록을 `.comment-cluster-badge-label`로 교체**

```css
.comment-cluster-badge-label {
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  font-variant-numeric: tabular-nums;
  user-select: none;
  pointer-events: none;
}
```

- [ ] **Step 4: `.comment-cluster-badge` 자체 강화 (음영 강화)**

기존 `.comment-cluster-badge` 블록의 `box-shadow`를 살짝 강화:
```css
box-shadow: 0 2px 6px rgba(245, 158, 11, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
```

### Task 2.2: 접기 배지 (close-badge) 스타일 추가

**Files:**
- Modify: `renderer/styles/main.css` (기존 `.comment-collapse-chip` 블록 근처)

- [ ] **Step 1: 기존 `.comment-collapse-chip` 블록 삭제**

- [ ] **Step 2: `.comment-cluster-close-badge` 블록 추가**

```css
.comment-cluster-close-badge {
  position: absolute;
  top: -22px;
  right: 0;
  height: 20px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(245, 158, 11, 0.5);
  cursor: pointer;
  z-index: 25;
  user-select: none;
  transition: filter 0.15s ease, transform 0.15s ease;
}
.comment-cluster-close-badge:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
}
.comment-cluster-close-badge::before {
  content: '×';
  font-size: 14px;
  line-height: 1;
}
```

### Task 2.3: 호버 툴팁 스타일 추가

**Files:**
- Modify: `renderer/styles/main.css` (파일 끝 또는 comment-cluster 근처)

- [ ] **Step 1: 툴팁 스타일 블록 추가**

```css
.comment-cluster-tooltip {
  position: fixed;
  z-index: 10000;
  max-width: 360px;
  min-width: 200px;
  padding: 8px 0;
  background: rgba(30, 30, 30, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  color: #e0e0e0;
  font-size: 12px;
  line-height: 1.4;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.comment-cluster-tooltip.visible {
  opacity: 1;
}
.comment-cluster-tooltip .tooltip-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  white-space: nowrap;
  overflow: hidden;
}
.comment-cluster-tooltip .tooltip-row + .tooltip-row {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.comment-cluster-tooltip .tooltip-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.comment-cluster-tooltip .tooltip-author {
  font-weight: 600;
  color: #ffffff;
  flex-shrink: 0;
}
.comment-cluster-tooltip .tooltip-range {
  color: #888;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.comment-cluster-tooltip .tooltip-text {
  color: #bbb;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
```

### Task 2.4: 커밋

- [ ] **Step 1: 커밋**

```bash
git add renderer/styles/main.css
git commit -m "style: 코멘트 클러스터 배지/접기/툴팁 CSS 재설계

- comment-cluster-stack-hint(세로 3색 스트라이프) 제거
- comment-cluster-badge-label: '+N' 텍스트 강조 스타일
- comment-cluster-close-badge: 펼친 클러스터 오른쪽 상단 고정 배지형 접기
- comment-cluster-tooltip: 접힌 배지 호버용 세로 리스트 팝업"
```

---

## Chunk 3: Phase 3 — DOM 구조 변경 + split 호출

### Task 3.1: `_createClusterBadgeElement` DOM 구조 변경

**Files:**
- Modify: `renderer/scripts/modules/timeline.js` (라인 ~2065-2109)

- [ ] **Step 1: 기존 함수 Read로 확인**

- [ ] **Step 2: 함수 내부의 `.comment-cluster-stack-hint` DOM 생성 제거**

- [ ] **Step 3: `.comment-cluster-count` → `.comment-cluster-badge-label`로 변경, 내용을 `+${count}`로**

구체 예시 (기존 구조에 맞춰 Edit):
```js
// 기존: 스택 힌트 3개 stripe DOM 생성 블록 제거

const label = document.createElement('span');
label.className = 'comment-cluster-badge-label';
label.textContent = `+${cluster.length}`;
badge.appendChild(label);
```

- [ ] **Step 4: 기존에 달려 있던 `badge.addEventListener('click', ...)` 제거**

위임 핸들러가 담당하므로 제거. `badge.dataset.clusterKey = clusterKey(cluster)`는 **반드시 유지**.

### Task 3.2: `_createCollapseChip` → `_createClusterCloseBadge` 리네임 및 구조 변경

**Files:**
- Modify: `renderer/scripts/modules/timeline.js` (라인 ~2114-2133)

- [ ] **Step 1: 함수 이름 `_createCollapseChip` → `_createClusterCloseBadge`**

- [ ] **Step 2: 반환 DOM 클래스명 `.comment-collapse-chip` → `.comment-cluster-close-badge`**

```js
_createClusterCloseBadge() {
  const el = document.createElement('div');
  el.className = 'comment-cluster-close-badge';
  el.textContent = '접기';
  return el;
}
```

- [ ] **Step 3: 기존 `addEventListener('click', ...)` 제거**

- [ ] **Step 4: 호출부 검색 후 리네임 반영**

Grep `_createCollapseChip` → 호출부를 `_createClusterCloseBadge`로 교체.

### Task 3.3: `renderCommentRanges`에 split 적용 + 검증 순서 이동

**Files:**
- Modify: `renderer/scripts/modules/timeline.js` (라인 ~1945-1968)

- [ ] **Step 1: 파일 상단 import에 `splitClustersByPixelGap` 추가**

```js
import { findRangeClusters, assignLanes, clusterKey, splitClustersByPixelGap } from './comment-cluster.js';
```

- [ ] **Step 2: `renderCommentRanges` 내 클러스터링 흐름 수정**

```js
// 1) 프레임 기반 클러스터링
const rawClusters = findRangeClusters(comments);

// 1b) 픽셀 기반 split (줌 반응형)
const trackRect = this.commentTrack.getBoundingClientRect();
const pxPerFrame = this.totalFrames > 0 ? trackRect.width / this.totalFrames : 0;
const clusters = splitClustersByPixelGap(rawClusters, { pxPerFrame, minGapPx: 8 });

// 2) 펼침 유효성 검증 — 반드시 split 후!
if (this.expandedClusterId !== null) {
  const stillExists = clusters.some(c =>
    clusterKey(c) === this.expandedClusterId && c.length > 1
  );
  if (!stillExists) {
    this.expandedClusterId = null;
  }
}
// ... 이하 기존 로직 유지 (maxLanes 계산, 렌더)
```

### Task 3.4: 수동 동작 확인

- [ ] **Step 1: 앱 실행**

Run: `npm run dev`
Expected: 앱 정상 실행, 에러 없음

- [ ] **Step 2: 배지 시각 확인**

- 겹친 코멘트 2개 이상 만들기 → `+N` 텍스트 배지가 주황 그라디언트로 표시, 세로줄 없음
- 펼쳤을 때 오른쪽 상단에 "× 접기" 배지 명확히 표시

- [ ] **Step 3: 줌 변경 확인**

- 겹친 코멘트 상태에서 타임라인 줌인 → 일정 줌 이후 클러스터 해제되어 개별 코멘트로 전환

### Task 3.5: 커밋

```bash
git add renderer/scripts/modules/timeline.js
git commit -m "feat: 클러스터 DOM 구조 변경 + 픽셀 기반 split 적용

- _createClusterBadgeElement: 세로 stripe 제거, '+N' 텍스트 라벨
- _createCollapseChip → _createClusterCloseBadge 리네임 + 배지 구조
- renderCommentRanges: splitClustersByPixelGap 파이프라인 통합
- 펼침 유효성 검증을 split 결과 기준으로 수행"
```

---

## Chunk 4: Phase 4 — 이벤트 위임 엔진 + 드래그 복구

### Task 4.1: 상태 필드 추가

**Files:**
- Modify: `renderer/scripts/modules/timeline.js` (constructor)

- [ ] **Step 1: `constructor` 내 기존 `expandedClusterId` 아래에 필드 추가**

```js
this.isDraggingComment = false;
this.dragContext = null;
this.justDragged = false;
this.clusterTooltipTimer = null;
this.clusterTooltipEl = null;
this._delegationBound = false;
```

### Task 4.2: `setCommentTrack` 기존 click 리스너 제거 + 위임 바인딩 호출

**Files:**
- Modify: `renderer/scripts/modules/timeline.js` (라인 ~1900-1912)

- [ ] **Step 1: 기존 `setCommentTrack` 내 `click` addEventListener 블록 삭제**

- [ ] **Step 2: `setCommentTrack` 끝에 위임 바인딩 호출 추가**

```js
setCommentTrack(trackElement, layerHeaderElement = null) {
  this.commentTrack = trackElement;
  this.commentLayerHeader = layerHeaderElement;
  this._bindCommentTrackDelegation();
}
```

### Task 4.3: 위임 핸들러 메서드 추가

**Files:**
- Modify: `renderer/scripts/modules/timeline.js` (클래스 내부 적절한 위치, 예: `setCommentTrack` 다음)

- [ ] **Step 1: `_bindCommentTrackDelegation` 메서드 추가**

```js
_bindCommentTrackDelegation() {
  if (this._delegationBound || !this.commentTrack) return;
  this._delegationBound = true;

  this.commentTrack.addEventListener('mousedown', (e) => this._onCommentTrackMousedown(e));
  this.commentTrack.addEventListener('click',     (e) => this._onCommentTrackClick(e));
  this.commentTrack.addEventListener('mouseover', (e) => this._onCommentTrackMouseover(e));
  this.commentTrack.addEventListener('mouseout',  (e) => this._onCommentTrackMouseout(e));
}
```

- [ ] **Step 2: `_onCommentTrackMousedown` 라우팅 추가**

```js
_onCommentTrackMousedown(e) {
  if (e.button !== 0) return;

  const handle     = e.target.closest('.comment-handle');
  const rangeItem  = e.target.closest('.comment-range-item');
  const closeBadge = e.target.closest('.comment-cluster-close-badge');
  const badge      = e.target.closest('.comment-cluster-badge');

  if (handle && rangeItem) {
    this._startResizeDrag(rangeItem, handle.dataset.handle, e);
  } else if (rangeItem) {
    this._startMoveDrag(rangeItem, e);
  } else if (closeBadge) {
    this.expandedClusterId = null;
    this.renderCommentRanges(this._lastComments || []);
  } else if (badge) {
    const key = badge.dataset.clusterKey;
    this.expandedClusterId = (this.expandedClusterId === key) ? null : key;
    this.renderCommentRanges(this._lastComments || []);
  }
}
```

- [ ] **Step 3: `_onCommentTrackClick` (닫힘 가드)**

```js
_onCommentTrackClick(e) {
  if (this.isDraggingComment || this.justDragged) {
    this.justDragged = false;
    return;
  }
  // 트랙 배경 클릭 (다른 요소 위가 아님)
  if (e.target === this.commentTrack && this.expandedClusterId !== null) {
    this.expandedClusterId = null;
    this.renderCommentRanges(this._lastComments || []);
  }
}
```

### Task 4.4: 드래그 엔진 구현

**Files:**
- Modify: `renderer/scripts/modules/timeline.js`

- [ ] **Step 1: `_pxToFrameDelta` 헬퍼**

```js
_pxToFrameDelta(dx) {
  const rect = this.commentTrack.getBoundingClientRect();
  if (rect.width <= 0 || !this.totalFrames) return 0;
  return Math.round((dx / rect.width) * this.totalFrames);
}
```

- [ ] **Step 2: `_startMoveDrag` 구현**

```js
_startMoveDrag(element, e) {
  const markerId = element.dataset.markerId;
  const layerId  = element.dataset.layerId;
  if (!markerId) return;

  const marker = this._getMarkerForRange?.(layerId, markerId);
  if (!marker) return;

  this.dragContext = {
    mode: 'move',
    element, markerId, layerId,
    startX: e.clientX,
    origStartFrame: marker.startFrame,
    origEndFrame:   marker.endFrame,
    dx: 0,
    moved: false,
  };
  this.isDraggingComment = true;

  this._attachDragWindowListeners();
  e.preventDefault();
}
```

- [ ] **Step 3: `_startResizeDrag` 구현**

```js
_startResizeDrag(element, side, e) {
  const markerId = element.dataset.markerId;
  const layerId  = element.dataset.layerId;
  if (!markerId || (side !== 'left' && side !== 'right')) return;

  const marker = this._getMarkerForRange?.(layerId, markerId);
  if (!marker) return;

  this.dragContext = {
    mode: side === 'left' ? 'resize-left' : 'resize-right',
    element, markerId, layerId,
    startX: e.clientX,
    origStartFrame: marker.startFrame,
    origEndFrame:   marker.endFrame,
    dx: 0,
    moved: false,
  };
  this.isDraggingComment = true;

  this._attachDragWindowListeners();
  e.preventDefault();
  e.stopPropagation();
}
```

- [ ] **Step 4: `_attachDragWindowListeners` + `_onDragMove` + `_onDragEnd`**

```js
_attachDragWindowListeners() {
  this._onDragMoveBound = (ev) => this._onDragMove(ev);
  this._onDragEndBound  = (ev) => this._onDragEnd(ev);
  window.addEventListener('mousemove', this._onDragMoveBound);
  window.addEventListener('mouseup',   this._onDragEndBound);
}

_detachDragWindowListeners() {
  if (this._onDragMoveBound) window.removeEventListener('mousemove', this._onDragMoveBound);
  if (this._onDragEndBound)  window.removeEventListener('mouseup',   this._onDragEndBound);
  this._onDragMoveBound = null;
  this._onDragEndBound  = null;
}

_onDragMove(e) {
  if (!this.dragContext) return;
  const ctx = this.dragContext;
  const dx = e.clientX - ctx.startX;
  ctx.dx = dx;
  if (Math.abs(dx) >= 3) ctx.moved = true;

  const deltaFrames = this._pxToFrameDelta(dx);
  let newStart = ctx.origStartFrame;
  let newEnd   = ctx.origEndFrame;
  const total  = this.totalFrames;

  if (ctx.mode === 'move') {
    let d = deltaFrames;
    if (ctx.origStartFrame + d < 0) d = -ctx.origStartFrame;
    if (ctx.origEndFrame   + d > total) d = total - ctx.origEndFrame;
    newStart = ctx.origStartFrame + d;
    newEnd   = ctx.origEndFrame   + d;
  } else if (ctx.mode === 'resize-left') {
    newStart = Math.max(0, Math.min(ctx.origEndFrame - 1, ctx.origStartFrame + deltaFrames));
  } else if (ctx.mode === 'resize-right') {
    newEnd = Math.min(total, Math.max(ctx.origStartFrame + 1, ctx.origEndFrame + deltaFrames));
  }

  // DOM 직접 업데이트 (재렌더 금지)
  const leftPercent  = (newStart / total) * 100;
  const widthPercent = ((newEnd - newStart) / total) * 100;
  ctx.element.style.left  = `${leftPercent}%`;
  ctx.element.style.width = `${Math.max(widthPercent, 0.5)}%`;
}

_onDragEnd(e) {
  const ctx = this.dragContext;
  this._detachDragWindowListeners();
  this.isDraggingComment = false;
  this.dragContext = null;

  if (!ctx) return;

  if (!ctx.moved) {
    // 단순 클릭 — 데이터 변경 없음
    this.justDragged = false;
    return;
  }

  this.justDragged = true;
  setTimeout(() => { this.justDragged = false; }, 50);

  const deltaFrames = this._pxToFrameDelta(ctx.dx);
  const total = this.totalFrames;
  let newStart = ctx.origStartFrame;
  let newEnd   = ctx.origEndFrame;

  if (ctx.mode === 'move') {
    let d = deltaFrames;
    if (ctx.origStartFrame + d < 0) d = -ctx.origStartFrame;
    if (ctx.origEndFrame   + d > total) d = total - ctx.origEndFrame;
    newStart = ctx.origStartFrame + d;
    newEnd   = ctx.origEndFrame   + d;
  } else if (ctx.mode === 'resize-left') {
    newStart = Math.max(0, Math.min(ctx.origEndFrame - 1, ctx.origStartFrame + deltaFrames));
  } else if (ctx.mode === 'resize-right') {
    newEnd = Math.min(total, Math.max(ctx.origStartFrame + 1, ctx.origEndFrame + deltaFrames));
  }

  if (newStart === ctx.origStartFrame && newEnd === ctx.origEndFrame) return;

  // 외부 콜백으로 데이터 커밋 (timeline은 commentManager 직접 접근 금지)
  if (typeof this.onCommentRangeUpdate === 'function') {
    this.onCommentRangeUpdate({
      layerId: ctx.layerId,
      markerId: ctx.markerId,
      startFrame: newStart,
      endFrame: newEnd,
    });
  }
}
```

### Task 4.5: `timeline.js`에 `onCommentRangeUpdate` / `_getMarkerForRange` 훅 정의

- [ ] **Step 1: constructor 또는 초기화 지점에 기본값 설정**

```js
this.onCommentRangeUpdate = null;  // 외부에서 주입
this._getMarkerForRange = null;     // 외부에서 주입 (layerId, markerId) => marker
```

- [ ] **Step 2: setter 메서드 추가**

```js
setCommentRangeCallbacks({ onUpdate, getMarker }) {
  if (typeof onUpdate   === 'function') this.onCommentRangeUpdate = onUpdate;
  if (typeof getMarker  === 'function') this._getMarkerForRange   = getMarker;
}
```

### Task 4.6: `app.js`에서 콜백 주입 + 기존 `setupCommentRangeInteractions` 삭제

**Files:**
- Modify: `renderer/scripts/app.js` (라인 ~3095-3200)

- [ ] **Step 1: 기존 `setupCommentRangeInteractions` 함수 전체 삭제**

- [ ] **Step 2: 이 함수의 모든 호출부 삭제**

Grep `setupCommentRangeInteractions` → 발견되는 모든 호출 제거.

- [ ] **Step 3: timeline에 콜백 주입 코드 추가** (앱 초기화 지점)

```js
timeline.setCommentRangeCallbacks({
  onUpdate: ({ layerId, markerId, startFrame, endFrame }) => {
    const marker = commentManager.getMarker(markerId);
    if (!marker) return;
    commentManager.updateMarker(markerId, { startFrame, endFrame });
  },
  getMarker: (layerId, markerId) => commentManager.getMarker(markerId),
});
```

적절한 위치는 `commentManager`가 초기화되고 `timeline`도 준비된 이후 — 기존 `setupCommentRangeInteractions` 호출 지점 근처.

### Task 4.7: 수동 QA

- [ ] **Step 1: 앱 실행**

Run: `npm run dev`
Expected: 정상 실행

- [ ] **Step 2: 드래그/리사이즈 동작 확인**

- 단일 코멘트 바 중앙 드래그 → 위치 이동 OK
- 좌/우 핸들 드래그 → 크기 변경 OK
- 3px 미만 클릭 → 데이터 변경 없음, 단순 클릭 동작만

- [ ] **Step 3: 클러스터 펼친 상태 편집 확인 (핵심 regression)**

- 겹친 코멘트 펼침 → 내부 개별 바 드래그 → 펼친 상태 **유지되며** 위치 이동
- 핸들 드래그 → 크기 변경, 펼친 상태 유지
- 접기 배지 클릭 → 정상 접힘
- 빈 영역 클릭 → 접힘

### Task 4.8: 커밋

```bash
git add renderer/scripts/modules/timeline.js renderer/scripts/app.js
git commit -m "refactor: 코멘트 상호작용을 이벤트 위임으로 전환 + 드래그 편집 regression 수정

- setupCommentRangeInteractions 삭제, commentTrack 1곳에 위임 리스너
- _bindCommentTrackDelegation: mousedown/click/mouseover/mouseout 라우팅
- _startMoveDrag/_startResizeDrag/_onDragMove/_onDragEnd 드래그 엔진
- 드래그 중 재렌더 억제 (DOM 직접 스타일 업데이트)
- 3px 미만 이동은 클릭, 이상이면 드래그 커밋 (justDragged 가드)
- setCommentRangeCallbacks: timeline ↔ commentManager 경계 유지"
```

---

## Chunk 5: Phase 5 — 호버 툴팁

### Task 5.1: 툴팁 DOM 재사용 인스턴스 생성

**Files:**
- Modify: `renderer/scripts/modules/timeline.js`

- [ ] **Step 1: `_ensureClusterTooltip` 헬퍼 추가**

```js
_ensureClusterTooltip() {
  if (this.clusterTooltipEl) return this.clusterTooltipEl;
  const el = document.createElement('div');
  el.className = 'comment-cluster-tooltip';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  this.clusterTooltipEl = el;
  return el;
}
```

### Task 5.2: 호버 이벤트 핸들러

**Files:**
- Modify: `renderer/scripts/modules/timeline.js`

- [ ] **Step 1: `_onCommentTrackMouseover` / `_onCommentTrackMouseout`**

```js
_onCommentTrackMouseover(e) {
  const badge = e.target.closest('.comment-cluster-badge');
  if (!badge) return;
  // 펼친 상태 배지에는 툴팁 띄우지 않음 (이미 펼쳐져 있으면 개별 코멘트가 보이므로)
  if (this.expandedClusterId !== null) return;

  this._cancelClusterTooltip();
  this.clusterTooltipTimer = setTimeout(() => {
    this._showClusterTooltip(badge);
  }, 300);
}

_onCommentTrackMouseout(e) {
  const badge = e.target.closest('.comment-cluster-badge');
  if (!badge) return;
  this._cancelClusterTooltip();
  this._hideClusterTooltip();
}

_cancelClusterTooltip() {
  if (this.clusterTooltipTimer) {
    clearTimeout(this.clusterTooltipTimer);
    this.clusterTooltipTimer = null;
  }
}

_hideClusterTooltip() {
  if (this.clusterTooltipEl) {
    this.clusterTooltipEl.classList.remove('visible');
  }
}
```

### Task 5.3: 툴팁 표시 구현

**Files:**
- Modify: `renderer/scripts/modules/timeline.js`

- [ ] **Step 1: `_showClusterTooltip` 구현**

```js
_showClusterTooltip(badge) {
  const clusterKey = badge.dataset.clusterKey;
  if (!clusterKey) return;

  // clusterKey로 해당 cluster의 코멘트들 복구
  const comments = this._findClusterCommentsByKey(clusterKey);
  if (!comments || comments.length === 0) return;

  const tooltip = this._ensureClusterTooltip();
  tooltip.innerHTML = '';
  comments.forEach(c => {
    const row = document.createElement('div');
    row.className = 'tooltip-row';
    row.innerHTML = `
      <span class="tooltip-color-dot" style="background:${c.color || '#4a9eff'}"></span>
      <span class="tooltip-author">${this._escape(c.author || '익명')}</span>
      <span class="tooltip-range">${c.startFrame}–${c.endFrame}</span>
      <span class="tooltip-text">${this._escape((c.text || '').split('\n')[0].slice(0, 80))}</span>
    `;
    tooltip.appendChild(row);
  });

  // 위치 계산 (top placement 우선, 상단 근처면 bottom으로)
  const badgeRect = badge.getBoundingClientRect();
  tooltip.classList.add('visible');  // 측정 위해 먼저 visible
  const tooltipRect = tooltip.getBoundingClientRect();

  let top = badgeRect.top - tooltipRect.height - 8;
  if (top < 10) top = badgeRect.bottom + 8;
  let left = badgeRect.left + (badgeRect.width / 2) - (tooltipRect.width / 2);
  left = Math.max(8, Math.min(window.innerWidth - tooltipRect.width - 8, left));

  tooltip.style.top  = `${top}px`;
  tooltip.style.left = `${left}px`;
}

_findClusterCommentsByKey(key) {
  if (!this._lastComments) return [];
  const rawClusters = findRangeClusters(this._lastComments);
  const trackRect = this.commentTrack.getBoundingClientRect();
  const pxPerFrame = this.totalFrames > 0 ? trackRect.width / this.totalFrames : 0;
  const clusters = splitClustersByPixelGap(rawClusters, { pxPerFrame, minGapPx: 8 });
  return clusters.find(c => clusterKey(c) === key) || [];
}

_escape(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
```

### Task 5.4: 수동 QA

- [ ] **Step 1: 앱 실행**

- [ ] **Step 2: 접힌 클러스터 배지에 마우스 호버 → 300ms 후 세로 리스트 팝업 표시**

- [ ] **Step 3: 마우스 벗어나면 즉시 숨김**

- [ ] **Step 4: 배지 클릭 후 펼친 상태 → 호버해도 팝업 안 뜸**

- [ ] **Step 5: 뷰포트 상단 근처 배지 → 아래쪽에 팝업 표시**

### Task 5.5: 커밋

```bash
git add renderer/scripts/modules/timeline.js
git commit -m "feat: 접힌 클러스터 배지 호버 팝업 (세로 리스트)

- 300ms 딜레이 후 표시, 마우스 벗어나면 즉시 숨김
- 각 코멘트: 색 점 · 작성자 · 프레임 범위 · 본문 1줄 (80자 제한)
- 위치: 배지 위쪽 우선, 상단 근처면 아래로 폴백
- 펼친 상태에서는 팝업 비활성화 (개별 코멘트 표시로 충분)"
```

---

## Chunk 6: Phase 6 — 썸네일 정확-프레임

### Task 6.1: `thumbnail-generator.js`에 API 추가

**Files:**
- Modify: `renderer/scripts/modules/thumbnail-generator.js`

- [ ] **Step 1: constructor 말미에 큐 상태 초기화**

```js
this._exactQueue = new Set();
this._exactDraining = false;
this._exactAborted = false;
```

- [ ] **Step 2: `getThumbnailUrlAtExact` 추가 (클래스 내 적절한 위치, `getThumbnailUrlAt` 근처)**

```js
getThumbnailUrlAtExact(time) {
  const rounded = Math.round(time * 10) / 10;
  return this.thumbnailMap.get(rounded) || null;
}
```

- [ ] **Step 3: `requestExactCapture` 추가**

```js
requestExactCapture(time) {
  if (typeof time !== 'number' || !isFinite(time) || time < 0) return;
  const rounded = Math.round(time * 10) / 10;
  if (this.thumbnailMap.has(rounded)) return;
  if (this._exactQueue.has(rounded)) return;
  this._exactQueue.add(rounded);
  this._drainExactQueue();
}
```

- [ ] **Step 4: `_drainExactQueue` 추가**

```js
async _drainExactQueue() {
  if (this._exactDraining) return;
  if (!this.videoSrc) return;
  this._exactDraining = true;
  this._exactAborted = false;

  const needsVideo = !this.video;
  try {
    if (needsVideo) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.preload = 'auto';
      await this._loadVideo(this.videoSrc);
    }

    while (this._exactQueue.size > 0) {
      if (this._exactAborted) break;
      const t = this._exactQueue.values().next().value;
      this._exactQueue.delete(t);
      try {
        await this._seekAndCapture(t);
        const dataUrl = this.thumbnailMap.get(t);
        if (dataUrl) this._emit('exactCaptured', { time: t, dataUrl });
      } catch (err) {
        log.warn('온디맨드 캡처 실패', { time: t, error: err?.message });
      }
    }
  } finally {
    if (needsVideo) {
      this._cleanupVideo();
      try { await this._saveToCache(); } catch (_) { /* ignore */ }
    }
    this._exactDraining = false;
    this._exactAborted = false;
  }
}

_abortExactDrain() {
  this._exactAborted = true;
}
```

### Task 6.2: `app.js` 댓글 렌더 수정

**Files:**
- Modify: `renderer/scripts/app.js` (라인 ~5299-5303)

- [ ] **Step 1: 기존 썸네일 URL 획득 부분 교체**

```js
const markerTime = marker.startFrame / videoPlayer.fps;
let thumbnailUrl = null;
if (showThumbnails && thumbnailGenerator?.isReady) {
  thumbnailUrl = thumbnailGenerator.getThumbnailUrlAtExact(markerTime);
  if (!thumbnailUrl) {
    thumbnailGenerator.requestExactCapture(markerTime);
    thumbnailUrl = thumbnailGenerator.getThumbnailUrlAt(markerTime);
  }
}
```

### Task 6.3: `exactCaptured` 이벤트 리스너 + videoPlayer 훅

**Files:**
- Modify: `renderer/scripts/app.js`

- [ ] **Step 1: thumbnailGenerator 초기화 근처에 리스너 추가**

(Grep `thumbnailGenerator.addEventListener` 또는 `thumbnailGenerator = getThumbnailGenerator` 로 위치 찾기)

```js
thumbnailGenerator.addEventListener('exactCaptured', (e) => {
  const { time, dataUrl } = e.detail || {};
  if (!dataUrl || typeof time !== 'number') return;
  const frame = Math.round(time * (videoPlayer.fps || 24));
  document.querySelectorAll(
    `.comment-item[data-start-frame="${frame}"] .comment-thumbnail`
  ).forEach(img => { img.src = dataUrl; });
});
```

- [ ] **Step 2: videoPlayer 이벤트 API 확인**

Grep `videoPlayer.on\(` 또는 `videoPlayer.addEventListener` 또는 `player.on` — BAEFRAME의 videoPlayer 래퍼 API 파악.

- [ ] **Step 3: pause/play 훅 추가**

API 형태에 맞춰 (예시는 EventTarget 스타일):
```js
// 래퍼가 .on/.off 사용이면:
videoPlayer.on?.('pause', () => thumbnailGenerator._drainExactQueue?.());
videoPlayer.on?.('play',  () => thumbnailGenerator._abortExactDrain?.());

// 혹은 DOM 이벤트면:
videoPlayer.videoElement?.addEventListener('pause', () => thumbnailGenerator._drainExactQueue?.());
videoPlayer.videoElement?.addEventListener('play',  () => thumbnailGenerator._abortExactDrain?.());
```

구체 구문은 실 API에 맞춰 선택.

### Task 6.4: 수동 QA

- [ ] **Step 1: 일시정지 상태에서 댓글 클릭** → 사이드바 썸네일이 근사치 → ≤1초 후 정확 프레임으로 교체

- [ ] **Step 2: 재생 중 댓글 이동** → 근사치 유지, 일시정지 시 정확 프레임으로 교체

- [ ] **Step 3: Phase 2 완료 후** (썸네일 캐시 전부 생성 완료) 새 댓글 달기 → 정확 프레임 캡처 동작

### Task 6.5: 커밋

```bash
git add renderer/scripts/modules/thumbnail-generator.js renderer/scripts/app.js
git commit -m "feat: 댓글 썸네일 온디맨드 정확-프레임 캡처

- getThumbnailUrlAtExact: 정확한 시간 키가 맵에 있을 때만 반환
- requestExactCapture + _drainExactQueue: 큐 기반 비동기 캡처
- Phase 2 후 비디오가 해제된 경우 lazy 재생성
- exactCaptured 이벤트로 img.src만 교체 (진적 갱신)
- videoPlayer pause/play 훅으로 재생 방해 방지"
```

---

## Chunk 7: Phase 7 — Lint · 테스트 · DEVLOG · PR

### Task 7.1: Lint 및 포맷

- [ ] **Step 1: ESLint 실행**

Run: `npm run lint`
Expected: 경고/에러 없음 (있으면 `npm run lint:fix`)

- [ ] **Step 2: Prettier 실행**

Run: `npm run format`
Expected: 포맷 정리됨

### Task 7.2: 단위 테스트 재실행

- [ ] **Step 1: 전체 테스트 실행**

Run: `npm test` 또는 해당 project의 test 커맨드
Expected: 모든 테스트 통과

### Task 7.3: DEVLOG 작성

**Files:**
- Create: `DEVLOG/2026-04-20-코멘트-클러스터-UX-재작업.md`

- [ ] **Step 1: DEVLOG 파일 작성**

```markdown
# 코멘트 클러스터 UX 재작업

## 요약

| 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|------|----------|------|---------|------|
| Phase 1 | comment-cluster.js, test | 픽셀 기반 split 순수 함수 | 높음 | ✅ 완료 |
| Phase 2 | main.css | 배지/접기/툴팁 CSS 재설계 | 높음 | ✅ 완료 |
| Phase 3 | timeline.js | DOM 구조 변경 + split 적용 | 높음 | ✅ 완료 |
| Phase 4 | timeline.js, app.js | 이벤트 위임 + 드래그 복구 | 높음 | ✅ 완료 |
| Phase 5 | timeline.js | 호버 툴팁 | 중간 | ✅ 완료 |
| Phase 6 | thumbnail-generator.js, app.js | 정확-프레임 썸네일 | 중간 | ✅ 완료 |

## 수동 QA 체크리스트

(스펙 문서 6.2의 항목 16가지를 복사)

## 스펙·플랜 참조

- Spec: `docs/superpowers/specs/2026-04-20-comment-cluster-ux-rework-design.md`
- Plan: `docs/superpowers/plans/2026-04-20-comment-cluster-ux-rework.md`
```

### Task 7.4: 통합 QA

QA 체크리스트 16개 항목을 순서대로 실제 앱에서 확인. 실패 항목은 해당 Phase로 돌아가 수정.

### Task 7.5: 최종 커밋 + PR

- [ ] **Step 1: DEVLOG 커밋**

```bash
git add DEVLOG/2026-04-20-코멘트-클러스터-UX-재작업.md
git commit -m "docs: 코멘트 클러스터 UX 재작업 DEVLOG + QA 체크리스트"
```

- [ ] **Step 2: PR 생성**

사용자가 PR 생성 요청 시 `anthropic-skills:pr-creator` 스킬 사용 또는:

```bash
gh pr create --title "feat: 코멘트 클러스터 UX 재작업 — 편집 regression 복구·줌 반응형·썸네일 정확-프레임" --body "$(cat <<'EOF'
## 요약

PR #112로 도입된 Mode C 하이브리드 펼침 UI의 후속 개선입니다.

## 주요 변경

- **편집 regression 복구**: 펼친 클러스터 내부 코멘트의 드래그/리사이즈 편집이 작동하지 않던 문제 수정 (이벤트 위임 전환)
- **줌 반응형 클러스터링**: 타임라인 줌인 시 8px 이상 벌어진 코멘트는 클러스터 해제
- **배지 UI 개선**: 세로 스트라이프 제거, "+N" 텍스트 강조, 접기 배지 오른쪽 상단 고정
- **호버 팝업**: 접힌 클러스터 배지 호버 시 겹친 코멘트들을 세로 리스트로 프리뷰
- **썸네일 정확-프레임**: 사이드바 댓글 썸네일이 `startFrame` 정확 프레임으로 진적 갱신

## 설계·계획 문서

- Spec: [docs/superpowers/specs/2026-04-20-comment-cluster-ux-rework-design.md](docs/superpowers/specs/2026-04-20-comment-cluster-ux-rework-design.md)
- Plan: [docs/superpowers/plans/2026-04-20-comment-cluster-ux-rework.md](docs/superpowers/plans/2026-04-20-comment-cluster-ux-rework.md)
- DEVLOG: [DEVLOG/2026-04-20-코멘트-클러스터-UX-재작업.md](DEVLOG/2026-04-20-코멘트-클러스터-UX-재작업.md)

## Test plan

- [ ] 단위 테스트 통과 (`splitClustersByPixelGap` 9케이스)
- [ ] ESLint/Prettier 통과
- [ ] 수동 QA 16개 항목 (DEVLOG 참조)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 리스크 및 주의사항 요약

| 리스크 | 완화 |
|--------|------|
| `window` 리스너 누수 | `_detachDragWindowListeners` 반드시 호출 |
| 드래그 중 실시간 동기화 충돌 | `isDraggingComment === true`이면 해당 마커 DOM 업데이트 skip (commentManager 이벤트 핸들러에서 가드) |
| 온디맨드 시크가 재생 방해 | videoPlayer pause/play 훅 |
| split로 expandedClusterId 사라짐 | 스펙 4.3.4의 검증 순서 이동이 처리 |

## 롤백 전략

각 Phase는 별도 커밋으로 분리되어 있으므로 `git revert <커밋>`으로 Phase 단위 롤백 가능. 특히 Phase 4 (이벤트 위임) 이슈 발생 시 Phase 4·5 커밋만 revert하고 Phase 1-3은 유지할 수 있다.
