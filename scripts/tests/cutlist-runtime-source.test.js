const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const mainIpc = fs.readFileSync(path.join(rootDir, 'main/ipc-handlers.js'), 'utf-8');
const preload = fs.readFileSync(path.join(rootDir, 'preload/preload.js'), 'utf-8');
const mainIndex = fs.readFileSync(path.join(rootDir, 'main/index.js'), 'utf-8');
const rendererIndex = fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf-8');
const appSource = fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf-8');
const timelineSource = fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf-8');

test('main process exposes cutlist file handlers', () => {
  assert.match(mainIpc, /cutlist:read/);
  assert.match(mainIpc, /cutlist:write/);
  assert.match(mainIpc, /cutlist:read-info-text/);
  assert.match(mainIpc, /cutlist:generate-link/);
});

test('preload exposes cutlist renderer API', () => {
  assert.match(preload, /readCutlist/);
  assert.match(preload, /writeCutlist/);
  assert.match(preload, /readCutlistInfoText/);
  assert.match(preload, /onOpenCutlist/);
});

test('main process recognizes bcutlist launch inputs', () => {
  assert.match(mainIndex, /\.bcutlist/);
  assert.match(mainIndex, /open-cutlist/);
  assert.match(mainIndex, /baeframe:\/\/cutlist/);
});

test('renderer has cutlist DOM hooks', () => {
  assert.match(rendererIndex, /btnCutlist/);
  assert.match(rendererIndex, /cutlistSidebar/);
  assert.match(rendererIndex, /currentCutOverlay/);
});

test('renderer initializes cutlist feature', () => {
  assert.match(appSource, /initCutlistFeature/);
  assert.match(appSource, /openCutlistFile/);
  assert.match(appSource, /addCutlistSourcePair/);
});

test('timeline can render cutlist segments', () => {
  assert.match(timelineSource, /setCutlistTimeline/);
  assert.match(timelineSource, /setCurrentCutId/);
});
