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
  // 그리기 단축키는 "브러시 고르기 또는 끄기" 분기를 거친다. 도구는 현재 드로잉
  // 컨트롤러(오버레이)에게 묻는다 — 지워진 구형 팔레트의 DOM 을 읽지 않는다.
  const shortcut = nodes.find(node => node.type === 'FunctionDeclaration' &&
    node.id?.name === 'handleDrawModeShortcut');
  assert.ok(shortcut);
  const run = async (controllerState, outcome) => {
    const calls = [];
    const context = vm.createContext({
      userSettings: { matchShortcut: (action) => action === 'drawMode' },
      fabricDrawingPilotController: {
        getState: () => controllerState,
        selectBrushFromShortcut: async () => {
          calls.push('select-brush');
          return outcome;
        }
      },
      toggleDrawMode: () => {
        calls.push('current-drawing');
        return true;
      },
      e: { preventDefault: () => calls.push('prevent-default') }
    });
    vm.runInContext(
      `${app.slice(shortcut.start, shortcut.end)}\n` +
      `(() => { ${app.slice(branch.start, branch.end)} })()`,
      context
    );
    await new Promise(resolve => setImmediate(resolve));
    return calls;
  };
  // 패널이 닫혀 있으면 지금까지처럼 바로 켠다.
  assert.deepEqual(await run('passive'), ['prevent-default', 'current-drawing']);
  // 패널이 켜져 있고 다른 도구였으면 브러시로 바꾸고 패널은 그대로 둔다.
  assert.deepEqual(await run('active', 'selected'), ['prevent-default', 'select-brush']);
  // 이미 브러시였으면 패널을 끈다.
  assert.deepEqual(
    await run('active', 'already-brush'),
    ['prevent-default', 'select-brush', 'current-drawing']
  );
  // 기다리는 사이 세션이 바뀌었으면 다시 켜지 않는다.
  assert.deepEqual(await run('active', 'stale'), ['prevent-default', 'select-brush']);
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
