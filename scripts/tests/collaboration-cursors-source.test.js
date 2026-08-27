const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const liveblocksManagerSource = normalizeNewlines(
  fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/liveblocks-manager.js'), 'utf8')
);

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

test('remote cursor labels are built as text before mpv mirroring', () => {
  assert.match(appSource, /const SVG_NAMESPACE = 'http:\/\/www\.w3\.org\/2000\/svg';/);
  assert.match(appSource, /const label = document\.createElement\('span'\);[\s\S]+label\.textContent = collab\.userName \|\| '알 수 없음';/);
  assert.match(appSource, /const svg = document\.createElementNS\(SVG_NAMESPACE, 'svg'\);/);
  assert.doesNotMatch(appSource, /cursorEl\.innerHTML = `[\s\S]*\$\{collab\.userName\}/);
});

test('collaborator avatars are built with text-only DOM operations', () => {
  const updateMatch = appSource.match(
    /function updateCollaboratorsUI\(collaborators\) \{([\s\S]*?)\n  \}\n\n  let _plexusStartTimer/
  );
  assert.ok(updateMatch, 'collaborator updater must remain discoverable');
  assert.match(updateMatch[1], /document\.createElement\('div'\)/);
  assert.match(updateMatch[1], /avatar\.textContent = initials/);
  assert.match(updateMatch[1], /collaboratorsAvatars\.replaceChildren/);
  assert.doesNotMatch(updateMatch[1], /innerHTML/);
});

test('others 구독은 Storage 로드 대기보다 먼저 설치되고 접속 후 초기 스냅샷을 보상 발행한다', () => {
  const startBody = liveblocksManagerSource.match(
    /this\._room = result\.room;([\s\S]*?)return \{ roomId: this\._roomId, isNewRoom \};/
  );
  assert.ok(startBody, 'start()의 Room 확보 이후 구간을 찾을 수 있어야 한다');

  const setupIndex = startBody[1].indexOf('this._setupSubscriptions();');
  const storageIndex = startBody[1].indexOf('// Storage 로드 대기');
  const backfillIndex = startBody[1].indexOf('this._emitCollaboratorsChanged();');

  assert.ok(setupIndex > -1, '구독 설치 호출이 start() 안에 있어야 한다');
  assert.ok(storageIndex > -1, 'Storage 로드 대기 구간이 남아 있어야 한다');
  assert.ok(backfillIndex > -1, '초기 참여자 보상 발행이 start() 안에 있어야 한다');
  assert.ok(setupIndex < storageIndex, '구독 설치가 Storage 대기보다 앞서야 한다');
  assert.ok(backfillIndex > storageIndex, '보상 발행은 접속 완료 이후여야 한다');
});

test('collaboratorsChanged 발행 경로는 하나이며 연결 복구 시에도 재푸시된다', () => {
  assert.match(
    liveblocksManagerSource,
    /_emitCollaboratorsChanged\(\) \{\s*\n\s*if \(!this\._room\) return;\s*\n\s*const others = this\.getOthers\(\);\s*\n\s*this\._emit\('collaboratorsChanged'/
  );
  assert.match(
    liveblocksManagerSource,
    /this\._room\.subscribe\('others', \(\) => \{\s*\n\s*this\._emitCollaboratorsChanged\(\);\s*\n\s*\}\);/
  );
  assert.match(
    liveblocksManagerSource,
    /else if \(event === 'restored'\) \{[\s\S]*?this\._emitCollaboratorsChanged\(\);/
  );
  assert.equal(
    (liveblocksManagerSource.match(/this\._emit\('collaboratorsChanged'/g) || []).length,
    1,
    'collaboratorsChanged 발행은 _emitCollaboratorsChanged 한 곳으로 모여야 한다'
  );
  assert.match(
    liveblocksManagerSource,
    /log\.error\('Room 접속 실패', error\);[\s\S]*?this\._unsubscribers = \[\];[\s\S]*?this\._room = null;/
  );
});

test('협업 세션 기준값은 Room 접속 전에 초기화되고 초기 스냅샷이 UI에 반영된다', () => {
  const startFn = appSource.match(
    /async function startCollaborationForVideoLoad\(loadToken, bframePath, options = \{\}\) \{([\s\S]*?)\n  \}\n/
  );
  assert.ok(startFn, 'startCollaborationForVideoLoad 본문을 찾을 수 있어야 한다');
  const resetIndex = startFn[1].indexOf('_previousOthersCount = 0;');
  const enterIndex = startFn[1].indexOf('await liveblocksManager.start(');
  assert.ok(resetIndex > -1 && enterIndex > -1);
  assert.ok(resetIndex < enterIndex, '세션 기준값은 Room 접속 이전에 초기화되어야 한다');

  const startedHandler = appSource.match(
    /liveblocksManager\.addEventListener\('collaborationStarted', \(e\) => \{([\s\S]*?)\n  \}\);/
  );
  assert.ok(startedHandler, 'collaborationStarted 핸들러를 찾을 수 있어야 한다');
  assert.match(startedHandler[1], /liveblocksManager\.getOthers\(\)\.map\(u => \(\{/);
  assert.match(startedHandler[1], /updateCollaboratorsUI\(\[me, \.\.\.others\]\);/);
  assert.doesNotMatch(startedHandler[1], /_triggerCollabRipple\(\);/);
  assert.doesNotMatch(startedHandler[1], /showToast\(/);
});
