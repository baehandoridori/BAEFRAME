const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));

test('remote cursor visibility is a local user setting', () => {
  assert.match(userSettingsSource, /showRemoteCursors:\s*true/);
  assert.match(userSettingsSource, /getShowRemoteCursors\(\) \{[\s\S]+return this\.settings\.showRemoteCursors !== false;/);
  assert.match(userSettingsSource, /setShowRemoteCursors\(show\) \{[\s\S]+this\.settings\.showRemoteCursors = !!show;[\s\S]+this\._save\(\);[\s\S]+this\._emit\('showRemoteCursorsChanged'/);
});

test('collaboration popup exposes an action for other collaborators cursors', () => {
  assert.match(indexSource, /id="collabPlexusPanel"[\s\S]+id="btnToggleRemoteCursors"/);
  assert.match(indexSource, /id="remoteCursorsToggleLabel">커서 숨기기<\/span>/);
  assert.doesNotMatch(indexSource, /id="toggleRemoteCursors"/);
  assert.match(appSource, /const btnToggleRemoteCursors = document\.getElementById\('btnToggleRemoteCursors'\);/);
  assert.match(appSource, /const remoteCursorsToggleLabel = document\.getElementById\('remoteCursorsToggleLabel'\);/);
  assert.match(appSource, /function updateRemoteCursorToggleButton\(\) \{[\s\S]+remoteCursorsToggleLabel\.textContent = showRemoteCursors \? '커서 숨기기' : '커서 보이기';/);
  assert.match(appSource, /userSettings\.setShowRemoteCursors\(!userSettings\.getShowRemoteCursors\(\)\);/);
});

test('remote cursor renderer clears cursors when the setting is off', () => {
  assert.match(appSource, /function clearRemoteCursors\(\) \{[\s\S]+querySelectorAll\('\.remote-cursor'\)\.forEach\(el => el\.remove\(\)\);/);
  assert.match(appSource, /if \(!userSettings\.getShowRemoteCursors\(\)\) \{[\s\S]+clearRemoteCursors\(\);[\s\S]+return;/);
  assert.match(appSource, /userSettings\.addEventListener\('showRemoteCursorsChanged'/);
});
