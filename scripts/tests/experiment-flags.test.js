const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const resolverPath = path.join(repoRoot, 'main', 'experiment-flags.js');

function loadResolver() {
  return require(resolverPath).resolveFabricDrawingPilot;
}

test('Fabric drawing pilot resolves enable and disable sources by priority', () => {
  const resolveFabricDrawingPilot = loadResolver();
  const cases = [
    [{ argv: [], env: {} }, { enabled: false, source: 'default' }],
    [{ argv: ['--fabric-drawing-pilot'], env: {} }, { enabled: true, source: 'cli' }],
    [{ argv: [], env: { BAEFRAME_FABRIC_DRAWING_PILOT: '1' } }, { enabled: true, source: 'env' }],
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
    }, { enabled: false, source: 'kill-switch' }]
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(resolveFabricDrawingPilot(input), expected);
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

test('Fabric and perfect-freehand versions are exact and Fabric stays build-only', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.devDependencies.fabric, '7.4.0');
  assert.equal(packageJson.dependencies['perfect-freehand'], '1.2.3');
  assert.equal(packageJson.dependencies.fabric, undefined);
});
