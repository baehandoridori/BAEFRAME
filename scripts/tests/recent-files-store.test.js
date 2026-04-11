/**
 * RecentFilesStore 단위 테스트
 *
 * 외부 의존을 피하기 위해 electron-store를 얇은 mock으로 대체한다.
 * 실행: npm run test:recent
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RecentFilesStore } = require('../../main/recent-files-store.js');

// ---- Mock Store (electron-store 대체) ----
class MockStore {
  constructor(initialData = {}) {
    this.data = JSON.parse(JSON.stringify(initialData));
  }
  get(key, defaultValue) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }
  set(key, value) {
    this.data[key] = JSON.parse(JSON.stringify(value));
  }
  clear() {
    this.data = {};
  }
}

// ---- Helper: 고정된 타임스탬프로 테스트 재현성 확보 ----
function createStore(initialData) {
  const mock = new MockStore(initialData);
  return new RecentFilesStore({ store: mock, now: () => 1000000000000 });
}

function makeItemInput(name, opts = {}) {
  return {
    path: opts.path || `C:/test/${name}`,
    name,
    dir: opts.dir || 'C:/test',
    ext: opts.ext || '.mp4',
    size: opts.size || 1000,
    duration: opts.duration || 10.0
  };
}

// ========== upsert 기본 동작 ==========

test('빈 저장소에 첫 항목을 추가하면 목록에 나타난다', () => {
  const store = createStore();
  const { id } = store.upsert(makeItemInput('a.mp4'));

  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].name, 'a.mp4');
  assert.equal(list[0].openCount, 1);
  assert.equal(list[0].openedAt, 1000000000000);
});

test('같은 경로를 다시 추가하면 항목이 갱신되고 중복되지 않는다', () => {
  const store = createStore();
  const first = store.upsert(makeItemInput('a.mp4'));

  // 나중 시각으로 재추가
  const store2 = new RecentFilesStore({
    store: new MockStore({ items: store.list(), pinned: [] }),
    now: () => 1000000060000 // 60초 뒤
  });
  const second = store2.upsert(makeItemInput('a.mp4'));

  const list = store2.list();
  assert.equal(list.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(list[0].openCount, 2);
  assert.equal(list[0].openedAt, 1000000060000);
});

test('파일 크기가 바뀌면 thumbPath가 무효화된다', () => {
  // 먼저 정확한 id를 구해 초기 데이터에 심는다
  const { hashPath } = require('../../main/recent-files-store.js');
  const correctId = hashPath('C:/test/a.mp4');
  const initial = {
    items: [{
      id: correctId,
      path: 'C:/test/a.mp4',
      name: 'a.mp4',
      dir: 'C:/test',
      ext: '.mp4',
      size: 1000,
      duration: 10,
      thumbPath: 'abc.jpg',
      openedAt: 900000000000,
      openCount: 1
    }],
    pinned: []
  };
  // 같은 id를 얻도록 같은 경로로 upsert하되 size 변경
  const store = new RecentFilesStore({
    store: new MockStore(initial),
    now: () => 1000000000000
  });
  store.upsert(makeItemInput('a.mp4', { size: 2000 }));

  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].thumbPath, null, '크기 변경 시 썸네일 무효화');
  assert.equal(list[0].size, 2000);
});

// ========== 정렬 ==========

test('list()는 openedAt 내림차순으로 반환한다', () => {
  const store = createStore();
  const nowProvider = { now: 1000000000000 };
  const customStore = new RecentFilesStore({
    store: new MockStore(),
    now: () => nowProvider.now
  });

  nowProvider.now = 1000; customStore.upsert(makeItemInput('old.mp4'));
  nowProvider.now = 3000; customStore.upsert(makeItemInput('new.mp4'));
  nowProvider.now = 2000; customStore.upsert(makeItemInput('mid.mp4'));

  const list = customStore.list();
  assert.deepEqual(list.map(i => i.name), ['new.mp4', 'mid.mp4', 'old.mp4']);
});

// ========== 용량 트림 ==========

test('비고정 항목이 10개를 초과하면 가장 오래된 것이 제거된다', () => {
  const nowProvider = { now: 1000 };
  const store = new RecentFilesStore({
    store: new MockStore(),
    now: () => nowProvider.now
  });

  // 11개 추가
  for (let i = 1; i <= 11; i++) {
    nowProvider.now = i * 1000;
    store.upsert(makeItemInput(`f${i}.mp4`));
  }

  const list = store.list();
  assert.equal(list.length, 10);
  const names = list.map(i => i.name);
  assert.ok(!names.includes('f1.mp4'), '가장 오래된 f1이 제거됨');
  assert.ok(names.includes('f11.mp4'), '가장 최신 f11은 유지');
});

test('고정 항목은 트림 대상에서 제외된다', () => {
  const nowProvider = { now: 1000 };
  const store = new RecentFilesStore({
    store: new MockStore(),
    now: () => nowProvider.now
  });

  // f1 추가 후 고정
  nowProvider.now = 1000;
  const first = store.upsert(makeItemInput('f1.mp4'));
  store.togglePin(first.id);

  // 비고정 11개 추가
  for (let i = 2; i <= 12; i++) {
    nowProvider.now = i * 1000;
    store.upsert(makeItemInput(`f${i}.mp4`));
  }

  const list = store.list();
  assert.equal(list.length, 11, '고정 1 + 비고정 10');
  const names = list.map(i => i.name);
  assert.ok(names.includes('f1.mp4'), '고정 f1은 남아있어야 함');
  assert.ok(!names.includes('f2.mp4'), '가장 오래된 비고정 f2가 제거됨');
});

// ========== 정렬 우선순위 (고정 먼저) ==========

test('고정 항목이 목록 맨 앞에 나온다', () => {
  const nowProvider = { now: 1000 };
  const store = new RecentFilesStore({
    store: new MockStore(),
    now: () => nowProvider.now
  });

  nowProvider.now = 1000; const a = store.upsert(makeItemInput('a.mp4'));
  nowProvider.now = 2000; const b = store.upsert(makeItemInput('b.mp4'));
  nowProvider.now = 3000; const c = store.upsert(makeItemInput('c.mp4'));

  store.togglePin(a.id); // a를 고정

  const list = store.list();
  assert.equal(list[0].name, 'a.mp4', '고정이 먼저');
  assert.equal(list[1].name, 'c.mp4', '그 다음 최신');
  assert.equal(list[2].name, 'b.mp4');
});

// ========== 고정 한계 ==========

test('6번째 고정 시도는 거부된다', () => {
  const store = createStore();
  const ids = [];
  for (let i = 1; i <= 6; i++) {
    const { id } = store.upsert(makeItemInput(`f${i}.mp4`));
    ids.push(id);
  }

  // 처음 5개는 성공
  for (let i = 0; i < 5; i++) {
    const res = store.togglePin(ids[i]);
    assert.equal(res.pinned, true, `${i + 1}번째 고정 성공`);
  }

  // 6번째는 실패
  assert.throws(() => store.togglePin(ids[5]), /최대 5개/);
  assert.equal(store.list().filter(i => i._pinned).length, 5);
});

test('고정 해제는 항상 성공한다', () => {
  const store = createStore();
  const { id } = store.upsert(makeItemInput('a.mp4'));
  store.togglePin(id);
  const res = store.togglePin(id);
  assert.equal(res.pinned, false);
});

// ========== 제거 ==========

test('remove()는 항목과 고정 플래그를 모두 제거한다', () => {
  const store = createStore();
  const { id } = store.upsert(makeItemInput('a.mp4'));
  store.togglePin(id);

  store.remove(id);
  assert.equal(store.list().length, 0);

  // 다시 추가 시 고정 안 된 상태여야 함
  const { id: newId } = store.upsert(makeItemInput('a.mp4'));
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]._pinned, false);
});

// ========== clear ==========

test('clear()는 모든 항목과 고정을 비운다', () => {
  const store = createStore();
  const { id } = store.upsert(makeItemInput('a.mp4'));
  store.togglePin(id);
  store.upsert(makeItemInput('b.mp4'));

  store.clear();
  assert.equal(store.list().length, 0);
});

// ========== pruneMissing ==========

test('pruneMissing()은 경로 검증 실패 항목을 제거한다', () => {
  const store = createStore();
  store.upsert(makeItemInput('a.mp4', { path: '/exists/a.mp4' }));
  store.upsert(makeItemInput('b.mp4', { path: '/missing/b.mp4' }));
  store.upsert(makeItemInput('c.mp4', { path: '/exists/c.mp4' }));

  const existsFn = (p) => p.startsWith('/exists/');
  const result = store.pruneMissing(existsFn);

  assert.equal(result.removedIds.length, 1);
  const list = store.list();
  assert.equal(list.length, 2);
  assert.ok(list.every(i => i.path.startsWith('/exists/')));
});

test('pruneMissing()은 고정된 항목도 경로 없으면 제거한다', () => {
  const store = createStore();
  const { id } = store.upsert(makeItemInput('a.mp4', { path: '/missing/a.mp4' }));
  store.togglePin(id);

  store.pruneMissing(() => false);
  assert.equal(store.list().length, 0);
});

// ========== id 안정성 ==========

test('같은 경로는 같은 id를 생성한다', () => {
  const store = createStore();
  const { id: id1 } = store.upsert(makeItemInput('a.mp4', { path: 'C:/same/path.mp4' }));
  store.remove(id1);
  const { id: id2 } = store.upsert(makeItemInput('a.mp4', { path: 'C:/same/path.mp4' }));
  assert.equal(id1, id2);
});

test('경로 대소문자/구분자 정규화가 적용된다', () => {
  const store = createStore();
  const { id: id1 } = store.upsert(makeItemInput('a.mp4', { path: 'C:\\Test\\A.mp4' }));
  const { id: id2 } = store.upsert(makeItemInput('a.mp4', { path: 'c:/test/a.mp4' }));
  assert.equal(id1, id2, '같은 파일로 간주');
  assert.equal(store.list().length, 1);
});

// ========== updateThumbPath ==========

test('updateThumbPath는 다른 필드를 건드리지 않는다', () => {
  const store = createStore();
  const { id } = store.upsert(makeItemInput('a.mp4'));
  const before = store.getById(id);
  store.updateThumbPath(id, 'abc.jpg');
  const after = store.getById(id);
  assert.equal(after.thumbPath, 'abc.jpg');
  assert.equal(after.openedAt, before.openedAt);
  assert.equal(after.openCount, before.openCount);
});

test('updateThumbPath는 존재하지 않는 id에 대해 false를 반환한다', () => {
  const store = createStore();
  assert.equal(store.updateThumbPath('nonexistent', 'x.jpg'), false);
});
