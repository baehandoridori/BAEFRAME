# 댓글 UX 개선 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 댓글 경로 링크 공백 허용, 붙여넣기 자동 따옴표, 답글 후 확장 유지, 사용자 필터 UX 개선

**Architecture:** `renderer/scripts/app.js`의 4개 독립 영역을 수정. 경로 렌더링(regex), 입력 이벤트(paste), 댓글 목록 렌더링(확장 보존), 필터 드롭다운(솔로/토글 + overflow). CSS는 필터 관련 스타일만 추가.

**Tech Stack:** Vanilla JS, CSS, Electron renderer process

**Spec:** `docs/superpowers/specs/2026-03-23-comment-ux-improvements-design.md`

---

## Chunk 1: 경로 링크 공백 허용 + 붙여넣기 자동 따옴표

### Task 1: Stage 2b regex 공백 허용

**Files:**
- Modify: `renderer/scripts/app.js:5438-5444`

- [ ] **Step 1: Stage 2b regex 수정 — `\s`를 `\n\r`로 변경**

`renderer/scripts/app.js:5440`에서 현재 regex:
```javascript
html = html.replace(/(G:[/\\](?:[^\s<"'&\x00]|&[^q#]|&q[^u]|&#[^3]|<\/?mark[^>]*>)+)/gi, (match) => {
```

수정:
```javascript
html = html.replace(/(G:[/\\](?:[^\n\r<"'&\x00]|&[^q#]|&q[^u]|&#[^3]|<\/?mark[^>]*>)+)/gi, (match) => {
```

- [ ] **Step 2: 매치 결과 trailing whitespace trim 추가**

같은 콜백 내부에서 `match`를 trim 처리. `app.js:5440-5444`를 다음으로 교체:
```javascript
html = html.replace(/(G:[/\\](?:[^\n\r<"'&\x00]|&[^q#]|&q[^u]|&#[^3]|<\/?mark[^>]*>)+)/gi, (match) => {
  if (match.includes('gdrive-link-btn')) return match;
  const trimmed = match.replace(/\s+$/, '');
  return makeBtn(trimmed, trimmed);
});
```

- [ ] **Step 3: 커밋**

```bash
git add renderer/scripts/app.js
git commit -m "fix: 경로 링크 regex에서 공백 허용 (줄바꿈에서 끊기)"
```

---

### Task 2: 붙여넣기 시 자동 따옴표 감싸기

**Files:**
- Modify: `renderer/scripts/app.js:1259-1266` (commentInput paste 핸들러)
- Modify: `renderer/scripts/app.js:7789-7796` (threadEditor paste 핸들러)

경로 감지 유틸 함수를 먼저 정의하고, 기존 paste 핸들러에 통합한다.

- [ ] **Step 1: 경로 paste 처리 헬퍼 함수 작성**

`renderGDriveLinks()` 함수 바로 위 (app.js:5410 부근)에 헬퍼 함수 추가:
```javascript
/**
 * paste 이벤트에서 드라이브 경로를 감지하여 첫 줄에 따옴표를 감싸는 헬퍼.
 * 이미지 paste가 아닌 텍스트 paste에서만 동작.
 * @returns {boolean} 경로가 감지되어 처리된 경우 true
 */
function handleDrivePathPaste(e) {
  // 이미지 데이터가 있으면 무시 (기존 이미지 paste 우선)
  if (e.clipboardData?.files?.length > 0) return false;
  if (e.clipboardData?.types?.includes('image/png')) return false;

  const text = e.clipboardData?.getData('text');
  if (!text) return false;

  const trimmed = text.trim();
  // 드라이브 경로 패턴: C:\ D:\ G:/ 등
  if (!/^[A-Z]:[/\\]/i.test(trimmed)) return false;

  // 이미 따옴표로 감싸져 있으면 무시
  if (/^["']/.test(trimmed) && /["']$/.test(trimmed)) return false;

  e.preventDefault();

  const target = e.target;
  const lines = text.split('\n');
  // 첫 줄(경로)만 따옴표 감싸기, 나머지 줄은 그대로
  lines[0] = `"${lines[0].trim()}"`;
  const result = lines.join('\n');

  // textarea/input에 삽입
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const value = target.value;
  target.value = value.slice(0, start) + result + value.slice(end);
  target.selectionStart = target.selectionEnd = start + result.length;

  // input 이벤트 트리거 (auto-resize 등)
  target.dispatchEvent(new Event('input', { bubbles: true }));

  return true;
}
```

- [ ] **Step 2: commentInput paste 핸들러에 통합**

`app.js:1259-1266`을 수정. 기존 이미지 paste 로직 앞에 경로 감지 추가:
```javascript
elements.commentInput.addEventListener('paste', async (e) => {
  // 드라이브 경로 자동 따옴표
  if (handleDrivePathPaste(e)) return;

  const imageData = await getImageFromClipboard(e);
  if (imageData) {
    e.preventDefault();
    showCommentImagePreview(imageData);
    showToast('이미지가 첨부되었습니다', 'success');
  }
});
```

- [ ] **Step 3: threadEditor paste 핸들러에 통합**

`app.js:7789-7796`을 수정:
```javascript
threadEditor?.addEventListener('paste', async (e) => {
  // 드라이브 경로 자동 따옴표
  if (handleDrivePathPaste(e)) return;

  const imageData = await getImageFromClipboard(e);
  if (imageData) {
    e.preventDefault();
    showThreadImagePreview(imageData);
    showToast('이미지가 첨부되었습니다', 'success');
  }
});
```

- [ ] **Step 4: 동적 reply-input에 이벤트 위임 추가**

댓글 패널 컨테이너에 paste 이벤트 위임 추가. `app.js`에서 기존 댓글 목록 이벤트 바인딩 후(약 5283줄 이후 근처), 혹은 초기화 영역에 다음 추가:

```javascript
// 동적 답글 입력의 경로 paste 처리 (이벤트 위임)
elements.commentsList?.addEventListener('paste', (e) => {
  if (e.target.closest('.comment-reply-input')) {
    handleDrivePathPaste(e);
  }
});
```

**주의**: 이 위임 리스너는 한 번만 등록하면 되므로 `updateCommentListImmediate()` 바깥의 초기화 영역에 둔다. `elements.commentsList`를 참조하는 초기화 코드 근처(app.js:1259 이미지 paste 핸들러 바로 뒤)에 배치.

- [ ] **Step 5: 커밋**

```bash
git add renderer/scripts/app.js
git commit -m "feat: 댓글에 드라이브 경로 붙여넣기 시 자동 따옴표 감싸기"
```

---

## Chunk 2: 답글 후 확장 상태 유지

### Task 3: 확장 상태 및 스크롤 보존

**Files:**
- Modify: `renderer/scripts/app.js:4889-4891` (updateCommentListImmediate 시작부)
- Modify: `renderer/scripts/app.js:5024-5036` (스레드 토글/답글 HTML 템플릿)

- [ ] **Step 1: 확장 ID 수집 + 스크롤 위치 저장**

`updateCommentListImmediate()` 함수 시작부 (app.js:4891 `if (!container) return;` 바로 뒤)에 추가:

```javascript
// 확장 상태 및 스크롤 위치 보존
const expandedIds = new Set(
  [...container.querySelectorAll('.comment-thread-toggle.expanded')]
    .map(el => el.dataset.markerId)
);
const savedScrollTop = container.scrollTop;
```

- [ ] **Step 2: HTML 템플릿에 확장 상태 반영**

`app.js:5024-5029` 스레드 토글 버튼 부분을 수정:
```javascript
${replyCount > 0 ? `
<button class="comment-thread-toggle${expandedIds.has(marker.id) ? ' expanded' : ''}" data-marker-id="${marker.id}">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
  답글 ${replyCount}개
</button>
` : ''}
```

`app.js:5030` 답글 컨테이너 부분을 수정:
```javascript
<div class="comment-replies${expandedIds.has(marker.id) ? ' expanded' : ''}" data-marker-id="${marker.id}">
```

- [ ] **Step 3: 스크롤 위치 복원**

`updateCommentListImmediate()` 함수 맨 마지막 (app.js:5283 `});` 바로 뒤, 함수 닫기 전)에 추가:

```javascript
// 스크롤 위치 복원
container.scrollTop = savedScrollTop;
```

- [ ] **Step 4: 커밋**

```bash
git add renderer/scripts/app.js
git commit -m "fix: 답글 작성 후 스레드 확장 상태 및 스크롤 위치 유지"
```

---

## Chunk 3: 사용자 필터 드롭다운 UX 개선

### Task 4: 드롭다운 HTML 구조 변경 + 솔로/토글 로직

**Files:**
- Modify: `renderer/scripts/app.js:1493-1532` (updateAuthorFilterMenu)
- Modify: `renderer/scripts/app.js:1601-1643` (필터 클릭 핸들러)

- [ ] **Step 1: updateAuthorFilterMenu() 리팩토링 — 이름을 span으로 감싸기 + 솔로 힌트 + 안내 텍스트 추가**

`app.js:1511-1531` 전체를 다음으로 교체:

```javascript
let html = '';
for (const [authorId, info] of authors) {
  const color = getAuthorColor(authorId);
  const isChecked = selectedAll || commentFilterState.authors.includes(authorId);
  html += `
    <div class="filter-dropdown-item" data-author-id="${escapeHtml(authorId)}">
      <div class="filter-dropdown-check ${isChecked ? 'checked' : ''}">${isChecked ? '✓' : ''}</div>
      <div class="filter-dropdown-dot" style="background: ${color.color}"></div>
      <span class="filter-dropdown-name">${escapeHtml(info.name)}</span>
      <span class="filter-dropdown-solo-hint">솔로</span>
      <span class="filter-dropdown-badge">${info.count}</span>
    </div>`;
}

html += '<div class="filter-dropdown-divider"></div>';
html += `
  <div class="filter-dropdown-item" data-author-id="__all__">
    <div class="filter-dropdown-check ${selectedAll ? 'checked' : ''}">${selectedAll ? '✓' : ''}</div>
    <span class="filter-dropdown-name">전체 선택/해제</span>
  </div>`;
html += `<div class="filter-dropdown-hint">☑ 체크박스 = 토글 &nbsp; 👤 이름 = 솔로</div>`;

menu.innerHTML = html;
```

- [ ] **Step 2: 클릭 핸들러 리팩토링 — 체크박스/이름 분리 + 드롭다운 유지 + stopPropagation**

`app.js:1601-1643` 전체를 다음으로 교체:

```javascript
// 작성자 선택/해제 (체크박스 토글 + 이름 솔로)
document.getElementById('authorFilterMenu')?.addEventListener('click', (e) => {
  e.stopPropagation(); // 드롭다운 닫힘 방지

  const item = e.target.closest('.filter-dropdown-item');
  if (!item) return;

  const authorId = item.dataset.authorId;
  const clickedName = e.target.closest('.filter-dropdown-name');
  const clickedCheck = e.target.closest('.filter-dropdown-check');

  // 전체 선택/해제
  if (authorId === '__all__') {
    commentFilterState.authors = commentFilterState.authors === null ? [] : null;
  }
  // 이름 클릭 → 솔로 모드
  else if (clickedName) {
    const isSolo = (
      commentFilterState.authors !== null &&
      commentFilterState.authors.length === 1 &&
      commentFilterState.authors[0] === authorId
    );
    commentFilterState.authors = isSolo ? null : [authorId];
  }
  // 체크박스 클릭 → 개별 토글
  else {
    if (commentFilterState.authors === null) {
      // 전체 선택 → 이 작성자만 해제
      const allMarkers = commentManager.getAllMarkers();
      const uniqueAuthors = new Set(
        allMarkers.filter(m => !m.deleted).map(m => m.authorId || m.author || 'unknown')
      );
      commentFilterState.authors = [...uniqueAuthors].filter(id => id !== authorId);
    } else {
      const idx = commentFilterState.authors.indexOf(authorId);
      if (idx !== -1) {
        commentFilterState.authors.splice(idx, 1);
      } else {
        commentFilterState.authors.push(authorId);
      }
      // 모든 작성자가 선택되면 null(전체)로 리셋
      const allMarkers = commentManager.getAllMarkers();
      const uniqueAuthors = new Set(
        allMarkers.filter(m => !m.deleted).map(m => m.authorId || m.author || 'unknown')
      );
      if (commentFilterState.authors.length >= uniqueAuthors.size) {
        commentFilterState.authors = null;
      }
    }
  }

  updateAuthorFilterMenu();
  applyCommentFilters();

  const btn = document.getElementById('authorFilterBtn');
  if (btn) {
    btn.classList.toggle('active', commentFilterState.authors !== null);
  }
});
```

- [ ] **Step 3: 커밋**

```bash
git add renderer/scripts/app.js
git commit -m "feat: 사용자 필터 드롭다운 솔로/토글 듀얼 인터랙션 구현"
```

---

### Task 5: 드롭다운 overflow 방지 + CSS 스타일

**Files:**
- Modify: `renderer/scripts/app.js:1561-1571` (드롭다운 열기 로직)
- Modify: `renderer/styles/main.css:3699` 이후 (새 스타일 추가)

- [ ] **Step 1: 드롭다운 열기 시 overflow 위치 보정**

`app.js:1561-1571`을 다음으로 교체:

```javascript
document.getElementById('authorFilterBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('authorFilterMenu');
  const isOpen = menu.classList.contains('open');
  if (isOpen) {
    menu.classList.remove('open');
    // 위치 리셋
    menu.style.top = '';
    menu.style.bottom = '';
    menu.style.left = '';
    menu.style.right = '';
  } else {
    updateAuthorFilterMenu();
    // 위치 리셋 후 열기
    menu.style.top = '';
    menu.style.bottom = '';
    menu.style.left = '';
    menu.style.right = '';
    menu.classList.add('open');

    // 레이아웃 확정 후 overflow 보정
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.bottom > window.innerHeight) {
        menu.style.top = 'auto';
        menu.style.bottom = 'calc(100% + 4px)';
      }
      if (rect.right > window.innerWidth) {
        menu.style.left = 'auto';
        menu.style.right = '0';
      }
    });
  }
});
```

- [ ] **Step 2: CSS 스타일 추가 — 솔로 힌트, 인터랙션 힌트**

`renderer/styles/main.css`에서 `.filter-dropdown-badge` (line 3699) 바로 뒤에 다음 추가:

```css
.filter-dropdown-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.filter-dropdown-name:hover {
  text-decoration: underline;
}

.filter-dropdown-solo-hint {
  font-size: 9px;
  color: var(--accent-primary);
  opacity: 0;
  transition: opacity var(--transition-fast);
  margin-left: -4px;
}

.filter-dropdown-item:hover .filter-dropdown-solo-hint {
  opacity: 0.7;
}

.filter-dropdown-hint {
  padding: 4px 10px 6px;
  font-size: 10px;
  color: var(--text-tertiary);
  border-top: 1px solid var(--border-subtle);
  margin-top: 2px;
}
```

- [ ] **Step 3: 커밋**

```bash
git add renderer/scripts/app.js renderer/styles/main.css
git commit -m "feat: 필터 드롭다운 overflow 방지 + 솔로 힌트 스타일 추가"
```

---

## Chunk 4: 수동 테스트 및 최종 커밋

### Task 6: 수동 테스트 검증

- [ ] **Step 1: 경로 링크 공백 테스트**

앱 실행 후 (`npm run dev`) 댓글에 다음 입력:
```
G:\공유 드라이브\사우스 코리안 파크\232_친모1\출력\B파트 한솔전달용
파일 전달드립니다!
```
→ 첫 줄 전체가 하나의 버튼으로 렌더링되는지 확인

- [ ] **Step 2: 경로 붙여넣기 자동 따옴표 테스트**

Windows 탐색기에서 `G:\공유 드라이브\폴더` 경로를 복사 → 댓글 입력창에 Ctrl+V
→ `"G:\공유 드라이브\폴더"` 형태로 따옴표가 자동 추가되는지 확인
→ 이미 따옴표가 있는 경우 중복 추가 안 되는지 확인
→ 이미지 붙여넣기가 여전히 동작하는지 확인

- [ ] **Step 3: 답글 확장 유지 테스트**

답글이 있는 댓글의 스레드를 펼친 상태에서 답글 작성
→ 스레드가 펼쳐진 상태 유지되는지 확인
→ 스크롤 위치가 유지되는지 확인

- [ ] **Step 4: 사용자 필터 테스트**

필터 드롭다운 열기 → 체크박스 클릭 (드롭다운 유지) → 이름 클릭 (솔로 모드)
→ 같은 이름 다시 클릭 (전체 복원)
→ 화면 하단 근처에서 열기 (위로 열리는지 확인)

- [ ] **Step 5: lint 실행**

```bash
npm run lint
```
에러가 있으면 수정 후 추가 커밋.
