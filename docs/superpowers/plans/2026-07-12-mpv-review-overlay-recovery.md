# mpv 리뷰 오버레이 회귀 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mpv 기본 재생에서 드로잉·댓글 마커가 다시 보이고 조작되며, 댓글/그리기 진입과 종료 중 영상이 검게 비지 않도록 한다.

**Architecture:** 먼저 native mpv 위에 표시되는 별도 overlay 문서가 실제로 실행 가능한지 로드 시 검증하고, 실패한 mpv 경로는 HTML5 재생으로 되돌린다. 댓글/그리기처럼 원본 DOM 입력이 필요한 동안에는 mpv 프레임을 PNG로 준비·decode한 뒤에만 native host를 숨기고, 종료 시 native host 복구가 확인된 뒤 PNG를 제거한다.

**Tech Stack:** Electron 28, Node.js test runner, mpv JSON IPC, Canvas/DOM overlay, Windows child BrowserWindow

## Global Constraints

- 기존 `.bframe` 저장 형식은 변경하지 않는다.
- `mpv/` 바이너리 폴더는 변경하지 않는다.
- HTML5 fallback 동작은 유지한다.
- 테스트는 production code보다 먼저 작성하고, 현재 코드에서 의도한 이유로 실패하는 것을 확인한다.
- 사용자 `main` checkout의 미커밋 파일은 건드리지 않고 전용 worktree에서만 작업한다.
- 댓글/그리기 화면 준비 실패 시 native 영상은 계속 보여야 하며 검은 화면에 고정되면 안 된다.
- PR 제목·본문·커밋 메시지는 한국어로 작성한다.

---

### Task 1: mpv overlay 문서 실행 계약 복구

**Files:**
- Modify: `main/mpv-overlay-host.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`

**Interfaces:**
- Consumes: `MPVOverlayHost.ensure(bounds)`, `updateState(state)`, `updateRemoteCursorState(html)`
- Produces: overlay 전역 함수 readiness가 확인된 경우에만 `{ success: true }`를 반환하는 `ensure()`

- [ ] **Step 1: cooked inline script가 파싱돼야 한다는 실패 테스트 작성**

`creates a click-through overlay window above the viewer area` 테스트에서 `loadURL` 이벤트의 data URL을 decode하고 실제 inline script를 컴파일한다.

```js
const overlayDocument = decodeURIComponent(loadUrl.replace(/^data:text\/html;charset=utf-8,/, ''));
const inlineScript = overlayDocument.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, 'overlay inline script should exist');
assert.doesNotThrow(() => new Function(inlineScript));
```

- [ ] **Step 2: RED 확인**

Run: `node --test scripts/tests/mpv-overlay-host.test.js`

Expected: `Invalid regular expression: /expressions*(/i: Unterminated group`로 실패.

- [ ] **Step 3: readiness 실패 계약 테스트 작성**

가짜 `executeJavaScript`가 readiness 표현식에 `false`를 반환하도록 만들고 다음을 검증한다.

```js
assert.equal(result.success, false);
assert.match(result.error, /overlay API/i);
assert.equal(host.contentLoaded, false);
```

또한 readiness 전 `updateState()`는 apply script를 보내지 않고 `{ success: false }`를 반환해야 한다.

- [ ] **Step 4: 최소 구현**

embedded script의 backslash가 보존되도록 기존 선언의 시작 부분만 `const OVERLAY_HTML = \``에서 `const OVERLAY_HTML = String.raw\``로 바꾸고, template body는 그대로 유지한다. load 후에는 두 API를 아래 expression으로 검증한다.

```js
const OVERLAY_API_READY_SCRIPT = [
  "typeof window.__applyMpvOverlayState === 'function'",
  "typeof window.__applyMpvRemoteCursorState === 'function'"
].join(' && ');
```

`ensure()`는 `loadURL()` 다음에 readiness expression을 실행하고 `true`일 때만 `contentLoaded = true`로 둔다. `updateState()`와 `updateRemoteCursorState()`는 window뿐 아니라 `contentLoaded`도 확인한다.

- [ ] **Step 5: GREEN 확인**

Run: `node --test scripts/tests/mpv-overlay-host.test.js`

Expected: 전체 통과, cooked script compile 통과, readiness false 테스트 통과.

- [ ] **Step 6: 커밋**

```powershell
git add main/mpv-overlay-host.js scripts/tests/mpv-overlay-host.test.js
git commit -m "fix: mpv 오버레이 문서 실행 상태 검증"
```

---

### Task 2: overlay 불능 시 mpv 채택 중단 및 실패 폭주 차단

**Files:**
- Modify: `renderer/scripts/app.js`
- Modify: `scripts/tests/mpv-runtime-source.test.js`

**Interfaces:**
- Consumes: Task 1의 `mpvPrepareOverlay()` readiness 결과
- Produces: `mpvOverlayHostReady` renderer 상태와 HTML5 fallback으로 이어지는 fail-closed mpv load

- [ ] **Step 1: overlay 준비 결과가 필수라는 실패 테스트 작성**

`mpv-runtime-source.test.js`에서 `loadVideoWithMpvPilot()`이 overlay 결과를 보관하고 실패 시 throw하는 계약을 추가한다.

```js
assert.match(loadMpvSource, /overlayHost = await prepareMpvOverlayHost\(\);/);
assert.match(loadMpvSource, /if \(!overlayHost\) \{[\s\S]+throw new Error\('mpv 오버레이 호스트 준비 실패'\);/);
```

상태 sync는 `mpvOverlayHostReady`가 false면 PNG snapshot을 만들기 전에 return하고, IPC 결과가 `{ success:false }`면 ready를 false로 내려야 한다.

- [ ] **Step 2: RED 확인**

Run: `node --test scripts/tests/mpv-runtime-source.test.js`

Expected: overlay host result가 무시되는 현재 코드 때문에 실패.

- [ ] **Step 3: 최소 구현**

`renderer/scripts/app.js`에 `let mpvOverlayHostReady = false;`를 두고 다음 계약을 구현한다.

```js
overlayHost = await prepareMpvOverlayHost();
if (!overlayHost) {
  throw new Error('mpv 오버레이 호스트 준비 실패');
}
mpvOverlayHostReady = true;
```

`syncMpvOverlayState()`와 remote cursor sync는 ready가 아니면 `getMpvOverlayState()` 전에 return한다. IPC 응답 실패 시 ready를 false로 내리고 한 번만 warning을 남긴다. stop/cleanup/new prepare에서 상태를 reset한다.

- [ ] **Step 4: GREEN 확인**

Run: `node --test scripts/tests/mpv-runtime-source.test.js scripts/tests/mpv-recovery-source.test.js`

Expected: 전체 통과.

- [ ] **Step 5: 커밋**

```powershell
git add renderer/scripts/app.js scripts/tests/mpv-runtime-source.test.js
git commit -m "fix: mpv 오버레이 실패 시 안전한 재생 폴백"
```

---

### Task 3: 댓글·그리기용 안전한 mpv 정지 화면 전환

**Files:**
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/styles/main.css`
- Modify: `scripts/tests/mpv-runtime-source.test.js`
- Modify: `scripts/tests/mpv-recovery-source.test.js`
- Modify: `scripts/tests/comment-input-focus-source.test.js`

**Interfaces:**
- Consumes: `window.electronAPI.mpvScreenshot()`, `mpvSetHostVisible(visible)`
- Produces: `showMpvReviewFreezeFrame()`, `releaseMpvReviewFreezeFrame()`, `isMpvReviewInteractionActive()`

- [ ] **Step 1: 댓글 모드도 native host를 안전하게 차단한다는 실패 테스트 작성**

다음 계약을 source tests에 추가한다.

```js
assert.match(appSource, /function isMpvReviewInteractionActive\(\) \{[\s\S]+state\.isDrawMode \|\| state\.isCommentMode/);
assert.match(appSource, /\.video-wrapper\.mpv-review-freeze-ready/);
assert.doesNotMatch(blockingSelectorSource, /\.drawing-tools\.visible/);
assert.match(commentModeHandler, /videoPlayer\.pause\(\);[\s\S]+showMpvReviewFreezeFrame\(\)/);
```

- [ ] **Step 2: freeze decode와 host ordering 실패 테스트 작성**

`mpv-recovery-source.test.js`에서 candidate image의 `decode()`가 끝난 뒤에만 `mpv-review-freeze-ready`를 추가하고, release는 `mpvSetHostVisible(true)` 응답 뒤 element를 제거하는지 검증한다.

```js
assert.match(showSource, /candidate\.src = result\.dataUrl;[\s\S]+await candidate\.decode\(\);[\s\S]+classList\.add\('mpv-review-freeze-ready'\)/);
assert.match(releaseSource, /await window\.electronAPI\.mpvSetHostVisible\(true\)[\s\S]+freezeElement\.remove\(\)/);
```

초기 capture/decode 실패는 ready class를 추가하지 않고 mode를 해제해야 한다.

- [ ] **Step 3: draw playback refresh가 throttle된다는 실패 테스트 작성**

현재의 `clearTimeout + 재예약` debounce를 금지하고 pending timer가 있으면 유지하는 계약을 추가한다.

```js
assert.match(scheduleSource, /if \(mpvReviewFreezeRefreshTimer\) return;/);
assert.doesNotMatch(scheduleSource, /clearTimeout\(mpvReviewFreezeRefreshTimer\)/);
```

- [ ] **Step 4: RED 확인**

Run: `node --test scripts/tests/mpv-runtime-source.test.js scripts/tests/mpv-recovery-source.test.js scripts/tests/comment-input-focus-source.test.js`

Expected: draw-only freeze, premature `.drawing-tools.visible` blocker, debounce 때문에 실패.

- [ ] **Step 5: 최소 구현**

기존 `mpvDrawFreeze*`를 review interaction 공용 surface로 바꾼다.

```js
function isMpvReviewInteractionActive() {
  return state.isDrawMode || state.isCommentMode;
}

async function showMpvReviewFreezeFrame() {
  const result = await window.electronAPI.mpvScreenshot();
  const candidate = new Image();
  candidate.src = result.dataUrl;
  await candidate.decode();
  // token/mode 재확인 후 기존 freeze를 갱신하거나 생성
  elements.videoWrapper.classList.add('mpv-review-freeze-ready');
  forceMpvHostVisibilitySync();
}
```

초기 준비 실패는 기존 native host를 숨기지 않고 해당 댓글/그리기 mode를 해제하며 오류 toast를 표시한다. 기존 정상 freeze가 있는 refresh 실패는 마지막 정상 프레임을 유지한다.

`releaseMpvReviewFreezeFrame()`은 ready class를 먼저 제거하고, 다른 blocking overlay가 없으면 `mpvSetHostVisible(true)` 성공을 기다린 다음 freeze element를 제거한다. stale token이면 새 mode가 활성화된 것으로 보고 제거하지 않는다.

댓글 모드 진입 시 mpv를 pause하고 공용 freeze를 준비한다. 댓글 확정/Escape/토글로 mode가 끝나면 release한다. draw mode 및 mpv 로드/영상 전환도 같은 함수만 사용한다.

refresh scheduler는 timer가 이미 있으면 그대로 두는 throttle로 바꿔 120ms frame polling이 160ms refresh를 영원히 밀어내지 못하게 한다.

- [ ] **Step 6: 스타일 보강**

```css
.mpv-review-freeze-frame {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  object-fit: fill;
}
```

검은 background fallback을 두지 않는다. 캔버스 z-index 2~4 아래에 고정한다.

- [ ] **Step 7: GREEN 확인**

Run: `npm run test:mpv`

Run: `npm run test:drawing`

Run: `npm run test:comment-input`

Expected: 0 failures.

- [ ] **Step 8: 커밋**

```powershell
git add renderer/scripts/app.js renderer/styles/main.css scripts/tests/mpv-runtime-source.test.js scripts/tests/mpv-recovery-source.test.js scripts/tests/comment-input-focus-source.test.js
git commit -m "fix: mpv 댓글·그리기 화면 전환 안정화"
```

---

### Task 4: 통합 검증·릴리스 기록

**Files:**
- Modify: `DEVLOG/2026-07-12-mpv-드로잉-댓글-회귀-수정.md`

**Interfaces:**
- Consumes: Tasks 1~3의 최종 동작
- Produces: 재현·원인·검증·배포 근거

- [ ] **Step 1: 관련 전체 자동 검증**

Run: `npm run test:mpv`

Run: `npm run test:drawing`

Run: `npm run test:comment-input`

Run: `npm run test:video-pan`

Run: `npm run test:frame-grid`

Run: `npm run test:cluster`

Run: `git diff --check`

Run: `npm run build`

Expected: 모든 명령 exit 0.

- [ ] **Step 2: 실제 Electron smoke test**

작은 테스트 영상으로 별도 multi-instance profile을 열고 다음을 확인한다.

1. mpv 기본 재생 중 기존 drawing/marker mirror가 보인다.
2. `C` → 영상 중앙 클릭 시 base frame이 유지되고 pending marker/input이 보인다.
3. Escape/확정 후 native 영상이 검은 flash 없이 복구된다.
4. 그리기 진입 후 base frame과 stroke가 같이 보인다.
5. draw mode Space 재생 중 freeze frame이 주기적으로 갱신된다.

- [ ] **Step 3: DEVLOG 상태와 증거 갱신**

테스트 수, 실제 smoke 결과, PR/review/merge/deploy/hash 결과를 문서에 기록한다.

- [ ] **Step 4: 커밋**

```powershell
git add DEVLOG/2026-07-12-mpv-드로잉-댓글-회귀-수정.md
git commit -m "docs: mpv 리뷰 오버레이 회귀 검증 기록"
```
