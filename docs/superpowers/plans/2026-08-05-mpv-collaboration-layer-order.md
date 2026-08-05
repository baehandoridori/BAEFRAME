# mpv Collaboration Layer Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep native mpv video visible and playing while Liveblocks cursors, collaborator count, and playback-sync status render above it in the existing transparent overlay layer.

**Architecture:** Reclassify persistent collaboration status surfaces from native-host blockers to generic HTML mirrors, leaving true modal/input surfaces as blockers. Harden the shared surface-visibility helper so descendant rectangles only count when their full ancestor chain is rendered and their visible rectangle survives ancestor overflow clipping. Existing click-through native windows continue routing pointer input to the original DOM.

**Tech Stack:** Electron, Chromium DOM/CSS, JavaScript ES modules, Node.js built-in test runner, mpv native child window, Liveblocks.

## Global Constraints

- Native mpv video must remain visible and playing during collaboration.
- Liveblocks remote cursors, collaborator count, and playback-sync status must render above mpv.
- Existing click, hover, collapse, close, and drag behavior must remain on the original DOM controls.
- Only full replacement surfaces such as modals may hide the native mpv host.
- Hidden, transparent, or ancestor-clipped descendants must not block mpv.
- Release version must be greater than `2.0.2-beta`; use `2.0.3-beta`.
- Shared-drive deployment must finish with full-tree `MismatchCount=0`.

---

## File Structure

- `renderer/scripts/modules/mpv-surface-policy.js`: owns surface classification and effective visible-rectangle calculation.
- `scripts/tests/mpv-surface-policy.test.js`: executes registry and geometry behavior tests against the real policy module.
- `main/mpv-overlay-host.js`: renders generic HTML mirrors above mpv and keeps their descendants click-through.
- `scripts/tests/mpv-overlay-host.test.js`: verifies the generated native overlay document and its input policy.
- `package.json`: desktop release version.
- `package-lock.json`: lockfile release version.

### Task 1: Reclassify Collaboration Status as Mirrored Surfaces

**Files:**
- Modify: `scripts/tests/mpv-surface-policy.test.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`
- Modify: `renderer/scripts/modules/mpv-surface-policy.js`
- Modify: `main/mpv-overlay-host.js`

**Interfaces:**
- Consumes: `getMpvSurfaceSelectors(mode)` and `MPV_SURFACE_MODE` from `mpv-surface-policy.js`.
- Produces: `.collaborators-indicator` and `.playback-sync-panel` in `HTML_MIRROR`, absent from `BLOCK`, with all generated `#htmlOverlay` descendants forced to remain pointer-transparent.

- [ ] **Step 1: Install dependencies and verify the clean baseline**

Run:

```powershell
npm ci
npm run test:mpv
```

Expected: dependency installation leaves tracked files unchanged and the existing mpv suite passes before new tests are added.

- [ ] **Step 2: Write the failing layer-contract tests**

Replace the current collaboration selector assertions in `scripts/tests/mpv-surface-policy.test.js` with the required layer contract:

```js
test('collaboration status surfaces mirror above mpv without hiding the native host', async () => {
  const { MPV_SURFACE_MODE, getMpvSurfaceSelectors } = await loadPolicy();
  const blockSelectors = getMpvSurfaceSelectors(MPV_SURFACE_MODE.BLOCK);
  const htmlMirrorSelectors = getMpvSurfaceSelectors(MPV_SURFACE_MODE.HTML_MIRROR);

  for (const selector of ['.collaborators-indicator', '.playback-sync-panel']) {
    assert.equal(blockSelectors.includes(selector), false);
    assert.equal(htmlMirrorSelectors.includes(selector), true);
  }
});
```

In `scripts/tests/mpv-overlay-host.test.js`, add this assertion beside the existing generated overlay document checks:

```js
assert.match(
  overlayHtml,
  /#htmlOverlay \*\s*\{[^}]*pointer-events:\s*none !important;/
);
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --test scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-host.test.js
```

Expected: FAIL because both collaboration selectors are still in `BLOCK` and absent from `HTML_MIRROR`, and `#htmlOverlay` descendants are not explicitly pointer-transparent.

- [ ] **Step 4: Implement the minimal registry and click-through changes**

In `renderer/scripts/modules/mpv-surface-policy.js`, remove these entries from the `BLOCK` selector array:

```js
'.collaborators-indicator',
'.playback-sync-panel'
```

Add the same selectors to the `HTML_MIRROR` selector array:

```js
'.collaborators-indicator',
'.playback-sync-panel'
```

Do not change the remote-cursor dedicated mirror or any modal/input blocker.

In the generated overlay CSS in `main/mpv-overlay-host.js`, extend the existing forced pointer-transparent mirror list:

```css
#markerMirror *,
#tooltipMirror *,
#toastMirror *,
#remoteCursorMirror *,
#htmlOverlay * {
  pointer-events: none !important;
}
```

This prevents cloned controls from capturing Fabric overlay input even though their original computed `pointer-events` values are copied.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
node --test scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-host.test.js
```

Expected: PASS with no warnings or failures.

- [ ] **Step 6: Commit the layer policy change**

```powershell
git add -- renderer/scripts/modules/mpv-surface-policy.js main/mpv-overlay-host.js scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-host.test.js
git commit -m "수정: mpv 영상 위에 협업 상태 레이어를 유지"
```

### Task 2: Respect Ancestor Visibility and Overflow Clipping

**Files:**
- Modify: `scripts/tests/mpv-surface-policy.test.js`
- Modify: `renderer/scripts/modules/mpv-surface-policy.js`

**Interfaces:**
- Consumes: DOM-like elements with `parentElement`, `getBoundingClientRect()`, and computed `display`, `visibility`, `opacity`, `overflow`, `overflowX`, `overflowY`.
- Produces: internal `isElementEffectivelyVisible(element, getStyle, styleCache)` and `getElementVisibleRect(element, getStyle, styleCache)` helpers; the existing public `isMpvSurfaceVisiblyOverlappingHost()` API uses them for every candidate.

- [ ] **Step 1: Extend the fake element helper**

Update `fakeElement()` in `scripts/tests/mpv-surface-policy.test.js` so tests can provide `parentElement` and overflow styles:

```js
function fakeElement(bounds, { style = {}, descendants = [], parentElement = null } = {}) {
  return {
    parentElement,
    getBoundingClientRect() { return bounds; },
    querySelectorAll() { return descendants; },
    _style: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      ...style
    }
  };
}
```

- [ ] **Step 2: Write failing ancestor-visibility tests**

Add these behavior cases:

```js
test('a descendant hidden by an ancestor cannot block mpv', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });
  for (const style of [
    { display: 'none' },
    { visibility: 'hidden' },
    { opacity: '0' }
  ]) {
    const ancestor = fakeElement(
      rect({ left: 300, top: 80, right: 480, bottom: 200 }),
      { style }
    );
    const child = fakeElement(
      rect({ left: 320, top: 120, right: 470, bottom: 160 }),
      { parentElement: ancestor }
    );
    const surface = fakeElement(
      rect({ left: 300, top: 20, right: 480, bottom: 60 }),
      { descendants: [ancestor, child] }
    );
    ancestor.parentElement = surface;
    assert.equal(
      isMpvSurfaceVisiblyOverlappingHost(surface, hostRect, getComputedStyle),
      false
    );
  }
});

test('an overflow-clipped descendant outside the visible ancestor bounds cannot block mpv', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });
  for (const overflow of ['hidden', 'clip', 'auto', 'scroll']) {
    const ancestor = fakeElement(
      rect({ left: 300, top: 20, right: 480, bottom: 60 }),
      { style: { overflow, overflowX: overflow, overflowY: overflow } }
    );
    const child = fakeElement(
      rect({ left: 320, top: 20, right: 470, bottom: 240 }),
      { parentElement: ancestor }
    );
    const surface = fakeElement(
      rect({ left: 300, top: 20, right: 480, bottom: 60 }),
      { descendants: [ancestor, child] }
    );
    ancestor.parentElement = surface;
    assert.equal(
      isMpvSurfaceVisiblyOverlappingHost(surface, hostRect, getComputedStyle),
      false
    );
  }
});
```

- [ ] **Step 3: Run the visibility tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="hidden by an ancestor|overflow-clipped descendant" scripts/tests/mpv-surface-policy.test.js
```

Expected: FAIL because the current helper evaluates each descendant's own style and raw rectangle without its ancestor chain.

- [ ] **Step 4: Implement effective visible rectangles**

Add focused internal helpers to `renderer/scripts/modules/mpv-surface-policy.js`:

```js
function getStyleSafely(element, getStyle, styleCache) {
  if (styleCache.has(element)) return styleCache.get(element);
  let style = null;
  try {
    style = getStyle(element);
  } catch (_error) {
    style = null;
  }
  styleCache.set(element, style);
  return style;
}

function isElementEffectivelyVisible(element, getStyle, styleCache) {
  for (let current = element; current; current = current.parentElement) {
    const style = getStyleSafely(current, getStyle, styleCache);
    if (!style || style.display === 'none' ||
        style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0) return false;
  }
  return true;
}

function intersectRects(rect, clipRect, { clipX = true, clipY = true } = {}) {
  const left = clipX ? Math.max(rect.left, clipRect.left) : rect.left;
  const right = clipX ? Math.min(rect.right, clipRect.right) : rect.right;
  const top = clipY ? Math.max(rect.top, clipRect.top) : rect.top;
  const bottom = clipY ? Math.min(rect.bottom, clipRect.bottom) : rect.bottom;
  if (right <= left || bottom <= top) return null;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function clipsOverflow(value) {
  return ['hidden', 'clip', 'auto', 'scroll'].includes(value);
}

function getElementVisibleRect(element, getStyle, styleCache) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  let visibleRect = element.getBoundingClientRect();
  if (!visibleRect || visibleRect.width <= 0 || visibleRect.height <= 0) return null;

  for (let current = element.parentElement; current; current = current.parentElement) {
    const style = getStyleSafely(current, getStyle, styleCache);
    if (!style || typeof current.getBoundingClientRect !== 'function') continue;
    const overflowX = style.overflowX || style.overflow || 'visible';
    const overflowY = style.overflowY || style.overflow || 'visible';
    if (!clipsOverflow(overflowX) && !clipsOverflow(overflowY)) continue;
    visibleRect = intersectRects(visibleRect, current.getBoundingClientRect(), {
      clipX: clipsOverflow(overflowX),
      clipY: clipsOverflow(overflowY)
    });
    if (!visibleRect) return null;
  }
  return visibleRect;
}
```

Within `isMpvSurfaceVisiblyOverlappingHost()`, create one `Map` style cache per call. For each candidate, require `isElementEffectivelyVisible(candidate, getStyle, styleCache)`, calculate `getElementVisibleRect(candidate, getStyle, styleCache)`, and pass that clipped rectangle to `doesMpvSurfaceRectOverlapHost()` instead of using the raw candidate rectangle.

- [ ] **Step 5: Run focused and full policy tests and verify GREEN**

Run:

```powershell
node --test scripts/tests/mpv-surface-policy.test.js
```

Expected: PASS for existing overflow-panel detection and both new hidden/clipped ancestor cases.

- [ ] **Step 6: Commit visibility hardening**

```powershell
git add -- renderer/scripts/modules/mpv-surface-policy.js scripts/tests/mpv-surface-policy.test.js
git commit -m "수정: 숨겨진 협업 요소의 mpv 가림 오판 방지"
```

### Task 3: Run Integration Verification and Bump the Beta Version

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: the completed policy and visibility behavior from Tasks 1 and 2.
- Produces: a release-ready `2.0.3-beta` package with all mpv and collaboration tests green.

- [ ] **Step 1: Run the complete relevant suites**

Run:

```powershell
npm run test:mpv
npm run test:collaboration
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Bump release metadata without a git tag**

Run:

```powershell
npm version 2.0.3-beta --no-git-tag-version
```

Expected: only `package.json` and `package-lock.json` version fields change from `2.0.2-beta` to `2.0.3-beta`.

- [ ] **Step 3: Build the unpacked desktop application**

Run:

```powershell
npm run build
```

Expected: `dist/win-unpacked/BFRAME_alpha_v2.exe` and `dist/win-unpacked/resources/app.asar` are produced successfully.

- [ ] **Step 4: Re-run targeted tests after the version change and build**

Run:

```powershell
node --test scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-host.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit release metadata**

```powershell
git add -- package.json package-lock.json
git commit -m "배포: mpv 협업 레이어 수정 베타 버전을 2.0.3으로 갱신"
```

### Task 4: PR Review, Merge, Build, and Shared-Drive Deployment

**Files:**
- Verify: `dist/win-unpacked/**`
- Deploy: `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\BAEFRAME\테스트버전 빌드\**`

**Interfaces:**
- Consumes: pushed branch `codex/baeframe-mpv-collab-layer-order` and green `2.0.3-beta` build.
- Produces: merged `main` and a byte-identical shared-drive deployment.

- [ ] **Step 1: Push the branch and prepare the PR**

Run:

```powershell
git push -u origin codex/baeframe-mpv-collab-layer-order
```

Use the title:

```text
[v2.0.3-beta] mpv 영상과 협업 표시 레이어 동시 노출 복구
```

Prepare the required four PR sections: `📋 업데이트 요약`, `🔧 상세 기술 설명`, `🚧 개발 난항`, and `✅ 테스트 가이드`. Show the completed title and body to the user for the required PR confirmation before running `gh pr create`.

Use this release content, updating only the final test counts and commit references if review adds changes:

```markdown
## 📋 업데이트 요약

- 🎬 협업을 시작해도 영상이 검게 사라지지 않고 계속 재생됩니다.
- 👥 다른 작업자의 커서, 현재 작업 인원, 재생 동기화 상태가 영상과 동시에 보입니다.
- 🖱️ 협업 패널의 클릭·호버·접기·닫기·드래그 방식은 그대로 유지됩니다.

## 🔧 상세 기술 설명

- `renderer/scripts/modules/mpv-surface-policy.js`에서 `.collaborators-indicator`와 `.playback-sync-panel`을 `BLOCK`에서 `HTML_MIRROR`로 이동했습니다. 두 표면은 `serializeMpvOverlayHtml()` 경로로 투명 오버레이 창에 복제되며 native mpv host 가시성에는 영향을 주지 않습니다.
- 조상 요소의 display/visibility/opacity와 overflow clipping을 반영한 유효 사각형 계산을 추가해, 접힌 `.collab-plexus-panel` 내부 요소가 가림 표면으로 오판되지 않게 했습니다.
- `main/mpv-overlay-host.js`에서 `#htmlOverlay` 자식의 pointer event를 강제로 비활성화해 Fabric 입력 중에도 복제 UI가 마우스를 가로채지 않게 했습니다. 입력은 기존 click-through 창을 지나 메인 DOM이 처리합니다.
- `scripts/tests/mpv-surface-policy.test.js`, `scripts/tests/mpv-overlay-host.test.js`에 레이어 분류·조상 가시성·클리핑·입력 관통 회귀 검증을 추가했습니다.

## 🚧 개발 난항

- 기존 수정은 협업 UI를 보이게 하려고 작은 패널이 영상과 겹칠 때 mpv 창 전체를 숨겼고, 그 결과 정상 재생 중인 영상까지 검게 보였습니다.
- 접힌 협업 플렉서스 패널은 높이와 투명도가 0이어도 내부 자식의 원본 좌표만 따로 검사되어 보이는 요소로 오판될 수 있었습니다. 후보 자체가 아니라 전체 조상 체인과 실제 잘린 영역을 계산하는 방식으로 수정했습니다.
- 일반 HTML 복제는 원래 요소의 pointer event 스타일도 복사하므로, 그리기 입력이 활성화될 때 복제 버튼이 입력을 가로채지 않도록 native overlay 문서에서 한 번 더 강제 관통 처리했습니다.

## ✅ 테스트 가이드

### 실사용자용

1. 같은 영상을 두 PC에서 열고 협업 연결을 시작합니다.
2. 영상이 계속 보이고 재생되는 상태에서 상대방 커서와 현재 작업 인원이 표시되는지 확인합니다.
3. 재생 동기화 패널을 열어 상태 표시, 접기, 닫기, 드래그가 동작하는지 확인합니다.
4. 그리기 모드와 댓글 모달을 각각 열어 기존 입력과 화면 전환에 문제가 없는지 확인합니다.

### 개발자용

- `npm run test:mpv`
- `npm run test:collaboration`
- `npm run build`
- 배포 후 로컬/공유 드라이브 전체 파일 SHA-256 비교 `MismatchCount=0`
```

- [ ] **Step 2: Create and review the PR**

After confirmation, create the PR, trigger Codex review, and inspect issue comments, reviews, and line comments. Address every actionable finding with failing-first regression coverage, rerun relevant tests, push, and retrigger until no actionable findings remain.

- [ ] **Step 3: Merge and synchronize the release checkout**

Merge the reviewed PR. Verify the remote merge commit, then fast-forward `C:\BAEframe\BAEFRAME` with:

```powershell
git pull --ff-only origin main
```

Do not stage, delete, or alter the existing unrelated untracked files in the main checkout.

- [ ] **Step 4: Rebuild from merged main**

Run in `C:\BAEframe\BAEFRAME`:

```powershell
npm run test:mpv
npm run test:collaboration
npm run build
```

Expected: all tests pass and merged-main `dist/win-unpacked` builds successfully.

- [ ] **Step 5: Stop only the deployed-path BAEFRAME process if it locks the target**

Resolve running `BFRAME_alpha_v2.exe` processes and stop only processes whose executable path starts with the exact deployment directory. Do not stop repo tools, editors, or unrelated BAEFRAME builds.

- [ ] **Step 6: Deploy the unpacked build**

Verify the resolved source is `C:\BAEframe\BAEFRAME\dist\win-unpacked` and the resolved target is the exact shared-drive test-version directory. Mirror the source tree to the target with `robocopy`, accepting exit codes `0` through `7` as success.

- [ ] **Step 7: Verify the entire deployed tree**

Build relative-path/SHA-256 maps for every file in local `dist\win-unpacked` and the deployed folder. Compare missing, extra, and mismatched hashes and require:

```text
MismatchCount=0
```

Also report matching hashes for `BFRAME_alpha_v2.exe` and `resources\app.asar` explicitly.

- [ ] **Step 8: Report the release outcome**

Report user-visible behavior, exact version `2.0.3-beta`, PR/review/merge status, test/build commands, deployment path, and full-tree hash result.
