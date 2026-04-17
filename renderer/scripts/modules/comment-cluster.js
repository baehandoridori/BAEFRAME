/**
 * 구간 댓글 클러스터링 + 레인 할당 — 순수 함수
 *
 * 구간: [startFrame, endFrame) 반열린. endFrame == 다른 startFrame은 겹침 아님.
 */

/**
 * 시간 구간이 겹치는 댓글을 연결 성분으로 묶음.
 * @param {Array<{markerId, startFrame, endFrame}>} comments
 * @returns {Array<Array>} 클러스터 배열 (각 클러스터는 startFrame 오름차순)
 */
export function findRangeClusters(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return [];

  const sorted = [...comments].sort((a, b) => a.startFrame - b.startFrame);
  const clusters = [];
  let current = [];
  let currentMaxEnd = -Infinity;

  for (const c of sorted) {
    if (current.length === 0 || c.startFrame < currentMaxEnd) {
      current.push(c);
      currentMaxEnd = Math.max(currentMaxEnd, c.endFrame);
    } else {
      clusters.push(current);
      current = [c];
      currentMaxEnd = c.endFrame;
    }
  }
  if (current.length) clusters.push(current);
  return clusters;
}

/**
 * 그리디 레인 할당 — 겹치지 않는 댓글은 같은 레인 재사용.
 * @param {Array<{startFrame, endFrame}>} cluster
 * @returns {{lanes: Array<number>, maxLane: number}}
 *   각 comment에 `_lane` (0-기반) 속성이 붙음 (mutation).
 *   `lanes[i]`는 레인 i의 마지막 endFrame.
 */
export function assignLanes(cluster) {
  const sorted = [...cluster].sort((a, b) => a.startFrame - b.startFrame);
  const laneEnds = []; // laneEnds[i] = 해당 레인의 마지막 endFrame

  for (const c of sorted) {
    let assigned = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= c.startFrame) {
        // 반열린: 이전 레인의 end가 현재 start와 같거나 작으면 재사용
        assigned = i;
        break;
      }
    }
    if (assigned === -1) {
      assigned = laneEnds.length;
      laneEnds.push(c.endFrame);
    } else {
      laneEnds[assigned] = c.endFrame;
    }
    c._lane = assigned;
  }

  return { lanes: laneEnds, maxLane: laneEnds.length };
}

/**
 * 클러스터 고유 식별자 — 첫(가장 이른 start) 댓글의 markerId 사용.
 */
export function clusterKey(cluster) {
  return cluster.length > 0 ? cluster[0].markerId : null;
}
