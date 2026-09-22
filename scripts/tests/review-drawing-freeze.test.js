const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.resolve(__dirname, '../../renderer/scripts/modules/review-drawing-freeze.js'), 'utf8');
const declaration = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'composite').declaration;
let drawingLayers;
before(async () => { drawingLayers = await import('../../shared/drawing-layers.js'); });

function fixture() {
  const draws = [], paths = [], transforms = [], decoded = [];
  let created = 0, disposed = 0;
  class ImageStub {
    constructor() { this.naturalWidth = 1280; this.naturalHeight = 720; }
    async decode() { decoded.push(this.src); }
  }
  class PathStub {
    constructor(pathData, options) { paths.push({ pathData, options }); }
    set(transform) { this.transform = transform; }
  }
  class StaticCanvasStub {
    constructor() { created++; this.lowerCanvasEl = { src: 'current-drawings' }; }
    setViewportTransform(value) { transforms.push([...value]); }
    add() {}
    renderAll() {}
    async dispose() { disposed++; }
  }
  const context = vm.createContext({
    ...drawingLayers, Image: ImageStub, Path: PathStub, StaticCanvas: StaticCanvasStub,
    document: { createElement: () => ({
      getContext: () => ({ drawImage: (image, ...args) => draws.push([image.src, ...args]) }),
      toDataURL: () => 'composited-frame'
    }) }
  });
  vm.runInContext(source.slice(declaration.start, declaration.end), context);
  return { composite: context.composite, draws, paths, transforms, decoded, created: () => created, disposed: () => disposed };
}

function keyframe() {
  return { sourceWidth: 1920, sourceHeight: 1080, objects: [{
    id: 'stroke-1', pathData: 'M 0 0 L 10 10', style: { color: '#ff0000', opacity: 0.5 },
    transform: { left: 10, top: 20, scaleX: 1, scaleY: 1 }
  }] };
}

test('old raster alone remains between the video and current drawings without allocating Fabric', async () => {
  const f = fixture();
  assert.equal(await f.composite('video-frame', null, null, 'legacy-raster'), 'composited-frame');
  assert.deepEqual(f.draws, [['video-frame', 0, 0], ['legacy-raster', 0, 0, 1280, 720]]);
  assert.equal(f.created(), 0);
});

test('current drawings alone keep source scaling independent from viewport zoom', async () => {
  const f = fixture();
  assert.equal(await f.composite('video-frame', keyframe(), null), 'composited-frame');
  assert.deepEqual(f.draws, [['video-frame', 0, 0], ['current-drawings', 0, 0]]);
  assert.deepEqual(f.transforms, [[1280 / 1920, 0, 0, 720 / 1080, 0, 0]]);
  assert.equal(f.paths[0].options.opacity, 0.5);
  assert.equal(f.disposed(), 1);
});

test('coexisting legacy and current drawings composite once in video, legacy, current order', async () => {
  const f = fixture();
  assert.equal(await f.composite('video-frame', keyframe(), null, 'legacy-raster'), 'composited-frame');
  assert.deepEqual(f.draws.map(draw => draw[0]), ['video-frame', 'legacy-raster', 'current-drawings']);
  assert.deepEqual(f.decoded, ['video-frame', 'legacy-raster']);
  assert.equal(f.disposed(), 1);
});

test('hidden current layers do not suppress visible legacy raster', async () => {
  const f = fixture();
  const layers = { version: 1, layers: [{ id: 'hidden', name: 'hidden', visible: false }], baseLayerId: 'hidden', activeLayerId: 'hidden', assignments: {} };
  assert.equal(await f.composite('video-frame', keyframe(), layers, 'legacy-raster'), 'composited-frame');
  assert.deepEqual(f.draws.map(draw => draw[0]), ['video-frame', 'legacy-raster']);
  assert.equal(f.created(), 0);
  assert.equal(await f.composite('video-frame', keyframe(), layers), 'video-frame');
});

test('an empty drawing frame returns the original screenshot without decoding or canvas allocation', async () => {
  const f = fixture();
  assert.equal(await f.composite('video-frame', null, null), 'video-frame');
  assert.deepEqual(f.decoded, []);
  assert.deepEqual(f.draws, []);
  assert.equal(f.created(), 0);
});
