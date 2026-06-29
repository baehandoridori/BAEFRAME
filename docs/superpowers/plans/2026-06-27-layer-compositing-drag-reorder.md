# Layer Compositing Drag Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-to-reorder support from the composition timeline headers and make layer-panel reorder dragging feel smooth and legible.

**Architecture:** Keep `CompositionLayerManager` as the order source of truth. Add a display-order reorder helper there, emit a timeline reorder event from `Timeline`, and bridge it in `renderer/scripts/app.js`. Use CSS classes during native drag interactions for live drop-position feedback and smooth transitions.

**Tech Stack:** Electron renderer JavaScript, existing DOM events, CSS transitions, Node built-in `node:test`.

## Global Constraints

- Do not change the `.bframe` persisted layer schema.
- Keep panel order, timeline order, and render order using the existing rule: higher `order` is visually above lower `order`.
- Do not touch Bflow files or processes.
- Verify with focused composition tests, syntax checks, and exact-worktree Electron restart only.

---

### Task 1: Lock Reorder Semantics With Tests

**Files:**
- Modify: `scripts/tests/composition-layer-manager.test.js`
- Modify: `scripts/tests/composition-layer-runtime-source.test.js`

**Interfaces:**
- Consumes: existing `CompositionLayerManager.reorderLayer(layerId, targetIndex)`
- Produces: expected API `CompositionLayerManager.reorderLayerByDisplayTarget(layerId, targetLayerId, placement)`

- [x] **Step 1: Add manager behavior test**

Add a test that drags a source layer before/after a visual target and asserts saved order changes correctly.

- [x] **Step 2: Add source tests**

Add source tests for timeline `compositionLayerReorder`, app bridge, panel drag classes, timeline drag classes, and CSS transitions.

- [x] **Step 3: Run focused tests to verify red**

Run: `node --test scripts/tests/composition-layer-manager.test.js scripts/tests/composition-layer-runtime-source.test.js`

Expected: FAIL because the helper, timeline event, app bridge, and drag-feedback classes are missing.

### Task 2: Add Shared Display-Order Reorder Helper

**Files:**
- Modify: `renderer/scripts/modules/composition-layer-manager.js`

**Interfaces:**
- Consumes: `reorderLayer(layerId, targetIndex)`
- Produces: `reorderLayerByDisplayTarget(layerId, targetLayerId, placement = 'before')`

- [x] **Step 1: Implement display-order index calculation**
- [x] **Step 2: Use it from panel drop**
- [x] **Step 3: Add panel drag state classes and cleanup**

### Task 3: Add Timeline Header Reorder

**Files:**
- Modify: `renderer/scripts/modules/timeline.js`
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/styles/main.css`

**Interfaces:**
- Consumes: `compositionLayerReorder` event detail `{ layerId, targetLayerId, placement }`
- Produces: draggable composition layer headers and app bridge to `CompositionLayerManager.reorderLayerByDisplayTarget`

- [x] **Step 1: Make composition headers draggable except visibility button**
- [x] **Step 2: Emit `compositionLayerReorder` on drop**
- [x] **Step 3: Bridge event in app**
- [x] **Step 4: Add CSS feedback for panel and timeline drag/drop**

### Task 4: Verify And Restart Preview

**Files:**
- All touched files

**Interfaces:**
- Produces: passing focused tests, syntax checks, and refreshed Electron preview.

- [x] **Step 1:** Run focused composition tests.
- [x] **Step 2:** Run `node --check` on touched JS modules.
- [x] **Step 3:** Run `git diff --check`.
- [x] **Step 4:** Restart only the f420 BAEFRAME Electron dev app.
