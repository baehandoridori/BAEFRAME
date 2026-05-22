import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultCutlistData,
  createCutlistCut,
  createCutlistSource,
  validateCutlistData
} from '../../shared/cutlist-schema.js';
import { CutlistManager } from '../../renderer/scripts/modules/cutlist-manager.js';

const SAMPLE_INFO_TEXT = `SW Timeline Scene Info
======================
Project Path: G:\\shot\\a019, a023, a028_re6.moho
FPS: 24.0

01. sc019
    Range: 1 - 11
    Frames: 11f

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

function installWindow(apiOverrides = {}) {
  const dispatched = [];
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  globalThis.window = {
    appState: {
      userName: 'tester',
      sessionId: 'session-1'
    },
    electronAPI: {
      readCutlistInfoText: async () => SAMPLE_INFO_TEXT,
      readCutlist: async () => null,
      writeCutlist: async () => true,
      fileExists: async () => true,
      getFileInfo: async (filePath) => ({ filePath }),
      pathDirname: async (filePath) => filePath.replace(/[\\/][^\\/]+$/, ''),
      pathJoin: async (folderPath, fileName) => `${folderPath}\\${fileName}`,
      ...apiOverrides
    },
    dispatchEvent(event) {
      dispatched.push(event);
    }
  };
  return dispatched;
}

test('createNew creates valid default data and emits a change', () => {
  const dispatched = installWindow();
  const manager = new CutlistManager();
  let changedCount = 0;
  manager.onCutlistModified = () => {
    changedCount += 1;
  };

  const data = manager.createNew('a019-a029');

  assert.equal(data.name, 'a019-a029');
  assert.equal(data.createdBy, 'tester');
  assert.equal(validateCutlistData(data).valid, true);
  assert.equal(manager.currentCutlist, data);
  assert.equal(manager.isModified, true);
  assert.equal(changedCount, 1);
  assert.equal(dispatched.at(-1).type, 'cutlist:changed');
  assert.equal(dispatched.at(-1).detail.reason, 'createNew');
});

test('addSourcePair parses cuts, records ignored labels, orders cuts, and emits changed', async () => {
  installWindow({
    readCutlistInfoText: async (infoPath) => {
      assert.equal(infoPath, 'G:\\shot\\a019_info.txt');
      return SAMPLE_INFO_TEXT;
    }
  });
  const manager = new CutlistManager();
  let changedCount = 0;
  manager.onCutlistModified = () => {
    changedCount += 1;
  };
  manager.createNew('source pair');

  const result = await manager.addSourcePair('G:\\shot\\a019_info.txt', 'G:\\shot\\a019.mp4');

  assert.equal(manager.currentCutlist.sources.length, 1);
  assert.equal(manager.currentCutlist.sources[0].videoPath, 'G:\\shot\\a019.mp4');
  assert.equal(manager.currentCutlist.sources[0].infoText, SAMPLE_INFO_TEXT);
  assert.equal(manager.currentCutlist.sources[0].fileName, 'a019.mp4');
  assert.equal(manager.currentCutlist.sources[0].ignoredLabels.length, 2);
  assert.deepEqual(result.cuts.map(cut => cut.sceneNumber), [19, 23, 28]);
  assert.deepEqual(manager.getOrderedCuts().map(cut => cut.sceneNumber), [19, 23, 28]);
  const sc023 = manager.getOrderedCuts().find(cut => cut.label === 'sc023');
  assert.equal(sc023.startFrame, 41);
  assert.equal(sc023.endFrame, 91);
  assert.equal(sc023.mohoStartFrame, 42);
  assert.equal(sc023.mohoEndFrame, 92);
  assert.deepEqual(result.ignored.map(item => item.reason), [
    'scene-label-not-numbered',
    'duplicate-shorter-scene'
  ]);
  assert.equal(validateCutlistData(manager.currentCutlist).valid, true);
  assert.equal(changedCount, 2);
});

test('re-adding the same source pair selects an existing replacement cut', async () => {
  const dispatched = installWindow();
  const manager = new CutlistManager();
  manager.createNew('replace source pair');

  const original = await manager.addSourcePair('G:\\shot\\a019_info.txt', 'G:\\shot\\a019.mp4');
  const originallySelected = manager.selectCut(original.cuts[1].id);
  assert.ok(originallySelected);

  const originalCutIds = new Set(original.cuts.map(cut => cut.id));
  const selectionEventCount = dispatched.filter(event => event.type === 'cutlist:selection-changed').length;
  const selectedCuts = [];
  manager.onCutSelected = (cut) => {
    selectedCuts.push(cut);
  };

  const replacement = await manager.addSourcePair('G:\\shot\\a019_info.txt', 'G:\\shot\\a019.mp4');
  const activeCut = manager.getCutById(manager.currentCutId);

  assert.ok(activeCut);
  assert.equal(originalCutIds.has(manager.currentCutId), false);
  assert.ok(replacement.cuts.some(cut => cut.id === manager.currentCutId));
  assert.ok(manager.currentCutlist.cuts.some(cut => cut.id === manager.currentCutId));
  assert.equal(selectedCuts.at(-1)?.id, manager.currentCutId);

  const selectionEvents = dispatched.filter(event => event.type === 'cutlist:selection-changed');
  assert.equal(selectionEvents.length, selectionEventCount + 1);
  assert.equal(selectionEvents.at(-1).detail.cut.id, manager.currentCutId);
});

test('save uses cut range filename when cutlist still has the default name', async () => {
  const writtenPaths = [];
  installWindow({
    writeCutlist: async (filePath) => {
      writtenPaths.push(filePath);
      return true;
    }
  });
  const manager = new CutlistManager();
  manager.createNew();

  await manager.addSourcePair('G:\\shot\\a019_info.txt', 'G:\\shot\\a019.mp4');
  const savedPath = await manager.save();

  assert.equal(savedPath, 'G:\\shot\\a019-a028.bcutlist');
  assert.deepEqual(writtenPaths, ['G:\\shot\\a019-a028.bcutlist']);
});

test('save uses sanitized custom name when cutlist name was changed', async () => {
  const writtenPaths = [];
  installWindow({
    writeCutlist: async (filePath) => {
      writtenPaths.push(filePath);
      return true;
    }
  });
  const manager = new CutlistManager();
  manager.createNew();

  await manager.addSourcePair('G:\\shot\\a019_info.txt', 'G:\\shot\\a019.mp4');
  manager.setName('성철 컷 묶음:/');
  const savedPath = await manager.save();

  assert.equal(savedPath, 'G:\\shot\\성철 컷 묶음__.bcutlist');
  assert.deepEqual(writtenPaths, ['G:\\shot\\성철 컷 묶음__.bcutlist']);
});

test('open validates data and refreshes missing sources', async () => {
  const data = createDefaultCutlistData({ name: 'opened cutlist' });
  data.sources.push(createCutlistSource({
    id: 'source_present',
    videoPath: 'G:\\shot\\present.mp4',
    infoPath: 'G:\\shot\\present_info.txt',
    infoText: SAMPLE_INFO_TEXT,
    fileName: 'present.mp4'
  }));
  data.sources.push(createCutlistSource({
    id: 'source_missing',
    videoPath: 'G:\\shot\\missing.mp4',
    infoPath: 'G:\\shot\\missing_info.txt',
    infoText: SAMPLE_INFO_TEXT,
    fileName: 'missing.mp4'
  }));
  data.cuts.push(createCutlistCut({
    id: 'cut_19',
    sourceId: 'source_present',
    sceneNumber: 19,
    label: 'sc019',
    startFrame: 0,
    endFrame: 10,
    mohoStartFrame: 1,
    mohoEndFrame: 11,
    fps: 24
  }));

  installWindow({
    readCutlist: async (filePath) => {
      assert.equal(filePath, 'G:\\shot\\opened.bcutlist');
      return data;
    },
    fileExists: async (filePath) => !filePath.includes('missing')
  });
  const manager = new CutlistManager();
  let loadedName = '';
  manager.onCutlistLoaded = cutlist => {
    loadedName = cutlist.name;
  };

  const opened = await manager.open('G:\\shot\\opened.bcutlist');

  assert.equal(opened.name, 'opened cutlist');
  assert.equal(loadedName, 'opened cutlist');
  assert.equal(manager.cutlistPath, 'G:\\shot\\opened.bcutlist');
  assert.equal(manager.getSourceById('source_present').missing, false);
  assert.equal(manager.getSourceById('source_missing').missing, true);
  assert.equal(manager.isModified, false);

  installWindow({ readCutlist: async () => ({ name: 'bad' }) });
  const invalidManager = new CutlistManager();
  await assert.rejects(
    () => invalidManager.open('G:\\shot\\bad.bcutlist'),
    /유효하지 않은 컷 묶음/
  );
});
