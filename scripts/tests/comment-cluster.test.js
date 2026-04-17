/**
 * comment-cluster 단위 테스트
 * 실행: npm run test:cluster
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

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
