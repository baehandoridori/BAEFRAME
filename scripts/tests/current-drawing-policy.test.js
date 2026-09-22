const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8').replace(/\r\n/g, '\n');
const settings = fs.readFileSync(path.join(root, 'renderer/scripts/modules/user-settings.js'), 'utf8').replace(/\r\n/g, '\n');

function appFunction(name) {
  const match = app.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, name);
  return match[0];
}
function settingsMethod(name) {
  const match = settings.match(new RegExp(`  ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, name);
  return match[0];
}

test('old per-PC playback and review flags migrate without replacing personal settings', () => {
  const migrate = vm.runInNewContext(`({${settingsMethod('_migrateLegacySettings')}})._migrateLegacySettings`);
  for (const old of [{ mpvPlaybackEnabled: false }, { mpvPilotEnabled: false }, { hybridReviewEngine: true }]) {
    const object = { settings: { ...old, userName: '테스터', customShortcuts: { drawMode: { key: 'KeyQ' } } } };
    migrate.call(object);
    assert.equal(object.settings.mpvPlaybackEnabled, true);
    assert.equal(object.settings.hybridReviewEngine, false);
    assert.equal('mpvPilotEnabled' in object.settings, false);
    assert.equal(object.settings.userName, '테스터');
    assert.equal(object.settings.customShortcuts.drawMode.key, 'KeyQ');
  }
});

for (const scenario of ['html5', 'disabled', 'preparing', 'ready']) {
  test(`B uses current drawing only when playback/controller are ${scenario}`, () => {
    const calls = [];
    const context = vm.createContext({ state: { isAudioMode: false, isDrawMode: false, isCommentMode: false },
      isMpvPilotPlaybackActive: () => scenario !== 'html5',
      fabricDrawingPilotController: {
        isEnabled: () => scenario !== 'disabled', getState: () => 'passive',
        shouldOwnDrawingShortcut: () => scenario !== 'preparing', toggle: () => calls.push('current')
      },
      fabricDrawingPilotStatusSnapshot: {}, fabricDrawingPilotDegradedNoticeShown: false,
      applyDrawModeState: () => calls.push('legacy'), showToast: () => calls.push('notice'), log: { debug() {} }
    });
    vm.runInContext(appFunction('toggleDrawMode'), context);
    context.toggleDrawMode();
    assert.deepEqual(calls, [scenario === 'ready' ? 'current' : 'notice']);
  });
}

test('the legacy palette cannot be reactivated by an asynchronous ready callback', () => {
  const visible = new Set();
  const element = name => ({ classList: { toggle: (key, on) => on && visible.add(`${name}:${key}`) } });
  const context = vm.createContext({ elements: { btnDrawMode: element('button'), drawingTools: element('old-tools'),
    drawingCanvas: element('old-canvas'), videoWrapper: element('wrapper') }, syncCommentInteractionPolicy() {} });
  vm.runInContext(appFunction('setDrawModeReadyState'), context);
  context.setDrawModeReadyState(true);
  assert.equal(visible.has('old-tools:visible'), false);
  assert.equal(visible.has('old-canvas:active'), false);
});
