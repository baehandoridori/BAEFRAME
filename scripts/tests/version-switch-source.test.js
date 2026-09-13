const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexHtmlSource = normalizeNewlines(
  fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8')
);

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const scanResult = name => ({ baseName: name, currentVersion: 1, versions: [{ version: 1, path: `C:/${name}_v1.mp4` }] });

test('playlist A/B/C each restore only their own manual versions, including empty lists', async () => {
  const { VersionManager } = await import('../../renderer/scripts/modules/version-manager.js');
  global.window = { electronAPI: { scanVersions: async file => scanResult(file.match(/([ABC])_v/)[1]) } };
  const manager = new VersionManager();
  const savedA = [{ version: 2, filePath: 'C:/manual-A.mp4' }];
  await manager.setCurrentFile('C:/A_v1.mp4');
  manager.setManualVersions(savedA);
  await manager.setCurrentFile('C:/B_v1.mp4');
  assert.deepEqual(manager.getManualVersions(), [], 'B has no manual versions; A must not leak');
  manager.setManualVersions([{ version: 2, filePath: 'C:/manual-B.mp4' }]);
  await manager.setCurrentFile('C:/C_v1.mp4');
  assert.deepEqual(manager.getAllVersions().map(v => v.path), ['C:/C_v1.mp4']);
  await manager.setCurrentFile('C:/A_v1.mp4');
  manager.setManualVersions(savedA);
  manager.addManualVersion({ version: 3, filePath: 'C:/manual-A3.mp4' });
  assert.equal(savedA.length, 1, 'display mutations must not mutate the saved review array');
});

test('a delayed A scan cannot block or replace B version results', async () => {
  const { VersionManager } = await import('../../renderer/scripts/modules/version-manager.js');
  const a = deferred(), b = deferred();
  const requests = [], completed = [];
  global.window = { electronAPI: { scanVersions: file => { requests.push(file); return file.includes('A_') ? a.promise : b.promise; } } };
  const manager = new VersionManager();
  manager.addEventListener('scanComplete', event => completed.push(event.detail.baseName));
  const loadingA = manager.setCurrentFile('C:/A_v1.mp4');
  const loadingB = manager.setCurrentFile('C:/B_v1.mp4');
  b.resolve(scanResult('B')); await loadingB;
  a.resolve(scanResult('A')); await loadingA;
  assert.deepEqual(requests, ['C:/A_v1.mp4', 'C:/B_v1.mp4']);
  assert.deepEqual(completed, ['B']);
  assert.deepEqual(manager.getAllVersions().map(v => v.path), ['C:/B_v1.mp4']);
  assert.equal(manager.getState().isScanning, false);
});

test('reset retires a pending version scan and its late error', async () => {
  const { VersionManager } = await import('../../renderer/scripts/modules/version-manager.js');
  for (const fail of [false, true]) {
    const scan = deferred();
    global.window = { electronAPI: { scanVersions: () => scan.promise } };
    const manager = new VersionManager();
    const events = [];
    manager.addEventListener('scanComplete', () => events.push('complete'));
    manager.addEventListener('scanError', () => events.push('error'));
    const loading = manager.setCurrentFile('C:/A_v1.mp4');
    manager.reset();
    if (fail) scan.reject(new Error('old scan')); else scan.resolve(scanResult('A'));
    await loading;
    assert.deepEqual(manager.getAllVersions(), []);
    assert.deepEqual(events, []);
  }
});

for (const switchAt of ['file picker', 'version number prompt', 'after addition']) {
  test(`manual version mutations retain their owner when switching during ${switchAt}`, async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(indexHtmlSource);
    global.window = dom.window; global.document = dom.window.document;
    const picker = deferred();
    window.electronAPI = { scanVersions: async file => scanResult(file.includes('/A_') ? 'A' : 'B'), openFileDialog: () => picker.promise };
    const { VersionDropdown } = await import('../../renderer/scripts/modules/version-dropdown.js');
    const dropdown = new VersionDropdown();
    const manager = dropdown._versionManager;
    manager.reset(); await manager.setCurrentFile('C:/A_v1.mp4');
    let reviewPath = 'C:/A_v1.mp4';
    const writes = [];
    dropdown.setReviewDataManager({ getVideoPath: () => reviewPath, addManualVersion: v => writes.push(v), removeManualVersion: path => writes.push(path) });
    dropdown.init();
    const adding = dropdown._handleAddManualVersion();
    const switchToB = async () => { reviewPath = 'C:/B_v1.mp4'; await manager.setCurrentFile(reviewPath); };
    if (switchAt === 'file picker') await switchToB();
    picker.resolve({ canceled: false, filePaths: ['C:/manual-A.mp4'] });
    await new Promise(resolve => setImmediate(resolve));
    if (switchAt === 'version number prompt') await switchToB();
    document.getElementById('promptModalInput').value = '2';
    document.getElementById('promptModalConfirm').click();
    await adding;
    if (switchAt === 'after addition') {
      assert.deepEqual(manager.getManualVersions().map(v => v.filePath), ['C:/manual-A.mp4']);
      assert.equal(writes.length, 1);
      const editing = dropdown._handleEditVersion(manager.getAllVersions().find(v => v.isManual));
      await switchToB();
      document.getElementById('promptModalInput').value = '3';
      document.getElementById('promptModalConfirm').click();
      await editing;
      assert.deepEqual(manager.getManualVersions(), []);
      assert.equal(writes.length, 1, 'late edit cannot remove or add versions in B');
    } else {
      assert.deepEqual(manager.getManualVersions(), []);
      assert.deepEqual(writes, []);
    }
    dom.window.close();
  });
}

test('version selection cannot use a stale row during a playlist transition', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(indexHtmlSource);
  global.window = dom.window; global.document = dom.window.document;
  window.electronAPI = { scanVersions: async () => scanResult('A') };
  const { VersionDropdown } = await import('../../renderer/scripts/modules/version-dropdown.js');
  const dropdown = new VersionDropdown();
  await dropdown._versionManager.setCurrentFile('C:/A_v1.mp4');
  dropdown.setReviewDataManager({ getVideoPath: () => 'C:/A_v1.mp4' });
  dropdown.init();
  const selected = [];
  dropdown.onVersionSelect(version => selected.push(version.path));
  dropdown.setContextGuard(() => false);
  dropdown._handleVersionSelect({ path: 'C:/A_v1.mp4' });
  assert.deepEqual(selected, []);
  dropdown.setContextGuard(() => true);
  dropdown._handleVersionSelect({ path: 'C:/A_v1.mp4' });
  assert.deepEqual(selected, ['C:/A_v1.mp4']);
  dom.window.close();
});

test('version comparison waits for the selected video context and never falls back to another video', () => {
  const vm = require('node:vm');
  const start = appSource.indexOf("  const btnCompareVersions = document.getElementById('btnCompareVersions');");
  const end = appSource.indexOf('// ====== 협업 시스템 초기화', start);
  let click, ready = false;
  let versions = [{ path: 'C:/A_v1.mp4' }, { path: 'C:/A_v2.mp4' }];
  const opened = [];
  vm.runInNewContext(appSource.slice(start, end), {
    document: { getElementById: () => ({ addEventListener: (_type, cb) => { click = cb; } }) },
    log: { info() {} }, showToast() {},
    versionDropdown: { close() {}, isContextReady: () => ready },
    getVersionManager: () => ({ getAllVersions: () => versions }),
    state: { currentFile: 'c:\\B_v1.mp4' },
    isSameFilePath: (a, b) => a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase(),
    splitViewManager: { open: options => opened.push(options) }
  });
  click(); assert.equal(opened.length, 0, 'loading B cannot open A comparison');
  ready = true;
  click(); assert.equal(opened.length, 0, 'missing current video is not replaced by versions[0]');
  versions = [{ path: 'C:/B_v1.mp4' }, { path: 'C:/B_v2.mp4' }];
  click(); assert.equal(opened.length, 1);
  assert.equal(opened[0].leftVersion.path, 'C:/B_v1.mp4');
  assert.equal(opened[0].rightVersion.path, 'C:/B_v2.mp4');
});

test('버전 전환이 전환 직전 시간을 initialTime으로 넘긴다 (피드백 36)', () => {
  assert.match(appSource, /onVersionSelect\(async \(versionInfo\) => \{[\s\S]*?initialTime: resumeTime/);
  assert.match(appSource, /initialTime = null,/);
  assert.match(appSource, /function resolveInitialFrameFromOptions\(initialFrame, initialTime\)/);
  assert.match(appSource, /seekMpvInitialFrameBeforeReveal\(mpvInitialFrame\)/);
  assert.match(
    appSource,
    /loadVideoWithMpvPilot\(filePath, \{\s*initialFrame,\s*initialTime,\s*loadToken,\s*isStaleVideoLoad\s*\}\)/
  );
});

test('이전 리뷰 패널을 현재 저장 매니저와 연결하고 파일 전환 시 참조 읽기를 중단한다', () => {
  assert.match(appSource, /const reviewCarryoverManager = new ReviewCarryoverManager\(\)/);
  assert.match(appSource, /new ReviewDataManager\(\{[\s\S]*?reviewCarryoverManager,/);
  assert.match(appSource, /previousReviewPanel = createPreviousReviewPanel\(\{/);
  assert.match(appSource, /previousReviewPanel\?\.suspend\(\)/);
  assert.match(appSource, /previousReviewPanel\?\.decorateList\(\)/);
  assert.match(indexHtmlSource, /id="prevVersionCommentsBtn"/);
  assert.match(indexHtmlSource, /id="previousReviewMount"/);
  assert.doesNotMatch(appSource, /let previousVersionComments = null/);
});

test('검수 입력은 최종 저장과 협업 종료보다 먼저 잠그고 전환 취소 시 소유자만 해제한다', () => {
  const start = appSource.indexOf('async function loadVideo(');
  const end = appSource.indexOf('async function handleImportFeedbackFromVersion',start);
  const load = appSource.slice(start,end);
  const fence = load.indexOf('previousReviewTransitionBlockToken = loadToken;');
  assert.ok(fence >= 0);
  assert.ok(fence < load.indexOf('await reviewDataManager.save()'));
  assert.ok(fence < load.indexOf('await window.electronAPI.watchFileStop'));
  assert.match(load, /if \(!canContinueVideoLoad\(\)\) return false;\s*previousReviewTransitionBlockToken = loadToken;/);
  assert.match(load, /finally \{\s*if \(previousReviewTransitionBlockToken === loadToken\) \{\s*previousReviewTransitionBlockToken = null;/);
  assert.match(appSource, /enabled: previousReviewContextReady && previousReviewTransitionBlockToken === null/);
});
