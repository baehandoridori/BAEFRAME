# Task 6b 보고서 — 좁은 화면 드로잉 툴바

## 결과

- 400px, 500px, 640px 폭에서 선택 모드의 11개 조작 버튼이 모두 한 툴바 안에 유지된다.
- 툴바는 최대 2줄로 줄바꿈되며, 버튼끼리 겹치거나 화면 밖으로 잘리지 않는다.
- 브러시 설정 패널은 줄바꿈된 툴바 아래에서 열리고 화면 높이를 넘으면 내부 스크롤된다.
- 툴바 DOM은 도구 변경과 viewport 갱신 뒤에도 하나만 유지된다.
- 저장 상태는 짧은 표시인 `자동 저장 · F프레임`을 사용하고, 전체 의미는 접근성 이름과 툴팁에 보존했다.
- mpv 영상 호스트의 오버플로, z-order, transform, BrowserWindow 크기 및 드로잉 좌표 의미는 바꾸지 않았다.

## RED 증거

구현 전에 아래 실패를 각각 확인했다.

1. runtime 계약: 툴바에 인라인 `gap: 6px`가 남아 CSS 반응형 간격을 덮었다.
2. host CSS 계약: 반응형 툴바 간격 토큰과 줄바꿈 규칙이 없었다.
3. 숨김 Chromium 실측: 400px에서 비필수 브러시 요약이 `block`으로 남아 compact 요구를 위반했다.

## 구현

- `main/mpv-overlay-host.js`
  - 한 DOM의 flex 툴바를 2줄까지 줄바꿈하도록 변경했다.
  - 640px 이하에서 간격, 패딩, 배지를 압축하고 비필수 브러시 요약을 숨겼다.
  - 모든 버튼의 최소 40×40px 조작 영역과 선택 그룹의 비축소 동작을 유지했다.
- `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
  - 인라인 간격을 제거해 host CSS가 화면 폭에 맞게 간격을 결정하도록 했다.
  - Brush, V, Undo, Redo, Delete, Clear, 설정 및 4개 선택 조작에 한국어 `aria-label`과 `title`을 추가했다.
  - 브러시 설정 패널을 실제 툴바 높이 아래에 배치하고 안전한 최대 높이와 내부 스크롤을 적용했다.
  - 저장 배지는 화면에는 짧게, 접근성 이름과 툴팁에는 전체 의미가 나오도록 분리했다.

## 검증

- `node --test scripts/tests/mpv-fabric-overlay-runtime.test.js`: 169/169 통과
- `node --test scripts/tests/mpv-overlay-host.test.js`: 67/67 통과
- 숨김 Electron Chromium 레이아웃 실측: 1/1 통과, 정상 종료 및 잔존 probe 프로세스 없음
- `npm run test:fabric-drawing-pilot`: 261/261 통과
- `npm run test:mpv`: 229/229 통과
- `npm run lint`: 오류 0, 기존 경고 59
- `git diff --check`: 통과

## 숨김 Chromium 검증 범위

- `BrowserWindow({ show: false })` 및 `host.setVisible(false)`로 화면을 띄우지 않았다.
- 사용자 마우스 커서를 조작하지 않았다.
- 400px, 500px, 640px에서 버튼 존재/가시성/포인터 입력/최소 크기/화면 내 포함/상호 비겹침을 실측했다.
- 설정 패널이 툴바 아래에서 열리고 root 안에 포함되는지 실측했다.
