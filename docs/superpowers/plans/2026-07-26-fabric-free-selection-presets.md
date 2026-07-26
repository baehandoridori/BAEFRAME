# Fabric 자유 선택 프리셋 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** V 도구에서 획 전체/영역 일부와 사각/라쏘를 독립적으로 선택하고, 사각형으로 고른 획 일부도 안전하게 이동·삭제·Undo/Redo한다.

**Architecture:** overlay runtime의 로컬 선택 상태를 대상과 모양 두 축으로 나눈다. 사각 드래그는 네 점 polygon으로 바꾸고, 사각/라쏘가 같은 pending `split-stroke` transaction을 사용한다. 최종 hit와 clip은 centerline 반폭 추정이 아니라 실제 Fabric Path 채움을 authoritative geometry로 사용한다.

**Tech Stack:** Electron, Fabric.js 7.4, CommonJS, Node test runner, esbuild

## Global Constraints

- 선택 대상과 모양은 리뷰 파일과 IPC에 저장하지 않는다.
- 부분 선택 pointerup은 scene, history, dirty, save attempt를 바꾸지 않는다.
- 실제 이동 또는 Delete에서만 원자적 `split-stroke` 한 번을 기록한다.
- 실제 채움으로 잘라낸 표시 모양은 엄격히 검증한 version 1 `renderGeometry`로
  저장하되 `sourcePoints`, pressure/time, caps, transform은 canonical 계보로
  유지한다.
- flatten, hit, paired clip, source-position 투영은 gesture당 하나의 250,000
  operation budget을 공유하고, 실패 시 부분 결과를 적용하지 않는다.
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

각 획의 실제 표시 Path 채움과 selection polygon의 overlap만 판정한다. hit된 원본
ID를 `activateObjectIds()`에 전달하고 replacement, pending proxy, history를 만들지
않는다. Task 8의 fill query가 이 단계의 최종 geometry authority다.

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

최초 Task 4 뒤 whole-branch 독립 리뷰에서 실제 재현된 Important를 출시 전에
닫는다. 아래 Task 5~8이 완료되기 전에는 PR, 병합, 배포하지 않는다. Task 8은
Task 2/3/5의 최종 hit·clip 구현을 실제 채움 기준으로 대체하며 UX와 pending
transaction 계약은 그대로 유지한다. Task 8 뒤에는 Task 7 전체 gate를 다시
실행한다.

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

### Task 8: 실제 표시 채움 기반 hit·clip·저장

Task 8은 Task 2/3/5의 centerline 반폭 기반 hit·clip을 대체한다. centerline은
선택된 채움과 canonical `sourcePoints` 구간을 연결하는 계보 투영에만 사용한다.

**Files:**
- Create: `renderer/scripts/modules/drawing-v3/stroke-fill-geometry.js`
- Create: `shared/drawing-render-geometry.js`
- Modify: `renderer/scripts/modules/drawing-v3/stroke-splitter.js`
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Modify: `renderer/scripts/modules/fabric-drawing-persistence-store.js`
- Modify: `main/mpv-overlay-host.js`
- Test: `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- Test: `scripts/tests/fabric-drawing-persistence-store.test.mjs`
- Test: `scripts/tests/mpv-overlay-host.test.js`

**Interfaces:**
- Consumes: Fabric Path의 대문자 `M/L/Q/C/Z`, selection polygon,
  canonical stroke record, gesture 공유 geometry budget
- Produces: `flattenFabricPath()`, `createPathFillQuery()`,
  `pathFillOverlapsPolygon()`, fail-all `clipSimplePathFillPair()`,
  version 1 `renderGeometry`
- Preserves: `sourcePoints`, pressure/time, `strokeCaps`, transform, z-order,
  pending 선택의 비파괴 stage 및 단일 `split-stroke` history command

- [ ] **Step 1: centerline 추정과 실제 픽셀의 차이를 RED로 고정**

실제 Fabric canvas에 size 20 perfect-freehand L-turn을 그리고, 모서리의 실제 alpha가
255인 점을 작은 polygon으로 감싼다. whole/partial 모두 해당 점을 선택해야 한다.
반대로 기존 raw centerline-radius에는 포함되지만 실제 alpha가 없는 바깥 점은 두
모드 모두 선택하지 않아야 한다.

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="rendered perfect-freehand L-turn|raw centerline-radius false positive" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: centerline 반폭만 쓰는 구현은 실제 모서리 hit 또는 바깥 miss 중 하나가
FAIL.

- [ ] **Step 2: 실제 Path flatten과 fill query 구현**

`flattenFabricPath()`는 command arity, 대문자 command, 유한 좌표, 닫힌 contour를
엄격히 확인하고 `Q/C`를 허용 오차에 맞춰 선분화한다. 결과 edge와 contour는
불변으로 만들고 bounds BVH를 구성한다. `createPathFillQuery()`는 원본 Path의
`evenodd | nonzero` 규칙으로 hole/island/상쇄 contour를 판정한다.

다음 fixture를 각각 양 winding과 두 fill rule에서 검증한다.

- 동일 경계, 일부 공유 경계, 외부 tangent
- 같은 점에서 닿는 동일/상이 크기 component
- 중첩 hole/island와 완전히 상쇄된 contour
- 높이 0.1/0.05/0.01의 얇은 채움과 그 옆의 빈 clearance

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="thin actual fill|collinear equal|point-touching fills|nested evenodd|canceled contours" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: 모든 overlap과 component/area assertion PASS.

- [ ] **Step 3: paired clip과 canonical source 구간 투영**

교집합과 차집합은 `clipSimplePathFillPair()` 한 번으로 계산한다. 어느 loop든
geometry 또는 budget 실패가 나면 다음과 같이 두 결과를 함께 폐기한다.

```js
{
  intersection: { components: [], reason: 'selection-complexity-limit-exceeded' },
  difference: { components: [], reason: 'selection-complexity-limit-exceeded' }
}
```

각 fill component는 centerline BVH의 bounds candidate만 조회해 단조
source-position interval로 투영한다. `splitStrokePointsBySourceIntervals()`가
그 구간을 잘라 원본 pressure/time chain과 caps를 보존한다. 분기점이 모호하거나
component와 source interval을 일대일로 연결할 수 없으면 추정하지 않고
`selection-geometry-unavailable`로 전체 gesture를 취소한다.

- [ ] **Step 4: clipped `renderGeometry` 저장·복원 경계 구현**

선택/잔여 fragment의 표시 채움은 다음 exact-key 형식으로 저장한다.

```js
{
  version: 1,
  pathData: 'M ... L ... Z',
  fillRule: 'evenodd'
}
```

`shared/drawing-render-geometry.js`의 동일 validator를 runtime, persistence store,
host가 사용한다. `pathData`는 닫힌 `M/L/Z` contour만 허용하고 command injection,
추가 key, 다른 version/fill rule, 비유한·범위 밖 좌표, 문자열 한도를 모두
거부한다. 표시에는 `renderGeometry`를 우선 사용하지만 canonical `pathData`는
계속 `sourcePoints`와 pressure에서 재생성 가능한 값이어야 한다.

L-turn fragment의 이동 → Undo/Redo → export → hydrate → 같은 fragment 재선택을
왕복해 실제 잘린 픽셀과 canonical source 데이터가 모두 유지되는지 확인한다.

Run:

```powershell
npm run test:fabric-drawing-persistence
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="render geometry|rendered perfect-freehand L-turn" scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/mpv-overlay-host.test.js
```

Expected: valid version 1 값은 정확히 왕복하고 모든 malformed fixture는 원자적으로
거부.

- [ ] **Step 5: 공유 250k budget·cache 동등성·선택 복구**

flatten, fill/path BVH, overlap, paired clip, centerline 투영은 같은
`createGeometryBudget(250_000)`을 사용한다. cache hit도 저장된
`logicalBuildCost`를 차감해 cold/warm 입력의 허용 여부가 같아야 한다.

gesture 시작 시 active object ID와 `selectedObjectIds`를 함께 캡처한다. geometry,
역행렬, fragment build, budget 실패가 나면 같은 scene/session revision에서만
그 선택을 정확히 복구한다. scene/history/mutation/save attempt와 pending proxy는
실패 전 상태여야 하며, revision이 바뀐 뒤에는 오래된 선택을 복구하지 않는다.

- [ ] **Step 6: 300/400/1,000/20,000 검증 계약**

동일한 sine 획, size 5.5, x=70..95 부분 사각 fixture로 다음을 고정한다.

| 입력 | Expected |
| --- | --- |
| 300 samples | 비파괴 stage → 이동 후 3 fragments → Undo 원본 복구, 250k 미만 |
| 400 samples | 같은 실제 runtime 왕복, direct paired clip 200k 미만, 각 1초 미만 |
| 1,000 samples | 250k 안에서 complexity failure, intersection/difference 모두 폐기, 1초 미만 |
| 20,000 edges | flatten 단계가 250k 안에서 complexity failure, 2초 미만 |

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="realistic 300 and 400|paired clipping fits|fill cache logical cost|shared geometry operation budget|restores the exact prior multi-selection" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: 표의 결과와 이전 다중 선택 exact restore 모두 PASS.

- [ ] **Step 7: Task 8 이후 출시 gate 재실행**

Run:

```powershell
npm run bundle:mpv-fabric-overlay
npm run test:fabric-drawing-pilot
npm run test:fabric-drawing-persistence
npm run test:mpv
npm run test:drawing
npm run lint
git diff --check
```

Expected: 모든 테스트 0 failures, lint 0 errors, source/browser bundle 계약 일치,
diff check clean. Task 8 geometry, persistence/host, runtime 선택 복구를 각각 독립
리뷰하고 `e0da8c2..HEAD` whole-branch Critical/Important 0을 확인한 뒤에만 PR,
병합, exact merged SHA 빌드와 hash mismatch 0 배포로 진행한다.
