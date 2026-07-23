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

function createMutableReviewManagers() {
  let comments = { layers: [] };
  let drawings = { layers: [] };
  let highlights = { highlights: [] };
  let compositionLayers = [];

  return {
    commentManager: {
      get layers() {
        return comments.layers || [];
      },
      toJSON: () => structuredClone(comments),
      fromJSON(data) {
        comments = structuredClone(data || { layers: [] });
      }
    },
    drawingManager: {
      exportData: () => structuredClone(drawings),
      importData(data) {
        drawings = structuredClone(data || { layers: [] });
      }
    },
    highlightManager: {
      get highlights() {
        return highlights.highlights || [];
      },
      toJSON: () => structuredClone(highlights),
      fromJSON(data) {
        highlights = structuredClone(data || { highlights: [] });
      }
    },
    compositionLayerManager: {
      get layers() {
        return compositionLayers;
      },
      toJSON: () => structuredClone(compositionLayers),
      fromJSON(data) {
        compositionLayers = structuredClone(data || []);
      }
    }
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

test('reload waits for Fabric source refresh and rechecks local dirty before external import', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const initialFabric = createFabricRoot();
  const externalFabric = createFabricRoot({
    documentId: 'fabric-document-reload-during-active-input',
    revision: 8,
    keyframes: [{
      id: 'external-reload-frame',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('external-reload-stroke')]
    }]
  });
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: initialFabric
  });
  window.electronAPI = {
    loadReview: async () => structuredClone(diskRoot)
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: externalFabric
  });

  const refreshEntered = createDeferred();
  const releaseOldSnapshotPull = createDeferred();
  const order = [];
  manager.setFabricDrawingSourceRefreshHandler(async ({ installSource }) => {
    order.push('input-off');
    refreshEntered.resolve();
    await releaseOldSnapshotPull.promise;
    const local = createFabricRecord('committed-before-reload-refresh');
    assert.equal(
      fabricStore.applyTransition(createFabricTransition(1, local)).applied,
      true
    );
    order.push('old-full-pull');
    const result = await installSource();
    order.push('install-checked');
    return result;
  });

  const reloading = manager.reloadAndMerge({ merge: true, force: true });
  await refreshEntered.promise;
  assert.deepEqual(
    fabricStore.exportRootValue(),
    initialFabric,
    'external drawingsV3 must not be imported before input-off and the old pull finish'
  );
  releaseOldSnapshotPull.resolve();
  const result = await reloading;

  assert.equal(result.success, false);
  assert.equal(manager._writeBlockedReason, 'fabric-drawing-conflict');
  assert.equal(manager.isDirty, true);
  assert.deepEqual(order, ['input-off', 'old-full-pull', 'install-checked']);
  assert.deepEqual(
    fabricStore.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['committed-before-reload-refresh']
  );
  manager.disconnect();
});

test('save preflight waits for Fabric source refresh and rechecks local dirty before write', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const commentManager = createCommentManager();
  const initialFabric = createFabricRoot();
  const externalFabric = createFabricRoot({
    documentId: 'fabric-document-save-preflight-active-input',
    revision: 9,
    keyframes: [{
      id: 'external-save-frame',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('external-save-stroke')]
    }]
  });
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: initialFabric
  });
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => structuredClone(diskRoot),
    saveReview: async () => {
      saveCount += 1;
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  addSubstantiveComment(manager, commentManager, 'save-preflight-refresh');
  diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: externalFabric
  });

  const refreshEntered = createDeferred();
  const releaseOldSnapshotPull = createDeferred();
  manager.setFabricDrawingSourceRefreshHandler(async ({ installSource }) => {
    refreshEntered.resolve();
    await releaseOldSnapshotPull.promise;
    const local = createFabricRecord('committed-before-save-refresh');
    assert.equal(
      fabricStore.applyTransition(createFabricTransition(1, local)).applied,
      true
    );
    return installSource();
  });

  const saving = manager.save();
  await refreshEntered.promise;
  assert.equal(saveCount, 0);
  assert.deepEqual(fabricStore.exportRootValue(), initialFabric);
  releaseOldSnapshotPull.resolve();
  assert.equal(await saving, false);

  assert.equal(saveCount, 0);
  assert.equal(manager._writeBlockedReason, 'fabric-drawing-conflict');
  assert.equal(manager.isDirty, true);
  assert.deepEqual(
    fabricStore.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['committed-before-save-refresh']
  );
  manager.disconnect();
});

test('merge false reload still routes Fabric replacement through the awaited source refresh transaction', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const initialFabric = createFabricRoot();
  const externalFabric = createFabricRoot({
    documentId: 'fabric-document-replace-refresh',
    revision: 11,
    keyframes: [{
      id: 'replace-refresh-frame',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('replace-refresh-stroke')]
    }]
  });
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: initialFabric
  });
  window.electronAPI = {
    loadReview: async () => structuredClone(diskRoot)
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_REMOTE,
    drawingsV3: externalFabric
  });

  const order = [];
  manager.setFabricDrawingSourceRefreshHandler(async ({ installSource }) => {
    order.push('refresh-start');
    const result = await installSource();
    order.push('refresh-finished');
    return result;
  });

  const result = await manager.reloadAndMerge({ merge: false, force: true });
  assert.equal(result.success, true);
  assert.deepEqual(order, ['refresh-start', 'refresh-finished']);
  assert.deepEqual(fabricStore.exportRootValue(), externalFabric);
  manager.disconnect();
});

test('overlapping video loads never let video A install into video B regardless of completion order', async t => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const videoA = 'C:/reviews/load-owner-a.mp4';
  const videoB = 'C:/reviews/load-owner-b.mp4';
  const pathA = 'C:/reviews/load-owner-a.bframe';
  const pathB = 'C:/reviews/load-owner-b.bframe';
  const fabricA = createFabricRoot({
    documentId: 'fabric-document-load-owner-a',
    keyframes: [{
      id: 'load-owner-a-frame',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('load-owner-a-stroke')]
    }]
  });
  const fabricB = createFabricRoot({
    documentId: 'fabric-document-load-owner-b',
    keyframes: [{
      id: 'load-owner-b-frame',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('load-owner-b-stroke')]
    }]
  });
  const reviewA = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    videoFile: 'load-owner-a.mp4',
    videoPath: videoA,
    drawingsV3: fabricA
  });
  const reviewB = createReviewRoot({
    reviewDocumentId: REVIEW_ID_REMOTE,
    videoFile: 'load-owner-b.mp4',
    videoPath: videoB,
    drawingsV3: fabricB
  });
  const contextFor = stableVideoIdentity => ({
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity
  });

  for (const completionOrder of ['b-first', 'a-first']) {
    await t.test(completionOrder, async () => {
      const fabricStore = await createFabricStore();
      const loadA = createDeferred();
      const loadB = createDeferred();
      const loadAStarted = createDeferred();
      const loadBStarted = createDeferred();
      window.electronAPI = {
        loadReview: async filePath => {
          if (filePath === pathA) {
            loadAStarted.resolve();
            return loadA.promise;
          }
          if (filePath === pathB) {
            loadBStarted.resolve();
            return loadB.promise;
          }
          return null;
        }
      };
      const manager = new ReviewDataManager({
        autoSave: false,
        fabricDrawingPersistenceProvider: fabricStore
      });
      manager.connect();

      const openingA = manager.setVideoFile(videoA, {
        skipSave: true,
        fabricDrawingPersistenceContext: contextFor(videoA)
      });
      await loadAStarted.promise;
      const openingB = manager.setVideoFile(videoB, {
        skipSave: true,
        fabricDrawingPersistenceContext: contextFor(videoB)
      });
      await loadBStarted.promise;

      if (completionOrder === 'b-first') {
        loadB.resolve(structuredClone(reviewB));
        assert.equal(await openingB, true);
        loadA.resolve(structuredClone(reviewA));
        assert.equal(await openingA, false);
      } else {
        loadA.resolve(structuredClone(reviewA));
        assert.equal(await openingA, false);
        assert.equal(
          fabricStore.getStatus().state,
          'unavailable',
          'stale A must not make the B provider ready while B is still loading'
        );
        loadB.resolve(structuredClone(reviewB));
        assert.equal(await openingB, true);
      }

      assert.equal(manager.currentVideoPath, videoB);
      assert.equal(manager.currentBframePath, pathB);
      assert.equal(manager._reviewDocumentId, REVIEW_ID_REMOTE);
      assert.equal(manager._writeBlockedReason, null);
      assert.deepEqual(
        fabricStore.exportRootValue().keyframes[0].objects.map(object => object.id),
        ['load-owner-b-stroke']
      );
      manager.disconnect();
    });
  }
});

test('stale reload source refresh cannot contaminate video B after a video switch', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const videoA = 'C:/reviews/reload-owner-a.mp4';
  const videoB = 'C:/reviews/reload-owner-b.mp4';
  const pathA = 'C:/reviews/reload-owner-a.bframe';
  const pathB = 'C:/reviews/reload-owner-b.bframe';
  const initialFabricA = createFabricRoot({
    documentId: 'fabric-document-reload-owner-a'
  });
  const externalFabricA = createFabricRoot({
    documentId: 'fabric-document-reload-owner-a-external',
    revision: 8,
    keyframes: [{
      id: 'reload-owner-a-external-frame',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('reload-owner-a-external-stroke')]
    }]
  });
  const fabricB = createFabricRoot({
    documentId: 'fabric-document-reload-owner-b',
    revision: 3,
    keyframes: [{
      id: 'reload-owner-b-frame',
      frame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('reload-owner-b-stroke')]
    }]
  });
  const roots = new Map([
    [pathA, createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      videoFile: 'reload-owner-a.mp4',
      videoPath: videoA,
      drawingsV3: initialFabricA
    })],
    [pathB, createReviewRoot({
      reviewDocumentId: REVIEW_ID_REMOTE,
      videoFile: 'reload-owner-b.mp4',
      videoPath: videoB,
      drawingsV3: fabricB
    })]
  ]);
  window.electronAPI = {
    loadReview: async path => structuredClone(roots.get(path) || null)
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  assert.equal(await manager.setVideoFile(videoA, {
    fabricDrawingPersistenceContext: {
      ...FABRIC_CONTEXT,
      stableVideoIdentity: videoA
    }
  }), true);

  roots.set(pathA, createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    videoFile: 'reload-owner-a.mp4',
    videoPath: videoA,
    drawingsV3: externalFabricA
  }));
  const refreshEntered = createDeferred();
  const releaseRefresh = createDeferred();
  manager.setFabricDrawingSourceRefreshHandler(async ({ installSource, path }) => {
    if (path === pathA) {
      refreshEntered.resolve();
      await releaseRefresh.promise;
    }
    return installSource();
  });

  const reloadingA = manager.reloadAndMerge({ merge: true, force: true });
  await refreshEntered.promise;
  assert.equal(await manager.setVideoFile(videoB, {
    skipSave: true,
    fabricDrawingPersistenceContext: {
      ...FABRIC_CONTEXT,
      stableVideoIdentity: videoB
    }
  }), true);
  assert.equal(manager.currentVideoPath, videoB);
  assert.equal(manager._reviewDocumentId, REVIEW_ID_REMOTE);
  assert.deepEqual(fabricStore.exportRootValue(), fabricB);

  releaseRefresh.resolve();
  const staleResult = await reloadingA;

  assert.equal(staleResult.success, false);
  assert.equal(staleResult.skipped, true);
  assert.equal(manager.currentVideoPath, videoB);
  assert.equal(manager.currentBframePath, pathB);
  assert.equal(manager._reviewDocumentId, REVIEW_ID_REMOTE);
  assert.equal(manager._writeBlockedReason, null);
  assert.deepEqual(fabricStore.exportRootValue(), fabricB);
  manager.disconnect();
});

test('a pending save source refresh remains owned by video A until video B can install', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const commentManager = createCommentManager();
  const videoA = 'C:/reviews/save-refresh-owner-a.mp4';
  const videoB = 'C:/reviews/save-refresh-owner-b.mp4';
  const pathA = 'C:/reviews/save-refresh-owner-a.bframe';
  const pathB = 'C:/reviews/save-refresh-owner-b.bframe';
  const initialFabricA = createFabricRoot({
    documentId: 'fabric-document-save-refresh-owner-a'
  });
  const externalFabricA = createFabricRoot({
    documentId: 'fabric-document-save-refresh-owner-a-external',
    revision: 9,
    keyframes: [{
      id: 'save-refresh-owner-a-external-frame',
      frame: 36,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('save-refresh-owner-a-external-stroke')]
    }]
  });
  const fabricB = createFabricRoot({
    documentId: 'fabric-document-save-refresh-owner-b',
    revision: 4,
    keyframes: [{
      id: 'save-refresh-owner-b-frame',
      frame: 48,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('save-refresh-owner-b-stroke')]
    }]
  });
  const roots = new Map([
    [pathA, createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      videoFile: 'save-refresh-owner-a.mp4',
      videoPath: videoA,
      drawingsV3: initialFabricA
    })],
    [pathB, createReviewRoot({
      reviewDocumentId: REVIEW_ID_REMOTE,
      videoFile: 'save-refresh-owner-b.mp4',
      videoPath: videoB,
      drawingsV3: fabricB
    })]
  ]);
  const writes = [];
  window.electronAPI = {
    loadReview: async path => structuredClone(roots.get(path) || null),
    saveReview: async (path, data, options) => {
      writes.push({
        path,
        data: structuredClone(data),
        options: structuredClone(options)
      });
      roots.set(path, structuredClone(data));
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  assert.equal(await manager.setVideoFile(videoA, {
    fabricDrawingPersistenceContext: {
      ...FABRIC_CONTEXT,
      stableVideoIdentity: videoA
    }
  }), true);
  addSubstantiveComment(manager, commentManager, 'save-refresh-owner-a-comment');

  roots.set(pathA, createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    videoFile: 'save-refresh-owner-a.mp4',
    videoPath: videoA,
    drawingsV3: externalFabricA
  }));
  const refreshEntered = createDeferred();
  const releaseRefresh = createDeferred();
  manager.setFabricDrawingSourceRefreshHandler(async ({ installSource, path }) => {
    if (path === pathA) {
      refreshEntered.resolve();
      await releaseRefresh.promise;
    }
    return installSource();
  });

  const savingA = manager.save();
  await refreshEntered.promise;
  let switchSettled = false;
  const switchingToB = manager.setVideoFile(videoB, {
    skipSave: true,
    fabricDrawingPersistenceContext: {
      ...FABRIC_CONTEXT,
      stableVideoIdentity: videoB
    }
  }).finally(() => {
    switchSettled = true;
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(switchSettled, false);
  assert.equal(manager.currentVideoPath, videoA);
  assert.equal(writes.length, 0);

  releaseRefresh.resolve();
  assert.equal(await savingA, true);
  assert.equal(await switchingToB, true);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, pathA);
  assert.equal(writes[0].data.videoPath, videoA);
  assert.deepEqual(writes[0].data.drawingsV3, externalFabricA);
  assert.equal(manager.currentVideoPath, videoB);
  assert.equal(manager.currentBframePath, pathB);
  assert.equal(manager._reviewDocumentId, REVIEW_ID_REMOTE);
  assert.equal(manager._writeBlockedReason, null);
  assert.deepEqual(fabricStore.exportRootValue(), fabricB);
  manager.disconnect();
});

test('an in-flight save stays owned by video A until completion before setVideoFile can install video B', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const pathA = 'C:/reviews/save-owner-a.bframe';
  const pathB = 'C:/reviews/save-owner-b.bframe';
  const videoA = 'C:/reviews/save-owner-a.mp4';
  const videoB = 'C:/reviews/save-owner-b.mp4';
  const fabricA = createFabricRoot({
    documentId: 'fabric-document-save-owner-a'
  });
  const fabricB = createFabricRoot({
    documentId: 'fabric-document-save-owner-b'
  });
  const roots = new Map([
    [pathA, createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      videoFile: 'save-owner-a.mp4',
      videoPath: videoA,
      drawingsV3: fabricA
    })],
    [pathB, createReviewRoot({
      reviewDocumentId: REVIEW_ID_REMOTE,
      videoFile: 'save-owner-b.mp4',
      videoPath: videoB,
      drawingsV3: fabricB
    })]
  ]);
  const writeStarted = createDeferred();
  const releaseWrite = createDeferred();
  const writes = [];
  window.electronAPI = {
    loadReview: async path => structuredClone(roots.get(path) || null),
    saveReview: async (path, data, options) => {
      writes.push({
        path,
        data: structuredClone(data),
        options: structuredClone(options)
      });
      if (path === pathA && writes.filter(write => write.path === pathA).length === 1) {
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      roots.set(path, structuredClone(data));
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile(videoA, {
    fabricDrawingPersistenceContext: {
      ...FABRIC_CONTEXT,
      stableVideoIdentity: videoA
    }
  });

  const savingA = manager.save();
  await writeStarted.promise;
  const switchingToB = manager.setVideoFile(videoB, {
    skipSave: true,
    fabricDrawingPersistenceContext: {
      ...FABRIC_CONTEXT,
      stableVideoIdentity: videoB
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  const ownerWhileAWritePending = {
    videoPath: manager.currentVideoPath,
    bframePath: manager.currentBframePath
  };

  releaseWrite.resolve();
  assert.equal(await savingA, true);
  assert.equal(await switchingToB, true);
  assert.deepEqual(ownerWhileAWritePending, {
    videoPath: videoA,
    bframePath: pathA
  });
  assert.equal(writes[0].path, pathA);
  assert.equal(writes[0].data.videoPath, videoA);
  assert.equal(manager.currentVideoPath, videoB);
  assert.equal(manager.currentBframePath, pathB);

  const localB = createFabricRecord('save-owner-b-local-stroke');
  assert.equal(fabricStore.applyTransition({
    ...createFabricTransition(1, localB),
    stableVideoIdentity: videoB
  }).applied, true);
  assert.equal(await manager.save(), true);
  assert.equal(writes.at(-1).path, pathB);
  assert.equal(
    writes.at(-1).data.drawingsV3.keyframes[0].objects[0].id,
    localB.id
  );
  manager.disconnect();
});

test('stale version-token conflict never acknowledges or cleans a Fabric save', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const initialFabric = createFabricRoot();
  const externalFabric = createFabricRoot({
    documentId: 'fabric-document-version-token-external',
    revision: 5,
    keyframes: [{
      id: 'version-token-external-frame',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('version-token-external-stroke')]
    }]
  });
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: initialFabric
  });
  const snapshotCalls = [];
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => structuredClone(diskRoot),
    loadReviewSnapshot: async path => {
      snapshotCalls.push(path);
      return {
        data: structuredClone(diskRoot),
        versionToken: 'sha256-initial-root'
      };
    },
    saveReview: async (path, data, options) => {
      saveCalls.push({
        path,
        data: structuredClone(data),
        options: structuredClone(options)
      });
      diskRoot = createReviewRoot({
        reviewDocumentId: REVIEW_ID_EXISTING,
        drawingsV3: externalFabric
      });
      return {
        success: false,
        conflict: true,
        reason: 'stale-version-token'
      };
    }
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  const local = createFabricRecord('version-token-local-stroke');
  assert.equal(
    fabricStore.applyTransition(createFabricTransition(1, local)).applied,
    true
  );
  const localRevision = fabricStore.getRevision();

  assert.equal(await manager.save(), false);
  assert.deepEqual(snapshotCalls, ['C:/reviews/fabric.bframe']);
  assert.equal(saveCalls.length, 1);
  assert.equal(
    saveCalls[0].options.expectedVersionToken,
    'sha256-initial-root'
  );
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), true);
  assert.equal(fabricStore.getRevision(), localRevision);
  assert.equal(
    fabricStore.exportRootValue().keyframes[0].objects[0].id,
    local.id
  );
  assert.deepEqual(diskRoot.drawingsV3, externalFabric);
  manager.disconnect();
});

test('retryable review lock contention keeps changes dirty without a save error alert', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING
  });
  window.electronAPI = {
    loadReview: async () => structuredClone(diskRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'a'.repeat(64)
    }),
    saveReview: async () => ({
      success: false,
      retryable: true,
      reason: 'lock-timeout'
    })
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/retryable-lock.mp4');
  addSubstantiveComment(manager, commentManager, 'retryable-lock-comment');
  let deferredEvents = 0;
  let saveErrorEvents = 0;
  manager.addEventListener('saveDeferred', () => {
    deferredEvents += 1;
  });
  manager.addEventListener('saveError', () => {
    saveErrorEvents += 1;
  });

  assert.equal(await manager.save(), false);
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), true);
  assert.equal(manager._writeBlockedReason, null);
  assert.equal(deferredEvents, 1);
  assert.equal(saveErrorEvents, 0);
  manager.disconnect();
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

test('persisted save merges latest external review data with local unsaved changes', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  const drawingManager = {
    exportData: () => ({
      layers: [{
        id: 'local-drawing-layer',
        name: '로컬 드로잉',
        keyframes: [{ id: 'local-keyframe', isEmpty: false }]
      }]
    }),
    importData() {}
  };
  const highlightManager = {
    toJSON: () => ({
      highlights: [{ id: 'local-highlight', startTime: 1, endTime: 2 }]
    }),
    fromJSON() {}
  };
  const compositionLayerManager = {
    toJSON: () => [{
      id: 'local-composition',
      name: '로컬 합성',
      order: 0
    }],
    fromJSON() {}
  };
  const initialRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING
  });
  const latestRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'layer-1',
        name: '기본 댓글 레이어',
        markers: [{
          id: 'remote-comment',
          text: '다른 인스턴스 댓글',
          frame: 24,
          createdAt: '2026-07-23T00:00:00.000Z',
          replies: []
        }]
      }]
    },
    drawings: {
      layers: [{
        id: 'remote-drawing-layer',
        name: '원격 드로잉',
        keyframes: [{ id: 'remote-keyframe', isEmpty: false }]
      }]
    },
    highlights: {
      highlights: [{ id: 'remote-highlight', startTime: 3, endTime: 4 }]
    },
    compositionLayers: [{
      id: 'remote-composition',
      name: '원격 합성',
      order: 0
    }],
    manualVersions: [{
      filePath: 'C:/reviews/remote-version.mp4',
      fileName: 'remote-version.mp4'
    }]
  });
  let savedRoot = null;
  let savedOptions = null;
  window.electronAPI = {
    loadReview: async () => structuredClone(initialRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(latestRoot),
      versionToken: 'latest-review-token'
    }),
    saveReview: async (_path, data, options) => {
      savedRoot = structuredClone(data);
      savedOptions = structuredClone(options);
      return {
        success: true,
        versionToken: 'saved-review-token'
      };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager,
    drawingManager,
    highlightManager,
    compositionLayerManager
  });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  addSubstantiveComment(manager, commentManager, 'local-comment');
  manager.addManualVersion({
    filePath: 'C:/reviews/local-version.mp4',
    fileName: 'local-version.mp4'
  });

  assert.equal(await manager.save(), true);
  assert.equal(savedOptions.expectedVersionToken, 'latest-review-token');
  assert.deepEqual(
    savedRoot.comments.layers[0].markers.map(marker => marker.id).sort(),
    ['local-comment', 'remote-comment']
  );
  assert.deepEqual(
    savedRoot.drawings.layers.map(layer => layer.id).sort(),
    ['local-drawing-layer', 'remote-drawing-layer']
  );
  assert.deepEqual(
    savedRoot.highlights.highlights.map(highlight => highlight.id).sort(),
    ['local-highlight', 'remote-highlight']
  );
  assert.deepEqual(
    savedRoot.compositionLayers.map(layer => layer.id).sort(),
    ['local-composition', 'remote-composition']
  );
  assert.deepEqual(
    savedRoot.manualVersions.map(version => version.fileName).sort(),
    ['local-version.mp4', 'remote-version.mp4']
  );
});

test('save without review managers preserves loaded and externally added review collections', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const initialRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'comment-layer-base',
        name: '기존 댓글',
        markers: [{ id: 'comment-base', text: '기존 댓글', replies: [] }]
      }]
    },
    drawings: {
      layers: [{
        id: 'drawing-base',
        name: '기존 드로잉',
        keyframes: [{ id: 'drawing-frame-base', isEmpty: false }]
      }]
    },
    highlights: {
      highlights: [{ id: 'highlight-base', startTime: 1, endTime: 2 }]
    },
    compositionLayers: [{
      id: 'composition-base',
      name: '기존 합성',
      order: 0
    }]
  });
  const latestRoot = structuredClone(initialRoot);
  latestRoot.comments.layers[0].markers.push({
    id: 'comment-remote',
    text: '원격 댓글',
    replies: []
  });
  latestRoot.drawings.layers.push({
    id: 'drawing-remote',
    name: '원격 드로잉',
    keyframes: [{ id: 'drawing-frame-remote', isEmpty: false }]
  });
  latestRoot.highlights.highlights.push({
    id: 'highlight-remote',
    startTime: 3,
    endTime: 4
  });
  latestRoot.compositionLayers.push({
    id: 'composition-remote',
    name: '원격 합성',
    order: 1
  });

  let savedRoot = null;
  window.electronAPI = {
    loadReview: async () => structuredClone(initialRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(latestRoot),
      versionToken: 'managerless-latest-token'
    }),
    saveReview: async (_path, data) => {
      savedRoot = structuredClone(data);
      return { success: true, versionToken: 'managerless-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false });
  assert.equal(await manager.setVideoFile('C:/reviews/existing.mp4'), true);
  assert.equal(await manager.save(), true);

  assert.deepEqual(
    savedRoot.comments.layers[0].markers.map(marker => marker.id).sort(),
    ['comment-base', 'comment-remote']
  );
  assert.deepEqual(
    savedRoot.drawings.layers.map(layer => layer.id).sort(),
    ['drawing-base', 'drawing-remote']
  );
  assert.deepEqual(
    savedRoot.highlights.highlights.map(highlight => highlight.id).sort(),
    ['highlight-base', 'highlight-remote']
  );
  assert.deepEqual(
    savedRoot.compositionLayers.map(layer => layer.id).sort(),
    ['composition-base', 'composition-remote']
  );
});

test('three-way save keeps local deletions and remote additions across repeated saves', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'comment-base',
        name: '삭제할 댓글 레이어',
        markers: [{ id: 'comment-base-marker', text: '삭제 대상', replies: [] }]
      }]
    },
    drawings: {
      layers: [{
        id: 'drawing-base',
        name: '삭제할 드로잉',
        keyframes: [{ frame: 1, isEmpty: false, canvasData: 'base-drawing' }]
      }]
    },
    highlights: {
      highlights: [{
        id: 'highlight-base',
        startTime: 1,
        endTime: 2,
        modifiedAt: '2026-07-01T00:00:00.000Z'
      }]
    },
    compositionLayers: [{
      id: 'composition-base',
      name: '삭제할 합성',
      order: 0
    }],
    manualVersions: [{
      filePath: 'C:/reviews/base-version.mp4',
      fileName: 'base-version.mp4',
      addedAt: '2026-07-01T00:00:00.000Z'
    }]
  });
  let diskRoot = structuredClone(baseRoot);
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: `${saveCount + 1}`.repeat(64).slice(0, 64)
    }),
    saveReview: async (_path, data) => {
      saveCount += 1;
      diskRoot = structuredClone(data);
      return {
        success: true,
        versionToken: `${saveCount + 5}`.repeat(64).slice(0, 64)
      };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    ...managers
  });
  await manager.setVideoFile('C:/reviews/existing.mp4');

  managers.commentManager.fromJSON({ layers: [] });
  managers.drawingManager.importData({ layers: [] });
  managers.highlightManager.fromJSON({ highlights: [] });
  managers.compositionLayerManager.fromJSON([]);
  manager.removeManualVersion('C:/reviews/base-version.mp4');

  diskRoot.comments.layers.push({
    id: 'comment-remote',
    name: '원격 댓글 레이어',
    markers: [{ id: 'comment-remote-marker', text: '원격 추가', replies: [] }]
  });
  diskRoot.drawings.layers.push({
    id: 'drawing-remote',
    name: '원격 드로잉',
    keyframes: [{ frame: 2, isEmpty: false, canvasData: 'remote-drawing' }]
  });
  diskRoot.highlights.highlights.push({
    id: 'highlight-remote',
    startTime: 3,
    endTime: 4,
    modifiedAt: '2026-07-02T00:00:00.000Z'
  });
  diskRoot.compositionLayers.push({
    id: 'composition-remote',
    name: '원격 합성',
    order: 1
  });
  diskRoot.manualVersions.push({
    filePath: 'C:/reviews/remote-version.mp4',
    fileName: 'remote-version.mp4',
    addedAt: '2026-07-02T00:00:00.000Z'
  });

  assert.equal(await manager.save(), true);
  assert.deepEqual(diskRoot.comments.layers.map(layer => layer.id), ['comment-remote']);
  assert.deepEqual(diskRoot.drawings.layers.map(layer => layer.id), ['drawing-remote']);
  assert.deepEqual(diskRoot.highlights.highlights.map(item => item.id), ['highlight-remote']);
  assert.deepEqual(diskRoot.compositionLayers.map(layer => layer.id), ['composition-remote']);
  assert.deepEqual(
    diskRoot.manualVersions.map(version => version.filePath),
    ['C:/reviews/remote-version.mp4']
  );

  manager._markDirty();
  assert.equal(await manager.save(), true);
  assert.deepEqual(diskRoot.comments.layers.map(layer => layer.id), ['comment-remote']);
  assert.deepEqual(diskRoot.drawings.layers.map(layer => layer.id), ['drawing-remote']);
  assert.deepEqual(diskRoot.highlights.highlights.map(item => item.id), ['highlight-remote']);
  assert.deepEqual(diskRoot.compositionLayers.map(layer => layer.id), ['composition-remote']);
  assert.deepEqual(
    diskRoot.manualVersions.map(version => version.filePath),
    ['C:/reviews/remote-version.mp4']
  );
});

test('three-way save preserves both sides of edit and delete conflicts without duplicate retries', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'comment-shared',
        name: '공유 댓글 레이어',
        markers: [{ id: 'comment-base-marker', text: '기준', replies: [] }]
      }]
    },
    drawings: {
      layers: [{
        id: 'drawing-shared',
        name: '공유 드로잉',
        keyframes: [{ frame: 1, isEmpty: false, canvasData: 'base-drawing' }]
      }]
    },
    highlights: {
      highlights: [{
        id: 'highlight-shared',
        startTime: 1,
        endTime: 2,
        note: '기준',
        modifiedAt: '2026-07-01T00:00:00.000Z'
      }]
    },
    compositionLayers: [{
      id: 'composition-shared',
      name: '공유 합성',
      opacity: 1,
      order: 0
    }]
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'a'.repeat(64)
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'b'.repeat(64) };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    ...managers
  });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  managers.commentManager.fromJSON({ layers: [] });
  managers.drawingManager.importData({ layers: [] });
  managers.highlightManager.fromJSON({ highlights: [] });
  managers.compositionLayerManager.fromJSON([]);
  manager._markDirty();

  diskRoot.comments.layers[0].markers.push({
    id: 'comment-remote-marker',
    text: '원격 수정',
    replies: []
  });
  diskRoot.drawings.layers[0].keyframes[0].canvasData = 'remote-drawing-change';
  diskRoot.highlights.highlights[0].note = '원격 수정';
  diskRoot.highlights.highlights[0].modifiedAt = '2026-07-02T00:00:00.000Z';
  diskRoot.compositionLayers[0].opacity = 0.5;

  assert.equal(await manager.save(), true);
  const firstConflictIds = {
    comments: diskRoot.comments.layers.map(layer => layer.id),
    drawings: diskRoot.drawings.layers.map(layer => layer.id),
    highlights: diskRoot.highlights.highlights.map(item => item.id),
    composition: diskRoot.compositionLayers.map(layer => layer.id)
  };
  for (const [kind, ids] of Object.entries(firstConflictIds)) {
    assert.equal(ids.length, 1, kind);
    assert.notEqual(ids[0], `${kind === 'comments' ? 'comment' : kind === 'drawings' ? 'drawing' : kind === 'highlights' ? 'highlight' : 'composition'}-shared`);
  }

  manager._markDirty();
  assert.equal(await manager.save(), true);
  assert.deepEqual(diskRoot.comments.layers.map(layer => layer.id), firstConflictIds.comments);
  assert.deepEqual(diskRoot.drawings.layers.map(layer => layer.id), firstConflictIds.drawings);
  assert.deepEqual(diskRoot.highlights.highlights.map(item => item.id), firstConflictIds.highlights);
  assert.deepEqual(
    diskRoot.compositionLayers.map(layer => layer.id),
    firstConflictIds.composition
  );
});

test('reloadAndMerge keeps local collection deletions while adopting remote additions', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{ id: 'comment-base', name: '삭제 대상', markers: [] }]
    },
    drawings: {
      layers: [{
        id: 'drawing-base',
        name: '삭제 대상',
        keyframes: [{ frame: 1, isEmpty: false, canvasData: 'base' }]
      }]
    },
    highlights: {
      highlights: [{ id: 'highlight-base', startTime: 1, endTime: 2 }]
    },
    compositionLayers: [{ id: 'composition-base', name: '삭제 대상', order: 0 }],
    manualVersions: [{
      filePath: 'C:/reviews/base-version.mp4',
      fileName: 'base-version.mp4'
    }]
  });
  const diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'c'.repeat(64)
    })
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    ...managers
  });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  managers.commentManager.fromJSON({ layers: [] });
  managers.drawingManager.importData({ layers: [] });
  managers.highlightManager.fromJSON({ highlights: [] });
  managers.compositionLayerManager.fromJSON([]);
  manager.removeManualVersion('C:/reviews/base-version.mp4');

  diskRoot.comments.layers.push({ id: 'comment-remote', name: '원격 추가', markers: [] });
  diskRoot.drawings.layers.push({
    id: 'drawing-remote',
    name: '원격 추가',
    keyframes: [{ frame: 2, isEmpty: false, canvasData: 'remote' }]
  });
  diskRoot.highlights.highlights.push({
    id: 'highlight-remote',
    startTime: 3,
    endTime: 4
  });
  diskRoot.compositionLayers.push({
    id: 'composition-remote',
    name: '원격 추가',
    order: 1
  });
  diskRoot.manualVersions.push({
    filePath: 'C:/reviews/remote-version.mp4',
    fileName: 'remote-version.mp4'
  });

  const result = await manager.reloadAndMerge({ merge: true });
  assert.equal(result.success, true);
  assert.deepEqual(
    managers.commentManager.toJSON().layers.map(layer => layer.id),
    ['comment-remote']
  );
  assert.deepEqual(
    managers.drawingManager.exportData().layers.map(layer => layer.id),
    ['drawing-remote']
  );
  assert.deepEqual(
    managers.highlightManager.toJSON().highlights.map(item => item.id),
    ['highlight-remote']
  );
  assert.deepEqual(
    managers.compositionLayerManager.toJSON().map(layer => layer.id),
    ['composition-remote']
  );
  assert.deepEqual(
    manager.getManualVersions().map(version => version.filePath),
    ['C:/reviews/remote-version.mp4']
  );
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
  assert.deepEqual(fabricStore.exportRootValue(), remoteFabric);

  const local = createFabricRecord('local-after-remote');
  assert.equal(fabricStore.applyTransition(
    createFabricTransition(1, local)
  ).applied, true);
  assert.equal(await manager.save(), true);
  assert.equal(saveCalls[1].drawingsV3.documentId, remoteFabric.documentId);
  assert.equal(
    saveCalls[1].drawingsV3.keyframes.find(frame => frame.frame === 12)
      .objects[0].id,
    local.id
  );
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
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING
  });
  window.electronAPI = {
    loadReview: async () => structuredClone(diskRoot),
    saveReview: async (_path, data) => {
      const savedSnapshot = structuredClone(data);
      saveCalls.push(savedSnapshot);
      if (saveCalls.length === 1) {
        saveStarted.resolve();
        const result = await releaseFirstSave.promise;
        diskRoot = savedSnapshot;
        return result;
      }
      diskRoot = savedSnapshot;
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

test('external supported drawingsV3 is re-imported before an unrelated save when local Fabric is clean', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const commentManager = createCommentManager();
  const initialFabric = createFabricRoot();
  const externalFabric = createFabricRoot({
    documentId: 'fabric-document-external-supported',
    revision: 5,
    keyframes: [{
      id: 'external-supported-frame',
      frame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('external-supported-stroke')]
    }]
  });
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: initialFabric
  });
  let savedRoot = null;
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
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: externalFabric
  });
  addSubstantiveComment(manager, commentManager, 'external-supported-comment');

  assert.equal(await manager.save(), true);
  assert.deepEqual(savedRoot.drawingsV3, externalFabric);
  assert.deepEqual(fabricStore.exportRootValue(), externalFabric);
  manager.disconnect();
});

test('external future and missing drawingsV3 are adopted opaquely when local Fabric is clean', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');

  for (const [label, externalDrawing, expectedState] of [
    ['future', {
      storageSchema: 'baeframe-fabric-scenes',
      storageVersion: '8.0.0',
      engine: 'future-engine',
      futurePayload: { preserve: ['exactly'] }
    }, 'incompatible'],
    ['missing', undefined, 'ready']
  ]) {
    const fabricStore = await createFabricStore();
    const commentManager = createCommentManager();
    let diskRoot = createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      drawingsV3: createFabricRoot()
    });
    let savedRoot = null;
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
    await manager.setVideoFile(`C:/reviews/external-${label}.mp4`, {
      fabricDrawingPersistenceContext: {
        ...FABRIC_CONTEXT,
        stableVideoIdentity: `C:/reviews/external-${label}.mp4`
      }
    });
    diskRoot = createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING
    });
    if (externalDrawing !== undefined) {
      diskRoot.drawingsV3 = externalDrawing;
    }
    addSubstantiveComment(manager, commentManager, `external-${label}-comment`);

    assert.equal(await manager.save(), true);
    assert.equal(Object.hasOwn(savedRoot, 'drawingsV3'), externalDrawing !== undefined);
    if (externalDrawing !== undefined) {
      assert.deepEqual(savedRoot.drawingsV3, externalDrawing);
      assert.deepEqual(fabricStore.exportRootValue(), externalDrawing);
    } else {
      assert.equal(fabricStore.exportRootValue().keyframes.length, 0);
    }
    assert.equal(fabricStore.getStatus().state, expectedState);
    manager.disconnect();
  }
});

test('local Fabric edits block external supported, future, or missing drawingsV3 replacements', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');

  for (const [label, externalDrawing] of [
    ['supported', createFabricRoot({
      documentId: 'fabric-document-conflicting-supported',
      revision: 11
    })],
    ['future', {
      storageSchema: 'baeframe-fabric-scenes',
      storageVersion: '7.0.0',
      engine: 'future-engine',
      payload: { neverReplace: true }
    }],
    ['missing', undefined]
  ]) {
    const fabricStore = await createFabricStore();
    let diskRoot = createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      drawingsV3: createFabricRoot()
    });
    let saveCount = 0;
    window.electronAPI = {
      loadReview: async () => diskRoot,
      saveReview: async () => {
        saveCount += 1;
        return { success: true };
      }
    };
    const manager = new ReviewDataManager({
      autoSave: false,
      fabricDrawingPersistenceProvider: fabricStore
    });
    manager.connect();
    await manager.setVideoFile(`C:/reviews/conflict-${label}.mp4`, {
      fabricDrawingPersistenceContext: {
        ...FABRIC_CONTEXT,
        stableVideoIdentity: `C:/reviews/conflict-${label}.mp4`
      }
    });
    const localStroke = createFabricRecord(`local-conflict-${label}`);
    assert.equal(fabricStore.applyTransition({
      ...createFabricTransition(1, localStroke),
      stableVideoIdentity: `C:/reviews/conflict-${label}.mp4`
    }).applied, true);
    const localSnapshot = fabricStore.exportRootValue();

    diskRoot = createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING
    });
    if (externalDrawing !== undefined) {
      diskRoot.drawingsV3 = externalDrawing;
    }

    assert.equal(await manager.save(), false, label);
    assert.equal(saveCount, 0, label);
    assert.equal(manager._writeBlockedReason, 'fabric-drawing-conflict', label);
    assert.equal(manager.isDirty, true, label);
    assert.deepEqual(fabricStore.exportRootValue(), localSnapshot, label);
    manager.disconnect();
  }
});

test('drawingsV3 fingerprint ignores JSON object key order without hiding real local edits', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const initialFabric = createFabricRoot();
  const reorderedSameFabric = {
    keyframes: [],
    totalFrames: initialFabric.totalFrames,
    fps: initialFabric.fps,
    revision: initialFabric.revision,
    documentId: initialFabric.documentId,
    engine: initialFabric.engine,
    storageVersion: initialFabric.storageVersion,
    storageSchema: initialFabric.storageSchema
  };
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: initialFabric
  });
  let savedRoot = null;
  window.electronAPI = {
    loadReview: async () => diskRoot,
    saveReview: async (_path, data) => {
      savedRoot = structuredClone(data);
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  const local = createFabricRecord('fingerprint-order-local');
  assert.equal(fabricStore.applyTransition(
    createFabricTransition(1, local)
  ).applied, true);
  diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: reorderedSameFabric
  });

  assert.equal(await manager.save(), true);
  assert.equal(savedRoot.drawingsV3.keyframes[0].objects[0].id, local.id);
  assert.notEqual(manager._writeBlockedReason, 'fabric-drawing-conflict');
  manager.disconnect();
});

test('reload merge applies external Fabric only when no local Fabric edit exists', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  let diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: createFabricRoot()
  });
  window.electronAPI = {
    loadReview: async () => diskRoot
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });

  const externalFabric = createFabricRoot({
    documentId: 'fabric-document-reload-external',
    revision: 3
  });
  diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: externalFabric
  });
  assert.equal((await manager.reloadAndMerge({ merge: true, force: true })).success, true);
  assert.deepEqual(fabricStore.exportRootValue(), externalFabric);

  const local = createFabricRecord('reload-local');
  assert.equal(fabricStore.applyTransition(
    createFabricTransition(1, local)
  ).applied, true);
  diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: createFabricRoot({
      documentId: 'fabric-document-reload-second-external',
      revision: 9
    })
  });
  const blocked = await manager.reloadAndMerge({ merge: true, force: true });
  assert.equal(blocked.success, false);
  assert.equal(manager._writeBlockedReason, 'fabric-drawing-conflict');
  assert.equal(manager.isDirty, true);
  manager.disconnect();
});

test('new video invalidates prior Fabric immediately and load failure stays unavailable', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const secondLoad = createDeferred();
  let loadCount = 0;
  window.electronAPI = {
    loadReview: async () => {
      loadCount += 1;
      if (loadCount === 1) {
        return createReviewRoot({
          reviewDocumentId: REVIEW_ID_EXISTING,
          drawingsV3: createFabricRoot({
            keyframes: [{
              id: 'prior-video-frame',
              frame: 12,
              sourceWidth: 1920,
              sourceHeight: 1080,
              mutationSequence: 1,
              objects: [createFabricRecord('prior-video-stroke')]
            }]
          })
        });
      }
      return secondLoad.promise;
    }
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: fabricStore
  });
  await manager.setVideoFile('C:/reviews/prior.mp4', {
    fabricDrawingPersistenceContext: {
      ...FABRIC_CONTEXT,
      stableVideoIdentity: 'C:/reviews/prior.mp4'
    }
  });
  assert.equal(fabricStore.getStatus().objectCount, 1);

  const switching = manager.setVideoFile('C:/reviews/failing.mp4', {
    skipSave: true,
    fabricDrawingPersistenceContext: {
      ...FABRIC_CONTEXT,
      stableVideoIdentity: 'C:/reviews/failing.mp4'
    }
  });
  await Promise.resolve();
  assert.equal(fabricStore.getStatus().state, 'unavailable');
  assert.equal(fabricStore.exportRootValue(), null);
  secondLoad.resolve(Promise.reject(new Error('injected load failure')));

  assert.equal(await switching, false);
  assert.equal(fabricStore.getStatus().state, 'unavailable');
  assert.equal(fabricStore.exportRootValue(), null);
});

test('provider replacement restores current disk raw or remains unavailable before a real load', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const firstStore = await createFabricStore();
  const replacementStore = await createFabricStore();
  const preLoadStore = await createFabricStore();
  const loadedFabric = createFabricRoot({
    revision: 2,
    keyframes: [{
      id: 'provider-replacement-frame',
      frame: 30,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [createFabricRecord('provider-replacement-stroke')]
    }]
  });
  window.electronAPI = {
    loadReview: async () => createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      drawingsV3: loadedFabric
    })
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: firstStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });

  manager.setFabricDrawingPersistenceProvider(replacementStore);
  assert.deepEqual(replacementStore.exportRootValue(), loadedFabric);
  assert.equal(replacementStore.getStatus().state, 'ready');

  const unloadedManager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: firstStore
  });
  unloadedManager.connect();
  unloadedManager.setFabricDrawingPersistenceProvider(preLoadStore);
  assert.equal(preLoadStore.getStatus().state, 'unavailable');
  assert.equal(preLoadStore.exportRootValue(), null);
  manager.disconnect();
  unloadedManager.disconnect();
});

test('provider replacement preserves a current unsaved Fabric snapshot and dirty ownership', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const firstStore = await createFabricStore();
  const replacementStore = await createFabricStore();
  window.electronAPI = {
    loadReview: async () => createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      drawingsV3: createFabricRoot()
    })
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    fabricDrawingPersistenceProvider: firstStore
  });
  manager.connect();
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  const local = createFabricRecord('provider-replacement-local');
  assert.equal(firstStore.applyTransition(
    createFabricTransition(1, local)
  ).applied, true);

  manager.setFabricDrawingPersistenceProvider(replacementStore);
  assert.equal(replacementStore.exportRootValue().keyframes[0].objects[0].id, local.id);
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), true);
  manager.disconnect();
});

test('preflight, latest-root refresh, final Fabric snapshot, collect, and write run in order', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const fabricStore = await createFabricStore();
  const commentManager = createCommentManager();
  const order = [];
  let loadCount = 0;
  let savedRoot = null;
  const diskRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawingsV3: createFabricRoot()
  });
  window.electronAPI = {
    loadReview: async () => {
      loadCount += 1;
      if (loadCount > 1) order.push('latest-root-refresh');
      return diskRoot;
    },
    saveReview: async (_path, data) => {
      order.push('write');
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
  await manager.setVideoFile('C:/reviews/fabric.mp4', {
    fabricDrawingPersistenceContext: FABRIC_CONTEXT
  });
  addSubstantiveComment(manager, commentManager, 'ordered-hook-comment');
  manager.setBeforeSaveHandler(async () => {
    order.push('preflight');
  });
  manager.setFinalFabricSnapshotHandler(async () => {
    order.push('final-fabric-snapshot');
    const pulled = createFabricRecord('final-hook-stroke');
    fabricStore.applyTransition(createFabricTransition(1, pulled));
  });
  const originalCollect = manager._collectData.bind(manager);
  manager._collectData = () => {
    order.push('collect');
    return originalCollect();
  };

  assert.equal(await manager.save(), true);
  assert.deepEqual(order, [
    'preflight',
    'latest-root-refresh',
    'final-fabric-snapshot',
    'collect',
    'write'
  ]);
  assert.equal(savedRoot.drawingsV3.keyframes[0].objects[0].id, 'final-hook-stroke');
  manager.disconnect();
});

test('final Fabric snapshot failure blocks disk write and keeps dirty state', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const commentManager = createCommentManager();
  let saveCount = 0;
  window.electronAPI = {
    loadReview: async () => createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING
    }),
    saveReview: async () => {
      saveCount += 1;
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({
    autoSave: false,
    commentManager
  });
  await manager.setVideoFile('C:/reviews/final-hook-failure.mp4');
  addSubstantiveComment(manager, commentManager, 'final-hook-failure-comment');
  manager.setFinalFabricSnapshotHandler(async () => {
    throw new Error('injected final snapshot failure');
  });

  assert.equal(await manager.save(), false);
  assert.equal(saveCount, 0);
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), true);
});

test('backup fallback reports failure when transactional backup save is deferred', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const backupRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING
  });
  window.electronAPI = {
    loadReview: async () => structuredClone(backupRoot),
    saveReview: async () => ({
      success: false,
      retryable: true,
      reason: 'lock-timeout'
    })
  };
  const manager = new ReviewDataManager({ autoSave: false });

  assert.equal(
    await manager._createBackup('C:/reviews/backup-result.bframe'),
    false
  );
});

test('backup fallback succeeds only after the backup file is confirmed saved', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const backupRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING
  });
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => structuredClone(backupRoot),
    saveReview: async (...args) => {
      saveCalls.push(args);
      return { success: true };
    }
  };
  const manager = new ReviewDataManager({ autoSave: false });

  assert.equal(
    await manager._createBackup('C:/reviews/backup-result.bframe'),
    true
  );
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0][0], 'C:/reviews/backup-result.bframe.bak');
  assert.deepEqual(saveCalls[0][1], backupRoot);
});

test('scheduled legacy migration save preserves migrated comments and manual versions', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const legacyRoot = {
    videoFile: 'legacy.mp4',
    videoPath: 'C:/reviews/legacy.mp4',
    fps: 24,
    comments: [{
      id: 'legacy-comment',
      text: '구형 댓글',
      createdAt: '2026-07-01T00:00:00.000Z',
      replies: []
    }],
    versions: [{
      version: 7,
      filename: 'legacy_v7.mp4',
      createdAt: '2026-07-01T00:00:00.000Z'
    }],
    vendorEnvelope: { preserve: true }
  };
  const saveCalls = [];
  window.electronAPI = {
    loadReview: async () => structuredClone(legacyRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(legacyRoot),
      versionToken: 'legacy-root-token'
    }),
    saveReview: async (reviewPath, data) => {
      saveCalls.push([reviewPath, structuredClone(data)]);
      return {
        success: true,
        versionToken: reviewPath.endsWith('.bak') ? undefined : 'legacy-saved-token'
      };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    reviewDocumentIdFactory: () => REVIEW_ID_GENERATED,
    ...managers
  });
  assert.equal(await manager.setVideoFile('C:/reviews/legacy.mp4'), true);

  await wait(160);

  const mainSave = saveCalls.find(([reviewPath]) =>
    reviewPath === 'C:/reviews/legacy.bframe'
  );
  assert.ok(mainSave, 'migration should schedule a canonical main-file save');
  const savedRoot = mainSave[1];
  assert.equal(savedRoot.bframeVersion, '2.0');
  assert.equal(savedRoot.reviewDocumentId, REVIEW_ID_GENERATED);
  assert.deepEqual(savedRoot.vendorEnvelope, { preserve: true });
  assert.equal(Object.hasOwn(savedRoot, 'versions'), false);
  assert.deepEqual(
    savedRoot.comments.layers[0].markers.map(marker => marker.id),
    ['legacy-comment']
  );
  assert.deepEqual(
    savedRoot.manualVersions.map(version => version.fileName),
    ['legacy_v7.mp4']
  );
});

test('three-way save preserves replies concurrently added to the same marker', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseMarker = {
    id: 'shared-marker',
    text: '공유 댓글',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    replies: []
  };
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'shared-layer',
        name: '공유 댓글',
        markers: [baseMarker]
      }]
    }
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'reply-latest-token'
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'reply-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, ...managers });
  await manager.setVideoFile('C:/reviews/existing.mp4');

  const localMarker = structuredClone(baseMarker);
  localMarker.updatedAt = '2026-07-01T00:01:00.000Z';
  localMarker.replies.push({
    id: 'reply-local',
    text: '로컬 답글',
    createdAt: '2026-07-01T00:01:00.000Z',
    updatedAt: '2026-07-01T00:01:00.000Z'
  });
  managers.commentManager.fromJSON({
    layers: [{
      id: 'shared-layer',
      name: '공유 댓글',
      markers: [localMarker]
    }]
  });

  const remoteMarker = diskRoot.comments.layers[0].markers[0];
  remoteMarker.updatedAt = '2026-07-01T00:02:00.000Z';
  remoteMarker.replies.push({
    id: 'reply-remote',
    text: '원격 답글',
    createdAt: '2026-07-01T00:02:00.000Z',
    updatedAt: '2026-07-01T00:02:00.000Z'
  });
  manager._markDirty();

  assert.equal(await manager.save(), true);
  assert.deepEqual(
    diskRoot.comments.layers[0].markers[0].replies
      .map(reply => reply.id)
      .sort(),
    ['reply-local', 'reply-remote']
  );
});

test('soft-deleted marker stays deleted when a concurrent newer reply arrives', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseMarker = {
    id: 'deleted-marker',
    text: '삭제할 댓글',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    deleted: false,
    deletedAt: null,
    replies: []
  };
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'shared-layer',
        name: '공유 댓글',
        markers: [baseMarker]
      }]
    }
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'delete-latest-token'
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'delete-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, ...managers });
  await manager.setVideoFile('C:/reviews/existing.mp4');

  managers.commentManager.fromJSON({
    layers: [{
      id: 'shared-layer',
      name: '공유 댓글',
      markers: [{
        ...structuredClone(baseMarker),
        updatedAt: '2026-07-01T00:01:00.000Z',
        deleted: true,
        deletedAt: '2026-07-01T00:01:00.000Z'
      }]
    }]
  });
  const remoteMarker = diskRoot.comments.layers[0].markers[0];
  remoteMarker.updatedAt = '2026-07-01T00:02:00.000Z';
  remoteMarker.replies.push({
    id: 'reply-after-delete',
    text: '뒤늦게 도착한 답글',
    createdAt: '2026-07-01T00:02:00.000Z',
    updatedAt: '2026-07-01T00:02:00.000Z'
  });
  manager._markDirty();

  assert.equal(await manager.save(), true);
  const savedMarker = diskRoot.comments.layers[0].markers[0];
  assert.equal(savedMarker.deleted, true);
  assert.equal(savedMarker.deletedAt, '2026-07-01T00:01:00.000Z');
  assert.deepEqual(
    savedMarker.replies.map(reply => reply.id),
    ['reply-after-delete']
  );

  manager._markDirty();
  assert.equal(await manager.save(), true);
  assert.deepEqual(
    diskRoot.comments.layers[0].markers.map(marker => marker.id),
    ['deleted-marker']
  );
  assert.equal(diskRoot.comments.layers[0].markers[0].deleted, true);
});

test('unrelated save preserves the latest remote order of review layers', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [
        { id: 'comment-a', name: 'A', markers: [] },
        { id: 'comment-b', name: 'B', markers: [] }
      ]
    },
    drawings: {
      layers: [
        { id: 'drawing-a', name: 'A', keyframes: [] },
        { id: 'drawing-b', name: 'B', keyframes: [] }
      ]
    },
    compositionLayers: [
      { id: 'composition-a', name: 'A', order: 0 },
      { id: 'composition-b', name: 'B', order: 1 }
    ]
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'reorder-latest-token'
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'reorder-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, ...managers });
  await manager.setVideoFile('C:/reviews/existing.mp4');

  diskRoot.comments.layers.reverse();
  diskRoot.drawings.layers.reverse();
  diskRoot.drawings.layers.splice(1, 0, {
    id: 'drawing-remote-insert',
    name: '원격 중간 삽입',
    keyframes: []
  });
  diskRoot.compositionLayers.reverse();
  diskRoot.compositionLayers.unshift({
    id: 'composition-remote-insert',
    name: '원격 맨 앞 삽입',
    order: 0
  });
  diskRoot.compositionLayers.forEach((layer, order) => {
    layer.order = order;
  });
  manager.addManualVersion({
    filePath: 'C:/reviews/unrelated.mp4',
    fileName: 'unrelated.mp4'
  });

  assert.equal(await manager.save(), true);
  assert.deepEqual(
    diskRoot.comments.layers.map(layer => layer.id),
    ['comment-b', 'comment-a']
  );
  assert.deepEqual(
    diskRoot.drawings.layers.map(layer => layer.id),
    ['drawing-b', 'drawing-remote-insert', 'drawing-a']
  );
  assert.deepEqual(
    diskRoot.compositionLayers.map(layer => layer.id),
    ['composition-remote-insert', 'composition-b', 'composition-a']
  );
  assert.deepEqual(
    diskRoot.compositionLayers.map(layer => layer.order),
    [0, 1, 2]
  );
});

test('conflicting local and remote reorders deterministically keep remote order and all layers', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const layerIds = ['a', 'b', 'c'];
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawings: {
      layers: layerIds.map(id => ({
        id: `drawing-${id}`,
        name: id.toUpperCase(),
        keyframes: []
      }))
    }
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'conflicting-order-latest-token'
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'conflicting-order-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, ...managers });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  managers.drawingManager.importData({
    layers: [
      baseRoot.drawings.layers[1],
      baseRoot.drawings.layers[0],
      baseRoot.drawings.layers[2]
    ]
  });
  diskRoot.drawings.layers = [
    diskRoot.drawings.layers[0],
    diskRoot.drawings.layers[2],
    diskRoot.drawings.layers[1]
  ];
  manager._markDirty();

  assert.equal(await manager.save(), true);
  assert.deepEqual(
    diskRoot.drawings.layers.map(layer => layer.id),
    ['drawing-a', 'drawing-c', 'drawing-b']
  );
  assert.deepEqual(
    new Set(diskRoot.drawings.layers.map(layer => layer.id)),
    new Set(['drawing-a', 'drawing-b', 'drawing-c'])
  );
});

test('array-form highlights load into HighlightManager and survive an unrelated save', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const { HighlightManager } = await import('../../renderer/scripts/modules/highlight-manager.js');
  const highlightManager = new HighlightManager();
  const root = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    highlights: [{
      id: 'highlight-array',
      startTime: 3,
      endTime: 7,
      colorKey: 'yellow',
      note: '배열형 하이라이트',
      createdAt: '2026-07-01T00:00:00.000Z',
      modifiedAt: '2026-07-01T00:00:00.000Z'
    }]
  });
  let savedRoot = null;
  window.electronAPI = {
    loadReview: async () => structuredClone(root),
    loadReviewSnapshot: async () => ({
      data: structuredClone(root),
      versionToken: 'highlight-latest-token'
    }),
    saveReview: async (_path, data) => {
      savedRoot = structuredClone(data);
      return { success: true, versionToken: 'highlight-saved-token' };
    }
  };

  const manager = new ReviewDataManager({
    autoSave: false,
    highlightManager
  });
  assert.equal(await manager.setVideoFile('C:/reviews/existing.mp4'), true);
  assert.deepEqual(
    highlightManager.getAllHighlights().map(highlight => highlight.id),
    ['highlight-array']
  );

  manager.addManualVersion({
    filePath: 'C:/reviews/unrelated.mp4',
    fileName: 'unrelated.mp4'
  });
  assert.equal(await manager.save(), true);
  assert.deepEqual(
    savedRoot.highlights.highlights.map(highlight => highlight.id),
    ['highlight-array']
  );
});

test('concurrent edits to the same reply create one deterministic conflict copy', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseMarker = {
    id: 'shared-marker',
    text: '공유 댓글',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    replies: [{
      id: 'shared-reply',
      text: '기준 답글',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }]
  };
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'shared-layer',
        name: '공유 댓글',
        markers: [baseMarker]
      }]
    }
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'same-reply-latest-token'
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'same-reply-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, ...managers });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  const localMarker = structuredClone(baseMarker);
  localMarker.updatedAt = '2026-07-01T00:01:00.000Z';
  localMarker.replies[0].text = '로컬 답글 수정';
  localMarker.replies[0].updatedAt = '2026-07-01T00:01:00.000Z';
  managers.commentManager.fromJSON({
    layers: [{
      id: 'shared-layer',
      name: '공유 댓글',
      markers: [localMarker]
    }]
  });
  const remoteMarker = diskRoot.comments.layers[0].markers[0];
  remoteMarker.updatedAt = '2026-07-01T00:02:00.000Z';
  remoteMarker.replies[0].text = '원격 답글 수정';
  remoteMarker.replies[0].updatedAt = '2026-07-01T00:02:00.000Z';
  manager._markDirty();

  assert.equal(await manager.save(), true);
  const firstReplies = diskRoot.comments.layers[0].markers[0].replies;
  assert.deepEqual(
    firstReplies.map(reply => reply.id),
    ['shared-reply', 'shared-reply__remote-conflict']
  );
  assert.deepEqual(
    firstReplies.map(reply => reply.text),
    ['로컬 답글 수정', '원격 답글 수정']
  );

  manager._markDirty();
  assert.equal(await manager.save(), true);
  assert.deepEqual(
    diskRoot.comments.layers[0].markers[0].replies.map(reply => reply.id),
    ['shared-reply', 'shared-reply__remote-conflict']
  );
});

test('concurrent marker metadata edits keep both parents and independently merged replies', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseMarker = {
    id: 'metadata-marker',
    text: '기준 댓글',
    resolved: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    replies: []
  };
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'shared-layer',
        name: '공유 댓글',
        markers: [baseMarker]
      }]
    }
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'marker-metadata-latest-token'
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'marker-metadata-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, ...managers });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  managers.commentManager.fromJSON({
    layers: [{
      id: 'shared-layer',
      name: '공유 댓글',
      markers: [{
        ...structuredClone(baseMarker),
        text: '로컬 본문 수정',
        updatedAt: '2026-07-01T00:01:00.000Z',
        replies: [{
          id: 'reply-local',
          text: '로컬 답글',
          createdAt: '2026-07-01T00:01:00.000Z',
          updatedAt: '2026-07-01T00:01:00.000Z'
        }]
      }]
    }]
  });
  const remoteMarker = diskRoot.comments.layers[0].markers[0];
  remoteMarker.resolved = true;
  remoteMarker.updatedAt = '2026-07-01T00:02:00.000Z';
  remoteMarker.replies.push({
    id: 'reply-remote',
    text: '원격 답글',
    createdAt: '2026-07-01T00:02:00.000Z',
    updatedAt: '2026-07-01T00:02:00.000Z'
  });
  manager._markDirty();

  assert.equal(await manager.save(), true);
  const firstMarkers = diskRoot.comments.layers[0].markers;
  assert.deepEqual(
    firstMarkers.map(marker => marker.id),
    ['metadata-marker', 'metadata-marker__remote-conflict']
  );
  assert.equal(firstMarkers[0].text, '로컬 본문 수정');
  assert.equal(firstMarkers[0].resolved, false);
  assert.equal(firstMarkers[1].text, '기준 댓글');
  assert.equal(firstMarkers[1].resolved, true);
  for (const marker of firstMarkers) {
    assert.deepEqual(
      marker.replies.map(reply => reply.id).sort(),
      ['reply-local', 'reply-remote']
    );
  }

  manager._markDirty();
  assert.equal(await manager.save(), true);
  assert.deepEqual(
    diskRoot.comments.layers[0].markers.map(marker => marker.id),
    ['metadata-marker', 'metadata-marker__remote-conflict']
  );
});

test('soft delete and concurrent marker edit preserve tombstone plus one conflict copy', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseMarker = {
    id: 'delete-edit-marker',
    text: '기준 댓글',
    deleted: false,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    replies: []
  };
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    comments: {
      layers: [{
        id: 'shared-layer',
        name: '공유 댓글',
        markers: [baseMarker]
      }]
    }
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'delete-edit-latest-token'
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'delete-edit-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, ...managers });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  managers.commentManager.fromJSON({
    layers: [{
      id: 'shared-layer',
      name: '공유 댓글',
      markers: [{
        ...structuredClone(baseMarker),
        deleted: true,
        deletedAt: '2026-07-01T00:01:00.000Z',
        updatedAt: '2026-07-01T00:01:00.000Z'
      }]
    }]
  });
  const remoteMarker = diskRoot.comments.layers[0].markers[0];
  remoteMarker.text = '원격 본문 수정';
  remoteMarker.updatedAt = '2026-07-01T00:02:00.000Z';
  manager._markDirty();

  assert.equal(await manager.save(), true);
  const firstMarkers = diskRoot.comments.layers[0].markers;
  assert.deepEqual(
    firstMarkers.map(marker => marker.id),
    ['delete-edit-marker', 'delete-edit-marker__remote-conflict']
  );
  assert.equal(firstMarkers[0].deleted, true);
  assert.equal(firstMarkers[1].deleted, false);
  assert.equal(firstMarkers[1].text, '원격 본문 수정');

  manager._markDirty();
  assert.equal(await manager.save(), true);
  assert.deepEqual(
    diskRoot.comments.layers[0].markers.map(marker => marker.id),
    ['delete-edit-marker', 'delete-edit-marker__remote-conflict']
  );
});

test('reload merge keeps latest remote as base so delete-edit conflicts do not resurrect on save', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const managers = createMutableReviewManagers();
  const baseRoot = createReviewRoot({
    reviewDocumentId: REVIEW_ID_EXISTING,
    drawings: {
      layers: [{
        id: 'drawing-shared',
        name: '공유 드로잉',
        keyframes: [{ frame: 1, isEmpty: false, canvasData: 'base' }]
      }]
    }
  });
  let diskRoot = structuredClone(baseRoot);
  window.electronAPI = {
    loadReview: async () => structuredClone(baseRoot),
    loadReviewSnapshot: async () => ({
      data: structuredClone(diskRoot),
      versionToken: 'reload-base-latest-token'
    }),
    saveReview: async (_path, data) => {
      diskRoot = structuredClone(data);
      return { success: true, versionToken: 'reload-base-saved-token' };
    }
  };

  const manager = new ReviewDataManager({ autoSave: false, ...managers });
  await manager.setVideoFile('C:/reviews/existing.mp4');
  managers.drawingManager.importData({ layers: [] });
  manager._markDirty();
  diskRoot.drawings.layers[0].keyframes[0].canvasData = 'remote-edit';

  assert.equal((await manager.reloadAndMerge({ merge: true })).success, true);
  assert.deepEqual(
    managers.drawingManager.exportData().layers.map(layer => layer.id),
    ['drawing-shared__remote-conflict']
  );

  assert.equal(await manager.save(), true);
  assert.deepEqual(
    diskRoot.drawings.layers.map(layer => layer.id),
    ['drawing-shared__remote-conflict']
  );
});

test('scalar metadata uses three-way merge and keeps remote on concurrent conflicts', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const cases = [
    {
      name: 'remote-only',
      localVersion: { label: 'base' },
      localRoom: 'room-base',
      localChanged: false,
      remoteVersion: { label: 'remote' },
      remoteRoom: 'room-remote',
      expectedVersion: { label: 'remote' },
      expectedRoom: 'room-remote'
    },
    {
      name: 'local-only',
      localVersion: { label: 'local' },
      localRoom: 'room-local',
      localChanged: true,
      remoteVersion: { label: 'base' },
      remoteRoom: 'room-base',
      expectedVersion: { label: 'local' },
      expectedRoom: 'room-local'
    },
    {
      name: 'concurrent',
      localVersion: { label: 'local' },
      localRoom: 'room-local',
      localChanged: true,
      remoteVersion: { label: 'remote' },
      remoteRoom: 'room-remote',
      expectedVersion: { label: 'remote' },
      expectedRoom: 'room-remote'
    },
    {
      name: 'local-clear',
      localVersion: null,
      localRoom: null,
      localChanged: true,
      remoteVersion: { label: 'base' },
      remoteRoom: 'room-base',
      expectedVersion: null,
      expectedRoom: null
    }
  ];

  for (const mergeCase of cases) {
    const baseRoot = createReviewRoot({
      reviewDocumentId: REVIEW_ID_EXISTING,
      versionInfo: { label: 'base' },
      liveblocksRoomId: 'room-base'
    });
    const diskRoot = structuredClone(baseRoot);
    diskRoot.versionInfo = mergeCase.remoteVersion;
    diskRoot.liveblocksRoomId = mergeCase.remoteRoom;
    let savedRoot = null;
    window.electronAPI = {
      loadReview: async () => structuredClone(baseRoot),
      loadReviewSnapshot: async () => ({
        data: structuredClone(diskRoot),
        versionToken: `scalar-${mergeCase.name}-latest`
      }),
      saveReview: async (_path, data) => {
        savedRoot = structuredClone(data);
        return {
          success: true,
          versionToken: `scalar-${mergeCase.name}-saved`
        };
      }
    };

    const manager = new ReviewDataManager({ autoSave: false });
    await manager.setVideoFile('C:/reviews/existing.mp4');
    if (mergeCase.localChanged) {
      manager.setVersionInfo(mergeCase.localVersion);
      manager.setLiveblocksRoomId(mergeCase.localRoom);
    }
    if (mergeCase.name === 'remote-only') {
      manager.addManualVersion({
        filePath: 'C:/reviews/unrelated.mp4',
        fileName: 'unrelated.mp4'
      });
    }

    assert.equal(await manager.save(), true, mergeCase.name);
    assert.deepEqual(
      savedRoot.versionInfo,
      mergeCase.expectedVersion,
      mergeCase.name
    );
    assert.equal(
      savedRoot.liveblocksRoomId,
      mergeCase.expectedRoom,
      mergeCase.name
    );
  }
});
