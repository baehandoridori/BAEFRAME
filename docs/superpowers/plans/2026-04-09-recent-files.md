# 최근 연 파일 기능 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BAEFRAME에 최근에 열었던 미디어 파일을 썸네일과 함께 보여주고 한 번에 다시 열 수 있는 기능을 추가한다. 빈 드롭존에는 카드 목록을, 헤더에는 드롭다운 패널을 제공한다.

**Architecture:** main 프로세스에 `electron-store` 기반의 저장소와 ffmpeg를 재사용한 썸네일 캡처 모듈을 신설하고 IPC로 렌더러에 노출한다. 렌더러는 얇은 매니저(비즈니스 로직)와 뷰(DOM) 모듈로 분리하여 `app.js`의 `loadVideo()` 성공 지점과 앱 초기화 지점에만 최소 침습으로 통합한다.

**Tech Stack:** Electron 28, Node 18, `electron-store` (이미 설치됨), 기존 `main/ffmpeg-manager.js`, 기존 `main/logger.js`. 새 의존성은 추가하지 않는다. 순수 로직 테스트는 Node 내장 `node --test` + `assert`로 수행한다.

**Spec:** `docs/superpowers/specs/2026-04-09-recent-files-design.md`

---

## 파일 구조 맵

### 신규 파일

| 경로 | 책임 |
|------|------|
| `main/recent-files-store.js` | `electron-store` 래퍼. 메타데이터 CRUD, 정렬, 용량 트림, 고정 로직. **외부 의존 없음 → 단위 테스트 가능** |
| `main/recent-thumb-capture.js` | ffmpeg로 단일 프레임 JPEG 추출. 실패 시 null 반환, 예외 안 던짐 |
| `scripts/tests/recent-files-store.test.js` | `main/recent-files-store.js`의 유닛 테스트. `node --test`로 실행 |
| `renderer/scripts/modules/recent-files-manager.js` | IPC 래핑, 이벤트 발행. EventTarget 상속 |
| `renderer/scripts/modules/recent-files-view.js` | DOM 렌더링 전담. `renderEmptyState()`, `renderDropdown()` 두 메서드 |
| `renderer/styles/recent-files.css` | 카드, 썸네일, 드롭다운 패널, 호버, 누락 상태 스타일 |
| `DEVLOG/최근-연-파일-기능-개발.md` | CLAUDE.md 규약에 따른 개발 문서 |

### 수정 파일

| 경로 | 수정 내용 |
|------|----------|
| `package.json` | `scripts.test:recent` 추가 |
| `main/ipc-handlers.js` | `// ====== 최근 파일 ======` 섹션에 9개 IPC 핸들러 추가 |
| `main/index.js` | 앱 시작 시 `pruneMissing()` 1회 호출 |
| `preload/preload.js` | `electronAPI`에 `recent*` 메서드 추가 (평면 네이밍) |
| `renderer/scripts/app.js` | 3지점 수정: 매니저/뷰 생성, 헤더 버튼 바인딩, `loadVideo()` 성공 시 `add` 호출 |
| `renderer/index.html` | 헤더 버튼, 드롭다운 패널, 드롭존 내 섹션 3곳 추가 |
| `renderer/styles/main.css` | `@import 'recent-files.css'` 추가 |

### 영향 없음 (의도적)

`.bframe` 스키마, `reviewDataManager`, `playlist-manager.js`, `version-dropdown.js`, `liveblocks-manager.js`, 협업 모듈, 기존 `thumbnail-generator.js`(재생 중 타임라인용). 이 기능은 완전히 로컬·독립이다.

---

## Chunk 1: Store 모듈과 단위 테스트

이 청크는 외부 I/O가 없는 순수 로직을 먼저 완성해 신뢰를 쌓는다. `electron-store`는 테스트에서 경량 mock으로 대체한다.

### Task 1.1: DEVLOG 문서 생성

**Files:**
- Create: `DEVLOG/최근-연-파일-기능-개발.md`

- [ ] **Step 1: Write DEVLOG header and plan reference**

파일 내용:

```markdown
# 최근 연 파일 기능 개발

## 요약

| Phase | 수정 파일 | 이유 | 우선순위 | 상태 |
|-------|----------|------|---------|------|
| Phase 1 | main/recent-files-store.js, scripts/tests/recent-files-store.test.js | 저장소 로직과 단위 테스트 | 높음 | ⬜ 대기 |
| Phase 2 | main/recent-thumb-capture.js, main/ipc-handlers.js, main/index.js, preload/preload.js | ffmpeg 썸네일 캡처 및 IPC 노출 | 높음 | ⬜ 대기 |
| Phase 3 | renderer/scripts/modules/recent-files-manager.js, renderer/scripts/modules/recent-files-view.js, renderer/styles/recent-files.css, renderer/styles/main.css | 렌더러 모듈과 스타일 | 높음 | ⬜ 대기 |
| Phase 4 | renderer/index.html, renderer/scripts/app.js | 기존 UI에 통합 | 높음 | ⬜ 대기 |
| Phase 5 | (수동 QA) | 10개 수동 테스트 시나리오 통과 | 높음 | ⬜ 대기 |

## 배경 및 목적

- 스튜디오 팀원이 매번 Google Drive 깊은 경로에서 파일을 다시 찾는 불편 해소
- 프로젝트 간 빠른 전환과 앱 재시작 후 컨텍스트 복원 지원
- 자세한 요구사항·UI·데이터 모델은 스펙 참조: `docs/superpowers/specs/2026-04-09-recent-files-design.md`
- 자세한 단계별 작업은 구현 계획 참조: `docs/superpowers/plans/2026-04-09-recent-files.md`

## Phase 1: 저장소 모듈

### 목표
순수 로직 저장소 작성. electron-store 래퍼로 메타데이터 CRUD, 정렬, 트림, 고정 로직 제공. Node `node --test`로 단위 테스트.

### 수정 파일
- 신규: main/recent-files-store.js
- 신규: scripts/tests/recent-files-store.test.js

### 구현 내용
- RecentFilesStore 클래스, 주입 가능한 store 인스턴스로 테스트 용이
- list/upsert/remove/clear/togglePin/pruneMissing/getById 공개 메서드
- 정렬: 고정 순서 → openedAt 내림차순
- 용량 제한: 비고정 10개

### 예상 리스크
- electron-store의 동기 vs 비동기 API 혼선 — v8은 동기이므로 주의
- 해시 생성 시 경로 대소문자·구분자 정규화 필요

## Phase 2: 썸네일 캡처 + IPC

### 목표
ffmpeg로 대표 프레임 1장 추출·저장, 9개 IPC 핸들러 노출.

### 수정 파일
- 신규: main/recent-thumb-capture.js
- 수정: main/ipc-handlers.js
- 수정: main/index.js
- 수정: preload/preload.js

### 구현 내용
- captureFrame(videoPath, outputPath, atSeconds) — 실패 시 null
- IPC: recent:list/add/remove/clear/togglePin/pruneMissing/openInFolder/captureThumb/getThumbUrl
- 앱 시작 시 pruneMissing 1회 비동기 호출

### 예상 리스크
- ffmpeg가 설치 안 된 환경 대응 (기존 ffmpeg-manager 패턴 재사용)
- 썸네일 파일 경로 보안 검증

## Phase 3: 렌더러 모듈과 스타일

### 목표
매니저(로직)와 뷰(DOM) 분리. 기존 version-dropdown 토큰과 일관된 스타일.

### 수정 파일
- 신규: renderer/scripts/modules/recent-files-manager.js
- 신규: renderer/scripts/modules/recent-files-view.js
- 신규: renderer/styles/recent-files.css
- 수정: renderer/styles/main.css

### 구현 내용
- 매니저: EventTarget 상속, list/add/remove/togglePin 래핑, updated 이벤트
- 뷰: renderEmptyState / renderDropdown 두 메서드, 이벤트 위임
- 스타일: 카드, 썸네일, 호버 액션, 누락 상태, 드롭다운 패널

### 예상 리스크
- CSP 이슈 (file:// URL 이미지 로드)
- 썸네일 로드 타이밍과 렌더링 순서

## Phase 4: 통합

### 목표
기존 UI에 최근 파일 섹션 삽입. loadVideo 훅 추가.

### 수정 파일
- 수정: renderer/index.html
- 수정: renderer/scripts/app.js

### 구현 내용
- 헤더 로고 옆 btnRecentFiles 버튼
- 헤더 하단 recentDropdownMenu 패널
- 드롭존 내 recentFilesSection
- loadVideo 성공 시점 add 호출
- 앱 초기화 시 매니저·뷰 생성

### 예상 리스크
- loadVideo 실패 시 add가 호출되지 않도록 정확한 위치 잡기
- 드래그앤드롭 영역과 리스트 영역 이벤트 충돌

## 리스크 및 우려 사항

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| electron-store 로드 실패 | 중간 | try/catch로 빈 배열 폴백, 사용자 차단 금지 |
| ffmpeg 부재 | 낮음 | ffmpegIsAvailable 확인 후 캡처 건너뛰기, 아이콘 폴백 |
| Google Drive 오프라인 | 중간 | pruneMissing은 부드럽게 회색 처리만, 즉시 삭제 금지 |
| 기존 UI 회귀 | 낮음 | 신규 CSS는 전용 파일로 격리, 기존 클래스명 재사용 안 함 |

## 테스트 방법

### 자동화
- `npm run test:recent` — recent-files-store 단위 테스트

### 수동 QA 체크리스트
스펙 섹션 9.1의 10개 시나리오 순차 확인. 각 항목 통과 시 DEVLOG에 체크.
```

- [ ] **Step 2: Commit DEVLOG**

```bash
git add "DEVLOG/최근-연-파일-기능-개발.md"
git commit -m "docs: 최근 연 파일 기능 DEVLOG 추가"
```

### Task 1.2: 단위 테스트 파일 작성 (실패 확인용)

**Files:**
- Create: `scripts/tests/recent-files-store.test.js`
- Modify: `package.json` (scripts 섹션)

이 태스크는 **테스트 우선 작성**이다. 테스트만 먼저 작성하고 실패를 확인한 뒤 다음 태스크에서 구현한다.

- [ ] **Step 1: Add npm test script**

`package.json`의 `scripts` 객체에 라인 추가 (기존 `format` 라인 뒤):

```json
"test:recent": "node --test scripts/tests/recent-files-store.test.js"
```

- [ ] **Step 2: Write the test file**

`scripts/tests/recent-files-store.test.js` 전체 내용:

```js
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
  const initial = {
    items: [{
      id: 'abc',
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
```

- [ ] **Step 3: Run test to verify failure**

실행:

```bash
npm run test:recent
```

Expected: `Cannot find module '../../main/recent-files-store.js'` 에러. 테스트가 올바르게 연결되어 있음을 확인하는 실패.

- [ ] **Step 4: Commit test file and package.json**

```bash
git add package.json scripts/tests/recent-files-store.test.js
git commit -m "test: 최근 파일 저장소 단위 테스트 추가 (실패 상태)"
```

### Task 1.3: Store 모듈 구현

**Files:**
- Create: `main/recent-files-store.js`
- Test: `scripts/tests/recent-files-store.test.js` (기존)

- [ ] **Step 1: Write the minimal implementation**

`main/recent-files-store.js` 전체 내용:

```js
/**
 * baeframe - Recent Files Store
 *
 * 최근 연 미디어 파일의 메타데이터 저장소.
 * electron-store를 주입받아 테스트에서는 mock으로 대체 가능하게 한다.
 *
 * 스키마:
 *   items:  RecentItem[]
 *   pinned: string[]  (id 배열, 최대 5)
 *
 * 정렬: 고정 순서 → openedAt 내림차순
 * 용량: 비고정 최대 10개 (초과 시 가장 오래된 비고정 제거)
 */

const crypto = require('crypto');

const MAX_UNPINNED = 10;
const MAX_PINNED = 5;

/**
 * 경로를 정규화해 id 안정성을 확보한다.
 * - Windows 역슬래시를 슬래시로 통일
 * - 소문자화 (Windows는 대소문자 구분 안 함)
 * - 끝 슬래시 제거
 */
function normalizePath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function hashPath(p) {
  return crypto.createHash('sha1').update(normalizePath(p)).digest('hex');
}

class RecentFilesStore {
  /**
   * @param {object} options
   * @param {object} options.store - electron-store 인터페이스 (get/set/clear)
   * @param {() => number} [options.now] - 현재 시각 공급자 (테스트 주입용)
   */
  constructor({ store, now = () => Date.now() }) {
    if (!store) throw new Error('store is required');
    this._store = store;
    this._now = now;
  }

  // ---- 내부 상태 접근 ----

  _readItems() {
    const items = this._store.get('items', []);
    return Array.isArray(items) ? items : [];
  }

  _readPinned() {
    const pinned = this._store.get('pinned', []);
    return Array.isArray(pinned) ? pinned : [];
  }

  _writeItems(items) {
    this._store.set('items', items);
  }

  _writePinned(pinned) {
    this._store.set('pinned', pinned);
  }

  // ---- 공개 API ----

  /**
   * 정렬된 전체 목록을 반환. 각 항목에 _pinned 플래그가 부여된다.
   */
  list() {
    const items = this._readItems();
    const pinned = this._readPinned();
    const pinnedSet = new Set(pinned);

    // 고정 섹션: pinned 배열 순서 (사용자가 고정한 순서 유지)
    const pinnedItems = pinned
      .map(id => items.find(i => i.id === id))
      .filter(Boolean)
      .map(i => ({ ...i, _pinned: true }));

    // 일반 섹션: 비고정 항목, openedAt 내림차순
    const regular = items
      .filter(i => !pinnedSet.has(i.id))
      .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
      .map(i => ({ ...i, _pinned: false }));

    return [...pinnedItems, ...regular];
  }

  /**
   * 경로를 기준으로 id를 계산해 반환한다 (외부에서도 재사용).
   */
  computeId(path) {
    return hashPath(path);
  }

  /**
   * 단일 항목 조회. 없으면 null.
   */
  getById(id) {
    const item = this._readItems().find(i => i.id === id);
    return item ? { ...item } : null;
  }

  /**
   * 항목을 삽입하거나 갱신한다.
   * 같은 id가 있으면 openedAt 갱신 + openCount++.
   * size가 달라졌으면 thumbPath 무효화.
   * 비고정 항목이 MAX_UNPINNED를 초과하면 가장 오래된 비고정 제거.
   *
   * @param {object} input - { path, name, dir, ext, size, duration }
   * @returns {{id: string, item: object}}
   */
  upsert(input) {
    if (!input || !input.path) throw new Error('path is required');

    const id = hashPath(input.path);
    const items = this._readItems();
    const now = this._now();

    const existingIdx = items.findIndex(i => i.id === id);

    if (existingIdx >= 0) {
      const existing = items[existingIdx];
      const sizeChanged = input.size != null && existing.size !== input.size;

      items[existingIdx] = {
        ...existing,
        path: input.path,           // 경로 표기 갱신 (정규화 전)
        name: input.name,
        dir: input.dir,
        ext: input.ext,
        size: input.size != null ? input.size : existing.size,
        duration: input.duration != null ? input.duration : existing.duration,
        thumbPath: sizeChanged ? null : existing.thumbPath,
        openedAt: now,
        openCount: (existing.openCount || 0) + 1
      };
    } else {
      items.push({
        id,
        path: input.path,
        name: input.name,
        dir: input.dir,
        ext: input.ext,
        size: input.size || 0,
        duration: input.duration || 0,
        thumbPath: null,
        openedAt: now,
        openCount: 1
      });
    }

    // 용량 트림: 비고정 항목이 10개 초과하면 가장 오래된 비고정 제거
    const pinnedSet = new Set(this._readPinned());
    const unpinned = items.filter(i => !pinnedSet.has(i.id));

    if (unpinned.length > MAX_UNPINNED) {
      // 가장 오래된 비고정부터 제거 대상
      const toRemove = unpinned
        .sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0))
        .slice(0, unpinned.length - MAX_UNPINNED)
        .map(i => i.id);
      const removeSet = new Set(toRemove);
      const trimmed = items.filter(i => !removeSet.has(i.id));
      this._writeItems(trimmed);
    } else {
      this._writeItems(items);
    }

    const savedItem = this._readItems().find(i => i.id === id);
    return { id, item: savedItem };
  }

  /**
   * 단일 항목 제거. 고정 배열에서도 함께 제거한다.
   */
  remove(id) {
    const items = this._readItems().filter(i => i.id !== id);
    this._writeItems(items);

    const pinned = this._readPinned().filter(pid => pid !== id);
    this._writePinned(pinned);
  }

  /**
   * 전체 비우기.
   */
  clear() {
    this._writeItems([]);
    this._writePinned([]);
  }

  /**
   * 고정 토글. 5개 초과 시도는 예외를 던진다.
   * @returns {{pinned: boolean}}
   */
  togglePin(id) {
    const item = this.getById(id);
    if (!item) throw new Error(`항목을 찾을 수 없음: ${id}`);

    const pinned = this._readPinned();
    const idx = pinned.indexOf(id);

    if (idx >= 0) {
      // 해제
      pinned.splice(idx, 1);
      this._writePinned(pinned);
      return { pinned: false };
    }

    if (pinned.length >= MAX_PINNED) {
      throw new Error(`고정은 최대 ${MAX_PINNED}개까지 가능합니다`);
    }

    pinned.push(id);
    this._writePinned(pinned);
    return { pinned: true };
  }

  /**
   * 존재하지 않는 경로의 항목을 일괄 제거.
   * @param {(path: string) => boolean} existsFn - 경로 존재 검사 함수
   * @returns {{removedIds: string[]}}
   */
  pruneMissing(existsFn) {
    const items = this._readItems();
    const removedIds = [];
    const keeping = [];

    for (const item of items) {
      if (existsFn(item.path)) {
        keeping.push(item);
      } else {
        removedIds.push(item.id);
      }
    }

    this._writeItems(keeping);

    if (removedIds.length > 0) {
      const removedSet = new Set(removedIds);
      const pinned = this._readPinned().filter(id => !removedSet.has(id));
      this._writePinned(pinned);
    }

    return { removedIds };
  }
}

module.exports = { RecentFilesStore, normalizePath, hashPath };
```

- [ ] **Step 2: Run test to verify pass**

```bash
npm run test:recent
```

Expected: 모든 테스트 통과 (16개 이상). 실패가 있으면 출력을 보고 구현을 수정한 뒤 재실행.

- [ ] **Step 3: Commit the store implementation**

```bash
git add main/recent-files-store.js
git commit -m "feat: 최근 파일 저장소 모듈 구현

- 경로 기반 SHA1 id, 경로 정규화(Windows 역슬래시, 대소문자)
- upsert/remove/clear/togglePin/pruneMissing 공개 API
- 고정 5개 + 비고정 10개 용량 제한
- electron-store 인터페이스 주입식으로 테스트 가능"
```

---

## Chunk 2: 썸네일 캡처 + IPC + preload

이 청크는 main 프로세스의 부작용(파일 I/O, ffmpeg) 부분을 완성하고 렌더러에 노출한다.

### Task 2.1: 썸네일 캡처 모듈

**Files:**
- Create: `main/recent-thumb-capture.js`

- [ ] **Step 1: Inspect existing ffmpeg-manager interface**

현재 ffmpeg 관리 모듈의 공개 메서드를 확인한다:

```bash
grep -n "exports\|module.exports\|function " main/ffmpeg-manager.js | head -40
```

`captureFrame` 같은 기존 메서드가 있으면 재사용, 없으면 새로 만든다.

- [ ] **Step 2: Write recent-thumb-capture.js**

`main/recent-thumb-capture.js` 전체 내용:

```js
/**
 * baeframe - Recent Files Thumbnail Capture
 *
 * ffmpeg로 비디오 대표 프레임 1장을 JPEG으로 추출한다.
 * 실패 시 예외를 던지지 않고 null을 반환해 상위 로직이 차단되지 않도록 한다.
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { createLogger } = require('./logger');

const log = createLogger('RecentThumbCapture');

const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 180;
const JPEG_QUALITY = 4; // ffmpeg -q:v 2(best)~31(worst), 4 ≈ 품질 0.75

/**
 * 썸네일 저장 폴더를 보장한다.
 * @param {string} userDataPath - app.getPath('userData')
 */
async function ensureThumbDir(userDataPath) {
  const dir = path.join(userDataPath, 'recent-thumbs');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function getThumbPath(userDataPath, id) {
  return path.join(userDataPath, 'recent-thumbs', `${id}.jpg`);
}

/**
 * ffmpeg 실행 파일 경로 반환.
 * 기존 ffmpeg-manager가 있으면 해당 경로 사용, 없으면 PATH의 ffmpeg.
 */
function resolveFfmpegPath() {
  try {
    // ffmpeg-manager가 경로를 노출하는 경우
    const ffmpegManager = require('./ffmpeg-manager');
    if (ffmpegManager.getFfmpegPath) {
      return ffmpegManager.getFfmpegPath();
    }
  } catch (e) {
    // ffmpeg-manager가 없거나 실패
  }
  return 'ffmpeg'; // PATH 의존 폴백
}

/**
 * 비디오의 지정 시각에서 단일 프레임을 JPEG으로 캡처한다.
 *
 * @param {object} options
 * @param {string} options.videoPath - 입력 비디오 절대 경로
 * @param {string} options.outputPath - 출력 JPEG 절대 경로
 * @param {number} options.atSeconds - 캡처 시각(초)
 * @param {number} [options.timeoutMs=10000] - 타임아웃
 * @returns {Promise<string|null>} 성공 시 outputPath, 실패 시 null
 */
async function captureFrame({ videoPath, outputPath, atSeconds, timeoutMs = 10000 }) {
  const ffmpegPath = resolveFfmpegPath();

  // 임시 파일에 쓰고 성공 시 원자적 rename
  const tmpPath = `${outputPath}.tmp`;

  const args = [
    '-y',
    '-ss', String(atSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=increase,crop=${THUMB_WIDTH}:${THUMB_HEIGHT}`,
    '-q:v', String(JPEG_QUALITY),
    tmpPath
  ];

  log.debug('ffmpeg 캡처 시작', { videoPath, atSeconds });

  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn(ffmpegPath, args, { windowsHide: true });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        log.warn('ffmpeg 캡처 타임아웃', { videoPath });
        try { proc.kill('SIGKILL'); } catch (e) {}
        resolve(null);
      }
    }, timeoutMs);

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log.warn('ffmpeg spawn 실패', { error: err.message });
      resolve(null);
    });

    proc.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        log.warn('ffmpeg 캡처 실패', { code, stderr: stderr.slice(0, 200) });
        try { await fs.unlink(tmpPath); } catch (e) {}
        resolve(null);
        return;
      }

      try {
        await fs.rename(tmpPath, outputPath);
        log.info('썸네일 캡처 성공', { outputPath });
        resolve(outputPath);
      } catch (err) {
        log.warn('썸네일 rename 실패', { error: err.message });
        resolve(null);
      }
    });
  });
}

/**
 * 썸네일 파일 삭제. 실패해도 예외 안 던짐.
 */
async function deleteThumb(userDataPath, id) {
  try {
    await fs.unlink(getThumbPath(userDataPath, id));
  } catch (e) {
    // 없어도 OK
  }
}

module.exports = {
  ensureThumbDir,
  getThumbPath,
  captureFrame,
  deleteThumb,
  THUMB_WIDTH,
  THUMB_HEIGHT
};
```

- [ ] **Step 3: Commit thumbnail capture module**

```bash
git add main/recent-thumb-capture.js
git commit -m "feat: 최근 파일 썸네일 캡처 모듈 추가

- ffmpeg로 320x180 JPEG 대표 프레임 1장 추출
- 10초 타임아웃, 실패 시 null 반환 (예외 없음)
- .tmp → rename 원자적 쓰기"
```

### Task 2.2: IPC 핸들러 추가

**Files:**
- Modify: `main/ipc-handlers.js`

- [ ] **Step 1: Verify existing imports and add new ones**

먼저 `main/ipc-handlers.js` 상단의 require 블록을 확인한다. 이미 존재하는 것:
- `const { ipcMain, dialog, app, clipboard, shell } = require('electron');` (5번째 줄 근처) — `app`, `shell`은 이미 있음
- `const { createLogger } = require('./logger');` / `const log = createLogger('IPC');` — `log`도 이미 있음

따라서 추가할 import만:

```js
const { RecentFilesStore } = require('./recent-files-store');
const recentThumbCapture = require('./recent-thumb-capture');
const Store = require('electron-store');
```

`Store`가 이미 다른 곳에서 require 되어 있지 않은지 grep으로 확인:

```bash
grep -n "require('electron-store')" main/ipc-handlers.js
```

이미 있으면 재사용, 없으면 위 3줄 추가.

- [ ] **Step 2: Add module-level store instance**

`setupIpcHandlers()` 함수 위에 한 번만 초기화되는 인스턴스 추가:

```js
// ====== 최근 파일 저장소 (모듈 스코프, 지연 초기화) ======
let recentStoreInstance = null;

function getRecentStore() {
  if (!recentStoreInstance) {
    const electronStore = new Store({
      name: 'recent-files',
      defaults: { items: [], pinned: [] }
    });
    recentStoreInstance = new RecentFilesStore({ store: electronStore });
  }
  return recentStoreInstance;
}
```

- [ ] **Step 3: Add public `updateThumbPath` method to RecentFilesStore**

`main/recent-files-store.js`의 RecentFilesStore 클래스에 메서드 추가 (remove 메서드 근처):

```js
  /**
   * 썸네일 경로만 갱신한다. openedAt/openCount는 건드리지 않는다.
   */
  updateThumbPath(id, thumbPath) {
    const items = this._readItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    items[idx] = { ...items[idx], thumbPath };
    this._writeItems(items);
    return true;
  }
```

`scripts/tests/recent-files-store.test.js` 끝에 테스트 추가:

```js
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
```

실행해서 추가된 테스트가 통과하는지 확인:

```bash
npm run test:recent
```

Expected: 모든 테스트 통과 (기존 + 2개 추가).

- [ ] **Step 4: Add IPC handler block inside setupIpcHandlers()**

`setupIpcHandlers()` 함수 내부, 다른 핸들러 블록 뒤에 추가 (예: 파일 관련 섹션 다음):

```js
  // ====== 최근 파일 ======

  ipcMain.handle('recent:list', async () => {
    try {
      return getRecentStore().list();
    } catch (err) {
      log.warn('recent:list 실패, 빈 배열 폴백', { error: err.message });
      return [];
    }
  });

  ipcMain.handle('recent:add', async (event, input) => {
    const trace = log.trace('recent:add');
    try {
      const result = getRecentStore().upsert(input);
      trace.end({ id: result.id });
      return result;
    } catch (err) {
      trace.error(err);
      throw err;
    }
  });

  ipcMain.handle('recent:remove', async (event, id) => {
    try {
      // 항목 제거 시 썸네일도 함께 삭제
      await recentThumbCapture.deleteThumb(app.getPath('userData'), id);
      getRecentStore().remove(id);
      return { success: true };
    } catch (err) {
      log.warn('recent:remove 실패', { error: err.message });
      return { success: false };
    }
  });

  ipcMain.handle('recent:clear', async () => {
    try {
      const store = getRecentStore();
      const items = store.list();
      // 모든 썸네일 삭제
      for (const item of items) {
        await recentThumbCapture.deleteThumb(app.getPath('userData'), item.id);
      }
      store.clear();
      return { success: true };
    } catch (err) {
      log.warn('recent:clear 실패', { error: err.message });
      return { success: false };
    }
  });

  ipcMain.handle('recent:togglePin', async (event, id) => {
    try {
      return getRecentStore().togglePin(id);
    } catch (err) {
      // 한계 초과 등 예외는 렌더러에 전달
      log.info('recent:togglePin 거부', { error: err.message });
      throw err;
    }
  });

  ipcMain.handle('recent:pruneMissing', async () => {
    try {
      const store = getRecentStore();
      const items = store.list();
      const fsSync = require('fs');
      const existsFn = (p) => {
        try { return fsSync.existsSync(p); } catch (e) { return false; }
      };
      const result = store.pruneMissing(existsFn);
      // 제거된 항목의 썸네일도 삭제
      for (const id of result.removedIds) {
        await recentThumbCapture.deleteThumb(app.getPath('userData'), id);
      }
      return result;
    } catch (err) {
      log.warn('recent:pruneMissing 실패', { error: err.message });
      return { removedIds: [] };
    }
  });

  ipcMain.handle('recent:openInFolder', async (event, filePath) => {
    try {
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (err) {
      return { success: false };
    }
  });

  ipcMain.handle('recent:captureThumb', async (event, videoPath, id, durationSec) => {
    try {
      const userData = app.getPath('userData');
      await recentThumbCapture.ensureThumbDir(userData);
      const outputPath = recentThumbCapture.getThumbPath(userData, id);
      const atSeconds = Math.max(0, (durationSec || 0) * 0.5);

      const result = await recentThumbCapture.captureFrame({
        videoPath, outputPath, atSeconds
      });

      if (result) {
        getRecentStore().updateThumbPath(id, `${id}.jpg`);
        return { thumbPath: `${id}.jpg` };
      }
      return { thumbPath: null };
    } catch (err) {
      log.warn('recent:captureThumb 실패', { error: err.message });
      return { thumbPath: null };
    }
  });

  ipcMain.handle('recent:getThumbUrl', async (event, id) => {
    try {
      const userData = app.getPath('userData');
      const thumbPath = recentThumbCapture.getThumbPath(userData, id);
      const fsSync = require('fs');
      if (!fsSync.existsSync(thumbPath)) return null;
      // file:// URL로 반환 (Windows 경로 변환)
      return 'file:///' + thumbPath.replace(/\\/g, '/');
    } catch (err) {
      return null;
    }
  });
```

- [ ] **Step 5: Syntax check**

```bash
node --check main/ipc-handlers.js
```

Expected: 에러 없이 통과.

- [ ] **Step 6: Commit IPC handlers and store updateThumbPath**

```bash
git add main/ipc-handlers.js main/recent-files-store.js scripts/tests/recent-files-store.test.js
git commit -m "feat: 최근 파일 IPC 핸들러 9개 추가

- recent:list/add/remove/clear/togglePin/pruneMissing
- recent:openInFolder/captureThumb/getThumbUrl
- 저장소에 updateThumbPath 공개 메서드 추가 + 테스트"
```

### Task 2.3: preload 브릿지 추가

**Files:**
- Modify: `preload/preload.js`

- [ ] **Step 1: Add recent* methods to electronAPI**

`preload/preload.js`에서 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 객체 내부에 추가 (기존 `// ====== 썸네일 캐시 관련 ======` 블록 뒤):

```js
  // ====== 최근 파일 관련 ======
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentAdd: (input) => ipcRenderer.invoke('recent:add', input),
  recentRemove: (id) => ipcRenderer.invoke('recent:remove', id),
  recentClear: () => ipcRenderer.invoke('recent:clear'),
  recentTogglePin: (id) => ipcRenderer.invoke('recent:togglePin', id),
  recentPruneMissing: () => ipcRenderer.invoke('recent:pruneMissing'),
  recentOpenInFolder: (filePath) => ipcRenderer.invoke('recent:openInFolder', filePath),
  recentCaptureThumb: (videoPath, id, durationSec) =>
    ipcRenderer.invoke('recent:captureThumb', videoPath, id, durationSec),
  recentGetThumbUrl: (id) => ipcRenderer.invoke('recent:getThumbUrl', id),
  onRecentUpdated: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('recent:updated', handler);
    return () => ipcRenderer.removeListener('recent:updated', handler);
  },
```

- [ ] **Step 2: Verify preload syntax**

```bash
node -c preload/preload.js
```

Expected: 에러 없음.

- [ ] **Step 3: Commit preload changes**

```bash
git add preload/preload.js
git commit -m "feat: 최근 파일 IPC 브릿지를 preload에 노출"
```

### Task 2.4: 앱 시작 시 pruneMissing 호출

**Files:**
- Modify: `main/index.js`

- [ ] **Step 1: Locate app ready handler**

```bash
grep -n "app.whenReady\|app.on('ready'" main/index.js
```

app ready 이후 초기화 블록을 찾는다.

- [ ] **Step 2: Extract `pruneMissingRecentFiles` as a public function in ipc-handlers.js**

`main/ipc-handlers.js`에서 `getRecentStore()` 함수 아래, `setupIpcHandlers()` 시작 전에 공개 함수 추가:

```js
/**
 * 존재하지 않는 파일 경로를 일괄 정리. main에서 직접 호출 가능.
 */
async function pruneMissingRecentFiles() {
  try {
    const store = getRecentStore();
    const fsSync = require('fs');
    const existsFn = (p) => {
      try { return fsSync.existsSync(p); } catch (e) { return false; }
    };
    const result = store.pruneMissing(existsFn);
    for (const id of result.removedIds) {
      await recentThumbCapture.deleteThumb(app.getPath('userData'), id);
    }
    return result;
  } catch (err) {
    log.warn('pruneMissingRecentFiles 실패', { error: err.message });
    return { removedIds: [] };
  }
}
```

그리고 Task 2.2 Step 4에서 추가한 `recent:pruneMissing` 핸들러 본문을 얇은 래퍼로 교체:

```js
  ipcMain.handle('recent:pruneMissing', async () => {
    return await pruneMissingRecentFiles();
  });
```

파일 하단 `module.exports`를 확인한다. grep으로 현재 형태 확인:

```bash
grep -n "module.exports" main/ipc-handlers.js
```

현재 `module.exports = setupIpcHandlers;` 같은 단일 export면 객체 형태로 변경:

```js
module.exports = {
  setupIpcHandlers,
  pruneMissingRecentFiles
};
```

이미 객체 형태면 `pruneMissingRecentFiles`만 추가한다.

**주의**: `module.exports`를 객체로 바꾸면 기존 import 지점이 깨질 수 있다. grep으로 확인:

```bash
grep -rn "require('./ipc-handlers')\|require('../main/ipc-handlers')" main/
```

기존 import가 `const setupIpcHandlers = require('./ipc-handlers');` 형태면 `const { setupIpcHandlers } = require('./ipc-handlers');`로 함께 수정한다.

- [ ] **Step 3: Add pruneMissing call in main/index.js**

app ready 블록, `setupIpcHandlers()` 호출 뒤에 추가:

```js
  // 최근 파일 목록 정리 (경로가 없어진 항목 제거)
  // 비동기로 실행하고 실패해도 앱 시작을 막지 않는다
  setImmediate(async () => {
    try {
      const { pruneMissingRecentFiles } = require('./ipc-handlers');
      const result = await pruneMissingRecentFiles();
      log.info('시작 시 pruneMissing 완료', result);
    } catch (err) {
      log.warn('시작 시 pruneMissing 실패', { error: err.message });
    }
  });
```

- [ ] **Step 4: Verify main process still starts**

```bash
node --check main/index.js
node --check main/ipc-handlers.js
```

Expected: 에러 없음. (실제 실행은 Phase 5에서 수동 QA)

- [ ] **Step 5: Commit**

```bash
git add main/index.js main/ipc-handlers.js
git commit -m "feat: 앱 시작 시 최근 파일 자동 정리

- pruneMissingRecentFiles 함수 분리 (재사용 가능)
- 시작 시 비동기 호출, 실패해도 앱 시작 차단 안 함"
```

---

## Chunk 3: 렌더러 모듈과 스타일

이 청크는 DOM 조작 없는 얇은 매니저와 DOM 전담 뷰를 분리해 작성한다.

### Task 3.1: Manager 모듈

**Files:**
- Create: `renderer/scripts/modules/recent-files-manager.js`

- [ ] **Step 1: Write the manager module**

전체 내용:

```js
/**
 * baeframe - Recent Files Manager
 *
 * IPC 래핑 + 이벤트 발행. DOM 조작은 하지 않는다.
 * 뷰(recent-files-view)가 이 매니저의 'updated' 이벤트를 구독해 재렌더링한다.
 */

import { createLogger } from '../logger.js';

const log = createLogger('RecentFilesManager');

export class RecentFilesManager extends EventTarget {
  constructor() {
    super();
    this._items = [];
    this._thumbCaptureQueue = new Set(); // 동시 캡처 제어용
    this._maxConcurrentCaptures = 2;
    this._activeCaptures = 0;
    this._pendingCaptures = [];
  }

  /**
   * 현재 메모리 캐시된 목록을 반환. 비동기 로드 전엔 빈 배열.
   */
  getCached() {
    return this._items;
  }

  /**
   * IPC로 전체 목록을 조회해 캐시를 갱신하고 updated 이벤트를 방출한다.
   */
  async refresh() {
    try {
      this._items = await window.electronAPI.recentList();
      this._emitUpdated();
      return this._items;
    } catch (err) {
      log.warn('recent list 조회 실패', { error: err.message });
      this._items = [];
      this._emitUpdated();
      return [];
    }
  }

  /**
   * 파일을 최근 목록에 추가한다. 썸네일 캡처는 백그라운드에서 진행.
   * loadVideo 성공 후 호출한다.
   *
   * @param {object} input - { path, name, dir, ext, size, duration }
   */
  async add(input) {
    if (!input || !input.path) return;

    try {
      const { id, item } = await window.electronAPI.recentAdd(input);
      await this.refresh();

      // 이미 썸네일이 있으면 스킵, 없으면 캡처 트리거
      if (!item || !item.thumbPath) {
        this._enqueueThumbCapture({ videoPath: input.path, id, durationSec: input.duration });
      }
    } catch (err) {
      log.warn('recent add 실패', { error: err.message });
    }
  }

  async remove(id) {
    try {
      await window.electronAPI.recentRemove(id);
      await this.refresh();
    } catch (err) {
      log.warn('recent remove 실패', { error: err.message });
    }
  }

  async clear() {
    try {
      await window.electronAPI.recentClear();
      await this.refresh();
    } catch (err) {
      log.warn('recent clear 실패', { error: err.message });
    }
  }

  async togglePin(id) {
    try {
      const result = await window.electronAPI.recentTogglePin(id);
      await this.refresh();
      return result;
    } catch (err) {
      // "고정은 최대 5개까지 가능합니다" 같은 비즈니스 예외
      throw err;
    }
  }

  async openInFolder(filePath) {
    try {
      return await window.electronAPI.recentOpenInFolder(filePath);
    } catch (err) {
      log.warn('openInFolder 실패', { error: err.message });
      return { success: false };
    }
  }

  /**
   * 주어진 id에 대한 썸네일 file:// URL을 반환. 없으면 null.
   */
  async getThumbUrl(id) {
    try {
      return await window.electronAPI.recentGetThumbUrl(id);
    } catch (err) {
      return null;
    }
  }

  // ---- 내부: 썸네일 캡처 동시성 제어 ----

  _enqueueThumbCapture(task) {
    if (this._thumbCaptureQueue.has(task.id)) return; // 중복 방지
    this._thumbCaptureQueue.add(task.id);
    this._pendingCaptures.push(task);
    this._drainCaptureQueue();
  }

  _drainCaptureQueue() {
    while (this._activeCaptures < this._maxConcurrentCaptures && this._pendingCaptures.length > 0) {
      const task = this._pendingCaptures.shift();
      this._activeCaptures++;
      this._runCapture(task).finally(() => {
        this._activeCaptures--;
        this._thumbCaptureQueue.delete(task.id);
        this._drainCaptureQueue();
      });
    }
  }

  async _runCapture(task) {
    try {
      const result = await window.electronAPI.recentCaptureThumb(
        task.videoPath, task.id, task.durationSec || 0
      );
      if (result && result.thumbPath) {
        log.debug('썸네일 캡처 완료', { id: task.id });
        // 목록 다시 로드해 thumbPath 반영
        await this.refresh();
      }
    } catch (err) {
      log.warn('썸네일 캡처 예외', { error: err.message });
    }
  }

  _emitUpdated() {
    this.dispatchEvent(new CustomEvent('updated', { detail: { items: this._items } }));
  }
}

// 싱글턴 인스턴스
let instance = null;

export function getRecentFilesManager() {
  if (!instance) {
    instance = new RecentFilesManager();
  }
  return instance;
}
```

- [ ] **Step 2: Verify syntax**

```bash
node -c renderer/scripts/modules/recent-files-manager.js
```

ES module이라 `node -c`가 실패할 수 있다. 그 경우 다음으로 대체:

```bash
node --input-type=module -e "$(cat renderer/scripts/modules/recent-files-manager.js)"
```

에러 없이 종료하면 OK (런타임 에러는 문서/브라우저 참조가 없어서 발생할 수 있으므로 문법 에러만 확인).

- [ ] **Step 3: Commit**

```bash
git add renderer/scripts/modules/recent-files-manager.js
git commit -m "feat: 최근 파일 매니저 모듈 추가

- IPC 래핑, EventTarget 상속
- 썸네일 캡처 동시성 2개 제한
- refresh/add/remove/clear/togglePin/openInFolder 공개 API"
```

### Task 3.2: View 모듈

**Files:**
- Create: `renderer/scripts/modules/recent-files-view.js`

- [ ] **Step 1: Write the view module**

전체 내용:

```js
/**
 * baeframe - Recent Files View
 *
 * DOM 렌더링 전담. 비즈니스 로직은 매니저에 위임한다.
 * 이벤트 위임으로 카드 클릭/핀/제거 처리.
 */

import { createLogger } from '../logger.js';

const log = createLogger('RecentFilesView');

// ---- SVG 아이콘 (stroke 스타일) ----

const SVG = {
  clock: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  bookmark: (filled) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  film: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>`,
  music: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
};

const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'];

function isAudioExt(ext) {
  return AUDIO_EXTS.includes(String(ext || '').toLowerCase());
}

// ---- 상대 시각 포맷 ----

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  const hour = Math.floor(diffMs / 3600000);
  const day = Math.floor(diffMs / 86400000);

  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  if (hour < 24) return `${hour}시간 전`;
  if (day === 1) return '어제';
  if (day < 7) return `${day}일 전`;
  if (day < 14) return '지난주';
  if (day < 30) return `${Math.floor(day / 7)}주 전`;
  if (day < 365) return `${Math.floor(day / 30)}개월 전`;
  return '오래 전';
}

function formatDuration(sec) {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---- 안전한 HTML 이스케이프 ----

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- 카드 HTML 생성 ----

function renderCard(item, { compact = false, missing = false } = {}) {
  const audio = isAudioExt(item.ext);
  const fallbackIcon = audio ? SVG.music : SVG.film;
  const missingClass = missing ? ' recent-card-missing' : '';
  const pinnedBadge = item._pinned
    ? `<div class="recent-card-pin-badge" title="고정됨">${SVG.bookmark(true)}</div>`
    : '';
  const missingOverlay = missing
    ? `<div class="recent-card-missing-overlay">${SVG.alert}</div>`
    : '';

  // thumbPath가 있으면 IPC로 URL을 비동기 로드, 없으면 폴백 아이콘
  const thumbContent = item.thumbPath
    ? `<img class="recent-card-thumb-img" data-thumb-id="${escapeHtml(item.id)}" alt="">`
    : `<div class="recent-card-thumb-fallback">${fallbackIcon}</div>`;

  const duration = formatDuration(item.duration);
  const meta = duration
    ? `${escapeHtml(item.dir)} · ${duration}`
    : escapeHtml(item.dir);

  return `
    <div class="recent-card${missingClass}" data-id="${escapeHtml(item.id)}" data-path="${escapeHtml(item.path)}" data-pinned="${item._pinned ? 'true' : 'false'}" role="listitem" tabindex="0">
      <div class="recent-card-thumb">
        ${thumbContent}
        ${pinnedBadge}
        ${missingOverlay}
      </div>
      <div class="recent-card-body">
        <div class="recent-card-name">${escapeHtml(item.name)}</div>
        <div class="recent-card-meta">${meta}</div>
      </div>
      <div class="recent-card-time">${formatRelativeTime(item.openedAt)}</div>
      <div class="recent-card-actions">
        <button class="recent-card-action recent-action-pin" data-action="pin" title="${item._pinned ? '고정 해제' : '고정'}">${SVG.bookmark(item._pinned)}</button>
        <button class="recent-card-action recent-action-remove" data-action="remove" title="목록에서 제거">${SVG.x}</button>
      </div>
    </div>
  `;
}

// ---- 빈 상태 렌더링 (드롭존 내부) ----

export function renderEmptyState(container, items, { onLoadMore } = {}) {
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  const pinned = items.filter(i => i._pinned);
  const regular = items.filter(i => !i._pinned);
  const VIEWPORT = 8;
  const visibleRegular = regular.slice(0, Math.max(0, VIEWPORT - pinned.length));
  const hasMore = regular.length > visibleRegular.length;

  const pinnedSection = pinned.length > 0 ? `
    <div class="recent-section-label">${SVG.bookmark(true)} 고정</div>
    <div class="recent-cards" role="list">
      ${pinned.map(i => renderCard(i)).join('')}
    </div>
  ` : '';

  const regularSection = `
    <div class="recent-section-label">최근</div>
    <div class="recent-cards" role="list">
      ${visibleRegular.map(i => renderCard(i)).join('')}
    </div>
    ${hasMore ? `<button class="recent-load-more">더 보기 ${SVG.chevron}</button>` : ''}
  `;

  container.innerHTML = `
    <div class="recent-empty-header">${SVG.clock} 최근 파일</div>
    ${pinnedSection}
    ${regularSection}
    <div class="recent-empty-footer">
      <button class="recent-clear-all">모두 지우기</button>
    </div>
  `;

  // 썸네일 이미지 URL 비동기 로드
  _loadThumbnails(container);
}

// ---- 드롭다운 패널 렌더링 ----

export function renderDropdown(container, items) {
  if (!container) return;

  const pinned = items.filter(i => i._pinned);
  const regular = items.filter(i => !i._pinned);

  const pinnedSection = pinned.length > 0 ? `
    <div class="recent-dropdown-section">
      <div class="recent-dropdown-section-label">${SVG.bookmark(true)} 고정</div>
      <div class="recent-cards" role="list">
        ${pinned.map(i => renderCard(i, { compact: true })).join('')}
      </div>
    </div>
    <div class="recent-dropdown-divider"></div>
  ` : '';

  const regularSection = regular.length > 0 ? `
    <div class="recent-dropdown-section">
      <div class="recent-cards" role="list">
        ${regular.map(i => renderCard(i, { compact: true })).join('')}
      </div>
    </div>
  ` : '<div class="recent-dropdown-empty">최근 항목이 없습니다</div>';

  container.innerHTML = `
    <div class="recent-dropdown-header">${SVG.clock} 최근 파일</div>
    ${pinnedSection}
    ${regularSection}
    <div class="recent-dropdown-divider"></div>
    <button class="recent-dropdown-action" data-action="open-other">${SVG.folder} 다른 파일 열기…</button>
  `;

  _loadThumbnails(container);
}

// ---- 썸네일 로드 ----

async function _loadThumbnails(root) {
  const imgs = root.querySelectorAll('img.recent-card-thumb-img[data-thumb-id]');
  for (const img of imgs) {
    const id = img.getAttribute('data-thumb-id');
    try {
      const url = await window.electronAPI.recentGetThumbUrl(id);
      if (url) {
        img.src = url;
      } else {
        // URL 없음 → 폴백으로 교체
        const parent = img.parentElement;
        if (parent) {
          parent.innerHTML = SVG.film;
          parent.classList.add('recent-card-thumb-fallback');
        }
      }
    } catch (e) {
      log.debug('썸네일 URL 조회 실패', { id });
    }
  }
}

// ---- 이벤트 위임 바인딩 ----

/**
 * 한 번만 호출해 container 범위에 이벤트 위임을 설정한다.
 *
 * @param {HTMLElement} container
 * @param {object} handlers - { onOpen, onPin, onRemove, onClearAll, onLoadMore, onOpenOther }
 */
export function bindEvents(container, handlers = {}) {
  if (!container) return;

  container.addEventListener('click', async (e) => {
    // 액션 버튼 클릭
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.getAttribute('data-action');
      const card = actionBtn.closest('.recent-card');

      if (action === 'pin' && card) {
        handlers.onPin?.(card.getAttribute('data-id'));
        return;
      }
      if (action === 'remove' && card) {
        handlers.onRemove?.(card.getAttribute('data-id'));
        return;
      }
      if (action === 'open-other') {
        handlers.onOpenOther?.();
        return;
      }
    }

    // 모두 지우기
    if (e.target.closest('.recent-clear-all')) {
      handlers.onClearAll?.();
      return;
    }

    // 더 보기
    if (e.target.closest('.recent-load-more')) {
      handlers.onLoadMore?.();
      return;
    }

    // 카드 본체 클릭 → 열기
    const card = e.target.closest('.recent-card');
    if (card) {
      const missing = card.classList.contains('recent-card-missing');
      handlers.onOpen?.({
        id: card.getAttribute('data-id'),
        path: card.getAttribute('data-path'),
        missing
      });
    }
  });

  // 키보드: Enter = 열기, Delete = 제거, Shift+P = 핀
  container.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.recent-card');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const missing = card.classList.contains('recent-card-missing');
      handlers.onOpen?.({
        id: card.getAttribute('data-id'),
        path: card.getAttribute('data-path'),
        missing
      });
    } else if (e.key === 'Delete') {
      e.preventDefault();
      handlers.onRemove?.(card.getAttribute('data-id'));
    } else if (e.key === 'P' && e.shiftKey) {
      e.preventDefault();
      handlers.onPin?.(card.getAttribute('data-id'));
    }
  });
}
```

- [ ] **Step 2: Commit view module**

```bash
git add renderer/scripts/modules/recent-files-view.js
git commit -m "feat: 최근 파일 뷰 모듈 추가

- renderEmptyState / renderDropdown 두 렌더 모드
- 인라인 SVG 아이콘 (clock, bookmark, x, alert, folder, film, music)
- 이벤트 위임 바인딩, 키보드 접근성
- 비동기 썸네일 URL 로드"
```

### Task 3.3: 전용 스타일시트

**Files:**
- Create: `renderer/styles/recent-files.css`
- Modify: `renderer/styles/main.css`

- [ ] **Step 1: Inspect existing CSS tokens**

```bash
grep -n "^:root\|--color-\|--bg-\|--text-" renderer/styles/main.css | head -30
```

기존에 쓰는 CSS 변수 이름을 확인하고 재사용한다. 없으면 inline 값 사용.

- [ ] **Step 2: Write recent-files.css**

전체 내용:

```css
/* ============================================================
 * baeframe — Recent Files Styles
 *
 * 카드, 썸네일, 호버 액션, 누락 상태, 드롭다운 패널 스타일.
 * 기존 version-dropdown 토큰과 시각적으로 일관되게 유지.
 * ============================================================ */

/* ---------- 드롭존 내부 섹션 ---------- */

#recentFilesSection {
  margin-top: 32px;
  max-width: 720px;
  width: 100%;
}

.recent-empty-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  opacity: 0.65;
  margin-bottom: 14px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.recent-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  opacity: 0.55;
  margin: 14px 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.recent-cards {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recent-empty-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.recent-clear-all {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.45;
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  transition: opacity 0.15s, background 0.15s;
}

.recent-clear-all:hover {
  opacity: 0.85;
  background: rgba(255, 255, 255, 0.06);
}

.recent-load-more {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: inherit;
  font-size: 11px;
  padding: 6px 10px;
  margin-top: 8px;
  cursor: pointer;
  border-radius: 6px;
  opacity: 0.7;
  transition: all 0.15s;
}

.recent-load-more:hover {
  opacity: 1;
  border-color: rgba(255, 255, 255, 0.18);
}

/* ---------- 카드 ---------- */

.recent-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
}

.recent-card:hover,
.recent-card:focus-visible {
  background: rgba(255, 255, 255, 0.06);
  outline: none;
}

.recent-card:focus-visible {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}

.recent-card-thumb {
  position: relative;
  flex-shrink: 0;
  width: 80px;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(60, 50, 90, 0.5), rgba(26, 26, 46, 0.8));
  display: flex;
  align-items: center;
  justify-content: center;
}

.recent-card-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.recent-card-thumb-fallback {
  opacity: 0.35;
}

.recent-card-pin-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(0, 0, 0, 0.55);
  padding: 2px 3px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.recent-card-missing-overlay {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.55);
  padding: 2px 3px;
  border-radius: 3px;
  color: #ffb83b;
  display: flex;
  pointer-events: none;
}

.recent-card-body {
  flex: 1;
  min-width: 0;
}

.recent-card-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-card-meta {
  font-size: 11px;
  opacity: 0.55;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-card-time {
  font-size: 11px;
  opacity: 0.5;
  flex-shrink: 0;
  white-space: nowrap;
}

.recent-card-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.recent-card:hover .recent-card-actions,
.recent-card:focus-within .recent-card-actions {
  opacity: 1;
}

.recent-card-action {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.12s;
}

.recent-card-action:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

/* 누락 파일 */
.recent-card-missing {
  opacity: 0.5;
}

.recent-card-missing:hover {
  opacity: 0.7;
}

/* ---------- 헤더 드롭다운 버튼 ---------- */

#btnRecentFiles {
  display: flex;
  align-items: center;
  gap: 2px;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.65;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

#btnRecentFiles:hover,
#btnRecentFiles.active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
}

/* ---------- 드롭다운 패널 ---------- */

.recent-dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  min-width: 360px;
  max-width: 480px;
  max-height: 480px;
  overflow-y: auto;
  background: rgba(22, 22, 28, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  padding: 8px 0;
  display: none;
}

.recent-dropdown-menu.open {
  display: block;
}

.recent-dropdown-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px 10px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.recent-dropdown-section {
  padding: 0 6px;
}

.recent-dropdown-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  opacity: 0.5;
  padding: 4px 8px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.recent-dropdown-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 6px 8px;
}

.recent-dropdown-empty {
  padding: 20px;
  text-align: center;
  opacity: 0.5;
  font-size: 12px;
}

.recent-dropdown-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  margin: 0 6px;
  padding: 8px 10px;
  background: none;
  border: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.12s;
}

.recent-dropdown-action:hover {
  background: rgba(255, 255, 255, 0.06);
}

/* 드롭다운 내부 카드는 컴팩트 버전 */
.recent-dropdown-menu .recent-card {
  padding: 6px 8px;
}

.recent-dropdown-menu .recent-card-thumb {
  width: 64px;
}
```

- [ ] **Step 3: Import in main.css**

`renderer/styles/main.css` 파일 최상단에 한 줄 추가 (첫 `@import` 바로 뒤 또는 맨 위):

```css
@import url('./recent-files.css');
```

- [ ] **Step 4: Commit styles**

```bash
git add renderer/styles/recent-files.css renderer/styles/main.css
git commit -m "style: 최근 파일 전용 스타일시트 추가

- 카드, 썸네일, 호버 액션, 누락 상태
- 헤더 드롭다운 버튼과 패널
- 기존 version-dropdown과 시각 토큰 일관성 유지"
```

---

## Chunk 4: HTML/app.js 통합과 수동 QA

이 청크는 신규 모듈들을 기존 UI에 연결하고, 스펙 섹션 9.1의 수동 테스트 시나리오를 수행한다.

### Task 4.1: HTML 구조 추가

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: Add header button next to logo**

`renderer/index.html`에서 `<div class="header-left">` 내부, `<div class="logo">...</div>` 블록 바로 뒤에 추가:

```html
        <button id="btnRecentFiles" title="최근 파일" aria-label="최근 파일 열기">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="recent-dropdown-menu" id="recentDropdownMenu" role="menu" aria-label="최근 파일">
          <!-- renderDropdown()으로 동적 채움 -->
        </div>
```

**배치 주의**: `#btnRecentFiles`는 `.logo` 바로 우측, 그리고 `#recentDropdownMenu`는 그 다음에 오되 `position: absolute`이므로 DOM 순서만 맞으면 된다.

- [ ] **Step 2: Add recent section inside dropzone**

`renderer/index.html`에서 `<div class="drop-zone-content">` 블록 내부, `<button ... id="btnOpenFile">` 블록 바로 뒤, `</div>` (drop-zone-content 닫는 태그) 바로 앞에 추가:

```html
              <section id="recentFilesSection" aria-label="최근 파일" style="display: none;">
                <!-- renderEmptyState()으로 동적 채움 -->
              </section>
```

- [ ] **Step 3: Verify HTML is still parseable**

브라우저에서 DevTools 없이 확인하긴 어려우므로, 파일 열고 닫는 태그 쌍만 점검:

```bash
grep -c "<div class=\"drop-zone-content\">" renderer/index.html
```

한 번만 나와야 한다. 닫는 `</div>`와 쌍이 맞는지는 다음 수동 실행에서 간접 확인.

- [ ] **Step 4: Commit HTML changes**

```bash
git add renderer/index.html
git commit -m "feat: 최근 파일 UI 구조 HTML에 추가

- 헤더 btnRecentFiles 버튼과 드롭다운 컨테이너
- 드롭존 내부 recentFilesSection"
```

### Task 4.2: app.js 초기화 및 이벤트 바인딩

**Files:**
- Modify: `renderer/scripts/app.js`

- [ ] **Step 1: Import the new modules**

`renderer/scripts/app.js` 파일 상단의 다른 `import` 문 근처에 추가:

```js
import { getRecentFilesManager } from './modules/recent-files-manager.js';
import * as recentFilesView from './modules/recent-files-view.js';
```

- [ ] **Step 2: Add element references**

`const elements = { ... }` 블록에 추가:

```js
    btnRecentFiles: document.getElementById('btnRecentFiles'),
    recentDropdownMenu: document.getElementById('recentDropdownMenu'),
    recentFilesSection: document.getElementById('recentFilesSection'),
```

- [ ] **Step 3: Create manager instance and wire up rendering**

`app.js`의 초기화 블록 (기존 매니저들이 생성되는 곳)에 추가:

```js
  // ====== 최근 파일 매니저 초기화 ======
  const recentFilesManager = getRecentFilesManager();

  // 빈 상태 & 드롭다운 재렌더링 헬퍼
  function renderRecentFiles() {
    const items = recentFilesManager.getCached();
    recentFilesView.renderEmptyState(elements.recentFilesSection, items);
    if (elements.recentDropdownMenu.classList.contains('open')) {
      recentFilesView.renderDropdown(elements.recentDropdownMenu, items);
    }
  }

  // 공통 핸들러 (빈 상태와 드롭다운 둘 다 공유)
  const recentHandlers = {
    onOpen: async ({ path, missing }) => {
      if (missing) {
        if (confirm('파일을 찾을 수 없습니다. 목록에서 제거할까요?')) {
          const items = recentFilesManager.getCached();
          const match = items.find(i => i.path === path);
          if (match) await recentFilesManager.remove(match.id);
        }
        return;
      }
      // 드롭다운 닫기
      elements.recentDropdownMenu.classList.remove('open');
      elements.btnRecentFiles?.classList.remove('active');
      await loadVideo(path);
    },
    onPin: async (id) => {
      try {
        await recentFilesManager.togglePin(id);
      } catch (err) {
        showToast(err.message || '고정 실패', 'error');
      }
    },
    onRemove: async (id) => {
      await recentFilesManager.remove(id);
    },
    onClearAll: async () => {
      if (confirm('최근 파일 목록을 모두 지울까요?')) {
        await recentFilesManager.clear();
      }
    },
    onLoadMore: () => {
      // MVP: view 모듈에 expanded 상태 미구현. Phase 2로 보류 (열린 질문 #1).
      // 대신 헤더 드롭다운을 안내하는 토스트 표시 (BAEFRAME은 네이티브 alert 사용 안 함).
      showToast('더 많은 항목은 헤더의 최근 파일 버튼에서 확인하세요.', 'info');
    },
    onOpenOther: async () => {
      elements.recentDropdownMenu.classList.remove('open');
      elements.btnRecentFiles?.classList.remove('active');
      try {
        const result = await window.electronAPI.openFileDialog();
        if (!result.canceled && result.filePaths.length > 0) {
          await loadVideo(result.filePaths[0]);
        }
      } catch (error) {
        showToast('파일을 열 수 없습니다.', 'error');
      }
    }
  };

  // 이벤트 위임 바인딩 (두 컨테이너 모두)
  if (elements.recentFilesSection) {
    recentFilesView.bindEvents(elements.recentFilesSection, recentHandlers);
  }
  if (elements.recentDropdownMenu) {
    recentFilesView.bindEvents(elements.recentDropdownMenu, recentHandlers);
  }

  // 매니저 updated 이벤트 구독
  recentFilesManager.addEventListener('updated', renderRecentFiles);

  // 초기 로드
  recentFilesManager.refresh();
```

- [ ] **Step 4: Wire up header button toggle**

먼저 기존 keydown 리스너가 있는지 확인:

```bash
grep -n "addEventListener('keydown'" renderer/scripts/app.js
```

- 결과가 없거나 별도의 전역 핸들러가 없으면 아래 블록을 그대로 추가.
- 결과가 있고 이미 Esc 처리를 하고 있으면, 기존 핸들러 내부에 아래 Esc 블록만 병합한다 (중복 `addEventListener('keydown', ...)`는 금지).

app.js의 이벤트 리스너 섹션에 추가:

```js
  // 헤더 최근 파일 버튼 토글
  elements.btnRecentFiles?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = elements.recentDropdownMenu;
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      menu.classList.remove('open');
      elements.btnRecentFiles.classList.remove('active');
    } else {
      // 열기 전에 최신 목록 렌더
      recentFilesView.renderDropdown(menu, recentFilesManager.getCached());
      menu.classList.add('open');
      elements.btnRecentFiles.classList.add('active');
    }
  });

  // 바깥 클릭으로 드롭다운 닫기
  document.addEventListener('click', (e) => {
    const menu = elements.recentDropdownMenu;
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(e.target)) return;
    if (elements.btnRecentFiles?.contains(e.target)) return;
    menu.classList.remove('open');
    elements.btnRecentFiles?.classList.remove('active');
  });

  // Esc로 드롭다운 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.recentDropdownMenu?.classList.contains('open')) {
      elements.recentDropdownMenu.classList.remove('open');
      elements.btnRecentFiles?.classList.remove('active');
    }
  });
```

- [ ] **Step 5: Hook loadVideo() success point**

먼저 정확한 삽입 위치를 grep으로 확인 (앞선 수정들로 라인 번호가 이동했을 수 있음):

```bash
grep -n "trace.end({ filePath, hasExistingData" renderer/scripts/app.js
```

Expected: 한 줄만 매치 (현재 약 3955번 줄). 매치된 라인 번호를 기록하고, 그 **바로 앞**에 추가:

```js
      // ====== 최근 파일 목록에 추가 ======
      // loadVideo 전체 흐름이 성공한 후에만 기록
      try {
        recentFilesManager.add({
          path: filePath,
          name: fileInfo.name,
          dir: fileInfo.dir,
          ext: fileInfo.ext,
          size: fileInfo.size,
          duration: videoPlayer.duration || 0
        });
      } catch (recErr) {
        log.warn('최근 파일 기록 실패', { error: recErr.message });
      }
```

**주의**: `fileInfo`는 loadVideo 초반에 `await window.electronAPI.getFileInfo(filePath)`로 얻은 변수이므로 스코프 내에 있다. `videoPlayer.duration`은 오디오/비디오 로드 후 사용 가능. 만약 duration이 아직 0이면 매니저 내부에서 나중에 updateDuration 호출을 검토 (현재 스펙의 열린 질문 #5).

- [ ] **Step 6: Quick smoke — syntax and startup**

```bash
npm run lint 2>&1 | head -40
```

Expected: 새로 추가한 코드에 에러 없음. 경고는 허용.

- [ ] **Step 7: Commit integration**

```bash
git add renderer/scripts/app.js
git commit -m "feat: 최근 파일 기능을 app.js에 통합

- getRecentFilesManager 인스턴스 생성 및 refresh
- 빈 상태/드롭다운 렌더링 헬퍼
- 헤더 버튼 토글, 바깥 클릭/Esc 닫기
- loadVideo 성공 지점에서 add 호출"
```

### Task 4.3: 수동 QA

**Files:**
- Test manually

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

DevTools가 자동으로 열리고 에러가 없어야 한다. 콘솔에 `RecentFilesManager` 또는 `RecentFilesView` 관련 에러가 있으면 수정 후 재시작.

- [ ] **Step 2: QA 시나리오 체크리스트**

스펙 섹션 9.1의 10개 시나리오를 순차 확인한다.

- [ ] **1. 기본 추가**: 새 영상 파일 열기 → 앱 재시작 → 목록에 해당 항목 보임 (썸네일 포함)
- [ ] **2. 중복 열기**: 같은 파일 여러 번 열기 → 하나의 항목만 존재, 시각만 갱신
- [ ] **3. 용량 트림**: 11개째 비고정 항목 열기 → 가장 오래된 비고정이 사라짐
- [ ] **4. 고정**: 임의 항목 고정 → 재시작 후에도 상단 유지, 자동 트림 대상 제외
- [ ] **5. 고정 한계**: 6번째 고정 시도 → 토스트 "고정은 최대 5개까지 가능합니다"
- [ ] **6. 파일 이동/삭제**: 목록에 있는 파일을 OS에서 이동하거나 삭제 → 앱 재시작 시 해당 항목이 자동 정리되거나, 재방문 시 회색 처리 + 클릭 시 제거 확인 다이얼로그
- [ ] **7. 전체 지우기**: 빈 상태 우측 하단 버튼 → 섹션 전체 사라짐
- [ ] **8. 헤더 드롭다운**: 파일 열린 상태에서 시계 버튼 클릭 → 패널 표시, Esc 닫힘, 바깥 클릭 닫힘
- [ ] **9. 드래그앤드롭 호환**: 드롭존 위 리스트 영역에서 파일 드롭 → 정상 로드
- [ ] **10. 오디오 파일**: mp3/wav 열기 → 썸네일 대신 music 아이콘 표시

각 항목 통과 시 DEVLOG 파일 Phase 5 상태를 ✅로 갱신.

- [ ] **Step 3: Fix any issues found**

실패한 항목에 대해:
1. DevTools 콘솔에서 에러 확인
2. 관련 모듈(main/store, capture, manager, view) 중 원인 특정
3. 수정 후 `npm run dev` 재실행
4. 해당 시나리오 재확인

- [ ] **Step 4: Update DEVLOG with results**

`DEVLOG/최근-연-파일-기능-개발.md`의 요약 테이블에서 모든 Phase 상태를 ✅로 변경하고, 하단에 QA 결과 요약 추가:

```markdown
## QA 결과 (2026-04-09)

- [x] 1. 기본 추가
- [x] 2. 중복 열기
- [x] 3. 용량 트림
- [x] 4. 고정
- [x] 5. 고정 한계
- [x] 6. 파일 이동/삭제
- [x] 7. 전체 지우기
- [x] 8. 헤더 드롭다운
- [x] 9. 드래그앤드롭 호환
- [x] 10. 오디오 파일

모든 시나리오 통과. 기능 완료.
```

- [ ] **Step 5: Final commit**

```bash
git add "DEVLOG/최근-연-파일-기능-개발.md"
git commit -m "docs: 최근 연 파일 기능 QA 완료 및 DEVLOG 업데이트"
```

---

## 완료 기준

1. `npm run test:recent` — 모든 단위 테스트 통과
2. `npm run lint` — 새로 추가한 코드에 에러 없음
3. `npm run dev` — 앱 정상 시작, DevTools 콘솔에 에러 없음
4. 스펙 섹션 9.1의 10개 수동 QA 시나리오 모두 통과
5. 기존 기능(재생목록, 버전 드롭다운, 협업, 댓글, 그리기) 회귀 없음
6. DEVLOG 문서 상태 모두 ✅
7. 모든 변경사항이 한글 커밋 메시지로 커밋됨

## 완료 후 권장

- `main`으로 PR 생성 (한글 제목·설명)
- 리뷰 통과 후 머지
- `npm run build:installer`로 설치 파일 생성
- 팀원에게 새 버전 전달

---

## 열린 질문 — 구현 중 결정 필요

스펙에도 명시된 항목으로, 구현 도중 기본값으로 진행하되 필요 시 조정:

1. **"더 보기" 동작**: 현재 MVP는 알림 메시지만 띄움. 추후 뷰 모듈에 `expanded` 상태 지원 추가.
2. **duration 확보 시점**: 현재 `videoPlayer.duration`을 `trace.end` 직전에 사용. 오디오/비디오 로드 완료 후이므로 값이 있을 가능성 높음. 0이면 썸네일 캡처가 0초 지점에서 일어나 첫 프레임이 나옴 — 허용 가능한 폴백.
3. **되돌리기 토스트**: 현재 미구현. 제거 직후 "되돌리기" 토스트는 Phase 2로 보류.
4. **우클릭 컨텍스트 메뉴**: 현재 미구현. 호버 액션 버튼으로 대체. Phase 2로 보류.
