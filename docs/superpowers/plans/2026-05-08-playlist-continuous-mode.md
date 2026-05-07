# Playlist Continuous Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BAEFRAME playlists keep a stable order, add an `이어보기` mode that plays playlist videos as one continuous flow, and fix stacked toast behavior.

**Architecture:** Keep existing playlist UI and managers, but move deterministic ordering, continuous timeline mapping, aggregate comment indexing, and toast stack layout into small testable ES modules. `renderer/scripts/app.js` remains the integration layer for DOM events, video loading, background transcode, and user notifications.

**Tech Stack:** Electron renderer, vanilla ES modules, CSS, `node --test`, existing `window.electronAPI` preload APIs.

---

## Scope Check

This spec touches two independent workstreams: playlist continuous playback and toast stack stability. They are kept in one implementation plan because the user explicitly asked to improve both in the same UX pass, but they are split into separate tasks and commits so either side can be reviewed independently.

## File Structure

- Create `renderer/scripts/modules/playlist-ordering.js`
  - Pure helpers for natural filename sorting, playlist setting normalization, and stable order application.
- Create `scripts/tests/playlist-ordering.test.js`
  - Unit tests for filename sorting, manual order preservation, and legacy settings normalization.
- Modify `shared/playlist-schema.js`
  - Document and emit new playlist-level settings while keeping `.bplaylist` v1.0 compatibility.
- Modify `renderer/scripts/modules/playlist-manager.js`
  - Use ordering helpers, persist settings, mark manual ordering, expose sort/loop/continuous methods, and preserve order after opening old playlists.
- Create `renderer/scripts/modules/playlist-continuous-core.js`
  - Pure helpers for segment building, global time mapping, next-item selection, and skipped-video summaries.
- Create `scripts/tests/playlist-continuous-core.test.js`
  - Unit tests for segment math, loop behavior, and skip summaries.
- Create `renderer/scripts/modules/playlist-comment-index.js`
  - Read-only mapping from per-video `.bframe` comments into global playlist timeline ranges.
- Create `scripts/tests/playlist-comment-index.test.js`
  - Unit tests proving aggregate comment indexing does not require mutating the active `commentManager`.
- Create `renderer/scripts/modules/toast-stack-core.js`
  - Pure helper for newest-first toast stack layout and visibility states.
- Create `scripts/tests/toast-stack-core.test.js`
  - Unit tests for z-index, stacked/hidden state, and dismissed toast demotion.
- Modify `renderer/index.html`
  - Add playlist mode tabs, sort selector, repeat toggle, preparation summary, and continuous action button IDs.
- Modify `renderer/scripts/app.js`
  - Wire UI, continuous playback state, preflight checks, background pre-transcode, end-of-video routing, aggregate comments, and toast pause behavior.
- Modify `renderer/scripts/modules/timeline.js`
  - Add playlist segment and aggregate comment rendering methods without changing existing review editing behavior.
- Modify `renderer/styles/playlist-panel.css`
  - Add tabs, sort controls, status chips, preparation summary, and compact continuous UI styling.
- Modify `renderer/styles/main.css`
  - Fix toast stack expansion, scroll containment, and hover pause visual behavior.
- Modify `package.json`
  - Add targeted test scripts for the new pure modules and an aggregate playlist test script.

---

### Task 1: Playlist Ordering Foundation

**Files:**
- Create: `renderer/scripts/modules/playlist-ordering.js`
- Create: `scripts/tests/playlist-ordering.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for natural sorting and settings normalization**

Create `scripts/tests/playlist-ordering.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');

let mod;

test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/playlist-ordering.js');
});

test('파일명 자연 정렬: 1, 2, 10 순서를 유지한다', () => {
  const items = [
    { id: '10', fileName: 'shot10.mp4', order: 0, addedAt: '2026-05-08T00:00:00.000Z' },
    { id: '2', fileName: 'shot2.mp4', order: 1, addedAt: '2026-05-08T00:00:01.000Z' },
    { id: '1', fileName: 'shot1.mp4', order: 2, addedAt: '2026-05-08T00:00:02.000Z' }
  ];

  const sorted = mod.sortPlaylistItems(items, mod.PLAYLIST_SORT_MODES.FILE_NAME);

  assert.deepEqual(sorted.map(item => item.fileName), ['shot1.mp4', 'shot2.mp4', 'shot10.mp4']);
  assert.deepEqual(items.map(item => item.fileName), ['shot10.mp4', 'shot2.mp4', 'shot1.mp4']);
});

test('추가한 순서 정렬: addedAt 기준으로 안정 정렬한다', () => {
  const items = [
    { id: 'b', fileName: 'b.mp4', order: 2, addedAt: '2026-05-08T00:00:02.000Z' },
    { id: 'a', fileName: 'a.mp4', order: 1, addedAt: '2026-05-08T00:00:01.000Z' },
    { id: 'c', fileName: 'c.mp4', order: 3, addedAt: '2026-05-08T00:00:03.000Z' }
  ];

  const sorted = mod.sortPlaylistItems(items, mod.PLAYLIST_SORT_MODES.ADDED_AT);

  assert.deepEqual(sorted.map(item => item.id), ['a', 'b', 'c']);
});

test('수동 순서가 있으면 새 항목만 파일명순으로 뒤에 붙인다', () => {
  const existing = [
    { id: 'manual-2', fileName: 'shot2.mp4', order: 0 },
    { id: 'manual-1', fileName: 'shot1.mp4', order: 1 }
  ];
  const incoming = [
    { id: 'new-10', fileName: 'shot10.mp4', order: 0 },
    { id: 'new-3', fileName: 'shot3.mp4', order: 0 }
  ];

  const merged = mod.appendSortedNewItems(existing, incoming);

  assert.deepEqual(merged.map(item => item.id), ['manual-2', 'manual-1', 'new-3', 'new-10']);
  assert.deepEqual(merged.map(item => item.order), [0, 1, 2, 3]);
});

test('기존 재생목록 설정은 기본 이어보기 설정으로 보정한다', () => {
  const playlist = {
    settings: {
      autoPlay: true,
      floatingMode: false
    }
  };

  const settings = mod.normalizePlaylistSettings(playlist);

  assert.equal(settings.autoPlay, true);
  assert.equal(settings.floatingMode, false);
  assert.equal(settings.continuous.loop, false);
  assert.equal(settings.continuous.sortMode, mod.PLAYLIST_SORT_MODES.FILE_NAME);
  assert.equal(settings.continuous.manualOrder, false);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `node --test scripts/tests/playlist-ordering.test.js`

Expected: FAIL with `Cannot find module` for `playlist-ordering.js`.

- [ ] **Step 3: Implement ordering helpers**

Create `renderer/scripts/modules/playlist-ordering.js`:

```js
export const PLAYLIST_SORT_MODES = Object.freeze({
  FILE_NAME: 'fileName',
  ADDED_AT: 'addedAt',
  MODIFIED_AT: 'modifiedAt'
});

export const DEFAULT_CONTINUOUS_SETTINGS = Object.freeze({
  loop: false,
  sortMode: PLAYLIST_SORT_MODES.FILE_NAME,
  manualOrder: false
});

const collator = new Intl.Collator('ko-KR', {
  numeric: true,
  sensitivity: 'base'
});

export function naturalCompare(a, b) {
  return collator.compare(String(a || ''), String(b || ''));
}

export function normalizePlaylistSettings(playlist) {
  const current = playlist?.settings && typeof playlist.settings === 'object'
    ? playlist.settings
    : {};
  const currentContinuous = current.continuous && typeof current.continuous === 'object'
    ? current.continuous
    : {};

  return {
    autoPlay: current.autoPlay === true,
    floatingMode: current.floatingMode === true,
    continuous: {
      loop: currentContinuous.loop === true,
      sortMode: Object.values(PLAYLIST_SORT_MODES).includes(currentContinuous.sortMode)
        ? currentContinuous.sortMode
        : DEFAULT_CONTINUOUS_SETTINGS.sortMode,
      manualOrder: currentContinuous.manualOrder === true
    }
  };
}

export function normalizeItemOrders(items) {
  return [...(items || [])]
    .sort((a, b) => {
      const orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return naturalCompare(a.fileName, b.fileName);
    })
    .map((item, index) => ({ ...item, order: index }));
}

export function sortPlaylistItems(items, sortMode = PLAYLIST_SORT_MODES.FILE_NAME) {
  const indexed = [...(items || [])].map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    let result = 0;
    if (sortMode === PLAYLIST_SORT_MODES.ADDED_AT) {
      result = String(a.item.addedAt || '').localeCompare(String(b.item.addedAt || ''));
    } else if (sortMode === PLAYLIST_SORT_MODES.MODIFIED_AT) {
      const aTime = Number.isFinite(a.item.modifiedAtMs) ? a.item.modifiedAtMs : 0;
      const bTime = Number.isFinite(b.item.modifiedAtMs) ? b.item.modifiedAtMs : 0;
      result = bTime - aTime;
    } else {
      result = naturalCompare(a.item.fileName, b.item.fileName);
    }
    return result || a.index - b.index;
  });
  return indexed.map(({ item }, index) => ({ ...item, order: index }));
}

export function appendSortedNewItems(existingItems, newItems) {
  const existing = normalizeItemOrders(existingItems || []);
  const sortedNew = sortPlaylistItems(newItems || [], PLAYLIST_SORT_MODES.FILE_NAME);
  return [...existing, ...sortedNew].map((item, index) => ({ ...item, order: index }));
}
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts:

```json
"test:playlist-ordering": "node --test scripts/tests/playlist-ordering.test.js",
"test:playlist": "node --test scripts/tests/playlist-ordering.test.js"
```

Keep existing scripts unchanged.

- [ ] **Step 5: Run tests**

Run: `npm run test:playlist-ordering`

Expected: PASS for 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json renderer/scripts/modules/playlist-ordering.js scripts/tests/playlist-ordering.test.js
git commit -m "재생목록 정렬 기준을 테스트 가능한 모듈로 추가"
```

---

### Task 2: Playlist Schema and Manager Integration

**Files:**
- Modify: `shared/playlist-schema.js`
- Modify: `renderer/scripts/modules/playlist-manager.js`
- Modify: `scripts/tests/playlist-ordering.test.js`

- [ ] **Step 1: Extend tests for manager-level add and manual order behavior**

Append to `scripts/tests/playlist-ordering.test.js`:

```js
test('PlaylistManager.addItems는 기본 파일명순으로 새 항목을 추가한다', async () => {
  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: { fileExists: async () => false }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager._tryGenerateThumbnail = async () => '';
  manager.createNew('정렬 테스트');

  await manager.addItems([
    'C:\\video\\shot10.mp4',
    'C:\\video\\shot2.mp4',
    'C:\\video\\shot1.mp4'
  ]);

  assert.deepEqual(manager.getItems().map(item => item.fileName), [
    'shot1.mp4',
    'shot2.mp4',
    'shot10.mp4'
  ]);
});

test('PlaylistManager는 수동 순서 뒤에 새 항목만 정렬해서 붙인다', async () => {
  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: { fileExists: async () => false }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager._tryGenerateThumbnail = async () => '';
  manager.createNew('수동 정렬 테스트');

  await manager.addItems([
    'C:\\video\\shot1.mp4',
    'C:\\video\\shot2.mp4'
  ]);
  manager.reorderItem(1, 0);
  await manager.addItems([
    'C:\\video\\shot10.mp4',
    'C:\\video\\shot3.mp4'
  ]);

  assert.deepEqual(manager.getItems().map(item => item.fileName), [
    'shot2.mp4',
    'shot1.mp4',
    'shot3.mp4',
    'shot10.mp4'
  ]);
  assert.equal(manager.getContinuousSettings().manualOrder, true);
});
```

- [ ] **Step 2: Run tests and verify the new manager tests fail**

Run: `npm run test:playlist-ordering`

Expected: FAIL because `getItems()` or `getContinuousSettings()` behavior is not yet updated for sorted add/manual order.

- [ ] **Step 3: Update schema defaults**

Modify both `shared/playlist-schema.js` and the duplicated default creator in `renderer/scripts/modules/playlist-manager.js` so new playlists use:

```js
settings: {
  autoPlay: false,
  floatingMode: false,
  continuous: {
    loop: false,
    sortMode: 'fileName',
    manualOrder: false
  }
}
```

In `shared/playlist-schema.js`, update the `PlaylistSettings` JSDoc to include:

```js
 * @property {Object} continuous - 이어보기 설정
 * @property {boolean} continuous.loop - 마지막 영상 후 반복 재생 여부
 * @property {'fileName'|'addedAt'|'modifiedAt'} continuous.sortMode - 마지막 선택 정렬 기준
 * @property {boolean} continuous.manualOrder - 사용자가 드래그로 수동 순서를 만든 상태
```

- [ ] **Step 4: Import ordering helpers into playlist manager**

At the top of `renderer/scripts/modules/playlist-manager.js`, add:

```js
import {
  PLAYLIST_SORT_MODES,
  normalizePlaylistSettings,
  normalizeItemOrders,
  sortPlaylistItems,
  appendSortedNewItems
} from './playlist-ordering.js';
```

- [ ] **Step 5: Normalize settings and item order when opening or creating playlists**

After `this.currentPlaylist = data;` in `open(filePath)`, add:

```js
this.currentPlaylist.settings = normalizePlaylistSettings(this.currentPlaylist);
this.currentPlaylist.items = normalizeItemOrders(this.currentPlaylist.items);
```

After `this.currentPlaylist = createDefaultPlaylistData(...)` in `createNew(name)`, add:

```js
this.currentPlaylist.settings = normalizePlaylistSettings(this.currentPlaylist);
```

- [ ] **Step 6: Sort new items before adding and preserve manual order**

In `addItems(filePaths)`, build all valid new item objects first, then merge:

```js
const createdItems = [];

for (const filePath of pathsToAdd) {
  if (!isMediaFile(filePath)) {
    log.warn('미디어 파일이 아님', { filePath });
    continue;
  }

  if (this._isDuplicate(filePath)) {
    log.warn('중복 파일', { filePath });
    continue;
  }

  const bframePath = await this._findBframePath(filePath);
  const thumbnailPath = await this._tryGenerateThumbnail(filePath);
  const item = createPlaylistItem(filePath, bframePath);
  item.thumbnailPath = thumbnailPath;
  createdItems.push(item);
}

if (createdItems.length > 0) {
  const settings = this.getContinuousSettings();
  this.currentPlaylist.items = settings.manualOrder
    ? appendSortedNewItems(this.currentPlaylist.items, createdItems)
    : sortPlaylistItems(
        [...this.currentPlaylist.items, ...createdItems],
        settings.sortMode || PLAYLIST_SORT_MODES.FILE_NAME
      );
  addedItems.push(...createdItems);
}
```

- [ ] **Step 7: Add manager accessors**

Add to the settings section of `PlaylistManager`:

```js
getContinuousSettings() {
  if (!this.currentPlaylist) {
    return normalizePlaylistSettings({ settings: {} }).continuous;
  }
  this.currentPlaylist.settings = normalizePlaylistSettings(this.currentPlaylist);
  return this.currentPlaylist.settings.continuous;
}

setContinuousLoop(enabled) {
  if (!this.currentPlaylist) return;
  this.currentPlaylist.settings = normalizePlaylistSettings(this.currentPlaylist);
  this.currentPlaylist.settings.continuous.loop = enabled === true;
  this.isModified = true;
  this.onPlaylistModified?.();
}

setSortMode(sortMode) {
  if (!this.currentPlaylist) return;
  if (!Object.values(PLAYLIST_SORT_MODES).includes(sortMode)) return;
  this.currentPlaylist.settings = normalizePlaylistSettings(this.currentPlaylist);
  this.currentPlaylist.settings.continuous.sortMode = sortMode;
  this.currentPlaylist.settings.continuous.manualOrder = false;
  this.currentPlaylist.items = sortPlaylistItems(this.currentPlaylist.items, sortMode);
  this.currentIndex = this.currentPlaylist.items.length > 0 ? Math.min(this.currentIndex, this.currentPlaylist.items.length - 1) : -1;
  this.isModified = true;
  this.onPlaylistModified?.();
}

getItems() {
  return this.currentPlaylist?.items || [];
}

getItemCount() {
  return this.currentPlaylist?.items?.length || 0;
}

isEmpty() {
  return this.getItemCount() === 0;
}

isActive() {
  return !!this.currentPlaylist;
}
```

If `getItems`, `getItemCount`, `isEmpty`, or `isActive` already exist later in the file, update those existing methods instead of duplicating them.

- [ ] **Step 8: Mark manual order on drag reorder**

Inside `reorderItem(fromIndex, toIndex)`, after order values are rewritten, add:

```js
this.currentPlaylist.settings = normalizePlaylistSettings(this.currentPlaylist);
this.currentPlaylist.settings.continuous.manualOrder = true;
```

- [ ] **Step 9: Run tests**

Run: `npm run test:playlist-ordering`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add shared/playlist-schema.js renderer/scripts/modules/playlist-manager.js scripts/tests/playlist-ordering.test.js
git commit -m "재생목록 설정 저장과 수동 순서 보존을 연결"
```

---

### Task 3: Continuous Playback Core

**Files:**
- Create: `renderer/scripts/modules/playlist-continuous-core.js`
- Create: `scripts/tests/playlist-continuous-core.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for segment math, loop, and skipped summaries**

Create `scripts/tests/playlist-continuous-core.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');

let mod;

test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/playlist-continuous-core.js');
});

test('재생목록 항목을 하나의 전역 시간 세그먼트로 만든다', () => {
  const items = [
    { id: 'a', fileName: 'a.mp4' },
    { id: 'b', fileName: 'b.mp4' }
  ];

  const result = mod.buildPlaylistSegments(items, new Map([
    ['a', { duration: 10, fps: 24 }],
    ['b', { duration: 5, fps: 30 }]
  ]));

  assert.equal(result.totalDuration, 15);
  assert.deepEqual(result.segments.map(s => [s.itemId, s.startTime, s.endTime]), [
    ['a', 0, 10],
    ['b', 10, 15]
  ]);
});

test('전역 시간을 해당 영상과 로컬 시간으로 변환한다', () => {
  const segments = [
    { itemId: 'a', index: 0, startTime: 0, endTime: 10, duration: 10 },
    { itemId: 'b', index: 1, startTime: 10, endTime: 15, duration: 5 }
  ];

  const mapped = mod.mapGlobalTimeToSegment(segments, 12.25);

  assert.equal(mapped.segment.itemId, 'b');
  assert.equal(mapped.localTime, 2.25);
});

test('현재 영상은 유지하고 다음 재생부터 새 순서를 따른다', () => {
  const items = [
    { id: 'current', fileName: 'current.mp4' },
    { id: 'skip', fileName: 'skip.mp4', continuousStatus: 'skipped' },
    { id: 'next', fileName: 'next.mp4' }
  ];

  const next = mod.findNextPlayableIndex(items, 0, { loop: false });

  assert.equal(next, 2);
});

test('반복 재생이 켜져 있으면 마지막 뒤에 첫 번째 재생 가능 항목으로 돌아간다', () => {
  const items = [
    { id: 'first', fileName: 'first.mp4' },
    { id: 'last', fileName: 'last.mp4' }
  ];

  const next = mod.findNextPlayableIndex(items, 1, { loop: true });

  assert.equal(next, 0);
});

test('연속 실패 토스트 메시지를 묶어서 만든다', () => {
  const message = mod.createSkippedToastMessage([
    { fileName: 'a.mp4' },
    { fileName: 'b.mp4' },
    { fileName: 'c.mp4' }
  ]);

  assert.equal(message, '3개 영상을 건너뜀');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test scripts/tests/playlist-continuous-core.test.js`

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement continuous core helpers**

Create `renderer/scripts/modules/playlist-continuous-core.js`:

```js
export const CONTINUOUS_STATUS = Object.freeze({
  IDLE: 'idle',
  CHECKING: 'checking',
  PREPARING: 'preparing',
  READY: 'ready',
  SKIPPED: 'skipped',
  MISSING: 'missing',
  ERROR: 'error'
});

export function buildPlaylistSegments(items, metadataByItemId) {
  const segments = [];
  let cursor = 0;

  (items || []).forEach((item, index) => {
    const metadata = metadataByItemId.get(item.id) || {};
    const duration = Math.max(0, Number(metadata.duration) || Number(item.duration) || 0);
    const fps = Number(metadata.fps) || Number(item.fps) || 24;
    const segment = {
      itemId: item.id,
      index,
      fileName: item.fileName,
      startTime: cursor,
      endTime: cursor + duration,
      duration,
      fps
    };
    segments.push(segment);
    cursor += duration;
  });

  return {
    segments,
    totalDuration: cursor
  };
}

export function mapGlobalTimeToSegment(segments, globalTime) {
  if (!segments || segments.length === 0) return null;
  const time = Math.max(0, Number(globalTime) || 0);
  const segment = segments.find(s => time >= s.startTime && time < s.endTime) || segments[segments.length - 1];
  return {
    segment,
    localTime: Math.max(0, Math.min(segment.duration, time - segment.startTime))
  };
}

export function mapLocalTimeToGlobal(segment, localTime) {
  if (!segment) return 0;
  return segment.startTime + Math.max(0, Number(localTime) || 0);
}

function isPlayable(item) {
  return item && ![
    CONTINUOUS_STATUS.SKIPPED,
    CONTINUOUS_STATUS.MISSING,
    CONTINUOUS_STATUS.ERROR
  ].includes(item.continuousStatus);
}

export function findNextPlayableIndex(items, currentIndex, options = {}) {
  const list = items || [];
  if (list.length === 0) return -1;

  for (let offset = 1; offset <= list.length; offset++) {
    const index = currentIndex + offset;
    if (index < list.length && isPlayable(list[index])) return index;
    if (index >= list.length && options.loop === true) {
      const wrappedIndex = index % list.length;
      if (wrappedIndex === currentIndex) return -1;
      if (isPlayable(list[wrappedIndex])) return wrappedIndex;
    }
  }

  return -1;
}

export function createSkippedToastMessage(items) {
  const count = (items || []).length;
  if (count <= 0) return '';
  if (count === 1) return `"${items[0].fileName}" 영상을 건너뜀`;
  return `${count}개 영상을 건너뜀`;
}
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts:

```json
"test:playlist-continuous": "node --test scripts/tests/playlist-continuous-core.test.js",
"test:playlist": "node --test scripts/tests/playlist-ordering.test.js scripts/tests/playlist-continuous-core.test.js"
```

- [ ] **Step 5: Run tests**

Run: `npm run test:playlist`

Expected: PASS for ordering and continuous core tests.

- [ ] **Step 6: Commit**

```bash
git add package.json renderer/scripts/modules/playlist-continuous-core.js scripts/tests/playlist-continuous-core.test.js
git commit -m "이어보기 시간 계산과 다음 영상 선택 로직 추가"
```

---

### Task 4: Toast Stack Core and Stabilization

**Files:**
- Create: `renderer/scripts/modules/toast-stack-core.js`
- Create: `scripts/tests/toast-stack-core.test.js`
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/styles/main.css`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for stack layout**

Create `scripts/tests/toast-stack-core.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');

let mod;

test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/toast-stack-core.js');
});

test('최신 토스트가 가장 높은 z-index를 가진다', () => {
  const layout = mod.computeToastStackLayout(['newest', 'middle', 'oldest'], { maxVisible: 3 });

  assert.equal(layout[0].id, 'newest');
  assert.equal(layout[0].fromTop, 0);
  assert.ok(layout[0].zIndex > layout[1].zIndex);
  assert.ok(layout[1].zIndex > layout[2].zIndex);
});

test('표시 개수를 넘은 토스트는 hidden 상태가 된다', () => {
  const layout = mod.computeToastStackLayout(['a', 'b', 'c', 'd'], { maxVisible: 3 });

  assert.equal(layout[3].hidden, true);
  assert.equal(layout[3].stacked, true);
});

test('dismissed 토스트는 재정렬 중 위로 올라오지 않는다', () => {
  const layout = mod.computeToastStackLayout([
    { id: 'a' },
    { id: 'b', dismissed: true },
    { id: 'c' }
  ], { maxVisible: 3 });

  const dismissed = layout.find(item => item.id === 'b');
  assert.equal(dismissed.zIndex, 0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test scripts/tests/toast-stack-core.test.js`

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement toast layout helper**

Create `renderer/scripts/modules/toast-stack-core.js`:

```js
export function computeToastStackLayout(toasts, options = {}) {
  const maxVisible = options.maxVisible || 3;
  const total = (toasts || []).length;

  return (toasts || []).map((toast, index) => {
    const id = typeof toast === 'string' ? toast : toast.id;
    const dismissed = typeof toast === 'object' && toast.dismissed === true;
    const fromTop = index;
    const hidden = fromTop >= maxVisible;
    const stacked = fromTop > 0;
    const scale = hidden ? 1 - Math.min(fromTop, 3) * 0.05 : 1 - fromTop * 0.05;
    const opacity = hidden ? 0 : Math.max(1 - fromTop * 0.2, 0.3);
    const brightness = hidden ? 0.7 : 1 - fromTop * 0.08;

    return {
      id,
      index,
      fromTop,
      stacked,
      hidden,
      zIndex: dismissed ? 0 : total - index,
      scale,
      opacity,
      brightness
    };
  });
}
```

- [ ] **Step 4: Import and apply layout in `app.js`**

At the top of `renderer/scripts/app.js`, add:

```js
import { computeToastStackLayout } from './modules/toast-stack-core.js';
```

Replace `_updateToastStack()` with:

```js
function _updateToastStack() {
  const layout = computeToastStackLayout(_toastState.toasts, {
    maxVisible: _toastState.maxVisible
  });

  layout.forEach((entry) => {
    const toast = _toastState.toasts[entry.index];
    if (!toast) return;

    toast.style.zIndex = String(entry.zIndex);
    toast.classList.toggle('toast-stacked', entry.stacked);
    toast.classList.toggle('toast-hidden', entry.hidden);
    toast.style.setProperty('--stack-scale', entry.scale);
    toast.style.setProperty('--stack-opacity', entry.opacity);
    toast.style.setProperty('--stack-brightness', entry.brightness);
  });
}
```

- [ ] **Step 5: Make toast state newest-first and pause by container**

In `showToast`, replace:

```js
elements.toastContainer.prepend(toast);
_toastState.toasts.push(toast);
```

with:

```js
elements.toastContainer.prepend(toast);
_toastState.toasts.unshift(toast);
```

Add helper functions near `_dismissToast`:

```js
function _pauseToastTimer(toast) {
  if (!toast || toast._isLoading || toast._paused || toast._dismissed) return;
  toast._paused = true;
  toast._remaining = Math.max(0, toast._duration - (performance.now() - toast._startedAt));
  clearTimeout(toast._autoTimer);
}

function _resumeToastTimer(toast) {
  if (!toast || toast._isLoading || !toast._paused || toast._dismissed) return;
  toast._paused = false;
  toast._duration = toast._remaining;
  toast._startedAt = performance.now();
  toast._autoTimer = setTimeout(() => _dismissToast(toast), toast._remaining);
}

function _bindToastContainerPause() {
  if (!elements.toastContainer || elements.toastContainer._pauseBound) return;
  elements.toastContainer._pauseBound = true;
  elements.toastContainer.addEventListener('mouseenter', () => {
    _toastState.toasts.forEach(_pauseToastTimer);
  });
  elements.toastContainer.addEventListener('mouseleave', () => {
    _toastState.toasts.forEach(_resumeToastTimer);
  });
}
```

Call `_bindToastContainerPause();` once before creating the first toast in `showToast`.

Store timer fields after `const isLoading = normalType === 'loading';`:

```js
toast._duration = duration;
toast._remaining = duration;
toast._startedAt = performance.now();
toast._isLoading = isLoading;
toast._paused = false;
```

Update `animateProgress()` to read `toast._duration`, `toast._remaining`, and `toast._startedAt` instead of closure-only `duration`, `remaining`, and `startTime`.

- [ ] **Step 6: Demote dismissed toasts before exit animation**

At the beginning of `_dismissToast`, after `_dismissed` is set:

```js
toast._dismissed = true;
toast.style.zIndex = '0';
```

After removing a toast from `_toastState.toasts`, call `_updateToastStack()` before the height-collapse transition ends.

- [ ] **Step 7: Contain expanded toast overflow in CSS**

Modify `.toast-container` in `renderer/styles/main.css`:

```css
.toast-container {
  position: fixed;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  width: min(356px, calc(100vw - 32px));
  max-height: calc(100vh - 104px);
  overflow: hidden;
  overscroll-behavior: contain;
  top: 52px;
  left: 0;
  right: 0;
  margin-left: auto;
  margin-right: auto;
}

.toast-container:hover {
  pointer-events: auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}
```

Keep existing `.toast-container:hover .toast.toast-stacked` and `.toast-container:hover .toast.toast-hidden` behavior, but ensure hidden toasts restore fixed padding and do not exceed container width.

- [ ] **Step 8: Add package script and run tests**

Modify `package.json`:

```json
"test:toast-stack": "node --test scripts/tests/toast-stack-core.test.js"
```

Run: `npm run test:toast-stack`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json renderer/scripts/modules/toast-stack-core.js scripts/tests/toast-stack-core.test.js renderer/scripts/app.js renderer/styles/main.css
git commit -m "토스트 스택 순서와 hover 일시정지를 안정화"
```

---

### Task 5: Playlist UI Shell

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/styles/playlist-panel.css`

- [ ] **Step 1: Add playlist tab and settings markup**

In `renderer/index.html`, inside `#playlistSidebar`, insert after `.playlist-progress-bar`:

```html
<div class="playlist-mode-tabs" role="tablist" aria-label="재생목록 모드">
  <button class="playlist-mode-tab active" id="playlistTabReview" type="button" role="tab" aria-selected="true">리뷰</button>
  <button class="playlist-mode-tab" id="playlistTabContinuous" type="button" role="tab" aria-selected="false">이어보기</button>
</div>

<div class="playlist-continuous-tools" id="playlistContinuousTools" hidden>
  <label class="playlist-sort-control">
    <span>정렬</span>
    <select id="playlistSortMode">
      <option value="fileName">파일명순</option>
      <option value="addedAt">추가한 순서</option>
      <option value="modifiedAt">수정한 날짜순</option>
    </select>
  </label>
  <label class="playlist-loop-toggle">
    <input type="checkbox" id="playlistContinuousLoop">
    <span class="toggle-slider"></span>
    <span class="toggle-label">반복</span>
  </label>
  <button class="playlist-continuous-play" id="btnPlaylistContinuousPlay" type="button">이어보기</button>
</div>

<div class="playlist-prepare-summary" id="playlistPrepareSummary" hidden>
  <span id="playlistPrepareSummaryText">0/0개 준비됨</span>
</div>
```

- [ ] **Step 2: Add elements in `app.js`**

In the `elements` object playlist section, add:

```js
playlistTabReview: document.getElementById('playlistTabReview'),
playlistTabContinuous: document.getElementById('playlistTabContinuous'),
playlistContinuousTools: document.getElementById('playlistContinuousTools'),
playlistSortMode: document.getElementById('playlistSortMode'),
playlistContinuousLoop: document.getElementById('playlistContinuousLoop'),
btnPlaylistContinuousPlay: document.getElementById('btnPlaylistContinuousPlay'),
playlistPrepareSummary: document.getElementById('playlistPrepareSummary'),
playlistPrepareSummaryText: document.getElementById('playlistPrepareSummaryText'),
```

- [ ] **Step 3: Add local UI mode state and switch function**

Near playlist feature functions in `app.js`, add:

```js
const playlistUIState = {
  mode: 'review'
};

function setPlaylistMode(mode) {
  const nextMode = mode === 'continuous' ? 'continuous' : 'review';
  playlistUIState.mode = nextMode;

  elements.playlistTabReview?.classList.toggle('active', nextMode === 'review');
  elements.playlistTabContinuous?.classList.toggle('active', nextMode === 'continuous');
  elements.playlistTabReview?.setAttribute('aria-selected', String(nextMode === 'review'));
  elements.playlistTabContinuous?.setAttribute('aria-selected', String(nextMode === 'continuous'));

  if (elements.playlistContinuousTools) {
    elements.playlistContinuousTools.hidden = nextMode !== 'continuous';
  }
  if (elements.playlistPrepareSummary) {
    elements.playlistPrepareSummary.hidden = nextMode !== 'continuous';
  }

  if (nextMode === 'review') {
    stopContinuousPlayback({ keepCurrentVideo: true });
  } else {
    updatePlaylistContinuousTimeline();
  }
}
```

`stopContinuousPlayback` and `updatePlaylistContinuousTimeline` are introduced in Task 6 and Task 7. Until those tasks are applied, define no-op functions with the same names in this task so the UI can switch without throwing:

```js
function stopContinuousPlayback() {}
function updatePlaylistContinuousTimeline() {}
```

When Task 6 and Task 7 add real implementations, remove the no-op definitions.

- [ ] **Step 4: Bind tab, sort, loop, and play controls**

Inside `initPlaylistFeature()`, add:

```js
elements.playlistTabReview?.addEventListener('click', () => {
  setPlaylistMode('review');
});

elements.playlistTabContinuous?.addEventListener('click', () => {
  setPlaylistMode('continuous');
});

elements.playlistSortMode?.addEventListener('change', (e) => {
  playlistManager.setSortMode(e.target.value);
  updatePlaylistUI();
  updatePlaylistContinuousTimeline();
});

elements.playlistContinuousLoop?.addEventListener('change', (e) => {
  playlistManager.setContinuousLoop(e.target.checked);
});

elements.btnPlaylistContinuousPlay?.addEventListener('click', () => {
  startContinuousPlayback();
});
```

Define a no-op `startContinuousPlayback()` in this task, then replace it in Task 6.

- [ ] **Step 5: Sync settings during `updatePlaylistUI()`**

In `updatePlaylistUI()`, after the existing auto-play checkbox sync, add:

```js
const continuousSettings = playlistManager.getContinuousSettings?.();
if (continuousSettings) {
  if (elements.playlistSortMode) {
    elements.playlistSortMode.value = continuousSettings.sortMode;
  }
  if (elements.playlistContinuousLoop) {
    elements.playlistContinuousLoop.checked = continuousSettings.loop;
  }
}
```

- [ ] **Step 6: Add CSS**

Append to `renderer/styles/playlist-panel.css`:

```css
.playlist-mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 8px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-subtle);
}

.playlist-mode-tab {
  height: 28px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.playlist-mode-tab.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--accent-primary);
}

.playlist-continuous-tools {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 8px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-subtle);
}

.playlist-sort-control {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.playlist-sort-control select {
  min-width: 0;
  flex: 1;
  height: 28px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
}

.playlist-loop-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 11px;
}

.playlist-loop-toggle input {
  display: none;
}

.playlist-continuous-play {
  grid-column: 1 / -1;
  height: 30px;
  border: 1px solid var(--accent-primary);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.playlist-prepare-summary {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
  font-size: 11px;
  background: var(--bg-secondary);
}
```

- [ ] **Step 7: Run lint and smoke test**

Run: `npm run lint`

Expected: No new lint errors from edited files.

Manual smoke: start `npm run dev`, open playlist sidebar, switch `리뷰`/`이어보기`, verify no console errors.

- [ ] **Step 8: Commit**

```bash
git add renderer/index.html renderer/scripts/app.js renderer/styles/playlist-panel.css
git commit -m "재생목록 리뷰와 이어보기 탭 UI 추가"
```

---

### Task 6: Continuous Playback Runtime

**Files:**
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/styles/playlist-panel.css`
- Modify: `package.json`

- [ ] **Step 1: Import continuous helpers**

At the top of `renderer/scripts/app.js`, add:

```js
import {
  CONTINUOUS_STATUS,
  findNextPlayableIndex,
  createSkippedToastMessage
} from './modules/playlist-continuous-core.js';
```

- [ ] **Step 2: Replace Task 5 no-op continuous functions with runtime state**

Near playlist feature functions, add:

```js
const continuousPlaybackState = {
  active: false,
  waiting: false,
  skippedBatch: [],
  preparePromises: new Map()
};

function stopContinuousPlayback() {
  continuousPlaybackState.active = false;
  continuousPlaybackState.waiting = false;
  continuousPlaybackState.skippedBatch = [];
  if (elements.btnPlaylistContinuousPlay) {
    elements.btnPlaylistContinuousPlay.textContent = '이어보기';
  }
}

function markPlaylistItemStatus(item, status, message = '') {
  if (!item) return;
  item.continuousStatus = status;
  item.continuousMessage = message;
  updatePlaylistPrepareSummary();
  const el = document.querySelector(`.playlist-item[data-id="${item.id}"]`);
  if (el) {
    el.dataset.continuousStatus = status;
    el.classList.toggle('missing', status === CONTINUOUS_STATUS.MISSING);
    const statusEl = el.querySelector('.playlist-item-continuous-status');
    if (statusEl) statusEl.textContent = message || status;
  }
}

function flushSkippedToastBatch() {
  if (continuousPlaybackState.skippedBatch.length === 0) return;
  showToast(createSkippedToastMessage(continuousPlaybackState.skippedBatch), 'warning');
  continuousPlaybackState.skippedBatch = [];
}
```

- [ ] **Step 3: Add quick preflight**

Add:

```js
async function quickCheckPlaylistForContinuous() {
  const playlistManager = getPlaylistManager();
  const items = playlistManager.getItems();

  for (const item of items) {
    markPlaylistItemStatus(item, CONTINUOUS_STATUS.CHECKING, '확인 중');
    const exists = await window.electronAPI.fileExists(item.videoPath);
    if (!exists) {
      markPlaylistItemStatus(item, CONTINUOUS_STATUS.MISSING, '문제 있음');
      continue;
    }
    markPlaylistItemStatus(item, CONTINUOUS_STATUS.IDLE, '');
  }

  updatePlaylistUI();
}
```

- [ ] **Step 4: Add background preparation**

Add:

```js
async function preparePlaylistItemInBackground(item) {
  if (!item || continuousPlaybackState.preparePromises.has(item.id)) {
    return continuousPlaybackState.preparePromises.get(item?.id);
  }

  const promise = (async () => {
    try {
      markPlaylistItemStatus(item, CONTINUOUS_STATUS.PREPARING, '준비 중');
      const ffmpegAvailable = await window.electronAPI.ffmpegIsAvailable();
      if (!ffmpegAvailable) {
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, '준비 완료');
        return { ready: true };
      }

      const codecInfo = await window.electronAPI.ffmpegProbeCodec(item.videoPath);
      if (!codecInfo.success || codecInfo.isSupported) {
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, '준비 완료');
        return { ready: true };
      }

      const cacheResult = await window.electronAPI.ffmpegCheckCache(item.videoPath);
      if (cacheResult.valid) {
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, '준비 완료');
        return { ready: true, cached: true };
      }

      const result = await window.electronAPI.ffmpegPreTranscode(item.videoPath);
      if (result.success) {
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, '준비 완료');
        return { ready: true };
      }

      markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
      return { ready: false, error: result.error || '변환 실패' };
    } catch (error) {
      markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
      return { ready: false, error: error.message };
    } finally {
      continuousPlaybackState.preparePromises.delete(item.id);
    }
  })();

  continuousPlaybackState.preparePromises.set(item.id, promise);
  return promise;
}

function prepareNextPlaylistItem() {
  const playlistManager = getPlaylistManager();
  const items = playlistManager.getItems();
  const settings = playlistManager.getContinuousSettings();
  const nextIndex = findNextPlayableIndex(items, playlistManager.currentIndex, { loop: settings.loop });
  if (nextIndex >= 0) {
    preparePlaylistItemInBackground(items[nextIndex]);
  }
}
```

- [ ] **Step 5: Add five-second wait before skipping preparation**

Add:

```js
async function waitForPreparedOrSkip(item) {
  const preparePromise = preparePlaylistItemInBackground(item);
  const timeoutPromise = new Promise(resolve => {
    setTimeout(() => resolve({ ready: false, timedOut: true }), 5000);
  });
  const result = await Promise.race([preparePromise, timeoutPromise]);
  if (result.ready) return true;

  markPlaylistItemStatus(item, CONTINUOUS_STATUS.SKIPPED, '건너뜀');
  continuousPlaybackState.skippedBatch.push(item);
  return false;
}
```

- [ ] **Step 6: Implement start and next flow**

Add:

```js
async function startContinuousPlayback() {
  const playlistManager = getPlaylistManager();
  if (!playlistManager.isActive() || playlistManager.isEmpty()) {
    showToast('재생목록에 영상을 먼저 추가해주세요.', 'warning');
    return;
  }

  continuousPlaybackState.active = true;
  continuousPlaybackState.skippedBatch = [];
  if (elements.btnPlaylistContinuousPlay) {
    elements.btnPlaylistContinuousPlay.textContent = '이어보기 중';
  }

  await quickCheckPlaylistForContinuous();
  const currentItem = playlistManager.getCurrentItem() || playlistManager.selectItem(0);
  if (!currentItem) return;

  const ready = await waitForPreparedOrSkip(currentItem);
  if (!ready) {
    await playNextContinuousItem();
    return;
  }

  const alreadyLoaded = state.currentFile === currentItem.videoPath;
  if (!alreadyLoaded) {
    await loadVideoFromPlaylist(currentItem);
    videoPlayer.seekToFrame(0);
  }
  videoPlayer.play();
  prepareNextPlaylistItem();
}

async function playNextContinuousItem() {
  const playlistManager = getPlaylistManager();
  const items = playlistManager.getItems();
  const settings = playlistManager.getContinuousSettings();
  const nextIndex = findNextPlayableIndex(items, playlistManager.currentIndex, { loop: settings.loop });

  if (nextIndex < 0) {
    stopContinuousPlayback();
    flushSkippedToastBatch();
    showToast('재생목록 재생 완료', 'success');
    return;
  }

  const nextItem = playlistManager.selectItem(nextIndex);
  const ready = await waitForPreparedOrSkip(nextItem);
  if (!ready) {
    await playNextContinuousItem();
    return;
  }

  flushSkippedToastBatch();
  await loadVideoFromPlaylist(nextItem);
  videoPlayer.play();
  prepareNextPlaylistItem();
}
```

- [ ] **Step 7: Route ended event through continuous mode first**

In the existing `videoPlayer.addEventListener('ended', ...)` block, replace playlist auto-play handling with:

```js
const playlistManager = getPlaylistManager();
if (continuousPlaybackState.active) {
  log.info('이어보기: 다음 재생 가능 항목으로 이동');
  void playNextContinuousItem();
  return;
}

if (playlistManager.isActive() && playlistManager.getAutoPlay() && playlistManager.hasNext()) {
  log.info('자동 재생: 다음 아이템으로 이동');
  playlistManager.next();
}
```

- [ ] **Step 8: Render item status and prepare summary**

In `renderPlaylistItems()`, inside `.playlist-item-stats`, add:

```html
<span class="playlist-item-continuous-status"></span>
```

After setting `el.dataset.index`, add:

```js
if (item.continuousStatus) {
  el.dataset.continuousStatus = item.continuousStatus;
}
```

Add:

```js
function updatePlaylistPrepareSummary() {
  const playlistManager = getPlaylistManager();
  const items = playlistManager.getItems?.() || [];
  const readyCount = items.filter(item => item.continuousStatus === CONTINUOUS_STATUS.READY).length;
  if (elements.playlistPrepareSummaryText) {
    elements.playlistPrepareSummaryText.textContent = `${readyCount}/${items.length}개 준비됨`;
  }
}
```

- [ ] **Step 9: Add status CSS**

Append:

```css
.playlist-item-continuous-status {
  color: var(--text-tertiary);
  font-size: 10px;
}

.playlist-item[data-continuous-status="preparing"] .playlist-item-continuous-status {
  color: var(--warning);
}

.playlist-item[data-continuous-status="ready"] .playlist-item-continuous-status {
  color: var(--success);
}

.playlist-item[data-continuous-status="skipped"] .playlist-item-continuous-status,
.playlist-item[data-continuous-status="error"] .playlist-item-continuous-status,
.playlist-item[data-continuous-status="missing"] .playlist-item-continuous-status {
  color: var(--error);
}
```

- [ ] **Step 10: Run tests and smoke test**

Run: `npm run test:playlist`

Expected: PASS.

Manual smoke: with two normal videos, start `이어보기`, verify first plays and second starts after ended. With a missing file in the list, verify it is marked and skipped.

- [ ] **Step 11: Commit**

```bash
git add package.json renderer/scripts/app.js renderer/styles/playlist-panel.css
git commit -m "이어보기 재생 흐름과 백그라운드 준비 상태 추가"
```

---

### Task 7: Unified Timeline Segments and Aggregate Comments

**Files:**
- Create: `renderer/scripts/modules/playlist-comment-index.js`
- Create: `scripts/tests/playlist-comment-index.test.js`
- Modify: `renderer/scripts/modules/timeline.js`
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/styles/playlist-panel.css`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for aggregate comment mapping**

Create `scripts/tests/playlist-comment-index.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');

let mod;

test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/playlist-comment-index.js');
});

test('영상별 댓글 프레임을 전역 시간으로 변환한다', () => {
  const bframeData = {
    fps: 24,
    comments: {
      layers: [
        {
          id: 'layer-1',
          visible: true,
          color: '#ffcc00',
          markers: [
            {
              id: 'm1',
              startFrame: 24,
              endFrame: 48,
              text: 'check',
              resolved: false,
              authorId: 'user-1'
            }
          ]
        }
      ]
    }
  };
  const segment = { itemId: 'item-1', index: 1, fileName: 'b.mp4', startTime: 10, duration: 5, fps: 24 };

  const ranges = mod.extractPlaylistCommentRanges({
    bframeData,
    segment,
    visibleLayerIds: null,
    allowedAuthorIds: null
  });

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].globalStartTime, 11);
  assert.equal(ranges[0].globalEndTime, 12);
  assert.equal(ranges[0].itemId, 'item-1');
  assert.equal(ranges[0].markerId, 'm1');
});

test('숨겨진 레이어는 통합 댓글에서 제외한다', () => {
  const bframeData = {
    fps: 24,
    comments: {
      layers: [
        { id: 'hidden', visible: false, markers: [{ id: 'm1', startFrame: 0, endFrame: 24 }] }
      ]
    }
  };
  const segment = { itemId: 'item-1', startTime: 0, duration: 5, fps: 24 };

  const ranges = mod.extractPlaylistCommentRanges({
    bframeData,
    segment,
    visibleLayerIds: null,
    allowedAuthorIds: null
  });

  assert.equal(ranges.length, 0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test scripts/tests/playlist-comment-index.test.js`

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement aggregate comment helper**

Create `renderer/scripts/modules/playlist-comment-index.js`:

```js
export function extractPlaylistCommentRanges(options) {
  const bframeData = options.bframeData || {};
  const segment = options.segment;
  const visibleLayerIds = options.visibleLayerIds;
  const allowedAuthorIds = options.allowedAuthorIds;
  if (!segment) return [];

  const fps = Number(bframeData.fps) || Number(segment.fps) || 24;
  const layers = Array.isArray(bframeData.comments?.layers) ? bframeData.comments.layers : [];
  const ranges = [];

  for (const layer of layers) {
    if (!layer) continue;
    if (layer.visible === false) continue;
    if (visibleLayerIds && !visibleLayerIds.has(layer.id)) continue;
    const markers = Array.isArray(layer.markers) ? layer.markers : [];

    for (const marker of markers) {
      if (!marker || marker.deleted) continue;
      const authorId = marker.authorId || marker.author || 'unknown';
      if (allowedAuthorIds && !allowedAuthorIds.has(authorId)) continue;

      const startTime = (Number(marker.startFrame) || 0) / fps;
      const endTime = Math.max(startTime, (Number(marker.endFrame) || Number(marker.startFrame) || 0) / fps);
      ranges.push({
        itemId: segment.itemId,
        itemIndex: segment.index,
        fileName: segment.fileName,
        layerId: layer.id,
        markerId: marker.id,
        text: marker.text || '',
        resolved: marker.resolved === true,
        color: marker.colorInfo?.color || layer.color || '#ffcc00',
        colorKey: marker.colorInfo?.key || marker.colorKey || 'default',
        localStartTime: startTime,
        localEndTime: endTime,
        globalStartTime: segment.startTime + startTime,
        globalEndTime: segment.startTime + endTime,
        localStartFrame: Number(marker.startFrame) || 0
      });
    }
  }

  return ranges.sort((a, b) => a.globalStartTime - b.globalStartTime);
}
```

- [ ] **Step 4: Add timeline segment rendering methods**

In `renderer/scripts/modules/timeline.js`, add methods to `Timeline`:

```js
setPlaylistTimeline(segments, totalDuration) {
  this.playlistSegments = segments || [];
  this.playlistDuration = totalDuration || 0;
  this._renderPlaylistSegments();
}

_renderPlaylistSegments() {
  if (!this.tracksContainer) return;
  this.tracksContainer.querySelectorAll('.playlist-segment-boundary').forEach(el => el.remove());
  const duration = this.playlistDuration || this.duration;
  if (!duration) return;

  for (const segment of this.playlistSegments || []) {
    const left = (segment.startTime / duration) * 100;
    const boundary = document.createElement('button');
    boundary.type = 'button';
    boundary.className = 'playlist-segment-boundary';
    boundary.style.left = `${left}%`;
    boundary.title = `${segment.fileName} ${this._formatTime(segment.startTime)}`;
    boundary.dataset.itemId = segment.itemId;
    boundary.dataset.startTime = String(segment.startTime);
    this.tracksContainer.appendChild(boundary);
  }
}

renderPlaylistCommentRanges(ranges, totalDuration) {
  if (!this.commentTrack) return;
  this.commentTrack.querySelectorAll('.playlist-comment-range').forEach(el => el.remove());
  const duration = totalDuration || this.playlistDuration || this.duration;
  if (!duration) return;

  for (const range of ranges || []) {
    const left = (range.globalStartTime / duration) * 100;
    const width = Math.max(0.2, ((range.globalEndTime - range.globalStartTime) / duration) * 100);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `playlist-comment-range${range.resolved ? ' resolved' : ''}`;
    el.style.left = `${left}%`;
    el.style.width = `${width}%`;
    el.style.setProperty('--comment-color', range.color);
    el.dataset.itemId = range.itemId;
    el.dataset.markerId = range.markerId;
    el.dataset.localStartFrame = String(range.localStartFrame);
    el.title = `${range.fileName}: ${range.text || '댓글'}`;
    this.commentTrack.appendChild(el);
  }

  this.commentTrack.style.display = ranges && ranges.length > 0 ? 'block' : 'none';
}
```

- [ ] **Step 5: Wire aggregate timeline in `app.js`**

Import helpers:

```js
import { buildPlaylistSegments, mapGlobalTimeToSegment } from './modules/playlist-continuous-core.js';
import { extractPlaylistCommentRanges } from './modules/playlist-comment-index.js';
```

Add:

```js
async function collectPlaylistMetadata(items) {
  const metadata = new Map();
  for (const item of items) {
    if (state.currentFile === item.videoPath && videoPlayer.duration) {
      metadata.set(item.id, { duration: videoPlayer.duration, fps: videoPlayer.fps || 24 });
    } else {
      metadata.set(item.id, { duration: item.duration || 0, fps: item.fps || 24 });
    }
  }
  return metadata;
}

async function updatePlaylistContinuousTimeline() {
  if (playlistUIState.mode !== 'continuous') return;
  const playlistManager = getPlaylistManager();
  const items = playlistManager.getItems();
  const metadata = await collectPlaylistMetadata(items);
  const { segments, totalDuration } = buildPlaylistSegments(items, metadata);
  timeline.setPlaylistTimeline(segments, totalDuration);

  const aggregateRanges = [];
  for (const segment of segments) {
    const item = items[segment.index];
    if (!item?.bframePath) continue;
    const bframeData = await window.electronAPI.loadReview(item.bframePath);
    if (!bframeData) continue;
    const allowedAuthorIds = commentFilterState.authors === null ? null : new Set(commentFilterState.authors);
    aggregateRanges.push(...extractPlaylistCommentRanges({
      bframeData,
      segment,
      visibleLayerIds: null,
      allowedAuthorIds
    }));
  }

  timeline.renderPlaylistCommentRanges(aggregateRanges, totalDuration);
}
```

- [ ] **Step 6: Add click handling for aggregate comments**

In `setupCommentRangeInteractions()` click handler, before existing `.comment-range-item` logic, add:

```js
const playlistCommentItem = e.target.closest('.playlist-comment-range');
if (playlistCommentItem) {
  const playlistManager = getPlaylistManager();
  const itemId = playlistCommentItem.dataset.itemId;
  const localStartFrame = parseInt(playlistCommentItem.dataset.localStartFrame, 10) || 0;
  const item = playlistManager.selectItemById(itemId);
  if (item) {
    await loadVideoFromPlaylist(item);
    videoPlayer.seekToFrame(localStartFrame);
    videoPlayer.pause();
    scrollToCommentWithGlow(playlistCommentItem.dataset.markerId);
  }
  return;
}
```

Because the existing listener is not `async`, change it to `async (e) => { ... }`.

- [ ] **Step 7: Add CSS for segments and aggregate comments**

Append to `renderer/styles/playlist-panel.css`:

```css
.playlist-segment-boundary {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  padding: 0;
  border: 0;
  background: rgba(255, 255, 255, 0.25);
  cursor: pointer;
  z-index: 8;
}

.playlist-segment-boundary:hover {
  width: 2px;
  background: var(--accent-primary);
}

.playlist-comment-range {
  position: absolute;
  top: 4px;
  height: 10px;
  border: 0;
  border-radius: 3px;
  background: var(--comment-color, var(--accent-primary));
  opacity: 0.75;
  cursor: pointer;
}

.playlist-comment-range:hover {
  opacity: 1;
  box-shadow: 0 0 0 1px var(--bg-primary), 0 0 0 2px var(--comment-color, var(--accent-primary));
}

.playlist-comment-range.resolved {
  opacity: 0.35;
}
```

- [ ] **Step 8: Add package script and run tests**

Modify `package.json`:

```json
"test:playlist-comments": "node --test scripts/tests/playlist-comment-index.test.js",
"test:playlist": "node --test scripts/tests/playlist-ordering.test.js scripts/tests/playlist-continuous-core.test.js scripts/tests/playlist-comment-index.test.js"
```

Run: `npm run test:playlist`

Expected: PASS.

- [ ] **Step 9: Manual smoke test**

Use two videos with `.bframe` comments. Open `이어보기`, verify comment bars appear on the unified timeline. Click a comment from the second video; the app should load that video, seek to the comment start frame, pause, and highlight the comment in the existing comment panel.

- [ ] **Step 10: Commit**

```bash
git add package.json renderer/scripts/modules/playlist-comment-index.js scripts/tests/playlist-comment-index.test.js renderer/scripts/modules/timeline.js renderer/scripts/app.js renderer/styles/playlist-panel.css
git commit -m "이어보기 통합 타임라인과 전체 댓글 표시 추가"
```

---

### Task 8: Modified-Date Sort and UI Completion

**Files:**
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/scripts/modules/playlist-manager.js`
- Modify: `renderer/styles/playlist-panel.css`

- [ ] **Step 1: Fill `modifiedAtMs` before modified-date sort**

Add in `app.js`:

```js
async function refreshPlaylistModifiedTimes() {
  const playlistManager = getPlaylistManager();
  const items = playlistManager.getItems();
  for (const item of items) {
    const stats = await window.electronAPI.getFileStats(item.videoPath);
    item.modifiedAtMs = Number(stats?.mtimeMs) || 0;
  }
}
```

Update the sort change handler:

```js
elements.playlistSortMode?.addEventListener('change', async (e) => {
  if (e.target.value === 'modifiedAt') {
    await refreshPlaylistModifiedTimes();
  }
  playlistManager.setSortMode(e.target.value);
  updatePlaylistUI();
  updatePlaylistContinuousTimeline();
});
```

- [ ] **Step 2: Keep current video stable after sort during continuous playback**

Before calling `playlistManager.setSortMode`, capture current item id:

```js
const currentItemId = playlistManager.getCurrentItem()?.id || null;
```

After sorting:

```js
if (currentItemId) {
  playlistManager.selectItemById(currentItemId);
}
```

Do this only in the sort handler. Do not force-load the video again.

- [ ] **Step 3: Ensure manual reorder does not reload current video**

In `initPlaylistDragReorder()` drop handler, after `playlistManager.reorderItem(draggedIndex, newIndex);`, do not call `playlistManager.selectItem()` directly. The existing `currentIndex` adjustment in manager should be the single source of truth.

- [ ] **Step 4: Run lint and playlist tests**

Run: `npm run test:playlist`

Expected: PASS.

Run: `npm run lint`

Expected: No new lint errors from edited files.

- [ ] **Step 5: Commit**

```bash
git add renderer/scripts/app.js renderer/scripts/modules/playlist-manager.js renderer/styles/playlist-panel.css
git commit -m "수정 날짜 정렬과 현재 영상 유지 동작 보완"
```

---

### Task 9: Verification and Manual QA

**Files:**
- No new code files expected.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm run test:playlist
npm run test:toast-stack
npm run test:cluster
```

Expected: PASS for all listed tests.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS or only pre-existing lint warnings that are unrelated to files changed in this plan.

- [ ] **Step 3: Start the app**

Run:

```bash
npm run dev
```

Expected: Electron app opens without renderer console errors.

- [ ] **Step 4: Manual playlist QA**

Use a test playlist with files named `shot1.mp4`, `shot2.mp4`, and `shot10.mp4`.

Verify:

- Files appear as `shot1`, `shot2`, `shot10`.
- Dragging `shot2` above `shot1` marks manual order.
- Adding `shot3` and `shot11` after manual reorder appends them as `shot3`, `shot11`.
- `파일명순`, `추가한 순서`, `수정한 날짜순` all change the visible order only when selected.
- The current video keeps playing when the order changes during `이어보기`.

- [ ] **Step 5: Manual continuous playback QA**

Verify:

- `이어보기` starts from the selected item.
- If the selected item is already loaded, playback starts from the current player position.
- If a later item is missing, it is marked and skipped.
- Multiple skipped items produce one grouped toast.
- Last item stops with `재생목록 재생 완료`.
- Repeat toggle loops from last playable item to first playable item.
- A video needing transcode shows `준비 중`, waits up to 5 seconds when its turn arrives, then plays or skips.

- [ ] **Step 6: Manual unified timeline QA**

Verify:

- `이어보기` tab shows segment boundaries on the timeline.
- Segment boundary hover shows filename/time through the `title` tooltip.
- Aggregate comment bars from multiple videos appear.
- Existing comment filters affect aggregate comment bars.
- Clicking an aggregate comment from another video loads that video, seeks to the local comment frame, pauses, and highlights the comment in the existing panel.
- Existing comment drag/resize editing still works in `리뷰` mode.

- [ ] **Step 7: Manual toast QA**

Trigger 6 toasts quickly.

Verify:

- Newest toast stays visually on top.
- Old toasts do not jump forward while disappearing.
- Hovering the toast area pauses all auto-dismiss timers.
- Hover expansion stays inside the window and scrolls within the toast container.
- Swiping or closing one toast does not reorder others incorrectly.

- [ ] **Step 8: Final commit if QA fixes were needed**

If QA produces small fixes, commit them:

```bash
git add renderer/index.html renderer/scripts/app.js renderer/scripts/modules renderer/styles package.json scripts/tests
git commit -m "재생목록 이어보기 QA 수정 반영"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Stable order: Task 1, Task 2, Task 8.
  - Review/continuous tabs: Task 5.
  - Continuous playback: Task 3, Task 6.
  - Fast check, background transcode, 5-second wait, skip toast: Task 6.
  - Unified timeline and aggregate comments: Task 7.
  - Toast stack stability: Task 4.
  - Manual verification: Task 9.
- Placeholder scan:
  - The plan contains no unresolved placeholder markers or open question markers.
- Type consistency:
  - Sort modes use `fileName`, `addedAt`, `modifiedAt`.
  - Continuous statuses use `idle`, `checking`, `preparing`, `ready`, `skipped`, `missing`, `error`.
  - Playlist settings path is `settings.continuous`.
- Out-of-scope items preserved in the approved design doc:
  - Clip trimming, direct aggregate comment editing, temporary include/exclude, extra sort modes, last continuous position memory.
