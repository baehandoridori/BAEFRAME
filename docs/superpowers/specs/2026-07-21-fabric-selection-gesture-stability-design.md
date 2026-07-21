# Fabric 선택 제스처 안정화 설계

- 상태: 사용자 승인 완료
- 작성일: 2026-07-21
- 기준 브랜치: `codex/baeframe-fabric-brush-style-v1`
- 기준 커밋: `8e8748e`
- 선행 설계: `2026-07-21-fabric-selection-settle-cursor-design.md`

## 1. 배경

실제 시험 앱에서 다음 세 문제가 남아 있다.

1. 두 획을 사각 선택해 옮긴 뒤 마우스를 놓아도 점선 선택 상자가 남고, 다음 획을 바로 조작할 수 없다.
2. 첫 획을 선택한 상태에서 다른 획을 한 번 클릭하면 선택 상자가 잠깐 이동했다가 모두 해제되며, 같은 획을 한 번 더 클릭해야 선택된다.
3. 선택된 획의 사각 경계 안에 커서를 올려도 사방 이동 커서가 안정적으로 표시되지 않는다.

선행 수정은 정상적인 Fabric `mouseup`이 도착한다는 조건에서 다중 선택을 microtask로 해제하고, 선택 전 얇은 획의 hit 여유를 넓혔다. 그러나 mpv 투명 오버레이의 실제 창 경계와 클릭 중 viewport 갱신을 함께 고려하지 못했다.

## 2. 확인된 근본 원인

### 2.1 선택 이동 종료 입력 유실

Fabric 7.4는 선택 이동을 시작하면 문서(`document`)에 임시 `mouseup` 리스너를 붙이고, 그 이벤트가 도착해야 transform을 확정해 `object:modified`를 발생시킨다. 현재 BAEFRAME overlay runtime은 브러시일 때만 포인터를 캡처한다. `V` 선택 모드에서는 포인터 캡처 없이 Fabric의 기본 mouse 이벤트 흐름에만 의존한다.

mpv 영상 위의 투명 Electron 오버레이 경계에서 마우스를 놓으면 문서 `mouseup`이 빠질 수 있다. 이 경우 화면의 Fabric 객체는 드래그 중 위치에 보이지만 `object:modified`와 후속 자동 해제가 발생하지 않는다. 다음 클릭이 이전 transform을 뒤늦게 끝내므로, 사용자는 선택 상자가 남고 첫 클릭이 먹히지 않는 것으로 느낀다.

### 2.2 단순 클릭과 viewport 갱신의 충돌

Fabric은 실제 이동이 없는 단순 클릭 후보에도 `before:transform`을 발생시킨다. runtime은 이 이벤트만으로 `transformStart`를 기록한다. 두 번째 획을 누른 뒤 마우스를 놓기 전에 더 높은 viewport revision이 들어오면, 현재 `updateViewport()`는 `transformStart !== null`이라는 이유로 장면 전체를 다시 만들고 active object와 저장소 selection을 비운다.

그 결과 `selection:updated`로 새 획이 잠깐 선택된 직후 `selection:cleared`가 발생한다. 다음 클릭에서야 같은 획이 정상적으로 선택된다.

### 2.3 선택된 경계와 선택 전 획의 hit 정책 혼용

영구 Path는 항상 `perPixelTargetFind: true`, `hoverCursor: grab`을 사용한다. 이 정책은 선택 전 얇은 획을 정확하게 가리키는 데 적합하지만, 선택된 Path의 투명한 사각 경계 내부는 대상이 아니므로 선택 상자 위에서 `default` 커서가 나온다. 반대로 ActiveSelection에는 `grab`이 설정돼 있어 사용자가 기대하는 사방 이동 의미도 충분히 전달하지 못한다.

## 3. 목표

- 선택 이동의 정상적인 포인터 해제가 Fabric까지 항상 도착해야 한다.
- 다중 선택 이동을 놓으면 점선 상자가 한 이벤트 주기 뒤 자동으로 사라져야 한다.
- 첫 획에서 다른 획으로 한 번 클릭만으로 선택이 전환돼야 한다.
- 선택 제스처 중 도착한 최신 viewport 갱신은 제스처 종료 뒤 적용돼야 하며 선택을 지우면 안 된다.
- 선택되지 않은 얇은 획은 기존 6 CSS px hit 여유와 `grab`을 유지한다.
- 선택된 단일 획의 사각 경계 전체와 다중 선택 상자는 `move`, 실제 드래그 중에는 `grabbing`을 사용한다.
- 선택·hover·viewport 적용·자동 선택 해제는 장면 mutation, dirty, save attempt를 늘리지 않아야 한다.
- 기존 B/Space 재생, 타임라인, 브러시, 장면 저장소 계약을 유지한다.

## 4. 범위

이번 변경은 overlay runtime의 선택 입력 생명주기와 표시 정책만 수정한다.

- 수정: Fabric Canvas 입력 이벤트 종류와 선택 포인터 캡처
- 수정: 선택 제스처 중 viewport 명령 보류 및 종료 후 반영
- 수정: 선택 상태별 hit-test와 커서 정책
- 수정: 실제 Fabric 회귀 테스트와 browser bundle
- 유지: 장면 저장소, IPC payload, 리뷰 데이터, 재생, 타임라인, 앱 셸

획 일부를 잘라 이동하는 자유 영역 선택은 별도 다음 페이즈다. 이번 단계에서는 기존의 획 전체 선택 의미를 바꾸지 않는다.

## 5. 선택 제스처 상태 모델

runtime은 브러시 입력 상태와 별도로 하나의 선택 제스처 상태를 가진다.

```text
idle
  └─ select pointerdown(primary) → tracking

tracking
  ├─ pointermove → tracking
  ├─ viewport(newer) → tracking + latest deferred viewport
  ├─ pointerup → settling
  ├─ pointercancel/lost capture/blur → cancelling
  └─ input disable/session change/destroy → cancelled

settling
  └─ current event propagation + microtask → idle + deferred viewport apply

cancelling
  └─ transform rollback/cleanup → idle; stale deferred viewport 폐기
```

선택 제스처 토큰은 최소한 `pointerId`, `sessionId`, `inputRevision`을 보유한다. 토큰은 현재 입력 세션과 revision이 같을 때만 종료 처리를 할 수 있다. 브러시용 `activeStroke`와 선택용 토큰은 동시에 활성화될 수 없다.

## 6. 포인터 이벤트 및 캡처 계약

Fabric Canvas는 `enablePointerEvents: true`로 생성한다. 그러면 Fabric과 BAEFRAME runtime이 모두 같은 `pointerdown/move/up` 계열을 사용한다.

선택 모드에서 주 버튼 `pointerdown`이 발생하면 runtime은 다음을 수행한다.

1. 현재 세션과 입력 revision을 토큰에 기록한다.
2. `upperCanvasEl.setPointerCapture(pointerId)`를 호출한다.
3. Fabric의 동일 이벤트 전파는 막지 않는다.

정상 `pointerup`은 캡처된 canvas에서 발생하고 문서까지 버블링되므로 Fabric의 문서 listener가 transform을 확정한다. runtime은 캡처만 해제하고, viewport flush는 같은 이벤트 안에서 동기 실행하지 않고 microtask로 예약한다. 이 순서로 Fabric의 `object:modified`, 다중 선택 해제 예약, selection 이벤트가 먼저 끝난다.

`pointercancel`, 예상치 못한 `lostpointercapture`, `window blur`, 입력 비활성, 세션 변경, destroy에서는 현재 제스처를 종료한다. Path 또는 ActiveSelection transform이 진행 중이면 시작 transform으로 되돌린 뒤 Fabric의 공개 종료 경로와 document `pointerup` 경로를 순서대로 통과시켜 임시 document listener까지 닫는다. 빈 marquee에는 되돌릴 transform 대상이 없으므로 lifecycle drain 뒤 새로 만들어진 active selection을 명시적으로 버리고 저장소 selection도 비운다. 이 취소 경로는 mutation을 만들지 않으며 다음 한 번의 클릭과 드래그가 바로 동작해야 한다.

포인터 캡처는 기본 경로이지만 API 부재나 예외를 안전하게 흡수해야 한다. 따라서 document에도 matching pointer ID만 받는 `pointerup`/`pointercancel` 종료 fallback을 둔다. 캡처된 정상 이벤트가 canvas에서 먼저 처리된 뒤 document로 버블링되더라도 `tracking → settling` phase guard가 두 번째 종료를 막는다. 캡처 해제 대상은 이벤트의 `currentTarget`이 아니라 항상 실제 upper canvas다.

중복 `pointerup`이나 이미 종료된 pointer ID는 무시한다. 캡처 API가 없는 테스트·구형 환경에서도 document fallback으로 같은 종료 계약을 유지한다.

더 높은 input revision이나 새 세션을 활성화하기 전에는 선택 제스처뿐 아니라 진행 중인 브러시 획도 취소한다. 이전 세션에서 시작한 늦은 브러시 `pointerup`은 새 세션에 획, mutation, dirty, save attempt를 만들 수 없다.

## 7. viewport 보류 계약

`updateViewport(command)`는 명령을 검증한 뒤 다음 두 경로로 나뉜다.

### 7.1 즉시 적용

선택 제스처와 Fabric transform 후보가 모두 없으면 기존처럼 즉시 적용한다. 적용 시점에만 `currentSession.viewportRevision`을 올린다.

### 7.2 보류

선택 포인터가 tracking/settling 중이거나 `transformStart`가 남아 있으면 장면을 다시 만들지 않는다. 대신 현재 적용 revision과 기존 보류 revision보다 높은 최신 명령 한 개만 보관하고 `{ accepted: true, deferred: true, revision }`을 반환한다.

정상 pointerup 뒤 microtask에서 다음 조건을 다시 확인한다.

- runtime이 파괴되지 않았다.
- 입력이 활성 상태다.
- 세션 ID와 input revision이 보류 당시와 같다.
- 보류 명령 revision이 현재 적용 revision보다 높다.
- 새 선택 제스처가 시작되지 않았다.

조건이 맞으면 `canvasRect`, `viewportTransform`, `viewportRevision`을 갱신하고 `applyViewport()`만 호출한다. 장면 전체 재생성, `discardActiveObject()`, `sceneStore.selectObjects([])`는 하지 않는다. 조건이 달라졌다면 보류 명령을 폐기한다.

보류 중 더 높은 revision이 도착하면 최신 명령으로 교체한다. 더 낮거나 같은 명령은 stale로 거절한다. 입력 비활성, 세션 변경, destroy에서는 보류 명령을 지워 다른 영상이나 프레임에 적용되지 않게 한다.

브러시 stroke 중 viewport 처리 방식은 이번 범위에서 바꾸지 않는다.

## 8. 선택 상태별 hit 및 커서 정책

| 상태 | hit 정책 | hover 커서 | 이동 중 커서 |
| --- | --- | --- | --- |
| 빈 선택 영역 | Canvas 기본 | `default` | 해당 없음 |
| 선택 전 영구 Path | 픽셀 판정 + 6 CSS px tolerance | `grab` | `grabbing` |
| 선택된 단일 Path | 전체 사각 경계 | `move` | `grabbing` |
| 선택된 ActiveSelection | 전체 선택 상자 | `move` | `grabbing` |
| 브러시 | 브러시 입력 | `crosshair` | `crosshair` |

선택이 만들어지거나 바뀔 때 먼저 모든 영구 Path를 선택 전 정책으로 되돌린다. 그 뒤 현재 active object만 선택 정책을 받는다.

- 단일 Path: `perPixelTargetFind: false`, `hoverCursor: move`, `moveCursor: grabbing`
- ActiveSelection: group 자체에 `perPixelTargetFind: false`, `hoverCursor: move`, `moveCursor: grabbing`

다중 선택의 자식 Path는 선택 전 정책을 유지하고 group 상자만 전체 hit 대상이 된다. 선택이 해제되거나 자동 해제되면 모든 Path가 즉시 픽셀 판정과 `grab`으로 돌아간다. 이 방식은 선택 상자 전체에서 직관적인 이동을 제공하면서, 해제 후 빈 공간이 이전 선택을 계속 가로채는 문제를 막는다.

## 9. 데이터 및 저장 불변식

다음 동작은 mutation을 만들지 않는다.

- 획 hover
- 단일/다중 선택 생성과 전환
- 선택 해제와 자동 해제
- 포인터 캡처·해제
- viewport 보류와 적용
- 선택 상태에 따른 Fabric 표시 속성 변경

실제 이동이 확정되어 `object:modified`가 발생한 경우에만 기존 `sceneStore.transformSelection()`이 정확히 한 번 실행된다. 이번 수정은 객체 ID, sourcePoints, pathData, transform 저장 형식, save 호출 여부를 바꾸지 않는다.

## 10. 자동 검증

실제 Fabric 7.4 입력 흐름을 사용하는 테스트를 우선한다.

1. 문서에 직접 mouseup을 보내지 않고 캡처된 canvas에 pointerup만 보내도 다중 선택 이동이 확정되고, microtask 뒤 선택이 해제된다.
2. 첫 획 선택 후 다른 획 pointerdown과 pointerup 사이에 새 viewport revision을 넣어도 두 번째 획이 한 번에 선택되고 `selection:cleared`가 발생하지 않는다.
3. 선택 제스처 중 여러 viewport revision이 들어오면 가장 최신 하나만 종료 후 적용된다.
4. 세션·input revision 변경이나 destroy 뒤에는 보류 viewport가 적용되지 않는다.
5. 선택된 단일 대각 획의 색칠되지 않은 사각 경계에서 target이 Path이고 커서가 `move`다.
6. ActiveSelection 상자는 `move`, 실제 드래그 중에는 `grabbing`, 자동 해제 후 획은 `grab`, 빈 곳은 `default`다.
7. 각 시나리오에서 mutation 수는 실제 획 생성·이동 횟수와 같고 save attempt는 0이다.
8. 기존 overlay runtime, drawing, mpv 회귀 스위트가 모두 통과한다.

## 11. 수동 합격 기준

1. 재생 중 B로 드로잉 모드에 들어간다.
2. 두 획을 그리고 V로 사각 선택한다.
3. 선택 묶음을 옮겨 마우스를 놓으면 점선 상자가 사라진다.
4. 곧바로 어느 획이든 한 번 클릭하면 그 획만 선택된다.
5. 선택된 획의 사각 상자 안에서는 사방 이동 커서, 실제 이동 중에는 잡은 커서가 나온다.
6. 다른 획을 한 번 클릭할 때 선택이 잠깐 보였다 사라지는 현상이 없다.
7. B와 Space가 계속 동작하고 영상 깜빡임, 이중 재생, 타임라인 점프가 없다.
8. 리뷰 데이터 저장 실패 알림이 없다.

## 12. 다음 페이즈와 제외 항목

이번 안정화가 실제 앱 검증을 통과한 뒤 `V` 도구의 선택 UI를 다음 순서로 확장한다.

1. 선택 대상: `획 전체` / `영역 일부`
2. 선택 모양: `사각형` / `라쏘` / `원형`
3. 획 전체 모드에서 세 모양의 교차 선택
4. `sourcePoints`를 경계 교차점에서 분할하는 영역 일부 이동
5. 한 번의 `split-stroke` 작업으로 Undo/Redo와 협업 저장

다음 항목은 이번 변경에 포함하지 않는다.

- 획 일부 분할, 라쏘, 원형 선택 UI
- Undo/Redo, 지우개, 도형, 레이어 영속화
- 재생 엔진, 타임라인, 리뷰 데이터 저장 형식 변경
- 기존 HTML 드로잉 엔진 제거
- 정식 배포 및 기존 실행 앱 교체
