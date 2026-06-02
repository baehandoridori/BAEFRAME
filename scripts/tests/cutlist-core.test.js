import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortCutsBySceneNumber,
  applyManualCutOrder,
  buildMissingSceneRows,
  buildCutlistTimeline,
  mapGlobalTimeToCut,
  mapCutFrameToSourceTime,
  findCurrentCut
} from '../../renderer/scripts/modules/cutlist-core.js';

const cuts = [
  { id: 'cut_20', sourceId: 'A', sceneNumber: 20, label: 'a020', startFrame: 0, endFrame: 73, fps: 24 },
  { id: 'cut_23', sourceId: 'B', sceneNumber: 23, label: 'sc023', startFrame: 41, endFrame: 91, fps: 24 },
  { id: 'cut_22', sourceId: 'A', sceneNumber: 22, label: 'a022', startFrame: 74, endFrame: 99, fps: 24 }
];

test('sorts by scene number then source label', () => {
  assert.deepEqual(sortCutsBySceneNumber(cuts).map(c => c.id), ['cut_20', 'cut_22', 'cut_23']);
});

test('applies saved manual order', () => {
  const ordered = applyManualCutOrder(cuts, ['cut_23', 'cut_20']);
  assert.deepEqual(ordered.map(c => c.id), ['cut_23', 'cut_20', 'cut_22']);
});

test('builds missing scene rows when option is enabled', () => {
  const rows = buildMissingSceneRows(sortCutsBySceneNumber(cuts), { showMissingScenes: true });
  assert.deepEqual(rows.map(row => row.label), ['a020', 'a021 없음', 'a022', 'sc023']);
  assert.equal(rows[1].missing, true);
});

test('builds timeline using cut frame counts', () => {
  const timeline = buildCutlistTimeline(sortCutsBySceneNumber(cuts));

  assert.equal(timeline.totalFrames, 151);
  assert.equal(timeline.totalDuration, 151 / 24);
  assert.deepEqual(timeline.segments.map(s => ({
    id: s.cutId,
    startFrame: s.globalStartFrame,
    endFrame: s.globalEndFrame
  })), [
    { id: 'cut_20', startFrame: 0, endFrame: 73 },
    { id: 'cut_22', startFrame: 74, endFrame: 99 },
    { id: 'cut_23', startFrame: 100, endFrame: 150 }
  ]);
});

test('maps global time to cut and source local time', () => {
  const timeline = buildCutlistTimeline(sortCutsBySceneNumber(cuts));
  const mapped = mapGlobalTimeToCut(timeline.segments, 100 / 24);

  assert.equal(mapped.segment.cutId, 'cut_23');
  assert.equal(mapped.localFrame, 0);
  assert.equal(mapped.sourceFrame, 41);
});

test('maps exact timeline boundaries to the playable cut at that time', () => {
  const timeline = buildCutlistTimeline(sortCutsBySceneNumber(cuts));

  const lastFrameOfCutA = mapGlobalTimeToCut(timeline.segments, 73 / 24);
  const firstFrameOfCutB = mapGlobalTimeToCut(timeline.segments, 74 / 24);

  assert.equal(lastFrameOfCutA.segment.cutId, 'cut_20');
  assert.equal(lastFrameOfCutA.localFrame, 73);
  assert.equal(firstFrameOfCutB.segment.cutId, 'cut_22');
  assert.equal(firstFrameOfCutB.localFrame, 0);
});

test('maps total duration to the final frame of the last playable segment', () => {
  const timeline = buildCutlistTimeline([
    { id: 'cut_a', sourceId: 'A', label: 'a001', startFrame: 10, endFrame: 11, fps: 24 },
    { id: 'cut_empty', sourceId: 'A', label: 'a002', startFrame: 20, endFrame: 19, fps: 24 }
  ]);
  const mapped = mapGlobalTimeToCut(timeline.segments, timeline.totalDuration);

  assert.equal(mapped.segment.cutId, 'cut_a');
  assert.equal(mapped.localFrame, 1);
  assert.equal(mapped.sourceFrame, 11);
});

test('returns null when mapping beyond the timeline and no segment is playable', () => {
  const timeline = buildCutlistTimeline([
    { id: 'cut_empty', sourceId: 'A', label: 'a001', startFrame: 20, endFrame: 19, fps: 24 }
  ]);

  assert.equal(mapGlobalTimeToCut(timeline.segments, timeline.totalDuration), null);
});

test('maps a source frame to seconds', () => {
  assert.equal(mapCutFrameToSourceTime({ startFrame: 41, fps: 24 }, 3), 44 / 24);
});

test('falls back to 24 fps for invalid cut fps values', () => {
  const timeline = buildCutlistTimeline([
    { id: 'cut_zero_fps', sourceId: 'A', label: 'a001', startFrame: 0, endFrame: 23, fps: 0 },
    { id: 'cut_null_fps', sourceId: 'A', label: 'a002', startFrame: 24, endFrame: 47, fps: null },
    { id: 'cut_bad_fps', sourceId: 'A', label: 'a003', startFrame: 48, endFrame: 71, fps: 'bad' }
  ]);

  assert.deepEqual(timeline.segments.map(segment => segment.duration), [1, 1, 1]);
  assert.equal(mapCutFrameToSourceTime({ startFrame: 41, fps: 0 }, 7), 48 / 24);
  assert.equal(mapCutFrameToSourceTime({ startFrame: 41, fps: null }, 7), 48 / 24);
  assert.equal(mapCutFrameToSourceTime({ startFrame: 41, fps: 'bad' }, 7), 48 / 24);
});

test('finds current cut by source id and frame', () => {
  assert.equal(findCurrentCut(cuts, { sourceId: 'B', frame: 91 }).id, 'cut_23');
  assert.equal(findCurrentCut(cuts, { sourceId: 'B', frame: 92 }), null);
});

test('ignores malformed cut bounds when finding the current cut', () => {
  const malformedCuts = [
    { id: 'null_start', sourceId: 'A', startFrame: null, endFrame: 10 },
    { id: 'empty_start', sourceId: 'A', startFrame: '', endFrame: 10 },
    { id: 'nan_end', sourceId: 'A', startFrame: 0, endFrame: 'bad' },
    { id: 'inverted_bounds', sourceId: 'A', startFrame: 30, endFrame: 20 },
    { id: 'valid_cut', sourceId: 'A', startFrame: 0, endFrame: 10 }
  ];

  assert.equal(findCurrentCut(malformedCuts, { sourceId: 'A', frame: 0 }).id, 'valid_cut');
  assert.equal(findCurrentCut(malformedCuts.slice(0, 4), { sourceId: 'A', frame: 0 }), null);
});
