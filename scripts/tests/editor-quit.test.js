const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function mainHarness() {
  const source = read('main/index.js');
  const start = source.indexOf('  // 앱 종료 전 - 저장 확인');
  const end = source.indexOf('  // 앱 종료 완료 - 프로세스 강제 종료', start);
  assert.ok(start >= 0 && end > start);
  const events = new Map(), handlers = new Map(), timers = new Map(), sent = [];
  let timerId = 0, needs = true, answer = true, acceptedExits = 0;
  const editor = { enabled: true, isDestroyed: () => false, isEnabled() { return this.enabled; }, setEnabled(value) { this.enabled = value; } };
  const main = new EventEmitter();
  main.destroyed = false;
  main.isDestroyed = () => main.destroyed;
  main.webContents = { mainFrame: {}, send: (...args) => sent.push(args) };
  main.close = () => {
    let prevented = false;
    main.emit('close', { preventDefault() { prevented = true; } });
    if (!prevented) main.destroyed = true;
  };
  const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  const context = {
    Promise, log: { info() {}, warn() {} },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    isQuitting: false, forceQuit: false, shutdownCleanupStarted: false, editorQuitCheck: false,
    editorWorkspace: { needsCloseConfirmation: () => needs, getWindow: () => editor,
      async confirmClose() { if (answer) needs = false; return answer; }, revokeCloseApproval() { needs = true; } },
    getMainWindow: () => main, cleanupMpvPilotBeforeQuit: async () => {},
    app: { on: (name, callback) => events.set(name, callback), quit() {
      let prevented = false;
      events.get('before-quit')({ preventDefault() { prevented = true; } });
      if (!prevented) { main.close(); if (main.destroyed) acceptedExits++; }
    } },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { context, main, editor, sent, timers, event, handlers,
    quit: () => context.app.quit(), setNeeds: (value) => { needs = value; }, setAnswer: (value) => { answer = value; },
    attempt: () => sent.filter(([name]) => name === 'app:request-save-before-quit').at(-1)?.[1],
    exits: () => acceptedExits };
}

test('cancelling the second editor approval restores quit state and requests a fresh review save on retry', async () => {
  const h = mainHarness();
  h.quit(); await tick();
  const first = h.attempt();
  h.setNeeds(true); h.setAnswer(false);
  await h.handlers.get('app:quit-confirmed')(h.event, first); await tick();
  assert.equal(h.context.isQuitting, false);
  assert.equal(h.context.forceQuit, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.editor.enabled, true);
  assert.ok(h.sent.some(([name, id]) => name === 'app:quit-aborted' && id === first));
  h.setAnswer(true); h.quit(); await tick();
  assert.notEqual(h.attempt(), first);
  assert.equal(h.sent.filter(([name]) => name === 'app:request-save-before-quit').length, 2);
  assert.equal(h.exits(), 0);
});

test('an earlier review confirmation cannot approve a later quit attempt', async () => {
  const h = mainHarness();
  h.quit(); await tick();
  const first = h.attempt();
  await h.handlers.get('app:quit-cancelled')(h.event, first);
  h.quit(); await tick();
  const second = h.attempt();
  assert.notEqual(first, second);
  await h.handlers.get('app:quit-confirmed')(h.event, first); await tick();
  assert.equal(h.context.forceQuit, false);
  assert.equal(h.exits(), 0);
  await h.handlers.get('app:quit-confirmed')({ ...h.event, sender: {} }, second);
  await h.handlers.get('app:quit-confirmed')({ ...h.event, senderFrame: {} }, second);
  await h.handlers.get('app:quit-cancelled')({ ...h.event, senderFrame: {} }, second);
  assert.equal(h.context.forceQuit, false);
  assert.equal(h.context.isQuitting, true, 'untrusted responses cannot approve or cancel a quit');
  await h.handlers.get('app:quit-confirmed')(h.event, second); await tick(); await tick();
  assert.equal(h.exits(), 1);
});

test('repeated quit requests cannot skip an in-flight review save and editor editing is locked', async () => {
  const h = mainHarness();
  h.quit(); await tick();
  assert.equal(h.editor.enabled, false);
  h.quit(); await tick();
  assert.equal(h.exits(), 0);
  assert.equal(h.sent.filter(([name]) => name === 'app:request-save-before-quit').length, 1);
});

test('the native main-window close waits for review persistence and engine cleanup before destroying the renderer', async () => {
  const h = mainHarness();
  h.setNeeds(false);
  h.main.close(); await tick();
  assert.equal(h.main.isDestroyed(), false, 'the renderer must remain alive to save the review');
  assert.equal(h.sent.filter(([name]) => name === 'app:request-save-before-quit').length, 1);
  await h.handlers.get('app:quit-confirmed')(h.event, h.attempt()); await tick(); await tick();
  assert.equal(h.context.shutdownCleanupStarted, true);
  assert.equal(h.main.isDestroyed(), true);
  assert.equal(h.exits(), 1);
});

function rendererHarness({ save, prepare = async () => true, hasChanges = true, confirm = () => true } = {}) {
  const source = read('renderer/scripts/app.js');
  const start = source.indexOf('  // ====== 앱 종료 전 저장 처리 ======');
  const end = source.indexOf('  // ====== 사용자 이름 초기화', start);
  assert.ok(start >= 0 && end > start);
  let onRequest, onAbort;
  const calls = [], overlay = new Set();
  const context = {
    Promise, Map, Set, Number, confirm,
    log: { info() {}, warn() {}, error() {} },
    document: { getElementById: () => ({ classList: { add: (name) => overlay.add(name), remove: (name) => overlay.delete(name) } }) },
    window: { electronAPI: {
      onRequestSaveBeforeQuit: (callback) => { onRequest = callback; },
      onQuitAborted: (callback) => { onAbort = callback; },
      async confirmQuit(id) { calls.push(['confirm', id]); },
      async cancelQuit(id) { calls.push(['cancel', id]); onAbort?.(id); }
    } },
    fabricDrawingPilotController: {
      async preparePersistenceForQuit() { calls.push(['prepare']); return prepare(); },
      async resumeAfterQuitCancelled() { calls.push(['resume-input']); }
    },
    reviewDataManager: { currentBframePath: 'C:/review.bframe',
      pauseAutoSave() { calls.push(['pause-auto']); }, resumeAutoSave() { calls.push(['resume-auto']); },
      async waitForPendingSave() {}, hasUnsavedChanges: () => hasChanges,
      async save() { calls.push(['save']); return save ? save() : true; }
    },
    commentSync: { stop() { calls.push(['stop-comments']); } },
    drawingSync: { stop() {} }, fabricDrawingSync: { stop() {} },
    liveblocksManager: { async stop() { calls.push(['stop-collaboration']); } },
    latestVideoLoadToken: 5,
    async startCollaborationForVideoLoad(token, file, options) { calls.push(['resume-collaboration', token, file, options.seedCurrentState]); }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { calls, overlay, request: (id) => onRequest(id), abort(id) { assert.equal(typeof onAbort, 'function'); return onAbort(id); } };
}

test('an aborted in-flight review save settles before input and collaboration resume and never confirms', async () => {
  const saving = deferred();
  const h = rendererHarness({ save: () => saving.promise });
  const work = h.request(1); await tick();
  assert.ok(h.calls.some(([name]) => name === 'save'));
  const recovery = h.abort(1); await tick();
  assert.equal(h.calls.filter(([name]) => name === 'resume-input').length, 0);
  saving.resolve(true); await work; await recovery; await tick();
  assert.equal(h.calls.filter(([name]) => name === 'confirm').length, 0);
  assert.equal(h.calls.filter(([name]) => name === 'resume-input').length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'resume-auto').length, 1);
  assert.deepEqual(h.calls.filter(([name]) => name === 'resume-collaboration'), [['resume-collaboration', 5, 'C:/review.bframe', false]]);
  assert.equal(h.overlay.has('active'), false);
});

test('an editor veto after review confirmation restores review and permits the next save attempt', async () => {
  const h = rendererHarness();
  await h.request(1);
  assert.deepEqual(h.calls.filter(([name]) => name === 'confirm'), [['confirm', 1]]);
  await h.abort(1); await tick();
  await h.request(2);
  assert.deepEqual(h.calls.filter(([name]) => name === 'confirm'), [['confirm', 1], ['confirm', 2]]);
  assert.equal(h.calls.filter(([name]) => name === 'resume-auto').length, 1);
});

test('a new request waits for cancellation recovery of an earlier asynchronous preparation', async () => {
  const preparing = deferred(); let count = 0;
  const h = rendererHarness({ prepare: () => ++count === 1 ? preparing.promise : true });
  const first = h.request(1); await tick();
  const cancelled = h.abort(1);
  const second = h.request(2);
  preparing.resolve(true); await first; await cancelled; await second;
  assert.deepEqual(h.calls.filter(([name]) => name === 'confirm'), [['confirm', 2]]);
  assert.ok(h.calls.findIndex(([name]) => name === 'resume-input') < h.calls.findLastIndex(([name]) => name === 'prepare'));
});
