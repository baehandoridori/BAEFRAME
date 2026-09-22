const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const nodes = [];
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) nodes.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
})(acorn.parse(app, { ecmaVersion: 'latest', sourceType: 'module' }));

test('review page contains the current drawing entry and legacy display canvases, without the old authoring palette', () => {
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    for (const id of ['drawingTools', 'brushSizeHud', 'brushSizeSlider', 'eraserModeSection', 'btnClearDrawing']) {
      assert.equal(document.getElementById(id), null, id);
    }
    assert.equal(document.querySelector('.tool-btn[data-tool]'), null);
    for (const id of ['btnDrawMode', 'drawingCanvas', 'layersBelowCanvas', 'layersAboveCanvas']) {
      assert.ok(document.getElementById(id), id);
    }
  } finally { dom.window.close(); }
});

test('B entry delegates directly to the current drawing controller without reading a removed palette', async () => {
  const handler = nodes.find(node => node.type === 'FunctionDeclaration' && node.id?.name === 'handleKeydown');
  assert.ok(handler);
  const branch = handler.body.body.find(node => node.type === 'IfStatement' &&
    node.test.type === 'CallExpression' && node.test.arguments[0]?.value === 'drawMode');
  assert.ok(branch);
  const calls = [];
  const context = vm.createContext({
    userSettings: { matchShortcut: (action) => action === 'drawMode' },
    toggleDrawMode: () => calls.push('current-drawing'),
    e: { preventDefault: () => calls.push('prevent-default') }
  });
  vm.runInContext(`(() => { ${app.slice(branch.start, branch.end)} })()`, context);
  assert.deepEqual(calls, ['prevent-default', 'current-drawing']);
});

test('removed authoring functions are not left as startup or keyboard dependencies', () => {
  for (const name of ['selectDrawingTool', 'applySavedBrushSettings', 'adjustBrushSizeBy', 'showBrushSizeHud', 'toggleOnionSkinWithUI',
    'applyDrawModeState', 'prepareMpvDrawMode', 'enterHybridReviewEngineIfPossible', 'exitHybridReviewEngineIfNeeded',
    'preserveMpvReviewFreezeFrameForMediaChange', 'shouldKeepMpvReviewFreeze']) {
    assert.equal(nodes.some(node => node.type === 'Identifier' && node.name === name), false, name);
  }
  assert.match(app, /fabricDrawingPilotController\.routeKeydown\(e\)/);
  assert.match(app, /matchShortcut\('brushSizeUp', event\)/);
  assert.match(app, /matchShortcut\('brushSizeDown', event\)/);
});
