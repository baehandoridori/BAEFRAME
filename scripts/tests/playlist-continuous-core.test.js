const { test } = require('node:test');
const assert = require('node:assert/strict');

let mod;

test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/playlist-continuous-core.js');
});

test('재생목록 항목을 하나의 전역 시간 세그먼트로 만든다', () => {
  const items = [
    { id: 'a', fileName: 'a.mp4' },
    { id: 'b', fileName: 'b.mp4' }
  ];

  const result = mod.buildPlaylistSegments(items, new Map([
    ['a', { duration: 10, fps: 24 }],
    ['b', { duration: 5, fps: 30 }]
  ]));

  assert.equal(result.totalDuration, 15);
  assert.deepEqual(result.segments.map(s => [s.itemId, s.startTime, s.endTime]), [
    ['a', 0, 10],
    ['b', 10, 15]
  ]);
});

test('전역 시간을 해당 영상과 로컬 시간으로 변환한다', () => {
  const segments = [
    { itemId: 'a', index: 0, startTime: 0, endTime: 10, duration: 10 },
    { itemId: 'b', index: 1, startTime: 10, endTime: 15, duration: 5 }
  ];

  const mapped = mod.mapGlobalTimeToSegment(segments, 12.25);

  assert.equal(mapped.segment.itemId, 'b');
  assert.equal(mapped.localTime, 2.25);
});

test('현재 영상은 유지하고 다음 재생부터 새 순서를 따른다', () => {
  const items = [
    { id: 'current', fileName: 'current.mp4' },
    { id: 'skip', fileName: 'skip.mp4', continuousStatus: 'skipped' },
    { id: 'next', fileName: 'next.mp4' }
  ];

  const next = mod.findNextPlayableIndex(items, 0, { loop: false });

  assert.equal(next, 2);
});

test('반복 재생이 켜져 있으면 마지막 뒤에 첫 번째 재생 가능 항목으로 돌아간다', () => {
  const items = [
    { id: 'first', fileName: 'first.mp4' },
    { id: 'last', fileName: 'last.mp4' }
  ];

  const next = mod.findNextPlayableIndex(items, 1, { loop: true });

  assert.equal(next, 0);
});

test('연속 실패 토스트 메시지를 묶어서 만든다', () => {
  const message = mod.createSkippedToastMessage([
    { fileName: 'a.mp4' },
    { fileName: 'b.mp4' },
    { fileName: 'c.mp4' }
  ]);

  assert.equal(message, '3개 영상을 건너뜀');
});
