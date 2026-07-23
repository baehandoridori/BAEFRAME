const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {
  logPanel: null,
  electronAPI: {}
};

function createCommentManager() {
  const layer = {
    id: 'layer-1',
    name: '기본 댓글 레이어',
    markers: new Map()
  };

  return {
    layers: [layer],
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
