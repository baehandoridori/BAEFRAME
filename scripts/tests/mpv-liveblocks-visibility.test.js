const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  const classes = new Set();
  let surfaceReady = true;
  const window = { electronAPI: {} };
  for (const name of ['mpvSetHostVisible', 'mpvSetOverlayVisible']) {
    window.electronAPI[name] = visible => {
      calls.push([name, visible]);
      return new Promise(resolve => pending.push(() => resolve({
        success: true, visible, ready: true, embed: { ready: true }, overlay: { ready: true }
      })));
    };
  }
  const document = { body: { classList: {
    toggle(name, visible) { if (visible) classes.add(name); else classes.delete(name); }
  } } };
  const api = Function('window', 'document', 'videoPlayer', 'isHtml5DrawingSurfaceReady', `
    let mpvHostVisibilityRequestRevision = 0;
    ${extractFunction('setMpvNativeHostVisibleClass')}
    ${extractFunction('didMpvHostVisibilityApply')}
    ${extractFunction('applyMpvHostVisibility')}
    ${extractFunction('invalidateMpvHostVisibilityRequests')}
    return { apply: applyMpvHostVisibility, didApply: didMpvHostVisibilityApply,
      invalidate: invalidateMpvHostVisibilityRequests };
  `)(window, document, { engine }, () => surfaceReady);
  return { ...api, calls, pending, classes, setSurfaceReady: value => { surfaceReady = value; } };
}

test('HTML5 drawing visibility only uses the prepared overlay and never marks native video visible', async () => {
  const harness = createVisibilityHarness('html5');
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

test('native and HTML5 visibility both reject older show completions after a newer hide or teardown', async () => {
  for (const engine of ['mpv-embedded', 'html5']) {
    const harness = createVisibilityHarness(engine);
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
