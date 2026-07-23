const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const reviewFileStorePath = path.join(
  repoRoot,
  'main',
  'review-file-store.js'
);
const workerPath = path.join(
  __dirname,
  'fixtures',
  'review-file-save-worker.js'
);
const WINDOWS_ONLY = process.platform !== 'win32'
  ? 'review-file cross-process locking uses a Windows named pipe'
  : false;
const TEST_TIMEOUT_MS = 15_000;
const NORMAL_STORE_OPTIONS = Object.freeze({
  lockAcquireTimeoutMs: 3_000,
  lockRetryMinMs: 5,
  lockRetryMaxMs: 20,
  renameRetryDelaysMs: [0, 5, 10]
});

function loadReviewFileStore() {
  return require(reviewFileStorePath);
}

function serializeReview(data) {
  return JSON.stringify(data, null, 2);
}

async function writeReview(filePath, data) {
  await fsp.writeFile(filePath, serializeReview(data), 'utf8');
}

async function readReview(filePath) {
  let lastError = null;
  for (const waitMs of [0, 5, 10, 25, 50, 100]) {
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    try {
      return JSON.parse(await fsp.readFile(filePath, 'utf8'));
    } catch (error) {
      lastError = error;
      if (!['EACCES', 'EBUSY', 'EPERM', 'ENOENT'].includes(error?.code)) {
        throw error;
      }
    }
  }
  throw lastError;
}

function createMessageInbox(child, getDiagnostics) {
  const backlog = [];
  const history = [];
  const waiters = [];
  let exit = null;

  function settleWaiter(waiter, message) {
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }

  function rejectWaiters(error) {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  child.on('message', (message) => {
    history.push(message);
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      settleWaiter(waiter, message);
      return;
    }
    backlog.push(message);
  });

  child.on('exit', (code, signal) => {
    exit = { code, signal };
    rejectWaiters(new Error(
      'review save worker exited before the expected message ' +
      `(${JSON.stringify(exit)})\n${getDiagnostics()}`
    ));
  });

  child.on('error', (error) => {
    rejectWaiters(error);
  });

  return {
    hasSeen(predicate) {
      return history.some(predicate);
    },
    waitFor(predicate, description, timeoutMs = 5_000) {
      const backlogIndex = backlog.findIndex(predicate);
      if (backlogIndex >= 0) {
        const [message] = backlog.splice(backlogIndex, 1);
        return Promise.resolve(message);
      }
      if (exit) {
        return Promise.reject(new Error(
          `review save worker already exited while waiting for ${description} ` +
          `(${JSON.stringify(exit)})\n${getDiagnostics()}`
        ));
      }

      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: null
        };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(
            `timed out waiting for ${description}\n${getDiagnostics()}`
          ));
        }, timeoutMs);
        waiters.push(waiter);
      });
    }
  };
}

async function createWorker() {
  const child = fork(workerPath, [], {
    cwd: repoRoot,
    env: { ...process.env },
    silent: true,
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });
  const diagnostics = () => [
    stdout ? `stdout:\n${stdout}` : '',
    stderr ? `stderr:\n${stderr}` : ''
  ].filter(Boolean).join('\n');
  const inbox = createMessageInbox(child, diagnostics);

  const worker = {
    child,
    send(message) {
      child.send(message);
    },
    run(config) {
      child.send({ type: 'run', config });
    },
    release(phase) {
      child.send({ type: 'release', phase });
    },
    waitForPhase(phase, timeoutMs) {
      return inbox.waitFor(
        message => message?.type === 'phase' && message.phase === phase,
        `phase ${phase}`,
        timeoutMs
      );
    },
    hasSeenPhase(phase) {
      return inbox.hasSeen(
        message => message?.type === 'phase' && message.phase === phase
      );
    },
    async waitForResult(timeoutMs) {
      const message = await inbox.waitFor(
        candidate =>
          candidate?.type === 'result' ||
          candidate?.type === 'error',
        'save result',
        timeoutMs
      );
      if (message.type === 'error') {
        const error = new Error(
          `review save worker failed: ${message.error?.message}\n` +
          `${message.error?.stack || ''}\n${diagnostics()}`
        );
        error.code = message.error?.code || null;
        error.workerStack = message.error?.stack || null;
        throw error;
      }
      return message.result;
    },
    async terminate() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise(resolve => child.once('exit', resolve));
      try {
        child.kill('SIGKILL');
      } catch {
        child.kill();
      }
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error(`worker termination timed out\n${diagnostics()}`)),
            2_000
          );
        })
      ]);
    }
  };

  await inbox.waitFor(
    message => message?.type === 'ready',
    'worker ready',
    5_000
  );
  return worker;
}

async function createHarness(t, initialData) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'baeframe-review-file-store-')
  );
  const filePath = path.join(directory, 'review.bframe');
  const workers = [];

  if (initialData !== undefined) {
    await writeReview(filePath, initialData);
  }

  t.after(async () => {
    await Promise.allSettled(workers.map(worker => worker.terminate()));
    await fsp.rm(directory, { recursive: true, force: true });
  });

  return {
    directory,
    filePath,
    async startWorker() {
      const worker = await createWorker();
      workers.push(worker);
      return worker;
    }
  };
}

async function tokenForFile(filePath) {
  const { createReviewVersionToken } = loadReviewFileStore();
  return createReviewVersionToken(await fsp.readFile(filePath, 'utf8'));
}

async function assertOnlyMainFileRemains(harness) {
  assert.deepEqual(
    (await fsp.readdir(harness.directory)).sort(),
    [path.basename(harness.filePath)]
  );
}

function assertStaleConflict(result) {
  assert.equal(result?.success, false);
  assert.equal(result?.conflict, true);
  assert.equal(result?.reason, 'stale-version-token');
}

test('two Node processes using one version token allow exactly one commit', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const base = {
    reviewDocumentId: 'cross-process-same-token',
    winner: 'base'
  };
  const firstData = {
    reviewDocumentId: base.reviewDocumentId,
    winner: 'first'
  };
  const secondData = {
    reviewDocumentId: base.reviewDocumentId,
    winner: 'second'
  };
  const harness = await createHarness(t, base);
  const versionToken = await tokenForFile(harness.filePath);
  const first = await harness.startWorker();
  const second = await harness.startWorker();

  first.run({
    filePath: harness.filePath,
    data: firstData,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterLockAcquired']
  });
  await first.waitForPhase('afterLockAcquired');

  second.run({
    filePath: harness.filePath,
    data: secondData,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS
  });
  await second.waitForPhase('saveStarted');
  first.release('afterLockAcquired');

  const [firstResult, secondResult] = await Promise.all([
    first.waitForResult(),
    second.waitForResult()
  ]);
  const results = [firstResult, secondResult];
  const successIndexes = results
    .map((result, index) => result?.success === true ? index : -1)
    .filter(index => index >= 0);
  assert.equal(
    successIndexes.length,
    1,
    JSON.stringify({ firstResult, secondResult })
  );
  assertStaleConflict(results[successIndexes[0] === 0 ? 1 : 0]);
  assert.deepEqual(
    await readReview(harness.filePath),
    successIndexes[0] === 0 ? firstData : secondData
  );
  await assertOnlyMainFileRemains(harness);
});

test('the named-pipe lock stays held until post-replace verification finishes', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const base = {
    reviewDocumentId: 'cross-process-lock-lifetime',
    winner: 'base'
  };
  const firstData = {
    reviewDocumentId: base.reviewDocumentId,
    winner: 'first'
  };
  const secondData = {
    reviewDocumentId: base.reviewDocumentId,
    winner: 'second'
  };
  const harness = await createHarness(t, base);
  const versionToken = await tokenForFile(harness.filePath);
  const first = await harness.startWorker();
  const second = await harness.startWorker();

  first.run({
    filePath: harness.filePath,
    data: firstData,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterReplace']
  });
  await first.waitForPhase('afterReplace');

  second.run({
    filePath: harness.filePath,
    data: secondData,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: {
      ...NORMAL_STORE_OPTIONS,
      lockAcquireTimeoutMs: 120
    }
  });
  const secondResult = await second.waitForResult();

  assert.deepEqual(secondResult, {
    success: false,
    retryable: true,
    reason: 'lock-timeout'
  });
  assert.equal(
    second.hasSeenPhase('afterLockAcquired'),
    false,
    'the waiting process must not enter the transaction while post-verify is held'
  );

  first.release('afterReplace');
  const firstResult = await first.waitForResult();
  assert.equal(firstResult?.success, true);
  assert.deepEqual(await readReview(harness.filePath), firstData);
  await assertOnlyMainFileRemains(harness);
});

test('malformed backup recovery holds the named-pipe lock through post-verify', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const backup = {
    reviewDocumentId: 'cross-process-malformed-recovery-lock',
    revision: 2,
    source: 'backup'
  };
  const waitingData = {
    reviewDocumentId: backup.reviewDocumentId,
    revision: 3,
    source: 'waiting-writer'
  };
  const harness = await createHarness(t);
  const backupContent = serializeReview(backup);
  await fsp.writeFile(
    harness.filePath,
    '{"reviewDocumentId":"cross-process-malformed-recovery-lock"',
    'utf8'
  );
  await fsp.writeFile(`${harness.filePath}.bak`, backupContent, 'utf8');
  const backupVersionToken = await tokenForFile(`${harness.filePath}.bak`);
  const recovery = await harness.startWorker();
  const waiting = await harness.startWorker();

  recovery.run({
    operation: 'read',
    filePath: harness.filePath,
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterReplace']
  });
  await recovery.waitForPhase('afterReplace');

  waiting.run({
    filePath: harness.filePath,
    data: waitingData,
    saveOptions: { expectedVersionToken: backupVersionToken },
    storeOptions: {
      ...NORMAL_STORE_OPTIONS,
      lockAcquireTimeoutMs: 120
    }
  });
  const waitingResult = await waiting.waitForResult();

  assert.deepEqual(waitingResult, {
    success: false,
    retryable: true,
    reason: 'lock-timeout'
  });
  assert.equal(
    waiting.hasSeenPhase('afterLockAcquired'),
    false,
    'a writer must not enter while malformed backup recovery is post-verifying'
  );

  recovery.release('afterReplace');
  const recoveredSnapshot = await recovery.waitForResult();
  assert.deepEqual(recoveredSnapshot.data, backup);
  assert.deepEqual(await readReview(harness.filePath), backup);
});

test('two Node processes creating one review file never overwrite the first creator', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const firstData = {
    reviewDocumentId: 'cross-process-first-create',
    creator: 'first'
  };
  const secondData = {
    reviewDocumentId: 'cross-process-first-create',
    creator: 'second'
  };
  const harness = await createHarness(t);
  const first = await harness.startWorker();
  const second = await harness.startWorker();

  first.run({
    filePath: harness.filePath,
    data: firstData,
    saveOptions: { failIfExists: true },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterLockAcquired']
  });
  await first.waitForPhase('afterLockAcquired');

  second.run({
    filePath: harness.filePath,
    data: secondData,
    saveOptions: { failIfExists: true },
    storeOptions: NORMAL_STORE_OPTIONS
  });
  await second.waitForPhase('saveStarted');
  first.release('afterLockAcquired');

  const [firstResult, secondResult] = await Promise.all([
    first.waitForResult(),
    second.waitForResult()
  ]);
  const results = [firstResult, secondResult];
  const successIndexes = results
    .map((result, index) => result?.success === true ? index : -1)
    .filter(index => index >= 0);
  assert.equal(
    successIndexes.length,
    1,
    JSON.stringify({ firstResult, secondResult })
  );
  assert.deepEqual(
    results[successIndexes[0] === 0 ? 1 : 0],
    { success: false, exists: true }
  );
  assert.deepEqual(
    await readReview(harness.filePath),
    successIndexes[0] === 0 ? firstData : secondData
  );
  await assertOnlyMainFileRemains(harness);
});

test('a waiting Node process times out without stealing another process lock', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const base = {
    reviewDocumentId: 'cross-process-timeout',
    revision: 1
  };
  const firstData = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    writer: 'lock-owner'
  };
  const secondData = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    writer: 'waiter'
  };
  const harness = await createHarness(t, base);
  const versionToken = await tokenForFile(harness.filePath);
  const owner = await harness.startWorker();
  const waiter = await harness.startWorker();

  owner.run({
    filePath: harness.filePath,
    data: firstData,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterLockAcquired']
  });
  await owner.waitForPhase('afterLockAcquired');

  waiter.run({
    filePath: harness.filePath,
    data: secondData,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: {
      ...NORMAL_STORE_OPTIONS,
      lockAcquireTimeoutMs: 120,
      lockRetryMinMs: 5,
      lockRetryMaxMs: 10
    }
  });
  const waiterResult = await waiter.waitForResult(2_000);
  assert.equal(waiterResult?.success, false);
  assert.equal(waiterResult?.retryable, true);
  assert.equal(waiterResult?.reason, 'lock-timeout');
  assert.deepEqual(await readReview(harness.filePath), base);

  owner.release('afterLockAcquired');
  const ownerResult = await owner.waitForResult();
  assert.equal(ownerResult?.success, true);
  assert.deepEqual(await readReview(harness.filePath), firstData);
  await assertOnlyMainFileRemains(harness);
});

test('a crashed named-pipe lock owner cannot leave a stale lock', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const base = {
    reviewDocumentId: 'cross-process-crashed-lock',
    revision: 1
  };
  const next = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2
  };
  const harness = await createHarness(t, base);
  const versionToken = await tokenForFile(harness.filePath);
  const crashedOwner = await harness.startWorker();

  crashedOwner.run({
    filePath: harness.filePath,
    data: {
      reviewDocumentId: base.reviewDocumentId,
      revision: 99
    },
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterLockAcquired']
  });
  await crashedOwner.waitForPhase('afterLockAcquired');
  await crashedOwner.terminate();
  assert.deepEqual(await readReview(harness.filePath), base);

  const recovery = await harness.startWorker();
  recovery.run({
    filePath: harness.filePath,
    data: next,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS
  });
  const recoveryResult = await recovery.waitForResult();
  assert.equal(recoveryResult?.success, true);
  assert.deepEqual(await readReview(harness.filePath), next);
  await assertOnlyMainFileRemains(harness);
});

test('an external edit after temp sync wins the final token recheck', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const base = {
    reviewDocumentId: 'cross-process-late-token',
    revision: 1
  };
  const candidate = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    source: 'candidate'
  };
  const external = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 3,
    source: 'external'
  };
  const harness = await createHarness(t, base);
  const versionToken = await tokenForFile(harness.filePath);
  const worker = await harness.startWorker();

  worker.run({
    filePath: harness.filePath,
    data: candidate,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['beforeCommitRecheck']
  });
  await worker.waitForPhase('beforeCommitRecheck');
  await writeReview(harness.filePath, external);
  worker.release('beforeCommitRecheck');

  const result = await worker.waitForResult();
  assertStaleConflict(result);
  assert.deepEqual(await readReview(harness.filePath), external);
  await assertOnlyMainFileRemains(harness);
});

test('a crash after temp sync preserves main and the next save removes the orphan', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const base = {
    reviewDocumentId: 'cross-process-temp-crash',
    revision: 1
  };
  const recovered = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    source: 'recovery'
  };
  const harness = await createHarness(t, base);
  const versionToken = await tokenForFile(harness.filePath);
  const crashedWriter = await harness.startWorker();

  crashedWriter.run({
    filePath: harness.filePath,
    data: {
      reviewDocumentId: base.reviewDocumentId,
      revision: 99,
      source: 'crashed'
    },
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterTempSynced']
  });
  await crashedWriter.waitForPhase('afterTempSynced');
  assert.deepEqual(await readReview(harness.filePath), base);
  assert.ok(
    (await fsp.readdir(harness.directory)).length > 1,
    'a synced temp should exist before the simulated crash'
  );
  await crashedWriter.terminate();
  assert.deepEqual(await readReview(harness.filePath), base);

  const recovery = await harness.startWorker();
  recovery.run({
    filePath: harness.filePath,
    data: recovered,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS
  });
  const result = await recovery.waitForResult();
  assert.equal(result?.success, true);
  assert.deepEqual(await readReview(harness.filePath), recovered);
  await assertOnlyMainFileRemains(harness);
});

test('a crash after replace leaves one complete target and releases the pipe lock', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const base = {
    reviewDocumentId: 'cross-process-after-replace-crash',
    revision: 1
  };
  const committed = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    source: 'committed-before-crash'
  };
  const harness = await createHarness(t, base);
  const oldVersionToken = await tokenForFile(harness.filePath);
  const crashedWriter = await harness.startWorker();

  crashedWriter.run({
    filePath: harness.filePath,
    data: committed,
    saveOptions: { expectedVersionToken: oldVersionToken },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterReplace']
  });
  await crashedWriter.waitForPhase('afterReplace');
  assert.deepEqual(await readReview(harness.filePath), committed);
  await crashedWriter.terminate();

  const staleWriter = await harness.startWorker();
  staleWriter.run({
    filePath: harness.filePath,
    data: {
      reviewDocumentId: base.reviewDocumentId,
      revision: 3
    },
    saveOptions: { expectedVersionToken: oldVersionToken },
    storeOptions: NORMAL_STORE_OPTIONS
  });
  const staleResult = await staleWriter.waitForResult();
  assertStaleConflict(staleResult);
  assert.deepEqual(await readReview(harness.filePath), committed);
  await assertOnlyMainFileRemains(harness);
});

test('readers observe only complete old or new JSON during replacement', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const base = {
    reviewDocumentId: 'cross-process-atomic-read',
    generation: 'old',
    payload: 'old'
  };
  const next = {
    reviewDocumentId: base.reviewDocumentId,
    generation: 'new',
    payload: 'x'.repeat(2 * 1024 * 1024)
  };
  const harness = await createHarness(t, base);
  const versionToken = await tokenForFile(harness.filePath);
  const writer = await harness.startWorker();

  writer.run({
    filePath: harness.filePath,
    data: next,
    saveOptions: { expectedVersionToken: versionToken },
    storeOptions: NORMAL_STORE_OPTIONS,
    holdPhases: ['afterTempSynced']
  });
  await writer.waitForPhase('afterTempSynced');
  assert.equal((await readReview(harness.filePath)).generation, 'old');

  let completed = false;
  const resultPromise = writer.waitForResult().finally(() => {
    completed = true;
  });
  const observed = new Set(['old']);
  writer.release('afterTempSynced');

  for (let attempt = 0; attempt < 500 && !completed; attempt += 1) {
    const observedDocument = await readReview(harness.filePath);
    assert.ok(
      observedDocument.generation === 'old' ||
      observedDocument.generation === 'new'
    );
    observed.add(observedDocument.generation);
    await new Promise(resolve => setImmediate(resolve));
  }

  const result = await resultPromise;
  assert.equal(result?.success, true);
  assert.equal((await readReview(harness.filePath)).generation, 'new');
  observed.add('new');
  assert.deepEqual([...observed].sort(), ['new', 'old']);
  await assertOnlyMainFileRemains(harness);
});
