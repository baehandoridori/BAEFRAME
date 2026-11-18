// 여러 사람이 같은 .bframe 을 열었을 때 해결 상태가 수렴하는지 본다.
//
// 2026-11-18, 팀 전체가 함께 보는 검수 파일에서 드러난 네 가지를 각각 재현한다.
//   1. 실시간 방 정원(10명) 초과 시 접속 대기가 끝나지 않는다.
//   2. 방 안의 사용자는 파일로만 도착하는 변경(정원 밖 사용자의 변경)을 받지 못한다.
//   3. 저장이 충돌로 거절되면 재시도 없이 실패로 끝난다.
//   4. 드라이브가 늦게 배달한 옛 사본이 해결 상태를 되돌리거나 댓글을 지우고 충돌 사본을 만든다.
const { test } = require('node:test');
const assert = require('node:assert/strict');

if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      this.detail = options.detail;
    }
  };
}
global.window = global.window || {};
window.logPanel = null;
// Liveblocks 번들은 불러올 때 개발 도구용 message 리스너를 window 에 건다.
window.addEventListener = window.addEventListener || (() => {});
window.removeEventListener = window.removeEventListener || (() => {});

const REVIEW_ID = 'reviewdoc-55555555-5555-4555-8555-555555555555';
const LAYER_ID = 'comment-layer-1';

// 경로마다 따로 있는 디스크 사본. 서로 다른 PC 의 구글 드라이브 로컬 사본을 흉내 낸다.
const disks = new Map();
let tokenSequence = 0;
const saveInterceptors = [];

function writeDisk(path, root) {
  tokenSequence += 1;
  disks.set(path, { root: structuredClone(root), token: `token-${tokenSequence}` });
}

function readDisk(path) {
  return structuredClone(disks.get(path).root);
}

function diskMarkers(path) {
  return disks.get(path).root.comments.layers[0].markers;
}

function diskMarker(path, id) {
  return diskMarkers(path).find(marker => marker.id === id);
}

function installElectronApi() {
  window.electronAPI = {
    loadReview: async path => (disks.has(path) ? readDisk(path) : null),
    loadReviewSnapshot: async path => ({
      data: disks.has(path) ? readDisk(path) : null,
      versionToken: disks.get(path)?.token || '__ABSENT__'
    }),
    saveReview: async (path, data, options = {}) => {
      const interceptor = saveInterceptors.shift();
      if (interceptor) {
        const intercepted = await interceptor(path, data, options);
        if (intercepted) return intercepted;
      }
      const current = disks.get(path);
      if (options.expectedVersionToken && current &&
          options.expectedVersionToken !== current.token) {
        return { success: false, conflict: true, reason: 'stale-version-token' };
      }
      writeDisk(path, data);
      return { success: true, versionToken: disks.get(path).token };
    }
  };
}

function markerRecord(id, overrides = {}) {
  return {
    id,
    x: 0.5,
    y: 0.5,
    startFrame: 10,
    endFrame: 106,
    fps: 24,
    text: `댓글 ${id}`,
    author: '작성자',
    createdAt: '2026-11-18T04:00:00.000Z',
    updatedAt: '2026-11-18T04:00:00.000Z',
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
    deleted: false,
    deletedAt: null,
    layerId: LAYER_ID,
    colorKey: 'default',
    replies: [],
    ...overrides
  };
}

function reviewRoot(markers, videoPath) {
  return {
    bframeVersion: '2.0',
    videoFile: videoPath.split('/').pop(),
    videoPath,
    fps: 24,
    createdAt: '2026-11-18T04:00:00.000Z',
    modifiedAt: '2026-11-18T04:00:00.000Z',
    reviewDocumentId: REVIEW_ID,
    comments: {
      fps: 24,
      layers: [{
        id: LAYER_ID,
        name: '댓글 1',
        color: '#ffd000',
        visible: true,
        locked: false,
        markers
      }]
    },
    drawings: { layers: [] },
    highlights: { highlights: [] },
    compositionLayers: []
  };
}

let clientSequence = 0;

async function openClient(name, markers, options = {}) {
  const { CommentManager } = await import('../../renderer/scripts/modules/comment-manager.js');
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  installElectronApi();
  clientSequence += 1;
  const videoPath = `C:/pc-${clientSequence}/review.mp4`;
  const bframePath = `C:/pc-${clientSequence}/review.bframe`;
  if (markers) writeDisk(bframePath, reviewRoot(markers, videoPath));
  const commentManager = new CommentManager({ author: name });
  const manager = new ReviewDataManager({
    commentManager,
    autoSave: options.autoSave === true,
    autoSaveDelay: 5,
    saveRetryDelays: options.saveRetryDelays
  });
  manager.connect();
  await manager.setVideoFile(videoPath);
  return { name, commentManager, manager, videoPath, bframePath };
}

// app.js 의 applyMarkerResolutionToggle + 이벤트 발행과 같은 동작.
function setResolved(client, markerId, resolved, at) {
  const marker = client.commentManager.getMarker(markerId);
  marker.resolved = resolved;
  marker.resolvedAt = resolved ? new Date(at) : null;
  marker.resolvedBy = resolved ? client.name : null;
  marker.updatedAt = new Date(at);
  client.commentManager._emit('markerUpdated', { marker });
  client.commentManager._emit('markersChanged');
  return marker;
}

function addMarker(client, id, at) {
  client.commentManager.restoreMarker(markerRecord(id, { createdAt: at, updatedAt: at }));
}

// 다른 PC 의 저장분이 드라이브를 거쳐 이 PC 의 로컬 사본을 덮어쓴다.
function deliver(fromPath, toPath) {
  const root = readDisk(fromPath);
  const target = disks.get(toPath).root;
  root.videoPath = target.videoPath;
  root.videoFile = target.videoFile;
  writeDisk(toPath, root);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('늦게 도착한 옛 파일 사본이 이미 저장한 해결 상태를 되돌리지 않는다', async () => {
  const client = await openClient('가', [markerRecord('x'), markerRecord('other')]);
  const beforeResolve = readDisk(client.bframePath);

  setResolved(client, 'x', true, '2026-11-18T05:00:00.000Z');
  assert.equal(await client.manager.save(), true);
  assert.equal(diskMarker(client.bframePath, 'x').resolved, true);

  // 해결 전 상태로 계산된 다른 PC 의 저장분이 뒤늦게 내려와 로컬 사본을 덮는다.
  writeDisk(client.bframePath, beforeResolve);

  setResolved(client, 'other', true, '2026-11-18T05:01:00.000Z');
  assert.equal(await client.manager.save(), true);

  assert.equal(diskMarker(client.bframePath, 'x').resolved, true,
    '옛 사본을 원격 변경으로 오인해 해결을 미해결로 되돌리면 안 된다');
  assert.equal(diskMarker(client.bframePath, 'other').resolved, true);
  assert.deepEqual(diskMarkers(client.bframePath).map(marker => marker.id), ['x', 'other']);
  client.manager.disconnect();
});

test('옛 사본에 없는 댓글을 삭제로 보지 않고 충돌 사본도 만들지 않는다', async () => {
  const client = await openClient('가', [markerRecord('x')]);
  const beforeAdd = readDisk(client.bframePath);

  addMarker(client, 'y', '2026-11-18T05:00:00.000Z');
  assert.equal(await client.manager.save(), true);
  assert.deepEqual(diskMarkers(client.bframePath).map(marker => marker.id), ['x', 'y']);

  // y 가 생기기 전에 계산된 사본이 내려온다. 댓글 삭제는 표시(deleted)로 남기므로
  // 파일에 없다는 것은 삭제가 아니라 옛 사본이라는 뜻이다.
  writeDisk(client.bframePath, beforeAdd);

  setResolved(client, 'y', true, '2026-11-18T05:02:00.000Z');
  addMarker(client, 'z', '2026-11-18T05:03:00.000Z');
  assert.equal(await client.manager.save(), true);

  assert.deepEqual(
    diskMarkers(client.bframePath).map(marker => marker.id).sort(),
    ['x', 'y', 'z']
  );
  assert.equal(diskMarker(client.bframePath, 'y').resolved, true);
  client.manager.disconnect();
});

test('두 사람이 같은 댓글을 각자 해결해도 댓글이 둘로 갈라지지 않는다', async () => {
  const first = await openClient('가', [markerRecord('x')]);
  const second = await openClient('나', [markerRecord('x')]);

  setResolved(first, 'x', true, '2026-11-18T05:20:30.760Z');
  assert.equal(await first.manager.save(), true);

  // 나는 가의 변경을 아직 못 본 채 같은 댓글을 해결하고, 그 사이 가의 저장분이 내려온다.
  setResolved(second, 'x', true, '2026-11-18T05:20:43.343Z');
  deliver(first.bframePath, second.bframePath);
  assert.equal(await second.manager.save(), true);

  const markers = diskMarkers(second.bframePath);
  assert.deepEqual(markers.map(marker => marker.id), ['x'],
    '해결 시각만 다른 두 변경은 충돌 사본을 만들 이유가 없다');
  assert.equal(markers[0].resolved, true);
  assert.equal(markers[0].resolvedBy, '나', '나중에 해결한 쪽이 남는다');
  first.manager.disconnect();
  second.manager.disconnect();
});

test('본문 수정과 해결이 겹치면 지금처럼 두 사본으로 보존한다', async () => {
  const first = await openClient('가', [markerRecord('x')]);
  const second = await openClient('나', [markerRecord('x')]);

  first.commentManager.getMarker('x').text = '본문을 고쳤다';
  first.commentManager.getMarker('x').updatedAt = new Date('2026-11-18T05:20:30.000Z');
  first.commentManager._emit('markerUpdated', { marker: first.commentManager.getMarker('x') });
  assert.equal(await first.manager.save(), true);

  setResolved(second, 'x', true, '2026-11-18T05:20:43.000Z');
  deliver(first.bframePath, second.bframePath);
  assert.equal(await second.manager.save(), true);

  assert.deepEqual(
    diskMarkers(second.bframePath).map(marker => marker.id),
    ['x', 'x__remote-conflict']
  );
  first.manager.disconnect();
  second.manager.disconnect();
});

test('같은 답글이 보낸 쪽과 받은 쪽의 저장 모양만 달라도 충돌 사본을 만들지 않는다', async () => {
  const reply = {
    id: 'reply-1',
    text: '펜스가 캐릭터를 가려버려서',
    author: '가',
    createdAt: '2026-11-18T05:10:01.921Z',
    updatedAt: '2026-11-18T05:10:01.921Z'
  };
  const client = await openClient('가', [markerRecord('x')]);

  // 작성자 쪽 모델에는 이미지 칸이 없는 답글이 들어간다.
  const marker = client.commentManager.getMarker('x');
  marker.replies.push({ ...reply, createdAt: new Date(reply.createdAt), updatedAt: new Date(reply.updatedAt) });
  marker.updatedAt = new Date(reply.updatedAt);
  client.commentManager._emit('replyAdded', { marker, reply: marker.replies[0] });

  // 받은 쪽은 Broadcast 모양(이미지 칸이 null)으로 먼저 저장했다.
  const remote = readDisk(client.bframePath);
  remote.comments.layers[0].markers[0].replies.push({
    ...reply, image: null, imageWidth: null, imageHeight: null
  });
  remote.comments.layers[0].markers[0].updatedAt = reply.updatedAt;
  writeDisk(client.bframePath, remote);

  assert.equal(await client.manager.save(), true);
  assert.deepEqual(
    diskMarker(client.bframePath, 'x').replies.map(item => item.id),
    ['reply-1']
  );
  client.manager.disconnect();
});

test('실시간 방 밖 사용자가 파일로 남긴 해결을 방 안 사용자가 받아들인다', async () => {
  const inside = await openClient('방 안', [markerRecord('x'), markerRecord('mine')]);
  const outside = await openClient('방 밖', [markerRecord('x'), markerRecord('mine')]);

  setResolved(outside, 'x', true, '2026-11-18T06:31:00.000Z');
  assert.equal(await outside.manager.save(), true);
  deliver(outside.bframePath, inside.bframePath);

  assert.equal(typeof inside.manager.reloadCommentsFromDisk, 'function');
  const result = await inside.manager.reloadCommentsFromDisk();

  assert.equal(result.success, true);
  assert.equal(result.changed, true);
  assert.equal(inside.commentManager.getMarker('x').resolved, true);
  assert.equal(inside.commentManager.getMarker('x').resolvedBy, '방 밖');
  assert.equal(inside.manager.hasUnsavedChanges(), false,
    '파일에서 받아들인 것만으로 다시 저장을 걸지 않는다');

  // 방 안 사용자가 저장 전인 자기 해결을 들고 있을 때 또 다른 변경이 파일로 온다.
  setResolved(inside, 'mine', true, '2026-11-18T06:32:00.000Z');
  const other = outside.commentManager.getMarker('x');
  other.text = '방 밖에서 고친 본문';
  other.updatedAt = new Date('2026-11-18T06:33:00.000Z');
  outside.commentManager._emit('markerUpdated', { marker: other });
  assert.equal(await outside.manager.save(), true);
  deliver(outside.bframePath, inside.bframePath);
  assert.equal((await inside.manager.reloadCommentsFromDisk()).changed, true);
  assert.equal(inside.commentManager.getMarker('x').text, '방 밖에서 고친 본문');
  assert.equal(inside.commentManager.getMarker('mine').resolved, true,
    '저장 전인 내 해결은 그대로다');
  assert.equal(inside.manager.hasUnsavedChanges(), true);

  // 받아들인 뒤 내 저장은 두 변경을 모두 담는다.
  assert.equal(await inside.manager.save(), true);
  assert.equal(diskMarker(inside.bframePath, 'x').resolved, true);
  assert.equal(diskMarker(inside.bframePath, 'mine').resolved, true);
  inside.manager.disconnect();
  outside.manager.disconnect();
});

test('방 안 사용자가 옛 파일 사본을 받아들여 화면의 해결을 되돌리지 않는다', async () => {
  const client = await openClient('방 안', [markerRecord('x')]);
  const beforeResolve = readDisk(client.bframePath);

  setResolved(client, 'x', true, '2026-11-18T06:00:00.000Z');
  assert.equal(await client.manager.save(), true);
  writeDisk(client.bframePath, beforeResolve);

  const result = await client.manager.reloadCommentsFromDisk();
  assert.equal(result.success, true);
  assert.equal(result.changed, false);
  assert.equal(client.commentManager.getMarker('x').resolved, true);

  // 다음 저장이 파일을 다시 바로잡는다.
  client.manager._markDirty();
  assert.equal(await client.manager.save(), true);
  assert.equal(diskMarker(client.bframePath, 'x').resolved, true);
  client.manager.disconnect();
});

test('옛 사본에 없는 답글은 지우지 않고, 옛 사본에만 있는 새 답글은 살린다', async () => {
  const client = await openClient('가', [markerRecord('x')]);
  const marker = client.commentManager.getMarker('x');
  marker.replies.push({
    id: 'mine', text: '내 답글', author: '가',
    createdAt: new Date('2026-11-18T05:00:00.000Z'), updatedAt: new Date('2026-11-18T05:00:00.000Z')
  });
  marker.updatedAt = new Date('2026-11-18T05:00:00.000Z');
  client.commentManager._emit('replyAdded', { marker, reply: marker.replies[0] });
  const beforeReply = readDisk(client.bframePath);
  assert.equal(await client.manager.save(), true);

  // 내 답글이 없던 때의 사본에 다른 사람의 새 답글이 실려 내려온다(그 사람은 내 답글을 못 봤다).
  // 답글을 달면 댓글의 수정 시각도 올라가므로, 이 사본은 내가 본 적 없는 상태다.
  const theirReply = {
    id: 'theirs', text: '다른 사람 답글', author: '나',
    createdAt: '2026-11-18T05:00:30.000Z', updatedAt: '2026-11-18T05:00:30.000Z'
  };
  beforeReply.comments.layers[0].markers[0].replies.push(theirReply);
  beforeReply.comments.layers[0].markers[0].updatedAt = theirReply.updatedAt;
  writeDisk(client.bframePath, beforeReply);

  const result = await client.manager.reloadCommentsFromDisk();
  assert.equal(result.success, true);
  assert.equal(result.changed, true);
  assert.deepEqual(
    client.commentManager.getMarker('x').replies.map(reply => reply.id).sort(),
    ['mine', 'theirs']
  );

  // 다음 저장이 두 답글을 모두 파일에 올린다.
  client.manager._markDirty();
  assert.equal(await client.manager.save(), true);
  assert.deepEqual(
    diskMarker(client.bframePath, 'x').replies.map(reply => reply.id).sort(),
    ['mine', 'theirs']
  );
  client.manager.disconnect();
});

test('저장 직전 병합은 답글이 생기기 전의 사본을 답글 삭제로 보지 않는다', async () => {
  const client = await openClient('가', [markerRecord('x')]);
  const beforeReply = readDisk(client.bframePath);
  const marker = client.commentManager.getMarker('x');
  marker.replies.push({
    id: 'mine', text: '내 답글', author: '가',
    createdAt: new Date('2026-11-18T05:00:00.000Z'), updatedAt: new Date('2026-11-18T05:00:00.000Z')
  });
  marker.updatedAt = new Date('2026-11-18T05:00:00.000Z');
  client.commentManager._emit('replyAdded', { marker, reply: marker.replies[0] });
  assert.equal(await client.manager.save(), true);

  // 답글이 없던 때의 사본이 그대로 내려온다.
  writeDisk(client.bframePath, beforeReply);
  client.manager._markDirty();
  assert.equal(await client.manager.save(), true);
  assert.deepEqual(
    diskMarker(client.bframePath, 'x').replies.map(reply => reply.id),
    ['mine']
  );
  client.manager.disconnect();
});

test('다른 사람이 지운 답글은 저장 직전 병합에서 지워진 채로 남는다', async () => {
  const reply = {
    id: 'gone', text: '지워질 답글', author: '나',
    createdAt: '2026-11-18T05:00:00.000Z', updatedAt: '2026-11-18T05:00:00.000Z'
  };
  const client = await openClient('가', [
    markerRecord('x', { replies: [reply], updatedAt: reply.updatedAt })
  ]);

  // 다른 사람이 나중에 답글을 지웠다(지우면 댓글의 수정 시각이 올라간다).
  const remote = readDisk(client.bframePath);
  remote.comments.layers[0].markers[0].replies = [];
  remote.comments.layers[0].markers[0].updatedAt = '2026-11-18T05:05:00.000Z';
  writeDisk(client.bframePath, remote);

  client.manager._markDirty();
  assert.equal(await client.manager.save(), true);
  assert.deepEqual(diskMarker(client.bframePath, 'x').replies, []);
  client.manager.disconnect();
});

test('내 답글을 못 본 사람이 같은 댓글을 해결해도 답글은 남고 해결은 받아들인다', async () => {
  const client = await openClient('가', [markerRecord('x')]);
  const beforeReply = readDisk(client.bframePath);
  const marker = client.commentManager.getMarker('x');
  marker.replies.push({
    id: 'mine', text: '내 답글', author: '가',
    createdAt: new Date('2026-11-18T05:00:00.000Z'), updatedAt: new Date('2026-11-18T05:00:00.000Z')
  });
  marker.updatedAt = new Date('2026-11-18T05:00:00.000Z');
  client.commentManager._emit('replyAdded', { marker, reply: marker.replies[0] });
  assert.equal(await client.manager.save(), true);

  // 방 밖 사용자가 내 답글이 없던 화면에서 해결을 눌렀다.
  Object.assign(beforeReply.comments.layers[0].markers[0], {
    resolved: true, resolvedBy: '나', resolvedAt: '2026-11-18T05:00:20.000Z', updatedAt: '2026-11-18T05:00:20.000Z'
  });
  writeDisk(client.bframePath, beforeReply);

  const result = await client.manager.reloadCommentsFromDisk();
  assert.equal(result.changed, true);
  assert.equal(client.commentManager.getMarker('x').resolved, true);
  assert.deepEqual(client.commentManager.getMarker('x').replies.map(reply => reply.id), ['mine']);

  client.manager._markDirty();
  assert.equal(await client.manager.save(), true);
  assert.equal(diskMarker(client.bframePath, 'x').resolved, true);
  assert.deepEqual(diskMarker(client.bframePath, 'x').replies.map(reply => reply.id), ['mine']);
  client.manager.disconnect();
});

test('자기 답글을 지우고 다시 쓴 사람의 저장분에서는 옛 답글이 지워진다', async () => {
  const first = {
    id: 'first', text: '먼저 있던 답글', author: '가',
    createdAt: '2026-11-18T05:00:00.000Z', updatedAt: '2026-11-18T05:00:00.000Z'
  };
  const typo = {
    id: 'typo', text: '오타가 난 답글', author: '나',
    createdAt: '2026-11-18T05:01:00.000Z', updatedAt: '2026-11-18T05:01:00.000Z'
  };
  const client = await openClient('가', [
    markerRecord('x', { replies: [first, typo], updatedAt: typo.updatedAt })
  ]);

  // 나는 자기 답글을 지우고 새로 썼다. 이 변경은 파일로만 도착했다.
  const remote = readDisk(client.bframePath);
  remote.comments.layers[0].markers[0].replies = [first, {
    id: 'fixed', text: '고쳐 쓴 답글', author: '나',
    createdAt: '2026-11-18T05:02:00.000Z', updatedAt: '2026-11-18T05:02:00.000Z'
  }];
  remote.comments.layers[0].markers[0].updatedAt = '2026-11-18T05:02:00.000Z';
  writeDisk(client.bframePath, remote);

  const result = await client.manager.reloadCommentsFromDisk();
  assert.equal(result.changed, true);
  assert.deepEqual(
    client.commentManager.getMarker('x').replies.map(reply => reply.id),
    ['first', 'fixed']
  );

  // 지워진 답글이 든 옛 사본이 다시 내려와도 되살아나지 않는다.
  const stale = readDisk(client.bframePath);
  stale.comments.layers[0].markers[0].replies = [first, typo];
  stale.comments.layers[0].markers[0].updatedAt = typo.updatedAt;
  writeDisk(client.bframePath, stale);
  await client.manager.reloadCommentsFromDisk();
  assert.deepEqual(
    client.commentManager.getMarker('x').replies.map(reply => reply.id),
    ['first', 'fixed']
  );
  client.manager.disconnect();
});

test('지운 댓글을 되돌리면(Ctrl+Z) 다른 PC 에도 되살아난다', async () => {
  const first = await openClient('가', [markerRecord('x')]);
  const second = await openClient('나', [markerRecord('x')]);
  const beforeDelete = first.commentManager.getMarker('x').toJSON();

  first.commentManager.deleteMarker('x');
  assert.equal(await first.manager.save(), true);
  deliver(first.bframePath, second.bframePath);
  assert.equal((await second.manager.reloadCommentsFromDisk()).changed, true);
  assert.equal(second.commentManager.getMarker('x').deleted, true);

  // 가가 삭제를 되돌린다. 되돌린 댓글은 예전 상태 그대로가 아니라 새 수정이어야
  // 다른 PC 가 "이미 지나온 옛 사본" 으로 오인하지 않는다.
  await wait(5);
  first.commentManager.restoreMarker(beforeDelete);
  assert.equal(await first.manager.save(), true);
  assert.equal(diskMarker(first.bframePath, 'x').deleted, false);
  deliver(first.bframePath, second.bframePath);

  assert.equal((await second.manager.reloadCommentsFromDisk()).changed, true);
  assert.equal(second.commentManager.getMarker('x').deleted, false);

  // 나의 저장도 되살린 댓글을 지우지 않는다.
  second.manager._markDirty();
  assert.equal(await second.manager.save(), true);
  assert.equal(diskMarker(second.bframePath, 'x').deleted, false);
  first.manager.disconnect();
  second.manager.disconnect();
});

test('답글을 지키며 받아들인 뒤에 온 본문 수정은 충돌 사본 없이 받아들인다', async () => {
  const first = await openClient('가', [markerRecord('x')]);
  const second = await openClient('나', [markerRecord('x')]);

  const marker = first.commentManager.getMarker('x');
  marker.replies.push({
    id: 'mine', text: '내 답글', author: '가',
    createdAt: new Date('2026-11-18T05:00:00.000Z'), updatedAt: new Date('2026-11-18T05:00:00.000Z')
  });
  marker.updatedAt = new Date('2026-11-18T05:00:00.000Z');
  first.commentManager._emit('replyAdded', { marker, reply: marker.replies[0] });
  assert.equal(await first.manager.save(), true);

  // 나는 가의 답글을 못 본 채 해결하고, 이어서 본문을 고친다.
  setResolved(second, 'x', true, '2026-11-18T05:00:20.000Z');
  assert.equal(await second.manager.save(), true);
  deliver(second.bframePath, first.bframePath);
  assert.equal((await first.manager.reloadCommentsFromDisk()).changed, true);

  const edited = second.commentManager.getMarker('x');
  edited.text = '나가 고친 본문';
  edited.updatedAt = new Date('2026-11-18T05:01:00.000Z');
  second.commentManager._emit('markerUpdated', { marker: edited });
  assert.equal(await second.manager.save(), true);
  deliver(second.bframePath, first.bframePath);
  assert.equal((await first.manager.reloadCommentsFromDisk()).changed, true);

  const layer = first.commentManager.toJSON().layers[0];
  assert.deepEqual(layer.markers.map(item => item.id), ['x']);
  assert.equal(layer.markers[0].text, '나가 고친 본문');
  assert.equal(layer.markers[0].resolved, true);
  assert.deepEqual(layer.markers[0].replies.map(reply => reply.id), ['mine']);
  first.manager.disconnect();
  second.manager.disconnect();
});

test('충돌 사본을 만든 뒤 다시 저장해도 사본이 늘어나지 않는다', async () => {
  const first = await openClient('가', [markerRecord('x')]);
  const second = await openClient('나', [markerRecord('x')]);

  setResolved(second, 'x', true, '2026-11-18T05:00:20.000Z');
  assert.equal(await second.manager.save(), true);

  // 가는 저장 전인 본문 수정을 들고 있다(본문 수정과 해결이 겹치면 두 사본으로 보존한다).
  const edited = first.commentManager.getMarker('x');
  edited.text = '가가 고친 본문';
  edited.updatedAt = new Date('2026-11-18T05:00:30.000Z');
  first.commentManager._emit('markerUpdated', { marker: edited });
  deliver(second.bframePath, first.bframePath);
  await first.manager.reloadCommentsFromDisk();
  assert.deepEqual(
    first.commentManager.toJSON().layers[0].markers.map(item => item.id),
    ['x', 'x__remote-conflict']
  );

  assert.equal(await first.manager.save(), true);
  first.manager._markDirty();
  assert.equal(await first.manager.save(), true);
  assert.deepEqual(
    diskMarkers(first.bframePath).map(item => item.id),
    ['x', 'x__remote-conflict']
  );
  first.manager.disconnect();
  second.manager.disconnect();
});

test('파일이 옛 사본으로 돌아간 것을 알아보면 스스로 다시 저장해 파일을 바로잡는다', async () => {
  const client = await openClient('가', [markerRecord('x')], { autoSave: true });
  const beforeResolve = readDisk(client.bframePath);
  setResolved(client, 'x', true, '2026-11-18T06:00:00.000Z');
  assert.equal(await client.manager.save(), true);
  assert.equal(client.manager.hasUnsavedChanges(), false);

  // 파일로만 동기화하는 사람은 이 파일만 본다. 옛 사본인 채로 두면 그 사람에게 해결이 보이지 않는다.
  writeDisk(client.bframePath, beforeResolve);
  const result = await client.manager.reloadCommentsFromDisk();
  assert.equal(result.changed, false);
  assert.equal(client.manager.hasUnsavedChanges(), true);

  for (let attempt = 0; attempt < 60 && diskMarker(client.bframePath, 'x').resolved !== true; attempt += 1) {
    await wait(10);
  }
  assert.equal(diskMarker(client.bframePath, 'x').resolved, true);
  client.manager.disconnect();
});

test('파일에서 받아들여도 고정해 둔 말풍선은 풀리지 않는다', async () => {
  const inside = await openClient('방 안', [markerRecord('x'), markerRecord('pinned')]);
  const outside = await openClient('방 밖', [markerRecord('x'), markerRecord('pinned')]);
  inside.commentManager.getMarker('pinned').pinned = true;

  setResolved(outside, 'x', true, '2026-11-18T06:31:00.000Z');
  assert.equal(await outside.manager.save(), true);
  deliver(outside.bframePath, inside.bframePath);
  assert.equal((await inside.manager.reloadCommentsFromDisk()).changed, true);

  assert.equal(inside.commentManager.getMarker('pinned').pinned, true);
  assert.equal(inside.commentManager.getMarker('x').pinned, false);
  inside.manager.disconnect();
  outside.manager.disconnect();
});

test('저장이 버전 충돌로 거절되면 실패로 끝내지 않고 다시 저장한다', async () => {
  const client = await openClient('가', [markerRecord('x')], {
    autoSave: true,
    saveRetryDelays: [10, 10, 10]
  });
  const statuses = [];
  const errors = [];
  client.manager.addEventListener('saveStateChanged', event => statuses.push(event.detail.status));
  client.manager.addEventListener('saveError', event => errors.push(event.detail));

  // 읽기와 쓰기 사이에 다른 PC 의 저장분이 내려와 버전이 달라진 상황.
  saveInterceptors.push(async () => ({
    success: false, conflict: true, reason: 'stale-version-token'
  }));
  setResolved(client, 'x', true, '2026-11-18T06:31:00.000Z');
  assert.equal(await client.manager.save(), false);
  assert.equal(statuses.includes('save-failed'), false,
    '충돌은 다시 읽어 합치면 풀리는 일시 상황이다');
  assert.ok(statuses.includes('retrying'));
  assert.deepEqual(errors, []);

  for (let attempt = 0; attempt < 50 && statuses.at(-1) !== 'saved'; attempt += 1) {
    await wait(10);
  }
  assert.equal(statuses.at(-1), 'saved');
  assert.equal(diskMarker(client.bframePath, 'x').resolved, true);
  assert.equal(client.manager.hasUnsavedChanges(), false);
  client.manager.disconnect();
});

test('해결 변경은 보낸 쪽과 받은 쪽이 같은 수정 시각을 갖도록 전송한다', async () => {
  const { CommentManager, CommentMarker } = await import('../../renderer/scripts/modules/comment-manager.js');
  const { CommentSync } = await import('../../renderer/scripts/modules/comment-sync.js');
  const manager = new CommentManager({ author: '가' });
  const marker = new CommentMarker(markerRecord('x'));
  manager.getActiveLayer().addMarker(marker);
  const broadcasts = [];
  const liveblocksManager = new EventTarget();
  liveblocksManager.broadcastEvent = event => broadcasts.push(event);
  const sync = new CommentSync({ liveblocksManager, commentManager: manager });
  await sync.start();

  marker.resolved = true;
  marker.resolvedAt = new Date('2026-11-18T06:31:00.000Z');
  marker.resolvedBy = '가';
  marker.updatedAt = new Date('2026-11-18T06:31:00.000Z');
  manager._emit('markerUpdated', { marker });

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].fields.updatedAt, '2026-11-18T06:31:00.000Z');
  sync.stop();
});

function createFakeLiveblocksClient(behavior) {
  const state = { left: 0, entered: 0, listeners: new Map() };
  const room = {
    subscribe(type, listener) {
      if (!state.listeners.has(type)) state.listeners.set(type, new Set());
      state.listeners.get(type).add(listener);
      return () => state.listeners.get(type).delete(listener);
    },
    getStorage: () => behavior.storage(state),
    getOthers: () => [],
    getSelf: () => null,
    updatePresence() {},
    broadcastEvent() {}
  };
  state.emit = (type, payload) => {
    for (const listener of state.listeners.get(type) || []) listener(payload);
  };
  return {
    state,
    createClient: () => ({
      enterRoom() {
        state.entered += 1;
        behavior.onEnter?.(state);
        return { room, leave: () => { state.left += 1; } };
      }
    })
  };
}

function rejectAfter(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

test('실시간 방이 가득 차면 접속 대기를 바로 끝내고 이유를 알려 준다', async () => {
  const { LiveblocksManager } = await import('../../renderer/scripts/modules/liveblocks-manager.js');
  const fake = createFakeLiveblocksClient({
    storage: () => new Promise(() => {}),
    onEnter: state => setTimeout(() => state.emit('error', {
      message: 'Max number of concurrent connections per room exceeded',
      context: { type: 'ROOM_CONNECTION_ERROR', code: 4005 }
    }), 5)
  });
  const manager = new LiveblocksManager({ createClient: fake.createClient, joinTimeoutMs: 5000 });
  const statuses = [];
  manager.addEventListener('connectionStatusChanged', event => statuses.push(event.detail));

  const failure = await rejectAfter(
    manager.start('C:/pc/review.bframe', '가', '#fff', 'bframe_room').then(
      () => null,
      error => error
    ),
    1000,
    '접속 대기가 끝나지 않는다'
  );
  assert.ok(failure, '정원 초과면 접속 실패로 끝나야 한다');
  assert.equal(failure.joinFailureReason, 'room-full');
  assert.equal(manager.isConnected, false);
  assert.equal(fake.state.left, 1, '거절된 방은 떠나야 한다');
  assert.equal(statuses.at(-1).status, 'disconnected');
  assert.equal(statuses.at(-1).reason, 'room-full');
});

test('응답이 없는 실시간 방 접속은 정해진 시간 뒤에 실패로 끝난다', async () => {
  const { LiveblocksManager } = await import('../../renderer/scripts/modules/liveblocks-manager.js');
  const fake = createFakeLiveblocksClient({ storage: () => new Promise(() => {}) });
  const manager = new LiveblocksManager({ createClient: fake.createClient, joinTimeoutMs: 30 });

  const failure = await rejectAfter(
    manager.start('C:/pc/review.bframe', '가', '#fff', 'bframe_room').then(
      () => null,
      error => error
    ),
    1000,
    '접속 대기가 끝나지 않는다'
  );
  assert.ok(failure);
  assert.equal(failure.joinFailureReason, 'timeout');
  assert.equal(manager.isConnected, false);
  assert.equal(fake.state.left, 1);
});

test('버려진 접속 시도가 뒤늦게 끝나도 그 뒤에 들어간 방을 끊지 않는다', async () => {
  const { LiveblocksManager } = await import('../../renderer/scripts/modules/liveblocks-manager.js');
  // 첫 방은 응답이 없고(영상을 바꾸면 떠난 방의 Storage 대기는 끝나지 않는다), 둘째 방은 바로 들어간다.
  const rooms = [];
  const createClient = () => ({
    enterRoom(roomId) {
      const state = { roomId, left: 0, listeners: new Map() };
      rooms.push(state);
      const pending = rooms.length === 1;
      return {
        room: {
          subscribe(type, listener) {
            if (!state.listeners.has(type)) state.listeners.set(type, new Set());
            state.listeners.get(type).add(listener);
            return () => state.listeners.get(type).delete(listener);
          },
          getStorage: () => (pending ? new Promise(() => {}) : Promise.resolve({ root: {} })),
          getOthers: () => [], getSelf: () => null, updatePresence() {}, broadcastEvent() {}
        },
        leave: () => { state.left += 1; }
      };
    }
  });
  const manager = new LiveblocksManager({ createClient, joinTimeoutMs: 60 });
  const statuses = [];
  manager.addEventListener('connectionStatusChanged', event => statuses.push(event.detail));

  const abandoned = manager.start('C:/pc/a.bframe', '가', '#fff', 'room-a').then(() => null, error => error);
  await wait(5);
  // 영상을 바꾼다: 앞선 방을 떠나고 새 방에 들어간다.
  await manager.stop();
  const failure = await rejectAfter(abandoned, 40, '버려진 접속 시도는 떠나는 즉시 끝나야 한다');
  assert.equal(failure.joinFailureReason, 'superseded');

  await manager.start('C:/pc/b.bframe', '가', '#fff', 'room-b');
  assert.equal(manager.isConnected, true);
  await wait(120); // 첫 시도의 제한 시간이 지나도록 기다린다
  assert.equal(manager.isConnected, true, '새 방의 연결이 유지돼야 한다');
  assert.equal(manager.roomId, 'room-b');
  assert.equal(rooms[1].left, 0, '새 방을 떠나면 안 된다');
  assert.ok((rooms[1].listeners.get('event')?.size || 0) > 0, '새 방의 구독이 살아 있어야 한다');
  assert.equal(statuses.at(-1).status, 'connected');
  await manager.stop();
});

test('실시간 방 접속이 되면 지금처럼 연결 상태가 된다', async () => {
  const { LiveblocksManager } = await import('../../renderer/scripts/modules/liveblocks-manager.js');
  const fake = createFakeLiveblocksClient({ storage: async () => ({ root: {} }) });
  const manager = new LiveblocksManager({ createClient: fake.createClient, joinTimeoutMs: 1000 });
  const started = [];
  manager.addEventListener('collaborationStarted', event => started.push(event.detail));

  const result = await manager.start('C:/pc/review.bframe', '가', '#fff', 'bframe_room');
  assert.deepEqual(result, { roomId: 'bframe_room', isNewRoom: false });
  assert.equal(manager.isConnected, true);
  assert.equal(started.length, 1);
  await manager.stop();
  assert.equal(fake.state.left, 1);
});
