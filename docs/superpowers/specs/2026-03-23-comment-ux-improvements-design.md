# 댓글 UX 개선 설계 스펙

## 요약

| 항목 | 수정 파일 | 내용 | 우선순위 |
|------|----------|------|---------|
| 1. 경로 링크 공백 허용 | `renderer/scripts/app.js` | Stage 2b regex에서 공백 허용, 줄바꿈에서 끊기 | 높음 |
| 2. 경로 붙여넣기 자동 따옴표 | `renderer/scripts/app.js` | paste 이벤트에서 G:\ 패턴 감지 → 따옴표 감싸기 | 높음 |
| 3. 답글 후 확장 유지 | `renderer/scripts/app.js` | updateCommentList 시 확장 상태 보존 | 중간 |
| 4. 사용자 필터 UX 개선 | `renderer/scripts/app.js`, `renderer/styles/main.css` | 드롭다운 유지 + 솔로/토글 모드 + overflow 방지 | 중간 |

---

## 1. 경로 링크 - 공백 허용

### 배경
댓글에 `G:공유 드라이브\JBBJ 자료실\폴더` 같은 경로를 따옴표 없이 입력하면, 공백에서 잘려서 `G:공유`까지만 버튼으로 처리됨.

### 원인
`renderGDriveLinks()` (app.js:5410-5452)의 Stage 2b regex:
```regex
/(G:[/\\](?:[^\s<"'&\x00]|&[^q#]|&q[^u]|&#[^3]|<\/?mark[^>]*>)+)/gi
```
문자 클래스 `[^\s<"'&\x00]`에서 `\s`가 공백을 제외함.

### 수정
Stage 2b regex의 `\s`를 `\n\r`로 변경하여 공백은 허용하되 줄바꿈에서 끊기:
```regex
/(G:[/\\](?:[^\n\r<"'&\x00]|&[^q#]|&q[^u]|&#[^3]|<\/?mark[^>]*>)+)/gi
```

매치된 경로의 trailing whitespace는 trim 처리.

### 사용 패턴
사용자들은 경로를 줄바꿈으로 구분하여 단독 입력:
```
G:\공유 드라이브\사우스 코리안 파크\232_친모1\출력\B파트 한솔전달용
파일 전달드립니다!
```

### 알려진 한계
같은 줄에 경로와 텍스트가 섞인 경우 (예: `G:\공유 드라이브\폴더 여기 확인`) 텍스트까지 경로로 인식될 수 있음. 사용자 패턴상 경로는 항상 단독 줄에 입력되고, Section 2의 자동 따옴표가 이를 이중으로 방지하므로 허용 가능한 트레이드오프.

---

## 2. 경로 붙여넣기 - 자동 따옴표 감싸기

### 배경
경로는 대부분 클립보드에서 붙여넣기로 입력됨. 붙여넣기 시 자동으로 따옴표를 감싸면 Stage 1(따옴표 경로)에서 정확히 처리 가능.

### 구현
댓글 입력 textarea/input에 `paste` 이벤트 리스너 추가:
1. `event.clipboardData.getData('text')` 확인
2. 이미지 데이터가 있으면 무시 (기존 이미지 paste 핸들러 우선)
3. `G:\` 또는 `G:/`로 시작하는 텍스트인지 검사
4. 이미 따옴표로 감싸져 있으면 무시
5. 감싸져 있지 않으면 **첫 줄(경로)만** 따옴표로 감싸고 나머지 줄은 그대로 유지
6. `event.preventDefault()`로 기본 붙여넣기 차단

### 기존 paste 핸들러와의 공존
- `commentInput` (app.js:1259)과 `threadEditor` (app.js:7789)에 이미 이미지 paste 핸들러 존재
- 새 로직을 기존 핸들러 **내부에 통합**: 이미지가 아닌 텍스트 paste일 때만 경로 감지 분기
- 별도 리스너를 추가하지 않아 순서/충돌 문제 방지

### 대상 입력 요소
- 댓글 작성 textarea (`#commentInput` 또는 동적 생성 요소)
- 답글 작성 입력 (스레드 팝업 내)
- 동적 생성되는 `.comment-reply-input`: 이벤트 위임 사용 (댓글 패널 컨테이너에 paste 이벤트 위임)

### 경로 판별 조건
```javascript
/^[A-Z]:[/\\]/.test(text.trim())
```
- 드라이브 문자 + `:` + 경로 구분자로 시작하는 텍스트
- 여러 줄 paste 시 첫 줄만 따옴표 감싸기 (설명 텍스트가 따옴표 안에 포함되는 것 방지)

---

## 3. 답글 후 확장 상태 유지

### 배경
답글 작성 후 `replyAdded`/`markersChanged` 이벤트 → `updateCommentList()` → 전체 HTML 재생성 → 확장 상태 소실.

### 원인
`updateCommentListImmediate()` (app.js:4889-5283)가 innerHTML을 완전히 재생성하면서 `.expanded` 클래스 정보를 보존하지 않음.

### 수정
`updateCommentListImmediate()` 시작부에서 현재 확장된 댓글 ID를 수집:
```javascript
const expandedIds = new Set(
  [...container.querySelectorAll('.comment-thread-toggle.expanded')]
    .map(el => el.dataset.markerId)
);
```

HTML 렌더링 시 해당 ID의 toggle/replies에 `expanded` 클래스 부여:
```javascript
const isExpanded = expandedIds.has(marker.id);
// thread toggle: class="comment-thread-toggle${isExpanded ? ' expanded' : ''}"
// replies container: class="comment-replies${isExpanded ? ' expanded' : ''}"
```

또한 `container.scrollTop`을 재렌더링 전에 저장하고, 렌더링 후 복원하여 스크롤 위치도 보존.

---

## 4. 사용자 필터 드롭다운 UX 개선

### 4-1. 드롭다운 닫힘 방지

**현재 동작**: 항목 클릭 시 드롭다운이 닫힘.
**수정**: 항목 클릭 시 드롭다운 유지. 닫기는 다음 경우에만:
- 드롭다운 바깥 클릭
- 버튼 재클릭
- mouseleave 300ms 타이머 (기존 동작 유지)

### 4-2. 듀얼 인터랙션: 체크박스 토글 + 솔로 모드

**기본 상태**: 전원 체크됨 (`commentFilterState.authors = null`)

**체크박스 클릭** (개별 토글):
- 해당 사용자만 on/off 토글
- 여러 명 조합 가능
- 전원 체크되면 `authors = null`로 리셋

**이름 텍스트 클릭** (솔로 모드):
- 해당 사용자만 체크, 나머지 해제
- 이미 솔로 상태에서 같은 이름 클릭 → 전체 복원 (`authors = null`)

**구현**:
- `updateAuthorFilterMenu()`에서 작성자 이름을 `<span class="filter-dropdown-name">` 요소로 감싸기 (현재는 bare text)
- `.filter-dropdown-check` 클릭 → 체크박스 토글 로직
- `.filter-dropdown-name` 클릭 → 솔로 로직
- 이벤트 위임으로 클릭 대상 구분 (`.filter-dropdown-item`에 단일 리스너, `e.target.closest()`로 분기)
- 메뉴 내부 클릭 시 `e.stopPropagation()` 추가 (document click 핸들러가 닫지 않도록)

**솔로 모드 감지 알고리즘**:
```javascript
const isSolo = (
  commentFilterState.authors !== null &&
  commentFilterState.authors.length === 1 &&
  commentFilterState.authors[0] === clickedAuthorId
);
if (isSolo) {
  commentFilterState.authors = null; // 전체 복원
} else {
  commentFilterState.authors = [clickedAuthorId]; // 솔로 진입
}
```

**UI 힌트**:
- 이름 hover 시 "솔로" 텍스트 표시 (opacity 전환)
- 하단에 `☑ 체크박스 = 토글 | 👤 이름 = 솔로` 안내

### 4-3. 드롭다운 overflow 방지

드롭다운이 뷰포트 밖으로 나가지 않도록 위치 보정:

**열릴 때** 위치 계산:
```javascript
const rect = menu.getBoundingClientRect();
const viewportH = window.innerHeight;
const viewportW = window.innerWidth;

// 하단 넘침 → 위로 열기
if (rect.bottom > viewportH) {
  menu.style.top = 'auto';
  menu.style.bottom = 'calc(100% + 4px)';
}

// 우측 넘침 → 왼쪽 정렬
if (rect.right > viewportW) {
  menu.style.left = 'auto';
  menu.style.right = '0';
}
```

메뉴에 `.open` 클래스 추가 후 `requestAnimationFrame()`으로 레이아웃이 확정된 뒤 위치를 계산하여 보정. (CSS transition 중 측정 오류 방지)

---

## 수정 대상 파일 요약

| 파일 | 수정 내용 |
|------|----------|
| `renderer/scripts/app.js:5440` | Stage 2b regex 공백 허용 |
| `renderer/scripts/app.js` (댓글 입력) | paste 이벤트 핸들러 추가 |
| `renderer/scripts/app.js:4889-5283` | 확장 상태 보존 로직 |
| `renderer/scripts/app.js:1493-1643` | 필터 드롭다운 솔로/토글 분리, 닫힘 방지 |
| `renderer/scripts/app.js:1561-1571` | 드롭다운 열기 시 overflow 위치 보정 |
| `renderer/styles/main.css:3647+` | 솔로 힌트 스타일, 인터랙션 힌트 |

---

## 시안 참조

`docs/superpowers/mockups/filter-mockup.html` - 필터 드롭다운 3가지 상태 비교

---

## 범위

- **포함**: Desktop 앱 (`renderer/`) 전체
- **제외**: Web Viewer (`web-viewer/`) - `renderGDriveLinks` 함수가 web-viewer에는 없음

---

## 수동 테스트 항목

| # | 테스트 | 예상 결과 |
|---|--------|----------|
| 1 | 따옴표 없이 공백 포함 경로 입력 후 줄바꿈 | 전체 경로가 하나의 버튼으로 표시 |
| 2 | 경로 붙여넣기 (클립보드) | 자동 따옴표 감싸기 |
| 3 | 이미 따옴표 있는 경로 붙여넣기 | 중복 따옴표 없이 정상 처리 |
| 4 | 이미지 붙여넣기 | 기존 이미지 paste 동작 유지 |
| 5 | 답글 작성 후 스레드 확장 상태 | 확장 유지, 스크롤 위치 유지 |
| 6 | 필터 체크박스 클릭 | 드롭다운 열린 채로 해당 사용자 토글 |
| 7 | 필터 이름 클릭 (솔로) | 해당 사용자만 표시, 다시 클릭 시 전체 복원 |
| 8 | 화면 하단 근처에서 필터 드롭다운 열기 | 위로 열림 (overflow 방지) |
