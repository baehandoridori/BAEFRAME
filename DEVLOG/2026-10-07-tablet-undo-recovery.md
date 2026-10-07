# 타블렛 실행취소 후 드로잉 복구

## 요청과 계획

- B 드로잉 진입 → 펜 획 → Ctrl+Z → 새 펜 획이 그려지지 않는 현상을 수정하고 운영 공유 드라이브까지 배포한다.
- 기준: origin/main `21bc6cf`, 2.13.1-beta. 원래 main의 수정·미추적 파일을 보존하고 별도 worktree에서 작업한다.
- 재현 → 최소 수정 → 드로잉·오버레이 회귀 검사 → PR와 Codex 리뷰 → 정확한 merge SHA 빌드 → 백업·교체·전체 SHA-256 비교 순으로 진행한다.

## 원인 조사

- 펜/터치 이벤트의 modifier 누락을 보완하기 위해 오버레이가 Control keydown 상태를 기억한다.
- 호스트가 Ctrl+Z keydown을 before-input-event에서 preventDefault하면 Chromium은 뒤따르는 keyup을 누락한다. Ctrl 래치가 남아 다음 펜 획이 임시 지우개가 된다.
- 마우스는 포인터 이벤트로 래치를 지우지만 펜은 의도적으로 키보드 상태를 신뢰한다. 이 보완 기능을 유지하며 키 이벤트 전달 경계를 고친다.
- 기존 오버레이 런타임 기준 검사: exit 0, 418 pass / 0 fail / 0 cancelled / 0 skipped.

## 검증과 릴리스

- 실제 Chromium 키 입력 + 합성 pen 포인터로 재현 검사를 추가한다. 실제 타블렛 하드웨어·드라이버 실기는 별도 미확인 항목이다.
- 재현: 수정 전 실제 Chromium에서 첫 펜 획·undo는 성공했지만 `afterRelease.gestures.modifierCtrl`이 true로 남아 기대값 false와 불일치했다(exit 1). 수정 후 같은 검사가 통과했다(exit 0).
- 수정: `main/mpv-overlay-host.js`에서 검증된 Ctrl 조합(Alt/Meta 제외)의 keydown을 메인에 한 번 전달하면서 DOM까지 보존한다. 자동 반복은 재실행하지 않는다. `mpv-fabric-overlay-runtime.js`에서 기본 동작만 차단한다. 키 릴레이 입력 검증·IPC·저장 형식은 유지한다.
- 실제 Chromium 회귀 검사는 pen → Ctrl+Z → Control release → pen, Ctrl 지우개와 해제, Ctrl+Y/Ctrl+Shift+Z/Ctrl+C 후 pen, 키를 떼는 순서, 기존 Space 흐름을 확인한다. 포인터는 합성이고 키보드는 Electron sendInputEvent다.
- `npm run test:drawing`: exit 0, 366 pass / 0 fail / 0 cancelled / 0 skipped.
- `npm run test:fabric-drawing-pilot`: exit 0, 648 pass / 0 fail / 0 cancelled / 0 skipped.
- `npm run test:mpv`: exit 0, 477 pass / 0 fail / 0 cancelled / 0 skipped.
- 합계 1,491 pass. 번들 갱신 완료. 버전은 버그 수정 패치 2.13.2-beta로 올렸다.
- 실기 미확인: 사용자 타블렛·드라이버·네이티브 포인터 capture, 전체 앱에서 B 진입 및 사용자 파일 저장/재열기. 실행 중 사용자 앱을 종료하거나 개인 설정을 변경하지 않았다.
- PR/리뷰/머지/빌드/배포 근거는 별도 릴리스 감사 기록에 남긴다.

## Codex 1차 리뷰 반영

- PR #232, `996d2f5` 대상 지적 1건: 현재 기능표가 Space 외의 모든 키 누름을 삼킨다고 서술해 수정 코드와 모순이었다.
- `docs/drawing-keyframe-features.md`의 Ctrl 예외·history 중복 방지·펜 래치 해제와 검증 범위를 갱신했다. 제품 코드는 변경하지 않았다.
- 문서 링크와 코드의 조건을 대조하고 `git diff --check`를 통과했다. 제품 검증은 위 최종 코드의 1,491 pass 결과를 유지한다.

## Codex 2차 리뷰 반영

- `0b61e4a` 대상 P2 1건: Ctrl 조합을 DOM에 보존해도 개발 모드 앱 메뉴 accelerator는 별도 차단해야 한다.
- `main/window.js`의 개발 메뉴 유지와 [Electron 공식 문서](https://www.electronjs.org/docs/latest/api/web-contents/#contentssetignoremenushortcutsignore)를 대조했다. 오버레이 생성 시 `webContents.setIgnoreMenuShortcuts(true)`를 설정해 메인 창의 메뉴와 분리했다.
- 숨긴 창의 메뉴 실행 probe만으로는 메뉴 동작을 재현하지 못했으므로 이를 회귀 근거로 삼지 않았다. 대신 Electron API 경계 검사에서 수정 전 메뉴 차단 호출 누락(exit 1)을 확인하고, 수정 후 호출과 Ctrl 전달·키 보존을 검증했다.
- `npm run test:mpv`: exit 0, 478 pass / 0 fail / 0 cancelled / 0 skipped. 기존 366 drawing + 648 Fabric 결과와 합쳐 최종 관련 검사 1,492 pass. 메뉴 보완은 main 호스트만 변경했다.

## 병합 후 패키지 검증

- PR #232의 최종 SHA `fdf57a1`에 Codex가 명시적인 문제 없음 응답을 남겼고, 리뷰 스레드 2건을 해결한 뒤 `818410c`로 병합했다.
- 정확한 merge SHA의 깨끗한 체크아웃에서 `npm run build`가 exit 0으로 완료됐다.
- prebuild의 `bundle:editor-drawing`도 공용 런타임을 포함하므로 `editor-drawing.iife.js`에 동일한 Ctrl 기본 동작 차단 3줄 diff가 생성됐다. 배포 재현성을 위해 생성 결과를 별도 후속 커밋에 포함한다. 새 원본 로직·버전 변경은 없다.
- 패키지 ASAR의 버전 2.13.2-beta, stable 프로필, 호스트·원본 런타임·오버레이/편집창/preload 번들의 SHA가 빌드 입력과 일치한다.
- 패키지 내부 호스트·preload·오버레이 번들을 사용하는 숨김 Electron 재현 검사: exit 0, 1 pass / 0 fail / 0 cancelled / 0 skipped. 실제 타블렛 실기 확인으로 확대 해석하지 않는다.
