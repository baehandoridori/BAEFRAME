/**
 * 보존해 둔 어니언 스킨 설정(켜짐·앞뒤 장수·진하기)을 오버레이에 심는다.
 *
 * 오버레이가 받을 수 있는 상태가 될 때마다 push() 를 부른다. 오버레이가 아직 준비되지
 * 않아 닿지 못했으면 잠깐 뒤에 몇 번 더 보낸다. 닿지 못한 채로 사용자가 그 오버레이에서
 * 값을 바꾸면, 그 오버레이의 기본값(장수·진하기)이 함께 저장돼 보존해 둔 값을 덮는다.
 *
 * 오버레이가 답했으면 끝이다 — 받았든, 사용자가 이미 값을 바꿔서 거절했든 더 보낼 것이
 * 없다. push() 를 다시 부르면 앞선 재시도는 그만둔다.
 */

export const FABRIC_ONION_SKIN_PREFS_RETRY_DELAYS_MS = Object.freeze([500, 1500, 4000]);

export function createFabricOnionSkinPrefsPusher({
  apply,
  flush = () => {},
  getPrefs,
  hasCustomPrefs,
  retryDelaysMs = FABRIC_ONION_SKIN_PREFS_RETRY_DELAYS_MS,
  setTimer = (callback, delay) => setTimeout(callback, delay)
} = {}) {
  if (typeof apply !== 'function' || typeof getPrefs !== 'function' ||
      typeof hasCustomPrefs !== 'function') {
    throw new TypeError('onion skin prefs pusher needs apply, getPrefs and hasCustomPrefs functions');
  }

  let serial = 0;

  async function attempt(current, retryIndex) {
    if (current !== serial) return;
    let result = null;
    try {
      // 아직 적지 못한 변경이 있으면 먼저 적는다. 방금 바꾼 값을 보내야 한다.
      flush();
      // 한 번도 바꾼 적이 없는 값은 새 오버레이의 기본값과 같다. 보낼 것이 없다.
      if (!hasCustomPrefs()) return;
      result = await apply(getPrefs());
    } catch {
      result = null;
    }
    if (result?.success === true || current !== serial) return;
    const delay = retryDelaysMs[retryIndex];
    if (!Number.isFinite(delay) || delay < 0) return;
    setTimer(() => {
      void attempt(current, retryIndex + 1);
    }, delay);
  }

  return {
    push() {
      serial += 1;
      void attempt(serial, 0);
    }
  };
}
