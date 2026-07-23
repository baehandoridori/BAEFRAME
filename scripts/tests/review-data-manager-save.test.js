const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {
  logPanel: null,
  electronAPI: {}
};

function createCommentManager() {
  const events = new EventTarget();
  const layer = {
    id: 'layer-1',
    name: '기본 댓글 레이어',
    markers: new Map()
  };

  return {
    layers: [layer],
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    toJSON() {
      return {
        layers: [{
          id: layer.id,
          name: layer.name,
          markers: Array.from(layer.markers.values())
        }]
      };
    },
    fromJSON() {}
  };
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function createReviewRoot(overrides = {}) {
  return {
    bframeVersion: '2.0',
    videoFile: 'existing.mp4',
    videoPath: 'C:/reviews/existing.mp4',
    fps: 24,
    createdAt: '2026-07-01T00:00:00.000Z',
    modifiedAt: '2026-07-01T00:00:00.000Z',
    comments: { layers: [] },
    drawings: { layers: [] },
    highlights: [],
    compositionLayers: [],
    ...overrides
  };
}

function addSubstantiveComment(manager, commentManager, id = 'marker-phase2a') {
  commentManager.layers[0].markers.set(id, {
    id,
    text: 'Phase 2A 저장 확인',
    frame: 12,
    replies: []
  });
  manager._onDataChanged(new Event('markerAdded'));
}

const REVIEW_ID_EXISTING = 'reviewdoc-11111111-1111-4111-8111-111111111111';
const REVIEW_ID_GENERATED = 'reviewdoc-22222222-2222-4222-8222-222222222222';
const REVIEW_ID_REMOTE = 'reviewdoc-33333333-3333-4333-8333-333333333333';
const REVIEW_ID_FUTURE = 'reviewdoc-44444444-4444-4444-8444-444444444444';
const FABRIC_CONTEXT = Object.freeze({
  fps: 24,
  totalFrames: 240,
  hostGeneration: 3,
  videoGeneration: 7,
  persistenceSessionId: 'review-save-session',
  stableVideoIdentity: 'C:/reviews/fabric.mp4'
});
const FABRIC_IDENTITY_TRANSFORM = Object.freeze({
  left: 0,
  top: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  skewX: 0,
  skewY: 0,
  flipX: false,
  flipY: false
});

function createFabricRecord(id, overrides = {}) {
  return {
    id,
    type: 'stroke',
    pathData: 'M 0 0 Q 5 10 10 10',
    sourcePoints: [
      { x: 0, y: 0, pressure: 0.25, time: 0, pointerType: 'pen' },
      { x: 10, y: 10, pressure: 0.75, time: 8, pointerType: 'pen' }
    ],
    strokeCaps: { start: true, end: true },
    style: { color: '#ff4757', size: 7.5, opacity: 0.65 },
    transform: { ...FABRIC_IDENTITY_TRANSFORM },
    ...overrides
  };
}

function createFabricRoot(overrides = {}) {
  return {
    storageSchema: 'baeframe-fabric-scenes',
    storageVersion: '1.0.0',
    engine: 'fabric-7',
    documentId: 'fabric-document-review-save',
    revision: 0,
    fps: FABRIC_CONTEXT.fps,
    totalFrames: FABRIC_CONTEXT.totalFrames,
    keyframes: [],
    ...overrides
  };
}

function createFabricTransition(sequence, record, index = 0) {
  return {
    hostGeneration: FABRIC_CONTEXT.hostGeneration,
    videoGeneration: FABRIC_CONTEXT.videoGeneration,
    persistenceSessionId: FABRIC_CONTEXT.persistenceSessionId,
    stableVideoIdentity: FABRIC_CONTEXT.stableVideoIdentity,
    scene: {
      sceneInstanceId: 'review-save-scene-12',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080
    },
    mutationSequence: sequence,
    origin: 'live',
    kind: 'add-objects',
    estimatedBytes: 512,
    unsupportedReason: null,
    removals: [],
    insertions: [{
      index,
      record,
      baseTransform: { ...record.transform }
    }],
    transforms: []
  };
}

async function createFabricStore() {
  const { createFabricDrawingPersistenceStore } = await import(
    '../../renderer/scripts/modules/fabric-drawing-persistence-store.js'
  );
  return createFabricDrawingPersistenceStore({
    createId: prefix => `${prefix}-review-save`
  });
}

function createDeferred() {
  let resolve;
  const promise = new Promise(resolver => {
    resolve = resolver;
  });
  return { promise, resolve };
}

test('new metadata-only review skips save while switching videos', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const saveCalls = [];
  let identityCalls = 0;
  window.electronAPI = {
    loadReview: async () => null,
    saveReview: async (...args) => {
      saveCalls.push(args);
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager: createCommentManager(),
    reviewDocumentIdFactory: () => {
      identityCalls += 1;
      return REVIEW_ID_GENERATED;
    }
  });
  manager.currentVideoPath = 'C:/reviews/first.mp4';
  manager.currentBframePath = 'C:/reviews/first.bframe';
  manager.setFps(30);

  assert.equal(manager.hasPersistedFile(), false);
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), false);

  await manager.setVideoFile('C:/reviews/second.mp4');

  assert.equal(saveCalls.length, 0);
  assert.equal(identityCalls, 0);
});

test('new metadata-only review skips scheduled automatic save', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => null,
    saveReview: async (...args) => {
      saveCalls.push(args);
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({
    autoSaveDelay: 5,
    commentManager: createCommentManager()
  });
  manager.currentVideoPath = 'C:/reviews/new.mp4';
  manager.currentBframePath = 'C:/reviews/new.bframe';
  manager.setVersionInfo({ fileName: 'new.mp4' });

  manager._scheduleAutoSave();
  await wait(30);

  assert.equal(manager.hasPersistedFile(), false);
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), false);
  assert.equal(saveCalls.length, 0);
});

test('first substantive comment makes a new review save once', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const saveCalls = [];
  const commentManager = createCommentManager();
  window.electronAPI = {
    saveReview: async (...args) => {
      saveCalls.push(args);
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  manager.currentVideoPath = 'C:/reviews/commented.mp4';
  manager.currentBframePath = 'C:/reviews/commented.bframe';
  commentManager.layers[0].markers.set('marker-1', {
    id: 'marker-1',
    text: '수정 부탁드립니다',
    frame: 12,
    replies: []
  });
  manager._onDataChanged(new Event('markerAdded'));

  assert.equal(manager.hasUnsavedChanges(), true);
  assert.equal(await manager.save(), true);

  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0][0], 'C:/reviews/commented.bframe');
  assert.equal(saveCalls[0][1].comments.layers[0].markers.length, 1);
  assert.deepEqual(saveCalls[0][2], { failIfExists: true });
  assert.equal(manager.hasPersistedFile(), true);
  assert.equal(manager.hasUnsavedChanges(), false);
});

test('new review with only a soft-deleted comment does not create a file', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  manager.currentVideoPath = 'C:/reviews/deleted-comment.mp4';
  manager.currentBframePath = 'C:/reviews/deleted-comment.bframe';
  commentManager.layers[0].markers.set('marker-deleted', {
    id: 'marker-deleted',
    text: '삭제된 댓글',
    frame: 4,
    deleted: true,
    deletedAt: new Date().toISOString(),
    replies: []
  });
  manager._onDataChanged(new Event('markerDeleted'));

  assert.equal(manager.hasSubstantiveContent(), false);
  assert.equal(manager.hasUnsavedChanges(), false);
});

test('persisted review keeps metadata-only dirty state as unsaved', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  window.electronAPI = {
    loadReview: async () => ({
      bframeVersion: '2.0',
      videoFile: 'existing.mp4',
      videoPath: 'C:/reviews/existing.mp4',
      fps: 24,
      comments: { layers: [] },
      drawings: { layers: [] },
      highlights: [],
      compositionLayers: []
    })
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager: createCommentManager()
  });

  assert.equal(await manager.setVideoFile('C:/reviews/existing.mp4'), true);
  manager.setFps(30);

  assert.equal(manager.hasPersistedFile(), true);
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), true);
});

test('remote drawing layer order event marks a persisted review as unsaved', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const drawingManager = new EventTarget();
  drawingManager.layers = [];
  const manager = new ReviewDataManager({ autoSave: false, drawingManager });
  manager.currentVideoPath = 'C:/reviews/existing.mp4';
  manager.currentBframePath = 'C:/reviews/existing.bframe';
  manager._hasPersistedFile = true;
  manager.connect();

  drawingManager.dispatchEvent(new Event('layerOrderChanged'));

  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), true);
  manager.disconnect();
});

test('remote empty layer restore marks a persisted review as unsaved', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const drawingManager = new EventTarget();
  drawingManager.layers = [];
  const manager = new ReviewDataManager({ autoSave: false, drawingManager });
  manager.currentVideoPath = 'C:/reviews/existing.mp4';
  manager.currentBframePath = 'C:/reviews/existing.bframe';
  manager._hasPersistedFile = true;
  manager.connect();

  drawingManager.dispatchEvent(new Event('layerRestored'));

  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), true);
  manager.disconnect();
});

test('persisted save preserves the latest opaque root fields and review identity', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const loadedRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: { schemaVersion: '3.0.0', nested: { vendor: ['original'] } },
    vendorEnvelope: { revision: 1 }
  });
  const latestRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: { schemaVersion: '3.0.0', nested: { vendor: ['latest'] } },
    vendorEnvelope: { revision: 2 },
    externallyAdded: { keep: true }
  });
  let loadCount = 0;
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => (loadCount++ === 0 ? loadedRoot : latestRoot),
    saveReview: async (...args) => {
      saveCalls.push(args);
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  assert.equal(await manager.setVideoFile('C:/reviews/existing.mp4'), true);
  addSubstantiveComment(manager, commentManager);

  assert.equal(await manager.save(), true);
  const savedRoot = saveCalls[0][1];
  assert.equal(savedRoot.reviewDocumentId, REVIEW_ID_EXISTING);
  assert.deepEqual(savedRoot.drawingsV3, latestRoot.drawingsV3);
  assert.deepEqual(savedRoot.vendorEnvelope, { revision: 2 });
  assert.deepEqual(savedRoot.externallyAdded, { keep: true });
});

test('persisted review identity mismatch blocks save instead of mixing two lineages', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const originalRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: { documentId: 'drawing-original' },
    vendorEnvelope: { lineage: 'original' }
  });
  const replacementRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_REMOTE,
    drawingsV3: { documentId: 'drawing-replacement' },
    vendorEnvelope: { lineage: 'replacement' }
  });
  let diskRoot = originalRoot;
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => diskRoot,
    saveReview: async (...args) => {
      saveCalls.push(args);
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  addSubstantiveComment(manager, commentManager);
  diskRoot = replacementRoot;

  assert.equal(await manager.save(), false);
  assert.equal(saveCalls.length, 0);
  assert.equal(manager.hasUnsavedChanges(), true);

  diskRoot = originalRoot;
  assert.equal(await manager.save(), true);
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0][1].reviewDocumentId, REVIEW_ID_EXISTING);
  assert.deepEqual(saveCalls[0][1].drawingsV3, originalRoot.drawingsV3);
});

test('persisted review identity disappearance blocks save until an explicit reload', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  let diskRoot = createReviewRoot({ reviewDocumentId: REVIEW_ID_EXISTING });
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => diskRoot,
    saveReview: async () => {
      saveCount += 1;
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  addSubstantiveComment(manager, commentManager);
  diskRoot = createReviewRoot();

  assert.equal(await manager.save(), false);
  assert.equal(saveCount, 0);
  assert.equal(manager.hasUnsavedChanges(), true);
});

test('latest disk root deletion is not undone from a stale opaque snapshot', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const loadedRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: { schemaVersion: '3.0.0', documentId: 'stale-drawing' },
    staleVendorField: { shouldDisappear: true }
  });
  const latestRoot = createReviewRoot({ reviewDocumentId: REVIEW_ID_EXISTING });
  let loadCount = 0;
  let savedRoot = null;
  window.electronAPI = {
    loadReview: async () => (loadCount++ === 0 ? loadedRoot : latestRoot),
    saveReview: async (_path, data) => {
      savedRoot = data;
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  addSubstantiveComment(manager, commentManager);

  assert.equal(await manager.save(), true);
  assert.equal(Object.hasOwn(savedRoot, 'drawingsV3'), false);
  assert.equal(Object.hasOwn(savedRoot, 'staleVendorField'), false);
});

test('missing review identity is generated once and reused after a failed save', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const diskRoot = createReviewRoot();
  const attemptedIds = [];
  let identityCalls = 0;
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => diskRoot,
    saveReview: async (_path, data) => {
      attemptedIds.push(data.reviewDocumentId);
      saveCount += 1;
      return saveCount === 1
        ? { success: false, error: 'injected failure' }
        : { success: true };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager,
    reviewDocumentIdFactory: () => {
      identityCalls += 1;
      return REVIEW_ID_GENERATED;
    }
  });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  addSubstantiveComment(manager, commentManager);

  assert.equal(await manager.save(), false);
  assert.equal(await manager.save(), true);
  assert.deepEqual(attemptedIds, [REVIEW_ID_GENERATED, REVIEW_ID_GENERATED]);
  assert.equal(identityCalls, 1);
});

test('missing review identity survives a realtime reload between a failed save and retry', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const diskRoot = createReviewRoot();
  const attemptedIds = [];
  const generatedIds = [REVIEW_ID_GENERATED, REVIEW_ID_REMOTE];
  let identityCalls = 0;
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => diskRoot,
    saveReview: async (_path, data) => {
      attemptedIds.push(data.reviewDocumentId);
      saveCount += 1;
      return saveCount === 1
        ? { success: false, error: 'injected failure' }
        : { success: true };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager,
    reviewDocumentIdFactory: () => generatedIds[identityCalls++]
  });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  addSubstantiveComment(manager, commentManager);

  assert.equal(await manager.save(), false);
  const reloadResult = await manager.reloadAndMerge({
    merge: true,
    force: true,
    preserveLocal: true
  });
  assert.equal(reloadResult.success, true);
  assert.equal(await manager.save(), true);
  assert.deepEqual(attemptedIds, [REVIEW_ID_GENERATED, REVIEW_ID_GENERATED]);
  assert.equal(identityCalls, 1);
});

test('persisted save stops when the latest disk root cannot be refreshed', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  let loadCount = 0;
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => (loadCount++ === 0
      ? createReviewRoot({ reviewDocumentId: REVIEW_ID_EXISTING, drawingsV3: { keep: true } })
      : null),
    saveReview: async () => {
      saveCount += 1;
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  addSubstantiveComment(manager, commentManager);

  assert.equal(await manager.save(), false);
  assert.equal(saveCount, 0);
  assert.equal(manager.hasUnsavedChanges(), true);
});

test('first-save conflict adopts the remote review identity and opaque root', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const remoteRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_REMOTE,
    drawingsV3: { schemaVersion: '3.0.0', documentId: 'remote-drawing' },
    remoteVendor: { keep: true }
  });
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => remoteRoot,
    saveReview: async (...args) => {
      saveCalls.push(args);
      return saveCalls.length === 1 ? { exists: true } : { success: true };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager,
    reviewDocumentIdFactory: () => REVIEW_ID_GENERATED
  });
  manager.currentVideoPath = 'C:/reviews/conflict.mp4';
  manager.currentBframePath = 'C:/reviews/conflict.bframe';
  addSubstantiveComment(manager, commentManager);
  manager.setInitialSaveConflictHandler(() => manager.reloadAndMerge({
    merge: true,
    force: true,
    preserveLocal: true
  }));

  assert.equal(await manager.save(), true);
  assert.equal(saveCalls.length, 2);
  assert.equal(saveCalls[1][1].reviewDocumentId, REVIEW_ID_REMOTE);
  assert.deepEqual(saveCalls[1][1].drawingsV3, remoteRoot.drawingsV3);
  assert.deepEqual(saveCalls[1][1].remoteVendor, { keep: true });
});

test('unsupported future bframe major stays read-only and is never downgraded', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const futureRoot = createReviewRoot({
    bframeVersion: '3.0',
    reviewDocumentId: REVIEW_ID_FUTURE,
    futureEnvelope: { mustRemainUntouched: true }
  });
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => futureRoot,
    copyFile: async () => {
      throw new Error('future major must not enter migration backup');
    },
    saveReview: async () => {
      saveCount += 1;
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  assert.equal(await manager.setVideoFile('C:/reviews/future.mp4'), true);
  addSubstantiveComment(manager, commentManager);

  assert.equal(await manager.save(), false);
  assert.equal(saveCount, 0);
  assert.equal(manager.hasUnsavedChanges(), true);
});

test('explicit but unparseable bframe versions stay read-only', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');

  for (const bframeVersion of [
    '',
    'v3.0',
    'legacy',
    '2.',
    '2.future',
    '2...',
    { major: 3 },
    null,
    0
  ]) {
    const commentManager = createCommentManager();
    const malformedRoot = createReviewRoot({
      bframeVersion,
      reviewDocumentId: REVIEW_ID_FUTURE
    });
    let saveCount = 0;
    window.electronAPI = {
      loadReview: async () => malformedRoot,
      saveReview: async () => {
        saveCount += 1;
        return { success: true };
      }
    };

    const manager = new ReviewDataManager({ autoSave: false, commentManager });
    assert.equal(await manager.setVideoFile('C:/reviews/malformed-version.mp4'), true);
    addSubstantiveComment(manager, commentManager, `marker-${String(bframeVersion)}`);

    assert.equal(await manager.save(), false, `version ${String(bframeVersion)} must be read-only`);
    assert.equal(saveCount, 0);
  }
});

test('invalid persisted review identity blocks saving instead of silently replacing it', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const invalidRoot = createReviewRoot({
    reviewDocumentId: '',
    drawingsV3: { preserve: 'without-rewrite' }
  });
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => invalidRoot,
    saveReview: async () => {
      saveCount += 1;
      return { success: true };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, commentManager });
  assert.equal(await manager.setVideoFile('C:/reviews/invalid-id.mp4'), true);
  addSubstantiveComment(manager, commentManager);

  assert.equal(await manager.save(), false);
  assert.equal(saveCount, 0);
  assert.equal(manager.hasUnsavedChanges(), true);
});

test('valid drawingsV3 loads into the shared provider while legacy drawings stay unchanged', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const legacyDrawings = {
    layers: [{ id: 'legacy-layer', keyframes: [{ frame: 8, canvasData: 'legacy-png' }] }]
  };
  const fabricRoot = createFabricRoot({
    revision: 4,
    keyframes: [{
      id: 'fabric-keyframe-12',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('fabric-loaded')]
    }]
  });
  let importedLegacy = null;
  const drawingManager = {
    layers: [],
    importData(value) {
      importedLegacy = structuredClone(value);
    },
    exportData() {
      return structuredClone(legacyDrawings);
    }
  };
  window.electronAPI = {
    loadReview: async () => createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      drawings: legacyDrawings,
      drawingsV3: fabricRoot
    })
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    drawingManager,
    fabricDrawingPersistenceProvider: fabricStore
  });
  assert.equal(await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  }), true);

  assert.deepEqual(importedLegacy, legacyDrawings);
  assert.deepEqual(fabricStore.exportRootValue(), fabricRoot);
  assert.deepEqual(manager._collectData().drawings, legacyDrawings);
  assert.deepEqual(manager._collectData().drawingsV3, fabricRoot);
});

test('new review resets the shared provider and a first Fabric-only stroke creates a bframe', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => null,
    saveReview: async (...args) => {
      saveCalls.push(args);
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore,
    reviewDocumentIdFactory: () => REVIEW_ID_GENERATED
  });
  manager.connect();

  assert.equal(await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  }), false);
  const record = createFabricRecord('fabric-first-stroke');
  assert.equal(fabricStore.applyTransition(
    createFabricTransition(1, record)
  ).applied, true);

  assert.equal(manager.hasSubstantiveContent(), true);
  assert.equal(manager.hasUnsavedChanges(), true);
  assert.equal(await manager.save(), true);
  assert.equal(saveCalls.length, 1);
  assert.deepEqual(saveCalls[0][2], { failIfExists: true });
  assert.equal(saveCalls[0][1].drawingsV3.keyframes[0].objects[0].id, record.id);
  assert.deepEqual(saveCalls[0][1].drawings, { layers: [] });
  manager.disconnect();
});

test('provider changes use the normal autosave path and disconnect removes the subscription', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => null,
    saveReview: async (...args) => {
      saveCalls.push(args);
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({
    autoSaveDelay: 5,
    fabricDrawingPersistenceProvider: fabricStore,
    reviewDocumentIdFactory: () => REVIEW_ID_GENERATED
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });

  const first = createFabricRecord('fabric-auto-save');
  assert.equal(fabricStore.applyTransition(
    createFabricTransition(1, first)
  ).applied, true);
  await wait(40);

  assert.equal(saveCalls.length, 1);
  assert.equal(manager.isDirty, false);
  manager.disconnect();
  manager.isDirty = false;
  const second = createFabricRecord('fabric-after-disconnect');
  assert.equal(fabricStore.applyTransition(
    createFabricTransition(2, second, 1)
  ).applied, true);
  await wait(20);
  assert.equal(manager.isDirty, false);
  assert.equal(saveCalls.length, 1);
});

test('latest opaque drawingsV3 is preserved until a real local Fabric change replaces it', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const loadedFabric = createFabricRoot();
  const remoteFabric = createFabricRoot({
    documentId: 'fabric-document-remote',
    revision: 8,
    keyframes: [{
      id: 'remote-keyframe',
      frame: 20,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('remote-stroke')]
    }]
  });
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: loadedFabric
  });
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => diskRoot,
    saveReview: async (_path, data) => {
      saveCalls.push(structuredClone(data));
      diskRoot = structuredClone(data);
      return { success: true };
    }
  };
  const commentManager = createCommentManager();
  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });

  diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: remoteFabric
  });
  addSubstantiveComment(manager, commentManager, 'comment-only-save');
  assert.equal(await manager.save(), true);
  assert.deepEqual(saveCalls[0].drawingsV3, remoteFabric);

  const local = createFabricRecord('local-after-remote');
  assert.equal(fabricStore.applyTransition(
    createFabricTransition(1, local)
  ).applied, true);
  assert.equal(await manager.save(), true);
  assert.equal(saveCalls[1].drawingsV3.documentId, loadedFabric.documentId);
  assert.equal(saveCalls[1].drawingsV3.keyframes[0].objects[0].id, local.id);
  manager.disconnect();
});

test('future or malformed drawingsV3 stays byte-equivalent through unrelated saves', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');

  for (const [label, opaqueDrawing] of [
    ['future', {
      storageSchema: 'baeframe-fabric-scenes',
      storageVersion: '9.0.0',
      engine: 'future-fabric',
      nested: { bytes: [0, 1, 2, 255], keep: true }
    }],
    ['malformed', {
      storageSchema: 'baeframe-fabric-scenes',
      storageVersion: '1.0.0',
      engine: 'fabric-7',
      documentId: null,
      nested: { malformed: ['must', 'stay', 'opaque'] }
    }]
  ]) {
    const fabricStore = await createFabricStore();
    const commentManager = createCommentManager();
    let savedRoot = null;
    const diskRoot = createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      drawingsV3: opaqueDrawing
    });
    window.electronAPI = {
      loadReview: async () => diskRoot,
      saveReview: async (_path, data) => {
        savedRoot = structuredClone(data);
        return { success: true };
      }
    };
    const manager = new ReviewDataManager({
      autoSave: false,
      commentManager,
      fabricDrawingPersistenceProvider: fabricStore
    });
    manager.connect();
    await manager.setVideoFile(`C:/reviews/${label}.mp4`, {
      fabricDrawingPersistenceContext: {
        ...FABRIC_CONTEXT,
        stableVideoIdentity: `C:/reviews/${label}.mp4`
      }
    });
    addSubstantiveComment(manager, commentManager, `comment-${label}`);

    assert.equal(await manager.save(), true);
    assert.deepEqual(savedRoot.drawingsV3, opaqueDrawing);
    assert.equal(fabricStore.getStatus().compatible, false);
    manager.disconnect();
  }
});

test('before-save hook can update the provider before data collection', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  let savedRoot = null;
  window.electronAPI = {
    loadReview: async () => null,
    saveReview: async (_path, data) => {
      savedRoot = structuredClone(data);
      return { success: true };
    }
  };
  const commentManager = createCommentManager();
  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager,
    fabricDrawingPersistenceProvider: fabricStore,
    reviewDocumentIdFactory: () => REVIEW_ID_GENERATED
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  addSubstantiveComment(manager, commentManager, 'save-hook-comment');
  const pulled = createFabricRecord('pulled-before-collect');
  manager.setBeforeSaveHandler(async () => {
    fabricStore.applyTransition(createFabricTransition(1, pulled));
  });

  assert.equal(await manager.save(), true);
  assert.equal(savedRoot.drawingsV3.keyframes[0].objects[0].id, pulled.id);
  manager.disconnect();
});

test('successful save with a concurrent manager change schedules exactly one trailing autosave', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const saveStarted = createDeferred();
  const releaseFirstSave = createDeferred();
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING
    }),
    saveReview: async (_path, data) => {
      saveCalls.push(structuredClone(data));
      if (saveCalls.length === 1) {
        saveStarted.resolve();
        return releaseFirstSave.promise;
      }
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({
    autoSaveDelay: 5,
    commentManager
  });
  await manager.setVideoFile('C:/reviews/concurrent.mp4');
  addSubstantiveComment(manager, commentManager, 'concurrent-comment');
  manager.setVersionInfo({ fileName: 'before-save.mp4' });

  const firstSave = manager.save();
  await saveStarted.promise;
  manager.setVersionInfo({ fileName: 'during-save.mp4' });
  releaseFirstSave.resolve({ success: true });

  assert.equal(await firstSave, true);
  assert.equal(manager.isDirty, true);
  await wait(50);
  assert.equal(saveCalls.length, 2);
  assert.deepEqual(saveCalls[0].versionInfo, { fileName: 'before-save.mp4' });
  assert.deepEqual(saveCalls[1].versionInfo, { fileName: 'during-save.mp4' });
  assert.equal(manager.isDirty, false);
  await wait(30);
  assert.equal(saveCalls.length, 2);
});

test('failed save with a concurrent provider mutation stays dirty without automatic retry', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const saveStarted = createDeferred();
  const releaseSave = createDeferred();
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      drawingsV3: createFabricRoot()
    }),
    saveReview: async () => {
      saveCount += 1;
      saveStarted.resolve();
      return releaseSave.promise;
    }
  };
  const manager = new ReviewDataManager({
    autoSaveDelay: 5,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  const first = createFabricRecord('failure-before-save');
  fabricStore.applyTransition(createFabricTransition(1, first));

  const saveResult = manager.save();
  await saveStarted.promise;
  const second = createFabricRecord('failure-during-save');
  fabricStore.applyTransition(createFabricTransition(2, second, 1));
  releaseSave.resolve({ success: false, error: 'injected Fabric save failure' });

  assert.equal(await saveResult, false);
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), true);
  await wait(50);
  assert.equal(saveCount, 1);
  manager.disconnect();
});

test('provider change inside a failing before-save hook never arms an automatic retry', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const commentManager = createCommentManager();
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      drawingsV3: createFabricRoot()
    }),
    saveReview: async () => {
      saveCount += 1;
      return { success: false, error: 'injected before-save failure' };
    }
  };
  const manager = new ReviewDataManager({
    autoSaveDelay: 5,
    commentManager,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  addSubstantiveComment(manager, commentManager, 'before-save-failure-comment');
  const pulled = createFabricRecord('failure-inside-before-save');
  manager.setBeforeSaveHandler(async () => {
    fabricStore.applyTransition(createFabricTransition(1, pulled));
  });

  assert.equal(await manager.save(), false);
  assert.equal(manager.isDirty, true);
  await wait(50);
  assert.equal(saveCount, 1);
  manager.disconnect();
});
