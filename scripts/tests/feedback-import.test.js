const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '../../renderer/scripts/modules/feedback-import.js')
  );
  return import(moduleUrl.href);
}

function createIdFactory() {
  let next = 1;
  return (prefix) => `${prefix}-copy-${next++}`;
}

function createTargetComments() {
  return {
    fps: 24,
    layers: [
      {
        id: 'target-layer',
        name: '댓글 1',
        color: '#ff6b6b',
        visible: true,
        locked: false,
        markers: [
          {
            id: 'target-marker',
            layerId: 'target-layer',
            x: 0.1,
            y: 0.2,
            startFrame: 12,
            endFrame: 36,
            fps: 24,
            text: 'v2 existing feedback',
            author: '배한솔',
            createdAt: '2026-07-04T00:00:00.000Z',
            updatedAt: '2026-07-04T00:00:00.000Z',
            resolved: false,
            colorKey: 'default',
            replies: []
          }
        ]
      }
    ]
  };
}

function createSourceComments() {
  return {
    fps: 24,
    layers: [
      {
        id: 'source-layer',
        name: '댓글 1',
        color: '#4a9eff',
        visible: true,
        locked: false,
        markers: [
          {
            id: 'source-marker',
            layerId: 'source-layer',
            x: 0.5,
            y: 0.6,
            startFrame: 48,
            endFrame: 96,
            fps: 24,
            text: 'v1 feedback to import',
            author: '리뷰어',
            createdAt: '2026-07-03T10:00:00.000Z',
            updatedAt: '2026-07-03T11:00:00.000Z',
            resolved: true,
            resolvedBy: '배한솔',
            resolvedAt: '2026-07-03T12:00:00.000Z',
            colorKey: 'yellow',
            image: 'data:image/png;base64,source-marker-image',
            imageWidth: 640,
            imageHeight: 360,
            replies: [
              {
                id: 'source-reply',
                text: 'reply with image',
                author: '답글러',
                createdAt: '2026-07-03T10:30:00.000Z',
                updatedAt: '2026-07-03T10:40:00.000Z',
                image: 'data:image/png;base64,source-reply-image',
                imageWidth: 320,
                imageHeight: 180
              }
            ]
          },
          {
            id: 'deleted-source-marker',
            layerId: 'source-layer',
            text: 'deleted feedback should not import',
            deleted: true,
            replies: []
          }
        ]
      }
    ]
  };
}

test('imports source markers into target comments without removing target markers', async () => {
  const { importFeedbackIntoTargetComments } = await loadModule();
  const result = importFeedbackIntoTargetComments(
    createTargetComments(),
    createSourceComments(),
    {
      createId: createIdFactory(),
      targetLayerId: 'target-layer'
    }
  );

  assert.equal(result.importedCount, 1);
  assert.equal(result.comments.layers.length, 1);
  assert.deepEqual(
    result.comments.layers[0].markers.map(marker => marker.text),
    ['v2 existing feedback', 'v1 feedback to import']
  );
});

test('copies replies and attached images while assigning new IDs', async () => {
  const { cloneFeedbackMarkers } = await loadModule();
  const [cloned] = cloneFeedbackMarkers(createSourceComments(), {
    createId: createIdFactory(),
    targetLayerId: 'target-layer'
  });

  assert.notEqual(cloned.id, 'source-marker');
  assert.equal(cloned.id, 'marker-copy-1');
  assert.equal(cloned.layerId, 'target-layer');
  assert.equal(cloned.image, 'data:image/png;base64,source-marker-image');
  assert.equal(cloned.imageWidth, 640);
  assert.equal(cloned.imageHeight, 360);
  assert.equal(cloned.resolved, true);
  assert.equal(cloned.resolvedBy, '배한솔');
  assert.equal(cloned.replies.length, 1);
  assert.notEqual(cloned.replies[0].id, 'source-reply');
  assert.equal(cloned.replies[0].id, 'reply-copy-2');
  assert.equal(cloned.replies[0].image, 'data:image/png;base64,source-reply-image');
  assert.equal(cloned.replies[0].imageWidth, 320);
  assert.equal(cloned.replies[0].imageHeight, 180);
});

test('returns zero importable markers for empty or missing comment layers', async () => {
  const { countImportableFeedbackMarkers, importFeedbackIntoTargetComments } = await loadModule();

  assert.equal(countImportableFeedbackMarkers(null), 0);
  assert.equal(countImportableFeedbackMarkers({ layers: [] }), 0);
  assert.equal(countImportableFeedbackMarkers({ layers: [{ markers: [{ deleted: true }] }] }), 0);

  const result = importFeedbackIntoTargetComments(createTargetComments(), { layers: [] }, {
    createId: createIdFactory(),
    targetLayerId: 'target-layer'
  });

  assert.equal(result.importedCount, 0);
  assert.deepEqual(
    result.comments.layers[0].markers.map(marker => marker.id),
    ['target-marker']
  );
});

test('normalizes legacy source review comments before import', async () => {
  const {
    countImportableFeedbackMarkers,
    importFeedbackIntoTargetComments,
    normalizeFeedbackSourceComments
  } = await loadModule();
  const legacySourceReview = {
    version: '1.0',
    videoPath: 'C:/videos/version-1.mp4',
    comments: [
      {
        id: 'legacy-marker',
        x: 0.25,
        y: 0.75,
        startFrame: 10,
        endFrame: 20,
        fps: 24,
        text: 'legacy feedback',
        author: '예전 리뷰어',
        image: 'data:image/png;base64,legacy-marker-image',
        replies: [
          {
            id: 'legacy-reply',
            text: 'legacy reply',
            author: '답글러',
            image: 'data:image/png;base64,legacy-reply-image'
          }
        ]
      }
    ]
  };

  const sourceComments = normalizeFeedbackSourceComments(legacySourceReview);
  assert.equal(countImportableFeedbackMarkers(sourceComments), 1);

  const result = importFeedbackIntoTargetComments(
    createTargetComments(),
    sourceComments,
    {
      createId: createIdFactory(),
      targetLayerId: 'target-layer'
    }
  );

  assert.equal(result.importedCount, 1);
  assert.deepEqual(
    result.comments.layers[0].markers.map(marker => marker.text),
    ['v2 existing feedback', 'legacy feedback']
  );
  assert.equal(result.importedMarkers[0].image, 'data:image/png;base64,legacy-marker-image');
  assert.match(result.importedMarkers[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result.importedMarkers[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.importedMarkers[0].replies[0].image, 'data:image/png;base64,legacy-reply-image');
  assert.match(result.importedMarkers[0].replies[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
});
