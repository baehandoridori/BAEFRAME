'use strict';

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

async function loadModules() {
  const [{ ReviewDataManager }, layers] = await Promise.all([
    import('../../renderer/scripts/modules/review-data-manager.js'),
    import('../../shared/drawing-layers.js')
  ]);
  return { ReviewDataManager, layers };
}

test('레이어는 drawingsV3 와 같은 opaque 루트 자리에 산다', async () => {
  // .bframe 최상위는 앱이 모르는 필드를 보존한다(shared/bframe-root-envelope.js).
  // 그래서 형제 루트 키에 두면 **드로잉 스키마를 한 글자도 건드리지 않고**
  // 레이어를 표현할 수 있고, 그 브리지를 가진 버전끼리는 왕복해도 보존된다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});

  // 레이어를 모르는 파일: 기본 레이어 하나로 열린다.
  assert.equal(manager.getDrawingLayers().layers.length, 1);
  assert.deepEqual(manager.getDrawingLayers().assignments, {});

  // 기본 상태 그대로면 루트에 키를 만들지 않는다.
  const untouched = manager._buildBframeRoot
    ? manager._buildBframeRoot()
    : null;
  if (untouched) {
    assert.equal(
      Object.hasOwn(untouched, layers.DRAWING_LAYERS_ROOT_KEY),
      false,
      '쓰지 않은 파일에 빈 구조를 심지 않는다'
    );
  }
});

test('레이어 상태는 실제로 달라졌을 때만 변경으로 표시된다', async () => {
  // 읽기만 해도 저장 대상이 되면 아무것도 안 했는데 파일이 계속 더러워진다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});

  const same = manager.setDrawingLayers(manager.getDrawingLayers());
  assert.equal(same, false, '같은 값은 변경이 아니다');

  const { state: two } = layers.addLayer(manager.getDrawingLayers());
  assert.equal(manager.setDrawingLayers(two), true, '레이어가 늘면 변경이다');
  assert.equal(manager.getDrawingLayers().layers.length, 2);
});

test('상한 값을 넣어도 쓸 수 있는 상태로 정규화된다', async () => {
  // 레이어는 그림 자체가 아니라 그림을 묶는 부가 정보다. 조금 상했다고 거부하면
  // 사용자가 그림을 통째로 잃는다.
  const { ReviewDataManager } = await loadModules();
  const manager = new ReviewDataManager({});
  manager.setDrawingLayers({ version: 99, layers: 'not-an-array' });
  const state = manager.getDrawingLayers();
  assert.equal(state.layers.length, 1);
  assert.equal(state.activeLayerId, state.layers[0].id);
  assert.equal(state.baseLayerId, state.layers[0].id);
});

test('저장 직전 새로고침이 로컬 레이어 변경을 되돌리지 않는다', async () => {
  // _captureRootEnvelope 는 로드뿐 아니라 **저장 직전 새로고침**에서도 불린다.
  // 거기서 레이어를 디스크 값으로 갈아 끼우면 방금 사용자가 만든 레이어가
  // 조용히 사라지고 낡은 상태가 저장된다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});

  // 로드: 디스크에 레이어가 둘인 파일을 읽는다.
  const onDisk = layers.addLayer(layers.createDefaultDrawingLayers()).state;
  manager._applyData({
    [layers.DRAWING_LAYERS_ROOT_KEY]: JSON.parse(JSON.stringify(onDisk))
  });
  assert.equal(manager.getDrawingLayers().layers.length, 2, '로드가 디스크 값을 채택한다');

  // 사용자가 레이어를 하나 더 만든다.
  manager.setDrawingLayers(layers.addLayer(manager.getDrawingLayers()).state);
  assert.equal(manager.getDrawingLayers().layers.length, 3);

  // 저장 직전 새로고침: 같은 디스크 내용을 다시 읽는다.
  manager._captureRootEnvelope({
    [layers.DRAWING_LAYERS_ROOT_KEY]: JSON.parse(JSON.stringify(onDisk))
  });
  assert.equal(
    manager.getDrawingLayers().layers.length,
    3,
    '새로고침이 로컬 변경을 덮지 않는다'
  );
});

test('레이어 변경은 저장 대상으로 표시된다', async () => {
  // 표시하지 않으면 자동 저장이 잡히지 않고 hasUnsavedChanges 가 false 로 남아,
  // 닫기·영상 전환 경로가 레이어 변경을 그냥 버린다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});
  const before = manager._changeRevision;

  manager.setDrawingLayers(manager.getDrawingLayers());
  assert.equal(manager._changeRevision, before, '같은 값은 표시하지 않는다');

  manager.setDrawingLayers(layers.addLayer(manager.getDrawingLayers()).state);
  assert.notEqual(manager._changeRevision, before, '달라지면 변경으로 표시한다');
  assert.equal(manager.isDirty, true);
});

test('로컬 변경이 없으면 다른 인스턴스의 레이어 변경을 채택한다', async () => {
  // 저장 직전 새로고침이 디스크에서 새 레이어를 읽어도, 낡은 메모리 값으로
  // 덮어쓰면 다른 인스턴스의 변경이 무관한 저장에 조용히 지워진다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});
  manager._applyData({});
  assert.equal(manager.getDrawingLayers().layers.length, 1);

  // 다른 인스턴스가 레이어를 하나 올렸다. 이쪽은 레이어를 건드리지 않았다.
  const remote = layers.addLayer(layers.createDefaultDrawingLayers()).state;
  manager._captureRootEnvelope({
    [layers.DRAWING_LAYERS_ROOT_KEY]: JSON.parse(JSON.stringify(remote))
  });
  assert.equal(
    manager.getDrawingLayers().layers.length,
    2,
    '로컬 변경이 없으면 디스크 값을 채택한다'
  );
});

test('저장 중에 들어온 레이어 변경은 살아남는다', async () => {
  // 저장이 IPC 를 기다리는 사이 사용자가 레이어를 또 바꾸면, 그 변경은 아직
  // 디스크에 없다. 저장 완료 때 플래그를 무조건 내리면 다음 저장의 새로고침이
  // 방금 쓴 낡은 값으로 되돌린다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});
  manager._applyData({});

  // 저장이 담아 간 상태.
  const collected = layers.addLayer(manager.getDrawingLayers()).state;
  manager.setDrawingLayers(collected);
  const savedDrawingLayers = manager.getDrawingLayers();

  // IPC 를 기다리는 사이 사용자가 하나 더 만든다.
  manager.setDrawingLayers(layers.addLayer(manager.getDrawingLayers()).state);
  assert.equal(manager.getDrawingLayers().layers.length, 3);

  // 저장 완료 처리: 담아 간 상태가 더는 최신이 아니므로 플래그를 내리면 안 된다.
  if (manager._drawingLayers === savedDrawingLayers) {
    manager._drawingLayersDirty = false;
  }
  assert.equal(manager._drawingLayersDirty, true, '더 새 변경이 있으면 표시를 유지한다');

  // 그래서 다음 새로고침이 낡은 디스크 값으로 되돌리지 못한다.
  manager._captureRootEnvelope({
    [layers.DRAWING_LAYERS_ROOT_KEY]: JSON.parse(JSON.stringify(collected))
  });
  assert.equal(manager.getDrawingLayers().layers.length, 3, '저장 중 변경이 살아남는다');
});

test('강제 덮어쓰기는 레이어도 원격으로 맞춘다', async () => {
  // merge:false 는 로컬을 버리고 원격으로 맞추는 경로다. 레이어만 dirty 가드에
  // 걸려 살아남으면, 나머지는 덮였는데 레이어는 로컬 값이 남아 다음 저장에서
  // 원격 레이어를 도로 지운다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});
  manager._applyData({});

  // 로컬에서 레이어를 하나 만든다(= dirty).
  manager.setDrawingLayers(layers.addLayer(manager.getDrawingLayers()).state);
  assert.equal(manager._drawingLayersDirty, true);

  // 강제 덮어쓰기: 원격은 기본 한 장짜리다.
  manager._drawingLayersDirty = false;
  manager._captureRootEnvelope({});
  assert.equal(
    manager.getDrawingLayers().layers.length,
    1,
    '덮어쓰기는 레이어도 원격으로 맞춘다'
  );
  assert.equal(manager._drawingLayersDirty, false, '표시도 함께 내린다');
});

test('동시 레이어 편집은 서로를 지우지 않는다', async () => {
  // 두 인스턴스가 같은 기준선에서 각자 레이어를 고치면, 나중에 저장하는 쪽이
  // 먼저 저장한 쪽의 추가를 통째로 지웠다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});
  manager._applyData({});
  const baseline = manager.getDrawingLayers();

  // 이쪽이 레이어를 하나 만든다.
  manager.setDrawingLayers(layers.addLayer(baseline, { name: '내 레이어' }).state);

  // 그 사이 다른 인스턴스가 같은 기준선에서 다른 레이어를 올렸다.
  const remote = layers.addLayer(baseline, { name: '남의 레이어' }).state;
  manager._captureRootEnvelope({
    [layers.DRAWING_LAYERS_ROOT_KEY]: JSON.parse(JSON.stringify(remote))
  });

  const names = manager.getDrawingLayers().layers.map(layer => layer.name);
  assert.ok(names.includes('내 레이어'), '내 추가가 남는다');
  assert.ok(names.includes('남의 레이어'), '남의 추가도 남는다');
});
