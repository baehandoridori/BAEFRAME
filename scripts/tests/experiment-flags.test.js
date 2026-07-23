const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const resolverPath = path.join(repoRoot, 'main', 'experiment-flags.js');
const ipcHandlersPath = path.join(repoRoot, 'main', 'ipc-handlers.js');

function loadResolver() {
  return require(resolverPath).resolveFabricDrawingPilot;
}

function loadShadowResolver() {
  const resolver = require(resolverPath).resolveFabricDrawingV3Shadow;
  assert.equal(
    typeof resolver,
    'function',
    'experiment-flags must export resolveFabricDrawingV3Shadow'
  );
  return resolver;
}

function loadMpvResolver() {
  const resolver = require(resolverPath).resolveMpvPlaybackPilot;
  assert.equal(
    typeof resolver,
    'function',
    'experiment-flags must export resolveMpvPlaybackPilot'
  );
  return resolver;
}

function trialRuntimeProfile() {
  return Object.freeze({
    active: true,
    source: 'marker',
    schemaVersion: 1,
    channel: 'fabric-v3-trial',
    features: Object.freeze({
      mpvPlaybackPilot: true,
      fabricDrawingPilot: true,
      fabricDrawingV3Shadow: true,
      fabricDrawingPersistence: true
    }),
    isolateUserData: true,
    skipShellRegistration: true
  });
}

function stableRuntimeProfile() {
  return Object.freeze({
    active: true,
    source: 'marker',
    schemaVersion: 1,
    channel: 'fabric-v3-stable',
    features: Object.freeze({
      mpvPlaybackPilot: true,
      fabricDrawingPilot: true,
      fabricDrawingV3Shadow: true,
      fabricDrawingPersistence: true
    }),
    isolateUserData: false,
    skipShellRegistration: false
  });
}

function loadIpcSetupWithHandlerRegistry(options = {}) {
  const handlers = new Map();
  const noop = () => {};
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    on: noop
  };
  const fakeModules = new Map([
    ['electron', { ipcMain, dialog: {}, app: {}, clipboard: {}, shell: {} }],
    ['./logger', {
      createLogger: () => ({
        debug: noop,
        error: noop,
        info: noop,
        trace: () => ({ end: noop, error: noop }),
        warn: noop
      })
    }],
    ['./window', {
      closeWindow: noop,
      getMainWindow: () => options.mainWindow || null,
      isFullscreen: () => false,
      isMaximized: () => false,
      minimizeWindow: noop,
      toggleFullscreen: noop,
      toggleMaximize: noop
    }],
    ['./recent-files-store', { RecentFilesStore: class RecentFilesStore {} }],
    ['./recent-thumb-capture', {}],
    ['./cutlist-paths', { validateCutlistFilePath: (value) => value }],
    ['./mpv-manager', { MPVManager: class MPVManager {}, mpvManager: {} }],
    ['./mpv-embed-host', { mpvEmbedHost: {} }],
    ['./mpv-overlay-host', { mpvOverlayHost: options.mpvOverlayHost || {} }],
    ['electron-store', class Store {}]
  ]);
  const originalLoad = Module._load;

  delete require.cache[ipcHandlersPath];
  Module._load = function loadWithFakes(request, parent, isMain) {
    if (parent?.filename === ipcHandlersPath && fakeModules.has(request)) {
      return fakeModules.get(request);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return { ...require(ipcHandlersPath), handlers };
  } finally {
    Module._load = originalLoad;
    delete require.cache[ipcHandlersPath];
  }
}

test('Fabric drawing pilot resolves enable and disable sources by priority', () => {
  const resolveFabricDrawingPilot = loadResolver();
  const cases = [
    [{ argv: [], env: {} }, { enabled: false, source: 'default' }],
    [{ argv: ['--fabric-drawing-pilot'], env: {} }, { enabled: true, source: 'cli' }],
    [{ argv: [], env: { BAEFRAME_FABRIC_DRAWING_PILOT: '1' } }, { enabled: true, source: 'env' }],
    [{ argv: [], env: { BAEFRAME_FABRIC_DRAWING_PILOT: ' 1 ' } }, { enabled: true, source: 'env' }],
    [{
      argv: ['--fabric-drawing-pilot'],
      env: { BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT: '1' }
    }, { enabled: false, source: 'kill-switch' }],
    [{
      argv: ['--disable-fabric-drawing-pilot'],
      env: { BAEFRAME_FABRIC_DRAWING_PILOT: '1' }
    }, { enabled: false, source: 'kill-switch' }],
    [{
      argv: [],
      env: {
        BAEFRAME_FABRIC_DRAWING_PILOT: '1',
        BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT: 'true'
      }
    }, { enabled: true, source: 'env' }]
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(resolveFabricDrawingPilot(input), expected);
  }
});

test('valid trial marker enables mpv, Fabric, and V3 shadow without environment mutation', () => {
  const resolveMpvPlaybackPilot = loadMpvResolver();
  const resolveFabricDrawingPilot = loadResolver();
  const resolveFabricDrawingV3Shadow = loadShadowResolver();
  const runtimeProfile = trialRuntimeProfile();
  const argv = Object.freeze([]);
  const env = Object.freeze({});

  const mpvPlaybackPilot = resolveMpvPlaybackPilot({ argv, env, runtimeProfile });
  const fabricDrawingPilot = resolveFabricDrawingPilot({ argv, env, runtimeProfile });
  const fabricDrawingV3Shadow = resolveFabricDrawingV3Shadow({
    argv,
    env,
    runtimeProfile,
    fabricDrawingPilot
  });

  assert.deepEqual(mpvPlaybackPilot, { enabled: true, source: 'marker' });
  assert.deepEqual(fabricDrawingPilot, { enabled: true, source: 'marker' });
  assert.deepEqual(fabricDrawingV3Shadow, { enabled: true, source: 'marker' });
  assert.equal(Object.isFrozen(mpvPlaybackPilot), true);
  assert.equal(Object.isFrozen(fabricDrawingPilot), true);
  assert.equal(Object.isFrozen(fabricDrawingV3Shadow), true);
  assert.deepEqual(argv, []);
  assert.deepEqual(env, {});
});

test('valid stable marker enables mpv, Fabric, and V3 shadow without trial isolation', () => {
  const resolveMpvPlaybackPilot = loadMpvResolver();
  const resolveFabricDrawingPilot = loadResolver();
  const resolveFabricDrawingV3Shadow = loadShadowResolver();
  const runtimeProfile = stableRuntimeProfile();

  const mpvPlaybackPilot = resolveMpvPlaybackPilot({
    argv: [],
    env: {},
    runtimeProfile
  });
  const fabricDrawingPilot = resolveFabricDrawingPilot({
    argv: [],
    env: {},
    runtimeProfile
  });
  const fabricDrawingV3Shadow = resolveFabricDrawingV3Shadow({
    argv: [],
    env: {},
    runtimeProfile,
    fabricDrawingPilot
  });

  assert.deepEqual(mpvPlaybackPilot, { enabled: true, source: 'marker' });
  assert.deepEqual(fabricDrawingPilot, { enabled: true, source: 'marker' });
  assert.deepEqual(fabricDrawingV3Shadow, { enabled: true, source: 'marker' });
  assert.equal(runtimeProfile.isolateUserData, false);
  assert.equal(runtimeProfile.skipShellRegistration, false);
});

test('kill switches win over the valid stable marker', () => {
  const runtimeProfile = stableRuntimeProfile();
  const resolveMpvPlaybackPilot = loadMpvResolver();
  const resolveFabricDrawingPilot = loadResolver();
  const resolveFabricDrawingV3Shadow = loadShadowResolver();

  const mpvPlaybackPilot = resolveMpvPlaybackPilot({
    argv: [],
    env: { BAEFRAME_DISABLE_MPV: '1' },
    runtimeProfile
  });
  const fabricDrawingPilot = resolveFabricDrawingPilot({
    argv: [],
    env: { BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT: '1' },
    runtimeProfile
  });

  assert.deepEqual(mpvPlaybackPilot, { enabled: false, source: 'kill-switch' });
  assert.deepEqual(fabricDrawingPilot, { enabled: false, source: 'kill-switch' });
  assert.deepEqual(
    resolveFabricDrawingV3Shadow({
      argv: [],
      env: { BAEFRAME_DISABLE_FABRIC_DRAWING_V3_SHADOW: '1' },
      runtimeProfile,
      fabricDrawingPilot: { enabled: true, source: 'marker' }
    }),
    { enabled: false, source: 'kill-switch' }
  );
});

test('kill switches win over the valid trial marker and explicit flags win over marker source', () => {
  const runtimeProfile = trialRuntimeProfile();
  const resolveMpvPlaybackPilot = loadMpvResolver();
  const resolveFabricDrawingPilot = loadResolver();
  const resolveFabricDrawingV3Shadow = loadShadowResolver();

  assert.deepEqual(
    resolveMpvPlaybackPilot({
      argv: [],
      env: { BAEFRAME_DISABLE_MPV: '1', BAEFRAME_MPV_PILOT: '1' },
      runtimeProfile
    }),
    { enabled: false, source: 'kill-switch' }
  );
  assert.deepEqual(
    resolveFabricDrawingPilot({
      argv: ['--fabric-drawing-pilot'],
      env: { BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT: '1' },
      runtimeProfile
    }),
    { enabled: false, source: 'kill-switch' }
  );
  assert.deepEqual(
    resolveFabricDrawingV3Shadow({
      argv: ['--fabric-drawing-v3-shadow'],
      env: { BAEFRAME_DISABLE_FABRIC_DRAWING_V3_SHADOW: '1' },
      runtimeProfile,
      fabricDrawingPilot: { enabled: true, source: 'marker' }
    }),
    { enabled: false, source: 'kill-switch' }
  );

  assert.deepEqual(
    resolveMpvPlaybackPilot({
      argv: [],
      env: { BAEFRAME_MPV_PILOT: '1' },
      runtimeProfile
    }),
    { enabled: true, source: 'env' }
  );
  assert.deepEqual(
    resolveFabricDrawingPilot({
      argv: ['--fabric-drawing-pilot'],
      env: {},
      runtimeProfile
    }),
    { enabled: true, source: 'cli' }
  );
});

test('mpv resolver keeps default OFF and supports existing explicit environment activation', () => {
  const resolveMpvPlaybackPilot = loadMpvResolver();

  assert.deepEqual(
    resolveMpvPlaybackPilot({ argv: [], env: {}, runtimeProfile: null }),
    { enabled: false, source: 'default' }
  );
  assert.deepEqual(
    resolveMpvPlaybackPilot({
      argv: [],
      env: { BAEFRAME_MPV_PILOT: 'true' },
      runtimeProfile: null
    }),
    { enabled: true, source: 'env' }
  );
  assert.deepEqual(
    resolveMpvPlaybackPilot({
      argv: ['--mpv-pilot'],
      env: {},
      runtimeProfile: null
    }),
    { enabled: true, source: 'cli' }
  );
});

test('a partial, future, or cross-channel profile cannot enable any runtime feature', () => {
  const resolveMpvPlaybackPilot = loadMpvResolver();
  const resolveFabricDrawingPilot = loadResolver();
  const resolveFabricDrawingV3Shadow = loadShadowResolver();
  const invalidProfiles = [
    {
      ...trialRuntimeProfile(),
      schemaVersion: 2
    },
    {
      ...trialRuntimeProfile(),
      features: {
        ...trialRuntimeProfile().features,
        fabricDrawingPersistence: false
      }
    },
    {
      ...trialRuntimeProfile(),
      unknown: true
    },
    {
      ...stableRuntimeProfile(),
      schemaVersion: 2
    },
    {
      ...stableRuntimeProfile(),
      features: {
        ...stableRuntimeProfile().features,
        fabricDrawingPersistence: false
      }
    },
    {
      ...stableRuntimeProfile(),
      isolateUserData: true
    },
    {
      ...stableRuntimeProfile(),
      channel: 'fabric-v3-trial'
    }
  ];

  for (const runtimeProfile of invalidProfiles) {
    const mpvPlaybackPilot = resolveMpvPlaybackPilot({
      argv: [],
      env: {},
      runtimeProfile
    });
    const fabricDrawingPilot = resolveFabricDrawingPilot({
      argv: [],
      env: {},
      runtimeProfile
    });
    const fabricDrawingV3Shadow = resolveFabricDrawingV3Shadow({
      argv: [],
      env: {},
      runtimeProfile,
      fabricDrawingPilot
    });

    assert.deepEqual(mpvPlaybackPilot, { enabled: false, source: 'default' });
    assert.deepEqual(fabricDrawingPilot, { enabled: false, source: 'default' });
    assert.deepEqual(
      fabricDrawingV3Shadow,
      { enabled: false, source: 'fabric-pilot-disabled' }
    );
  }
});

test('environment flags accept only the trimmed exact value 1', () => {
  const resolveFabricDrawingPilot = loadResolver();

  for (const value of ['true', 'yes', 'on', '01']) {
    assert.deepEqual(
      resolveFabricDrawingPilot({
        argv: [],
        env: { BAEFRAME_FABRIC_DRAWING_PILOT: value }
      }),
      { enabled: false, source: 'default' }
    );
    assert.deepEqual(
      resolveFabricDrawingPilot({
        argv: [],
        env: { BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT: value }
      }),
      { enabled: false, source: 'default' }
    );
    assert.deepEqual(
      resolveFabricDrawingPilot({
        argv: [],
        env: {
          BAEFRAME_FABRIC_DRAWING_PILOT: '1',
          BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT: value
        }
      }),
      { enabled: true, source: 'env' }
    );
  }
});

test('legacy shortened kill-switch names do not change the approved flag contract', () => {
  const resolveFabricDrawingPilot = loadResolver();

  assert.deepEqual(
    resolveFabricDrawingPilot({
      argv: ['--fabric-drawing-pilot', '--disable-fabric-drawing'],
      env: { BAEFRAME_DISABLE_FABRIC_DRAWING: '1' }
    }),
    { enabled: true, source: 'cli' }
  );
});

test('Fabric drawing V3 shadow resolves kill, pilot dependency, CLI, env, and default in priority order', () => {
  const resolveFabricDrawingV3Shadow = loadShadowResolver();
  const enabledPilot = Object.freeze({ enabled: true, source: 'cli' });
  const disabledPilot = Object.freeze({ enabled: false, source: 'default' });
  const cases = [
    [{
      argv: ['--fabric-drawing-v3-shadow', '--disable-fabric-drawing-v3-shadow'],
      env: { BAEFRAME_FABRIC_DRAWING_V3_SHADOW: '1' },
      fabricDrawingPilot: disabledPilot
    }, { enabled: false, source: 'kill-switch' }],
    [{
      argv: ['--fabric-drawing-v3-shadow'],
      env: { BAEFRAME_DISABLE_FABRIC_DRAWING_V3_SHADOW: '1' },
      fabricDrawingPilot: enabledPilot
    }, { enabled: false, source: 'kill-switch' }],
    [{
      argv: ['--fabric-drawing-v3-shadow'],
      env: { BAEFRAME_FABRIC_DRAWING_V3_SHADOW: '1' },
      fabricDrawingPilot: disabledPilot
    }, { enabled: false, source: 'fabric-pilot-disabled' }],
    [{
      argv: ['--fabric-drawing-v3-shadow'],
      env: { BAEFRAME_FABRIC_DRAWING_V3_SHADOW: '1' },
      fabricDrawingPilot: enabledPilot
    }, { enabled: true, source: 'cli' }],
    [{
      argv: [],
      env: { BAEFRAME_FABRIC_DRAWING_V3_SHADOW: '1' },
      fabricDrawingPilot: enabledPilot
    }, { enabled: true, source: 'env' }],
    [{
      argv: [],
      env: {},
      fabricDrawingPilot: enabledPilot
    }, { enabled: false, source: 'default' }]
  ];

  for (const [input, expected] of cases) {
    const result = resolveFabricDrawingV3Shadow(input);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Object.keys(result).sort(), ['enabled', 'source']);
    assert.deepEqual(result, expected);
  }
});

test('Fabric drawing V3 shadow environment flags accept only the trimmed exact value 1', () => {
  const resolveFabricDrawingV3Shadow = loadShadowResolver();
  const fabricDrawingPilot = Object.freeze({ enabled: true, source: 'env' });

  assert.deepEqual(
    resolveFabricDrawingV3Shadow({
      argv: [],
      env: { BAEFRAME_FABRIC_DRAWING_V3_SHADOW: ' 1 ' },
      fabricDrawingPilot
    }),
    { enabled: true, source: 'env' }
  );

  for (const value of ['true', 'yes', 'on', '01', '1.0']) {
    assert.deepEqual(
      resolveFabricDrawingV3Shadow({
        argv: [],
        env: { BAEFRAME_FABRIC_DRAWING_V3_SHADOW: value },
        fabricDrawingPilot
      }),
      { enabled: false, source: 'default' }
    );
    assert.deepEqual(
      resolveFabricDrawingV3Shadow({
        argv: ['--fabric-drawing-v3-shadow'],
        env: { BAEFRAME_DISABLE_FABRIC_DRAWING_V3_SHADOW: value },
        fabricDrawingPilot
      }),
      { enabled: true, source: 'cli' }
    );
  }
});

test('Fabric drawing V3 shadow stays off for missing or invalid Fabric pilot state', () => {
  const resolveFabricDrawingV3Shadow = loadShadowResolver();

  for (const fabricDrawingPilot of [
    undefined,
    null,
    true,
    {},
    { enabled: false },
    { enabled: 'true' },
    { enabled: 1 }
  ]) {
    assert.deepEqual(
      resolveFabricDrawingV3Shadow({
        argv: ['--fabric-drawing-v3-shadow'],
        env: {},
        fabricDrawingPilot
      }),
      { enabled: false, source: 'fabric-pilot-disabled' }
    );
  }
});

test('Fabric drawing V3 shadow returns a frozen exact result without mutating inputs', () => {
  const resolverModule = require(resolverPath);
  const argv = Object.freeze(['--fabric-drawing-v3-shadow']);
  const env = Object.freeze({ BAEFRAME_FABRIC_DRAWING_V3_SHADOW: '1' });
  const fabricDrawingPilot = Object.freeze({ enabled: true, source: 'cli' });
  const input = Object.freeze({ argv, env, fabricDrawingPilot });

  assert.deepEqual(
    Object.keys(resolverModule).sort(),
    ['resolveFabricDrawingPilot', 'resolveFabricDrawingV3Shadow', 'resolveMpvPlaybackPilot']
  );

  const result = resolverModule.resolveFabricDrawingV3Shadow(input);

  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result).sort(), ['enabled', 'source']);
  assert.deepEqual(result, { enabled: true, source: 'cli' });
  assert.deepEqual(argv, ['--fabric-drawing-v3-shadow']);
  assert.deepEqual(env, { BAEFRAME_FABRIC_DRAWING_V3_SHADOW: '1' });
  assert.deepEqual(fabricDrawingPilot, { enabled: true, source: 'cli' });
  assert.deepEqual(input, { argv, env, fabricDrawingPilot });
});

test('resolver returns a frozen exact result without mutating explicit inputs', () => {
  const resolverModule = require(resolverPath);
  const argv = Object.freeze(['--fabric-drawing-pilot']);
  const env = Object.freeze({ BAEFRAME_FABRIC_DRAWING_PILOT: '1' });

  assert.deepEqual(
    Object.keys(resolverModule).sort(),
    ['resolveFabricDrawingPilot', 'resolveFabricDrawingV3Shadow', 'resolveMpvPlaybackPilot']
  );

  const result = resolverModule.resolveFabricDrawingPilot({ argv, env });

  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result).sort(), ['enabled', 'source']);
  assert.deepEqual(argv, ['--fabric-drawing-pilot']);
  assert.deepEqual(env, { BAEFRAME_FABRIC_DRAWING_PILOT: '1' });

  const resolverSource = fs.readFileSync(resolverPath, 'utf8');
  assert.doesNotMatch(resolverSource, /electron-store|localStorage|writeFile|appendFile/);
  const mainSource = fs.readFileSync(path.join(repoRoot, 'main', 'index.js'), 'utf8');
  assert.doesNotMatch(
    mainSource,
    /process\.env\.(?:BAEFRAME_MPV_PILOT|BAEFRAME_FABRIC_DRAWING_PILOT|BAEFRAME_FABRIC_DRAWING_V3_SHADOW)\s*=/
  );
});

test('main startup resolves the packaged profile and injects mpv/Fabric states once before app readiness', () => {
  const mainSource = fs.readFileSync(path.join(repoRoot, 'main', 'index.js'), 'utf8');
  const runtimeProfileCalls = mainSource.match(/loadRuntimeProfile\s*\(/g) || [];
  const mpvResolverCalls = mainSource.match(/resolveMpvPlaybackPilot\s*\(/g) || [];
  const fabricResolverCalls = mainSource.match(/resolveFabricDrawingPilot\s*\(/g) || [];
  const shadowResolverCalls = mainSource.match(/resolveFabricDrawingV3Shadow\s*\(/g) || [];
  const mpvConfigureCalls = mainSource.match(/mpvManager\.configurePilotState\s*\(/g) || [];
  const shadowConfigureCalls = mainSource.match(
    /mpvOverlayHost\.configureDrawingV3Shadow\s*\(/g
  ) || [];
  const readyCalls = mainSource.match(/app\.whenReady\s*\(/g) || [];

  assert.equal(runtimeProfileCalls.length, 1);
  assert.equal(mpvResolverCalls.length, 1);
  assert.equal(fabricResolverCalls.length, 1);
  assert.equal(shadowResolverCalls.length, 1);
  assert.equal(mpvConfigureCalls.length, 1);
  assert.equal(shadowConfigureCalls.length, 1);
  assert.equal(readyCalls.length, 1);

  const runtimeProfileResolution = mainSource.match(
    /const\s+runtimeProfile\s*=\s*loadRuntimeProfile\s*\(\s*\{[\s\S]*?isPackaged:\s*app\.isPackaged,[\s\S]*?resourcesPath:\s*process\.resourcesPath[\s\S]*?\}\s*\)\s*;/
  );
  const mpvResolution = mainSource.match(
    /const\s+mpvPlaybackPilot\s*=\s*resolveMpvPlaybackPilot\s*\(\s*\{\s*runtimeProfile\s*\}\s*\)\s*;/
  );
  const fabricResolution = mainSource.match(
    /const\s+fabricDrawingPilot\s*=\s*resolveFabricDrawingPilot\s*\(\s*\{\s*runtimeProfile\s*\}\s*\)\s*;/
  );
  const shadowResolution = mainSource.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*resolveFabricDrawingV3Shadow\s*\(\s*\{\s*fabricDrawingPilot,\s*runtimeProfile\s*\}\s*\)\s*;/
  );
  assert.ok(runtimeProfileResolution);
  assert.ok(mpvResolution);
  assert.ok(fabricResolution);
  assert.ok(shadowResolution);

  const shadowStateName = shadowResolution[1];
  const escapedShadowStateName = shadowStateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mpvConfiguration = mainSource.match(
    /mpvManager\.configurePilotState\s*\(\s*mpvPlaybackPilot\s*\)\s*;/
  );
  const shadowConfiguration = mainSource.match(new RegExp(
    `mpvOverlayHost\\.configureDrawingV3Shadow\\s*\\(\\s*${escapedShadowStateName}\\.enabled\\s*\\)\\s*;`
  ));
  assert.ok(mpvConfiguration);
  assert.ok(shadowConfiguration);

  const readyIndex = mainSource.search(/app\.whenReady\s*\(/);
  assert.ok(runtimeProfileResolution.index < mpvResolution.index);
  assert.ok(mpvResolution.index < fabricResolution.index);
  assert.ok(fabricResolution.index < shadowResolution.index);
  assert.ok(shadowResolution.index < mpvConfiguration.index);
  assert.ok(shadowResolution.index < shadowConfiguration.index);
  assert.ok(shadowConfiguration.index < readyIndex);

  const setupCalls = Array.from(
    mainSource.matchAll(/setupIpcHandlers\s*\(\s*([^)]*?)\s*\)\s*;/g)
  );
  assert.equal(setupCalls.length, 1);
  assert.match(setupCalls[0][1], /^\{\s*fabricDrawingPilot\s*\}$/);
  assert.doesNotMatch(setupCalls[0][1], /shadow|drawingV3/i);
});

test('IPC pilot state handler defaults off and returns only a boolean snapshot', () => {
  const cases = [
    [undefined, false],
    [{ fabricDrawingPilot: Object.freeze({ enabled: true, source: 'env' }) }, true],
    [{ fabricDrawingPilot: Object.freeze({ enabled: false, source: 'kill-switch' }) }, false],
    [{ fabricDrawingPilot: { enabled: 'true', source: 'cli', argv: ['secret'] } }, false]
  ];

  for (const [options, expected] of cases) {
    const sender = { id: 42 };
    const mainWindow = { isDestroyed: () => false, webContents: sender };
    const { setupIpcHandlers, handlers } = loadIpcSetupWithHandlerRegistry({ mainWindow });
    setupIpcHandlers(options);

    const stateHandler = handlers.get('fabric-drawing:get-pilot-state');
    assert.equal(typeof stateHandler, 'function');

    const state = stateHandler({ sender });
    assert.equal(state, expected);
    assert.equal(typeof state, 'boolean');
  }

  const ipcSource = fs.readFileSync(ipcHandlersPath, 'utf8');
  assert.match(
    ipcSource,
    /function\s+setupIpcHandlers\s*\(\s*\{\s*fabricDrawingPilot\s*=\s*DEFAULT_FABRIC_DRAWING_PILOT_STATE\s*\}\s*=\s*\{\}\s*\)/
  );
  const registration = ipcSource.match(
    /ipcMain\.handle\s*\(\s*['"]fabric-drawing:get-pilot-state['"][\s\S]{0,160}/
  );
  assert.ok(registration);
  assert.doesNotMatch(registration[0], /\b(?:argv|env|source)\b/);
});

test('IPC pilot state returns enabled only to the current main renderer sender', () => {
  const currentSender = { id: 41 };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: currentSender
  };
  const { setupIpcHandlers, handlers } = loadIpcSetupWithHandlerRegistry({ mainWindow });
  setupIpcHandlers({
    fabricDrawingPilot: Object.freeze({ enabled: true, source: 'cli' })
  });
  const stateHandler = handlers.get('fabric-drawing:get-pilot-state');

  assert.equal(stateHandler({ sender: currentSender }), true);
  assert.equal(stateHandler({ sender: { id: 42 } }), false);
  assert.equal(stateHandler({}), false);
  assert.equal(typeof stateHandler({ sender: { id: 42 } }), 'boolean');
});

test('Fabric and perfect-freehand versions are exact and Fabric stays build-only', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.devDependencies.fabric, '7.4.0');
  assert.equal(packageJson.dependencies['perfect-freehand'], '1.2.3');
  assert.equal(packageJson.dependencies.fabric, undefined);
});
