import test from 'node:test';
import assert from 'node:assert/strict';

// shared/drawing-layers.js 는 ESM 이다 — 이 모델을 쓰는 review-data-manager 가
// 브라우저 네이티브 ES 모듈이라 CommonJS 를 import 할 수 없기 때문이다.
import * as layers from '../../shared/drawing-layers.js';

const {
  DRAWING_LAYERS_ROOT_KEY,
  DRAWING_LAYERS_VERSION,
  MAX_DRAWING_LAYERS,
  addLayer,
  assignObject,
  createDefaultDrawingLayers,
  deleteLayer,
  isObjectEditable,
  isObjectVisible,
  layerIdForObject,
  moveLayerByOffset,
  normalizeDrawingLayers,
  pruneAssignments,
  selectLayerByOffset,
  serializeDrawingLayers,
  toggleLayerLock,
  toggleLayerVisibility
} = layers;

test('레이어를 모르는 파일은 마이그레이션 없이 기본 레이어 하나로 열린다', () => {
  // drawingsV3 는 손대지 않는다. 레이어가 없던 파일의 모든 획은 기준 레이어에 속한다.
  const state = normalizeDrawingLayers(undefined);
  assert.equal(state.version, DRAWING_LAYERS_VERSION);
  assert.equal(state.layers.length, 1);
  assert.equal(state.activeLayerId, state.layers[0].id);
  assert.equal(state.baseLayerId, state.layers[0].id);
  assert.deepEqual(state.assignments, {});
  assert.equal(layerIdForObject(state, '아무-오브젝트'), state.baseLayerId);

  // 저장할 때는 키 자체를 만들지 않는다 — 쓰지 않은 파일에 빈 구조를 심지 않는다.
  assert.equal(serializeDrawingLayers(state), undefined);
  assert.equal(DRAWING_LAYERS_ROOT_KEY, 'drawingLayersV1');
});

test('새 레이어를 맨 위에 넣어도 기존 그림이 딸려 올라가지 않는다', () => {
  // "배정 없음 = 배열의 첫 레이어" 로 두면 새 레이어를 위에 넣는 순간 배정 없는
  // 기존 그림이 통째로 새 빈 레이어로 옮겨간다. 기준은 흔들리지 않아야 한다.
  const base = createDefaultDrawingLayers();
  const baseId = base.baseLayerId;
  const { state, added } = addLayer(base);

  assert.equal(state.layers.length, 2);
  assert.equal(state.layers[0].id, added.id, '새 레이어가 활성 레이어 위에 온다');
  assert.equal(state.activeLayerId, added.id, '새 레이어가 활성이 된다');
  assert.equal(state.baseLayerId, baseId, '기준은 그대로다');
  assert.equal(
    layerIdForObject(state, '오래된-획'),
    baseId,
    '배정 없는 기존 그림은 기준 레이어에 남는다'
  );
});

test('레이어를 지우면 그 위의 그림만 함께 지운다', () => {
  const { state: two, added } = addLayer(createDefaultDrawingLayers());
  const assigned = assignObject(two, '새-획', added.id);
  assert.deepEqual(assigned.assignments, { '새-획': added.id });

  const removed = deleteLayer(assigned, added.id, ['오래된-획', '새-획']);
  assert.deepEqual(removed.removedObjectIds, ['새-획'], '그 레이어의 그림만 지운다');
  assert.equal(removed.state.layers.length, 1);
  assert.deepEqual(removed.state.assignments, {}, '배정도 함께 걷힌다');

  // 마지막 하나는 지우지 않는다 — 레이어가 없으면 새 획을 놓을 곳이 없다.
  const last = deleteLayer(removed.state, removed.state.layers[0].id, ['오래된-획']);
  assert.equal(last.reason, 'last-layer');
  assert.equal(last.state.layers.length, 1);
  assert.deepEqual(last.removedObjectIds, []);
});

test('기준 레이어를 지우면 남은 맨 아래가 새 기준이 된다', () => {
  const { state: two, added } = addLayer(createDefaultDrawingLayers());
  const baseId = two.baseLayerId;
  // 기준 레이어에는 배정 없는 그림이 있다. 지우면 그 그림도 함께 사라져야 한다.
  const removed = deleteLayer(two, baseId, ['오래된-획']);
  assert.deepEqual(removed.removedObjectIds, ['오래된-획']);
  assert.equal(removed.state.baseLayerId, added.id, '남은 레이어가 새 기준이다');
  assert.equal(removed.state.layers.length, 1);
});

test('선택과 이동은 끝에서 멈춘다', () => {
  const { state: two } = addLayer(createDefaultDrawingLayers());
  const [top, bottom] = two.layers;
  assert.equal(two.activeLayerId, top.id);

  assert.equal(selectLayerByOffset(two, -1).activeLayerId, top.id, '맨 위에서 더 못 올라간다');
  const down = selectLayerByOffset(two, 1);
  assert.equal(down.activeLayerId, bottom.id);
  assert.equal(selectLayerByOffset(down, 1).activeLayerId, bottom.id, '맨 아래에서 더 못 내려간다');

  // 활성 레이어 자체를 옮긴다.
  const moved = moveLayerByOffset(two, 1);
  assert.deepEqual(moved.layers.map(layer => layer.id), [bottom.id, top.id]);
  assert.equal(moved.activeLayerId, top.id, '옮겨도 활성은 그대로다');
  assert.equal(moveLayerByOffset(two, -1).layers[0].id, top.id, '맨 위에서는 그대로다');
});

test('숨김과 잠금이 그리기 판정을 바꾼다', () => {
  const { state: two, added } = addLayer(createDefaultDrawingLayers());
  const assigned = assignObject(two, '새-획', added.id);
  assert.equal(isObjectVisible(assigned, '새-획'), true);
  assert.equal(isObjectEditable(assigned, '새-획'), true);

  const hidden = toggleLayerVisibility(assigned, added.id);
  assert.equal(isObjectVisible(hidden, '새-획'), false, '숨긴 레이어의 그림은 그리지 않는다');
  assert.equal(isObjectEditable(hidden, '새-획'), false, '보이지 않는 것은 고를 수도 없다');
  assert.equal(isObjectVisible(hidden, '오래된-획'), true, '다른 레이어는 영향받지 않는다');

  const locked = toggleLayerLock(assigned, added.id);
  assert.equal(isObjectVisible(locked, '새-획'), true, '잠가도 보이기는 한다');
  assert.equal(isObjectEditable(locked, '새-획'), false, '잠긴 레이어의 그림은 편집 못 한다');
});

test('상한 게 파일은 거부하지 않고 알아볼 수 있는 만큼만 살린다', () => {
  // 레이어는 그림 자체가 아니라 그림을 묶는 부가 정보다. 조금 상했다고 파일을
  // 거부하면 사용자가 그림을 통째로 잃는다.
  const state = normalizeDrawingLayers({
    version: DRAWING_LAYERS_VERSION,
    layers: [
      { id: 'a', name: '  ', visible: 'yes', locked: 'no', color: 'not-a-color' },
      { id: 'a', name: '중복 id' },
      { name: 'id 없음' },
      null,
      { id: 'b', name: '정상', visible: false, locked: true, color: '#ABCDEF' }
    ],
    activeLayerId: '없는-레이어',
    baseLayerId: '없는-레이어',
    assignments: { 'obj-1': 'b', 'obj-2': '사라진-레이어', 'obj-3': 'a' }
  });

  assert.deepEqual(state.layers.map(layer => layer.id), ['a', 'b'], '중복·불량 항목만 버린다');
  assert.equal(state.layers[0].name, '드로잉 1', '빈 이름은 기본 이름으로');
  assert.equal(state.layers[0].visible, true, 'boolean 이 아니면 보이는 쪽이 기본');
  assert.equal(state.layers[0].locked, false, 'boolean 이 아니면 안 잠긴 쪽이 기본');
  assert.match(state.layers[0].color, /^#[0-9a-f]{6}$/, '색은 항상 유효한 값이 된다');
  assert.equal(state.layers[1].color, '#abcdef', '유효한 색은 소문자로 보존된다');
  assert.equal(state.activeLayerId, 'a', '없는 활성은 첫 레이어로');
  assert.equal(state.baseLayerId, 'b', '없는 기준은 맨 아래로');
  assert.deepEqual(
    state.assignments,
    { 'obj-1': 'b', 'obj-3': 'a' },
    '사라진 레이어를 가리키는 배정은 버린다'
  );
});

test('레이어 수에 상한이 있고 사라진 배정은 걷어낸다', () => {
  let state = createDefaultDrawingLayers();
  for (let index = 0; index < MAX_DRAWING_LAYERS + 5; index += 1) {
    state = addLayer(state).state;
  }
  assert.equal(state.layers.length, MAX_DRAWING_LAYERS);
  assert.equal(addLayer(state).reason, 'layer-limit-reached');

  const withGhost = assignObject(state, '사라진-획', state.layers[0].id);
  assert.ok(Object.hasOwn(withGhost.assignments, '사라진-획'));
  // 남겨 두면 저장 파일이 계속 자란다.
  const pruned = pruneAssignments(withGhost, ['살아있는-획']);
  assert.deepEqual(pruned.assignments, {});
});

test('저장한 값을 다시 읽으면 같은 상태가 된다', () => {
  const { state: two, added } = addLayer(createDefaultDrawingLayers());
  const assigned = assignObject(toggleLayerLock(two, added.id), '새-획', added.id);
  const serialized = serializeDrawingLayers(assigned);
  assert.ok(serialized, '기본 상태가 아니면 저장한다');
  // JSON 을 거쳐도 같아야 한다 — .bframe 은 JSON 파일이다.
  assert.deepEqual(normalizeDrawingLayers(JSON.parse(JSON.stringify(serialized))), assigned);
});

test('레이어 id 는 개수에서 유도하지 않는다', () => {
  // 셋 만들고 하나 지운 뒤 또 만들면, 개수로 id 를 지으면 살아남은 레이어와
  // 같은 id 가 나온다. 정규화가 중복을 버려 **개수가 늘지 않으면서** 기존
  // 레이어의 메타데이터만 덮어쓰는데도 "추가됨" 으로 보고된다.
  let state = createDefaultDrawingLayers();
  const created = [];
  for (let index = 0; index < 3; index += 1) {
    const result = addLayer(state);
    state = result.state;
    created.push(result.added.id);
  }
  assert.equal(state.layers.length, 4);

  const removed = deleteLayer(state, created[0], []);
  assert.equal(removed.state.layers.length, 3);

  const again = addLayer(removed.state);
  assert.ok(again.added, '추가에 성공한다');
  assert.equal(again.state.layers.length, 4, '개수가 실제로 늘어난다');
  assert.equal(
    new Set(again.state.layers.map(layer => layer.id)).size,
    4,
    'id 가 겹치지 않는다'
  );
});

test('이름·색만 다른 한 장짜리 상태도 저장한다', () => {
  // 기본 판정이 visible/locked 만 보면, 이름과 색을 붙인 한 장짜리 문서가
  // 저장 때 키째 지워지고 다시 열 때 기본값으로 되돌아간다.
  const base = createDefaultDrawingLayers();
  const renamed = normalizeDrawingLayers({
    ...base,
    layers: [{ ...base.layers[0], name: '배경', color: '#ff4757' }]
  });
  const serialized = serializeDrawingLayers(renamed);
  assert.ok(serialized, '기본값과 다르면 저장한다');
  assert.equal(serialized.layers[0].name, '배경');
  assert.equal(serialized.layers[0].color, '#ff4757');

  // 진짜 기본 상태는 여전히 저장하지 않는다.
  assert.equal(serializeDrawingLayers(base), undefined);
});

test('오브젝트 id 는 레이어 id 한도로 재지 않는다', () => {
  // 드로잉 레코드 id 는 512자까지 허용된다. 레이어 id 한도(128)로 재면 긴 id 를
  // 가진 정상 오브젝트의 배정이 정규화에서 버려져, 다시 열 때 기준 레이어로
  // 되돌아간다 — 사용자가 나눠 둔 레이어가 조용히 풀린다.
  const { state: two, added } = addLayer(createDefaultDrawingLayers());
  const longId = 'o'.repeat(400);
  const assigned = assignObject(two, longId, added.id);
  assert.equal(assigned.assignments[longId], added.id, '400자 id 도 배정된다');
  assert.equal(layerIdForObject(assigned, longId), added.id);

  // JSON 왕복 후에도 유지된다.
  const round = normalizeDrawingLayers(JSON.parse(JSON.stringify(assigned)));
  assert.equal(layerIdForObject(round, longId), added.id, '다시 열어도 그 레이어에 남는다');
});

test('호출자가 준 중복 id 는 새 id 로 갈아 끼운다', () => {
  // 그대로 받으면 정규화가 기존 레이어를 버리고 새 것을 남기면서도 "추가됨" 으로
  // 보고해, 멀쩡한 레이어가 메타데이터째 사라진다.
  const base = createDefaultDrawingLayers();
  const existingId = base.layers[0].id;
  const result = addLayer(base, { id: existingId, name: '중복 시도' });

  assert.ok(result.added, '추가에 성공한다');
  assert.equal(result.state.layers.length, 2, '기존 레이어를 잡아먹지 않는다');
  assert.notEqual(result.added.id, existingId, '새 id 를 받는다');
  assert.ok(
    result.state.layers.some(layer => layer.id === existingId),
    '기존 레이어가 그대로 남는다'
  );
});
