# BAEFRAME Drawing, Keyframe, and Playlist Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stroke erasing, multi-keyframe drag operations, playlist autoplay playback, and smoother `.bplaylist` opening.

**Architecture:** Keep the existing Electron renderer modules and add small testable helpers where behavior is pure. `drawing-layer.js` owns saved keyframe shape, `drawing-stroke-records.js` owns hit testing and record normalization, `drawing-canvas.js` resolves temporary Ctrl eraser behavior, and `app.js` remains the DOM integration layer.

**Tech Stack:** Electron renderer, vanilla JavaScript modules, Canvas API, local user settings, `node --test`.

---

## File Structure

- Create `renderer/scripts/modules/drawing-stroke-records.js`
  - Pure helpers for eraser modes, stroke record creation, hit testing, and record removal.
- Create `scripts/tests/drawing-stroke-records.test.js`
  - Unit tests for stroke serialization, eraser mode defaults, and hit detection.
- Create `scripts/tests/keyframe-multi-select-source.test.js`
  - Source-level regression tests for keyframe box selection and selected-keyframe deletion wiring.
- Modify `renderer/scripts/modules/drawing-layer.js`
  - Add `baseCanvasData` and `strokeRecords` to `Keyframe`.
- Modify `renderer/scripts/modules/drawing-canvas.js`
  - Add eraser mode state, Ctrl temporary eraser resolution, and stroke record rendering helper.
- Modify `renderer/scripts/modules/drawing-manager.js`
  - Save stroke records, freeze records on pixel operations, erase intersecting records, and delete selected keyframes.
- Modify `renderer/scripts/modules/drawing-sync.js`
  - Include stroke metadata in final keyframe sync and avoid live pixel streaming for stroke eraser gestures.
- Modify `renderer/scripts/modules/user-settings.js`
  - Persist local eraser mode with default `pixel`.
- Modify `renderer/index.html`
  - Add the eraser mode segmented control inside the existing drawing tools panel.
- Modify `renderer/styles/main.css`
  - Style the eraser mode segmented control and keyframe selection affordances.
- Modify `renderer/scripts/modules/timeline.js`
  - Make drag selection target `.keyframe-marker-dot`, allow drag-box selection on drawing tracks, and expose selection data.
- Modify `renderer/scripts/app.js`
  - Wire eraser mode UI, selected keyframe deletion, playlist autoplay playback, `.bplaylist` add/open handling, and faster continuous playback start.
- Modify `package.json`
  - Add targeted drawing test scripts and include them in relevant aggregate scripts.

## Tasks

- [x] Add failing tests for drawing stroke helpers and keyframe serialization.
- [x] Implement `drawing-stroke-records.js` and extend `Keyframe` JSON compatibility.
- [x] Wire `DrawingCanvas` to resolve Ctrl temporary eraser at stroke start.
- [x] Wire `DrawingManager` to store, freeze, redraw, and erase stroke records.
- [x] Add eraser mode persistence and drawing panel UI.
- [x] Add failing tests for keyframe selection/delete wiring.
- [x] Fix timeline drag selection and selected-keyframe deletion.
- [x] Add failing tests for playlist autoplay and `.bplaylist` add paths.
- [x] Implement playlist autoplay playback and `.bplaylist` add/drop handling.
- [x] Reduce continuous transition wait by checking the current item first, preparing the rest in the background, attempting playback immediately, and retaining the watchdog.
- [x] Run targeted tests and lint/diff checks.

## Self-Review

- Spec coverage: drawing eraser modes, Ctrl temporary eraser, keyframe multi-select/move/delete, playlist autoplay, `.bplaylist` opening, and delay reduction all map to tasks.
- Placeholder scan: no open TODO/TBD markers are left in this plan.
- Type consistency: eraser modes use `pixel` and `stroke`; keyframe records use `baseCanvasData` and `strokeRecords`; selected keyframes use `{ layerId, frame }`.
