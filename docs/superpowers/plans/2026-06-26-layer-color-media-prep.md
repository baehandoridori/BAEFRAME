# Layer Color And Media Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-layer colors and runtime media preparation for composition video layers.

**Architecture:** Extend `CompositionLayerManager` with pure color helpers and runtime media state. Keep FFmpeg probing/transcoding in `renderer/scripts/app.js` through an injected `prepareMedia` callback.

**Tech Stack:** Electron renderer JavaScript modules, existing FFmpeg IPC, Node built-in `node:test`, CSS variables.

## Global Constraints

- Persist `color` and `selectedColor`; do not persist `displayFilePath`, `mediaStatus`, or `mediaMessage`.
- Keep original `filePath` unchanged even when a converted cache file is used for display.
- Do not add export-video support in this phase.
- Do not introduce MPV-backed per-layer native windows.

---

### Task 1: Add Failing Tests

**Files:**
- Modify: `scripts/tests/composition-layer-manager.test.js`
- Modify: `scripts/tests/composition-layer-schema.test.js`
- Modify: `scripts/tests/composition-layer-runtime-source.test.js`

**Interfaces:**
- Produces: tests for `color`, `selectedColor`, `prepareLayerMedia(layerId)`, runtime `displayFilePath`, and UI source wiring.

- [x] **Step 1: Write tests**

Add tests that assert automatic colors, custom color normalization, runtime media status filtering, and app-level FFmpeg preparation wiring.

- [x] **Step 2: Verify red**

Run: `node --test scripts/tests/composition-layer-manager.test.js scripts/tests/composition-layer-schema.test.js scripts/tests/composition-layer-runtime-source.test.js`

Expected: FAIL because color helpers and media resolver are not implemented.

### Task 2: Implement Color State

**Files:**
- Modify: `renderer/scripts/modules/composition-layer-manager.js`
- Modify: `shared/schema.js`
- Modify: `shared/validators.js`
- Modify: `docs/bframe-schema.md`

**Interfaces:**
- Produces: `color`, `selectedColor`, `getAutomaticCompositionLayerColors(index)`, color validation.

- [x] **Step 1: Add color helpers and normalization**
- [x] **Step 2: Serialize color fields**
- [x] **Step 3: Validate optional hex colors**

### Task 3: Implement Runtime Media Preparation

**Files:**
- Modify: `renderer/scripts/modules/composition-layer-manager.js`
- Modify: `renderer/scripts/app.js`
- Modify: `main/mpv-overlay-host.js`

**Interfaces:**
- Produces: `prepareLayerMedia(layerId)`, `displayFilePath`, `mediaStatus`, app callback `prepareCompositionLayerMedia(filePath)`.

- [x] **Step 1: Add manager runtime media state**
- [x] **Step 2: Inject app callback using existing FFmpeg IPC**
- [x] **Step 3: Send display file URL to normal and MPV overlays**

### Task 4: Wire UI

**Files:**
- Modify: `renderer/scripts/modules/composition-layer-manager.js`
- Modify: `renderer/scripts/modules/timeline.js`
- Modify: `renderer/styles/main.css`

**Interfaces:**
- Produces: color swatches, media status badges, CSS-variable-driven preview and timeline colors.

- [x] **Step 1: Add row color inputs**
- [x] **Step 2: Apply colors to preview and timeline**
- [x] **Step 3: Add media status badge styles**

### Task 5: Verify

**Files:**
- All touched files

**Interfaces:**
- Produces: passing tests and refreshed dev app.

- [x] **Step 1:** Run focused composition tests.
- [x] **Step 2:** Run `npm run test:mpv`.
- [x] **Step 3:** Run syntax/lint checks.
- [x] **Step 4:** Restart the f420 Electron dev app.
