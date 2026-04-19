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
 * 클러스터 고유 식별자 — 클러스터 내 모든 markerId를 정렬해 조합.
 * 정렬 순서가 바뀌거나 단일 댓글 위치가 이동해도 클러스터 구성원이 같은 한 안정된 키 반환.
 * @param {Array} cluster
 * @returns {string|null} "id1|id2|id3" 형태의 정렬 조합 / 빈 클러스터는 null
 */
export function clusterKey(cluster) {
  if (!cluster || cluster.length === 0) return null;
  return cluster.map(c => c.markerId).sort().join('|');
}

/**
 * 클러스터 내부에서 이웃 구간의 `startFrame` 간격이 minSpacingPx 이상이면 분리한다.
 *
 * 기준이 `startFrame` 간격인 이유: 타임라인의 포인트 댓글 마커 클러스터링이 동일한
 * "20px 미만 시작점 거리" 기준을 사용한다(timeline.js _renderClusteredMarkers).
 * 구간 코멘트도 같은 기준으로 묶어야 포인트 마커의 "(N)" 복수 배지와 구간 배지가
 * 시각적으로 일관되게 나타난다.
 *
 * @param {Array<Array>} clusters - findRangeClusters의 반환값
 * @param {{pxPerFrame: number, minSpacingPx?: number}} [opts]
 * @returns {Array<Array>} 분리된 클러스터 배열 (단일 멤버도 포함 가능)
 */
export function splitClustersByPixelGap(clusters, opts = {}) {
  const { pxPerFrame, minSpacingPx = 20 } = opts;
  if (!Array.isArray(clusters)) return clusters;
  if (typeof pxPerFrame !== 'number' || !isFinite(pxPerFrame) || pxPerFrame <= 0) {
    return clusters;
  }
  const result = [];
  for (const cluster of clusters) {
    if (!cluster || cluster.length < 2) {
      result.push(cluster);
      continue;
    }
    const sorted = [...cluster].sort((a, b) => a.startFrame - b.startFrame);
    let current = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      // 포인트 마커 클러스터링과 동일: startFrame 간 픽셀 거리 기준
      const spacingFrames = curr.startFrame - prev.startFrame;
      const spacingPx = spacingFrames * pxPerFrame;
      if (spacingPx >= minSpacingPx) {
        result.push(current);
        current = [curr];
      } else {
        current.push(curr);
      }
    }
    result.push(current);
  }
  return result;
}
