const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
const start = appSource.indexOf("document.addEventListener('paste', async (e) => {");
assert.ok(start >= 0);
const handlerSource = appSource.slice(start, appSource.indexOf('\n  });', start) + 6);
const png = 'data:image/png;base64,iVBORw0KGgo=';

async function setup() {
  const { CompositionLayerManager } = await import(pathToFileURL(path.join(root,
    'renderer/scripts/modules/composition-layer-manager.js')).href);
  let resolveImage;
  const imageReady = new Promise(resolve => { resolveImage = resolve; });
  const calls = { reads: 0, options: null, panel: 0, toasts: [] };
  const context = {
    videoPlayer: { isLoaded: true, filePath: 'C:/shot/A.mp4', currentTime: 2 },
    latestVideoLoadToken: 1, videoLoadIntentGeneration: 1, activeVideoLoadToken: null,
    shouldIgnoreGlobalShortcutTarget: target => target?.tagName === 'TEXTAREA',
    hasImageInClipboard: event => event.image !== false,
    isSameFilePath: (a, b) => a === b,
    getImageFromClipboard: async (_, options) => { calls.reads++; calls.options = options; return imageReady; },
    showToast: (message, level) => calls.toasts.push({ message, level }),
    renderCompositionLayerTimeline() {}, scheduleMpvOverlayStateSync() {},
    log: { error() {} }, document: { addEventListener: (_, handler) => { context.paste = handler; } }
  };
  const manager = new CompositionLayerManager({
    getCurrentTime: () => context.videoPlayer.currentTime,
    getBaseDuration: () => 30
  });
  manager.togglePanel = () => { calls.panel++; };
  context.compositionLayerManager = manager;
  vm.runInNewContext(handlerSource, context);
  const event = { target: {}, prevented: false, preventDefault() { this.prevented = true; } };
  return { context, manager, calls, event, resolveImage };
}

test('clipboard layer stays at the frame where paste began even after scrubbing', async () => {
  const h = await setup();
  const pending = h.context.paste(h.event);
  h.context.videoPlayer.currentTime = 12;
  h.resolveImage({ base64: png });
  await pending;
  assert.equal(h.manager.layers.length, 1);
  assert.equal(h.manager.layers[0].startTime, 2);
  assert.equal(h.manager.toJSON()[0].sourceDataUrl, png);
  assert.equal(h.event.prevented, true);
  assert.equal(h.calls.panel, 1);
  assert.equal(h.calls.options?.format, 'image/png');
  assert.ok(h.manager.undo());
  assert.equal(h.manager.layers.length, 0);
});

for (const scenario of ['different video', 'A to B to A', 'new load intent']) {
  test(`pending clipboard image cannot cross ${scenario}`, async () => {
    const h = await setup();
    const pending = h.context.paste(h.event);
    if (scenario === 'different video') h.context.videoPlayer.filePath = 'C:/shot/B.mp4';
    if (scenario === 'A to B to A') h.context.latestVideoLoadToken += 2;
    if (scenario === 'new load intent') h.context.videoLoadIntentGeneration++;
    h.resolveImage({ base64: png });
    await pending;
    assert.equal(h.manager.layers.length, 0);
    assert.equal(h.calls.panel, 0);
    assert.equal(h.calls.toasts.some(toast => toast.level === 'success'), false);
  });
}

test('paste during video loading cannot attach to the outgoing document', async () => {
  const h = await setup();
  h.context.activeVideoLoadToken = 2;
  h.resolveImage({ base64: png });
  await h.context.paste(h.event);
  assert.equal(h.calls.reads, 0);
  assert.equal(h.manager.layers.length, 0);
});

test('text inputs, text-only clipboard, and unloaded videos keep existing paste behavior', async () => {
  for (const scenario of ['input', 'text', 'unloaded']) {
    const h = await setup();
    if (scenario === 'input') h.event.target.tagName = 'TEXTAREA';
    if (scenario === 'text') h.event.image = false;
    if (scenario === 'unloaded') h.context.videoPlayer.isLoaded = false;
    await h.context.paste(h.event);
    assert.equal(h.calls.reads, 0);
    assert.equal(h.event.prevented, false);
  }
});

test('clipboard utility forwards optional compression settings and retains caller defaults', async () => {
  const source = fs.readFileSync(path.join(root, 'renderer/scripts/modules/image-utils.js'), 'utf8');
  const match = source.match(/export async function getImageFromClipboard\([\s\S]*?\n\}/);
  assert.ok(match);
  const seen = [];
  const context = { compressImage: async (blob, options) => { seen.push({ blob, options }); return { base64: png }; } };
  vm.runInNewContext(match[0].replace('export ', ''), context);
  const blob = {};
  const event = { clipboardData: { items: [{ type: 'image/png', getAsFile: () => blob }] } };
  await context.getImageFromClipboard(event, { format: 'image/png' });
  await context.getImageFromClipboard(event);
  assert.equal(seen[0].blob, blob);
  assert.equal(seen[0].options?.format, 'image/png');
  assert.equal(seen[1].options?.format, undefined);
});
