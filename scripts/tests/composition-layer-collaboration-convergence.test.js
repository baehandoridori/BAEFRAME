// 여러 PC 가 같은 .bframe 을 저장할 때 합성 레이어가 수렴하는지 본다.
//
// 2026-11-18, 팀 전체가 함께 여는 검수 파일에서 합성 레이어 하나가 이름 끝에 "(로컬 충돌)" 이
// 붙은 사본 네 개로 남아 있었다(원본 id 는 사라짐, 네 사본은 위치만 서로 다름). 원인:
//   1. 내 저장을 아직 못 본 PC 의 저장분(옛 사본)이 늦게 내려오면, 병합이 "파일에 없다" 를
//      삭제로 읽는다. 손대지 않은 레이어는 지워지고, 고친 레이어는 "(로컬 충돌)" 사본이 된다.
//   2. 그 뒤로는 원본 id 가 파일에 다시 생기지 않으므로 레이어를 고칠 때마다 사본이 하나씩 는다.
//   3. 레이어의 순서 번호(order)가 레코드 안에 들어 있어, 다른 사람이 레이어를 끼워 넣은 것만으로
//      "양쪽이 고쳤다" 로 읽혀 "(원격 충돌)" 사본이 생긴다.
//   4. 영상 레이어는 파일을 다시 읽을 때마다(변환 확인이 끝나면) 문서가 바뀐 것으로 표시돼
//      저장을 유발한다. 파일 동기화로 일하는 PC 에서는 저장 → 다시 읽기 → 저장이 되풀이된다.
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
window.addEventListener = window.addEventListener || (() => {});
window.removeEventListener = window.removeEventListener || (() => {});

const REVIEW_ID = 'reviewdoc-66666666-6666-4666-8666-666666666666';
const SYNC_KEY = 'compositionLayerSyncV1';
const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// 경로마다 따로 있는 디스크 사본. 서로 다른 PC 의 구글 드라이브 로컬 사본을 흉내 낸다.
const disks = new Map();
let tokenSequence = 0;
let saveCount = 0;
// 다음 쓰기 한 번을 붙잡는다(쓰는 사이에 편집이 일어나는 경우, 쓰기가 실패하는 경우).
let writeGate = null;

// 다음 쓰기를 파일에 닿기 직전에 멈춰 둔다. reached 는 멈춘 때, resume() 은 이어서 쓰게 한다.
function holdNextWrite() {
  let resume;
  let markReached;
  const reached = new Promise((resolve) => { markReached = resolve; });
  const released = new Promise((resolve) => { resume = resolve; });
  writeGate = async () => {
    markReached();
    await released;
    return null;
  };
  return { reached, resume };
}

// 다음 쓰기 한 번을 실패시킨다(디스크 오류).
function failNextWrite() {
  writeGate = async () => ({ success: false, error: 'EIO: 쓰기 실패' });
}

function writeDisk(path, root) {
  tokenSequence += 1;
  disks.set(path, { root: structuredClone(root), token: `token-${tokenSequence}` });
}

function readDisk(path) {
  return structuredClone(disks.get(path).root);
}

function diskLayers(path) {
  return disks.get(path).root.compositionLayers;
}

function diskLayerIds(path) {
  return diskLayers(path).map(layer => layer.id);
}

function diskLayer(path, id) {
  return diskLayers(path).find(layer => layer.id === id);
}

function diskSync(path) {
  return disks.get(path).root[SYNC_KEY];
}

function installElectronApi() {
  window.electronAPI = {
    loadReview: async path => (disks.has(path) ? readDisk(path) : null),
    loadReviewSnapshot: async path => ({
      data: disks.has(path) ? readDisk(path) : null,
      versionToken: disks.get(path)?.token || '__ABSENT__'
    }),
    saveReview: async (path, data, options = {}) => {
      const gate = writeGate;
      writeGate = null;
      if (gate) {
        const intercepted = await gate();
        if (intercepted) return intercepted;
      }
      const current = disks.get(path);
      if (options.expectedVersionToken && current &&
          options.expectedVersionToken !== current.token) {
        return { success: false, conflict: true, reason: 'stale-version-token' };
      }
      saveCount += 1;
      writeDisk(path, data);
      return { success: true, versionToken: disks.get(path).token };
    }
  };
}

// 앱이 저장하는 모양 그대로의 합성 레이어 레코드(serializeCompositionLayer 의 출력).
function layerRecord(id, overrides = {}) {
  return {
    id,
    name: `${id}.png`,
    type: 'image',
    filePath: `C:/shots/${id}.png`,
    enabled: true,
    order: 0,
    startTime: 1,
    endTime: 3,
    opacity: 1,
    x: 0.25,
    y: 0.25,
    width: 0.5,
    height: 0.5,
    aspectLocked: true,
    color: '#ffd000',
    selectedColor: '#ffe675',
    sourceDuration: 0,
    ...overrides
  };
}

function reviewRoot(layers, videoPath, extra = {}) {
  return {
    bframeVersion: '2.0',
    videoFile: videoPath.split('/').pop(),
    videoPath,
    fps: 24,
    createdAt: '2026-11-18T04:00:00.000Z',
    modifiedAt: '2026-11-18T04:00:00.000Z',
    reviewDocumentId: REVIEW_ID,
    comments: { layers: [] },
    drawings: { layers: [] },
    highlights: { highlights: [] },
    compositionLayers: layers.map((layer, order) => ({ ...layer, order })),
    ...extra
  };
}

let clientSequence = 0;

/**
 * PC 한 대. connected 는 실시간 방에 들어가 있는지 — 들어가 있으면 파일이 바뀔 때
 * 합성 레이어만 따로 받아들이고(reloadCompositionLayersFromDisk), 아니면 파일 전체를
 * 다시 읽어 합친다(reloadAndMerge). app.js 의 syncReviewFileFromDisk 와 같은 갈래다.
 */
async function openClient(name, options = {}) {
  const { CompositionLayerManager } = await import('../../renderer/scripts/modules/composition-layer-manager.js');
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  installElectronApi();
  clientSequence += 1;
  const videoPath = `C:/pc-${clientSequence}/review.mp4`;
  const bframePath = `C:/pc-${clientSequence}/review.bframe`;
  if (options.fromClient) {
    const root = readDisk(options.fromClient.bframePath);
    root.videoPath = videoPath;
    writeDisk(bframePath, root);
  } else if (options.layers) {
    writeDisk(bframePath, reviewRoot(options.layers, videoPath, options.rootExtra));
  }
  const layerManager = new CompositionLayerManager({ prepareMedia: options.prepareMedia });
  const manager = new ReviewDataManager({
    compositionLayerManager: layerManager,
    autoSave: false,
    ...options.managerOptions
  });
  manager.connect();
  await manager.setVideoFile(videoPath);
  return {
    name,
    layerManager,
    manager,
    videoPath,
    bframePath,
    connected: options.connected === true,
    deliveredVersion: 0
  };
}

function closeClient(client) {
  client.manager.disconnect();
}

// 앱을 껐다 켠다. 끄기 전에 저장하고, 메모리에만 있던 것(삭제 표시, 본 수정 횟수)은 사라진다.
async function reopenClient(client) {
  const { CompositionLayerManager } = await import('../../renderer/scripts/modules/composition-layer-manager.js');
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const saved = await flush(client);
  client.manager.disconnect();
  client.layerManager = new CompositionLayerManager();
  client.manager = new ReviewDataManager({
    compositionLayerManager: client.layerManager,
    autoSave: false
  });
  client.manager.connect();
  await client.manager.setVideoFile(client.videoPath);
  return saved;
}

function screenLayers(client) {
  return client.layerManager.toJSON();
}

function screenLayerIds(client) {
  return screenLayers(client).map(layer => layer.id);
}

function screenLayer(client, id) {
  return screenLayers(client).find(layer => layer.id === id);
}

// 다른 PC 의 저장분이 드라이브를 거쳐 이 PC 의 로컬 사본을 덮어쓴다.
function deliver(fromPath, toPath) {
  const root = readDisk(fromPath);
  const target = disks.get(toPath).root;
  root.videoPath = target.videoPath;
  root.videoFile = target.videoFile;
  writeDisk(toPath, root);
}

// 파일이 바뀌었을 때 앱이 하는 일(파일 감시 → 동기화).
async function fileChanged(client) {
  if (client.connected) {
    return client.manager.reloadCompositionLayersFromDisk();
  }
  return client.manager.reloadAndMerge({ merge: true });
}

// 자동 저장이 하는 일: 저장할 것이 있으면 저장한다.
async function flush(client) {
  if (!client.manager.hasUnsavedChanges()) return false;
  assert.equal(await client.manager.save(), true, `${client.name} 저장`);
  return true;
}

// 합성 레이어와 무관한 변경(댓글·해결 등)으로 저장이 걸린 것을 흉내 낸다.
function touchUnrelated(client) {
  client.manager._markDirty();
}

function conflictNames(layers) {
  return layers.filter(layer => /충돌\)/.test(String(layer.name)) ||
    /-conflict/.test(String(layer.id)));
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// 조건이 참이 될 때까지 기다린다(타이머로 도는 일). 끝내 안 되면 false.
async function waitUntil(condition, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await wait(5);
  }
  return condition();
}

/**
 * 구글 드라이브: 마지막 업로드가 남고, 각 PC 는 그것을 조금 늦게 내려받는다.
 * 회전마다 모든 PC 가 (새 파일이 있으면) 받아들이고, 저장할 것이 있으면 저장해 올린다.
 * 회전별 저장 횟수를 돌려준다 — 저장 반복이 없으면 뒤쪽 회전은 0 이어야 한다.
 */
function createDrive() {
  return {
    version: 0,
    sourcePath: null,
    upload(client) {
      this.version += 1;
      this.sourcePath = client.bframePath;
      this.snapshot = readDisk(client.bframePath);
      client.deliveredVersion = this.version;
    },
    // 뒤늦게 올라온 옛 사본(그 PC 가 예전에 계산해 둔 저장분).
    uploadSnapshot(snapshot) {
      this.version += 1;
      this.snapshot = structuredClone(snapshot);
    },
    deliverTo(client) {
      const root = structuredClone(this.snapshot);
      const target = disks.get(client.bframePath).root;
      root.videoPath = target.videoPath;
      root.videoFile = target.videoFile;
      writeDisk(client.bframePath, root);
      client.deliveredVersion = this.version;
    }
  };
}

async function runRounds(clients, drive, rounds = 8) {
  const savesPerRound = [];
  for (let round = 0; round < rounds; round += 1) {
    const before = saveCount;
    // 1) 드라이브가 마지막 업로드를 모든 PC 로 내려보낸다.
    for (const client of clients) {
      if (drive.version > 0 && client.deliveredVersion !== drive.version) {
        drive.deliverTo(client);
        await fileChanged(client);
      }
    }
    // 2) 저장할 것이 있는 PC 가 각자 저장해 올린다. 같은 회전의 다른 PC 저장분은 아직
    //    못 본 채 저장하므로, 나중에 올린 쪽이 앞선 저장분을 덮는다(마지막 업로드가 남는다).
    for (const client of clients) {
      if (await flush(client)) {
        drive.upload(client);
        // 자기 저장도 파일 감시에 잡힌다.
        await fileChanged(client);
      }
    }
    savesPerRound.push(saveCount - before);
  }
  return savesPerRound;
}

function assertQuiet(savesPerRound, message) {
  assert.deepEqual(savesPerRound.slice(-3), [0, 0, 0],
    `${message}: 회전별 저장 횟수 ${JSON.stringify(savesPerRound)}`);
}

function assertSameScreens(clients, message) {
  const [first, ...rest] = clients;
  for (const client of rest) {
    assert.deepEqual(screenLayers(client), screenLayers(first),
      `${message}: ${client.name} 의 화면이 ${first.name} 과 다르다`);
  }
}

// ── 원인 확정 ────────────────────────────────────────────────────────────────

test('앱이 저장한 모양의 레이어는 열었다 저장해도 달라지지 않는다(저장 모양 차이는 원인이 아니다)', async () => {
  const client = await openClient('가', {
    layers: [
      layerRecord('a'),
      layerRecord('clip', { filePath: '', sourceDataUrl: IMAGE_DATA_URL, x: -0.498239, y: 0.287676 }),
      layerRecord('movie', { type: 'video', filePath: 'C:/shots/movie.webm', sourceDuration: 4.5 })
    ]
  });
  const loaded = readDisk(client.bframePath).compositionLayers;
  assert.deepEqual(screenLayers(client), loaded);
  // 기존 병합은 JSON 문자열로 비교했다. 칸의 순서까지 같아야 "그대로" 로 읽힌다.
  assert.equal(JSON.stringify(screenLayers(client)), JSON.stringify(loaded));

  touchUnrelated(client);
  assert.equal(await client.manager.save(), true);
  assert.deepEqual(diskLayers(client.bframePath), loaded);
  closeClient(client);
});

test('옛 사본이 파일을 덮은 뒤 레이어를 고쳐도 "(로컬 충돌)" 사본이 생기지 않는다', async () => {
  const first = await openClient('가', { layers: [], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });

  // 가: 클립보드 그림을 합성 레이어로 붙이고 저장한다.
  const layer = await first.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '캡처' });
  assert.equal(await first.manager.save(), true);
  assert.deepEqual(diskLayerIds(first.bframePath), [layer.id]);

  // 나: 가의 저장분을 아직 못 받은 채 다른 변경을 저장한다. 드라이브는 마지막 업로드를
  // 남기므로 그 저장분(레이어가 없는 옛 사본)이 가의 PC 로 내려온다.
  touchUnrelated(second);
  assert.equal(await second.manager.save(), true);
  deliver(second.bframePath, first.bframePath);
  assert.deepEqual(diskLayerIds(first.bframePath), []);

  // 가: 레이어를 옮긴다.
  first.layerManager.updateLayer(layer.id, { x: 0.1, y: 0.6 });
  assert.equal(await first.manager.save(), true);

  assert.deepEqual(diskLayerIds(first.bframePath), [layer.id],
    '파일에 없다는 것만으로 내 레이어를 사본으로 바꾸면 안 된다');
  assert.equal(diskLayer(first.bframePath, layer.id).name, '캡처');
  assert.equal(diskLayer(first.bframePath, layer.id).x, 0.1);
  closeClient(first);
  closeClient(second);
});

test('레이어를 고칠 때마다 사본이 하나씩 늘지 않는다(실제 파일에서 본 네 사본)', async () => {
  const first = await openClient('가', { layers: [], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });
  const layer = await first.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '캡처' });
  assert.equal(await first.manager.save(), true);
  touchUnrelated(second);
  assert.equal(await second.manager.save(), true);
  deliver(second.bframePath, first.bframePath);

  const moves = [
    { x: 0.013496, y: 0.600985, width: 0.399015, height: 0.399015 },
    { x: 0.703002, y: 0, width: 0.287399, height: 0.287399 },
    { x: -0.498239, y: 0.287676, width: 0.5, height: 0.5 },
    { x: -0.498239, y: 0.408948, width: 0.378728, height: 0.378728 }
  ];
  for (const rect of moves) {
    first.layerManager.updateLayer(layer.id, rect);
    assert.equal(await first.manager.save(), true);
  }

  assert.deepEqual(diskLayerIds(first.bframePath), [layer.id]);
  assert.deepEqual(conflictNames(diskLayers(first.bframePath)), []);
  assert.equal(diskLayer(first.bframePath, layer.id).y, 0.408948);
  closeClient(first);
  closeClient(second);
});

test('옛 사본에 없는 레이어를 삭제로 읽어 화면에서 지우지 않고, 파일을 바로잡는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')] });
  const beforeAdd = readDisk(first.bframePath);

  const layer = await first.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '캡처' });
  assert.equal(await first.manager.save(), true);

  // 레이어가 생기기 전에 계산된 사본이 내려온다(가는 그 뒤로 레이어를 고치지 않았다).
  writeDisk(first.bframePath, beforeAdd);
  assert.equal((await fileChanged(first)).success, true);

  assert.deepEqual(screenLayerIds(first), ['a', layer.id],
    '삭제 표시가 없으면 그 레이어가 생기기 전의 사본이다');
  assert.equal(first.manager.hasUnsavedChanges(), true,
    '파일이 옛 사본으로 돌아가 있으면 다시 저장해 바로잡는다');
  assert.equal(await flush(first), true);
  assert.deepEqual(diskLayerIds(first.bframePath), ['a', layer.id]);
  closeClient(first);
});

test('옛 사본이 레이어를 이전 위치로 되돌리지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')] });
  const beforeMove = readDisk(first.bframePath);

  first.layerManager.updateLayer('a', { x: 0.6, y: 0.1 });
  assert.equal(await first.manager.save(), true);

  writeDisk(first.bframePath, beforeMove);
  assert.equal((await fileChanged(first)).success, true);

  assert.equal(screenLayer(first, 'a').x, 0.6, '이미 지나온 상태로 되돌아가지 않는다');
  assert.equal(await flush(first), true, '파일을 바로잡는다');
  assert.equal(diskLayer(first.bframePath, 'a').x, 0.6);
  assert.deepEqual(conflictNames(diskLayers(first.bframePath)), []);
  closeClient(first);
});

test('옛 사본이 내려온 뒤 같은 레이어를 또 고쳐도 "(원격 충돌)" 사본이 생기지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')], connected: true });
  const beforeMove = readDisk(first.bframePath);

  first.layerManager.updateLayer('a', { x: 0.6 });
  assert.equal(await first.manager.save(), true);
  writeDisk(first.bframePath, beforeMove);

  first.layerManager.updateLayer('a', { y: 0.7 });
  assert.equal(await first.manager.save(), true);

  assert.deepEqual(diskLayerIds(first.bframePath), ['a']);
  assert.equal(diskLayer(first.bframePath, 'a').x, 0.6);
  assert.equal(diskLayer(first.bframePath, 'a').y, 0.7);
  closeClient(first);
});

test('다른 사람이 레이어를 끼워 넣어 순서 번호가 바뀐 것만으로 "(원격 충돌)" 사본이 생기지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });

  // 나: 레이어 q 를 추가해 먼저 저장한다(가의 p 는 아직 못 봤다).
  second.layerManager.fromJSON([...screenLayers(second), layerRecord('q', { order: 1 })]);
  touchUnrelated(second);
  assert.equal(await second.manager.save(), true);

  // 가: 레이어 p 를 추가한다. 저장 직전에 나의 저장분이 내려와 있어 p 는 q 뒤(order 2)로 합쳐진다.
  first.layerManager.fromJSON([...screenLayers(first), layerRecord('p', { order: 1 })]);
  touchUnrelated(first);
  deliver(second.bframePath, first.bframePath);
  assert.equal(await first.manager.save(), true);
  assert.deepEqual(diskLayerIds(first.bframePath), ['a', 'q', 'p']);
  assert.equal(diskLayer(first.bframePath, 'p').order, 2);

  // 가의 화면에서 p 는 여전히 order 1 이다. p 의 불투명도만 바꾼다.
  first.layerManager.updateLayer('p', { opacity: 0.4 });
  assert.equal(await first.manager.save(), true);

  assert.deepEqual(diskLayerIds(first.bframePath).sort(), ['a', 'p', 'q']);
  assert.equal(diskLayer(first.bframePath, 'p').opacity, 0.4);
  closeClient(first);
  closeClient(second);
});

// ── 삭제 ─────────────────────────────────────────────────────────────────────

test('지운 레이어는 다른 PC 에서도 지워지고, 옛 사본이 되살리지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')] });
  const second = await openClient('나', { fromClient: first });
  const beforeDelete = readDisk(first.bframePath);

  assert.equal(first.layerManager.deleteLayer('b'), true);
  assert.equal(await first.manager.save(), true);
  assert.deepEqual(diskLayerIds(first.bframePath), ['a']);

  deliver(first.bframePath, second.bframePath);
  assert.equal((await fileChanged(second)).success, true);
  assert.deepEqual(screenLayerIds(second), ['a'], '삭제 표시가 있으면 삭제다');

  // 삭제 전에 계산된 사본이 두 PC 로 내려온다.
  for (const client of [first, second]) {
    writeDisk(client.bframePath, { ...beforeDelete, videoPath: client.videoPath });
    assert.equal((await fileChanged(client)).success, true);
    assert.deepEqual(screenLayerIds(client), ['a'], `${client.name}: 옛 사본이 지운 레이어를 되살리면 안 된다`);
    assert.equal(await flush(client), true, `${client.name}: 파일을 바로잡는다`);
    assert.deepEqual(diskLayerIds(client.bframePath), ['a']);
  }
  closeClient(first);
  closeClient(second);
});

test('삭제를 되돌리면(Ctrl+Z) 다른 PC 에서도 레이어가 돌아온다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')] });
  const second = await openClient('나', { fromClient: first });

  first.layerManager.deleteLayer('b');
  assert.equal(await first.manager.save(), true);
  deliver(first.bframePath, second.bframePath);
  await fileChanged(second);
  assert.deepEqual(screenLayerIds(second), ['a']);

  assert.equal(first.layerManager.undo(), true);
  assert.equal(await first.manager.save(), true);
  assert.deepEqual(diskLayerIds(first.bframePath), ['a', 'b']);

  deliver(first.bframePath, second.bframePath);
  await fileChanged(second);
  assert.deepEqual(screenLayerIds(second), ['a', 'b'],
    '되살린 레이어는 삭제 표시보다 나중 상태다');
  assert.equal(second.manager.hasUnsavedChanges(), false);
  closeClient(first);
  closeClient(second);
});

test('한쪽이 지우고 다른 쪽이 같은 레이어를 고치면 사본 없이 고친 레이어가 남는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')] });
  const second = await openClient('나', { fromClient: first });
  const drive = createDrive();

  first.layerManager.deleteLayer('b');
  second.layerManager.updateLayer('b', { opacity: 0.3 });

  const saves = await runRounds([first, second], drive);
  assertQuiet(saves, '삭제 대 수정');
  assertSameScreens([first, second], '삭제 대 수정');
  assert.deepEqual(screenLayerIds(first), ['a', 'b']);
  assert.equal(screenLayer(first, 'b').opacity, 0.3);
  assert.deepEqual(conflictNames(screenLayers(first)), []);
  closeClient(first);
  closeClient(second);
});

// ── 저장 반복이 없는지 ───────────────────────────────────────────────────────

test('되돌리기로 예전과 똑같아진 레이어도 전해지고, 두 PC 가 번갈아 덮어쓰지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')] });
  const second = await openClient('나', { fromClient: first });
  const drive = createDrive();

  first.layerManager.updateLayer('a', { x: 0.6 });
  await runRounds([first, second], drive, 4);
  assert.equal(screenLayer(second, 'a').x, 0.6);

  // 가: Ctrl+Z. 레이어가 처음 상태와 바이트까지 같아진다.
  assert.equal(first.layerManager.undo(), true);
  assert.equal(screenLayer(first, 'a').x, 0.25);

  const saves = await runRounds([first, second], drive);
  assertQuiet(saves, '되돌리기');
  assert.equal(screenLayer(second, 'a').x, 0.25,
    '예전과 같은 내용이라도 새 수정이다. 옛 사본으로 보고 버리면 안 된다');
  assertSameScreens([first, second], '되돌리기');
  closeClient(first);
  closeClient(second);
});

test('두 사람이 같은 레이어를 각자 옮기면 사본 없이 한쪽으로 모인다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')] });
  const second = await openClient('나', { fromClient: first });
  const third = await openClient('다', { fromClient: first, connected: true });
  const drive = createDrive();

  first.layerManager.updateLayer('a', { x: 0.1 });
  second.layerManager.updateLayer('a', { x: 0.9 });

  const saves = await runRounds([first, second, third], drive);
  assertQuiet(saves, '동시 이동');
  assertSameScreens([first, second, third], '동시 이동');
  assert.deepEqual(screenLayerIds(first), ['a']);
  assert.ok([0.1, 0.9].includes(screenLayer(first, 'a').x));
  closeClient(first);
  closeClient(second);
  closeClient(third);
});

test('옛 사본이 되풀이해 내려와도 세 PC 가 저장을 멈추고 같은 화면으로 모인다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')] });
  const second = await openClient('나', { fromClient: first, connected: true });
  const third = await openClient('다', { fromClient: first });
  const drive = createDrive();
  const original = readDisk(first.bframePath);

  const added = await first.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '캡처' });
  second.layerManager.updateLayer('a', { opacity: 0.5 });
  await runRounds([first, second, third], drive, 4);
  const afterFirstEdits = structuredClone(drive.snapshot);

  third.layerManager.updateLayer(added.id, { x: 0.05 });
  first.layerManager.deleteLayer('a');
  await runRounds([first, second, third], drive, 4);

  // 처음 상태의 사본과 중간 상태의 사본이 차례로 뒤늦게 올라온다.
  drive.uploadSnapshot(original);
  await runRounds([first, second, third], drive, 4);
  drive.uploadSnapshot(afterFirstEdits);
  const saves = await runRounds([first, second, third], drive);

  assertQuiet(saves, '옛 사본 반복');
  assertSameScreens([first, second, third], '옛 사본 반복');
  assert.deepEqual(screenLayerIds(first), [added.id]);
  assert.equal(screenLayer(first, added.id).x, 0.05);
  for (const client of [first, second, third]) {
    assert.deepEqual(diskLayerIds(client.bframePath), [added.id], client.name);
    assert.deepEqual(conflictNames(diskLayers(client.bframePath)), [], client.name);
    closeClient(client);
  }
});

test('연결 중에도 파일로 온 다른 사람의 레이어 변경을 받아들인다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });

  const added = await first.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '캡처' });
  first.layerManager.updateLayer('a', { opacity: 0.2 });
  assert.equal(await first.manager.save(), true);

  deliver(first.bframePath, second.bframePath);
  const result = await fileChanged(second);
  assert.deepEqual(result, { success: true, changed: true });
  assert.deepEqual(screenLayerIds(second), ['a', added.id]);
  assert.equal(screenLayer(second, 'a').opacity, 0.2);
  assert.equal(second.manager.hasUnsavedChanges(), false,
    '받아들이기만 한 것은 저장할 변경이 아니다');

  // 내용이 같은 파일을 다시 받으면 화면을 건드리지 않는다.
  deliver(first.bframePath, second.bframePath);
  assert.deepEqual(await fileChanged(second), { success: true, changed: false });
  closeClient(first);
  closeClient(second);
});

test('레이어를 끌고 있는 동안에는 파일에서 받아들이지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });

  first.layerManager.updateLayer('a', { opacity: 0.2 });
  assert.equal(await first.manager.save(), true);
  deliver(first.bframePath, second.bframePath);

  // 끄는 중이면 파일을 읽지도 않는다.
  let reads = 0;
  const loadReviewSnapshot = window.electronAPI.loadReviewSnapshot;
  window.electronAPI.loadReviewSnapshot = async (path) => {
    reads += 1;
    return loadReviewSnapshot(path);
  };
  second.layerManager.dragState = { layerId: 'a' };
  assert.deepEqual(await fileChanged(second), { success: false, changed: false });
  assert.equal(reads, 0);
  assert.equal(screenLayer(second, 'a').opacity, 1);

  // 파일을 읽는 사이에 끌기 시작해도 목록을 갈아 끼우지 않는다.
  second.layerManager.dragState = null;
  window.electronAPI.loadReviewSnapshot = async (path) => {
    second.layerManager.timelineDragState = { layerId: 'a' };
    return loadReviewSnapshot(path);
  };
  assert.deepEqual(await fileChanged(second), { success: false, changed: false });
  assert.equal(screenLayer(second, 'a').opacity, 1);

  window.electronAPI.loadReviewSnapshot = loadReviewSnapshot;
  second.layerManager.timelineDragState = null;
  assert.deepEqual(await fileChanged(second), { success: true, changed: true });
  assert.equal(screenLayer(second, 'a').opacity, 0.2);
  closeClient(first);
  closeClient(second);
});

test('끌기가 끝나면 미뤄 둔 받아들이기를 다시 하고, 받아들였다고 알린다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });
  let accepted = 0;
  second.manager.addEventListener('compositionLayersAccepted', () => { accepted += 1; });

  first.layerManager.updateLayer('a', { opacity: 0.2 });
  assert.equal(await first.manager.save(), true);
  deliver(first.bframePath, second.bframePath);

  // 나: b 를 끄는 중에 파일이 바뀌었다.
  second.layerManager.dragState = { layerId: 'b' };
  assert.deepEqual(await fileChanged(second), { success: false, changed: false });
  // 끌기를 끝낸다(앱의 _onDocumentPointerUp 과 같은 순서: 상태를 비우고 changed 를 낸다).
  second.layerManager.dragState = null;
  second.layerManager.updateLayer('b', { x: 0.7 });
  await wait(5);

  assert.equal(screenLayer(second, 'a').opacity, 0.2,
    '미뤄 둔 채 잊으면 다음 파일 변경 때까지 다른 사람의 변경이 화면에 없다');
  assert.equal(screenLayer(second, 'b').x, 0.7);
  assert.equal(accepted, 1, '타임라인·mpv 오버레이가 이 이벤트로 다시 그린다');
  closeClient(first);
  closeClient(second);
});

test('변경 이벤트 없이 바뀐 화면의 레이어도 받아들이기 전에 내 편집으로 잡는다', async () => {
  for (const connected of [true, false]) {
    const first = await openClient('가', { layers: [layerRecord('a')], connected });
    const second = await openClient('나', { fromClient: first, connected });

    // 나: 레이어를 옮겨 저장한다(수정 횟수 1).
    second.layerManager.updateLayer('a', { x: 0.1 });
    assert.equal(await second.manager.save(), true);

    // 가: 변경 이벤트가 나가지 않은 편집(끄는 중의 위치, 다시 읽는 동안의 편집)이 화면에 있다.
    first.layerManager.updateLayer('a', { x: 0.9 }, { emitChange: false });
    deliver(second.bframePath, first.bframePath);
    await fileChanged(first);

    // 내 편집을 잡지 않으면 화면이 수정 횟수 0 으로 읽혀 나의 것이 통째로 덮인다.
    // 잡으면 두 사람이 함께 고친 것이 되어 내용 순서로 한쪽을 고른다(0.9 가 뒤).
    assert.equal(screenLayer(first, 'a').x, 0.9, connected ? '연결 중' : '파일 동기화');
    assert.equal(await flush(first), true);
    assert.equal(diskLayer(first.bframePath, 'a').x, 0.9);
    closeClient(first);
    closeClient(second);
  }
});

test('연결 중에 파일이 옛 사본으로 돌아가면 다시 저장해 바로잡는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')], connected: true });
  const beforeAdd = readDisk(first.bframePath);
  const added = await first.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '캡처' });
  first.layerManager.updateLayer('a', { x: 0.6 });
  assert.equal(await first.manager.save(), true);

  writeDisk(first.bframePath, beforeAdd);
  assert.deepEqual(await fileChanged(first), { success: true, changed: false });
  assert.equal(first.manager.hasUnsavedChanges(), true,
    '연결 중에는 다음 편집을 기다리지 않고 바로잡아야, 파일로만 동기화하는 사람이 내 레이어를 본다');
  assert.equal(await flush(first), true);
  assert.deepEqual(diskLayerIds(first.bframePath), ['a', added.id]);
  assert.equal(diskLayer(first.bframePath, 'a').x, 0.6);
  closeClient(first);
});

test('저장이 끝난 내 편집은 파일을 다시 읽기 전에도 "방금 고친 것" 이 아니다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')], connected: true });
  first.layerManager.updateLayer('a', { x: 0.6 });
  assert.equal(await first.manager.save(), true);

  // 자기 저장의 파일 변경을 처리하기 전에, 이전 버전 PC 가 같은 레이어를 옮긴 저장분이 온다
  // (이전 버전은 수정 횟수를 올리지 않는다). 내 편집이 아직 "방금 고친 것" 으로 남아 있으면
  // 두 사람이 함께 고친 것으로 읽혀 내용 순서로 내 것이 이긴다.
  const oldVersionSave = readDisk(first.bframePath);
  oldVersionSave.compositionLayers[0].x = 0.1;
  writeDisk(first.bframePath, oldVersionSave);
  assert.deepEqual(await fileChanged(first), { success: true, changed: true });
  assert.equal(screenLayer(first, 'a').x, 0.1);
  assert.equal(first.manager.hasUnsavedChanges(), false);
  closeClient(first);
});

test('지워진 레이어를 내 편집으로 되살린 뒤에는 같은 삭제 표시가 다시 와도 지워지지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });

  // 나: 레이어를 옮긴 뒤 지워 저장한다(삭제 표시의 수정 횟수 2).
  second.layerManager.updateLayer('a', { x: 0.9 });
  second.layerManager.deleteLayer('a');
  assert.equal(await second.manager.save(), true);
  const deletedCopy = readDisk(second.bframePath);
  assert.equal(deletedCopy[SYNC_KEY].layers.a.rev, 2);

  // 가: 그것을 못 본 채 같은 레이어의 불투명도를 바꿨다(수정 횟수 1). 저장하면서 삭제
  // 표시를 만난다 — 고친 레이어를 남긴다.
  first.layerManager.updateLayer('a', { opacity: 0.4 });
  deliver(second.bframePath, first.bframePath);
  assert.equal(await first.manager.save(), true);
  assert.deepEqual(diskLayerIds(first.bframePath), ['a']);
  assert.equal(diskSync(first.bframePath).layers.a.rev, 2);

  // 같은 삭제 표시가 든 사본이 다시 내려온다.
  writeDisk(first.bframePath, { ...deletedCopy, videoPath: first.videoPath });
  await fileChanged(first);
  assert.deepEqual(screenLayerIds(first), ['a'],
    '되살린 레이어의 수정 횟수를 올려 두지 않으면 삭제 표시가 더 나중으로 읽힌다');
  assert.equal(screenLayer(first, 'a').opacity, 0.4);
  closeClient(first);
  closeClient(second);
});

test('파일이 바뀌어도 합성 레이어가 그대로면 화면을 다시 만들지 않는다(되돌리기 기록 유지)', async () => {
  for (const connected of [false, true]) {
    const first = await openClient('가', { layers: [layerRecord('a')], connected });
    let refills = 0;
    const originalFromJSON = first.layerManager.fromJSON.bind(first.layerManager);
    first.layerManager.fromJSON = (layers) => {
      refills += 1;
      return originalFromJSON(layers);
    };

    first.layerManager.updateLayer('a', { x: 0.6 });
    assert.equal(await first.manager.save(), true);
    // 자기 저장과, 합성 레이어와 무관한 다른 사람의 저장이 파일 감시에 잡힌다.
    await fileChanged(first);
    const root = readDisk(first.bframePath);
    root.modifiedAt = '2026-11-18T06:00:00.000Z';
    writeDisk(first.bframePath, root);
    await fileChanged(first);

    assert.equal(refills, 0, connected ? '연결 중' : '파일 동기화');
    assert.equal(first.layerManager.undo(), true, '목록을 다시 채우면 되돌리기 기록이 지워진다');
    assert.equal(screenLayer(first, 'a').x, 0.25);
    closeClient(first);
  }
});

test('저장 직전에 읽은 파일에서만 본 수정이 있어도, 그 뒤의 내 편집이 나중 상태다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });

  // 나: 레이어를 세 번 옮겨 저장한다(수정 횟수 3).
  for (const x of [0.3, 0.4, 0.5]) second.layerManager.updateLayer('a', { x });
  assert.equal(await second.manager.save(), true);
  assert.equal(diskSync(second.bframePath).layers.a.rev, 3);

  // 가: 그 파일을 화면으로 받아들이기 전에, 다른 일로 저장하면서 읽기만 했다.
  deliver(second.bframePath, first.bframePath);
  touchUnrelated(first);
  assert.equal(await first.manager.save(), true);
  assert.equal(diskLayer(first.bframePath, 'a').x, 0.5, '파일에는 나의 상태가 그대로 남는다');
  assert.equal(screenLayer(first, 'a').x, 0.25, '저장은 화면을 바꾸지 않는다');

  // 가: 레이어의 불투명도를 바꾼다. 수정 횟수 1 로 찍으면 나의 3 에 져서 버려진다.
  first.layerManager.updateLayer('a', { opacity: 0.5 });
  assert.equal(await first.manager.save(), true);
  assert.equal(diskLayer(first.bframePath, 'a').opacity, 0.5);
  assert.equal(diskSync(first.bframePath).layers.a.rev, 4);
  closeClient(first);
  closeClient(second);
});

test('앱을 껐다 켜도 지운 레이어는 되살아나지 않는다(삭제 표시는 파일에 있다)', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')] });
  const beforeDelete = readDisk(first.bframePath);

  first.layerManager.deleteLayer('b');
  assert.equal(await reopenClient(first), true);
  assert.deepEqual(screenLayerIds(first), ['a']);

  // 삭제 전의 사본이 뒤늦게 내려온다. 파일의 삭제 표시도 함께 덮였다.
  writeDisk(first.bframePath, beforeDelete);
  await fileChanged(first);
  assert.deepEqual(screenLayerIds(first), ['a']);
  assert.equal(await flush(first), true);
  assert.deepEqual(diskLayerIds(first.bframePath), ['a']);
  assert.equal(diskSync(first.bframePath).layers.b.deleted, true);
  closeClient(first);
});

test('파일이 생기기 전에 붙인 레이어는 먼저 만들어진 파일의 레이어와 함께 남는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')] });
  // 나: 아직 .bframe 이 없을 때 영상을 열어 레이어를 붙였다.
  const second = await openClient('나', {});
  const added = await second.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '캡처' });

  // 첫 저장 직전에 가의 파일이 내려와 있다(app.js: 기존 파일 발견 → 병합 후 저장).
  writeDisk(second.bframePath, { ...readDisk(first.bframePath), videoPath: second.videoPath });
  assert.equal((await second.manager.reloadAndMerge({ merge: true, force: true, preserveLocal: true })).success, true);
  assert.equal(await second.manager.save(), true);

  assert.deepEqual(diskLayerIds(second.bframePath).sort(), ['a', added.id].sort());
  assert.deepEqual(screenLayerIds(second).sort(), ['a', added.id].sort());
  closeClient(first);
  closeClient(second);
});

// ── 무작위 순서 ──────────────────────────────────────────────────────────────

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 시드 하나: PC 두세 대가 무작위로 레이어를 추가·수정·삭제·순서 변경·되돌리기 하고, 앱을
 * 껐다 켜고, 드라이브는 마지막 업로드나 옛 사본을 늦게 내려보낸다. 끝난 뒤의 상태를 돌려준다.
 */
async function runRandomSession(seed, stepCount) {
  const random = createRandom(seed);
  const pick = items => items[Math.floor(random() * items.length)];
  const first = await openClient('pc0', { layers: [], connected: random() < 0.5 });
  const clients = [first];
  const clientCount = 2 + Math.floor(random() * 2);
  for (let index = 1; index < clientCount; index += 1) {
    clients.push(await openClient(`pc${index}`, { fromClient: first, connected: random() < 0.5 }));
  }
  const drive = createDrive();
  const history = [];
  const upload = client => {
    drive.upload(client);
    history.push(structuredClone(drive.snapshot));
  };
  const round = async (lossy) => {
    const before = saveCount;
    for (const client of clients) {
      if (drive.version === 0 || client.deliveredVersion === drive.version) continue;
      if (lossy && random() < 0.15) continue; // 이 PC 만 배달이 늦는다
      drive.deliverTo(client);
      await fileChanged(client);
    }
    for (const client of clients) {
      if (lossy && random() < 0.1) continue; // 저장이 늦는다
      if (await flush(client)) {
        upload(client);
        await fileChanged(client);
      }
    }
    return saveCount - before;
  };

  const created = new Set();
  const removed = new Set();
  const contents = new Map();
  const contentOf = (layer) => {
    // eslint-disable-next-line no-unused-vars
    const { order, ...content } = layer;
    return JSON.stringify(content);
  };
  const recordContents = () => {
    for (const client of clients) {
      for (const layer of screenLayers(client)) {
        if (!contents.has(layer.id)) contents.set(layer.id, new Set());
        contents.get(layer.id).add(contentOf(layer));
      }
    }
  };

  for (let step = 0; step < stepCount; step += 1) {
    const client = pick(clients);
    const layers = screenLayers(client);
    const action = random();
    if (action < 0.14 && layers.length < 5) {
      const added = await client.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: `L${step}` });
      created.add(added.id);
    } else if (action < 0.44 && layers.length > 0) {
      const layer = pick(layers);
      client.layerManager.updateLayer(layer.id, pick([
        { x: pick([0.1, 0.25, 0.4, 0.6]) },
        { opacity: pick([1, 0.5, 0.2]) },
        { enabled: !layer.enabled }
      ]));
    } else if (action < 0.52 && layers.length > 0) {
      const layer = pick(layers);
      client.layerManager.deleteLayer(layer.id);
      removed.add(layer.id);
    } else if (action < 0.60 && layers.length > 1) {
      client.layerManager.moveLayerByOffset(pick(layers).id, pick([-1, 1]));
    } else if (action < 0.66) {
      client.layerManager.undo();
      const remaining = new Set(screenLayerIds(client));
      for (const layer of layers) if (!remaining.has(layer.id)) removed.add(layer.id);
    } else if (action < 0.69) {
      if (await reopenClient(client)) upload(client);
    } else if (action < 0.75 && history.length > 1) {
      drive.uploadSnapshot(pick(history.slice(0, -1))); // 옛 사본이 뒤늦게 올라온다
    } else {
      await round(true);
    }
    recordContents();
  }

  const settle = async () => {
    const counts = [];
    while (counts.length < 30 &&
        !(counts.length >= 3 && counts.slice(-3).every(count => count === 0))) {
      counts.push(await round(false));
    }
    return counts;
  };
  const saves = await settle();
  recordContents();

  // 모두 모인 뒤 한 사람이 혼자 한 변경은 모든 화면에 그대로 전해져야 한다.
  const lone = { edit: true, reorder: true, remove: true };
  const everyScreen = predicate => clients.every(client => predicate(screenLayers(client)));
  const actor = pick(clients);
  if (screenLayers(actor).length > 0) {
    const target = pick(screenLayers(actor));
    actor.layerManager.updateLayer(target.id, { x: 0.777, opacity: 0.33 });
    saves.push(...await settle());
    lone.edit = everyScreen(layers => {
      const layer = layers.find(item => item.id === target.id);
      return layer?.x === 0.777 && layer?.opacity === 0.33;
    });
  }
  if (screenLayers(actor).length > 1) {
    const before = screenLayerIds(actor);
    actor.layerManager.moveLayerByOffset(before[0], 1);
    const expected = JSON.stringify(screenLayerIds(actor));
    saves.push(...await settle());
    lone.reorder = expected !== JSON.stringify(before) &&
      everyScreen(layers => JSON.stringify(layers.map(layer => layer.id)) === expected);
  }
  if (screenLayers(actor).length > 0) {
    const target = pick(screenLayers(actor));
    actor.layerManager.deleteLayer(target.id);
    removed.add(target.id);
    saves.push(...await settle());
    lone.remove = everyScreen(layers => !layers.some(layer => layer.id === target.id));
  }
  recordContents();

  const finalLayers = screenLayers(clients[0]);
  const finalIds = new Set(finalLayers.map(layer => layer.id));
  const result = {
    saves,
    lone,
    quiet: saves.length >= 3 && saves.slice(-3).every(count => count === 0),
    sameScreens: clients.every(client =>
      JSON.stringify(screenLayers(client)) === JSON.stringify(finalLayers)),
    sameDisks: clients.every(client =>
      JSON.stringify(diskLayers(client.bframePath)) === JSON.stringify(finalLayers)),
    unsaved: clients.filter(client => client.manager.hasUnsavedChanges()).map(client => client.name),
    conflictCopies: conflictNames(finalLayers).map(layer => layer.id),
    // 아무도 지우지 않은 레이어는 끝까지 남아 있어야 한다.
    lost: [...created].filter(id => !removed.has(id) && !finalIds.has(id)),
    // 끝에 남은 내용은 누군가의 화면에 있던 내용이어야 한다.
    fabricated: finalLayers
      .filter(layer => !contents.get(layer.id)?.has(contentOf(layer)))
      .map(layer => layer.id)
  };
  clients.forEach(closeClient);
  return result;
}

test('무작위 순서 150가지: 저장이 멈추고, 화면이 같고, 지우지 않은 레이어가 남는다', async () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    const result = await runRandomSession(seed, 60);
    assert.deepEqual(
      {
        quiet: result.quiet,
        sameScreens: result.sameScreens,
        sameDisks: result.sameDisks,
        unsaved: result.unsaved,
        conflictCopies: result.conflictCopies,
        lost: result.lost,
        fabricated: result.fabricated,
        lone: result.lone
      },
      {
        quiet: true,
        sameScreens: true,
        sameDisks: true,
        unsaved: [],
        conflictCopies: [],
        lost: [],
        fabricated: [],
        lone: { edit: true, reorder: true, remove: true }
      },
      `시드 ${seed}: 마무리 회전의 저장 횟수 ${JSON.stringify(result.saves)}`
    );
  }
});

// ── 하이라이트·레거시 드로잉 ─────────────────────────────────────────────────

test('하이라이트·레거시 드로잉도 파일에 없다는 것만으로 내가 고친 것을 사본으로 바꾸지 않는다', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  installElectronApi();
  clientSequence += 1;
  const videoPath = `C:/pc-${clientSequence}/review.mp4`;
  const bframePath = `C:/pc-${clientSequence}/review.bframe`;
  const emptyRoot = reviewRoot([], videoPath);
  writeDisk(bframePath, emptyRoot);

  let highlights = { highlights: [] };
  let drawings = { layers: [] };
  const manager = new ReviewDataManager({
    autoSave: false,
    highlightManager: {
      get highlights() { return highlights.highlights; },
      toJSON: () => structuredClone(highlights),
      fromJSON(data) { highlights = structuredClone(data || { highlights: [] }); }
    },
    drawingManager: {
      get layers() { return drawings.layers; },
      exportData: () => structuredClone(drawings),
      importData(data) { drawings = structuredClone(data || { layers: [] }); }
    }
  });
  await manager.setVideoFile(videoPath);

  highlights.highlights.push({ id: 'highlight-1', startTime: 1, endTime: 2, note: '확인', modifiedAt: 'm1' });
  drawings.layers.push({ id: 'layer-x', name: '레이어 1', keyframes: [{ frame: 1, canvasData: 'k1' }] });
  manager._markDirty();
  assert.equal(await manager.save(), true);

  // 하이라이트와 레이어가 생기기 전의 사본이 내려온 뒤, 둘을 세 번 고친다.
  writeDisk(bframePath, emptyRoot);
  for (const round of [2, 3, 4]) {
    highlights.highlights[0].note = `확인 ${round}`;
    highlights.highlights[0].modifiedAt = `m${round}`;
    drawings.layers[0].keyframes[0].canvasData = `k${round}`;
    manager._markDirty();
    assert.equal(await manager.save(), true);
  }

  const saved = readDisk(bframePath);
  assert.deepEqual(saved.highlights.highlights.map(item => item.id), ['highlight-1']);
  assert.equal(saved.highlights.highlights[0].note, '확인 4',
    '예전에는 주석 끝에 "(로컬 충돌)" 이 붙은 사본이 저장할 때마다 하나씩 늘었다');
  assert.deepEqual(saved.drawings.layers.map(item => item.id), ['layer-x']);
  assert.equal(saved.drawings.layers[0].name, '레이어 1');
  assert.equal(saved.drawings.layers[0].keyframes[0].canvasData, 'k4');
});

// ── 영상 레이어 ──────────────────────────────────────────────────────────────

test('영상 레이어의 변환 확인이 끝난 것은 저장할 변경이 아니다', async () => {
  const prepareMedia = async filePath => ({ status: 'ready', filePath, message: '원본 사용' });
  const first = await openClient('가', {
    layers: [layerRecord('movie', { type: 'video', filePath: 'C:/shots/movie.webm', sourceDuration: 4 })],
    prepareMedia
  });
  await wait(10);
  assert.equal(first.manager.hasUnsavedChanges(), false,
    '파일을 열기만 했는데 저장이 걸리면 여는 사람마다 파일을 한 번씩 다시 쓴다');

  // 파일 동기화로 일하는 PC: 자기 저장도 파일 감시에 잡혀 다시 읽는다.
  const drive = createDrive();
  touchUnrelated(first);
  const saves = [];
  for (let round = 0; round < 5; round += 1) {
    const before = saveCount;
    if (await flush(first)) drive.upload(first);
    await fileChanged(first);
    await wait(10);
    saves.push(saveCount - before);
  }
  assert.deepEqual(saves, [1, 0, 0, 0, 0], '저장 → 다시 읽기 → 저장이 되풀이되면 안 된다');
  closeClient(first);
});

test('저장하는 사이에 영상 레이어의 변환 확인이 끝나도 저장을 한 번 더 하지 않는다', async () => {
  const prepareMedia = async filePath => ({ status: 'ready', filePath, message: '원본 사용' });
  const first = await openClient('가', {
    layers: [
      layerRecord('a'),
      layerRecord('movie', { type: 'video', filePath: 'C:/shots/movie.webm', sourceDuration: 4 })
    ],
    prepareMedia
  });
  await wait(10);

  // 레이어를 고쳐 저장한다. 파일에 쓰는 사이에 영상 레이어의 변환 확인이 끝난다(화면 전용 변경).
  first.layerManager.updateLayer('a', { x: 0.6 });
  const held = holdNextWrite();
  const saving = first.manager.save();
  await held.reached;
  first.layerManager.updateLayer('movie', { mediaMessage: '다시 확인함' }, { recordUndo: false });
  held.resume();
  assert.equal(await saving, true);
  assert.equal(first.manager.hasUnsavedChanges(), false,
    '쓰는 중이라 아직 기준이 옮겨지지 않았다는 이유로 화면 전용 변경을 저장할 변경으로 치면 안 된다');

  // 내 편집이 다른 사람의 더 나중 수정에 졌고, 아직 그것을 화면으로 받기 전이다.
  const second = await openClient('나', { fromClient: first, prepareMedia });
  await wait(10);
  for (const x of [0.1, 0.2, 0.3]) second.layerManager.updateLayer('a', { x });
  assert.equal(await second.manager.save(), true);
  first.layerManager.updateLayer('a', { opacity: 0.5 });
  deliver(second.bframePath, first.bframePath);
  assert.equal(await first.manager.save(), true);
  assert.equal(diskLayer(first.bframePath, 'a').x, 0.3);
  const before = saveCount;
  for (let index = 0; index < 3; index += 1) {
    first.layerManager.updateLayer('movie', { mediaMessage: `확인 ${index}` }, { recordUndo: false });
    await flush(first);
  }
  assert.equal(saveCount - before, 0, '화면 전용 변경마다 저장하면 안 된다');
  closeClient(first);
  closeClient(second);
});

// ── 이전 버전과 섞였을 때 ────────────────────────────────────────────────────

test('삭제 표시와 수정 횟수는 파일 루트의 별도 칸에 두고 레이어 레코드는 그대로 둔다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')] });
  const recordKeys = Object.keys(layerRecord('a')).sort();

  first.layerManager.updateLayer('a', { opacity: 0.5 });
  first.layerManager.deleteLayer('b');
  assert.equal(await first.manager.save(), true);

  assert.deepEqual(Object.keys(diskLayer(first.bframePath, 'a')).sort(), recordKeys,
    '이전 버전은 레이어 레코드에 모르는 칸이 있으면 저장할 때마다 "내가 고쳤다" 로 읽는다');
  const sync = diskSync(first.bframePath);
  assert.equal(sync.version, 1);
  assert.equal(sync.layers.a.rev, 1);
  assert.equal(sync.layers.b.deleted, true);
  assert.equal(sync.layers.b.rev, 1);
  assert.equal(typeof sync.layers.b.deletedAt, 'string');
  closeClient(first);
});

test('합성 레이어를 쓰지 않는 파일에는 새 칸을 만들지 않는다', async () => {
  const first = await openClient('가', { layers: [] });
  touchUnrelated(first);
  assert.equal(await first.manager.save(), true);
  assert.equal(Object.hasOwn(readDisk(first.bframePath), SYNC_KEY), false);

  const second = await openClient('나', { layers: [layerRecord('a')] });
  touchUnrelated(second);
  assert.equal(await second.manager.save(), true);
  assert.equal(Object.hasOwn(readDisk(second.bframePath), SYNC_KEY), false,
    '손대지 않은 레이어만 있는 파일도 그대로 둔다');
  closeClient(first);
  closeClient(second);
});

test('파일을 처음 만들 때도 수정 횟수와 삭제 표시를 적는다', async () => {
  // 아직 .bframe 이 없는 영상: 레이어 둘을 붙이고 하나를 지운 뒤 처음 저장한다.
  const first = await openClient('가', {});
  const kept = await first.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '남김' });
  const dropped = await first.layerManager.addLayerFromDataUrl(IMAGE_DATA_URL, { name: '지움' });
  first.layerManager.deleteLayer(dropped.id);
  assert.equal(await first.manager.save(), true);

  assert.deepEqual(diskLayerIds(first.bframePath), [kept.id]);
  const sync = diskSync(first.bframePath);
  assert.equal(sync.layers[kept.id].rev, 1);
  assert.equal(sync.layers[dropped.id].deleted, true);
  closeClient(first);
});

test('오래된 모양의 레코드는 열거나 다시 읽어도 고친 것으로 읽지 않는다', async () => {
  // 색·비율 잠금·원본 길이·순서 번호 칸이 없는 레코드 둘. 색이 없으면 매니저가 목록에서의
  // 자리로 색을 정하므로, 견줄 때도 같은 자리로 맞춰야 같은 레코드로 읽힌다.
  const oldShape = (id) => {
    // eslint-disable-next-line no-unused-vars
    const { color, selectedColor, aspectLocked, sourceDuration, order, ...record } = layerRecord(id);
    return record;
  };
  const first = await openClient('가', {
    layers: [],
    rootExtra: { compositionLayers: [oldShape('a'), oldShape('b')] },
    connected: true
  });
  assert.notEqual(screenLayer(first, 'a').color, screenLayer(first, 'b').color);
  let refills = 0;
  const originalFromJSON = first.layerManager.fromJSON.bind(first.layerManager);
  first.layerManager.fromJSON = (layers) => {
    refills += 1;
    return originalFromJSON(layers);
  };

  assert.equal(first.manager.hasUnsavedChanges(), false);
  assert.deepEqual(await fileChanged(first), { success: true, changed: false });
  assert.equal(refills, 0);
  assert.equal(first.manager.hasUnsavedChanges(), false,
    '모양만 다른 것을 편집으로 읽으면 여는 사람마다 파일을 한 번씩 다시 쓴다');

  touchUnrelated(first);
  assert.equal(await first.manager.save(), true);
  assert.equal(Object.hasOwn(readDisk(first.bframePath), SYNC_KEY), false);
  closeClient(first);
});

test('파일로 통째로 덮어쓴 뒤에는 그 파일의 상태에서 다시 시작한다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')] });
  const second = await openClient('나', { fromClient: first });

  second.layerManager.updateLayer('a', { x: 0.6 });
  second.layerManager.deleteLayer('b');
  assert.equal(await second.manager.save(), true);
  const remoteSync = diskSync(second.bframePath);

  // 가: 저장하지 않은 편집을 버리고 파일로 덮어쓴다.
  first.layerManager.updateLayer('a', { opacity: 0.3 });
  first.layerManager.updateLayer('b', { opacity: 0.3 });
  deliver(second.bframePath, first.bframePath);
  assert.equal((await first.manager.reloadAndMerge({ merge: false, force: true })).success, true);
  assert.deepEqual(screenLayerIds(first), ['a']);
  assert.equal(screenLayer(first, 'a').opacity, 1);

  touchUnrelated(first);
  assert.equal(await first.manager.save(), true);
  assert.deepEqual(diskSync(first.bframePath), remoteSync,
    '버린 편집의 흔적으로 수정 횟수를 올리면 안 된다');
  assert.deepEqual(diskLayerIds(first.bframePath), ['a']);
  closeClient(first);
  closeClient(second);
});

test('파일의 레이어를 이긴 삭제 표시는 개수 한도를 넘어도 파일에 적는다', async () => {
  // 삭제 표시가 한도보다 많고, 그 가운데 가장 오래된 것이 레이어 a 의 표시다.
  const tombstones = { a: { rev: 3, deleted: true, deletedAt: '2020-01-01T00:00:00.000Z' } };
  for (let index = 0; index < 520; index += 1) {
    tombstones[`gone-${index}`] = {
      rev: 1,
      deleted: true,
      deletedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    };
  }
  const first = await openClient('가', {
    layers: [layerRecord('b')],
    rootExtra: { [SYNC_KEY]: { version: 1, layers: tombstones, orderRev: 0 } },
    connected: true
  });

  // a 가 살아 있던 때의 사본이 뒤늦게 내려온다.
  writeDisk(first.bframePath, reviewRoot([layerRecord('a'), layerRecord('b')], first.videoPath));
  await fileChanged(first);
  assert.deepEqual(screenLayerIds(first), ['b']);
  assert.equal(await flush(first), true);

  assert.deepEqual(diskLayerIds(first.bframePath), ['b']);
  assert.equal(diskSync(first.bframePath).layers.a?.deleted, true,
    '이 표시가 빠지면 a 를 든 PC 와 삭제 표시를 든 PC 가 파일을 번갈아 고쳐 쓴다');
  closeClient(first);
});

test('이전 버전이 고친 레이어(수정 횟수가 그대로)는 받아들이고, 저장을 되풀이하지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a')] });
  const second = await openClient('나', { fromClient: first });
  const drive = createDrive();

  first.layerManager.updateLayer('a', { x: 0.6 });
  await runRounds([first, second], drive, 4);

  // 이전 버전 PC: 레이어를 옮겨 저장한다. 별도 칸은 모르는 칸이라 읽은 그대로 다시 쓴다.
  const oldVersionSave = structuredClone(drive.snapshot);
  oldVersionSave.compositionLayers[0].x = 0.8;
  oldVersionSave.modifiedAt = '2026-11-18T06:00:00.000Z';
  drive.uploadSnapshot(oldVersionSave);

  const saves = await runRounds([first, second], drive);
  assertQuiet(saves, '이전 버전의 수정');
  assert.equal(screenLayer(first, 'a').x, 0.8);
  assert.equal(screenLayer(second, 'a').x, 0.8);
  closeClient(first);
  closeClient(second);
});

test('별도 칸의 판 번호가 더 높으면 건드리지 않고 그대로 보존한다', async () => {
  const future = { version: 2, layers: { a: { rev: 9, vector: [1, 2] } }, extra: true };
  const first = await openClient('가', {
    layers: [layerRecord('a')],
    rootExtra: { [SYNC_KEY]: future }
  });
  first.layerManager.updateLayer('a', { opacity: 0.5 });
  assert.equal(await first.manager.save(), true);
  assert.deepEqual(diskSync(first.bframePath), future);
  assert.equal(diskLayer(first.bframePath, 'a').opacity, 0.5);

  // 수정 횟수를 적을 수 없는 파일이다. 내 수정 횟수만 앞선 것을 "파일이 뒤처졌다" 로 보면
  // 저장해도 그대로라 저장 → 다시 읽기 → 저장이 끝없이 되풀이된다.
  for (const connected of [false, true]) {
    first.connected = connected;
    await fileChanged(first);
    assert.equal(first.manager.hasUnsavedChanges(), false, connected ? '연결 중' : '파일 동기화');
  }
  // 수정 횟수를 적을 수 없는 파일에서는 옛 사본을 가릴 수 없다. 내가 고치는 중이 아니면
  // 파일을 따르고 다시 저장하지 않는다 — 여기서 바로잡으려 들면 같은 처지의 두 PC 가
  // 서로의 저장분을 번갈아 덮어쓴다(아래 검사).
  const reverted = readDisk(first.bframePath);
  reverted.compositionLayers[0].opacity = 1;
  writeDisk(first.bframePath, reverted);
  await fileChanged(first);
  assert.equal(first.manager.hasUnsavedChanges(), false);
  assert.equal(screenLayer(first, 'a').opacity, 1);
  assert.deepEqual(diskSync(first.bframePath), future);
  closeClient(first);
});

test('별도 칸의 판 번호가 더 높은 파일에서도 두 PC 가 저장을 되풀이하지 않는다', async () => {
  const future = { version: 2, layers: { a: { rev: 7, clock: 'abc' } }, orderRev: 3, extra: true };
  for (const connected of [false, true]) {
    const label = connected ? '연결 중' : '파일 동기화';
    const first = await openClient('가', {
      layers: [layerRecord('a'), layerRecord('b'), layerRecord('c')],
      rootExtra: { [SYNC_KEY]: future },
      connected
    });
    const second = await openClient('나', { fromClient: first, connected });
    const clients = [first, second];
    const drive = createDrive();

    // 지우기: 삭제 표시를 적을 수 없어도 지운 것은 지워진다. 예전에는 한쪽이 지우고 다른
    // 쪽이 되살리기를 끝없이 되풀이했다.
    const beforeDelete = readDisk(first.bframePath);
    first.layerManager.deleteLayer('c');
    assertQuiet(await runRounds(clients, drive), `${label} 삭제`);
    assert.deepEqual(screenLayerIds(first), ['a', 'b'], label);
    assertSameScreens(clients, `${label} 삭제`);

    // 삭제 전의 사본이 내려오면 이 파일에서는 옛 사본인지 가릴 수 없다. 두 PC 가 같은 판정을
    // 해야 한다 — 지운 쪽만 "내가 지운 것" 으로 기억하고 있으면 한쪽 화면에만 레이어가 돌아온다.
    drive.uploadSnapshot(beforeDelete);
    assertQuiet(await runRounds(clients, drive), `${label} 옛 사본`);
    assertSameScreens(clients, `${label} 옛 사본`);
    assert.deepEqual(screenLayerIds(first), ['a', 'b', 'c'], label);
    second.layerManager.deleteLayer('c');
    assertQuiet(await runRounds(clients, drive), `${label} 다시 삭제`);
    assert.deepEqual(screenLayerIds(first), ['a', 'b'], label);

    // 차례로 옮기기: 나중에 옮긴 쪽이 남는다. 예전에는 메모리에만 있는 수정 횟수로 서로
    // 자기 것이 나중이라고 읽어 번갈아 덮어썼다.
    first.layerManager.updateLayer('a', { x: 0.6 });
    assertQuiet(await runRounds(clients, drive), `${label} 이동 1`);
    second.layerManager.updateLayer('a', { x: 0.1 });
    assertQuiet(await runRounds(clients, drive), `${label} 이동 2`);
    assert.equal(screenLayer(first, 'a').x, 0.1, label);
    assertSameScreens(clients, `${label} 이동`);

    // 함께 옮기기, 순서 바꾸기.
    first.layerManager.updateLayer('a', { x: 0.7 });
    second.layerManager.updateLayer('a', { x: 0.2 });
    second.layerManager.moveLayerByOffset('a', 1);
    assertQuiet(await runRounds(clients, drive), `${label} 함께 이동`);
    assertSameScreens(clients, `${label} 함께 이동`);
    assert.deepEqual(screenLayerIds(first), ['b', 'a'], label);

    // 한쪽이 지우고 다른 쪽이 고치면 고친 레이어가 남는다.
    first.layerManager.deleteLayer('b');
    second.layerManager.updateLayer('b', { opacity: 0.4 });
    assertQuiet(await runRounds(clients, drive), `${label} 삭제와 수정`);
    assertSameScreens(clients, `${label} 삭제와 수정`);
    assert.equal(screenLayer(first, 'b')?.opacity, 0.4, label);

    for (const client of clients) {
      assert.deepEqual(diskSync(client.bframePath), future, `${label}: 미래 판의 값은 그대로 둔다`);
      assert.deepEqual(conflictNames(diskLayers(client.bframePath)), [], label);
      closeClient(client);
    }
  }
});

// ── 저장하는 사이의 편집 ─────────────────────────────────────────────────────

test('고친 것을 저장하는 사이에 지운 레이어는 되살아나지 않는다', async () => {
  for (const connected of [true, false]) {
    for (const during of ['지우기', '또 고친 뒤 지우기']) {
      const label = `${connected ? '연결 중' : '파일 동기화'}, ${during}`;
      const client = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], connected });

      client.layerManager.updateLayer('a', { x: 0.6 });
      const held = holdNextWrite();
      const firstSave = client.manager.save();
      await held.reached;
      // 파일에 쓰는 사이(구글 드라이브 폴더에서는 수백 ms)에 화면에서 또 손을 댄다.
      if (during === '지우기') client.layerManager.deleteLayer('a');
      else client.layerManager.updateLayer('a', { x: 0.7 });
      held.resume();
      assert.equal(await firstSave, true, label);
      assert.equal(diskLayer(client.bframePath, 'a').x, 0.6, label);
      if (during !== '지우기') client.layerManager.deleteLayer('a');

      // 다음 저장은 방금 내가 쓴 파일(수정 횟수 1)을 읽는다. 그것을 "다른 사람이 고친 것"
      // 으로 읽으면 "남의 편집을 삭제로 덮지 않는다" 가 걸려 지운 레이어가 되살아난다.
      assert.equal(await flush(client), true, label);
      await fileChanged(client);
      assert.deepEqual(diskLayerIds(client.bframePath), ['b'], label);
      assert.deepEqual(screenLayerIds(client), ['b'], label);
      assert.equal(diskSync(client.bframePath).layers.a.deleted, true, label);
      assert.equal(client.manager.hasUnsavedChanges(), false, label);
      closeClient(client);
    }
  }
});

test('남의 삭제를 내 편집이 이겨 쓰이는 사이에 그 레이어를 지워도 되살아나지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], connected: true });
  const second = await openClient('나', { fromClient: first, connected: true });

  // 나: a 를 두 번 고친 뒤 지워 저장한다(삭제 표시의 수정 횟수 3).
  second.layerManager.updateLayer('a', { x: 0.4 });
  second.layerManager.updateLayer('a', { x: 0.5 });
  second.layerManager.deleteLayer('a');
  assert.equal(await second.manager.save(), true);
  assert.equal(diskSync(second.bframePath).layers.a.rev, 3);

  // 가: 그것을 못 본 채 a 를 고친다(수정 횟수 1). 저장하면서 삭제 표시를 만나, 고친 레이어를
  // 삭제 표시보다 뒤(수정 횟수 3)로 쓴다. 그 쓰기 도중에 가도 a 를 지운다.
  first.layerManager.updateLayer('a', { opacity: 0.4 });
  deliver(second.bframePath, first.bframePath);
  const held = holdNextWrite();
  const firstSave = first.manager.save();
  await held.reached;
  first.layerManager.deleteLayer('a');
  held.resume();
  assert.equal(await firstSave, true);
  assert.deepEqual(diskLayerIds(first.bframePath), ['a', 'b']);
  assert.equal(diskSync(first.bframePath).layers.a.rev, 3);

  // 다음 저장이 읽는 a 는 방금 내가 쓴 것이다. 수정 횟수가 내가 지울 때 보던 것(1)보다 크다는
  // 것만으로 "못 본 남의 편집" 으로 읽으면, 두 사람이 다 지운 레이어가 양쪽 화면에 되살아난다.
  assert.equal(await flush(first), true);
  await fileChanged(first);
  assert.deepEqual(diskLayerIds(first.bframePath), ['b']);
  assert.deepEqual(screenLayerIds(first), ['b']);

  const drive = createDrive();
  drive.upload(first);
  assertQuiet(await runRounds([first, second], drive), '둘 다 지운 레이어');
  assert.deepEqual(screenLayerIds(second), ['b']);
  assert.deepEqual(diskLayerIds(second.bframePath), ['b']);
  closeClient(first);
  closeClient(second);
});

test('파일에 쓰기는 끝났는데 저장이 실패로 끝난 경우에도, 그 뒤에 지운 레이어는 되살아나지 않는다', async () => {
  // 수정 횟수를 적을 수 있는 파일과 없는 파일(다룰 수 없는 판) 둘 다. 뒤쪽은 지울 때 보던
  // 판을 견줄 수 없어, 쓰기가 끝난 그 순간에 기준을 옮겨 두는 것만이 막아 준다.
  for (const [label, rootExtra] of [
    ['수정 횟수 있음', {}],
    ['수정 횟수 없음', { [SYNC_KEY]: { version: 2, layers: {} } }]
  ]) {
    const client = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], rootExtra });
    client.layerManager.updateLayer('a', { x: 0.6 });
    const held = holdNextWrite();
    const firstSave = client.manager.save();
    await held.reached;
    // 쓰는 사이에 파일 감시가 파일을 다시 읽는다(파일 동기화). 저장은 파일에 쓴 뒤에 이것을
    // 알아채고 "저장 중 파일 상태가 바뀌었다" 로 끝낸다 — 파일에는 이미 내 수정이 들어갔다.
    const reload = fileChanged(client);
    await wait(5);
    held.resume();
    assert.equal(await firstSave, false, `${label}: 쓰기는 끝났지만 저장 완료 처리를 하지 못했다`);
    await reload;
    assert.equal(diskLayer(client.bframePath, 'a').x, 0.6, `${label}: 파일에는 내 수정이 들어가 있다`);

    // 그 레이어를 지운다. 파일에 있는 것은 방금 내가 쓴 것이다.
    client.layerManager.deleteLayer('a');
    assert.equal(await flush(client), true, label);
    await fileChanged(client);
    assert.deepEqual(diskLayerIds(client.bframePath), ['b'], label);
    assert.deepEqual(screenLayerIds(client), ['b'], label);
    closeClient(client);
  }
});

test('수정 횟수를 적을 수 없는 파일에서도, 저장하는 사이에 지운 레이어는 되살아나지 않는다', async () => {
  const future = { version: 2, layers: {}, orderRev: 9 };
  for (const during of ['지우기', '또 고친 뒤 지우기', '순서를 또 바꾸기']) {
    const client = await openClient('가', {
      layers: [layerRecord('a'), layerRecord('b'), layerRecord('c')],
      rootExtra: { [SYNC_KEY]: future },
      connected: true
    });
    client.layerManager.updateLayer('a', { x: 0.6 });
    client.layerManager.moveLayerByOffset('a', 1);
    const held = holdNextWrite();
    const firstSave = client.manager.save();
    await held.reached;
    if (during === '지우기') client.layerManager.deleteLayer('a');
    else if (during === '또 고친 뒤 지우기') client.layerManager.updateLayer('a', { x: 0.7 });
    else client.layerManager.moveLayerByOffset('a', 1);
    held.resume();
    assert.equal(await firstSave, true, during);
    if (during === '또 고친 뒤 지우기') client.layerManager.deleteLayer('a');

    assert.equal(await flush(client), true, during);
    await fileChanged(client);
    // 수정 횟수가 없으면 "내가 쓴 칸" 은 저장할 때의 내 상태와 쓴 것을 견주어서만 알 수 있다.
    const expected = during === '순서를 또 바꾸기' ? ['b', 'c', 'a'] : ['b', 'c'];
    assert.deepEqual(diskLayerIds(client.bframePath), expected, during);
    assert.deepEqual(screenLayerIds(client), expected, during);
    assert.equal(client.manager.hasUnsavedChanges(), false, during);
    assert.deepEqual(diskSync(client.bframePath), future, during);
    closeClient(client);
  }
});

test('저장하는 사이에 지웠다가 되돌린 레이어는 남는다', async () => {
  const client = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], connected: true });
  client.layerManager.deleteLayer('a');
  const held = holdNextWrite();
  const firstSave = client.manager.save();
  await held.reached;
  assert.equal(client.layerManager.undo(), true);
  held.resume();
  assert.equal(await firstSave, true);
  assert.deepEqual(diskLayerIds(client.bframePath), ['b']);

  assert.equal(await flush(client), true);
  await fileChanged(client);
  assert.deepEqual(diskLayerIds(client.bframePath), ['a', 'b']);
  assert.deepEqual(screenLayerIds(client), ['a', 'b']);
  assert.equal(diskSync(client.bframePath).layers.a.deleted, undefined);
  closeClient(client);
});

test('내 편집이 이미 덮은 다른 사람의 수정은, 그 레이어를 지울 때 되살리지 않는다', async () => {
  for (const connected of [true, false]) {
    const label = connected ? '연결 중' : '파일 동기화';
    const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], connected });
    const second = await openClient('나', { fromClient: first, connected });

    // 나: 레이어를 옮겨 저장한다(수정 횟수 1).
    second.layerManager.updateLayer('a', { x: 0.6 });
    assert.equal(await second.manager.save(), true);

    // 가: 그 파일을 화면으로 받기 전에 다른 일로 저장하면서 읽기만 했다(수정 횟수 1 을 봤다).
    deliver(second.bframePath, first.bframePath);
    touchUnrelated(first);
    assert.equal(await first.manager.save(), true);
    // 가: 불투명도를 바꾼다(수정 횟수 2 — 나의 이동보다 나중이다). 그 뒤에 파일 변경을 처리한다.
    first.layerManager.updateLayer('a', { opacity: 0.5 });
    await fileChanged(first);
    assert.equal(screenLayer(first, 'a').opacity, 0.5, label);
    assert.equal(screenLayer(first, 'a').x, 0.25, label);

    // 가: 그 레이어를 지운다. 파일에는 아직 나의 이동(수정 횟수 1)이 있다 — 이미 내 편집이
    // 덮은 것이므로 "내가 못 본 남의 편집" 이 아니다.
    first.layerManager.deleteLayer('a');
    assert.equal(await flush(first), true, label);
    assert.deepEqual(diskLayerIds(first.bframePath), ['b'], label);
    assert.equal(diskSync(first.bframePath).layers.a.deleted, true, label);

    const drive = createDrive();
    drive.upload(first);
    const saves = await runRounds([first, second], drive);
    assertQuiet(saves, label);
    assert.deepEqual(screenLayerIds(first), ['b'], label);
    assert.deepEqual(screenLayerIds(second), ['b'], label);
    closeClient(first);
    closeClient(second);
  }
});

test('함께 순서를 바꾸고 한쪽이 상대가 옮긴 레이어를 지워도 화면과 파일의 순서가 갈리지 않는다', async () => {
  for (const connected of [false, true]) {
    const label = connected ? '연결 중' : '파일 동기화';
    const first = await openClient('가', {
      layers: [layerRecord('p'), layerRecord('q'), layerRecord('r')],
      connected
    });
    const second = await openClient('나', { fromClient: first, connected });
    const drive = createDrive();

    // 나: p 를 한 칸 올려 저장한다(p q r → q p r).
    second.layerManager.moveLayerByOffset('p', 1);
    assert.equal(await second.manager.save(), true);
    drive.upload(second);
    // 가: 그것을 못 본 채 r 을 한 칸 내리고(p r q) p 를 지운다(r q). 저장할 때는 나의 파일이
    // 이미 내려와 있다.
    first.layerManager.moveLayerByOffset('r', -1);
    first.layerManager.deleteLayer('p');
    drive.deliverTo(first);
    assert.equal(await first.manager.save(), true);
    drive.upload(first);
    await fileChanged(first);

    const saves = await runRounds([first, second], drive);
    assertQuiet(saves, label);
    // 남은 레이어(q, r)끼리의 순서를 바꾼 것은 가뿐이다 — 나가 옮긴 p 는 지워졌다. 지워진
    // 레이어까지 넣어 "둘 다 순서를 바꿨다" 로 읽으면, 저장할 때는 파일의 순서를 쓰고 다시
    // 읽을 때는 화면의 순서를 고집해, 저장할 것이 없는데 화면과 파일이 다른 채로 남는다.
    assert.deepEqual(screenLayerIds(first), ['r', 'q'], label);
    assert.deepEqual(diskLayerIds(first.bframePath), ['r', 'q'], label);
    assert.deepEqual(screenLayerIds(second), ['r', 'q'], label);
    closeClient(first);
    closeClient(second);
  }
});

test('저장에 실패한 편집은 변경 이벤트가 뒤늦게 와도 저장할 변경으로 남는다', async () => {
  const client = await openClient('가', { layers: [layerRecord('a')] });
  // 끄는 중: 화면에는 새 위치가 있지만 changed 는 아직 나가지 않았다.
  client.layerManager.dragState = { layerId: 'a' };
  client.layerManager.updateLayer('a', { x: 0.7 }, { emitChange: false });
  // 그때 Ctrl+S 를 눌렀는데 쓰기가 실패한다.
  failNextWrite();
  assert.equal(await client.manager.save(), false);
  assert.equal(diskLayer(client.bframePath, 'a').x, 0.25);
  assert.equal(client.manager.hasUnsavedChanges(), true,
    '실패한 저장이 읽어 간 편집은 그 자리에서 저장할 변경으로 남긴다');

  // 끌기가 끝나 changed 가 나간다. 저장하려고 읽어 간 편집이라고 "달라진 것이 없다" 로
  // 읽으면, 파일에 닿지 못한 편집이 화면에만 남는다.
  client.layerManager.dragState = null;
  client.layerManager._changed('layerUpdated', { layer: client.layerManager.getLayer('a') });
  assert.equal(client.manager.hasUnsavedChanges(), true);
  assert.equal(await flush(client), true);
  assert.equal(diskLayer(client.bframePath, 'a').x, 0.7);
  closeClient(client);
});

// ── 조작 중에 미뤄 둔 받아들이기 ─────────────────────────────────────────────

test('조작이 변경 이벤트 없이 끝나도 미뤄 둔 받아들이기를 잊지 않는다', async () => {
  const gestures = {
    '패널에서 끌다 제자리에 놓기': layerManager => { layerManager.panelReorderState = { layerId: 'b' }; },
    '값을 바꾸지 않고 손 떼기': layerManager => { layerManager.panelContinuousEdit = { key: 'b:opacity' }; },
    '타임라인에서 순서 바꾸려다 놓기': layerManager => {
      layerManager.timeline = { compositionLayerReorderState: { layerId: 'b' } };
    }
  };
  const release = (layerManager) => {
    layerManager.panelReorderState = null;
    layerManager.panelContinuousEdit = null;
    if (layerManager.timeline) layerManager.timeline.compositionLayerReorderState = null;
  };
  for (const [label, begin] of Object.entries(gestures)) {
    const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], connected: true });
    const second = await openClient('나', {
      fromClient: first,
      connected: true,
      managerOptions: { compositionLayerReloadRetryDelay: 5 }
    });
    first.layerManager.updateLayer('a', { opacity: 0.2 });
    assert.equal(await first.manager.save(), true);
    deliver(first.bframePath, second.bframePath);

    begin(second.layerManager);
    assert.deepEqual(await fileChanged(second), { success: false, changed: false }, label);
    await wait(30);
    assert.equal(screenLayer(second, 'a').opacity, 1, `${label}: 조작 중에는 받아들이지 않는다`);

    // 조작이 끝났지만 changed 는 나가지 않는다.
    release(second.layerManager);
    assert.equal(await waitUntil(() => screenLayer(second, 'a').opacity === 0.2), true,
      `${label}: 미뤄 둔 채 잊으면 다음 파일 변경 때까지 다른 사람의 변경이 화면에 없다`);
    closeClient(first);
    closeClient(second);
  }
});

test('조작 표시가 풀리지 않고 남아도 받아들이기를 끝없이 미루지 않는다', async () => {
  const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], connected: true });
  const second = await openClient('나', {
    fromClient: first,
    connected: true,
    managerOptions: { compositionLayerReloadRetryDelay: 5, compositionLayerReloadMaxDeferral: 40 }
  });
  first.layerManager.updateLayer('a', { opacity: 0.2 });
  assert.equal(await first.manager.save(), true);
  deliver(first.bframePath, second.bframePath);

  // 끄는 도중 목록이 다시 그려져 끝났다는 신호(dragend)를 받지 못한 경우: 표시가 남는다.
  second.layerManager.panelReorderState = { layerId: 'b' };
  assert.deepEqual(await fileChanged(second), { success: false, changed: false });
  assert.equal(await waitUntil(() => screenLayer(second, 'a').opacity === 0.2), true,
    '표시가 남았다는 이유로 다른 사람의 변경을 영영 받지 않으면 안 된다');
  closeClient(first);
  closeClient(second);
});

test('연결을 끊으면 미뤄 둔 받아들이기를 다시 하지 않는다', async () => {
  const first = await openClient('가', {
    layers: [layerRecord('a')],
    connected: true,
    managerOptions: { compositionLayerReloadRetryDelay: 5 }
  });
  let reads = 0;
  first.layerManager.dragState = { layerId: 'a' };
  assert.deepEqual(await fileChanged(first), { success: false, changed: false });
  closeClient(first);
  first.layerManager.dragState = null;
  const loadReviewSnapshot = window.electronAPI.loadReviewSnapshot;
  window.electronAPI.loadReviewSnapshot = async (path) => {
    reads += 1;
    return loadReviewSnapshot(path);
  };
  await wait(40);
  window.electronAPI.loadReviewSnapshot = loadReviewSnapshot;
  assert.equal(reads, 0, '연결을 끊은 뒤에는 다시 읽지 않는다');
});

test('영상을 바꿔 열면 앞 파일에서 미뤄 둔 받아들이기는 버린다', async () => {
  const first = await openClient('가', {
    layers: [layerRecord('a')],
    connected: true,
    managerOptions: { compositionLayerReloadRetryDelay: 5 }
  });
  const otherVideoPath = 'C:/pc-other/next.mp4';
  writeDisk('C:/pc-other/next.bframe', reviewRoot([layerRecord('z')], otherVideoPath));

  first.layerManager.dragState = { layerId: 'a' };
  assert.deepEqual(await fileChanged(first), { success: false, changed: false });
  first.layerManager.dragState = null;
  await first.manager.setVideoFile(otherVideoPath);
  assert.deepEqual(screenLayerIds(first), ['z']);

  let reads = 0;
  const loadReviewSnapshot = window.electronAPI.loadReviewSnapshot;
  window.electronAPI.loadReviewSnapshot = async (path) => {
    reads += 1;
    return loadReviewSnapshot(path);
  };
  await wait(40);
  window.electronAPI.loadReviewSnapshot = loadReviewSnapshot;
  assert.equal(reads, 0, '앞 파일의 일로 새 파일을 다시 읽지 않는다');
  closeClient(first);
});

// ── 수정 횟수를 모르는 다른 저장 주체 ────────────────────────────────────────

test('삭제 표시가 있는 레이어는 옛 목록에 남아 있어도 되살리지 않는다(웹 뷰어의 저장분)', async () => {
  for (const connected of [true, false]) {
    const label = connected ? '연결 중' : '파일 동기화';
    const first = await openClient('가', { layers: [layerRecord('a'), layerRecord('b')], connected });
    const second = await openClient('나', { fromClient: first, connected });
    const drive = createDrive();
    const openedByWeb = readDisk(first.bframePath);

    first.layerManager.deleteLayer('b');
    await runRounds([first, second], drive, 4);
    assert.deepEqual(screenLayerIds(second), ['a'], label);

    // 웹 뷰어: 합성 레이어는 자기가 연 때의 목록(b 가 있다)을, 모르는 칸은 최신 파일의 것
    // (b 의 삭제 표시)을 붙여 저장한다.
    const webSave = structuredClone(drive.snapshot);
    webSave.compositionLayers = openedByWeb.compositionLayers;
    webSave.modifiedAt = '2026-11-18T07:00:00.000Z';
    assert.equal(webSave[SYNC_KEY].layers.b.deleted, true);
    drive.uploadSnapshot(webSave);

    const saves = await runRounds([first, second], drive);
    assertQuiet(saves, label);
    assert.deepEqual(screenLayerIds(first), ['a'], label);
    assert.deepEqual(screenLayerIds(second), ['a'], label);
    assert.deepEqual(diskLayerIds(first.bframePath), ['a'],
      `${label}: 파일에 남은 옛 레코드도 치운다(이전 버전은 그것을 살아 있는 레이어로 보여 준다)`);
    assert.equal(diskSync(first.bframePath).layers.b.deleted, true, label);

    // 그 저장분을 처음 여는 PC 도 지워진 레이어를 보여 주지 않는다.
    const third = await openClient('다', { layers: [], rootExtra: {
      compositionLayers: webSave.compositionLayers,
      [SYNC_KEY]: webSave[SYNC_KEY]
    }, connected });
    assert.deepEqual(screenLayerIds(third), ['a'], label);
    assert.equal(third.manager.hasUnsavedChanges(), false, label);
    touchUnrelated(third);
    assert.equal(await flush(third), true, label);
    assert.deepEqual(diskLayerIds(third.bframePath), ['a'], label);
    assert.equal(diskSync(third.bframePath).layers.b.deleted, true, label);
    for (const client of [first, second, third]) closeClient(client);
  }
});

test('앱이 받아들이지 않는 id(0 등)의 레코드가 있어도 레이어가 끝없이 늘지 않는다', async () => {
  for (const badId of [0, false, '']) {
    const first = await openClient('가', {
      layers: [],
      rootExtra: { compositionLayers: [layerRecord('a'), { ...layerRecord('zero'), id: badId, order: 1 }] }
    });
    const second = await openClient('나', { fromClient: first });
    const drive = createDrive();
    touchUnrelated(first);
    const saves = await runRounds([first, second], drive, 10);
    assertQuiet(saves, `id ${JSON.stringify(badId)}`);
    assertSameScreens([first, second], `id ${JSON.stringify(badId)}`);
    // 매니저는 그런 레코드에 여는 PC 마다 새 id 를 붙인다. 두 PC 가 하나씩, 그 이상은 늘지 않는다.
    assert.ok(screenLayerIds(first).length <= 3,
      `id ${JSON.stringify(badId)}: ${screenLayerIds(first).length}개`);
    closeClient(first);
    closeClient(second);
  }
});
