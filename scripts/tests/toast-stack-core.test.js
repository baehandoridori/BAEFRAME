const { test } = require('node:test');
const assert = require('node:assert/strict');

let mod;

test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/toast-stack-core.js');
});

test('최신 토스트가 가장 높은 z-index를 가진다', () => {
  const layout = mod.computeToastStackLayout(['newest', 'middle', 'oldest'], { maxVisible: 3 });

  assert.equal(layout[0].id, 'newest');
  assert.equal(layout[0].fromTop, 0);
  assert.ok(layout[0].zIndex > layout[1].zIndex);
  assert.ok(layout[1].zIndex > layout[2].zIndex);
});

test('표시 개수를 넘은 토스트는 hidden 상태가 된다', () => {
  const layout = mod.computeToastStackLayout(['a', 'b', 'c', 'd'], { maxVisible: 3 });

  assert.equal(layout[3].hidden, true);
  assert.equal(layout[3].stacked, true);
});

test('dismissed 토스트는 재정렬 중 위로 올라오지 않는다', () => {
  const layout = mod.computeToastStackLayout([
    { id: 'a' },
    { id: 'b', dismissed: true },
    { id: 'c' }
  ], { maxVisible: 3 });

  const dismissed = layout.find(item => item.id === 'b');
  assert.equal(dismissed.zIndex, 0);
});

test('DOM dismissed 토스트도 재정렬 중 위로 올라오지 않는다', () => {
  const layout = mod.computeToastStackLayout([
    { id: 'a' },
    { id: 'b', _dismissed: true },
    { id: 'c' }
  ], { maxVisible: 3 });

  const dismissed = layout.find(item => item.id === 'b');
  assert.equal(dismissed.zIndex, 0);
});
