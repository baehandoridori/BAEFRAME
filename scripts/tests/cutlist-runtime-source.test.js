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
const launchRouting = require(path.join(rootDir, 'main/launch-routing'));
const cutlistPaths = require(path.join(rootDir, 'main/cutlist-paths'));

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
  assert.match(rendererIndex, /btnCutlistPrimaryAdd/);
  assert.match(rendererIndex, /영상 \+ info txt 쌍 추가/);
  assert.match(rendererIndex, /cutlistSidebar/);
  assert.match(rendererIndex, /currentCutOverlay/);
});

test('renderer initializes cutlist feature', () => {
  assert.match(appSource, /initCutlistFeature/);
  assert.match(appSource, /openCutlistFile/);
  assert.match(appSource, /btnCutlistPrimaryAdd/);
  assert.match(appSource, /btnCutlistPrimaryAdd\?\.addEventListener\('click'[\s\S]*handleCutlistAddClick\(\)/);
  assert.match(appSource, /addCutlistSourcePair/);
});

test('timeline can render cutlist segments', () => {
  assert.match(timelineSource, /setCutlistTimeline/);
  assert.match(timelineSource, /setCurrentCutId/);
});

test('cutlist route URLs preserve or recover Windows drive paths', () => {
  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist/G:/dir/file.bcutlist', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist/G/dir/file.bcutlist', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );
});

test('cutlist query route decodes only the file value', () => {
  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist?file=G%3A%5Cdir%5Cfile.bcutlist', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist?file=G%3A%5Cdir%5Cfile.bcutlist&x=1', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );
});

test('cutlist query route preserves literal percent characters in the file path', () => {
  const encodedPath = encodeURIComponent('G:\\dir\\100% done\\file.bcutlist');

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl(`baeframe://cutlist?file=${encodedPath}`, 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\100% done\\file.bcutlist' }
  );

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl(`baeframe://cutlist/?file=${encodedPath}`, 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\100% done\\file.bcutlist' }
  );
});

test('cutlist route with slash before query decodes the file value', () => {
  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist/?file=G%3A%5Cdir%5Cfile.bcutlist', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );
});

test('playlist query route preserves literal percent characters in the file path', () => {
  const encodedPath = encodeURIComponent('G:\\dir\\100% done\\file.bplaylist');

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl(`baeframe://playlist?file=${encodedPath}`, 'playlist'),
    { route: 'playlist', filePath: 'G:\\dir\\100% done\\file.bplaylist' }
  );

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl(`baeframe://playlist/?file=${encodedPath}`, 'playlist'),
    { route: 'playlist', filePath: 'G:\\dir\\100% done\\file.bplaylist' }
  );
});

test('playlist route with slash before query decodes the file value', () => {
  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://playlist/?file=G%3A%5Cdir%5Cfile.bplaylist', 'playlist'),
    { route: 'playlist', filePath: 'G:\\dir\\file.bplaylist' }
  );
});

test('malformed cutlist route URL does not throw or resolve', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(
      launchRouting.resolveRoutedFileUrl('baeframe://cutlist?file=G%ZZbad.bcutlist', 'cutlist'),
      { route: '', filePath: '' }
    );
  });
});

test('launch arguments classify cutlist and existing file types', () => {
  assert.equal(launchRouting.classifyLaunchArgument('C:\\dir\\file.bcutlist'), 'cutlist');
  assert.equal(launchRouting.classifyLaunchArgument('C:\\dir\\clip.mp4'), 'video');
  assert.equal(launchRouting.classifyLaunchArgument('C:\\dir\\project.bframe'), 'project');
  assert.equal(launchRouting.classifyLaunchArgument('C:\\dir\\playlist.bplaylist'), 'playlist');
});

test('cutlist IPC path validation only allows bcutlist files', () => {
  assert.equal(cutlistPaths.validateCutlistFilePath('C:/dir/file.bcutlist'), 'C:\\dir\\file.bcutlist');
  assert.throws(() => cutlistPaths.validateCutlistFilePath('C:/dir/file.json'), /bcutlist/);
  assert.throws(() => cutlistPaths.validateCutlistFilePath('C:/dir/file.bframe'), /bcutlist/);
  assert.throws(() => cutlistPaths.validateCutlistFilePath('C:/dir/file.mp4'), /bcutlist/);
});
