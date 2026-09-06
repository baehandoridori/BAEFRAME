// Public GET requests only. The native fixture is read and tested locally;
// it is never included in a URL, request body, header, or remote operation.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceUrls = [
  'https://baeframe.vercel.app/open.html',
  'https://baeframe.vercel.app/index.html',
  'https://baeframe.vercel.app/scripts/app.js',
  'https://baeframe.vercel.app/scripts/bframe-write-guard.js'
];

async function main() {
  const checks = [];
  const check = (label, condition) => {
    assert.ok(condition, label);
    checks.push({ label, passed: true });
  };
  const fixturePath = path.join(__dirname, 'native-drawing-sample.bframe');
  const fixtureBytes = fs.readFileSync(fixturePath);
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  const fetched = await Promise.all(sourceUrls.map(async url => {
    const response = await fetch(url, { method: 'GET', redirect: 'error' });
    assert.equal(response.status, 200, url);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { url, status: response.status, bytes: bytes.length, sha256: sha256(bytes), source: bytes.toString('utf8') };
  }));
  const [open, index, app, guard] = fetched;
  check('Open page targets the actual index.html web viewer', open.source.includes('/index.html?video='));
  check('Open page also attempts the desktop baeframe protocol', open.source.includes('baeframe://open?video='));
  check('Viewer HTML contains the drawing canvas', index.source.includes('id="drawingCanvas"'));
  check('Viewer HTML loads scripts/app.js', index.source.includes('src="scripts/app.js"'));
  const imports = Array.from(app.source.matchAll(/from\s+['"]([^'"]+)['"]/g), match => match[1]);
  check('The app has only the inspected first-party module dependency', imports.length === 1 && imports[0] === './bframe-write-guard.js');
  check('The inspected guard has no additional module dependency', !/\bimport\s*(?:\(|[{*'"])/.test(guard.source));
  const v3Occurrences = {
    app: (app.source.match(/drawingsV3/g) || []).length,
    guard: (guard.source.match(/drawingsV3/g) || []).length
  };
  check('Neither deployed first-party module names drawingsV3', v3Occurrences.app === 0 && v3Occurrences.guard === 0);

  const repoRoot = path.resolve(__dirname, '../../../..');
  const validatorPath = path.join(repoRoot, 'renderer/scripts/modules/fabric-drawing-persistence-store.js');
  const { createFabricDrawingPersistenceStore } = await import(pathToFileURL(validatorPath).href);
  const nativeStore = createFabricDrawingPersistenceStore();
  const nativeImport = nativeStore.importRootValue(fixture.drawingsV3, {
    hostGeneration: 1,
    videoGeneration: 1,
    persistenceSessionId: 'ux-audit-local-fixture',
    stableVideoIdentity: 'synthetic-ux-audit/review-C-3s.mp4'
  });
  const nativeStatus = nativeStore.getStatus();
  check('The desktop persistence module accepts the native fixture', nativeImport.accepted && nativeImport.compatible && nativeStatus.state === 'ready');
  check('The native fixture contains visible-review content to exercise', nativeStatus.keyframeCount > 0 && nativeStatus.objectCount > 0);

  const start = app.source.indexOf('function renderDrawingForCurrentFrame()');
  const end = app.source.indexOf('\nfunction selectTool(', start);
  check('The deployed renderer can be extracted at explicit function boundaries', start >= 0 && end > start);
  const renderer = app.source.slice(start, end);
  const rendererLine = app.source.slice(0, start).split('\n').length;
  function renderProbe(root, frame, fps, width, height) {
    const calls = [];
    const drawingContext = new Proxy({}, {
      get: (_target, property) => (...args) => calls.push([property, ...args]),
      set: () => true
    });
    const context = {
      state: { currentTime: frame / fps, frameRate: fps, bframeData: root, drawingContext },
      elements: { drawingCanvas: { width, height } }
    };
    vm.runInNewContext(renderer + '\nrenderDrawingForCurrentFrame();', context, { timeout: 1000 });
    return {
      requestedFrame: frame,
      computedFrame: Math.floor(context.state.currentTime * fps),
      clearCalls: calls.filter(call => call[0] === 'clearRect').length,
      strokeCalls: calls.filter(call => call[0] === 'stroke').length,
      fillCalls: calls.filter(call => call[0] === 'fill').length
    };
  }
  const nativeRender = fixture.drawingsV3.keyframes.map(keyframe => renderProbe(
    fixture, keyframe.frame, fixture.drawingsV3.fps, keyframe.sourceWidth, keyframe.sourceHeight
  ));
  check('The deployed renderer clears but never draws the native fixture', nativeRender.every(result => result.computedFrame === result.requestedFrame && result.clearCalls === 1 && result.strokeCalls === 0 && result.fillCalls === 0));
  const first = fixture.drawingsV3.keyframes[0];
  const legacyControl = renderProbe({ drawings: [{ frame: first.frame, strokes: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#ffff00', width: 3 }] }] }, first.frame, fixture.drawingsV3.fps, first.sourceWidth, first.sourceHeight);
  check('The same deployed renderer draws a legacy positive control', legacyControl.strokeCalls === 1);

  const deployedGuard = await import('data:text/javascript;base64,' + Buffer.from(guard.source).toString('base64'));
  const latest = structuredClone(fixture);
  const local = structuredClone(fixture);
  delete local.drawingsV3;
  const prepared = deployedGuard.prepareDriveBframeForWrite(latest, local, { localIdentityPersisted: true });
  const serialized = JSON.parse(deployedGuard.serializeBframeForWrite(prepared.data));
  const v3Hash = sha256(JSON.stringify(fixture.drawingsV3));
  const preservedV3Hash = sha256(JSON.stringify(serialized.drawingsV3));
  check('The write guard preserves the latest native drawingsV3 as an opaque root', v3Hash === preservedV3Hash);
  check('The fixture remains byte-for-byte unchanged', sha256(fs.readFileSync(fixturePath)) === sha256(fixtureBytes));

  const result = {
    checkedAt: new Date().toISOString(),
    testScope: 'Downloaded public renderer and write guard executed locally; mocked canvas; native app-created synthetic fixture; no authenticated app, browser, or Google Drive operation',
    networkRequests: sourceUrls.map(url => ({ method: 'GET', url, body: null })),
    sources: fetched.map(({ source, ...metadata }) => metadata),
    inspectedAppImports: imports,
    drawingsV3Occurrences: v3Occurrences,
    nativeFixture: { filename: path.basename(fixturePath), sha256: sha256(fixtureBytes), bytes: fixtureBytes.length, fps: fixture.drawingsV3.fps, framesWithDrawings: fixture.drawingsV3.keyframes.map(keyframe => keyframe.frame), legacyDrawingsIsArray: Array.isArray(fixture.drawings), nativeImport, nativeStatus },
    nativeValidator: { path: 'renderer/scripts/modules/fabric-drawing-persistence-store.js', sha256: sha256(fs.readFileSync(validatorPath)) },
    deployedRenderer: { firstLine: rendererLine, sha256: sha256(renderer), nativeRender, legacyControl },
    deployedWriteGuard: { nativeV3Preserved: v3Hash === preservedV3Hash, nativeV3Hash: v3Hash, preservedV3Hash },
    assertions: { passed: checks.length, failed: 0, cancelled: 0, checks },
    limitations: [
      'The mocked canvas counts drawing calls; it does not produce or inspect browser pixels.',
      'There was no authenticated Google Drive load or save and no personal/shared URL was sent.',
      'These results identify the downloaded deployment by its hashes; a future deployment can differ.'
    ]
  };
  fs.writeFileSync(path.join(__dirname, 'web-compatibility-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
