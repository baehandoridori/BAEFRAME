# Layer Compositing Editing UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add practical layer editing controls for duplicate, reorder, aspect-locked resize, snapping, and missing-file relink.

**Architecture:** Keep the feature inside `CompositionLayerManager` because layer state, panel rendering, overlay transform, and timeline sync already meet there. Add small pure helpers for duplicate, rect resize, and snap so behavior is testable without Electron.

**Tech Stack:** Electron renderer JavaScript modules, Node built-in `node:test`, existing CSS and BFRAME schema validators.

## Global Constraints

- Do not add export/render-output video support in this phase.
- Do not add numeric inspector fields for position, size, start time, or end time.
- Keep drag reorder, selection, deletion, visibility, and timeline range editing working.
- Store only durable layer data in `.bframe`; do not persist runtime `missing` state.
- Touch mpv overlay sync only if renderer state shape changes.

---

### Task 1: Lock The Data And Helper Behavior With Tests

**Files:**
- Modify: `scripts/tests/composition-layer-manager.test.js`
- Modify: `scripts/tests/composition-layer-schema.test.js`
- Modify: `scripts/tests/composition-layer-runtime-source.test.js`

**Interfaces:**
- Consumes: existing exports from `renderer/scripts/modules/composition-layer-manager.js`
- Produces: failing tests for `aspectLocked`, `duplicateCompositionLayer`, `resizeLayerRect`, `snapCompositionLayerRect`, `duplicateLayer`, `moveLayerByOffset`, and `relinkLayerFile`

- [ ] **Step 1: Add failing unit tests**

Add tests that import and call the new helper names directly.

- [ ] **Step 2: Run red test**

Run: `node --test scripts/tests/composition-layer-manager.test.js scripts/tests/composition-layer-schema.test.js scripts/tests/composition-layer-runtime-source.test.js`

Expected: FAIL because the new helper exports and schema field do not exist yet.

### Task 2: Implement Layer State Helpers

**Files:**
- Modify: `renderer/scripts/modules/composition-layer-manager.js`
- Modify: `shared/schema.js`
- Modify: `shared/validators.js`
- Modify: `docs/bframe-schema.md`

**Interfaces:**
- Produces: `aspectLocked` persistence, `duplicateCompositionLayer(layers, layerId, options)`, `resizeLayerRect(layer, handle, deltaX, deltaY, options)`, `snapCompositionLayerRect(rect, options)`

- [ ] **Step 1: Add `aspectLocked` normalization and serialization**

Default `aspectLocked` to `true`, preserve explicit `false`, serialize it, document it, and validate optional boolean values.

- [ ] **Step 2: Add duplicate and transform helpers**

Implement duplicate, aspect resize, and snap as pure exports.

- [ ] **Step 3: Run green helper tests**

Run: `node --test scripts/tests/composition-layer-manager.test.js scripts/tests/composition-layer-schema.test.js`

Expected: PASS.

### Task 3: Wire Panel And Overlay UX

**Files:**
- Modify: `renderer/scripts/modules/composition-layer-manager.js`
- Modify: `renderer/styles/main.css`
- Modify: `scripts/tests/composition-layer-runtime-source.test.js`

**Interfaces:**
- Consumes: Task 2 helper exports
- Produces: row buttons for move up, move down, duplicate, aspect lock, relink; snap guide DOM; selected-state visual improvements

- [ ] **Step 1: Add panel row actions**

Render `data-action="move-up"`, `data-action="move-down"`, `data-action="duplicate"`, `data-action="aspect-lock"`, and `data-action="relink"` controls and handle them in `_handlePanelClick`.

- [ ] **Step 2: Use helper behavior during overlay drag**

Use `resizeLayerRect()` for handle drags and `snapCompositionLayerRect()` for move/resize. Render `.composition-layer-snap-guide` elements while snapping and clear them on pointer up.

- [ ] **Step 3: Add relink behavior**

Implement `relinkLayerFile(layerId)` using the existing open-file dialog and video duration probe.

- [ ] **Step 4: Run runtime source tests**

Run: `node --test scripts/tests/composition-layer-runtime-source.test.js`

Expected: PASS.

### Task 4: Verify Integrated Behavior

**Files:**
- All touched files

**Interfaces:**
- Consumes: all previous tasks
- Produces: passing targeted test suite and running preview

- [ ] **Step 1: Run focused tests**

Run: `node --test scripts/tests/composition-layer-manager.test.js scripts/tests/composition-layer-schema.test.js scripts/tests/composition-layer-runtime-source.test.js`

Expected: PASS.

- [ ] **Step 2: Run mpv overlay tests**

Run: `npm run test:mpv`

Expected: PASS.

- [ ] **Step 3: Run syntax checks**

Run: `node --check renderer/scripts/modules/composition-layer-manager.js && node --check shared/schema.js && node --check shared/validators.js`

Expected: PASS.

- [ ] **Step 4: Start or refresh the preview**

Run the existing Electron dev command if needed and give the user the active preview context.
