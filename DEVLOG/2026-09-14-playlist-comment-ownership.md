# 재생목록 댓글 저장 대상 혼선 수정

## 요청과 원인

1번 영상에 첫 댓글을 남긴 직후 2번을 선택하면 2번에도 댓글이 있는 것처럼 표시된다.
`saved` 처리기가 저장 당시 영상 대신 현재 선택 항목에 새 `.bframe` 경로를 연결했다.
선택 표시는 영상 로드/이전 리뷰 저장 완료보다 먼저 바뀌므로 정상적인 빠른 이동으로도 발생한다.

## 수정

- `ReviewDataManager.save()`의 완료 이벤트에 이미 캡처한 `saveOwner.videoPath`를 전달한다.
- `app.js`는 해당 영상의 항목만 찾아 최초 리뷰 경로를 연결하고 댓글을 갱신한다.
- 경로만 가진 구형 이벤트는 이미 연결된 항목만 갱신한다. 선택 항목을 추측하지 않는다.
- 기존 명시적 리뷰 연결은 보존한다. 비동기 갱신 중 재생목록이 교체되면 이전 항목 갱신을 중단한다.
- 실제 사용자 리뷰/재생목록을 임의 수정하거나 기존 잘못된 연결을 일괄 복구하지 않는다.
- 별도 origin/main 기반 worktree 사용. 기존 dirty checkout과 실행 중 사용자 앱 보존.

## 검증

- 수정 전: 재현 테스트 2개 모두 assertion 실패(2번에 1번 리뷰 연결, saved 이벤트 영상 정보 누락).
- 수정 후: 1/2/3번 댓글 수 `[1, 0, 0]`, 외부 영상/구형 이벤트/명시적 연결/재생목록 교체 검사 통과.
- `npm run test:playlist`: exit 0, pass 375 / fail 0 / cancelled 0.
- `npm run test:fabric-drawing-persistence`: exit 0, pass 167 / fail 0 / cancelled 0.
- 변경 JS ESLint `--no-ignore`: exit 0, errors 0, 기존 unused 경고 17. `git diff --check` 통과.
- 초기 전체 검사 실패는 새 worktree의 jsdom/Electron 미설치 때문이었으며 의존성 설치 후 통과.

## 릴리스

2.12.1-beta 패치 릴리스. PR 리뷰, 최종 머지 빌드, 실제 앱 및 공유드라이브 검증 결과는
작업 worktree의 `.local/playlist-comment-ownership/`에 별도 기록한다.
실물 태블릿 및 다른 사용자 PC 동기화는 이 변경의 검증 결과에 포함하지 않는다.
