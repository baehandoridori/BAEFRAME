# 레이어 우클릭 삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 드로잉 레이어 설정 말풍선에서 우클릭한 레이어를 안전하게 삭제한다.

**Architecture:** `timeline.js`는 우클릭한 레이어 ID를 `layerContextMenu` 이벤트로 `app.js`에 전달한다. `app.js`가 보관한 `selectedLayerIdForPopup`를 새 버튼이 공용 삭제 함수에 전달하고, 공용 함수가 마지막 레이어 보호·삭제·팝업 닫기·타임라인 갱신·토스트를 처리한다.

**Tech Stack:** Electron 28, DOM 이벤트, Node.js test runner, CSS

## Global Constraints

- 기존 `.bframe` 저장 형식과 `mpv/` 바이너리는 변경하지 않는다.
- 우클릭 대상과 활성 레이어가 다를 때도 우클릭 대상만 삭제한다.
- 마지막 남은 레이어는 삭제하지 않는다.
- production code보다 먼저 회귀 테스트를 작성하고 실패를 확인한다.
- 사용자 미추적 파일은 stage하거나 변경하지 않는다.
- PR 제목·본문·커밋 메시지는 한글로 작성한다.

---

### Task 1: 우클릭 삭제 계약 추가

**Files:**

- Modify: `scripts/tests/keyframe-shortcuts-source.test.js`
- Modify: `renderer/index.html`
- Modify: `renderer/styles/main.css`
- Modify: `renderer/scripts/app.js`

**Interfaces:**

- Consumes: `layerContextMenu`의 `{ layerId, x, y }`와 `selectedLayerIdForPopup`
- Produces: `deleteDrawingLayer(layerId)`와 `#layerDeleteBtn` 클릭 시 우클릭 대상 삭제

- [ ] **Step 1: 실패 테스트 작성**

`scripts/tests/keyframe-shortcuts-source.test.js` 상단에 아래 소스를 추가한다.

```js
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
```

아래 계약 테스트를 추가한다.

```js
test('layer settings popup deletes the layer that was right-clicked', () => {
  assert.match(indexSource, /id="layerDeleteBtn"[\s\S]{0,120}>레이어 삭제<\/button>/);
  assert.match(appSource, /const layerDeleteBtn = document\.getElementById\('layerDeleteBtn'\);/);
  assert.match(appSource, /function deleteDrawingLayer\(layerId\) \{/);
  assert.match(appSource, /drawingManager\.deleteLayer\(layerId\)/);
  assert.match(appSource, /layerDeleteBtn\.addEventListener\('click', \(\) => \{[\s\S]{0,120}deleteDrawingLayer\(selectedLayerIdForPopup\);/);
  assert.match(appSource, /function deleteActiveDrawingLayer\(\) \{[\s\S]{0,160}deleteDrawingLayer\(drawingManager\.activeLayerId\);/);
});
```

- [ ] **Step 2: RED 확인**

Run: `node --test scripts/tests/keyframe-shortcuts-source.test.js`

Expected: 아직 없는 `layerDeleteBtn` 때문에 새 서브테스트가 실패한다.

- [ ] **Step 3: 최소 구현**

`renderer/index.html`의 `#layerSettingsPopup`에서 불투명도 행 뒤에 아래 버튼을 추가한다.

```html
<div class="layer-settings-actions">
  <button type="button" class="layer-settings-delete" id="layerDeleteBtn">레이어 삭제</button>
</div>
```

`renderer/styles/main.css`에 아래 스타일을 추가한다.

```css
.layer-settings-delete {
  width: 100%;
  min-height: 30px;
  border: 1px solid rgba(255, 107, 107, 0.45);
  border-radius: 6px;
  background: transparent;
  color: #ff8a8a;
  cursor: pointer;
}

.layer-settings-delete:hover {
  background: rgba(255, 107, 107, 0.14);
  border-color: #ff8a8a;
}
```

`renderer/scripts/app.js`에서 버튼을 찾고 아래 공용 삭제 함수를 추가한다.

```js
const layerDeleteBtn = document.getElementById('layerDeleteBtn');

function deleteDrawingLayer(layerId) {
  if (!layerId) {
    showToast('삭제할 레이어가 없습니다.', 'warn');
    return;
  }
  if (drawingManager.layers.length <= 1) {
    showToast('마지막 레이어는 삭제할 수 없습니다.', 'warn');
    return;
  }
  if (drawingManager.deleteLayer(layerId)) {
    hideLayerSettingsPopup();
    renderDrawingLayerTimeline();
    showToast('레이어 삭제됨', 'info');
  }
}

layerDeleteBtn.addEventListener('click', () => {
  deleteDrawingLayer(selectedLayerIdForPopup);
});

function deleteActiveDrawingLayer() {
  deleteDrawingLayer(drawingManager.activeLayerId);
}
```

- [ ] **Step 4: GREEN 확인**

Run: `node --test scripts/tests/keyframe-shortcuts-source.test.js`

Expected: 모든 서브테스트 통과.

- [ ] **Step 5: 범위 검증과 커밋**

Run: `npm run test:drawing; npm run lint; git diff --check`

Expected: 드로잉 테스트 전체 통과, 린트 오류 0건, 공백 오류 없음.

```powershell
git add renderer/index.html renderer/styles/main.css renderer/scripts/app.js scripts/tests/keyframe-shortcuts-source.test.js
git commit -m "feat: 레이어 우클릭 삭제 추가"
```

### Task 2: PR·리뷰·배포·완료 보고

**Files:**

- Build: `dist/win-unpacked/BFRAME_alpha_v2.exe`
- Deploy: `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\BAEFRAME\테스트버전 빌드`

**Interfaces:**

- Consumes: Task 1의 머지된 `main`, `dist/win-unpacked`
- Produces: 공유 드라이브 배포본과 원본의 SHA-256 파일 해시 일치, 윤성원님 DM 완료 보고

- [ ] **Step 1: PR 생성과 Codex 리뷰 루프**

현재 브랜치를 push하고 한글 PR을 만든 뒤 `@codex review`를 요청한다. 새 review·issue·line comment가 없고 review 결과가 해결될 때까지 반복한다.

- [ ] **Step 2: 머지 확인**

Run: `gh pr view --json state,mergedAt,mergeCommit,url`

Expected: `state`가 `MERGED`이고 merge commit이 있다.

- [ ] **Step 3: 빌드**

Run: `npm run build; npx electron-builder --dir`

Expected: `dist/win-unpacked/BFRAME_alpha_v2.exe`와 `resources/app.asar`가 생성된다.

- [ ] **Step 4: 공유 드라이브 배포와 해시 대조**

`dist/win-unpacked`을 배포 폴더에 mirror한 뒤, 로컬과 배포본의 모든 상대 파일 경로와 SHA-256을 비교한다.

Expected: `BFRAME_alpha_v2.exe`, `resources/app.asar`를 포함한 `MismatchCount=0`.

- [ ] **Step 5: Slack DM 완료 보고**

사용자 계정 Slack MCP에서 윤성원님 DM을 찾거나 열고, 변경 내용·PR·배포 경로·해시 검증 결과를 짧게 보낸다. 전송 결과를 기록한다.
