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
 * 렌더 단위 레인 할당 — 접힌 클러스터 배지와 단일 댓글이 서로 덮이지 않도록 배치.
 *
 * laneSpan은 펼친 클러스터처럼 세로로 여러 줄을 차지하는 렌더 단위가 예약할 줄 수다.
 * @param {Array<{startFrame: number, endFrame: number, laneSpan?: number}>} items
 * @returns {{lanes: Array<number>, maxLane: number}}
 */
export function assignRenderLanes(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { lanes: [], maxLane: 0 };
  }

  const sorted = [...items].sort((a, b) =>
    a.startFrame - b.startFrame || a.endFrame - b.endFrame
  );
  const laneEnds = [];

  for (const item of sorted) {
    const startFrame = Number.isFinite(item.startFrame) ? item.startFrame : 0;
    const endFrame = Number.isFinite(item.endFrame)
      ? Math.max(startFrame, item.endFrame)
      : startFrame;
    const laneSpan = Math.max(
      1,
      Math.floor(Number.isFinite(item.laneSpan) ? item.laneSpan : 1)
    );

    let assigned = 0;
    while (true) {
      let fits = true;
      for (let i = 0; i < laneSpan; i++) {
        if ((laneEnds[assigned + i] ?? -Infinity) > startFrame) {
          fits = false;
          break;
        }
      }
      if (fits) break;
      assigned++;
    }

    for (let i = 0; i < laneSpan; i++) {
      laneEnds[assigned + i] = endFrame;
    }
    item._lane = assigned;
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

function getFiniteFrame(value, fallback = 0) {
  const frame = Number(value);
  return Number.isFinite(frame) ? frame : fallback;
}

function clampDelta(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 접힌 댓글 클러스터의 한쪽 끝을 조절할 때 모든 멤버에 적용할 frame 업데이트 계산.
 *
 * 각 댓글의 길이는 최소 1프레임을 유지하며, 가능한 범위 안에서 모든 댓글에 같은 delta를 적용한다.
 *
 * @param {Array<{markerId: string, startFrame: number, endFrame: number}>} cluster
 * @param {{edge: 'left'|'right', deltaFrames: number, totalFrames?: number}} opts
 * @returns {{appliedDeltaFrames: number, updates: Array}}
 */
export function resizeClusterMembersByEdge(cluster, opts = {}) {
  if (!Array.isArray(cluster) || cluster.length === 0) {
    return { appliedDeltaFrames: 0, updates: [] };
  }

  const edge = opts.edge === 'right' ? 'right' : 'left';
  const deltaFrames = Math.round(getFiniteFrame(opts.deltaFrames, 0));
  const totalFrames = getFiniteFrame(opts.totalFrames, 0);
  const normalized = cluster.map(item => {
    const startFrame = getFiniteFrame(item.startFrame, 0);
    const endFrame = Math.max(startFrame + 1, getFiniteFrame(item.endFrame, startFrame + 1));
    return { ...item, startFrame, endFrame };
  });

  let appliedDeltaFrames;
  if (edge === 'left') {
    const minStart = Math.min(...normalized.map(item => item.startFrame));
    const maxShrink = Math.min(...normalized.map(item => item.endFrame - item.startFrame - 1));
    appliedDeltaFrames = clampDelta(deltaFrames, -minStart, maxShrink);
  } else {
    const maxEnd = Math.max(...normalized.map(item => item.endFrame));
    const maxShrink = Math.min(...normalized.map(item => item.endFrame - item.startFrame - 1));
    const maxGrow = totalFrames > 0 ? Math.max(0, totalFrames - maxEnd) : Number.POSITIVE_INFINITY;
    appliedDeltaFrames = clampDelta(deltaFrames, -maxShrink, maxGrow);
  }

  const updates = normalized.map(item => {
    if (edge === 'left') {
      return {
        ...item,
        startFrame: item.startFrame + appliedDeltaFrames,
        endFrame: item.endFrame
      };
    }
    return {
      ...item,
      startFrame: item.startFrame,
      endFrame: item.endFrame + appliedDeltaFrames
    };
  });

  return { appliedDeltaFrames, updates };
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
