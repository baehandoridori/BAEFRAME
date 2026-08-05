# mpv Collaboration Layer Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep native mpv video visible and playing while Liveblocks cursors, collaborator count, and playback-sync status render above it in the existing transparent overlay layer.

**Architecture:** Keep the completed blocker removal and ancestor-clipping hardening, but replace the interim generic HTML clones for collaboration with a dedicated revisioned state mirror. A trusted static overlay DOM renders semantic collaborator/playback state and a throttled plexus PNG; while Fabric owns the native overlay input, an allowlisted action relay stops the gesture before Fabric and calls the same named handlers as the original DOM. True modal/input surfaces remain blockers and collaboration-state failure never hides the native mpv host.

**Tech Stack:** Electron, Chromium DOM/CSS, JavaScript ES modules, Node.js built-in test runner, mpv native child window, Liveblocks.

## Global Constraints

- Native mpv video must remain visible and playing during collaboration.
- Liveblocks remote cursors, collaborator count, and playback-sync status must render above mpv.
- Existing click, hover, toggle, radio, collapse, close, and drag behavior must work both with and without Fabric drawing input.
- Collaboration controls must not create accidental Fabric strokes.
- Only full replacement surfaces such as modals may hide the native mpv host.
- Hidden, transparent, or ancestor-clipped descendants must not block mpv.
- Collaboration UI must not be copied through generic `innerHTML`; untrusted names and colors must use normalized values and `textContent`.
- Dedicated collaboration state is exact-schema, revisioned, at most `1 MiB`, contains at most `64` users, and accepts only validated PNG snapshots up to `768 KiB`.
- `#collaborationMirror` uses `z-index: 46`, above remote cursors (`45`) and below toasts (`50`).
- Collaboration interaction must not dynamically flip `setIgnoreMouseEvents`; only semantic actions with current host/video/input/session fences may cross windows.
- Release version must be greater than `2.0.2-beta`; use `2.0.3-beta`.
- Shared-drive deployment must finish with full-tree `MismatchCount=0`.

---

## File Structure

- `renderer/scripts/modules/mpv-surface-policy.js`: owns surface classification and effective visible-rectangle calculation.
- `renderer/scripts/app.js`: builds dedicated collaboration state, sanitizes collaborator UI, schedules plexus snapshots, and owns named collaboration actions shared by original and mirrored controls.
- `preload/preload.js`: exposes the dedicated state update and normalized mirrored-action listener to the main renderer.
- `preload/mpv-overlay-preload.js`: exposes the narrow allowlisted collaboration-action dispatch API to the native overlay document.
- `main/ipc-handlers.js`: verifies IPC sender identity and routes collaboration state/actions only between the current main renderer and current overlay host.
- `scripts/tests/mpv-surface-policy.test.js`: executes registry and geometry behavior tests against the real policy module.
- `main/mpv-overlay-host.js`: renders generic mirrors and the trusted revisioned `#collaborationMirror`, assigns current action fences, and rejects stale/duplicate actions.
- `scripts/tests/mpv-overlay-host.test.js`: verifies the generated native overlay document and its input policy.
- `scripts/tests/mpv-overlay-preload.test.js`: verifies the overlay renderer can dispatch only normalized collaboration actions.
- `scripts/tests/mpv-runtime-source.test.js`: verifies both IPC bridges, state scheduling, source-of-truth handler reuse, and post-version suite contracts.
- `scripts/tests/collaboration-cursors-source.test.js`: verifies safe collaborator DOM creation and collaboration-state update wiring.
- `package.json`: desktop release version.
- `package-lock.json`: lockfile release version.

> **Review correction after Tasks 1-3:** Tasks 1-3 are retained as completed investigation and hardening work. Task 1's generic `HTML_MIRROR` classification was an interim fix; Task 4 deliberately supersedes only that classification with `COLLABORATION_MIRROR`. The pointer transparency added to generic mirrors remains valid for all other generic mirrored surfaces.

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

### Task 4: Replace Generic Collaboration Clones with a Dedicated State Mirror

**Files:**
- Modify: `renderer/scripts/modules/mpv-surface-policy.js`
- Modify: `renderer/scripts/app.js`
- Modify: `preload/preload.js`
- Modify: `main/ipc-handlers.js`
- Modify: `main/mpv-overlay-host.js`
- Modify: `scripts/tests/mpv-surface-policy.test.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`
- Modify: `scripts/tests/mpv-runtime-source.test.js`
- Modify: `scripts/tests/collaboration-cursors-source.test.js`

**Interfaces:**
- Consumes: the completed ancestor visibility helpers from Task 2 and the current overlay lifecycle owner captured by `mpvOverlayLifecycle.captureReadyOwner()`.
- Produces: `MPV_SURFACE_MODE.COLLABORATION_MIRROR`; `window.electronAPI.mpvUpdateOverlayCollaborationState(state)`; `MPVOverlayHost.updateCollaborationState(state)`; `window.__applyMpvCollaborationState(state)`; and `scheduleMpvOverlayCollaborationStateSync({ livePlexus = false } = {})`.
- State contract: `{ revision, theme, indicator, plexus, playback }` with exact keys, `1 MiB` total cap, `64` users, a `768 KiB` PNG cap, and monotonically increasing revision.

- [ ] **Step 1: Write failing surface and host-contract tests**

Update `scripts/tests/mpv-surface-policy.test.js` so the final classification contract is explicit:

```js
test('collaboration status uses only the dedicated collaboration mirror', async () => {
  const { MPV_SURFACE_MODE, getMpvSurfaceSelectors } = await loadPolicy();
  for (const selector of ['.collaborators-indicator', '.playback-sync-panel']) {
    assert.equal(getMpvSurfaceSelectors(MPV_SURFACE_MODE.BLOCK).includes(selector), false);
    assert.equal(getMpvSurfaceSelectors(MPV_SURFACE_MODE.HTML_MIRROR).includes(selector), false);
    assert.equal(
      getMpvSurfaceSelectors(MPV_SURFACE_MODE.COLLABORATION_MIRROR).includes(selector),
      true
    );
  }
});
```

Add host tests that require all of the following:

```js
assert.match(overlayHtml, /id="collaborationMirror"/);
assert.match(overlayHtml, /#collaborationMirror\s*\{[^}]*z-index:\s*46;/);
assert.match(overlayHtml, /window\.__applyMpvCollaborationState/);
assert.match(overlayHtml, /collaborationName\.textContent\s*=/);
assert.doesNotMatch(overlayHtml, /collaborationMirror\.innerHTML\s*=/);
```

Export the state normalizer for tests and assert that it rejects an extra root key, an invalid enum, a non-finite bound, more than 64 users, a non-PNG data URL, a snapshot over 768 KiB, and a serialized state over 1 MiB. Assert that names are stripped of control/bidi characters and limited to 64 characters, and colors outside `/^#[0-9A-Fa-f]{6}$/` become `#FFD000`.

- [ ] **Step 2: Run the dedicated-state tests and verify RED**

Run:

```powershell
node --test scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/collaboration-cursors-source.test.js
```

Expected: FAIL because `COLLABORATION_MIRROR`, the dedicated state channel, the trusted overlay DOM, and the safe collaborator DOM writer do not exist.

- [ ] **Step 3: Add the final surface classification and observation contract**

In `renderer/scripts/modules/mpv-surface-policy.js`, add the mode and move only the two collaboration selectors out of the generic mirror:

```js
export const MPV_SURFACE_MODE = Object.freeze({
  BLOCK: 'block',
  HTML_MIRROR: 'htmlMirror',
  DEDICATED_MIRROR: 'dedicatedMirror',
  COLLABORATION_MIRROR: 'collaborationMirror'
});
```

Keep `COLLABORATION_MIRROR` in `MPV_MIRRORED_OVERLAY_SELECTOR` so mutation, resize, and motion observers still schedule position updates. Keep it out of `MPV_HTML_MIRROR_OVERLAY_SELECTOR` so `serializeMpvOverlayHtml()` cannot copy collaboration DOM, form controls, or canvas elements.

- [ ] **Step 4: Replace unsafe collaborator avatar HTML and build semantic state**

In `renderer/scripts/app.js`, replace `collaboratorsAvatars.innerHTML = collaborators.map(...)` with `replaceChildren(fragment)`. Build each avatar with `document.createElement('div')`; assign the name/initials with `textContent`, the title with the `title` property, and only a normalized `#RRGGBB` value to `style.backgroundColor`.

Add exact helpers with these responsibilities:

```js
function normalizeMpvCollaborationName(value) { /* strip control/bidi, trim, slice(0, 64) */ }
function normalizeMpvCollaborationColor(value) { /* #RRGGBB or #FFD000 */ }
function buildMpvOverlayCollaborationState() { /* exact semantic snapshot */ }
function scheduleMpvOverlayCollaborationStateSync({ livePlexus = false } = {}) {}
```

`buildMpvOverlayCollaborationState()` must:

- calculate indicator, plexus, and playback bounds relative to the current mpv overlay root;
- read `syncEnabled` and `leaderMode` from `playbackSync`, not from cloned attributes;
- read `collapsed` and visibility from the authoritative source panel;
- read the remote-cursor setting from `userSettings.getShowRemoteCursors()`;
- include the latest sanitized `_currentCollaborators` and `syncStatus` badge;
- call `collabPlexusCanvas.toDataURL('image/png')` only while the panel is visibly active, catch failures, and otherwise send `snapshotDataUrl: ''`;
- increment a dedicated revision and submit only while `mpvOverlayLifecycle.isReady(owner)` remains true.

Throttle only `{ livePlexus: true }` calls to one IPC update per `66.67 ms`. Send ordinary semantic changes on the next animation frame without that delay. When `_hideCollabPlexusPanel()` runs, cancel pending live capture and force one state with an empty snapshot.

- [ ] **Step 5: Add the strict IPC state boundary and trusted static renderer**

Expose this main-renderer bridge in `preload/preload.js`:

```js
mpvUpdateOverlayCollaborationState: (state) =>
  ipcRenderer.invoke('mpv:update-overlay-collaboration-state', state),
```

Register `mpv:update-overlay-collaboration-state` beside the existing remote-cursor channel in `main/ipc-handlers.js`, reusing the same main-renderer sender check before calling `mpvOverlayHost.updateCollaborationState(state)`.

In `main/mpv-overlay-host.js`, add `normalizeMpvCollaborationState(value)`. Require exact key sets at every object level, finite bounded rectangles, enums, booleans, the user/name/color limits, PNG prefix/size, and the total byte cap. `updateCollaborationState()` must reject invalid state, ignore `revision <= collaborationRevision`, and reset `collaborationRevision` on host create/destroy.

Add trusted static markup under `#root`:

```html
<div id="collaborationMirror">
  <section id="collaborationIndicatorMirror" data-collaboration-target="collab.indicator">
    <div id="collaborationAvatarsMirror"></div>
    <span id="collaborationCountMirror"></span>
    <button data-collaboration-action="collab.sync-status"></button>
  </section>
  <section id="collaborationPlexusMirror" data-collaboration-target="collab.panel">
    <img id="collaborationPlexusImageMirror" alt="">
    <button data-collaboration-action="collab.cursor-toggle"><span></span></button>
    <button data-collaboration-action="collab.open-sync"><span></span></button>
  </section>
  <section id="playbackSyncMirror" data-collaboration-target="sync.panel">
    <div data-collaboration-action="sync.drag-start"></div>
    <button data-collaboration-action="sync.collapse"></button>
    <button data-collaboration-action="sync.close"></button>
    <button data-collaboration-action="sync.toggle"><span class="sync-knob"></span></button>
    <button data-collaboration-action="sync.lead"><span class="radio-dot"></span></button>
    <button data-collaboration-action="sync.follow"><span class="radio-dot"></span></button>
  </section>
</div>
```

Use `z-index: 46`. `window.__applyMpvCollaborationState()` must update only pre-created nodes through `textContent`, `replaceChildren()` with locally-created nodes, validated styles, `classList`, `aria-checked`, and the validated image `src`. The real `.sync-knob` and `.radio-dot` children must render the current state without relying on cloned pseudo elements or source `checked` attributes.

- [ ] **Step 6: Wire every authoritative state transition**

Call `scheduleMpvOverlayCollaborationStateSync()` after collaborator/connection updates, panel show/hide, cursor preference changes, sync enable/mode changes, panel show/collapse/close/drag, overlay bounds changes, and theme changes. While `_startPlexusAnimation()` draws, call the throttled live variant after the canvas frame is complete.

Do not add collaboration snapshots to the generic `getMpvOverlayState()` payload. A failure on the dedicated channel may schedule overlay recovery for the current owner, but must not mark the native mpv video as blocked or call `mpvSetHostVisible(false)`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
node --test scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/collaboration-cursors-source.test.js
```

Expected: PASS with collaboration absent from generic HTML serialization, strict state normalization green, safe avatar construction green, and the static semantic mirror present at layer 46.

- [ ] **Step 8: Commit the dedicated state mirror**

```powershell
git add -- renderer/scripts/modules/mpv-surface-policy.js renderer/scripts/app.js preload/preload.js main/ipc-handlers.js main/mpv-overlay-host.js scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/collaboration-cursors-source.test.js
git commit -m "수정: 협업 UI를 전용 mpv 상태 레이어로 분리"
```

### Task 5: Relay Allowlisted Collaboration Actions Without Fabric Strokes

**Files:**
- Modify: `renderer/scripts/app.js`
- Modify: `preload/preload.js`
- Modify: `preload/mpv-overlay-preload.js`
- Modify: `main/ipc-handlers.js`
- Modify: `main/mpv-overlay-host.js`
- Modify: `scripts/tests/mpv-overlay-preload.test.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`
- Modify: `scripts/tests/mpv-runtime-source.test.js`
- Modify: `scripts/tests/fabric-drawing-pilot-integration.test.js`

**Interfaces:**
- Consumes: trusted `[data-collaboration-action]` controls and semantic state from Task 4; current `hostGeneration`, `currentVideoGeneration`, `currentInputRevision`, and `activeSessionId` from `MPVOverlayHost`.
- Produces: `window.mpvOverlayCollaborationActions.dispatch(action)`; `mpv-overlay:collaboration-action`; `window.electronAPI.onMpvOverlayCollaborationAction(callback)`; `MPVOverlayHost.forwardCollaborationAction(sender, action)`; and `applyMpvOverlayCollaborationAction(message)`.
- Action contract: exact `{ action, payload }` from overlay preload; host-authored exact `{ action, payload, hostGeneration, videoGeneration, inputRevision, activeSessionId, sequence }` to the main renderer.

- [ ] **Step 1: Write failing normalization, fence, and propagation tests**

In `scripts/tests/mpv-overlay-preload.test.js`, require an exact allowlist and payload shapes:

```js
const allowed = [
  'collab.indicator-enter', 'collab.indicator-leave',
  'collab.panel-enter', 'collab.panel-leave',
  'collab.sync-status', 'collab.cursor-toggle', 'collab.open-sync',
  'sync.toggle', 'sync.lead', 'sync.follow',
  'sync.collapse', 'sync.close',
  'sync.drag-start', 'sync.drag-move', 'sync.drag-end', 'sync.drag-cancel'
];
```

Non-drag actions accept no payload. `sync.drag-start` accepts only finite `{ pointerId, clientX, clientY }` inside the overlay viewport. Once pointer capture owns that drag, move/end accept the same exact payload with signed finite overlay-local coordinates bounded to `±32768`, so the panel can keep following the pointer outside the video. Cancel accepts only `{ pointerId }`. Unknown keys, unknown actions, non-finite or out-of-bound coordinates, arrays, and prototype-shaped input return `false` without sending IPC.

In host/runtime tests, assert:

- only the current overlay `webContents` sender is accepted;
- fence values are read from the host, never accepted from the overlay payload;
- sequence strictly increases and duplicates/stale sessions are ignored;
- collaboration controls call `preventDefault()` and `stopImmediatePropagation()` in capture phase before the Fabric pointer handler;
- the collaboration path contains no `setIgnoreMouseEvents()` call;
- one gesture causes one original named action, not a second copy of business logic.

- [ ] **Step 2: Run action-relay tests and verify RED**

Run:

```powershell
node --test scripts/tests/mpv-overlay-preload.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/fabric-drawing-pilot-integration.test.js
```

Expected: FAIL because the overlay preload API, sender fence, capture suppression, and named main-renderer adapter do not exist.

- [ ] **Step 3: Refactor original DOM listeners into named authoritative actions**

In `renderer/scripts/app.js`, extract the existing anonymous callbacks without changing their business behavior:

```js
function handleCollaborationIndicatorEnter() {}
function handleCollaborationIndicatorLeave(relatedTarget = null) {}
function handleCollaborationPanelEnter() {}
function handleCollaborationPanelLeave() {}
function showCollaborationSyncStatus() {}
function toggleRemoteCollaboratorCursors() {}
function setPlaybackSyncPanelVisible(visible) {}
function setPlaybackSyncEnabled(enabled) {}
function setPlaybackSyncLeaderMode(mode) {}
function togglePlaybackSyncPanelCollapsed() {}
function movePlaybackSyncPanelTo(clientX, clientY, dragState) {}
```

Original DOM `mouseenter`, `mouseleave`, `click`, `change`, `mousedown`, `mousemove`, and `mouseup` listeners must call these functions. Each state-changing function schedules the dedicated state update from Task 4. `setPlaybackSyncEnabled()` updates `PlaybackSync`, source checkbox/label/status, and collaborator `syncActive` together; `setPlaybackSyncLeaderMode()` updates both the model and source radios.

- [ ] **Step 4: Add the overlay-side capture and drag state machine**

In `preload/mpv-overlay-preload.js`, expose a frozen API that normalizes the exact action and sends `mpv-overlay:collaboration-action` only on success.

In the trusted overlay document from `main/mpv-overlay-host.js`:

- register `pointerenter`, `pointerleave`, `pointerdown`, `click`, and `change` behavior only for known `data-collaboration-action` controls;
- for every collaboration control event received while Fabric input is active, call `preventDefault()` and `stopImmediatePropagation()` in capture phase before dispatch;
- permit exactly one active drag `pointerId`, call `setPointerCapture(pointerId)`, and reject a second pointer;
- require drag start inside the overlay viewport, but preserve signed bounded move/end coordinates after capture instead of clamping them to the video;
- coalesce `pointermove` to one `sync.drag-move` per animation frame;
- flush the last move before `sync.drag-end` on `pointerup`;
- send `sync.drag-cancel` and release capture on `pointercancel`, `lostpointercapture`, blur, or a changed host/video/input/session fence.

Do not change native mouse-ignore mode for a collaboration hover or click. When Fabric is inactive, the entire native overlay remains click-through and the source DOM listeners above continue to own input.

- [ ] **Step 5: Fence actions in main and expose the normalized renderer listener**

Add `MPVOverlayHost.forwardCollaborationAction(sender, action)` in `main/mpv-overlay-host.js`. It must verify `sender === currentOverlayWindow.webContents`, normalize the allowlisted action again, require active Fabric input, attach current host/video/input/session fields and the next sequence, then send only to the current main window.

Register the raw overlay channel in `main/ipc-handlers.js` and delegate sender checking to that host method. In `preload/preload.js`, expose:

```js
onMpvOverlayCollaborationAction: (callback) => {
  // normalize exact keys/types, invoke callback, return unsubscribe
}
```

Do not expose an arbitrary IPC channel name or a generic message sender to either renderer.

- [ ] **Step 6: Validate fences and call the same named handlers in the main renderer**

Implement `applyMpvOverlayCollaborationAction(message)` in `renderer/scripts/app.js`. Before dispatch, compare the message fence to `fabricDrawingPilotController.getStatusSnapshot()` and the current overlay lifecycle owner. Require an active/prepared Fabric input session, exact host/video/input/session equality, and `sequence > lastAppliedCollaborationActionSequence`.

Dispatch with a closed `switch` to the named functions from Step 3. For drag, convert overlay-local coordinates to app client coordinates by adding only the current video wrapper's `left`/`top`, retain one renderer-side drag record `{ pointerId, startX, startY, panelStartX, panelStartY }`, let the existing authoritative panel-move function clamp the resulting panel position to the app viewport, commit the final point on end, and clear it on cancel or any fence change. Unknown or stale messages must return without touching DOM, `PlaybackSync`, `userSettings`, or Fabric.

- [ ] **Step 7: Run focused and Fabric integration tests and verify GREEN**

Run:

```powershell
node --test scripts/tests/mpv-overlay-preload.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/fabric-drawing-pilot-integration.test.js
```

Expected: PASS. In the integration harness, a collaboration button click changes only the intended collaboration state, Fabric receives zero pointer gesture, stale fenced input is ignored, and drag end preserves the final coordinates.

- [ ] **Step 8: Commit the semantic action relay**

```powershell
git add -- renderer/scripts/app.js preload/preload.js preload/mpv-overlay-preload.js main/ipc-handlers.js main/mpv-overlay-host.js scripts/tests/mpv-overlay-preload.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/fabric-drawing-pilot-integration.test.js
git commit -m "수정: Fabric 위 협업 컨트롤 입력을 안전하게 전달"
```

### Task 6: Lock Fidelity, Security, Geometry, and Full Post-Version Regression

**Files:**
- Modify: `scripts/tests/mpv-surface-policy.test.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`
- Modify: `scripts/tests/mpv-runtime-source.test.js`
- Modify: `scripts/tests/collaboration-cursors-source.test.js`
- Verify: `package.json`
- Verify: `package-lock.json`
- Verify: `dist/win-unpacked/**`

**Interfaces:**
- Consumes: Tasks 1-5 and release metadata `2.0.3-beta` from Task 3.
- Produces: explicit mixed-axis/zero-size geometry coverage, malicious-data coverage, exact checked/radio/canvas/z-order fidelity coverage, all relevant suites rerun after the final code and version, and a fresh unpacked package.

- [ ] **Step 1: Add the remaining geometry edge tests and verify RED when guards are removed**

Add separate cases to `scripts/tests/mpv-surface-policy.test.js`:

```js
test('overflow-x clips only x while overflow-y remains visible', async () => {
  // Child overlaps the host only on the clipped x side: expect false.
});

test('overflow-y clips only y while overflow-x remains visible', async () => {
  // Child overlaps the host only on the clipped y side: expect false.
});

test('zero-width or zero-height candidates and clipping ancestors never block mpv', async () => {
  // Exercise zero candidate width, zero candidate height, zero ancestor width,
  // and zero ancestor height independently: expect false for every case.
});
```

Temporarily confirm each new assertion fails if axis selection or the `right <= left || bottom <= top` guard is bypassed, then restore the production guard.

- [ ] **Step 2: Add exact visual-state and hostile-input regression cases**

In `scripts/tests/mpv-overlay-host.test.js`, apply successive states and assert:

- `syncEnabled: false -> true` moves the real `.sync-knob`, changes `aria-checked`, and updates the label;
- `leaderMode: lead -> follow` changes exactly one real `.radio-dot` selection;
- `badge: syncing | synced | error | idle` changes the expected class/text only;
- a valid PNG appears while `plexus.visible` is true and its `src` is removed when false;
- stale revisions cannot restore an older toggle, radio, or image state;
- `#collaborationMirror` is `46`, `#remoteCursorMirror` is `45`, and `#toastMirror` is `50`;
- a name such as `<img src=x onerror=alert(1)>` remains literal text and creates no element;
- CSS-like colors and extra payload keys never reach a style or DOM sink.

In `scripts/tests/collaboration-cursors-source.test.js`, assert `updateCollaboratorsUI()` uses `createElement`, `textContent`, and `replaceChildren`, and does not assign collaborator data through `innerHTML`.

- [ ] **Step 3: Run all focused files after the final fixes**

Run:

```powershell
node --test scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-preload.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/collaboration-cursors-source.test.js scripts/tests/fabric-drawing-pilot-integration.test.js
```

Expected: PASS with zero failures and no unhandled rejection warnings.

- [ ] **Step 4: Re-run every release-relevant suite after the version bump and final implementation**

Run:

```powershell
node --test scripts/tests/runtime-profile.test.js
npm run test:mpv
npm run test:collaboration
npm run test:fabric-drawing-pilot
```

Expected: all suites pass on the final `2.0.3-beta` tree. This supersedes Task 3's pre-review targeted rerun; do not rely on a test result captured before Tasks 4-5.

- [ ] **Step 5: Build and verify packaged identity**

Run:

```powershell
npm run build
```

Expected: `dist/win-unpacked/BFRAME_alpha_v2.exe` and `dist/win-unpacked/resources/app.asar` are rebuilt. Verify executable FileVersion is `2.0.3-beta`, packaged `package.json` is `2.0.3-beta`, and packaged hashes for `main/mpv-overlay-host.js`, `renderer/scripts/modules/mpv-surface-policy.js`, `preload/preload.js`, and `preload/mpv-overlay-preload.js` equal the final source files.

- [ ] **Step 6: Perform the Windows interaction smoke test**

Launch only the fresh unpacked build with a normal existing video and verify:

1. join a collaboration room and play the video continuously;
2. confirm remote cursor, collaborator count, connection badge, opened plexus image, and playback-sync panel are visible above video;
3. with Fabric drawing enabled, hover the indicator, toggle remote cursors, open sync, change toggle and lead/follow, collapse, drag, and close;
4. confirm every action changes once, the video never turns black, and no unintended Fabric stroke appears;
5. open an existing blocking modal and confirm the native video is hidden only for that modal and returns afterward.

- [ ] **Step 7: Commit any regression coverage or final corrections**

```powershell
git add -- scripts/tests/mpv-surface-policy.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/collaboration-cursors-source.test.js renderer/scripts/modules/mpv-surface-policy.js renderer/scripts/app.js preload/preload.js preload/mpv-overlay-preload.js main/ipc-handlers.js main/mpv-overlay-host.js
git diff --cached --quiet || git commit -m "테스트: mpv 협업 레이어 상호작용 회귀를 고정"
```

### Task 7: PR Review, Merge, Build, and Shared-Drive Deployment

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
- 👥 다른 작업자의 커서, 현재 작업 인원, 협업 연결 화면, 재생 동기화 상태가 영상과 동시에 정확히 보입니다.
- 🖱️ 그리기 중에도 협업 패널의 클릭·호버·토글·모드 선택·접기·닫기·드래그가 동작하며 원치 않는 선이 그어지지 않습니다.

## 🔧 상세 기술 설명

- `renderer/scripts/modules/mpv-surface-policy.js`에 `COLLABORATION_MIRROR`를 추가하고 `.collaborators-indicator`와 `.playback-sync-panel`을 일반 HTML 복제에서 분리했습니다. 협업 표면은 native mpv host 가시성에 영향을 주지 않습니다.
- `renderer/scripts/app.js`, `preload/preload.js`, `main/ipc-handlers.js`, `main/mpv-overlay-host.js`에 revision 기반 전용 협업 상태 경로를 추가했습니다. 신뢰된 정적 DOM이 인원·연결 상태·동기화 토글·주도/팔로우 상태를 렌더링하고, 플렉서스 캔버스는 제한된 PNG 스냅샷으로 초당 최대 15회 전달됩니다.
- Fabric 입력 활성 시 전용 컨트롤이 포인터 제스처를 capture 단계에서 중단하고 허용된 의미 동작만 현재 host/video/input/session fence와 함께 원본 핸들러로 전달합니다. 협업 동작을 위해 native mouse-ignore 모드를 전환하지 않습니다.
- 협업자 아바타의 템플릿 `innerHTML`을 제거하고 이름은 `textContent`, 색상은 검증된 `#RRGGBB`만 사용합니다. 상태와 동작 IPC도 정확한 키·크기·enum·revision 제한을 통과해야 적용됩니다.
- 조상 요소의 display/visibility/opacity와 overflow clipping을 반영한 유효 사각형 계산을 추가해, 접힌 `.collab-plexus-panel` 내부 요소가 가림 표면으로 오판되지 않게 했습니다.
- mpv 정책·호스트·preload·renderer·Fabric 통합 테스트에 레이어 순서, 축별 클리핑, 토글/라디오/캔버스 충실도, 악성 입력 차단, stale fence 거부, 드래그 종료와 accidental stroke 방지 회귀를 추가했습니다.

## 🚧 개발 난항

- 기존 수정은 협업 UI를 보이게 하려고 작은 패널이 영상과 겹칠 때 mpv 창 전체를 숨겼고, 그 결과 정상 재생 중인 영상까지 검게 보였습니다.
- 접힌 협업 플렉서스 패널은 높이와 투명도가 0이어도 내부 자식의 원본 좌표만 따로 검사되어 보이는 요소로 오판될 수 있었습니다. 후보 자체가 아니라 전체 조상 체인과 실제 잘린 영역을 계산하는 방식으로 수정했습니다.
- 첫 보완안인 일반 HTML 복제는 영상과 표시를 동시에 살렸지만, 그리기 활성 시 클릭 전달이 끊기고 체크/라디오의 현재 값과 CSS 의사 요소, 캔버스 픽셀이 복제되지 않는 문제가 리뷰에서 확인됐습니다. 협업 UI만 전용 상태와 의미 동작 경로로 분리해 세 문제를 함께 해결했습니다.
- 네이티브 창의 마우스 관통을 클릭 순간마다 전환하면 down/up 분리와 포인터 캡처 손실이 생길 수 있어, 고정된 입력 소유권 위에서 허용 동작만 전달하고 세대·세션 검증으로 오래된 입력을 버리는 구조를 사용했습니다.

## ✅ 테스트 가이드

### 실사용자용

1. 같은 영상을 두 PC에서 열고 협업 연결을 시작합니다.
2. 영상이 계속 보이고 재생되는 상태에서 상대방 커서와 현재 작업 인원이 표시되는지 확인합니다.
3. 협업 인원에 마우스를 올려 연결 화면이 보이는지, 다른 사람 커서 표시를 전환하고 동기화 패널을 열 수 있는지 확인합니다.
4. 그리기 모드에서 동기화 켜기/끄기, 주도/팔로우, 접기, 닫기, 드래그를 사용하고 원치 않는 선이 생기지 않는지 확인합니다.
5. 댓글 모달을 열어 영상이 필요한 동안만 가려지고 닫은 뒤 다시 보이는지 확인합니다.

### 개발자용

- `npm run test:mpv`
- `npm run test:collaboration`
- `npm run test:fabric-drawing-pilot`
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
npm run test:fabric-drawing-pilot
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
