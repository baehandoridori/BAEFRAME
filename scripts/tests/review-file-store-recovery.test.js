const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const reviewFileStorePath = path.resolve(
  __dirname,
  '../../main/review-file-store.js'
);

function serializeReview(data) {
  return JSON.stringify(data, null, 2);
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function createReviewFixture(t, data) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'baeframe-review-file-store-recovery-')
  );
  const filePath = path.join(directory, 'review.bframe');
  await fsp.writeFile(filePath, serializeReview(data), 'utf8');
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return { directory, filePath };
}

async function readReview(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function saveResultWithoutThrow(savePromise) {
  try {
    return await savePromise;
  } catch (error) {
    return { thrownError: error };
  }
}

test('an external write at the final commit boundary is never overwritten', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'final-boundary-cas',
    revision: 1,
    source: 'base'
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
  const { filePath } = await createReviewFixture(t, base);
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(filePath, 'utf8')
  );
  let boundaryWrites = 0;
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0],
    hooks: {
      async onRenameAttempt({ attempt }) {
        if (attempt !== 0) return;
        boundaryWrites += 1;
        await fsp.writeFile(filePath, serializeReview(external), 'utf8');
      }
    }
  });

  const result = await saveResultWithoutThrow(store.saveReviewFile(
    filePath,
    candidate,
    { expectedVersionToken }
  ));

  assert.equal(boundaryWrites, 1);
  assert.equal(result?.success, false);
  assert.equal(result?.conflict, true);
  assert.deepEqual(await readReview(filePath), external);
});

test('a live commit restores an unexpected external CAS backup before success', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'live-displaced-external',
    revision: 1,
    source: 'base'
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
  const { directory, filePath } = await createReviewFixture(t, base);
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(filePath, 'utf8')
  );
  let injectedBackupPath = null;
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0],
    hooks: {
      async afterReplace() {
        const sidecar = JSON.parse(
          await fsp.readFile(`${filePath}.recovery.json`, 'utf8')
        );
        injectedBackupPath = path.join(
          path.dirname(filePath),
          '.baeframe-cas.backup-' +
            `${sidecar.transactionId}-injected-external`
        );
        await fsp.writeFile(
          injectedBackupPath,
          serializeReview(external),
          'utf8'
        );
      }
    }
  });

  const result = await store.saveReviewFile(filePath, candidate, {
    expectedVersionToken
  });

  assert.deepEqual(result, {
    success: false,
    conflict: true,
    reason: 'superseded-by-external',
    versionToken: createReviewVersionToken(serializeReview(external))
  });
  assert.deepEqual(await readReview(filePath), external);
  assert.equal(await pathExists(injectedBackupPath), false);
  assert.deepEqual(
    (await fsp.readdir(directory)).sort(),
    [path.basename(filePath)]
  );
});

test('a pre-existing CAS backup from another transaction is never restored', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'ignore-stale-cas-backup',
    revision: 10,
    source: 'base'
  };
  const candidate = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 11,
    source: 'candidate'
  };
  const stale = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 1,
    source: 'old-residue'
  };
  const { directory, filePath } = await createReviewFixture(t, base);
  const staleBackupPath = path.join(
    directory,
    '.baeframe-cas.backup-old-crash'
  );
  await fsp.writeFile(staleBackupPath, serializeReview(stale), 'utf8');
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(filePath, 'utf8')
  );
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0]
  });

  const result = await store.saveReviewFile(filePath, candidate, {
    expectedVersionToken
  });

  assert.equal(result?.success, true);
  assert.deepEqual(await readReview(filePath), candidate);
  assert.equal(
    await fsp.readFile(staleBackupPath, 'utf8'),
    serializeReview(stale)
  );
});

test('a save waits for an active recovery sidecar then reports the completed write as stale', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'active-sidecar-stale',
    revision: 1,
    source: 'base'
  };
  const activeWriter = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    source: 'active-writer'
  };
  const waitingWriter = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 3,
    source: 'waiting-writer'
  };
  const { directory, filePath } = await createReviewFixture(t, base);
  const baseContent = await fsp.readFile(filePath, 'utf8');
  const activeContent = serializeReview(activeWriter);
  const expectedVersionToken = createReviewVersionToken(baseContent);
  const transactionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const targetTempPath = path.join(
    directory,
    `.${path.basename(filePath)}.baeframe-tmp-active-${transactionId}`
  );
  const rollbackPath = `${filePath}.rollback.${transactionId}.bak`;
  const sidecarPath = `${filePath}.recovery.json`;

  await fsp.writeFile(targetTempPath, activeContent, 'utf8');
  await fsp.writeFile(rollbackPath, baseContent, 'utf8');
  await fsp.writeFile(sidecarPath, JSON.stringify({
    schemaVersion: 1,
    state: 'prepared',
    operation: 'save',
    transactionId,
    ownerMachineToken: 'active-sidecar-machine',
    ownerPid: 424242,
    preparedAt: '2026-07-23T00:00:00.000Z',
    fileName: path.basename(filePath),
    base: {
      exists: true,
      versionToken: expectedVersionToken,
      jsonValid: true
    },
    target: {
      versionToken: createReviewVersionToken(activeContent),
      reviewDocumentId: activeWriter.reviewDocumentId
    },
    artifacts: {
      targetTempName: path.basename(targetTempPath),
      rollbackName: path.basename(rollbackPath)
    }
  }, null, 2), 'utf8');

  const store = createReviewFileStore({
    machineToken: 'active-sidecar-machine',
    isProcessAlive: pid => pid === 424242,
    lockAcquireTimeoutMs: 1_000,
    lockRetryMinMs: 5,
    lockRetryMaxMs: 10,
    recoveryOwnerStaleMs: 0,
    renameRetryDelaysMs: [0]
  });

  const activeCommit = (async () => {
    await new Promise(resolve => setTimeout(resolve, 75));
    await fsp.writeFile(filePath, activeContent, 'utf8');
    await Promise.all([
      fsp.unlink(targetTempPath),
      fsp.unlink(rollbackPath),
      fsp.unlink(sidecarPath)
    ]);
  })();
  const result = await store.saveReviewFile(
    filePath,
    waitingWriter,
    { expectedVersionToken }
  );
  await activeCommit;

  assert.deepEqual(result, {
    success: false,
    conflict: true,
    reason: 'stale-version-token'
  });
  assert.deepEqual(await readReview(filePath), activeWriter);
});

for (const failureMode of ['corrupted', 'missing']) {
  test(`a ${failureMode} post-verify target restores the verified base`, async t => {
    const {
      createReviewFileStore,
      createReviewVersionToken
    } = require(reviewFileStorePath);
    const base = {
      reviewDocumentId: `postverify-${failureMode}`,
      revision: 1,
      source: 'verified-base'
    };
    const candidate = {
      reviewDocumentId: base.reviewDocumentId,
      revision: 2,
      source: 'candidate'
    };
    const { filePath } = await createReviewFixture(t, base);
    const expectedVersionToken = createReviewVersionToken(
      await fsp.readFile(filePath, 'utf8')
    );
    const store = createReviewFileStore({
      renameRetryDelaysMs: [0],
      hooks: {
        async afterReplace() {
          if (failureMode === 'missing') {
            await fsp.unlink(filePath);
            return;
          }
          await fsp.writeFile(filePath, '{"broken":', 'utf8');
        }
      }
    });

    const result = await saveResultWithoutThrow(store.saveReviewFile(
      filePath,
      candidate,
      { expectedVersionToken }
    ));

    assert.equal(result?.success, false);
    assert.equal(result?.recovered, true);
    assert.equal(result?.reason, 'post-write-rolled-back');
    assert.deepEqual(await readReview(filePath), base);
  });
}

test('a rollback failure is fatal and preserves every recovery artifact', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'postverify-fatal',
    revision: 1,
    source: 'verified-base'
  };
  const candidate = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    source: 'candidate'
  };
  const { directory, filePath } = await createReviewFixture(t, base);
  const baseContent = await fsp.readFile(filePath, 'utf8');
  const expectedVersionToken = createReviewVersionToken(baseContent);
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0],
    hooks: {
      async afterReplace() {
        await fsp.writeFile(filePath, '{"broken-after-replace":', 'utf8');
      },
      beforeRollbackRestore() {
        const error = new Error('injected rollback failure');
        error.code = 'EACCES';
        throw error;
      }
    }
  });

  const result = await saveResultWithoutThrow(store.saveReviewFile(
    filePath,
    candidate,
    { expectedVersionToken }
  ));

  assert.equal(result?.success, false);
  assert.equal(result?.fatal, true);
  assert.equal(result?.reason, 'rollback-failed');
  assert.equal(await pathExists(filePath), true);

  const sidecarPath = `${filePath}.recovery.json`;
  assert.equal(await pathExists(sidecarPath), true);
  const sidecar = JSON.parse(await fsp.readFile(sidecarPath, 'utf8'));
  assert.equal(sidecar.schemaVersion, 1);
  assert.equal(sidecar.state, 'prepared');

  const rollbackPaths = (await fsp.readdir(directory))
    .filter(name => name.startsWith(`${path.basename(filePath)}.rollback.`))
    .map(name => path.join(directory, name));
  assert.equal(rollbackPaths.length, 1);
  assert.equal(await fsp.readFile(rollbackPaths[0], 'utf8'), baseContent);

  const targetTempPath = path.join(
    directory,
    sidecar.artifacts.targetTempName
  );
  assert.equal(await pathExists(targetTempPath), true);
  assert.equal(
    createReviewVersionToken(await fsp.readFile(targetTempPath, 'utf8')),
    sidecar.target.versionToken
  );
});

test('the next read restores a prepared transaction whose main is missing', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'prepared-read-recovery',
    revision: 1,
    source: 'rollback'
  };
  const candidate = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    source: 'prepared-candidate'
  };
  const { directory, filePath } = await createReviewFixture(t, base);
  const baseContent = await fsp.readFile(filePath, 'utf8');
  const targetContent = serializeReview(candidate);
  const transactionId = '11111111-2222-4333-8444-555555555555';
  const rollbackPath = `${filePath}.rollback.${transactionId}.bak`;
  const targetTempPath = path.join(
    directory,
    `.${path.basename(filePath)}.baeframe-tmp-test-${transactionId}`
  );
  const sidecarPath = `${filePath}.recovery.json`;
  await fsp.rename(filePath, rollbackPath);
  await fsp.writeFile(targetTempPath, targetContent, 'utf8');
  await fsp.writeFile(sidecarPath, JSON.stringify({
    schemaVersion: 1,
    state: 'prepared',
    operation: 'save',
    transactionId,
    ownerMachineToken: 'test-machine',
    ownerPid: 12345,
    preparedAt: '2026-07-23T00:00:00.000Z',
    fileName: path.basename(filePath),
    base: {
      exists: true,
      versionToken: createReviewVersionToken(baseContent),
      jsonValid: true
    },
    target: {
      versionToken: createReviewVersionToken(targetContent),
      reviewDocumentId: candidate.reviewDocumentId
    },
    artifacts: {
      targetTempName: path.basename(targetTempPath),
      rollbackName: path.basename(rollbackPath)
    }
  }, null, 2), 'utf8');
  const store = createReviewFileStore({
    machineToken: 'test-machine',
    renameRetryDelaysMs: [0]
  });

  const snapshot = await store.readReviewSnapshot(filePath);

  assert.deepEqual(snapshot.data, base);
  assert.equal(
    snapshot.versionToken,
    createReviewVersionToken(baseContent)
  );
  assert.equal(snapshot.recovery?.action, 'restored-rollback');
  assert.deepEqual(await readReview(filePath), base);
  assert.equal(await pathExists(targetTempPath), false);
  assert.equal(await pathExists(sidecarPath), false);
});

test('a valid external version supersedes an interrupted prepared transaction', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'prepared-external-winner',
    revision: 1,
    source: 'base'
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
  const { directory, filePath } = await createReviewFixture(t, external);
  const baseContent = serializeReview(base);
  const targetContent = serializeReview(candidate);
  const transactionId = '22222222-3333-4444-8555-666666666666';
  const rollbackPath = `${filePath}.rollback.${transactionId}.bak`;
  const targetTempPath = path.join(
    directory,
    `.${path.basename(filePath)}.baeframe-tmp-test-${transactionId}`
  );
  const sidecarPath = `${filePath}.recovery.json`;
  await fsp.writeFile(rollbackPath, baseContent, 'utf8');
  await fsp.writeFile(targetTempPath, targetContent, 'utf8');
  await fsp.writeFile(sidecarPath, JSON.stringify({
    schemaVersion: 1,
    state: 'prepared',
    operation: 'save',
    transactionId,
    ownerMachineToken: 'test-machine',
    ownerPid: 12345,
    preparedAt: '2026-07-23T00:00:00.000Z',
    fileName: path.basename(filePath),
    base: {
      exists: true,
      versionToken: createReviewVersionToken(baseContent),
      jsonValid: true
    },
    target: {
      versionToken: createReviewVersionToken(targetContent),
      reviewDocumentId: candidate.reviewDocumentId
    },
    artifacts: {
      targetTempName: path.basename(targetTempPath),
      rollbackName: path.basename(rollbackPath)
    }
  }, null, 2), 'utf8');
  const store = createReviewFileStore({
    machineToken: 'test-machine',
    renameRetryDelaysMs: [0]
  });

  const snapshot = await store.readReviewSnapshot(filePath);

  assert.deepEqual(snapshot.data, external);
  assert.equal(snapshot.recovery?.action, 'superseded-by-external');
  assert.equal(await pathExists(targetTempPath), false);
  assert.equal(await pathExists(rollbackPath), false);
  assert.equal(await pathExists(sidecarPath), false);
});

test('a displaced external CAS backup is restored after a helper crash', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'prepared-displaced-external',
    revision: 1,
    source: 'base'
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
  const { directory, filePath } = await createReviewFixture(t, candidate);
  const baseContent = serializeReview(base);
  const targetContent = serializeReview(candidate);
  const externalContent = serializeReview(external);
  const transactionId = '33333333-4444-4555-8666-777777777777';
  const rollbackPath = `${filePath}.rollback.${transactionId}.bak`;
  const targetTempPath = path.join(
    directory,
    `.${path.basename(filePath)}.baeframe-tmp-test-${transactionId}`
  );
  const casBackupPath = path.join(
    directory,
    `.baeframe-cas.backup-${transactionId}-crash-window`
  );
  const sidecarPath = `${filePath}.recovery.json`;
  await Promise.all([
    fsp.writeFile(rollbackPath, baseContent, 'utf8'),
    fsp.writeFile(targetTempPath, targetContent, 'utf8'),
    fsp.writeFile(casBackupPath, externalContent, 'utf8')
  ]);
  await fsp.writeFile(sidecarPath, JSON.stringify({
    schemaVersion: 1,
    state: 'prepared',
    operation: 'save',
    transactionId,
    ownerMachineToken: 'test-machine',
    ownerPid: 12345,
    preparedAt: '2026-07-23T00:00:00.000Z',
    fileName: path.basename(filePath),
    base: {
      exists: true,
      versionToken: createReviewVersionToken(baseContent),
      jsonValid: true
    },
    target: {
      versionToken: createReviewVersionToken(targetContent),
      reviewDocumentId: candidate.reviewDocumentId
    },
    artifacts: {
      targetTempName: path.basename(targetTempPath),
      rollbackName: path.basename(rollbackPath)
    }
  }, null, 2), 'utf8');
  const store = createReviewFileStore({
    machineToken: 'test-machine',
    renameRetryDelaysMs: [0]
  });

  const snapshot = await store.readReviewSnapshot(filePath);

  assert.deepEqual(snapshot.data, external);
  assert.equal(snapshot.recovery?.action, 'superseded-by-external');
  assert.deepEqual(await readReview(filePath), external);
  assert.deepEqual(
    (await fsp.readdir(directory)).sort(),
    [path.basename(filePath)]
  );
});

test('a stale malformed sidecar is quarantined without hiding valid review data', async t => {
  const { createReviewFileStore } = require(reviewFileStorePath);
  const review = {
    reviewDocumentId: 'stale-malformed-sidecar',
    revision: 4,
    source: 'valid-main'
  };
  const { directory, filePath } = await createReviewFixture(t, review);
  const sidecarPath = `${filePath}.recovery.json`;
  const malformedSidecar = '{"schemaVersion":1,"state":';
  await fsp.writeFile(sidecarPath, malformedSidecar, 'utf8');
  const store = createReviewFileStore({
    recoveryOwnerStaleMs: 0
  });

  const snapshot = await store.readReviewSnapshot(filePath);

  assert.deepEqual(snapshot.data, review);
  assert.equal(
    snapshot.recovery?.action,
    'quarantined-stale-sidecar'
  );
  assert.equal(await pathExists(sidecarPath), false);
  assert.equal(
    await fsp.readFile(snapshot.recovery.quarantinePath, 'utf8'),
    malformedSidecar
  );
  assert.equal(
    path.dirname(snapshot.recovery.quarantinePath),
    directory
  );
});

test('a stale unsupported sidecar is also quarantined with its bytes intact', async t => {
  const { createReviewFileStore } = require(reviewFileStorePath);
  const review = {
    reviewDocumentId: 'stale-unsupported-sidecar',
    revision: 5,
    source: 'valid-main'
  };
  const { filePath } = await createReviewFixture(t, review);
  const sidecarPath = `${filePath}.recovery.json`;
  const unsupportedSidecar = '{"schemaVersion":0}';
  await fsp.writeFile(sidecarPath, unsupportedSidecar, 'utf8');
  const store = createReviewFileStore({
    recoveryOwnerStaleMs: 0
  });

  const snapshot = await store.readReviewSnapshot(filePath);

  assert.deepEqual(snapshot.data, review);
  assert.equal(
    snapshot.recovery?.action,
    'quarantined-stale-sidecar'
  );
  assert.equal(await pathExists(sidecarPath), false);
  assert.equal(
    await fsp.readFile(snapshot.recovery.quarantinePath, 'utf8'),
    unsupportedSidecar
  );
});

test('a stale foreign-computer sidecar recovers a complete committed target', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'stale-foreign-sidecar',
    revision: 1,
    source: 'base'
  };
  const candidate = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    source: 'foreign-commit'
  };
  const { directory, filePath } = await createReviewFixture(t, candidate);
  const baseContent = serializeReview(base);
  const candidateContent = serializeReview(candidate);
  const transactionId = '44444444-5555-4666-8777-888888888888';
  const targetTempPath = path.join(
    directory,
    `.${path.basename(filePath)}.baeframe-tmp-test-${transactionId}`
  );
  const rollbackPath = `${filePath}.rollback.${transactionId}.bak`;
  const sidecarPath = `${filePath}.recovery.json`;
  await Promise.all([
    fsp.writeFile(targetTempPath, candidateContent, 'utf8'),
    fsp.writeFile(rollbackPath, baseContent, 'utf8')
  ]);
  await fsp.writeFile(sidecarPath, JSON.stringify({
    schemaVersion: 1,
    state: 'prepared',
    operation: 'save',
    transactionId,
    ownerMachineToken: 'another-computer',
    ownerPid: 99999,
    preparedAt: '2026-07-20T00:00:00.000Z',
    fileName: path.basename(filePath),
    base: {
      exists: true,
      versionToken: createReviewVersionToken(baseContent),
      jsonValid: true
    },
    target: {
      versionToken: createReviewVersionToken(candidateContent),
      reviewDocumentId: candidate.reviewDocumentId
    },
    artifacts: {
      targetTempName: path.basename(targetTempPath),
      rollbackName: path.basename(rollbackPath)
    }
  }, null, 2), 'utf8');
  const store = createReviewFileStore({
    machineToken: 'this-computer',
    recoveryOwnerStaleMs: 0
  });

  const snapshot = await store.readReviewSnapshot(filePath);

  assert.deepEqual(snapshot.data, candidate);
  assert.equal(snapshot.recovery?.action, 'completed-commit');
  assert.deepEqual(
    (await fsp.readdir(directory)).sort(),
    [path.basename(filePath)]
  );
});

test('a malformed main is restored from valid .bak through the store transaction', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const backup = {
    reviewDocumentId: 'malformed-backup-recovery',
    revision: 7,
    source: 'validated-backup'
  };
  const { directory, filePath } = await createReviewFixture(t, {
    reviewDocumentId: backup.reviewDocumentId,
    revision: 1
  });
  const malformedContent = '{"reviewDocumentId":"malformed-backup-recovery"';
  const backupContent = serializeReview(backup);
  await fsp.writeFile(filePath, malformedContent, 'utf8');
  await fsp.writeFile(`${filePath}.bak`, backupContent, 'utf8');
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0]
  });

  const snapshot = await store.readReviewSnapshot(filePath);

  assert.deepEqual(snapshot.data, backup);
  assert.equal(
    snapshot.versionToken,
    createReviewVersionToken(backupContent)
  );
  assert.equal(snapshot.recovery?.action, 'restored-backup');
  assert.match(
    path.basename(snapshot.recovery.corruptedPath),
    /^review\.bframe\.corrupted\.[0-9a-f-]+$/i
  );
  assert.equal(
    await fsp.readFile(snapshot.recovery.corruptedPath, 'utf8'),
    malformedContent
  );
  assert.deepEqual(await readReview(filePath), backup);

  const unresolvedSidecar = path.join(
    directory,
    `${path.basename(filePath)}.recovery.json`
  );
  if (await pathExists(unresolvedSidecar)) {
    const sidecar = JSON.parse(await fsp.readFile(unresolvedSidecar, 'utf8'));
    assert.notEqual(sidecar.state, 'prepared');
  }
});
