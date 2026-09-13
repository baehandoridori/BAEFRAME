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

T0~T8 및 T9 구현 커밋 완료. T10 통합 검증 진행. 아래 각 task 수치는 그 task 시점의 검사이며, 최신 통합 결과는 T10에 기록한다.
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

## T6 (T9 다음)

- RED: 구간/DOM 강조 신규3개 실패. 양끝 포함, 끝 없음=1프레임, 실제0/invalid, playlist item 정체 및 cutlist global interval 구현.
- 실제 목록/필터 갱신 때만 key→DOM index 재구축, 재생 tick은 차이 class/data-current-frame만 변경. previous review와 이전 리뷰 분리창도 연결.
- T9 scrubbing detail로 미리보기/최종/취소 강조 연결. .selected/aria-label/포커스/스크롤 변경 없음.
- 500행 DOM 시험에서 innerHTML 쓰기0, 반복 강조의 행 query1회, 초안/선택/스크롤 보존.
- 관련51 pass / 0 fail / 0 cancelled, exit0 (`T6-final.log`). 실제 앱 화면 검증은 미수행.

## T7

- RED: mouse/pen/touch 이동량과 입력 소유권 신규4개 실패 확인.
- pointerdown의 CSS 좌표/scale/pan을 고정하고 동일 pointerId만 추적, release 최종 좌표 반영. cancel/lostcapture/blur/영상·모드 변경/종료 정리.
- rAF로 메인 viewport 갱신 합치기, end flush. 기본 가운데 고정 조건 유지. 중간 버튼 scrub은 별도 mouse 경로를 유지하고 주 버튼 호환 mouse 중복 이동 제거.
- 관련17 pass / 0 fail / 0 cancelled, exit0 (`T7-final.log`). 실물 태블릿은 아직 미수행.


## T8 — native Fabric Space 입력 소유권

- primary down을 프레임 확정/레이어 잠금/Alt 처리보다 먼저 보류하고 전용 IPC로 main의 Space 상태를 확인한다. draw만 기존 프레임 확정으로 한 번 재생하고 pan은 뷰포트만 변경한다.
- 공유 strict validator, 양방향 sender와 host/video/persistence/identity fence, 단조 sequence, 응답 timeout/취소, 늦은 mirror 차단, keyup flush를 구현했다. Space 재지정과 반복 입력을 구분한다.
- sandbox=true를 보존하기 위해 overlay preload와 공유 controller를 번들로 생성했다. 실제 Fabric DOM 경로에서 잠긴 레이어 위 pen/Alt pan의 mutation/undo=0, 조기 pointerup 후 draw 프레임 확정 1회를 검사했다.
- T7 취소에서 다른 pointerId 무시와 종료 여부 반환을 보완했다.
- RED: validator 미구현 1 fail, ownership 미구현 1 fail. 초기 전체 검사 225 fail 중 223은 npm ci --ignore-scripts로 생긴 canvas native 모듈 미설치였다. npm rebuild canvas 성공 후 실제 Fabric 검사가 실행됐다. 나머지 2개는 새 bridge/번들 경로의 기존 계약 갱신이었다.
- bundle exit0, T8 관련 node tests exit0 / pass579 / fail0 / cancelled0 (`.local/review-playback-input/T8-final.log`). 실제 앱/실물 태블릿은 아직 미수행.


## T10 — 통합 검증

- 신규 검사를 package.json의 실제 playlist/mpv/frame-grid/comment-input/ux/video-pan 명령에 연결했다. 버전은 기능 추가와 하위 호환 수정 범위에 맞춰 2.12.0-beta로 올렸다.
- 기존 소스 검사 중 옛 전체 Promise.all/마우스 이벤트/preload 경로를 강제하던 항목은 새 동작의 안전 계약을 검사하도록 갱신했다. 기존 fixture harness에 새 queue/pan 정책 의존성을 추가했다.
- ESLint는 숨김 worktree를 기본 제외하므로 ignore:false로 변경 파일을 실제 검사했다. CRLF를 LF로 통일하고 새 코드의 스타일 오류를 수정했다.
- 실제 앱에서 native mpvLoad 계측 누락을 발견해 실제 load 호출 시작/완료에 연결했다. thumbnail 준비를 mpvLoad 종료로 표시하지 않는다. firstPlay는 재생 호출 완료일 뿐 최초 영상 표시 시간이 아니다.
- 추가 RED/GREEN: 같은 댓글의 다른 답글 저장이 합쳐지는 재현 5 pass/1 fail → reply id로 분리 후 6 pass/0 fail. 저장 실패 이유를 잘못된 권한 오류로 덮어쓰지 않도록 수정했다.
- 추가 RED/GREEN: 저장 원본의 endFrame=0이 생성 기본값96으로 바뀌는 실제 CommentMarker.fromJSON 재현 11 pass/1 fail → 로드 시 원본 시간과 누락을 보존 후 12 pass/0 fail. 새 댓글 생성의 기본 길이는 유지하고, 누락된 기존 댓글 시간은 0으로 변환하지 않는다. 끝이 없는 기존 댓글은 한 프레임으로 해석한다.

### 격리 앱과 데이터 경계

- Playwright Electron으로 별도 userData와 --skip-shell-registration/--multi-instance-user-data 실행. 익명 A(3초24fps)/B(5초24fps)/C(3초30fps) 영상을 FFmpeg로 생성하고 프레임 번호를 새겼다. 기존 실행 앱을 종료·재시작하지 않았다.
- 외부 네트워크는 테스트 앱 session에서 차단했다. 이때 기존 Liveblocks 초기 연결 대기가 첫 저장을 막아, 테스트 페이지 debugger 경계에서 협업 시작을 실패시키는 가짜 구현을 주입했다. 이는 제품 코드 변경이 아니며 원격 협업 성공을 의미하지 않는다.
- 최초 그림은 위 연결 대기로 수동 fixture export 후 재열기했다. 이후 실제 saveThroughCheckpoint/CAS 저장을 성공시켜 저장 전후 그림 동일성을 확인했다. 수동 export와 제품 저장을 구분한다.
- import fixture에 createdAt을 빠뜨려 InvalidDate 오류가 한 차례 발생했다. 익명 fixture를 올바른 직렬화 형식으로 수정 후 실제 저장 성공. 제품 오류/성공 수치에 섞지 않았다.
- native overlay 150%에서 (120,40) CSS px mouse 이동 → main/runtime pan(80,26.6667), objects/undo/mutation 증가0. 실제 태블릿 검증은 미수행.
- 실제 타임라인 drag release → UI frame58. mpvScreenshot의 burned-in A58을 이미지로 확인. 해당 프레임의 새 그림은 drawingsV3 keyframe58에 저장됐다.
- 3컷 목록: A24=로컬1초/전체1초, B32=로컬1초8프레임/전체4초8프레임, C30=로컬1초/전체9초. 실제 frame0은 00:00:00:00 유지. 중복 컷 시간 배지는 없다.
- 완료→다음 컷→복귀 제품 저장 성공, 완료 true. drawingsV3/manualVersions 및 root key 집합 동일. 첫 실측 다음 컷 요청은 이벤트 루프 대기로62.5ms여서 '50ms 이내 실기' 통과로 쓰지 않는다. 50ms race는 통제 자동 검사로 검증했다.
- CDP native overlay keyDown은 확인됐지만 sendInputEvent keyUp은 테스트 자동화에서 전달되지 않았다. OS 강제 입력은 대상 foreground 검증이 실패해 보내지 않았다. 메인 Space tap 재생과 native mouse pan은 확인, 실제 OS focus handoff·키 유실·태블릿은 미확인.

### 최신 검사 결과

| suite | pass | fail | cancelled | exit |
|---|---:|---:|---:|---:|
| test:playlist | 355 | 0 | 0 | 0 |
| test:mpv | 397 | 0 | 0 | 0 |
| test:frame-grid | 68 | 0 | 0 | 0 |
| test:comment-input | 36 | 0 | 0 | 0 |
| test:comment-popout | 52 | 0 | 0 | 0 |
| test:ux | 77 | 0 | 0 | 0 |
| test:fabric-drawing-persistence | 166 | 0 | 0 | 0 |
| test:fabric-drawing-pilot | 631 | 0 | 0 | 0 |

- 번들 생성 exit0, 변경 파일 ESLint 오류0. 로그는 `.local/review-playback-input/T10-*`에 보존했다. suite는 일부 검사가 겹치므로 합계를 고유 테스트 수로 쓰지 않는다.
- 쓰기 전 잠금/권한 거절이 영구 저장 실패로 남아 이동을 막는 재현6 pass/1 fail → mutation 전 거절과 실제 실패를 구분 후7 pass/0 fail. 실제 저장 실패는 계속 재시도 성공까지 이동을 막는다.
- 최종 실제 완료→즉시 다음 컷: local20/Drive20 모두 저장·전환 성공, 요청 간격 최대1ms. 별도 pending 목록 검사0.4ms에 aria-busy=true/저장 중 확인. 초기62.5ms 측정과 구분한다.
- 실제 수정창 한글 멘션 후보 선택 성공. frame32로 이동하고 markersChanged를 발생시켜도 같은 DOM/초안/포커스 유지.
- 성능 조건/원본 JSON/median·p95/이미지: [T10 실제 검증 증거](../docs/superpowers/plans/2026-09-14-playlist-review-evidence/T10/README.md). local warm p95 1399.7→980.2ms, Drive1465.8→1005.4ms. versionScan p9544.9ms로 조건부 지연 로드 미적용. cold와 Drive 지연 제거는 주장하지 않는다.

### 요구별 인수 상태

| 요구 | 구현/자동 검사 | 실제 격리 앱 | 미확인 |
|---|---|---|---|
| R1 | 시간 출처·0/누락·FPS·캐시 통과 | 3컷 로컬/전체 시간 | 실제 업무 파일 시나리오 |
| R2 | queue/checkpoint/CAS conflict/실패·전환 보호 통과 | local/Drive40회 즉시 전환 및 재열기·그림 보존 | 다른 PC 동시 편집 |
| R3 | 100컷 부분 갱신·단계 계측 통과 | baseline/after local/Drive 각20 warm 및 first-touch 별도 | cold 다운로드·모든 환경의 끊김 제거 |
| R4 | 메인/host 입력 소유권과 댓글 차단 통과 | native 포인터 경로 작동 | 실물 펜으로 점 위 획 |
| R5 | 편집면·IME·pointer·draft 검사 통과 | 수정창 한글 후보와 DOM/초안 유지 | OS IME 장치·실물 펜 선택 |
| R6 | 겹친 구간·현재 컷·필터·DOM delta 통과 | frame32 해당 댓글 강조 | 장시간 재생·다른 PC |
| R7/R8 | 엄격 IPC·실제 Fabric DOM·cancel/flush/session 통과 | native mouse pan, mutation/undo0, 메인 Space tap | 실물 태블릿·실제 OS keyup/focus handoff |
| R9 | 최종 release·혼합 FPS·DPR·scroll·cutlist 통과 | burned-in58/UI58/그림 저장58 | 기타 실제 디코더/장치 |

PR·머지·정확한 merge SHA 빌드·배포는 다음 릴리스 단계에서 기록한다. 태블릿 등 미확인은 자동 검사나 빌드 성공으로 대체하지 않는다.

- 추가 실제 익명 D 재열기: start/end0 보존, 시간 누락 행의 `시간 정보 없음` 표시 확인. 필터가 null 시간을0으로 다시 정렬하던 문제3 pass/1 fail 재현 후 컷 안의 유효 시간 뒤에 배치하도록 수정했다.

- b70e441 제품 소스의 별도 격리 실행으로 저장 불변식을 다시 확인했다. 최초 endFrame0 치환 재현의 otherCommentsUnchanged=false를 보존하고, 수정 후 native-save-parity-final.json에서 그림/루트 필드/다른 댓글 모두 true를 확인했다. 최종 실제 목록 순서는 0→24→32→시간 정보 없음이었다.


## PR #222 Codex 1차 리뷰 반영

- 대상b70e441, trigger5655175868, line comment4000476506(P2): 비동기 영상 이동이 실패해도 scrubbingEnd가 목적지 댓글을 계속 강조하는 문제.
- 실제 app의 seek/scrubbing/scrubbingEnd 리스너를 실행해 playlist/cutlist 각각 실패를 재현했다(3 pass/2 fail). 최신 요청 객체만 완료 처리를 소유하고, 성공 시 실제 프레임·실패 시 원본 영상의 현재 프레임으로 강조를 갱신한다. 이후 시작한 드래그는 오래된 실패로 덮지 않는다.
- 저장 실패 뒤 목록 선택이 새 항목에 남아 있어도 실제 로드된 continuous segment에서 댓글 정체를 구한다. 이동 예외도 같은 복원을 거친다.
- 새 행동7 pass/0 fail. 관련 suite: comment-input36/frame-grid68/playlist353/ux77 pass, 모두 fail0/cancelled0/exit0. UX 최초76 pass/1 fail은 기존 VM harness가 새 frame reader import를 제거해 생긴 ReferenceError였고, 실제 production reader를 주입해 재검사했다. lint 오류0.
- 초기 저장 불변식 실패와 수정 후 최종 실제 저장 증거를 함께 명확히 문서화했다. 새 head로 재리뷰 요청한다.


## PR #222 Codex 2차 리뷰 반영

- 대상80ee4b9, trigger5655237605, P1 두 건(comment4000511109/4000511112).
- native cancel: 이전 검사의 main/overlay transform 변수를 분리해 미전송 move 뒤 pointercancel·owner cancel 불일치를 재현했다(9 pass/2 fail). main이 cancel의 마지막 표시 좌표를 반영하고 그 sequence를 viewport mirror에 남긴다. owner 주도 취소에는 authoritative transform을 엄격한 cancel packet으로 보내고, 이미 release된 제스처의 지연 취소도 같은 fence에서 좌표/sequence를 맞춘다. sandbox preload/ESM/runtime 번들을 함께 재생성했다.
- 실제 Fabric DOM pointercancel과 늦은 cancel까지 검사했다. 별도 Electron 앱의 실제 main↔host↔native IPC에서도 동일 tick move/cancel 뒤 main(80,26.6667)과 overlay 좌표가 일치하고 mutation/undo0, 재생false였다. 취소 후175% 확대 mirror도 수신됐다. 실물 펜/OS pointercancel 검증으로 확대하지 않는다.
- background revalidation: 100개 무변경 파일을 전부 읽고 render하는 기존 timer 재현(4 pass/1 fail), 실제 app cache의 metadata reader 미연결 재현(3 pass/1 fail)을 먼저 확인했다. 기본 freshness60초/5초 tick/round-robin 최대4경로/worker1로 분리했다. size+mtime으로 변경 여부를 확인하며 변경 시만 본문을 읽는다. 같은 댓글 snapshot은 DOM/timeline 갱신을 생략하고, batch 내 변경은 마지막에 한 번 렌더한다. 쓰기는 계속 캐시를 사용하지 않는다.
- 관련 검사: cache/panel9 pass, mpv397 pass, playlist355 pass, Fabric pilot631 pass, persistence166 pass. 모두 fail0/cancelled0/exit0. lint 오류0, 생성 번들 검사 포함.
- Electron 검증 시작 시 mpv 내장 영상 창을 overlay로 잘못 선택한 테스트 harness 오류를 고쳤다. 실제 runtime 존재로 창을 선택한 뒤 위 결과를 확인했다. 제품 코드 오류와 구분한다.

- 리뷰2 수정 후 동일 익명 fixture/격리 앱 전환46회: warm 각20회, local median771.6/p951101.1ms, Drive median774.8/p95924.3ms. 초기3회는 별도 first-touch이며 cold 다운로드 검증은 아니다. raw JSON과 실제 취소/실패 전환 증거를 T10 폴더에 추가했다.

## 배포 후보 빌드 사전 확인

- a607b64의 별도 release worktree에서 npm run build exit0. 기본 fabric-v3-stable 프로필로 실행한 packaged 앱에서 version2.12.0-beta/isPackaged/mpv-embedded/native bridge/테스트 영상 screenshot을 확인했다. 개인 userData/실제 업무 파일은 사용하지 않았다.
- prebuild가 같은 mpv Fabric runtime을 재사용하는 editor-drawing.iife.js도 갱신했다. 이 생성 결과를 소스와 일치하도록 추가하고 test:editor147 pass/fail0/cancelled0/exit0를 확인했다. 최종 리뷰 이후 정확한 merge SHA에서 다시 빌드한다.
- packaged 검사 스크립트의 asar 경로 구분자를 Windows path.normalize로 고쳤다. 처음 파일 없음 오류는 검사 스크립트 오류였으며 실제 archive에 해당 파일이 있고 비교26개가 모두 일치했다.

## PR #222 최종 후보 리뷰의 댓글 편집 보완

- 최종 후보0ef5a3c, trigger5655383688, review5191831026의 P2 두 건(comment4000563301/4000563303)을 확인했다. 앞선 a607b64 트리거는 편집 화면 생성 번들 추가로 대체했으며 이전 신호를 승인으로 사용하지 않았다.
- 실제 saveCurrentCommentEdit와 focus listener로 원인 재현10 pass/5 fail 후 수정. 실패한 본문/답글의 text만 소유권·객체·현재 값 확인 후 복원한다. 원격 병합이 실패 본문을 다시 살리지 않도록 복원은 새 revision으로 알린다. 다른 완료 상태/답글/그림과 더 최신 원격 본문은 덮지 않는다. 복원된 수정은 navigation 실패 queue에 남기지 않으며 초안은 편집창에 유지한다.
- 편집칸 handoff는 보류된 refresh를 다음 session에 넘기고, 다른 문서 등 명시적 context 종료는 기존대로 폐기한다. 답글 취소 경로의 refresh 유실도3 pass/1 fail로 추가 재현하여 폼 정리 뒤 flush한다.
- 관련 결과: playlist360/comment-input38/comment-popout52/ux77/persistence166 pass. 모두 fail0/cancelled0/exit0. lint 오류0. 테스트 반복은 후속 cleanup 변경 범위에 한정했다.
- 별도 실제 Electron 앱: 익명 A 댓글 수정 checkpoint 실패→원래 본문 복원→정상 저장→A.bframe 재읽기에서 원래 본문 확인. 사용자 데이터는 사용하지 않았다. T10/review4-native-edit-failure.json에 원본 기록.

## PR #222 이전 리뷰 FPS 정합성 보완

- 대상100db00, trigger5655446875, review5191859630/comment4000593902(P2): source FPS의 raw frame을 현재 영상 frame과 비교하던 재현.
- 실제 previous-review panel과 팝업에서24→30/30→24/23.976→29.97 FPS, 이어받기, 구간 끝, frame0/누락/마지막 frame 검사28 pass/4 fail을 먼저 확인했다.
- source frame/FPS를 현재 FPS로 환산하고 seek와 같은 마지막 frame clamp 함수를 공유한다. 원본 source의 끝 frame도 선택적으로 보존하여 구간을 잃지 않으며, 이전 snapshot의 누락 끝은 시작 frame으로 처리한다. 잘못된 범위와 길이 밖은 강조하지 않는다. 저장되는 source의 frame/FPS를 현재 값으로 덮지 않는다. schema 문서에 선택 필드와 호환 동작을 기록했다.
- 자동 결과: previous-review55/comment-input38/playlist360/persistence166 pass, fail0/cancelled0/exit0. lint 오류0/diff check 통과. 이번 혼합 FPS 보완은 DOM 자동 검증이며 새 실물 태블릿/협업 실기로 보고하지 않는다.

## PR #222 일반 목록의 시간 없음·선택 필드 검증 보완

- 대상ac47657, trigger5655515430, review5191916353의 P2 두 건(comment4000625981/4000625985).
- 실제 일반 목록 renderer, CommentMarker/CommentManager, carryover manager로24 pass/3 fail을 먼저 재현했다. missing/null/음수/문자열/boolean은 시간 없음으로 표시하고 일반 목록 클릭·직접 포커스·댓글 마커 seek에서 제외한다. 썸네일 요청/타임라인 범위/이전·다음 댓글 이동도 유효 frame만 사용한다. 실제 frame0은 그대로 표시/선택/이동한다.
- optional endFrame은 undefined/null 또는 시작과 일관된 유한 비음수 수만 지원한다. 잘못된 persisted payload는 기존 opaque roundtrip과 편집 차단 경로를 따른다. 기존 필드 없는 snapshot도 지원한다.
- 실제 앱에서 시간 검증 함수 import 누락을 발견했고, 테스트가 임의 helper 주입 대신 실제 app import 목록을 쓰도록 바꿔5 pass/2 fail 재현 후 import를 연결했다. 제품 연결 누락이며 최종 앱에서 수정 확인했다.
- 확장 검사: playlist363/mpv397/frame-grid68/comment-input38/comment-popout52/ux77/persistence166/Fabric pilot631/previous-review56/cutlist82 pass. 모두 fail0/cancelled0/exit0. prebuild와 lint 오류0/diff check 통과. 생성 번들은 이미 source와 일치하여 추가 diff 없음.
- cutlist 최초80 pass/2 fail은 T9에서 바뀐 detail 전달/정수 frame 검사 대신 옛 함수 문자열을 고정한 source test였다. 시간 이동보다 cutlist 분기 우선, load 전 target frame 결정 검사를 새 계약으로 유지했다.
- 실제 익명 D 일반 목록: untimed 클릭 뒤 frame32 유지/seekCalls[], zero 클릭은 frame0/seekCalls[0]/00:00:00:00. 이전 리뷰 혼합 FPS의 실제 30~60 강조·61 해제·frame0 결과도 T10 폴더에 추가했다. 사용자 업무 파일에는 쓰지 않았다.

## PR #222 저장 재시도 중 편집 잠금·누락 끝 필드 보존

- 대상ee5073c, trigger5655612960, review5192005372, P2 comment4000671992/4000671994.
- 4초 기본값 복원 제안은 사용자 지정 계획 §1.1의 “끝이 없으면 한 프레임짜리 구간”과 충돌하므로 적용하지 않았다. 대신 기존 파일의 missing endFrame이 무관한 저장에서 새로 쓰이는 문제13 pass/1 fail을 재현했다. 메모리에서는 명시 사양대로 한 프레임, 원본에 없는 끝 필드는 범위를 실제로 늘리기 전까지 저장하지 않는다. 새 댓글의 생성 기본4초는 유지한다. 내부 flag는 저장 형식에 추가되지 않는다.
- 실제 편집 버튼/save/cancel 리스너의 실패·빈 제출 잠금 해제를5 pass/2 fail로 재현했다. 실패/빈 입력은 열린 초안과 activeComment를 유지하고 성공 또는 취소로 닫힐 때만 해제한다. 다음 인수 조건 검사21 pass/0 fail.
- 관련 결과: playlist364/comment-input41/comment-popout52/previous-review56/persistence166 pass. 모두 fail0/cancelled0/exit0. lint 오류0/diff check 통과. 실제 다른 PC 편집 잠금 실기는 미확인이며 DOM 리스너/Presence 호출 자동 검증이다.


## 최종 리뷰 8차 경계 조건

- 23.976/29.97fps 신규 댓글의 기본4초 끝이 소수가 되어 한 프레임으로 축소되는 원인을 재현했다. 생성자와 실제 startMarkerCreation 양쪽에서4초 길이를 정수 프레임으로 반올림한다.
- 목록 교체/새로 만들기/닫기로 재시도 행이 사라진 뒤 과거 실패가 파일 이동을 영구 차단하는 문제를 재현했다. playlist scope 실패만 폐기하고 진행 중 쓰기는 완료까지 기다린다. 뒤늦은 실패가 다시 이동을 막지 않으며 일반 편집 실패와 새 목록 실패는 유지한다.
- 유효한 저장 carryover의 null 끝은 현재 FPS의 시작 프레임 한 장으로 강조한다. 미가져온 원본에서 손상된 끝을 null로 정규화한 표시는 계속 강조에서 제외한다.
- 재현 검사63개: 수정 전58pass/5fail/0cancelled/exit1 → 수정 후63pass/0fail/0cancelled/exit0. 첫 보완 중 테스트 window 환경 누락을 수정했고 실제 persisted manager.fromJSON 경로로 null을 재현했다.
- 관련 검사: playlist368, previous-review57, comment-input41, comment-popout52, persistence166 pass. 모두 fail0/cancelled0/exit0. 기존 isolated lifecycle harness에 새 정리 의존성을 추가했다.
- 로그: .local/review-playback-input/review8-*.log. 이 보완은 자동 검사이며 추가 실물 태블릿 검증으로 표시하지 않는다.


## 최종 리뷰 9차 중복 편집 제출

- 느린 저장 중 같은 본문/답글에 다시 제출하면 entity key로 첫 promise를 공유해 새 내용의 성공으로 오인하는 경로를 재현했다.
- 공통 saveCurrentCommentEdit는 동일 entity의 pending 제출을 false로 거절한다. 실제 일반 댓글·답글/팝업 편집 폼을 전달받아 해당 입력을 readOnly/contentEditable=false, 저장·취소 버튼 disabled, aria-busy=true로 잠그고 finally에서 원상복원한다. 실패 뒤 초안/편집 잠금은 유지되어 재시도할 수 있다.
- 재현:17개 중14pass/3fail/0cancelled/exit1 →17pass/0fail/0cancelled/exit0. 실제 textarea/contenteditable 폼, 지연 저장, 중복 mutation 거절, 본문 복원, 재시도 입력 해제를 확인했다.
- 관련 검사 playlist371, comment-input41, comment-popout52, persistence166 pass/fail0/cancelled0/exit0. 변경 ESLint 오류0, git diff --check 통과. 로그 review9-*.log.
