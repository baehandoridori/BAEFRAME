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

test('maps a source frame to seconds', () => {
  assert.equal(mapCutFrameToSourceTime({ startFrame: 41, fps: 24 }, 3), 44 / 24);
});

test('finds current cut by source id and frame', () => {
  assert.equal(findCurrentCut(cuts, { sourceId: 'B', frame: 91 }).id, 'cut_23');
  assert.equal(findCurrentCut(cuts, { sourceId: 'B', frame: 92 }), null);
});
