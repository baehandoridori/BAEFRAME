# Fabric Command History and Partial Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fabric 시험판의 모든 현재 편집을 장면별 Undo/Redo로 되돌리고, 라쏘 부분 선택은 실제 이동 또는 Delete 때만 한 command로 확정한다.

**Architecture:** 순수 `DrawingCommandHistory`가 bounded undo/redo stack을 소유하고 `SessionSceneStore`가 touched-object 정방향·역방향 state를 만든다. 라쏘 fragment는 runtime의 pending transaction에만 존재하다 실제 편집 pointerup 또는 Delete에서 scene command 하나로 commit된다. main-window shortcut은 controller가, overlay-origin shortcut은 host가 같은 직렬 action 경로로 runtime에 전달한다.

**Tech Stack:** Electron, Fabric.js 7.4.0, CommonJS runtime modules, Node.js `node:test`, esbuild IIFE bundle

## Global Constraints

- 기준 커밋은 `a1f4094`다.
- 작업공간은 `C:\Users\user\.codex\worktrees\fabric-brush-style-v1\BAEFRAME`의 기존 linked worktree를 사용한다.
- `.bframe`, ReviewDataManager, drawing sync, user settings에는 연결하지 않는다.
- 모든 시나리오에서 `saveAttemptCount === 0`을 유지한다.
- hover, 선택, 라쏘 pointerup, 취소, 0거리 이동은 command, mutation, dirty, redo invalidation을 만들지 않는다.
- 새 실제 편집만 redo stack을 비운다.
- 라쏘 부분 이동과 라쏘 부분 Delete는 각각 한 command다.
- Undo/Redo 이후 selection은 비운다.
- 단일 파괴 command의 inverse가 history 한도를 넘으면 scene 변경을 원자적으로 거부한다.
- history 기본 최대 개수는 scene당 32다.
- Ctrl/Cmd+Z는 Undo, Ctrl/Cmd+Y와 Ctrl/Cmd+Shift+Z는 Redo다.
- IME, `keyCode === 229`, editable target, Alt 조합은 Fabric history shortcut이 아니다.
- auto-repeat은 소비하지만 action을 추가 실행하지 않는다.
- 기존 실행 중인 BAEFRAME 프로세스를 조회·종료·재사용하지 않는다.
- 생성 번들은 `npm.cmd run bundle:mpv-fabric-overlay`로만 갱신한다.

---

### Task 1: Bounded DrawingCommandHistory 구현

**Files:**
- Create: `renderer/scripts/modules/drawing-v3/drawing-command-history.js`
- Create: `scripts/tests/drawing-v3-command-history.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `createDrawingCommandHistory(options)`
- Produces history methods: `record(command)`, `undo(applyState)`, `redo(applyState)`, `clear()`, `getDiagnostics()`
- Command contract: `{ id, kind, undoState, redoState }`
- `applyState(state, direction, command)` returns `{ applied: true }` or `{ applied: false, reason }` and may throw.

- [ ] **Step 1: 순수 history RED 테스트 작성**

다음 실제 동작을 별도 test로 작성한다.

```js
test('record undo and redo preserve command order', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  const applied = [];
  assert.equal(history.record({
    id: 'add-1', kind: 'add-objects',
    undoState: { value: 0 }, redoState: { value: 1 }
  }).recorded, true);
  assert.equal(history.undo(state => (applied.push(state.value), { applied: true })).applied, true);
  assert.equal(history.getDiagnostics().redoDepth, 1);
  assert.equal(history.redo(state => (applied.push(state.value), { applied: true })).applied, true);
  assert.deepEqual(applied, [0, 1]);
});
```

추가 test:

```text
new record clears redo but does not discard older undo
failed apply leaves the entry on its original stack
throwing apply leaves the entry on its original stack
oldest undo entries are evicted at maxEntries
undo and redo bytes are both included in historyBytes
one command larger than maxBytes is rejected without changing stacks
invalid and duplicate command ids are rejected
clear removes both stacks and bytes
```

- [ ] **Step 2: RED 확인**

Run:

```powershell
node --test scripts/tests/drawing-v3-command-history.test.js
```

Expected: module missing 또는 `createDrawingCommandHistory is not a function`으로 FAIL.

- [ ] **Step 3: 최소 history 모듈 구현**

다음 shape를 구현한다.

```js
'use strict';

function positiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function clonePlain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function defaultEstimateEntryBytes(entry) {
  return Math.max(1, JSON.stringify(entry).length * 2);
}

function createDrawingCommandHistory(options = {}) {
  const maxEntries = positiveInteger(options.maxEntries, 32);
  const maxBytes = positiveInteger(options.maxBytes, 16 * 1024 * 1024);
  const estimateEntryBytes = options.estimateEntryBytes || defaultEstimateEntryBytes;
  const undoStack = [];
  const redoStack = [];
  const knownIds = new Set();
  let historyBytes = 0;

  function removeAt(stack, index) {
    const [entry] = stack.splice(index, 1);
    if (!entry) return;
    historyBytes = Math.max(0, historyBytes - entry.estimatedBytes);
    knownIds.delete(entry.id);
  }

  function clearStack(stack) {
    while (stack.length > 0) removeAt(stack, stack.length - 1);
  }

  function record(command) {
    if (!command || typeof command.id !== 'string' || !command.id ||
        typeof command.kind !== 'string' || !command.kind ||
        command.undoState === undefined || command.redoState === undefined) {
      return { recorded: false, reason: 'invalid-command' };
    }
    if (knownIds.has(command.id)) return { recorded: false, reason: 'duplicate-command' };
    const stored = clonePlain(command);
    const estimatedBytes = Math.max(1, Math.trunc(Number(estimateEntryBytes(stored)) || 1));
    if (estimatedBytes > maxBytes) return { recorded: false, reason: 'history-capacity-exceeded' };

    clearStack(redoStack);
    while (undoStack.length >= maxEntries || historyBytes + estimatedBytes > maxBytes) {
      if (undoStack.length === 0) return { recorded: false, reason: 'history-capacity-exceeded' };
      removeAt(undoStack, 0);
    }
    undoStack.push({ ...stored, estimatedBytes });
    knownIds.add(stored.id);
    historyBytes += estimatedBytes;
    return { recorded: true, undoDepth: undoStack.length, redoDepth: 0 };
  }

  function moveTop(from, to, stateKey, applyState, direction) {
    const entry = from.at(-1);
    if (!entry) return { applied: false, reason: 'history-empty' };
    try {
      const result = applyState(clonePlain(entry[stateKey]), direction, clonePlain(entry));
      if (result?.applied !== true) {
        return { applied: false, reason: result?.reason || 'history-apply-failed' };
      }
    } catch (error) {
      return { applied: false, reason: error?.message || 'history-apply-failed' };
    }
    from.pop();
    to.push(entry);
    return { applied: true, commandId: entry.id, kind: entry.kind,
      undoDepth: undoStack.length, redoDepth: redoStack.length };
  }

  function undo(applyState) {
    return moveTop(undoStack, redoStack, 'undoState', applyState, 'undo');
  }

  function redo(applyState) {
    return moveTop(redoStack, undoStack, 'redoState', applyState, 'redo');
  }

  function clear() {
    clearStack(undoStack);
    clearStack(redoStack);
  }

  function getDiagnostics() {
    const undoBytes = undoStack.reduce((total, entry) => total + entry.estimatedBytes, 0);
    const redoBytes = redoStack.reduce((total, entry) => total + entry.estimatedBytes, 0);
    return { undoDepth: undoStack.length, redoDepth: redoStack.length,
      undoBytes, redoBytes, historyBytes, maxEntries, maxBytes };
  }

  return { record, undo, redo, clear, getDiagnostics };
}

module.exports = { createDrawingCommandHistory };
```

`moveTop()`은 apply 성공 뒤에만 stack을 이동한다. 실패·throw에서는 원래 stack을 유지하고 `{ applied: false, reason }`을 반환한다.

- [ ] **Step 4: GREEN과 test:drawing 연결**

`package.json`의 `test:drawing`에 `scripts/tests/drawing-v3-command-history.test.js`를 추가한다.

Run:

```powershell
node --test scripts/tests/drawing-v3-command-history.test.js
npm.cmd run test:drawing
```

Expected: 새 history tests 전부 PASS, 기존 drawing tests 포함 실패 0.

- [ ] **Step 5: Task 1 커밋**

```powershell
git add -- renderer/scripts/modules/drawing-v3/drawing-command-history.js scripts/tests/drawing-v3-command-history.test.js package.json
git commit -m "feat: Fabric 드로잉 명령 이력 기반 추가"
```

---

### Task 2: SessionSceneStore의 모든 편집을 Undo/Redo command로 전환

**Files:**
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Modify: `scripts/tests/mpv-fabric-overlay-runtime.test.js`

**Interfaces:**
- Consumes: `createDrawingCommandHistory()` from Task 1
- Produces store methods: existing `undo()` plus new `redo()`
- `replaceObjects(change)` accepts optional `kind`, `transforms`, `dx`, `dy` and commits structure+transform atomically.
- Diagnostics add `redoDepth` and `historyBytes`; existing `undoDepth` and `undoBytes` remain compatible.

- [ ] **Step 1: store/runtime RED tests 작성**

실제 `createSessionSceneStore()`와 runtime을 사용해 다음을 먼저 작성한다.

```text
add stroke -> undo removes it -> redo restores exact record and z-order
single and multi stroke move -> one undo -> one redo
full-stroke Delete -> undo -> redo
Clear -> undo -> redo
undo then selection-only/no-op keeps redoDepth
undo then new stroke clears redoDepth and keeps older undo entries
two consecutive moves create two commands
video/frame scene histories remain independent
destructive command over maxHistoryBytes is rejected and scene stays byte-identical
```

각 test는 `mutationCount`, `undoDepth`, `redoDepth`, `saveAttemptCount`도 검증한다.

- [ ] **Step 2: RED 확인**

Run:

```powershell
node --test --test-name-pattern="undo|redo|history|destructive command" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: `redo` invalid action, 일반 mutation history 부재, 용량 초과 원자성 부재로 FAIL.

- [ ] **Step 3: scene별 history와 staged mutation 구현**

scene 생성 시 다음 필드를 둔다.

```js
history: createDrawingCommandHistory({
  maxEntries: maxHistory,
  maxBytes: maxHistoryBytes,
  estimateEntryBytes: estimateHistoryEntryBytes
})
```

구조 state helper를 추가한다.

```js
function makeObjectsState(objects, touchedIds, order) {
  return {
    type: 'objects',
    touchedIds: [...touchedIds],
    objects: [...touchedIds].filter(id => objects.has(id)).map(id => clonePlain(objects.get(id))),
    order: [...order]
  };
}

function makeTransformsState(objects, objectIds) {
  return {
    type: 'transforms',
    transforms: objectIds.map(id => ({ id, transform: clonePlain(objects.get(id)?.transform || {}) }))
  };
}
```

각 mutation은 현재 scene을 바로 바꾸지 않고 `nextObjects`, `nextSelection`, `nextOrder`를 먼저 만든다. history `record()`가 성공한 뒤에만 scene에 교체하고 `noteMutation()`을 한 번 호출한다.

`applyHistoryState()`는 touched ID만 교체하거나 transform만 적용하고, selection을 비우며 bytes를 재계산한다.

- [ ] **Step 4: runtime action에 Redo 추가**

허용 action을 다음으로 확장한다.

```js
const DRAWING_ACTIONS = new Set([
  'delete-selection',
  'clear-session',
  'undo',
  'redo'
]);
```

Undo/Redo 성공 시 `renderActiveScene()`, active object discard, tool policy 복원, object metric 갱신을 같은 경로로 수행한다.

툴바에 `Undo`, `Redo` 버튼을 추가하고 각각 동일한 `applyDrawingAction()`을 호출한다.

- [ ] **Step 5: GREEN 확인**

Run:

```powershell
node --test scripts/tests/drawing-v3-command-history.test.js scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: history 및 runtime tests 모두 PASS.

- [ ] **Step 6: Task 2 커밋**

```powershell
git add -- renderer/scripts/modules/mpv-fabric-overlay-runtime.js scripts/tests/mpv-fabric-overlay-runtime.test.js
git commit -m "feat: Fabric 편집 Undo Redo 연결"
```

---

### Task 3: 라쏘 선택을 미확정 transaction으로 전환하고 부분 Delete 원자화

**Files:**
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Modify: `scripts/tests/mpv-fabric-overlay-runtime.test.js`

**Interfaces:**
- Replaces runtime `pendingLassoVisual` with `pendingLassoSelection`.
- Produces helpers: `stagePendingLassoSelection()`, `materializePendingLassoSelection()`, `commitPendingLassoMove()`, `commitPendingLassoDelete()`, `abortPendingLassoSelection()`.
- Consumes atomic `sceneStore.replaceObjects({ replacements, selectedObjectIds, dx, dy, kind })` from Task 2.

- [ ] **Step 1: pending selection RED tests 작성**

먼저 다음 real Fabric tests를 작성 또는 기존 test 기대값을 변경한다.

```text
lasso pointerup keeps exact scene objects, mutationCount, dirty, undoDepth and redoDepth
lasso selection visually keeps the original stroke without darkening
first real move commits split+move once; undo restores original; redo restores moved fragments
same fragments moved a second time create a second command
partial lasso Delete leaves outside fragments; undo restores original ID/path/z-order; redo recreates the hole
partial fragments plus fully enclosed stroke Delete round-trips as one command
pending cancel, blur, pointercancel, B disable, tool mode change, selection preset change and new lasso leave no proxy or history
pending Undo/Redo aborts pending first and applies only committed history
zero-distance move remains no-op
commit failure or history capacity failure leaves original scene and Fabric paths
```

- [ ] **Step 2: RED 확인**

Run:

```powershell
node --test --test-name-pattern="lasso|pending|partial" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: pointerup mutation, Delete history loss, redo 부재 또는 proxy rollback 문제로 FAIL.

- [ ] **Step 3: finalizeActiveLasso를 stage-only로 변경**

`finalizeActiveLasso()`는 geometry와 fragment record를 계산하지만 `sceneStore.replaceObjects()`를 호출하지 않는다.

```js
pendingLassoSelection = {
  sessionId: currentSession.sessionId,
  inputRevision: tokenState.inputRevision,
  sourceMutationCount: sceneStore.getDiagnostics().mutationCount,
  replacements,
  selectedPersistedIds: new Set(fullySelectedIds),
  selectedFragmentIds: new Set(selectedFragmentIds),
  originalFabricObjects,
  fragmentFabricObjects,
  phase: 'selected'
};
```

선택 fragment는 `opacity: 0`, `__baeframePendingLasso = true` proxy로만 canvas에 추가한다. `onSelectionChanged()`는 pending fragment ID를 `sceneStore.selectObjects()`에 기록하지 않는다.

- [ ] **Step 4: move와 Delete commit 구현**

첫 `object:moving`은 화면 staging만 수행하고 pending 상태를 유지한다.

`object:modified`는 시작점과 현재 위치 차이가 있을 때 다음 한 호출로 commit한다.

```js
sceneStore.replaceObjects({
  replacements: pending.replacements,
  selectedObjectIds: [
    ...pending.selectedPersistedIds,
    ...pending.selectedFragmentIds
  ],
  dx,
  dy,
  kind: 'split-stroke'
});
```

Delete는 partial replacement의 selected fragment를 제외하고 fully selected persisted object는 `{ removeId, addObjects: [] }`로 포함한다. 성공 후에만 pending visual을 폐기하고 scene을 render한다.

취소 helper는 canvas proxy와 임시 fragment만 제거하고 store mutation API나 공개 Undo를 호출하지 않는다.

- [ ] **Step 5: 기존 임시 lasso undo 제거와 GREEN 확인**

ID 집합 기반 무기한 coalescing, `rollbackPendingLassoVisual()`의 `sceneStore.undo()`, 선택 pointerup의 즉시 `replaceObjects()`를 제거한다.

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: runtime 전체 PASS, 모든 lasso test에서 `saveAttemptCount === 0`.

- [ ] **Step 6: Task 3 커밋**

```powershell
git add -- renderer/scripts/modules/mpv-fabric-overlay-runtime.js scripts/tests/mpv-fabric-overlay-runtime.test.js
git commit -m "fix: Fabric 라쏘 선택과 부분 삭제 원자화"
```

---

### Task 4: Ctrl/Cmd Undo/Redo와 host action 순서 연결

**Files:**
- Modify: `renderer/scripts/modules/fabric-drawing-pilot-controller.js`
- Modify: `main/mpv-overlay-host.js`
- Modify: `scripts/tests/fabric-drawing-pilot-shortcuts.test.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`
- Modify: `scripts/tests/fabric-drawing-pilot-integration.test.js`

**Interfaces:**
- Controller produces generic `applyDrawingAction(action)` for `delete-selection|undo|redo`.
- Host accepts `delete-selection|clear-session|undo|redo` and serializes all drawing actions.
- Overlay `before-input-event` detects physical `KeyZ`/`KeyY` history shortcuts before forwarding other keys.

- [ ] **Step 1: controller shortcut RED tests 작성**

다음 경우를 실제 controller harness로 검증한다.

```text
active Ctrl/Cmd+Z sends undo exactly once
active Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z send redo exactly once
preparing and auto-repeat consume but send zero actions
editable, IME, keyCode 229, Alt+Z, plain Z/Y, Ctrl+C/V are not Fabric history actions
fast undo then redo requests preserve order
every request carries current generations, sessionId and unique actionId
```

- [ ] **Step 2: host RED tests 작성**

```text
undo and redo pass the allowlist; unknown action is rejected
same actionId in-flight and completed executes runtime once
different undo/redo actionIds execute in request order
overlay-origin Ctrl+Z/Y/Shift+Z executes one history action without main sendInputEvent
overlay auto-repeat is consumed without action
non-history B/V/Delete/Space forwarding remains unchanged
host response does not expose scene objects or deleted IDs
```

- [ ] **Step 3: RED 확인**

Run:

```powershell
node --test scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/mpv-overlay-host.test.js
```

Expected: modifier 거부, host allowlist, action serialization, overlay history intercept 부재로 FAIL.

- [ ] **Step 4: controller 의미 기반 action과 queue 구현**

```js
let drawingActionQueue = Promise.resolve();

function enqueueDrawingAction(action) {
  const operation = drawingActionQueue.then(() => applyDrawingAction(action));
  drawingActionQueue = operation.catch(() => false);
  return operation;
}
```

history 조합은 일반 modifier 거부보다 먼저 `event.code` 중심으로 판정한다. editable/IME 검사는 그보다 먼저 유지한다.

- [ ] **Step 5: host allowlist, 직렬 queue, overlay-origin 처리 구현**

host의 `applyDrawingAction()`은 모든 action을 하나의 queue에서 `_performDrawingAction()` 순서대로 실행한다. 기존 completed/in-flight dedupe는 queue 앞에서 유지한다.

`before-input-event`에서 정확한 accelerator와 `KeyZ`/`KeyY`를 판정해 현재 token으로 `undo` 또는 `redo` action을 만들고 직접 queue에 넣는다. history keyDown/keyUp은 main으로 재전송하지 않는다.

- [ ] **Step 6: integration GREEN 확인**

Run:

```powershell
node --test scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/fabric-drawing-pilot-integration.test.js
```

Expected: 관련 tests 모두 PASS, unhandled rejection 0.

- [ ] **Step 7: Task 4 커밋**

```powershell
git add -- renderer/scripts/modules/fabric-drawing-pilot-controller.js main/mpv-overlay-host.js scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/fabric-drawing-pilot-integration.test.js
git commit -m "feat: Fabric 실행 취소 다시 실행 단축키 연결"
```

---

### Task 5: 번들, 전체 회귀, 독립 리뷰, 분리 앱 검증

**Files:**
- Regenerate: `renderer/scripts/lib/mpv-fabric-overlay.iife.js`
- Update runtime ledger: `.superpowers/sdd/progress.md` (git-ignored, do not stage)

**Interfaces:**
- Consumes all prior tasks.
- Produces a packaged isolated test app only; no deployment and no existing-process mutation.

- [ ] **Step 1: 공식 bundle 재생성**

```powershell
npm.cmd run bundle:mpv-fabric-overlay
```

Expected: exit 0, generated IIFE contains command history module and matches source behavior.

- [ ] **Step 2: 집중 검증**

```powershell
node --test scripts/tests/drawing-v3-command-history.test.js scripts/tests/mpv-fabric-overlay-runtime.test.js
node --test scripts/tests/fabric-drawing-pilot-source.test.js scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/fabric-drawing-pilot-session.test.js scripts/tests/fabric-drawing-pilot-integration.test.js scripts/tests/fabric-drawing-pilot-benchmark.test.mjs scripts/tests/mpv-overlay-host.test.js scripts/tests/keyboard-shortcut-targets.test.js
npm.cmd run test:drawing
npm.cmd run test:mpv
git diff --check
```

Expected: 실패 0, 새 unhandled rejection 0, 알려진 module-type warning 외 새 경고 0.

- [ ] **Step 3: 독립 whole-branch review**

리뷰 범위는 `a1f4094..HEAD`다. 다음을 필수로 확인한다.

```text
selection-only no mutation/history
partial Delete exact undo/redo
second move is a separate command
history capacity atomicity
controller and host ordering
editable/IME/overlay focus behavior
no review persistence integration
```

Critical/Important finding은 수정 후 같은 test를 다시 실행하고 재리뷰한다.

- [ ] **Step 4: unpacked 앱 빌드**

```powershell
npm.cmd run build
npx.cmd electron-builder --dir
```

빌드 결과를 `.superpowers/sdd/builds/fabric-history-partial-delete-<timestamp>/win-unpacked`에 보존하고 executable, `resources/app.asar`, Fabric bundle SHA-256를 기록한다.

- [ ] **Step 5: 기존 인스턴스와 분리 실행**

환경변수와 인자:

```text
BAEFRAME_MPV_PILOT=1
BAEFRAME_FABRIC_DRAWING_PILOT=1
--fabric-drawing-pilot
--skip-shell-registration
--remote-debugging-port=<unused unique port>
--multi-instance-profile=fabric-history-partial-delete-<timestamp>
```

`.bframe`이 없는 테스트 영상 복사본을 사용한다. 기존 BAEFRAME 프로세스는 조회·종료·재사용하지 않는다.

- [ ] **Step 6: 실제 입력 검증**

```text
B 진입/종료와 Space 재생
V 획 선택 이동 -> Ctrl+Z -> Ctrl+Y
라쏘 부분 선택만 하고 취소 -> 화면과 history 무변화
라쏘 부분 이동 -> Ctrl+Z -> Ctrl+Y
라쏘 부분 Delete -> Ctrl+Z -> Ctrl+Y
두 번째 이동의 Undo가 직전 위치만 복원
overlay 포커스 상태의 Ctrl+Z/Y
저장 실패 알림 0, saveAttemptCount 0
```

- [ ] **Step 7: 최종 기능 커밋**

```powershell
git add -- renderer/scripts/lib/mpv-fabric-overlay.iife.js
git commit -m "test: Fabric 명령 이력 시험판 검증 완료"
```

사용자에게 새 분리 시험 앱을 전면에 열어 직접 확인하도록 한다.
