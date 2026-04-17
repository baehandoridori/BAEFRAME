/**
 * frame-grid-tiers 단위 테스트
 * 실행: npm run test:frame-grid
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

let resolveFrameGridTier, TIER;
test('모듈 로드', async () => {
  const mod = await import('../../renderer/scripts/modules/frame-grid-tiers.js');
  resolveFrameGridTier = mod.resolveFrameGridTier;
  TIER = mod.TIER;
});

test('pxPerFrame < 0.5: 5초 강조선만', () => {
  const t = resolveFrameGridTier(0.2, null);
  assert.equal(t.showFiveSec, true);
  assert.equal(t.showOneSec, false);
  assert.equal(t.showHalf, false);
  assert.equal(t.showQuarter, false);
  assert.equal(t.showFrame, false);
  assert.equal(t.tier, TIER.FIVE_SEC);
});

test('pxPerFrame = 0.5 임계: 1초 진입', () => {
  const t = resolveFrameGridTier(0.5, null);
  assert.equal(t.showFiveSec, false);
  assert.equal(t.showOneSec, true);
  assert.equal(t.tier, TIER.ONE_SEC);
});

test('pxPerFrame = 1.0: ½초 추가', () => {
  const t = resolveFrameGridTier(1.0, null);
  assert.equal(t.showOneSec, true);
  assert.equal(t.showHalf, true);
  assert.equal(t.showQuarter, false);
  assert.equal(t.tier, TIER.HALF_SEC);
});

test('pxPerFrame = 2.0: ¼초 추가', () => {
  const t = resolveFrameGridTier(2.0, null);
  assert.equal(t.showHalf, true);
  assert.equal(t.showQuarter, true);
  assert.equal(t.showFrame, false);
  assert.equal(t.tier, TIER.QUARTER_SEC);
});

test('pxPerFrame = 4.0: 매 프레임 추가', () => {
  const t = resolveFrameGridTier(4.0, null);
  assert.equal(t.showQuarter, true);
  assert.equal(t.showFrame, true);
  assert.equal(t.tier, TIER.EVERY_FRAME);
});

test('히스테리시스: 0.485 (이탈)에서 TIER.ONE_SEC 유지 (직전이 ONE_SEC)', () => {
  const t = resolveFrameGridTier(0.49, TIER.ONE_SEC);
  assert.equal(t.tier, TIER.ONE_SEC);
  assert.equal(t.showOneSec, true);
});

test('히스테리시스: 0.48 이하에서는 FIVE_SEC로 하강', () => {
  const t = resolveFrameGridTier(0.48, TIER.ONE_SEC);
  assert.equal(t.tier, TIER.FIVE_SEC);
});

test('히스테리시스: 상승 진입은 임계 + 3% (0.515)', () => {
  const t1 = resolveFrameGridTier(0.51, TIER.FIVE_SEC);
  assert.equal(t1.tier, TIER.FIVE_SEC, '0.51은 아직 FIVE_SEC');
  const t2 = resolveFrameGridTier(0.52, TIER.FIVE_SEC);
  assert.equal(t2.tier, TIER.ONE_SEC, '0.52는 ONE_SEC로 상승');
});

test('엣지: pxPerFrame = 0 (duration 0 상황)', () => {
  const t = resolveFrameGridTier(0, null);
  assert.equal(t.tier, TIER.FIVE_SEC);
});

test('엣지: 매우 큰 pxPerFrame (100)', () => {
  const t = resolveFrameGridTier(100, null);
  assert.equal(t.tier, TIER.EVERY_FRAME);
  assert.equal(t.showFrame, true);
});

test('엣지: 음수/NaN 입력 — 안전한 기본값', () => {
  const t1 = resolveFrameGridTier(-1, null);
  assert.equal(t1.tier, TIER.FIVE_SEC, '음수는 FIVE_SEC로 수렴');
  const t2 = resolveFrameGridTier(NaN, null);
  assert.equal(t2.tier, TIER.FIVE_SEC, 'NaN도 안전 기본값');
});
