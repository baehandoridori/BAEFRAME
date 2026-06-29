# mpv 댓글/도구 오버레이 표시 안정화

## 요약

| 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|------|----------|------|---------|------|
| Phase 1 | `renderer/scripts/app.js` | mpv 재생 중 댓글 입력창, 드롭다운, 도구 팝업이 영상 뒤로 가려지지 않게 감지 범위 확장 | 높음 | 완료 |
| Phase 2 | `renderer/scripts/app.js` | 댓글 범위, 툴팁, 마커 같은 복제 오버레이 상태가 바뀔 때 mpv 오버레이를 자동 갱신 | 높음 | 완료 |
| Phase 3 | `scripts/tests/mpv-runtime-source.test.js` | 같은 유형의 가림 문제가 재발하지 않도록 source 테스트 보강 | 높음 | 완료 |

## 배경 및 목적

mpv 직접 재생 모드는 영상을 네이티브 창으로 띄우기 때문에 Chromium DOM UI가 영상 뒤로 가려질 수 있다.
기존에는 큰 모달과 일부 오버레이만 mpv 차단 대상으로 잡혀 있어, 댓글 입력창이나 도구 팝업처럼 영상 위에서 직접 조작하는 UI가 가려질 여지가 있었다.

## 구현 내용

- mpv host 숨김 대상에 댓글 입력창, 드롭 선택창, 드로잉 도구, 마커/하이라이트/레이어 팝업, 멘션/필터/설정 드롭다운 등을 추가했다.
- 단순히 UI가 열렸다는 이유만으로 영상을 숨기지 않고, 실제 영상 영역과 겹칠 때만 mpv host를 숨기도록 overlap 검사를 추가했다.
- 댓글 마커, 댓글 툴팁, 영상 하단 댓글 범위, 줌/전체화면/토스트/합성 레이어 오버레이는 DOM 변화가 생기면 mpv 투명 오버레이에 다시 복제되도록 MutationObserver를 추가했다.

## 리스크 및 우려 사항

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| 너무 많은 UI가 mpv host를 숨길 수 있음 | 중간 | 영상 영역과 실제로 겹치는 경우에만 숨기도록 제한 |
| DOM 변경 감시가 과하게 자주 실행될 수 있음 | 중간 | mpv 모드에서만 동작하고, 복제 대상 selector에 걸리는 변화만 반응 |
| 댓글 범위/툴팁 복제 타이밍이 늦을 수 있음 | 낮음 | 감지 시 `force` sync로 즉시 갱신 |

## 테스트 방법

- `node --test scripts/tests/mpv-runtime-source.test.js`
- `npm run test:mpv`
- `node --test scripts/tests/comment-input-focus-source.test.js`
- `npm run test:playlist`
- `npm run build`
