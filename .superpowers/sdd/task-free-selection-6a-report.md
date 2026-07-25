# Task 6a: 선택 프리셋 전환 중 viewport 안정화

## 범위

- 선택 대상/모양이 실제로 바뀔 때 진행 중인 Fabric 선택 입력을 안전하게 취소한다.
- 같은 세션과 현재 input revision에 속한 최신 deferred viewport는 취소 뒤 한 번 적용한다.
- 같은 값의 프리셋 재클릭은 strict no-op으로 유지한다.
- pointer cancel, blur, B 비활성, 세션 교체, destroy의 deferred viewport 폐기 계약은 유지한다.
- geometry, browser IIFE, toolbar layout, host, 재생 및 저장 구조는 수정하지 않았다.

## 근본 원인

`updateViewport()`가 선택 입력 중 viewport를 정상 접수해 `deferredViewport`에 보관해도,
프리셋 변경이 `cancelSelectInteraction()`을 호출하는 과정에서 이를 무조건 `null`로
만들었다. 그 결과 `{ accepted: true, deferred: true }`가 반환된 명령의 revision이
적용되지 않고 다음 viewport 이벤트까지 오버레이가 이전 위치에 남았다.

## TDD 증거

### RED

실제 Fabric 입력 테스트를 먼저 추가해 다음 세 경로가 각각 실패하는 것을 확인했다.

- native 선택 이동 중 프리셋 변경: 기대 revision 3, 실제 0
- custom lasso 진행 중 프리셋 변경: 기대 revision 4, 실제 0
- 이동 중인 pending partial proxy에서 프리셋 변경: 기대 revision 5, 실제 0

같은 값 재클릭과 input disable/session replacement의 stale 폐기 테스트는 기존
동작대로 통과했다.

독립 검토에서 custom lasso의 취소 경로가 deferred viewport를 적용하는 문제를
추가로 발견했다. 회귀 테스트를 먼저 추가해 다음 실패를 확인했다.

- pointercancel: 기대 revision 0, 실제 8
- window blur: 기대 revision 0, 실제 9

### GREEN

- `cancelSelectInteraction(event, { preserveDeferredViewport: true })`를 프리셋 변경
  경로에만 사용했다.
- custom preview 제거 후 Fabric transform rollback, late modified 무시, pointer
  lifecycle drain/capture 해제를 먼저 수행하고 pending proxy를 복구하도록 순서를
  정리했다.
- 새 target/shape와 interaction policy를 적용한 뒤 이전 session ID/input revision으로
  `settleDeferredViewport()`를 호출했다.
- settle 시 현재 `tokenState.inputRevision`도 다시 확인한다.
- custom lasso의 pointercancel/blur는 preview와 capture를 정리한 뒤 deferred
  viewport를 폐기한다.
- 늦은 기존 pointerup 뒤에도 revision, scene, history가 다시 변하지 않음을 검증했다.
- native/custom 경로 모두 기존 Fabric Path 객체 identity가 유지되어 canvas 재생성이
  없음을 검증했다.

## 검증 결과

- 집중 회귀: 관련 테스트 7/7 통과
- `npm run test:fabric-drawing-pilot`: 260/260 통과
- 대상 파일 ESLint: 0 error
- 전체 `npm run lint`: 0 error, 기존 warning 59
- `git diff --check`: 통과
- scene objects, mutation, dirty, undo/redo, history bytes, save attempt 불변
- input disable 및 session replacement 뒤 stale deferred viewport 미적용

## 독립 검토

- 최초 검토: Important 1건(custom lasso pointercancel/blur 폐기 계약) 발견
- 수정 후 재검토: Critical 0, Important 0, Ready: Yes
- 비차단 Minor: preset change의 `calcOffset` 정확한 호출 횟수를 직접 고정하면
  회귀 방지가 더 강해질 수 있음
