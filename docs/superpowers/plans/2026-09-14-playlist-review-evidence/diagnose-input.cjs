const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../../../..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function extract(source, pattern) {
  const match = pattern.exec(source);
  assert.ok(match);
  const start = source.indexOf(') {', match.index) + 2;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (!depth) return source.slice(match.index, i + 1);
  }
  throw new Error('Incomplete source');
}
const timeline = read('renderer/scripts/modules/timeline.js');
const finish = vm.runInNewContext('({' + extract(timeline, /_finishScrubbing\(e\) \{/) + '})._finishScrubbing');
const emitted = [];
finish.call({ scrubTime: 57 / 24, _emit: (name, payload) => emitted.push({ name, ...payload }) }, { clientX: 585 });
assert.equal(emitted[0].time, 57 / 24);
const toTime = vm.runInNewContext('({' + extract(timeline,
  /_getTimelineTimeFromCellPercent\(percent\) \{/) + '})._getTimelineTimeFromCellPercent');
const boundaryFrame = toTime.call({ fps: 24, _getTimelineDuration: () => 100 / 24,
  _getDisplayTotalFrames: () => 100, _getSegmentTimeFromDisplayFrame: () => null }, 0.58) * 24;
assert.equal(boundaryFrame, 57);

const dom = new JSDOM('<body><textarea></textarea></body>', {
  runScripts: 'outside-only', pretendToBeVisual: true
});
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const mentions = read('renderer/scripts/modules/mention-manager.js')
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
dom.window.eval('const TEAM_MEMBERS = [{name:"테스트"}]; const createLogger=()=>({});' + mentions +
  ';window.manager = new MentionManager();');
const manager = dom.window.manager;
const textarea = dom.window.document.querySelector('textarea');
manager.attach(textarea);
function type(value) {
  textarea.focus(); textarea.value = value;
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
type('확인@테');
const noSpaceVisible = manager.isVisible;
assert.equal(noSpaceVisible, false);
type('확인 @테');
assert.equal(manager.isVisible, true);
const composingEnter = new dom.window.KeyboardEvent('keydown', {
  key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true
});
textarea.dispatchEvent(composingEnter);
assert.equal(composingEnter.defaultPrevented, true);
assert.equal(textarea.value, '확인 @테스트 ');

const app = read('renderer/scripts/app.js');
const stateChanges = [];
const noOp = () => {};
const context = vm.createContext({
  fabricDrawingPilotStatusSnapshot: null, lastLoggedFabricPersistenceReason: null,
  fabricDrawingPilotFailureToastShown: false, fabricDrawingPilotUiEngaged: false,
  seedFabricDrawingLayerAssignmentTracking: noOp, pushFabricPilotLayerView: noOp,
  pushFabricPilotLayerViewAfterDisplay: noOp, resetMpvOverlayCollaborationDrag: noOp,
  renderActiveDrawingLayers: noOp, scheduleMpvOverlayStateSync: noOp,
  notifyFabricDrawingPilotFailure: noOp, isMpvPilotPlaybackActive: () => true,
  fabricDrawingPilotController: { shouldOwnDrawingShortcut: () => true },
  document: { body: { dataset: {}, classList: { toggle: noOp } } },
  elements: { btnDrawMode: { classList: { toggle: noOp } } }, state: {},
  setDrawModePreparingState: noOp,
  setDrawModeReadyState: value => stateChanges.push(value)
});
vm.runInContext(extract(app, /function handleFabricDrawingPilotStateChange\(/), context);
context.handleFabricDrawingPilotStateChange('active', {});
assert.equal(context.state.isDrawMode, true);
assert.deepEqual(stateChanges, [false]);
console.log(JSON.stringify({
  frameBoundary: { requestedCell: 58, actualFrame: boundaryFrame },
  releasePosition: { lastMoveFrame: 57, releaseClientX: 585,
    lastMoveTimeReused: emitted[0].time },
  mention: { afterKoreanWithoutSpace: noSpaceVisible,
    composingEnterPrevented: composingEnter.defaultPrevented,
    composingEnterInsertedMember: textarea.value === '확인 @테스트 ' },
  fabricActive: { isDrawMode: context.state.isDrawMode,
    legacyReadyAndCommentPassthrough: stateChanges[0] },
  scope: 'Controlled source-body and JSDOM reproduction, not a physical tablet or native mpv test'
}, null, 2));
manager.destroy(); dom.window.close();
