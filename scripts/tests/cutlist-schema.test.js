import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUTLIST_VERSION,
  createDefaultCutlistData,
  validateCutlistData,
  createCutlistSource,
  createCutlistCut,
  isCutlistFilePath,
  suggestCutlistFileName
} from '../../shared/cutlist-schema.js';

test('creates valid default cutlist data', () => {
  const data = createDefaultCutlistData({ name: 'a019-a029', userName: 'tester', userId: 'u1' });

  assert.equal(data.cutlistVersion, CUTLIST_VERSION);
  assert.equal(data.name, 'a019-a029');
  assert.equal(data.createdBy, 'tester');
  assert.deepEqual(data.sources, []);
  assert.deepEqual(data.cuts, []);
  assert.equal(data.settings.showMissingScenes, false);
  assert.equal(validateCutlistData(data).valid, true);
});

test('validates required source and cut fields', () => {
  const data = createDefaultCutlistData({ name: 'demo' });
  data.sources.push(createCutlistSource({
    id: 'source_1',
    videoPath: 'G:/shot/a019.mp4',
    infoPath: 'G:/shot/a019_info.txt',
    infoText: 'FPS: 24.0',
    fileName: 'a019.mp4'
  }));
  data.cuts.push(createCutlistCut({
    id: 'cut_23',
    sourceId: 'source_1',
    sceneNumber: 23,
    label: 'sc023',
    startFrame: 41,
    endFrame: 91,
    mohoStartFrame: 42,
    mohoEndFrame: 92,
    fps: 24
  }));

  const result = validateCutlistData(data);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('rejects invalid cut ranges and missing paths', () => {
  const data = createDefaultCutlistData({ name: 'bad' });
  data.sources.push(createCutlistSource({ id: 'source_1', videoPath: '', infoPath: '', infoText: '' }));
  data.cuts.push(createCutlistCut({
    id: 'cut_bad',
    sourceId: 'source_1',
    sceneNumber: 1,
    label: 'a001',
    startFrame: 10,
    endFrame: 9,
    mohoStartFrame: 11,
    mohoEndFrame: 10,
    fps: 24
  }));

  const result = validateCutlistData(data);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /videoPath/);
  assert.match(result.errors.join('\n'), /endFrame/);
});

test('detects cutlist paths and suggests names', () => {
  assert.equal(isCutlistFilePath('G:/shot/a019-a029.bcutlist'), true);
  assert.equal(isCutlistFilePath('G:/shot/a019-a029.bplaylist'), false);
  assert.equal(suggestCutlistFileName([{ sceneNumber: 19 }, { sceneNumber: 29 }]), 'a019-a029.bcutlist');
});
