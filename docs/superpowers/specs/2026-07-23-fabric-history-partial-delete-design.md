# BAEFRAME Fabric 명령 이력과 라쏘 부분 삭제 설계

- 문서 상태: 구현 승인됨
- 기준 커밋: `a6dfea7 feat: Fabric 라쏘 부분 선택과 이동 추가`
- 대상: opt-in Fabric 드로잉 시험판
- 저장 정책: 세션 전용, `.bframe` 및 리뷰 데이터 저장 금지

## 1. 결정 요약

다음 구현 단위는 Fabric 시험판의 Undo/Redo와 삭제 안정화다.

채택 구조는 **overlay-local 명령 이력 + 미확정 라쏘 선택 transaction**이다.

- 라쏘를 놓는 행위는 선택일 뿐이며 공식 scene을 변경하지 않는다.
- 라쏘 조각은 이동이 실제로 끝나거나 Delete를 누를 때 한 command로 확정한다.
- 그리기, 획 이동, 다중 획 이동, 획 삭제, 라쏘 부분 이동, 라쏘 부분 삭제, 전체 지우기를 장면별 Undo/Redo 이력에 기록한다.
- `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`는 Fabric 입력이 활성일 때만 Fabric command에 적용한다.
- 텍스트 입력과 IME에서는 기존 입력창의 Undo/Redo를 유지한다.
- 어떤 동작도 리뷰 데이터 저장을 호출하지 않는다.

## 2. 현재 문제

현재 기준점은 사용자가 확인한 선택 사용감을 제공하지만 내부 이력은 임시 상태다.

- 라쏘 pointerup에서 `replaceObjects()`가 공식 scene을 즉시 분할한다.
- 이동 없이 선택을 취소할 때 공개 `undo()`로 원상 복구해 mutation이 추가된다.
- 일반 획 이동, Delete, Clear, 새 획은 기존 라쏘 undo 이력을 지운다.
- Redo stack이 없다.
- controller와 main host는 Delete/Clear만 허용하며 Ctrl+Z/Y는 legacy 차단 경로에서 소비된다.

따라서 키만 연결하면 일부 라쏘 동작만 간헐적으로 되돌아가고 일반 작업은 되돌릴 수 없다.

## 3. 사용자 경험 계약

| 사용자 동작 | Scene 변경 | History | Redo 보존 | 저장 시도 |
|---|---:|---:|---:|---:|
| hover, 클릭 선택, 사각 선택 | 없음 | 없음 | 보존 | 0 |
| 라쏘 부분 선택만 | 없음 | 없음 | 보존 | 0 |
| 선택 취소, B 해제, blur, 도구 전환 | 없음 | 없음 | 보존 | 0 |
| 새 획 하나 완성 | 1회 | add 1개 | 제거 | 0 |
| 획 하나 또는 여러 개 이동 | 1회 | transform 1개 | 제거 | 0 |
| 라쏘 부분 이동 | 1회 | split+transform 1개 | 제거 | 0 |
| 획 선택 Delete | 1회 | delete 1개 | 제거 | 0 |
| 라쏘 부분 Delete | 1회 | split+delete 1개 | 제거 | 0 |
| Clear | 1회 | clear 1개 | 제거 | 0 |
| 선택 없는 Delete, 0거리 이동 | 없음 | 없음 | 보존 | 0 |
| Undo | 역연산 1회 | undo에서 redo로 이동 | 해당 없음 | 0 |
| Redo | 정연산 1회 | redo에서 undo로 이동 | 해당 없음 | 0 |

Undo/Redo 이후에는 active selection을 비운다. 사용자가 복원된 객체를 실수로 연속 이동하거나 삭제하지 않게 하기 위한 정책이다.

## 4. 접근 비교

### 4.1 채택: 객체 단위 command + pending transaction

각 command는 변경된 객체와 순서, transform의 정방향·역방향 정보만 보관한다. 라쏘 fragment는 command 확정 전까지 runtime 메모리에만 둔다.

장점:

- 500~2,000획 장면에서 전체 scene 복제보다 메모리 사용이 작다.
- 한 제스처를 한 command로 원자화할 수 있다.
- 이후 `DrawingEngineAdapter`와 저장·협업 command로 승격하기 쉽다.

단점:

- 현재 임시 lasso undo를 정리하고 구조 command와 transform command를 함께 지원해야 한다.

### 4.2 제외: command마다 전체 scene snapshot

구현은 단순하지만 획 수와 포인트 수가 늘수록 이력 메모리와 재생성 비용이 급격히 증가한다. 복원 때 전체 Fabric canvas를 다시 만드는 빈도도 높아져 깜빡임 위험이 있다.

### 4.3 이번 단계에서 제외: 기존 main global Undo에 직접 합류

기존 글로벌 Undo에 즉시 연결하면 overlay에서 main으로 전체 command payload를 보내야 하고 저장·협업 경계까지 동시에 넓어진다. 시험판의 무저장·낮은 IPC 범위를 깨므로 Phase 1 이후에 진행한다.

## 5. 컴포넌트 구조

### 5.1 DrawingCommandHistory

새 모듈 `renderer/scripts/modules/drawing-v3/drawing-command-history.js`가 장면 하나의 undo/redo stack을 관리한다.

공개 API:

```js
createDrawingCommandHistory({
  maxEntries,
  maxBytes,
  estimateEntryBytes
})

history.record(command)
history.undo(applyState)
history.redo(applyState)
history.clear()
history.getDiagnostics()
```

command는 최소한 다음 필드를 가진다.

```js
{
  id,
  kind,
  undoState,
  redoState
}
```

`record()`는 새 실제 command에서만 redo stack을 비운다. 선택, 취소, no-op은 `record()`를 호출하지 않는다.

단일 command가 `maxBytes`를 초과하면 `record()`는 거부한다. 삭제·분할·Clear처럼 데이터 손실 가능성이 있는 동작은 history 기록이 보장되지 않으면 scene 변경도 거부한다.

### 5.2 SessionSceneStore

각 scene은 독립된 `DrawingCommandHistory`를 소유한다. 다른 영상·프레임의 이력은 섞이지 않는다.

구조 변경 command의 state:

```js
{
  type: 'objects',
  touchedIds,
  objects,
  order
}
```

transform command의 state:

```js
{
  type: 'transforms',
  transforms: [{ id, transform }]
}
```

다음 mutation은 command를 기록한다.

- `addStroke()` → `add-objects`
- `transformSelection()` → `transform-objects`
- `replaceObjects()` → `split-stroke`, 선택적 이동 transform을 같은 호출에서 적용
- `deleteSelection()` → `delete-objects`
- `clearSession()` → `clear-keyframe`

Undo/Redo 적용 시 객체 ID, 원래 z-order, 원래 transform을 복원하고 selection은 비운다. 새 command가 기록되면 redo만 비우며 이전 undo 이력은 유지한다.

### 5.3 PendingLassoSelection

`finalizeActiveLasso()`는 공식 scene을 변경하지 않고 다음 runtime 상태만 만든다.

```js
{
  sessionId,
  inputRevision,
  sourceMutationCount,
  replacements,
  selectedPersistedIds,
  selectedFragmentIds,
  originalFabricObjects,
  fragmentFabricObjects,
  activeTarget,
  phase: 'selected' | 'moving'
}
```

- 부분 fragment는 투명 hit proxy로 올린다.
- 완전히 포함된 기존 획은 원래 Fabric 객체를 그대로 선택한다.
- 이 상태에서는 object count, mutation count, dirty, undo/redo depth가 변하지 않는다.
- 첫 실제 `object:moving`에서만 원본 crossing path를 화면에서 숨기고 fragment를 표시한다.
- `object:modified`에서 이동 거리가 0보다 클 때 `split-stroke` command 하나를 확정한다.
- Delete는 선택 fragment를 제외한 바깥 fragment만 남기는 `split-stroke` command 하나를 확정한다.
- 취소, blur, B 해제, 도구/프리셋/세션 변경은 proxy만 폐기하고 원본 scene을 그대로 둔다.

pending 취소는 공개 Undo를 사용하지 않는다.

## 6. 키보드 라우팅

### main renderer에서 시작한 키

`FabricDrawingPilotController.routeKeydown()`이 다음 조합만 Fabric history action으로 변환한다.

- `Ctrl+Z` 또는 `Cmd+Z` → `undo`
- `Ctrl+Y` 또는 `Cmd+Y` → `redo`
- `Ctrl+Shift+Z` 또는 `Cmd+Shift+Z` → `redo`

규칙:

- IME composing, `keyCode 229`, Alt 조합은 거부한다.
- input, textarea, select, contenteditable에서는 거부해 native text history를 보존한다.
- `preparing`에서는 이벤트만 소비하고 action을 보내지 않는다.
- `active`에서 최초 keydown 한 번만 tokenized action을 보낸다.
- auto-repeat은 소비하되 추가 command를 실행하지 않는다.
- controller는 history action queue를 사용해 빠른 Undo 다음 Redo도 요청 순서대로 보낸다.

### overlay 창에서 시작한 키

overlay의 `before-input-event`는 출처를 알고 있으므로 history shortcut을 main의 stale active element로 전달하지 않는다. host가 현재 `hostGeneration`, `videoGeneration`, `inputRevision`, `sessionId`로 action을 직접 실행하고 이벤트를 소비한다.

host는 controller IPC와 overlay-origin shortcut을 같은 직렬 action queue에 넣는다. 서로 다른 action ID여도 실행 순서를 보장한다.

그 외 B, V, Delete, Space 릴레이는 기존 main renderer 단일 경로를 유지한다.

## 7. 오류와 용량 정책

- stale session, stale input revision, 중복 action ID는 현재 정책대로 거부한다.
- pending lasso commit 중 fragment 생성, history 용량, scene 용량 중 하나라도 실패하면 공식 scene은 원본 그대로다.
- Undo/Redo 적용 실패 시 stack 이동을 롤백하고 scene을 변경하지 않는다.
- 한 장면의 기본 history 최대 개수는 32다.
- history 총량은 기존 `maxHistoryBytes` 한도를 사용하며 undo와 redo를 합산한다.
- 오래된 history를 제거할 수 있으면 가장 오래된 undo부터 제거한다.
- 단일 inverse command가 한도를 초과하면 되돌릴 수 없는 삭제·분할을 허용하지 않는다.

## 8. UI 범위

이번 단계는 기존 시험 툴바에 `Undo`, `Redo` 버튼을 추가한다. 버튼과 키보드는 동일한 `applyDrawingAction()` 경로를 사용한다.

- Undo/Redo 후 canvas를 현재 scene에서 한 번 다시 그린다.
- 일반 선택과 라쏘 선택 자체는 canvas 전체를 다시 만들지 않는다.
- 성공 토스트나 mpv 연결 알림을 추가하지 않는다.

## 9. 파일 경계

생성:

- `renderer/scripts/modules/drawing-v3/drawing-command-history.js`
- `scripts/tests/drawing-v3-command-history.test.js`

수정:

- `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- `renderer/scripts/lib/mpv-fabric-overlay.iife.js` — 공식 bundle 명령으로만 재생성
- `renderer/scripts/modules/fabric-drawing-pilot-controller.js`
- `main/mpv-overlay-host.js`
- `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- `scripts/tests/fabric-drawing-pilot-shortcuts.test.js`
- `scripts/tests/fabric-drawing-pilot-integration.test.js`
- `scripts/tests/mpv-overlay-host.test.js`
- `package.json` — 새 순수 history 테스트를 기존 집중 테스트에 포함

수정 금지:

- `renderer/scripts/app.js`
- `renderer/scripts/modules/review-data-manager.js`
- 기존 `drawing-manager.js`, `drawing-canvas.js`, `drawing-sync.js`
- `.bframe` 스키마와 저장 IPC

## 10. 검증 기준

### 순수 history

- add, transform, delete, clear의 Undo/Redo 왕복
- Undo 후 선택/no-op은 Redo 보존
- Undo 후 새 command는 Redo 제거
- 장면별 history 분리
- 최대 개수와 바이트 제한
- apply 실패 시 stack과 scene 원복

### 실제 Fabric runtime

- 라쏘 선택 직후 scene objects, mutation, dirty, history 불변
- 부분 이동 확정 뒤 Undo 한 번에 원래 ID·path·z-order 복원, Redo 한 번에 같은 이동 상태 복원
- 부분 Delete 뒤 Undo/Redo 왕복
- 완전 포함 획과 부분 fragment 혼합 Delete 왕복
- 획/다중 획 이동과 Delete가 각각 한 command
- 0거리 이동, 선택 없는 Delete, 취소는 history 불변
- B 해제, blur, 프리셋 전환, 새 라쏘에서 pending proxy가 남지 않음
- 모든 시나리오에서 `saveAttemptCount === 0`

### 키와 host

- main 창의 Ctrl+Z/Y/Shift+Z가 정확한 action 하나를 전송
- preparing과 auto-repeat은 소비하지만 action 없음
- editable/IME/Alt 조합은 Fabric이 소비하지 않음
- overlay-origin history shortcut은 stale main active element와 무관하게 action 하나만 실행
- action allowlist, token 검증, in-flight/completed dedupe 유지

### 회귀와 실제 앱

- Fabric runtime 집중 테스트
- Fabric pilot source/shortcut/session/integration/benchmark
- mpv overlay host와 전체 mpv 테스트
- 기존 drawing 테스트
- bundle source/package parity
- 새 고유 profile의 unpacked 앱에서 실제 B, V, 라쏘, Delete, Ctrl+Z/Y 검증
- 기존 실행 중인 BAEFRAME 프로세스는 조회·종료·재사용하지 않음

## 11. 이번 단계 제외

- `.bframe` 저장
- 기존 drawings와 drawingsV3 변환
- 레이어와 keyframe command
- 협업 command
- copy/paste
- 도형과 지우개
- 기존 글로벌 Undo stack과 병합

이 항목들은 이번 시험판이 통과한 뒤 다음 순차 구현 단위에서 다룬다.
