import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMohoSceneInfo,
  mergeDuplicateSceneCuts,
  buildCutsFromMohoSceneInfo
} from '../../renderer/scripts/modules/moho-scene-info-parser.js';
import {
  createCutlistSource,
  createDefaultCutlistData,
  validateCutlistData
} from '../../shared/cutlist-schema.js';

const SAMPLE = `SW Timeline Scene Info
======================
Marker Level: Document
Project Path: G:\\shot\\a019, a023, a028_re6.moho
FPS: 24.0
Document Range: 1 - 204
Scene Count: 5

01. sc019
    Range: 1 - 11
    Frames: 11f
    Length: 00분 00초 11프레임 (00:00:11)

02. 실제 사운드 시작지점
    Range: 12 - 41
    Frames: 30f

03. sc023
    Range: 42 - 92
    Frames: 51f

04. a028
    Range: 93 - 204
    Frames: 112f

05. a028
    Range: 205 - 205
    Frames: 1f
`;

test('parses fps, project path, and scene blocks', () => {
  const parsed = parseMohoSceneInfo(SAMPLE);

  assert.equal(parsed.fps, 24);
  assert.equal(parsed.projectPath, 'G:\\shot\\a019, a023, a028_re6.moho');
  assert.equal(parsed.entries.length, 5);
  assert.equal(parsed.entries[2].label, 'sc023');
  assert.equal(parsed.entries[2].mohoStartFrame, 42);
  assert.equal(parsed.entries[2].mohoEndFrame, 92);
});

test('builds scene cuts from numeric labels and applies minus-one frame offset', () => {
  const result = buildCutsFromMohoSceneInfo(SAMPLE, { sourceId: 'source_1' });

  assert.deepEqual(result.cuts.map(c => c.label), ['sc019', 'sc023', 'a028']);
  assert.deepEqual(result.cuts.map(c => c.sceneNumber), [19, 23, 28]);
  assert.deepEqual(result.cuts.find(c => c.label === 'sc023'), {
    id: 'source_1_23_41_91',
    sourceId: 'source_1',
    sceneNumber: 23,
    label: 'sc023',
    startFrame: 41,
    endFrame: 91,
    mohoStartFrame: 42,
    mohoEndFrame: 92,
    frameCount: 51,
    fps: 24,
    order: 1,
    ignored: false
  });
});

test('builds schema-valid cuts for default cutlist data', () => {
  const result = buildCutsFromMohoSceneInfo(SAMPLE, { sourceId: 'source_1' });
  const data = createDefaultCutlistData({ name: 'parser output' });
  data.sources.push(createCutlistSource({
    id: 'source_1',
    videoPath: 'G:/shot/a019.mp4',
    infoPath: 'G:/shot/a019_info.txt',
    infoText: SAMPLE,
    fileName: 'a019.mp4',
    fps: result.fps,
    missing: false,
    addedAt: '2026-05-23T00:00:00.000Z'
  }));
  data.cuts.push(...result.cuts);

  const validation = validateCutlistData(data);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test('reports ignored memo labels and short duplicate scenes', () => {
  const result = buildCutsFromMohoSceneInfo(SAMPLE, { sourceId: 'source_1' });

  assert.equal(result.ignored.length, 2);
  assert.equal(result.ignored[0].label, '실제 사운드 시작지점');
  assert.equal(result.ignored[0].reason, 'scene-label-not-numbered');
  assert.equal(result.ignored[1].label, 'a028');
  assert.equal(result.ignored[1].reason, 'duplicate-shorter-scene');
});

test('ignores scene labels with reversed ranges', () => {
  const reversedRange = `SW Timeline Scene Info
======================
FPS: 24.0

01. sc020
    Range: 20 - 10
    Frames: 11f
`;

  const result = buildCutsFromMohoSceneInfo(reversedRange, { sourceId: 'source_1' });

  assert.deepEqual(result.cuts, []);
  assert.equal(result.ignored.length, 1);
  assert.equal(result.ignored[0].label, 'sc020');
  assert.equal(result.ignored[0].reason, 'scene-range-invalid');
});

test('accepts flexible numeric scene labels while preserving display labels', () => {
  const flexibleLabels = `SW Timeline Scene Info
======================
FPS: 24.0

01. a20
    Range: 1 - 10

02. a020
    Range: 11 - 30

03. a0020
    Range: 31 - 35

04. SC 023
    Range: 36 - 40
`;

  const result = buildCutsFromMohoSceneInfo(flexibleLabels, { sourceId: 'source_1' });

  assert.deepEqual(result.cuts.map(cut => cut.label), ['a020', 'SC 023']);
  assert.deepEqual(result.cuts.map(cut => cut.sceneNumber), [20, 23]);
  assert.equal(result.ignored.length, 2);
  assert.deepEqual(result.ignored.map(entry => entry.label), ['a20', 'a0020']);
  assert.deepEqual(result.ignored.map(entry => entry.reason), ['duplicate-shorter-scene', 'duplicate-shorter-scene']);
});

test('keeps the longest duplicate scene per scene number', () => {
  const cuts = [
    { sceneNumber: 28, label: 'a028', frameCount: 112, startFrame: 92, endFrame: 203 },
    { sceneNumber: 28, label: 'a028', frameCount: 1, startFrame: 204, endFrame: 204 }
  ];

  const result = mergeDuplicateSceneCuts(cuts);

  assert.equal(result.cuts.length, 1);
  assert.equal(result.cuts[0].frameCount, 112);
  assert.equal(result.ignored[0].reason, 'duplicate-shorter-scene');
});

test('keeps the duplicate scene with the longest range even when Frames is misleading', () => {
  const misleadingFrames = `SW Timeline Scene Info
======================
FPS: 24.0

01. sc019
    Range: 1 - 10
    Frames: 999f

02. sc019
    Range: 11 - 60
    Frames: 1f
`;

  const result = buildCutsFromMohoSceneInfo(misleadingFrames, { sourceId: 'source_1' });

  assert.equal(result.cuts.length, 1);
  assert.equal(result.cuts[0].startFrame, 10);
  assert.equal(result.cuts[0].endFrame, 59);
  assert.equal(result.ignored.length, 1);
  assert.equal(result.ignored[0].startFrame, 0);
  assert.equal(result.ignored[0].endFrame, 9);
  assert.equal(result.ignored[0].reason, 'duplicate-shorter-scene');
});
