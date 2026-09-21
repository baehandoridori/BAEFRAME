# 창 이동 지연과 버전 메뉴 입력 가림 수정

## 범위와 계획
- 기준: origin/main `119c13b`, 2.12.4-beta. 다른 작업이 남아 있는 기본 체크아웃 보존.
- 영상/입력 창의 부모 이동 처리, 숨김 상태와 재정렬 경합을 재현하고 공통 경로 수정.
- 회귀 테스트 → 독립 로컬 리뷰 → PR/머지 → 정확한 merge SHA 빌드 → 기존 배포 백업/staging/전체 SHA-256 검증.
- 사용자가 Codex 리뷰 한도 소진으로 로컬 내부 리뷰를 명시. 온라인 봇 리뷰 대신 독립 로컬 리뷰를 사용한다.

## 원인과 구현
- `MPVEmbedHost`와 `MPVOverlayHost`가 부모 move/moved를 `setImmediate`로 미뤘다. Windows에서 부모 `setPosition` 직후 두 호스트는 이전 좌표에 있었고 200ms 뒤에야 일치했다. 네이티브 드래그 루프 중 callback 지연 가능성이 있다.
- 부모 이동 경로는 bounds 캐시를 갱신하지 않고 `setBounds`와 overlay `moveTop`을 반복했다. renderer 갱신과 부모 이동이 섞이면 캐시가 이전 화면 좌표를 가리켰다.
- 실제 Electron 28/Windows에서 숨긴 창에 `moveTop()`을 호출하면 다시 표시된다. 메뉴가 열려 `requestedVisible=false`인데 `updateBounds`가 overlay만 다시 표시하는 현상을 계측했다. DOM `.click()`은 성공하므로 버전 선택 콜백 자체와 OS 입력 가림을 구분했다.
- 부모 이벤트 안에서 두 창의 위치를 즉시 반영하고 ensure/update/parent 경로 모두 `_applyScreenBounds`로 중복 적용을 제거한다. 이동 자체는 z-order를 건드리지 않는다.
- 모든 overlay restack에 `_canRaiseOverlay`/`_raiseVisibleOverlay`를 적용한다. 숨김 요청, 실제 창 숨김, 부모 숨김/최소화, 교체된 창은 다시 표시하거나 focus하지 않는다. 표시 복원은 기존 `setVisible`/부모 show 경로를 따른다.
- IPC 채널/입력 데이터 형식, 저장 형식, 미디어 바이너리는 변경하지 않는다.

## 재현과 검증 기록
- 수정 전 `test:mpv`: exit 0, 399 pass / 0 fail / 0 cancelled.
- 새 회귀 `mpv-parent-move.test.js`: 수정 전 7 fail, 수정 후 통과. 즉시 이동, 중복 이벤트, 이전 좌표 복귀, 메뉴 중 layout/drawing 경합을 검증.
- 실제 Windows Electron probe: 수정 전 embed hidden / overlay visible / requested false. 수정 후 두 창 모두 hidden. 수정 후 부모 이동 직후와 안정화 후 좌표 일치.
- `mpv-native-window.test.js`: 실제 BrowserWindow 이동/숨김/재표시/부모 숨김과 native drawing setup 검사. 개인정보 없는 별도 프로필 사용.
- 현재까지 호스트·새 native 검사 126 pass / 0 fail / 0 cancelled, exit 0.
- 테스트 실행 초기에 GUI exe를 shell pipe로 시작해 pipe 종료 오류가 발생했다. 해당 테스트 인스턴스만 정리하고 안정적인 stdout/stderr 파일 리다이렉션으로 재실행했다. 제품 변경과 분리된 테스트 실행 문제다.

## 남은 검증
- 버전 실제 Chromium pointer 입력, 관련 회귀 묶음, 독립 리뷰와 릴리스 증거를 아래에 추가한다.
- 실제 사용자의 장시간 마우스 드래그, 다중 DPI 모니터 이동, 팀원 PC 동기화는 자동/격리 검사와 구분한다.

## 최종 회귀와 로컬 리뷰
- 로컬 리뷰 1차 `71373c1`: P2 1건. overlay 일반 closed 후 동일 bounds로 재생성하면 이전 창 캐시로 배치를 건너뛴다. 실제 Electron close/recreate 검사로 fail 1 재현 후 새 창 생성 시 캐시 초기화, pass 1로 해결(`52b281a`).
- `test:mpv`: 407 pass / 0 fail / 0 cancelled, exit 0.
- `test:version`: 11 pass / 0 fail / 0 cancelled, exit 0.
- `test:playlist`: 375 pass / 0 fail / 0 cancelled, exit 0.
- `test:comment-input`: 54 pass / 0 fail / 0 cancelled, exit 0.
- `test:fabric-drawing-pilot`: 631 pass / 0 fail / 0 cancelled, exit 0.
- 총 1,478 pass. 수정 파일 ESLint `--no-ignore`: exit 0, 경고/오류 없음. `git diff --check` 통과.
- 검사 보완: mpv 명령 목록과 guarded restack을 기존 source assertions에 반영. 이전 댓글 단축키 릴리스가 바꾼 3인자 호출을 오래된 2인자 assertion에 반영(기준 SHA에서도 불일치 확인).
- 격리 실제 앱/생성 영상에서 menu 열림 시 embed/overlay 모두 hidden, Chromium `sendInputEvent` 마우스 클릭 후 `probe_v1.mp4 → probe_v2.mp4`, badge v2, 메뉴 닫힘 확인. Electron 입력 테스트에는 창 활성화가 필요했다. OS 실제 마우스 드래그 검사와 구분한다.
- 상세 실행 로그와 재현 JSON: 작업 폴더 `.cache/diagnostics/`. 배포 결과는 exact merge 이후 별도 로컬 릴리스 보고서에 기록한다.
