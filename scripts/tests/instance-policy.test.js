const assert = require('assert');
const test = require('node:test');
const path = require('path');

const {
  getSwitchValue,
  resolveMultiInstanceUserDataPath,
  sanitizeProfileName,
  shouldAllowMultipleInstances
} = require('../../main/instance-policy');
const { classifyLaunchArgument } = require('../../main/launch-routing');

test('development mode allows multiple instances without a switch', () => {
  assert.equal(shouldAllowMultipleInstances({ isDev: true, argv: [], env: {} }), true);
});

test('packaged mode stays single-instance by default', () => {
  assert.equal(shouldAllowMultipleInstances({ isDev: false, argv: [], env: {} }), false);
});

test('packaged Fabric trial allows a direct second instance without launch switches', () => {
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe'],
    env: {},
    runtimeProfile: {
      active: true,
      channel: 'fabric-v3-trial',
      isolateUserData: true
    }
  }), true);

  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe'],
    env: {},
    runtimeProfile: {
      active: false,
      channel: null,
      isolateUserData: false
    }
  }), false);
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
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', 'baeframe://open?file=G%3A%5Cproject%5Creview.bframe&comment=marker-1'],
    env: {}
  }), true);
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', 'baeframe://open?file=G%3A%5Cproject%5Cplaylist.bplaylist&comment=marker-1'],
    env: {}
  }), true);
});

test('packaged non-project launches keep the existing single-instance router', () => {
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', 'G:\\project\\review.mov'],
    env: {}
  }), false);
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', 'G:\\project\\cuts.bcutlist'],
    env: {}
  }), false);
  assert.equal(shouldAllowMultipleInstances({
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe', 'baeframe://open?file=G%3A%5Cproject%5Creview.mov&comment=marker-1'],
    env: {}
  }), false);
});

test('open deeplinks classify project files before the single-instance router', () => {
  assert.equal(classifyLaunchArgument('baeframe://open?file=G%3A%5Cproject%5Creview.bframe&comment=marker-1'), 'project');
  assert.equal(classifyLaunchArgument('baeframe://open?file=G%3A%5Cproject%5Cplaylist.bplaylist&comment=marker-1'), 'playlist');
  assert.equal(classifyLaunchArgument('baeframe://open?file=G%3A%5Cproject%5Ccuts.bcutlist&comment=marker-1'), 'cutlist');
  assert.equal(classifyLaunchArgument('baeframe://open?file=G%3A%5Cproject%5Creview.mov&comment=marker-1'), 'video');
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

test('Fabric trial defaults to a PID-isolated user data folder', () => {
  const isolated = resolveMultiInstanceUserDataPath({
    allowMultipleInstances: true,
    isDev: false,
    argv: ['BFRAME_alpha_v2.exe'],
    env: {},
    appDataDir: 'C:\\Users\\tester\\AppData\\Roaming',
    pid: 1234,
    runtimeProfile: {
      active: true,
      channel: 'fabric-v3-trial',
      isolateUserData: true
    }
  });

  assert.equal(
    isolated,
    path.join('C:\\Users\\tester\\AppData\\Roaming', 'baeframe', 'multi-instance', 'pid-1234')
  );
});

test('explicit user data and named profiles override the trial PID default', () => {
  const runtimeProfile = {
    active: true,
    channel: 'fabric-v3-trial',
    isolateUserData: true
  };

  assert.equal(
    resolveMultiInstanceUserDataPath({
      allowMultipleInstances: true,
      isDev: false,
      argv: ['BFRAME_alpha_v2.exe', '--multi-instance-user-data=C:\\trial\\manual'],
      env: {},
      appDataDir: 'C:\\Users\\tester\\AppData\\Roaming',
      pid: 1234,
      runtimeProfile
    }),
    path.resolve('C:\\trial\\manual')
  );

  assert.equal(
    resolveMultiInstanceUserDataPath({
      allowMultipleInstances: true,
      isDev: false,
      argv: ['BFRAME_alpha_v2.exe', '--multi-instance-profile=manual-check'],
      env: {},
      appDataDir: 'C:\\Users\\tester\\AppData\\Roaming',
      pid: 1234,
      runtimeProfile
    }),
    path.join(
      'C:\\Users\\tester\\AppData\\Roaming',
      'baeframe',
      'multi-instance',
      'manual-check'
    )
  );
});

test('multi-instance profile names are sanitized for filesystem use', () => {
  assert.equal(sanitizeProfileName(' shot A/B:compare '), 'shot-A-B-compare');
  assert.equal(getSwitchValue(['app.exe', '--multi-instance-profile', 'A'], '--multi-instance-profile'), 'A');
});
