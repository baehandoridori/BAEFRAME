# 댓글·재생 전환·드로잉 입력 구현

## 범위와 환경

- 요구사항: [구현 계획](../docs/superpowers/plans/2026-09-14-review-playback-input-plan.md) §1. 순서 T0 → T1 → T2 → T3 → T4 → T5 → T9 → T6 → T7 → T8 → T10.
- 기준 origin/main: `04e2a229bb1e85edac2a7c0f11bf9f294b796218`, 2.11.1-beta.
- 구현 폴더: `C:\BAEframe\BAEFRAME\.worktrees\review-playback-input`, 브랜치 `codex/review-playback-input`.
- 기존 main의 team-members.js 및 미추적 DEVLOG/docs, 다른 worktree, 실행 앱 및 사용자 데이터 보존.
- 계획은 timeline-comment-transition-plan worktree에서 복사. 과거 조사 로그는 이번 실행 결과와 구분한다.
- 사용자 요청으로 PR/머지/배포 승인됨. Slack 발송 및 사용자 앱 재시작은 범위 밖.
- 자동 테스트는 익명 A(3초/24fps), B(5초/24fps), C(3초/30fps) 및 0프레임/오류 시간 fixture만 사용. 실물 태블릿과 실제 앱 검증은 별도 기록한다.

## T0

- 저장소 작업/개발/드로잉/협업/파일/릴리스 가이드 확인. 실제 직렬화와 CAS 계약 우선.
- `npm ci --ignore-scripts`: exit 0. baseline 최초 270 pass/1 fail/0 cancelled, exit 1. Electron 설치 스크립트 미실행이 원인, 제품 실패 아님.
- `node node_modules/electron/install.js`: exit 0. 새 worktree의 Electron만 준비.
- 기준 검사: 계획 T0의 8개 파일에 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test` 적용. 로그 `.local/review-playback-input/T0-baseline-ready.log`.

## 진행

T0 검증 완료 후 T1 시작. T1~T10 미완료. 빌드/실제 앱/태블릿/PR/머지/배포 아직 미수행.
- T0 최종 결과: 271 pass / 0 fail / 0 cancelled, exit 0.

## T1

- RED: 신규 7개 실패(새 API/캐시 미구현 포함). 캐시 구현 후 실제 app 함수에서 메모리32→디스크0, DOM 중복 컷 배지 2개 재현 확인.
- GREEN: index/cache/panel 16 pass / 0 fail / 0 cancelled. 기존 runtime의 구현 문자열 검사 4개를 새 캐시/가드/표시 계약으로 갱신한 통합 결과 155 pass / 0 fail / 0 cancelled, exit 0 (`T1-final.log`).
- 원본 frame0 보존, 잘못된 시간은 null/시간 정보 없음 및 seek 제외. 현재 댓글 동기 snapshot 우선. 경로 정규화/in-flight 재사용/오류 재시도/LRU200, 부분 갱신과 1 worker 백그라운드 재검증 구현.
- 실기 미수행. 캐시는 표시용이고 쓰기에는 사용하지 않는다. T3에서 실제 변경 이벤트의 전체 갱신을 부분 갱신으로 연결한다.

## T2

- RED: checkpoint/queue API 4개 실패, 실제 app 함수의 늦은 전체 렌더와 CAS conflict 2개 실패를 수정 전 확인.
- 체크포인트는 성공한 write가 실제 포함한 revision만 인정. 진행 중 첫 IPC에는 완료 편집이 없고 두 번째 write에만 들어가는 실제 ReviewDataManager 테스트 추가(쓰기는 익명 메모리 fixture).
- 완료 intent는 await 전 등록, 파일별 직렬화/같은 작업 중복 억제, 전환의 outgoing/incoming 경로 동기 잠금 및 drain 적용. 실패는 이동을 차단하고 명시적 재시도 성공으로 해제.
- 비활성 컷 CAS 충돌은 최신 snapshot에 원하는 상태를 1회 재적용. 그림/다른 댓글 보존. 현재 컷 완료와 본문 수정은 checkpoint 사용.
- 늦은 완료의 전체 목록/focus/scroll 변경 제거, 행의 저장 중/실패 상태 유지.
- 최종 관련 검사 232 pass / 0 fail / 0 cancelled, exit 0 (`T2-final.log`). app 구문 검사 exit 0. 전환 harness에 새 queue 의존성 추가 후 기존 행동 검사 통과.
- 실제 앱/동시 PC 검증은 아직 미수행.

## T3

- RED: 계측 API/주입 reader 검사가 3개 실패. 구현 후 결과/예외 보존 및 로그 실패 격리 확인.
- 저장/flush/fileInfo/미디어 load/versionScan/reviewLoad/Fabric 준비/firstPlay/commentRefresh/total 구간 기록. firstPlay start/end는 재생 호출 시점이며 실제 최초 표시 프레임과 다름.
- 진행률은 같은 댓글 reader와 항목 Map을 사용. 초기 worker 최대2, marker/저장/전환 갱신은 변경 컷만 읽고 목록 구조가 같으면 segment 재구성 생략.
- 100컷 fixture 부분 갱신: 해당 read1/무관99개 read0/probe0/clear0. 실사용자 파일 읽기나 쓰기 없음.
- 최종 관련 162 pass / 0 fail / 0 cancelled, exit0 (`T3-final.log`).
- 실제 20회 local/Drive warm/cold 전환 측정은 T10 격리 앱 검증에서 수행할 항목. 현재 실측 근거가 없으므로 조건부 versionScan 지연 로드는 적용하지 않음. Drive 지연 제거를 주장하지 않음.

## T4

- RED: Fabric active가 레거시 ready=false 처리로 댓글 입력 차단을 해제하는 행동과 boolean overlay 계약 2개 실패 확인.
- 드로잉 입력 소유권 정책 분리, active/preparing/recovering 차단 및 passive/failed/off 해제 검증. 진행 중 marker drag 취소 및 리스너 정리, tooltip 닫기, click/hover 방어.
- 메인/실제 native overlay의 marker/tooltip 자손 pointer-events 차단. commentInteractionBlocked의 생략/명시 false 구분.
- 관련 179 pass / 0 fail / 0 cancelled, exit0 (`T4-green.log`). 실물 펜/네이티브 hit-test는 T10 별도 검증 대상.

## T5

- RED: 신규 멘션/편집 세션 9개 실패 및 실제 목록 renderer가 편집 DOM을 파괴하는 테스트 실패 확인.
- 한국어 바로 뒤/괄호 @ 허용, ASCII 이메일 접두 거절. entry별 IME 상태/keyCode229, 실제 소비 키 표시, 해당 editor 한정 드롭다운 확인, pointerdown 및 미지원 문서 mousedown fallback.
- plaintext-only/ownerDocument/분리창 이벤트 생성자 보존. 기존 attached 멘션 재사용.
- 목록/스레드 편집 세션으로 전체 렌더 지연, 대상별 메모리 초안 보존. 원격 삭제 시 복사 가능한 초안 보존. 완료 버튼은 편집 중에도 행만 업데이트.
- 답글 수정 및 본문 수정은 T2 checkpoint로 저장 확인. 일반 댓글/답글의 기존 권한 검사는 유지.
- 최종 관련 179 pass / 0 fail / 0 cancelled, exit0 (`T5-final.log`). 실제 태블릿 후보 선택/실제 앱 입력 검증은 아직 미수행.

## T9 (T5 다음)

- RED: 58셀→57프레임, release 좌표 무시, 혼합 FPS identity와 cancel 소유권 등 신규23개 실패 확인.
- 8*EPSILON 상대 오차만 보정하고 floor 유지. release 당시 rect/CSS 좌표로 정수 frame 확정, pointerId/capture/cancel 복귀/blur/dispose 정리.
- seek detail에 displayFrame/localFrame/itemId/cutId/frameExact 전달. playlist는 load/intent 확인 뒤 seekToFrame, cutlist는 sourceStartFrame 오프셋과 최신 선택 generation 유지.
- 기존 목표 frame hold/video-player 코드는 변경하지 않음. 글로벌 +1/round 보정 없음.
- 실제 production seek 함수가 다른 fps 상태에서도 요청58을 seekToFrame(58)으로 보내는 행동 검사 포함. 관련175 pass / 0 fail / 0 cancelled, exit0 (`T9-final.log`).
- 프레임 번호가 새겨진 영상의 native 재생/드로잉 저장 프레임 대조는 T10에서 별도 수행 예정.
