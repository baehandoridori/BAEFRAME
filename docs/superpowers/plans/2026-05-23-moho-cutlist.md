# Moho Cutlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `.bcutlist`, a Moho label based virtual cut review mode for BAEFRAME.

**Architecture:** Keep the core cut parsing and timing logic in small pure modules, then wire those modules into Electron IPC, file open handling, a dedicated cutlist panel, and existing playback/comment flows. `.bcutlist` stores cut structure and source paths; comments remain in each source video's `.bframe`.

**Tech Stack:** Electron main/preload IPC, vanilla renderer modules, Node `node:test`, existing `Timeline`, `VideoPlayer`, `ReviewDataManager`, and `.bframe` comment data.

---

## File Structure

- Create `shared/cutlist-schema.js`: `.bcutlist` constants, default object creation, validation, path/name helpers.
- Create `renderer/scripts/modules/moho-scene-info-parser.js`: parse Moho `info.txt`, filter scene labels, apply `txt frame - 1`, merge duplicate scene numbers, report ignored labels.
- Create `renderer/scripts/modules/cutlist-core.js`: pure cut ordering, missing-scene calculation, local/global time mapping, active-cut lookup, source video lookup.
- Create `renderer/scripts/modules/cutlist-manager.js`: UI-independent cutlist state, add source pair, save/open data, reconnect source video, manual ordering.
- Modify `main/ipc-handlers.js`: add `.bcutlist` read/write/delete/link handlers, info txt read handler, and include `.bcutlist` in open dialog filters.
- Modify `preload/preload.js`: expose cutlist IPC methods and open event callback.
- Modify `main/index.js`: recognize `.bcutlist` launch arguments and `baeframe://cutlist?...` links.
- Modify `renderer/index.html`: add top toolbar `컷 묶음` button, dedicated cutlist sidebar, current-cut overlay.
- Modify `renderer/styles/main.css`: current-cut video overlay and timeline current-cut highlighting.
- Create `renderer/styles/cutlist-panel.css`: dedicated panel layout.
- Modify `renderer/scripts/app.js`: initialize cutlist feature, open/save `.bcutlist`, source-pair picker flow, click-to-seek, comment display integration, broken-path handling.
- Modify `renderer/scripts/modules/timeline.js`: render cutlist segments and current cut state separately from playlist segments.
- Modify `renderer/scripts/modules/playlist-comment-index.js` or create `renderer/scripts/modules/cutlist-comment-index.js`: format cutlist comment labels without changing normal review labels.
- Modify `package.json`: add `test:cutlist`.
- Create `scripts/tests/moho-scene-info-parser.test.js`: parser coverage.
- Create `scripts/tests/cutlist-core.test.js`: ordering/mapping/current-cut coverage.
- Create `scripts/tests/cutlist-schema.test.js`: schema validation coverage.
- Create `scripts/tests/cutlist-runtime-source.test.js`: source checks for IPC, DOM hooks, and styles.

## Task 1: Core Parser And Schema

**Files:**
- Create: `shared/cutlist-schema.js`
- Create: `renderer/scripts/modules/moho-scene-info-parser.js`
- Test: `scripts/tests/moho-scene-info-parser.test.js`
- Test: `scripts/tests/cutlist-schema.test.js`

- [ ] **Step 1: Write failing schema tests**

Create `scripts/tests/cutlist-schema.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUTLIST_VERSION,
  createDefaultCutlistData,
  validateCutlistData,
  createCutlistSource,
  createCutlistCut,
  isCutlistFilePath,
  suggestCutlistFileName
} from '../../shared/cutlist-schema.js';

test('creates valid default cutlist data', () => {
  const data = createDefaultCutlistData({ name: 'a019-a029', userName: 'tester', userId: 'u1' });

  assert.equal(data.cutlistVersion, CUTLIST_VERSION);
  assert.equal(data.name, 'a019-a029');
  assert.equal(data.createdBy, 'tester');
  assert.deepEqual(data.sources, []);
  assert.deepEqual(data.cuts, []);
  assert.equal(data.settings.showMissingScenes, false);
  assert.equal(validateCutlistData(data).valid, true);
});

test('validates required source and cut fields', () => {
  const data = createDefaultCutlistData({ name: 'demo' });
  data.sources.push(createCutlistSource({
    id: 'source_1',
    videoPath: 'G:/shot/a019.mp4',
    infoPath: 'G:/shot/a019_info.txt',
    infoText: 'FPS: 24.0',
    fileName: 'a019.mp4'
  }));
  data.cuts.push(createCutlistCut({
    id: 'cut_23',
    sourceId: 'source_1',
    sceneNumber: 23,
    label: 'sc023',
    startFrame: 41,
    endFrame: 91,
    mohoStartFrame: 42,
    mohoEndFrame: 92,
    fps: 24
  }));

  const result = validateCutlistData(data);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('rejects invalid cut ranges and missing paths', () => {
  const data = createDefaultCutlistData({ name: 'bad' });
  data.sources.push(createCutlistSource({ id: 'source_1', videoPath: '', infoPath: '', infoText: '' }));
  data.cuts.push(createCutlistCut({
    id: 'cut_bad',
    sourceId: 'source_1',
    sceneNumber: 1,
    label: 'a001',
    startFrame: 10,
    endFrame: 9,
    mohoStartFrame: 11,
    mohoEndFrame: 10,
    fps: 24
  }));

  const result = validateCutlistData(data);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /videoPath/);
  assert.match(result.errors.join('\n'), /endFrame/);
});

test('detects cutlist paths and suggests names', () => {
  assert.equal(isCutlistFilePath('G:/shot/a019-a029.bcutlist'), true);
  assert.equal(isCutlistFilePath('G:/shot/a019-a029.bplaylist'), false);
  assert.equal(suggestCutlistFileName([{ sceneNumber: 19 }, { sceneNumber: 29 }]), 'a019-a029.bcutlist');
});
```

- [ ] **Step 2: Run schema tests to verify failure**

Run:

```bash
node --test scripts/tests/cutlist-schema.test.js
```

Expected: FAIL with module not found for `shared/cutlist-schema.js`.

- [ ] **Step 3: Implement schema module**

Create `shared/cutlist-schema.js`:

```js
export const CUTLIST_VERSION = '1.0';
export const CUTLIST_EXTENSION = 'bcutlist';
export const SUPPORTED_CUTLIST_VERSIONS = ['1.0'];

export function generateCutlistId(prefix = 'cutlist') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

export function extractFileName(filePath) {
  if (!filePath) return '';
  return String(filePath).replace(/\\/g, '/').split('/').pop() || '';
}

export function sanitizeFileName(name) {
  return String(name || '컷 묶음').replace(/[<>:"/\\|?*]/g, '_').trim() || '컷 묶음';
}

export function isCutlistFilePath(filePath) {
  return String(filePath || '').split(/[?#]/)[0].toLowerCase().endsWith(`.${CUTLIST_EXTENSION}`);
}

export function createDefaultCutlistData(options = {}) {
  const now = new Date().toISOString();
  return {
    cutlistVersion: CUTLIST_VERSION,
    id: options.id || generateCutlistId(),
    name: options.name || '새 컷 묶음',
    createdAt: now,
    modifiedAt: now,
    createdBy: options.userName || '',
    createdById: options.userId || '',
    sources: [],
    cuts: [],
    settings: {
      showMissingScenes: false,
      manualOrder: false
    },
    future: {
      drawingEnabled: false
    }
  };
}

export function createCutlistSource(input = {}) {
  return {
    id: input.id || generateCutlistId('source'),
    videoPath: input.videoPath || '',
    infoPath: input.infoPath || '',
    infoText: input.infoText || '',
    fileName: input.fileName || extractFileName(input.videoPath),
    fps: Number(input.fps) > 0 ? Number(input.fps) : 24,
    missing: input.missing === true,
    addedAt: input.addedAt || new Date().toISOString()
  };
}

export function createCutlistCut(input = {}) {
  return {
    id: input.id || generateCutlistId('cut'),
    sourceId: input.sourceId || '',
    sceneNumber: Number(input.sceneNumber),
    label: input.label || '',
    startFrame: Number(input.startFrame),
    endFrame: Number(input.endFrame),
    mohoStartFrame: Number(input.mohoStartFrame),
    mohoEndFrame: Number(input.mohoEndFrame),
    fps: Number(input.fps) > 0 ? Number(input.fps) : 24,
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
    ignored: input.ignored === true
  };
}

export function validateCutlistData(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['데이터가 객체가 아닙니다.'] };
  }
  if (!SUPPORTED_CUTLIST_VERSIONS.includes(data.cutlistVersion)) {
    errors.push(`지원하지 않는 컷 묶음 버전입니다: ${data.cutlistVersion || '(없음)'}`);
  }
  if (!data.id) errors.push('id 필드가 없습니다.');
  if (!data.name || typeof data.name !== 'string') errors.push('name 필드가 유효하지 않습니다.');
  if (!Array.isArray(data.sources)) errors.push('sources 필드가 배열이 아닙니다.');
  if (!Array.isArray(data.cuts)) errors.push('cuts 필드가 배열이 아닙니다.');

  (data.sources || []).forEach((source, index) => {
    if (!source.id) errors.push(`sources[${index}]: id 필드가 없습니다.`);
    if (!source.videoPath) errors.push(`sources[${index}]: videoPath 필드가 없습니다.`);
    if (!source.infoPath) errors.push(`sources[${index}]: infoPath 필드가 없습니다.`);
  });

  (data.cuts || []).forEach((cut, index) => {
    if (!cut.id) errors.push(`cuts[${index}]: id 필드가 없습니다.`);
    if (!cut.sourceId) errors.push(`cuts[${index}]: sourceId 필드가 없습니다.`);
    if (!Number.isFinite(Number(cut.sceneNumber))) errors.push(`cuts[${index}]: sceneNumber가 유효하지 않습니다.`);
    if (!cut.label) errors.push(`cuts[${index}]: label 필드가 없습니다.`);
    if (!Number.isFinite(Number(cut.startFrame))) errors.push(`cuts[${index}]: startFrame이 유효하지 않습니다.`);
    if (!Number.isFinite(Number(cut.endFrame))) errors.push(`cuts[${index}]: endFrame이 유효하지 않습니다.`);
    if (Number(cut.endFrame) < Number(cut.startFrame)) errors.push(`cuts[${index}]: endFrame은 startFrame보다 작을 수 없습니다.`);
  });

  return { valid: errors.length === 0, errors };
}

export function suggestCutlistFileName(cuts = []) {
  const sceneNumbers = cuts
    .map(cut => Number(cut.sceneNumber))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (sceneNumbers.length === 0) return 'cutlist.bcutlist';
  const first = String(sceneNumbers[0]).padStart(3, '0');
  const last = String(sceneNumbers[sceneNumbers.length - 1]).padStart(3, '0');
  return sanitizeFileName(`a${first}-a${last}`) + '.bcutlist';
}
```

- [ ] **Step 4: Verify schema tests pass**

Run:

```bash
node --test scripts/tests/cutlist-schema.test.js
```

Expected: PASS all schema tests.

- [ ] **Step 5: Write failing parser tests**

Create `scripts/tests/moho-scene-info-parser.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMohoSceneInfo,
  mergeDuplicateSceneCuts,
  buildCutsFromMohoSceneInfo
} from '../../renderer/scripts/modules/moho-scene-info-parser.js';

const SAMPLE = `SW Timeline Scene Info
======================
Marker Level: Document
Project Path: G:\\shot\\a019, a023, a028_re6.moho
FPS: 24.0
Document Range: 1 - 204
Scene Count: 5

01. sc019
    Range: 1 - 11
    Frames: 11f
    Length: 00분 00초 11프레임 (00:00:11)

02. 실제 사운드 시작지점
    Range: 12 - 41
    Frames: 30f

03. sc023
    Range: 42 - 92
    Frames: 51f

04. a028
    Range: 93 - 204
    Frames: 112f

05. a028
    Range: 205 - 205
    Frames: 1f
`;

test('parses fps, project path, and scene blocks', () => {
  const parsed = parseMohoSceneInfo(SAMPLE);

  assert.equal(parsed.fps, 24);
  assert.equal(parsed.projectPath, 'G:\\shot\\a019, a023, a028_re6.moho');
  assert.equal(parsed.entries.length, 5);
  assert.equal(parsed.entries[2].label, 'sc023');
  assert.equal(parsed.entries[2].mohoStartFrame, 42);
  assert.equal(parsed.entries[2].mohoEndFrame, 92);
});

test('builds scene cuts from numeric labels and applies minus-one frame offset', () => {
  const result = buildCutsFromMohoSceneInfo(SAMPLE, { sourceId: 'source_1' });

  assert.deepEqual(result.cuts.map(c => c.label), ['sc019', 'sc023', 'a028']);
  assert.deepEqual(result.cuts.map(c => c.sceneNumber), [19, 23, 28]);
  assert.deepEqual(result.cuts.find(c => c.label === 'sc023'), {
    id: 'source_1_23_41_91',
    sourceId: 'source_1',
    sceneNumber: 23,
    label: 'sc023',
    startFrame: 41,
    endFrame: 91,
    mohoStartFrame: 42,
    mohoEndFrame: 92,
    frameCount: 51,
    fps: 24,
    order: 1
  });
});

test('reports ignored memo labels and short duplicate scenes', () => {
  const result = buildCutsFromMohoSceneInfo(SAMPLE, { sourceId: 'source_1' });

  assert.equal(result.ignored.length, 2);
  assert.equal(result.ignored[0].label, '실제 사운드 시작지점');
  assert.equal(result.ignored[0].reason, 'scene-label-not-numbered');
  assert.equal(result.ignored[1].label, 'a028');
  assert.equal(result.ignored[1].reason, 'duplicate-shorter-scene');
});

test('keeps the longest duplicate scene per scene number', () => {
  const cuts = [
    { sceneNumber: 28, label: 'a028', frameCount: 112, startFrame: 92, endFrame: 203 },
    { sceneNumber: 28, label: 'a028', frameCount: 1, startFrame: 204, endFrame: 204 }
  ];

  const result = mergeDuplicateSceneCuts(cuts);

  assert.equal(result.cuts.length, 1);
  assert.equal(result.cuts[0].frameCount, 112);
  assert.equal(result.ignored[0].reason, 'duplicate-shorter-scene');
});
```

- [ ] **Step 6: Run parser tests to verify failure**

Run:

```bash
node --test scripts/tests/moho-scene-info-parser.test.js
```

Expected: FAIL with module not found for `moho-scene-info-parser.js`.

- [ ] **Step 7: Implement parser module**

Create `renderer/scripts/modules/moho-scene-info-parser.js`:

```js
const SCENE_HEADER_PATTERN = /^\s*(\d+)\.\s+(.+?)\s*$/;
const RANGE_PATTERN = /^\s*Range:\s*(-?\d+)\s*-\s*(-?\d+)\s*$/i;
const FPS_PATTERN = /^\s*FPS:\s*([0-9]+(?:\.[0-9]+)?)\s*$/i;
const PROJECT_PATH_PATTERN = /^\s*Project Path:\s*(.+?)\s*$/i;
const NUMBERED_SCENE_PATTERN = /^(?:a|sc)\s*0*(\d+)$/i;

export function getSceneNumberFromLabel(label) {
  const match = String(label || '').trim().match(NUMBERED_SCENE_PATTERN);
  return match ? Number(match[1]) : null;
}

export function parseMohoSceneInfo(text) {
  const lines = String(text || '').split(/\r?\n/);
  const entries = [];
  let current = null;
  let fps = 24;
  let projectPath = '';

  for (const line of lines) {
    const fpsMatch = line.match(FPS_PATTERN);
    if (fpsMatch) {
      fps = Number(fpsMatch[1]) || 24;
      continue;
    }

    const projectMatch = line.match(PROJECT_PATH_PATTERN);
    if (projectMatch) {
      projectPath = projectMatch[1].trim();
      continue;
    }

    const headerMatch = line.match(SCENE_HEADER_PATTERN);
    if (headerMatch) {
      current = {
        index: Number(headerMatch[1]),
        label: headerMatch[2].trim(),
        mohoStartFrame: null,
        mohoEndFrame: null
      };
      entries.push(current);
      continue;
    }

    const rangeMatch = line.match(RANGE_PATTERN);
    if (rangeMatch && current) {
      current.mohoStartFrame = Number(rangeMatch[1]);
      current.mohoEndFrame = Number(rangeMatch[2]);
    }
  }

  return { fps, projectPath, entries };
}

function toCut(entry, sourceId, fps, order) {
  const sceneNumber = getSceneNumberFromLabel(entry.label);
  const mohoStartFrame = Number(entry.mohoStartFrame);
  const mohoEndFrame = Number(entry.mohoEndFrame);
  const startFrame = mohoStartFrame - 1;
  const endFrame = mohoEndFrame - 1;
  const frameCount = endFrame - startFrame + 1;

  return {
    id: `${sourceId}_${sceneNumber}_${startFrame}_${endFrame}`,
    sourceId,
    sceneNumber,
    label: entry.label,
    startFrame,
    endFrame,
    mohoStartFrame,
    mohoEndFrame,
    frameCount,
    fps,
    order
  };
}

export function mergeDuplicateSceneCuts(cuts) {
  const byScene = new Map();
  const ignored = [];

  for (const cut of cuts) {
    const previous = byScene.get(cut.sceneNumber);
    if (!previous) {
      byScene.set(cut.sceneNumber, cut);
      continue;
    }

    const previousCount = Number(previous.frameCount) || (previous.endFrame - previous.startFrame + 1);
    const nextCount = Number(cut.frameCount) || (cut.endFrame - cut.startFrame + 1);
    if (nextCount > previousCount) {
      ignored.push({ ...previous, reason: 'duplicate-shorter-scene' });
      byScene.set(cut.sceneNumber, cut);
    } else {
      ignored.push({ ...cut, reason: 'duplicate-shorter-scene' });
    }
  }

  return {
    cuts: Array.from(byScene.values()).sort((a, b) => a.sceneNumber - b.sceneNumber),
    ignored
  };
}

export function buildCutsFromMohoSceneInfo(text, options = {}) {
  const parsed = parseMohoSceneInfo(text);
  const sourceId = options.sourceId || 'source';
  const validCuts = [];
  const ignored = [];

  parsed.entries.forEach((entry) => {
    const sceneNumber = getSceneNumberFromLabel(entry.label);
    if (!sceneNumber) {
      ignored.push({ ...entry, reason: 'scene-label-not-numbered' });
      return;
    }
    if (!Number.isFinite(entry.mohoStartFrame) || !Number.isFinite(entry.mohoEndFrame)) {
      ignored.push({ ...entry, sceneNumber, reason: 'scene-range-missing' });
      return;
    }
    const cut = toCut(entry, sourceId, parsed.fps, validCuts.length);
    if (cut.frameCount <= 0) {
      ignored.push({ ...entry, sceneNumber, reason: 'scene-range-invalid' });
      return;
    }
    validCuts.push(cut);
  });

  const merged = mergeDuplicateSceneCuts(validCuts);
  return {
    fps: parsed.fps,
    projectPath: parsed.projectPath,
    cuts: merged.cuts.map((cut, index) => ({ ...cut, order: index })),
    ignored: [...ignored, ...merged.ignored]
  };
}
```

- [ ] **Step 8: Run parser/schema tests**

Run:

```bash
node --test scripts/tests/cutlist-schema.test.js scripts/tests/moho-scene-info-parser.test.js
```

Expected: PASS both test files.

- [ ] **Step 9: Commit core parser and schema**

Run:

```bash
git add shared/cutlist-schema.js renderer/scripts/modules/moho-scene-info-parser.js scripts/tests/cutlist-schema.test.js scripts/tests/moho-scene-info-parser.test.js
git commit -m "Moho 컷 묶음 파서와 스키마 추가"
```

## Task 2: Cutlist Core Timing And Ordering

**Files:**
- Create: `renderer/scripts/modules/cutlist-core.js`
- Test: `scripts/tests/cutlist-core.test.js`

- [ ] **Step 1: Write failing core tests**

Create `scripts/tests/cutlist-core.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortCutsBySceneNumber,
  applyManualCutOrder,
  buildMissingSceneRows,
  buildCutlistTimeline,
  mapGlobalTimeToCut,
  mapCutFrameToSourceTime,
  findCurrentCut
} from '../../renderer/scripts/modules/cutlist-core.js';

const cuts = [
  { id: 'cut_20', sourceId: 'A', sceneNumber: 20, label: 'a020', startFrame: 0, endFrame: 73, fps: 24 },
  { id: 'cut_23', sourceId: 'B', sceneNumber: 23, label: 'sc023', startFrame: 41, endFrame: 91, fps: 24 },
  { id: 'cut_22', sourceId: 'A', sceneNumber: 22, label: 'a022', startFrame: 74, endFrame: 99, fps: 24 }
];

test('sorts by scene number then source label', () => {
  assert.deepEqual(sortCutsBySceneNumber(cuts).map(c => c.id), ['cut_20', 'cut_22', 'cut_23']);
});

test('applies saved manual order', () => {
  const ordered = applyManualCutOrder(cuts, ['cut_23', 'cut_20']);
  assert.deepEqual(ordered.map(c => c.id), ['cut_23', 'cut_20', 'cut_22']);
});

test('builds missing scene rows when option is enabled', () => {
  const rows = buildMissingSceneRows(sortCutsBySceneNumber(cuts), { showMissingScenes: true });
  assert.deepEqual(rows.map(row => row.label), ['a020', 'a021 없음', 'a022', 'sc023']);
  assert.equal(rows[1].missing, true);
});

test('builds timeline using cut frame counts', () => {
  const timeline = buildCutlistTimeline(sortCutsBySceneNumber(cuts));

  assert.equal(timeline.totalFrames, 151);
  assert.equal(timeline.totalDuration, 151 / 24);
  assert.deepEqual(timeline.segments.map(s => ({
    id: s.cutId,
    startFrame: s.globalStartFrame,
    endFrame: s.globalEndFrame
  })), [
    { id: 'cut_20', startFrame: 0, endFrame: 73 },
    { id: 'cut_22', startFrame: 74, endFrame: 99 },
    { id: 'cut_23', startFrame: 100, endFrame: 150 }
  ]);
});

test('maps global time to cut and source local time', () => {
  const timeline = buildCutlistTimeline(sortCutsBySceneNumber(cuts));
  const mapped = mapGlobalTimeToCut(timeline.segments, 100 / 24);

  assert.equal(mapped.segment.cutId, 'cut_23');
  assert.equal(mapped.localFrame, 0);
  assert.equal(mapped.sourceFrame, 41);
});

test('maps a source frame to seconds', () => {
  assert.equal(mapCutFrameToSourceTime({ startFrame: 41, fps: 24 }, 3), 44 / 24);
});

test('finds current cut by source id and frame', () => {
  assert.equal(findCurrentCut(cuts, { sourceId: 'B', frame: 91 }).id, 'cut_23');
  assert.equal(findCurrentCut(cuts, { sourceId: 'B', frame: 92 }), null);
});
```

- [ ] **Step 2: Run core tests to verify failure**

Run:

```bash
node --test scripts/tests/cutlist-core.test.js
```

Expected: FAIL with module not found for `cutlist-core.js`.

- [ ] **Step 3: Implement cutlist core module**

Create `renderer/scripts/modules/cutlist-core.js`:

```js
export function getCutFrameCount(cut) {
  return Math.max(0, Number(cut.endFrame) - Number(cut.startFrame) + 1);
}

export function sortCutsBySceneNumber(cuts = []) {
  return [...cuts].sort((a, b) => (
    Number(a.sceneNumber) - Number(b.sceneNumber) ||
    String(a.label || '').localeCompare(String(b.label || ''), 'ko') ||
    String(a.id || '').localeCompare(String(b.id || ''))
  ));
}

export function applyManualCutOrder(cuts = [], manualOrder = []) {
  const byId = new Map(cuts.map(cut => [cut.id, cut]));
  const ordered = [];
  for (const id of manualOrder || []) {
    const cut = byId.get(id);
    if (cut) {
      ordered.push(cut);
      byId.delete(id);
    }
  }
  return [...ordered, ...sortCutsBySceneNumber(Array.from(byId.values()))];
}

export function buildMissingSceneRows(cuts = [], options = {}) {
  const sorted = sortCutsBySceneNumber(cuts);
  if (options.showMissingScenes !== true || sorted.length === 0) {
    return sorted.map(cut => ({ ...cut, missing: false }));
  }

  const rows = [];
  for (let index = 0; index < sorted.length; index++) {
    const cut = sorted[index];
    const previous = sorted[index - 1];
    if (previous) {
      for (let scene = previous.sceneNumber + 1; scene < cut.sceneNumber; scene++) {
        rows.push({
          id: `missing_${scene}`,
          sceneNumber: scene,
          label: `a${String(scene).padStart(3, '0')} 없음`,
          missing: true
        });
      }
    }
    rows.push({ ...cut, missing: false });
  }
  return rows;
}

export function buildCutlistTimeline(cuts = []) {
  const segments = [];
  let cursorFrame = 0;

  for (const cut of cuts) {
    const frameCount = getCutFrameCount(cut);
    const fps = Number(cut.fps) > 0 ? Number(cut.fps) : 24;
    const segment = {
      cutId: cut.id,
      sourceId: cut.sourceId,
      label: cut.label,
      sceneNumber: cut.sceneNumber,
      sourceStartFrame: cut.startFrame,
      sourceEndFrame: cut.endFrame,
      globalStartFrame: cursorFrame,
      globalEndFrame: cursorFrame + frameCount - 1,
      startTime: cursorFrame / fps,
      endTime: (cursorFrame + frameCount) / fps,
      duration: frameCount / fps,
      fps
    };
    segments.push(segment);
    cursorFrame += frameCount;
  }

  const fps = Number(segments[0]?.fps) > 0 ? Number(segments[0].fps) : 24;
  return {
    segments,
    totalFrames: cursorFrame,
    totalDuration: cursorFrame / fps
  };
}

export function mapGlobalTimeToCut(segments = [], globalTime = 0) {
  if (segments.length === 0) return null;
  const time = Math.max(0, Number(globalTime) || 0);
  const segment = segments.find(s => time >= s.startTime && time < s.endTime) || segments[segments.length - 1];
  const localFrame = Math.max(0, Math.floor((time - segment.startTime) * segment.fps));
  return {
    segment,
    localFrame,
    sourceFrame: segment.sourceStartFrame + localFrame,
    localTime: localFrame / segment.fps,
    sourceTime: (segment.sourceStartFrame + localFrame) / segment.fps
  };
}

export function mapCutFrameToSourceTime(cut, localFrame = 0) {
  const fps = Number(cut.fps) > 0 ? Number(cut.fps) : 24;
  return (Number(cut.startFrame) + Math.max(0, Number(localFrame) || 0)) / fps;
}

export function findCurrentCut(cuts = [], position = {}) {
  const frame = Number(position.frame);
  if (!position.sourceId || !Number.isFinite(frame)) return null;
  return cuts.find(cut => (
    cut.sourceId === position.sourceId &&
    frame >= Number(cut.startFrame) &&
    frame <= Number(cut.endFrame)
  )) || null;
}
```

- [ ] **Step 4: Run cutlist core tests**

Run:

```bash
node --test scripts/tests/cutlist-core.test.js
```

Expected: PASS all core tests.

- [ ] **Step 5: Run all cutlist pure tests**

Run:

```bash
node --test scripts/tests/cutlist-schema.test.js scripts/tests/moho-scene-info-parser.test.js scripts/tests/cutlist-core.test.js
```

Expected: PASS all pure cutlist tests.

- [ ] **Step 6: Commit core timing and ordering**

Run:

```bash
git add renderer/scripts/modules/cutlist-core.js scripts/tests/cutlist-core.test.js
git commit -m "컷 묶음 시간 계산과 정렬 규칙 추가"
```

## Task 3: Electron IPC And File Opening

**Files:**
- Modify: `main/ipc-handlers.js`
- Modify: `preload/preload.js`
- Modify: `main/index.js`
- Test: `scripts/tests/cutlist-runtime-source.test.js`

- [ ] **Step 1: Write failing source tests for IPC and launch hooks**

Create `scripts/tests/cutlist-runtime-source.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainIpc = fs.readFileSync('main/ipc-handlers.js', 'utf-8');
const preload = fs.readFileSync('preload/preload.js', 'utf-8');
const mainIndex = fs.readFileSync('main/index.js', 'utf-8');
const rendererIndex = fs.readFileSync('renderer/index.html', 'utf-8');
const appSource = fs.readFileSync('renderer/scripts/app.js', 'utf-8');
const timelineSource = fs.readFileSync('renderer/scripts/modules/timeline.js', 'utf-8');

test('main process exposes cutlist file handlers', () => {
  assert.match(mainIpc, /cutlist:read/);
  assert.match(mainIpc, /cutlist:write/);
  assert.match(mainIpc, /cutlist:read-info-text/);
  assert.match(mainIpc, /cutlist:generate-link/);
});

test('preload exposes cutlist renderer API', () => {
  assert.match(preload, /readCutlist/);
  assert.match(preload, /writeCutlist/);
  assert.match(preload, /readCutlistInfoText/);
  assert.match(preload, /onOpenCutlist/);
});

test('main process recognizes bcutlist launch inputs', () => {
  assert.match(mainIndex, /\.bcutlist/);
  assert.match(mainIndex, /open-cutlist/);
  assert.match(mainIndex, /baeframe:\/\/cutlist/);
});

test('renderer has cutlist DOM hooks', () => {
  assert.match(rendererIndex, /btnCutlist/);
  assert.match(rendererIndex, /cutlistSidebar/);
  assert.match(rendererIndex, /currentCutOverlay/);
});

test('renderer initializes cutlist feature', () => {
  assert.match(appSource, /initCutlistFeature/);
  assert.match(appSource, /openCutlistFile/);
  assert.match(appSource, /addCutlistSourcePair/);
});

test('timeline can render cutlist segments', () => {
  assert.match(timelineSource, /setCutlistTimeline/);
  assert.match(timelineSource, /setCurrentCutId/);
});
```

- [ ] **Step 2: Run source tests to verify failure**

Run:

```bash
node --test scripts/tests/cutlist-runtime-source.test.js
```

Expected: FAIL because cutlist handlers and DOM hooks are not present.

- [ ] **Step 3: Add main-process `.bcutlist` handlers**

Modify `main/ipc-handlers.js`.

In the open dialog filters, include `.bcutlist`:

```js
{ name: 'BAEFRAME 파일', extensions: [...MEDIA_FILE_EXTENSIONS, 'bplaylist', 'bcutlist'] },
{ name: 'BAEFRAME 컷 묶음', extensions: ['bcutlist'] },
{ name: 'BAEFRAME 재생목록', extensions: ['bplaylist'] },
```

After `setupPlaylistHandlers()`, add `setupCutlistHandlers()`:

```js
function setupCutlistHandlers() {
  ipcMain.handle('cutlist:read', async (event, filePath) => {
    const trace = log.trace('cutlist:read');
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      trace.end({ filePath });
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        trace.end({ filePath, exists: false });
        return null;
      }
      trace.error(error);
      throw error;
    }
  });

  ipcMain.handle('cutlist:write', async (event, filePath, data) => {
    const trace = log.trace('cutlist:write');
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      trace.end({ filePath });
      return { success: true };
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  ipcMain.handle('cutlist:delete', async (event, filePath) => {
    const trace = log.trace('cutlist:delete');
    try {
      await fs.promises.unlink(filePath);
      trace.end({ filePath });
      return { success: true };
    } catch (error) {
      if (error.code === 'ENOENT') {
        trace.end({ filePath, exists: false });
        return { success: true };
      }
      trace.error(error);
      throw error;
    }
  });

  ipcMain.handle('cutlist:read-info-text', async (event, filePath) => {
    const trace = log.trace('cutlist:read-info-text');
    try {
      const normalized = String(filePath || '');
      if (!normalized.toLowerCase().endsWith('.txt')) {
        throw new Error('info txt 파일만 읽을 수 있습니다.');
      }
      const content = await fs.promises.readFile(normalized, 'utf-8');
      trace.end({ filePath: normalized, length: content.length });
      return content;
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  ipcMain.handle('cutlist:generate-link', async (event, cutlistPath) => {
    const encodedPath = encodeURIComponent(cutlistPath);
    return `baeframe://cutlist?file=${encodedPath}`;
  });
}
```

Inside `setupIpcHandlers()`, call:

```js
setupCutlistHandlers();
```

- [ ] **Step 4: Expose preload cutlist APIs**

Modify `preload/preload.js` after playlist APIs:

```js
  // ====== 컷 묶음 관련 ======
  readCutlist: (filePath) => ipcRenderer.invoke('cutlist:read', filePath),
  writeCutlist: (filePath, data) => ipcRenderer.invoke('cutlist:write', filePath, data),
  deleteCutlist: (filePath) => ipcRenderer.invoke('cutlist:delete', filePath),
  readCutlistInfoText: (filePath) => ipcRenderer.invoke('cutlist:read-info-text', filePath),
  generateCutlistLink: (cutlistPath) => ipcRenderer.invoke('cutlist:generate-link', cutlistPath),
```

Add the event listener:

```js
  onOpenCutlist: (callback) => {
    ipcRenderer.on('open-cutlist', (event, path) => callback(path));
  },
```

- [ ] **Step 5: Add `.bcutlist` launch and protocol routing**

Modify `main/index.js`.

Add `.bcutlist` to launch argument recognition:

```js
function isLaunchArgument(arg) {
  if (!arg || typeof arg !== 'string') return false;
  return arg.startsWith('baeframe://') ||
    hasExtension(arg, '.bframe') ||
    hasExtension(arg, '.bplaylist') ||
    hasExtension(arg, '.bcutlist') ||
    isSupportedVideoPath(arg);
}
```

In `second-instance` handling, before playlist routing fallback:

```js
if (arg.match(/^baeframe:\/\/cutlist[\/\?%]/i)) {
  const fileMatch = arg.match(/[?&]file=([^&]+)/i);
  const cutlistPath = fileMatch ? decodeURIComponent(fileMatch[1]) : '';
  if (cutlistPath) {
    mainWindow.webContents.send('open-cutlist', cutlistPath);
    return;
  }
}

if (hasExtension(arg, '.bcutlist')) {
  mainWindow.webContents.send('open-cutlist', arg);
  return;
}
```

In startup argument handling, mirror the playlist branch:

```js
let isCutlistArg = false;
if (fileArg && hasExtension(fileArg, '.bcutlist')) {
  isCutlistArg = true;
  log.info('컷 묶음 파일로 시작됨', { fileArg });
}
```

Where the renderer receives playlist startup events, add:

```js
if (isCutlistArg) {
  mainWindow.webContents.send('open-cutlist', fileArg);
} else if (isPlaylistArg) {
  mainWindow.webContents.send('open-playlist', playlistPath);
} else {
  mainWindow.webContents.send('open-from-protocol', fileArg, parseBaeframeUrl._lastCommentId || null);
}
```

- [ ] **Step 6: Run runtime source test**

Run:

```bash
node --test scripts/tests/cutlist-runtime-source.test.js
```

Expected: still FAIL because renderer DOM and timeline hooks are not added yet. Confirm IPC and launch assertions pass before continuing.

- [ ] **Step 7: Commit IPC and launch routing**

Run:

```bash
git add main/ipc-handlers.js preload/preload.js main/index.js scripts/tests/cutlist-runtime-source.test.js
git commit -m "컷 묶음 파일 입출력 경로 추가"
```

## Task 4: Cutlist Manager And Dedicated UI

**Files:**
- Create: `renderer/scripts/modules/cutlist-manager.js`
- Modify: `renderer/index.html`
- Create: `renderer/styles/cutlist-panel.css`
- Modify: `renderer/styles/main.css`
- Modify: `renderer/scripts/app.js`

- [ ] **Step 1: Create cutlist manager**

Create `renderer/scripts/modules/cutlist-manager.js`:

```js
import { createLogger } from '../logger.js';
import {
  createDefaultCutlistData,
  createCutlistSource,
  createCutlistCut,
  validateCutlistData,
  suggestCutlistFileName
} from '../../../shared/cutlist-schema.js';
import { buildCutsFromMohoSceneInfo } from './moho-scene-info-parser.js';
import {
  applyManualCutOrder,
  sortCutsBySceneNumber,
  buildMissingSceneRows,
  buildCutlistTimeline
} from './cutlist-core.js';

const log = createLogger('CutlistManager');

export class CutlistManager extends EventTarget {
  constructor() {
    super();
    this.currentCutlist = null;
    this.cutlistPath = null;
    this.currentCutId = null;
    this.manualOrder = [];
    this.isModified = false;
  }

  createNew(name = '새 컷 묶음') {
    this.currentCutlist = createDefaultCutlistData({
      name,
      userName: window.appState?.userName || '',
      userId: window.appState?.sessionId || ''
    });
    this.cutlistPath = null;
    this.currentCutId = null;
    this.manualOrder = [];
    this.isModified = true;
    this._emitChanged('created');
    return this.currentCutlist;
  }

  async open(filePath) {
    const data = await window.electronAPI.readCutlist(filePath);
    if (!data) throw new Error('컷 묶음 파일을 찾을 수 없습니다.');
    const validation = validateCutlistData(data);
    if (!validation.valid) throw new Error(validation.errors.join('\n'));
    this.currentCutlist = data;
    this.cutlistPath = filePath;
    this.manualOrder = data.manualOrder || data.cuts.map(cut => cut.id);
    this.currentCutId = data.cuts[0]?.id || null;
    this.isModified = false;
    await this.refreshMissingSources();
    this._emitChanged('opened');
    return this.currentCutlist;
  }

  async save(savePath = null) {
    if (!this.currentCutlist) throw new Error('저장할 컷 묶음이 없습니다.');
    const targetPath = savePath || this.cutlistPath || await this._suggestSavePath();
    this.currentCutlist.modifiedAt = new Date().toISOString();
    this.currentCutlist.manualOrder = this.manualOrder;
    await window.electronAPI.writeCutlist(targetPath, this.currentCutlist);
    this.cutlistPath = targetPath;
    this.isModified = false;
    this._emitChanged('saved');
    return targetPath;
  }

  async _suggestSavePath() {
    const firstInfoPath = this.currentCutlist?.sources?.[0]?.infoPath;
    if (!firstInfoPath) throw new Error('저장 위치를 정할 info txt가 없습니다.');
    const folder = await window.electronAPI.pathDirname(firstInfoPath);
    const fileName = suggestCutlistFileName(this.currentCutlist.cuts);
    return window.electronAPI.pathJoin(folder, fileName);
  }

  async addSourcePair(infoPath, videoPath) {
    if (!this.currentCutlist) this.createNew();
    const infoText = await window.electronAPI.readCutlistInfoText(infoPath);
    const sourceId = `source_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const parsed = buildCutsFromMohoSceneInfo(infoText, { sourceId });
    const fileInfo = await window.electronAPI.getFileInfo(videoPath);
    const source = createCutlistSource({
      id: sourceId,
      videoPath,
      infoPath,
      infoText,
      fileName: fileInfo?.name || videoPath.split(/[\\/]/).pop(),
      fps: parsed.fps
    });
    this.currentCutlist.sources.push({ ...source, ignoredLabels: parsed.ignored });
    this.currentCutlist.cuts.push(...parsed.cuts.map(cut => createCutlistCut(cut)));
    this._normalizeOrder();
    this.isModified = true;
    this._emitChanged('source-added', { source, ignored: parsed.ignored });
    return { source, cuts: parsed.cuts, ignored: parsed.ignored };
  }

  getOrderedCuts() {
    const cuts = this.currentCutlist?.cuts || [];
    if (this.currentCutlist?.settings?.manualOrder) {
      return applyManualCutOrder(cuts, this.manualOrder);
    }
    return sortCutsBySceneNumber(cuts);
  }

  getRows() {
    return buildMissingSceneRows(this.getOrderedCuts(), this.currentCutlist?.settings || {});
  }

  getTimeline() {
    return buildCutlistTimeline(this.getOrderedCuts());
  }

  setShowMissingScenes(enabled) {
    if (!this.currentCutlist) return;
    this.currentCutlist.settings.showMissingScenes = enabled === true;
    this.isModified = true;
    this._emitChanged('settings-changed');
  }

  reorderCut(cutId, targetIndex) {
    const ids = this.getOrderedCuts().map(cut => cut.id).filter(id => id !== cutId);
    ids.splice(Math.max(0, targetIndex), 0, cutId);
    this.manualOrder = ids;
    this.currentCutlist.settings.manualOrder = true;
    this.isModified = true;
    this._emitChanged('order-changed');
  }

  selectCut(cutId) {
    this.currentCutId = cutId;
    this.dispatchEvent(new CustomEvent('cut-selected', { detail: { cut: this.getCutById(cutId) } }));
  }

  getCutById(cutId) {
    return (this.currentCutlist?.cuts || []).find(cut => cut.id === cutId) || null;
  }

  getSourceById(sourceId) {
    return (this.currentCutlist?.sources || []).find(source => source.id === sourceId) || null;
  }

  async reconnectSource(sourceId, videoPath) {
    const source = this.getSourceById(sourceId);
    if (!source) throw new Error('다시 연결할 출력 영상을 찾을 수 없습니다.');
    const fileInfo = await window.electronAPI.getFileInfo(videoPath);
    source.videoPath = videoPath;
    source.fileName = fileInfo?.name || videoPath.split(/[\\/]/).pop();
    source.missing = false;
    this.isModified = true;
    this._emitChanged('source-reconnected', { source });
  }

  async refreshMissingSources() {
    for (const source of this.currentCutlist?.sources || []) {
      source.missing = !(await window.electronAPI.fileExists(source.videoPath));
    }
  }

  _normalizeOrder() {
    this.currentCutlist.cuts = sortCutsBySceneNumber(this.currentCutlist.cuts);
    this.currentCutlist.cuts.forEach((cut, index) => {
      cut.order = index;
    });
    this.manualOrder = this.currentCutlist.cuts.map(cut => cut.id);
  }

  _emitChanged(reason, detail = {}) {
    log.info('컷 묶음 변경', { reason });
    this.dispatchEvent(new CustomEvent('changed', { detail: { reason, ...detail } }));
  }
}

let instance = null;
export function getCutlistManager() {
  if (!instance) instance = new CutlistManager();
  return instance;
}
```

- [ ] **Step 2: Add top toolbar button and cutlist panel DOM**

Modify `renderer/index.html`.

After `btnPlaylist`, add:

```html
      <button class="btn btn-secondary" id="btnCutlist" title="컷 묶음">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2"/>
          <line x1="8" y1="5" x2="8" y2="19"/>
          <line x1="16" y1="5" x2="16" y2="19"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
        </svg>
        컷 묶음
      </button>
```

After `playlistSidebar`, add:

```html
    <aside class="cutlist-sidebar hidden" id="cutlistSidebar">
      <div class="cutlist-header">
        <div class="cutlist-title-section">
          <svg class="cutlist-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="5" width="18" height="14" rx="2"/>
            <line x1="8" y1="5" x2="8" y2="19"/>
            <line x1="16" y1="5" x2="16" y2="19"/>
          </svg>
          <input type="text" class="cutlist-name-input" id="cutlistNameInput" placeholder="컷 묶음 이름" value="새 컷 묶음">
        </div>
        <div class="cutlist-actions">
          <button class="cutlist-btn" id="btnCutlistAddPair" title="영상 + info txt 쌍 추가">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <button class="cutlist-btn" id="btnCutlistSave" title="컷 묶음 저장">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            </svg>
          </button>
          <button class="cutlist-btn" id="btnCutlistClose" title="패널 숨기기">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="cutlist-empty" id="cutlistEmpty">
        <button class="cutlist-primary-add" id="btnCutlistPrimaryAdd" type="button">영상 + info txt 쌍 추가</button>
      </div>
      <label class="cutlist-missing-toggle">
        <input type="checkbox" id="cutlistShowMissing">
        <span>누락 씬 표시</span>
      </label>
      <div class="cutlist-items" id="cutlistItems"></div>
      <div class="cutlist-ignored-summary" id="cutlistIgnoredSummary" hidden></div>
    </aside>
```

Inside `videoWrapper`, add:

```html
          <div class="current-cut-overlay" id="currentCutOverlay" hidden></div>
```

Add stylesheet link in the document head if stylesheets are linked individually:

```html
  <link rel="stylesheet" href="./styles/cutlist-panel.css">
```

- [ ] **Step 3: Add cutlist panel styles**

Create `renderer/styles/cutlist-panel.css`:

```css
.cutlist-sidebar {
  width: 320px;
  min-width: 280px;
  max-width: 480px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cutlist-sidebar.hidden {
  display: none;
}

.cutlist-header,
.cutlist-actions,
.cutlist-title-section {
  display: flex;
  align-items: center;
}

.cutlist-header {
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
}

.cutlist-title-section {
  min-width: 0;
  flex: 1;
  gap: 8px;
}

.cutlist-name-input {
  min-width: 0;
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--text-primary);
  font: inherit;
  font-weight: 600;
}

.cutlist-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.cutlist-empty {
  padding: 14px;
}

.cutlist-primary-add {
  width: 100%;
  height: 44px;
  border: 1px solid var(--accent-primary);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
  color: var(--text-primary);
  font-weight: 700;
}

.cutlist-missing-toggle {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.cutlist-items {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.cutlist-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
}

.cutlist-item + .cutlist-item {
  margin-top: 6px;
}

.cutlist-item.active {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 14%, var(--bg-primary));
}

.cutlist-item.missing {
  color: var(--text-muted);
  border-style: dashed;
}

.cutlist-item-detail {
  grid-column: 1 / -1;
  display: none;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.cutlist-item.expanded .cutlist-item-detail {
  display: block;
}

.cutlist-ignored-summary {
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
  color: var(--text-muted);
  font-size: 12px;
}
```

Modify `renderer/styles/main.css`:

```css
.current-cut-overlay {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 22;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}

.cutlist-segment-block {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent-primary) 24%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-primary) 45%, transparent);
  overflow: hidden;
}

.cutlist-segment-block.current {
  background: color-mix(in srgb, var(--accent-primary) 55%, transparent);
  border-color: var(--accent-primary);
}

.cutlist-segment-label {
  display: block;
  padding: 2px 5px;
  color: var(--text-primary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 4: Add DOM caching and feature bootstrap in app**

Modify `renderer/scripts/app.js` imports:

```js
import { getCutlistManager } from './modules/cutlist-manager.js';
import { mapCutFrameToSourceTime, findCurrentCut } from './modules/cutlist-core.js';
```

Add elements:

```js
    btnCutlist: document.getElementById('btnCutlist'),
    cutlistSidebar: document.getElementById('cutlistSidebar'),
    cutlistNameInput: document.getElementById('cutlistNameInput'),
    btnCutlistAddPair: document.getElementById('btnCutlistAddPair'),
    btnCutlistPrimaryAdd: document.getElementById('btnCutlistPrimaryAdd'),
    btnCutlistSave: document.getElementById('btnCutlistSave'),
    btnCutlistClose: document.getElementById('btnCutlistClose'),
    cutlistShowMissing: document.getElementById('cutlistShowMissing'),
    cutlistItems: document.getElementById('cutlistItems'),
    cutlistEmpty: document.getElementById('cutlistEmpty'),
    cutlistIgnoredSummary: document.getElementById('cutlistIgnoredSummary'),
    currentCutOverlay: document.getElementById('currentCutOverlay'),
```

Add state:

```js
  const cutlistUIState = {
    active: false,
    lastIgnored: []
  };
```

Add `initCutlistFeature()` skeleton:

```js
  function initCutlistFeature() {
    const cutlistManager = getCutlistManager();

    cutlistManager.addEventListener('changed', () => {
      updateCutlistUI();
      updateCutlistTimeline();
    });

    cutlistManager.addEventListener('cut-selected', async (event) => {
      await seekToCut(event.detail.cut);
    });

    elements.btnCutlist?.addEventListener('click', () => {
      showCutlistSidebar();
      if (!cutlistManager.currentCutlist) cutlistManager.createNew();
    });

    elements.btnCutlistClose?.addEventListener('click', hideCutlistSidebar);
    elements.btnCutlistAddPair?.addEventListener('click', addCutlistSourcePair);
    elements.btnCutlistPrimaryAdd?.addEventListener('click', addCutlistSourcePair);
    elements.btnCutlistSave?.addEventListener('click', () => saveCurrentCutlist());
    elements.cutlistShowMissing?.addEventListener('change', (event) => {
      cutlistManager.setShowMissingScenes(event.target.checked);
    });

    window.electronAPI.onOpenCutlist?.(async (path) => {
      try {
        await openCutlistFile(path);
      } catch (error) {
        showToast(`컷 묶음을 열 수 없습니다: ${error.message}`, 'error');
      }
    });
  }
```

Call `initCutlistFeature()` next to `initPlaylistFeature()`.

- [ ] **Step 5: Implement source-pair add and panel rendering**

Add to `renderer/scripts/app.js`:

```js
  async function addCutlistSourcePair() {
    const txtResult = await window.electronAPI.openFileDialog({
      title: 'Moho info txt 선택',
      filters: [{ name: 'Moho info txt', extensions: ['txt'] }],
      properties: ['openFile']
    });
    if (txtResult.canceled || txtResult.filePaths.length === 0) return;

    const videoResult = await window.electronAPI.openFileDialog({
      title: '연결할 출력 영상 선택',
      filters: [{ name: '미디어 파일', extensions: SUPPORTED_MEDIA_EXTENSIONS }],
      properties: ['openFile']
    });
    if (videoResult.canceled || videoResult.filePaths.length === 0) return;

    const cutlistManager = getCutlistManager();
    const result = await cutlistManager.addSourcePair(txtResult.filePaths[0], videoResult.filePaths[0]);
    cutlistUIState.lastIgnored = result.ignored || [];
    showToast(`${result.cuts.length}개 컷을 추가했습니다.`, 'success');
  }

  function showCutlistSidebar() {
    cutlistUIState.active = true;
    elements.cutlistSidebar?.classList.remove('hidden');
  }

  function hideCutlistSidebar() {
    cutlistUIState.active = false;
    elements.cutlistSidebar?.classList.add('hidden');
  }

  function updateCutlistUI() {
    const cutlistManager = getCutlistManager();
    const cutlist = cutlistManager.currentCutlist;
    if (!cutlist) return;

    if (elements.cutlistNameInput && document.activeElement !== elements.cutlistNameInput) {
      elements.cutlistNameInput.value = cutlist.name;
    }
    if (elements.cutlistShowMissing) {
      elements.cutlistShowMissing.checked = cutlist.settings.showMissingScenes === true;
    }
    if (elements.cutlistEmpty) {
      elements.cutlistEmpty.hidden = cutlist.cuts.length > 0;
    }

    renderCutlistItems();
    renderCutlistIgnoredSummary();
  }

  function renderCutlistItems() {
    const cutlistManager = getCutlistManager();
    if (!elements.cutlistItems) return;
    elements.cutlistItems.innerHTML = '';

    for (const row of cutlistManager.getRows()) {
      const item = document.createElement('div');
      item.className = `cutlist-item${row.id === cutlistManager.currentCutId ? ' active' : ''}${row.missing ? ' missing' : ''}`;
      item.dataset.cutId = row.id;
      item.innerHTML = row.missing
        ? `<span>${escapeHtml(row.label)}</span>`
        : `
          <span>${escapeHtml(row.label)}</span>
          <span>${row.endFrame - row.startFrame + 1}f</span>
          <div class="cutlist-item-detail">
            BAEFRAME ${row.startFrame} - ${row.endFrame}f<br>
            Moho ${row.mohoStartFrame} - ${row.mohoEndFrame}f
          </div>
        `;
      if (!row.missing) {
        item.addEventListener('click', () => cutlistManager.selectCut(row.id));
        item.addEventListener('dblclick', () => item.classList.toggle('expanded'));
      }
      elements.cutlistItems.appendChild(item);
    }
  }

  function renderCutlistIgnoredSummary() {
    const ignoredCount = cutlistUIState.lastIgnored.length;
    if (!elements.cutlistIgnoredSummary) return;
    elements.cutlistIgnoredSummary.hidden = ignoredCount === 0;
    elements.cutlistIgnoredSummary.textContent = ignoredCount > 0 ? `무시된 라벨 ${ignoredCount}개` : '';
  }
```

- [ ] **Step 6: Run source tests and fix DOM hook assertions**

Run:

```bash
node --test scripts/tests/cutlist-runtime-source.test.js
```

Expected: FAIL only on timeline methods until Task 5. If app/index/style hooks fail, correct element ids or source names before continuing.

- [ ] **Step 7: Commit cutlist manager and panel**

Run:

```bash
git add renderer/scripts/modules/cutlist-manager.js renderer/index.html renderer/styles/cutlist-panel.css renderer/styles/main.css renderer/scripts/app.js scripts/tests/cutlist-runtime-source.test.js
git commit -m "컷 묶음 전용 패널 추가"
```

## Task 5: Playback, Timeline, And Comment Integration

**Files:**
- Modify: `renderer/scripts/modules/timeline.js`
- Modify: `renderer/scripts/app.js`
- Create: `renderer/scripts/modules/cutlist-comment-index.js`
- Test: `scripts/tests/cutlist-runtime-source.test.js`

- [ ] **Step 1: Add timeline cutlist rendering methods**

Modify `renderer/scripts/modules/timeline.js`.

Add state in constructor:

```js
    this.cutlistSegments = [];
    this.currentCutId = null;
```

Add methods near playlist timeline methods:

```js
  setCutlistTimeline(segments, totalDuration) {
    this.cutlistSegments = segments || [];
    this.cutlistDuration = totalDuration || 0;
    this._renderCutlistSegments();
  }

  setCurrentCutId(cutId) {
    this.currentCutId = cutId || null;
    this._renderCutlistSegments();
  }

  _renderCutlistSegments() {
    this.tracksContainer?.querySelectorAll('.cutlist-segment-block').forEach(el => el.remove());
    const videoTrackRow = this.tracksContainer?.querySelector('.video-track-row');
    if (!videoTrackRow || !this.cutlistSegments?.length) return;
    const duration = this.cutlistDuration || this.duration;
    if (!duration) return;

    for (const segment of this.cutlistSegments) {
      const block = document.createElement('div');
      block.className = `cutlist-segment-block${segment.cutId === this.currentCutId ? ' current' : ''}`;
      block.style.left = `${(segment.startTime / duration) * 100}%`;
      block.style.width = `${Math.max(0.25, (segment.duration / duration) * 100)}%`;
      block.dataset.cutId = segment.cutId;
      block.title = `${segment.label} ${this._formatTime(segment.startTime)} - ${this._formatTime(segment.endTime)}`;

      const label = document.createElement('span');
      label.className = 'cutlist-segment-label';
      label.textContent = segment.label;
      block.appendChild(label);

      block.addEventListener('click', (event) => {
        event.stopPropagation();
        this._emit('cutlist-seek', { cutId: segment.cutId });
      });

      videoTrackRow.appendChild(block);
    }
  }
```

Update `clearMarkers()` or related cleanup:

```js
    this.setCutlistTimeline([], 0);
```

- [ ] **Step 2: Wire timeline cut clicks and update current cut overlay**

Modify `renderer/scripts/app.js`:

```js
  function updateCutlistTimeline() {
    const cutlistManager = getCutlistManager();
    const timelineData = cutlistManager.getTimeline();
    timeline.setCutlistTimeline(timelineData.segments, timelineData.totalDuration);
    timeline.setCurrentCutId(cutlistManager.currentCutId);
  }

  async function seekToCut(cut) {
    if (!cut) return;
    const cutlistManager = getCutlistManager();
    const source = cutlistManager.getSourceById(cut.sourceId);
    if (!source) return;
    if (source.missing || !(await window.electronAPI.fileExists(source.videoPath))) {
      await reconnectCutlistSource(source.id);
      return;
    }

    const loaded = state.currentFile === source.videoPath || await loadVideo(source.videoPath);
    if (!loaded) return;

    videoPlayer.seekToFrame(cut.startFrame);
    updateCurrentCutDisplay(cut);
    updateCommentList();
  }

  async function reconnectCutlistSource(sourceId) {
    const result = await window.electronAPI.openFileDialog({
      title: '출력 영상 다시 연결',
      filters: [{ name: '미디어 파일', extensions: SUPPORTED_MEDIA_EXTENSIONS }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return false;
    await getCutlistManager().reconnectSource(sourceId, result.filePaths[0]);
    showToast('출력 영상을 다시 연결했습니다.', 'success');
    return true;
  }

  function updateCurrentCutDisplay(cut) {
    const cutlistManager = getCutlistManager();
    if (!elements.currentCutOverlay) return;
    if (!cut) {
      elements.currentCutOverlay.hidden = true;
      timeline.setCurrentCutId(null);
      return;
    }
    elements.currentCutOverlay.textContent = cut.label;
    elements.currentCutOverlay.hidden = false;
    cutlistManager.currentCutId = cut.id;
    timeline.setCurrentCutId(cut.id);
    updateCutlistUI();
  }
```

Add event listener:

```js
    timeline.addEventListener('cutlist-seek', (event) => {
      getCutlistManager().selectCut(event.detail.cutId);
    });
```

- [ ] **Step 3: Update active cut during playback**

Modify existing `timeupdate` and frame update listeners in `renderer/scripts/app.js`:

```js
  function refreshCurrentCutFromPlayback() {
    const cutlistManager = getCutlistManager();
    if (!cutlistUIState.active || !cutlistManager.currentCutlist) return;
    const source = (cutlistManager.currentCutlist.sources || []).find(s => s.videoPath === state.currentFile);
    if (!source) {
      updateCurrentCutDisplay(null);
      return;
    }
    const cut = findCurrentCut(cutlistManager.currentCutlist.cuts, {
      sourceId: source.id,
      frame: videoPlayer.currentFrame
    });
    updateCurrentCutDisplay(cut);
  }
```

Call `refreshCurrentCutFromPlayback()` inside both `timeupdate` and `frameupdate` listeners after `videoPlayer.currentFrame` is updated.

- [ ] **Step 4: Create comment formatter for cutlist mode**

Create `renderer/scripts/modules/cutlist-comment-index.js`:

```js
export function formatCutlistTimecode(frame, fps = 24) {
  const safeFps = Number(fps) > 0 ? Number(fps) : 24;
  const totalFrames = Math.max(0, Math.round(Number(frame) || 0));
  const seconds = Math.floor(totalFrames / safeFps);
  const frames = totalFrames % safeFps;
  const minutes = Math.floor(seconds / 60);
  const displaySeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function formatCutlistCommentLabel({ cut, sourceFrame, globalFrame }) {
  if (!cut) return '';
  const fps = Number(cut.fps) > 0 ? Number(cut.fps) : 24;
  const localFrame = Math.max(0, Number(sourceFrame) - Number(cut.startFrame));
  return `${cut.label} ${formatCutlistTimecode(localFrame, fps)} · 전체 ${formatCutlistTimecode(globalFrame, fps)}`;
}
```

In `renderer/scripts/app.js`, when rendering comment list in cutlist mode, prefix the normal time label:

```js
  function getCutlistCommentPrefix(marker) {
    const cutlistManager = getCutlistManager();
    if (!cutlistUIState.active || !cutlistManager.currentCutlist) return '';
    const source = (cutlistManager.currentCutlist.sources || []).find(s => s.videoPath === state.currentFile);
    if (!source) return '';
    const frame = marker.frame ?? Math.round((marker.time || 0) * (videoPlayer.fps || 24));
    const cut = findCurrentCut(cutlistManager.currentCutlist.cuts, { sourceId: source.id, frame });
    if (!cut) return '';
    const timelineData = cutlistManager.getTimeline();
    const segment = timelineData.segments.find(s => s.cutId === cut.id);
    const globalFrame = segment ? segment.globalStartFrame + (frame - cut.startFrame) : frame;
    return formatCutlistCommentLabel({ cut, sourceFrame: frame, globalFrame });
  }
```

Use this prefix only in cutlist mode. Leave normal review comment rendering unchanged when `cutlistUIState.active` is false.

- [ ] **Step 5: Ensure comments save to source `.bframe`**

Keep existing `reviewDataManager.save()` behavior. Before adding a comment in cutlist mode, ensure the source video is loaded with `loadVideo(source.videoPath)`, because `loadVideo()` already creates or resolves the normal `.bframe` path through existing review data flow.

Add guard in comment submission path:

```js
  async function ensureCutlistCommentTargetReady() {
    if (!cutlistUIState.active) return true;
    const cutlistManager = getCutlistManager();
    const currentCut = cutlistManager.getCutById(cutlistManager.currentCutId);
    if (!currentCut) return true;
    const source = cutlistManager.getSourceById(currentCut.sourceId);
    if (!source) return false;
    if (state.currentFile !== source.videoPath) {
      return await loadVideo(source.videoPath);
    }
    return true;
  }
```

Call `await ensureCutlistCommentTargetReady()` before confirming a new comment marker or submitting a panel comment.

- [ ] **Step 6: Run source tests**

Run:

```bash
node --test scripts/tests/cutlist-runtime-source.test.js
```

Expected: PASS all runtime source checks.

- [ ] **Step 7: Commit playback and comment integration**

Run:

```bash
git add renderer/scripts/modules/timeline.js renderer/scripts/app.js renderer/scripts/modules/cutlist-comment-index.js scripts/tests/cutlist-runtime-source.test.js
git commit -m "컷 묶음 재생 위치와 댓글 표시 연결"
```

## Task 6: Save/Open UX, Validation, And Full Verification

**Files:**
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/scripts/modules/cutlist-manager.js`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-05-23-moho-cutlist-design.md` only if the implemented behavior intentionally differs from the approved spec.

- [ ] **Step 1: Implement `.bcutlist` open path detection in renderer**

Modify `renderer/scripts/app.js` constants:

```js
const SUPPORTED_CUTLIST_EXTENSION = 'bcutlist';
```

Add helpers near playlist path helpers:

```js
  function isCutlistFilePath(filePath) {
    const normalized = String(filePath || '').split(/[?#]/)[0].toLowerCase();
    return normalized.endsWith(`.${SUPPORTED_CUTLIST_EXTENSION}`);
  }

  async function openCutlistFile(filePath) {
    const cutlistManager = getCutlistManager();
    await cutlistManager.open(filePath);
    showCutlistSidebar();
    updateCutlistUI();
    updateCutlistTimeline();
    const firstCut = cutlistManager.getOrderedCuts()[0];
    if (firstCut) cutlistManager.selectCut(firstCut.id);
    return true;
  }
```

Modify `openSelectedPath(filePath)`:

```js
    if (isCutlistFilePath(filePath)) {
      return openCutlistFile(filePath);
    }
```

- [ ] **Step 2: Implement save and link copy flow**

Add `saveCurrentCutlist()`:

```js
  async function saveCurrentCutlist() {
    const cutlistManager = getCutlistManager();
    if (!cutlistManager.currentCutlist) {
      showToast('저장할 컷 묶음이 없습니다.', 'warning');
      return false;
    }
    try {
      const path = await cutlistManager.save();
      showToast('컷 묶음을 저장했습니다.', 'success');
      return path;
    } catch (error) {
      showToast(`컷 묶음을 저장할 수 없습니다: ${error.message}`, 'error');
      return false;
    }
  }
```

If adding a copy-link button in the panel, use:

```js
  async function copyCutlistLink() {
    const cutlistManager = getCutlistManager();
    const path = cutlistManager.cutlistPath || await saveCurrentCutlist();
    if (!path) return;
    const windowsPath = path.replace(/\//g, '\\');
    const fileName = windowsPath.split('\\').pop() || '컷묶음.bcutlist';
    await window.electronAPI.copyToClipboard(`${windowsPath}\n\n${fileName}`);
    showToast('컷 묶음 경로가 복사되었습니다.', 'success');
  }
```

- [ ] **Step 3: Add broken-path visual state**

In `renderCutlistItems()`, source missing state must affect all cuts from that source:

```js
      const source = cutlistManager.getSourceById(row.sourceId);
      const sourceMissing = source?.missing === true;
      item.className = `cutlist-item${row.id === cutlistManager.currentCutId ? ' active' : ''}${row.missing || sourceMissing ? ' missing' : ''}`;
```

In `seekToCut(cut)`, if source missing, call `reconnectCutlistSource(source.id)` and then reload UI:

```js
    if (source.missing || !(await window.electronAPI.fileExists(source.videoPath))) {
      source.missing = true;
      updateCutlistUI();
      const reconnected = await reconnectCutlistSource(source.id);
      if (!reconnected) return;
    }
```

- [ ] **Step 4: Add full cutlist test script**

Modify `package.json` scripts:

```json
"test:cutlist": "node --test scripts/tests/cutlist-schema.test.js scripts/tests/moho-scene-info-parser.test.js scripts/tests/cutlist-core.test.js scripts/tests/cutlist-runtime-source.test.js"
```

Expected: the script references every cutlist test file created by Tasks 1, 2, and 3.

- [ ] **Step 5: Run unit and source tests**

Run:

```bash
npm run test:cutlist
```

Expected: PASS.

Run related existing tests:

```bash
npm run test:playlist
```

Expected: PASS. This ensures cutlist timeline changes did not break playlist continuous mode.

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: Electron builder directory build completes. Existing warnings are acceptable if the command exits successfully.

- [ ] **Step 7: Manual QA with the user's sample info files**

Use the user's sample files:

```txt
G:\공유 드라이브\사우스 코리안 파크\233_친모2\제작\성철\제작\a016-031\a020, a022, a024, a026, a029_re5_info.txt
G:\공유 드라이브\사우스 코리안 파크\233_친모2\제작\성철\제작\a016-031\a019, a023, a028_re6_info.txt
```

Expected manual results:

- `sc019`, `a020`, `a022`, `sc023`, `a024`, `a026`, `a028`, `a029` appear sorted by scene number.
- `실제 사운드 시작지점` is counted in ignored labels.
- duplicate 1-frame `a028` and `a029` are ignored.
- `sc023` shows BAEFRAME `41 - 91f` and Moho `42 - 92f`.
- clicking `sc023` loads the `a019, a023, a028_re6` output video and seeks to frame 41.
- `.bcutlist` saves to the first info txt folder.
- reopening `.bcutlist` restores the same cuts.
- temporarily renaming one output video makes its cuts gray, and reconnecting restores them.

- [ ] **Step 8: Commit final cutlist integration**

Run:

```bash
git add renderer/scripts/app.js renderer/scripts/modules/cutlist-manager.js docs/superpowers/specs/2026-05-23-moho-cutlist-design.md package.json
git commit -m "컷 묶음 저장 열기 흐름 완성"
```

## Self-Review Checklist

- Spec coverage:
  - `.bcutlist` file format: Task 1 and Task 3.
  - Moho txt parsing and `txt - 1` frame rule: Task 1.
  - long duplicate priority and ignored label summary: Task 1 and Task 4.
  - dedicated toolbar button and panel: Task 4.
  - cut click seek and current cut overlay: Task 5.
  - timeline cut blocks, labels, current cut highlight: Task 5.
  - comments stored in source `.bframe`: Task 5.
  - save/open, broken path gray state, reconnect: Task 6.
  - transition-delay optimization is intentionally out of prototype scope and remains in the approved 2차 개선 range.
- Placeholder scan:
  - No red-flag placeholder terms remain in action steps.
  - Each code step names concrete functions and files.
- Type consistency:
  - Core cut objects use `id`, `sourceId`, `sceneNumber`, `label`, `startFrame`, `endFrame`, `mohoStartFrame`, `mohoEndFrame`, `fps`, `order`.
  - Timeline segment objects use `cutId`, `sourceId`, `label`, `globalStartFrame`, `globalEndFrame`, `startTime`, `endTime`, `duration`, `fps`.
  - Manager methods used by app are `createNew`, `open`, `save`, `addSourcePair`, `getOrderedCuts`, `getRows`, `getTimeline`, `selectCut`, `getCutById`, `getSourceById`, `reconnectSource`, `refreshMissingSources`.
