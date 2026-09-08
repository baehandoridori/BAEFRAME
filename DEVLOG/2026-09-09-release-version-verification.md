# 2.11.1-beta 릴리스 버전 검사 정리

PR #220의 머지 커밋 `6c88030ed5f40a76b973bc7d00911ca91989a3f7`에서 빌드와 최종 검증을 수행했다. 실행 파일 FileVersion은 `2.11.1-beta`, ProductVersion은 `2.11.1.0`, ASAR 내부 앱과 package/lock 버전은 `2.11.1-beta`로 일치했다. 필수 파일 11개, 소스와 패키지 핵심 파일 6개, 기존 vendor 파일 6개의 검증도 통과했다.

최종 `test:mpv`는 379 pass / 1 fail / 0 cancelled, 종료 코드 1이었다. 실패는 `runtime-profile.test.js`가 이전 릴리스 번호 `2.11.0-beta`를 고정해서 비교하는 한 줄이었다. 이 검사를 현재 beta 버전 형식과 package/lock의 세 버전 일치 검사로 변경한다. 특정 과거 번호 때문에 정상적인 다음 릴리스가 실패하지 않게 하면서 버전 불일치 검사는 유지한다. 배포 앱의 제품 코드는 바꾸지 않는다.

같은 머지 커밋의 다른 최종 검증은 `test:playback-buffering` 70, `test:playlist` 330, `test:composition` 60, `test:frame-grid` 38 pass이며 모두 fail/cancelled 0, 종료 코드 0이었다. 후속 검사 수정이 반영된 새 머지 커밋에서 최종 빌드와 배포 검증을 이어간다.

수정 후 `node --test scripts/tests/runtime-profile.test.js`: 7 pass / 0 fail / 0 cancelled, 종료 코드 0. `git diff --check` 통과.
