# Fabric Selection Gesture Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fabric selection pointer release reliable across the mpv overlay boundary, preserve one-click stroke switching when viewport updates arrive mid-click, and give selected bounds an honest four-direction move cursor.

**Architecture:** Keep the session scene store as the only mutation owner. Add a small select-pointer state machine beside the existing brush pointer state, run Fabric and the runtime on the same pointer-event stream, and retain only the latest valid viewport command until the select gesture settles. Centralize selection interaction policy so unselected paths use per-pixel hit testing while only the current active object owns rectangular move hit testing.

**Tech Stack:** Electron 28, Fabric.js 7.4.0, CommonJS, Node.js `node:test`, esbuild, electron-builder.

## Global Constraints

- Work only in `C:/Users/user/.codex/worktrees/fabric-brush-style-v1/BAEFRAME` on `codex/baeframe-fabric-brush-style-v1`.
- Never modify or launch from `C:/BAEframe/BAEFRAME`.
- Never inspect, focus, close, stop, or reuse any existing BAEFRAME process.
- Follow strict TDD for every production behavior: add a failing test, run it and record the expected failure, then write the minimum implementation.
- Selection release, click switching, hover, cursor changes, and viewport application must not increase mutation, dirty, object, or save-attempt counters.
- A real object move continues to call the existing scene-store transform path exactly once.
- Cursor contract: brush `crosshair`; select blank `default`; unselected path `grab`; selected Path or ActiveSelection bounds `move`; active drag `grabbing`.
- Keep the existing six displayed CSS-pixel tolerance for unselected strokes.
- Do not modify playback, timeline, review persistence, IPC payloads, HTML drawing-engine behavior, Undo/Redo, eraser, or partial-stroke selection.
- Regenerate `renderer/scripts/lib/mpv-fabric-overlay.iife.js` from source; never edit it by hand.
- Commit messages are concise Korean descriptions of what, how, and why.

---

## File Map

- Modify `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`: select pointer ownership, deferred viewport application, and state-specific cursor/hit policy.
- Modify `scripts/tests/mpv-fabric-overlay-runtime.test.js`: real Fabric pointer interaction regressions and small fake-harness lifecycle assertions.
- Regenerate `renderer/scripts/lib/mpv-fabric-overlay.iife.js`: browser artifact produced from runtime source.
- Add no production files and change no app playback, timeline, persistence, or IPC files.

### Task 1: Guarantee select pointer completion and defer viewport updates

**Files:**
- Modify: `scripts/tests/mpv-fabric-overlay-runtime.test.js:17-179,300-442,444-659,780-930`
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js:580-609,1115-1237,1300-1313,1415-1425,1499-1528`
- Regenerate: `renderer/scripts/lib/mpv-fabric-overlay.iife.js`

**Behavioral interfaces:**
- Runtime owns one select gesture token: `{ pointerId, sessionId, inputRevision, phase }`.
- Runtime owns at most one deferred viewport record: `{ sessionId, inputRevision, command }`.
- `updateViewport()` returns `{ accepted: true, deferred: true, revision }` when a valid newer command is held during a select gesture.
- The applied `currentSession.viewportRevision` advances only when `applyViewport()` actually runs.

- [ ] **Step 1: Extend the test harness for pointer capture and pointer-based Fabric selection**

Add `setPointerCapture`, `releasePointerCapture`, and `hasPointerCapture` observability to the existing fake element only. Do not add test-only production methods. Record captured pointer IDs in a `Set` so tests can assert lifecycle without mocking Fabric behavior.

In `createRealFabricHarness()` replace selection-only mouse helpers with a single pointer dispatcher that can target either `upperCanvasEl` or `document` and defines `clientX`, `clientY`, `pointerId`, `pointerType`, `button`, `buttons`, and `pressure`. Keep real `fabric/node` Canvas and Path objects. Update marquee, ActiveSelection drag, stroke drag, and hover helpers to use pointer event names because production Canvas will enable Fabric pointer events.

Add a helper that performs pointerdown and pointermove but completes by dispatching pointerup only from `upperCanvasEl`; the event must bubble naturally to Fabric's document listener. Do not call Fabric private `_onMouseUp` or emit `object:modified` manually.

- [ ] **Step 2: Write the failing captured-release regression**

Add a real Fabric test named `captured select pointerup settles a moved marquee without a direct document mouseup`:

1. Draw two strokes and switch to `select`.
2. Create a real two-object marquee.
3. Pointerdown the ActiveSelection, pointermove on `document`, and pointerup only on `upperCanvasEl`.
4. Await two microtasks to allow Fabric completion and the guarded release.
5. Assert active objects and scene-store selection are empty.
6. Assert the two strokes moved by the requested delta, mutation count is exactly 3, and save attempt count is 0.
7. Assert the selection pointer was captured and released exactly once.

Run:

```powershell
node --test --test-name-pattern="captured select pointerup" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected RED: selection pointer capture is never requested and Fabric still listens to mouse events because `enablePointerEvents` is absent.

- [ ] **Step 3: Write the failing mid-click viewport regression**

Add a real Fabric test named `viewport update during a stroke click waits and preserves the new selection`:

1. Draw two separated strokes and switch to `select`.
2. Click the first stroke and confirm it is the only active object.
3. Pointerdown the second stroke.
4. Before pointerup, call `runtime.updateViewport()` with revision 1 and a valid changed canvasRect/scale.
5. Assert the command is accepted as deferred while the applied diagnostic revision remains 0.
6. Pointerup only on `upperCanvasEl`, await the settle microtask, and confirm revision 1 is now applied.
7. Assert the second stroke remains the only active object, no `selection:cleared` occurred during the switch, mutation count remains 2, and save attempt count is 0.
8. Click the first stroke once more and confirm one-click switching remains symmetric.

Add two focused lifecycle tests using the runtime's real public API and the existing fake harness:

- revisions 1, 3, and 2 received during one gesture apply only revision 3 after settle;
- disabling input or replacing the session/input revision before settle discards the deferred command and cannot mutate the new session.

Run:

```powershell
node --test --test-name-pattern="viewport update during|latest deferred viewport|stale deferred viewport" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected RED: current `updateViewport()` rerenders the scene, clears selection, and applies each command immediately.

- [ ] **Step 4: Implement one pointer stream and select gesture ownership**

Create Fabric Canvas with `enablePointerEvents: true` while preserving all current options.

Refactor the existing runtime pointer handlers so primary `pointerdown` branches by tool:

- brush: preserve the current `activeStroke` behavior;
- select: if no select gesture is active, store `{ pointerId, sessionId, inputRevision, phase: 'tracking' }` and call `setPointerCapture(pointerId)` without preventing propagation.

On a matching select `pointerup`:

1. mark the gesture `settling` before releasing capture;
2. release capture best-effort;
3. schedule one microtask to finish the gesture and flush a valid deferred viewport.

Ignore the `lostpointercapture` produced by the normal release while phase is `settling`. For `pointercancel`, unexpected lost capture, or blur, restore the target transform from `transformStart` when present, call Fabric's public `endCurrentTransform()` only after restoration so no real delta is persisted, clear local gesture/transform state, and discard its deferred viewport. Duplicate and mismatched pointer IDs are no-ops.

Clear select gesture and deferred viewport state in `disableInput()`, session replacement, resource release, and destroy paths. Preserve the current brush cancellation behavior.

- [ ] **Step 5: Implement latest-only deferred viewport application**

Extract the current successful viewport mutation into an internal `applyViewportCommand(command)` helper. It must:

- update `currentSession.canvasRect`, normalized viewport transform, and viewport revision;
- call `applyViewport(currentSession)`;
- never render the scene, discard the active object, or edit scene-store selection.

Change `updateViewport()` validation as follows:

- compare a command revision against the maximum of applied and pending revisions;
- reject lower/equal revisions as `stale-viewport`;
- if a select gesture or `transformStart` is active, store only the latest valid command with current session/input guards and return the deferred result;
- otherwise keep the existing brush cancellation behavior and apply immediately through the helper.

The select-settle microtask must first verify runtime, input, session ID, input revision, pointer identity, and absence of a newer gesture. It then clears a click-only `transformStart` that Fabric completed without `object:modified`, marks the gesture idle, and applies the deferred command if it is still newer and valid.

Do not advance the applied revision when queuing. Do not use `renderActiveScene()`, `discardActiveObject()`, or `sceneStore.selectObjects([])` in the ordinary viewport path.

**Binding review corrections:**

- Install matching-pointer document `pointerup` and `pointercancel` fallbacks so capture API failure cannot leave the gesture tracking forever. Release capture through the upper canvas, and use the gesture phase to make canvas-plus-document duplicate delivery a no-op.
- For transform-less blank marquee cancellation, drain Fabric's document lifecycle and then discard any selection produced by that synthetic completion. Assert both Fabric active objects and store selection are empty immediately after cancel/blur.
- Cancel an active brush stroke before accepting any higher enabled input/session token. A pointerup belonging to the replaced input must not add an object or mutation to the new session.
- The real Fabric harness must install capture behavior on its actual `upperCanvasEl`, retarget an outside release through that registry, and reproduce normal `lostpointercapture` before the settle microtask.

- [ ] **Step 6: Verify GREEN and existing runtime behavior**

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: all runtime tests pass with no warnings; the new tests prove one-click switching, newest-only viewport application, stale guard behavior, exact mutation counts, and zero save attempts.

- [ ] **Step 7: Regenerate the bundle and commit Task 1**

Run:

```powershell
npm.cmd run bundle:mpv-fabric-overlay
git diff --check
git status --short
```

Verify only the declared source, test, and generated bundle changed. Then stage those three files and commit:

```powershell
git commit -m "fix: Fabric 선택 입력 종료와 화면 갱신 충돌 해소"
```

### Task 2: Give only active selection bounds the move cursor

**Files:**
- Modify: `scripts/tests/mpv-fabric-overlay-runtime.test.js:300-498,700-930`
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js:911-968,984-1009,1151-1180,1218-1222,1252-1261`
- Regenerate: `renderer/scripts/lib/mpv-fabric-overlay.iife.js`

**Behavioral interfaces:**
- Unselected permanent Path policy: `perPixelTargetFind: true`, `hoverCursor: 'grab'`, `moveCursor: 'grabbing'`.
- Selected single Path policy: `perPixelTargetFind: false`, `hoverCursor: 'move'`, `moveCursor: 'grabbing'`.
- Selected ActiveSelection policy: group `perPixelTargetFind: false`, `hoverCursor: 'move'`, `moveCursor: 'grabbing'`; child paths retain unselected policy.

- [ ] **Step 1: Write failing real Fabric selected-bounds tests**

Add a real Fabric test named `selected stroke owns its full bounds with a move cursor and restores pixel hit testing on switch`:

1. Draw two diagonal or curved strokes with separated bounds and switch to select.
2. Click the first stroke.
3. Hover inside its rectangular bounding box but away from painted pixels.
4. Assert Fabric resolves the first Path and the canvas cursor is `move`.
5. Drag from that transparent point and assert only the first stroke moves, with cursor `grabbing` during the drag.
6. Click the second stroke once.
7. Assert the first Path returned to `perPixelTargetFind: true` and `grab`, while the second Path has selected bounds and `move`.
8. Assert blank space remains `default`, mutation increments only for the one real move, and save attempt remains 0.

Add a second real Fabric test named `active selection bounds use move and released strokes return to grab`:

1. Marquee-select two strokes.
2. Hover an empty point inside the ActiveSelection bounds and assert target group plus `move`.
3. Drag and assert `grabbing` during movement.
4. Await automatic release and assert both paths returned to per-pixel `grab` while blank space is `default`.

Run:

```powershell
node --test --test-name-pattern="selected stroke owns|active selection bounds" scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected RED: selected Path keeps per-pixel hit testing, transparent selected bounds resolve to no target, and current active objects use `grab` rather than `move`.

- [ ] **Step 2: Centralize and implement selection interaction policy**

Split the current generic `applyMoveOnlyConstraints()` responsibilities:

- keep movement locks in a move-only constraint helper;
- add an unselected permanent-Path helper that sets the existing tolerance, `perPixelTargetFind: true`, `hoverCursor: 'grab'`, and `moveCursor: 'grabbing'`;
- add a selected-active helper that sets `perPixelTargetFind: false`, `hoverCursor: 'move'`, and `moveCursor: 'grabbing'` on the active Path or ActiveSelection group.

Add one `refreshSelectionInteractionPolicy()` entry point:

1. reset every non-transient permanent Path to unselected policy;
2. inspect `fabricCanvas.getActiveObject()`;
3. apply selected policy only to that Path or group;
4. call `setCoords()` and request rendering only when the caller needs it.

Call it after:

- `selection:created` and `selection:updated`;
- `selection:cleared`;
- automatic moved-multi-selection release;
- `setToolMode()`;
- viewport tolerance changes;
- scene restoration.

For ActiveSelection, do not set its child paths to rectangular selected hit mode. This keeps the group as the sole rectangular target and ensures paths return cleanly to per-pixel behavior after release.

- [ ] **Step 3: Verify GREEN and all runtime tests**

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js
```

Expected: all tests pass with no warnings. Confirm direct one-click switching, selected transparent bounds, ActiveSelection bounds, release restoration, mutation counts, and zero save attempts.

- [ ] **Step 4: Regenerate the bundle and commit Task 2**

Run:

```powershell
npm.cmd run bundle:mpv-fabric-overlay
git diff --check
git status --short
```

Verify only the declared files changed, stage them, and commit:

```powershell
git commit -m "fix: Fabric 선택 상자 이동 커서와 판정 일치"
```

### Task 3: Regression gate, independent review, build, parity, and isolated launch

**Files:**
- Verify only; change production files only if a new failing regression test demonstrates a defect.
- Update ignored progress evidence under `.superpowers/sdd/` as needed.

- [ ] **Step 1: Run the complete focused regression matrix**

Run this exact suite from the isolated worktree:

```powershell
node --test scripts/tests/fabric-drawing-pilot-source.test.js scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/fabric-drawing-pilot-session.test.js scripts/tests/fabric-drawing-pilot-integration.test.js scripts/tests/fabric-drawing-pilot-benchmark.test.mjs scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/keyboard-shortcut-targets.test.js
npm.cmd run test:drawing
npm.cmd run test:mpv
git diff --check
git status --short
```

Record exact pass/fail counts and warnings. Any production fix requires a new RED test before the fix, a GREEN run afterward, bundle regeneration, and a separate Korean commit.

- [ ] **Step 2: Request an independent whole-branch review**

Review the range from pre-design base `8e8748e` to current HEAD against:

- `docs/superpowers/specs/2026-07-21-fabric-selection-gesture-stability-design.md`
- this implementation plan
- the three user-reported interaction failures

The review must check stale-session guards, pointer lifecycle ordering, viewport revision monotonicity, mutation/save invariants, cursor policy restoration, and generated bundle parity. Fix every Critical or Important finding through TDD, re-run affected tests, and request re-review until approved.

- [ ] **Step 3: Build the unpacked test application**

Run:

```powershell
npm.cmd run build
```

Verify exit code 0 and the existence of:

- `dist/win-unpacked/BFRAME_alpha_v2.exe`
- `dist/win-unpacked/resources/app.asar`

Compute SHA-256 hashes for both artifacts and record them.

- [ ] **Step 4: Verify source-to-app.asar bundle parity**

Extract only `renderer/scripts/lib/mpv-fabric-overlay.iife.js` from `dist/win-unpacked/resources/app.asar` with the installed `@electron/asar` package into a temporary evidence directory under `.superpowers/sdd/`. Compare its SHA-256 with the worktree source bundle and require exact equality. Do not edit the asar or use the main checkout's artifacts.

- [ ] **Step 5: Launch one new isolated test instance**

Create a unique profile name in the form `fabric-selection-gesture-YYYYMMDD-HHmmss-fff`. Launch only:

```text
dist/win-unpacked/BFRAME_alpha_v2.exe
  --fabric-drawing-pilot
  --skip-shell-registration
  --multi-instance-profile=<unique profile>
```

Set `BAEFRAME_MPV_PILOT=1` and `BAEFRAME_FABRIC_DRAWING_PILOT=1` only for that child process, then restore the parent shell environment. Do not enumerate, inspect, focus, stop, or reuse any other BAEFRAME process.

- [ ] **Step 6: Hand off the manual checkpoint**

Report the unique profile, artifact hashes, automated pass counts, review verdict, and this exact manual sequence:

1. 재생 중 B로 진입해 두 획을 그린다.
2. V에서 두 획을 사각 선택해 이동하고 놓는다. 점선 상자가 사라지는지 본다.
3. 첫 획과 다른 획을 번갈아 한 번씩 클릭한다. 첫 클릭마다 바로 선택되는지 본다.
4. 선택 상자 안은 사방 이동 커서, 드래그 중은 잡은 커서, 해제 후 획은 손 모양, 빈 곳은 기본 커서인지 본다.
5. B와 Space를 반복하고 재생 깜빡임, 이중 재생, 타임라인 점프, 저장 실패 알림이 없는지 본다.

Stop at this checkpoint for the user's real interaction verdict. Begin whole-stroke rectangle/lasso/circle selection only after this stability build is accepted; no additional design-approval pause is required.
