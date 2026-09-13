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

test('통합 댓글 구간은 세그먼트 길이를 넘지 않게 자른다', () => {
  const bframeData = {
    fps: 10,
    comments: {
      layers: [
        {
          id: 'layer-a',
          visible: true,
          markers: [
            { id: 'm1', startFrame: 40, endFrame: 80, text: '끝 구간 확인' }
          ]
        }
      ]
    }
  };
  const segment = {
    itemId: 'item-1',
    index: 0,
    fileName: 'short.mov',
    startTime: 100,
    duration: 5,
    fps: 10
  };

  const [range] = mod.extractPlaylistCommentRanges({
    bframeData,
    segment,
    visibleLayerIds: null,
    allowedAuthorIds: null
  });

  assert.equal(range.localStartTime, 4);
  assert.equal(range.localEndTime, 5);
  assert.equal(range.globalStartTime, 104);
  assert.equal(range.globalEndTime, 105);
  assert.equal(range.endFrame, 50);
});

test('통합 댓글 키는 한 헬퍼에서 만든다', () => {
  assert.equal(typeof mod.getPlaylistAggregateCommentKey, 'function');
  assert.equal(
    mod.getPlaylistAggregateCommentKey({ itemId: 'item-1', layerId: 'layer-a', markerId: 'm1' }),
    'item-1:layer-a:m1'
  );
});

test('zero and missing frames are different and malformed times remain visible without seeking', async () => {
  const m = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  assert.equal(m.readPlaylistMarkerFrame(0), 0);
  assert.equal(m.readPlaylistMarkerFrame('32'), 32);
  for (const value of [null, undefined, '', ' ', 'bad', -1, 1.2, Infinity, NaN, true, {}]) assert.equal(m.readPlaylistMarkerFrame(value), null);
  const ranges = m.extractPlaylistCommentRanges({ segment: { itemId: 'a', startTime: 0, duration: 3, fps: 24 }, bframeData: { comments: { layers: [{ markers: [{ id: 'bad' }, { id: 'zero', startFrame: 0 }] }] } } });
  assert.equal(ranges[0].markerId, 'zero');
  assert.equal(ranges[1].timingValid, false);
  assert.equal(ranges[1].localStartFrame, null);
  assert.equal(ranges[1].globalStartTime, null);
  assert.match(m.formatPlaylistCommentLabel(ranges[1]), /시간 정보 없음/);
});

test('numeric frames override stale labels for integer and fractional segment fps', async () => {
  const m = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  for (const fps of [24, 30, 23.976, 29.97]) {
    const [range] = m.extractPlaylistCommentRanges({ segment: { itemId: 'a', startTime: 3, duration: 5, fps }, bframeData: { fps: 60, comments: { layers: [{ markers: [{ startFrame: 32, endFrame: 'bad', fps: 60 }] }] } } });
    assert.equal(range.localStartTime, 32 / fps);
    assert.equal(range.localEndFrame, 32);
    assert.equal(m.formatPlaylistCommentLabel({ ...range, localStartTimecode: '00:00:00:00' }), `${m.getPlaylistCutLabel(range)} ${range.localStartTimecode}`);
  }
});


test('loaded comments retain genuine zero, missing time, and single-frame endpoints', async () => {
  const { CommentMarker } = await import('../../renderer/scripts/modules/comment-manager.js');
  const zero = CommentMarker.fromJSON({ id: 'zero', startFrame: 0, endFrame: 0, createdAt: '2026-09-14T00:00:00Z' });
  assert.equal(zero.endFrame, 0);
  const missing = CommentMarker.fromJSON({ id: 'missing', createdAt: '2026-09-14T00:00:00Z' });
  assert.equal(missing.startFrame, undefined);
  assert.equal(missing.isVisibleAtFrame(0), false);
  const single = CommentMarker.fromJSON({ id: 'single', startFrame: 32, createdAt: '2026-09-14T00:00:00Z' });
  assert.equal(single.endFrame, 32);
  assert.equal(single.isVisibleAtFrame(32), true);
  assert.equal(single.isVisibleAtFrame(33), false);
});


test('untimed loaded markers stay out of marker navigation and timeline ranges while real zero stays usable', async () => {
  const { CommentMarker, CommentManager } = await import('../../renderer/scripts/modules/comment-manager.js');
  const markers = [undefined, null, -1, 'bad', true, 0, 24].map((startFrame, i) => CommentMarker.fromJSON({ id: String(i), startFrame, createdAt: '2026-09-14T00:00:00Z' }));
  for (const marker of markers.slice(0, 5)) assert.equal(marker.startTimecode, '시간 정보 없음');
  assert.equal(markers[5].startTimecode, '00:00:00:00');
  const context = { layers: [{ id: 'l', getAllMarkers: () => markers }], getAllMarkers: () => markers };
  assert.equal(CommentManager.prototype.getPrevMarkerFrame.call(context, 12), 0);
  assert.equal(CommentManager.prototype.getNextMarkerFrame.call(context, 0), 24);
  assert.deepEqual(CommentManager.prototype.getMarkerRanges.call(context).map(r => r.startFrame), [0, 24]);
});


test('implicit one-frame loaded ranges preserve an absent endpoint on unrelated saves', async () => {
  const { CommentMarker } = await import('../../renderer/scripts/modules/comment-manager.js');
  const loaded = CommentMarker.fromJSON({ id: 'legacy', startFrame: 32, createdAt: '2026-09-14T00:00:00Z' });
  assert.equal(loaded.isVisibleAtFrame(32), true); assert.equal(loaded.isVisibleAtFrame(33), false);
  loaded.text = 'edited'; assert.equal(Object.hasOwn(loaded.toJSON(), 'endFrame'), false);
  loaded.setDuration(12); assert.equal(loaded.toJSON().endFrame, 44);
  const created = new CommentMarker({ startFrame: 32, fps: 24 });
  assert.equal(created.toJSON().endFrame, 128, 'new comments keep the four-second creation default');
});

for (const fps of [23.976, 29.97]) { test(`new four-second comments use integer endpoints at ${fps}fps`, async t => {
  const { CommentMarker, CommentManager } = await import('../../renderer/scripts/modules/comment-manager.js');
  const priorWindow = global.window; global.window = {}; t.after(() => { global.window = priorWindow; });
  const expected = 32 + Math.round(fps * 4);
  const direct = new CommentMarker({ startFrame: 32, fps });
  assert.equal(direct.endFrame, expected);
  const context = { isCommentMode: true, currentFrame: 32, fps, _emit() {} };
  const marker = CommentManager.prototype.startMarkerCreation.call(context, .5, .5);
  assert.equal(marker.endFrame, expected);
  const loaded = CommentMarker.fromJSON(marker.toJSON());
  assert.equal(loaded.endFrame, expected); assert.equal(loaded.isVisibleAtFrame(expected - 1), true);
});
}
