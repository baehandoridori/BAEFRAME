/**
 * frame-grid-tiers 단위 테스트
 * 실행: npm run test:frame-grid
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

let resolveFrameGridTier, resolveFrameCellActive, computeMinZoomForCellMode, TIER;
test('모듈 로드', async () => {
  const mod = await import('../../renderer/scripts/modules/frame-grid-tiers.js');
  resolveFrameGridTier = mod.resolveFrameGridTier;
  resolveFrameCellActive = mod.resolveFrameCellActive;
  computeMinZoomForCellMode = mod.computeMinZoomForCellMode;
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

test('프레임 셀 모드: off는 항상 비활성, on은 항상 활성', () => {
  const hiddenFrameTier = resolveFrameGridTier(0.2, null);
  assert.equal(resolveFrameCellActive('off', hiddenFrameTier), false);
  assert.equal(resolveFrameCellActive('on', hiddenFrameTier), true);
});

test('프레임 셀 모드: auto는 매 프레임 격자 티어를 따른다', () => {
  assert.equal(resolveFrameCellActive('auto', resolveFrameGridTier(3.9, null)), false);
  assert.equal(resolveFrameCellActive('auto', resolveFrameGridTier(4.0, null)), true);
  assert.equal(resolveFrameCellActive('auto', resolveFrameGridTier(4.2, null)), true);
});

test('프레임 셀 모드: auto는 격자 티어 히스테리시스를 공유한다', () => {
  const kept = resolveFrameGridTier(3.9, TIER.EVERY_FRAME);
  const dropped = resolveFrameGridTier(3.87, TIER.EVERY_FRAME);

  assert.equal(kept.tier, TIER.EVERY_FRAME);
  assert.equal(resolveFrameCellActive('auto', kept), true);
  assert.notEqual(dropped.tier, TIER.EVERY_FRAME);
  assert.equal(resolveFrameCellActive('auto', dropped), false);
});

test('ON 모드 최소 줌은 1프레임 최소 픽셀 폭을 보장한다', () => {
  assert.equal(computeMinZoomForCellMode(43200, 1200, 8), 28800);
  assert.equal(computeMinZoomForCellMode(120, 1200, 8), 100);
  assert.equal(computeMinZoomForCellMode(0, 1200, 8), 100);
  assert.equal(computeMinZoomForCellMode(120, 0, 8), 100);
});
