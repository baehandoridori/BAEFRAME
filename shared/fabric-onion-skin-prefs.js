'use strict';

/**
 * 어니언 스킨 설정(켜짐·앞뒤 장수·진하기)의 한도와 검증 단일 소스.
 *
 * 이 값은 영상 위 오버레이 창에서 바뀌고 메인 창의 사용자 설정에 보존된다. 팔레트
 * 값(shared/fabric-palette-prefs.js)과 같은 길을 지나며, 프로세스 경계를 넘을 때마다
 * 같은 검증을 거친다.
 *
 * - renderer/scripts/modules/mpv-fabric-overlay-runtime.js: require (esbuild 번들 시 인라인)
 * - preload/mpv-overlay-preload.js: require (오버레이 → 메인 프로세스)
 * - main/ipc-handlers.js, main/mpv-overlay-host.js: require
 * - preload/preload.js: require (메인 프로세스 → 메인 렌더러)
 * - renderer/scripts/modules/user-settings.js: 브라우저 네이티브 ES 모듈이라 CommonJS 를
 *   import 할 수 없으므로 리터럴을 유지하고, scripts/tests/fabric-onion-skin-prefs.test.js 가
 *   값이 같음을 강제한다.
 *
 * 어니언 스킨은 화면에만 보이는 뷰 상태다. 그림 문서(`drawingsV3`)와는 무관하다.
 */

const FABRIC_ONION_SKIN_MAX_SHEETS = 5;
const FABRIC_ONION_SKIN_MIN_OPACITY_PERCENT = 10;
const FABRIC_ONION_SKIN_MAX_OPACITY_PERCENT = 80;
// 구형 도구의 기본값을 잇는다(이전 2장·이후 1장·30%, 꺼짐).
const FABRIC_ONION_SKIN_DEFAULT_PREFS = Object.freeze({
  enabled: false,
  before: 2,
  after: 1,
  opacityPercent: 30
});
const FABRIC_ONION_SKIN_PREFS_KEYS = Object.freeze(['enabled', 'before', 'after', 'opacityPercent']);

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * @returns {{ enabled: boolean, before: number, after: number, opacityPercent: number } | null}
 *   형식이 조금이라도 다르면 null. 고쳐 쓰지 않는다 — 고쳐 쓰면 보낸 쪽과 받은 쪽의
 *   값이 조용히 달라진다.
 */
function normalizeFabricOnionSkinPrefs(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  // 접근자·프록시가 던지는 예외도 "형식이 다르다"로 본다. 검증기가 호출자를 죽이면 안 된다.
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Object.keys(value);
    if (keys.length !== FABRIC_ONION_SKIN_PREFS_KEYS.length ||
        !FABRIC_ONION_SKIN_PREFS_KEYS.every(key => keys.includes(key))) {
      return null;
    }
    const { enabled, before, after, opacityPercent } = value;
    if (typeof enabled !== 'boolean' ||
        !isIntegerInRange(before, 0, FABRIC_ONION_SKIN_MAX_SHEETS) ||
        !isIntegerInRange(after, 0, FABRIC_ONION_SKIN_MAX_SHEETS) ||
        !isIntegerInRange(
          opacityPercent,
          FABRIC_ONION_SKIN_MIN_OPACITY_PERCENT,
          FABRIC_ONION_SKIN_MAX_OPACITY_PERCENT
        )) {
      return null;
    }
    return { enabled, before, after, opacityPercent };
  } catch (_error) {
    return null;
  }
}

module.exports = {
  FABRIC_ONION_SKIN_MAX_SHEETS,
  FABRIC_ONION_SKIN_MIN_OPACITY_PERCENT,
  FABRIC_ONION_SKIN_MAX_OPACITY_PERCENT,
  FABRIC_ONION_SKIN_DEFAULT_PREFS,
  normalizeFabricOnionSkinPrefs
};
