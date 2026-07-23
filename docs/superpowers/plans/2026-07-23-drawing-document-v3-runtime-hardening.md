# DrawingDocumentV3 Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Every behavior change starts with a failing test and every task ends with an isolated commit.

**Goal:** 이미 수동 확인을 통과한 mpv + Fabric 사용감을 바꾸지 않은 채, `DrawingDocumentV3`가 큰 리뷰 문서에서도 한 번의 편집 때문에 문서 전체를 복사하지 않도록 만들고, 과도하게 큰 명령과 Undo가 renderer를 멈추거나 메모리를 소진하기 전에 원자적으로 거부한다.

**Architecture:** 공개 API와 canonical schema는 그대로 유지한다. 생성 시 keyframe/object 위치 인덱스를 한 번 만들고, command 적용 중에는 대상 keyframe의 `objects` 배열과 실제로 바뀐 object만 지연 복사한다. 성공 직전에 root→layer→keyframe 경로만 교체하고 인덱스를 함께 확정한다. 명령은 user/history별 개수·point·근사 byte 예산을 복제 전에 검사하며, 생성된 inverse도 history 예산을 통과해야만 원본 변경을 commit한다.

**Tech Stack:** Node.js CommonJS, `node:test`, `node:assert/strict`, existing ESLint, `performance.now()` telemetry benchmark

## Confirmed baseline

- 2026-07-23 사용자가 별도 시험 앱에서 mpv 재생과 Fabric 드로잉 토글/조작을 직접 확인했고, “일단 잘 되는 것 같다”고 판정했다.
- 이 계획은 그 UI 동작을 건드리지 않는 내부 hardening 단계다.
- 현재 focused model test 130/130, drawing 242/242, mpv 184/184, Fabric pilot 8/8, build PASS가 기준선이다.
- 현재 단일 transform 측정값은 대상 20 objects 약 0.228ms, 대상 20 + 무관 4,000 objects 약 17.864ms, 대상 10,000 objects 약 108.271ms다. 원인은 command마다 전체 `content`를 `structuredClone()`하고 전역 object ID를 다시 순회하는 구조다.

## Non-negotiable scope

- 수정 가능:
  - `renderer/scripts/modules/drawing-v3/drawing-document.js`
  - `scripts/tests/drawing-v3-document.test.js`
  - 새 `scripts/tests/drawing-v3-document-cow.test.js`
  - 새 `scripts/tests/drawing-v3-document-benchmark.test.mjs`
  - `package.json`의 drawing test/benchmark script
- 수정 금지:
  - `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`와 생성 bundle
  - `renderer/scripts/modules/drawing-v3/drawing-command-history.js`
  - Fabric scene/runtime/toolbar
  - ReviewDataManager, IPC, preload, `.bframe` codec/writer, collaboration
  - layer/keyframe 생성·삭제·재정렬 command
- 앱을 실행하거나 마우스·키보드·커서를 자동 조작하지 않는다.
- 공개 API `createDrawingDocumentV3()`, `getContentSnapshot()`, `getHead()`, `resolveFrame()`, `applyCommand()`와 성공 결과 shape를 바꾸지 않는다.
- canonical root/layer/keyframe/stroke schema를 바꾸지 않는다.

## Semantics that must remain exact

다음 판정 순서와 원자성은 기존 130개 테스트와 동일하게 유지한다.

1. malformed apply options와 command envelope의 data-descriptor shape
2. operations array의 O(1) brand/prototype/nonempty/length gate
3. operation count budget
4. 한도 안 operations의 density와 각 operation record/type/payload array header
5. payload array length의 category/combined reference budget
6. insert object의 points data-property/array length만 읽는 aggregate point budget
7. 한도 안 payload의 density와 기존 operation-entry structural validation
8. 성공한 command ID dedupe
9. stale base revision
10. exact target existence
11. layer lock
12. operation 순서대로 canonical stroke, affine matrix, object existence/document duplicate semantic validation
13. 앞선 semantic reason이 없을 때만 saturated approximate-byte budget 결과 확정
14. validated transaction의 COW materialization과 최종 상태 no-op
15. head/keyframe revision overflow
16. 생성 inverse의 history-source budget preflight와 public result materialization
17. content/head/index/dedupe를 한 번에 commit

추가 보존 조건:

- 실패, no-op, overflow, inverse-budget 실패 command ID는 재사용 가능하다.
- 성공한 command ID만 dedupe set에 들어간다.
- object limit는 초과분 object 내부 결함보다 우선한다.
- point limit는 초과 stroke의 point 내부 결함보다 우선한다.
- invalid transform은 object-not-found보다 우선한다.
- `0`과 `-0` transform은 no-op 비교에서 동일하다.
- remove inverse는 operation group 역순, 각 multi-remove group 내부 original index 오름차순을 유지한다.
- forward→inverse 뒤 canonical data와 z-order가 완전히 복원된다.
- constructor input, command input, snapshot, resolve 결과, inverse 결과는 private state와 alias되지 않는다.
- remove한 기존 ID를 같은 command에서 다시 insert할 수 있다.
- 새 ID를 insert한 뒤 같은 command에서 transform/remove할 수 있다.
- 다른 keyframe에 살아 있는 ID는 계속 document-wide duplicate다.

## Command budget contract

기존 stroke/keyframe hard limit에 아래 flat limit keys를 추가한다. `limits` override는 기존과 마찬가지로 양의 safe integer이며 hard default보다 **낮추는 것만** 허용한다.

| user/history flat limit keys | user | trusted history | 의미 |
|---|---:|---:|---|
| `maxUserOperationsPerCommand` / `maxHistoryOperationsPerCommand` | 1,024 | 10,000 | command 안 operation 개수 |
| `maxUserInsertedObjectsPerCommand` / `maxHistoryInsertedObjectsPerCommand` | 512 | 10,000 | 모든 `insert-objects.objects.length` 합 |
| `maxUserRemovedIdsPerCommand` / `maxHistoryRemovedIdsPerCommand` | 10,000 | 10,000 | 모든 `remove-objects.objectIds.length` 합 |
| `maxUserTransformedIdsPerCommand` / `maxHistoryTransformedIdsPerCommand` | 10,000 | 10,000 | 모든 `set-transforms.transforms.length` 합 |
| `maxUserObjectReferencesPerCommand` / `maxHistoryObjectReferencesPerCommand` | 10,000 | 10,000 | 위 세 occurrence 합 |
| `maxUserInsertedPointsPerCommand` / `maxHistoryInsertedPointsPerCommand` | 20,000 | 100,000 | insert되는 모든 stroke의 `points.length` 합 |
| `maxUserCommandBytes` / `maxHistoryCommandBytes` | 4 MiB | 16 MiB | renderer 내부 command/inverse 방어선 |

- occurrence는 unique ID가 아니라 배열에 실제 등장한 횟수를 센다.
- effective **combined object-reference** 한도만 configured combined value와 `maxObjectsPerKeyframe` 중 작은 값이다. inserted/removed/transformed category cap은 각 configured 값 그대로 적용되지만 combined gate가 최종 상한을 제공한다.
- 한 stroke의 user/stored point limit와 한 command의 aggregate point limit는 별개로 모두 적용한다.
- override 관계는 다음을 모두 만족해야 하며 하나라도 깨지면 constructor `TypeError`다.
  - 각 user 값 `<=` 대응 history 값
  - 각 source의 inserted/removed/transformed category cap `<=` 같은 source의 combined reference cap
  - `maxInputPointsPerStroke <= maxUserInsertedPointsPerCommand`
  - `maxStoredPointsPerStroke <= maxHistoryInsertedPointsPerCommand`
  - `maxUserInsertedObjectsPerCommand <= maxHistoryRemovedIdsPerCommand`
  - `maxUserRemovedIdsPerCommand <= maxHistoryInsertedObjectsPerCommand`
  - `maxUserTransformedIdsPerCommand <= maxHistoryTransformedIdsPerCommand`
  - `maxUserObjectReferencesPerCommand <= maxHistoryObjectReferencesPerCommand`
  - `maxUserObjectReferencesPerCommand <= maxHistoryOperationsPerCommand` — user remove inverse가 object마다 insert operation으로 팽창할 수 있기 때문이다.
  - `maxUserCommandBytes <= maxHistoryCommandBytes`
- 일반 IPC 64 KiB와 완성 stroke IPC 2 MiB는 후속 adapter/IPC wire gate다. 이번 4/16 MiB는 순수 모델의 메모리 방어선이며 wire 허용량을 넓히지 않는다.
- 일반 command가 넘으면 다음 reason을 사용한다.
  - `operation-limit-exceeded`
  - `command-object-reference-limit-exceeded`
  - `command-point-limit-exceeded`
  - `command-payload-limit-exceeded`
- 생성된 inverse가 history profile을 넘으면 원 command를 commit하지 않고 `inverse-command-limit-exceeded`를 반환한다.
- approximate byte estimator는 `JSON.stringify()`로 거대 문자열을 만들지 않는다. plain data를 반복문/stack으로 순회하고 UTF-16 문자열 비용, number/boolean/null, key/array/record overhead를 보수적으로 합산하며 `limit + 1`에서 즉시 포화 종료한다.
- inverse byte 검사는 `inverseOperations` 자체를 occurrence 기준으로 측정한다. 이는 **모델이 반환하는 inverse output의 메모리 방어선**이지, 아직 연결하지 않은 `drawing-command-history` entry나 IPC wrapper 전체가 16 MiB 안에 들어간다는 보장이 아니다. 후속 adapter는 실제 forward+inverse+envelope 전체를 별도로 admission-check해야 한다.
- 정상적인 최대 512-fragment 라쏘는 원본 stroke 위치가 비연속일 때 여러 insert group이 필요할 수 있다. user 1,024-operation cap은 remove/insert/optional transform을 포함한 이 정상 경로를 수용한다. 공개 operation schema나 z-order를 바꾸지 않는다.

### O(1)-first array admission

- untrusted array에서 `Reflect.ownKeys()`, density scan, element access를 하기 전에 `Array.isArray`, exact `Array.prototype`, nonempty 여부와 `.length`만 O(1)로 확인한다.
- operations length가 cap을 넘으면 sparse/hole/accessor element를 보지 않고 `operation-limit-exceeded`다.
- payload array length의 누적 category/combined cap을 넘으면 해당 payload의 density와 nested ID/object/transform entry를 보지 않고 `command-object-reference-limit-exceeded`다.
- inserted object occurrence cap 안에서 각 object의 `points`는 `Object.getOwnPropertyDescriptor()`로 data property인지 확인한다. 유효한 array header의 length만 합산하고 point/style element는 읽지 않는다. aggregate cap을 넘으면 nested style/point 결함보다 `command-point-limit-exceeded`가 우선한다.
- 단, 한 stroke의 points length가 source별 기존 cap(`maxInputPointsPerStroke` 또는 `maxStoredPointsPerStroke`)을 넘으면 aggregate 합산보다 먼저 기존 `point-limit-exceeded`를 반환한다. 모든 개별 stroke가 자기 cap 안에 있고 합계만 넘을 때에만 `command-point-limit-exceeded`다.
- cap 안에 들어온 배열만 기존 exact density 검사를 수행한다. 따라서 at-limit sparse/hole/accessor는 기존 field-specific malformed reason이고, over-limit sparse 배열은 limit reason이다.
- count reason의 동시 초과 우선순위는 operations → inserted objects → removed IDs → transformed IDs → combined refs → aggregate points → bytes다.

### Deterministic approximate-byte estimator

- estimator는 operation payload의 기존 structural gate 뒤 descriptor-only로 계산할 수 있지만, 그 결과는 dedupe/stale/target/lock과 operation 순서의 semantic validation이 모두 성공할 때까지 public reason으로 반환하지 않는다. 따라서 used ID+invalid matrix는 `duplicate-command-id`, stale+invalid stroke는 `stale-revision`, missing target/locked+invalid object는 각각 `target-not-found`/`layer-locked`, earlier missing-object+later invalid transform은 `object-not-found`를 유지한다.
- estimator는 accessor를 호출하거나 임의 object graph를 실행하지 않는다. active-path `WeakSet`으로 cycle을 발견하면 해당 branch를 `unmeasurable`로 표시하고 계속하지 않는다. cycle/accessor/class 등 semantic 결함의 reason은 기존 validator가 원래 순서에서 결정하며 estimator가 선점하지 않는다. shared child는 각 occurrence마다 다시 계산한다.
- byte 상수는 다음으로 고정한다: `null=4`, `boolean=5`, finite `number=8`, `string=4 + UTF-16 codeUnits*2`, `array base=8 + entry당 4`, `record base=8 + own entry당 4`, record key도 string 공식으로 더한다.
- 포화 덧셈은 `total > limit - addition`이면 즉시 `limit + 1`을 반환하며, 그 뒤의 property/element를 읽지 않는다.
- semantic validation이 모두 성공했고 estimator가 measurable일 때만 exceeded 결과를 `command-payload-limit-exceeded`로 확정한다. valid canonical command는 tree-shaped schema이므로 measurable이어야 한다.

## Copy-on-write and index contract

constructor validation/clone 뒤 private index를 만든다.

```js
keyframeLocations: Map<keyframeId, {
  layerIndex,
  keyframeIndex,
  layerId,
  frame
}>

objectLocations: Map<objectId, {
  keyframeId,
  objectIndex
}>
```

- Phase 1A에는 layer/keyframe 구조 명령이 없으므로 `keyframeLocations`는 생성 후 안정적이다.
- `objectLocations`는 성공한 structural command의 대상 keyframe 범위만 갱신한다.
- command 처리 중 원본 `content`, layer, keyframe, object, points/style은 읽기 전용이다.
- 대상 `objects` 배열은 첫 실제 변경 때 한 번만 얕게 복사한다.
- transform은 바뀌는 object와 6-number matrix만 새 값으로 교체한다.
- semantic planning draft에는 insert input을 read-only caller reference로 잠시 둘 수 있지만 이를 mutation·노출·commit하지 않는다. operation 의미가 모두 유효하고 byte budget을 통과한 뒤, 최종 상태에 남는 inserted object만 깊게 복사해 caller alias를 끊는다.
- transform은 planning draft에서 새 object/matrix를 만들며 nested caller data는 읽기 전용으로 유지한다. final inserted object materialization 뒤에만 private state가 될 수 있다.
- remove inverse가 보유하는 object는 원본을 수정하지 않으며, 반환 직전에 깊게 복사한다.
- structural operation이 필요할 때만 대상-local ID→index map을 만들고 transaction 안에서 갱신하거나 dirty 후 지연 재생성한다.
- document-wide current existence는 persistent `objectLocations`와 transaction-local `removedBaseIds`/`addedIds`로 판단한다. 전체 ID set을 command마다 복사하지 않는다.
- 성공 commit은 root `layers` array, target layer, target `keyframes` array, target keyframe만 path-copy한다. coordinate/timebase와 무관 layer/keyframe/object는 private immutable reference를 공유해도 된다.
- 실패/no-op/overflow/inverse-budget 실패 시 draft, local sets/index를 폐기하고 private content/head/index/dedupe는 bit-for-bit 의미상 불변이어야 한다.
- `applyCommand()` 중 전체 root `content`를 `structuredClone()`하는 횟수는 0이어야 한다.

---

## Task 1: Command budget preflight and inverse admission

**Files:**
- Modify: `renderer/scripts/modules/drawing-v3/drawing-document.js`
- Modify: `scripts/tests/drawing-v3-document.test.js`

### Step 1: Add RED boundary and precedence tests

- user/history 각 profile의 operation, inserted objects, removed IDs, transformed IDs, combined refs, aggregate points, approximate bytes에 대해 exact boundary PASS / boundary+1 atomic FAIL을 작성한다.
- 같은 ID가 여러 operation에 반복되어도 occurrence로 합산되는 테스트를 작성한다.
- 512-fragment-shaped split command와 여러 비연속 insert group이 user profile에서 PASS하고 1,025 operations는 FAIL하는 테스트를 작성한다.
- oversized outer array가 extra nested defect보다 먼저 budget reason을 내는 테스트를 작성한다. 최소 조합은 oversized+duplicate ID, oversized+bad transform entry, oversized points+bad stroke style이다.
- 단일 stroke의 기존 point cap exact/+1은 계속 `point-limit-exceeded`, 여러 valid stroke의 aggregate exact/+1만 `command-point-limit-exceeded`인지 user/history 양쪽에서 고정한다.
- length만 큰 sparse `operations`, `objects`, `objectIds`, `transforms`, `points`가 nested getter를 실행하거나 전체 key를 열거하지 않고 즉시 해당 limit reason을 내는 테스트를 작성한다.
- at-limit accessor, sparse array, class instance는 estimator에 닿기 전에 기존 malformed reason으로 거부되고 getter가 실행되지 않는 테스트를 작성한다.
- lowered overrides의 exact/+1과 잘못된 관계를 constructor `TypeError`로 고정한다.

Run: `node --test scripts/tests/drawing-v3-document.test.js`

Expected: new tests FAIL because budget keys/reasons do not exist.

### Step 2: Split structural validation from count-first preflight

- top-level command record의 exact data descriptors와 operations array header만 먼저 확인한다.
- 모든 untrusted arrays는 O(1) header/length gate를 통과한 뒤에만 `Reflect.ownKeys()` 또는 element loop를 허용한다.
- operation count와 각 payload array length를 density/element deep-walk 전에 합산한다.
- insert object count cap 뒤 각 object의 `points` data-array 길이를 합산한다.
- count gate를 통과한 payload의 density와 기존 operation-entry structure까지만 early validation한다. canonical stroke, affine matrix, document-wide duplicate/object existence는 dedupe/stale/target/lock 뒤 원래 operation 순서에서 수행한다.
- shallow envelope → O(1) length budgets → within-limit density/operation structure → dedupe → stale → target → lock → sequential semantics → byte budget의 공개 precedence를 테스트와 함께 고정한다.
- used command ID+invalid matrix, stale+invalid stroke, missing target+invalid object, locked target+invalid object, earlier missing-object operation+later invalid transform의 기존 reason을 RED tests로 고정한다.

### Step 3: Add saturated approximate-byte estimator

- 재귀 call-stack overflow를 피하는 iterative stack을 사용한다.
- descriptor-only walker로 입력을 안전하게 계수하되, exceeded/unmeasurable 결과를 operation semantic validation 전에는 반환하지 않는다.
- command에 대해서는 envelope 전체를, inverse에 대해서는 inverse operations 자체를 잰다.
- active-path cycle/accessor는 실행하지 않고 semantic validator에 reason 결정을 넘기며, shared child는 occurrence마다 센다.
- byte boundary 테스트는 낮춘 limit와 ASCII/한글 문자열, shared child, cyclic record를 모두 사용한다. cyclic record는 estimator reason이 아니라 기존 field-specific semantic reason을 유지해야 한다.

### Step 4: Preflight generated inverse before commit

- operations 적용, final no-op, revision overflow 확인 뒤 생성 inverse를 history profile로 검사한다.
- inverse가 넘으면 `inverse-command-limit-exceeded`로 반환하고 content/head/index/dedupe를 전혀 바꾸지 않는다.
- 실패한 ID를 작은 valid command에 재사용할 수 있음을 테스트한다.
- 큰 remove가 생성하는 many-insert inverse와, 많은 points를 가진 object 제거 inverse를 각각 검사한다.
- `publicInverseOperations`, success result object, next path-copy content, index delta를 모두 private-state mutation 전에 materialize한다.
- test 전용 `structuredClone` throw 주입으로 public inverse clone이 실패해도 `applyCommand()`가 throw하기 전 content/head/dedupe가 불변이고 같은 command ID를 재사용할 수 있음을 확인한다.
- 첫 private-state mutation 뒤에는 clone, validation, estimator, caller code를 실행하지 않는다. 미리 만든 primitive-key index delta의 `Map.delete`/`Map.set`, private reference assignment, 성공 ID `Set.add`만 연속 수행한다.

### Step 5: Verify and commit Task 1

Run:

```powershell
node --test scripts/tests/drawing-v3-document.test.js
npm run test:drawing
npm run lint -- --quiet
```

Expected: focused and drawing tests PASS, lint errors 0.

Commit:

```powershell
git add renderer/scripts/modules/drawing-v3/drawing-document.js scripts/tests/drawing-v3-document.test.js
git commit -m "fix: 드로잉 명령 메모리 방어선 추가"
```

---

## Task 2: Persistent indexes and target-local lazy COW

**Files:**
- Modify: `renderer/scripts/modules/drawing-v3/drawing-document.js`
- Create: `scripts/tests/drawing-v3-document-cow.test.js`
- Modify: `package.json`

### Step 1: Add RED structural safety tests

다음 black-box tests를 새 파일에 작성한다.

- `global.structuredClone` spy로 `applyCommand()` 중 root content와 root layers를 clone한 호출이 0인지 확인한다. 각 clone 인수의 canonical node 수를 test helper가 세며, small document와 **다른 layer/keyframe에** 무관 4,000 objects가 있는 문서에서 apply 중 총 clone-node 수가 동일해야 한다. spy는 `try/finally`에서 반드시 복원하고 해당 tests는 concurrency를 끈다.
- source guard가 apply path의 `clonePlain(content)`, `collectDocumentObjectIds`, `content.layers` 전체 순회 재도입을 탐지한다. constructor/snapshot/resolve의 전체 순회·clone은 허용하되 apply call graph에서는 금지한다.
- insert 뒤 late failure, remove 뒤 late failure, revision overflow, final no-op, inverse-budget failure 후 ID index가 새거나 해제되지 않는지 다음 command 결과로 관측한다.
- successful insert/remove 뒤 index shift 상태에서 첫/middle/last object transform이 정확한 대상을 바꾸는지 확인한다.
- 기존 object remove→same ID reinsert, new insert→transform→remove, 다른 keyframe으로 ID reuse/duplicate 규칙을 확인한다.
- base ID remove→reinsert→remove→reinsert와 new ID insert→remove→reinsert의 transaction-local set 전이를 확인한다.
- valid keyframeId와 wrong layerId 또는 wrong frame 조합이 `target-not-found`이고 index lookup이 엉뚱한 keyframe을 열지 않는지 확인한다.
- 100 sequential transform operations의 result/inverse/head가 기존 의미와 동일한지 확인한다.

Run: `node --test --test-concurrency=1 scripts/tests/drawing-v3-document-cow.test.js`

Expected: root clone and unrelated-object work tests FAIL.

### Step 2: Build immutable constructor indexes

- initial canonical content validation 중 keyframe/object uniqueness를 확인하며 location maps를 함께 만든다.
- target lookup은 `keyframeLocations`와 path indices를 사용한다.
- transform-only object lookup은 `objectLocations`를 사용하고 target keyframe 일치를 확인한다.
- index는 외부 API로 노출하지 않는다.

### Step 3: Replace full draft clone with transaction-local COW

- `clonePlain(content)`와 command별 `collectDocumentObjectIds(content)`를 제거한다.
- original target objects는 no-op 비교와 inverse source로만 읽는다.
- 첫 mutation 시 `objects.slice()`를 만들고 transform 대상 object만 `{ ...object, transform: [...matrix] }`로 교체한다.
- insert는 semantic planning 동안 caller input을 read-only reference로 추적하고, 모든 semantic reason과 byte budget이 통과한 뒤 최종 상태에 남는 inserted object만 깊게 clone한다. oversized valid string/object를 payload failure 전에 복제하지 않는다.
- structural lookup map과 current existence sets는 transaction 안에서만 관리한다.

### Step 4: Atomic path-copy commit and index update

- final no-op/revision/inverse checks를 모두 통과한 뒤 target keyframe revision을 올린 새 keyframe을 만든다.
- root→layer→keyframe 경로만 복사해 next content를 만든다.
- structural change가 있을 때만 기존 target IDs를 `objectLocations`에서 제거하고 final target IDs로 다시 기록한다.
- public inverse clone/result, next content/path arrays, target index delta를 전부 먼저 완성한다.
- content/head/objectLocations/appliedCommandIds commit 사이에는 사용자 코드, clone, validation, estimator를 호출하지 않는다.

### Step 5: Verify and commit Task 2

Run:

```powershell
node --test --test-concurrency=1 scripts/tests/drawing-v3-document-cow.test.js
node --test scripts/tests/drawing-v3-document.test.js
npm run test:drawing
npm run lint -- --quiet
```

Expected: all PASS, root-content clone count 0.

Commit:

```powershell
git add renderer/scripts/modules/drawing-v3/drawing-document.js scripts/tests/drawing-v3-document-cow.test.js package.json
git commit -m "perf: 드로잉 명령을 대상 범위만 복사하도록 개선"
```

---

## Task 3: Deterministic regression gates and performance telemetry

**Files:**
- Create: `scripts/tests/drawing-v3-document-benchmark.test.mjs`
- Modify: `package.json`
- Modify if needed: `scripts/tests/drawing-v3-document-cow.test.js`

### Step 1: Add an isolated benchmark command

`package.json`에 다음 역할의 scripts를 추가한다.

```json
{
  "test:drawing-v3-hardening": "node --test --test-concurrency=1 scripts/tests/drawing-v3-document.test.js scripts/tests/drawing-v3-document-cow.test.js",
  "benchmark:drawing-v3": "node --test --test-concurrency=1 scripts/tests/drawing-v3-document-benchmark.test.mjs"
}
```

`test:drawing`에도 COW test를 포함하되 benchmark는 일반 회귀에 넣지 않는다.

### Step 2: Implement telemetry scenarios

light transform scenario는 setup/snapshot/assert를 timed region 밖에 두고, 한 measured batch 안에서 200회의 alternating transform command를 적용한다. 5개 warmup batch 뒤 최소 20개 measured batch를 수집하고, per-command duration의 median과 nearest-rank `p95 = sorted[Math.ceil(0.95 * n) - 1]`를 출력한다. structural scenario는 한 batch에 5 round-trip을 적용하고 동일하게 5 warmup + 20 measured batches를 사용한다.

- target 20 objects single transform
- target 20 + **다른 layer/keyframe의** unrelated 4,000 objects single transform
- target 10,000 objects의 first/middle/last single transform
- target 10,000 objects 중 교차된 비연속 5,000 objects remove/inverse insert round-trip
- 같은 패턴의 target 5,000/noncontiguous 2,500 round-trip을 함께 측정해 2배 size scaling을 비교
- one command with 100 transform operations
- late operation failure rollback

시간 측정과 별도로 모든 scenario에서 content/head/forward-inverse 결과를 assert한다.

### Step 3: Use stable gates

- CI hard gate는 시간 한 번의 절댓값이 아니라 결과 정확성, full-document clone 0, failure index leak 0에 둔다.
- local performance acceptance:
  - unrelated 4,000 case median은 small case median의 2배 이내
  - target 10,000 single transform p95는 16.7ms 이하
  - noncontiguous 5,000 remove/inverse round-trip median은 2,500 case의 3배 이하여야 한다. 약 4배가 되는 quadratic splice/index-rebuild 퇴행은 adapter 단계 blocker다.
- 각 ratio는 batch 총시간이 아니라 per-command median으로 비교하고, setup·fixture creation·snapshot·assert 비용은 포함하지 않는다.
- timer resolution/noise 때문에 수치 gate가 흔들리면 benchmark는 측정값과 경고를 출력하되 test correctness를 거짓 실패시키지 않는다. 단, 기준을 넘으면 다음 adapter 단계의 blocker로 문서화한다.

### Step 4: Verify and commit Task 3

Run:

```powershell
npm run test:drawing-v3-hardening
npm run benchmark:drawing-v3
npm run test:drawing
```

Expected: correctness PASS; local acceptance targets reported with before/after comparison.

Commit:

```powershell
git add scripts/tests/drawing-v3-document-benchmark.test.mjs scripts/tests/drawing-v3-document-cow.test.js package.json
git commit -m "test: 드로잉 문서 성능 회귀 기준 추가"
```

---

## Task 4: Full regression, package evidence, and independent review

### Step 1: Run complete verification

```powershell
npm run test:drawing-v3-hardening
npm run benchmark:drawing-v3
npm run test:drawing
npm run test:mpv
npm run test:fabric-drawing-pilot
npm run lint
npm run build
```

- lint는 errors 0을 요구한다. 기존 warning 수는 baseline과 비교해 증가하지 않아야 한다.
- build output의 required mpv files 4개가 nonempty이고 source/package SHA-256가 일치하는지 다시 확인한다.
- `git diff cab9336...HEAD`에서 runtime/IPC/save/Fabric UI 파일이 바뀌지 않았는지 확인한다.
- `rg`로 DrawingDocumentV3가 앱 runtime/save 경로에 연결되지 않았음을 확인한다.
- worktree가 clean인지 확인한다.

### Step 2: Independent review

리뷰어는 plan과 전체 branch diff를 읽고 다음을 판정한다.

- Critical/Important correctness finding 0
- failed/no-op/inverse-budget commands cannot leak index/dedupe/content changes
- public schema/API/reason precedence is preserved except specified new budget reasons
- apply path has no full-content clone or document-wide scan
- benchmark claims match reproducible output
- forbidden runtime/UI/save scope untouched

`Ready: YES`가 아니면 finding별 RED test를 먼저 추가하고 수정·재검증한다.

## Exit gate

다음을 모두 만족해야만 후속 `drawing-engine-adapter.js` 계획으로 넘어간다.

- focused hardening tests PASS
- drawing/mpv/Fabric regressions PASS
- lint errors 0, build PASS
- packaged mpv hash match
- full-content clone 0 structural gate PASS
- unrelated 4,000 objects median <= small median ×2
- target 10,000 single transform p95 <=16.7ms, 또는 환경 노이즈가 입증된 경우 반복 측정과 구조 지표로 명시적 판단 기록
- noncontiguous 5,000 remove/inverse round-trip median <= 2,500 case median ×3
- independent review Critical 0 / Important 0 / Ready YES
- 사용자 UI 자동 조작 0, 기존 실행 중 BAEFRAME instance 영향 0

이 exit gate 뒤의 다음 별도 단계는 Fabric scene과 canonical document 사이의 one-way adapter 및 session-only shadow integration이다. 저장/IPC 연결과 legacy 숨김 제거는 그보다 뒤이며, 이번 계획에 포함하지 않는다.
