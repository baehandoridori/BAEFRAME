# Layer Compositing Implementation Plan

> Required skills: test-driven-development before production code, executing-plans while applying this plan, verification-before-completion before claiming completion.

## Goal

Implement BAEFRAME phase-1 `레이어 합성`: image/video overlay layers in preview, compact layer panel, direct preview transform, timeline range bars, `.bframe` save/restore, and mpv overlay mirroring. Composite export and real alpha-channel processing are deferred.

## Architecture

- Add `renderer/scripts/modules/composition-layer-manager.js` as the single owner of composition layer state, normalization, default durations, visible-layer filtering, undo/redo, DOM rendering, direct manipulation, panel events, timeline events, and serializable mpv overlay state.
- Wire the manager from `renderer/scripts/app.js` after `videoPlayer` and `timeline` are created.
- Extend `ReviewDataManager` to collect/apply `compositionLayers`.
- Extend `Timeline` with a focused `renderCompositionLayers()` method that appends composition track rows and dispatches layer selection/range drag events.
- Extend `main/mpv-overlay-host.js` so mpv pilot can render image/video overlay layers above native mpv video.
- Extend schema/docs/validator with optional `compositionLayers`.

## Tech Stack

- Electron renderer modules, plain JavaScript ES modules.
- Node built-in `node:test` for tests.
- Existing CSS in `renderer/styles/main.css`.
- Existing IPC/preload APIs for file dialog, file existence, and mpv overlay update.

## Global Constraints

- Do not implement final composite export.
- Keep overlay videos muted.
- Store original media paths only.
- Do not add numeric transform/time inspector fields in phase 1.
- Do not touch unrelated Bflow files or other BAEFRAME worktrees.
- Use `apply_patch` for manual file edits.

## Tasks

1. Add failing tests for core layer behavior.
   - Create `scripts/tests/composition-layer-manager.test.js`.
   - Cover media type detection, image default duration, layer normalization, visible filtering, reorder, undo/redo, and range move/resize math.
   - Run `node --test scripts/tests/composition-layer-manager.test.js` and confirm it fails because the module does not exist.

2. Add failing schema/source tests.
   - Create `scripts/tests/composition-layer-schema.test.js`.
   - Create `scripts/tests/composition-layer-runtime-source.test.js`.
   - Cover validator acceptance/rejection, schema default data, app wiring strings, ReviewDataManager collect/apply strings, mpv overlay state strings, and required HTML ids.
   - Run both tests and confirm expected failures.

3. Implement core manager.
   - Add `renderer/scripts/modules/composition-layer-manager.js`.
   - Export pure helpers for test coverage.
   - Implement manager state, add/update/delete/select/reorder, undo/redo, default durations, metadata fallback, visible filtering, and mpv state serialization.
   - Run `node --test scripts/tests/composition-layer-manager.test.js`.

4. Extend schema and review-data saving.
   - Update `shared/schema.js`, `shared/validators.js`, `docs/bframe-schema.md`.
   - Update `renderer/scripts/modules/review-data-manager.js` to accept `compositionLayerManager`, listen to `changed`, include `compositionLayers` in `_collectData()`, and call `fromJSON()` in `_applyData()`.
   - Run `node --test scripts/tests/composition-layer-schema.test.js`.

5. Add renderer UI and app wiring.
   - Update `renderer/index.html` with `btnLayerCompositing`, `compositionLayerOverlay`, and `compositionLayerPanel`.
   - Update `renderer/styles/main.css` for panel, preview overlay, handles, layer rows, and timeline bars.
   - Update `renderer/scripts/app.js` to import/construct the manager, wire file add/drop, video time/play/pause, loaded video info, timeline events, and mpv overlay state.
   - Run `node --test scripts/tests/composition-layer-runtime-source.test.js`.

6. Extend timeline rendering.
   - Update `renderer/scripts/modules/timeline.js` with `renderCompositionLayers(layers, options)`.
   - Dispatch `compositionLayerSelect`, `compositionLayerRangeChange`, and `compositionLayerReorder` events.
   - Show temporal overflow with an overflow segment and badge when `endTime > duration`.
   - Re-run composition tests.

7. Extend mpv overlay host.
   - Update `main/mpv-overlay-host.js` to accept `compositionLayers` in normalized overlay state.
   - Render/update image/video elements in the isolated overlay document; video layers are muted and time-synced to base playback time.
   - Extend `scripts/tests/mpv-overlay-host.test.js` or the composition runtime test to check the fields.
   - Run `npm run test:mpv`.

8. Final verification and preview prep.
   - Run:
     - `node --test scripts/tests/composition-layer-manager.test.js scripts/tests/composition-layer-schema.test.js scripts/tests/composition-layer-runtime-source.test.js`
     - `npm run test:mpv`
   - Start the Electron dev app with `npm run dev` in a background PowerShell process and log output to a temp file.
   - Report what to test: open a base video, open `레이어 합성`, add image/video, move/resize, drag timeline range, toggle visibility, rename/delete, save, reopen.
