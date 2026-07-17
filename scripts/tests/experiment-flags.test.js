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

function loadIpcSetupWithHandlerRegistry() {
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
      getMainWindow: () => null,
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
    ['./mpv-overlay-host', { mpvOverlayHost: {} }],
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

test('resolver returns a frozen exact result without mutating explicit inputs', () => {
  const resolverModule = require(resolverPath);
  const argv = Object.freeze(['--fabric-drawing-pilot']);
  const env = Object.freeze({ BAEFRAME_FABRIC_DRAWING_PILOT: '1' });

  assert.deepEqual(Object.keys(resolverModule), ['resolveFabricDrawingPilot']);

  const result = resolverModule.resolveFabricDrawingPilot({ argv, env });

  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result).sort(), ['enabled', 'source']);
  assert.deepEqual(argv, ['--fabric-drawing-pilot']);
  assert.deepEqual(env, { BAEFRAME_FABRIC_DRAWING_PILOT: '1' });

  const resolverSource = fs.readFileSync(resolverPath, 'utf8');
  assert.doesNotMatch(resolverSource, /electron-store|localStorage|writeFile|appendFile/);
});

test('main startup resolves the pilot once and injects the frozen state into IPC setup', () => {
  const mainSource = fs.readFileSync(path.join(repoRoot, 'main', 'index.js'), 'utf8');
  const resolverCalls = mainSource.match(/resolveFabricDrawingPilot\s*\(/g) || [];

  assert.equal(resolverCalls.length, 1);
  assert.match(
    mainSource,
    /const\s+fabricDrawingPilot\s*=\s*resolveFabricDrawingPilot\s*\(\s*\)\s*;/
  );
  assert.match(
    mainSource,
    /setupIpcHandlers\s*\(\s*\{\s*fabricDrawingPilot\s*\}\s*\)\s*;/
  );
});

test('IPC pilot state handler defaults off and returns only a boolean snapshot', () => {
  const cases = [
    [undefined, false],
    [{ fabricDrawingPilot: Object.freeze({ enabled: true, source: 'env' }) }, true],
    [{ fabricDrawingPilot: Object.freeze({ enabled: false, source: 'kill-switch' }) }, false],
    [{ fabricDrawingPilot: { enabled: 'true', source: 'cli', argv: ['secret'] } }, false]
  ];

  for (const [options, expected] of cases) {
    const { setupIpcHandlers, handlers } = loadIpcSetupWithHandlerRegistry();
    setupIpcHandlers(options);

    const stateHandler = handlers.get('fabric-drawing:get-pilot-state');
    assert.equal(typeof stateHandler, 'function');

    const state = stateHandler({ sender: { id: 42 } });
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

test('Fabric and perfect-freehand versions are exact and Fabric stays build-only', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.devDependencies.fabric, '7.4.0');
  assert.equal(packageJson.dependencies['perfect-freehand'], '1.2.3');
  assert.equal(packageJson.dependencies.fabric, undefined);
});
