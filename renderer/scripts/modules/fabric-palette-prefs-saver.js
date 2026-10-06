/**
 * 드로잉 팔레트 값(마지막 색·굵기·불투명도·내 색)의 저장을 모은다.
 *
 * 오버레이는 값이 바뀔 때마다 그 자리에서 알린다 — 슬라이더나 색 고르기 판을 끄는
 * 동안에는 1초에 수십 번이다. 그때마다 설정 파일을 쓰면 안 되므로 마지막 값만 들고
 * 있다가 조용해지면 한 번 저장한다.
 *
 * 모으는 쪽이 오버레이가 아니라 여기(메인 창)인 이유: 오버레이 창은 앱 종료나 복구 때
 * 예고 없이 사라진다. 거기서 모으면 사라지기 직전의 변경이 통째로 없어진다. 메인 창은
 * 그보다 오래 살고, 닫힐 때 flush 로 남은 값을 적을 수 있다.
 */

export const FABRIC_PALETTE_PREFS_SAVE_DELAY_MS = 400;

export function createFabricPalettePrefsSaver({
  save,
  delayMs = FABRIC_PALETTE_PREFS_SAVE_DELAY_MS,
  setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
  clearTimeoutFn = handle => clearTimeout(handle)
} = {}) {
  if (typeof save !== 'function') throw new Error('Palette prefs saver requires a save function');
  let pending = null;
  let timer = null;

  // 들고 있는 값을 지금 저장한다. 저장할 것이 있었으면 true.
  function flush() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (pending === null) return false;
    const prefs = pending;
    pending = null;
    save(prefs);
    return true;
  }

  function push(prefs) {
    pending = prefs;
    if (timer !== null) clearTimeoutFn(timer);
    timer = setTimeoutFn(flush, delayMs);
  }

  return { push, flush, hasPending: () => pending !== null };
}
