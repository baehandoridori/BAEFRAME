# Fabric 자유 선택 프리셋 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** V 도구에서 획 전체/영역 일부와 사각/라쏘를 독립적으로 선택하고, 사각형으로 고른 획 일부도 안전하게 이동·삭제·Undo/Redo한다.

**Architecture:** overlay runtime의 로컬 선택 상태를 대상과 모양 두 축으로 나눈다. 사각 드래그는 네 점 polygon으로 바꾸고, 기존 라쏘의 검증된 polygon splitter와 pending `split-stroke` transaction을 그대로 재사용한다.

**Tech Stack:** Electron, Fabric.js 7.4, CommonJS, Node test runner, esbuild

## Global Constraints

- 선택 대상과 모양은 리뷰 파일과 IPC에 저장하지 않는다.
- 부분 선택 pointerup은 scene, history, dirty, save attempt를 바꾸지 않는다.
- 실제 이동 또는 Delete에서만 원자적 `split-stroke` 한 번을 기록한다.
- 기존 B/Space/mpv/타임라인/리뷰 저장 계약을 바꾸지 않는다.
- 기존 HTML 픽셀 자유 선택 코드는 재사용하지 않는다.

---

### Task 1: 선택 설정 UI와 전환 계약

**Files:**
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Test: `scripts/tests/mpv-fabric-overlay-runtime.test.js`

**Interfaces:**
- Consumes: overlay-local `currentSession.tool`, Fabric active selection
- Produces: `selectionTarget: 'stroke' | 'partial'`, `selectionShape: 'rectangle' | 'lasso'`

- [ ] **Step 1: UI와 전환 실패 테스트 작성**

`V exposes independent selection target and shape controls` 테스트에서 다음 버튼과
진단 값을 요구한다.

```js
const strokeTarget = findOne(toolbar, node =>
  node.dataset.fabricPilotAction === 'select-target-stroke');
const partialTarget = findOne(toolbar, node =>
  node.dataset.fabricPilotAction === 'select-target-partial');
const rectangleShape = findOne(toolbar, node =>
  node.dataset.fabricPilotAction === 'select-shape-rectangle');
const lassoShape = findOne(toolbar, node =>
  node.dataset.fabricPilotAction === 'select-shape-lasso');

assert.equal(runtime.getDiagnostics().selectionTarget, 'stroke');
assert.equal(runtime.getDiagnostics().selectionShape, 'rectangle');
partialTarget.dispatch('click');
lassoShape.dispatch('click');
assert.equal(runtime.getDiagnostics().selectionTarget, 'partial');
assert.equal(runtime.getDiagnostics().selectionShape, 'lasso');
```

실제 Fabric 테스트에서는 획을 선택한 뒤 `partial` 또는 `lasso`로 바꾸면
`canvas.getActiveObject()`와 `selectedObjectIds`가 즉시 비는 것을 요구한다.

- [ ] **Step 2: 실패 확인**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="independent selection target|switching a whole-stroke selection" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: 새 버튼과 진단 필드가 없어 FAIL.

- [ ] **Step 3: 최소 선택 상태와 UI 구현**

```js
let selectionTarget = 'stroke';
let selectionShape = 'rectangle';

function usesNativeRectangleSelection(tool = currentSession?.tool) {
  return tool === 'select' &&
    selectionTarget === 'stroke' &&
    selectionShape === 'rectangle';
}
```

선택 대상·모양 버튼 그룹을 만들고, 실제 값이 바뀌는 순간 pending selection,
active gesture, Fabric active object, scene selection을 정리한다. 같은 값을 다시
누르면 no-op으로 둔다.

- [ ] **Step 4: 집중 테스트 통과 확인**

Run: Step 2와 같은 명령.

Expected: PASS.

### Task 2: 공통 영역 gesture와 사각형 부분 선택

**Files:**
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Test: `scripts/tests/mpv-fabric-overlay-runtime.test.js`

**Interfaces:**
- Consumes: `selectionTarget`, `selectionShape`, `splitStrokePointsByPolygon()`
- Produces: 사각 또는 라쏘 polygon, 기존 pending lasso transaction과 호환되는 선택 결과

- [ ] **Step 1: 사각형 부분 이동 실패 테스트 작성**

긴 획 하나를 그리고 `partial + rectangle`을 선택한 뒤 중간 영역을 드래그한다.
pointerup 직후 원본 scene과 history가 그대로이고 pending proxy만 존재해야 한다.
선택을 이동한 뒤에는 바깥/안/바깥 세 fragment가 생기고 안쪽 fragment만 이동해야
한다.

```js
partialTarget.click();
rectangleShape.click();
harness.dragLasso([{ x: 70, y: 70 }, { x: 130, y: 130 }], 801);
assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, [original]);
harness.dragActiveSelectionBy(15, -10, 802);
assert.equal(harness.sceneStore.getActiveSceneSnapshot().objects.length, 3);
```

역방향 꼭짓점 입력도 같은 fragment 범위를 선택하는 별도 테스트를 둔다.

- [ ] **Step 2: 실패 확인**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="rectangle partial selection" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: rectangle 자유 선택 버튼 또는 polygon 경로 부재로 FAIL.

- [ ] **Step 3: 사각 polygon과 공통 finalize 구현**

```js
function rectanglePolygon(start, end) {
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: start.y },
    { x: end.x, y: end.y },
    { x: start.x, y: end.y }
  ];
}
```

native 조합이 아닌 선택은 같은 pointer-capture gesture를 사용한다. 라쏘는 기존
단순화 polygon, 사각은 첫 점과 마지막 점의 네 꼭짓점을 만든다. 현재
`finalizeActiveLasso()`의 polygon 이후 부분 분할 코드를 공통 함수로 옮겨 두 모양이
동일한 pending transaction을 사용하게 한다.

- [ ] **Step 4: 부분 Delete와 Undo/Redo 실패 테스트 및 구현 확인**

사각 부분 선택 뒤 Delete, Undo, Redo를 실행해 원본 1개 → 바깥 fragment → 원본
1개 → 바깥 fragment 순서를 요구한다. production 경로는 기존
`commitPendingLassoDelete()`와 command history를 그대로 사용한다.

- [ ] **Step 5: 집중 테스트 통과 확인**

Run: Step 2 명령과 기존 lasso split 테스트 패턴.

Expected: 모두 PASS.

### Task 3: 획 전체 + 라쏘와 네 조합 회귀

**Files:**
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Test: `scripts/tests/mpv-fabric-overlay-runtime.test.js`

**Interfaces:**
- Consumes: 공통 polygon과 transform된 `sourcePoints`
- Produces: fragment를 만들지 않는 원본 객체 ID 선택

- [ ] **Step 1: 획 전체 + 라쏘 실패 테스트 작성**

두 획의 일부에 닿는 라쏘를 그린 뒤 두 원본 ID 전체가 선택되며 object count,
mutation, undo depth가 변하지 않는 것을 요구한다.

- [ ] **Step 2: 실패 확인**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="whole-stroke lasso" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: 독립 shape/target 조합이 없어 FAIL.

- [ ] **Step 3: 비파괴 whole-hit 경로 구현**

각 획에 `splitStrokePointsByPolygon()`을 적용하되 inside run 존재 여부만 사용한다.
hit된 원본 ID를 `activateObjectIds()`에 전달하고 replacement, pending proxy,
history를 만들지 않는다.

- [ ] **Step 4: 네 조합과 기존 선택 UX 회귀 확인**

획 전체 + 사각의 click/marquee/hover/이동 테스트, 부분 + 라쏘의 이동/Delete/
Undo/Redo 테스트, 모드 전환 후 첫 입력 테스트를 함께 실행한다.

### Task 4: 번들·전체 회귀·출시

**Files:**
- Modify by generated command: `renderer/scripts/lib/mpv-fabric-overlay.iife.js`
- Verify: `package.json`에 정의된 drawing/mpv 테스트

**Interfaces:**
- Consumes: 검증된 source runtime
- Produces: source와 일치하는 browser IIFE 및 배포 가능한 Electron 앱

- [ ] **Step 1: browser bundle 재생성**

Run:

```powershell
npm run bundle:mpv-fabric-overlay
```

Expected: exit 0.

- [ ] **Step 2: 집중 및 전체 회귀 실행**

Run:

```powershell
npm run test:fabric-drawing-pilot
npm run test:fabric-drawing-persistence
npm run test:mpv
npm run lint
git diff --check
```

Expected: 모든 테스트 0 failures, lint 0 errors, diff check clean.

- [ ] **Step 3: 독립 리뷰와 커밋**

diff와 테스트 증거를 독립 리뷰에 전달한다. P0-P3 지적이 없거나 모두 해결된 뒤
한국어 커밋 메시지로 source, test, generated bundle, 문서를 커밋한다.

- [ ] **Step 4: PR 검토와 병합**

branch를 push하고 사용자용 변경 요약, 상세 기술 설명, 개발 난항, 테스트 가이드가
있는 PR을 만든다. Codex review에서 actionable comment가 없음을 확인한 뒤 병합한다.

- [ ] **Step 5: 병합본 빌드와 배포**

병합된 `origin/main` 정확한 SHA에서 unpacked 앱을 빌드한다. 실행 중 BAEFRAME
프로세스를 종료하지 않고 사용자 종료 상태를 확인한 뒤 공유 드라이브에 mirror한다.
로컬과 배포본 전체 manifest의 파일 수, 크기, SHA-256을 비교해
`MismatchCount=0`을 확인한다.

---

## Final review hardening addendum

최초 Task 4 뒤 whole-branch 독립 리뷰에서 실제 재현된 여섯 Important를 출시 전에
닫는다. 아래 Task 5~7이 완료되기 전에는 PR, 병합, 배포하지 않는다.

### Task 5: 변환 정확도·boolean hit·부분 점 획·연산 한도

**Files:**
- Modify: `renderer/scripts/modules/drawing-v3/lasso-geometry.js`
- Modify: `renderer/scripts/modules/drawing-v3/stroke-splitter.js`
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Test: `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- Test: focused geometry/performance tests under `scripts/tests/`

**Interfaces:**
- Produces: source-coordinate polygon query, bounded `strokeTouchesPolygon()`
- Preserves: existing fragment splitter output and atomic pending transaction

- [ ] **Step 1: 리뷰 결함을 RED로 고정**

다음을 실제 Fabric 경로로 먼저 실패시킨다.

- 정상 길이 획의 1 source-unit 미만 가시 가장자리 접촉을 whole lasso가 놓침
- `scaleY`, scale+rotate, scale+skew/flip 획의 보이는 영역을 놓침
- partial rectangle/lasso가 점·0.4-unit 획을 완전히 감싸도 선택하지 못함
- 20,000점 × 512/1024-edge whole hit가 동기 O(points*edges)로 오래 멈춤

- [ ] **Step 2: polygon을 원본 획 좌표로 역변환**

`calcTransformMatrix()`를 역변환하고 `pathOffset`을 더해 scene polygon을
`sourcePoints` 좌표로 옮긴다. determinant가 안전하지 않거나 budget을 넘으면
부분 결과 없이 `selection-complexity-limit-exceeded`로 취소한다.

- [ ] **Step 3: bounded boolean hit 구현**

fragment의 1-unit 최소 길이 필터와 독립적인 `strokeTouchesPolygon()`을 만든다.
polygon edge index, broad phase, 첫 접촉 early return, gesture 공유 operation
budget을 사용한다. whole lasso는 splitter를 호출하지 않는다.

- [ ] **Step 4: 점·초단 획의 부분 선택과 affine fragment 보존**

분할할 수 없는 획은 touch 시 원본 ID를 `selectedPersistedIds`에 넣는다. 정상
fragment는 원본 선형 transform과 pathOffset 차이를 반영한 scene center를 가져야
한다. 혼합 선택의 이동/Delete는 각각 Undo 한 번으로 원본 ID·transform·z-order를
왕복한다.

- [ ] **Step 5: 정확도·불변식·성능 GREEN**

false-positive 경계, 역방향 사각형, transform 조합, 혼합 선택, atomic abort를
검증한다. 비-flaky 기준은 operation count 상한이며 wall-clock benchmark는
20k×512/1024 입력이 250ms 이내인지 보조로 기록한다.

### Task 6: preset 취소 상태와 좁은 화면 도구막대

**Files:**
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Modify: `main/mpv-overlay-host.js`
- Test: `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- Test: `scripts/tests/mpv-overlay-host.test.js` 또는 전용 숨김 Electron layout test

- [ ] **Step 1: deferred viewport RED**

native select 이동, custom 영역 gesture, pending partial 이동 각각에서 viewport를
보류한 뒤 실제 preset을 바꾼다. 현재 revision 미적용, stale 정렬, 늦은 modified
위험을 실패로 확인한다.

- [ ] **Step 2: 취소 정리 뒤 current viewport 한 번 적용**

preset 변경만 deferred viewport를 보존한다. transform rollback, pointer lifecycle,
pending proxy 복구, active selection 정리 뒤 같은 session과 정확히 같은 current
input revision이면 최신 명령을 한 번 적용한다. disable/session replacement/
pointercancel/blur/destroy는 계속 폐기한다.

- [ ] **Step 3: compact-wrap RED와 구현**

400/500/640px에서 모든 버튼의 root 포함, 40x40 입력 영역, 비겹침, 최대 두 행을
요구한다. production toolbar에 `max-width`, flex wrap, 좁은 화면 간격/요약 축약을
적용하고 브러시 panel을 실제 toolbar 아래에 배치한다. root overflow, z-index,
BrowserWindow 위치, DOM 재생성은 변경하지 않는다.

- [ ] **Step 4: 접근성·리사이즈 회귀**

짧은 저장 문구와 전체 `aria-label`/`title`, 같은 toolbar 노드 유지, B/V 전환과
리사이즈 뒤 모든 action 접근 가능을 검증한다.

### Task 7: 재번들·전체 회귀·최종 독립 리뷰

- [ ] `npm run bundle:mpv-fabric-overlay`
- [ ] `npm run test:fabric-drawing-pilot`
- [ ] `npm run test:fabric-drawing-persistence`
- [ ] `npm run test:mpv`
- [ ] `npm run test:drawing`
- [ ] `npm run lint`
- [ ] source/bundle SHA-256 결정성 및 `git diff --check`
- [ ] Task 5, Task 6 각각 독립 리뷰
- [ ] `e0da8c2..HEAD` whole-branch 재리뷰에서 Critical/Important 0
- [ ] PR/Codex review/merge 뒤 exact merged SHA build와 배포 hash mismatch 0
