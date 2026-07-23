const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const reviewFileStorePath = path.resolve(
  __dirname,
  '../../main/review-file-store.js'
);

function serializeReview(data) {
  return JSON.stringify(data, null, 2);
}

async function createReviewFixture(t, data) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'baeframe-review-file-store-contract-')
  );
  const filePath = path.join(directory, 'review.bframe');
  await fsp.writeFile(filePath, serializeReview(data), 'utf8');
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return { directory, filePath };
}

async function readReview(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function assertOnlyMainFileRemains(directory, filePath) {
  assert.deepEqual(
    (await fsp.readdir(directory)).sort(),
    [path.basename(filePath)]
  );
}

test('review file store exposes the transactional save API', () => {
  const {
    createReviewFileStore,
    createReviewVersionToken,
    readReviewSnapshot,
    saveReviewFile
  } = require(reviewFileStorePath);

  assert.equal(typeof createReviewFileStore, 'function');
  assert.equal(typeof createReviewVersionToken, 'function');
  assert.equal(typeof readReviewSnapshot, 'function');
  assert.equal(typeof saveReviewFile, 'function');

  const store = createReviewFileStore({
    lockAcquireTimeoutMs: 100,
    lockRetryMinMs: 5,
    lockRetryMaxMs: 10,
    renameRetryDelaysMs: [0],
    hooks: {}
  });
  assert.equal(typeof store.readReviewSnapshot, 'function');
  assert.equal(typeof store.saveReviewFile, 'function');
});

test('transient Windows rename errors retry before committing the verified temp', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'rename-retry-success',
    revision: 1
  };
  const next = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2
  };
  const { directory, filePath } = await createReviewFixture(t, base);
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(filePath, 'utf8')
  );
  const injectedCodes = ['EPERM', 'EACCES'];
  let renameAttempts = 0;
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0, 0, 0],
    hooks: {
      onRenameAttempt() {
        renameAttempts += 1;
        const code = injectedCodes.shift();
        if (!code) return;
        const error = new Error(`injected ${code}`);
        error.code = code;
        throw error;
      }
    }
  });

  const result = await store.saveReviewFile(filePath, next, {
    expectedVersionToken
  });

  assert.equal(result?.success, true);
  assert.equal(renameAttempts, 3);
  assert.deepEqual(await readReview(filePath), next);
  await assertOnlyMainFileRemains(directory, filePath);
});

test('exhausted Windows rename retries preserve main and report target-busy', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'rename-retry-exhausted',
    revision: 1
  };
  const { directory, filePath } = await createReviewFixture(t, base);
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(filePath, 'utf8')
  );
  let renameAttempts = 0;
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0, 0, 0],
    hooks: {
      onRenameAttempt() {
        renameAttempts += 1;
        const error = new Error('injected EBUSY');
        error.code = 'EBUSY';
        throw error;
      }
    }
  });

  const result = await store.saveReviewFile(filePath, {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2
  }, {
    expectedVersionToken
  });

  assert.deepEqual(result, {
    success: false,
    retryable: true,
    reason: 'target-busy'
  });
  assert.equal(renameAttempts, 3);
  assert.deepEqual(await readReview(filePath), base);
  await assertOnlyMainFileRemains(directory, filePath);
});

test('an external edit during rename backoff stops later retries as stale', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'rename-retry-external-edit',
    revision: 1
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
  let renameAttempts = 0;
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0, 0, 0],
    hooks: {
      async onRenameAttempt() {
        renameAttempts += 1;
        if (renameAttempts !== 1) return;
        await fsp.writeFile(filePath, serializeReview(external), 'utf8');
        const error = new Error('injected EPERM after external write');
        error.code = 'EPERM';
        throw error;
      }
    }
  });

  const result = await store.saveReviewFile(filePath, {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2,
    source: 'candidate'
  }, {
    expectedVersionToken
  });

  assert.deepEqual(result, {
    success: false,
    conflict: true,
    reason: 'stale-version-token'
  });
  assert.equal(renameAttempts, 1);
  assert.deepEqual(await readReview(filePath), external);
  await assertOnlyMainFileRemains(directory, filePath);
});

test('a recovery sidecar is never exposed before its complete JSON is synced', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'atomic-recovery-sidecar',
    revision: 1
  };
  const { directory, filePath } = await createReviewFixture(t, base);
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(filePath, 'utf8')
  );
  const injected = new Error('stop after the private sidecar temp is synced');
  const store = createReviewFileStore({
    hooks: {
      afterRecoverySidecarTempSynced() {
        throw injected;
      }
    }
  });

  await assert.rejects(
    store.saveReviewFile(filePath, {
      reviewDocumentId: base.reviewDocumentId,
      revision: 2
    }, {
      expectedVersionToken
    }),
    error => error === injected
  );

  assert.deepEqual(await readReview(filePath), base);
  assert.equal(
    await fsp.stat(`${filePath}.recovery.json`).then(
      () => true,
      error => {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
    ),
    false
  );
  await assertOnlyMainFileRemains(directory, filePath);
});

test('orphan cleanup removes only exact generated temp names and preserves live owners', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const base = {
    reviewDocumentId: 'strict-orphan-temp-cleanup',
    revision: 1
  };
  const next = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2
  };
  const { directory, filePath } = await createReviewFixture(t, base);
  const machineToken = 'strict-temp-machine';
  const deadPid = 999999;
  const livePid = 424242;
  const targetPrefix =
    `.${path.basename(filePath)}.baeframe-tmp-${machineToken}-`;
  const sidecarPrefix =
    `.${path.basename(filePath)}.recovery.json.baeframe-tmp-` +
    `${machineToken}-`;
  const deadTargetName =
    `${targetPrefix}${deadPid}-11111111-1111-4111-8111-111111111111`;
  const deadSidecarName =
    `${sidecarPrefix}${deadPid}-22222222-2222-4222-8222-222222222222` +
    '.prepare';
  const liveTargetName =
    `${targetPrefix}${livePid}-33333333-3333-4333-8333-333333333333`;
  const lookalikeName = `${targetPrefix}${deadPid}.bframe`;
  await Promise.all([
    fsp.writeFile(path.join(directory, deadTargetName), '{}', 'utf8'),
    fsp.writeFile(path.join(directory, deadSidecarName), '{}', 'utf8'),
    fsp.writeFile(path.join(directory, liveTargetName), '{}', 'utf8'),
    fsp.writeFile(
      path.join(directory, lookalikeName),
      serializeReview({
        reviewDocumentId: 'valid-lookalike-review',
        revision: 9
      }),
      'utf8'
    )
  ]);
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(filePath, 'utf8')
  );
  const store = createReviewFileStore({
    machineToken,
    isProcessAlive: pid => pid === livePid
  });

  const result = await store.saveReviewFile(filePath, next, {
    expectedVersionToken
  });

  assert.equal(result?.success, true);
  assert.deepEqual(await readReview(filePath), next);
  assert.deepEqual(
    new Set(await fsp.readdir(directory)),
    new Set([
      path.basename(filePath),
      liveTargetName,
      lookalikeName
    ])
  );
});

for (const fileName of [
  'Review.BFRAME',
  `Review-${'X'.repeat(130)}.BFRAME`
]) {
  const label = fileName.length > 120 ? 'long' : 'short';
  test(`a ${label} Windows path recovers the same transaction through different casing`, async t => {
    const {
      createReviewFileStore,
      createReviewVersionToken
    } = require(reviewFileStorePath);
    const directory = await fsp.mkdtemp(
      path.join(os.tmpdir(), `baeframe-review-file-store-case-${label}-`)
    );
    t.after(() => fsp.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, fileName);
    const differentlyCasedPath = path.join(
      directory,
      fileName.toLowerCase()
    );
    const base = {
      reviewDocumentId: `windows-case-${label}`,
      revision: 1
    };
    await fsp.writeFile(filePath, serializeReview(base), 'utf8');
    const expectedVersionToken = createReviewVersionToken(
      await fsp.readFile(filePath, 'utf8')
    );
    const interrupted = new Error('leave a prepared transaction for recovery');
    const writer = createReviewFileStore({
      hooks: {
        afterRecoveryPrepared() {
          throw interrupted;
        }
      }
    });

    await assert.rejects(
      writer.saveReviewFile(filePath, {
        reviewDocumentId: base.reviewDocumentId,
        revision: 2
      }, {
        expectedVersionToken
      }),
      error => error === interrupted
    );

    const reader = createReviewFileStore();
    const snapshot = await reader.readReviewSnapshot(differentlyCasedPath);

    assert.deepEqual(snapshot.data, base);
    assert.equal(snapshot.recovery?.action, 'discarded-uncommitted');
    await assertOnlyMainFileRemains(directory, filePath);
  });
}

for (const {
  label,
  firstFileName,
  secondFileName
} of [
    {
      label: 'NFC and NFD',
      firstFileName: 'caf\u00e9.bframe',
      secondFileName: 'cafe\u0301.bframe'
    },
    {
      label: 'Kelvin sign and ASCII k',
      firstFileName: '\u212a.bframe',
      secondFileName: 'k.bframe'
    }
  ]) {
  test(`distinct ${label} Windows files never consume each other recovery state`, async t => {
    const {
      createReviewFileStore,
      createReviewVersionToken
    } = require(reviewFileStorePath);
    const directory = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'baeframe-review-file-store-unicode-')
    );
    t.after(() => fsp.rm(directory, { recursive: true, force: true }));
    const firstFilePath = path.join(directory, firstFileName);
    const secondFilePath = path.join(directory, secondFileName);
    const firstBase = {
      reviewDocumentId: `windows-unicode-first-${label}`,
      revision: 1
    };
    const secondBase = {
      reviewDocumentId: `windows-unicode-second-${label}`,
      revision: 1
    };
    await Promise.all([
      fsp.writeFile(firstFilePath, serializeReview(firstBase), 'utf8'),
      fsp.writeFile(secondFilePath, serializeReview(secondBase), 'utf8')
    ]);
    assert.deepEqual(
      new Set(await fsp.readdir(directory)),
      new Set([path.basename(firstFilePath), path.basename(secondFilePath)])
    );
    const expectedVersionToken = createReviewVersionToken(
      await fsp.readFile(firstFilePath, 'utf8')
    );
    const interrupted = new Error(
      `leave ${label} recovery artifacts in place`
    );
    const writer = createReviewFileStore({
      hooks: {
        afterRollbackPrepared() {
          throw interrupted;
        }
      }
    });

    await assert.rejects(
      writer.saveReviewFile(firstFilePath, {
        reviewDocumentId: firstBase.reviewDocumentId,
        revision: 2
      }, {
        expectedVersionToken
      }),
      error => error === interrupted
    );

    const reader = createReviewFileStore();
    const secondSnapshot = await reader.readReviewSnapshot(secondFilePath);
    assert.deepEqual(secondSnapshot.data, secondBase);
    assert.equal(secondSnapshot.recovery, null);

    const firstSnapshot = await reader.readReviewSnapshot(firstFilePath);
    assert.deepEqual(firstSnapshot.data, firstBase);
    assert.equal(firstSnapshot.recovery?.action, 'discarded-uncommitted');
    assert.deepEqual(
      new Set(await fsp.readdir(directory)),
      new Set([path.basename(firstFilePath), path.basename(secondFilePath)])
    );
  });
}

test('ASCII case variants in a case-sensitive Windows directory keep separate recovery state', async t => {
  if (process.platform !== 'win32') {
    t.skip('Windows case-sensitive directory behavior');
    return;
  }
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'baeframe-review-file-store-case-sensitive-')
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  try {
    await execFileAsync('fsutil.exe', [
      'file',
      'SetCaseSensitiveInfo',
      directory,
      'enable'
    ], {
      windowsHide: true
    });
  } catch (error) {
    const unavailableOrDenied =
      error?.code === 'ENOENT' ||
      /access.+denied|permission|not supported|unavailable|권한|지원되지/i
        .test(`${error?.stderr || ''} ${error?.message || ''}`);
    if (unavailableOrDenied) {
      t.skip('Windows case-sensitive directory creation unavailable');
      return;
    }
    throw error;
  }
  const firstFilePath = path.join(directory, 'Review.bframe');
  const secondFilePath = path.join(directory, 'review.bframe');
  const firstBase = {
    reviewDocumentId: 'windows-case-sensitive-upper',
    revision: 1
  };
  const secondBase = {
    reviewDocumentId: 'windows-case-sensitive-lower',
    revision: 1
  };
  await Promise.all([
    fsp.writeFile(
      firstFilePath,
      serializeReview(firstBase),
      { encoding: 'utf8', flag: 'wx' }
    ),
    fsp.writeFile(
      secondFilePath,
      serializeReview(secondBase),
      { encoding: 'utf8', flag: 'wx' }
    )
  ]);
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(firstFilePath, 'utf8')
  );
  const interrupted = new Error(
    'leave upper-case recovery artifacts in place'
  );
  const writer = createReviewFileStore({
    hooks: {
      afterRollbackPrepared() {
        throw interrupted;
      }
    }
  });

  await assert.rejects(
    writer.saveReviewFile(firstFilePath, {
      reviewDocumentId: firstBase.reviewDocumentId,
      revision: 2
    }, {
      expectedVersionToken
    }),
    error => error === interrupted
  );

  const reader = createReviewFileStore();
  const secondSnapshot = await reader.readReviewSnapshot(secondFilePath);
  assert.deepEqual(secondSnapshot.data, secondBase);
  assert.equal(secondSnapshot.recovery, null);

  const firstSnapshot = await reader.readReviewSnapshot(firstFilePath);
  assert.deepEqual(firstSnapshot.data, firstBase);
  assert.equal(firstSnapshot.recovery?.action, 'discarded-uncommitted');
  assert.deepEqual(
    new Set(await fsp.readdir(directory)),
    new Set([path.basename(firstFilePath), path.basename(secondFilePath)])
  );
});

test('a Windows junction alias recovers the same long-name transaction', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const rootDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'baeframe-review-file-store-junction-')
  );
  const realDirectory = path.join(rootDirectory, 'real');
  const aliasDirectory = path.join(rootDirectory, 'alias');
  await fsp.mkdir(realDirectory);
  try {
    await fsp.symlink(realDirectory, aliasDirectory, 'junction');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip(`junction creation unavailable: ${error.code}`);
      await fsp.rm(rootDirectory, { recursive: true, force: true });
      return;
    }
    throw error;
  }
  t.after(async () => {
    await fsp.rm(aliasDirectory, { force: true });
    await fsp.rm(rootDirectory, { recursive: true, force: true });
  });
  const fileName = `Review-${'J'.repeat(130)}.BFRAME`;
  const realFilePath = path.join(realDirectory, fileName);
  const aliasFilePath = path.join(aliasDirectory, fileName);
  const base = {
    reviewDocumentId: 'windows-junction-long-name',
    revision: 1
  };
  await fsp.writeFile(realFilePath, serializeReview(base), 'utf8');
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(realFilePath, 'utf8')
  );
  const interrupted = new Error('leave a prepared junction transaction');
  const writer = createReviewFileStore({
    hooks: {
      afterRecoveryPrepared() {
        throw interrupted;
      }
    }
  });

  await assert.rejects(
    writer.saveReviewFile(realFilePath, {
      reviewDocumentId: base.reviewDocumentId,
      revision: 2
    }, {
      expectedVersionToken
    }),
    error => error === interrupted
  );

  const reader = createReviewFileStore();
  const snapshot = await reader.readReviewSnapshot(aliasFilePath);

  assert.deepEqual(snapshot.data, base);
  assert.equal(snapshot.recovery?.action, 'discarded-uncommitted');
  await assertOnlyMainFileRemains(realDirectory, realFilePath);
});

test('a long valid Windows file name uses compact sibling transaction files', async t => {
  const {
    createReviewFileStore,
    createReviewVersionToken
  } = require(reviewFileStorePath);
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'baeframe-review-file-store-long-name-')
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(
    directory,
    `${'r'.repeat(180)}.bframe`
  );
  const base = {
    reviewDocumentId: 'long-valid-windows-file-name',
    revision: 1
  };
  const next = {
    reviewDocumentId: base.reviewDocumentId,
    revision: 2
  };
  await fsp.writeFile(filePath, serializeReview(base), 'utf8');
  const expectedVersionToken = createReviewVersionToken(
    await fsp.readFile(filePath, 'utf8')
  );
  const store = createReviewFileStore({
    renameRetryDelaysMs: [0]
  });

  const result = await store.saveReviewFile(filePath, next, {
    expectedVersionToken
  });

  assert.equal(result?.success, true);
  assert.deepEqual((await store.readReviewSnapshot(filePath)).data, next);
  await assertOnlyMainFileRemains(directory, filePath);
});
