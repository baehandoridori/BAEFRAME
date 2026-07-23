# DrawingEngineAdapter session-only shadow integration plan

> Date: 2026-07-23
> Branch: `codex/baeframe-fabric-brush-style-v1`
> Baseline: user manual MPV + Fabric drawing smoke PASS on 2026-07-23
> Status: implementation plan

## 1. Goal

현재 사용자가 직접 확인한 MPV 재생 + Fabric 드로잉 동작을 그대로 유지하면서,
`DrawingDocumentV3`가 동일한 장면 변경을 뒤에서 단방향으로 따라가게 한다.

이번 단계의 성공 기준은 "새 엔진으로 화면을 그렸다"가 아니다. 다음 조건을 모두
만족하는 session-only observational shadow를 만드는 것이다.

- Fabric scene/history가 계속 유일한 사용자 동작 기준이다.
- Fabric에서 성공한 변경만 V3 shadow에 전달된다.
- V3 변환·적용·검증 실패는 Fabric 결과, 선택, Undo/Redo, 재생, 저장에 영향을 주지 않는다.
- 선택, hover, 도구 전환, B 토글만으로는 V3 revision이 증가하지 않는다.
- scene별 Fabric projection과 V3 snapshot의 ID, 순서, points, style, transform이 검증 가능하다.
- 이 단계의 데이터는 앱을 닫으면 사라지며 `.bframe`, ReviewDataManager, IPC 저장 경로에 닿지 않는다.

## 2. Non-goals

이번 계획에서 하지 않는다.

- V3를 화면 렌더러 또는 입력 authority로 전환
- canonical document를 `.bframe`에 저장
- ReviewDataManager dirty/save/toast 연결
- canonical -> Fabric 역방향 동기화
- 기존 drawing data 마이그레이션 또는 legacy 삭제
- controller/preload/renderer 저장 IPC 추가
- 재생, 타임라인, 영상 전환 로직 변경
- 자동 마우스·키보드 조작

## 3. Why this boundary

현재 브러시 입력, 획 이동, 라쏘 분할은 모두 controller action IPC를 통과하지 않는다.
실제 변경을 빠짐없이 보는 공통 지점은 `SessionSceneStore`의 성공 commit 직후다.

따라서 adapter는 action 의도를 다시 해석하지 않고 다음 두 경로의 최종 before/after
상태만 받는다.

- live mutation: `commitStagedMutation()`
- Undo/Redo mutation: `applyHistoryState()`가 transition을 capture만 하고,
  `moveHistory()`가 실제 history stack과 mirrored `historyEntries` 이동을 끝낸 뒤 enqueue

이 경계는 실패한 명령이나 중간 preview를 shadow에 넣지 않으며, 하나의 사용자 gesture를
하나의 canonical command로 유지한다.

## 4. Authority and failure model

```text
pointer / toolbar / shortcut
          |
          v
Fabric runtime -> SessionSceneStore -> legacy DrawingCommandHistory
                         |
                         | successful commit only, best effort
                         v
                 DrawingEngineAdapter
                         |
                         v
                 DrawingDocumentV3 shadow
```

규칙:

1. observer는 primary commit이 끝난 뒤 호출한다.
2. observer 반환값은 primary API 반환값에 섞지 않는다.
3. observer 예외는 catch하고 해당 shadow scene만 `desynced`로 격리한다.
4. 격리된 scene은 증분 command를 더 받지 않는다.
5. 격리된 scene은 B 재진입만으로 몰래 정상 상태로 되돌리지 않는다. startup-only
   shadow에서는 scene 생성 시점에만 bootstrap하며, 명시적 개발 진단 reset 또는 새
   scene instance에서만 다시 시작한다.
6. partial document는 노출하지 않는다.
7. adapter는 Fabric history를 되감거나 별도 UI Undo stack을 소유하지 않는다.
8. transition뿐 아니라 activation, eviction, destroy lifecycle callback 예외도 모두 Fabric
   primary 경계 밖으로 격리한다.

## 5. Data contract

### 5.1 Scene identity

외부 file path는 canonical ID로 사용하지 않는다. store scene 생성 시 opaque
`sceneInstanceId`를 한 번 만들고, 같은 warm scene의 B off/on 동안 유지한다.

각 `(stableVideoIdentity, targetFrame)` scene은 다음 shadow content 하나를 가진다.

- document 1개
- layer 1개
- keyframe 1개
- actor 1개
- keyframe frame = `targetFrame`
- initial object order = authoritative `Map` iteration order

Exact constructor skeleton:

```js
{
  documentId: opaqueId('document'),
  coordinateSpace: {
    unit: 'source-pixel',
    origin: 'top-left',
    yAxis: 'down',
    pixelRatio: 1,
    width: sourceWidth,
    height: sourceHeight
  },
  timebase: provisionalTimebase,
  initialLayers: [{
    id: opaqueId('layer'),
    name: 'Session shadow',
    visible: true,
    locked: false,
    opacity: 1,
    keyframes: [{
      id: opaqueId('keyframe'),
      frame: targetFrame,
      empty: false,
      revision: 0,
      objects: canonicalObjects
    }]
  }],
  revisionSequence: initialMutationSequence
}
```

`empty:false`는 object가 0개여도 editable exact keyframe을 뜻한다. document/layer/keyframe/
actor/command ID는 file path를 포함하지 않는 opaque UUID를 사용한다. adapter는
`sourceWidth/sourceHeight`가 positive finite, `targetFrame`이 nonnegative safe integer,
`targetFrame + 1`이 safe integer인지 검증한다. 실패는 Fabric activation을 거부하지 않고
shadow만 `invalid-seed`로 격리한다.

현재 overlay payload에는 정확한 FPS 분자/분모와 totalFrames가 없다. 따라서 이번
session-only shadow는 아래 provisional timebase를 사용한다.

```js
{
  fpsNumerator: 1,
  fpsDenominator: 1,
  totalFrames: targetFrame + 1
}
```

이 timebase는 저장 가능한 review document를 뜻하지 않는다. persistence 단계 전에는
실제 metadata를 전달하는 별도 설계가 반드시 필요하다.

### 5.2 Canonical stroke

Fabric scene record:

```js
{
  id,
  type: 'stroke',
  pathData,
  sourcePoints,
  style: { color, size, opacity },
  transform: { left, top, scaleX, scaleY, angle, skewX, skewY, flipX, flipY },
  strokeCaps?: { start, end }
}
```

V3 shadow stroke:

```js
{
  id,
  type: 'stroke',
  tool: 'brush',
  visible: true,
  locked: false,
  opacity,
  blendMode: 'source-over',
  transform: [a, b, c, d, e, f],
  points: [{ x, y, pressure, time }],
  style: {
    color,
    size,
    thinning: 0.65,
    smoothing: 0.55,
    streamline: 0.5,
    outlineColor: null,
    outlineWidth: 0
  },
  caps: { start, end }
}
```

Conversion rules:

- `pathData`는 파생 데이터이므로 복사하지 않는다.
- point의 `pointerType` 같은 runtime-only 필드는 제거한다.
- color는 canonical lowercase `#rrggbb`로 정규화한다.
- opacity는 object-level opacity로 옮긴다.
- 현재 pilot은 brush-only이므로 `tool: 'brush'`로 고정한다. pen 추가 전에는 Fabric
  record에 tool provenance를 추가해야 한다.
- 원본 획은 `caps: { start: true, end: true }`; 라쏘 fragment는 `strokeCaps`를 보존한다.
- source points, style, transform 입력은 clone해서 alias를 만들지 않는다.

### 5.3 Transform baseline

Fabric `left/top`은 path geometry와 `pathOffset`에 따른 생성 기준값을 포함하므로 그대로
canonical translation으로 복사하면 안 된다.

첫 shadow 단계는 store-level relative baseline을 사용한다.

- scene bootstrap/add 시 해당 record transform을 baseline으로 저장하고 canonical transform은
  identity로 시작한다.
- 이후 move는 `after.left - baseline.left`, `after.top - baseline.top`을 canonical `e/f`로 쓴다.
- Undo/Redo로 삭제한 ID가 다시 들어올 수 있으므로 scene lifetime 동안 ID baseline archive를
  유지한다. live에서 처음 등장한 ID만 `baseTransform`이 필수다.
- history insertion은 `baseTransform:null`을 허용하고 archive의 기존 baseline을 사용한다.
  archive에 없는 ID가 history에서 들어오면 현재 final transform을 baseline으로 가장하지
  않고 `missing-baseline`으로 격리한다.
- baseline과 함께 transform을 제외한 canonical points/style/caps/opacity의 compact content
  signature를 ID lifetime 동안 보존한다. history insertion이 이 signature와 다르면
  `unsupported-field-mutation`으로 격리한다.
- 첫 live insertion의 record transform은 선언한 `baseTransform`과 같아야 한다. 최초부터
  offset이 있으면 숨은 move를 정상 add로 꾸미지 않고 `transition-before-mismatch`다.
- 같은 split commit 안에서 fragment가 생성 즉시 이동하면 insertion의 `baseTransform`을
  baseline으로 사용한다.
- scale/rotation/skew/flip 변화가 발견되면 이번 adapter가 거짓 parity를 만들지 않고
  scene을 `desynced` 처리한다.

후속 renderer-authority 단계에서는 실제 Fabric Path의 `calcTransformMatrix()`와
`pathOffset`을 사용한 exact affine conversion integration test가 필요하다.

## 6. Canonical caps schema amendment

현재 V3 exact schema에는 라쏘 절단면 의미를 보존하는 필드가 없다. points만으로는
내부 절단면의 flat cap을 복원할 수 없으므로 adapter 연결 전에 다음 required field를
추가한다.

```js
caps: {
  start: boolean,
  end: boolean
}
```

- 기존 full stroke fixture는 `{ start: true, end: true }`를 명시한다.
- exact-key validation을 유지한다.
- command inverse, clone, snapshot이 caps를 손실하지 않는지 검증한다.
- 이 변경은 아직 save schema migration이 아니다. V3 pure model contract 보강이다.

## 7. Transition contract

Store가 observer에 보내는 event는 point-heavy 전체 scene clone이 아니라 touched delta다.

```js
{
  scene: {
    sceneInstanceId,
    targetFrame,
    sourceWidth,
    sourceHeight
  },
  mutationSequence,
  origin: 'live' | 'history',
  kind,
  estimatedBytes,
  unsupportedReason: null,
  removals: [{ id, index }],
  insertions: [{ index, record, baseTransform }], // history replay는 null 가능
  transforms: [{ id, beforeTransform, afterTransform }]
}
```

- transition은 별도 point clone을 만들지 않는다. live commit은 `makeObjectsState()`가 이미
  만든 독립 redo-state clone 중 필요한 insertion record/transform의 소유권을 event로 넘긴다.
  history apply는 `DrawingCommandHistory.moveTop()`이 callback에 넘긴 독립 state clone을
  사용한다. scene object와 stored history entry는 별도 clone이므로 alias되지 않는다.
- enqueue 시 scene/scalar envelope와 touched 배열 항목/작은 transform object만 얕게 복사해
  deferred callback 전 routing 변경을 막는다. insertion record의 point 배열은 exclusive
  ownership transfer 계약으로 유지해 primary stack에서 추가 복사하지 않는다.
- queue byte admission도 point payload를 다시 순회하지 않는다. live는 이미 계산한
  `commandBytes`, history는 cloned entry의 `estimatedBytes`를 conservative upper bound로
  event에 싣는다. removal은 ID와 index만 전달한다.
- `estimatedBytes`는 nonnegative safe integer이며 queue admission 전용이다. V3 exact
  command payload에는 복사하지 않는다.
- one successful primary commit = one transition = one V3 command.
- `mutationSequence`는 scene에서 정확히 +1이어야 한다.
- insertions는 final order 기준 contiguous run으로 묶어 `insert-objects` operations를 만든다.
- removals는 pre-order 기준 ID를 `remove-objects`로 만든다.
- surviving object transform 변경은 `set-transforms`로 만든다.
- field mutation이나 surviving ID 상대 순서 변경은 지원된 command로 꾸미지 않는다.
  store는 같은 sequence의 event에 `unsupportedReason`을
  `unsupported-field-mutation | unsupported-order-mutation | unsupported-transform` 중 하나로
  넣고, adapter는 payload를 적용하지 않은 채 그 scene만 격리한다.
- 한 transition에서 같은 ID를 remove+reinsert해 points/style incarnation을 바꾸는 방식도
  `unsupported-field-mutation`이다. lifetime baseline을 덮어쓰지 않는다.

Mapping:

| Fabric mutation | V3 command kind | Operations |
| --- | --- | --- |
| brush add | `add-objects` | insert |
| full-stroke delete | `delete-objects` | remove |
| clear | `delete-objects` | remove all |
| move | `transform-objects` | set-transforms |
| lasso move/delete split | `split-stroke` | remove + insert + optional transform |
| Undo/Redo | final before/after에 맞는 kind | same monotonic command, `source:'history'` |

Undo/Redo는 V3의 이전 inverse를 직접 재생하지 않는다. Fabric history가 적용한 실제
before/after를 새 monotonic shadow command로 투영한다. 이렇게 해야 Fabric가 계속 유일한
Undo authority다.

## 8. Lifecycle and queue

- observer event는 최대 128개이면서 합계 32MiB 이하인 bounded FIFO task queue로 처리한다.
  insertion points를 포함한 event가 단독 32MiB를 넘거나 enqueue가 어느 한도를 넘으면
  해당 scene만 즉시 격리하고 그 payload 참조를 보관하지 않는다. microtask 연쇄는
  브라우저 paint보다 먼저 계속 실행될 수 있으므로 사용하지 않는다. 기본 scheduler는
  `setTimeout(callback, 0)`처럼 event loop와 paint에 양보하는 macrotask이며 테스트에서는
  주입할 수 있다.
- 한 task는 최대 4개 또는 4ms 중 먼저 도달한 시점까지만 처리하고, 남은 작업은 다음
  macrotask로 넘긴다. 느린 command 하나는 끝까지 원자 적용하되 그 뒤 즉시 양보한다.
- queue overflow는 Fabric action을 막지 않고 해당 shadow scene을 `desynced` 처리한다.
- A scene의 overflow/apply failure는 B scene의 queue/status를 바꾸지 않는다.
- A가 overflow/desync되면 A의 기존 pending event도 즉시 제거하고 queue bytes를 정확히
  차감한다. B의 pending order/bytes/status는 유지한다.
- scene별 expected sequence를 검사한다. late, duplicate, gap event는 apply하지 않고 해당
  scene을 격리하며 각각의 bounded diagnostic counter를 증가시킨다.
- transition은 `sceneInstanceId`만 사용하며 private file/video identity나 store `sceneKey`를
  adapter command/diagnostics에 전달하지 않는다.
- store의 video LRU eviction은 실제 제거한 opaque `sceneInstanceId[]`를
  `dropScenes(sceneInstanceIds)` lifecycle callback에 직접 전달한다. key parsing은 금지한다.
- eviction 뒤 같은 video/frame scene이 다시 생겨도 새 `sceneInstanceId`를 발급한다.
- store destroy는 `dropScenes(allSceneInstanceIds)`를 정확히 한 번 호출한다. runtime은 그 뒤
  adapter `destroy()`를 정확히 한 번 소유해 scheduler와 aggregate telemetry까지 닫는다.
- eviction/destroy 뒤 이미 예약된 callback은 no-op이며 payload 참조를 다시 살리지 않는다.
- B off는 scene을 제거하지 않는다. 같은 scene 재진입은 warm shadow를 재사용한다.
- 같은 `sceneInstanceId` warm activation에 다른 dimensions, sequence, authoritative objects가
  들어오면 새 baseline을 잡지 않고 `warm-seed-mismatch`로 격리한다.
- scene source dimensions가 바뀌면 기존 shadow를 재사용하거나 가짜 resync하지 않고
  `seed-signature-changed`로 격리한다.
- `enqueueTransition()`과 `quarantineScene()`은 외부에 예외를 던지지 않는 API다. 그래도
  runtime/store wrapper는 방어적으로 catch하고 즉시
  `quarantineScene(sceneInstanceId, 'observer-failed')`를 다시 시도한다. 마지막 mutation 뒤
  후속 event가 없어도 synced로 남으면 안 된다. activation/scheduler 내부 예외도 같은
  non-throwing quarantine 규칙을 따른다.
- primary scheduler가 throw하면 fallback macrotask scheduler를 한 번 사용한다. fallback도
  실패하면 현재 queued scene들을 각각 격리하고 queue/payload bytes를 0으로 정리한다.

## 9. Diagnostics

사용자 UI, toast, badge는 바꾸지 않는다. 공개 diagnostics에는 raw file path, points,
Fabric JSON, full document를 넣지 않는다.

허용 항목:

```js
{
  enabled,
  status,
  sceneCount,
  bootstrapCount,
  commitCount,
  failureCount,
  divergenceCount,
  resyncCount,
  staleCount,
  gapCount,
  headSequence,
  objectCount,
  estimatedBytes,
  latencyP50Ms,
  latencyP95Ms,
  lastReason
}
```

Diagnostics 자체가 V3 snapshot을 serialize하지 않도록 source test를 둔다.
테스트 전용 `getSceneProjection(sceneInstanceId)`도 `desynced` scene에서는 stale/partial
snapshot을 반환하지 않고 `null`을 반환한다.

## 10. Experiment flag

Production default는 OFF다.

- CLI: `--fabric-drawing-v3-shadow`
- env: `BAEFRAME_FABRIC_DRAWING_V3_SHADOW=1`
- kill switch: `--disable-fabric-drawing-v3-shadow` 또는
  `BAEFRAME_DISABLE_FABRIC_DRAWING_V3_SHADOW=1`
- Fabric pilot가 OFF이면 shadow도 반드시 OFF다.

첫 구현에서는 pure adapter와 store option integration을 먼저 완료한다. packaged app flag
injection은 모든 automated gates를 통과한 뒤 별도 commit으로 추가한다. user manual test는
격리 worktree와 별도 instance profile에서만 실행한다.

Packaged flag 전달 순서는 고정한다.

1. `resolveFabricDrawingV3Shadow()`가 enable, kill switch, Fabric pilot dependency를 main startup
   때 한 번 결정한다.
2. singleton host에는 첫 `ensure()` 전에만 가능한 boolean-only configuration seam을 둔다.
3. host는 Fabric bundle을 평가하기 전에 boolean bootstrap config를 overlay window에 주입한다.
4. bundle singleton은 생성 순간 config를 한 번 읽고 즉시 삭제한다.
5. bootstrap 주입이 실패하거나 late configuration이 들어오면 Fabric prepare는 shadow OFF로
   계속되어야 하며 기존 드로잉을 실패시키지 않는다.

## 11. Known promotion blockers

Shadow parity가 통과해도 다음을 해결하기 전에는 V3를 저장/렌더 authority로 승격하지 않는다.

1. real fps numerator/denominator/totalFrames 전달
2. pen/brush tool provenance 보존
3. actual Fabric matrix/pathOffset exact conversion
4. existing review drawing import/migration
5. large atomic split budget alignment
6. total point-copy memory overhead admission

특히 현재 Fabric에서 유효한 대규모 라쏘는 V3의 user budget을 넘을 수 있다.

- remove + insert + transform 합계가 10,000 object references를 넘을 수 있음
- 여러 긴 획 fragment의 aggregate inserted points가 20,000을 넘을 수 있음

이 경우 shadow는 Fabric action을 거부하거나 여러 command로 쪼개지 않는다. scene을 격리하고
진단만 남긴다. 여러 command로 쪼개면 "한 번의 라쏘 = 한 번의 Undo"가 깨진다. authority
승격 전에는 split 전용 atomic budget 또는 Fabric admission rule을 별도로 설계한다.

## 12. Implementation tasks

### Task 1: Add caps to the pure V3 schema

Files:

- modify `renderer/scripts/modules/drawing-v3/drawing-document.js`
- modify `scripts/tests/drawing-v3-document.test.js`
- modify `scripts/tests/drawing-v3-document-cow.test.js`
- modify `scripts/tests/drawing-v3-document-benchmark.test.mjs`

RED tests:

- missing/extra/non-boolean caps rejected
- full stroke caps survive constructor snapshot
- split command caps survive forward + inverse round-trip
- failed command cannot leak caps/content/index mutation

Verify:

```powershell
npm run test:drawing-v3-hardening
npm run benchmark:drawing-v3
```

Commit:

```powershell
git commit -m "feat: 드로잉 획 절단면 정보를 보존"
```

### Task 2: Build the pure adapter projection and diff engine

Files:

- create `renderer/scripts/modules/drawing-v3/drawing-engine-adapter.js`
- create `scripts/tests/drawing-v3-engine-adapter.test.js`
- modify `package.json`

Public factory:

```js
createDrawingEngineAdapter({
  createDocument,
  nowIso,
  latencyNow,
  createId,
  scheduleWork,
  fallbackScheduleWork,
  limits
})
```

Required methods:

- `activateScene(scene, authoritativeObjects)` (scene 생성/bootstrap 전용)
- `enqueueTransition(event)`
- `applyTransition(event)`
- `quarantineScene(sceneInstanceId, reason)` (non-throwing)
- `dropScenes(sceneInstanceIds)`
- `destroy()`
- `getSceneProjection(sceneInstanceId)` for tests only, cloned
- `getDiagnostics(sceneInstanceId?)`

RED tests:

- empty and warm bootstrap
- exact constructor skeleton, invalid/overflow seed quarantine
- exact canonical point/style/opacity/caps projection
- input alias isolation
- stable ID/order
- add, delete, clear, translate
- lasso remove+insert+translate as one split command
- Undo/Redo before/after transitions as monotonic commands: split move -> Undo -> Redo,
  delete -> Undo, add -> Undo -> Redo에서 transform/baseline 일치
- unknown history insertion is quarantined with `missing-baseline`
- selection/hover/tool/B lifecycle produces no command
- scene/video/frame isolation
- duplicate/gap/unsupported transform/field mutation quarantine
- adapter apply failure isolation and no partial document
- final enqueue/activation/scheduler throw with no later event still quarantines immediately
- queue item/byte ordering, 4ms yield, oversize/overflow quarantine, destroy/evict 중 pending
  event 폐기, A/B scene failure isolation
- `nowIso()` exact ISO timestamp와 latency monotonic clock 분리
- desynced scene projection is null; B off/on cannot auto-resync it
- no raw identity/points in diagnostics

Verify:

```powershell
npm run test:drawing-v3-adapter
npm run test:drawing-v3-hardening
```

Commit:

```powershell
git commit -m "feat: 드로잉 엔진 단방향 어댑터 추가"
```

### Task 3: Add post-commit observer hooks to SessionSceneStore

Files:

- modify `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- create or modify focused store tests

Implementation:

- scene creation adds opaque `sceneInstanceId`, source dimensions, mutation sequence.
- store option은 observer를 구조적으로 주입하며 startup 뒤 동적 부착을 지원하지 않는다.
- 새 scene activation은 빈 authoritative state를 bootstrap한다. restored warm scene은 같은
  adapter scene을 재사용하고 full-scene clone을 만들지 않는다.
- `commitStagedMutation()` captures touched delta and notifies only after primary commit.
- `applyHistoryState()`는 before/after transition을 capture만 한다. `moveHistory()`가
  `DrawingCommandHistory` stack과 mirrored `historyEntries`를 모두 옮긴 뒤에만
  `origin:'history'` event를 enqueue한다.
- observer is optional and default no-op. notification은 bounded FIFO queue에 복사된 touched
  delta만 넣고 primary call stack에서 V3 command를 적용하지 않는다. insertion payload는
  redo/history state의 독립 clone을 transfer해 point 배열을 추가 복사하지 않는다.
- observer exceptions are caught and recorded outside primary mutation return.
- eviction/destroy lifecycle callback removes shadow state.
- full-scene clone on small transform hot path is structurally forbidden.

RED tests:

- failed primary mutations emit nothing
- live add/move/delete/clear emit one exact event each
- split emits one exact event with final z-order and baseTransform
- Undo/Redo emit history events
- observer/lifecycle throw does not change primary return, commandId, objects, selection,
  undo/redo depth, bytes, or mirrored history entries
- final mutation enqueue throw with no subsequent event quarantines scene and returns null projection
- click/selection/tool/B-only paths emit nothing
- video eviction/destroy lifecycle exact once
- old queued event cannot apply after scene eviction/recreation
- desync -> add -> move -> B off/on remains desynced until eviction/restart

Verify:

```powershell
node --test scripts/tests/fabric-drawing-pilot-session.test.js
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Commit:

```powershell
git commit -m "feat: 성공한 드로잉 변경 관찰 지점 추가"
```

### Task 4: Wire the opt-in session shadow

Files:

- modify `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- modify `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- regenerate `renderer/scripts/lib/mpv-fabric-overlay.iife.js`

Implementation:

- runtime option `drawingV3ShadowEnabled` default false.
- enabled runtime creates adapter and supplies store observer/lifecycle callbacks.
- if a custom sceneStore is supplied, runtime does not monkey-patch it.
- diagnostics exposes only the bounded aggregate described above.
- adapter failure never reaches `lastError`, toast, badge, save metric, playback state.

Integration tests:

- real Fabric brush add/move/delete/clear/Undo/Redo projection parity
- real Fabric lasso split caps/order/translation parity under normal budgets
- B off/on warm reuse; video/frame isolation
- B off/on 100회에서 bootstrap/document revision/point-copy 증가 0
- injected converter/apply/observer failures leave Fabric usable for next gesture
- mutationCount/history depth/selection identical with shadow OFF vs ON
- metrics.saveAttemptCount remains 0
- no ReviewDataManager/save/IPC imports in adapter/runtime path
- bridge/save spies show review dirty/save/saveError/toast 0; temp `.bframe` hash, size, mtime unchanged
- shadow failure 전후 playback owner/media/currentFrame/timeline state와 관련 call count 동일

Verify:

```powershell
npm run bundle:mpv-fabric-overlay
npm run test:drawing-v3-adapter
node --test scripts/tests/fabric-drawing-pilot-session.test.js scripts/tests/mpv-fabric-overlay-runtime.test.js
npm run test:fabric-drawing-pilot
npm run test:drawing
npm run test:mpv
```

Commit:

```powershell
git commit -m "feat: Fabric 세션에 V3 그림자 검증 연결"
```

### Task 5: Performance and memory gates

Files:

- create `scripts/tests/drawing-v3-engine-adapter-benchmark.test.mjs`
- modify `package.json`

Gates:

- small transform event creation does not clone/scan 4,000 unrelated records
- 2,000-object scene small transform adapter apply p95 <= 4ms and max를 함께 기록
- primary store enqueue+return p95 < 1ms for a small transform and observer work cannot run before return
- shadow OFF/ON primary-return latency delta is measured for a normal brush, a 20,000-point boundary
  brush, and a normal-budget multi-fragment split; each local p95 delta <= 4ms
- source/instrumentation gate proves event assembly reuses the independent history-state clone and
  performs zero additional point-array clone/byte-scan on the primary stack
- 512-fragment normal-budget split completes atomically or cleanly quarantines
- adapter estimated point/object bytes are reported and return to zero on eviction/destroy
- queue length is bounded; no event payload retained after apply/failure
- 100회 warm B off/on에서 bootstrap count, revision, estimated point bytes 불변
- shadow OFF adds no document/point copy and no adapter scene

Absolute timing is local acceptance evidence, while correctness, no full-scene hot-path clone,
bounded lifetime, and cleanup are stable test gates.

Verify:

```powershell
npm run benchmark:drawing-v3-adapter
```

Commit:

```powershell
git commit -m "test: 드로잉 어댑터 성능과 메모리 기준 추가"
```

### Task 6: Add startup-only packaged experiment flag

Files:

- modify `main/experiment-flags.js`
- modify `main/index.js` and/or the smallest host configuration seam
- modify `main/mpv-overlay-host.js`
- modify focused flag/host tests
- regenerate bundle if needed

Requirements:

- default OFF
- explicit enable and kill switch precedence
- Fabric pilot OFF forces shadow OFF
- the flag reaches the overlay before singleton runtime construction
- exact order is bootstrap config -> bundle evaluation -> singleton creation -> prepare
- bootstrap config is consumed/deleted once; late configure is rejected
- no new renderer/preload persistence IPC
- sanitized shadow diagnostics only

Verify:

```powershell
node --test scripts/tests/experiment-flags.test.js scripts/tests/mpv-overlay-host.test.js
npm run test:fabric-drawing-pilot
npm run test:mpv
```

Commit:

```powershell
git commit -m "feat: V3 그림자 검증 실험 스위치 추가"
```

### Task 7: Full verification and manual handoff

Automated verification:

```powershell
npm run test:drawing-v3-hardening
npm run test:drawing-v3-adapter
npm run benchmark:drawing-v3
npm run benchmark:drawing-v3-adapter
npm run test:drawing
npm run test:fabric-drawing-pilot
node --test scripts/tests/fabric-drawing-pilot-session.test.js scripts/tests/mpv-fabric-overlay-runtime.test.js
npm run test:mpv
npm run lint
npm run build
```

Package checks:

- generated Fabric bundle is current
- packaged mpv required files are non-empty
- source/package mpv SHA-256 match
- `git diff --check` clean
- worktree scope contains no save/ReviewDataManager/preload persistence wiring

Independent review:

- Critical 0
- Important 0
- Ready YES
- explicit verdict that shadow failure cannot affect primary state
- explicit verdict that claims do not exceed provisional timebase/transform/budget limits

Only after all automated gates pass:

1. launch from this isolated worktree with the shadow flag and a separate instance profile;
2. do not close, focus, or control any existing BAEFRAME instance;
3. do not automate mouse/keyboard;
4. user manually tests MPV playback, B toggle, brush, stroke move, lasso split, Delete,
   Undo/Redo, frame/video revisit;
5. read sanitized diagnostics after the user finishes.

## 13. Exit gate

This phase is complete only when:

- user-confirmed baseline behavior remains unchanged
- caps schema tests pass
- adapter pure tests pass
- store post-commit observer tests pass
- Fabric shadow ON/OFF behavioral equivalence tests pass
- normal lasso split projection preserves caps/order/translation
- failures quarantine only shadow and next Fabric gesture still works
- save attempt/toast/review dirty remain zero
- temporary `.bframe` hash/size/mtime and playback/currentFrame/timeline canaries remain unchanged
- lifecycle memory cleanup passes
- performance gates pass
- lint errors 0, build PASS, mpv package hash match
- independent review Critical 0 / Important 0 / Ready YES
- final user manual test is performed by the user only

Passing this exit gate still does not authorize persistence or renderer authority. The next separate
design phase is real metadata + exact transform transport, then canonical rendering behind another
opt-in switch.
