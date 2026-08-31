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

  let scheduled = 0;
  manager._scheduleAutoSave = () => { scheduled += 1; };
  manager.autoSaveEnabled = true;
  manager.setDrawingLayers(layers.addLayer(manager.getDrawingLayers()).state);
  assert.notEqual(manager._changeRevision, before, '달라지면 변경으로 표시한다');
  assert.equal(manager.isDirty, true);
  // 자동 저장 타이머까지 잡아야 사용자가 따로 저장하지 않아도 디스크에 닿는다.
  assert.equal(scheduled, 1, '레이어만 바꿔도 자동 저장을 예약한다');
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

test('병합으로 흡수한 원격 값이 새 기준선이 된다', async () => {
  // 저장이 지연·실패한 뒤 다음 병합이 흡수한 원격 값을 "내 편집" 으로 오인하면,
  // 그 사이 올라온 더 새 원격 변경을 덮어쓴다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});
  manager._applyData({});
  const baseline = manager.getDrawingLayers();
  const baseId = baseline.layers[0].id;

  // 이쪽은 레이어를 하나 추가한다(= dirty).
  manager.setDrawingLayers(layers.addLayer(baseline, { name: '내 레이어' }).state);

  // 원격 R1: 기준 레이어의 이름을 바꿨다.
  const r1 = layers.normalizeDrawingLayers({
    ...baseline,
    layers: [{ ...baseline.layers[0], name: 'R1' }]
  });
  manager._captureRootEnvelope({
    [layers.DRAWING_LAYERS_ROOT_KEY]: JSON.parse(JSON.stringify(r1))
  });
  assert.equal(layers.findLayer(manager.getDrawingLayers(), baseId).name, 'R1');

  // 저장이 지연됐고, 그 사이 원격 R2 가 같은 레이어를 또 바꿨다.
  const r2 = layers.normalizeDrawingLayers({
    ...baseline,
    layers: [{ ...baseline.layers[0], name: 'R2' }]
  });
  manager._captureRootEnvelope({
    [layers.DRAWING_LAYERS_ROOT_KEY]: JSON.parse(JSON.stringify(r2))
  });
  assert.equal(
    layers.findLayer(manager.getDrawingLayers(), baseId).name,
    'R2',
    '더 새 원격 변경을 덮어쓰지 않는다'
  );
  assert.ok(
    manager.getDrawingLayers().layers.some(layer => layer.name === '내 레이어'),
    '내 추가는 그대로 남는다'
  );
});

test('기준선은 IPC 쓰기가 성공할 때마다 즉시 전진한다', async () => {
  // 쓰기가 끝난 뒤에도 재시도로 빠지는 경로가 있다(fabric-drawing-authority-changed).
  // 루프 밖에서만 기준선을 옮기면 그 경로가 낡은 기준선으로 다음 병합을 하고,
  // 이 쓰기가 흡수한 원격 변경이 "내 편집" 으로 오인돼 더 새 원격 값을 덮어쓴다.
  //
  // 실행 경로 전체를 재현하기 어려우므로 배선 자체를 고정한다.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const source = fs.readFileSync(
    path.join(process.cwd(), 'renderer/scripts/modules/review-data-manager.js'),
    'utf8'
  );
  const writeSucceeded = source.indexOf('this._reviewDocumentIdPersisted = true;');
  assert.ok(writeSucceeded > 0, '쓰기 성공 지점을 찾지 못했다');
  // IPC 가 성공을 보고하는 지점 직후여야 한다. 그 아래에는 쓰기가 끝난 뒤에도
  // 던지거나 재시도로 빠지는 경로가 여럿 있다(관측 충돌·Fabric 권위 변경).
  const ipcReturned = source.indexOf('const saveResult = await window.electronAPI.saveReview(');
  assert.ok(ipcReturned > 0 && ipcReturned < writeSucceeded, 'IPC 호출 지점을 찾지 못했다');
  const advance = source.indexOf('this._drawingLayersBaseline = attemptDrawingLayers;');
  assert.ok(advance > ipcReturned, '기준선 전진이 IPC 뒤에 온다');
  assert.ok(
    advance < source.indexOf('review-file-version-conflict', ipcReturned),
    '관측 충돌 검사보다 **먼저** 기준선을 옮겨야 한다'
  );
  assert.ok(
    advance < source.indexOf('fabric-drawing-authority-changed', ipcReturned),
    'Fabric 권위 재시도보다 먼저 옮겨야 한다'
  );
});

test('덮어쓰기가 완전히 끝나기 전 실패는 로컬 레이어를 되돌린다', async () => {
  // 재조정만 감싸면 그 뒤의 _applyData 가 던질 때 복원이 건너뛰어져, 재로드는
  // 실패로 보고되는데 사용자의 미저장 레이어는 이미 사라진 뒤다.
  // 실행 경로를 통째로 재현하기 어려워 배선을 고정한다.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const source = fs.readFileSync(
    path.join(process.cwd(), 'renderer/scripts/modules/review-data-manager.js'),
    'utf8'
  );
  const reloadStart = source.indexOf('async reloadAndMerge(');
  const reload = source.slice(
    reloadStart,
    source.indexOf("log.info('reloadAndMerge: 데이터 덮어쓰기 완료')", reloadStart)
  );
  // catch 는 try 안에서 선언한 것을 볼 수 없다(TDZ). try 앞에서 잡아 둬야 한다.
  assert.ok(
    reload.indexOf('let restoreStagedLayers = () => {};') <
      reload.indexOf('try {'),
    'restoreStagedLayers 는 try 앞에서 선언돼야 한다'
  );
  // 덮어쓰기가 끝났으면 되돌리지 않는다.
  assert.ok(reload.includes('if (overwriteCompleted) return;'), '완료 후에는 되돌리지 않는다');
  assert.ok(
    source.includes('overwriteCompleted = true;'),
    '덮어쓰기 완료 지점에서 표시를 올린다'
  );
  // 바깥 catch 도 복원한다.
  const outerCatch = source.indexOf('} catch (error) {', source.indexOf('return { success: true, ...result };'));
  assert.ok(
    source.slice(outerCatch, outerCatch + 120).includes('restoreStagedLayers();'),
    '바깥 catch 에서도 되돌린다'
  );
});

test('레이어만 바꾼 것도 저장할 내용으로 센다', async () => {
  // .bframe 이 아직 없는 새 영상에서, 이걸 빼면 자동 저장 타이머가
  // hasUnsavedChanges 로 걸러지고 영상 전환 전 저장도 건너뛰어져 사용자의
  // 레이어 작업이 조용히 사라진다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});
  assert.equal(manager.hasSubstantiveContent(), false, '기본 상태는 내용이 없다');

  manager.setDrawingLayers(layers.addLayer(manager.getDrawingLayers(), { name: '새 레이어' }).state);
  assert.equal(manager.hasSubstantiveContent(), true, '레이어를 만들면 내용이 있다');
});

test('다룰 수 없는 판의 레이어 데이터는 손대지 않는다', async () => {
  // 앞으로 나올 판(version 2 등)을 정규화하면 기본값으로 접히고, 그 뒤 무관한
  // 저장이 키를 통째로 지워 미래 데이터가 사라진다. .bframe 루트가 모르는 필드를
  // 보존하려고 만들어졌는데 그 목적을 우리가 깨는 셈이다.
  const { ReviewDataManager, layers } = await loadModules();
  const manager = new ReviewDataManager({});
  const future = { version: 2, layers: [{ id: 'x' }], somethingNew: true };

  manager._applyData({ [layers.DRAWING_LAYERS_ROOT_KEY]: future });
  assert.equal(manager._drawingLayersUnsupported, true, '다룰 수 없는 판으로 표시한다');
  // 내용 판정에도 세지 않는다 — 우리 것이 아니다.
  assert.equal(manager.hasSubstantiveContent(), false);

  // 저장 payload 를 실제로 조립해 원본이 그대로 남는지 본다.
  const root = manager._collectData();
  assert.deepEqual(
    root[layers.DRAWING_LAYERS_ROOT_KEY],
    future,
    '지우지도 덮지도 않는다'
  );

  // 우리가 다룰 수 있는 판은 그대로 동작한다.
  manager._applyData({});
  assert.equal(manager._drawingLayersUnsupported, false);
});
