const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeAtomic, captureFileVersion, assertSafeDestination, validateOverlays, runProcess } = require('../../main/editor-media');
const { EventEmitter } = require('node:events');
const { createProject } = require('../../shared/edit-project');
const { isTrustedSender, validateAuthorizedProject, setupEditorIpc } = require('../../main/editor-window');

test('editor IPC requires the exact live window and its main frame', () => {
  const frame = {};
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  assert.equal(isTrustedSender({ sender: contents, senderFrame: frame }, window), true);
  assert.equal(isTrustedSender({ sender: contents, senderFrame: {} }, window), false);
  assert.equal(isTrustedSender({ sender: {}, senderFrame: frame }, window), false);
  assert.equal(isTrustedSender({ sender: contents }, window), false);
});

test('atomic saves reject concurrent edits and preserve the existing destination', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baeframe-editor-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, '프로젝트 파일.bedit');
  await fs.writeFile(output, 'old');
  const version = await captureFileVersion(output);
  await fs.writeFile(output, 'external');
  await assert.rejects(writeAtomic(output, 'new', { expectedVersion: version }), /changed|변경/);
  assert.equal(await fs.readFile(output, 'utf8'), 'external');
  const writtenVersion = await writeAtomic(output, 'new', { expectedVersion: await captureFileVersion(output) });
  assert.equal(await fs.readFile(output, 'utf8'), 'new');
  assert.equal(writtenVersion, await captureFileVersion(output));
  assert.deepEqual(await fs.readdir(dir), ['프로젝트 파일.bedit']);
});

test('save destinations reject media originals and existing review file extensions', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baeframe-editor-path-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = path.join(dir, 'source.mp4');
  await fs.writeFile(original, 'original');
  await assert.rejects(assertSafeDestination(original, [original], '.mp4'), /원본|original/);
  await assert.rejects(assertSafeDestination(path.join(dir, 'review.bframe'), [], '.bedit'), /확장자|extension/);
});

test('overlay intervals reject invalid PNG data, overlap and excessive payloads', () => {
  const project = { width: 96, height: 64, clips: [{ id: 'clip', durationFrames: 24 }] };
  assert.throws(() => validateOverlays(project, [{ clipId: 'clip', startFrame: 0, endFrame: 25, dataUrl: 'data:image/png;base64,AA==' }]));
  assert.throws(() => validateOverlays(project, [{ clipId: 'clip', startFrame: 0, endFrame: 1, dataUrl: 'data:image/png;base64,AA==' }]), /PNG/);
});

test('malformed projects and renderer-invented source paths are rejected before file dialogs', () => {
  assert.throws(() => validateAuthorizedProject({ type: 'wrong' }, new Map()));
  const source = { id: 's', path: path.resolve('original.mp4'), name: 'source', durationSeconds: 1, width: 96, height: 64, fps: 24, hasAudio: true };
  const project = createProject({ sources: [source] });
  // createProject may intentionally only accept output settings.
  project.sources = [source];
  assert.throws(() => validateAuthorizedProject(project, new Map()), /가져오지 않은/);
  const sources = new Map([['s', { ...source }]]);
  assert.doesNotThrow(() => validateAuthorizedProject(project, sources));
  project.sources[0].path = path.resolve('private.mp4');
  assert.throws(() => validateAuthorizedProject(project, sources), /가져오지 않은/);
  let executed = false;
  Object.defineProperty(project, 'toJSON', { enumerable: true, get() { executed = true; return () => ({}); } });
  assert.throws(() => validateAuthorizedProject(project, sources));
  assert.equal(executed, false, 'validation must not execute an untrusted getter');
});

test('subprocess progress streams can trigger cancellation without retaining unlimited output', async () => {
  const abort = new AbortController();
  let reported = '';
  await assert.rejects(runProcess(process.execPath, ['-e', "process.stdout.write('frame=1\\n'); setTimeout(() => process.exit(0), 100)"], { signal: abort.signal, collectStdout: false, onStdout: (chunk) => { reported += chunk; abort.abort(); } }), { name: 'AbortError' });
  assert.match(reported, /frame=1/);
});

test('editor IPC gates frames, saves only dialog paths, and resumes dirty guards after cancellation', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baeframe-editor-ipc-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
  ipcMain.removeHandler = (channel) => handlers.delete(channel);
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.isDestroyed = () => false;
      this.webContents.setWindowOpenHandler = (fn) => { this.openHandler = fn; };
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    show() {}
    focus() {}
    async loadFile() {}
    close() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; this.emit('close', event); if (!event.prevented) { this.destroyed = true; this.emit('closed'); } }
  }
  const main = new Window({});
  let saveChoice = { canceled: true };
  let response = 0;
  let dialogs = 0;
  let resumeRuntime;
  let startedRuntime;
  const runtimeStarted = new Promise((resolve) => { startedRuntime = resolve; });
  const runtimeProvider = () => new Promise((resolve) => { resumeRuntime = resolve; startedRuntime(); });
  const editor = setupEditorIpc({ getMainWindow: () => main, runtimeProvider, electron: { BrowserWindow: Window, ipcMain, app: { getPath: () => dir }, dialog: { showSaveDialog: async () => { dialogs++; return saveChoice; }, showMessageBox: async () => ({ response }) } } });
  t.after(() => editor.dispose());
  const eventFor = (window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  await assert.rejects(handlers.get('editor:open')({ sender: main.webContents, senderFrame: {} }), /리뷰창/);
  await handlers.get('editor:open')(eventFor(main));
  const window = editor.getWindow();
  const event = eventFor(window);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.deepEqual(window.openHandler({ url: 'https://example.com' }), { action: 'deny' });
  await assert.rejects(handlers.get('editor:save-project')({ ...event, senderFrame: {} }, createProject(), true), /편집창/);
  await assert.rejects(handlers.get('editor:save-project')(event, {}, true));
  assert.equal(dialogs, 0);
  assert.deepEqual(await handlers.get('editor:save-project')(event, createProject(), true), { cancelled: true });
  saveChoice = { canceled: false, filePath: path.join(dir, '저장.bedit') };
  const saved = await handlers.get('editor:save-project')(event, createProject(), true);
  assert.equal(saved.path, saveChoice.filePath);
  assert.equal(JSON.parse(await fs.readFile(saved.path, 'utf8')).type, 'baeframe-edit');
  ipcMain.emit('editor:set-dirty', event, true);
  assert.equal(editor.needsCloseConfirmation(), true);
  assert.equal(await editor.confirmClose(), false);
  assert.equal(editor.needsCloseConfirmation(), true);
  response = 1;
  assert.equal(await editor.confirmClose(), true);
  assert.equal(editor.needsCloseConfirmation(), false);
  editor.revokeCloseApproval();
  assert.equal(editor.needsCloseConfirmation(), true, 'a cancelled review-window quit must restore editor protection');
  assert.equal(await editor.confirmClose(), true);
  assert.equal(editor.needsCloseConfirmation(), false);
  ipcMain.emit('editor:set-dirty', event, true);
  assert.equal(editor.needsCloseConfirmation(), true);
  response = 0;
  window.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.isDestroyed(), false);
  ipcMain.emit('editor:set-dirty', event, false);
  saveChoice = { canceled: false, filePath: path.join(dir, 'never-publish.mp4') };
  const pendingExport = handlers.get('editor:export-video')(event, { project: createProject(), overlays: [] });
  const closedExport = assert.rejects(pendingExport, /편집창이 닫혔/);
  await runtimeStarted;
  window.close();
  assert.equal(window.isDestroyed(), true);
  resumeRuntime({ ffmpegPath: 'unused', ffprobePath: 'unused' });
  await closedExport;
  assert.deepEqual(await fs.readdir(dir), ['저장.bedit']);
});
