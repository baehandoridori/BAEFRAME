const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
const nodes = [];
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) nodes.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
})(acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
function fn(name) {
  const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}
function listener(target, event) {
  const node = nodes.find(n => n.type === 'CallExpression' &&
    source.slice(n.callee.start, n.callee.end) === `${target}.addEventListener` && n.arguments[0]?.value === event);
  assert.ok(node, `${target} ${event}`);
  return `(${source.slice(node.arguments[1].start, node.arguments[1].end)})`;
}
const noop = () => {};

for (const [zoom, locked] of [[125, true], [75, false], [50, true], [200, false]]) {
  test(`comment placement does not capture the pointer for panning at ${zoom}% / center ${locked}`, async () => {
    const { createVideoPanGesture } = await import(pathToFileURL(path.join(root, 'renderer/scripts/modules/video-pan-gesture.js')).href);
    const state = { videoZoom: zoom, videoCenterLocked: locked, isCommentMode: true, isDrawMode: false, isSpaceHeld: false };
    const context = vm.createContext({ state });
    vm.runInContext(fn('canPanVideo'), context);
    let captured = false;
    const gesture = createVideoPanGesture({ canStart: () => context.canPanVideo(),
      getTransform: () => ({ scale: zoom / 100, panX: 20, panY: 10 }), onChange: noop });
    assert.equal(gesture.pointerDown({ pointerId: 1, button: 0, clientX: 20, clientY: 30,
      currentTarget: { setPointerCapture: () => { captured = true; } }, preventDefault: () => { captured = true; } }), false);
    assert.equal(captured, false);
    state.isSpaceHeld = true;
    assert.equal(context.canPanVideo(), zoom > 100 || !locked, 'Space explicitly permits panning');
  });
}

function clickHarness() {
  const markers = [];
  const classes = new Set(['comment-mode']);
  const context = vm.createContext({
    state: { isCommentMode: true, currentFile: 'A.mp4', isSpaceHeld: false, isPanningVideo: false },
    commentModePreparationToken: 1, videoLoadIntentGeneration: 1, commentMarkerPlacementToken: 0,
    elements: { videoWrapper: { classList: { contains: value => classes.has(value) } } },
    markerContainer: { getBoundingClientRect: () => ({ left: -160, top: -90, width: 1600, height: 900 }) },
    ensureCutlistCommentTargetReady: async () => true,
    commentManager: { startMarkerCreation: (x, y) => markers.push({ x, y }) }
  });
  // Execute the production listener, including the asynchronous input fence.
  const click = vm.runInContext(listener('markerContainer', 'click'), context);
  const event = { clientX: 240, clientY: 360, target: { closest: () => null } };
  return { context, click, event, markers, classes };
}

test('transformed marker bounds map the clicked pixel to normalized video coordinates', async () => {
  const { click, event, markers } = clickHarness();
  await click(event);
  assert.deepEqual(markers, [{ x: 0.25, y: 0.5 }]);
});

test('preparing, Space pan, or outside-video clicks never create a marker', async () => {
  for (const scenario of ['preparing', 'space', 'panning', 'outside', 'zero-size']) {
    const h = clickHarness();
    if (scenario === 'preparing') h.classes.clear();
    if (scenario === 'space') h.context.state.isSpaceHeld = true;
    if (scenario === 'panning') h.context.state.isPanningVideo = true;
    if (scenario === 'outside') h.event.clientX = 1600;
    if (scenario === 'zero-size') h.context.markerContainer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    await h.click(h.event);
    assert.equal(h.markers.length, 0, scenario);
  }
});

test('an awaited placement is discarded after mode exit, file change, or a newer click', async () => {
  for (const scenario of ['exit', 'file', 'intent', 'token', 'newer']) {
    const h = clickHarness();
    let done;
    h.context.ensureCutlistCommentTargetReady = () => new Promise(resolve => { done = resolve; });
    const pending = h.click(h.event);
    const firstDone = done;
    if (scenario === 'exit') h.context.state.isCommentMode = false;
    if (scenario === 'file') h.context.state.currentFile = 'B.mp4';
    if (scenario === 'intent') h.context.videoLoadIntentGeneration++;
    if (scenario === 'token') h.context.commentModePreparationToken++;
    if (scenario === 'newer') void h.click(h.event);
    firstDone(true);
    await pending;
    assert.equal(h.markers.length, 0, scenario);
  }
});

test('C begins the existing mpv freeze without reloading the file through another engine', async () => {
  const calls = [];
  const context = vm.createContext({
    state: { isCommentMode: false, isDrawMode: false, currentFile: 'A.mp4' },
    commentModePreparationToken: 0, videoLoadIntentGeneration: 1, exitDrawModeForSystemPath: noop,
    isMpvPilotPlaybackActive: () => true, isFabricDrawingPilotControllerEngaged: () => false,
    endVideoPan: () => calls.push('end-pan'),
    videoPlayer: { pauseAndSync: async () => { calls.push('pause'); return true; } },
    setCommentModeReadyState: noop, setCommentModePreparingState: noop,
    enterHybridReviewEngineIfPossible: () => { calls.push('reload'); return new Promise(noop); },
    showMpvReviewFreezeFrame: () => { calls.push('freeze'); return Promise.resolve(true); },
    showCommentModeGuidance: noop
  });
  vm.runInContext(`${fn('prepareMpvCommentReadiness')}\n${fn('prepareMpvCommentMode')}`, context);
  vm.runInContext(listener('commentManager', 'commentModeChanged'), context)({ detail: { isCommentMode: true } });
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['end-pan', 'pause', 'freeze']);
});

test('C waits for the confirmed stop, and a failed or stale pause never captures a frame', async () => {
  for (const scenario of ['ready', 'failed', 'file', 'mode', 'intent']) {
    let finishPause;
    let captures = 0;
    const context = vm.createContext({
      state: { currentFile: 'A.mp4', isCommentMode: true },
      commentModePreparationToken: 1, videoLoadIntentGeneration: 1,
      isMpvPilotPlaybackActive: () => true,
      videoPlayer: { pauseAndSync: () => new Promise(resolve => { finishPause = resolve; }) },
      showMpvReviewFreezeFrame: async () => { captures++; return true; },
      commentManager: { setCommentMode: enabled => { context.state.isCommentMode = enabled; } },
      setCommentModeReadyState: noop, setCommentModePreparingState: noop, showCommentModeGuidance: noop, showToast: noop
    });
    vm.runInContext(`${fn('prepareMpvCommentReadiness')}\n${fn('prepareMpvCommentMode')}`, context);
    const pending = context.prepareMpvCommentMode(1);
    assert.equal(captures, 0);
    if (scenario === 'file') context.state.currentFile = 'B.mp4';
    if (scenario === 'mode') context.commentModePreparationToken++;
    if (scenario === 'intent') context.videoLoadIntentGeneration++;
    finishPause(scenario !== 'failed');
    assert.equal(await pending, scenario === 'ready');
    assert.equal(captures, scenario === 'ready' ? 1 : 0);
    if (scenario === 'failed') assert.equal(context.state.isCommentMode, false);
  }
});

test('the final paused frame update cannot cancel initial C readiness or start an early capture', () => {
  const context = vm.createContext({ state: { isCommentMode: true, commentModePauseOwner: {} }, commentModePreparationToken: 4,
    mpvReviewFreezeRefreshScheduler: { schedule: () => assert.fail('early refresh') } });
  vm.runInContext(`${fn('invalidateMpvReviewFreezeForFrameChange')}\n${fn('scheduleMpvReviewFreezeRefresh')}`, context);
  assert.equal(context.invalidateMpvReviewFreezeForFrameChange(), false);
  context.scheduleMpvReviewFreezeRefresh();
  assert.equal(context.commentModePreparationToken, 4);
});
