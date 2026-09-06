const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const rootDir = 'C:/BAEframe/BAEFRAME/';

(async () => {
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'native-drawing-sample.bframe'), 'utf8'));
  const { createFabricDrawingPersistenceStore } = await import(pathToFileURL(path.join(rootDir, 'renderer/scripts/modules/fabric-drawing-persistence-store.js')).href);
  const store = createFabricDrawingPersistenceStore();
  const imported = store.importRootValue(sample.drawingsV3, {
    documentId: sample.drawingsV3.documentId,
    fps: sample.fps,
    totalFrames: sample.drawingsV3.totalFrames,
    hostGeneration: 1,
    videoGeneration: 1,
    persistenceSessionId: 'audit-native-sample',
    stableVideoIdentity: sample.videoPath
  });
  assert.equal(imported.accepted, true, 'current V3 persistence store must accept the native drawing fixture');
  const frame = sample.drawingsV3.keyframes[0].frame;
  const objects = sample.drawingsV3.keyframes.reduce((sum, kf) => sum + kf.objects.length, 0);
  assert.equal(frame, 33);
  assert.equal(objects, 1);

  const viewer = fs.readFileSync(path.join(rootDir, 'web-viewer/scripts/app.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = viewer.indexOf('function renderDrawingForCurrentFrame() {');
  const end = viewer.indexOf('\nfunction selectTool', start);
  assert(start >= 0 && end > start);
  let clears = 0;
  let paints = 0;
  const noop = () => {};
  const ctx = vm.createContext({
    state: {
      currentTime: frame / sample.fps,
      frameRate: sample.fps,
      bframeData: sample,
      drawingContext: {
        clearRect: () => { clears += 1; },
        stroke: () => { paints += 1; },
        beginPath: noop,
        moveTo: noop,
        lineTo: noop
      }
    },
    elements: { drawingCanvas: { width: 1280, height: 720 } },
    Math, Array
  });
  vm.runInContext(viewer.slice(start, end), ctx);
  ctx.renderDrawingForCurrentFrame();
  assert.equal(clears, 1);
  assert.equal(paints, 0);
  console.log(JSON.stringify({
    source: 'Native app drawing fixture captured by the report author',
    nativeFixtureAcceptedByCurrentV3Store: imported.accepted,
    keyframe: frame,
    objects,
    fps: sample.fps,
    legacyDrawingsIsArray: Array.isArray(sample.drawings),
    localWebViewerAtSameFrame: { clears, paints },
    scope: 'Valid fixture and extracted local renderer; not a network or native UI replay'
  }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
