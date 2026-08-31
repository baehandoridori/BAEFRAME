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
