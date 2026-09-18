# 2026-09-18 댓글 C 단축키의 PC별 입력 차이 수정

## 요청과 조사

- 동일 배포본을 쓰는 특정 PC에서 C로 댓글 모드를 시작하지 못한다는 보고. 수정 및 배포까지 승인됨.
- 원본 main의 사용자 변경은 보존하고 origin/main d7ab666에서 별도 worktree로 작업한다. 기준 버전 2.12.3-beta.
- 메인 화면은 텍스트 입력 대상 밖에서 물리 키 code를 사용하지만, mpv 오버레이 호스트는 commentMode의 isComposing/Process 입력을 차단한다.
- 오버레이 전역 단축키의 포커스 우회 목록에 commentMode가 없어, 메인 화면에 남은 textarea 포커스에 C가 전달되어 무시될 수 있다.
- 해당 PC의 실제 입력 상태는 아직 확인하지 못했다. 재현 가능한 코드 결함과 현장 원인 확정을 구분한다.

## 계획과 범위

1. 호스트 입력 릴레이와 실제 renderer 핸들러의 회귀 테스트를 먼저 실행해 실패 확인.
2. 실제 댓글 단축키만 IME 조합 예외로 처리하고, 기존 IPC 검증은 유지. 댓글 단축키를 포커스 우회 목록에 추가.
3. 댓글 모드에서 길게 누른 키의 반복 토글 방지. 일반 텍스트 입력과 사용자 지정 키 조합 보존.
4. 관련 mpv/댓글/UX 검증, PR 및 Codex 리뷰, 정확한 merge SHA 빌드, 기존 공유드라이브 경로 교체 및 전체 해시 대조.

계정, 개인 설정, 댓글 데이터와 실행 중인 앱은 변경하지 않는다.

## 초기 검증

- 의존성 설치 후 mpv-overlay-host 117 pass / 0 fail / 0 cancelled, 종료 0.
- 키 릴레이/대상/댓글 입력 기준 검사 38 pass / 0 fail / 0 cancelled, 종료 0.
- 초기 의존성 없는 worktree의 host 실행은 electron 미설치로 실패했고, npm ci 후 위 기준 검사가 통과했다.
- Electron before-input-event의 key/code/isComposing 계약 확인: https://www.electronjs.org/docs/latest/api/web-contents
- 물리 키 code와 입력 언어의 구분 확인: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code

## 완료 근거

- 재현 테스트: 수정 전 123 tests / 119 pass / 4 fail / 0 cancelled, 종료 1. stale focus, 사용자 지정 chord, 키 반복, IME 호스트 릴레이가 각각 의도한 assertion으로 실패했다.
- 수정 후 같은 테스트 123 pass / 0 fail / 0 cancelled, 종료 0.
- 최종 관련 검사: `test:mpv` 399, `test:comment-input` 54, `test:comment-popout` 61, `test:ux` 85. 합계 599 pass / 0 fail / 0 cancelled, 모든 종료 코드 0.
- 수정 JS 구문 검사와 `git diff --check` 종료 0.
- 버전: 2.12.4-beta. main 호스트와 renderer 라우팅만 수정했으며 오버레이 런타임 원본 변경은 없다. npm ci 후 생성 번들 변경 없음.
- 실제 문제 PC의 IME 상태 및 최종 동작은 아직 미확인. 리뷰·merge·배포 증거는 별도 릴리스 기록에 남긴다.
- 패키지 실행 점검에서 document로 전달된 키를 하이라이트 단축키 listener가 Element로 가정해 `e.target.matches is not a function`을 발생시키는 것을 확인. 실제 listener를 연결한 테스트에서 2건 실패를 재현하고, optional method guard로 수정한다.
