const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('../../shared/edit-project');
const controllers = require('../../renderer/scripts/editor/controller');
const preview = require('../../renderer/scripts/editor/preview-clock');
const timeline = require('../../renderer/scripts/editor/timeline-interaction');

const root = path.resolve(__dirname, '../..');
const source = { id: 'video', path: 'C:/fixtures/clip.mp4', name: '테스트 영상',
  durationSeconds: 4, width: 320, height: 180, fps: 24, hasAudio: false };
const fixture = () => core.appendSource(core.createProject({ name: '기존 이름' }), source);
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, overrides = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'renderer/editor.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://editor.test/'
  });
  const { window } = dom;
  const { document } = window;
  const $ = id => document.getElementById(id);
  t.after(() => window.close());
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} });
  Object.defineProperties(window.HTMLMediaElement.prototype, {
    readyState: { get: () => 4 }, duration: { get: () => 4 },
    currentTime: { get() { return this._time || 0; }, set(value) {
      this._time = value;
      queueMicrotask(() => this.dispatchEvent(new window.Event('seeked')));
    } }
  });
  window.HTMLMediaElement.prototype.pause = function () {};
  window.HTMLMediaElement.prototype.play = async function () {};
  window.HTMLMediaElement.prototype.load = function () {
    queueMicrotask(() => this.dispatchEvent(new window.Event(this.dataset.fail ? 'error' : 'loadedmetadata')));
  };
  Object.defineProperties($('videoPreview'), { videoWidth: { value: 320 }, videoHeight: { value: 180 } });
  const input = { enabled: false, tool: 'brush', owner: null };
  // jsdom has no media decoder or interactive Fabric surface. Keep those two
  // boundaries controlled; execute the real renderer, controller and project API.
  const drawing = {
    async loadClip(clip) { input.owner = clip?.id; }, async seek() {},
    async setEnabled(value) { input.enabled = value; },
    async setTool(value) { if (input.owner) input.tool = value; },
    snapshot: async () => ({ drawingsV3: null, drawingLayersV1: null }),
    layers: () => [], keyframes: () => [], refreshViewport() {}, dispose() {}
  };
  const saves = [];
  const api = { setDirty() {}, onExportProgress() {}, confirmDiscard: async () => true,
    openProject: async () => ({ project: fixture(), path: 'C:/fixtures/project.bedit' }),
    pickMedia: async () => ({ sources: [source] }),
    saveProject: async project => { saves.push(project); return { path: 'C:/fixtures/saved.bedit' }; },
    ...overrides
  };
  let controller;
  Object.assign(window, { BAEEditProject: core, BAEEditorPreview: preview,
    BAEEditorTimeline: timeline, BAEEditorDrawing: { createEditorDrawing: () => drawing },
    BAEEditorController: { createEditorController(options) {
      controller = controllers.createEditorController(options); return controller;
    } }, editorAPI: api });
  window.eval(fs.readFileSync(path.join(root, 'renderer/scripts/editor/editor.js'), 'utf8'));
  async function settle() {
    for (let i = 0; i < 30; i++) {
      await tick();
      if (!controller.state.busy && !$('openProject').disabled) return;
    }
    assert.fail('editor did not release its operation');
  }
  function key(target, keyValue, extra = {}) {
    const event = new window.KeyboardEvent('keydown', { key: keyValue, bubbles: true,
      cancelable: true, ctrlKey: true, ...extra });
    target.dispatchEvent(event); return event;
  }
  return { window, document, $, input, api, saves, key, settle, get controller() { return controller; },
    async open() { await $('openProject').onclick(); await settle(); } };
}

test('opening a document enables the initially displayed V selection tool, and importing does too', async t => {
  const h = harness(t);
  await h.open();
  assert.equal(h.input.enabled, true, 'initial selection must accept drawing input');
  assert.equal(h.input.tool, 'select', 'V must not dispatch the adapter default brush');
  assert.equal(h.document.body.dataset.editorTool, 'select');
  const imported = harness(t);
  await imported.$('importVideo').onclick();
  assert.equal(imported.input.enabled, true);
  assert.equal(imported.input.tool, 'select');
});

test('a failed open releases the prepared composite and preserves the current document and frame', async t => {
  const h = harness(t);
  await h.open();
  await h.$('nextFrame').onclick();
  const before = JSON.stringify(h.controller.state.project);
  h.api.openProject = async () => { throw new Error('테스트: 원본을 찾을 수 없습니다.'); };
  await h.$('openProject').onclick();
  assert.equal(h.document.body.classList.contains('editor-seeking'), false);
  assert.equal(h.input.enabled, true);
  assert.equal(h.controller.state.frame, 1);
  assert.equal(JSON.stringify(h.controller.state.project), before);
  assert.match(h.$('status').textContent, /원본/);
  await h.$('nextFrame').onclick();
  assert.equal(h.controller.state.frame, 2, 'the next interaction must remain usable');
});

test('a failed decoder never exposes a new document over the old video', async t => {
  const h = harness(t);
  await h.open();
  await h.document.querySelector('button[data-editor-tool="select"]').onclick();
  const other = fixture(); other.sources[0].path = 'C:/fixtures/broken.mp4';
  h.api.openProject = async () => ({ project: other, path: 'C:/fixtures/broken.bedit' });
  h.$('videoPreview').dataset.fail = 'true';
  await h.$('openProject').onclick();
  assert.equal(h.document.body.classList.contains('editor-seeking'), true);
  assert.equal(h.input.enabled, false, 'a hidden/unprepared canvas must not accept drawing input');
  await h.document.querySelector('button[data-editor-tool="select"]').onclick();
  assert.equal(h.document.body.classList.contains('editor-seeking'), true, 'changing tools does not prepare failed media');
  assert.equal(h.input.enabled, false);
  await h.$('nextFrame').onclick();
  assert.equal(h.input.enabled, false, 'a failed seek cannot reactivate the hidden canvas');
});

test('Ctrl+S commits a focused name before exactly one save and leaves no extra change on blur', async t => {
  const h = harness(t);
  await h.open();
  const name = h.$('projectName'); name.focus(); name.value = '한글 이름 확정';
  const event = h.key(name, 's');
  await h.settle();
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].name, '한글 이름 확정');
  assert.equal(h.controller.state.dirty, false);
  name.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await h.settle();
  assert.equal(h.controller.state.dirty, false, 'blur after saving must not create a duplicate name edit');
});

test('Ctrl+S preserves an edited name when the save dialog is cancelled', async t => {
  const h = harness(t, { saveProject: async () => ({ cancelled: true }) });
  await h.open();
  const name = h.$('projectName'); name.focus(); name.value = '저장 취소 후에도 남는 이름';
  h.key(name, 's'); await h.settle();
  assert.equal(h.controller.state.project.name, '저장 취소 후에도 남는 이름');
  assert.equal(h.controller.state.dirty, true);
});

test('document save respects Korean composition and text editing shortcuts', async t => {
  const h = harness(t);
  await h.open();
  const name = h.$('projectName'); name.focus(); name.value = '한';
  name.dispatchEvent(new h.window.CompositionEvent('compositionstart', { bubbles: true }));
  h.key(name, 's');
  h.key(name, 's', { isComposing: true });
  await h.settle();
  assert.equal(h.saves.length, 0);
  assert.equal(name.value, '한');
  name.dispatchEvent(new h.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(h.key(name, 'z').defaultPrevented, false, 'text undo remains native');
  assert.equal(h.key(name, 'b', { ctrlKey: false }).defaultPrevented, false);
  h.key(name, 's'); await h.settle();
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].name, '한');
});

test('saving a focused trim draft does not apply the separate trim command', async t => {
  const h = harness(t);
  await h.open();
  const trim = h.$('trimStart'); trim.focus(); trim.value = '0.5';
  h.key(trim, 's'); await h.settle();
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].clips[0].durationFrames, 96);
  assert.equal(h.saves[0].clips[0].sourceStartSeconds, 0);
});

test('Ctrl+S commits a pending volume change without duplicate saves while persistence is pending', async t => {
  let complete, received;
  let calls = 0;
  const h = harness(t, { saveProject: async project => {
    calls++; received = project;
    return new Promise(resolve => { complete = resolve; });
  } });
  await h.open();
  const volume = h.$('clipVolume'); volume.focus(); volume.value = '37';
  h.key(volume, 's'); await tick();
  h.key(h.document.body, 's'); await tick();
  assert.equal(calls, 1);
  assert.equal(received.clips[0].volume, 0.37);
  complete({ path: 'C:/fixtures/saved.bedit' }); await h.settle();
  assert.equal(h.controller.state.dirty, false);
});
