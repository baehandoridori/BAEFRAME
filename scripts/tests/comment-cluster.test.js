/**
 * comment-cluster 단위 테스트
 * 실행: npm run test:cluster
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const longVideoMockupPath = path.join(rootDir, 'docs/mockups/2026-06-07-comment-range-long-video.html');

let mod;
test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/comment-cluster.js');
});

function c(id, start, end) {
  return { markerId: id, startFrame: start, endFrame: end };
}

// --- findRangeClusters ---

test('빈 배열 → 빈 클러스터', () => {
  assert.deepEqual(mod.findRangeClusters([]), []);
});

test('단일 댓글 → 단일 클러스터 (크기 1)', () => {
  const cs = [c('a', 0, 10)];
  const result = mod.findRangeClusters(cs);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 1);
});

test('비중첩 둘 → 독립 클러스터 2개', () => {
  const cs = [c('a', 0, 10), c('b', 20, 30)];
  const result = mod.findRangeClusters(cs);
  assert.equal(result.length, 2);
});

test('인접하지만 겹치지 않음 (end == start): 독립', () => {
  const cs = [c('a', 0, 10), c('b', 10, 20)];
  const result = mod.findRangeClusters(cs);
  assert.equal(result.length, 2, 'endFrame == startFrame은 겹침 아님 (반열린 구간 규칙)');
});

test('정확히 겹치는 두 댓글: 하나의 클러스터', () => {
  const cs = [c('a', 0, 10), c('b', 5, 15)];
  const result = mod.findRangeClusters(cs);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 2);
});

test('전이적 겹침 (A-B, B-C): 단일 클러스터로 병합', () => {
  const cs = [c('a', 0, 10), c('b', 5, 15), c('c', 12, 20)];
  const result = mod.findRangeClusters(cs);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 3);
});

test('정렬되지 않은 입력 — 결과는 정렬됨', () => {
  const cs = [c('c', 20, 30), c('a', 0, 10), c('b', 5, 15)];
  const result = mod.findRangeClusters(cs);
  // 정렬 후 [a,b], [c]
  assert.equal(result.length, 2);
  assert.equal(result[0][0].markerId, 'a');
  assert.equal(result[1][0].markerId, 'c');
});

test('동일 startFrame: 단일 클러스터', () => {
  const cs = [c('a', 10, 20), c('b', 10, 30)];
  const result = mod.findRangeClusters(cs);
  assert.equal(result.length, 1);
});

// --- assignLanes ---

test('단일 댓글: 레인 0', () => {
  const cs = [c('a', 0, 10)];
  const { lanes, maxLane } = mod.assignLanes(cs);
  assert.equal(lanes.length, 1);
  assert.equal(maxLane, 1);
  assert.equal(cs[0]._lane, 0);
});

test('비중첩 둘: 둘 다 레인 0 (같은 레인에 순차)', () => {
  const cs = [c('a', 0, 10), c('b', 20, 30)];
  const { lanes, maxLane } = mod.assignLanes(cs);
  assert.equal(maxLane, 1);
  assert.equal(cs[0]._lane, 0);
  assert.equal(cs[1]._lane, 0);
});

test('완전 겹침 둘: 레인 0, 1', () => {
  const cs = [c('a', 0, 10), c('b', 5, 15)];
  const { lanes, maxLane } = mod.assignLanes(cs);
  assert.equal(maxLane, 2);
  assert.equal(cs[0]._lane, 0);
  assert.equal(cs[1]._lane, 1);
});

test('세 개 겹침: 레인 0, 1, 2', () => {
  const cs = [c('a', 0, 10), c('b', 5, 15), c('c', 8, 20)];
  const { maxLane } = mod.assignLanes(cs);
  assert.equal(maxLane, 3);
});

test('재사용 가능한 레인: A(0-10), B(5-15), C(12-20) → A,C는 레인 0 공유', () => {
  const cs = [c('a', 0, 10), c('b', 5, 15), c('c', 12, 20)];
  const { maxLane } = mod.assignLanes(cs);
  assert.equal(maxLane, 2, 'B는 새 레인, C는 A의 레인 재사용');
  assert.equal(cs[0]._lane, 0);
  assert.equal(cs[1]._lane, 1);
  assert.equal(cs[2]._lane, 0);
});

test('렌더 단위 레인: 접힌 클러스터와 단일 댓글이 시간상 겹치면 다른 줄에 배치한다', () => {
  const items = [
    { id: 'cluster', startFrame: 24, endFrame: 120 },
    { id: 'single', startFrame: 70, endFrame: 110 }
  ];

  const { maxLane } = mod.assignRenderLanes(items);

  assert.equal(maxLane, 2);
  assert.equal(items[0]._lane, 0);
  assert.equal(items[1]._lane, 1);
});

test('렌더 단위 레인: 펼친 클러스터는 내부 레인 수만큼 세로 공간을 예약한다', () => {
  const items = [
    { id: 'expanded', startFrame: 0, endFrame: 100, laneSpan: 2 },
    { id: 'overlap', startFrame: 20, endFrame: 40 },
    { id: 'after', startFrame: 100, endFrame: 120 }
  ];

  const { maxLane } = mod.assignRenderLanes(items);

  assert.equal(maxLane, 3);
  assert.equal(items[0]._lane, 0);
  assert.equal(items[1]._lane, 2);
  assert.equal(items[2]._lane, 0);
});

// --- clusterKey ---

test('clusterKey: 빈 클러스터 → null', () => {
  assert.equal(mod.clusterKey([]), null);
});

test('clusterKey: 단일 댓글 클러스터 → 해당 markerId', () => {
  assert.equal(mod.clusterKey([c('x', 0, 10)]), 'x');
});

test('clusterKey: 여러 댓글 클러스터 → 정렬된 markerId 조합', () => {
  const cluster = [c('first', 0, 10), c('second', 5, 15)];
  assert.equal(mod.clusterKey(cluster), 'first|second');
});

test('clusterKey: 멤버 순서가 달라도 동일한 키 반환 (안정성)', () => {
  const k1 = mod.clusterKey([c('alpha', 0, 10), c('beta', 5, 15)]);
  const k2 = mod.clusterKey([c('beta', 5, 15), c('alpha', 0, 10)]);
  assert.equal(k1, k2);
  assert.equal(k1, 'alpha|beta');
});

test('resizeClusterMembersByEdge: 왼쪽 끝 조절은 모든 멤버 startFrame을 같은 delta로 변경한다', () => {
  const cluster = [
    c('a', 10, 40),
    c('b', 20, 50),
    c('c', 25, 60)
  ];

  const result = mod.resizeClusterMembersByEdge(cluster, {
    edge: 'left',
    deltaFrames: 5,
    totalFrames: 100
  });

  assert.equal(result.appliedDeltaFrames, 5);
  assert.deepEqual(result.updates.map(item => [item.markerId, item.startFrame, item.endFrame]), [
    ['a', 15, 40],
    ['b', 25, 50],
    ['c', 30, 60]
  ]);
});

test('resizeClusterMembersByEdge: 오른쪽 끝 조절은 모든 멤버 endFrame을 같은 delta로 변경한다', () => {
  const cluster = [
    c('a', 10, 40),
    c('b', 20, 50),
    c('c', 25, 60)
  ];

  const result = mod.resizeClusterMembersByEdge(cluster, {
    edge: 'right',
    deltaFrames: -8,
    totalFrames: 100
  });

  assert.equal(result.appliedDeltaFrames, -8);
  assert.deepEqual(result.updates.map(item => [item.markerId, item.startFrame, item.endFrame]), [
    ['a', 10, 32],
    ['b', 20, 42],
    ['c', 25, 52]
  ]);
});

test('resizeClusterMembersByEdge: 너무 많이 줄이면 모든 댓글이 최소 1프레임을 유지하도록 delta를 제한한다', () => {
  const cluster = [
    c('a', 10, 14),
    c('b', 20, 50)
  ];

  const result = mod.resizeClusterMembersByEdge(cluster, {
    edge: 'right',
    deltaFrames: -10,
    totalFrames: 100
  });

  assert.equal(result.appliedDeltaFrames, -3);
  assert.deepEqual(result.updates.map(item => [item.markerId, item.startFrame, item.endFrame]), [
    ['a', 10, 11],
    ['b', 20, 47]
  ]);
});

test('접힌 댓글 클러스터 바는 손잡이와 Ctrl 드래그로 그룹 범위를 조절한다', () => {
  assert.match(timelineSource, /comment-cluster-handle comment-cluster-handle-left/);
  assert.match(timelineSource, /comment-cluster-handle comment-cluster-handle-right/);
  assert.match(mainCss, /\.comment-cluster-handle/);
  assert.match(appSource, /function beginCommentClusterResize\(clusterBadge, edge, e\)/);
  assert.match(appSource, /e\.ctrlKey \|\| clusterHandle/);
  assert.match(appSource, /resizeClusterMembersByEdge/);
});

test('일반 댓글 바도 Ctrl 드래그 시 클릭한 절반 기준으로 길이를 조절한다', () => {
  assert.match(appSource, /function getResizeEdgeFromElementHalf\(element, e\)/);
  assert.match(appSource, /function beginCommentRangeResize\(item, marker, handle, e\)/);
  assert.match(appSource, /if \(e\.ctrlKey\) \{/);
  assert.match(appSource, /beginCommentRangeResize\(item, marker, getResizeEdgeFromElementHalf\(item, e\), e\)/);
  assert.match(appSource, /document\.body\.style\.cursor = 'ew-resize'/);
});

test('Ctrl 드래그는 짧은 댓글 바 근처의 넓은 영역에서도 리사이즈 대상을 찾는다', () => {
  assert.match(appSource, /const CTRL_COMMENT_RESIZE_MIN_HIT_WIDTH = 72/);
  assert.match(appSource, /function findCtrlCommentResizeTarget\(e\)/);
  assert.match(appSource, /commentTrack\.querySelectorAll\([\s\S]*'\.comment-range-item, \.comment-cluster-badge'[\s\S]*\)/);
  assert.match(appSource, /if \(e\.ctrlKey\) \{[\s\S]*findCtrlCommentResizeTarget\(e\)/);
});

test('Ctrl 키를 누르고 댓글 트랙에 마우스를 올리면 넓어진 리사이즈 후보 영역을 시각적으로 표시한다', () => {
  assert.match(appSource, /let ctrlCommentResizeKeyDown = false/);
  assert.match(appSource, /let ctrlCommentResizeCandidate = null/);
  assert.match(appSource, /function updateCtrlCommentResizeCandidate\(e\)/);
  assert.match(appSource, /ctrl-resize-candidate/);
  assert.match(appSource, /ctrl-resize-left/);
  assert.match(appSource, /ctrl-resize-right/);
  assert.match(appSource, /commentTrack\.addEventListener\('mousemove', updateCtrlCommentResizeCandidate\)/);
  assert.match(appSource, /document\.addEventListener\('keydown'[\s\S]*ctrlCommentResizeKeyDown = true/);
  assert.match(mainCss, /\.comment-range-item\.ctrl-resize-candidate::before/);
  assert.match(mainCss, /\.comment-cluster-badge\.ctrl-resize-candidate::before/);
  assert.match(mainCss, /width: 72px/);
});

test('긴 영상 댓글 범위 목업은 5분/10분 타임라인과 Ctrl 리사이즈 시각화를 포함한다', () => {
  assert.equal(fs.existsSync(longVideoMockupPath), true);
  const mockupSource = normalizeNewlines(fs.readFileSync(longVideoMockupPath, 'utf8'));
  assert.match(mockupSource, /data-duration="300"/);
  assert.match(mockupSource, /data-duration="600"/);
  assert.match(mockupSource, /Ctrl 리사이즈 모드/);
  assert.match(mockupSource, /ctrl-resize-candidate/);
  assert.match(mockupSource, /긴 영상/);
});

test('댓글 지속시간 타임라인 표시는 체크 토글로 켜고 끈다', () => {
  assert.match(indexSource, /id="toggleCommentTimelineRanges"/);
  assert.match(indexSource, /댓글 구간/);
  assert.match(mainCss, /\.comment-timeline-toggle/);
  assert.match(userSettingsSource, /showCommentTimelineRanges: true/);
  assert.match(userSettingsSource, /getShowCommentTimelineRanges\(\)/);
  assert.match(userSettingsSource, /setShowCommentTimelineRanges\(show\)/);
  assert.match(timelineSource, /setCommentRangesVisible\(visible\)/);
  assert.match(appSource, /toggleCommentTimelineRanges/);
  assert.match(appSource, /timeline\.setCommentRangesVisible\(show\)/);
});

// --- splitClustersByPixelGap ---
// 기준: 이웃 구간의 startFrame 간격 (포인트 마커 클러스터링과 동일, 기본 20px)

test('split: 빈 배열 입력 → 빈 배열 반환', () => {
  assert.deepEqual(mod.splitClustersByPixelGap([], { pxPerFrame: 1, minSpacingPx: 20 }), []);
});

test('split: 단일 멤버 클러스터는 그대로 통과', () => {
  const cluster = [c('a', 0, 10)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 1, minSpacingPx: 20 });
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 1);
  assert.equal(result[0][0].markerId, 'a');
});

test('split: 모든 spacing이 minSpacingPx 미만 → 원본 클러스터 그대로', () => {
  // startFrame 0→15 = 15px < 20px
  const cluster = [c('a', 0, 10), c('b', 15, 25)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 1, minSpacingPx: 20 });
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 2);
});

test('split: 한 지점만 spacing ≥ minSpacingPx → 2개로 분리', () => {
  // startFrame 0→25 = 25px ≥ 20px
  const cluster = [c('a', 0, 10), c('b', 25, 35)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 1, minSpacingPx: 20 });
  assert.equal(result.length, 2);
  assert.equal(result[0][0].markerId, 'a');
  assert.equal(result[1][0].markerId, 'b');
});

test('split: 여러 spacing ≥ minSpacingPx → N+1개로 분리', () => {
  // startFrame 0→25→50, 각 25px 간격
  const cluster = [c('a', 0, 5), c('b', 25, 30), c('c', 50, 55)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 1, minSpacingPx: 20 });
  assert.equal(result.length, 3);
});

test('split: pxPerFrame = 0 → 원본 그대로 (안전 가드)', () => {
  const cluster = [c('a', 0, 10), c('b', 100, 110)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 0, minSpacingPx: 20 });
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 2);
});

test('split: pxPerFrame 음수 → 원본 그대로', () => {
  const cluster = [c('a', 0, 10), c('b', 100, 110)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: -1, minSpacingPx: 20 });
  assert.equal(result.length, 1);
});

test('split: minSpacingPx 옵션 생략 → 기본 20px 적용', () => {
  // startFrame 0→25 = 25px ≥ 20px
  const cluster = [c('a', 0, 10), c('b', 25, 35)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 1 });
  assert.equal(result.length, 2);
});

test('split: 정렬되지 않은 멤버도 처리', () => {
  const cluster = [c('b', 25, 35), c('a', 0, 10)]; // spacing=25px, 입력 역순
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 1, minSpacingPx: 20 });
  assert.equal(result.length, 2);
  assert.equal(result[0][0].markerId, 'a');
  assert.equal(result[1][0].markerId, 'b');
});

test('split: pxPerFrame이 작으면 spacing이 커도 묶임 유지 (줌 아웃)', () => {
  // startFrame 차 100 * pxPerFrame 0.1 = 10px < 20px
  const cluster = [c('a', 0, 10), c('b', 100, 110)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 0.1, minSpacingPx: 20 });
  assert.equal(result.length, 1);
});

test('split: 긴 구간이 중간에 있어도 startFrame만 가까우면 같은 클러스터', () => {
  // A는 긴 구간 [0,1000], B는 A 시작점 근처 [5,10]
  const cluster = [c('a', 0, 1000), c('b', 5, 10)];
  const result = mod.splitClustersByPixelGap([cluster], { pxPerFrame: 1, minSpacingPx: 20 });
  assert.equal(result.length, 1, 'startFrame 간격 5px이므로 묶임 유지');
});
