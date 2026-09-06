const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'renderer/scripts/modules/user-settings.js'), 'utf8');
const commentSource = fs.readFileSync(path.join(root, 'renderer/scripts/modules/comment-manager.js'), 'utf8');

function createHarness(registeredUsers = []) {
  const context = vm.createContext({
    EventTarget,
    createLogger: () => ({ info() {}, warn() {}, error() {} }),
    getAuthManager: () => ({ isReady: () => true, getRegisteredUsers: () => registeredUsers })
  });
  vm.runInContext(settingsSource.replace(/^import .*;\r?\n/gm, '').replace(/export default UserSettings;/, '').replace(/\bexport /g, ''), context);
  vm.runInContext(commentSource.slice(commentSource.indexOf('// 마커 색상 정의'), commentSource.indexOf('/**\n * UUID 생성')).replace(/\bexport /g, ''), context);
  vm.runInContext('const userSettings = Object.create(UserSettings.prototype);', context);
  const resolver = app.match(/  function getCommentAuthorColor\(author, authorId\) \{[\s\S]*?\n  \}/)?.[0];
  if (resolver) vm.runInContext(resolver, context);
  const expression = app.match(/const markerAuthorColor = ([^;]+);/)[1];
  return {
    bodyColor(author, authorId) {
      context.marker = { author, authorId };
      return vm.runInContext(expression, context);
    },
    fallback(id) { context.id = id; return vm.runInContext('getAuthorColor(id)', context); }
  };
}

test('윤성원 and existing aliases keep their named blue even with an unrelated author ID', () => {
  const harness = createHarness();
  for (const name of ['윤성원', '성원', 'SW', 'sw']) {
    assert.equal(harness.bodyColor(name, 'unrelated-user-1').color, '#4a9eff', name);
  }
});

test('existing red and pink name colors and explicit registered themes have priority', () => {
  const harness = createHarness([{ name: '윤성원', theme: 'green' }, { name: '등록 사용자', theme: 'pink' }]);
  assert.equal(harness.bodyColor('배한솔', 'unrelated-user-1').color, '#ff5555');
  assert.equal(harness.bodyColor('허혜원', 'unrelated-user-1').color, '#ffaaaa');
  assert.equal(harness.bodyColor('윤성원', 'unrelated-user-1').color, '#2ed573');
  assert.equal(harness.bodyColor('등록 사용자', 'unrelated-user-1').color, '#ffaaaa');
});

test('authors without a named or registered color retain the original stable ID hash', () => {
  const harness = createHarness();
  for (const id of ['u-1', 'u-2', 'u-3']) {
    assert.deepEqual(harness.bodyColor('알 수 없는 사용자', id), harness.fallback(id));
  }
});

test('author accents use the matching translucent fill', () => {
  const harness = createHarness();
  assert.equal(harness.bodyColor('윤성원', 'unrelated-user-1').bgColor, 'rgba(74, 158, 255, 0.3)');
});

test('body, aggregate comments, author filter and video markers share the name-aware resolver', () => {
  assert.ok(/getCommentAuthorColor\(info\.name, authorId\)/.test(app));
  assert.ok(/getCommentAuthorColor\(rangeMarker\.author, rangeMarker\.authorId\)/.test(app));
  assert.equal((app.match(/getCommentAuthorColor\(author, range\.authorId\)/g) || []).length, 2);
  assert.ok(/getCommentAuthorColor\(marker\.author, marker\.authorId\)/.test(app));
});
