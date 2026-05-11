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

test('통합 댓글은 우측 패널과 라벨에 필요한 컷/작성자/시간 정보를 보존한다', () => {
  const bframeData = {
    fps: 24,
    comments: {
      layers: [
        {
          id: 'layer-a',
          visible: true,
          color: '#33cc88',
          markers: [
            {
              id: 'm1',
              startFrame: 46,
              endFrame: 70,
              text: '입 모양 확인',
              resolved: false,
              author: '민지',
              authorId: 'user-a',
              createdAt: '2026-05-09T01:00:00.000Z',
              replies: [{ id: 'r1', text: '확인했습니다' }],
              image: 'data:image/png;base64,abc'
            }
          ]
        }
      ]
    }
  };
  const segment = {
    itemId: 'item-2',
    index: 1,
    fileName: 'a002.mov',
    startTime: 65,
    duration: 10,
    fps: 24
  };

  const ranges = mod.extractPlaylistCommentRanges({
    bframeData,
    segment,
    visibleLayerIds: null,
    allowedAuthorIds: null
  });

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].author, '민지');
  assert.equal(ranges[0].authorId, 'user-a');
  assert.equal(ranges[0].createdAt, '2026-05-09T01:00:00.000Z');
  assert.equal(ranges[0].replies.length, 1);
  assert.equal(ranges[0].image, 'data:image/png;base64,abc');
  assert.equal(ranges[0].cutLabel, 'a002');
  assert.equal(ranges[0].localStartTimecode, '00:00:01:22');
  assert.equal(ranges[0].globalStartTimecode, '00:01:06:22');
});

test('통합 댓글 라벨은 컷 이름과 컷 내부 시간을 짧게 표시한다', () => {
  assert.equal(typeof mod.formatPlaylistCommentLabel, 'function');
  assert.equal(typeof mod.formatPlaylistCommentPanelLine, 'function');

  const range = {
    cutLabel: 'a001',
    fileName: 'a001.mp4',
    localStartTime: 5 + 22 / 24,
    globalStartTime: 12 + 3 / 24,
    fps: 24,
    text: '손 위치 확인'
  };

  assert.equal(mod.formatPlaylistCommentLabel(range), 'a001 00:00:05:22');
  assert.equal(mod.formatPlaylistCommentPanelLine(range), 'a001 00:00:05:22 - 손 위치 확인');
});

test('통합 댓글 위치는 저장된 리뷰 fps보다 현재 세그먼트 fps를 우선한다', () => {
  const bframeData = {
    fps: 24,
    comments: {
      layers: [
        {
          id: 'layer-a',
          visible: true,
          markers: [
            { id: 'm1', startFrame: 60, endFrame: 90, text: 'fps 위치 확인' }
          ]
        }
      ]
    }
  };
  const segment = {
    itemId: 'item-1',
    index: 0,
    fileName: 'shot.mov',
    startTime: 10,
    duration: 5,
    fps: 30
  };

  const [range] = mod.extractPlaylistCommentRanges({
    bframeData,
    segment,
    visibleLayerIds: null,
    allowedAuthorIds: null
  });

  assert.equal(range.localStartTime, 2);
  assert.equal(range.globalStartTime, 12);
  assert.equal(range.localStartTimecode, '00:00:02:00');
});
