# Fabric 드로잉 키프레임 hold·이동 설계

## 목표

`drawingsV3` 드로잉을 Adobe Animate의 키프레임 노출 방식으로 표시하고, 타임라인에서 안전하게 이동할 수 있게 한다.

- 첫 키프레임 전에는 드로잉이 보이지 않는다.
- 내용 키프레임은 다음 키프레임 직전까지 유지(hold)된다.
- 빈 키프레임은 이전 hold를 끊는다.
- B-off 탐색·재생 중 현재 프레임에 맞는 장면이 표시된다.
- hold 프레임에서 B-on 시 원본을 보이되, 첫 실제 변경에서 현재 프레임 키프레임을 copy-on-write로 만든다.
- 키프레임을 기존 키프레임 위로 이동하면 목적지를 통째로 덮어쓴다.
- 다중 이동과 undo/redo는 원자적으로 동작한다.

## 원인

현재 Fabric runtime은 `(stableVideoIdentity, targetFrame)` exact scene을 저장하지만, B-off에는 `lastPaintedScene`만 다시 그린다. 렌더러의 `timeupdate`/`frameUpdate`가 오버레이에 현재 프레임을 전달하지 않으므로 마지막 활성 장면이 다른 프레임에도 남는다.

타임라인 투영은 `locked: true`이고 앱도 `keyframesMove`를 즉시 반환한다. 이 차단만 제거하면 synthetic layer가 legacy `drawingManager`로 흘러 실제 `drawingsV3`는 이동하지 않고 legacy history만 오염된다.

## 표시 의미

저장·편집 target과 표시 source를 분리한다.

- `targetFrame`: 새 변경이 귀속되는 현재 프레임.
- `sourceFrame`: `targetFrame` 이하의 마지막 키프레임. 없으면 `null`.
- source 키프레임의 objects가 비어 있으면 화면은 빈 상태이며 hold가 끊긴다.
- 타임라인 마커는 exact frame에 위치하지만 노출 막대는 다음 키프레임 직전까지 이어진다.

예: 내용 100, 빈 150, 내용 200이면 0~99 빈 화면, 100~149는 100 장면, 150~199 빈 화면, 200부터 200 장면이다.

## 프레임 표시 채널

렌더러에서 persistence store가 `sourceFrame`을 해석하고, source가 바뀔 때만 controller에 표시 요청을 보낸다. 매 재생 프레임마다 같은 장면을 다시 그리지 않는다.

controller는 passive 상태에서만 최신 요청 하나를 직렬화한다. 요청은 host/video/presentation revision과 영상 identity로 fence한다. preload/IPC/overlay host는 새 passive frame-present 호출을 전달하고, runtime은 저장·selection·history를 바꾸지 않은 채 source scene을 non-interactive canvas에 그린다. source가 없거나 empty이면 즉시 비운다.

B active 동안 편집 target은 진입 프레임으로 고정한다. passive 요청은 active 세션을 덮지 않는다. B를 끄거나 수화·영상 전환이 끝나 passive가 되면 현재 playhead를 다시 동기화한다.

## hold 프레임 편집

exact target scene이 없고 이전 source scene이 있으면 runtime은 target 좌표에 임시 clone을 만든다.

- 임시 clone은 export와 persistence에서 제외한다.
- 아무 변경 없이 B를 끄면 임시 clone을 폐기한다.
- 첫 stroke/transform/delete/clear 직전에 clone을 materialize하고, 전체 base objects를 target의 첫 transition으로 보낸 뒤 실제 변경 transition을 적용한다.
- source가 empty이면 새 object가 생길 때까지 exact keyframe을 만들지 않는다.
- 첫 변경의 undo는 변경 전 clone 내용으로 돌아가며, 생성된 target keyframe은 유지한다.

이 방식은 hold 원본을 수정하지 않고 현재 프레임에서만 애니메이션 상태를 분기한다.

## 타임라인 이동

synthetic 행은 레이어 잠금 상태를 유지하되 `timelineKeyframesMovable` 명시 플래그로 키프레임 drag만 허용한다. 헤더 제어·삭제·레거시 단축키는 계속 차단한다.

`fabric-drawing-persistence-store`에 원자 이동 API를 추가한다.

- 모든 source/target과 범위를 먼저 검증한다.
- source keyframe 스냅샷을 이동 시작 시점 기준으로 캡처한다.
- 목적지의 기존 keyframe은 선택 여부와 관계없이 source 스냅샷으로 덮어쓴다.
- 겹치는 다중 이동도 원본 스냅샷 기준으로 계산한다. 예를 들어 100·200을 +100 이동하면 원래 100이 200으로, 원래 200이 300으로 간다.
- 하나라도 범위를 벗어나거나 source가 없으면 전체를 변경하지 않는다.
- 성공 시 revision과 change event를 정확히 한 번 증가시킨다.
- before/after 스냅샷을 global undo/redo에 등록하여 덮어쓴 목적지도 복구한다.

앱은 Fabric drag를 legacy `drawingManager.moveKeyframes()`로 보내지 않는다. 기존 controller의 persistence source refresh 순서를 재사용해 overlay authoritative pull → store 이동 → hydrate/export 검증 → active/passive 복귀를 직렬화한다. store change는 기존 ReviewDataManager dirty/autosave 경로를 사용한다.

## 보호 범위

- legacy `drawings`, legacy undo와 HTML5 동작은 변경하지 않는다.
- Fabric 키프레임 선택 삭제와 레이어 제어는 이번 범위에서 계속 막는다.
- playlist/cutlist aggregate timeline suppression은 유지한다.
- runtime 소스를 바꾸는 커밋에는 `npm run bundle:mpv-fabric-overlay` 결과를 함께 포함한다.
- 호스트/영상/source epoch가 바뀐 stale 표시·이동 결과는 폐기한다.

## RED→GREEN 검증

1. 표시: 99=blank, 100=exact, 101=held, empty break 이후 blank, 역방향 seek와 재생 source 교체.
2. active copy-on-write: hold 장면 표시, 첫 변경 전 export 불변, 첫 변경 후 target keyframe 생성과 source 불변.
3. 이동: 단일·다중·겹침·덮어쓰기, 범위 실패 원자성, revision/event 1회, undo/redo.
4. 라우팅: Fabric drag는 store/controller만 사용하고 legacy manager/history는 호출하지 않음.
5. 영속성: autosave와 저장 후 재실행에서 frame·objects·empty break 유지.
6. 회귀: B toggle z-order, mpv runtime/host, HTML5 legacy, playlist/cutlist, 전체 테스트.

## 릴리스

기준 `origin/main`은 `2.2.1-beta`이며 표시 채널과 타임라인 편집 기능을 추가하므로 `2.3.0-beta`로 올린다. 독립 리뷰와 Codex PR 리뷰를 통과한 정확한 merge commit에서 Windows beta를 빌드하고, 공유드라이브 테스트 버전을 staging 교체한 뒤 전체 파일 SHA-256 parity와 실행 시나리오를 확인한다.
