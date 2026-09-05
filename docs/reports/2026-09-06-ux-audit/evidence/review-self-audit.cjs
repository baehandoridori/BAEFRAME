const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = 'C:/BAEframe/BAEFRAME/';
const read = file => fs.readFileSync(root + file, 'utf8').replace(/\r\n/g, '\n');
const app = read('renderer/scripts/app.js');
const cmOriginal = read('renderer/scripts/modules/comment-manager.js');
const viewer = read('web-viewer/scripts/app.js');
const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop };
function section(source, startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start);
  assert(start >= 0 && end > start, 'production source anchors must exist');
  return source.slice(start, end);
}
const share = section(app, "  elements.btnCopyLink.addEventListener('click', async () => {", '\n  // Google Drive 경로 감지');
const sidebar = section(app, '  async function submitSidebarCommentDraft() {', "\n  elements.commentInput.addEventListener('keydown'");
const webRender = section(viewer, 'function renderDrawingForCurrentFrame() {', '\nfunction selectTool');
const cm = cmOriginal.replace(/^import .*;\n/gm, '').replace(/^export default .*;\n?/gm, '').replace(/^export /gm, '');

async function shareCase({ path, exists, dirty, saveResult }) {
  const events = [];
  let callback;
  const ctx = vm.createContext({
    elements: { btnCopyLink: { addEventListener: (_, handler) => { callback = handler; } } },
    reviewDataManager: {
      getBframePath: () => path,
      getVideoPath: () => 'C:/audit/example.mp4',
      hasUnsavedChanges: () => dirty,
      save: async () => { events.push('save'); return saveResult; }
    },
    window: { electronAPI: {
      fileExists: async () => exists,
      copyToClipboard: async () => { events.push('copy'); }
    } },
    showToast: message => { events.push(message); },
    log: logger,
    isGoogleDrivePath: () => false
  });
  vm.runInContext(share, ctx);
  await callback();
  return events;
}

async function draftCase(targetReady) {
  const input = { value: '보존 확인용 본문' };
  const ctx = vm.createContext({
    EventTarget, Event, CustomEvent, Date, Map, Math,
    createLogger: () => logger,
    getAuthManager: () => ({ isAuthAvailable: () => false, getCurrentUser: () => null }),
    elements: { commentInput: input },
    state: { pendingCommentImage: null },
    ensureCutlistCommentTargetReady: async () => targetReady,
    clearCommentImage: noop,
    showToast: noop
  });
  vm.runInContext(cm + '\nglobalThis.commentManager = new CommentManager();', ctx);
  vm.runInContext(sidebar, ctx);
  await ctx.submitSidebarCommentDraft();
  return { manager: ctx.commentManager, input };
}

(async () => {
  const controls = [];
  const noPath = await shareCase({ path: null, exists: false, dirty: true, saveResult: false });
  assert(!noPath.includes('copy') && !noPath.includes('save'));
  controls.push({ case: 'share_without_path_is_blocked', events: noPath });

  const clean = await shareCase({ path: 'C:/audit/example.bframe', exists: true, dirty: false, saveResult: false });
  assert(clean.includes('copy') && !clean.includes('save'));
  assert(!clean.some(value => value.includes('자동 저장되었습니다')));
  controls.push({ case: 'existing_clean_file_skips_unneeded_save', events: clean });

  const success = await shareCase({ path: 'C:/audit/example.bframe', exists: false, dirty: true, saveResult: true });
  assert(success.includes('save') && success.includes('copy'));
  assert(success.some(value => value.includes('자동 저장되었습니다')));
  controls.push({ case: 'successful_save_has_expected_success_notice', events: success });

  const targetNotReady = await draftCase(false);
  assert.equal(targetNotReady.input.value, '보존 확인용 본문');
  assert.equal(targetNotReady.manager.pendingText, null);
  controls.push({ case: 'target_not_ready_preserves_sidebar_input', input: targetNotReady.input.value });

  const confirmed = await draftCase(true);
  confirmed.manager.startMarkerCreation(0.5, 0.5);
  assert.equal(confirmed.manager.getAllMarkers().length, 1);
  assert.equal(confirmed.manager.getAllMarkers()[0].text, '보존 확인용 본문');
  controls.push({ case: 'normal_position_selection_registers_comment', count: 1 });

  confirmed.manager.fromJSON({ layers: [{ id: 'comment-layer-1', markers: [
    { id: 'resolved', startFrame: 24, endFrame: 48, text: '완료', resolved: true },
    { id: 'unresolved', startFrame: 96, endFrame: 120, text: '남음', resolved: false }
  ] }] });
  assert.equal(confirmed.manager.getNextMarkerFrame(0), 24);
  controls.push({ case: 'unfiltered_navigation_correctly_includes_resolved_comment', nextFrame: 24 });

  let clears = 0;
  let paints = 0;
  const vctx = vm.createContext({
    state: {
      currentTime: 0, frameRate: 24,
      bframeData: { drawings: [{ frame: 0, strokes: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], color: '#ff0000', width: 3 }] }] },
      drawingContext: { clearRect: () => { clears += 1; }, stroke: () => { paints += 1; }, beginPath: noop, moveTo: noop, lineTo: noop }
    },
    elements: { drawingCanvas: { width: 1920, height: 1080 } }, Math, Array
  });
  vm.runInContext(webRender, vctx);
  vctx.renderDrawingForCurrentFrame();
  assert.equal(clears, 1);
  assert.equal(paints, 1);
  controls.push({ case: 'web_legacy_positive_control_draws_one_stroke', clears, paints });

  console.log(JSON.stringify({
    scope: 'Counterexamples and positive controls; no Electron UI or remote IO',
    sourceTransform: 'Line endings normalized; comments source ESM import/export declarations removed; function bodies unchanged',
    extractedSourceSha256: Object.fromEntries(Object.entries({ share, sidebar, webRender, commentManagerModule: cmOriginal })
      .map(([name, text]) => [name, crypto.createHash('sha256').update(text).digest('hex')])),
    controls,
    passedControls: controls.length
  }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
