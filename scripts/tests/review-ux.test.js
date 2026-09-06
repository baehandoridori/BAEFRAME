const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
const ast = acorn.parse(app, { ecmaVersion: 'latest', sourceType: 'module' });
const nodes = [];
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) nodes.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
}
walk(ast);
const noop = () => {};
const log = { debug: noop, info: noop, warn: noop, error: noop };
function declaration(name, optional = false) {
  const node = nodes.find(item => item.type === 'FunctionDeclaration' && item.id?.name === name);
  if (!node && optional) return '';
  assert.ok(node, `Production function ${name} exists`);
  return app.slice(node.start, node.end);
}
function listener(target, event) {
  const node = nodes.find(item => item.type === 'CallExpression' &&
    app.slice(item.callee.start, item.callee.end) === `${target}.addEventListener` &&
    item.arguments[0]?.value === event);
  assert.ok(node, `${target} ${event} listener exists`);
  return `(${app.slice(node.arguments[1].start, node.arguments[1].end)})`;
}
function manager() {
  const source = fs.readFileSync(path.join(root, 'renderer/scripts/modules/comment-manager.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export default .*;\r?\n?/gm, '').replace(/^export /gm, '');
  const context = vm.createContext({ EventTarget, Event, CustomEvent, Date, Map, Math,
    createLogger: () => log, getAuthManager: () => ({ isAuthAvailable: () => false, getCurrentUser: () => null }) });
  vm.runInContext(`${source}\nglobalThis.manager = new CommentManager();`, context);
  return context.manager;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function draftHarness() {
  const cm = manager();
  const input = { value: '손 포즈를 확인해주세요' };
  const image = { base64: 'data:image/png;base64,fixture', width: 8, height: 8 };
  const context = vm.createContext({
    commentManager: cm, elements: { commentInput: input },
    state: { currentFile: 'A.mp4', pendingCommentImage: image },
    latestVideoLoadToken: 1, videoLoadIntentGeneration: 1,
    cutlistUIState: { active: false },
    ensureCutlistCommentTargetReady: async () => true,
    showToast: noop, clearCommentImage: () => { context.state.pendingCommentImage = null; }
  });
  vm.runInContext(`let sidebarCommentDraft = null; let sidebarCommentSubmissionToken = 0; let sidebarCommentSubmissionPending = false;\n${declaration('submitSidebarCommentDraft')}\n${declaration('cancelSidebarCommentDraft')}\n${declaration('finishSidebarCommentDraft')}`, context);
  return { context, cm, input, image };
}

test('sidebar cancellation preserves the text and attachment until a marker is confirmed', async () => {
  const { context, cm, input, image } = draftHarness();
  assert.equal(await context.submitSidebarCommentDraft(), true);
  cm.setCommentMode(false);
  assert.equal(input.value, '손 포즈를 확인해주세요');
  assert.equal(context.state.pendingCommentImage, image);
  assert.equal(cm.getAllMarkers().length, 0);
  assert.equal(cm.pendingText, null);
  assert.equal(cm._pendingImage, null);
});

test('confirmed sidebar marker consumes exactly its own text and image draft', async () => {
  const { context, cm, input, image } = draftHarness();
  cm.addEventListener('markerAdded', event => context.finishSidebarCommentDraft(event.detail));
  await context.submitSidebarCommentDraft();
  const marker = cm.startMarkerCreation(0.4, 0.3);
  assert.equal(marker.image, image.base64);
  assert.equal(input.value, '');
  assert.equal(context.state.pendingCommentImage, null);
});

test('a newer input draft survives confirmation of the previous submitted draft', async () => {
  const { context, cm, input } = draftHarness();
  cm.addEventListener('markerAdded', event => context.finishSidebarCommentDraft(event.detail));
  await context.submitSidebarCommentDraft();
  input.value = '다음 포즈 초안';
  const newerImage = { base64: 'data:image/png;base64,new', width: 4, height: 4 };
  context.state.pendingCommentImage = newerImage;
  cm.startMarkerCreation(0.4, 0.3);
  assert.equal(input.value, '다음 포즈 초안');
  assert.equal(context.state.pendingCommentImage, newerImage);
});

test('an awaited sidebar target cannot submit an old draft into the next video', async () => {
  const { context, cm, input } = draftHarness();
  const ready = deferred();
  context.ensureCutlistCommentTargetReady = () => ready.promise;
  const submission = context.submitSidebarCommentDraft();
  context.state.currentFile = 'B.mp4';
  context.videoLoadIntentGeneration++;
  ready.resolve(true);
  assert.equal(await submission, false);
  assert.equal(cm.isCommentMode, false);
  assert.equal(input.value, '손 포즈를 확인해주세요');
});

test('cancelling while the sidebar target is still preparing keeps the complete draft', async () => {
  const { context, cm, input, image } = draftHarness();
  const ready = deferred();
  context.ensureCutlistCommentTargetReady = () => ready.promise;
  const submission = context.submitSidebarCommentDraft();
  context.cancelSidebarCommentDraft();
  ready.resolve(true);
  assert.equal(await submission, false);
  assert.equal(cm.isCommentMode, false);
  assert.equal(input.value, '손 포즈를 확인해주세요');
  assert.equal(context.state.pendingCommentImage, image);
});

test('only the latest sidebar submission may finish an asynchronous target request', async () => {
  const { context, cm, input } = draftHarness();
  const firstReady = deferred();
  const secondReady = deferred();
  let count = 0;
  context.ensureCutlistCommentTargetReady = () => (++count === 1 ? firstReady : secondReady).promise;
  const first = context.submitSidebarCommentDraft();
  input.value = '두 번째 초안';
  const second = context.submitSidebarCommentDraft();
  secondReady.resolve(true);
  assert.equal(await second, true);
  firstReady.resolve(true);
  assert.equal(await first, false);
  assert.equal(cm.pendingText, '두 번째 초안');
});

test('clear and both comment cancellation APIs discard pending image ownership', () => {
  for (const cancel of [cm => cm.setCommentMode(false), cm => cm.toggleCommentMode(), cm => cm.clear()]) {
    const cm = manager();
    cm.setPendingText('초안');
    cm._pendingImage = { base64: 'old' };
    cancel(cm);
    assert.equal(cm.pendingText, null);
    assert.equal(cm._pendingImage, null);
  }
});

function shareHarness(save) {
  const copied = [];
  const toasts = [];
  const context = vm.createContext({
    reviewDataManager: { getBframePath: () => 'C:/fixture/A.bframe', getVideoPath: () => 'C:/fixture/A.mp4',
      hasUnsavedChanges: () => true, save },
    window: { electronAPI: { fileExists: async () => false, copyToClipboard: async value => copied.push(value) } },
    state: { currentFile: 'C:/fixture/A.mp4' }, videoLoadIntentGeneration: 1,
    showToast: (message, type) => toasts.push({ message, type }), log, isGoogleDrivePath: () => false
  });
  const click = vm.runInContext(listener('elements.btnCopyLink', 'click'), context);
  return { context, click, copied, toasts };
}
for (const outcome of ['false', 'throw']) {
  test(`share stops and reports failure when save ${outcome}`, async () => {
    const { click, copied, toasts } = shareHarness(async () => {
      if (outcome === 'throw') throw new Error('fixture write failed');
      return false;
    });
    await click();
    assert.equal(copied.length, 0);
    assert.ok(toasts.some(item => item.type === 'error' || item.type === 'warning'));
    assert.ok(!toasts.some(item => /저장되었습니다|복사되었습니다/.test(item.message)));
  });
}
test('share still copies a successfully saved local document', async () => {
  const { click, copied } = shareHarness(async () => true);
  await click();
  assert.deepEqual(copied, ['C:\\fixture\\A.bframe']);
});

test('a share request waiting for save does not copy after navigation', async () => {
  const saved = deferred();
  const { context, click, copied, toasts } = shareHarness(() => saved.promise);
  const pending = click();
  await Promise.resolve();
  context.videoLoadIntentGeneration++;
  saved.resolve(true);
  await pending;
  assert.equal(copied.length, 0);
  assert.equal(toasts.length, 0);
});

function hybridHarness(document = null) {
  const probe = deferred();
  const swaps = [];
  const context = vm.createContext({
    state: { currentFile: 'A.mp4', isAudioMode: false, isCommentMode: true, isDrawMode: false },
    videoPlayer: { currentFrame: 24, engine: 'mpv', seekToFrame: noop },
    videoLoadIntentGeneration: 1, latestVideoLoadToken: 1,
    commentModePreparationToken: 1, drawModePreparationToken: 0,
    userSettings: { getHybridReviewEngine: () => true },
    isMpvPilotPlaybackActive: () => true,
    isMpvReviewInteractionActive: () => context.state.isCommentMode || context.state.isDrawMode,
    fabricDrawingPersistenceStore: { getStatus: () => ({ keyframeCount: document?.keyframes?.length || 0 }) },
    isHtml5DirectPlayableForReview: () => probe.promise,
    loadVideoWithHtml5Fallback: async (file, options) => { swaps.push({ file, options }); return true; },
    exitHybridReviewEngineIfNeeded: async () => {}, log
  });
  vm.runInContext(`let hybridReviewSwapInFlight = false; let hybridReviewResumeMpvFile = null;\n${declaration('enterHybridReviewEngineIfPossible')}`, context);
  return { context, probe, swaps };
}
test('V3 drawings retain the mpv drawing host when entering comment mode', async () => {
  const { context, probe, swaps } = hybridHarness({ keyframes: [{ frame: 0, objects: [{ id: 'stroke' }] }] });
  probe.resolve(true);
  assert.equal(await context.enterHybridReviewEngineIfPossible(), false);
  assert.equal(swaps.length, 0);
});

test('mpv comment freeze includes the current V3 drawing snapshot before hiding native surfaces', async () => {
  const showFreeze = nodes.find(item => item.type === 'FunctionDeclaration' && item.id?.name === 'showMpvReviewFreezeFrame');
  const capture = nodes.find(item => item.type === 'Property' && item.key?.name === 'captureFrame' &&
    item.start > showFreeze.start && item.end < showFreeze.end);
  const keyframe = { frame: 0, sourceWidth: 320, sourceHeight: 180, objects: [{ id: 'stroke' }] };
  const calls = [];
  const context = vm.createContext({
    window: { electronAPI: { mpvScreenshot: async () => ({ success: true, dataUrl: 'original' }) } },
    videoPlayer: { currentFrame: 12 },
    fabricDrawingPersistenceStore: { resolveKeyframeAtFrame: frame => { assert.equal(frame, 12); return keyframe; } },
    reviewDataManager: { getDrawingLayers: () => ({ layers: [{ id: 'visible', visible: true }] }) },
    loadReviewDrawingFreezeRenderer: async () => ({ composite: async (...args) => { calls.push(args); return 'with-drawing'; } })
  });
  vm.runInContext(declaration('captureMpvReviewFrameWithDrawings', true), context);
  const captureFrame = vm.runInContext(`(${app.slice(capture.value.start, capture.value.end)})`, context);
  const result = await captureFrame();
  assert.equal(result.dataUrl, 'with-drawing');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], keyframe);
});

test('same-frame drawing layer and document updates refresh an active comment freeze', () => {
  let refreshes = 0;
  const context = vm.createContext({
    state: { isCommentMode: true }, isMpvPilotPlaybackActive: () => true,
    mpvReviewFreezeContentRevision: 0,
    scheduleMpvReviewFreezeRefresh: () => refreshes++,
    shouldSuppressLegacyDrawingForFabricPilot: () => true,
    fabricDrawingPilotController: { sendLayerView: async () => {} }, fabricPilotLayerViewSets: () => ({}),
    fabricPilotTimelineRenderQueued: false, requestAnimationFrame: noop
  });
  vm.runInContext(`${declaration('invalidateMpvReviewFreezeContent')}\n${declaration('pushFabricPilotLayerView')}`, context);
  context.pushFabricPilotLayerView();
  assert.equal(refreshes, 1);
  const subscribe = nodes.find(item => item.type === 'CallExpression' &&
    app.slice(item.callee.start, item.callee.end) === 'fabricDrawingPersistenceStore.subscribe');
  const callback = vm.runInContext(`(${app.slice(subscribe.arguments[0].start, subscribe.arguments[0].end)})`, context);
  callback();
  assert.equal(refreshes, 2);
  assert.equal(context.mpvReviewFreezeContentRevision, 2);
  context.state.isCommentMode = false;
  context.pushFabricPilotLayerView();
  callback();
  assert.equal(refreshes, 2);
});

function pendingFreezeHarness() {
  const gate = deferred();
  const timers = new Map();
  let timerId = 0;
  let captures = 0;
  let content = 'visible';
  const presented = [];
  const classes = new Set();
  const context = vm.createContext({
    state: { isCommentMode: true, isDrawMode: false },
    videoPlayer: { filePath: 'A.mp4', currentFrame: 12 },
    commentModePreparationToken: 1, drawModePreparationToken: 0,
    mpvReviewFreezeToken: 0, mpvReviewFreezeContentRevision: 0,
    mpvReviewFreezeElement: null, mpvReviewFreezeFrameSnapshot: null,
    mpvReviewFreezeHostHideOwner: null, mpvHostLastRequestedVisible: true,
    elements: { videoWrapper: { classList: {
      contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name)
    }, insertBefore: candidate => { candidate.isConnected = true; presented.push(candidate.src); } } },
    Image: class {
      constructor() { this.style = {}; }
      async decode() {}
      replaceWith(candidate) { candidate.isConnected = true; presented.push(candidate.src); }
      remove() {}
    },
    isMpvPilotPlaybackActive: () => true,
    isMpvReviewInteractionActive: () => context.state.isCommentMode,
    captureCurrentMpvReviewFrameTarget: () => context.mpvReviewFrameTracker.capture(
      context.videoPlayer.filePath, context.videoPlayer.currentFrame),
    captureMpvReviewFrameWithDrawings: async () => {
      captures++;
      const snapshot = content;
      await gate.promise;
      return { success: true, dataUrl: snapshot };
    },
    window: { electronAPI: { mpvSetHostVisible: noop } },
    getVideoRenderArea: () => null, syncCanvasZoom: noop,
    applyMpvHostVisibility: async () => ({ success: true }), didMpvHostVisibilityApply: () => true,
    resyncMpvHostVisibilityForCurrentState: noop, forceMpvHostVisibilitySync: noop,
    setCommentModePreparingState: noop, setCommentModeReadyState: noop,
    setDrawModePreparingState: noop, setDrawModeReadyState: noop,
    disableMpvReviewInteractionAfterFreezeFailure: noop, log
  });
  vm.runInContext(['createSharedAsyncCaptureOwner', 'createCoalescedAsyncScheduler', 'createMpvReviewFrameTracker',
    'runMpvReviewFreezeCapture', 'runMpvReviewFreezeRefresh', 'showMpvReviewFreezeFrame',
    'refreshMpvReviewFreezeFrameForCurrentFrame', 'scheduleMpvReviewFreezeRefresh',
    'invalidateMpvReviewFreezeContent'].map(name => declaration(name)).join('\n'), context);
  context.mpvReviewFrameTracker = context.createMpvReviewFrameTracker();
  context.mpvReviewFreezeCaptureOwner = context.createSharedAsyncCaptureOwner();
  context.mpvReviewFreezeRefreshScheduler = context.createCoalescedAsyncScheduler({
    delayMs: 160,
    shouldRun: () => context.state.isCommentMode,
    run: () => context.refreshMpvReviewFreezeFrameForCurrentFrame(),
    setTimer: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimer: id => timers.delete(id)
  });
  function runTimer() {
    const next = timers.entries().next().value;
    assert.ok(next, 'a follow-up capture is scheduled');
    timers.delete(next[0]); next[1]();
  }
  return { context, gate, timers, presented, runTimer, setContent: value => { content = value; }, get captures() { return captures; } };
}

test('drawing changes during the initial freeze force a fresh capture after the shared capture settles', async () => {
  const harness = pendingFreezeHarness();
  const initial = harness.context.showMpvReviewFreezeFrame();
  harness.setContent('hidden');
  harness.context.invalidateMpvReviewFreezeContent();
  // The refresh timer fires while the initial capture still owns the shared promise.
  harness.runTimer();
  harness.gate.resolve();
  await initial;
  await new Promise(setImmediate);
  harness.runTimer();
  await new Promise(setImmediate);
  assert.equal(harness.captures, 2);
  assert.deepEqual(harness.presented, ['hidden']);
  assert.equal(harness.timers.size, 0);
});

test('cancelling comment mode while a stale freeze settles never starts another capture', async () => {
  const harness = pendingFreezeHarness();
  const initial = harness.context.showMpvReviewFreezeFrame();
  harness.setContent('hidden');
  harness.context.invalidateMpvReviewFreezeContent();
  harness.runTimer();
  harness.context.state.isCommentMode = false;
  harness.context.mpvReviewFreezeCaptureOwner.cancel();
  harness.context.mpvReviewFreezeRefreshScheduler.cancel();
  harness.gate.resolve();
  await initial;
  await new Promise(setImmediate);
  assert.equal(harness.captures, 1);
  assert.deepEqual(harness.presented, []);
  assert.equal(harness.timers.size, 0);
});

test('a duplicate refresh without content changes can reuse the in-flight frame', async () => {
  const harness = pendingFreezeHarness();
  const initial = harness.context.showMpvReviewFreezeFrame();
  harness.context.scheduleMpvReviewFreezeRefresh();
  harness.runTimer();
  harness.gate.resolve();
  await initial;
  await new Promise(setImmediate);
  assert.equal(harness.captures, 1);
  assert.deepEqual(harness.presented, ['visible']);
  assert.equal(harness.timers.size, 0);
});

test('a pending freeze from the previous video cannot replace the new video freeze', async () => {
  const harness = pendingFreezeHarness();
  const oldCapture = harness.context.showMpvReviewFreezeFrame();
  harness.context.mpvReviewFreezeCaptureOwner.cancel();
  harness.context.mpvReviewFreezeRefreshScheduler.cancel();
  harness.context.videoPlayer.filePath = 'B.mp4';
  harness.setContent('video-B');
  const newCapture = harness.context.showMpvReviewFreezeFrame();
  harness.gate.resolve();
  await Promise.all([oldCapture, newCapture]);
  await new Promise(setImmediate);
  assert.equal(harness.captures, 2);
  assert.deepEqual(harness.presented, ['video-B']);
  assert.equal(harness.timers.size, 0);
});
for (const change of ['cancel', 'reenter', 'video']) {
  test(`late hybrid codec result cannot activate a stale ${change} request`, async () => {
    const { context, probe, swaps } = hybridHarness();
    const request = context.enterHybridReviewEngineIfPossible();
    if (change === 'cancel') context.state.isCommentMode = false;
    if (change === 'reenter') context.commentModePreparationToken += 2;
    if (change === 'video') { context.state.currentFile = 'B.mp4'; context.videoLoadIntentGeneration++; }
    probe.resolve(true);
    assert.equal(await request, false);
    assert.equal(swaps.length, 0);
  });
}
test('simultaneous hybrid requests share the in-flight exclusion before codec probing', async () => {
  const { context, probe, swaps } = hybridHarness();
  const first = context.enterHybridReviewEngineIfPossible();
  const second = context.enterHybridReviewEngineIfPossible();
  probe.resolve(true);
  const results = await Promise.all([first, second]);
  assert.equal(swaps.length, 1);
  assert.deepEqual(results, [true, false]);
});

test('cancellation after HTML5 loading starts still schedules restoration to mpv', async () => {
  const { context, probe } = hybridHarness();
  const loading = deferred();
  const started = deferred();
  let resumedFile = null;
  context.exitHybridReviewEngineIfNeeded = () => {
    resumedFile = vm.runInContext('hybridReviewResumeMpvFile', context);
  };
  context.loadVideoWithHtml5Fallback = () => {
    context.videoPlayer.engine = 'html5';
    started.resolve();
    return loading.promise;
  };
  const pending = context.enterHybridReviewEngineIfPossible();
  probe.resolve(true);
  await started.promise;
  context.state.isCommentMode = false;
  loading.resolve(false);
  assert.equal(await pending, false);
  assert.equal(resumedFile, 'A.mp4');
});

test('comment readiness ignores completion from a cancelled then reentered mode', async () => {
  const pending = deferred();
  const ready = [];
  const context = vm.createContext({
    state: { currentFile: 'A.mp4', isCommentMode: false, isDrawMode: false },
    commentModePreparationToken: 0, videoLoadIntentGeneration: 1,
    isFabricDrawingPilotControllerEngaged: () => false, isMpvPilotPlaybackActive: () => true,
    videoPlayer: { pause: noop }, enterHybridReviewEngineIfPossible: () => pending.promise,
    setCommentModeReadyState: value => ready.push(value), setCommentModePreparingState: noop,
    showCommentModeGuidance: noop, exitHybridReviewEngineIfNeeded: noop,
    prepareMpvCommentMode: () => ready.push('freeze')
  });
  const modeChanged = vm.runInContext(listener('commentManager', 'commentModeChanged'), context);
  modeChanged({ detail: { isCommentMode: true } });
  context.commentModePreparationToken += 2;
  pending.resolve(true);
  await Promise.resolve();
  assert.deepEqual(ready, [false]);
});

test('aborted mpv restoration keeps ownership for the next comment-mode exit', async () => {
  const firstLoading = deferred();
  let loads = 0;
  const context = vm.createContext({
    state: { currentFile: 'A.mp4', isCommentMode: false },
    videoPlayer: { currentFrame: 24, engine: 'html5', isPlaying: false },
    videoLoadIntentGeneration: 1,
    isMpvReviewInteractionActive: () => context.state.isCommentMode,
    loadVideo: async () => {
      loads++;
      if (loads === 1) return firstLoading.promise;
      context.videoPlayer.engine = 'mpv';
      return true;
    }, log
  });
  vm.runInContext(`let hybridReviewSwapInFlight = false; let hybridReviewResumeMpvFile = 'A.mp4';\n${declaration('exitHybridReviewEngineIfNeeded')}`, context);
  const first = context.exitHybridReviewEngineIfNeeded();
  context.state.isCommentMode = true;
  firstLoading.resolve(false);
  await first;
  assert.equal(vm.runInContext('hybridReviewResumeMpvFile', context), 'A.mp4');
  context.state.isCommentMode = false;
  await context.exitHybridReviewEngineIfNeeded();
  assert.equal(loads, 2);
  assert.equal(vm.runInContext('hybridReviewResumeMpvFile', context), null);
});

test('previous and next comment controls follow status, author and search filters', async () => {
  const cm = manager();
  cm.fromJSON({ layers: [{ id: 'comment-layer-1', markers: [
    { id: 'resolved', startFrame: 24, endFrame: 48, resolved: true, author: '김', text: '손 수정' },
    { id: 'other-author', startFrame: 48, endFrame: 72, author: '이', text: '손 수정' },
    { id: 'search-miss', startFrame: 72, endFrame: 96, author: '김', text: '발 수정' },
    { id: 'visible', startFrame: 96, endFrame: 120, author: '김', text: '손 수정' }
  ] }] });
  const seeks = [];
  const context = vm.createContext({
    commentManager: cm, videoPlayer: { duration: 10, currentFrame: 0, seekToFrame: frame => seeks.push(frame) },
    timeline: { scrollToPlayhead: noop }, showToast: noop, log,
    playlistUIState: { mode: 'normal' }, cutlistUIState: { active: false },
    getActiveCommentFilter: () => 'unresolved', filterByAuthors: markers => markers.filter(marker => marker.author === '김'),
    commentSearchKeyword: '손', normalizeCommentSearch: text => text.trim(),
    markerMatchesCommentSearch: (marker, text) => marker.text.includes(text)
  });
  vm.runInContext(`${declaration('getFilteredCurrentCommentMarkers', true)}\n${declaration('navigateVisibleComment', true)}`, context);
  vm.runInContext(listener('elements.btnNextComment?', 'click'), context)();
  assert.deepEqual(seeks, [96]);
  context.videoPlayer.currentFrame = 144;
  vm.runInContext(listener('elements.btnPrevComment?', 'click'), context)();
  assert.deepEqual(seeks, [96, 96]);
  context.commentSearchKeyword = '검색 결과 없음';
  await context.navigateVisibleComment(-1);
  assert.deepEqual(seeks, [96, 96]);
});

for (const kind of ['playlist', 'cutlist']) {
  test(`${kind} navigation uses the same filtered global ranges as its comment list`, async () => {
    const opened = [];
    const ranges = [
      { id: 'resolved', globalStartTime: 1, resolved: true, author: '김', text: '손' },
      { id: 'wrong-author', globalStartTime: 2, resolved: false, author: '이', text: '손' },
      { id: 'visible', globalStartTime: 4, resolved: false, author: '김', text: '손' }
    ];
    const context = vm.createContext({
      playlistUIState: { mode: kind === 'playlist' ? 'continuous' : 'normal' },
      cutlistUIState: { active: kind === 'cutlist' },
      timeline: { currentTime: 0, scrollToPlayhead: noop },
      playlistAggregateCommentRanges: ranges, cutlistAggregateCommentRanges: ranges,
      getActiveCommentFilter: () => 'unresolved', commentSearchKeyword: '손', normalizeCommentSearch: text => text,
      filterByAuthors: items => items.filter(item => item.author === '김'),
      playlistRangeMatchesCommentSearch: (item, text) => item.text.includes(text),
      cutlistRangeMatchesCommentSearch: (item, text) => item.text.includes(text),
      getPlaylistAggregateCommentKey: item => item.id, getCutlistAggregateCommentKey: item => item.id,
      openPlaylistAggregateComment: async key => opened.push(key),
      openCutlistAggregateComment: async key => opened.push(key), showToast: noop
    });
    vm.runInContext([declaration('navigateVisibleComment'), declaration('filterPlaylistAggregateCommentRanges'),
      declaration('filterCutlistAggregateCommentRanges')].join('\n'), context);
    await context.navigateVisibleComment(1);
    assert.deepEqual(opened, ['visible']);
    context.timeline.currentTime = 8;
    await context.navigateVisibleComment(-1);
    assert.deepEqual(opened, ['visible', 'visible']);
  });
}

test('late cut source resolution cannot replace a newer opened video', async () => {
  const resolved = deferred();
  const loads = [];
  const context = vm.createContext({
    cutlistUIState: { active: true },
    getCutlistManager: () => ({ isActive: () => true, currentCutId: 'cut-a', getCutById: () => ({ id: 'cut-a' }) }),
    videoLoadIntentGeneration: 1,
    resolveCutlistSourceForPlayback: () => resolved.promise,
    loadVideo: async file => { loads.push(file); return true; }, showToast: noop
  });
  vm.runInContext(declaration('ensureCutlistCommentTargetReady'), context);
  const pending = context.ensureCutlistCommentTargetReady();
  context.videoLoadIntentGeneration++;
  resolved.resolve({ videoPath: 'A.mp4' });
  assert.equal(await pending, false);
  assert.deepEqual(loads, []);
});
