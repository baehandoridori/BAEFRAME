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
