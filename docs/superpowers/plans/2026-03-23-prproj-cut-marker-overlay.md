# Premiere Pro 컷 마커 오버레이 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** .prproj 파일의 중첩 시퀀스 정보를 파싱하여 BAEframe 영상 리뷰 시 컷 이름을 오버레이로 표시하는 기능 구현

**Architecture:** Main 프로세스에서 .prproj(GZip XML)를 파싱하고, IPC를 통해 Renderer에 컷 데이터를 전달. CutMarkerManager가 영상 위 DOM 오버레이와 타임라인 마커를 렌더링. 컷 데이터는 .bframe 파일에 저장되어 재로드 시 복원됨.

**Tech Stack:** Electron (Node.js zlib + fast-xml-parser), Vanilla JS (EventTarget), CSS 오버레이

**Spec:** `docs/superpowers/specs/2026-03-23-prproj-cut-marker-overlay-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `main/prproj-parser.js` | .prproj GZip 해제 + XML 파싱 + 중첩 시퀀스 추출 |
| `renderer/scripts/modules/cut-marker-manager.js` | CutMarker 데이터, 오버레이 렌더링, 설정, 직렬화 |

### Modified Files
| File | Changes |
|------|---------|
| `package.json` | `fast-xml-parser` 의존성 추가 |
| `shared/schema.js` | `createDefaultBframeData()`에 `cuts: null` 추가 |
| `main/ipc-handlers.js` | `prproj:open-dialog`, `prproj:parse` 핸들러 추가 |
| `preload/preload.js` | `openPrprojDialog`, `parsePrproj` API 노출 |
| `renderer/scripts/modules/review-data-manager.js` | `_collectData()`, `_applyData()`에 cuts 통합 |
| `renderer/scripts/modules/user-settings.js` | 컷 마커 관련 설정 3개 추가 |
| `renderer/scripts/modules/timeline.js` | `setCutMarkers()`, `renderCutMarkers()` 메서드 추가 |
| `renderer/scripts/app.js` | CutMarkerManager 초기화 + 이벤트 연결 + 가져오기 버튼 핸들러 |
| `renderer/index.html` | 오버레이 DOM + 가져오기 버튼 |
| `renderer/styles/main.css` | 오버레이 스타일 + 6가지 위치 클래스 + 타임라인 마커 스타일 |

---

## Chunk 1: 기반 인프라

### Task 1: 브랜치 생성 + 의존성 설치

**Files:**
- Modify: `package.json`

- [ ] **Step 1: feature 브랜치 생성**

```bash
cd /c/BAEframe/BAEFRAME
git checkout -b feature/prproj-cut-markers
```

- [ ] **Step 2: fast-xml-parser 설치**

```bash
npm install fast-xml-parser
```

Expected: `package.json`의 `dependencies`에 `fast-xml-parser` 추가됨

- [ ] **Step 3: 커밋**

```bash
git add package.json package-lock.json
git commit -m "chore: fast-xml-parser 의존성 추가

.prproj XML 파싱을 위한 라이브러리"
```

---

### Task 2: .bframe 스키마에 cuts 필드 추가

**Files:**
- Modify: `shared/schema.js` — `createDefaultBframeData()` 함수

- [ ] **Step 1: `createDefaultBframeData()`에 cuts 필드 추가**

`shared/schema.js`의 `createDefaultBframeData()` 함수 반환 객체에 `cuts: null` 추가:

```javascript
// 기존 highlights: [] 다음에 추가
cuts: null
```

위치: `highlights: []` 바로 다음 줄.

또한 `migrateToV2()` 함수(line ~226-278)의 반환 객체에도 `cuts: data.cuts || null` 추가. 이렇게 하면 v1→v2 마이그레이션 시에도 cuts 필드가 포함됨.

- [ ] **Step 2: 검증**

```bash
npm run lint
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add shared/schema.js
git commit -m "feat: .bframe 스키마에 cuts 필드 추가

- createDefaultBframeData()에 cuts: null 기본값 추가
- 기존 .bframe 파일 하위 호환성 유지 (missing field → null)"
```

---

### Task 3: IPC 핸들러 + Preload Bridge

**Files:**
- Modify: `main/ipc-handlers.js`
- Modify: `preload/preload.js`

- [ ] **Step 1: main/ipc-handlers.js에 prproj 핸들러 추가**

파일 상단에 import 추가:

```javascript
const { parsePrproj, parsePrprojWithSequenceId } = require('./prproj-parser');
```

기존 IPC 핸들러 블록 끝에 추가 (`getMainWindow()` 패턴 + `log.trace()` 패턴을 기존 코드와 동일하게 사용):

```javascript
  // ====== Premiere Pro 프로젝트 관련 ======
  ipcMain.handle('prproj:open-dialog', async () => {
    const trace = logger.trace('prproj:open-dialog');
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Premiere Pro 프로젝트 파일 열기',
      filters: [{ name: 'Premiere Pro Project', extensions: ['prproj'] }],
      properties: ['openFile']
    });
    trace.end({ canceled: result.canceled });
    return result;
  });

  ipcMain.handle('prproj:parse', async (event, filePath) => {
    const trace = logger.trace('prproj:parse');
    try {
      const result = await parsePrproj(filePath);
      trace.end({ cuts: result.cuts?.length || 0 });
      return result;
    } catch (err) {
      logger.error('prproj 파싱 실패:', err.message);
      trace.end({ error: err.message });
      throw err;
    }
  });

  ipcMain.handle('prproj:parse-with-sequence', async (event, filePath, sequenceId) => {
    const trace = logger.trace('prproj:parse-with-sequence');
    try {
      const result = await parsePrprojWithSequenceId(filePath, sequenceId);
      trace.end({ cuts: result.cuts?.length || 0 });
      return result;
    } catch (err) {
      logger.error('prproj 시퀀스 파싱 실패:', err.message);
      trace.end({ error: err.message });
      throw err;
    }
  });
```

- [ ] **Step 2: preload/preload.js에 API 노출**

기존 `electronAPI` 객체 내부, 적절한 위치(예: 설정 관련 섹션 근처)에 추가:

```javascript
  // ====== Premiere Pro 프로젝트 관련 ======
  openPrprojDialog: () => ipcRenderer.invoke('prproj:open-dialog'),
  parsePrproj: (filePath) => ipcRenderer.invoke('prproj:parse', filePath),
  parsePrprojWithSequenceId: (filePath, sequenceId) =>
    ipcRenderer.invoke('prproj:parse-with-sequence', filePath, sequenceId),
```

- [ ] **Step 3: 검증**

```bash
npm run lint
```

Expected: prproj-parser.js가 아직 없어서 런타임에는 에러나지만, lint는 통과

- [ ] **Step 4: 커밋**

```bash
git add main/ipc-handlers.js preload/preload.js
git commit -m "feat: .prproj 파일 열기/파싱 IPC 채널 추가

- prproj:open-dialog: 파일 선택 다이얼로그
- prproj:parse: .prproj 파싱 실행
- preload bridge에 openPrprojDialog, parsePrproj 노출"
```

---

## Chunk 2: .prproj 파서

### Task 4: prproj-parser.js 구현

**Files:**
- Create: `main/prproj-parser.js`

이 파일은 Main 프로세스에서 실행되며, .prproj 파일(GZip XML)을 파싱하여 중첩 시퀀스 정보를 추출한다.

- [ ] **Step 1: 기본 구조 + GZip 해제 + XML 파싱**

`main/prproj-parser.js` 생성:

```javascript
/**
 * prproj-parser.js
 * Premiere Pro 프로젝트 파일(.prproj) 파서
 * .prproj는 GZip 압축된 XML 파일이다.
 */

const fs = require('fs');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');
const { createLogger } = require('./logger');

const logger = createLogger('PrprojParser');

// Premiere Pro ticks per second (기본값)
const DEFAULT_TICKS_PER_SECOND = 254016000000;

/**
 * .prproj 파일을 파싱하여 중첩 시퀀스 정보를 추출한다.
 * @param {string} filePath - .prproj 파일 경로
 * @returns {Promise<Object>} 파싱 결과
 */
async function parsePrproj(filePath) {
  logger.info(`파싱 시작: ${filePath}`);

  // 1. 파일 읽기
  const fileBuffer = fs.readFileSync(filePath);

  // 2. GZip 해제
  let xmlString;
  try {
    const decompressed = zlib.gunzipSync(fileBuffer);
    xmlString = decompressed.toString('utf-8');
  } catch (err) {
    throw new Error('지원하지 않는 프리미어 프로젝트 형식입니다. GZip 해제에 실패했습니다.');
  }

  // 3. XML 파싱
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => {
      // 배열로 처리해야 하는 태그들
      const arrayTags = [
        'Track', 'TrackItem', 'ClipItem',
        'VideoClipTrackItem', 'AudioClipTrackItem',
        'Sequence'
      ];
      return arrayTags.includes(name);
    }
  });

  let xmlObj;
  try {
    xmlObj = parser.parse(xmlString);
  } catch (err) {
    throw new Error('프로젝트 파일을 읽을 수 없습니다. XML 파싱에 실패했습니다.');
  }

  // 4. 시퀀스 추출
  const result = extractSequenceData(xmlObj);
  logger.info(`파싱 완료: ${result.cuts.length}개 컷 발견`);
  return result;
}

/**
 * XML 객체에서 시퀀스 데이터를 추출한다.
 * @param {Object} xmlObj - 파싱된 XML 객체
 * @returns {Object} 시퀀스 데이터
 */
function extractSequenceData(xmlObj) {
  // PremiereData 루트 찾기
  const root = xmlObj.PremiereData || xmlObj;

  // 모든 Sequence를 수집 (ObjectID 기반 인덱스)
  const sequenceMap = new Map(); // ObjectID → { sequence, name }
  const nestedIds = new Set();   // 다른 시퀀스에 중첩된 시퀀스 ID들

  collectSequences(root, sequenceMap);

  // 중첩된 시퀀스 ID 수집
  for (const [id, entry] of sequenceMap) {
    const nestedRefs = findNestedSequenceRefs(entry.sequence);
    for (const ref of nestedRefs) {
      nestedIds.add(ref);
    }
  }

  // 최상위 시퀀스 = 다른 시퀀스에 중첩되지 않은 시퀀스
  const topLevelSequences = [];
  for (const [id, entry] of sequenceMap) {
    if (!nestedIds.has(id)) {
      topLevelSequences.push(entry);
    }
  }

  if (topLevelSequences.length === 0) {
    throw new Error('프로젝트에서 시퀀스를 찾을 수 없습니다.');
  }

  // 최상위 시퀀스가 여러 개면 목록 반환 (Renderer에서 선택)
  if (topLevelSequences.length > 1) {
    return {
      multipleSequences: true,
      sequences: topLevelSequences.map(s => ({
        id: s.id,
        name: s.name
      }))
    };
  }

  // 최상위 시퀀스가 1개면 바로 파싱
  const mainSeq = topLevelSequences[0];
  return parseMainSequence(mainSeq.sequence, mainSeq.name, sequenceMap);
}

/**
 * XML 트리에서 모든 Sequence를 재귀적으로 수집한다.
 */
function collectSequences(obj, map, path = '') {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectSequences(item, map, `${path}[${i}]`));
    return;
  }

  // Sequence 요소 발견
  if (obj['@_ObjectID'] !== undefined && obj.Name !== undefined) {
    // 시퀀스인지 확인 (VideoTrackGroup 또는 AudioTrackGroup이 있는 경우)
    const hasTrackGroups = obj.TrackGroups ||
      obj.VideoTrackGroup || obj.AudioTrackGroup;
    if (hasTrackGroups || path.includes('Sequence')) {
      map.set(String(obj['@_ObjectID']), {
        id: String(obj['@_ObjectID']),
        name: obj.Name || 'Unnamed',
        sequence: obj
      });
    }
  }

  // 재귀 탐색
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue;
    collectSequences(obj[key], map, `${path}.${key}`);
  }
}

/**
 * 시퀀스 내에서 참조되는 중첩 시퀀스의 ObjectID/ObjectURef를 찾는다.
 */
function findNestedSequenceRefs(sequence) {
  const refs = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }

    // SequenceSource의 ObjectURef는 중첩 시퀀스 참조
    if (obj['@_ObjectURef'] !== undefined) {
      refs.add(String(obj['@_ObjectURef']));
    }
    if (obj['@_ObjectRef'] !== undefined) {
      refs.add(String(obj['@_ObjectRef']));
    }

    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_')) continue;
      walk(obj[key]);
    }
  }

  walk(sequence);
  return refs;
}

/**
 * 메인 시퀀스에서 중첩 시퀀스의 타임코드를 추출한다.
 */
function parseMainSequence(sequence, seqName, sequenceMap) {
  // FPS 추출
  const fps = extractFps(sequence);
  const ticksPerSecond = extractTicksPerSecond(sequence) || DEFAULT_TICKS_PER_SECOND;
  const ticksPerFrame = ticksPerSecond / fps;

  // 비디오 트랙에서 클립 아이템 추출
  const trackItems = extractVideoTrackItems(sequence);

  // 중첩 시퀀스만 필터링하여 컷 데이터 생성
  const cuts = [];

  for (const item of trackItems) {
    const nestedSeqName = resolveNestedSequenceName(item, sequenceMap);
    if (!nestedSeqName) continue; // 일반 미디어 클립은 무시

    const startTicks = parseTickValue(item.Start);
    const endTicks = parseTickValue(item.End);

    if (startTicks === null || endTicks === null) continue;

    const startTime = startTicks / ticksPerSecond;
    const endTime = endTicks / ticksPerSecond;
    const startFrame = Math.round(startTicks / ticksPerFrame);
    const endFrame = Math.round(endTicks / ticksPerFrame);

    cuts.push({
      name: nestedSeqName,
      startFrame,
      endFrame,
      startTime: Math.round(startTime * 1000) / 1000,
      endTime: Math.round(endTime * 1000) / 1000
    });
  }

  // 시작 프레임 기준 정렬
  cuts.sort((a, b) => a.startFrame - b.startFrame);

  if (cuts.length === 0) {
    throw new Error('선택한 프로젝트에 중첩 시퀀스가 없습니다.');
  }

  // 전체 시퀀스 정보
  const lastCut = cuts[cuts.length - 1];
  const duration = lastCut.endTime;
  const totalFrames = lastCut.endFrame;

  return {
    sequenceName: seqName,
    fps,
    duration,
    totalFrames,
    cuts
  };
}

/**
 * Sequence에서 FPS를 추출한다.
 */
function extractFps(sequence) {
  // TimeBase에서 FPS 추출 시도
  const timebase = findDeep(sequence, 'TimeBase');
  if (timebase) return Number(timebase);

  // FrameRate에서 추출 시도
  const frameRate = findDeep(sequence, 'FrameRate');
  if (frameRate) return Number(frameRate);

  // 기본값
  return 24;
}

/**
 * Sequence에서 TicksPerSecond를 추출한다.
 */
function extractTicksPerSecond(sequence) {
  const tps = findDeep(sequence, 'TicksPerSecond');
  if (tps) return Number(tps);
  return null;
}

/**
 * 비디오 트랙의 클립 아이템을 추출한다.
 */
function extractVideoTrackItems(sequence) {
  const items = [];

  function walk(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;

    if (Array.isArray(obj)) {
      obj.forEach(item => walk(item, depth));
      return;
    }

    // VideoClipTrackItem 또는 TrackItem을 찾는다
    const isTrackItem = obj.Start !== undefined && obj.End !== undefined &&
      (obj.SubClip || obj.ClipID || obj.Source);

    if (isTrackItem) {
      items.push(obj);
      return; // 더 깊이 탐색할 필요 없음
    }

    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_')) continue;
      walk(obj[key], depth + 1);
    }
  }

  walk(sequence);
  return items;
}

/**
 * TrackItem이 중첩 시퀀스를 참조하는지 확인하고, 이름을 반환한다.
 */
function resolveNestedSequenceName(trackItem, sequenceMap) {
  // SubClip → VideoClip → Source → SequenceSource → ObjectRef
  function findSequenceRef(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const result = findSequenceRef(item, depth);
        if (result) return result;
      }
      return null;
    }

    // SequenceSource를 찾으면 참조 ID 반환
    if (obj['@_ObjectURef'] !== undefined) {
      const ref = String(obj['@_ObjectURef']);
      if (sequenceMap.has(ref)) {
        return sequenceMap.get(ref).name;
      }
    }
    if (obj['@_ObjectRef'] !== undefined) {
      const ref = String(obj['@_ObjectRef']);
      if (sequenceMap.has(ref)) {
        return sequenceMap.get(ref).name;
      }
    }

    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_')) continue;
      const result = findSequenceRef(obj[key], depth + 1);
      if (result) return result;
    }
    return null;
  }

  return findSequenceRef(trackItem);
}

/**
 * tick 값을 숫자로 파싱한다.
 * Premiere Pro의 tick 값은 다양한 형식일 수 있다.
 */
function parseTickValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = Number(value);
    return isNaN(num) ? null : num;
  }
  if (typeof value === 'object') {
    // 숫자 텍스트 노드인 경우
    const text = value['#text'] || value._ || value.toString();
    const num = Number(text);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * 객체 트리에서 특정 키의 값을 깊이 탐색으로 찾는다.
 */
function findDeep(obj, targetKey, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 15) return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = findDeep(item, targetKey, depth);
      if (result !== null) return result;
    }
    return null;
  }

  if (obj[targetKey] !== undefined) {
    const val = obj[targetKey];
    if (typeof val === 'object' && val !== null) {
      return val['#text'] || val._ || null;
    }
    return val;
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue;
    const result = findDeep(obj[key], targetKey, depth + 1);
    if (result !== null) return result;
  }
  return null;
}

/**
 * 특정 시퀀스를 지정하여 파싱한다 (여러 최상위 시퀀스 중 선택).
 */
async function parsePrprojWithSequenceId(filePath, sequenceId) {
  const fileBuffer = fs.readFileSync(filePath);
  let xmlString;
  try {
    const decompressed = zlib.gunzipSync(fileBuffer);
    xmlString = decompressed.toString('utf-8');
  } catch (err) {
    throw new Error('지원하지 않는 프리미어 프로젝트 형식입니다.');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => {
      const arrayTags = ['Track', 'TrackItem', 'ClipItem',
        'VideoClipTrackItem', 'AudioClipTrackItem', 'Sequence'];
      return arrayTags.includes(name);
    }
  });

  const xmlObj = parser.parse(xmlString);
  const sequenceMap = new Map();
  collectSequences(xmlObj.PremiereData || xmlObj, sequenceMap);

  const target = sequenceMap.get(sequenceId);
  if (!target) {
    throw new Error('지정한 시퀀스를 찾을 수 없습니다.');
  }

  return parseMainSequence(target.sequence, target.name, sequenceMap);
}

module.exports = { parsePrproj, parsePrprojWithSequenceId };
```

- [ ] **Step 2: 검증**

```bash
npm run lint
```

Expected: lint 통과

- [ ] **Step 3: 수동 테스트**

실제 .prproj 파일이 있다면 Node.js REPL 또는 앱 실행 후 DevTools 콘솔에서:

```javascript
// DevTools 콘솔에서
const result = await window.electronAPI.parsePrproj('C:/경로/테스트.prproj');
console.log(result);
```

Expected: `sequenceName`, `fps`, `cuts` 배열이 출력되거나, `multipleSequences: true`와 시퀀스 목록이 출력

**참고**: .prproj XML 구조는 프리미어 버전마다 다를 수 있다. 실제 파일로 테스트하면서 `collectSequences`, `findNestedSequenceRefs`, `resolveNestedSequenceName`의 탐색 로직을 조정해야 할 수 있다. 파서의 핵심 로직(GZip → XML → 트리 탐색)은 정확하지만, XML 태그 이름과 구조는 실제 파일에 맞춰 미세 조정이 필요할 수 있다.

- [ ] **Step 4: 커밋**

```bash
git add main/prproj-parser.js
git commit -m "feat: .prproj 파서 구현

- GZip 해제 + XML 파싱 (fast-xml-parser)
- ObjectID 기반 시퀀스 그래프 탐색
- 최상위 시퀀스 자동 감지 (중첩되지 않은 시퀀스)
- 중첩 시퀀스의 In/Out 타임코드 추출
- tick → frame/time 변환 (TimeBase 자동 추출)"
```

---

## Chunk 3: CutMarkerManager (Renderer)

### Task 5: cut-marker-manager.js 구현

**Files:**
- Create: `renderer/scripts/modules/cut-marker-manager.js`

- [ ] **Step 1: CutMarker 데이터 클래스 + CutMarkerManager 구현**

`renderer/scripts/modules/cut-marker-manager.js` 생성:

```javascript
/**
 * cut-marker-manager.js
 * Premiere Pro 중첩 시퀀스 기반 컷 마커 관리 + 영상 오버레이
 */

import { createLogger } from '../logger.js';

const logger = createLogger('CutMarkerManager');

// ============================================================
// CutMarker 데이터 클래스
// ============================================================

class CutMarker {
  constructor({ name, startFrame, endFrame, startTime, endTime }) {
    this.name = name;
    this.startFrame = startFrame;
    this.endFrame = endFrame;
    this.startTime = startTime;
    this.endTime = endTime;
  }

  containsFrame(frame) {
    return frame >= this.startFrame && frame < this.endFrame;
  }

  containsTime(time) {
    return time >= this.startTime && time < this.endTime;
  }

  toJSON() {
    return {
      name: this.name,
      startFrame: this.startFrame,
      endFrame: this.endFrame,
      startTime: this.startTime,
      endTime: this.endTime
    };
  }

  static fromJSON(json) {
    return new CutMarker(json);
  }
}

// ============================================================
// CutMarkerManager
// ============================================================

const POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right'
];

const FONT_SIZES = {
  small: '11px',
  medium: '14px',
  large: '18px'
};

class CutMarkerManager extends EventTarget {
  constructor(options = {}) {
    super();

    // DOM
    this.overlayContainer = options.overlayContainer || null;
    this.overlayLabel = this.overlayContainer?.querySelector('.cut-marker-label') || null;

    // Dependencies
    this.videoPlayer = options.videoPlayer || null;
    this.timeline = options.timeline || null;
    this.settings = options.settings || null;

    // Data
    this.markers = [];
    this.currentCut = null;
    this.source = null;
    this.sequenceName = null;
    this.sourceFps = null;

    // Settings
    this._visible = true;
    this._position = 'top-left';
    this._fontSize = 'medium';

    // 설정에서 초기값 로드
    this._loadSettings();

    logger.info('CutMarkerManager 초기화');
  }

  // ============================================================
  // Settings
  // ============================================================

  _loadSettings() {
    if (!this.settings) return;
    this._visible = this.settings.getSetting('showCutMarkers') !== false;
    this._position = this.settings.getSetting('cutMarkerPosition') || 'top-left';
    this._fontSize = this.settings.getSetting('cutMarkerFontSize') || 'medium';
    this._applyOverlaySettings();
  }

  setVisible(show) {
    this._visible = show;
    if (this.settings) {
      this.settings.setSetting('showCutMarkers', show);
    }
    this._applyOverlaySettings();
    this._emit('visibilityChanged', { visible: show });
  }

  setPosition(position) {
    if (!POSITIONS.includes(position)) return;
    this._position = position;
    if (this.settings) {
      this.settings.setSetting('cutMarkerPosition', position);
    }
    this._applyOverlaySettings();
    this._emit('positionChanged', { position });
  }

  setFontSize(size) {
    if (!FONT_SIZES[size]) return;
    this._fontSize = size;
    if (this.settings) {
      this.settings.setSetting('cutMarkerFontSize', size);
    }
    this._applyOverlaySettings();
    this._emit('fontSizeChanged', { size });
  }

  _applyOverlaySettings() {
    if (!this.overlayContainer) return;

    // 위치 클래스 교체
    for (const pos of POSITIONS) {
      this.overlayContainer.classList.remove(`cut-marker-pos-${pos}`);
    }
    this.overlayContainer.classList.add(`cut-marker-pos-${this._position}`);

    // 폰트 크기
    this.overlayContainer.style.fontSize = FONT_SIZES[this._fontSize] || FONT_SIZES.medium;

    // 표시/숨김
    this.overlayContainer.style.display =
      (this._visible && this.markers.length > 0) ? 'block' : 'none';
  }

  // ============================================================
  // Data Management
  // ============================================================

  importFromPrproj(parsedData) {
    this.markers = parsedData.cuts.map(c => CutMarker.fromJSON(c));
    this.source = parsedData.source || null;
    this.sequenceName = parsedData.sequenceName;
    this.sourceFps = parsedData.fps;

    // 타임라인에 마커 전달
    if (this.timeline) {
      this.timeline.setCutMarkers(this.markers);
    }

    this._applyOverlaySettings();
    this._emit('imported', {
      count: this.markers.length,
      sequenceName: this.sequenceName
    });

    logger.info(`컷 마커 가져오기 완료: ${this.markers.length}개 (${this.sequenceName})`);
  }

  clear() {
    this.markers = [];
    this.currentCut = null;
    this.source = null;
    this.sequenceName = null;
    this.sourceFps = null;

    if (this.overlayLabel) {
      this.overlayLabel.textContent = '';
    }
    if (this.overlayContainer) {
      this.overlayContainer.style.display = 'none';
    }
    if (this.timeline) {
      this.timeline.setCutMarkers([]);
    }

    this._emit('cleared');
    logger.info('컷 마커 초기화');
  }

  hasMarkers() {
    return this.markers.length > 0;
  }

  // ============================================================
  // Frame Lookup (Binary Search)
  // ============================================================

  getCutAtFrame(frame) {
    if (this.markers.length === 0) return null;

    let low = 0;
    let high = this.markers.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const marker = this.markers[mid];

      if (frame < marker.startFrame) {
        high = mid - 1;
      } else if (frame >= marker.endFrame) {
        low = mid + 1;
      } else {
        return marker; // frame is within this marker
      }
    }

    return null; // frame is not within any marker
  }

  getCutAtTime(time) {
    if (this.markers.length === 0) return null;

    let low = 0;
    let high = this.markers.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const marker = this.markers[mid];

      if (time < marker.startTime) {
        high = mid - 1;
      } else if (time >= marker.endTime) {
        low = mid + 1;
      } else {
        return marker;
      }
    }

    return null;
  }

  // ============================================================
  // Overlay Rendering
  // ============================================================

  updateOverlay(currentFrame) {
    if (!this._visible || this.markers.length === 0) {
      if (this.overlayContainer) {
        this.overlayContainer.style.display = 'none';
      }
      return;
    }

    const cut = this.getCutAtFrame(currentFrame);

    if (cut !== this.currentCut) {
      this.currentCut = cut;

      if (cut && this.overlayLabel) {
        this.overlayLabel.textContent = cut.name;
        this.overlayContainer.style.display = 'block';
      } else if (this.overlayContainer) {
        this.overlayContainer.style.display = 'none';
      }

      this._emit('cutChanged', { cut });
    }
  }

  updateOverlayByTime(currentTime) {
    if (!this._visible || this.markers.length === 0) {
      if (this.overlayContainer) {
        this.overlayContainer.style.display = 'none';
      }
      return;
    }

    const cut = this.getCutAtTime(currentTime);

    if (cut !== this.currentCut) {
      this.currentCut = cut;

      if (cut && this.overlayLabel) {
        this.overlayLabel.textContent = cut.name;
        this.overlayContainer.style.display = 'block';
      } else if (this.overlayContainer) {
        this.overlayContainer.style.display = 'none';
      }

      this._emit('cutChanged', { cut });
    }
  }

  // ============================================================
  // Persistence (.bframe)
  // ============================================================

  toJSON() {
    if (this.markers.length === 0) return null;

    return {
      source: this.source,
      sequenceName: this.sequenceName,
      fps: this.sourceFps,
      markers: this.markers.map(m => m.toJSON())
    };
  }

  loadFromJSON(json) {
    if (!json || !json.markers || json.markers.length === 0) {
      this.clear();
      return;
    }

    this.source = json.source || null;
    this.sequenceName = json.sequenceName || null;
    this.sourceFps = json.fps || null;
    this.markers = json.markers.map(m => CutMarker.fromJSON(m));

    // 타임라인에 마커 전달
    if (this.timeline) {
      this.timeline.setCutMarkers(this.markers);
    }

    this._applyOverlaySettings();
    this._emit('loaded', {
      count: this.markers.length,
      sequenceName: this.sequenceName
    });

    logger.info(`컷 마커 로드 완료: ${this.markers.length}개`);
  }

  // ============================================================
  // Events
  // ============================================================

  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

// Singleton
let instance = null;

export function getCutMarkerManager(options) {
  if (!instance) {
    instance = new CutMarkerManager(options);
  }
  return instance;
}

export { CutMarker, CutMarkerManager };
```

- [ ] **Step 2: 검증**

```bash
npm run lint
```

- [ ] **Step 3: 커밋**

```bash
git add renderer/scripts/modules/cut-marker-manager.js
git commit -m "feat: CutMarkerManager 모듈 구현

- CutMarker 데이터 클래스 (toJSON/fromJSON/containsFrame)
- Binary search 기반 프레임 → 컷 탐색
- DOM 오버레이 렌더링 (위치/크기/표시 설정)
- .bframe 저장/로드 지원
- 타임라인 마커 연동 인터페이스"
```

---

### Task 6: ReviewDataManager 통합

**Files:**
- Modify: `renderer/scripts/modules/review-data-manager.js`

- [ ] **Step 1: constructor에 cutMarkerManager 옵션 추가**

`review-data-manager.js` constructor(line ~99-130)에서 기존 `this.highlightManager = options.highlightManager;` 다음에 추가:

```javascript
    this.cutMarkerManager = options.cutMarkerManager || null;
```

- [ ] **Step 2: _collectData()에 cuts 추가**

`_collectData()` 메서드(line ~638)의 반환 객체에, 기존 `highlights: ...` 다음에 추가:

```javascript
      cuts: this.cutMarkerManager?.toJSON() || null
```

- [ ] **Step 3: _applyData()에 cuts 로드 추가**

`_applyData()` 메서드(line ~668)에서, 기존 highlights 로드 블록 다음에 추가:

```javascript
    // 컷 마커 데이터
    if (this.cutMarkerManager) {
      if (data.cuts) {
        this.cutMarkerManager.loadFromJSON(data.cuts);
      } else {
        this.cutMarkerManager.clear();
      }
    }
```

- [ ] **Step 4: connect()에 cutMarkerManager 이벤트 연결 추가**

`connect()` 메서드에서, 기존 highlightManager 이벤트 연결 다음에 추가:

```javascript
    if (this.cutMarkerManager) {
      this.cutMarkerManager.addEventListener('imported', this._onDataChanged);
      this.cutMarkerManager.addEventListener('cleared', this._onDataChanged);
    }
```

- [ ] **Step 5: setCutMarkerManager() 메서드 추가**

클래스 내부에 메서드 추가 (기존 setter 패턴이 있다면 근처에, 없으면 connect() 근처):

```javascript
  setCutMarkerManager(manager) {
    this.cutMarkerManager = manager;
    if (manager) {
      manager.addEventListener('imported', this._onDataChanged);
      manager.addEventListener('cleared', this._onDataChanged);
    }
  }
```

- [ ] **Step 6: 검증**

```bash
npm run lint
```

- [ ] **Step 7: 커밋**

```bash
git add renderer/scripts/modules/review-data-manager.js
git commit -m "feat: ReviewDataManager에 컷 마커 저장/로드 통합

- _collectData()에 cuts 필드 추가
- _applyData()에 cuts 로드/초기화 추가
- setCutMarkerManager() 메서드 추가
- imported/cleared 이벤트로 auto-save 연동"
```

---

## Chunk 4: UI 통합

### Task 7: UserSettings에 컷 마커 설정 추가

**Files:**
- Modify: `renderer/scripts/modules/user-settings.js`

- [ ] **Step 1: 기본값 객체에 설정 3개 추가**

`user-settings.js`의 `this.settings = { ... }` 블록(line ~160-185) 내부, 기존 설정 마지막에 추가:

```javascript
      // 컷 마커 설정
      showCutMarkers: true,
      cutMarkerPosition: 'top-left',
      cutMarkerFontSize: 'medium',
```

- [ ] **Step 2: 범용 getSetting/setSetting 메서드 추가**

기존 `UserSettings` 클래스에는 프로퍼티별 getter/setter만 있고, 범용 접근 메서드가 없다. `CutMarkerManager`가 설정에 접근할 수 있도록 범용 메서드를 추가한다. 기존 getter/setter 블록 근처에 추가:

```javascript
  // ====== 범용 설정 접근 ======
  getSetting(key) {
    return this.settings[key];
  }

  setSetting(key, value) {
    if (this.settings[key] !== value) {
      this.settings[key] = value;
      this._save();
      this._emit('settingChanged', { key, value });
    }
  }
```

이 메서드는 기존 프로퍼티별 getter/setter와 공존하며, 새로 추가되는 설정 접근에 활용된다.

- [ ] **Step 3: 커밋**

```bash
git add renderer/scripts/modules/user-settings.js
git commit -m "feat: 컷 마커 표시 설정 추가

- showCutMarkers: 오버레이 표시 여부 (기본값 true)
- cutMarkerPosition: 오버레이 위치 (기본값 top-left)
- cutMarkerFontSize: 글자 크기 (기본값 medium)"
```

---

### Task 8: HTML + CSS

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/styles/main.css`

- [ ] **Step 1: index.html에 오버레이 DOM 추가**

`renderer/index.html`의 `video-wrapper` (`<div class="video-wrapper" id="videoWrapper">`) 내부, 기존 canvas/overlay 요소들 다음에 추가:

```html
          <!-- 컷 마커 오버레이 -->
          <div id="cutMarkerOverlay" class="cut-marker-overlay cut-marker-pos-top-left" style="display: none;">
            <span class="cut-marker-label"></span>
          </div>
```

- [ ] **Step 2: index.html에 가져오기 버튼 추가**

기존 컨트롤 버튼 영역(video-comment-overlay-controls 등)에 적절한 위치에 추가:

```html
            <button class="overlay-control-btn" id="btnImportCutMarkers" title="릴 가져오기 (.prproj)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 1h8l4 4v10H2V1zm8 0v4h4M5 9h6M8 6v6"/>
              </svg>
            </button>
```

- [ ] **Step 3: main.css에 오버레이 스타일 추가**

`renderer/styles/main.css` 끝 또는 적절한 섹션에 추가:

```css
/* ====== 컷 마커 오버레이 ====== */
.cut-marker-overlay {
  position: absolute;
  z-index: 15;
  pointer-events: none;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  color: #ffffff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  padding: 3px 8px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  transition: opacity 0.15s ease;
  user-select: none;
}

/* 위치 클래스 */
.cut-marker-pos-top-left { top: 12px; left: 12px; }
.cut-marker-pos-top-center { top: 12px; left: 50%; transform: translateX(-50%); }
.cut-marker-pos-top-right { top: 12px; right: 12px; }
.cut-marker-pos-bottom-left { bottom: 12px; left: 12px; }
.cut-marker-pos-bottom-center { bottom: 12px; left: 50%; transform: translateX(-50%); }
.cut-marker-pos-bottom-right { bottom: 12px; right: 12px; }

/* 타임라인 컷 마커 */
.timeline-cut-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 165, 0, 0.6);
  pointer-events: none;
  z-index: 2;
}

.timeline-cut-label {
  position: absolute;
  top: 1px;
  left: 3px;
  font-size: 9px;
  font-family: 'Consolas', monospace;
  color: rgba(255, 165, 0, 0.9);
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}

/* 라이트 모드 */
.light-mode .cut-marker-overlay {
  color: #1a1a1a;
  text-shadow: 0 1px 3px rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.7);
}

.light-mode .timeline-cut-marker {
  background: rgba(200, 120, 0, 0.6);
}

.light-mode .timeline-cut-label {
  color: rgba(200, 120, 0, 0.9);
}
```

- [ ] **Step 4: 검증**

```bash
npm run lint
```

- [ ] **Step 5: 커밋**

```bash
git add renderer/index.html renderer/styles/main.css
git commit -m "feat: 컷 마커 오버레이 UI 추가

- 영상 위 오버레이 DOM (6가지 위치 지원)
- 릴 가져오기 버튼
- 타임라인 컷 구분선 스타일
- 라이트 모드 대응"
```

---

### Task 9: Timeline 컷 마커 렌더링

**Files:**
- Modify: `renderer/scripts/modules/timeline.js`

- [ ] **Step 1: 컷 마커 상태 + setCutMarkers() 추가**

`timeline.js` constructor 내부(line ~12-79), 기존 상태 변수 근처에 추가:

```javascript
    // 컷 마커
    this._cutMarkers = [];
```

클래스에 메서드 추가:

```javascript
  /**
   * 컷 마커를 설정하고 타임라인에 렌더링한다.
   * @param {CutMarker[]} markers
   */
  setCutMarkers(markers) {
    this._cutMarkers = markers || [];
    this.renderCutMarkers();
  }

  /**
   * 타임라인 룰러에 컷 구분선을 렌더링한다.
   */
  renderCutMarkers() {
    // 기존 마커 제거
    const existing = this.tracksContainer?.querySelectorAll('.timeline-cut-marker');
    if (existing) {
      existing.forEach(el => el.remove());
    }

    if (!this._cutMarkers.length || !this.tracksContainer || !this.duration) return;

    const containerWidth = this.tracksContainer.scrollWidth;

    for (const marker of this._cutMarkers) {
      const ratio = marker.startTime / this.duration;
      const xPos = ratio * containerWidth;

      const line = document.createElement('div');
      line.className = 'timeline-cut-marker';
      line.style.left = `${xPos}px`;

      const label = document.createElement('span');
      label.className = 'timeline-cut-label';
      label.textContent = marker.name;

      line.appendChild(label);
      this.tracksContainer.appendChild(line);
    }
  }
```

- [ ] **Step 2: 줌/리사이즈 시 재렌더링 연결**

기존 `_applyZoom()` 메서드 끝에 추가:

```javascript
    this.renderCutMarkers();
```

기존 리사이즈 핸들러가 있다면 거기에도 `this.renderCutMarkers()` 호출 추가.

- [ ] **Step 3: 커밋**

```bash
git add renderer/scripts/modules/timeline.js
git commit -m "feat: 타임라인에 컷 구분선 렌더링

- setCutMarkers()로 마커 데이터 수신
- 룰러에 수직 구분선 + 컷 이름 라벨 렌더링
- 줌/리사이즈 시 자동 재렌더링"
```

---

### Task 10: app.js 통합 + 가져오기 플로우

**Files:**
- Modify: `renderer/scripts/app.js`

- [ ] **Step 1: import 추가**

`app.js` 상단 import 섹션에 추가:

```javascript
import { getCutMarkerManager } from './modules/cut-marker-manager.js';
```

- [ ] **Step 2: elements 객체에 DOM 참조 추가**

`elements` 객체(line ~44-181) 내부에 추가:

```javascript
    cutMarkerOverlay: document.getElementById('cutMarkerOverlay'),
    btnImportCutMarkers: document.getElementById('btnImportCutMarkers'),
```

- [ ] **Step 3: CutMarkerManager 초기화**

모듈 초기화 섹션(다른 매니저가 생성되는 근처)에 추가:

```javascript
  // 컷 마커 매니저 초기화
  const cutMarkerManager = getCutMarkerManager({
    overlayContainer: elements.cutMarkerOverlay,
    videoPlayer: videoPlayer,
    timeline: timeline,
    settings: userSettings
  });

  // ReviewDataManager에 연결
  reviewDataManager.setCutMarkerManager(cutMarkerManager);
```

- [ ] **Step 4: timeupdate 이벤트 연결**

기존 videoPlayer의 timeupdate 이벤트 핸들러 근처에 추가:

```javascript
  // 컷 마커 오버레이 업데이트 (프레임 기반 — 더 정확)
  videoPlayer.addEventListener('timeupdate', (e) => {
    if (e.detail && e.detail.currentFrame !== undefined) {
      cutMarkerManager.updateOverlay(e.detail.currentFrame);
    } else {
      cutMarkerManager.updateOverlayByTime(videoPlayer.currentTime);
    }
  });
```

**참고**: videoPlayer가 mpv 기반이므로 이벤트 이름과 currentTime 접근 방식을 기존 코드에 맞출 것. 기존 timeupdate 핸들러가 어떤 이벤트 이름을 쓰는지 확인 후 동일하게 사용.

- [ ] **Step 5: 가져오기 버튼 핸들러**

이벤트 리스너 섹션에 추가:

```javascript
  // 릴 가져오기 버튼
  if (elements.btnImportCutMarkers) {
    elements.btnImportCutMarkers.addEventListener('click', async () => {
      try {
        // 기존 데이터 덮어쓰기 확인
        if (cutMarkerManager.hasMarkers()) {
          const confirmed = confirm('기존 컷 데이터를 덮어씁니다. 계속하시겠습니까?');
          if (!confirmed) return;
        }

        // 파일 선택
        const result = await window.electronAPI.openPrprojDialog();
        if (result.canceled || !result.filePaths.length) return;

        const filePath = result.filePaths[0];

        // 파싱
        const parsed = await window.electronAPI.parsePrproj(filePath);

        // 여러 시퀀스가 있는 경우: 사용자에게 선택 프롬프트
        if (parsed.multipleSequences) {
          const names = parsed.sequences.map(s => s.name);
          const choice = prompt(
            `여러 시퀀스가 발견되었습니다. 번호를 입력하세요:\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
          );
          if (!choice) return;

          const idx = parseInt(choice, 10) - 1;
          if (idx < 0 || idx >= parsed.sequences.length) return;

          const selectedId = parsed.sequences[idx].id;
          const reparsed = await window.electronAPI.parsePrprojWithSequenceId(filePath, selectedId);
          reparsed.source = filePath;
          cutMarkerManager.importFromPrproj(reparsed);
          return;
        }

        // 컷 마커 적용
        parsed.source = filePath;
        cutMarkerManager.importFromPrproj(parsed);

      } catch (err) {
        logger.error('릴 가져오기 실패:', err.message);
        // 사용자에게 에러 표시 (기존 toast/alert 패턴 사용)
        if (typeof showToast === 'function') {
          showToast(err.message, 'error');
        } else {
          alert(err.message);
        }
      }
    });
  }
```

- [ ] **Step 6: 검증**

```bash
npm run lint
```

- [ ] **Step 7: 커밋**

```bash
git add renderer/scripts/app.js
git commit -m "feat: 컷 마커 기능 app.js 통합

- CutMarkerManager 초기화 + ReviewDataManager 연결
- 영상 재생 시 오버레이 업데이트 연동
- 릴 가져오기 버튼 클릭 핸들러
- 에러 처리 + 덮어쓰기 확인 다이얼로그"
```

---

### Task 11: 최종 통합 테스트 + lint

- [ ] **Step 1: lint + format**

```bash
npm run lint:fix && npm run format
```

- [ ] **Step 2: 앱 실행 테스트**

```bash
npm run dev
```

테스트 시나리오:
1. 앱 실행 후 영상 파일 로드
2. 릴 가져오기 버튼 클릭 → .prproj 파일 선택
3. 오버레이에 컷 이름(a001, a002...) 표시 확인
4. 타임라인에 컷 구분선 표시 확인
5. 영상 탐색 시 오버레이가 해당 컷 이름으로 변경되는지 확인
6. 앱 닫고 다시 열어 .bframe에서 컷 데이터 복원되는지 확인

- [ ] **Step 3: 문제 수정 후 최종 커밋**

```bash
git add -A
git commit -m "fix: 컷 마커 통합 테스트 후 수정사항 반영"
```

- [ ] **Step 4: lint 최종 확인**

```bash
npm run lint
```

Expected: 0 errors, 0 warnings
