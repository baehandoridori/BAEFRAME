/**
 * 합성 레이어의 파일 동기화 규칙 단일 소스.
 *
 * ## 왜 필요한가
 *
 * 합성 레이어는 실시간 전송(Broadcast)이 없고 `.bframe` 파일로만 오간다. 같은 파일을 여러
 * PC 가 각자 저장하고 구글 드라이브는 마지막 업로드를 남기므로, 디스크의 파일이 내 화면보다
 * **옛 사본**인 일이 흔하다. 기준·로컬·원격을 견주는 세 갈래 병합만으로는 그 사본을 가릴 수
 * 없다 — 레이어는 지우면 레코드가 사라질 뿐이라 "파일에 없다" 가 삭제인지 그 레이어가 생기기
 * 전의 사본인지 알 수 없고, 레코드에 수정 시각이 없어 "예전 값으로 돌아갔다" 가 되돌리기인지
 * 옛 사본인지도 알 수 없다. 그 결과 레이어가 조용히 사라지거나 `(로컬 충돌)` 사본으로 바뀌었고,
 * 그 뒤로는 고칠 때마다 사본이 하나씩 늘었다(2026-11-18, DEVLOG 참고).
 *
 * ## 무엇을 더하는가
 *
 * 레이어마다 **수정 횟수(rev)** 와, 지운 레이어의 **삭제 표시**를 둔다. 수정 횟수는 PC 시계가
 * 아니라 "그 레이어를 몇 번 고쳤는가" 이므로 PC 사이의 시계 차이와 무관하다.
 *
 *   - 수정 횟수가 큰 쪽이 나중 상태다. 옛 사본은 수정 횟수가 작으므로 받아들이지 않는다.
 *   - 파일에 레이어가 없으면: 삭제 표시가 있을 때만 삭제다. 없으면 그 레이어를 모르는 사본이다.
 *   - 예전과 똑같은 내용으로 되돌려도(Ctrl+Z) 수정 횟수는 올라가므로 새 수정으로 전해진다.
 *
 * 순서는 어느 PC 에서 계산해도 같다. 그래서 두 PC 가 서로의 저장분을 옛 사본으로 보고 번갈아
 * 덮어쓰는 일이 없고, 화면으로 받아들일 때와 파일에 쓸 때 같은 판정을 쓴다.
 *
 * ## 어디에 두는가
 *
 * `compositionLayers` 의 레코드에는 칸을 더하지 않는다. 이전 버전은 레코드를 정해진 칸만으로
 * 다시 쓰므로, 모르는 칸이 있으면 손대지 않은 레이어까지 "내가 고쳤다" 로 읽어 충돌 사본을
 * 만든다. 대신 `.bframe` 최상위의 형제 키 `compositionLayerSyncV1` 에 둔다 — 최상위의 모르는
 * 키는 이전 버전도 읽은 그대로 다시 쓴다(`shared/bframe-root-envelope.js`).
 *
 *   {
 *     version: 1,
 *     layers: {
 *       '<레이어 id>': { rev: 3 },
 *       '<지운 레이어 id>': { rev: 4, deleted: true, deletedAt: '<ISO 시각>' }
 *     },
 *     orderRev: 2          // 레이어 순서를 바꾼 횟수
 *   }
 *
 * 한 번도 고치지 않은 레이어(rev 0)는 적지 않는다. 적을 것이 없으면 키 자체를 만들지 않는다.
 */

const COMPOSITION_LAYER_SYNC_ROOT_KEY = 'compositionLayerSyncV1';
const COMPOSITION_LAYER_SYNC_VERSION = 1;
// 삭제 표시는 작지만(하나에 100바이트 남짓) 끝없이 쌓이지 않게 최근 것만 둔다.
const MAX_COMPOSITION_LAYER_TOMBSTONES = 512;

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// 길이로 거르지 않는다. 걸러진 레이어는 병합에서 빠져 파일에서 사라진다.
function isLayerId(value) {
  return typeof value === 'string' && value.length > 0;
}

// 레코드의 id. 매니저(normalizeCompositionLayer)와 같은 규칙이어야 한다 — 매니저는 거짓으로
// 읽히는 id(없음, 0, false, 빈 글자)에 읽을 때마다 새 id 를 붙인다. 그런 레코드를 여기서
// 제 id 로 받으면 "화면에서 사라진 레이어" 와 "파일에만 있는 레이어" 가 읽을 때마다 새로
// 생겨 레이어가 끝없이 는다. id 가 없는 레코드로 본다.
function layerIdOf(record) {
  return isPlainRecord(record) && record.id ? String(record.id) : '';
}

// 다음 수정 횟수. 안전한 정수의 끝을 넘기면 읽는 쪽이 값을 버려(수정 횟수 0) 옛 사본에 진다.
function nextRevision(floor) {
  return Math.min(floor + 1, Number.MAX_SAFE_INTEGER);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = canonicalize(value[key]);
  }
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * 이 앱이 다룰 수 있는 판인가. 앞으로 나올 판을 정규화하면 빈 값으로 접히고 그 뒤의 저장이
 * 키를 덮어써 미래 데이터가 사라진다. 다룰 수 없는 판은 건드리지 않고 그대로 둔다.
 */
function isSupportedCompositionLayerSync(value) {
  if (!isPlainRecord(value)) return true;
  const version = Number(value.version);
  return !Number.isFinite(version) || version <= COMPOSITION_LAYER_SYNC_VERSION;
}

/**
 * `.bframe` 루트에서 읽은 값을 정규화한다. 무엇이 들어와도 쓸 수 있는 값을 돌려준다 —
 * 알아볼 수 없는 부분은 "아는 것이 없다" 로 읽는다(수정 횟수 0, 삭제 표시 없음).
 *
 * @returns {{ layers: Map<string, {rev: number, deleted: boolean, deletedAt?: string|null}>, orderRev: number }}
 */
function normalizeCompositionLayerSync(value) {
  const layers = new Map();
  let orderRev = 0;
  if (isPlainRecord(value) && value.version === COMPOSITION_LAYER_SYNC_VERSION) {
    if (isRevision(value.orderRev)) orderRev = value.orderRev;
    if (isPlainRecord(value.layers)) {
      for (const [id, entry] of Object.entries(value.layers)) {
        if (!isLayerId(id) || !isPlainRecord(entry) || !isRevision(entry.rev)) continue;
        layers.set(id, entry.deleted === true
          ? {
            rev: entry.rev,
            deleted: true,
            deletedAt: typeof entry.deletedAt === 'string' ? entry.deletedAt : null
          }
          : { rev: entry.rev, deleted: false });
      }
    }
  }
  return { layers, orderRev };
}

function layerOrderOf(record, index) {
  const order = Number(record?.order);
  return Math.max(0, Math.round(Number.isFinite(order) ? order : index));
}

/**
 * 비교에 쓰는 레이어 내용. 순서 번호(`order`)는 뺀다 — 목록에서의 자리일 뿐이라, 다른 사람이
 * 레이어를 하나 끼워 넣기만 해도 바뀐다. 내용에 넣으면 손대지 않은 레이어가 "고쳤다" 로 읽힌다.
 */
function layerContentOf(record, normalizeLayer, index) {
  let normalized = record;
  if (typeof normalizeLayer === 'function') {
    try {
      normalized = normalizeLayer(record, index);
    } catch (_error) {
      normalized = record;
    }
  }
  if (!isPlainRecord(normalized)) return {};
  // eslint-disable-next-line no-unused-vars
  const { order, ...content } = normalized;
  return content;
}

function sameContent(left, right) {
  if (left === right) return true;
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) return false;
    const a = left[key];
    const b = right[key];
    if (a === b) continue;
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' &&
        canonicalJson(a) === canonicalJson(b)) {
      continue;
    }
    return false;
  }
  return true;
}

function sameEntry(left, right) {
  if (!left || !right) return left === right;
  if (left.rev !== right.rev || left.deleted !== right.deleted) return false;
  return left.deleted || sameContent(left.content, right.content);
}

// 수정 횟수가 같은 두 내용의 앞뒤. 어느 PC 에서 계산해도 같은 답이어야 한다.
function compareContent(left, right) {
  const leftKey = canonicalJson(left);
  const rightKey = canonicalJson(right);
  if (leftKey === rightKey) return 0;
  return leftKey < rightKey ? -1 : 1;
}

function createEmptyCompositionLayerState() {
  return { entries: new Map(), order: [], orderRev: 0 };
}

/**
 * 레이어 목록과 동기화 정보로 상태를 만든다.
 *
 * 상태는 레이어 id 마다 한 칸을 가진다: 살아 있으면 `{ rev, deleted: false, record, content }`,
 * 지워졌으면 `{ rev, deleted: true, deletedAt }`. `order` 는 살아 있는 레이어의 id 를 아래에서
 * 위로 늘어놓은 것이다.
 *
 * @param {Array} layers - `compositionLayers` 배열
 * @param {*} syncValue - 루트의 `compositionLayerSyncV1` 값(없어도 된다)
 * @param {Object} [options]
 * @param {Function} [options.normalizeLayer] - (레코드, 배열에서의 자리) => 앱이 저장하는
 *   모양의 레코드. 오래된 버전이 쓴 레코드(빠진 칸)와 지금의 레코드를 같은 것으로 읽기 위해 쓴다.
 */
function createCompositionLayerState(layers, syncValue, options = {}) {
  const sync = normalizeCompositionLayerSync(syncValue);
  const state = createEmptyCompositionLayerState();
  state.orderRev = sync.orderRev;
  const candidates = (Array.isArray(layers) ? layers : [])
    .map((record, index) => ({ record, index }))
    // id 없는 레코드는 앱이 만들지 않는다(레이어를 올릴 때마다 PC 마다 다른 id 가 붙어
    // 합칠 수 없다). 같은 id 가 둘이면 앞의 것만 본다.
    .filter(({ record }) => isLayerId(layerIdOf(record)))
    .sort((a, b) => (
      layerOrderOf(a.record, a.index) - layerOrderOf(b.record, b.index) || a.index - b.index
    ));
  for (const { record, index } of candidates) {
    const id = layerIdOf(record);
    if (state.entries.has(id)) continue;
    const known = sync.layers.get(id);
    if (known?.deleted) {
      // 삭제 표시가 있는데 목록에도 남아 있다. 이 앱은 그렇게 쓰지 않는다 — 수정 횟수를
      // 모르는 쪽(웹 뷰어)이 예전에 연 목록에 최신 파일의 별도 칸을 붙여 저장한 것이다.
      // 삭제 표시를 따른다: 살아 있는 것으로 읽으면 그 저장 한 번에 지운 레이어가 모든
      // PC 에서 되살아난다. 되살린 레이어라면 이 앱이 삭제 표시를 지우고 더 큰 수정 횟수를 적는다.
      state.shadowedIds = state.shadowedIds || new Set();
      state.shadowedIds.add(id);
      continue;
    }
    state.entries.set(id, {
      rev: known?.rev ?? 0,
      deleted: false,
      record,
      content: layerContentOf(record, options.normalizeLayer, index)
    });
    state.order.push(id);
  }
  for (const [id, entry] of sync.layers) {
    if (entry.deleted && !state.entries.has(id)) {
      state.entries.set(id, { rev: entry.rev, deleted: true, deletedAt: entry.deletedAt ?? null });
    }
  }
  return state;
}

/**
 * 화면에 올릴 레이어 목록: 삭제 표시가 있는 id 의 레코드를 뺀다(createCompositionLayerState 와
 * 같은 판정). 파일을 열 때 쓴다 — 빼지 않으면 화면에는 있고 상태에는 지워진 레이어가 되어,
 * 곧바로 "내가 되살렸다" 로 읽힌다.
 */
function withoutTombstonedCompositionLayers(layers, syncValue) {
  const source = Array.isArray(layers) ? layers : [];
  const sync = normalizeCompositionLayerSync(syncValue);
  if (sync.layers.size === 0) return source;
  return source.filter(record => sync.layers.get(layerIdOf(record))?.deleted !== true);
}

/** 수정 횟수와 삭제 표시를 떼어 낸 상태(살아 있는 레이어만, 수정 횟수 0). */
function withoutCompositionLayerRevisions(state) {
  const next = createEmptyCompositionLayerState();
  // 칸은 순서 목록이 아니라 칸 자체에서 옮긴다. 기준의 순서 목록은 칸과 따로 옮겨져서
  // (advanceCompositionLayerBase) 살아 있는 칸이 거기 없을 수 있다.
  for (const [id, entry] of state.entries) {
    if (!entry.deleted) next.entries.set(id, entry.rev === 0 ? entry : { ...entry, rev: 0 });
  }
  next.order = aliveIds(state);
  return next;
}

function aliveIds(state) {
  return state.order.filter(id => state.entries.get(id)?.deleted === false);
}

function countTombstones(state) {
  let count = 0;
  for (const entry of state.entries.values()) {
    if (entry.deleted) count += 1;
  }
  return count;
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

// 양쪽에 다 있는 레이어끼리의 순서가 달라졌는가. 추가·삭제만으로는 달라지지 않는다.
function isReordered(fromOrder, toOrder) {
  const toSet = new Set(toOrder);
  const fromSet = new Set(fromOrder);
  return !sameSequence(
    fromOrder.filter(id => toSet.has(id)),
    toOrder.filter(id => fromSet.has(id))
  );
}

/**
 * 이 인스턴스가 본 가장 큰 수정 횟수를 기억한다. 화면에 아직 반영하지 못한 원격 상태(저장
 * 직전에 읽은 파일)까지 포함해야, 그 뒤의 내 편집이 그것보다 나중 상태로 찍힌다.
 *
 * @param {{ revs: Map<string, number>, orderRev: number }} seen
 */
function noteSeenCompositionLayerState(seen, state) {
  for (const [id, entry] of state.entries) {
    if (entry.rev > (seen.revs.get(id) ?? -1)) seen.revs.set(id, entry.rev);
  }
  if (state.orderRev > seen.orderRev) seen.orderRev = state.orderRev;
  return seen;
}

function createCompositionLayerSeen() {
  return { revs: new Map(), orderRev: 0 };
}

/**
 * 화면(매니저)의 레이어 목록을 직전 상태와 견주어 내 편집을 찾아 수정 횟수를 올린다.
 *
 *   - 새로 생겼거나 내용이 달라진 레이어: 수정 횟수 +1
 *   - 사라진 레이어: 삭제 표시(수정 횟수 +1)
 *   - 지웠다가 되살린 레이어(Ctrl+Z): 삭제 표시보다 큰 수정 횟수로 살아난다
 *   - 양쪽에 다 있는 레이어끼리의 순서가 달라졌으면: 순서 수정 횟수 +1
 *
 * @returns {{ state: Object, changed: boolean }} changed 는 내용·순서·목록 중 무엇이든 달라졌는가
 */
function applyLocalCompositionLayers(previousState, layers, options = {}) {
  const seen = options.seen || createCompositionLayerSeen();
  const now = typeof options.now === 'string' ? options.now : new Date().toISOString();
  const current = createCompositionLayerState(layers, undefined, options);
  const next = createEmptyCompositionLayerState();
  let changed = false;

  for (const id of current.order) {
    const previous = previousState.entries.get(id);
    const entry = current.entries.get(id);
    if (previous && !previous.deleted && sameContent(previous.content, entry.content)) {
      next.entries.set(id, { ...entry, rev: previous.rev });
    } else {
      const floor = Math.max(previous?.rev ?? 0, seen.revs.get(id) ?? 0);
      next.entries.set(id, { ...entry, rev: nextRevision(floor) });
      changed = true;
    }
    next.order.push(id);
  }
  for (const [id, previous] of previousState.entries) {
    if (next.entries.has(id)) continue;
    if (previous.deleted) {
      next.entries.set(id, previous);
      continue;
    }
    const floor = Math.max(previous.rev, seen.revs.get(id) ?? 0);
    next.entries.set(id, {
      rev: nextRevision(floor),
      deleted: true,
      deletedAt: now,
      // 지울 때 화면에 있던 판. 파일에는 적지 않는다(이 인스턴스만 안다). 나중에 파일의
      // 레이어가 "내가 못 본 남의 편집" 인지 "내가 보고 지운 바로 그것" 인지 가리는 데 쓴다.
      deletedFrom: { rev: previous.rev, content: previous.content }
    });
    changed = true;
  }

  const previousOrder = aliveIds(previousState);
  if (isReordered(previousOrder, next.order)) {
    next.orderRev = nextRevision(Math.max(previousState.orderRev, seen.orderRev));
    changed = true;
  } else {
    next.orderRev = previousState.orderRev;
    if (!sameSequence(previousOrder, next.order)) changed = true;
  }
  noteSeenCompositionLayerState(seen, next);
  return { state: next, changed };
}

// 기준에서 달라진 내 변경인가(아직 파일과 맞춰 보지 않은 편집).
function isPendingLocalEntry(baseEntry, localEntry) {
  return Boolean(localEntry) && !sameEntry(baseEntry, localEntry);
}

/**
 * 레이어 하나의 세 갈래 판정.
 *
 * @returns {{ entry: Object, from: 'local'|'remote', ahead: boolean, pinned?: boolean }}
 *   ahead 는 파일이 내 상태보다 뒤처져 있어 다시 저장해 바로잡아야 하는가.
 */
function pickCompositionLayerEntry(baseEntry, localEntry, remoteEntry) {
  if (!remoteEntry) {
    // 파일에 없고 삭제 표시도 없다: 그 레이어를 모르는 사본이다. 내 것을 지킨다.
    // 삭제 표시만 나에게 있는 경우는 파일에 그 레이어가 없으니 레이어를 바로잡을 것은 없다.
    // 빠진 표시를 다시 적을지는 합치는 쪽이 정한다(파일의 표시가 한도에 차 있으면 적지 않는다).
    return {
      entry: localEntry,
      from: 'local',
      ahead: !localEntry.deleted,
      missingTombstone: localEntry.deleted === true
    };
  }
  if (!localEntry) return { entry: remoteEntry, from: 'remote', ahead: false };

  // 한쪽이 지우고 다른 쪽이 고친 경우에만 쓴다: 내 변경이 아직 파일과 맞춰 보지 않은
  // 것이고(방금 한 편집), 상대의 변경도 내가 못 본 것이면 두 변경은 서로를 못 본 채 겹친
  // 것이다. 이때는 수정 횟수와 무관하게 고친 쪽을 남긴다 — 남의 편집을 삭제로 덮지 않는다.
  const baseAlive = Boolean(baseEntry) && !baseEntry.deleted;
  const localPending = isPendingLocalEntry(baseEntry, localEntry);

  if (localEntry.deleted && !remoteEntry.deleted) {
    // 파일의 레이어가 "내가 못 본 채 지운 남의 편집" 인가. 내가 지울 때 화면에 있던 판
    // (deletedFrom)과 견준다.
    //   - 내용이 같으면 내가 보고 지운 바로 그것이다. 수정 횟수가 더 커도 그렇다 — 다른
    //     사람의 삭제 표시를 내 편집이 이길 때는 내 내용이 더 큰 수정 횟수로 쓰인다.
    //   - 내용이 다르고 수정 횟수가 같거나 크면 못 본 편집이다(같은 경우는 함께 고친 것이거나
    //     이전 버전의 편집 — 이전 버전은 수정 횟수를 올리지 않는다).
    //   - 내용이 다르고 수정 횟수가 작으면 옛 사본이다.
    // 기준이 아니라 지운 판과 견주므로, 방금 내가 쓴 파일(기준이 아직 그 전이어도)을 남의
    // 편집으로 읽지 않는다. 지운 판을 모르는 삭제 표시(파일에서 온 것)만 기준과 견준다.
    const seenByDeleter = localEntry.deletedFrom || (baseAlive ? baseEntry : null);
    const remoteUnseenByDeleter = Boolean(seenByDeleter) &&
      remoteEntry.rev >= seenByDeleter.rev &&
      !sameContent(remoteEntry.content, seenByDeleter.content);
    if (localPending && remoteUnseenByDeleter) {
      // 살아난 레이어가 내 삭제 표시보다 뒤가 되도록 수정 횟수를 맞춘다.
      const rev = Math.max(remoteEntry.rev, localEntry.rev);
      return { entry: { ...remoteEntry, rev }, from: 'remote', ahead: rev !== remoteEntry.rev };
    }
    if (remoteEntry.rev >= localEntry.rev) {
      return { entry: remoteEntry, from: 'remote', ahead: false };
    }
    // 파일에 살아 있는 레이어를 내 삭제 표시가 이겼다. 이 표시는 반드시 파일에 적는다.
    return { entry: localEntry, from: 'local', ahead: true, pinned: true };
  }
  if (!localEntry.deleted && remoteEntry.deleted) {
    if (localEntry.rev >= remoteEntry.rev) {
      return { entry: localEntry, from: 'local', ahead: true };
    }
    if (localPending && baseAlive) {
      // 내가 고치는 사이 상대가 지웠다. 고친 레이어를 남기고 삭제 표시보다 뒤로 찍는다.
      return { entry: { ...localEntry, rev: remoteEntry.rev }, from: 'local', ahead: true };
    }
    return { entry: remoteEntry, from: 'remote', ahead: false };
  }
  if (localEntry.deleted && remoteEntry.deleted) {
    // 삭제 표시끼리는 레이어가 지워졌다는 뜻이 같다. 파일을 바로잡을 것도 없다. 다만 같은
    // 표시는 어느 PC 에서나 같은 값으로 모여야 한다: 수정 횟수가 큰 쪽, 같으면 더 나중에 지운
    // 쪽. 같은 레이어를 두 PC 가 각자 지우면 지운 시각이 다른데, 그대로 각자 자기 것을 들고
    // 있으면 "최근에 지운 것부터 한도만큼 적는다" 의 순위가 PC 마다 갈린다.
    const keepLocal = localEntry.rev !== remoteEntry.rev
      ? localEntry.rev > remoteEntry.rev
      : (localEntry.deletedAt || '') >= (remoteEntry.deletedAt || '');
    if (keepLocal) return { entry: localEntry, from: 'local', ahead: false };
    // 같은 삭제를 가리키는 표시라면 내가 지울 때 본 판은 그대로 기억해 둔다.
    const entry = localEntry.rev === remoteEntry.rev && localEntry.deletedFrom
      ? { ...remoteEntry, deletedFrom: localEntry.deletedFrom }
      : remoteEntry;
    return { entry, from: 'remote', ahead: false };
  }

  if (localEntry.rev !== remoteEntry.rev) {
    return localEntry.rev > remoteEntry.rev
      ? { entry: localEntry, from: 'local', ahead: true }
      : { entry: remoteEntry, from: 'remote', ahead: false };
  }
  if (sameContent(localEntry.content, remoteEntry.content)) {
    return { entry: localEntry, from: 'local', ahead: false };
  }
  // 수정 횟수는 같은데 내용이 다르다.
  //   - 내가 방금 고친 것이면 두 사람이 같은 레이어를 함께 고친 것이다. 내용 순서로 한쪽을
  //     고른다(어느 PC 에서나 같은 쪽).
  //   - 내가 고친 것이 아니면 파일 쪽이 바뀐 것이다(이전 버전은 수정 횟수를 올리지 않는다).
  //     받아들이되 다시 저장하지는 않는다 — 여기서 저장하면 서로 다른 내용을 든 두 PC 가
  //     상대의 것을 번갈아 받아 적는다.
  if (localPending && compareContent(localEntry.content, remoteEntry.content) > 0) {
    return { entry: localEntry, from: 'local', ahead: true };
  }
  return { entry: remoteEntry, from: 'remote', ahead: false };
}

/**
 * 수정 횟수를 쓸 수 없을 때(다룰 수 없는 판의 파일)의 레이어 하나의 판정. 기준과의 비교만 본다.
 * 넘겨받는 칸은 살아 있는 것뿐이다(없으면 undefined). 돌려주는 값이 없으면 지워진 것이다.
 *
 *   - 내가 고치는 중이 아니면 파일을 따른다(파일에 없으면 지운다).
 *   - 나만 고쳤으면 내 것을 남긴다(내가 지웠으면 지운다).
 *   - 둘 다 고쳤으면 지금 화면의 것을, 한쪽이 지웠으면 고친 쪽을 남긴다.
 */
function pickCompositionLayerEntryByContent(baseEntry, localEntry, remoteEntry) {
  const same = (left, right) => (
    left && right ? sameContent(left.content, right.content) : left === right
  );
  if (same(baseEntry, localEntry)) return remoteEntry;
  if (same(baseEntry, remoteEntry)) return localEntry;
  return localEntry || remoteEntry;
}

/**
 * 기준·로컬·원격 상태를 합친다. 저장 직전 병합, 파일 재로드, 연결 중 받아들이기가 모두 쓴다.
 *
 * @param {Object} base - 지난번에 파일과 맞춰 본 뒤의 내 상태
 * @param {Object} local - 지금의 내 상태(applyLocalCompositionLayers 를 거친 것)
 * @param {Object} remote - 방금 읽은 파일의 상태
 * @param {Object} [options]
 * @param {boolean} [options.revisions=true] - false 면 수정 횟수와 삭제 표시를 보지 않고 기준과의
 *   비교만으로 합친다. 수정 횟수를 파일에 적을 수 없을 때(다룰 수 없는 판) 쓴다 — 메모리에만
 *   있는 수정 횟수로 판정하면 같은 처지의 두 PC 가 서로 자기 것이 나중이라고 읽어 상대의
 *   저장분을 번갈아 덮어쓴다. 이때는 옛 사본을 가릴 수 없으므로 파일을 바로잡으려 들지 않는다.
 * @returns {{ state: Object, localAhead: boolean, changed: boolean, pinnedTombstones: Set<string> }}
 *   - localAhead: 파일이 뒤처져 있다. 다시 저장해 바로잡는다.
 *   - changed: 합친 결과의 살아 있는 레이어·순서가 로컬과 다르다. 화면에 반영할 것이 있다.
 */
function mergeCompositionLayerStates(baseState, localState, remoteState, options = {}) {
  const useRevisions = options.revisions !== false;
  const base = useRevisions ? baseState : withoutCompositionLayerRevisions(baseState);
  const local = useRevisions ? localState : withoutCompositionLayerRevisions(localState);
  const remote = useRevisions ? remoteState : withoutCompositionLayerRevisions(remoteState);
  const merged = createEmptyCompositionLayerState();
  const pinnedTombstones = new Set();
  let hasMissingTombstone = false;
  let localAhead = false;

  const ids = new Set([...local.entries.keys(), ...remote.entries.keys()]);
  for (const id of ids) {
    if (!useRevisions) {
      const entry = pickCompositionLayerEntryByContent(
        base.entries.get(id),
        local.entries.get(id),
        remote.entries.get(id)
      );
      if (entry) merged.entries.set(id, entry);
      continue;
    }
    const picked = pickCompositionLayerEntry(
      base.entries.get(id),
      local.entries.get(id),
      remote.entries.get(id)
    );
    merged.entries.set(id, picked.entry);
    if (picked.ahead) localAhead = true;
    if (picked.pinned) pinnedTombstones.add(id);
    if (picked.missingTombstone) hasMissingTombstone = true;
  }
  // 삭제 표시가 있는데 목록에도 남아 있던 레코드는 파일에서 치운다. 이전 버전은 별도 칸을
  // 보지 않아 그 레코드를 살아 있는 레이어로 보여 준다.
  if (useRevisions && remote.shadowedIds?.size > 0) localAhead = true;

  // 순서는 합친 결과에 살아 있는 레이어끼리만 견준다. 지워진 레이어를 옮긴 것까지 "순서를
  // 바꿨다" 로 치면, 그 레이어가 기준에서 빠지기 전과 뒤의 판정이 달라진다 — 저장할 때는
  // 파일의 순서를 쓰고 다시 읽을 때는 화면의 순서를 고집해, 둘이 다른 채로 남는다.
  const isAlive = id => merged.entries.get(id)?.deleted === false;
  const localAlive = aliveIds(local);
  const remoteAlive = aliveIds(remote);
  const localOrder = localAlive.filter(isAlive);
  const remoteOrder = remoteAlive.filter(isAlive);
  // 기준의 순서는 걸러 둘 필요가 없다(견줄 때 양쪽에 다 있는 레이어만 본다).
  const baseOrder = aliveIds(base);
  // 순서를 더 여러 번 바꾼 쪽을 따른다. 같으면 한쪽만 바꿨을 때 그쪽을, 양쪽이 다 바꿨으면
  // 파일 쪽을 따른다(먼저 저장한 쪽).
  let preferLocalOrder;
  if (local.orderRev !== remote.orderRev) {
    preferLocalOrder = local.orderRev > remote.orderRev;
    if (preferLocalOrder) localAhead = true;
  } else {
    preferLocalOrder = isReordered(baseOrder, localOrder) && !isReordered(baseOrder, remoteOrder);
  }
  merged.orderRev = Math.max(local.orderRev, remote.orderRev);
  // 따르는 쪽의 순서를 뼈대로 삼고, 다른 쪽에만 있는 레이어는 그쪽 목록에서의 자리에 끼운다:
  // 이웃(바로 아래 레이어) 뒤에, 맨 위쪽에 있었으면 맨 위에. 무조건 맨 위에 붙이면 옛 사본에
  // 없는 내 레이어가 옛 사본이 내려올 때마다 맨 위로 올라간다.
  const backbone = preferLocalOrder ? localOrder : remoteOrder;
  const others = preferLocalOrder ? remoteOrder : localOrder;
  const backboneIds = new Set(backbone);
  const lastShared = others.findLastIndex(id => backboneIds.has(id));
  merged.order = [...backbone];
  let anchor = -1;
  others.forEach((id, index) => {
    if (backboneIds.has(id)) {
      anchor = merged.order.indexOf(id);
    } else if (index > lastShared) {
      merged.order.push(id);
    } else {
      anchor += 1;
      merged.order.splice(anchor, 0, id);
    }
  });
  // 내 순서를 따랐는데 파일의 순서가 다르면 파일을 바로잡는다. 순서의 수정 횟수가 같을 때도
  // 그렇다 — 바로잡지 않으면 저장할 것이 없는데 화면과 파일의 순서가 다른 채로 남는다.
  if (preferLocalOrder && isReordered(remoteOrder, merged.order)) localAhead = true;

  // 내가 든 삭제 표시가 파일에서 빠졌다(삭제 전의 사본이 덮었다). 다시 적어 둔다 — 지운
  // PC 가 꺼진 뒤에는 그 표시를 아는 PC 가 없어, 삭제를 못 받은 PC 의 저장으로 레이어가
  // 되살아난다.
  // 파일의 삭제 표시가 한도에 차 있을 때는 적지 않는다. 그때 빠진 표시는 개수 한도로 빠진
  // 것이고, PC 마다 든 표시가 달라 서로 "내 것이 빠졌다" 며 번갈아 쓰게 된다. 한도 아래에서는
  // 쓸 때마다 파일의 표시가 늘기만 하므로(합친 상태는 양쪽 표시를 다 든다) 되풀이되지 않는다.
  if (useRevisions && hasMissingTombstone &&
      countTombstones(remote) < MAX_COMPOSITION_LAYER_TOMBSTONES) {
    localAhead = true;
  }

  return {
    state: merged,
    // 수정 횟수를 파일에 적을 수 없으면 "뒤처졌다" 를 확인할 길이 없다. 다시 저장하지 않는다
    // (저장은 내 편집이 건다).
    localAhead: useRevisions && localAhead,
    changed: !sameSequence(localAlive, merged.order) || merged.order.some(id => !sameContent(
      local.entries.get(id)?.content,
      merged.entries.get(id).content
    )),
    pinnedTombstones
  };
}

/**
 * 방금 파일에 쓴(또는 파일에서 읽은) 상태와 내용이 같은 칸은 그 수정 횟수를 따른다.
 *
 * 합치는 과정에서 수정 횟수만 올라가는 경우가 있다(지워진 레이어를 내 편집이 되살릴 때).
 * 저장은 화면을 바꾸지 않으므로 내 상태의 수정 횟수를 따로 올려 두지 않으면, 뒤늦게 내려온
 * 삭제 표시가 방금 되살린 레이어보다 나중으로 읽힌다.
 */
function adoptCompositionLayerRevisions(state, fileState) {
  const next = {
    entries: new Map(state.entries),
    order: state.order,
    orderRev: state.orderRev
  };
  for (const [id, entry] of state.entries) {
    const written = fileState.entries.get(id);
    if (!written || written.deleted !== entry.deleted || written.rev <= entry.rev) continue;
    if (entry.deleted || sameContent(entry.content, written.content)) {
      next.entries.set(id, { ...entry, rev: written.rev });
    }
  }
  if (fileState.orderRev > state.orderRev &&
      !isReordered(aliveIds(state), aliveIds(fileState))) {
    next.orderRev = fileState.orderRev;
  }
  return next;
}

/**
 * 병합 기준을 옮긴다. 기준은 "내 상태가 딛고 선 파일의 상태" 다 — 여기서 달라진 것이 "내가
 * 방금 고친 것" 이고, 파일이 여기서 달라진 것이 "남이 그 사이 고친 것" 이다.
 *
 *   - 내 상태가 파일의 것과 같은 칸: 기준을 그리로 옮긴다.
 *   - 저장을 마쳤을 때, 내 상태에서 나와 파일에 쓰인 칸(writtenFrom): 그 뒤에 화면에서 또
 *     고쳤든 지웠든 쓴 것을 기준으로 삼는다. 옮기지 않으면 방금 내가 쓴 파일이 "남이 그 사이
 *     고친 것" 으로 읽힌다.
 *   - 그 밖의 칸(화면이 파일보다 뒤처졌다, 옛 사본이다, 내 편집이 파일의 것을 이겼다):
 *     그대로 둔다. 화면에 아직 받지 못한 파일의 것을 기준으로 삼으면 화면의 옛 내용이 "내가
 *     방금 고친 것" 으로 읽힌다.
 *
 * @param {Object} base - 지금까지의 기준
 * @param {Object} state - 지금의 내 상태
 * @param {Object} fileState - 방금 읽은(또는 방금 쓴) 파일의 상태
 * @param {Object} [options]
 * @param {Object} [options.writtenFrom] - 저장을 마친 뒤에 준다: 그 파일을 만든 재료(합칠 때의
 *   내 상태). 이것과 쓴 것이 같은 칸은 내가 쓴 칸이므로, 그 뒤에 화면에서 또 고쳤든 지웠든
 *   쓴 것을 기준으로 삼는다. 수정 횟수 없이 합칠 때는 이것만이 "내가 쓴 칸" 을 가려 준다.
 */
function advanceCompositionLayerBase(base, state, fileState, options = {}) {
  const next = {
    entries: new Map(base.entries),
    order: base.order,
    orderRev: base.orderRev
  };
  for (const [id, entry] of state.entries) {
    const fileEntry = fileState.entries.get(id);
    if (!fileEntry) continue;
    if (sameEntry(entry, fileEntry)) next.entries.set(id, entry);
  }
  const writtenFrom = options.writtenFrom;
  if (writtenFrom) {
    for (const [id, fileEntry] of fileState.entries) {
      const mine = writtenFrom.entries.get(id);
      if (!mine || mine.deleted !== fileEntry.deleted) continue;
      if (fileEntry.deleted || sameContent(mine.content, fileEntry.content)) {
        next.entries.set(id, fileEntry);
      }
    }
  }
  // 내 상태에도 파일에도 없는 칸은 기준에서 뺀다. 삭제 표시를 두는 동안에는 생기지 않고,
  // 수정 횟수 없이 합칠 때(삭제 표시가 없다) 내가 지워 파일에서도 사라진 레이어가 여기 든다 —
  // 남겨 두면 다른 사람이 같은 id 로 되살린 레이어를 "내가 지운 것" 으로 또 지운다.
  const known = writtenFrom || state;
  for (const id of base.entries.keys()) {
    if (!known.entries.has(id) && !fileState.entries.has(id)) next.entries.delete(id);
  }
  // 순서도 같다: 내 순서가 파일의 순서와 같거나, 내 순서가 그대로 쓰였으면 기준을 옮긴다.
  const fileOrder = aliveIds(fileState);
  const stateOrder = aliveIds(state);
  if (state.orderRev === fileState.orderRev && !isReordered(stateOrder, fileOrder)) {
    next.order = stateOrder;
    next.orderRev = state.orderRev;
  } else if (writtenFrom && writtenFrom.orderRev === fileState.orderRev &&
      !isReordered(aliveIds(writtenFrom), fileOrder)) {
    next.order = fileOrder;
    next.orderRev = fileState.orderRev;
  }
  return next;
}

/**
 * 아직 파일과 맞춰 보지 않은 내 변경이 있는가(기준과 다른 살아 있는 레이어·삭제·순서).
 *
 * 저장하려고 화면의 편집을 읽어 간 뒤 그 저장이 실패하면, 그 편집은 상태에는 들어 있고
 * 파일에는 없다. 뒤늦게 온 변경 이벤트에서 "직전 상태와 달라진 것이 없다" 만 보면 그 편집을
 * 저장할 변경으로 표시하지 못한다. 그때 이 값으로 가린다.
 */
function hasUnsyncedCompositionLayerChanges(base, state) {
  for (const [id, entry] of state.entries) {
    const baseEntry = base.entries.get(id);
    if (entry.deleted) {
      // 삭제 표시끼리는 같다. 기준에 없는 삭제 표시(개수 한도로 파일에서 빠진 것, 파일에
      // 닿기 전에 지운 레이어)는 맞춰 볼 레이어가 없다.
      if (baseEntry && !baseEntry.deleted) return true;
      continue;
    }
    if (!baseEntry || !sameEntry(baseEntry, entry)) return true;
  }
  return state.orderRev !== base.orderRev || isReordered(aliveIds(base), aliveIds(state));
}

/** 상태의 살아 있는 레이어를 `compositionLayers` 배열로. 순서 번호는 자리대로 다시 매긴다. */
function compositionLayerStateToLayers(state) {
  return state.order.map((id, order) => ({ ...state.entries.get(id).record, order }));
}

/**
 * 파일에 적을 삭제 표시([id, 값] 의 배열). 최근에 지운 것부터 한도만큼, 그리고 한도와 무관하게
 * 반드시 적을 것(pinned). 어느 PC 에서 계산해도 같은 표시를 고른다.
 */
function tombstonesToWrite(state, pinned) {
  const tombstones = [];
  for (const [id, entry] of state.entries) {
    if (!entry.deleted) continue;
    tombstones.push([id, {
      rev: entry.rev,
      deleted: true,
      deletedAt: typeof entry.deletedAt === 'string' ? entry.deletedAt : null
    }]);
  }
  tombstones.sort((left, right) => {
    const leftPinned = pinned.has(left[0]);
    const rightPinned = pinned.has(right[0]);
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
    const leftAt = left[1].deletedAt || '';
    const rightAt = right[1].deletedAt || '';
    if (leftAt !== rightAt) return leftAt > rightAt ? -1 : 1;
    return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
  });
  return tombstones.filter(([id], index) => (
    pinned.has(id) || index < MAX_COMPOSITION_LAYER_TOMBSTONES
  ));
}

/**
 * 저장할 `compositionLayerSyncV1` 값. 적을 것이 없으면 `undefined` 를 돌려 루트에 키를 만들지
 * 않는다 — 합성 레이어를 쓰지 않거나 한 번도 고치지 않은 파일에 빈 구조를 심을 이유가 없다.
 *
 * @param {Object} state
 * @param {Object} [options]
 * @param {Set<string>} [options.pinnedTombstones] - 개수 한도와 무관하게 반드시 적을 삭제 표시.
 *   파일에 살아 있는 레이어를 이긴 표시가 빠지면, 그 레이어를 든 PC 와 삭제 표시를 든 PC 가
 *   파일을 번갈아 고쳐 쓴다.
 */
function serializeCompositionLayerSync(state, options = {}) {
  const pinned = options.pinnedTombstones instanceof Set ? options.pinnedTombstones : new Set();
  const alive = [];
  for (const [id, entry] of state.entries) {
    if (!entry.deleted && entry.rev > 0) alive.push([id, { rev: entry.rev }]);
  }
  const keptTombstones = tombstonesToWrite(state, pinned);
  if (alive.length === 0 && keptTombstones.length === 0 && state.orderRev === 0) {
    return undefined;
  }
  const entries = [...alive, ...keptTombstones]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return {
    version: COMPOSITION_LAYER_SYNC_VERSION,
    layers: Object.fromEntries(entries),
    orderRev: state.orderRev
  };
}

export {
  COMPOSITION_LAYER_SYNC_ROOT_KEY,
  COMPOSITION_LAYER_SYNC_VERSION,
  MAX_COMPOSITION_LAYER_TOMBSTONES,
  adoptCompositionLayerRevisions,
  advanceCompositionLayerBase,
  applyLocalCompositionLayers,
  compositionLayerStateToLayers,
  createCompositionLayerSeen,
  createCompositionLayerState,
  createEmptyCompositionLayerState,
  hasUnsyncedCompositionLayerChanges,
  isSupportedCompositionLayerSync,
  mergeCompositionLayerStates,
  normalizeCompositionLayerSync,
  noteSeenCompositionLayerState,
  serializeCompositionLayerSync,
  withoutCompositionLayerRevisions,
  withoutTombstonedCompositionLayers
};
