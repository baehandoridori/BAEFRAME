const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = path.resolve(__dirname, '../..');
const VALID_ID = 'reviewdoc-55555555-5555-4555-8555-555555555555';
const OTHER_VALID_ID = 'reviewdoc-66666666-6666-4666-8666-666666666666';

async function importModule(relativePath) {
  return import(pathToFileURL(path.join(rootDir, relativePath)).href);
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

test('web writer prepares one stable review identity while preserving opaque fields', async () => {
  const {
    prepareBframeForWrite,
    serializeBframeForWrite
  } = await importModule('web-viewer/scripts/bframe-write-guard.js');
  const root = {
    bframeVersion: '2.0',
    videoFile: 'shot.mp4',
    drawingsV3: { schemaVersion: '3.0.0', nested: { keep: true } },
    vendorEnvelope: { values: [1, 2, 3] }
  };
  let uuidCalls = 0;
  const randomUUID = () => {
    uuidCalls += 1;
    return VALID_ID.slice('reviewdoc-'.length);
  };

  assert.strictEqual(prepareBframeForWrite(root, { randomUUID }), root);
  assert.equal(root.reviewDocumentId, VALID_ID);
  assert.strictEqual(prepareBframeForWrite(root, { randomUUID }), root);
  const serialized = JSON.parse(serializeBframeForWrite(root, { randomUUID }));

  assert.equal(uuidCalls, 1);
  assert.equal(serialized.reviewDocumentId, VALID_ID);
  assert.deepEqual(serialized.drawingsV3, root.drawingsV3);
  assert.deepEqual(serialized.vendorEnvelope, root.vendorEnvelope);
});

test('web writer fails closed for future, malformed, and explicit legacy versions', async () => {
  const { prepareBframeForWrite } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const blockedVersions = [
    '3.0',
    'v3.0',
    'legacy',
    '2.',
    '2.future',
    '2...',
    '',
    null,
    0,
    { major: 3 }
  ];

  for (const bframeVersion of blockedVersions) {
    const root = { bframeVersion, videoFile: 'future.mp4' };
    assert.throws(
      () => prepareBframeForWrite(root, {
        randomUUID: () => VALID_ID.slice('reviewdoc-'.length)
      }),
      /지원하지 않는.*bframe/i,
      `version ${String(bframeVersion)} must be blocked`
    );
    assert.equal(Object.hasOwn(root, 'reviewDocumentId'), false);
  }

  const actualLegacyRoot = { videoFile: 'legacy.mp4', vendorField: { keep: true } };
  assert.doesNotThrow(() => prepareBframeForWrite(actualLegacyRoot, {
    randomUUID: () => VALID_ID.slice('reviewdoc-'.length)
  }));
  assert.equal(actualLegacyRoot.reviewDocumentId, VALID_ID);
});

test('web writer rejects an invalid existing review identity without replacing it', async () => {
  const { prepareBframeForWrite } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const root = {
    bframeVersion: '2.0',
    reviewDocumentId: '',
    drawingsV3: { keep: true }
  };

  assert.throws(
    () => prepareBframeForWrite(root, {
      randomUUID: () => VALID_ID.slice('reviewdoc-'.length)
    }),
    /reviewDocumentId/
  );
  assert.equal(root.reviewDocumentId, '');
});

test('web and desktop bridge apply the same version and identity rules', async () => {
  const webGuard = await importModule('web-viewer/scripts/bframe-write-guard.js');
  const desktopEnvelope = await importModule('shared/bframe-root-envelope.js');
  const desktopSchema = await importModule('shared/schema.js');
  const roots = [
    {},
    { bframeVersion: '2.0' },
    { bframeVersion: '3.0' },
    { bframeVersion: 'legacy' },
    { bframeVersion: '2.' },
    { bframeVersion: '2.future' },
    { bframeVersion: '2...' },
    { bframeVersion: '' },
    { bframeVersion: null },
    { bframeVersion: 0 },
    { version: '1.0' }
  ];

  for (const root of roots) {
    const webVersion = webGuard.getDataVersion(root);
    const desktopVersion = desktopSchema.getDataVersion(root);
    const webResult = webGuard.getUnsupportedBframeMajor(
      webVersion,
      webGuard.BFRAME_VERSION,
      !webGuard.hasExplicitBframeVersion(root)
    );
    const desktopResult = desktopEnvelope.getUnsupportedBframeMajor(
      desktopVersion,
      desktopSchema.BFRAME_VERSION,
      !desktopSchema.hasExplicitBframeVersion(root)
    );

    assert.equal(webVersion, desktopVersion);
    assert.equal(Number.isNaN(webResult), Number.isNaN(desktopResult));
    if (!Number.isNaN(webResult)) assert.equal(webResult, desktopResult);
  }

  for (const value of [VALID_ID, '', null, 0, 'reviewdoc-not-a-uuid']) {
    assert.equal(
      webGuard.isValidReviewDocumentId(value),
      desktopEnvelope.isValidReviewDocumentId(value)
    );
  }
});

test('Drive payload uses the latest opaque root and never resurrects stale unknown fields', async () => {
  const { prepareDriveBframeForWrite } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const localRoot = {
    bframeVersion: '2.0',
    reviewDocumentId: VALID_ID,
    videoFile: 'shot.mp4',
    comments: { layers: [{ id: 'local-comments', markers: [] }] },
    drawingsV3: { documentId: 'stale-drawing' },
    staleVendor: { resurrect: false }
  };
  const latestRoot = {
    bframeVersion: '2.0',
    reviewDocumentId: VALID_ID,
    videoFile: 'shot.mp4',
    comments: { layers: [{ id: 'remote-comments', markers: [] }] },
    drawingsV3: { documentId: 'latest-drawing', nested: { keep: true } },
    latestVendor: { preserve: true }
  };

  const result = prepareDriveBframeForWrite(latestRoot, localRoot, {
    localIdentityPersisted: true
  });

  assert.equal(result.identityPersisted, true);
  assert.equal(result.data.reviewDocumentId, VALID_ID);
  assert.deepEqual(result.data.comments, localRoot.comments);
  assert.deepEqual(result.data.drawingsV3, latestRoot.drawingsV3);
  assert.deepEqual(result.data.latestVendor, latestRoot.latestVendor);
  assert.equal(Object.hasOwn(result.data, 'staleVendor'), false);
});

test('Drive payload enforces lineage while allowing first bridge identity creation', async () => {
  const { prepareDriveBframeForWrite } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const baseRoot = {
    bframeVersion: '2.0',
    videoFile: 'shot.mp4',
    comments: { layers: [] }
  };

  assert.throws(
    () => prepareDriveBframeForWrite(
      { ...baseRoot, reviewDocumentId: OTHER_VALID_ID },
      { ...baseRoot, reviewDocumentId: VALID_ID },
      { localIdentityPersisted: true }
    ),
    /계보 충돌/
  );
  assert.throws(
    () => prepareDriveBframeForWrite(
      { ...baseRoot },
      { ...baseRoot, reviewDocumentId: VALID_ID },
      { localIdentityPersisted: true }
    ),
    /계보 충돌/
  );

  const adopted = prepareDriveBframeForWrite(
    { ...baseRoot, reviewDocumentId: OTHER_VALID_ID, latestVendor: { keep: true } },
    { ...baseRoot },
    { localIdentityPersisted: false }
  );
  assert.equal(adopted.data.reviewDocumentId, OTHER_VALID_ID);
  assert.equal(adopted.identityPersisted, true);

  const created = prepareDriveBframeForWrite(
    { ...baseRoot },
    { ...baseRoot },
    {
      localIdentityPersisted: false,
      randomUUID: () => VALID_ID.slice('reviewdoc-'.length)
    }
  );
  assert.equal(created.data.reviewDocumentId, VALID_ID);
  assert.equal(created.identityPersisted, false);
});

test('Drive save coordinator is single-flight and coalesces concurrent requests into one trailing save', async () => {
  const { createTrailingSingleFlight } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const gates = [];
  let active = 0;
  let maxConcurrency = 0;

  const requestSave = createTrailingSingleFlight(async () => {
    const gate = createDeferred();
    const saveNumber = gates.length + 1;
    gates.push(gate);
    active += 1;
    maxConcurrency = Math.max(maxConcurrency, active);
    await gate.promise;
    active -= 1;
    return saveNumber;
  });

  const firstSave = requestSave();
  await flushPromises();
  assert.equal(gates.length, 1);

  let trailingResolved = false;
  const trailingSave = requestSave().then(result => {
    trailingResolved = true;
    return result;
  });
  const joinedTrailingSave = requestSave();
  await flushPromises();

  assert.equal(gates.length, 1, 'concurrent requests must not overlap the active save');
  assert.equal(trailingResolved, false);

  gates[0].resolve();
  assert.equal(await firstSave, 1);
  await flushPromises();

  assert.equal(gates.length, 2, 'pending requests must coalesce into one trailing save');
  assert.equal(trailingResolved, false, 'trailing callers must wait for their own save');
  assert.equal(maxConcurrency, 1);

  gates[1].resolve();
  assert.equal(await trailingSave, 2);
  assert.equal(await joinedTrailingSave, 2);
  assert.equal(maxConcurrency, 1);
});

test('Drive save coordinator can queue one new trailing save while the previous trailing save runs', async () => {
  const { createTrailingSingleFlight } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const gates = [];
  const requestSave = createTrailingSingleFlight(async () => {
    const gate = createDeferred();
    const saveNumber = gates.length + 1;
    gates.push(gate);
    await gate.promise;
    return saveNumber;
  });

  const firstSave = requestSave();
  await flushPromises();
  const secondSave = requestSave();
  gates[0].resolve();
  await firstSave;
  await flushPromises();
  assert.equal(gates.length, 2);

  const thirdSave = requestSave();
  const joinedThirdSave = requestSave();
  gates[1].resolve();
  assert.equal(await secondSave, 2);
  await flushPromises();

  assert.equal(gates.length, 3, 'requests during a trailing save must queue one next save');
  gates[2].resolve();
  assert.equal(await thirdSave, 3);
  assert.equal(await joinedThirdSave, 3);
});

test('Drive save coordinator runs trailing work with the latest queued request context', async () => {
  const { createTrailingSingleFlight } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const gates = [];
  const receivedContexts = [];
  const requestSave = createTrailingSingleFlight(async context => {
    const gate = createDeferred();
    gates.push(gate);
    receivedContexts.push(context);
    await gate.promise;
    return context.fileId;
  });
  const activeContext = { fileId: 'old-active' };
  const staleQueuedContext = { fileId: 'old-queued' };
  const latestQueuedContext = { fileId: 'new-queued' };

  const activeSave = requestSave(activeContext);
  await flushPromises();
  const staleQueuedSave = requestSave(staleQueuedContext);
  const latestQueuedSave = requestSave(latestQueuedContext);

  gates[0].resolve();
  assert.equal(await activeSave, 'old-active');
  await flushPromises();
  assert.deepEqual(receivedContexts, [activeContext, latestQueuedContext]);

  gates[1].resolve();
  assert.equal(await staleQueuedSave, 'new-queued');
  assert.equal(await latestQueuedSave, 'new-queued');
});

test('Drive save coordinator releases its lock after failure so a later request can retry', async () => {
  const { createTrailingSingleFlight } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  let attempts = 0;
  const requestSave = createTrailingSingleFlight(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Drive PATCH failed');
    return 'saved';
  });

  await assert.rejects(requestSave(), /Drive PATCH failed/);
  assert.equal(await requestSave(), 'saved');
  assert.equal(attempts, 2);
});

test('Drive commit merge keeps committed opaque fields and post-snapshot local edits', async () => {
  const { mergeDriveBframeAfterWrite } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const patchGate = createDeferred();
  const committedRoot = {
    bframeVersion: '2.0',
    reviewDocumentId: VALID_ID,
    comments: { layers: [{ markers: [{ id: 'comment-1', text: 'snapshot' }] }] },
    drawings: [{ frame: 1, strokes: [] }],
    latestVendor: { revision: 2 }
  };
  let localRoot = {
    bframeVersion: '2.0',
    reviewDocumentId: VALID_ID,
    comments: { layers: [{ markers: [{ id: 'comment-1', text: 'snapshot' }] }] },
    drawings: [{ frame: 1, strokes: [] }],
    staleVendor: { revision: 1 }
  };

  const finishSave = (async () => {
    await patchGate.promise;
    localRoot = mergeDriveBframeAfterWrite(committedRoot, localRoot);
  })();

  localRoot.comments.layers[0].markers[0].text = 'edited while PATCH waited';
  localRoot.drawings = [{ frame: 42, strokes: [{ color: '#ffff00' }] }];
  patchGate.resolve();
  await finishSave;

  assert.equal(
    localRoot.comments.layers[0].markers[0].text,
    'edited while PATCH waited'
  );
  assert.deepEqual(localRoot.drawings, [
    { frame: 42, strokes: [{ color: '#ffff00' }] }
  ]);
  assert.deepEqual(localRoot.latestVendor, { revision: 2 });
  assert.equal(Object.hasOwn(localRoot, 'staleVendor'), false);
});

test('context-bound Drive save aborts before PATCH when the document changes during GET', async () => {
  const { runContextBoundDriveSave } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const getGate = createDeferred();
  const oldRoot = { reviewDocumentId: VALID_ID, comments: { layers: [] } };
  const newRoot = { reviewDocumentId: OTHER_VALID_ID, comments: { layers: [] } };
  const saveContext = {
    fileId: 'old-file',
    documentGeneration: 1,
    root: oldRoot
  };
  let currentContext = saveContext;
  let patchCalls = 0;
  let commitCalls = 0;
  const isCurrent = context => context.fileId === currentContext.fileId &&
    context.documentGeneration === currentContext.documentGeneration &&
    context.root === currentContext.root;

  const savePromise = runContextBoundDriveSave(saveContext, {
    isCurrent,
    loadLatest: async context => {
      assert.equal(context.fileId, 'old-file');
      await getGate.promise;
      return { reviewDocumentId: VALID_ID, latestVendor: { keep: true } };
    },
    prepare: latestRoot => ({ data: latestRoot }),
    persist: async () => {
      patchCalls += 1;
    },
    commit: () => {
      commitCalls += 1;
    }
  });

  await flushPromises();
  currentContext = {
    fileId: 'new-file',
    documentGeneration: 2,
    root: newRoot
  };
  getGate.resolve();

  await assert.rejects(savePromise, /저장 대상 문서가 변경/);
  assert.equal(patchCalls, 0);
  assert.equal(commitCalls, 0);
  assert.strictEqual(currentContext.root, newRoot);
});

test('context-bound Drive save never commits into a new document after delayed PATCH', async () => {
  const { runContextBoundDriveSave } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const patchStarted = createDeferred();
  const patchGate = createDeferred();
  const oldRoot = { reviewDocumentId: VALID_ID, drawings: [] };
  const newRoot = { reviewDocumentId: OTHER_VALID_ID, drawings: [{ frame: 99 }] };
  const saveContext = {
    fileId: 'old-file',
    documentGeneration: 1,
    root: oldRoot
  };
  let currentContext = saveContext;
  let patchedFileId = null;
  let commitCalls = 0;
  const isCurrent = context => context.fileId === currentContext.fileId &&
    context.documentGeneration === currentContext.documentGeneration &&
    context.root === currentContext.root;

  const savePromise = runContextBoundDriveSave(saveContext, {
    isCurrent,
    loadLatest: async context => ({
      reviewDocumentId: context.root.reviewDocumentId,
      latestVendor: { keep: true }
    }),
    prepare: latestRoot => ({ data: latestRoot }),
    persist: async (_prepared, context) => {
      patchedFileId = context.fileId;
      patchStarted.resolve();
      await patchGate.promise;
    },
    commit: () => {
      commitCalls += 1;
    }
  });

  await patchStarted.promise;
  currentContext = {
    fileId: 'new-file',
    documentGeneration: 2,
    root: newRoot
  };
  patchGate.resolve();
  const result = await savePromise;

  assert.equal(patchedFileId, 'old-file');
  assert.equal(result.applied, false);
  assert.equal(commitCalls, 0);
  assert.strictEqual(currentContext.root, newRoot);
  assert.deepEqual(currentContext.root.drawings, [{ frame: 99 }]);
});

test('an old queued save aborts instead of capturing and saving a newly opened document', async () => {
  const {
    createTrailingSingleFlight,
    runContextBoundDriveSave
  } = await importModule('web-viewer/scripts/bframe-write-guard.js');
  const patchStarted = createDeferred();
  const patchGate = createDeferred();
  const oldRoot = { reviewDocumentId: VALID_ID };
  const newRoot = { reviewDocumentId: OTHER_VALID_ID };
  const oldContext = {
    fileId: 'old-file',
    documentGeneration: 1,
    root: oldRoot
  };
  let currentContext = oldContext;
  const getFileIds = [];
  const patchFileIds = [];
  const isCurrent = context => context.fileId === currentContext.fileId &&
    context.documentGeneration === currentContext.documentGeneration &&
    context.root === currentContext.root;
  const requestSave = createTrailingSingleFlight(context =>
    runContextBoundDriveSave(context, {
      isCurrent,
      loadLatest: async requestContext => {
        getFileIds.push(requestContext.fileId);
        return requestContext.root;
      },
      prepare: latestRoot => ({ data: latestRoot }),
      persist: async (_prepared, requestContext) => {
        patchFileIds.push(requestContext.fileId);
        patchStarted.resolve();
        await patchGate.promise;
      },
      commit: () => {}
    })
  );

  const activeSave = requestSave(oldContext);
  await patchStarted.promise;
  const queuedOldSave = requestSave(oldContext);
  currentContext = {
    fileId: 'new-file',
    documentGeneration: 2,
    root: newRoot
  };
  patchGate.resolve();

  const activeResult = await activeSave;
  assert.equal(activeResult.applied, false);
  await assert.rejects(queuedOldSave, /저장 대상 문서가 변경/);
  assert.deepEqual(getFileIds, ['old-file']);
  assert.deepEqual(patchFileIds, ['old-file']);
  assert.strictEqual(currentContext.root, newRoot);
});

test('same-document commit preserves root identity so trailing save PATCHes post-snapshot edits', async () => {
  const {
    createTrailingSingleFlight,
    prepareDriveBframeForWrite,
    reconcileDriveBframeAfterWrite,
    runContextBoundDriveSave
  } = await importModule('web-viewer/scripts/bframe-write-guard.js');
  const originalRoot = {
    bframeVersion: '2.0',
    reviewDocumentId: VALID_ID,
    comments: { layers: [{ markers: [{ id: 'comment-1', text: 'snapshot' }] }] },
    drawings: [{ frame: 1, strokes: [] }]
  };
  const state = {
    fileId: 'same-file',
    documentGeneration: 1,
    root: originalRoot
  };
  let remoteRoot = structuredClone(originalRoot);
  const patches = [];
  const isCurrent = context => context.fileId === state.fileId &&
    context.documentGeneration === state.documentGeneration &&
    context.root === state.root;
  const requestSave = createTrailingSingleFlight(context =>
    runContextBoundDriveSave(context, {
      isCurrent,
      loadLatest: async () => structuredClone(remoteRoot),
      prepare: latestRoot => prepareDriveBframeForWrite(latestRoot, context.root, {
        localIdentityPersisted: true
      }),
      persist: async prepared => {
        const gate = createDeferred();
        const payload = structuredClone(prepared.data);
        patches.push({ gate, payload });
        await gate.promise;
        remoteRoot = payload;
      },
      commit: prepared => {
        state.root = reconcileDriveBframeAfterWrite(prepared.data, context.root);
      }
    })
  );
  const captureContext = () => ({
    fileId: state.fileId,
    documentGeneration: state.documentGeneration,
    root: state.root
  });

  const activeSave = requestSave(captureContext());
  await flushPromises();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].payload.comments.layers[0].markers[0].text, 'snapshot');

  state.root.comments.layers[0].markers[0].text = 'edited after snapshot';
  state.root.drawings = [{ frame: 42, strokes: [{ color: '#ffff00' }] }];
  const trailingSave = requestSave(captureContext());

  patches[0].gate.resolve();
  await activeSave;
  await flushPromises();

  assert.strictEqual(state.root, originalRoot, 'same-document commit must keep root identity');
  assert.equal(patches.length, 2, 'post-snapshot edits must trigger the queued PATCH');
  assert.equal(
    patches[1].payload.comments.layers[0].markers[0].text,
    'edited after snapshot'
  );
  assert.deepEqual(patches[1].payload.drawings, [
    { frame: 42, strokes: [{ color: '#ffff00' }] }
  ]);

  patches[1].gate.resolve();
  await trailingSave;
  assert.equal(remoteRoot.comments.layers[0].markers[0].text, 'edited after snapshot');
  assert.deepEqual(remoteRoot.drawings, [
    { frame: 42, strokes: [{ color: '#ffff00' }] }
  ]);
});

test('a trailing save uses identity persisted by the active save and blocks remote disappearance', async () => {
  const {
    createTrailingSingleFlight,
    prepareContextBoundDriveBframeForWrite,
    reconcileDriveBframeAfterWrite,
    runContextBoundDriveSave
  } = await importModule('web-viewer/scripts/bframe-write-guard.js');
  const root = {
    bframeVersion: '2.0',
    comments: { layers: [] }
  };
  const state = {
    fileId: 'same-file',
    documentGeneration: 1,
    root,
    identityPersisted: false
  };
  const firstPatchGate = createDeferred();
  let loadCount = 0;
  let patchCount = 0;
  const isCurrent = context => context.fileId === state.fileId &&
    context.documentGeneration === state.documentGeneration &&
    context.root === state.root;
  const requestSave = createTrailingSingleFlight(context =>
    runContextBoundDriveSave(context, {
      isCurrent,
      loadLatest: async () => {
        loadCount += 1;
        return {
          bframeVersion: '2.0',
          comments: { layers: [] }
        };
      },
      prepare: latestRoot => {
        const prepared = prepareContextBoundDriveBframeForWrite(
          latestRoot,
          context,
          {
            currentIdentityPersisted: state.identityPersisted,
            randomUUID: () => VALID_ID.slice('reviewdoc-'.length)
          }
        );
        if (prepared.identityPersisted) state.identityPersisted = true;
        return prepared;
      },
      persist: async () => {
        patchCount += 1;
        if (patchCount === 1) await firstPatchGate.promise;
      },
      commit: prepared => {
        reconcileDriveBframeAfterWrite(prepared.data, context.root);
        state.identityPersisted = true;
      }
    })
  );
  const captureContext = () => ({
    fileId: state.fileId,
    documentGeneration: state.documentGeneration,
    root: state.root,
    localIdentityPersisted: state.identityPersisted
  });

  const activeSave = requestSave(captureContext());
  await flushPromises();
  assert.equal(patchCount, 1);
  assert.equal(state.identityPersisted, false, 'new identity is unproven before PATCH succeeds');

  const trailingSave = requestSave(captureContext());
  assert.equal(trailingSave instanceof Promise, true);
  firstPatchGate.resolve();
  await activeSave;

  await assert.rejects(trailingSave, /계보 충돌/);
  assert.equal(loadCount, 2);
  assert.equal(patchCount, 1, 'remote identity disappearance must block the trailing PATCH');
  assert.equal(state.identityPersisted, true);
  assert.equal(state.root.reviewDocumentId, VALID_ID);
});

test('remote identity adoption survives PATCH failure and blocks disappearance on retry', async () => {
  const {
    prepareContextBoundDriveBframeForWrite,
    runContextBoundDriveSave
  } = await importModule('web-viewer/scripts/bframe-write-guard.js');
  const root = { bframeVersion: '2.0', comments: { layers: [] } };
  const state = {
    fileId: 'same-file',
    documentGeneration: 1,
    root,
    identityPersisted: false
  };
  let latestRoot = {
    bframeVersion: '2.0',
    reviewDocumentId: OTHER_VALID_ID,
    comments: { layers: [] }
  };
  let patchAttempts = 0;
  const isCurrent = context => context.fileId === state.fileId &&
    context.documentGeneration === state.documentGeneration &&
    context.root === state.root;
  const persist = context => runContextBoundDriveSave(context, {
    isCurrent,
    loadLatest: async () => structuredClone(latestRoot),
    prepare: remoteRoot => {
      const prepared = prepareContextBoundDriveBframeForWrite(
        remoteRoot,
        context,
        { currentIdentityPersisted: state.identityPersisted }
      );
      if (prepared.identityPersisted) state.identityPersisted = true;
      return prepared;
    },
    persist: async () => {
      patchAttempts += 1;
      throw new Error('Drive PATCH failed');
    },
    commit: () => {
      assert.fail('failed PATCH must not commit');
    }
  });
  const captureContext = () => ({
    fileId: state.fileId,
    documentGeneration: state.documentGeneration,
    root: state.root,
    localIdentityPersisted: state.identityPersisted
  });

  await assert.rejects(persist(captureContext()), /Drive PATCH failed/);
  assert.equal(state.identityPersisted, true, 'remote ID is already persisted evidence');
  assert.equal(state.root.reviewDocumentId, OTHER_VALID_ID);

  latestRoot = { bframeVersion: '2.0', comments: { layers: [] } };
  await assert.rejects(persist(captureContext()), /계보 충돌/);
  assert.equal(patchAttempts, 1, 'retry must stop before PATCH when remote ID disappears');
});

test('a stale delayed bframe load cannot overwrite a newer document context', async () => {
  const { runContextBoundBframeLoad } = await importModule(
    'web-viewer/scripts/bframe-write-guard.js'
  );
  const loadGate = createDeferred();
  const oldContext = { fileId: 'old-file', documentGeneration: 1 };
  const newRoot = { videoFile: 'new.mp4' };
  let currentContext = oldContext;
  let stateRoot = null;
  const isCurrent = context => context.fileId === currentContext.fileId &&
    context.documentGeneration === currentContext.documentGeneration;

  const oldLoad = runContextBoundBframeLoad(oldContext, {
    isCurrent,
    load: async context => {
      assert.equal(context.fileId, 'old-file');
      await loadGate.promise;
      return { videoFile: 'old.mp4' };
    },
    commit: loadedRoot => {
      stateRoot = loadedRoot;
    }
  });

  await flushPromises();
  currentContext = { fileId: 'new-file', documentGeneration: 2 };
  stateRoot = newRoot;
  loadGate.resolve();

  await assert.rejects(oldLoad, /로드 대상 문서가 변경/);
  assert.strictEqual(stateRoot, newRoot);
});

test('both web-viewer save paths use the guarded serializer', () => {
  const appSource = fs.readFileSync(
    path.join(rootDir, 'web-viewer/scripts/app.js'),
    'utf8'
  ).replace(/\r\n/g, '\n');

  assert.match(
    appSource,
    /import \{[\s\S]*createTrailingSingleFlight,[\s\S]*prepareContextBoundDriveBframeForWrite,[\s\S]*reconcileDriveBframeAfterWrite,[\s\S]*runContextBoundBframeLoad,[\s\S]*runContextBoundDriveSave,[\s\S]*serializeBframeForWrite[\s\S]*\} from '\.\/bframe-write-guard\.js';/
  );
  assert.equal(
    (appSource.match(/serializeBframeForWrite\(state\.bframeData\)/g) || []).length,
    1
  );
  assert.doesNotMatch(appSource, /JSON\.stringify\(state\.bframeData/);

  const saveStart = appSource.indexOf('async function saveToDrive()');
  const saveEnd = appSource.indexOf('async function handleShare()', saveStart);
  const saveSource = appSource.slice(saveStart, saveEnd);
  assert.match(
    saveSource,
    /async function saveToDrive\(\) \{\s*return requestDriveSave\(captureDriveSaveContext\(\)\);\s*\}/
  );
  assert.match(
    saveSource,
    /function captureDriveSaveContext\(\) \{[\s\S]*fileId: state\.bframeFileId,[\s\S]*documentGeneration: state\.bframeDocumentGeneration,[\s\S]*root: state\.bframeData/
  );
  assert.match(saveSource, /runContextBoundDriveSave\(saveContext,/);
  assert.match(saveSource, /const latestResponse = await fetch\(/);
  assert.match(saveSource, /if \(!latestResponse\.ok\) \{[\s\S]*throw new Error/);
  assert.match(saveSource, /const latestRoot = await latestResponse\.json\(\);/);
  assert.match(saveSource, /prepareContextBoundDriveBframeForWrite\([\s\S]*latestRoot,[\s\S]*saveContext/);
  assert.match(
    saveSource,
    /currentIdentityPersisted: state\.bframeIdentityPersisted/
  );
  assert.match(
    saveSource,
    /if \(prepared\.identityPersisted\) \{\s*state\.bframeIdentityPersisted = true;\s*\}/
  );
  assert.ok(
    saveSource.indexOf('const latestResponse = await fetch(') <
      saveSource.indexOf("method: 'PATCH'"),
    'latest Drive root must be fetched before PATCH'
  );
  assert.match(
    saveSource,
    /reconcileDriveBframeAfterWrite\(prepared\.data, saveContext\.root\);/
  );
  assert.doesNotMatch(saveSource, /state\.bframeData = prepared\.data;/);
  assert.doesNotMatch(saveSource, /state\.bframeData = mergeDriveBframeAfterWrite/);
  assert.equal(
    (saveSource.match(/\$\{saveContext\.fileId\}/g) || []).length,
    2,
    'GET and PATCH must both use the request-time file ID'
  );
  assert.doesNotMatch(saveSource, /\$\{state\.bframeFileId\}/);
  assert.match(appSource, /bframeDocumentGeneration: 0/);
  assert.ok(
    (appSource.match(/beginBframeDocument\(/g) || []).length >= 4,
    'open, auto-open, demo, and back paths must invalidate the old save context'
  );

  const loadStart = appSource.indexOf('async function loadBframeFile(url)');
  const loadEnd = appSource.indexOf('async function loadVideo(url)', loadStart);
  const loadSource = appSource.slice(loadStart, loadEnd);
  assert.match(loadSource, /runContextBoundBframeLoad\(loadContext,/);
  assert.match(
    loadSource,
    /fileId:[\s\S]*documentGeneration: state\.bframeDocumentGeneration/
  );
  assert.doesNotMatch(loadSource, /state\.bframeData = await response\.json\(\)/);
});
