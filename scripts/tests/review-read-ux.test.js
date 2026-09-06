const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createReviewFileStore, createReviewVersionToken } = require('../../main/review-file-store');

async function fixture(t, data = null) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'baeframe-review-read-ux-'));
  const filePath = path.join(directory, 'review.bframe');
  if (data) await fsp.writeFile(filePath, JSON.stringify(data), 'utf8');
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return { directory, filePath };
}

test('normal absence returns null after checking once and confirming under the save lock', async t => {
  const { filePath } = await fixture(t);
  let reads = 0;
  const store = createReviewFileStore({ fsPromises: {
    ...fsp,
    async readFile(file, ...args) {
      if (file === filePath) reads++;
      return fsp.readFile(file, ...args);
    }
  } });
  const started = performance.now();
  const snapshot = await store.readReviewSnapshot(filePath, { allowMissing: true });
  t.diagnostic(`normal absent review: ${(performance.now() - started).toFixed(2)} ms`);
  assert.equal(snapshot.data, null);
  assert.equal(snapshot.versionToken, null);
  assert.equal(reads, 2, 'normal absence only reads once plus one locked confirmation, without the six-attempt retry schedule');
  await fsp.writeFile(filePath, JSON.stringify({ reviewDocumentId: 'created-later' }));
  assert.equal((await store.readReviewSnapshot(filePath, { allowMissing: true })).data.reviewDocumentId, 'created-later');
});

test('default snapshot reads still retry a temporary ENOENT', async t => {
  const { filePath } = await fixture(t, { reviewDocumentId: 'existing' });
  let reads = 0;
  const store = createReviewFileStore({ fsPromises: {
    ...fsp,
    async readFile(file, ...args) {
      if (file === filePath && ++reads === 1) throw Object.assign(new Error('temporary rename'), { code: 'ENOENT' });
      return fsp.readFile(file, ...args);
    }
  } });
  assert.equal((await store.readReviewSnapshot(filePath)).data.reviewDocumentId, 'existing');
  assert.equal(reads, 2);
});

test('normal-load mode retries access contention instead of treating it as absence', async t => {
  const { filePath } = await fixture(t, { reviewDocumentId: 'busy' });
  let reads = 0;
  const store = createReviewFileStore({ fsPromises: {
    ...fsp,
    async readFile(file, ...args) {
      if (file === filePath && ++reads === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return fsp.readFile(file, ...args);
    }
  } });
  assert.equal((await store.readReviewSnapshot(filePath, { allowMissing: true })).data.reviewDocumentId, 'busy');
  assert.equal(reads, 2);
});

test('normal-load mode waits for the same store pending write', async t => {
  const { filePath } = await fixture(t);
  let releaseWrite, entered;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const store = createReviewFileStore({ hooks: {
    async afterLockAcquired() { entered(); await gate; }
  } });
  const saving = store.saveReviewFile(filePath, { reviewDocumentId: 'pending' }, { failIfExists: true });
  await started;
  let readSettled = false;
  const reading = store.readReviewSnapshot(filePath, { allowMissing: true }).then(value => { readSettled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  const settledBeforeWrite = readSettled;
  releaseWrite();
  assert.equal((await saving).success, true);
  const snapshot = await reading;
  assert.equal(settledBeforeWrite, false);
  assert.equal(snapshot.data.reviewDocumentId, 'pending');
});

test('normal-load mode waits for a different store first save before its sidecar is published', async t => {
  const { filePath } = await fixture(t);
  let releaseWrite, entered;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const writer = createReviewFileStore({ hooks: {
    async afterTempSynced() { entered(); await gate; }
  } });
  const reader = createReviewFileStore({ lockRetryMinMs: 1, lockRetryMaxMs: 1 });
  const saving = writer.saveReviewFile(filePath, { reviewDocumentId: 'other-store' }, { failIfExists: true });
  await started;
  assert.equal(fs.existsSync(`${filePath}.recovery.json`), false);
  let readSettled = false;
  const reading = reader.readReviewSnapshot(filePath, { allowMissing: true }).then(value => { readSettled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 20));
  const settledBeforeWrite = readSettled;
  releaseWrite();
  assert.equal((await saving).success, true);
  const snapshot = await reading;
  assert.equal(settledBeforeWrite, false);
  assert.equal(snapshot.data.reviewDocumentId, 'other-store');
});

for (const appearDuringRead of [false, true]) {
  test(`normal-load mode recovers a missing main with a prepared sidecar (${appearDuringRead ? 'appears during read' : 'already present'})`, async t => {
    const { directory, filePath } = await fixture(t);
    const base = { reviewDocumentId: 'recover-absence', revision: 1 };
    const baseContent = JSON.stringify(base);
    const targetContent = JSON.stringify({ ...base, revision: 2 });
    const id = '11111111-2222-4333-8444-555555555555';
    const rollbackPath = `${filePath}.rollback.${id}.bak`;
    const targetPath = path.join(directory, `.${path.basename(filePath)}.baeframe-tmp-test-${id}`);
    const sidecarPath = `${filePath}.recovery.json`;
    const publishSidecar = async () => {
      await fsp.writeFile(rollbackPath, baseContent);
      await fsp.writeFile(targetPath, targetContent);
      await fsp.writeFile(sidecarPath, JSON.stringify({
        schemaVersion: 1, state: 'prepared', operation: 'save', transactionId: id,
        ownerMachineToken: 'test-machine', ownerPid: 12345,
        preparedAt: '2026-07-23T00:00:00.000Z', fileName: path.basename(filePath),
        base: { exists: true, versionToken: createReviewVersionToken(baseContent), jsonValid: true },
        target: { versionToken: createReviewVersionToken(targetContent), reviewDocumentId: base.reviewDocumentId },
        artifacts: { targetTempName: path.basename(targetPath), rollbackName: path.basename(rollbackPath) }
      }));
    };
    if (!appearDuringRead) await publishSidecar();
    let published = !appearDuringRead;
    const store = createReviewFileStore({ machineToken: 'test-machine', fsPromises: {
      ...fsp,
      async readFile(file, ...args) {
        if (file === filePath && !published) { published = true; await publishSidecar(); }
        return fsp.readFile(file, ...args);
      }
    } });
    const snapshot = await store.readReviewSnapshot(filePath, { allowMissing: true });
    assert.deepEqual(snapshot.data, base);
    assert.equal(snapshot.recovery.action, 'restored-rollback');
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), base);
  });
}

test('only the ordinary load IPC opts into normal absence and still validates its path', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../main/ipc-handlers.js'), 'utf8');
  const start = source.indexOf("  ipcMain.handle('file:load-review-snapshot'");
  const end = source.indexOf('  // 파일 존재 여부 확인', start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Map(), calls = [];
  const context = {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    log: { trace: () => ({ end() {}, error() {} }) },
    validateFilePath(value) { if (value !== 'allowed.bframe') throw new Error('invalid path'); return 'validated.bframe'; },
    async readReviewSnapshot(...args) { calls.push(args); return { data: null, versionToken: null }; }
  };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(await handlers.get('file:load-review')({}, 'allowed.bframe'), null);
  assert.equal(calls[0][0], 'validated.bframe');
  assert.equal(calls[0][1]?.allowMissing, true);
  await handlers.get('file:load-review-snapshot')({}, 'allowed.bframe');
  assert.equal(calls[1][1]?.allowMissing, undefined);
  await assert.rejects(handlers.get('file:load-review')({}, 'untrusted'), /invalid path/);
  assert.equal(calls.length, 2);
});
