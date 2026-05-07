const { test } = require('node:test');
const assert = require('node:assert/strict');

let mod;

test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/playlist-comment-index.js');
});

test('영상별 댓글 프레임을 전역 시간으로 변환한다', () => {
  const bframeData = {
    fps: 24,
    comments: {
      layers: [
        {
          id: 'layer-1',
          visible: true,
          color: '#ffcc00',
          markers: [
            {
              id: 'm1',
              startFrame: 24,
              endFrame: 48,
              text: 'check',
              resolved: false,
              authorId: 'user-1'
            }
          ]
        }
      ]
    }
  };
  const segment = { itemId: 'item-1', index: 1, fileName: 'b.mp4', startTime: 10, duration: 5, fps: 24 };

  const ranges = mod.extractPlaylistCommentRanges({
    bframeData,
    segment,
    visibleLayerIds: null,
    allowedAuthorIds: null
  });

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].globalStartTime, 11);
  assert.equal(ranges[0].globalEndTime, 12);
  assert.equal(ranges[0].itemId, 'item-1');
  assert.equal(ranges[0].markerId, 'm1');
});

test('숨겨진 레이어는 통합 댓글에서 제외한다', () => {
  const bframeData = {
    fps: 24,
    comments: {
      layers: [
        { id: 'hidden', visible: false, markers: [{ id: 'm1', startFrame: 0, endFrame: 24 }] }
      ]
    }
  };
  const segment = { itemId: 'item-1', startTime: 0, duration: 5, fps: 24 };

  const ranges = mod.extractPlaylistCommentRanges({
    bframeData,
    segment,
    visibleLayerIds: null,
    allowedAuthorIds: null
  });

  assert.equal(ranges.length, 0);
});

test('레이어와 작성자 필터를 적용한다', () => {
  const bframeData = {
    fps: 10,
    comments: {
      layers: [
        {
          id: 'layer-a',
          visible: true,
          markers: [
            { id: 'allowed', startFrame: 10, endFrame: 20, authorId: 'user-a' },
            { id: 'blocked-author', startFrame: 30, endFrame: 40, authorId: 'user-b' }
          ]
        },
        {
          id: 'layer-b',
          visible: true,
          markers: [
            { id: 'blocked-layer', startFrame: 50, endFrame: 60, authorId: 'user-a' }
          ]
        }
      ]
    }
  };
  const segment = { itemId: 'item-1', startTime: 5, duration: 10, fps: 10 };

  const ranges = mod.extractPlaylistCommentRanges({
    bframeData,
    segment,
    visibleLayerIds: new Set(['layer-a']),
    allowedAuthorIds: new Set(['user-a'])
  });

  assert.deepEqual(ranges.map(range => range.markerId), ['allowed']);
  assert.equal(ranges[0].globalStartTime, 6);
});
