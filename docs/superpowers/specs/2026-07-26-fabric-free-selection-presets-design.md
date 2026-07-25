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

선택 대상이나 모양을 바꾸면 진행 중인 선택 transaction과 기존 active selection을
정리한다. 따라서 `획 + 사각`에서 획을 고른 뒤 `부분 + 라쏘`로 바꾸어도 첫
드래그부터 새 자유 선택이 시작된다.

선택 설정을 같은 값으로 다시 누른 경우에는 현재 부분 선택을 유지해 선택 조각을
계속 이동하거나 삭제할 수 있다.

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

`획 전체 + 라쏘`는 기존 `splitStrokePointsByPolygon()`의 압력·굵기 판정을 hit
검사로만 사용한다. inside 구간이 하나라도 있으면 원본 객체 ID 전체를 선택하며
fragment나 history를 만들지 않는다.

`영역 일부 + 사각/라쏘`는 같은 polygon 이후 경로를 사용한다.

1. 원본 sourcePoints를 현재 transform 위치로 편다.
2. polygon과 획의 실제 반폭 교차를 계산한다.
3. inside/outside run을 만든다.
4. 선택 시점에는 투명 fragment proxy만 준비한다.
5. 실제 이동 또는 Delete에서만 `split-stroke` command 하나로 확정한다.

## 5. 저장·Undo·표시 불변식

- hover, 모드 전환, 영역 선택 pointerup은 mutation, dirty, save attempt를 늘리지 않는다.
- 부분 이동과 부분 Delete는 각각 history command 하나다.
- Undo/Redo는 원본 ID, sourcePoints, transform, z-order를 복구한다.
- fragment 하나라도 만들 수 없거나 용량 제한을 넘으면 원본 장면을 유지한다.
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
