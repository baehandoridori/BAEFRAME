# BAEFRAME Fabric 자유 선택 프리셋 설계

- 상태: 사용자 실행 승인 완료
- 작성일: 2026-07-26
- 기준 커밋: `e0da8c2`
- 선행 설계: `2026-07-17-fabric-drawing-surface-v3-design.md`

## 1. 문제와 근본 원인

현재 V 도구의 `selectionMode`는 `stroke | lasso` 한 축뿐이다.

- `stroke`는 Fabric 기본 사각 marquee로 획 전체를 선택한다.
- `lasso`는 자유형 polygon으로 획 일부를 분리한다.

따라서 사용자가 원한 다음 두 설정을 독립적으로 고를 수 없다.

1. 선택 대상: 획 전체 / 영역 일부
2. 선택 모양: 사각형 / 라쏘

또한 획 전체를 선택한 뒤 라쏘로 바꾸면 기존 active selection을 유지한다. 다음
pointerdown이 그 선택 상자 안에서 시작되면 새 라쏘가 아니라 기존 획 전체 이동으로
분기한다. 이 때문에 라쏘도 획 선택처럼 보인다.

사각형 부분 선택은 안정화 승격 때 명시적으로 후속 단계로 남겨졌으므로 현재 코드에
부분 분할 경로가 없다.

## 2. 결정

V 도구의 로컬 선택 설정을 두 축으로 분리한다.

```text
selectionTarget: stroke | partial
selectionShape: rectangle | lasso
```

사용자에게는 다음 네 조합을 제공한다.

| 선택 대상 | 선택 모양 | 동작 |
| --- | --- | --- |
| 획 전체 | 사각형 | 기존 Fabric 사각 marquee로 닿은 획 전체 선택 |
| 획 전체 | 라쏘 | 라쏘 polygon에 닿은 원본 획 전체 선택 |
| 영역 일부 | 사각형 | 드래그 사각형을 polygon으로 바꿔 닿은 획 조각 선택 |
| 영역 일부 | 라쏘 | 현재 검증된 라쏘 획 조각 선택 |

두 값은 overlay runtime 메모리에만 둔다. B/V 전환 동안 유지하지만 리뷰 파일,
StrokeObject, IPC payload에는 저장하지 않는다.

원형 선택은 이번 변경에 포함하지 않는다. 현재 요청인 사각형과 라쏘를 안정화한 뒤
같은 polygon 경계에 추가할 수 있다.

## 3. UI 계약

V가 활성화되면 도구막대에 두 그룹을 동시에 표시한다.

- 선택 대상: `획`, `부분`
- 선택 모양: `사각`, `라쏘`

각 버튼은 `aria-pressed`와 명확한 `aria-label`을 가진다. 기본값은 현재 사용감을
보존하는 `획 + 사각`이다.

도구막대는 DOM을 다시 만들지 않는 2행 compact-wrap을 사용한다. 400px, 500px,
640px 뷰어 폭에서도 Brush, V, 네 선택 설정, Undo, Redo, Delete, Clear, 설정,
저장 상태가 모두 root 안에 남아야 한다. 버튼의 최소 입력 영역은 40x40px이며,
좁은 화면에서는 브러시 요약과 저장 배지만 축약하고 전체 설명은 `aria-label`과
`title`로 유지한다.

선택 대상이나 모양을 바꾸면 진행 중인 선택 transaction과 기존 active selection을
정리한다. 따라서 `획 + 사각`에서 획을 고른 뒤 `부분 + 라쏘`로 바꾸어도 첫
드래그부터 새 자유 선택이 시작된다.

선택 설정을 같은 값으로 다시 누른 경우에는 현재 부분 선택을 유지해 선택 조각을
계속 이동하거나 삭제할 수 있다.

실제 설정 변경으로 진행 중인 선택을 취소할 때 이미 수락한 같은 session/input의
최신 deferred viewport는 rollback과 pointer 정리가 끝난 뒤 정확히 한 번 적용한다.
입력 비활성, 세션 교체, pointercancel, blur, destroy의 deferred viewport는 기존처럼
폐기한다.

## 4. 입력과 geometry

### 4.1 획 전체 + 사각형

현재 Fabric native selection을 유지한다. 이 조합에서만
`fabricCanvas.selection = true`이며 영구 Path가 native selectable/evented 객체가
된다.

### 4.2 그 밖의 세 조합

native marquee를 끄고 overlay가 pointer capture와 polygon preview를 관리한다.

- 라쏘: pointer 샘플을 기존 방식으로 단순화해 닫힌 polygon을 만든다.
- 사각형: 시작점과 현재점을 대각 꼭짓점으로 하는 네 점 polygon을 만든다.
- 면적이 없는 입력은 아무 장면 변경 없이 취소한다.
- 선택된 active object의 경계 안에서 시작한 드래그만 기존 선택 이동으로 처리한다.

선택 polygon은 각 Fabric Path의 `calcTransformMatrix()` 역행렬을 통과시킨 뒤
`pathOffset`을 더해 실제 표시 Path와 같은 좌표계로 옮긴다. 이 방식으로 비균일
확대, 회전, 기울임, flip이 있어도 화면에 보이는 채움과 선택 경계가 일치한다.

`획 전체 + 라쏘`는 fragment splitter와 분리된 실제 Path 채움 hit query를
사용한다. 접촉 길이가 1 source-unit보다 짧아도 보이는 채움과 닿으면 원본 객체 ID
전체를 선택하며 fragment나 history를 만들지 않는다. polygon/fill edge index와
gesture 전체 연산 budget으로 최악 입력을 제한한다. 한도를 넘으면 일부 ID를
선택하지 않고 전체 선택을 원자적으로 취소한다.

`영역 일부 + 사각/라쏘`는 같은 polygon 이후 경로를 사용한다.

1. scene polygon을 획의 실제 표시 Path 좌표계로 역변환한다.
2. `renderGeometry`가 있으면 이를, 없으면 canonical `pathData`를 실제 채움으로
   삼아 polygon과 교집합·차집합을 함께 계산한다.
3. 선택/잔여 채움 component를 원본 centerline의 단조 source-position 구간에
   투영한다. centerline은 데이터 계보를 찾는 데만 쓰며 hit/clip 판정의 근거로
   쓰지 않는다.
4. source-position 구간으로 원본 pressure/time chain을 보존한 fragment를 만든다.
5. 선택 시점에는 투명 fragment proxy만 준비한다.
6. 실제 이동 또는 Delete에서만 `split-stroke` command 하나로 확정한다.

원본 획 자체가 점 또는 1 source-unit 미만이면 조작 가능한 fragment로 나눌 수
없으므로, polygon과 닿을 때 원본 ID 전체를 부분 선택 transaction에 포함한다.
일반 fragment와 함께 이동·삭제해도 하나의 원자적 command로 기록한다.

변환된 획의 fragment는 원본 선형 transform을 상속하고, 새 fragment의
`pathOffset` 차이를 원본 matrix로 변환한 scene center에 배치한다. 따라서 분할
전후의 scale, rotate, skew, flip과 화면상 위치가 유지된다.

## 5. 저장·Undo·표시 불변식

- hover, 모드 전환, 영역 선택 pointerup은 mutation, dirty, save attempt를 늘리지 않는다.
- 부분 이동과 부분 Delete는 각각 history command 하나다.
- Undo/Redo는 원본 ID, sourcePoints, transform, z-order를 복구한다.
- fragment 하나라도 만들 수 없거나 용량 제한을 넘으면 원본 장면을 유지한다.
- geometry 연산 한도나 역행렬 검증을 통과하지 못하면 일부 선택 없이 원본 장면을
  유지한다.
- 선택 결과의 실제 채움은 선택/잔여 fragment별 `renderGeometry`로 저장하되,
  `sourcePoints`, pressure/time, canonical `pathData`, transform은 계속 편집·Undo의
  기준 데이터로 유지한다.
- 저장 가능한 `renderGeometry`는 exact-key `{ version: 1, pathData, fillRule:
  'evenodd' }`이며 닫힌 `M/L/Z` contour, 문자열 길이, 좌표 범위를 모두 통과해야
  한다. 저장·hydrate·host 경계 중 하나라도 거부하면 문서 전체를 원자적으로
  거부한다.
- 선택 직후 lower canvas 픽셀은 바뀌지 않는다.
- B/Space, mpv 재생, 타임라인, 리뷰 저장 형식은 변경하지 않는다.
- 기존 HTML 드로잉 엔진과 legacy 픽셀 자유 선택은 사용하지 않는다.

## 6. 검증 계약

실제 Fabric 입력 테스트로 다음을 증명한다.

1. UI가 선택 대상과 모양을 독립적으로 노출하고 B/V 전환 뒤 값을 유지한다.
2. 획 선택 뒤 부분 모드로 바꾸면 기존 active selection이 즉시 사라진다.
3. 영역 일부 + 사각형으로 한 획의 중간만 선택하고 이동하면 세 fragment가 되며
   선택 조각만 이동한다.
4. 역방향 사각 드래그도 같은 결과를 낸다.
5. 영역 일부 + 사각형 Delete와 Undo/Redo가 원본을 왕복한다.
6. 영역 일부 + 라쏘의 기존 부분 이동·삭제 회귀가 유지된다.
7. 획 전체 + 라쏘는 닿은 획 전체만 선택하고 scene/history를 바꾸지 않는다.
8. 획 전체 + 사각형의 기존 click/marquee/hover/이동 동작이 유지된다.
9. 선택 설정과 선택만으로 review save attempt가 발생하지 않는다.
10. browser bundle과 소스 runtime의 선택 계약이 일치한다.
11. preset 변경 중 보류된 같은-session viewport는 취소 정리 뒤 한 번 적용되고,
    stale session/input viewport는 계속 폐기된다.
12. 정상 길이 획의 얕은 가장자리 접촉, 점 획, 1 source-unit 미만 획을 모드 계약에
    맞게 선택한다.
13. scale/rotate/skew/flip 획의 whole hit와 부분 fragment 위치가 화면과 일치한다.
14. 20,000점 획과 512/1024-edge polygon도 연산 budget 안에서 early-exit 또는
    원자적 취소한다.
15. 400/500/640px에서 모든 도구막대 동작이 보이고 겹치지 않으며 최대 두 행이다.

## 7. Task 8 addendum: 실제 채움 기준 자유 선택

Task 5까지의 centerline/반폭 판정은 일반 획에는 충분하지만 perfect-freehand가 만든
곡선 모서리, 압력 변화, 끝단에서 실제 Fabric 채움과 픽셀이 달라질 수 있다. Task
8은 기존 네 선택 조합과 pending transaction 계약을 바꾸지 않고, 선택의
authoritative geometry만 화면에 실제로 그려지는 Path 채움으로 승격한다.

### 7.1 채움 해석과 topology

- Fabric의 대문자 `M/L/Q/C/Z` Path만 엄격히 받아 `Q/C`를 허용 오차 내 선분으로
  평탄화한다. 잘못된 command, 비유한 좌표, 열린 contour, 자기 교차로 결과를
  확정할 수 없는 입력은 추정하지 않고 원자적으로 거부한다.
- 원본 Path의 `evenodd`와 `nonzero` 채움 규칙을 그대로 해석한다. hole, 중첩
  island, 동일/부분 공유 경계, 외부 tangent, 같은 점에서 닿는 크기가 같거나 다른
  component, 상쇄 contour를 구분한다.
- 높이 `0.1`, `0.05`, `0.01` source-unit의 얇은 실제 채움도 놓치지 않아야 하며,
  상쇄 contour 옆의 빈 틈은 채움으로 오판하지 않는다. 한 번 잘라 저장한
  `renderGeometry`를 다시 선택해도 같은 규칙이 유지된다.
- partial clip의 교집합과 차집합은 한 번의 paired operation으로 만든다. 둘 중
  하나라도 geometry/budget 실패이면 두 결과를 모두 폐기하며 원본 획 전체 선택으로
  대체하지 않는다.

### 7.2 계보·저장·복구

- 실제 채움이 hit와 clip의 기준이어도 `sourcePoints`, pressure/time, caps,
  transform은 canonical 편집 계보로 남는다. 채움 component는 BVH로 가속한
  centerline 투영을 통해 단조 source-position 구간과 연결한다.
- 잘라낸 표시 모양은 version 1 `renderGeometry`로 이동·Delete·Undo/Redo와
  리뷰 데이터 저장/복원을 왕복한다. 이후 재선택도 저장된 채움을 다시
  authoritative geometry로 사용한다.
- 같은 gesture에서 geometry unavailable, fragment build, 역행렬, 공유 budget
  실패가 나면 scene/history/save attempt뿐 아니라 gesture 시작 전 Fabric active
  object와 `selectedObjectIds`도 정확히 복원한다. 중간에 scene/session revision이
  달라졌다면 오래된 선택을 되살리지 않는다.

### 7.3 연산 한도와 검증 기준

flatten, spatial index, hit, paired clip, centerline 투영은 gesture당 하나의
`250,000` operation budget을 공유한다. Path/contour BVH와 bounds query를 사용하며,
cache hit도 cold build의 logical cost를 동일하게 차감한다.

| fixture | 필수 결과 |
| --- | --- |
| 300점 실제 획 | 부분 사각 선택은 비파괴 stage 후 이동 시 3 fragment, Undo 시 원본 정확 복원, 250k 미만 |
| 400점 실제 획 | 300점과 같은 실제 runtime 왕복, direct paired clip 200k 미만, 각 검증 1초 미만 |
| 1,000점 실제 획 | 250k 이내에서 `selection-complexity-limit-exceeded`, 교집합·차집합 모두 빈 실패 결과, 부분 출력 없음 |
| 20,000-edge Path | flatten/index 단계가 250k 이내에서 같은 complexity reason으로 중단, UI 장기 정지나 cache 우회 없음 |

이 표와 L-turn 실제 픽셀 hit/miss, 저장 후 재선택, thin/tangent/kissing/hole
fixture가 모두 통과해야 Task 8을 완료한 것으로 본다.
