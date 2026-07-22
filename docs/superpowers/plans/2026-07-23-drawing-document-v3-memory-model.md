# DrawingDocumentV3 Pure Memory Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fabric, 앱 runtime, IPC, `.bframe` writer와 분리된 canonical `DrawingDocumentV3` 메모리 모델을 만들고, 기존 획 추가·삭제·이동·부분 분리 결과를 원자 명령으로 표현할 수 있게 한다.

**Architecture:** CommonJS 순수 모듈 하나가 canonical 문서와 revision head를 private state로 소유한다. 모든 입력·출력은 deep clone하고, 명령은 임시 복제본에 전부 적용·검증한 뒤 성공할 때만 한 번에 교체한다. 이 단계에서는 실제 Fabric scene, 기존 command history, ReviewDataManager, `.bframe` 저장에 연결하지 않는다.

**Tech Stack:** Node.js CommonJS, `node:test`, `node:assert/strict`, 기존 ESLint 설정

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-17-fabric-drawing-surface-v3-design.md`의 11, 12, 14, 15.5, Phase 1이며, 이번 계획은 그중 stroke와 기존 exact keyframe 명령만 구현하는 **Phase 1A slice**다.
- 새 runtime 파일은 `renderer/scripts/modules/drawing-v3/drawing-document.js` 하나다.
- 새 테스트 파일은 `scripts/tests/drawing-v3-document.test.js` 하나다.
- `mpv-fabric-overlay-runtime.js`, 생성 번들, `drawing-command-history.js`, `review-data-manager.js`, 앱 runtime, IPC, `.bframe` writer는 수정하지 않는다.
- canonical transform은 길이 6의 2D affine matrix `[a, b, c, d, e, f]`다. determinant 절댓값이 `1e-8` 이하인 행렬은 거부한다.
- Fabric의 `pathData`, `sourcePoints`, `left`, `top`, `scaleX`, `scaleY`, `angle`은 canonical 문서에 저장하지 않는다.
- 저장 문서 방어 한도는 한 stroke당 `100,000` points, keyframe당 `10,000` objects다. UI command 입력의 더 낮은 한도는 한 stroke당 `20,000` points다. 초과 입력은 자르지 않고 전체를 거부한다.
- `applyCommand(command)`의 기본 source는 `user`이며 `20,000` point 입력 한도를 적용한다. 모델이 반환한 canonical inverse를 복원할 때만 `applyCommand(command, { source: 'history' })`를 사용하며 저장 문서 한도 `100,000`을 적용한다. 두 경로 모두 나머지 schema와 원자성 검증은 동일하다.
- `source:'history'`는 이 순수 모델을 호출하는 trusted internal adapter/history 전용이다. 후속 IPC나 renderer action payload에서 사용자가 source 값을 지정하게 하지 않는다.
- `limits` option은 테스트나 저사양 환경에서 한도를 낮추는 용도만 허용한다. 모든 값은 양의 safe integer이고 `maxObjectsPerKeyframe<=10000`, `maxInputPointsPerStroke<=20000`, `maxStoredPointsPerStroke<=100000`, `maxInputPointsPerStroke<=maxStoredPointsPerStroke`를 만족해야 한다.
- 모든 frame/revision/sequence/fps counter는 `Number.isSafeInteger` 범위여야 한다. `Number.MAX_SAFE_INTEGER` state 자체는 읽을 수 있지만, 실제 순변화가 있는 command가 head 또는 target keyframe revision을 그 이상으로 올려야 하면 commit 직전에 `revision-limit-exceeded`로 원자 거부한다.
- opacity `0`은 유효한 값으로 그대로 보존한다.
- 선택, hover, tool preset, marquee, clipboard, transient transform preview는 문서에 포함하지 않는다.
- 이 계획 완료 뒤에도 Fabric 파일럿의 session scene은 저장되지 않는다.

### Phase 1A에서 의도적으로 제외하는 범위

- ShapeObject, MaskObject, RasterObject와 mask target 연동은 후속 object-type slice에서 구현한다.
- hold frame 편집 시 create-keyframe, keyframe 생성·삭제·복제, layer 생성·삭제·정렬·잠금 변경 command는 후속 layer/keyframe slice에서 구현한다. 이번 command target은 이미 존재하는 exact keyframe만 허용한다.
- `initialLayers`는 미래 decoder가 검증·정규화해 넘긴 **trusted canonical internal input**이다. raw `.bframe drawingsV3`를 직접 decode하는 공개 API가 아니다.
- strict fields-only constructor `TypeError`는 persisted-file read-only UX 계약이 아니다. nested unknown-minor field 보존 codec, 128 layers, layer당 10,000 keyframes, drawingsV3 64MiB, over-limit read-only 처리는 Phase 2의 decoder/codec/validator 계획에서 구현한다.
- Fabric runtime adapter, 현재 `SessionSceneStore` 변환, 기존 command history 연결은 이 모델이 독립 검증된 뒤 별도 계획으로 진행한다.

### Phase 1A canonical validation 계약

이 constructor는 raw persisted JSON decoder가 아니라 trusted internal canonical 경계이므로 정규화하거나 모르는 값을 보존하지 않는다. 모든 record는 null이 아닌 plain object, 모든 배열은 hole이 없는 dense array여야 하며 `undefined`, accessor, class instance는 허용하지 않는다. 아래 exact key 이외의 own enumerable key가 있거나 필수 key가 빠지면 constructor는 `TypeError`, command insert는 `invalid-object`로 거부한다. 이후 raw `.bframe` codec은 별도 계층에서 unknown field 보존과 read-only 판정을 담당한다.

| record | exact keys와 값 계약 |
|---|---|
| create options | `documentId`, `coordinateSpace`, `timebase`, `initialLayers`, `revisionSequence`, 선택적 `limits`; `documentId`는 nonempty string, `revisionSequence`는 nonnegative safe integer |
| coordinateSpace | `unit`, `origin`, `yAxis`, `pixelRatio`, `width`, `height`; 앞 세 값은 각각 `source-pixel`, `top-left`, `down`, 나머지는 finite positive number |
| timebase | `fpsNumerator`, `fpsDenominator`, `totalFrames`; 모두 positive safe integer |
| layer | `id`, `name`, `visible`, `locked`, `opacity`, `keyframes`; ID/name은 nonempty string, visible/locked는 boolean, opacity는 finite `0..1` |
| keyframe | `id`, `frame`, `empty`, `revision`, `objects`; ID는 nonempty string, frame/revision은 nonnegative safe integer, empty는 boolean, objects는 dense array |
| stroke | `id`, `type`, `tool`, `visible`, `locked`, `opacity`, `blendMode`, `transform`, `points`, `style`; ID는 nonempty string, type은 `stroke`, tool은 `pen` 또는 `brush`, visible/locked는 boolean, opacity는 finite `0..1`, blendMode는 Phase 1A에서 `source-over`만 허용 |
| point | `x`, `y`, `pressure`, `time`; 모두 finite number, pressure는 `0..1`, time은 nonnegative이고 stroke 안에서 nondecreasing |
| style | `color`, `size`, `thinning`, `smoothing`, `streamline`, `outlineColor`, `outlineWidth`; color는 lowercase `#rrggbb`, outlineColor는 같은 형식 또는 null, size는 finite positive, thinning은 finite `-1..1`, smoothing/streamline은 finite `0..1`, outlineWidth는 finite nonnegative |

stroke `points`는 점 하나짜리 dot을 위해 최소 1개를 허용한다. transform은 dense length-6 finite-number array이며 위 determinant 규칙을 만족해야 한다. x/y는 canvas 밖 이동을 보존해야 하므로 coordinateSpace 범위로 clamp하지 않는다. keyframe frame은 `0 <= frame < totalFrames`, 같은 layer 안에서 엄격한 오름차순이고 중복이 없어야 한다. layer/keyframe ID는 각 종류 전체에서, object ID는 document 전체에서 유일해야 한다. `empty:true` keyframe의 objects는 반드시 비어 있어야 한다.

---

### Task 1: Canonical document와 frame resolution

**Files:**
- Create: `renderer/scripts/modules/drawing-v3/drawing-document.js`
- Create: `scripts/tests/drawing-v3-document.test.js`

**Interfaces:**
- Consumes: canonical `coordinateSpace`, `timebase`, layer/keyframe/stroke fixtures
- Produces: `createDrawingDocumentV3(options)`, `getContentSnapshot()`, `getHead()`, `resolveFrame({ layerId, frame })`

생성 API는 다음 형식을 사용한다.

```js
const document = createDrawingDocumentV3({
  documentId: 'drawdoc-1',
  coordinateSpace: {
    unit: 'source-pixel',
    origin: 'top-left',
    yAxis: 'down',
    pixelRatio: 1,
    width: 1920,
    height: 1080
  },
  timebase: {
    fpsNumerator: 24,
    fpsDenominator: 1,
    totalFrames: 240
  },
  initialLayers: [{
    id: 'layer-1',
    name: '드로잉 1',
    visible: true,
    locked: false,
    opacity: 1,
    keyframes: [{
      id: 'keyframe-1',
      frame: 0,
      empty: false,
      revision: 0,
      objects: []
    }]
  }],
  revisionSequence: 0,
  limits: {
    maxObjectsPerKeyframe: 10000,
    maxInputPointsPerStroke: 20000,
    maxStoredPointsPerStroke: 100000
  }
});
```

`getContentSnapshot()`은 다음 root를 deep clone으로 반환한다.

```js
{
  schemaVersion: '3.0.0',
  documentId: 'drawdoc-1',
  engine: 'baeframe-drawing',
  coordinateSpace,
  timebase,
  layers
}
```

`getHead()`은 저장용 revision UUID나 시간 없이 메모리 head만 반환한다.

```js
{ sequence: 0, lastCommandId: null }
```

`resolveFrame()` 반환 계약은 다음과 같다.

```js
{
  layerId: 'layer-1',
  frame: 12,
  sourceFrame: 0,
  keyframeId: 'keyframe-1',
  held: true,
  empty: false,
  objects: []
}
```

요청 frame 이하의 마지막 keyframe을 source로 사용한다. exact frame이면 `held:false`, 이전 keyframe hold이면 `held:true`다. 마지막 source가 `empty:true`면 그 keyframe의 `sourceFrame`, `keyframeId`, `held`를 유지하고 `empty:true`, `objects:[]`를 반환한다. source 자체가 없으면 아래 exact shape를 반환한다. 존재하지 않는 layer나 범위 밖 frame은 `null`을 반환한다.

```js
{
  layerId: 'layer-1',
  frame: 0,
  sourceFrame: null,
  keyframeId: null,
  held: false,
  empty: true,
  objects: []
}
```

- [ ] **Step 1: 모듈이 아직 없다는 RED 테스트 작성**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createDrawingDocumentV3
} = require('../../renderer/scripts/modules/drawing-v3/drawing-document.js');

test('document snapshots are isolated from constructor input and returned mutations', () => {
  const layers = [createLayerFixture()];
  const document = createDrawingDocumentV3(createDocumentOptions({ initialLayers: layers }));
  layers[0].name = '외부 변경';
  const first = document.getContentSnapshot();
  first.layers[0].name = '반환값 변경';
  assert.equal(document.getContentSnapshot().layers[0].name, '드로잉 1');
  assert.deepEqual(document.getHead(), { sequence: 0, lastCommandId: null });
});
```

- [ ] **Step 2: RED 확인**

Run: `node --test scripts/tests/drawing-v3-document.test.js`

Expected: FAIL with `Cannot find module ... drawing-document.js`.

- [ ] **Step 3: 생성·snapshot·head 최소 구현**

```js
'use strict';

const HARD_LIMITS = Object.freeze({
  maxObjectsPerKeyframe: 10_000,
  maxInputPointsPerStroke: 20_000,
  maxStoredPointsPerStroke: 100_000
});
const DEFAULT_LIMITS = HARD_LIMITS;

function clonePlain(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createDrawingDocumentV3(options = {}) {
  const limits = validateLimits(options.limits);
  let content = validateAndCloneInitialContent(options, limits);
  let head = {
    sequence: validateRevisionSequence(options.revisionSequence),
    lastCommandId: null
  };
  const appliedCommandIds = new Set();

  return {
    getContentSnapshot: () => clonePlain(content),
    getHead: () => ({ ...head }),
    resolveFrame(request) {
      return resolveFrameSnapshot(content, request);
    },
    applyCommand(command, applyOptions = {}) {
      return applyCommandAtomically({
        content,
        head,
        limits,
        command,
        appliedCommandIds,
        source: applyOptions.source ?? 'user'
      }, next => {
        content = next.content;
        head = next.head;
      });
    }
  };
}

module.exports = { createDrawingDocumentV3 };
```

초기 validation은 document/layer/keyframe ID와 document 전체에서 유일한 object ID, finite 숫자, positive source 크기와 timebase 분모, frame 정렬·중복·범위, opacity `0..1`, empty keyframe의 빈 objects를 확인한다. `structuredClone`을 사용하되 undefined를 별도로 처리한다.

- [ ] **Step 4: exact/held/empty와 opacity 0 테스트 추가**

```js
test('resolveFrame distinguishes exact, held, and empty-break frames', () => {
  const document = createDrawingDocumentV3(createDocumentOptions({
    initialLayers: [createLayerFixture({
      opacity: 0,
      keyframes: [
        createKeyframeFixture({ id: 'keyframe-0', frame: 0, objects: [
          createStroke('stroke-1', { opacity: 0 })
        ] }),
        createKeyframeFixture({ id: 'keyframe-10', frame: 10, empty: true, objects: [] })
      ]
    })]
  }));

  assert.equal(document.getContentSnapshot().layers[0].opacity, 0);
  assert.equal(document.getContentSnapshot().layers[0].keyframes[0].objects[0].opacity, 0);
  assert.deepEqual(document.resolveFrame({ layerId: 'layer-1', frame: 0 }), {
    layerId: 'layer-1', frame: 0, sourceFrame: 0, keyframeId: 'keyframe-0',
    held: false, empty: false, objects: [createStroke('stroke-1', { opacity: 0 })]
  });
  const held = document.resolveFrame({ layerId: 'layer-1', frame: 5 });
  assert.equal(held.held, true);
  held.objects[0].points[0].x = 9999;
  assert.equal(
    document.resolveFrame({ layerId: 'layer-1', frame: 5 }).objects[0].points[0].x,
    createStroke('stroke-1').points[0].x,
    'resolveFrame must return a deep clone'
  );
  assert.equal(document.resolveFrame({ layerId: 'layer-1', frame: 12 }).empty, true);
  assert.equal(document.resolveFrame({ layerId: 'missing', frame: 0 }), null);
});
```

같은 테스트에서 frame 12의 empty-break 결과와 첫 keyframe 이전 no-source 결과도 위 계약의 모든 필드(`layerId`, `frame`, `sourceFrame`, `keyframeId`, `held`, `empty`, `objects`)를 `deepEqual`로 확인해, 일부 필드만 맞는 불완전한 반환을 놓치지 않는다.

- [ ] **Step 5: initial canonical structure table validation 테스트 추가**

각 case는 `createDrawingDocumentV3()`가 `TypeError`를 던지고 입력 fixture를 변경하지 않아야 한다.

```js
const invalidInitialCases = [
  ['non-finite source width', optionsWith({ coordinateSpace: { width: Number.NaN } })],
  ['non-positive source height', optionsWith({ coordinateSpace: { height: 0 } })],
  ['non-positive fps denominator', optionsWith({ timebase: { fpsDenominator: 0 } })],
  ['non-integer totalFrames', optionsWith({ timebase: { totalFrames: 10.5 } })],
  ['duplicate layer id', optionsWithDuplicateLayers()],
  ['duplicate keyframe id', optionsWithDuplicateKeyframeIds()],
  ['duplicate object id across keyframes', optionsWithDuplicateObjectIds()],
  ['unsorted keyframe frames', optionsWithFrames([10, 0])],
  ['duplicate keyframe frame', optionsWithFrames([0, 0])],
  ['negative frame', optionsWithFrames([-1])],
  ['fractional frame', optionsWithFrames([1.5])],
  ['frame at totalFrames', optionsWithFrames([240])],
  ['empty keyframe with objects', optionsWithEmptyKeyframeObjects()],
  ['layer opacity below zero', optionsWith({ layerOpacity: -0.01 })],
  ['stroke opacity above one', optionsWith({ strokeOpacity: 1.01 })]
];

for (const [name, options] of invalidInitialCases) {
  test(`initial validator rejects ${name}`, () => {
    const before = structuredClone(options);
    assert.throws(() => createDrawingDocumentV3(options), TypeError);
    assert.deepEqual(options, before);
  });
}
```

finite positive width/height/pixelRatio, positive safe integer fps numerator/denominator/totalFrames, nonnegative safe integer revision/frame, unique nonempty IDs, sorted unique keyframe frames, opacity inclusive `0..1`을 공용 constructor validator에서 확인한다. `Number.MAX_SAFE_INTEGER + 1`인 revisionSequence/keyframe revision/totalFrames/frame은 각각 constructor `TypeError` 회귀로 고정한다.

- [ ] **Step 6: Task 1 GREEN 확인**

Run: `node --test scripts/tests/drawing-v3-document.test.js`

Expected: all Task 1 tests PASS.

- [ ] **Step 7: Task 1 커밋**

```powershell
git add renderer/scripts/modules/drawing-v3/drawing-document.js scripts/tests/drawing-v3-document.test.js
git commit -m "feat: DrawingDocumentV3 기본 모델 추가"
```

---

### Task 2: Atomic insert, remove, transform commands와 inverse

**Files:**
- Modify: `renderer/scripts/modules/drawing-v3/drawing-document.js`
- Modify: `scripts/tests/drawing-v3-document.test.js`

**Interfaces:**
- Consumes: Task 1의 `createDrawingDocumentV3()`와 exact keyframe target
- Produces: `applyCommand(command, { source?: 'user'|'history' })`과 `insert-objects`, `remove-objects`, `set-transforms` operation

첫 slice command 형식은 다음과 같다.

```js
{
  id: 'command-1',
  actorId: 'actor-1',
  baseRevision: 0,
  target: { layerId: 'layer-1', keyframeId: 'keyframe-1', frame: 0 },
  kind: 'add-objects',
  operations: [{ type: 'insert-objects', index: 0, objects: [stroke] }],
  createdAt: '2026-07-23T00:00:00.000Z'
}
```

지원 operation은 정확히 세 종류다.

```js
{ type: 'insert-objects', index, objects }
{ type: 'remove-objects', objectIds }
{ type: 'set-transforms', transforms: [{ objectId, transform }] }
```

Phase 1A command envelope 규칙은 다음과 같다.

| kind | 허용 operations |
|---|---|
| `add-objects` | 하나 이상의 `insert-objects`만 |
| `delete-objects` | 하나 이상의 `remove-objects`만 |
| `transform-objects` | 하나 이상의 `set-transforms`만 |
| `split-stroke` | `remove-objects`와 `insert-objects`를 각각 하나 이상 포함하고, 필요하면 `set-transforms` 포함 |

반환된 `inverseOperations`를 새 command로 감쌀 때 kind는 원래 command kind를 복사하지 않고 inverse operation 구성에서 다시 결정한다. insert-only는 `add-objects`, remove-only는 `delete-objects`, set-only는 `transform-objects`, remove+insert(+set) 혼합은 `split-stroke`다. 테스트 helper `createInverseCommand()`도 이 규칙만 사용한다.

`id`, `actorId`, `target.layerId`, `target.keyframeId`는 비어 있지 않은 문자열이어야 한다. `baseRevision`은 0 이상의 safe integer이고 현재 head sequence와 같아야 한다. `target.frame`은 범위 안 safe integer이며 target keyframe의 실제 frame과 정확히 같아야 한다. `createdAt`은 유효한 ISO timestamp 문자열이고 `operations`는 비어 있지 않은 배열이어야 한다.

operation payload도 적용 전에 전부 검증한다. `insert-objects.index`는 해당 operation이 적용되는 그 시점의 `0..objects.length` 범위 safe integer이고 `objects`는 비어 있지 않은 배열이어야 한다. `remove-objects.objectIds`와 `set-transforms.transforms`도 비어 있지 않은 배열이어야 하며, 모든 object ID는 비어 있지 않은 문자열이어야 한다. unknown operation, malformed payload, unsupported kind, kind와 맞지 않는 operation 조합, 중복 `remove-objects.objectIds`, 중복 `set-transforms.transforms[].objectId`는 `invalid-command`로 command 전체를 원자적으로 거부한다. payload shape는 유효하지만 canonical object 자체가 잘못되면 `invalid-object`, affine matrix가 잘못되면 `invalid-transform`을 사용한다.

검증 순서는 malformed `applyOptions`/command shape → 이미 성공한 command ID 중복 → base revision → exact non-empty target → layer lock → draft에서 operation 순차 적용 → 최종-state no-op → revision overflow → single commit/ID 기록이다. 따라서 같은 성공 command를 stale baseRevision 그대로 재전송해도 `duplicate-command-id`가 우선하고, malformed command/source는 dedupe보다 먼저 `invalid-command`다. 새로 insert한 fragment는 같은 compound command의 뒤 operation에서 transform할 수 있다.

`empty:true` keyframe은 hold를 끊는 표식이며 Phase 1A object command target이 아니다. 이 keyframe을 target으로 한 insert/remove/transform은 `target-not-found`로 거부한다. command 테스트의 ‘빈 keyframe’ fixture는 `empty:false, objects:[]`인 편집 가능한 keyframe을 뜻한다. `empty:true`를 편집 가능 keyframe으로 전환하는 create-keyframe command는 후속 layer/keyframe slice 책임이다.

성공 반환값:

```js
{
  applied: true,
  commandId: 'command-1',
  sequence: 1,
  inverseOperations: [{ type: 'remove-objects', objectIds: ['stroke-1'] }]
}
```

실패와 no-op은 `{ applied:false, reason }`이고 content/head를 바꾸지 않는다. reason은 `invalid-command`, `duplicate-command-id`, `stale-revision`, `target-not-found`, `layer-locked`, `duplicate-object-id`, `object-not-found`, `invalid-object`, `invalid-transform`, `point-limit-exceeded`, `object-limit-exceeded`, `revision-limit-exceeded`, `no-change` 중 하나다.

canonical stroke는 다음 필드만 허용한다.

```js
{
  id: 'stroke-1',
  type: 'stroke',
  tool: 'brush',
  visible: true,
  locked: false,
  opacity: 0.4,
  blendMode: 'source-over',
  transform: [1, 0, 0, 1, 0, 0],
  points: [{ x: 10, y: 20, pressure: 0.5, time: 0 }],
  style: {
    color: '#ff4757',
    size: 12,
    thinning: 0.65,
    smoothing: 0.55,
    streamline: 0.5,
    outlineColor: null,
    outlineWidth: 0
  }
}
```

- [ ] **Step 1: insert와 inverse RED 테스트**

```js
test('insert command increments revision once and returns inverse removal', () => {
  const document = createDocumentWithEmptyKeyframe();
  const result = document.applyCommand(createCommand({
    id: 'command-insert',
    operations: [{ type: 'insert-objects', index: 0, objects: [createStroke('stroke-1')] }]
  }));

  assert.deepEqual(result, {
    applied: true,
    commandId: 'command-insert',
    sequence: 1,
    inverseOperations: [{ type: 'remove-objects', objectIds: ['stroke-1'] }]
  });
  assert.deepEqual(document.getHead(), { sequence: 1, lastCommandId: 'command-insert' });
});
```

같은 RED 묶음에 table-driven command envelope 테스트를 추가한다.

```js
const invalidCommands = [
  createCommand({ id: '' }),
  createCommand({ actorId: '' }),
  createCommand({ baseRevision: -1 }),
  createCommand({ kind: 'unknown-kind' }),
  createCommand({ operations: [] }),
  createCommand({ kind: 'add-objects', operations: [removeStrokeOperation()] }),
  createCommand({ createdAt: 'not-a-date' }),
  createCommand({ kind: 'delete-objects', operations: [{
    type: 'remove-objects', objectIds: ['stroke-1', 'stroke-1']
  }] }),
  createCommand({ kind: 'transform-objects', operations: [{
    type: 'set-transforms',
    transforms: [move('stroke-1', 10, 0), move('stroke-1', 20, 0)]
  }] })
];

for (const command of invalidCommands) {
  const before = document.getContentSnapshot();
  const head = document.getHead();
  assert.deepEqual(document.applyCommand(command), { applied: false, reason: 'invalid-command' });
  assert.deepEqual(document.getContentSnapshot(), before);
  assert.deepEqual(document.getHead(), head);
}
```

correct layer/keyframe ID지만 frame만 다른 target은 `invalid-command`가 아니라 exact target 불일치인 `target-not-found`로 별도 테스트한다. compound remove+insert+transform fixture의 kind는 반드시 `split-stroke`를 사용한다.

별도 테스트에서 `empty:true, objects:[]` keyframe을 exact target으로 지정한 insert command가 `target-not-found`이고 content/head가 불변인지 확인한다.

- [ ] **Step 2: RED 확인**

Run: `node --test scripts/tests/drawing-v3-document.test.js`

Expected: FAIL because Task 1 has not implemented command operation support.

- [ ] **Step 3: 임시 복제본 기반 insert/remove/set-transforms 구현**

```js
function applyCommandAtomically({
  content,
  head,
  limits,
  command,
  appliedCommandIds,
  source
}, commit) {
  const validation = validateCommandEnvelope(command, head, appliedCommandIds);
  if (validation) return { applied: false, reason: validation };
  if (source !== 'user' && source !== 'history') {
    return { applied: false, reason: 'invalid-command' };
  }

  const draft = clonePlain(content);
  const target = findExactTarget(draft, command.target);
  if (!target) return { applied: false, reason: 'target-not-found' };
  if (target.layer.locked) return { applied: false, reason: 'layer-locked' };

  const objectsBefore = clonePlain(target.keyframe.objects);
  const documentObjectIds = collectDocumentObjectIds(draft);
  const inverseOperations = [];
  for (const operation of command.operations) {
    const result = applyOperation(
      target.keyframe,
      operation,
      limits,
      draft,
      source,
      documentObjectIds
    );
    if (!result.applied) return { applied: false, reason: result.reason };
    inverseOperations.unshift(...result.inverseOperations);
  }
  if (deepEqualPlain(objectsBefore, target.keyframe.objects)) {
    return { applied: false, reason: 'no-change' };
  }
  if (head.sequence === Number.MAX_SAFE_INTEGER ||
    target.keyframe.revision === Number.MAX_SAFE_INTEGER) {
    return { applied: false, reason: 'revision-limit-exceeded' };
  }

  target.keyframe.revision += 1;
  const nextHead = { sequence: head.sequence + 1, lastCommandId: command.id };
  commit({ content: draft, head: nextHead });
  appliedCommandIds.add(command.id);
  return {
    applied: true,
    commandId: command.id,
    sequence: nextHead.sequence,
    inverseOperations: clonePlain(inverseOperations)
  };
}
```

`deepEqualPlain()`은 primitive `===`, 배열 길이/순서, plain object의 정렬된 key/value를 재귀 비교하는 browser-safe helper로 구현한다. 모든 canonical 숫자는 finite이므로 `NaN` 예외가 없고 `0`과 `-0`은 같은 값으로 취급한다. 중간 operation이 변화를 만들었더라도 최종 canonical objects가 시작과 같으면 `no-change`이며 revision과 applied command ID를 갱신하지 않는다.

`remove-objects` inverse는 요청 `objectIds` 순서와 무관하게 제거 전 index 오름차순의 `insert-objects` operation들이다. `set-transforms` inverse는 각 object의 원래 matrix다. 반환 inverse를 외부에서 변경해도 내부 상태는 바뀌지 않는다.

- [ ] **Step 4: transform/no-op/invalid matrix 원자성 테스트**

```js
test('affine transform changes only transform and identical transform is a no-op', () => {
  const document = createDocumentWithObjects([createStroke('stroke-1')]);
  const moved = document.applyCommand(createCommand({
    id: 'move-1',
    operations: [{
      type: 'set-transforms',
      transforms: [{ objectId: 'stroke-1', transform: [1, 0, 0, 1, 30, 40] }]
    }]
  }));
  assert.equal(moved.applied, true);
  const after = objectById(document, 'stroke-1');
  assert.deepEqual(after.transform, [1, 0, 0, 1, 30, 40]);
  assert.deepEqual(after.points, createStroke('stroke-1').points);
  assert.deepEqual(after.style, createStroke('stroke-1').style);

  const head = document.getHead();
  assert.deepEqual(document.applyCommand(createCommand({
    id: 'move-noop', baseRevision: head.sequence,
    operations: [{
      type: 'set-transforms',
      transforms: [{ objectId: 'stroke-1', transform: [1, 0, 0, 1, 30, 40] }]
    }]
  })), { applied: false, reason: 'no-change' });
  assert.deepEqual(document.getHead(), head);
});
```

별도 테스트에서 `[1, 0, 0, 0, 0, 0]` singular matrix와 `{ left: 10, top: 20, scaleX: 1, angle: 0 }` Fabric transform을 `invalid-transform`으로 거부하고 snapshot/head가 동일함을 확인한다.

추가로 같은 command 안에서 임시 object를 insert한 뒤 다시 remove해 최종 objects가 시작과 같아지는 경우 `no-change`이고 revision/head가 불변인지 확인한다.

- [ ] **Step 5: compound z-order와 inverse round-trip 테스트**

초기 `[stroke-a, stroke-b, stroke-c]`에 `remove stroke-b`, index 1에 `[fragment-1, fragment-2]` insert, `fragment-2` transform을 한 command로 적용한다. 결과가 `[stroke-a, fragment-1, fragment-2, stroke-c]`인지 확인한다. 반환 inverse operations를 위 kind 파생 규칙을 따르는 `createInverseCommand()`로 `baseRevision:1`인 새 command에 감싸고 `applyCommand(inverseCommand, { source:'history' })`로 적용하면 objects의 순서와 canonical 데이터가 초기 objects와 완전히 같아야 한다. 다만 이력 자체를 되감는 것이 아니므로 keyframe revision은 `2`, document head sequence도 `2`로 단조 증가해야 한다.

별도 순서 회귀는 초기 `[stroke-a, stroke-b, stroke-c, stroke-d]`에서 `remove-objects.objectIds:['stroke-d','stroke-b']`를 적용한다. 반환 inverse의 `insert-objects` index가 요청 순서가 아니라 `1`, `3` 오름차순인지 확인한다. 이 insert-only inverse는 `createInverseCommand()`가 `add-objects` kind로 감싸야 하며, history source round-trip 뒤 네 object의 원래 순서가 정확히 복원되어야 한다. add command의 remove-only inverse는 `delete-objects`, transform command의 set-only inverse는 `transform-objects`가 되는지도 각각 단언해 kind/operation envelope가 round-trip 중 깨지지 않게 한다.

- [ ] **Step 6: stale/target/locked/duplicate ID 실패 원자성 테스트**

각 실패 전 snapshot/head를 보관하고 다음을 각각 실행한다.

```js
[
  { reason: 'stale-revision', command: createCommand({ baseRevision: 99 }) },
  { reason: 'target-not-found', command: createCommand({ target: missingTarget }) },
  { reason: 'layer-locked', command: commandAgainstLockedLayer },
  { reason: 'duplicate-object-id', command: insertExistingIdCommand }
]
```

모든 결과의 `reason`이 정확하고 snapshot/head가 변하지 않아야 한다.

`set-transforms.transforms` 안에서 같은 objectId가 두 번 나오거나 `remove-objects.objectIds`가 중복되면 일부 적용이나 last-write-wins로 처리하지 않고 `invalid-command`로 전체 거부하는지 이 묶음에서도 확인한다.

operation payload 회귀 표에는 최소한 음수 index, 소수 index, 현재 objects.length 초과 index, 빈 `objects`/`objectIds`/`transforms`, 빈 object ID, unknown operation type을 넣는다. 각 case는 `invalid-command`이고 앞선 operation을 포함한 command여도 snapshot/head가 완전히 불변이어야 한다. compound command 안의 두 번째 insert index는 첫 번째 operation까지 반영된 draft의 현재 objects.length를 기준으로 검증한다.

object ID 유일성은 현재 target만이 아니라 draft document 전체를 기준으로 유지한다. 다른 layer/keyframe의 ID와 충돌, 한 insert 안의 중복, 연속 insert operation 사이 중복은 `duplicate-object-id`로 원자 거부한다. 반대로 앞 operation에서 object를 remove한 뒤 같은 ID의 canonical object를 다시 insert하는 것은 draft의 현재 전역 ID 집합을 기준으로 허용한다. 전역 ID Set은 command마다 draft에서 한 번만 만들고, 완전히 검증된 remove/insert가 적용될 때 함께 갱신한다. 이 index 자체도 draft-local이어야 실패 command가 다음 command에 흔적을 남기지 않으며, inverse에 insert가 많이 포함돼도 매 operation마다 문서 전체를 재스캔하지 않는다.

검증 precedence 회귀는 malformed source/command가 duplicate ID보다 먼저 `invalid-command`, 성공 command 재전송은 stale보다 먼저 `duplicate-command-id`인지 확인한다. 실패/no-op/overflow command ID는 기록하지 않아 같은 ID로 안전한 state에서 재시도할 수 있어야 한다. 최종-state no-op은 `transform A→B→A`와 insert→remove를 포함하고, no-op transform 뒤 실제 insert가 이어지는 command는 성공해야 한다. 연속된 두 remove operation의 inverse도 operation group은 역순이되 각 group 내부 insert index는 오름차순을 유지해 round-trip z-order가 복원되어야 한다.

revision overflow 회귀는 `revisionSequence:Number.MAX_SAFE_INTEGER`인 문서와 target keyframe `revision:Number.MAX_SAFE_INTEGER`인 문서를 각각 만든다. 실제 순변화 command는 commit 직전에 `revision-limit-exceeded`이고 content/head/command-ID dedupe가 불변이어야 한다. 같은 command ID를 안전한 state에서 다시 쓸 수 있어야 한다. transform 결과가 이미 같은 no-op은 revision을 올리지 않으므로 overflow보다 먼저 `{applied:false, reason:'no-change'}`를 반환한다.

경계 성공도 별도로 고정한다. head와 target keyframe revision이 각각 `Number.MAX_SAFE_INTEGER - 1`일 때 한 번의 실제 변경은 둘 다 정확히 `Number.MAX_SAFE_INTEGER`로 증가해야 하고, 그 다음 실제 변경부터 거부되어야 한다. command 입력과 삽입 stroke/transform, 성공 반환 inverse를 사후 변경해도 내부 snapshot/head가 바뀌지 않아야 한다.

- [ ] **Step 7: Task 2 GREEN 확인**

Run: `node --test scripts/tests/drawing-v3-document.test.js`

Expected: all Task 1-2 tests PASS.

- [ ] **Step 8: Task 2 커밋**

```powershell
git add renderer/scripts/modules/drawing-v3/drawing-document.js scripts/tests/drawing-v3-document.test.js
git commit -m "feat: DrawingDocumentV3 원자 명령 적용"
```

---

### Task 3: Canonical 경계, 방어 한도, drawing regression 연결

**Files:**
- Modify: `renderer/scripts/modules/drawing-v3/drawing-document.js`
- Modify: `scripts/tests/drawing-v3-document.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 command API
- Produces: strict canonical stroke/limit validation and `npm run test:drawing` coverage

- [ ] **Step 1: Fabric-only 필드와 외부 mutation RED 테스트**

`pathData`, `sourcePoints`, 또는 property-object transform이 들어간 stroke insert를 `invalid-object` 또는 `invalid-transform`으로 거부한다. command의 points/style/transform과 성공 반환 inverse를 호출 뒤 변경해도 document snapshot이 바뀌지 않아야 한다.

strict field matrix는 위 표에서 최소 한 case씩 포함한다: missing/unknown stroke key, unsupported tool/blendMode, non-boolean flags, sparse/empty points, point의 missing/unknown key, non-finite x/y/time, pressure 범위 이탈, time 역행, style의 missing/unknown key, 대문자/비-hex color, size 0, thinning/smoothing/streamline 범위 이탈, outlineColor 오류, 음수 outlineWidth. 초기 문서는 `TypeError`, 같은 stroke를 insert하는 command는 `{applied:false, reason:'invalid-object'}`이고 snapshot/head가 불변이어야 한다. malformed transform만 `invalid-transform`으로 구분한다.

`limits`에는 낮춘 양의 정수만 허용한다. `maxObjectsPerKeyframe:10001`, `maxInputPointsPerStroke:20001`, `maxStoredPointsPerStroke:100001`, input이 stored보다 큰 조합, `0`, 음수, 소수는 constructor `TypeError`여야 한다. `{maxObjectsPerKeyframe:2,maxInputPointsPerStroke:4,maxStoredPointsPerStroke:8}`은 허용되어 실제 command 검증에 적용되어야 한다.

- [ ] **Step 2: point/object limit RED 테스트**

```js
test('input limits reject instead of truncating or partially applying', () => {
  const tooManyPoints = Array.from({ length: 20_001 }, (_, index) => ({
    x: index, y: index, pressure: 0.5, time: index
  }));
  const pointLimited = createDocumentWithEmptyKeyframe();
  const beforePoints = pointLimited.getContentSnapshot();
  assert.deepEqual(pointLimited.applyCommand(insertStrokeWithPoints(tooManyPoints)), {
    applied: false,
    reason: 'point-limit-exceeded'
  });
  assert.deepEqual(pointLimited.getContentSnapshot(), beforePoints);

  const objectLimited = createDocumentWithObjects(createManyStrokes(10_000));
  const beforeObjects = objectLimited.getContentSnapshot();
  assert.deepEqual(objectLimited.applyCommand(insertOneMoreStroke()), {
    applied: false,
    reason: 'object-limit-exceeded'
  });
  assert.deepEqual(objectLimited.getContentSnapshot(), beforeObjects);
});
```

같은 테스트 묶음에서 초기 문서의 `20,001` points stroke는 저장 문서 한도 안이므로 그대로 허용되고, `100,001` points stroke는 constructor가 `TypeError`로 거부되는지 확인한다. 이로써 constructor의 `maxStoredPointsPerStroke`와 command의 `maxInputPointsPerStroke`가 뒤바뀌지 않게 한다.

- [ ] **Step 3: strict validator와 limit check 최소 구현**

```js
const FORBIDDEN_FABRIC_FIELDS = new Set([
  'pathData', 'sourcePoints', 'left', 'top', 'scaleX', 'scaleY', 'angle'
]);

function validateStrokeObject(object, limits, source = 'user') {
  if (!hasExactCanonicalStrokeKeys(object) || object.type !== 'stroke') {
    return 'invalid-object';
  }
  if ([...FORBIDDEN_FABRIC_FIELDS].some(key => Object.hasOwn(object, key))) {
    return 'invalid-object';
  }
  if (!Array.isArray(object.points)) return 'invalid-object';
  const pointLimit = source === 'history'
    ? limits.maxStoredPointsPerStroke
    : limits.maxInputPointsPerStroke;
  if (object.points.length > pointLimit) {
    return 'point-limit-exceeded';
  }
  const fieldReason = validateCanonicalStrokeFieldsExceptTransform(object);
  if (fieldReason) return fieldReason;
  if (!isValidAffineTransform(object.transform)) return 'invalid-transform';
  return null;
}
```

검증 순서는 plain/exact required keys와 transform key 존재 여부 → 나머지 canonical fields → 존재하는 transform 값의 matrix 유효성이다. 따라서 missing `transform`은 `invalid-object`, transform key는 있지만 property object·길이 오류·non-finite·singular matrix면 `invalid-transform`이다. 이 두 경우를 별도 테스트로 고정한다.

초기 document도 같은 canonical validator를 사용하되 저장 문서 한도 `maxStoredPointsPerStroke:100000`을 적용한다. 기본 `user` source의 새 `insert-objects` command에는 더 낮은 `maxInputPointsPerStroke:20000`을 적용한다. 모델이 반환한 inverse를 재적용하는 `history` source만 `maxStoredPointsPerStroke:100000`을 사용한다. 한도를 넘거나 잘못된 초기 문서는 잘라내지 않고 `TypeError`를 던지고, command 적용 중에는 structured `{ applied:false, reason }`을 반환한다.

- [ ] **Step 4: large stored stroke inverse 경계 테스트**

초기 문서에 `50,000` points stroke를 넣고 user source로 삭제한다. 반환된 insert-only inverse는 `createInverseCommand()`가 `add-objects` kind로 감싼다. 이를 기본 source로 적용하면 `point-limit-exceeded`이며 content/head가 불변이어야 한다. 같은 inverse command ID를 `{ source:'history' }`로 다시 적용하면 성공하고 50,000 points가 잘림 없이 복원되어야 한다. 별도의 history source insert command에 `100,001` points를 주면 `point-limit-exceeded`로 거부한다.

- [ ] **Step 5: duplicate command와 full atomicity 테스트**

성공한 command ID를 다시 사용하면 `duplicate-command-id`이고 revision/content가 불변이어야 한다. 여러 operation 중 마지막 operation이 잘못되어도 앞 operation 결과가 하나도 남지 않는지 확인한다.

- [ ] **Step 6: package drawing suite에 새 테스트 연결**

`package.json`의 `test:drawing` 명령 끝에 다음 파일을 추가한다.

```text
scripts/tests/drawing-v3-document.test.js
```

- [ ] **Step 7: 집중 및 전체 drawing 검증**

Run:

```powershell
node --test scripts/tests/drawing-v3-document.test.js
npm run test:drawing
npx eslint renderer/scripts/modules/drawing-v3/drawing-document.js scripts/tests/drawing-v3-document.test.js
git diff --check
```

Expected: all commands exit `0`; ESLint errors `0`.

- [ ] **Step 8: 금지된 runtime 연결이 없는지 확인**

Run:

```powershell
git diff --name-only cab9336
git status --short
rg -n "drawing-document" renderer/scripts/app.js renderer/scripts/modules/review-data-manager.js renderer/scripts/modules/mpv-fabric-overlay-runtime.js main preload
```

Expected: diff는 이 plan 문서, 새 module/test, `package.json`만 포함한다. `rg`는 runtime 연결 결과 `0`건이다.

- [ ] **Step 9: Task 3 커밋**

```powershell
git add renderer/scripts/modules/drawing-v3/drawing-document.js scripts/tests/drawing-v3-document.test.js package.json
git commit -m "test: DrawingDocumentV3 방어 한도 검증"
```

---

## 최종 검증과 다음 경계

구현 뒤 독립 리뷰에서 Critical/Important가 없어야 한다. controller는 다음을 새로 실행한다.

```powershell
node --test scripts/tests/drawing-v3-document.test.js
npm run test:drawing
npm run test:mpv
npm run test:fabric-drawing-pilot
npm run lint
npm run build
git diff --check cab9336..HEAD
```

이 phase는 앱에서 보이는 동작을 바꾸지 않으므로 앱 실행이나 커서 자동 조작을 하지 않는다. 다음 phase는 별도 계획으로 `drawing-engine-adapter.js`를 만들고, 현재 `SessionSceneStore` 결과와 canonical 문서 결과를 test fixture에서 비교한다. 그 전에는 두 저장소를 동시에 authoritative하게 운영하거나 `.bframe drawingsV3` writer를 켜지 않는다.
