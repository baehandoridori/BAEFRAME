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

test('hover 중 생성된 일반 토스트는 시작부터 일시정지된다', () => {
  const plan = mod.computeToastTimerPlan({ isHovered: true, isLoading: false });

  assert.equal(plan.paused, true);
  assert.equal(plan.shouldScheduleAutoDismiss, false);
  assert.equal(plan.shouldStartProgress, false);
});

test('hover 중 loading update로 일반 토스트가 되어도 타이머를 바로 시작하지 않는다', () => {
  const plan = mod.computeToastTimerPlan({ isHovered: true, isLoading: false });

  assert.equal(plan.shouldScheduleAutoDismiss, false);
  assert.equal(plan.shouldStartProgress, false);
});

test('loading 토스트는 hover 상태와 무관하게 자동 닫기를 시작하지 않는다', () => {
  const plan = mod.computeToastTimerPlan({ isHovered: false, isLoading: true });

  assert.equal(plan.paused, false);
  assert.equal(plan.shouldScheduleAutoDismiss, false);
  assert.equal(plan.shouldStartProgress, false);
});
