# Fabric 드로잉 키프레임 hold·이동 설계

## 목표

`drawingsV3` 드로잉을 Adobe Animate의 키프레임 노출 방식으로 표시하고, 타임라인에서 안전하게 이동할 수 있게 한다.

- 첫 키프레임 전에는 드로잉이 보이지 않는다.
- 내용 키프레임은 다음 키프레임 직전까지 유지(hold)된다.
- 빈 키프레임은 이전 hold를 끊는다.
- B-off 탐색·재생 중 현재 프레임에 맞는 장면이 표시된다.
- hold 프레임에서 B-on 시 원본을 보이되, 첫 실제 변경에서 현재 프레임 키프레임을 copy-on-write로 만든다.
- mpv Fabric이 드로잉을 소유하는 영상은 로컬 runtime 준비 성공 뒤에만 자동재생한다.
- 키프레임을 기존 키프레임 위로 이동하면 목적지를 통째로 덮어쓴다.
- 다중 이동과 undo/redo는 비동기 refresh 중 들어온 다른 history action과도 원자적 순서를 유지한다.

## 원인

현재 Fabric runtime은 `(stableVideoIdentity, targetFrame)` exact scene을 저장하지만, B-off에는 `lastPaintedScene`만 다시 그린다. 렌더러의 `timeupdate`/`frameUpdate`가 오버레이에 현재 프레임을 전달하지 않으므로 마지막 활성 장면이 다른 프레임에도 남는다.

프레임 표시 채널을 연결한 시험판의 실사용 검증에서 두 개의 추가 표시 결함이 확인됐다. 첫째, controller는 passive presentation DTO에 공통 protocol envelope를 덧붙였지만 overlay host와 runtime은 표시 전용 exact-key DTO만 허용했다. 단위 테스트의 IPC stub은 extra key를 검사하지 않아 통과했지만 실제 controller → host 통합 경로는 `invalid-presentation-request`로 runtime 진입 전에 거부됐다. 둘째, 요청 형식을 맞춘 뒤에도 passive `presentDrawingFrame()`은 Fabric canvas를 다시 그리고 Chromium 합성만 무효화했지만, sibling인 mpv embed 창보다 뒤로 내려간 overlay BrowserWindow의 네이티브 창 순서는 복구하지 않았다. 같은 화면 사각형의 실행 창을 Win32 z-order로 확인했을 때 embed가 overlay 바로 위에 있었고, B-on만 기존 `moveTop()` 경로를 타서 그때서야 이미 그려진 장면이 보였다.

Windows 콜드 스타트 검증에서는 세 번째 결함도 확인됐다. `loadVideo()`가 로컬 `.bframe` 설치 뒤 협업 저장소 연결을 먼저 `await`하고 그 다음에 Fabric `afterVideoReady()`를 호출했다. 협업 `getStorage()` Promise가 pending이면 controller가 `recovering`, host가 `videoGeneration: -1`에 머물러 runtime이 준비되지 않았고, 자동재생도 로컬 드로잉 수화보다 먼저 시작할 수 있었다. 네트워크 협업 준비 여부가 로컬 리뷰 표시의 선행 조건이 되어서는 안 된다.

따라서 B는 표시 스위치가 아니라 입력·편집 스위치로만 남겨야 한다. passive 장면이 승인될 때도 overlay를 영상 위로 복구하고, 재생 시작 시 현재 held 장면을 한 번 강제 동기화해야 한다. 같은 source가 유지되는 매 프레임마다 네이티브 창을 다시 올리지는 않는다.

타임라인 투영은 `locked: true`이고 앱도 `keyframesMove`를 즉시 반환한다. 이 차단만 제거하면 synthetic layer가 legacy `drawingManager`로 흘러 실제 `drawingsV3`는 이동하지 않고 legacy history만 오염된다.

## 표시 의미

저장·편집 target과 표시 source를 분리한다.

- `targetFrame`: 새 변경이 귀속되는 현재 프레임.
- `sourceFrame`: `targetFrame` 이하의 마지막 키프레임. 없으면 `null`.
- source 키프레임의 objects가 비어 있으면 화면은 빈 상태이며 hold가 끊긴다.
- 타임라인 마커는 exact frame에 위치하지만 노출 막대는 다음 키프레임 직전까지 이어진다.

예: 내용 100, 빈 150, 내용 200이면 0~99 빈 화면, 100~149는 100 장면, 150~199 빈 화면, 200부터 200 장면이다.

## 프레임 표시 채널

렌더러에서 persistence store가 `sourceFrame`을 해석하고, passive 상태에서는 source·store·viewport signature가 바뀔 때만 controller에 표시 요청을 보낸다. 매 재생 프레임마다 같은 장면을 다시 그리지 않는다.

controller는 passive 표시 요청과 active 프레임 후보 요청을 각각 최신 하나로 직렬화한다. 요청은 host/video/input/session/revision과 영상 identity로 fence한다. preload/IPC/overlay host는 두 요청을 분리해 전달한다.

- passive runtime은 저장·selection·history를 바꾸지 않은 채 source scene을 non-interactive canvas에 그린다. source가 없거나 empty이면 즉시 비운다. renderer의 프레임 hot path는 held source의 frame 번호만 binary search로 해석하고 전체 object payload를 clone하지 않는다.
- passive controller는 host/runtime가 허용하는 표시 전용 exact-key DTO만 전송하며 공통 protocol envelope를 섞지 않는다.
- passive 표시 요청은 영상 원본 크기, 캔버스 영역, zoom/pan 정보를 함께 보내 fresh host와 B-off resize에서도 같은 좌표를 유지한다.
- B active 재생 중 runtime은 자기 최신 committed scene으로 hold source를 찾아 읽기 전용 미리보기만 갱신한다. 이 프레임 알림만으로 keyframe·transition·provisional scene을 만들지 않는다.
- B-on input 승인이 비동기로 지연되면 승인 시점의 live playhead를 다시 샘플한다. 진입 때 캡처한 frame과 달라졌으면 active observation과 runtime preview를 forced frame sync로 즉시 맞춘다.
- 실제 pointerdown 또는 mutation action 직전에 최신 후보 프레임으로 copy-on-write 전환한다. 한 획이 진행되는 동안 들어온 다음 프레임은 보류해 획 전체를 pointerdown 프레임에 고정하고, 다음 입력부터 최신 프레임을 사용한다.
- B를 끄거나 수화·영상 전환이 끝나 passive가 되면 현재 playhead를 다시 동기화한다.
- passive 장면 렌더가 현재 요청으로 승인되면 overlay host는 `moveTop()` 뒤 Chromium 합성을 무효화한다. stale·reject·실패 응답은 창 순서를 바꾸지 않는다.
- 재생 시작 시 현재 playhead를 한 번 force-present하여 이미 hold 구간 안에서 시작해도 장면과 네이티브 창 순서를 복구한다. 이후에는 source·store·viewport가 바뀔 때만 다시 표시한다.
- passive 표시 IPC도 bounded deadline을 사용한다. host가 응답하지 않으면 in-flight를 해제하고 대기열의 최신 프레임 한 건만 이어서 전송하며, 늦은 응답은 현재 accepted signature를 바꾸지 않는다.
- 새 영상 로드는 `로컬 review 설치 → FPS 설정 → Fabric afterVideoReady → 선택적 자동재생 → 협업 시작` 순서를 지킨다. 협업 Promise가 pending 또는 reject여도 로컬 passive 표시 준비는 먼저 끝나야 한다.
- mpv·비음성·Fabric 소유 경로에서는 `afterVideoReady()`의 명시적 성공(`true`)이 자동재생의 선행 조건이다. `false`면 자동재생 전에 load를 실패로 닫고 해당 영상의 Fabric 준비와 미디어 surface를 정리한다.
- HTML5, 음성, engine swap, mpv 비소유 경로는 위 fail-closed 판정의 비적용 범위다. 이 경로들은 기존 자동재생을 유지하며, engine swap은 기존 Fabric 세션을 재사용하고 중복 `afterVideoReady()`를 호출하지 않는다.
- 위 순서 이동에서도 기존 `!engineSwap`, load token, stale/cancel guard를 유지해 엔진 교체·취소된 로드가 중복 수화나 중복 재생을 만들지 않는다.

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
- 비동기 persistence refresh를 시작하기 전에 global history mutation 자리를 예약한다. 이동이 commit되면 이동 action을 먼저 넣고, tail 동안 들어온 외부 action은 그 뒤에 FIFO로 넣는다.
- global undo/redo는 예약 장벽이 풀릴 때까지 기다린다. 따라서 tail 도중 Undo를 눌러도 이전 action을 잘못 꺼내지 않고, 나중에 들어온 외부 action부터 이동 action 순으로 되돌린다.
- 이동 결과의 document owner가 바뀌어 이동 history action을 commit하지 못하거나 이동이 실패해도, 장벽에 대기하던 외부 action은 버리지 않고 원래 순서로 보존한다.
- global undo/redo가 이미 실행 중이면 새 Fabric 이동은 store mutation 전에 거절해 inverse history 작업과 이동 commit이 교차하지 않게 한다.

앱은 Fabric drag를 legacy `drawingManager.moveKeyframes()`로 보내지 않는다. 기존 controller의 persistence source refresh 순서를 재사용해 overlay authoritative pull → store 이동 → hydrate/export 검증 → active/passive 복귀를 직렬화한다. store change는 기존 ReviewDataManager dirty/autosave 경로를 사용한다.

## 보호 범위

- legacy `drawings`, legacy undo와 HTML5 동작은 변경하지 않는다.
- Fabric 키프레임 선택 삭제와 레이어 제어는 이번 범위에서 계속 막는다.
- playlist/cutlist aggregate timeline suppression은 유지한다.
- runtime 소스를 바꾸는 커밋에는 `npm run bundle:mpv-fabric-overlay` 결과를 함께 포함한다.
- 호스트/영상/source epoch가 바뀐 stale 표시·이동 결과는 폐기한다.
- 협업 연결 지연·실패는 로컬 Fabric 준비와 B-off 표시를 차단하지 않는다.
- 적용 대상 mpv Fabric readiness 실패는 자동재생보다 먼저 load를 실패로 닫고, HTML5·음성·engine swap·mpv 비소유 경로의 기존 재생 의미는 유지한다.
- 이동 history 예약이 열린 동안의 undo/redo와 외부 push는 FIFO 장벽을 따르며, owner 상실·이동 실패에서도 대기 action을 유실하지 않는다.
- pointerdown 프레임 승인 대기 중에도 coalesced 펜 좌표·압력을 순서대로 보존하고, bounded pending buffer를 넘으면 전체 gesture를 실패로 닫는다.

## RED→GREEN 검증

1. 표시: 99=blank, 100=exact, 101=held, empty break 이후 blank, 역방향 seek와 재생 source 교체.
2. active copy-on-write: 재생 중 hold 미리보기, 프레임 알림만으로 export·transition·scene 수 불변, pointerdown 프레임 고정, 다음 입력의 최신 프레임 전환, source 불변.
3. 이동: 단일·다중·겹침·덮어쓰기, 범위 실패 원자성, revision/event 1회, undo/redo.
4. 라우팅: Fabric drag는 store/controller만 사용하고 legacy manager/history는 호출하지 않음.
5. 영속성: autosave와 저장 후 재실행에서 frame·objects·empty break 유지.
6. viewport: fresh passive 표시와 B-off resize/zoom/pan에서 캔버스 크기·좌표 일치.
7. 통합 DTO: 실제 controller → host → runtime에서 extra key 없이 presentation이 승인되고, B 입력 enable 0회로 정·역 hold/empty 장면이 표시된다.
8. 네이티브 표시: B를 한 번도 누르지 않은 재생 시작과 keyframe 경계에서 runtime render → overlay `moveTop()` → invalidate 순서, reject/stale 시 restack 없음.
9. 콜드 스타트: 협업 Promise를 pending으로 둬도 `afterVideoReady`가 먼저 완료되고, 자동재생은 그 뒤에만 시작하며, 정상 협업·engine swap·stale/cancel 경로에는 중복 준비·재생이 없음.
10. readiness 실패: 적용 대상 mpv Fabric의 `afterVideoReady=false`는 자동재생 전 load 실패·정리를 만들고, HTML5·음성·engine swap·mpv 비소유 control은 기존 자동재생을 유지한다.
11. history 순서: 이동 tail 중 Undo 대기, 이동 뒤 외부 push FIFO, owner 상실 시 대기 action 보존, 진행 중 global Undo와 inverse 이동의 store commit 차단.
12. playback hot path: held source frame 해석이 object payload를 clone하지 않고 exact/hold/empty-break를 보존한다.
13. passive IPC deadline: 미응답 요청 뒤 최신 trailing이 진행되고, 늦은 응답·자동 retry가 현재 표시를 덮지 않는다.
14. delayed B-on: input 승인 전 playhead가 이동하면 첫 pointerdown과 runtime preview가 승인 시점 live frame을 사용한다.
15. 입력 정밀도: pointerdown 승인 대기 중 coalesced move 좌표·압력·pointerup 순서를 보존하고, 1,024개 상한 초과 시 저장 없이 capture를 해제한다.
16. 회귀: B toggle z-order, mpv runtime/host, HTML5 legacy, playlist/cutlist, 전체 테스트.

## 릴리스

기준 `origin/main`은 `2.2.1-beta`이며 표시 채널과 타임라인 편집 기능을 추가하므로 `2.3.0-beta`로 올린다. 독립 리뷰와 Codex PR 리뷰를 통과한 정확한 merge commit에서 Windows beta를 빌드하고, 공유드라이브 테스트 버전을 staging 교체한 뒤 전체 파일 SHA-256 parity와 실행 시나리오를 확인한다.
