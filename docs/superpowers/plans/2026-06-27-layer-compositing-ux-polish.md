# Layer Compositing UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BAEFRAME composition layers compact, easier to control from both the panel and timeline, and safer when media files are dropped onto the viewer.

**Architecture:** Keep `CompositionLayerManager` as the source of truth for layer state and compact panel rendering. Use the existing `Timeline` event bridge for timeline visibility and selection controls. Keep drag/drop decision logic in `renderer/scripts/app.js` where video loading and layer insertion already live.

**Tech Stack:** Electron renderer JavaScript, existing DOM/CSS modules, Node built-in `node:test`, source-level runtime tests.

## Global Constraints

- Do not change the `.bframe` persistence model beyond already-supported composition layer fields.
- Keep converted display paths runtime-only.
- Do not add export/render-out support in this pass.
- Preserve current MPV overlay synchronization behavior.
- Do not touch Bflow files or processes.

---

### Task 1: Lock The New UX With Failing Tests

**Files:**
- Modify: `scripts/tests/composition-layer-manager.test.js`
- Modify: `scripts/tests/composition-layer-runtime-source.test.js`

**Interfaces:**
- Consumes: `CompositionLayerManager.addLayerFromFile(filePath, options)`
- Produces: test coverage for topmost/newest display order, compact panel source, context menu source, timeline visibility controls, drop choice source, and WebP/WebM alpha-preserving media handling.

- [x] **Step 1: Add behavior/source tests**

Add tests that assert new layer insertion is visually topmost, source-level compact row markers, timeline visibility controls, panel wheel isolation, resizable panel styles, drop choice modal source, and alpha-capable WebP/WebM media handling.

- [x] **Step 2: Run tests to verify red**

Run: `node --test scripts/tests/composition-layer-manager.test.js scripts/tests/composition-layer-runtime-source.test.js`

Expected: FAIL because the compact panel, timeline controls, and drop choice source markers are not implemented.

### Task 2: Compact The Composition Panel

**Files:**
- Modify: `renderer/scripts/modules/composition-layer-manager.js`
- Modify: `renderer/styles/main.css`

**Interfaces:**
- Produces: compact rows, eye icon visibility toggle, clearer media type labels, visible aspect lock label, context menu editor, panel wheel isolation, resize handle.

- [x] **Step 1: Render newest/topmost layers first**
- [x] **Step 2: Replace inline color/source controls with context menu fields**
- [x] **Step 3: Move duplicate/delete/color/name controls into the context menu**
- [x] **Step 4: Stop wheel propagation from the panel**
- [x] **Step 5: Add CSS for compact rows, context menu, and resize handle**

### Task 3: Align Timeline Controls

**Files:**
- Modify: `renderer/scripts/modules/timeline.js`
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/styles/main.css`

**Interfaces:**
- Produces: timeline eye toggle, image/video labels, same visual order as panel, and event bridge `compositionLayerVisibilityToggle`.

- [x] **Step 1: Render timeline composition headers in topmost-first order**
- [x] **Step 2: Add visibility button and media type badge in timeline headers**
- [x] **Step 3: Bridge timeline visibility event to `CompositionLayerManager.updateLayer`**
- [x] **Step 4: Verify panel order and timeline order match**

### Task 4: Make Dropped Media Choice Explicit

**Files:**
- Modify: `renderer/scripts/app.js`

**Interfaces:**
- Produces: `chooseDroppedVideoAction(filePath)` and drop handling that asks whether a video should open as the base video or be added as a composition layer when a base video is already loaded.

- [x] **Step 1: Add video drop choice helper**
- [x] **Step 2: Apply helper in main drop handler before choosing open-vs-overlay behavior**
- [x] **Step 3: Keep non-video composition files going straight to composition layer when base video is loaded**

### Task 5: Verify And Restart Preview

**Files:**
- All touched files

**Interfaces:**
- Produces: passing focused tests, MPV regression confidence, syntax checks, refreshed Electron dev app.

- [x] **Step 1:** Run focused composition tests.
- [x] **Step 2:** Run `npm run test:mpv`.
- [x] **Step 3:** Run syntax and diff checks.
- [x] **Step 4:** Restart only the f420 BAEFRAME Electron dev app.
