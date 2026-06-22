const assert = require('assert');
const test = require('node:test');
const path = require('path');

const {
  getSwitchValue,
  resolveMultiInstanceUserDataPath,
  sanitizeProfileName,
  shouldAllowMultipleInstances
} = require('../../main/instance-policy');

test('development mode allows multiple instances without a switch', () => {
  assert.equal(shouldAllowMultipleInstances({ isDev: true, argv: [], env: {} }), true);
});

test('packaged mode stays single-instance by default', () => {
  assert.equal(shouldAllowMultipleInstances({ isDev: false, argv: [], env: {} }), false);
});

test('packaged file launches open in a new instance by default', () => {
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', 'G:\\project\\review.bframe'],
    env: {}
  }), true);
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', 'G:\\project\\playlist.bplaylist'],
    env: {}
  }), true);
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', 'baeframe://playlist/G:/project/playlist.bplaylist'],
    env: {}
  }), true);
});

test('explicit multi-instance switches allow packaged comparison runs', () => {
  assert.equal(shouldAllowMultipleInstances({ argv: ['BFRAME_alpha_v2.exe', '--multi-instance'], env: {} }), true);
  assert.equal(shouldAllowMultipleInstances({ argv: ['BFRAME_alpha_v2.exe', '--multi-instance-profile=A'], env: {} }), true);
  assert.equal(shouldAllowMultipleInstances({ argv: ['BFRAME_alpha_v2.exe', '--multi-instance-user-data=C:\\temp\\A'], env: {} }), true);
  assert.equal(shouldAllowMultipleInstances({ argv: ['BFRAME_alpha_v2.exe'], env: { BAEFRAME_MULTI_INSTANCE: '1' } }), true);
  assert.equal(shouldAllowMultipleInstances({ argv: ['BFRAME_alpha_v2.exe'], env: { BAEFRAME_MULTI_INSTANCE_USER_DATA: 'C:\\temp\\A' } }), true);
  assert.equal(shouldAllowMultipleInstances({ argv: ['BFRAME_alpha_v2.exe'], env: { BAEFRAME_MULTI_INSTANCE_PROFILE: 'A' } }), true);
  assert.equal(shouldAllowMultipleInstances({ argv: ['BFRAME_alpha_v2.exe'], env: { BAEFRAME_MULTI_INSTANCE_ISOLATED: '1' } }), true);
});

test('multi-instance profile uses an isolated user data folder only when requested', () => {
  const shared = resolveMultiInstanceUserDataPath({
    allowMultipleInstances: true,
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', '--multi-instance'],
    env: {},
    appDataDir: 'C:\\Users\\tester\\AppData\\Roaming',
    pid: 1234
  });
  assert.equal(shared, null);

  const isolated = resolveMultiInstanceUserDataPath({
    allowMultipleInstances: true,
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', '--multi-instance-profile=shot-A'],
    env: {},
    appDataDir: 'C:\\Users\\tester\\AppData\\Roaming',
    pid: 1234
  });
  assert.equal(isolated, path.join('C:\\Users\\tester\\AppData\\Roaming', 'baeframe', 'multi-instance', 'shot-A'));
});

test('multi-instance profile names are sanitized for filesystem use', () => {
  assert.equal(sanitizeProfileName(' shot A/B:compare '), 'shot-A-B-compare');
  assert.equal(getSwitchValue(['app.exe', '--multi-instance-profile', 'A'], '--multi-instance-profile'), 'A');
});
