/**
 * 프레임 격자 단계 결정 — 순수 함수 (DOM 의존 없음)
 *
 * 타임라인 줌 레벨(pxPerFrame)과 직전 단계를 받아
 * 현재 표시할 격자 단계와 레이어 플래그를 반환한다.
 * 단계 경계 근처에서 깜빡임을 방지하기 위해 ±3% 히스테리시스를 적용한다.
 */

// 단계 식별자
export const TIER = Object.freeze({
  FIVE_SEC: 0,     // 5초 강조선만
  ONE_SEC: 1,      // + 1초
  HALF_SEC: 2,     // + ½초
  QUARTER_SEC: 3,  // + ¼초
  EVERY_FRAME: 4   // + 매 프레임
});

// 상승(진입) 임계값
const UP_THRESHOLDS = [
  { tier: TIER.ONE_SEC, pxPerFrame: 0.5 },
  { tier: TIER.HALF_SEC, pxPerFrame: 1.0 },
  { tier: TIER.QUARTER_SEC, pxPerFrame: 2.0 },
  { tier: TIER.EVERY_FRAME, pxPerFrame: 4.0 }
];

// 히스테리시스 비율
const HYSTERESIS_PCT = 0.03;

/**
 * 주어진 pxPerFrame에서 도달 가능한 최고 단계를 반환 (히스테리시스 없음)
 */
function baseTier(pxPerFrame) {
  if (!Number.isFinite(pxPerFrame) || pxPerFrame <= 0) {
    return TIER.FIVE_SEC;
  }
  let result = TIER.FIVE_SEC;
  for (const t of UP_THRESHOLDS) {
    if (pxPerFrame >= t.pxPerFrame) result = t.tier;
    else break;
  }
  return result;
}

/**
 * 히스테리시스 적용된 단계 반환
 * @param {number} pxPerFrame
 * @param {number|null} prevTier - 직전 프레임의 tier (없으면 null)
 * @returns {{tier: number, showFiveSec: boolean, showOneSec: boolean, showHalf: boolean, showQuarter: boolean, showFrame: boolean}}
 */
export function resolveFrameGridTier(pxPerFrame, prevTier) {
  const b = baseTier(pxPerFrame);

  let tier = b;
  if (prevTier !== null && prevTier !== undefined) {
    // 직전 단계가 있으면 히스테리시스 체크
    if (b > prevTier) {
      // 상승: 임계 × (1 + 3%) 이상이어야 상승
      const upThreshold = UP_THRESHOLDS[prevTier];
      if (upThreshold && pxPerFrame < upThreshold.pxPerFrame * (1 + HYSTERESIS_PCT)) {
        tier = prevTier;
      }
    } else if (b < prevTier) {
      // 하강: 임계 × (1 - 3%) 이하여야 하강
      const downThreshold = UP_THRESHOLDS[prevTier - 1];
      if (downThreshold && pxPerFrame > downThreshold.pxPerFrame * (1 - HYSTERESIS_PCT)) {
        tier = prevTier;
      }
    }
  }

  return {
    tier,
    showFiveSec: tier === TIER.FIVE_SEC,
    showOneSec: tier >= TIER.ONE_SEC,
    showHalf: tier >= TIER.HALF_SEC,
    showQuarter: tier >= TIER.QUARTER_SEC,
    showFrame: tier >= TIER.EVERY_FRAME
  };
}
