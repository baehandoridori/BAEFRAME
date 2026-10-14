const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8')
  .replace(/\r\n/g, '\n');
const appSource = read('renderer/scripts/app.js');
const stylesSource = read('renderer/styles/main.css');
const preloadSource = read('preload/preload.js');
const ipcSource = read('main/ipc-handlers.js');

function extractFunction(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appSource.match(new RegExp(`(?:async )?function ${escaped}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

function createVisibilityHarness(engine) {
  const calls = [];
  const pending = [];
  const dom = new JSDOM('<body class="mpv-pilot-mode"><div class="mpv-review-freeze-ready"><img class="mpv-review-freeze-frame"></div></body>');
  const { window } = dom;
  const { document } = window;
  const classes = { has: name => document.body.classList.contains(name) };
  const frames = [];
  const videoPlayer = { engine };
  let nativeVisible = true;
  let surfaceReady = true;
  window.electronAPI = {};
  window.electronAPI.mpvDestroyOverlay = async () => { nativeVisible = true; return { success: true }; };
  window.electronAPI.mpvPrepareOverlay = async () => ({ success: true, drawingCapability: {} });
  window.electronAPI.mpvUpdateOverlayState = async () => ({ success: true });
  for (const name of ['mpvSetHostVisible', 'mpvSetOverlayVisible']) {
    window.electronAPI[name] = visible => {
      calls.push([name, visible]);
      if (name === 'mpvSetHostVisible') nativeVisible = visible;
      return new Promise((resolve, reject) => pending.push(error => error ? reject(error) : resolve({
        success: true, visible, ready: true, embed: { ready: true }, overlay: { ready: true }
      })));
    };
  }
  const api = Function('window', 'document', 'videoPlayer', 'isHtml5DrawingSurfaceReady', 'frames', `
    let mpvHostVisibilityRequestRevision = 0;
    let mpvHostVisibilityInFlight = null;
    let mpvHostLastRequestedVisible = false;
    let mpvHostVisibilitySyncPending = false;
    let mpvPilotHostPreparing = false;
    let mpvReviewFreezeToken = 0;
    let mpvReviewFreezeElement = document.querySelector('img');
    let mpvReviewFreezeHostHideOwner = null;
    let mpvReviewFreezeFrameSnapshot = {};
    let mpvReviewTargetFrameSnapshot = {};
    const mpvReviewFreezeCaptureOwner = { cancel() {} };
    const mpvReviewFreezeRefreshScheduler = { cancel() {} };
    const elements = { videoWrapper: document.querySelector('div') };
    const log = { warn() {}, debug() {}, info() {} };
    const state = { currentFile: 'fixture.mp4' };
    let videoLoadIntentGeneration = 1;
    let activeVideoLoadToken = null;
    let mpvOverlayRecoveryOwner = null;
    let mpvOverlayRecoveryInFlightOwner = null;
    let mpvOverlaySyncEpoch = 0;
    let recoveryPromise;
    let gateWaits = 0;
    let activeOwner = {};
    const mpvTeardownGate = { run(callback) { recoveryPromise = callback(); return recoveryPromise; },
      async waitForIdle() { gateWaits += 1; await recoveryPromise; } };
    const mpvOverlayLifecycle = { owns: owner => !!owner && owner === activeOwner, markReady: () => true };
    const fabricDrawingPilotController = { adoptOverlayCapability: async () => true };
    const initializeCurrentDrawing = async () => {};
    const getMpvEmbedBounds = () => ({ x: 0, y: 0, width: 640, height: 360 });
    const getMpvOverlayState = () => ({});
    const scheduleMpvOverlayStateSync = () => {};
    const scheduleMpvOverlayRemoteCursorStateSync = () => {};
    const scheduleMpvOverlayCollaborationStateSync = () => {};
    const fallbackFromMpvOverlayRecoveryFailureOnce = () => { throw new Error('unexpected fallback'); };
    const isMpvPilotPlaybackActive = () => true;
    const isMpvReviewInteractionActive = () => elements.videoWrapper.classList.contains('comment-mode');
    const isCurrentDrawingSurfaceReady = () => true;
    const hasBlockingOverlayForMpv = () => elements.videoWrapper.classList.contains('mpv-review-freeze-ready');
    const requestAnimationFrame = callback => frames.push(callback);
    const MutationObserver = window.MutationObserver;
    ${extractFunction('setMpvNativeHostVisibleClass')}
    ${extractFunction('didMpvHostVisibilityApply')}
    ${extractFunction('applyMpvHostVisibility')}
    ${extractFunction('invalidateMpvHostVisibilityRequests')}
    ${extractFunction('shouldShowMpvHostForCurrentState')}
    ${extractFunction('syncMpvHostVisibilityWithDom')}
    ${extractFunction('installMpvBlockingOverlayObserver')}
    ${extractFunction('releaseMpvReviewFreezeFrame')}
    ${extractFunction('forceMpvHostVisibilitySync')}
    ${extractFunction('prepareMpvOverlayHost')}
    ${extractFunction('recoverMpvOverlayHostOnce')}
    return { apply: applyMpvHostVisibility, didApply: didMpvHostVisibilityApply,
      release: releaseMpvReviewFreezeFrame, observe: installMpvBlockingOverlayObserver,
      recover: () => recoverMpvOverlayHostOnce(activeOwner, 'test recovery'), waitRecovery: () => recoveryPromise,
      endOwner: () => { activeOwner = null; invalidateMpvHostVisibilityRequests(); }, gateWaits: () => gateWaits,
      navigate: () => { videoLoadIntentGeneration += 1; state.currentFile = 'next.mp4'; },
      invalidate: invalidateMpvHostVisibilityRequests };
  `)(window, document, videoPlayer, () => surfaceReady, frames);
  return { ...api, calls, pending, classes, document, videoPlayer,
    nativeVisible: () => nativeVisible,
    close: () => window.close(), flushFrames: () => Promise.all(frames.splice(0).map(callback => callback())),
    setSurfaceReady: value => { surfaceReady = value; } };
}

test('overlay recovery sends a fresh hide to the replacement instead of reusing the destroyed host response', async t => {
  const harness = createVisibilityHarness('mpv-embedded');
  t.after(harness.close);
  const oldHide = harness.apply(false);
  assert.equal(harness.recover(), true);
  await harness.waitRecovery();
  const sync = harness.flushFrames();
  harness.pending.forEach(resolve => resolve());
  await sync;
  assert.equal(harness.nativeVisible(), false, 'replacement must stay hidden behind the comment input');
  assert.equal(harness.didApply(await oldHide, false), false, 'destroyed host response is stale');
});

test('comment freeze release follows successful host recovery through the new visibility response', async t => {
  const harness = createVisibilityHarness('mpv-embedded');
  t.after(harness.close);
  const release = harness.release();
  harness.recover();
  await harness.waitRecovery();
  const sync = harness.flushFrames();
  harness.pending[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(harness.document.querySelector('.mpv-review-freeze-frame'), 'keep freeze until replacement confirms show');
  harness.pending.slice(1).forEach(resolve => resolve());
  await sync;
  assert.equal(await release, true);
  assert.equal(harness.document.querySelector('.mpv-review-freeze-frame'), null);
});

for (const change of ['new comment', 'navigation']) {
  test(`recovery retry does not revive the old freeze release after ${change}`, async t => {
    const harness = createVisibilityHarness('mpv-embedded');
    t.after(harness.close);
    const release = harness.release();
    harness.recover();
    await harness.waitRecovery();
    if (change === 'new comment') harness.document.querySelector('div').classList.add('comment-mode');
    else harness.navigate();
    harness.pending[0]();
    assert.equal(await release, false);
    assert.ok(harness.document.querySelector('.mpv-review-freeze-frame'));
    assert.equal(harness.calls.length, 1, 'superseded release must not issue a new show');
  });
}

test('release inside an invalidated teardown owner never waits on its own teardown gate', async t => {
  const harness = createVisibilityHarness('mpv-embedded');
  t.after(harness.close);
  harness.recover();
  await harness.waitRecovery();
  const release = harness.release();
  harness.endOwner();
  harness.pending[0]();
  assert.equal(await release, false);
  assert.equal(harness.gateWaits(), 0);
});

test('a new comment arriving while the recovery retry waits keeps the freeze image', async t => {
  const harness = createVisibilityHarness('mpv-embedded');
  t.after(harness.close);
  const release = harness.release();
  harness.recover();
  await harness.waitRecovery();
  harness.pending[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.length, 2, 'recovery requested a fresh show');
  harness.document.querySelector('div').classList.add('comment-mode');
  harness.pending[1]();
  assert.equal(await release, false);
  assert.ok(harness.document.querySelector('.mpv-review-freeze-frame'));
});

test('comment freeze is removed when the DOM observer also requests video visibility before IPC returns', async t => {
  const harness = createVisibilityHarness('mpv-embedded');
  t.after(harness.close);
  harness.observe();
  const release = harness.release();
  await Promise.resolve();
  const sync = harness.flushFrames();
  harness.pending.forEach(resolve => resolve());
  assert.equal(await release, true, 'a duplicate show must not strand the comment freeze image');
  await sync;
  assert.equal(harness.document.querySelector('.mpv-review-freeze-frame'), null);
  assert.equal(harness.classes.has('mpv-native-host-visible'), true);
});

test('overlapping native show requests share success without invalidating the original caller', async t => {
  const harness = createVisibilityHarness('mpv-embedded');
  t.after(harness.close);
  const first = harness.apply(true);
  const second = harness.apply(true);
  harness.pending.forEach(resolve => resolve());
  assert.equal(harness.didApply(await first, true), true);
  assert.equal(harness.didApply(await second, true), true);
  assert.equal(harness.calls.length, 1);
});

test('a same-direction request after teardown never reuses a previous lifecycle request', async t => {
  const harness = createVisibilityHarness('mpv-embedded');
  t.after(harness.close);
  const oldShow = harness.apply(true);
  harness.invalidate();
  const newShow = harness.apply(true);
  harness.pending[1]();
  assert.equal(harness.didApply(await newShow, true), true);
  harness.pending[0]();
  assert.equal(harness.didApply(await oldShow, true), false);
  assert.equal(harness.classes.has('mpv-native-host-visible'), true);
});

test('a rejected older show cannot erase the visibility of a newer successful show', async t => {
  const harness = createVisibilityHarness('mpv-embedded');
  t.after(harness.close);
  const oldShow = harness.apply(true);
  const rejected = assert.rejects(oldShow, /older request failed/);
  harness.invalidate();
  const newShow = harness.apply(true);
  harness.pending[1]();
  assert.equal(harness.didApply(await newShow, true), true);
  harness.pending[0](new Error('older request failed'));
  await rejected;
  assert.equal(harness.classes.has('mpv-native-host-visible'), true);
});

test('HTML5 drawing visibility only uses the prepared overlay and never marks native video visible', async t => {
  const harness = createVisibilityHarness('html5');
  t.after(harness.close);
  const show = harness.apply(true);
  assert.deepEqual(harness.calls, [['mpvSetOverlayVisible', true]]);
  harness.pending.shift()();
  assert.equal(harness.didApply(await show, true), true);
  assert.equal(harness.classes.has('mpv-native-host-visible'), false);

  harness.setSurfaceReady(false);
  const unprepared = harness.apply(true);
  harness.pending.shift()();
  assert.equal(harness.didApply(await unprepared, true), false);
  assert.deepEqual(harness.calls, [['mpvSetOverlayVisible', true], ['mpvSetOverlayVisible', false]]);
});

test('native and HTML5 visibility both reject older show completions after a newer hide or teardown', async t => {
  for (const engine of ['mpv-embedded', 'html5']) {
    const harness = createVisibilityHarness(engine);
    t.after(harness.close);
    const show = harness.apply(true);
    const hide = harness.apply(false);
    harness.pending[1]();
    assert.equal(harness.didApply(await hide, false), true);
    harness.pending[0]();
    const staleShow = await show;
    assert.equal(staleShow.stale, true);
    assert.equal(harness.didApply(staleShow, true), false);
    assert.equal(harness.classes.has('mpv-native-host-visible'), false);

    const beforeTeardown = harness.apply(true);
    harness.invalidate();
    harness.pending[2]();
    assert.equal(harness.didApply(await beforeTeardown, true), false);
    assert.equal(harness.classes.has('mpv-native-host-visible'), false);
    assert.deepEqual(harness.calls.map(([channel]) => channel), Array(3).fill(
      engine === 'html5' ? 'mpvSetOverlayVisible' : 'mpvSetHostVisible'
    ));
  }
});

test('remote cursors have one revisioned writer and the general overlay state cannot rewind them', () => {
  const getState = appSource.match(
    /function getMpvOverlayState\(\) \{([\s\S]*?)\n  \}\n\n  \/\/ 32 잔존/
  )?.[1] || '';
  const cursorSync = appSource.match(
    /function syncMpvOverlayRemoteCursorState\(\) \{([\s\S]*?)\n  \}\n\n  function scheduleMpvOverlayRemoteCursorStateSync/
  )?.[1] || '';

  assert.doesNotMatch(getState, /remoteCursorHtml/);
  assert.match(appSource, /let mpvOverlayRemoteCursorRevision = 0;/);
  assert.match(cursorSync, /revision:\s*\+\+mpvOverlayRemoteCursorRevision/);
  assert.match(cursorSync, /mpvUpdateOverlayRemoteCursors\(cursorState\)/);
});

test('original cursor visibility follows the real native-host state, including temporary blockers', () => {
  assert.match(stylesSource,
    /body\.mpv-native-host-visible \.video-wrapper\.mpv-pilot-mode > \.remote-cursors-container \{[\s\S]*?visibility:\s*hidden !important;/);
  assert.doesNotMatch(stylesSource,
    /body\.mpv-pilot-mode \.video-wrapper\.mpv-pilot-mode > \.remote-cursors-container/);
  assert.match(appSource,
    /function setMpvNativeHostVisibleClass\(visible\) \{[\s\S]*?classList\.toggle\('mpv-native-host-visible', visible === true\);/);
  assert.match(appSource,
    /async function applyMpvHostVisibility\(visible\) \{[\s\S]*?setMpvNativeHostVisibleClass\(false\);[\s\S]*?mpvSetHostVisible\(shouldShow\)[\s\S]*?setMpvNativeHostVisibleClass\(shouldShow\);/);
});

test('native host visibility ignores stale async completions and invalidates teardown requests', () => {
  assert.match(appSource, /let mpvHostVisibilityRequestRevision = 0;/);
  assert.match(appSource,
    /async function applyMpvHostVisibility\(visible\) \{[\s\S]*?const requestRevision = \+\+mpvHostVisibilityRequestRevision;[\s\S]*?await window\.electronAPI\.mpvSetHostVisible\(shouldShow\);[\s\S]*?requestRevision !== mpvHostVisibilityRequestRevision[\s\S]*?stale: true/);
  assert.match(appSource,
    /function didMpvHostVisibilityApply\(result, shouldShowMpvHost\) \{[\s\S]*?!result\?\.success \|\| result\?\.stale/);
  assert.match(appSource,
    /function invalidateMpvHostVisibilityRequests\(\) \{[\s\S]*?mpvHostVisibilityRequestRevision \+= 1;[\s\S]*?setMpvNativeHostVisibleClass\(false\);/);
  assert.match(appSource, /async function destroyMpvPilotHosts\(\) \{\s+state\.html5DrawingSurface = null;\s+document\.body\.classList\.remove\('drawing-surface-ready'\);\s+invalidateMpvHostVisibilityRequests\(\);/);
  assert.match(appSource,
    /restoreNativeHost: async \(\) => \{[\s\S]*?applyMpvHostVisibility\(true\);[\s\S]*?didMpvHostVisibilityApply\(result, true\)/);
  assert.match(appSource,
    /async function releaseMpvReviewFreezeFrame\(\) \{[\s\S]*?applyMpvHostVisibility\(true\);[\s\S]*?!didMpvHostVisibilityApply\(result, true\)/);
});

test('legacy remote strokes and the collaboration ripple have native mpv mirror paths', () => {
  assert.match(appSource,
    /new DrawingSync\(\{[\s\S]*?onRemoteStrokeOverlayChange:[\s\S]*?scheduleMpvOverlayStateSync\(\{ liveDrawing: true \}\)/);
  assert.match(appSource,
    /remoteStrokeDataUrl:[\s\S]*?getCanvasOverlayDataUrl\(remoteStrokeOverlayForMpv\)/);
  assert.match(appSource,
    /remoteStrokeOpacity:[\s\S]*?remoteStrokeOverlayForMpv\.style\.opacity/);
  assert.match(appSource,
    /const MPV_OVERLAY_DIFF_FIELDS = \[[^\]]*'remoteStrokeDataUrl'/);
  assert.match(appSource,
    /function _triggerCollabRipple\(\) \{[\s\S]*?mpvTriggerOverlayCollabRipple\(\{ x: normalizedX, y: normalizedY \}\)/);
  assert.match(preloadSource,
    /mpvTriggerOverlayCollabRipple:\s*\(state\) => ipcRenderer\.invoke\('mpv:trigger-overlay-collab-ripple', state\)/);
  assert.match(ipcSource,
    /ipcMain\.handle\('mpv:trigger-overlay-collab-ripple'[\s\S]*?mpvOverlayHost\.triggerCollabRipple\(state\)/);
});

test('Fabric native input relays normalized pointer presence back to Liveblocks', () => {
  assert.match(preloadSource, /onMpvOverlayPointerPresence/);
  assert.match(appSource,
    /onMpvOverlayPointerPresence\?\.\(\(cursor\) => \{[\s\S]*?liveblocksManager\.updatePresence\(\{ cursor \}\);/);
});
