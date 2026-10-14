# 댓글 확정 직후 재생 화면 복원 오류

## 계획과 조사

- 사용자 요청: 댓글 Enter 확정 직후 간헐적인 재생 문제 조사, 수정, 리뷰 및 운영 배포.
- 기준: origin/main `292239e`, 2.13.2-beta. 기존 main의 수정과 실행 중인 사용자 앱을 보존한다.
- 운영 로그(2026-10-13)에서 댓글 저장 전후 `stale visibility request` 경고를 반복 확인했다.
- 가설: `releaseMpvReviewFreezeFrame()`의 표시 요청과 MutationObserver가 예약한 동일한 표시 요청이 경합하여, 정상 표시 응답이 stale로 처리되고 정지 이미지가 남는다.
- 검증: 실제 app.js 함수로 경합을 재현하고 수정 전 실패를 확인한다. 같은 표시 요청은 진행 중 응답을 공유하되 반대 요청, 엔진 교체, teardown은 기존 무효화 경계를 유지한다.
- 관련 자동 검사 후 격리 프로필/테스트 영상으로 Electron 앱 입력과 실제 mpv 진행을 확인한다.
- PR/Codex 리뷰 완료 후 정확한 merge SHA를 빌드하고 백업, staging, 운영 전체 파일 SHA-256을 검증한다.

## 진행

- 의존성 설치 exit 0, 생성 tracked diff 없음.
- 수정 전 `test:comment-input`: exit 0, 78 pass / 0 fail / 0 cancelled / 0 skipped.
- 실제 사용자의 물리 키 입력과 원격 팀원 PC 동기화는 자동 검사와 구분한다.

## 수정과 검증

- `app.js`: 같은 엔진·표시 상태·요청 revision의 진행 중 native 표시 요청을 공유한다. 반대 표시 요청과 teardown은 이전 요청을 무효화한다. 늦게 실패한 이전 요청이 최신 표시 상태를 지우지 않도록 보호한다.
- `mpv-liveblocks-visibility.test.js`: 실제 표시·freeze 해제·DOM observer 함수를 JSDOM에서 실행한다. 수정 전 11건 중 3건 실패(정지 이미지 잔존, 동일 표시 요청의 상호 무효화, 이전 실패가 최신 표시를 취소). 수정 후 관련 HTML5 검사 포함 34 pass.
- `test:mpv` 482, `test:comment-input` 78, `test:comment-popout` 64, `test:ux` 84, `test:playlist` 377: 합계 1,085 pass. 각 exit 0 / fail 0 / cancelled 0 / skipped 0.
- 2.13.3-beta candidate `npm run build` exit 0, 생성 tracked diff 없음. 구문 검사와 `git diff --check` exit 0.
- 격리 프로필/생성 영상의 Electron 패키지에서 Chromium 키보드 입력으로 Enter → Space 검사. native host 표시 IPC 응답을 120ms 늦춰 같은 경합을 만들었다.
- 이전 2.13.2-beta 패키지: 첫 회에 `stale visibility request`, 영상 시간 진행 중 정지 이미지 잔존으로 실패(exit 1).
- 수정 2.13.3-beta 패키지: 6회 연속 재생 시간 진행 및 정지 이미지 제거, 페이지 오류 0, 복원 경고 0, exit 0.
- 초기 테스트 도구는 영상 로드 완료 전에 입력하여 실패했고, 로드 완료 이벤트 대기 및 실제 mpv 상태 필드 `time`을 사용하도록 고쳤다. 앱 종료 확인에 걸린 테스트 프로세스만 정리했으며 운영 앱은 보존했다.
- 근거: `C:\BAEframe\BAEFRAME\output\releases\2026-10-14-comment-submit-playback`의 테스트 로그, `baseline-2.13.2/result.json`, `candidate-2/result.json`.
- 실물 키보드/OS 한글 IME의 입력이나 사용자 작업 파일로 확인한 결과는 아니다.
