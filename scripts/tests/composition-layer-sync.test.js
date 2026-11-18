// 합성 레이어 동기화 규칙(shared/composition-layer-sync.js)의 단위 검사.
// 여러 PC 가 얽힌 순서는 composition-layer-collaboration-convergence.test.js 가 본다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function loadModule() {
  return import(pathToFileURL(
    path.join(__dirname, '../../shared/composition-layer-sync.js')
  ).href);
}

function layer(id, overrides = {}) {
  return { id, name: id, x: 0.25, opacity: 1, order: 0, ...overrides };
}

async function setup() {
  const sync = await loadModule();
  const state = (layers, syncValue) => sync.createCompositionLayerState(layers, syncValue);
  // 화면에서 고친 것처럼: 직전 상태에서 레이어 목록이 이렇게 바뀌었다.
  const edit = (previous, layers, options = {}) =>
    sync.applyLocalCompositionLayers(previous, layers, { now: '2026-11-18T05:00:00.000Z', ...options });
  const ids = merged => merged.state.order;
  const entry = (merged, id) => merged.state.entries.get(id);
  return { sync, state, edit, ids, entry };
}

test('루트 값이 무엇이든 쓸 수 있는 동기화 정보로 정규화한다', async () => {
  const { sync } = await setup();
  for (const garbage of [undefined, null, 'x', 7, [], { version: 1 }, { version: 1, layers: [] },
    { version: 0, layers: { a: { rev: 3 } } }]) {
    const normalized = sync.normalizeCompositionLayerSync(garbage);
    assert.equal(normalized.layers.size, 0);
    assert.equal(normalized.orderRev, 0);
  }
  const normalized = sync.normalizeCompositionLayerSync({
    version: 1,
    orderRev: 2,
    layers: {
      a: { rev: 3 },
      b: { rev: 4, deleted: true, deletedAt: '2026-11-18T05:00:00.000Z' },
      negative: { rev: -1 },
      fraction: { rev: 1.5 },
      text: { rev: '2' },
      none: null
    }
  });
  assert.deepEqual([...normalized.layers.keys()].sort(), ['a', 'b']);
  assert.deepEqual(normalized.layers.get('a'), { rev: 3, deleted: false });
  assert.deepEqual(normalized.layers.get('b'), {
    rev: 4, deleted: true, deletedAt: '2026-11-18T05:00:00.000Z'
  });
  assert.equal(normalized.orderRev, 2);
});

test('레이어 id 가 __proto__ 여도 자기 칸으로 읽고 쓴다', async () => {
  const { sync } = await setup();
  // 파일은 JSON 이라 "__proto__" 도 자기 속성으로 들어온다.
  const root = JSON.parse(JSON.stringify({
    compositionLayers: [{ id: 'placeholder', name: 'P', order: 0 }],
    sync: { version: 1, layers: { placeholder: { rev: 2 } } }
  }).replaceAll('placeholder', '__proto__'));
  const state = sync.createCompositionLayerState(root.compositionLayers, root.sync);
  assert.equal(state.entries.get('__proto__').rev, 2);

  const serialized = sync.serializeCompositionLayerSync(state);
  assert.equal(Object.hasOwn(serialized.layers, '__proto__'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)).layers['__proto__'], { rev: 2 });
  assert.equal(Object.getPrototypeOf(serialized.layers), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, 'rev'), false);
});

test('아주 긴 id 의 레이어도 병합에서 빠지지 않는다', async () => {
  const { sync } = await setup();
  const longId = `composition_${'x'.repeat(900)}`;
  const state = sync.createCompositionLayerState([{ id: longId, name: 'L', order: 0 }]);
  assert.deepEqual(state.order, [longId]);
  const merged = sync.mergeCompositionLayerStates(state, state, sync.createCompositionLayerState([]));
  assert.deepEqual(merged.state.order, [longId]);
});

test('앱이 받아들이지 않는 id(없음, 0, false, 빈 글자)의 레코드는 상태에 넣지 않는다', async () => {
  const { sync } = await setup();
  // 매니저는 이런 레코드에 읽을 때마다 새 id 를 붙인다. 상태에 넣으면 "화면에서 사라진
  // 레이어" 와 "파일에만 있는 레이어" 가 읽을 때마다 새로 생겨 레이어가 끝없이 는다.
  const state = sync.createCompositionLayerState([
    layer('a'), { name: 'none' }, { id: 0 }, { id: false }, { id: '' }, { id: null }, { id: 7, name: '7' }
  ]);
  assert.deepEqual(state.order, ['a', '7']);
});

test('삭제 표시가 있는 id 의 레코드가 목록에 남아 있어도 지워진 것으로 읽는다', async () => {
  const { sync, state, ids } = await setup();
  const tombstone = { version: 1, layers: { b: { rev: 2, deleted: true, deletedAt: null } } };
  // 웹 뷰어의 저장분: 예전에 연 목록(b 가 있다)에 최신 파일의 삭제 표시가 붙어 있다.
  const hybrid = state([layer('a'), layer('b', { order: 1 })], tombstone);
  assert.deepEqual(hybrid.order, ['a']);
  assert.equal(hybrid.entries.get('b').deleted, true);
  assert.equal(hybrid.entries.get('b').rev, 2);

  // 삭제 표시를 든 PC 는 파일에 남은 옛 레코드를 치운다. 치운 뒤에는 다시 저장하지 않는다.
  const mine = state([layer('a')], tombstone);
  const merged = sync.mergeCompositionLayerStates(mine, mine, hybrid);
  assert.deepEqual(ids(merged), ['a']);
  assert.equal(merged.changed, false);
  assert.equal(merged.localAhead, true);
  assert.equal(sync.mergeCompositionLayerStates(mine, mine, mine).localAhead, false);

  // 그 뒤에 되살린 레이어(삭제 표시보다 큰 수정 횟수)는 살아 있다.
  const restored = state([layer('a'), layer('b', { order: 1 })], { version: 1, layers: { b: { rev: 3 } } });
  assert.deepEqual(ids(sync.mergeCompositionLayerStates(mine, mine, restored)), ['a', 'b']);
});

test('수정 횟수를 쓸 수 없으면 기준과의 비교만으로 합치고, 파일을 바로잡으려 들지 않는다', async () => {
  const { sync, state, edit, ids, entry } = await setup();
  const merge = (base, local, remote) =>
    sync.mergeCompositionLayerStates(base, local, remote, { revisions: false });
  const base = state([layer('a'), layer('b', { order: 1 })]);
  const editedA = edit(base, [layer('a', { x: 0.6 }), layer('b', { order: 1 })]).state;

  // 내가 고치는 중이 아니면 파일을 따른다(삭제 포함). 메모리에만 있는 수정 횟수는 보지 않는다 —
  // 보면 같은 처지의 두 PC 가 서로 자기 것이 나중이라고 읽어 번갈아 덮어쓴다.
  const followed = merge(editedA, editedA, state([layer('a', { x: 0.1 })]));
  assert.equal(entry(followed, 'a').content.x, 0.1);
  assert.deepEqual(ids(followed), ['a']);
  assert.equal(followed.changed, true);
  assert.equal(followed.localAhead, false);

  // 내가 방금 고친 것은 남긴다. 저장은 내 편집이 걸므로 따로 바로잡으라고 하지 않는다.
  const pending = merge(base, editedA, base);
  assert.equal(entry(pending, 'a').content.x, 0.6);
  assert.equal(pending.changed, false);
  assert.equal(pending.localAhead, false);

  // 내가 지운 것은 지워진다. 한쪽이 지우고 다른 쪽이 고쳤으면 고친 쪽이 남는다.
  const deletedB = edit(base, [layer('a')]).state;
  const editedB = state([layer('a'), layer('b', { order: 1, opacity: 0.4 })]);
  assert.deepEqual(ids(merge(base, deletedB, base)), ['a']);
  assert.equal(entry(merge(base, deletedB, editedB), 'b').content.opacity, 0.4);
  assert.equal(entry(merge(base, editedB, state([layer('a')])), 'b').content.opacity, 0.4);

  // 둘 다 고쳤으면 지금 화면의 것을 남긴다.
  const other = state([layer('a', { x: 0.2 }), layer('b', { order: 1 })]);
  assert.equal(entry(merge(base, editedA, other), 'a').content.x, 0.6);

  // 순서도 기준과의 비교로만 정한다: 나만 바꿨으면 내 순서를, 그 밖에는 파일의 순서를.
  const swapped = edit(base, [layer('b'), layer('a', { order: 1 })]).state;
  const mineReordered = merge(base, swapped, base);
  assert.deepEqual(ids(mineReordered), ['b', 'a']);
  assert.equal(mineReordered.localAhead, false);
  assert.deepEqual(ids(merge(swapped, swapped, base)), ['a', 'b']);

  // 합친 상태에는 수정 횟수도 삭제 표시도 없다.
  const merged = merge(base, deletedB, base);
  assert.deepEqual([...merged.state.entries.values()].map(item => [item.rev, item.deleted]), [[0, false]]);
  assert.equal(merged.state.orderRev, 0);
});

test('저장을 마친 뒤의 기준: 내 상태에서 나온 칸은 쓴 것을, 파일 쪽을 따른 칸은 예전 기준을 둔다', async () => {
  const { sync, state, ids } = await setup();
  const plain = sync.withoutCompositionLayerRevisions;
  const merge = (base, local, remote) =>
    sync.mergeCompositionLayerStates(base, local, remote, { revisions: false });
  const base = state([layer('a'), layer('b', { order: 1 }), layer('c', { order: 2 })]);
  // 저장할 때: a 는 내가 옮겼고, b 는 파일 쪽이 바뀌어 있었다(화면에는 아직 예전 b 가 있다).
  const localAtSave = state([layer('a', { x: 0.6 }), layer('b', { order: 1 }), layer('c', { order: 2 })]);
  const written = state([layer('a', { x: 0.6 }), layer('b', { order: 1, opacity: 0.3 }), layer('c', { order: 2 })]);
  // 쓰는 사이에 a 를 지우고 c 를 맨 아래로 내렸다.
  const now = plain(state([layer('c'), layer('b', { order: 1 })]));

  const nextBase = sync.advanceCompositionLayerBase(base, now, written, { writtenFrom: localAtSave });
  assert.equal(nextBase.entries.get('a').content.x, 0.6, '내가 쓴 칸');
  assert.equal(nextBase.entries.get('b').content.opacity, 1, '화면이 아직 받지 못한 칸');
  assert.deepEqual(nextBase.order, ['a', 'b', 'c'], '내 순서가 그대로 쓰였다');

  // 다음 병합: 지운 a 는 지워지고, 내린 c 는 내 순서대로, b 는 파일의 것을 따른다.
  const merged = merge(nextBase, now, written);
  assert.deepEqual(ids(merged), ['c', 'b']);
  assert.equal(merged.state.entries.get('b').content.opacity, 0.3);

  // 저장할 때 내가 지워 둔 레이어는 기준에서 빠진다(파일에도 없다).
  const deletedAtSave = state([layer('b', { order: 1 }), layer('c', { order: 2 })]);
  const afterDelete = sync.advanceCompositionLayerBase(base, deletedAtSave, deletedAtSave, {
    writtenFrom: deletedAtSave
  });
  assert.equal(afterDelete.entries.has('a'), false);
});

test('수정 횟수 없이 합칠 때는, 지운 레이어가 파일에서도 사라지면 기준에서도 뺀다', async () => {
  const { sync, state, edit, ids } = await setup();
  const base = state([layer('a'), layer('b', { order: 1 })]);
  const mine = sync.withoutCompositionLayerRevisions(edit(base, [layer('a')]).state);
  assert.equal(mine.entries.has('b'), false, '삭제 표시를 두지 않는다');
  const nextBase = sync.advanceCompositionLayerBase(base, mine, state([layer('a')]));
  assert.equal(nextBase.entries.has('b'), false);
  // 기준에 남아 있으면, 다른 사람이 같은 id 로 되살린 레이어를 "내가 지운 것" 으로 또 지운다.
  const merged = sync.mergeCompositionLayerStates(nextBase, mine, base, { revisions: false });
  assert.deepEqual(ids(merged), ['a', 'b']);

  // 기준의 순서 목록은 칸과 따로 옮겨진다. 순서 목록에 없는 살아 있는 칸도 견줄 수 있어야 한다 —
  // 빠지면 "기준에 없던 레이어" 로 읽혀, 내가 지운 레이어가 파일에서 되살아난다.
  const partialOrder = { entries: base.entries, order: ['a'], orderRev: 0 };
  assert.deepEqual([...sync.withoutCompositionLayerRevisions(partialOrder).entries.keys()].sort(), ['a', 'b']);
  const deletedB = sync.withoutCompositionLayerRevisions(edit(base, [layer('a')]).state);
  assert.deepEqual(
    ids(sync.mergeCompositionLayerStates(partialOrder, deletedB, base, { revisions: false })),
    ['a']
  );
});

test('내가 보고 지운 레이어는, 파일에 내가 쓴 것이 남아 있어도 되살아나지 않는다', async () => {
  const { sync, state, edit, entry } = await setup();
  const base = state([layer('a')]);
  const written = edit(base, [layer('a', { x: 0.6 })]).state;
  const editedDuringWrite = edit(written, [layer('a', { x: 0.7 })]).state;
  const isDeleted = (local, remote) =>
    entry(sync.mergeCompositionLayerStates(base, local, remote), 'a').deleted;

  // 기준이 저장 전 그대로여도(쓰는 사이에 지웠다, 저장 완료 처리를 못 했다) 지운 레이어는
  // 되살아나지 않는다. 파일에 있는 것은 내가 지울 때 보던 바로 그 판이거나 그보다 옛것이다 —
  // 기준과만 견주면 방금 내가 쓴 것이 "남이 그 사이 고친 것" 으로 읽혀 되살아난다.
  const deletedAfterWrite = edit(written, []).state;
  assert.equal(isDeleted(deletedAfterWrite, written), true);
  const deletedAfterSecondEdit = edit(editedDuringWrite, []).state;
  assert.equal(isDeleted(deletedAfterSecondEdit, written), true);

  // 내가 못 본 편집은 살린다: 지울 때 보던 판보다 수정 횟수가 크거나, 같은데 내용이 다르다.
  const later = state([layer('a', { opacity: 0.3 })], { version: 1, layers: { a: { rev: 2 } } });
  assert.equal(isDeleted(deletedAfterWrite, later), false);
  const sameRevOtherContent = state([layer('a', { opacity: 0.3 })], { version: 1, layers: { a: { rev: 1 } } });
  assert.equal(isDeleted(deletedAfterWrite, sameRevOtherContent), false);

  // 내가 쓴 것인데 수정 횟수만 올라간 경우: 다른 사람의 삭제 표시(수정 횟수 3)를 내 편집이
  // 이기면서 내 내용이 수정 횟수 3 으로 쓰였다. 그 쓰기 도중에 지웠으면, 파일의 것은 내용이
  // 내가 지운 것과 같다 — 수정 횟수가 더 크다는 것만으로 "못 본 편집" 이 아니다.
  const sameContentHigherRev = state([layer('a', { x: 0.6 })], { version: 1, layers: { a: { rev: 3 } } });
  const seen = sync.createCompositionLayerSeen();
  sync.noteSeenCompositionLayerState(seen, sameContentHigherRev);
  const deletedDuringBumpedWrite = edit(written, [], { seen }).state;
  assert.equal(deletedDuringBumpedWrite.entries.get('a').rev, 4);
  assert.equal(isDeleted(deletedDuringBumpedWrite, sameContentHigherRev), true);

  // 지울 때 보던 판은 파일에 적지 않는다.
  assert.deepEqual(sync.serializeCompositionLayerSync(deletedAfterWrite).layers.a, {
    rev: 2, deleted: true, deletedAt: '2026-11-18T05:00:00.000Z'
  });
});

test('삭제 표시가 한도를 넘어도, 같은 레이어를 각자 지운 두 PC 가 번갈아 저장하지 않는다', async () => {
  const { sync } = await setup();
  const cap = sync.MAX_COMPOSITION_LAYER_TOMBSTONES;
  const at = seconds => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  const tombstone = seconds => ({ rev: 1, deleted: true, deletedAt: at(seconds) });
  // 둘 다 아는 삭제 표시가 한도만큼 있다. 레이어 x 는 두 PC 가 서로의 삭제를 못 본 채 각자
  // 지웠다: PC1 은 가장 먼저(0초), PC2 는 가장 나중에.
  const common = {};
  for (let index = 1; index <= cap; index += 1) common[`gone-${String(index).padStart(4, '0')}`] = tombstone(index);
  const stateOf = layers => sync.createCompositionLayerState([], { version: 1, layers });
  const states = {
    pc1: stateOf({ ...common, x: tombstone(0) }),
    pc2: stateOf({ ...common, x: tombstone(cap + 10) })
  };
  const fileOf = merged => sync.createCompositionLayerState([], sync.serializeCompositionLayerSync(
    merged.state, { pinnedTombstones: merged.pinnedTombstones }
  ));
  // PC2 가 마지막으로 쓴 파일에서 시작해, 서로의 파일을 번갈아 읽고 "뒤처졌다" 면 다시 쓴다.
  let file = sync.createCompositionLayerState([], sync.serializeCompositionLayerSync(states.pc2));
  const savesPerRound = [];
  for (let round = 0; round < 8; round += 1) {
    let saves = 0;
    for (const name of ['pc1', 'pc2']) {
      const merged = sync.mergeCompositionLayerStates(states[name], states[name], file);
      states[name] = merged.state;
      if (merged.localAhead) {
        file = fileOf(merged);
        saves += 1;
      }
    }
    savesPerRound.push(saves);
  }
  // 같은 id 의 삭제 표시가 PC 마다 다른 시각을 달고 있으면 "최근 것부터 한도만큼" 의 순위가
  // 갈려, 서로 "내 표시가 파일에서 빠졌고 적을 수 있다" 로 읽고 끝없이 번갈아 쓴다.
  assert.deepEqual(savesPerRound.slice(-4), [0, 0, 0, 0], JSON.stringify(savesPerRound));
  assert.equal(states.pc1.entries.get('x').deletedAt, states.pc2.entries.get('x').deletedAt,
    '같은 삭제 표시는 어느 PC 에서나 같은 값으로 모인다');
});

test('수정 횟수가 있을 때의 기준: 내가 쓴 칸은 쓴 것으로, 뒤처진 칸과 옛 사본은 그대로', async () => {
  const { sync, state, edit } = await setup();
  const base = state([layer('a')]);
  const written = edit(base, [layer('a', { x: 0.6 })]).state;
  const editedDuringWrite = edit(written, [layer('a', { x: 0.7 })]).state;

  // 쓰는 사이에 또 고친 칸: 쓴 것(수정 횟수 1)이 기준이다.
  const afterEdit = sync.advanceCompositionLayerBase(base, editedDuringWrite, written, { writtenFrom: written });
  assert.equal(afterEdit.entries.get('a').rev, 1);
  assert.equal(afterEdit.entries.get('a').content.x, 0.6);
  // 쓰는 사이에 지운 칸도 같다.
  const afterDelete = sync.advanceCompositionLayerBase(base, edit(written, []).state, written, { writtenFrom: written });
  assert.equal(afterDelete.entries.get('a').rev, 1);

  // 화면이 파일보다 뒤처진 칸(저장할 때 파일 쪽이 이겼다)은 기준을 옮기지 않는다.
  const remoteWon = state([layer('a', { x: 0.9 })], { version: 1, layers: { a: { rev: 3 } } });
  assert.equal(
    sync.advanceCompositionLayerBase(base, base, remoteWon, { writtenFrom: base }).entries.get('a').rev,
    0
  );

  // 받아들일 때: 내 것이 이긴 칸과 옛 사본으로는 기준을 옮기지 않는다.
  const synced = state([layer('a', { x: 0.6 })], { version: 1, layers: { a: { rev: 4 } } });
  const ahead = edit(synced, [layer('a', { x: 0.8 })]).state;
  const stale = state([layer('a')], { version: 1, layers: { a: { rev: 2 } } });
  assert.equal(sync.advanceCompositionLayerBase(synced, ahead, stale).entries.get('a').rev, 4);
});

test('아직 파일과 맞춰 보지 않은 내 변경이 있는지 알려 준다', async () => {
  const { sync, state, edit } = await setup();
  const base = state([layer('a'), layer('b', { order: 1 })], { version: 1, layers: { a: { rev: 2 } } });
  assert.equal(sync.hasUnsyncedCompositionLayerChanges(base, base), false);
  assert.equal(sync.hasUnsyncedCompositionLayerChanges(
    base, edit(base, [layer('a', { x: 0.9 }), layer('b', { order: 1 })]).state), true);
  assert.equal(sync.hasUnsyncedCompositionLayerChanges(base, edit(base, [layer('a')]).state), true);
  assert.equal(sync.hasUnsyncedCompositionLayerChanges(
    base, edit(base, [layer('b'), layer('a', { order: 1 })]).state), true);
  assert.equal(sync.hasUnsyncedCompositionLayerChanges(
    base, edit(base, [layer('a'), layer('b', { order: 1 }), layer('c', { order: 2 })]).state), true);
});

test('수정 횟수가 안전한 정수의 끝이어도 다음 편집이 읽을 수 없는 값을 적지 않는다', async () => {
  const { sync, state, edit } = await setup();
  const max = Number.MAX_SAFE_INTEGER;
  const top = state([layer('a'), layer('b', { order: 1 })], {
    version: 1, layers: { a: { rev: max }, b: { rev: max } }, orderRev: max
  });
  const edited = edit(top, [layer('b', { order: 0 }), layer('a', { x: 0.9, order: 1 })]).state;
  const serialized = sync.serializeCompositionLayerSync(edit(edited, [layer('a', { x: 0.9 })]).state);
  const read = sync.normalizeCompositionLayerSync(serialized);
  assert.equal(read.layers.get('a').rev, max);
  assert.deepEqual(
    { rev: read.layers.get('b').rev, deleted: read.layers.get('b').deleted },
    { rev: max, deleted: true }
  );
  assert.equal(read.orderRev, max);
});

test('다룰 수 있는 판만 받아들인다', async () => {
  const { sync } = await setup();
  assert.equal(sync.isSupportedCompositionLayerSync(undefined), true);
  assert.equal(sync.isSupportedCompositionLayerSync({ version: 1 }), true);
  assert.equal(sync.isSupportedCompositionLayerSync({}), true);
  assert.equal(sync.isSupportedCompositionLayerSync({ version: 2 }), false);
});

test('적을 것이 없으면 값을 만들지 않고, 고친 레이어와 삭제 표시만 적는다', async () => {
  const { sync, state, edit } = await setup();
  assert.equal(sync.serializeCompositionLayerSync(state([])), undefined);
  assert.equal(sync.serializeCompositionLayerSync(state([layer('a'), layer('b', { order: 1 })])), undefined);

  const edited = edit(state([layer('a'), layer('b', { order: 1 })]), [layer('a', { x: 0.5 })]).state;
  assert.deepEqual(sync.serializeCompositionLayerSync(edited), {
    version: 1,
    layers: {
      a: { rev: 1 },
      b: { rev: 1, deleted: true, deletedAt: '2026-11-18T05:00:00.000Z' }
    },
    orderRev: 0
  });
});

test('순서 번호만 다른 레코드는 같은 내용이다', async () => {
  const { state, edit } = await setup();
  const before = state([layer('a'), layer('b', { order: 1 })]);
  const result = edit(before, [layer('a', { order: 3 }), layer('b', { order: 7 })]);
  assert.equal(result.changed, false);
  assert.equal(result.state.entries.get('a').rev, 0);
});

test('내 편집마다 수정 횟수가 하나씩 오르고, 되돌려도 내려가지 않는다', async () => {
  const { state, edit } = await setup();
  const seen = (await loadModule()).createCompositionLayerSeen();
  let current = state([layer('a')]);
  current = edit(current, [layer('a', { x: 0.6 })], { seen }).state;
  assert.equal(current.entries.get('a').rev, 1);
  // 처음과 똑같은 내용으로 되돌렸다.
  const reverted = edit(current, [layer('a')], { seen });
  assert.equal(reverted.changed, true);
  assert.equal(reverted.state.entries.get('a').rev, 2);
  // 지웠다가 되살리면 삭제 표시보다 큰 수정 횟수로 살아난다.
  const deleted = edit(reverted.state, [], { seen }).state;
  assert.deepEqual(
    { rev: deleted.entries.get('a').rev, deleted: deleted.entries.get('a').deleted },
    { rev: 3, deleted: true }
  );
  const restored = edit(deleted, [layer('a')], { seen }).state;
  assert.deepEqual(
    { rev: restored.entries.get('a').rev, deleted: restored.entries.get('a').deleted },
    { rev: 4, deleted: false }
  );
});

test('내 편집은 이 인스턴스가 본 가장 큰 수정 횟수보다 나중으로 찍힌다', async () => {
  const { sync, state, edit } = await setup();
  const seen = sync.createCompositionLayerSeen();
  // 화면에는 아직 반영하지 못했지만 파일에서 rev 5 를 본 적이 있다.
  sync.noteSeenCompositionLayerState(seen, state([layer('a')], { version: 1, layers: { a: { rev: 5 } } }));
  const edited = edit(state([layer('a')]), [layer('a', { x: 0.9 })], { seen }).state;
  assert.equal(edited.entries.get('a').rev, 6);
});

test('순서만 바꾸면 순서 수정 횟수가 오르고, 추가·삭제만으로는 오르지 않는다', async () => {
  const { state, edit } = await setup();
  const before = state([layer('a'), layer('b', { order: 1 }), layer('c', { order: 2 })]);
  const added = edit(before, [layer('a'), layer('b', { order: 1 }), layer('c', { order: 2 }), layer('d', { order: 3 })]);
  assert.equal(added.state.orderRev, 0);
  const removed = edit(before, [layer('a'), layer('c', { order: 1 })]);
  assert.equal(removed.state.orderRev, 0);
  const swapped = edit(before, [layer('b'), layer('a', { order: 1 }), layer('c', { order: 2 })]);
  assert.equal(swapped.changed, true);
  assert.equal(swapped.state.orderRev, 1);
  assert.equal(swapped.state.entries.get('a').rev, 0, '순서를 바꾼 것은 레이어 내용의 수정이 아니다');
});

test('같은 상태끼리 합치면 바뀌는 것이 없고 파일을 바로잡을 것도 없다', async () => {
  const { sync, state } = await setup();
  const both = state(
    [layer('a'), layer('b', { order: 1 })],
    { version: 1, layers: { a: { rev: 2 }, gone: { rev: 3, deleted: true, deletedAt: null } }, orderRev: 1 }
  );
  const merged = sync.mergeCompositionLayerStates(both, both, both);
  assert.equal(merged.changed, false);
  assert.equal(merged.localAhead, false);
  assert.deepEqual(merged.state.order, ['a', 'b']);
});

test('파일에 없는 레이어: 삭제 표시가 없으면 지키고, 있으면 지운다', async () => {
  const { sync, state, ids } = await setup();
  const mine = state([layer('a'), layer('b', { order: 1 })]);

  const stale = sync.mergeCompositionLayerStates(mine, mine, state([layer('a')]));
  assert.deepEqual(ids(stale), ['a', 'b']);
  assert.equal(stale.localAhead, true, '파일에서 빠진 내 레이어를 다시 써 넣는다');
  assert.equal(stale.changed, false);

  const deleted = sync.mergeCompositionLayerStates(mine, mine, state(
    [layer('a')],
    { version: 1, layers: { b: { rev: 1, deleted: true, deletedAt: null } } }
  ));
  assert.deepEqual(ids(deleted), ['a']);
  assert.equal(deleted.localAhead, false);
  assert.equal(deleted.changed, true);
});

test('수정 횟수가 큰 쪽이 나중 상태다', async () => {
  const { sync, state, entry } = await setup();
  const mine = state([layer('a', { x: 0.6 })], { version: 1, layers: { a: { rev: 2 } } });
  const older = state([layer('a')], { version: 1, layers: { a: { rev: 1 } } });
  const newer = state([layer('a', { x: 0.9 })], { version: 1, layers: { a: { rev: 3 } } });

  const againstOlder = sync.mergeCompositionLayerStates(mine, mine, older);
  assert.equal(entry(againstOlder, 'a').content.x, 0.6);
  assert.equal(againstOlder.localAhead, true);
  assert.equal(againstOlder.changed, false);

  const againstNewer = sync.mergeCompositionLayerStates(mine, mine, newer);
  assert.equal(entry(againstNewer, 'a').content.x, 0.9);
  assert.equal(againstNewer.localAhead, false);
  assert.equal(againstNewer.changed, true);
});

test('수정 횟수가 같고 내용이 다르면: 내가 고친 것이 아니면 파일을 따르고 다시 저장하지 않는다', async () => {
  const { sync, state, entry } = await setup();
  const mine = state([layer('a', { x: 0.6 })], { version: 1, layers: { a: { rev: 2 } } });
  const other = state([layer('a', { x: 0.1 })], { version: 1, layers: { a: { rev: 2 } } });

  const merged = sync.mergeCompositionLayerStates(mine, mine, other);
  assert.equal(entry(merged, 'a').content.x, 0.1);
  assert.equal(merged.localAhead, false,
    '여기서 저장하면 서로 다른 내용을 든 두 PC 가 상대의 것을 번갈아 받아 적는다');

  const reverse = sync.mergeCompositionLayerStates(other, other, mine);
  assert.equal(entry(reverse, 'a').content.x, 0.6);
  assert.equal(reverse.localAhead, false);
});

test('두 사람이 함께 고쳐 수정 횟수가 같으면 어느 PC 에서나 같은 쪽을 고른다', async () => {
  const { sync, state, edit, entry } = await setup();
  const base = state([layer('a')]);
  const first = edit(base, [layer('a', { x: 0.1 })]).state;
  const second = edit(base, [layer('a', { x: 0.9 })]).state;

  const atFirst = sync.mergeCompositionLayerStates(base, first, second);
  const atSecond = sync.mergeCompositionLayerStates(base, second, first);
  assert.equal(entry(atFirst, 'a').content.x, entry(atSecond, 'a').content.x);
  // 이긴 쪽만 파일을 고쳐 쓴다.
  assert.notEqual(atFirst.localAhead, atSecond.localAhead);
});

test('한쪽이 지우고 다른 쪽이 고치면 고친 레이어가 삭제 표시보다 뒤로 남는다', async () => {
  const { sync, state, edit, entry } = await setup();
  const base = state([layer('a')], { version: 1, layers: { a: { rev: 4 } } });
  const deleted = edit(base, []).state;
  const editedByNew = edit(base, [layer('a', { opacity: 0.3 })]).state;
  // 이전 버전은 수정 횟수를 올리지 않는다.
  const editedByOld = state([layer('a', { opacity: 0.3 })], { version: 1, layers: { a: { rev: 4 } } });

  for (const [label, edited] of [['새 버전', editedByNew], ['이전 버전', editedByOld]]) {
    const atDeleter = sync.mergeCompositionLayerStates(base, deleted, edited);
    assert.equal(entry(atDeleter, 'a').deleted, false, label);
    assert.equal(entry(atDeleter, 'a').content.opacity, 0.3, label);
    assert.equal(entry(atDeleter, 'a').rev, 5, label);
    assert.equal(atDeleter.changed, true, label);
  }
  const atEditor = sync.mergeCompositionLayerStates(base, editedByNew, deleted);
  assert.equal(entry(atEditor, 'a').deleted, false);
  assert.equal(atEditor.localAhead, true);

  // 상대가 고친 뒤 지워서 삭제 표시의 수정 횟수가 더 커도, 내가 방금 고친 것이면 남긴다.
  const editedThenDeleted = edit(edit(base, [layer('a', { x: 0.9 })]).state, []).state;
  const atLateEditor = sync.mergeCompositionLayerStates(base, editedByNew, editedThenDeleted);
  assert.equal(entry(atLateEditor, 'a').deleted, false);
  assert.equal(entry(atLateEditor, 'a').rev, 6);
  assert.equal(atLateEditor.localAhead, true);
});

test('옛 사본은 내 삭제를 취소하지 못하고, 삭제 표시를 든 쪽이 파일을 바로잡는다', async () => {
  const { sync, state, edit, entry } = await setup();
  const base = state([layer('a')], { version: 1, layers: { a: { rev: 4 } } });
  const deleted = edit(base, []).state;
  // 기준보다 수정 횟수가 작은 사본(내용도 다르다).
  const stale = state([layer('a', { x: 0.7 })], { version: 1, layers: { a: { rev: 3 } } });

  const pending = sync.mergeCompositionLayerStates(base, deleted, stale);
  assert.equal(entry(pending, 'a').deleted, true);
  assert.equal(pending.localAhead, true);
  assert.deepEqual([...pending.pinnedTombstones], ['a']);

  const settled = sync.mergeCompositionLayerStates(deleted, deleted, stale);
  assert.equal(entry(settled, 'a').deleted, true);
  assert.equal(settled.localAhead, true);
});

test('파일에서 빠진 삭제 표시는 다시 적되, 개수 한도로 빠진 표시 때문에 저장을 되풀이하지 않는다', async () => {
  const { sync, state } = await setup();
  const mine = state([layer('a')], {
    version: 1,
    layers: { gone: { rev: 2, deleted: true, deletedAt: '2026-11-18T05:00:00.000Z' } }
  });
  // 삭제 전의 사본(그 레이어도 삭제 표시도 없다)이 파일을 덮었다.
  const merged = sync.mergeCompositionLayerStates(mine, mine, state([layer('a')]));
  assert.equal(merged.localAhead, true,
    '표시를 다시 적어 두지 않으면, 지운 PC 가 꺼진 뒤에는 그 삭제를 아는 PC 가 없다');
  assert.equal(merged.changed, false);
  assert.equal(merged.state.entries.get('gone').deleted, true);
  // 다시 적은 뒤에는 저장하지 않는다.
  assert.equal(sync.mergeCompositionLayerStates(mine, mine, mine).localAhead, false);

  // 한도보다 많은 표시를 든 PC: 파일에는 최근 것만 있다. 빠진 옛 표시는 적어도 다시 빠진다.
  const layers = {};
  for (let index = 0; index < sync.MAX_COMPOSITION_LAYER_TOMBSTONES + 20; index += 1) {
    layers[`gone-${String(index).padStart(4, '0')}`] = {
      rev: 1,
      deleted: true,
      deletedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    };
  }
  const full = state([layer('a')], { version: 1, layers });
  const onDisk = state([layer('a')], sync.serializeCompositionLayerSync(full));
  assert.equal(onDisk.entries.has('gone-0000'), false);
  assert.equal(sync.mergeCompositionLayerStates(full, full, onDisk).localAhead, false,
    '한도로 빠진 표시를 "파일이 뒤처졌다" 로 보면 저장해도 그대로라 저장을 되풀이한다');
});

test('삭제 표시끼리는 수정 횟수가 달라도 파일을 다시 쓰지 않는다', async () => {
  const { sync, state } = await setup();
  const tombstone = rev => state([], {
    version: 1,
    layers: { gone: { rev, deleted: true, deletedAt: '2026-11-18T05:00:00.000Z' } }
  });
  const newer = sync.mergeCompositionLayerStates(tombstone(5), tombstone(5), tombstone(3));
  assert.equal(newer.state.entries.get('gone').rev, 5);
  assert.equal(newer.localAhead, false, '파일에 이미 그 레이어가 없다. 바로잡을 것이 없다');
  const older = sync.mergeCompositionLayerStates(tombstone(3), tombstone(3), tombstone(5));
  assert.equal(older.state.entries.get('gone').rev, 5);
  assert.equal(older.localAhead, false);
});

test('삭제 표시는 최근 것만 두되, 파일의 레이어를 이긴 표시는 반드시 적는다', async () => {
  const { sync } = await setup();
  const layers = {};
  const total = sync.MAX_COMPOSITION_LAYER_TOMBSTONES + 20;
  for (let index = 0; index < total; index += 1) {
    layers[`gone-${String(index).padStart(4, '0')}`] = {
      rev: 1,
      deleted: true,
      deletedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    };
  }
  const state = sync.createCompositionLayerState([], { version: 1, layers });
  const plain = sync.serializeCompositionLayerSync(state);
  assert.equal(Object.keys(plain.layers).length, sync.MAX_COMPOSITION_LAYER_TOMBSTONES);
  assert.equal(Object.hasOwn(plain.layers, 'gone-0000'), false, '가장 오래된 것부터 뺀다');
  assert.equal(Object.hasOwn(plain.layers, `gone-${String(total - 1).padStart(4, '0')}`), true);

  const pinned = sync.serializeCompositionLayerSync(state, {
    pinnedTombstones: new Set(['gone-0000'])
  });
  assert.equal(Object.hasOwn(pinned.layers, 'gone-0000'), true);
});

test('순서는 더 여러 번 바꾼 쪽을 따르고, 새 레이어는 맨 위에 놓인다', async () => {
  const { sync, state, edit, ids } = await setup();
  const base = state([layer('a'), layer('b', { order: 1 })]);
  const reordered = edit(base, [layer('b'), layer('a', { order: 1 })]).state;
  const added = edit(base, [layer('a'), layer('b', { order: 1 }), layer('c', { order: 2 })]).state;

  const atReorderer = sync.mergeCompositionLayerStates(base, reordered, added);
  assert.deepEqual(ids(atReorderer), ['b', 'a', 'c']);
  assert.equal(atReorderer.localAhead, true);

  const atAdder = sync.mergeCompositionLayerStates(base, added, reordered);
  assert.deepEqual(ids(atAdder), ['b', 'a', 'c']);

  // 순서를 바꾸기 전의 사본은 순서를 되돌리지 못한다.
  const stale = sync.mergeCompositionLayerStates(reordered, reordered, base);
  assert.deepEqual(ids(stale), ['b', 'a']);
  assert.equal(stale.localAhead, true);
});

test('지워진 레이어를 옮긴 것은 순서를 바꾼 것으로 치지 않는다', async () => {
  const { sync, state, edit, ids } = await setup();
  const ordered = (...names) => names.map((name, index) => layer(name, { order: index }));
  // p q r 에서 나는 p 를 올렸고(q p r), 가는 r 을 내린 뒤(p r q) p 를 지웠다(r q).
  // 둘 다 순서를 한 번 바꿨다.
  const base = state(ordered('p', 'q', 'r'));
  const remote = edit(base, ordered('q', 'p', 'r')).state;
  const local = edit(edit(base, ordered('p', 'r', 'q')).state, ordered('r', 'q')).state;
  assert.equal(local.orderRev, remote.orderRev);

  // 남은 레이어(q, r)끼리의 순서를 바꾼 것은 가뿐이다. 지워진 p 까지 넣어 "둘 다 바꿨다" 로
  // 읽으면 저장할 때는 파일의 순서를, 다시 읽을 때는 화면의 순서를 골라 둘이 갈린다.
  const merged = sync.mergeCompositionLayerStates(base, local, remote);
  assert.deepEqual(ids(merged), ['r', 'q']);
  assert.equal(merged.changed, false);

  // 순서의 수정 횟수가 같은데 내 순서를 따르기로 했으면, 파일의 순서가 다를 때 파일을 바로잡는다.
  const tombstone = { version: 1, layers: { p: { rev: 1, deleted: true, deletedAt: null } }, orderRev: 1 };
  const mine = state(ordered('r', 'q'), tombstone);
  const file = state(ordered('q', 'r'), tombstone);
  const lagging = sync.mergeCompositionLayerStates(file, mine, file);
  assert.deepEqual(ids(lagging), ['r', 'q']);
  assert.equal(lagging.localAhead, true, '바로잡지 않으면 저장할 것이 없는데 화면과 파일이 다른 채로 남는다');
});

test('한쪽에만 있는 레이어는 그쪽 목록에서의 자리를 지킨다', async () => {
  const { sync, state, ids } = await setup();
  const order = (...names) => names.map((name, index) => layer(name, { order: index }));
  const merge = (local, remote) => {
    const mine = state(order(...local));
    return sync.mergeCompositionLayerStates(mine, mine, state(order(...remote)));
  };

  // 옛 사본에 없는 내 레이어: 가운데·맨 아래·맨 위 어디에 있든 제자리. 화면을 다시 채울 일도 없다.
  for (const local of [['a', 'x', 'b'], ['x', 'a', 'b'], ['a', 'b', 'x'], ['a', 'x', 'y', 'b']]) {
    const merged = merge(local, ['a', 'b']);
    assert.deepEqual(ids(merged), local);
    assert.equal(merged.changed, false, local.join());
  }
  // 다른 사람이 끼워 넣은 레이어는 그 사람이 넣은 자리에 들어온다.
  assert.deepEqual(ids(merge(['a', 'b'], ['a', 'q', 'b'])), ['a', 'q', 'b']);
  assert.deepEqual(ids(merge(['a', 'b'], ['q', 'a', 'b'])), ['q', 'a', 'b']);
  // 양쪽이 각자 맨 위에 올린 레이어는 둘 다 위쪽에 남는다.
  assert.deepEqual(ids(merge(['a', 'b', 'p'], ['a', 'b', 'q'])), ['a', 'b', 'q', 'p']);
  // 지운 레이어는 어느 쪽 순서에 있든 빠진다.
  const deleted = sync.mergeCompositionLayerStates(
    state(order('a', 'x', 'b')),
    state(order('a', 'x', 'b')),
    state(order('a', 'b'), { version: 1, layers: { x: { rev: 1, deleted: true, deletedAt: null } } })
  );
  assert.deepEqual(ids(deleted), ['a', 'b']);
});

test('저장한 뒤에는 파일에 쓴 수정 횟수를 따르고, 아직 파일에 없는 편집의 기준은 그대로 둔다', async () => {
  const { sync, state, edit } = await setup();
  const base = state([layer('a'), layer('b', { order: 1 })]);
  const local = edit(base, [layer('a', { x: 0.6 }), layer('b', { order: 1 })]).state;
  // 파일에는 a 가 수정 횟수 3 으로 쓰였다(지워진 레이어를 되살린 경우 등).
  const written = sync.createCompositionLayerState(
    [layer('a', { x: 0.6 }), layer('b', { order: 1 })],
    { version: 1, layers: { a: { rev: 3 } } }
  );
  const adopted = sync.adoptCompositionLayerRevisions(local, written);
  assert.equal(adopted.entries.get('a').rev, 3);

  // 저장하는 사이 b 를 또 고쳤다. b 는 아직 파일과 다르므로 기준을 옮기지 않는다.
  const editedDuringSave = edit(adopted, [layer('a', { x: 0.6 }), layer('b', { order: 1, opacity: 0.5 })]).state;
  const nextBase = sync.advanceCompositionLayerBase(base, editedDuringSave, written);
  assert.equal(nextBase.entries.get('a').rev, 3);
  assert.equal(nextBase.entries.get('b').rev, 0);
  assert.equal(nextBase.entries.get('b').content.opacity, 1);
});

test('상태를 레이어 배열로 되돌리면 받은 레코드 그대로이고 순서 번호만 자리대로 매긴다', async () => {
  const { sync } = await setup();
  const records = [
    { id: 'b', name: 'B', extra: { keep: true }, order: 5 },
    { id: 'a', name: 'A', order: 2 }
  ];
  const state = sync.createCompositionLayerState(records, undefined, {
    // 비교용 정규화는 파일에 쓰는 레코드를 바꾸지 않는다.
    normalizeLayer: record => ({ id: record.id, name: String(record.name).toLowerCase(), order: record.order })
  });
  assert.deepEqual(sync.compositionLayerStateToLayers(state), [
    { id: 'a', name: 'A', order: 0 },
    { id: 'b', name: 'B', extra: { keep: true }, order: 1 }
  ]);
});
