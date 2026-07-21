# Fabric Brush Style Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 검증한 `94048cd` Fabric 시험판에 세션 전용 8색·1–50px·10–100% 브러시 설정을 추가하고 기존 B/mpv/타임라인/무저장 계약을 그대로 보존한다.

**Architecture:** 브러시 설정의 유일한 소유자는 `mpv-fabric-overlay-runtime.js` 안의 로컬 `brushStyle`이다. 툴바 설정 패널과 새 획 생성만 이 상태를 읽으며, 포인터 시작 시 복사한 스타일을 preview·final·scene record에 함께 사용한다. main renderer, controller, IPC, 사용자 설정, 리뷰 저장에는 새 연결을 만들지 않는다.

**Tech Stack:** Electron overlay BrowserWindow, Fabric.js 7.4.0, perfect-freehand 1.2.3, Node.js `node:test`, esbuild IIFE bundle

## Global Constraints

- 기준 커밋은 `94048cdf7da0f5e7d1ad5b0a5e563103f698bb57`이다.
- 수정 가능한 제품 소스는 `renderer/scripts/modules/mpv-fabric-overlay-runtime.js` 하나다.
- 수정 가능한 테스트는 `scripts/tests/mpv-fabric-overlay-runtime.test.js` 하나다.
- `renderer/scripts/lib/mpv-fabric-overlay.iife.js`는 `npm.cmd run bundle:mpv-fabric-overlay`로만 재생성한다.
- `renderer/scripts/app.js`, `renderer/scripts/modules/fabric-drawing-pilot-controller.js`, `main/mpv-overlay-host.js`, preload, IPC, timeline, ReviewDataManager, user-settings, 기존 DrawingCanvas/Manager/Layer는 수정하지 않는다.
- 팔레트 순서는 `#ff4757`, `#ffd000`, `#26de81`, `#4a9eff`, `#ffffff`, `#000000`, `#1abc9c`, `#ff6b9d`이다.
- 기본값은 `#ff4757`, `3px`, `100%`이다.
- 크기는 `1..50`, 불투명도 UI는 `10..100`, 획 레코드 불투명도는 `0.1..1`이다.
- 설정 변경은 기존 획을 바꾸지 않으며 scene dirty/mutation/object/save 카운터를 바꾸지 않는다.
- `onPointerDown()`에서 스타일을 복사해 한 획의 preview와 final에 같은 값을 사용한다.
- B warm disable/enable과 같은 overlay runtime 안의 프레임 이동에서는 설정을 유지하며 디스크에는 저장하지 않는다.
- range는 포인터 조작용이며 키보드는 Tab+Enter로 작동하는 `−/+` 버튼을 제공한다.
- 현재 실행 중인 다른 BAEFRAME 프로세스를 조회·종료·재사용하지 않는다.

---

### Task 1: 세션 전용 브러시 설정을 테스트 우선으로 구현

**Files:**
- Modify: `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Regenerate: `renderer/scripts/lib/mpv-fabric-overlay.iife.js`

**Interfaces:**
- Consumes: 기존 `createFabricOverlayRuntime(options)`, `createSessionSceneStore()`, `createStrokePathData()`, `addDomListener()`, `setStyles()`, `makeFabricPath()`, `activeStroke`, `sceneStore`
- Produces: 런타임 내부 `brushStyle`, `brushControls`, `setBrushColor()`, `setBrushSize()`, `setBrushOpacityPercent()`, `syncBrushControls()`; 새 공개 API와 새 IPC는 생산하지 않는다.
- DOM contract: `data-fabric-pilot-action="brush-settings|size-decrease|size-increase|opacity-decrease|opacity-increase"`, `data-fabric-pilot-panel="brush-settings"`, `data-fabric-pilot-color="#rrggbb"`, `data-fabric-pilot-setting="size|opacity"`, `data-fabric-pilot-output="summary|size|opacity|color-preview|size-preview"`.

- [ ] **Step 1: 테스트 fixture에 DOM 탐색 helper와 scene store import를 추가한다**

`scripts/tests/mpv-fabric-overlay-runtime.test.js`의 runtime import에 `createSessionSceneStore`를 추가한다.

```js
const {
  createFabricOverlayRuntime,
  createSessionSceneStore,
  createStrokePathData,
  resolveEffectiveCanvasRect,
  mapClientPointToSource
} = require(runtimePath);
```

`drawStroke` 아래에 실제 `children` 트리를 탐색하는 helper를 추가한다.

```js
function findAll(root, predicate) {
  if (!root) return [];
  const matches = predicate(root) ? [root] : [];
  return matches.concat((root.children || []).flatMap(child => findAll(child, predicate)));
}

function findOne(root, predicate) {
  return findAll(root, predicate)[0] || null;
}

function getBrushControls(root) {
  const toolbar = root.querySelectorAllByClass('mpv-fabric-pilot-toolbar')[0];
  return {
    toolbar,
    settingsButton: findOne(toolbar, node => node.dataset.fabricPilotAction === 'brush-settings'),
    panel: findOne(toolbar, node => node.dataset.fabricPilotPanel === 'brush-settings'),
    colorButtons: findAll(toolbar, node => typeof node.dataset.fabricPilotColor === 'string'),
    sizeInput: findOne(toolbar, node => node.dataset.fabricPilotSetting === 'size'),
    opacityInput: findOne(toolbar, node => node.dataset.fabricPilotSetting === 'opacity'),
    sizeOutput: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'size'),
    opacityOutput: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'opacity'),
    summary: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'summary'),
    colorPreview: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'color-preview'),
    sizePreview: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'size-preview'),
    sizeDecrease: findOne(toolbar, node => node.dataset.fabricPilotAction === 'size-decrease'),
    sizeIncrease: findOne(toolbar, node => node.dataset.fabricPilotAction === 'size-increase'),
    opacityDecrease: findOne(toolbar, node => node.dataset.fabricPilotAction === 'opacity-decrease'),
    opacityIncrease: findOne(toolbar, node => node.dataset.fabricPilotAction === 'opacity-increase')
  };
}
```

- [ ] **Step 2: 기본 UI와 설정-only 무변경 계약 테스트를 먼저 작성한다**

다음 테스트를 추가한다. 테스트는 정확한 팔레트, 기본값, 범위, ARIA, 패널 토글, clamp, `−/+`, 설정 변경이 scene mutation이 아님을 한 번에 검증한다.

```js
test('brush settings expose the familiar bounded palette without mutating the scene', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());

  const controls = getBrushControls(root);
  const before = runtime.getDiagnostics();
  assert.ok(controls.settingsButton);
  assert.ok(controls.panel);
  assert.equal(controls.settingsButton.getAttribute('aria-expanded'), 'false');
  assert.equal(controls.panel.style.display, 'none');
  assert.equal(controls.panel.getAttribute('role'), 'group');
  assert.equal(controls.panel.getAttribute('aria-label'), '브러시 설정');
  assert.deepEqual(
    controls.colorButtons.map(button => button.dataset.fabricPilotColor),
    ['#ff4757', '#ffd000', '#26de81', '#4a9eff', '#ffffff', '#000000', '#1abc9c', '#ff6b9d']
  );
  assert.equal(controls.colorButtons[0].getAttribute('aria-pressed'), 'true');
  assert.deepEqual(
    controls.colorButtons.map(button => button.getAttribute('aria-label')),
    ['브러시 색상 빨강', '브러시 색상 노랑', '브러시 색상 초록', '브러시 색상 파랑',
      '브러시 색상 하양', '브러시 색상 검정', '브러시 색상 민트', '브러시 색상 핑크']
  );
  assert.equal(controls.sizeInput.type, 'range');
  assert.equal(controls.sizeInput.min, '1');
  assert.equal(controls.sizeInput.max, '50');
  assert.equal(controls.sizeInput.step, '1');
  assert.equal(controls.sizeInput.value, '3');
  assert.equal(controls.sizeInput.getAttribute('aria-label'), '브러시 크기');
  assert.equal(controls.opacityInput.min, '10');
  assert.equal(controls.opacityInput.max, '100');
  assert.equal(controls.opacityInput.step, '1');
  assert.equal(controls.opacityInput.value, '100');
  assert.equal(controls.opacityInput.getAttribute('aria-label'), '브러시 불투명도');
  assert.equal(controls.sizeDecrease.getAttribute('aria-label'), '브러시 크기 1px 줄이기');
  assert.equal(controls.sizeIncrease.getAttribute('aria-label'), '브러시 크기 1px 늘리기');
  assert.equal(controls.opacityDecrease.getAttribute('aria-label'), '브러시 불투명도 1% 줄이기');
  assert.equal(controls.opacityIncrease.getAttribute('aria-label'), '브러시 불투명도 1% 늘리기');
  assert.equal(controls.sizeOutput.textContent, '3px');
  assert.equal(controls.opacityOutput.textContent, '100%');
  assert.equal(controls.summary.textContent, '3px · 100%');
  assert.equal(controls.colorPreview.style.background, '#ff4757');
  assert.equal(controls.sizePreview.style.width, '3px');
  assert.equal(controls.sizePreview.style.height, '3px');
  assert.equal(controls.sizePreview.style.background, '#ff4757');
  assert.equal(controls.sizePreview.style.opacity, '1');

  controls.settingsButton.dispatch('click');
  assert.equal(controls.settingsButton.getAttribute('aria-expanded'), 'true');
  assert.equal(controls.panel.style.display, 'flex');

  controls.colorButtons[1].dispatch('click');
  controls.sizeInput.value = '24';
  controls.sizeInput.dispatch('input');
  controls.opacityInput.value = '40';
  controls.opacityInput.dispatch('input');
  assert.equal(controls.colorButtons[0].getAttribute('aria-pressed'), 'false');
  assert.equal(controls.colorButtons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(controls.sizeOutput.textContent, '24px');
  assert.equal(controls.opacityOutput.textContent, '40%');
  assert.equal(controls.summary.textContent, '24px · 40%');
  assert.equal(controls.colorPreview.style.background, '#ffd000');
  assert.equal(controls.sizePreview.style.width, '22px');
  assert.equal(controls.sizePreview.style.background, '#ffd000');
  assert.equal(controls.sizePreview.style.opacity, '0.4');

  controls.sizeDecrease.dispatch('click');
  assert.equal(controls.sizeInput.value, '23');
  controls.sizeIncrease.dispatch('click');
  controls.sizeIncrease.dispatch('click');
  assert.equal(controls.sizeInput.value, '25');
  controls.opacityDecrease.dispatch('click');
  assert.equal(controls.opacityInput.value, '39');
  controls.opacityIncrease.dispatch('click');
  controls.opacityIncrease.dispatch('click');
  assert.equal(controls.opacityInput.value, '41');

  controls.sizeInput.value = '1';
  controls.sizeInput.dispatch('input');
  controls.sizeDecrease.dispatch('click');
  assert.equal(controls.sizeInput.value, '1');
  controls.sizeInput.value = '50';
  controls.sizeInput.dispatch('input');
  controls.sizeIncrease.dispatch('click');
  assert.equal(controls.sizeInput.value, '50');
  controls.opacityInput.value = '10';
  controls.opacityInput.dispatch('input');
  controls.opacityDecrease.dispatch('click');
  assert.equal(controls.opacityInput.value, '10');
  controls.opacityInput.value = '100';
  controls.opacityInput.dispatch('input');
  controls.opacityIncrease.dispatch('click');
  assert.equal(controls.opacityInput.value, '100');

  controls.sizeInput.value = 'invalid';
  controls.sizeInput.dispatch('input');
  assert.equal(controls.sizeInput.value, '50');
  controls.opacityInput.value = 'invalid';
  controls.opacityInput.dispatch('input');
  assert.equal(controls.opacityInput.value, '100');

  const after = runtime.getDiagnostics();
  assert.equal(after.objectCount, before.objectCount);
  assert.equal(after.mutationCount, before.mutationCount);
  assert.equal(after.dirty, before.dirty);
  assert.equal(after.metrics.saveAttemptCount, before.metrics.saveAttemptCount);
});
```

- [ ] **Step 3: 획 스타일 고정·복원 테스트를 먼저 작성한다**

다음 테스트를 추가한다. 외부에 보관한 `sceneStore`로 새 공개 API 없이 실제 레코드를 검증한다.

```js
test('each stroke snapshots color size and opacity and warm reactivation restores mixed styles', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const sceneStore = createSessionSceneStore();
  const observedSizes = [];
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    sceneStore,
    strokePathFactory(samples, options) {
      observedSizes.push(options.size);
      return createStrokePathData(samples, options);
    }
  });
  const firstInput = makeInput();
  runtime.prepare(root);
  runtime.setDrawingInput(firstInput);
  const canvas = FakeCanvas.instances[0];
  const controls = getBrushControls(root);

  drawStroke(canvas.upperCanvasEl, 41);
  const firstCallCount = observedSizes.length;
  assert.equal(observedSizes.slice(0, firstCallCount).every(size => size === 3), true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects[0].style, {
    color: '#ff4757',
    size: 3,
    opacity: 1
  });
  assert.equal(canvas.getObjects()[0].fill, '#ff4757');
  assert.equal(canvas.getObjects()[0].opacity, 1);

  controls.colorButtons[1].dispatch('click');
  controls.sizeInput.value = '24';
  controls.sizeInput.dispatch('input');
  controls.opacityInput.value = '40';
  controls.opacityInput.dispatch('input');
  drawStroke(canvas.upperCanvasEl, 42);

  assert.equal(observedSizes.slice(firstCallCount).every(size => size === 24), true);
  const records = sceneStore.getActiveSceneSnapshot().objects;
  assert.deepEqual(records.map(record => record.style), [
    { color: '#ff4757', size: 3, opacity: 1 },
    { color: '#ffd000', size: 24, opacity: 0.4 }
  ]);
  assert.deepEqual(canvas.getObjects().map(path => [path.fill, path.opacity]), [
    ['#ff4757', 1],
    ['#ffd000', 0.4]
  ]);

  sceneStore.addStroke({
    id: 'legacy-opacity-less',
    type: 'stroke',
    pathData: 'M 0 0 L 1 1 Z',
    sourcePoints: [{ x: 0, y: 0, pressure: 0.5, pointerType: 'mouse', time: 0 }],
    style: { color: '#000000', size: 5 }
  });
  sceneStore.addStroke({
    id: 'legacy-invalid-opacity',
    type: 'stroke',
    pathData: 'M 1 1 L 2 2 Z',
    sourcePoints: [{ x: 1, y: 1, pressure: 0.5, pointerType: 'mouse', time: 1 }],
    style: { color: '#ff6b9d', size: 5, opacity: 0 }
  });

  controls.settingsButton.dispatch('click');
  assert.equal(controls.settingsButton.getAttribute('aria-expanded'), 'true');

  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    enabled: false
  });
  runtime.setDrawingInput({
    ...firstInput,
    inputRevision: 3,
    session: { ...firstInput.session, sessionId: 'runtime-session-restored' }
  });

  const restoredControls = getBrushControls(root);
  assert.equal(restoredControls.sizeInput.value, '24');
  assert.equal(restoredControls.opacityInput.value, '40');
  assert.equal(restoredControls.colorButtons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(restoredControls.settingsButton.getAttribute('aria-expanded'), 'true');
  assert.equal(restoredControls.panel.style.display, 'flex');
  assert.deepEqual(canvas.getObjects().map(path => [path.fill, path.opacity]), [
    ['#ff4757', 1],
    ['#ffd000', 0.4],
    ['#000000', 1],
    ['#ff6b9d', 1]
  ]);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);

  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 4,
    enabled: false
  });
  runtime.setDrawingInput({
    ...firstInput,
    inputRevision: 5,
    session: {
      ...firstInput.session,
      sessionId: 'runtime-session-frame-25',
      targetFrame: 25
    }
  });
  const nextFrameControls = getBrushControls(root);
  assert.equal(nextFrameControls.sizeInput.value, '24');
  assert.equal(nextFrameControls.opacityInput.value, '40');
  assert.equal(nextFrameControls.colorButtons[1].getAttribute('aria-pressed'), 'true');
});
```

진행 중 획의 스타일이 바뀌지 않는 별도 테스트도 추가한다.

```js
test('an active stroke keeps the pointerdown style while controls change', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const sceneStore = createSessionSceneStore();
  const observedSizes = [];
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    sceneStore,
    strokePathFactory(samples, options) {
      observedSizes.push(options.size);
      return createStrokePathData(samples, options);
    }
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  const controls = getBrushControls(root);

  canvas.upperCanvasEl.dispatch('pointerdown', {
    pointerId: 51,
    pointerType: 'pen',
    button: 0,
    clientX: 10,
    clientY: 20,
    pressure: 0.5,
    timeStamp: 1
  });
  controls.colorButtons[1].dispatch('click');
  controls.sizeInput.value = '24';
  controls.sizeInput.dispatch('input');
  controls.opacityInput.value = '40';
  controls.opacityInput.dispatch('input');
  canvas.upperCanvasEl.dispatch('pointermove', {
    pointerId: 51,
    pointerType: 'pen',
    clientX: 30,
    clientY: 40,
    pressure: 0.5,
    timeStamp: 2
  });
  const transient = canvas.getObjects().find(path => path.__baeframeTransient === true);
  assert.ok(transient);
  assert.equal(transient.fill, '#ff4757');
  assert.equal(transient.opacity, 1);
  assert.equal(observedSizes.every(size => size === 3), true);
  canvas.upperCanvasEl.dispatch('pointerup', {
    pointerId: 51,
    pointerType: 'pen',
    clientX: 50,
    clientY: 60,
    pressure: 0.5,
    timeStamp: 3
  });

  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects[0].style, {
    color: '#ff4757',
    size: 3,
    opacity: 1
  });
  assert.equal(canvas.getObjects()[0].fill, '#ff4757');
  assert.equal(canvas.getObjects()[0].opacity, 1);
  assert.equal(observedSizes.every(size => size === 3), true);
});
```

- [ ] **Step 4: 새 테스트가 기존 코드에서 올바른 이유로 실패하는지 확인한다**

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: 기존 런타임에는 `brush-settings` 컨트롤과 opacity 렌더링이 없으므로 새 테스트만 FAIL하고 기존 테스트는 PASS한다. 구문 오류나 fixture 오류로 실패하면 구현하지 말고 테스트부터 수정한다.

- [ ] **Step 5: 런타임 로컬 브러시 상태와 정규화 helper를 구현한다**

`mpv-fabric-overlay-runtime.js` 상단 상수 영역에 다음 값을 추가한다.

```js
const BRUSH_COLORS = Object.freeze([
  '#ff4757',
  '#ffd000',
  '#26de81',
  '#4a9eff',
  '#ffffff',
  '#000000',
  '#1abc9c',
  '#ff6b9d'
]);
const BRUSH_COLOR_LABELS = Object.freeze({
  '#ff4757': '빨강',
  '#ffd000': '노랑',
  '#26de81': '초록',
  '#4a9eff': '파랑',
  '#ffffff': '하양',
  '#000000': '검정',
  '#1abc9c': '민트',
  '#ff6b9d': '핑크'
});
const DEFAULT_BRUSH_STYLE = Object.freeze({ color: '#ff4757', size: 3, opacity: 1 });
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 50;
const MIN_BRUSH_OPACITY_PERCENT = 10;
const MAX_BRUSH_OPACITY_PERCENT = 100;
```

`finiteNumber()` 아래에 다음 helper를 추가한다.

```js
function boundedInteger(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizePathOpacity(value) {
  if (value === null || value === undefined || value === '') return 1;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.1 || number > 1) return 1;
  return number;
}
```

`createFabricOverlayRuntime()`의 로컬 상태에 다음을 추가한다. `disableInput()`에서는 이 값을 초기화하지 않는다.

```js
let brushStyle = { ...DEFAULT_BRUSH_STYLE };
let brushControls = null;
let brushPanelOpen = false;
```

- [ ] **Step 6: 툴바 설정 버튼과 360px 이내 인라인 패널을 구현한다**

기존 `createButton()`, `addDomListener()`, `setStyles()`를 재사용한다. 구현은 다음 DOM 계약과 업데이트 함수를 그대로 제공해야 한다.

```js
function setBrushColor(color) {
  if (!BRUSH_COLORS.includes(color)) return brushStyle.color;
  brushStyle = { ...brushStyle, color };
  syncBrushControls();
  return brushStyle.color;
}

function setBrushSize(value) {
  brushStyle = {
    ...brushStyle,
    size: boundedInteger(value, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, brushStyle.size)
  };
  syncBrushControls();
  return brushStyle.size;
}

function setBrushOpacityPercent(value) {
  const currentPercent = Math.round(brushStyle.opacity * 100);
  const percent = boundedInteger(
    value,
    MIN_BRUSH_OPACITY_PERCENT,
    MAX_BRUSH_OPACITY_PERCENT,
    currentPercent
  );
  brushStyle = { ...brushStyle, opacity: percent / 100 };
  syncBrushControls();
  return percent;
}

function syncBrushControls() {
  if (!brushControls) return;
  const opacityPercent = Math.round(brushStyle.opacity * 100);
  brushControls.settingsButton.setAttribute('aria-expanded', String(brushPanelOpen));
  brushControls.panel.style.display = brushPanelOpen ? 'flex' : 'none';
  brushControls.sizeInput.value = String(brushStyle.size);
  brushControls.opacityInput.value = String(opacityPercent);
  brushControls.sizeOutput.textContent = `${brushStyle.size}px`;
  brushControls.opacityOutput.textContent = `${opacityPercent}%`;
  brushControls.summary.textContent = `${brushStyle.size}px · ${opacityPercent}%`;
  brushControls.colorPreview.style.background = brushStyle.color;
  brushControls.sizePreview.style.width = `${Math.min(22, Math.max(2, brushStyle.size))}px`;
  brushControls.sizePreview.style.height = brushControls.sizePreview.style.width;
  brushControls.sizePreview.style.background = brushStyle.color;
  brushControls.sizePreview.style.opacity = String(brushStyle.opacity);
  for (const button of brushControls.colorButtons) {
    const active = button.dataset.fabricPilotColor === brushStyle.color;
    button.setAttribute('aria-pressed', String(active));
    button.style.boxShadow = active
      ? '0 0 0 2px #fff, 0 0 0 4px rgba(255, 71, 87, 0.75)'
      : 'none';
  }
}
```

패널 생성 함수는 다음 조건을 모두 구현한다.

```js
// settingsButton
dataset.fabricPilotAction = 'brush-settings'
aria-expanded = 'false'
aria-label = '브러시 설정'

// panel
dataset.fabricPilotPanel = 'brush-settings'
role = 'group'
aria-label = '브러시 설정'
display = 'none'
position = 'absolute'
top = '52px'
left = '0'
width = '360px'
maxWidth = 'calc(100vw - 24px)'
flexDirection = 'column'

// palette button
dataset.fabricPilotColor = BRUSH_COLORS[index]
aria-label = `브러시 색상 ${BRUSH_COLOR_LABELS[color]}`
aria-pressed = 'true|false'
minWidth = '40px'
minHeight = '40px'
// 내부 22px 색상 점. #ffffff 점에는 rgba(0, 0, 0, 0.7) 테두리.

// size input
type = 'range'
min = '1'
max = '50'
step = '1'
dataset.fabricPilotSetting = 'size'
aria-label = '브러시 크기'

// opacity input
type = 'range'
min = '10'
max = '100'
step = '1'
dataset.fabricPilotSetting = 'opacity'
aria-label = '브러시 불투명도'
```

settings button 안에는 `data-fabric-pilot-output="color-preview"`인 현재 색상 점과 `summary`를 둔다. panel 안에는 `data-fabric-pilot-output="size-preview"`인 원형 크기 미리보기를 별도로 둔다.

두 range 행은 레이블, `−` 버튼, range, `+` 버튼, output 순서다. `−/+` 버튼은 각각 `size-decrease`, `size-increase`, `opacity-decrease`, `opacity-increase` action을 사용한다. 네 버튼의 `aria-label`은 각각 `브러시 크기 1px 줄이기`, `브러시 크기 1px 늘리기`, `브러시 불투명도 1% 줄이기`, `브러시 불투명도 1% 늘리기`로 고정한다. 다음 listener를 `addDomListener()`로 연결한다.

```js
addDomListener(settingsButton, 'click', () => {
  brushPanelOpen = !brushPanelOpen;
  syncBrushControls();
});
addDomListener(sizeInput, 'input', () => setBrushSize(sizeInput.value));
addDomListener(opacityInput, 'input', () => setBrushOpacityPercent(opacityInput.value));
addDomListener(sizeDecrease, 'click', () => setBrushSize(brushStyle.size - 1));
addDomListener(sizeIncrease, 'click', () => setBrushSize(brushStyle.size + 1));
addDomListener(opacityDecrease, 'click', () => {
  setBrushOpacityPercent(Math.round(brushStyle.opacity * 100) - 1);
});
addDomListener(opacityIncrease, 'click', () => {
  setBrushOpacityPercent(Math.round(brushStyle.opacity * 100) + 1);
});
for (const button of colorButtons) {
  addDomListener(button, 'click', () => setBrushColor(button.dataset.fabricPilotColor));
}
```

`prepare()`에서 기존 네 action button 뒤, badge 앞에 settings button을 붙이고 panel도 toolbar의 child로 붙인다. 생성 직후 `brushControls`를 완성하고 `syncBrushControls()`를 호출한다. `releaseSurfaceResources()`에서는 `brushControls = null`만 수행하며 `brushStyle`은 건드리지 않는다.

- [ ] **Step 7: 포인터 시작 스타일을 preview·final·restore에 일관되게 적용한다**

`makeFabricPath()`의 Path options에 다음 opacity를 추가한다.

```js
fill: record.style?.color || DEFAULT_BRUSH_STYLE.color,
opacity: normalizePathOpacity(record.style?.opacity),
```

`onPointerDown()`에서 현재 스타일을 복사한다.

```js
activeStroke = {
  pointerId: event.pointerId,
  samples: [],
  preview: null,
  style: { ...brushStyle }
};
```

`updateTransientPreview()`는 `currentSession.toolOptions` 대신 `activeStroke.style`만 사용한다.

```js
const strokeData = strokePathFactory(activeStroke.samples, { size: activeStroke.style.size });
activeStroke.preview = makeFabricPath({
  id: null,
  pathData: strokeData.pathData,
  style: { ...activeStroke.style }
}, true);
```

`finalizeActiveStroke()`는 `activeStroke`를 지우기 전에 samples와 style을 각각 복사하고 같은 style을 저장한다.

```js
const samples = activeStroke.samples;
const style = { ...activeStroke.style };
const strokeData = strokePathFactory(samples, { size: style.size, last: true });
const record = {
  id: createId('stroke'),
  type: 'stroke',
  pathData: strokeData.pathData,
  sourcePoints: strokeData.sourcePoints,
  style
};
```

`currentSession.toolOptions`의 기존 color/size fallback 사용은 모두 제거한다. scene store mutation은 기존 `addStroke(record)` 한 번만 유지한다.

- [ ] **Step 8: 집중 테스트를 실행해 GREEN을 확인한다**

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: 모든 runtime 테스트 PASS, 실패 0. 새 테스트는 실제 `sceneStore`와 실제 `createStrokePathData()`를 사용해야 하며 production에 test-only API를 추가하지 않는다.

- [ ] **Step 9: Fabric 브라우저 번들을 공식 명령으로 재생성한다**

Run:

```powershell
npm.cmd run bundle:mpv-fabric-overlay
```

Expected: exit 0, `renderer/scripts/lib/mpv-fabric-overlay.iife.js`만 생성 변경된다.

- [ ] **Step 10: 금지 파일과 생성물 경계를 검증한다**

Run:

```powershell
git status --short
git diff --name-only
git diff --check
```

Expected product/test paths:

```text
renderer/scripts/lib/mpv-fabric-overlay.iife.js
renderer/scripts/modules/mpv-fabric-overlay-runtime.js
scripts/tests/mpv-fabric-overlay-runtime.test.js
```

문서 외에 다른 파일이 보이면 커밋하지 말고 원인을 조사한다. 특히 Global Constraints의 수정 금지 파일은 diff가 0이어야 한다.

- [ ] **Step 11: 기존 핵심 계약을 포함한 집중 회귀 테스트를 실행한다**

Run:

```powershell
node --test scripts/tests/fabric-drawing-pilot-source.test.js scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/fabric-drawing-pilot-session.test.js scripts/tests/fabric-drawing-pilot-integration.test.js scripts/tests/fabric-drawing-pilot-benchmark.test.mjs scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/keyboard-shortcut-targets.test.js
```

Expected: 기준 112개와 새 테스트가 모두 PASS, 실패 0. 기존 module-type warning은 기준점에도 존재하는 경고이며 새 오류·unhandled rejection은 없어야 한다.

- [ ] **Step 12: 구현 diff를 자체 검토하고 한 기능 커밋으로 남긴다**

자체 검토 체크:

```text
[ ] brushStyle은 disableInput에서 초기화되지 않는다.
[ ] 설정만 바꿀 때 sceneStore mutation 메서드를 호출하지 않는다.
[ ] activeStroke.style은 pointerdown에서 복사된다.
[ ] preview/final/restore가 color/size/opacity를 일관되게 사용한다.
[ ] opacity fallback에 `|| 1`을 쓰지 않는다.
[ ] 모든 control listener는 addDomListener로 등록되어 destroy 때 제거된다.
[ ] 새 공개 API·IPC·파일 저장·user-settings 연결이 없다.
[ ] 금지 파일 diff가 없다.
```

Run:

```powershell
git add -- renderer/scripts/modules/mpv-fabric-overlay-runtime.js scripts/tests/mpv-fabric-overlay-runtime.test.js renderer/scripts/lib/mpv-fabric-overlay.iife.js
git commit -m "feat: Fabric 브러시 색상 크기 불투명도 추가"
```

Expected: 제품 소스, 집중 테스트, 생성 번들 세 파일만 포함한 새 커밋 1개.

---

## Task 완료 후 운영 검증

Task review와 whole-branch review가 모두 승인된 뒤 root agent가 다음을 수행한다.

1. `npm.cmd run build`로 unpacked 앱을 새 worktree에서 패키징한다.
2. 빌드 exit 0과 `dist/win-unpacked/resources/app.asar` 존재를 확인한다.
3. 기존 프로세스는 조회·종료하지 않고 고유 profile로 새 실행 파일만 시작한다.
4. 환경변수 `BAEFRAME_MPV_PILOT=1`과 인자 `--fabric-drawing-pilot --skip-shell-registration --multi-instance-profile=fabric-brush-style-<timestamp>`를 사용한다.
5. 사용자에게 직접 검증할 9단계 체크리스트와 시험 앱 식별 정보를 전달한다.
