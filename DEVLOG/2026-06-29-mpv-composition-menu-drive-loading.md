# mpv 합성 레이어 메뉴 및 Drive 로딩 피드백 수정

## 요약

| 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|------|----------|------|---------|------|
| Phase 1 | `renderer/scripts/modules/composition-layer-manager.js` | 합성 레이어 설정 메뉴가 패널 내부에 갇히지 않게 분리 | 높음 | 완료 |
| Phase 2 | `renderer/scripts/app.js` | mpv 재생 중 설정 메뉴와 Drive 로딩 상태를 화면에 안정적으로 표시 | 높음 | 완료 |
| Phase 3 | `scripts/tests/*` | 재발 방지용 source 테스트 추가 | 높음 | 완료 |

## 배경 및 목적

합성 레이어 설정 메뉴가 패널의 작은 영역 안에서 잘리거나, mpv 직접 재생 모드에서 native 영상 뒤로 가려질 수 있었다.
또 Google Drive 경로의 영상은 파일 확인과 재생 준비에 시간이 걸릴 수 있는데, 사용자에게 즉시 로딩 상태를 보여주는 피드백이 부족했다.

## 구현 내용

- 합성 레이어 설정 메뉴를 패널 리스트 내부가 아니라 `document.body`에 붙는 portal로 렌더링한다.
- mpv native host 표시 제어 조건에 `.composition-layer-context-menu`를 추가해 메뉴가 열릴 때 영상 뒤로 가려지지 않게 한다.
- Google Drive 경로 감지 시 `videoLoadingOverlay`에 `Google Drive에서 영상 불러오는 중...` 문구를 먼저 표시한다.
- Drive 로딩 표시와 썸네일 로딩 표시가 같은 오버레이를 공유하므로 `data-loading-kind`로 상태를 구분한다.

## 리스크 및 우려 사항

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| 포털 메뉴 이벤트가 기존 패널 이벤트와 달라질 수 있음 | 중간 | 메뉴 click, pointerdown, input, change 이벤트를 portal에도 연결 |
| mpv host가 메뉴 표시 중 과하게 숨을 수 있음 | 낮음 | 기존 blocking overlay 흐름에 selector만 추가 |
| Drive 로딩 표시가 썸네일 표시와 충돌할 수 있음 | 중간 | `data-loading-kind`로 Drive/thumbnail 상태 분리 |

## 테스트 방법

- `node --test scripts/tests/composition-layer-runtime-source.test.js`
- `npm run test:mpv`
- `npm run test:playlist`
- `npm run build`
