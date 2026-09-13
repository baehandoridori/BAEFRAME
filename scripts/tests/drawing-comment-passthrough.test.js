const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { normalizeOverlayState } = require('../../main/mpv-overlay-host');
const source = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
test('Fabric active/preparing/recovery blocks comment input while legacy canvas stays disabled', () => {
  const dom = new JSDOM('<div id="markers"></div><div class="comment-marker-tooltip visible pinned"></div>');
  const noop = () => {};
  const context = vm.createContext({ document: dom.window.document, markerContainer: dom.window.document.querySelector('#markers'),
    endVideoPan() {}, resetViewportPanCycle() {}, state: { isDrawMode: false }, elements: {}, activeMarkerDragCancels: new Set(),
    fabricDrawingPilotStatusSnapshot: null, lastLoggedFabricPersistenceReason: null,
    fabricDrawingPilotFailureToastShown: false, fabricDrawingPilotUiEngaged: false,
    seedFabricDrawingLayerAssignmentTracking: noop, pushFabricPilotLayerView: noop,
    pushFabricPilotLayerViewAfterDisplay: noop, resetMpvOverlayCollaborationDrag: noop,
    renderActiveDrawingLayers: noop, scheduleMpvOverlayStateSync: noop,
    notifyFabricDrawingPilotFailure: noop, isMpvPilotPlaybackActive: () => true,
    fabricDrawingPilotController: { shouldOwnDrawingShortcut: () => true },
    isFabricDrawingPilotControllerEngaged: () => context.fabricDrawingPilotUiEngaged,
    setDrawModePreparingState: noop
  });
  for (const name of ['setCommentOverlaysDrawingPassthrough', 'setDrawModeReadyState', 'syncCommentInteractionPolicy', 'handleFabricDrawingPilotStateChange']) {
    if (source.includes(`function ${name}(`)) vm.runInContext(fn(name), context);
  }
  for (const state of ['active', 'preparing', 'recovering', 'passive', 'active', 'failed', 'off']) {
    context.handleFabricDrawingPilotStateChange(state, {});
    assert.equal(context.markerContainer.classList.contains('drawing-active'), ['active', 'preparing', 'recovering'].includes(state), state);
  }
  assert.equal(dom.window.document.querySelector('.comment-marker-tooltip').classList.contains('pinned'), false);
  dom.window.close();
});
test('overlay policy accepts only booleans and preserves omission versus explicit false', () => {
  assert.equal(normalizeOverlayState({ commentInteractionBlocked: true }).commentInteractionBlocked, true);
  assert.equal(normalizeOverlayState({ commentInteractionBlocked: false }).commentInteractionBlocked, false);
  for (const value of [undefined, null, 'false', 0, {}]) assert.equal(normalizeOverlayState({ commentInteractionBlocked: value }).commentInteractionBlocked, undefined);
});
