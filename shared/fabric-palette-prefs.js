'use strict';

/**
 * 드로잉 팔레트 값(마지막 색·굵기·불투명도·"내 색")의 한도와 검증 단일 소스.
 *
 * 이 값은 영상 위 오버레이 창에서 바뀌고 메인 창의 사용자 설정에 보존되므로
 * 프로세스 경계를 두 번 넘는다. 넘을 때마다 같은 검증을 거쳐야 한 쪽이 통과시킨
 * 값을 다른 쪽이 거부하는 일이 없다.
 *
 * - renderer/scripts/modules/mpv-fabric-overlay-runtime.js: require (esbuild 번들 시 인라인)
 * - preload/mpv-overlay-preload.js: require (오버레이 → 메인 프로세스)
 * - main/ipc-handlers.js, main/mpv-overlay-host.js: require
 * - preload/preload.js: require (메인 프로세스 → 메인 렌더러)
 * - renderer/scripts/modules/user-settings.js: 브라우저 네이티브 ES 모듈이라 CommonJS 를
 *   import 할 수 없으므로 리터럴을 유지하고, scripts/tests/fabric-palette-prefs.test.js 가
 *   값이 같음을 강제한다.
 *
 * 그림 자체의 색은 여기와 무관하다 — 획의 색은 저장 스키마(`#rrggbb`)가 검증한다.
 */

const FABRIC_PALETTE_SAVED_COLOR_LIMIT = 7;
const FABRIC_PALETTE_MIN_BRUSH_SIZE = 1;
const FABRIC_PALETTE_MAX_BRUSH_SIZE = 50;
const FABRIC_PALETTE_MIN_OPACITY_PERCENT = 10;
const FABRIC_PALETTE_MAX_OPACITY_PERCENT = 100;
const FABRIC_PALETTE_PREFS_KEYS = Object.freeze(['color', 'size', 'opacity', 'savedColors']);
// 경계를 넘는 값은 이미 정규화된 소문자 6자리만 받는다. 느슨한 입력(대문자·# 생략)은
// 사용자가 글자를 치는 런타임 안에서만 받아 주고, 밖으로 나갈 때는 정규형이다.
const FABRIC_PALETTE_HEX_COLOR = /^#[0-9a-f]{6}$/;

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * @returns {{ color: string, size: number, opacity: number, savedColors: string[] } | null}
 *   형식이 조금이라도 다르면 null. 고쳐 쓰지 않는다 — 고쳐 쓰면 보낸 쪽과 받은 쪽의
 *   값이 조용히 달라진다.
 */
function normalizeFabricPalettePrefs(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  // 접근자·프록시가 던지는 예외도 "형식이 다르다"로 본다. 검증기가 호출자를 죽이면 안 된다.
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Object.keys(value);
    if (keys.length !== FABRIC_PALETTE_PREFS_KEYS.length ||
        !FABRIC_PALETTE_PREFS_KEYS.every(key => keys.includes(key))) {
      return null;
    }
    const { color, size, opacity, savedColors } = value;
    if (typeof color !== 'string' || !FABRIC_PALETTE_HEX_COLOR.test(color) ||
        !isIntegerInRange(size, FABRIC_PALETTE_MIN_BRUSH_SIZE, FABRIC_PALETTE_MAX_BRUSH_SIZE) ||
        !isIntegerInRange(
          opacity,
          FABRIC_PALETTE_MIN_OPACITY_PERCENT,
          FABRIC_PALETTE_MAX_OPACITY_PERCENT
        ) ||
        !Array.isArray(savedColors) ||
        savedColors.length > FABRIC_PALETTE_SAVED_COLOR_LIMIT) {
      return null;
    }
    const colors = [];
    for (const entry of savedColors) {
      if (typeof entry !== 'string' || !FABRIC_PALETTE_HEX_COLOR.test(entry) ||
          colors.includes(entry)) {
        return null;
      }
      colors.push(entry);
    }
    return { color, size, opacity, savedColors: colors };
  } catch (_error) {
    return null;
  }
}

module.exports = {
  FABRIC_PALETTE_SAVED_COLOR_LIMIT,
  FABRIC_PALETTE_MIN_BRUSH_SIZE,
  FABRIC_PALETTE_MAX_BRUSH_SIZE,
  FABRIC_PALETTE_MIN_OPACITY_PERCENT,
  FABRIC_PALETTE_MAX_OPACITY_PERCENT,
  normalizeFabricPalettePrefs
};
