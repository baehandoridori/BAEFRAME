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

test('메타데이터 맵이 없어도 항목 시간 정보와 안전 기본값을 사용한다', () => {
  const items = [
    { id: 'a', fileName: 'a.mp4', duration: 10, fps: 30 },
    { id: 'b', fileName: 'b.mp4' }
  ];

  const result = mod.buildPlaylistSegments(items, null);

  assert.equal(result.totalDuration, 10);
  assert.deepEqual(result.segments.map(s => [s.itemId, s.duration, s.fps]), [
    ['a', 10, 30],
    ['b', 0, 24]
  ]);
});

test('잘못된 duration/fps 메타데이터는 안전한 값으로 보정한다', () => {
  const items = [
    { id: 'a', fileName: 'a.mp4', duration: 10, fps: 30 },
    { id: 'b', fileName: 'b.mp4', duration: 5, fps: 60 }
  ];

  const result = mod.buildPlaylistSegments(items, new Map([
    ['a', { duration: Infinity, fps: -30 }],
    ['b', { duration: -5, fps: Infinity }]
  ]));

  assert.equal(result.totalDuration, 0);
  assert.deepEqual(result.segments.map(s => [s.itemId, s.duration, s.fps]), [
    ['a', 0, 24],
    ['b', 0, 24]
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

test('세그먼트 경계와 정확히 같은 전역 시간은 다음 영상으로 매핑한다', () => {
  const segments = [
    { itemId: 'a', index: 0, startTime: 0, endTime: 10, duration: 10 },
    { itemId: 'b', index: 1, startTime: 10, endTime: 15, duration: 5 }
  ];

  const mapped = mod.mapGlobalTimeToSegment(segments, 10);

  assert.equal(mapped.segment.itemId, 'b');
  assert.equal(mapped.localTime, 0);
});

test('로컬 시간을 전역 시간으로 바꿀 때 세그먼트 길이를 넘지 않게 제한한다', () => {
  const segment = { itemId: 'a', index: 0, startTime: 10, endTime: 15, duration: 5 };

  assert.equal(mod.mapLocalTimeToGlobal(segment, 20), 15);
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

test('반복 재생이 켜져 있고 항목이 하나뿐이면 현재 항목을 다시 재생한다', () => {
  const items = [
    { id: 'only', fileName: 'only.mp4' }
  ];

  const next = mod.findNextPlayableIndex(items, 0, { loop: true });

  assert.equal(next, 0);
});

test('반복 재생에서 현재 항목만 재생 가능하면 현재 항목을 다시 재생한다', () => {
  const items = [
    { id: 'current', fileName: 'current.mp4' },
    { id: 'missing', fileName: 'missing.mp4', continuousStatus: 'missing' },
    { id: 'error', fileName: 'error.mp4', continuousStatus: 'error' }
  ];

  const next = mod.findNextPlayableIndex(items, 0, { loop: true });

  assert.equal(next, 0);
});

test('모든 항목이 건너뜀/누락/오류 상태면 반복 재생에서도 다음 항목을 찾지 않는다', () => {
  const items = [
    { id: 'skip', fileName: 'skip.mp4', continuousStatus: 'skipped' },
    { id: 'missing', fileName: 'missing.mp4', continuousStatus: 'missing' },
    { id: 'error', fileName: 'error.mp4', continuousStatus: 'error' }
  ];

  const next = mod.findNextPlayableIndex(items, 0, { loop: true });

  assert.equal(next, -1);
});

test('연속 실패 토스트 메시지를 묶어서 만든다', () => {
  const message = mod.createSkippedToastMessage([
    { fileName: 'a.mp4' },
    { fileName: 'b.mp4' },
    { fileName: 'c.mp4' }
  ]);

  assert.equal(message, '3개 영상을 건너뜀');
});
