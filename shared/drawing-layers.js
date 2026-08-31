/**
 * 파일럿 드로잉 레이어 모델 단일 소스.
 *
 * ## 왜 drawingsV3 밖에 두는가
 *
 * `drawingsV3` 의 레코드·키프레임은 3계층(스토어·런타임·호스트)이 각각
 * **exact-keys** 로 검증한다. 필드를 하나라도 늘리면 구버전 앱이 파일을 통째로
 * 거부한다(`docs/drawing-keyframe-features.md` §4.5).
 *
 * 대신 `.bframe` **최상위**는 앱이 모르는 필드를 opaque 데이터로 보존한다
 * (`shared/bframe-root-envelope.js`, 2026-07-23 도입). `drawingsV3` 자체가 그
 * 경로로 살아남고 있다. 그래서 레이어를 형제 루트 키 `drawingLayersV1` 에 두면
 * **드로잉 스키마를 건드리지 않고** 레이어를 표현할 수 있고, 그 브리지를 가진
 * 버전끼리는 왕복해도 레이어가 보존된다.
 *
 * ## 구조
 *
 *   {
 *     version: 1,
 *     layers: [{ id, name, visible, locked, color }],   // 배열 순서 = 위→아래
 *     activeLayerId: '<id>',
 *     baseLayerId: '<id>',
 *     assignments: { '<objectId>': '<layerId>' }
 *   }
 *
 * `assignments` 에 없는 오브젝트는 **기준 레이어**(`baseLayerId`)에 속한다.
 * 그래서 레이어 정보가 없는 기존 파일도 마이그레이션 없이 그대로 열린다 —
 * 모든 획이 기본 레이어다.
 *
 * 기준을 "배열의 첫 레이어" 로 두면 안 된다. 새 레이어를 맨 위에 넣는 순간
 * 배정 없는 기존 그림이 통째로 **새 빈 레이어로 옮겨간다.** 기준은 레이어를
 * 넣고 옮겨도 흔들리지 않아야 한다.
 */

const DRAWING_LAYERS_ROOT_KEY = 'drawingLayersV1';
const DRAWING_LAYERS_VERSION = 1;
const MAX_DRAWING_LAYERS = 64;
const MAX_LAYER_NAME_LENGTH = 120;
const MAX_LAYER_ID_LENGTH = 128;
// 레이어마다 다른 색을 돌려 쓴다. 타임라인 행을 눈으로 구분하는 유일한 단서다.
const LAYER_COLORS = Object.freeze([
  '#4f8ef7', '#ff4757', '#ffa502', '#2ed573',
  '#a55eea', '#00d2d3', '#ff6b81', '#ffd32a'
]);
const DEFAULT_LAYER_NAME = '드로잉 1';

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLayerId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_LAYER_ID_LENGTH;
}

function normalizeName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, MAX_LAYER_NAME_LENGTH);
}

function normalizeColor(value, index) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toLowerCase()
    : LAYER_COLORS[index % LAYER_COLORS.length];
}

function makeLayer(options = {}, index = 0) {
  return {
    id: isLayerId(options.id) ? options.id : `drawing-layer-${index + 1}`,
    name: normalizeName(options.name, `드로잉 ${index + 1}`),
    // 저장된 값이 boolean 이 아니면 **보이고 잠기지 않은 쪽**이 안전한 기본이다.
    // 반대로 두면 파일이 조금 상했을 때 그림이 통째로 사라진 것처럼 보인다.
    visible: options.visible !== false,
    locked: options.locked === true,
    color: normalizeColor(options.color, index)
  };
}

function createDefaultDrawingLayers() {
  const layer = makeLayer({ name: DEFAULT_LAYER_NAME }, 0);
  return {
    version: DRAWING_LAYERS_VERSION,
    layers: [layer],
    activeLayerId: layer.id,
    baseLayerId: layer.id,
    assignments: {}
  };
}

/**
 * `.bframe` 루트에서 읽은 값을 정규화한다.
 *
 * 무엇이 들어와도 **쓸 수 있는 상태**를 돌려준다. 레이어 정보는 그림 자체가
 * 아니라 그림을 묶는 부가 정보이므로, 조금 상했다고 파일을 거부하면 사용자가
 * 그림을 통째로 잃는다. 알아볼 수 없는 부분만 버린다.
 */
function normalizeDrawingLayers(value) {
  if (!isPlainRecord(value) || value.version !== DRAWING_LAYERS_VERSION) {
    return createDefaultDrawingLayers();
  }
  const seenIds = new Set();
  const layers = [];
  for (const candidate of Array.isArray(value.layers) ? value.layers : []) {
    if (layers.length >= MAX_DRAWING_LAYERS) break;
    if (!isPlainRecord(candidate) || !isLayerId(candidate.id) || seenIds.has(candidate.id)) {
      continue;
    }
    seenIds.add(candidate.id);
    layers.push(makeLayer(candidate, layers.length));
  }
  if (layers.length === 0) return createDefaultDrawingLayers();

  const assignments = {};
  if (isPlainRecord(value.assignments)) {
    for (const [objectId, layerId] of Object.entries(value.assignments)) {
      // 사라진 레이어를 가리키는 배정은 버린다 — 그러면 그 오브젝트는 규칙대로
      // 첫 레이어로 돌아간다. 남겨 두면 어느 레이어에도 없는 유령이 된다.
      if (isLayerId(objectId) && seenIds.has(layerId)) assignments[objectId] = layerId;
    }
  }
  return {
    version: DRAWING_LAYERS_VERSION,
    layers,
    activeLayerId: seenIds.has(value.activeLayerId) ? value.activeLayerId : layers[0].id,
    // 기준이 사라졌으면 **맨 아래** 레이어를 기준으로 삼는다. 배정 없는 그림은
    // 원래 가장 오래된 것이므로 아래쪽이 자연스럽고, 위에 새로 넣은 레이어로
    // 딸려 올라가지 않는다.
    baseLayerId: seenIds.has(value.baseLayerId)
      ? value.baseLayerId
      : layers[layers.length - 1].id,
    assignments
  };
}

/** 오브젝트가 속한 레이어 id. 배정이 없으면 첫 레이어다. */
function layerIdForObject(state, objectId) {
  const assigned = state?.assignments?.[objectId];
  if (isLayerId(assigned) && state.layers.some(layer => layer.id === assigned)) return assigned;
  return state?.baseLayerId ?? state?.layers?.[0]?.id ?? null;
}

function findLayer(state, layerId) {
  return state?.layers?.find(layer => layer.id === layerId) || null;
}

/** 화면에 보여야 하는 오브젝트인가. 숨긴 레이어의 것은 그리지 않는다. */
function isObjectVisible(state, objectId) {
  const layer = findLayer(state, layerIdForObject(state, objectId));
  return layer ? layer.visible !== false : true;
}

/** 편집할 수 있는 오브젝트인가. 잠긴 레이어의 것은 고르지도 지우지도 못한다. */
function isObjectEditable(state, objectId) {
  const layer = findLayer(state, layerIdForObject(state, objectId));
  if (!layer) return true;
  return layer.visible !== false && layer.locked !== true;
}

/**
 * 저장할 값. 기본 상태 그대로면 `undefined` 를 돌려 루트에 키를 만들지 않는다 —
 * 레이어를 쓰지 않은 파일에 빈 구조를 심어 diff 를 늘릴 이유가 없다.
 */
function serializeDrawingLayers(state) {
  const normalized = normalizeDrawingLayers(state);
  if (normalized.layers.length !== 1 || Object.keys(normalized.assignments).length !== 0) {
    return normalized;
  }
  // **레이어 필드를 전부 비교해야 한다.** 이름·색·id 만 다른 한 장짜리 상태를
  // 기본으로 판정하면 저장 때 키가 지워지고, 다시 열 때 '드로잉 1' 기본값으로
  // 되돌아가 사용자가 붙인 이름과 색이 사라진다.
  const [layer] = normalized.layers;
  const [reference] = createDefaultDrawingLayers().layers;
  const isDefault = Object.keys(reference)
    .every(field => layer[field] === reference[field]);
  return isDefault ? undefined : normalized;
}


// ── 변이 ────────────────────────────────────────────────────────────────────
// 전부 **순수 함수**다. 새 상태를 돌려주고 입력을 건드리지 않는다. 오브젝트를
// 실제로 지우는 것은 오버레이 스토어의 일이므로, 지워야 할 id 만 함께 돌려준다.

function withLayers(state, layers, activeLayerId, assignments, baseLayerId) {
  return normalizeDrawingLayers({
    version: DRAWING_LAYERS_VERSION,
    layers,
    activeLayerId,
    baseLayerId: baseLayerId || state.baseLayerId,
    assignments: assignments || state.assignments
  });
}

function allocateLayerId(state) {
  const used = new Set(state.layers.map(layer => layer.id));
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid && !used.has(`drawing-layer-${uuid}`)) return `drawing-layer-${uuid}`;
  let ordinal = state.layers.length + 1;
  while (used.has(`drawing-layer-${ordinal}`)) ordinal += 1;
  return `drawing-layer-${ordinal}`;
}

/** 활성 레이어 **위에** 새 레이어를 넣고 활성으로 삼는다(레거시와 같다). */
function addLayer(state, options = {}) {
  const current = normalizeDrawingLayers(state);
  if (current.layers.length >= MAX_DRAWING_LAYERS) {
    return { state: current, added: null, reason: 'layer-limit-reached' };
  }
  const index = current.layers.findIndex(layer => layer.id === current.activeLayerId);
  const ordinal = current.layers.length;
  const layer = makeLayer({
    ...options,
    // **개수에서 id 를 유도하면 안 된다.** 셋 만들고 하나 지운 뒤 또 만들면
    // 살아남은 레이어와 같은 id 가 나오고, 정규화가 중복을 버려 개수가 늘지
    // 않으면서 기존 레이어의 메타데이터만 덮어쓴다. 그런데도 "추가됨" 으로
    // 보고된다. 쓰이지 않는 id 를 찾을 때까지 센다.
    id: isLayerId(options.id) ? options.id : allocateLayerId(current),
    name: normalizeName(options.name, `드로잉 ${ordinal + 1}`)
  }, ordinal);
  const layers = [...current.layers];
  layers.splice(index < 0 ? layers.length : index, 0, layer);
  return { state: withLayers(current, layers, layer.id), added: layer, reason: null };
}

/**
 * 레이어와 **그 위의 오브젝트**를 함께 없앤다. 마지막 하나는 지우지 않는다 —
 * 레이어가 없으면 새 획을 어디에도 놓을 수 없다.
 *
 * 오브젝트 배정은 암묵적일 수 있으므로(배정이 없으면 첫 레이어) 문서의 전체
 * 오브젝트 id 를 받아 판정한다. 모델만으로는 첫 레이어의 오브젝트를 셀 수 없다.
 */
function deleteLayer(state, layerId, allObjectIds = []) {
  const current = normalizeDrawingLayers(state);
  if (current.layers.length <= 1) {
    return { state: current, removedObjectIds: [], reason: 'last-layer' };
  }
  if (!findLayer(current, layerId)) {
    return { state: current, removedObjectIds: [], reason: 'unknown-layer' };
  }
  const removedObjectIds = [...allObjectIds]
    .filter(objectId => layerIdForObject(current, objectId) === layerId);
  const layers = current.layers.filter(layer => layer.id !== layerId);
  const assignments = {};
  for (const [objectId, assigned] of Object.entries(current.assignments)) {
    if (assigned !== layerId) assignments[objectId] = assigned;
  }
  const activeLayerId = current.activeLayerId === layerId
    ? layers[0].id
    : current.activeLayerId;
  // 기준 레이어를 지우면 남은 맨 아래를 새 기준으로 삼는다. 그 레이어의
  // 오브젝트는 위에서 함께 지웠으므로 배정 없는 것이 새로 생기지 않는다.
  const baseLayerId = current.baseLayerId === layerId
    ? layers[layers.length - 1].id
    : current.baseLayerId;
  return {
    state: withLayers(current, layers, activeLayerId, assignments, baseLayerId),
    removedObjectIds,
    reason: null
  };
}

/** 활성 레이어를 위(-1)/아래(+1)로 옮긴다. 끝에서는 그대로 둔다. */
function selectLayerByOffset(state, offset) {
  const current = normalizeDrawingLayers(state);
  const index = current.layers.findIndex(layer => layer.id === current.activeLayerId);
  const next = Math.max(0, Math.min(current.layers.length - 1, index + offset));
  return withLayers(current, current.layers, current.layers[next].id);
}

/** 활성 레이어 자체를 위(-1)/아래(+1)로 옮긴다. 끝에서는 그대로 둔다. */
function moveLayerByOffset(state, offset) {
  const current = normalizeDrawingLayers(state);
  const index = current.layers.findIndex(layer => layer.id === current.activeLayerId);
  if (index < 0) return current;
  const next = index + offset;
  if (next < 0 || next >= current.layers.length) return current;
  const layers = [...current.layers];
  const [moved] = layers.splice(index, 1);
  layers.splice(next, 0, moved);
  return withLayers(current, layers, moved.id);
}

function toggleLayerFlag(state, layerId, flag) {
  const current = normalizeDrawingLayers(state);
  if (!findLayer(current, layerId)) return current;
  const layers = current.layers.map(layer => (
    layer.id === layerId ? { ...layer, [flag]: layer[flag] !== true } : layer
  ));
  return withLayers(current, layers, current.activeLayerId);
}

function toggleLayerVisibility(state, layerId) {
  const current = normalizeDrawingLayers(state);
  const layer = findLayer(current, layerId);
  if (!layer) return current;
  const layers = current.layers.map(candidate => (
    candidate.id === layerId ? { ...candidate, visible: layer.visible === false } : candidate
  ));
  return withLayers(current, layers, current.activeLayerId);
}

function toggleLayerLock(state, layerId) {
  return toggleLayerFlag(state, layerId, 'locked');
}

/** 새 획을 활성 레이어에 붙인다. 첫 레이어면 배정을 남기지 않는다(기본값이므로). */
function assignObject(state, objectId, layerId) {
  const current = normalizeDrawingLayers(state);
  if (!isLayerId(objectId) || !findLayer(current, layerId)) return current;
  const assignments = { ...current.assignments };
  if (layerId === current.baseLayerId) delete assignments[objectId];
  else assignments[objectId] = layerId;
  return withLayers(current, current.layers, current.activeLayerId, assignments);
}

/** 사라진 오브젝트의 배정을 걷어낸다. 남겨 두면 저장 파일이 계속 자란다. */
function pruneAssignments(state, liveObjectIds) {
  const current = normalizeDrawingLayers(state);
  const live = new Set(liveObjectIds);
  const assignments = {};
  for (const [objectId, layerId] of Object.entries(current.assignments)) {
    if (live.has(objectId)) assignments[objectId] = layerId;
  }
  return withLayers(current, current.layers, current.activeLayerId, assignments);
}

export {
  DEFAULT_LAYER_NAME,
  addLayer,
  assignObject,
  deleteLayer,
  moveLayerByOffset,
  pruneAssignments,
  selectLayerByOffset,
  toggleLayerLock,
  toggleLayerVisibility,
  DRAWING_LAYERS_ROOT_KEY,
  DRAWING_LAYERS_VERSION,
  LAYER_COLORS,
  MAX_DRAWING_LAYERS,
  createDefaultDrawingLayers,
  findLayer,
  isObjectEditable,
  isObjectVisible,
  layerIdForObject,
  makeLayer,
  normalizeDrawingLayers,
  serializeDrawingLayers
};
