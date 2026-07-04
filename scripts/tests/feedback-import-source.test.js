const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const dropdownSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/version-dropdown.js'), 'utf8'));
const cssSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));

test('version dropdown exposes a per-version feedback import action', () => {
  assert.match(dropdownSource, /this\._onFeedbackImport = null;/);
  assert.match(dropdownSource, /onFeedbackImport\(callback\) \{/);
  assert.match(dropdownSource, /version-item-import-feedback/);
  assert.match(dropdownSource, /이 버전의 피드백 가져오기/);
  assert.match(dropdownSource, /this\._onFeedbackImport\(versionInfo\)/);
  assert.match(dropdownSource, /e\.stopPropagation\(\);[\s\S]+this\._onFeedbackImport\(versionInfo\)/);
  assert.match(cssSource, /\.version-item-import-feedback/);
});

test('feedback import is wired to load source bframe, save current bframe, and refresh visible UI', () => {
  assert.match(appSource, /from '\.\/modules\/feedback-import\.js';/);
  assert.match(appSource, /async function handleImportFeedbackFromVersion\(versionInfo\) \{/);
  assert.match(appSource, /const sourceBframePath = getBframePath\(versionInfo\.path\);/);
  assert.match(appSource, /sourceData = await window\.electronAPI\.loadReview\(sourceBframePath\);/);
  assert.match(appSource, /normalizeFeedbackSourceComments\(sourceData\)/);
  assert.match(appSource, /countImportableFeedbackMarkers\(sourceComments\)/);
  assert.match(appSource, /confirm\(`[\s\S]+피드백[\s\S]+가져올까요\?`\)/);
  assert.match(appSource, /importFeedbackIntoTargetComments\(/);
  assert.match(appSource, /commentManager\.toJSON\(\),[\s\S]+sourceComments,[\s\S]+\{ targetLayerId \}/);
  assert.match(appSource, /commentManager\.addImportedMarkers\(result\.importedMarkers, targetLayerId\)/);
  assert.match(appSource, /commentManager\.setActiveLayer\(importedMarkers\[0\]\.layerId \|\| targetLayerId\);/);
  assert.match(appSource, /const saved = await reviewDataManager\.save\(\);/);
  assert.match(appSource, /updateCommentList\(\);[\s\S]+updateTimelineMarkers\(\);[\s\S]+renderVideoMarkers\(\);[\s\S]+refreshCommentRangesForCurrentMode\(\);/);
  assert.match(appSource, /versionDropdown\.onFeedbackImport\(handleImportFeedbackFromVersion\);/);
});

test('imported feedback skips local Slack and undo side effects while still using markerAdded', () => {
  assert.match(appSource, /const \{ marker, remote, restored, imported \} = e\.detail;/);
  assert.match(appSource, /if \(remote \|\| restored \|\| imported\) return;/);
});
