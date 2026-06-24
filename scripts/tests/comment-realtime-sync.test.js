const { test } = require('node:test');
const assert = require('node:assert/strict');

if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      this.detail = options.detail;
    }
  };
}

global.window = global.window || {};

test('adding a reply advances the parent marker revision time for file sync', async () => {
  const { CommentMarker } = await import('../../renderer/scripts/modules/comment-manager.js');
  const oldRevision = new Date('2026-01-01T00:00:00.000Z');
  const marker = new CommentMarker({
    id: 'marker-1',
    text: '원댓글',
    createdAt: oldRevision,
    updatedAt: oldRevision
  });

  const reply = marker.addReply({ text: '새 대댓글', author: '민지' });

  assert.ok(reply.updatedAt, 'reply should carry its own revision time');
  assert.ok(new Date(marker.updatedAt).getTime() > oldRevision.getTime());
  assert.equal(new Date(marker.updatedAt).getTime(), new Date(reply.updatedAt).getTime());
});

test('remote reply add and delete emit the same refresh signals as local changes', async () => {
  const { CommentManager, CommentMarker } = await import('../../renderer/scripts/modules/comment-manager.js');
  const manager = new CommentManager({ author: '테스터' });
  const marker = new CommentMarker({
    id: 'marker-1',
    text: '원댓글',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  });
  manager.getActiveLayer().addMarker(marker);

  const events = [];
  ['replyAdded', 'replyDeleted', 'markerUpdated', 'markersChanged'].forEach(eventName => {
    manager.addEventListener(eventName, () => events.push(eventName));
  });

  const addRevision = '2026-01-01T00:01:00.000Z';
  assert.equal(manager.applyRemoteReplyAdd('marker-1', {
    id: 'reply-1',
    text: '원격 대댓글',
    author: '수현',
    createdAt: addRevision,
    updatedAt: addRevision
  }, addRevision), true);

  assert.deepEqual(events, ['replyAdded', 'markerUpdated', 'markersChanged']);
  assert.equal(marker.replies.length, 1);
  assert.equal(new Date(marker.updatedAt).toISOString(), addRevision);

  events.length = 0;
  const deleteRevision = '2026-01-01T00:02:00.000Z';
  assert.equal(manager.applyRemoteReplyDelete('marker-1', 'reply-1', deleteRevision), true);

  assert.deepEqual(events, ['replyDeleted', 'markerUpdated', 'markersChanged']);
  assert.equal(marker.replies.length, 0);
  assert.equal(new Date(marker.updatedAt).toISOString(), deleteRevision);
});

test('file reload merge accepts newer remote replies even when marker updatedAt is unchanged', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const localMarker = {
    id: 'marker-1',
    text: '원댓글',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    replies: []
  };
  const remoteMarker = {
    ...localMarker,
    replies: [{
      id: 'reply-1',
      text: '원격 대댓글',
      author: '수현',
      createdAt: '2026-01-01T00:01:00.000Z'
    }]
  };

  let appliedComments = null;
  const commentManager = {
    toJSON: () => ({
      layers: [{ id: 'layer-1', markers: [localMarker] }]
    }),
    fromJSON: comments => {
      appliedComments = comments;
    }
  };

  window.electronAPI = {
    loadReview: async () => ({
      comments: {
        layers: [{ id: 'layer-1', markers: [remoteMarker] }]
      }
    })
  };

  const manager = new ReviewDataManager({ commentManager });
  manager.currentBframePath = 'C:/review.bframe';

  const result = await manager.reloadAndMerge({ merge: true, force: true });

  assert.equal(result.success, true);
  assert.equal(result.updated, 1);
  assert.equal(appliedComments.layers[0].markers[0].replies.length, 1);
  assert.equal(appliedComments.layers[0].markers[0].replies[0].text, '원격 대댓글');
});
