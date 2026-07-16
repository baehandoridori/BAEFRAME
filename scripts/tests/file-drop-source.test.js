const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const windowSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/window.js'), 'utf8'));
const embedHostSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/mpv-embed-host.js'), 'utf8'));
const overlayHostSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/mpv-overlay-host.js'), 'utf8'));

test('문서 레벨 드롭 가드가 파일 열기로 라우팅한다 (드래그드롭 수복)', () => {
  assert.match(appSource, /async function handleDroppedFiles\(files\)/);
  assert.match(appSource, /document\.addEventListener\('dragover', \(e\) => \{\s*\n\s*e\.preventDefault\(\);/);
  assert.match(appSource, /void handleDroppedFiles\(e\.dataTransfer\?\.files\);/);
  assert.match(windowSource, /webContents\.on\('will-navigate'/);
});

test('드롭존 drop 핸들러가 공용 함수로 축약되어 있다 (드래그드롭 수복)', () => {
  assert.match(appSource, /await handleDroppedFiles\(e\.dataTransfer\.files\);/);
  // 문서 drop 핸들러는 드롭존이 보이면(첫 화면) 조기 반환해 중복 처리를 막는다
  assert.match(appSource, /if \(!elements\.dropZone\.classList\.contains\('hidden'\)\) return;/);
});

test('메인 창 will-navigate가 확장자별 채널로 라우팅한다 (드래그드롭 수복)', () => {
  assert.match(windowSource, /function sendDroppedPathToRenderer\(mainWindow, filePath\)/);
  assert.match(windowSource, /mainWindow\.webContents\.send\('open-playlist', filePath\)/);
  assert.match(windowSource, /mainWindow\.webContents\.send\('open-cutlist', filePath\)/);
  assert.match(windowSource, /mainWindow\.webContents\.send\('open-from-protocol', filePath, null\)/);
});

test('mpv 호스트 창 2개가 드롭 네비게이션을 가로챈다 (드래그드롭 수복)', () => {
  assert.match(embedHostSource, /webContents\?\.on\?\.\('will-navigate'/);
  assert.match(embedHostSource, /open-from-protocol/);
  assert.match(overlayHostSource, /webContents\?\.on\?\.\('will-navigate'/);
  assert.match(overlayHostSource, /open-from-protocol/);
});
