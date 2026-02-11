# 마커 색상 변경 및 UI 개선 개발 계획

## 요약

| 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|------|----------|------|---------|------|
| Phase 1 | main.css | 버튼 텍스트 깨짐 수정 | 높음 | ✅ 완료 |
| Phase 2 | comment-manager.js | MARKER_COLORS 상수 정의 | 높음 | ✅ 완료 |
| Phase 3 | index.html, main.css | 마커 색상 팝업 UI 추가 | 높음 | ✅ 완료 |
| Phase 4 | app.js | 마커 우클릭 색상 변경 로직 | 높음 | ✅ 완료 |
| Phase 5 | comment-manager.js, timeline.js | 타임라인 색상 연동 | 중간 | ✅ 완료 |
| Phase 6 | app.js | 댓글 오버레이 색상 연동 | 중간 | ✅ 완료 |
| Phase 7 | index.html, main.css, app.js | 피드백 완료율 프로그레스 바 | 중간 | ✅ 완료 |

## 배경 및 목적

1. **버튼 텍스트 깨짐 문제**: 창 크기에 따라 버튼 텍스트가 세로로 쓰여지거나 깨지는 현상
2. **마커 색상 커스터마이징**: 하이라이트처럼 마커도 우클릭으로 색상 변경 가능하도록
3. **색상 일관성**: 타임라인 댓글 표기 및 비디오 오버레이가 마커의 개별 색상을 따라가도록
4. **진행 상황 시각화**: 피드백 완료율을 프로그레스 바로 표시

## Phase 1: 버튼 텍스트 깨짐 수정

### 목표
창 크기에 관계없이 버튼 텍스트가 깨지지 않도록 CSS 수정

### 수정 파일
- `renderer/styles/main.css`

### 구현 내용
- `.filter-chip`, `.comment-submit`, `.settings-dropdown-btn` 등에 `white-space: nowrap` 추가
- `flex-shrink: 0` 설정으로 버튼 크기 고정
- 필요시 `min-width` 설정

## Phase 2: 마커 색상 상수 정의

### 목표
마커 전용 색상 팔레트 정의

### 수정 파일
- `renderer/scripts/modules/comment-manager.js`

### 구현 내용
```javascript
export const MARKER_COLORS = {
  default: { name: '기본', color: '#4a9eff', bgColor: 'rgba(74, 158, 255, 0.3)' },
  yellow: { name: '노랑', color: '#ffdd59', bgColor: 'rgba(255, 221, 89, 0.3)' },
  red: { name: '빨강', color: '#ff5555', bgColor: 'rgba(255, 85, 85, 0.3)' },
  pink: { name: '핑크', color: '#ff6b9d', bgColor: 'rgba(255, 107, 157, 0.3)' },
  green: { name: '초록', color: '#2ed573', bgColor: 'rgba(46, 213, 115, 0.3)' },
  gray: { name: '회색', color: '#a0a0a0', bgColor: 'rgba(160, 160, 160, 0.3)' },
  white: { name: '흰색', color: '#ffffff', bgColor: 'rgba(255, 255, 255, 0.3)' }
};
```

### CommentMarker 클래스 수정
- `colorKey` 속성 추가 (기본값: 'default')
- `colorInfo` getter 추가
- `toJSON()`/`fromJSON()` 메서드에 colorKey 포함

## Phase 3: 마커 색상 팝업 UI

### 목표
하이라이트 팝업과 유사한 마커 색상 선택 팝업 추가

### 수정 파일
- `renderer/index.html`
- `renderer/styles/main.css`

### 구현 내용
- `#markerPopup` HTML 요소 추가
- `.marker-popup`, `.marker-color-btn` CSS 스타일 추가

## Phase 4: 마커 우클릭 색상 변경 로직

### 목표
마커(타임라인 댓글 범위, 비디오 오버레이 바) 우클릭 시 색상 변경 팝업 표시

### 수정 파일
- `renderer/scripts/app.js`

### 구현 내용
- `showMarkerPopup()` 함수 추가
- 댓글 범위 아이템 우클릭 이벤트 핸들러 추가
- 색상 선택 시 마커 업데이트 및 UI 갱신

## Phase 5: 타임라인 색상 연동

### 목표
타임라인 댓글 표기 색상이 마커의 개별 색상을 따라가도록

### 수정 파일
- `renderer/scripts/modules/comment-manager.js` (getMarkerRanges)
- `renderer/scripts/modules/timeline.js` (_createCommentRangeElement)

### 구현 내용
- `getMarkerRanges()`에서 레이어 색상 대신 마커 개별 색상 반환
- `_createCommentRangeElement()`에서 마커 색상 사용

## Phase 6: 댓글 오버레이 색상 연동

### 목표
비디오 위 댓글 오버레이 바가 마커 색상을 따라가도록

### 수정 파일
- `renderer/scripts/app.js` (renderVideoCommentRanges)

### 구현 내용
- 바 생성 시 마커 개별 색상 적용

## Phase 7: 피드백 완료율 프로그레스 바

### 목표
댓글 창 상단에 피드백 완료율 표시

### 수정 파일
- `renderer/index.html`
- `renderer/styles/main.css`
- `renderer/scripts/app.js`

### 구현 내용
- `.feedback-progress` 컨테이너 추가 (filter-bar 위)
- 프로그레스 바 + 퍼센트 텍스트
- 마커 변경 시 완료율 자동 계산 및 업데이트

## 리스크 및 우려 사항

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| .bframe 파일 호환성 | 중간 | colorKey 미존재 시 기본값('default') 사용 |
| 기존 마커 색상 변경 | 낮음 | 기존 레이어 색상 유지, 새 마커만 개별 색상 적용 |

## 테스트 방법

1. 창 크기를 다양하게 조절하며 버튼 텍스트 확인
2. 마커 우클릭 → 색상 변경 → 타임라인/오버레이 색상 확인
3. 기존 .bframe 파일 로드 시 정상 동작 확인
4. 마커 해결/미해결 토글 → 완료율 업데이트 확인
