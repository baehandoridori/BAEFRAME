const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeAtomic, publishAtomic, captureFileVersion, assertSafeDestination, validateOverlays, runProcess } = require('../../main/editor-media');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { createProject, appendSource } = require('../../shared/edit-project');
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

async function lockFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'baeframe-editor-lock-'));
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(child => child.stop()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const start = (destination, { hold = false, contents = 'child saved', expectedVersion } = {}) => {
    const child = spawn(process.execPath, ['-e', `
      const fs = require('node:fs/promises');
      const { publishAtomic } = require(process.env.EDITOR_LOCK_MODULE);
      const options = JSON.parse(process.env.EDITOR_LOCK_OPTIONS);
      let resume;
      process.on('message', message => { if (message === 'release') resume?.(); });
      publishAtomic(options.destination, async temporary => {
        if (options.hold) await new Promise(resolve => { resume = resolve; process.send({ type: 'locked' }); });
        await fs.writeFile(temporary, options.contents);
      }, { expectedVersion: options.expectedVersion }).then(
        () => process.send({ type: 'result', success: true }, () => process.exit(0)),
        error => process.send({ type: 'result', success: false, error: error.message }, () => process.exit(0))
      );
    `], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, EDITOR_LOCK_MODULE: require.resolve('../../main/editor-media'), EDITOR_LOCK_OPTIONS: JSON.stringify({ destination, hold, contents, expectedVersion }) }
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const messages = [];
    const pending = [];
    let exited = false;
    child.on('message', message => {
      const waiter = pending.find(item => item.type === message.type);
      if (waiter) { pending.splice(pending.indexOf(waiter), 1); waiter.resolve(message); }
      else messages.push(message);
    });
    const exit = new Promise(resolve => child.once('exit', () => {
      exited = true;
      for (const waiter of pending.splice(0)) waiter.reject(new Error(`Lock child exited before ${waiter.type}: ${stderr}`));
      resolve();
    }));
    const worker = {
      pid: child.pid,
      wait(type) {
        const index = messages.findIndex(message => message.type === type);
        if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Lock child timed out: ${type} ${stderr}`)), 5000);
          pending.push({ type, resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
        });
      },
      release() { child.send('release'); },
      async stop() { if (!exited) child.kill(); await exit; }
    };
    children.push(worker);
    return worker;
  };
  return { directory, start };
}

test('a crashed editor publisher releases its OS guard and its same-host abandoned lock can be recovered', { timeout: 15000 }, async t => {
  const { directory, start } = await lockFixture(t);
  const destination = path.join(directory, '다시 저장.bedit');
  await fs.writeFile(destination, 'original');
  const version = await captureFileVersion(destination);
  const crashed = start(destination, { hold: true, expectedVersion: version });
  await crashed.wait('locked');
  const lockPath = destination + '.baeframe-edit.lock';
  const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  assert.equal(owner.hostname, os.hostname().toLowerCase());
  assert.equal(owner.pid, crashed.pid);
  assert.match(owner.token, /^[0-9a-f-]{36}$/);
  await crashed.stop();
  assert.equal(await fs.readFile(destination, 'utf8'), 'original');
  await writeAtomic(destination, 'recovered', { expectedVersion: version });
  assert.equal(await fs.readFile(destination, 'utf8'), 'recovered');
  assert.deepEqual(await fs.readdir(directory), ['다시 저장.bedit']);
});

test('live publishers retain old-looking locks and competing processes cannot enter prepare', { timeout: 15000 }, async t => {
  const { directory, start } = await lockFixture(t);
  const destination = path.join(directory, 'live.bedit');
  const owner = start(destination, { hold: true, expectedVersion: null });
  await owner.wait('locked');
  const lockPath = destination + '.baeframe-edit.lock';
  const original = await fs.readFile(lockPath, 'utf8');
  const old = new Date(Date.now() - 86400000);
  await fs.utimes(lockPath, old, old);
  const contender = start(destination, { contents: 'must not publish', expectedVersion: null });
  const result = await contender.wait('result');
  assert.equal(result.success, false);
  assert.match(result.error, /저장 중/);
  assert.equal(await fs.readFile(lockPath, 'utf8'), original);
  owner.release();
  assert.equal((await owner.wait('result')).success, true);
  assert.equal(await fs.readFile(destination, 'utf8'), 'child saved');
});

test('foreign-host, live local, legacy PID and incomplete lock owners are preserved without guessing', async t => {
  const { directory } = await lockFixture(t);
  const destination = path.join(directory, 'protected.bedit');
  const lockPath = destination + '.baeframe-edit.lock';
  await fs.writeFile(destination, 'original');
  const localOwner = { schemaVersion: 1, hostname: os.hostname().toLowerCase(), pid: process.pid, token: require('node:crypto').randomUUID() };
  const cases = [
    { contents: JSON.stringify(localOwner), error: /저장 중/ },
    { contents: JSON.stringify({ ...localOwner, hostname: 'different-editor-host', pid: 2147483647 }), error: /다른 컴퓨터/ },
    { contents: String(process.pid), error: /소유자.*확인/ },
    { contents: '2147483647', error: /소유자.*확인/ },
    { contents: '', error: /소유자.*확인/ },
    { contents: '{"schemaVersion":1,"hostname":', error: /소유자.*확인/ },
    { contents: JSON.stringify({ ...localOwner, token: '' }), error: /소유자.*확인/ }
  ];
  for (const fixture of cases) {
    await fs.writeFile(lockPath, fixture.contents);
    await assert.rejects(writeAtomic(destination, 'must not publish'), fixture.error);
    assert.equal(await fs.readFile(lockPath, 'utf8'), fixture.contents);
    assert.equal(await fs.readFile(destination, 'utf8'), 'original');
  }
});

test('concurrent stale-lock recoverers publish exactly one expected revision without deleting a successor lock', { timeout: 15000 }, async t => {
  const { directory, start } = await lockFixture(t);
  const destination = path.join(directory, 'concurrent.bedit');
  await fs.writeFile(destination, 'original');
  const version = await captureFileVersion(destination);
  const crashed = start(destination, { hold: true, expectedVersion: version });
  await crashed.wait('locked');
  await crashed.stop();
  const contenders = Array.from({ length: 6 }, (_, index) => start(destination, { contents: `writer-${index}`, expectedVersion: version }));
  const results = await Promise.all(contenders.map(worker => worker.wait('result')));
  assert.equal(results.filter(result => result.success).length, 1);
  const winner = results.findIndex(result => result.success);
  assert.equal(await fs.readFile(destination, 'utf8'), `writer-${winner}`);
  assert.deepEqual(await fs.readdir(directory), ['concurrent.bedit']);
});

test('a changed lock owner blocks publication and former-owner cleanup preserves the replacement lock', async t => {
  const { directory } = await lockFixture(t);
  const destination = path.join(directory, 'changed-owner.bedit');
  const lockPath = destination + '.baeframe-edit.lock';
  const replacement = JSON.stringify({ schemaVersion: 1, hostname: 'another-host', pid: process.pid, token: require('node:crypto').randomUUID() });
  await fs.writeFile(destination, 'original');
  await assert.rejects(publishAtomic(destination, async temporary => {
    await fs.unlink(lockPath);
    await fs.writeFile(lockPath, replacement, { flag: 'wx' });
    await fs.writeFile(temporary, 'must not publish');
  }), /잠금.*변경/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'original');
  assert.equal(await fs.readFile(lockPath, 'utf8'), replacement);
});

test('real MP4 export recovers a same-host crashed publish lock on its chosen destination', { timeout: 60000 }, async t => {
  const { directory, start } = await lockFixture(t);
  const destination = path.join(directory, '다시 출력.mp4');
  const crashed = start(destination, { hold: true, expectedVersion: null });
  await crashed.wait('locked');
  await crashed.stop();
  const ffmpegPath = process.env.BAEFRAME_TEST_FFMPEG || path.resolve(__dirname, '../../ffmpeg/win32/ffmpeg.exe');
  const ffprobePath = path.join(path.dirname(ffmpegPath), 'ffprobe.exe');
  const sourcePath = path.join(directory, 'original.mkv');
  await runProcess(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24:duration=0.25', '-c:v', 'ffv1', '-an', sourcePath]);
  const { probeMedia } = require('../../main/editor-media');
  const project = appendSource(createProject({ width: 96, height: 64 }), (await probeMedia(sourcePath, { ffprobePath })).source);
  const result = await require('../../main/editor-export').exportProject({ project, outputPath: destination, expectedVersion: null, ffmpegPath, ffprobePath });
  assert.equal(result.cancelled, false);
  const probe = JSON.parse((await runProcess(ffprobePath, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', destination])).stdout);
  assert.equal(Number(probe.streams.find(stream => stream.codec_type === 'video').nb_read_frames), 6);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['original.mkv', '다시 출력.mp4']);
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
