# Fabric Selection Settle and Cursor Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a moved Fabric multi-selection release safely so the next stroke can be dragged immediately, while giving thin strokes a stable six-screen-pixel hit area and truthful cursors.

**Architecture:** Keep the existing session scene store as the only mutation owner. Add a display-aware hit-policy helper inside the overlay runtime, then release only a successfully moved multi-selection in a guarded microtask after Fabric finishes its transform event. Exercise both changes through the existing fake harness and an installed-Fabric 7.4 interaction harness before rebuilding the browser bundle.

**Tech Stack:** Electron 28, Fabric.js 7.4.0, CommonJS, Node.js `node:test`, esbuild, electron-builder.

## Global Constraints

- Work only in `C:/Users/user/.codex/worktrees/fabric-brush-style-v1/BAEFRAME` on `codex/baeframe-fabric-brush-style-v1`.
- Do not modify or launch from `C:/BAEframe/BAEFRAME`.
- Do not inspect, focus, close, or reuse any existing BAEFRAME process.
- Multi-selection auto-release applies only after a real move of two or more strokes; an unmoved marquee and a moved single stroke stay selected.
- Keep `V` active after multi-selection release.
- Selection release must not increase mutation, dirty, object, or save-attempt counters.
- Cursor contract: brush `crosshair`, select blank `default`, selectable stroke `grab`, active drag `grabbing`.
- Target hit margin is six displayed CSS pixels, converted to Fabric logical pixels and clamped to integer range 2 through 96.
- No persistence, Undo/Redo, eraser, partial-stroke lasso cutting, or HTML drawing-engine changes.
- Regenerate `renderer/scripts/lib/mpv-fabric-overlay.iife.js` from source; never edit it by hand.
- Commit messages are concise Korean descriptions of what, how, and why.

---

## File Map

- Modify `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`: own hit tolerance, cursor state, and deferred multi-selection release.
- Modify `scripts/tests/mpv-fabric-overlay-runtime.test.js`: extend the fake Canvas contract and add fake/real Fabric regression coverage.
- Regenerate `renderer/scripts/lib/mpv-fabric-overlay.iife.js`: browser artifact produced from the runtime source.
- Do not modify app playback, timeline, persistence, IPC, or HTML drawing-engine files.

### Task 1: Display-aware stroke hit area and cursor policy

**Files:**
- Modify: `scripts/tests/mpv-fabric-overlay-runtime.test.js:94-179, 370-458, 840-909`
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js:13-39, 875-972, 1197-1221, 1347-1352`
- Regenerate: `renderer/scripts/lib/mpv-fabric-overlay.iife.js`

**Interfaces:**
- Consumes: normalized session fields `sourceWidth`, `sourceHeight`, `canvasRect`, and `viewportTransform.scale`.
- Produces: `resolveSelectionHitTolerance(session): number`, returning an integer from 2 through 96; runtime-owned Canvas/Path cursor policy.

- [ ] **Step 1: Extend only the fake Canvas test harness with observable cursor and tolerance methods**

After the existing `this.options = options` assignment in `FakeCanvas`, add these exact observable fields and methods so tests model the real Fabric API without changing production APIs:

```js
this.defaultCursor = options.defaultCursor;
this.hoverCursor = options.hoverCursor;
this.moveCursor = options.moveCursor;
this.freeDrawingCursor = options.freeDrawingCursor;
this.targetFindTolerance = 0;
this.cursorHistory = [];

// Add these methods to FakeCanvas.
setTargetFindTolerance(value) {
  this.targetFindTolerance = Math.round(value);
}

setCursor(value) {
  this.upperCanvasEl.style.cursor = value;
  this.cursorHistory.push(value);
}
```

- [ ] **Step 2: Write failing cursor and viewport-scale tests**

Add `resolveSelectionHitTolerance` to the existing runtime import destructuring at the top of the test file. Update the existing `prepare creates one Fabric canvas` option assertion to include these exact fields:

```js
assert.deepEqual(FakeCanvas.instances[0].options, {
  selection: true,
  preserveObjectStacking: true,
  enableRetinaScaling: false,
  defaultCursor: 'default',
  hoverCursor: 'grab',
  moveCursor: 'grabbing',
  freeDrawingCursor: 'crosshair'
});
```

Add a test that uses the normal fake runtime, draws one stroke, and proves the exact policy:

```js
test('selection hit margin and cursors follow displayed pixels without scene mutations', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });

  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  drawStroke(canvas.upperCanvasEl, 61);
  const path = canvas.getObjects()[0];
  const before = runtime.getDiagnostics();

  assert.equal(canvas.defaultCursor, 'crosshair');
  assert.equal(canvas.upperCanvasEl.style.cursor, 'crosshair');
  assert.equal(canvas.targetFindTolerance, 12);
  assert.equal(path.padding, 12);
  assert.equal(path.hoverCursor, 'grab');
  assert.equal(path.moveCursor, 'grabbing');

  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });
  assert.equal(canvas.defaultCursor, 'default');
  assert.equal(canvas.upperCanvasEl.style.cursor, 'default');

  runtime.updateViewport({
    revision: 1,
    canvasRect: { left: 0, top: 0, width: 960, height: 540 },
    scale: 2,
    panX: 0,
    panY: 0
  });
  assert.equal(canvas.targetFindTolerance, 6);
  assert.equal(path.padding, 6);
  assert.equal(runtime.getDiagnostics().mutationCount, before.mutationCount);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
});
```

Also add a direct pure-function boundary test for invalid, minimum, normal, and clamped values:

```js
assert.equal(resolveSelectionHitTolerance({}), 6);
assert.equal(resolveSelectionHitTolerance(makeInput().session), 12);
assert.equal(resolveSelectionHitTolerance({
  sourceWidth: 1920,
  sourceHeight: 1080,
  canvasRect: { width: 960, height: 540 },
  viewportTransform: { scale: 2 }
}), 6);
assert.equal(resolveSelectionHitTolerance({
  sourceWidth: 1920,
  sourceHeight: 1080,
  canvasRect: { width: 960, height: 540 },
  viewportTransform: { scale: 0.5 }
}), 24);
assert.equal(resolveSelectionHitTolerance({
  sourceWidth: 100,
  sourceHeight: 100,
  canvasRect: { width: 1200, height: 1200 },
  viewportTransform: { scale: 2 }
}), 2);
assert.equal(resolveSelectionHitTolerance({
  sourceWidth: 7680,
  sourceHeight: 4320,
  canvasRect: { width: 100, height: 56.25 },
  viewportTransform: { scale: 0.25 }
}), 96);
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: FAIL because `resolveSelectionHitTolerance` is not exported and the runtime does not set Path padding or explicit cursor values. Existing tests must continue to run rather than error during setup.

- [ ] **Step 4: Implement the logical hit-tolerance helper**

Add constants beside the current brush constants and add the pure helper after viewport normalization:

```js
const SELECTION_HIT_MARGIN_CSS_PX = 6;
const MIN_SELECTION_HIT_TOLERANCE = 2;
const MAX_SELECTION_HIT_TOLERANCE = 96;

function resolveSelectionHitTolerance(session = {}) {
  const rect = session.canvasRect || {};
  const sourceWidth = Math.max(0, finiteNumber(session.sourceWidth));
  const sourceHeight = Math.max(0, finiteNumber(session.sourceHeight));
  const displayWidth = Math.max(0, finiteNumber(rect.width));
  const displayHeight = Math.max(0, finiteNumber(rect.height));
  const scale = normalizeViewportTransform(session.viewportTransform).scale;
  if (!sourceWidth || !sourceHeight || !displayWidth || !displayHeight) {
    return SELECTION_HIT_MARGIN_CSS_PX;
  }
  const sourcePerCssPixel = Math.max(
    sourceWidth / displayWidth / scale,
    sourceHeight / displayHeight / scale
  );
  return Math.min(
    MAX_SELECTION_HIT_TOLERANCE,
    Math.max(MIN_SELECTION_HIT_TOLERANCE, Math.ceil(SELECTION_HIT_MARGIN_CSS_PX * sourcePerCssPixel))
  );
}
```

Export `resolveSelectionHitTolerance` in `module.exports` for a pure unit contract.

- [ ] **Step 5: Apply the hit and cursor policy at object creation, tool transition, and viewport transition**

Add a runtime helper and call it from `applyViewport` after dimensions are updated:

```js
function applySelectionHitPolicy(session = currentSession) {
  if (!fabricCanvas) return;
  const tolerance = resolveSelectionHitTolerance(session || {});
  fabricCanvas.setTargetFindTolerance?.(tolerance);
  for (const object of fabricCanvas.getObjects()) {
    if (object.__baeframeTransient) continue;
    object.set({ padding: tolerance, hoverCursor: 'grab', moveCursor: 'grabbing' });
    object.setCoords?.();
  }
}
```

Set the same properties in `makeFabricPath` so paths restored after `applyViewport` receive the current value:

```js
padding: transient ? 0 : resolveSelectionHitTolerance(currentSession || {}),
hoverCursor: transient ? null : 'grab',
moveCursor: transient ? null : 'grabbing',
```

In `applyMoveOnlyConstraints`, set `hoverCursor: 'grab'` and `moveCursor: 'grabbing'` so real `ActiveSelection` objects follow the same policy.

Create the Fabric Canvas with explicit defaults:

```js
fabricCanvas = new Canvas(canvasElement, {
  selection: true,
  preserveObjectStacking: true,
  enableRetinaScaling: false,
  defaultCursor: 'default',
  hoverCursor: 'grab',
  moveCursor: 'grabbing',
  freeDrawingCursor: 'crosshair'
});
```

In `setToolMode`, set and render the current default cursor:

```js
fabricCanvas.defaultCursor = selectMode ? 'default' : 'crosshair';
fabricCanvas.hoverCursor = 'grab';
fabricCanvas.moveCursor = 'grabbing';
fabricCanvas.freeDrawingCursor = 'crosshair';
fabricCanvas.setCursor?.(fabricCanvas.defaultCursor);
```

When input is disabled, call `fabricCanvas?.setCursor?.('default')` after pointer events are removed so no stale move cursor remains on the hidden surface.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: all tests PASS; the new test reports exact 12-to-6 tolerance conversion and unchanged mutation/save counters.

- [ ] **Step 7: Regenerate the overlay and commit Task 1**

Run:

```powershell
npm.cmd run bundle:mpv-fabric-overlay
git diff --check
git add renderer/scripts/modules/mpv-fabric-overlay-runtime.js scripts/tests/mpv-fabric-overlay-runtime.test.js renderer/scripts/lib/mpv-fabric-overlay.iife.js
git commit -m "fix: Fabric 획 선택 커서와 판정 범위 보강"
```

Expected: bundle succeeds, diff check is empty, and the commit contains only the three declared files.

### Task 2: Release a moved multi-selection after Fabric settles

**Files:**
- Modify: `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js:546-579, 1114-1182, 1233-1245`
- Regenerate: `renderer/scripts/lib/mpv-fabric-overlay.iife.js`

**Interfaces:**
- Consumes: existing `transformStart`, `sceneStore.transformSelection`, `tokenState.inputRevision`, `currentSession.sessionId`, and Fabric `getActiveObject()` identity.
- Produces: `scheduleMovedMultiSelectionRelease(target, selectedIds): void`, which changes selection state only after the current Fabric event and never changes scene mutation state.

- [ ] **Step 1: Add an installed-Fabric interaction harness to the runtime test file**

Use `fabric/node` only in tests. Add this helper after the existing fake helper functions. It creates the real runtime, captures the real Canvas instance, fixes `getBoundingClientRect` for jsdom, dispatches runtime pointer events for strokes, and dispatches Fabric mouse events for marquee and drag:

```js
function createRealFabricHarness() {
  const realFabric = require('fabric/node');
  const environment = realFabric.getEnv();
  const canvases = [];
  const sceneStore = createSessionSceneStore();
  class CaptureCanvas extends realFabric.Canvas {
    constructor(...args) {
      super(...args);
      this.__disposePromise = Promise.resolve();
      canvases.push(this);
    }

    dispose() {
      const result = super.dispose();
      this.__disposePromise = Promise.resolve(result);
      return result;
    }
  }
  const root = environment.document.createElement('div');
  environment.document.body.appendChild(root);
  const runtime = createFabricOverlayRuntime({
    fabric: { ...realFabric, Canvas: CaptureCanvas },
    document: environment.document,
    window: environment.window,
    sceneStore
  });
  runtime.prepare(root);
  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 1,
    enabled: true,
    session: {
      sessionId: 'real-fabric-session',
      stableVideoIdentity: 'real-fabric-video',
      targetFrame: 0,
      sourceWidth: 200,
      sourceHeight: 200,
      canvasRect: { left: 0, top: 0, width: 200, height: 200 },
      viewportTransform: { scale: 1, panX: 0, panY: 0 },
      tool: 'brush'
    }
  });

  const canvas = canvases[0];
  const element = canvas.upperCanvasEl;
  const rect = {
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    toJSON() { return this; }
  };
  for (const node of [canvas.upperCanvasEl, canvas.lowerCanvasEl, canvas.wrapperEl]) {
    node.getBoundingClientRect = () => rect;
  }
  canvas.calcOffset();

  function dispatchPointer(type, x, y, pointerId) {
    const event = new environment.window.Event(type, { bubbles: true, cancelable: true });
    for (const [name, value] of Object.entries({
      clientX: x,
      clientY: y,
      pointerId,
      pointerType: 'mouse',
      button: 0,
      pressure: 0.5
    })) {
      Object.defineProperty(event, name, { value });
    }
    element.dispatchEvent(event);
  }

  function dispatchMouse(target, type, x, y, buttons = type === 'mousedown' ? 1 : 0) {
    target.dispatchEvent(new environment.window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons
    }));
  }

  function drawStrokeAt(y, pointerId) {
    dispatchPointer('pointerdown', 20, y, pointerId);
    dispatchPointer('pointermove', 60, y, pointerId);
    dispatchPointer('pointerup', 60, y, pointerId);
  }

  function dragMarquee(from, to) {
    dispatchMouse(element, 'mousedown', from.x, from.y);
    dispatchMouse(environment.document, 'mousemove', to.x, to.y, 1);
    dispatchMouse(environment.document, 'mouseup', to.x, to.y);
  }

  function dragActiveSelectionBy(dx, dy) {
    const center = canvas.getActiveObject().getCenterPoint();
    dispatchMouse(element, 'mousedown', center.x, center.y);
    dispatchMouse(environment.document, 'mousemove', center.x + dx, center.y + dy, 1);
    dispatchMouse(environment.document, 'mouseup', center.x + dx, center.y + dy);
  }

  function dragStrokeBy(index, dx, dy, onMove) {
    const center = canvas.getObjects()[index].getCenterPoint();
    dispatchMouse(element, 'mousedown', center.x, center.y);
    dispatchMouse(environment.document, 'mousemove', center.x + dx, center.y + dy, 1);
    onMove?.();
    dispatchMouse(environment.document, 'mouseup', center.x + dx, center.y + dy);
  }

  function hoverAt(x, y) {
    dispatchMouse(element, 'mousemove', x, y);
  }

  function sceneTransforms() {
    return sceneStore.getActiveSceneSnapshot().objects.map(object => ({
      left: Number(object.transform?.left) || 0,
      top: Number(object.transform?.top) || 0
    }));
  }

  return {
    runtime,
    canvas,
    environment,
    drawStrokeAt,
    dragMarquee,
    dragActiveSelectionBy,
    dragStrokeBy,
    hoverAt,
    sceneTransforms,
    async destroy() {
      runtime.destroy();
      await canvas.__disposePromise;
      root.remove();
    }
  };
}
```

Immediately use the harness to lock Task 1's browser-library behavior before adding Task 2 production code:

```js
test('real Fabric thin stroke hit margin drives honest hover cursors', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStrokeAt(30, 70);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    const center = harness.canvas.getObjects()[0].getCenterPoint();

    harness.hoverAt(center.x, center.y + 5);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grab');
    harness.hoverAt(center.x, center.y + 20);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'default');
    harness.dragStrokeBy(0, 2, 0, () => {
      assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grabbing');
    });
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grab');
  } finally {
    await harness.destroy();
  }
});
```

Run this named test once. Expected: PASS against Task 1, proving both Fabric's coarse bounding-box gate and per-pixel gate receive the converted tolerance.

The helper's `destroy()` must call `runtime.destroy()` and remove the root so tests cannot leak listeners or DOM state.

- [ ] **Step 2: Write the failing real-Fabric regression test**

Add an async test with a `try/finally` cleanup:

```js
test('moved real Fabric marquee settles before the next single-stroke drag', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStrokeAt(30, 71);
    harness.drawStrokeAt(70, 72);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });

    harness.dragMarquee({ x: 10, y: 10 }, { x: 100, y: 100 });
    assert.equal(harness.canvas.getActiveObjects().length, 2);
    harness.dragActiveSelectionBy(20, 10);
    await Promise.resolve();

    assert.equal(harness.canvas.getActiveObjects().length, 0);
    assert.equal(harness.runtime.getDiagnostics().selectionCount, 0);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 3);

    const before = harness.sceneTransforms();
    harness.dragStrokeBy(0, 15, 5);
    const after = harness.sceneTransforms();
    assert.deepEqual(after[0], { ...before[0], left: before[0].left + 15, top: before[0].top + 5 });
    assert.deepEqual(after[1], before[1]);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 4);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});
```

Add this second guard test using an injected microtask queue. It changes membership on the same ActiveSelection identity, then invalidates another queued release by disabling input. Both queued tasks must be harmless:

```js
test('stale multi-selection release respects membership and input revisions', () => {
  FakeCanvas.instances = [];
  const queuedMicrotasks = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    queueMicrotask: callback => queuedMicrotasks.push(callback)
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  drawStroke(canvas.upperCanvasEl, 81);
  drawStroke(canvas.upperCanvasEl, 82);
  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });

  const [first, second] = canvas.getObjects();
  const group = new FakePath('');
  let members = [first, second];
  group.type = 'activeselection';
  group.getObjects = () => members;
  canvas.activeObject = group;
  canvas.activeObjects = members;
  canvas.emit('selection:created', { selected: [first, second] });
  canvas.emit('before:transform', { target: group, transform: { target: group } });
  group.left += 10;
  canvas.emit('object:modified', { target: group });

  assert.equal(queuedMicrotasks.length, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 3);
  members = [first];
  canvas.activeObjects = [first];
  canvas.emit('selection:updated', { selected: [first], deselected: [second] });
  queuedMicrotasks.shift()();

  assert.equal(canvas.getActiveObject(), group);
  assert.equal(runtime.getDiagnostics().selectionCount, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 3);

  members = [first, second];
  canvas.activeObjects = members;
  canvas.emit('selection:updated', { selected: members, deselected: [] });
  canvas.emit('before:transform', { target: group, transform: { target: group } });
  group.left += 5;
  canvas.emit('object:modified', { target: group });
  assert.equal(queuedMicrotasks.length, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 4);

  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    enabled: false
  });
  queuedMicrotasks.shift()();
  assert.equal(runtime.getDiagnostics().state, 'passive');
  assert.equal(runtime.getDiagnostics().mutationCount, 4);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
});
```

- [ ] **Step 3: Run the real-Fabric regression and verify RED**

Run:

```powershell
node --test --test-name-pattern "moved real Fabric marquee|stale multi-selection release" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: FAIL because the real ActiveSelection remains active after the group move; mutation count remains 3 at that point, proving persistence succeeded while selection settlement is missing.

- [ ] **Step 4: Add an injectable microtask scheduler and guarded release helper**

Resolve the scheduler once in `createFabricOverlayRuntime`:

```js
const queueMicrotaskRef = options.queueMicrotask ||
  windowRef?.queueMicrotask?.bind(windowRef) ||
  globalThis.queueMicrotask?.bind(globalThis) ||
  (callback => Promise.resolve().then(callback));
```

Add the guarded helper beside selection event handlers:

```js
function scheduleMovedMultiSelectionRelease(target, selectedIds) {
  const sessionId = currentSession?.sessionId;
  const inputRevision = tokenState.inputRevision;
  const expectedSelection = [...selectedIds].sort().join(SCENE_KEY_SEPARATOR);
  queueMicrotaskRef(() => {
    if (destroyed || !inputEnabled || !fabricCanvas) return;
    if (currentSession?.sessionId !== sessionId || tokenState.inputRevision !== inputRevision) return;
    if (fabricCanvas.getActiveObject?.() !== target) return;
    if (selectionIds().sort().join(SCENE_KEY_SEPARATOR) !== expectedSelection) return;
    fabricCanvas.discardActiveObject();
    sceneStore.selectObjects([]);
    fabricCanvas.setCursor?.(fabricCanvas.defaultCursor || 'default');
    fabricCanvas.requestRenderAll();
  });
}
```

In `onObjectModified`, preserve the current mutation logic, set `transformStart = null`, then schedule only a successful multi-object transform:

```js
const shouldReleaseMultiSelection = result.applied && children.length > 1;
transformStart = null;
if (result.applied) updateObjectMetric();
if (shouldReleaseMultiSelection) scheduleMovedMultiSelectionRelease(target, ids);
```

Do not call `discardActiveObject()` synchronously inside `object:modified`; Fabric clears `_currentTransform` only after firing its mouse-up events.

- [ ] **Step 5: Run Task 2 tests and verify GREEN**

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: all runtime tests PASS. The real Fabric test must show zero active objects after the microtask, only the first stroke moving in the next drag, exactly four total mutations, and zero save attempts.

- [ ] **Step 6: Regenerate the overlay and commit Task 2**

Run:

```powershell
npm.cmd run bundle:mpv-fabric-overlay
git diff --check
git add renderer/scripts/modules/mpv-fabric-overlay-runtime.js scripts/tests/mpv-fabric-overlay-runtime.test.js renderer/scripts/lib/mpv-fabric-overlay.iife.js
git commit -m "fix: 다중 선택 이동 후 획 재선택 복원"
```

Expected: bundle succeeds and the commit changes only the three declared files.

### Task 3: Full verification, independent review, isolated build, and user handoff

**Files:**
- Verify only: all branch changes from `20072d9` through Task 2 HEAD.
- Build output: `dist/win-unpacked/` (gitignored).

**Interfaces:**
- Consumes: Task 1 and Task 2 commits.
- Produces: reviewed unpacked test app launched under a unique profile, plus an exact user validation checklist.

- [ ] **Step 1: Run the focused Fabric regression set**

Run:

```powershell
node --test scripts/tests/fabric-drawing-pilot-source.test.js scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/fabric-drawing-pilot-session.test.js scripts/tests/fabric-drawing-pilot-integration.test.js scripts/tests/fabric-drawing-pilot-benchmark.test.mjs scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/keyboard-shortcut-targets.test.js
```

Expected: exit code 0, zero failures, and benchmark output present.

- [ ] **Step 2: Run legacy drawing and mpv suites**

Run independently:

```powershell
npm.cmd run test:drawing
npm.cmd run test:mpv
```

Expected: both exit code 0 with zero failures.

- [ ] **Step 3: Verify generated parity and branch scope**

Run:

```powershell
npm.cmd run bundle:mpv-fabric-overlay
git status --short
git diff --check 20072d9..HEAD
git diff --name-only 20072d9..HEAD
```

Expected: clean status; branch files are the two docs plus runtime, runtime test, and generated IIFE only.

- [ ] **Step 4: Request independent code review**

Review `20072d9..HEAD` for critical, important, and minor findings. The reviewer must specifically check Fabric event re-entry, stale microtasks, cursor ownership, display-to-source tolerance conversion, mutation/save invariants, and forbidden playback/persistence changes. Resolve every critical or important finding with a new failing test before continuing.

- [ ] **Step 5: Build the isolated unpacked app**

Run:

```powershell
npm.cmd run build
```

Expected: exit code 0 and `dist/win-unpacked/BFRAME_alpha_v2.exe` plus `dist/win-unpacked/resources/app.asar` exist.

Compute SHA-256 for both artifacts and use `@electron/asar.extractFile` to prove the packed `renderer/scripts/lib/mpv-fabric-overlay.iife.js` byte-for-byte equals the worktree file.

- [ ] **Step 6: Launch without touching existing BAEFRAME instances**

Start only the newly built executable with:

```text
--fabric-drawing-pilot
--skip-shell-registration
--multi-instance-profile=fabric-selection-settle-<timestamp>
```

Set `BAEFRAME_MPV_PILOT=1` and `BAEFRAME_FABRIC_DRAWING_PILOT=1` only in the child launch environment, then restore the shell environment. Do not enumerate or stop any BAEFRAME process.

- [ ] **Step 7: Give the user the exact validation sequence and stop before the next phase**

Ask the user to verify:

1. Draw two thin strokes.
2. Press `V`, marquee-select both, and move the group.
3. Confirm the selection rectangle disappears but `V` stays active.
4. Without clicking blank space, hover one stroke and confirm `grab`.
5. Drag it and confirm only that stroke moves with `grabbing` during drag.
6. Confirm blank space uses the normal cursor and thin strokes are easy to acquire.
7. Play, toggle B, and use Space again; confirm no lock, flicker, duplicate playback, timeline jump, or save-failure notification.

Do not start Undo/Redo or any later drawing feature until the user reports this checkpoint passed.
