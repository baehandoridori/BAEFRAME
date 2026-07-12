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

test('new metadata-only review skips save while switching videos', async () => {
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
    autoSave: false,
    commentManager: createCommentManager()
  });
  manager.currentVideoPath = 'C:/reviews/first.mp4';
  manager.currentBframePath = 'C:/reviews/first.bframe';
  manager.setFps(30);

  assert.equal(manager.hasPersistedFile(), false);
  assert.equal(manager.isDirty, true);
  assert.equal(manager.hasUnsavedChanges(), false);

  await manager.setVideoFile('C:/reviews/second.mp4');

  assert.equal(saveCalls.length, 0);
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
