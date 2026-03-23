/**
 * prproj-parser.js
 * Premiere Pro 프로젝트 파일(.prproj) 파서
 * .prproj는 GZip 압축된 XML 파일이다.
 *
 * XML 구조: PremiereData 아래 모든 요소가 플랫 배열로 존재.
 * ObjectID/ObjectRef 기반 참조 그래프를 구성하여 시퀀스 관계를 해석한다.
 */

const fs = require('fs');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');
const { createLogger } = require('./logger');

const logger = createLogger('PrprojParser');

const DEFAULT_TICKS_PER_SECOND = 254016000000;

// XML 파싱 시 항상 배열로 처리할 태그 목록
const ARRAY_TAGS = new Set([
  'Sequence',
  'VideoClipTrackItem', 'AudioClipTrackItem',
  'VideoSequenceSource', 'AudioSequenceSource',
  'VideoClipTrack', 'AudioClipTrack',
  'VideoTrackGroup', 'AudioTrackGroup',
  'VideoClip', 'AudioClip',
  'SubClip', 'MasterClip',
  'Track', 'TrackItem', 'ClipItem'
]);

/**
 * .prproj 파일을 파싱한다.
 * @param {string} filePath - .prproj 파일 경로
 * @returns {Promise<object>} 파싱 결과 (cuts 배열 또는 multipleSequences)
 */
async function parsePrproj(filePath) {
  logger.info(`파싱 시작: ${filePath}`);

  const { root, objectMap } = loadAndParse(filePath);
  const result = extractSequenceData(root, objectMap);

  logger.info(`파싱 완료: ${result.cuts?.length || 0}개 컷 발견`);
  return result;
}

/**
 * 특정 시퀀스 ID를 지정하여 파싱한다.
 * @param {string} filePath - .prproj 파일 경로
 * @param {string} sequenceId - 시퀀스 ObjectID
 * @returns {Promise<object>} 파싱 결과
 */
async function parsePrprojWithSequenceId(filePath, sequenceId) {
  logger.info(`파싱 시작 (시퀀스 ID: ${sequenceId}): ${filePath}`);

  const { root, objectMap } = loadAndParse(filePath);
  const sequences = ensureArray(root.Sequence);

  const target = sequences.find(
    (s) => String(s['@_ObjectID']) === String(sequenceId)
  );

  if (!target) {
    throw new Error('지정한 시퀀스를 찾을 수 없습니다.');
  }

  const seqName = extractTextValue(target.Name) || 'Unnamed';
  return parseMainSequence(target, seqName, objectMap, root);
}

// ─────────────────────────────────────────────
// 내부 헬퍼 함수
// ─────────────────────────────────────────────

/**
 * 파일을 읽고, GZip 해제 후 XML 파싱하여 root와 objectMap을 반환한다.
 */
function loadAndParse(filePath) {
  const fileBuffer = fs.readFileSync(filePath);

  let xmlString;
  try {
    const decompressed = zlib.gunzipSync(fileBuffer);
    xmlString = decompressed.toString('utf-8');
  } catch (_err) {
    throw new Error('지원하지 않는 프리미어 프로젝트 형식입니다. GZip 해제에 실패했습니다.');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ARRAY_TAGS.has(name)
  });

  let xmlObj;
  try {
    xmlObj = parser.parse(xmlString);
  } catch (_err) {
    throw new Error('프로젝트 파일을 읽을 수 없습니다. XML 파싱에 실패했습니다.');
  }

  const root = xmlObj.PremiereData || xmlObj;
  const objectMap = buildObjectMap(root);

  return { root, objectMap };
}

/**
 * root 아래 모든 플랫 배열을 순회하여 ObjectID → 객체 맵을 구성한다.
 */
function buildObjectMap(root) {
  const map = new Map();

  for (const key of Object.keys(root)) {
    if (key.startsWith('@_') || key.startsWith('#')) continue;

    const elements = root[key];

    if (Array.isArray(elements)) {
      for (const el of elements) {
        registerObject(map, el);
      }
    } else if (elements && typeof elements === 'object') {
      registerObject(map, elements);
    }
  }

  return map;
}

/**
 * 객체에 ObjectID가 있으면 맵에 등록한다.
 */
function registerObject(map, obj) {
  if (!obj || typeof obj !== 'object') return;

  if (obj['@_ObjectID'] !== undefined) {
    map.set(String(obj['@_ObjectID']), obj);
  }
  if (obj['@_ObjectUID'] !== undefined) {
    map.set(String(obj['@_ObjectUID']), obj);
  }
}

/**
 * ObjectRef/ObjectURef 참조를 실제 객체로 해석한다.
 */
function resolveRef(obj, objectMap) {
  if (!obj || typeof obj !== 'object') return obj;

  if (obj['@_ObjectRef'] !== undefined) {
    return objectMap.get(String(obj['@_ObjectRef'])) || null;
  }
  if (obj['@_ObjectURef'] !== undefined) {
    return objectMap.get(String(obj['@_ObjectURef'])) || null;
  }

  return obj;
}

/**
 * 시퀀스 데이터를 추출한다. 최상위 시퀀스를 찾고 컷 목록을 반환한다.
 */
function extractSequenceData(root, objectMap) {
  const sequences = ensureArray(root.Sequence);

  if (sequences.length === 0) {
    throw new Error('프로젝트에서 시퀀스를 찾을 수 없습니다.');
  }

  // 시퀀스 ID → name 맵 구성
  const sequenceIdSet = new Set();
  for (const seq of sequences) {
    if (seq['@_ObjectID'] !== undefined) {
      sequenceIdSet.add(String(seq['@_ObjectID']));
    }
  }

  // 중첩 시퀀스로 참조되는 시퀀스 ID를 수집한다.
  // VideoSequenceSource → SequenceSource → Sequence(ObjectRef)를 추적
  const nestedSequenceIds = collectNestedSequenceIds(root, objectMap);

  // 다른 시퀀스에 의해 중첩되지 않는 최상위 시퀀스를 찾는다.
  const topLevel = sequences.filter(
    (seq) => !nestedSequenceIds.has(String(seq['@_ObjectID']))
  );

  if (topLevel.length === 0) {
    // 모두 중첩된 경우: 가장 이름이 '릴' 포함하거나, 첫 번째 시퀀스 사용
    const reelSeq = sequences.find(
      (s) => (extractTextValue(s.Name) || '').includes('릴')
    );
    const fallback = reelSeq || sequences[0];
    const name = extractTextValue(fallback.Name) || 'Unnamed';
    return parseMainSequence(fallback, name, objectMap, root);
  }

  if (topLevel.length > 1) {
    return {
      multipleSequences: true,
      sequences: topLevel.map((s) => ({
        id: String(s['@_ObjectID']),
        name: extractTextValue(s.Name) || 'Unnamed'
      }))
    };
  }

  const mainSeq = topLevel[0];
  const mainName = extractTextValue(mainSeq.Name) || 'Unnamed';
  return parseMainSequence(mainSeq, mainName, objectMap, root);
}

/**
 * VideoSequenceSource 배열을 통해 중첩 시퀀스로 참조되는 시퀀스 ID를 수집한다.
 */
function collectNestedSequenceIds(root, objectMap) {
  const ids = new Set();

  // VideoSequenceSource에서 Sequence 참조를 추출
  const videoSeqSources = ensureArray(root.VideoSequenceSource);
  for (const vss of videoSeqSources) {
    const seqId = extractSequenceIdFromSource(vss, objectMap);
    if (seqId) ids.add(seqId);
  }

  // AudioSequenceSource도 확인
  const audioSeqSources = ensureArray(root.AudioSequenceSource);
  for (const ass of audioSeqSources) {
    const seqId = extractSequenceIdFromSource(ass, objectMap);
    if (seqId) ids.add(seqId);
  }

  return ids;
}

/**
 * SequenceSource 객체에서 참조하는 Sequence의 ObjectID를 추출한다.
 */
function extractSequenceIdFromSource(sourceObj, objectMap) {
  if (!sourceObj) return null;

  // SequenceSource → Sequence (ObjectRef)
  const seqSource = sourceObj.SequenceSource || sourceObj;
  const seqRef = seqSource.Sequence;

  if (!seqRef) return null;

  const resolved = resolveRef(seqRef, objectMap);
  if (resolved && resolved['@_ObjectID'] !== undefined) {
    return String(resolved['@_ObjectID']);
  }

  // 직접 참조인 경우
  if (seqRef['@_ObjectRef'] !== undefined) {
    return String(seqRef['@_ObjectRef']);
  }
  if (seqRef['@_ObjectURef'] !== undefined) {
    return String(seqRef['@_ObjectURef']);
  }

  return null;
}

/**
 * 메인 시퀀스를 파싱하여 컷 목록을 반환한다.
 */
function parseMainSequence(sequence, seqName, objectMap, root) {
  const fps = extractFps(sequence, objectMap);
  const ticksPerSecond = extractTicksPerSecond(sequence) || DEFAULT_TICKS_PER_SECOND;
  const ticksPerFrame = ticksPerSecond / fps;

  // 메인 시퀀스의 비디오 트랙 아이템을 추출한다.
  const trackItems = extractVideoTrackItemsFlat(sequence, objectMap, root);

  const cuts = [];

  for (const item of trackItems) {
    const nestedSeqName = resolveNestedSequenceName(item, objectMap);
    if (!nestedSeqName) continue;

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

  cuts.sort((a, b) => a.startFrame - b.startFrame);

  if (cuts.length === 0) {
    throw new Error('선택한 프로젝트에 중첩 시퀀스가 없습니다.');
  }

  const lastCut = cuts[cuts.length - 1];

  return {
    sequenceName: seqName,
    fps,
    duration: lastCut.endTime,
    totalFrames: lastCut.endFrame,
    cuts
  };
}

/**
 * 메인 시퀀스의 비디오 트랙 아이템을 플랫 구조에서 추출한다.
 *
 * 참조 체인:
 * Sequence → TrackGroups(ref) → VideoTrackGroup(ID)
 *   → Tracks → VideoClipTrack(ref) → VideoClipTrack(ID)
 *     → ClipItems → TrackItems → VideoClipTrackItem(ref) → VideoClipTrackItem(ID)
 */
function extractVideoTrackItemsFlat(sequence, objectMap, root) {
  const items = [];

  // 1단계: TrackGroups에서 VideoTrackGroup 참조를 찾는다.
  const trackGroups = sequence.TrackGroups;
  if (!trackGroups) return items;

  const videoTrackGroupRef = trackGroups.VideoTrackGroup;
  if (!videoTrackGroupRef) return items;

  const videoTrackGroup = resolveRef(videoTrackGroupRef, objectMap);
  if (!videoTrackGroup) return items;

  // 2단계: VideoTrackGroup → Tracks → VideoClipTrack 참조를 찾는다.
  const tracks = videoTrackGroup.Tracks;
  if (!tracks) return items;

  const clipTrackRefs = collectRefs(tracks, 'VideoClipTrack');

  for (const trackRef of clipTrackRefs) {
    const track = resolveRef(trackRef, objectMap);
    if (!track) continue;

    // 3단계: VideoClipTrack → ClipItems → TrackItems → VideoClipTrackItem
    const clipItems = track.ClipItems;
    if (!clipItems) continue;

    const trackItemRefs = collectRefs(clipItems, 'VideoClipTrackItem');

    for (const tiRef of trackItemRefs) {
      const trackItem = resolveRef(tiRef, objectMap);
      if (trackItem && trackItem.Start !== undefined && trackItem.End !== undefined) {
        items.push(trackItem);
      }
    }
  }

  // 폴백: 위 방법으로 아이템을 찾지 못한 경우,
  // root의 VideoClipTrackItem 전체를 탐색하여 이 시퀀스에 속하는 것을 찾는다.
  if (items.length === 0) {
    logger.warn('참조 체인으로 트랙 아이템을 찾지 못함. 폴백 탐색 시작.');
    return extractVideoTrackItemsFallback(sequence, objectMap, root);
  }

  return items;
}

/**
 * 폴백: 시퀀스 내부를 재귀적으로 탐색하여 트랙 아이템을 찾는다.
 */
function extractVideoTrackItemsFallback(sequence, objectMap, root) {
  const items = [];

  // root의 모든 VideoClipTrackItem 중
  // 이 시퀀스와 연결되는 것을 찾는다.
  const allTrackItems = ensureArray(root.VideoClipTrackItem);

  // 시퀀스 내부에서 참조하는 모든 ObjectRef를 수집
  const seqRefs = collectAllRefs(sequence);

  for (const ti of allTrackItems) {
    const tiId = String(ti['@_ObjectID'] || '');
    if (seqRefs.has(tiId) && ti.Start !== undefined && ti.End !== undefined) {
      items.push(ti);
    }
  }

  // 그래도 없으면 시퀀스 내부를 직접 탐색
  if (items.length === 0) {
    walkForTrackItems(sequence, items, 0);
  }

  return items;
}

/**
 * 객체 내부를 재귀적으로 탐색하여 Start/End가 있는 트랙 아이템을 수집한다.
 */
function walkForTrackItems(obj, items, depth) {
  if (!obj || typeof obj !== 'object' || depth > 20) return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      walkForTrackItems(item, items, depth);
    }
    return;
  }

  if (obj.Start !== undefined && obj.End !== undefined &&
      (obj.SubClip || obj.ClipID || obj.Source)) {
    items.push(obj);
    return;
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue;
    walkForTrackItems(obj[key], items, depth + 1);
  }
}

/**
 * 객체 내부의 모든 ObjectRef 값을 수집한다.
 */
function collectAllRefs(obj, refs = new Set(), depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 20) return refs;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectAllRefs(item, refs, depth);
    }
    return refs;
  }

  if (obj['@_ObjectRef'] !== undefined) {
    refs.add(String(obj['@_ObjectRef']));
  }
  if (obj['@_ObjectURef'] !== undefined) {
    refs.add(String(obj['@_ObjectURef']));
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue;
    collectAllRefs(obj[key], refs, depth + 1);
  }

  return refs;
}

/**
 * 컨테이너 객체에서 특정 태그명의 참조 배열을 추출한다.
 * 예: Tracks 내부의 VideoClipTrack 참조들
 */
function collectRefs(container, tagName) {
  if (!container || typeof container !== 'object') return [];

  // 직접 태그명으로 접근
  const direct = container[tagName];
  if (direct) {
    return ensureArray(direct);
  }

  // TrackItems, ClipItems 등 중간 컨테이너 내부 탐색
  const results = [];
  for (const key of Object.keys(container)) {
    if (key.startsWith('@_')) continue;
    const child = container[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object') {
          if (item['@_ObjectRef'] !== undefined || item['@_ObjectID'] !== undefined) {
            results.push(item);
          }
          // 중첩 컨테이너 확인
          const nested = item[tagName];
          if (nested) {
            results.push(...ensureArray(nested));
          }
        }
      }
    } else if (child && typeof child === 'object') {
      const nested = child[tagName];
      if (nested) {
        results.push(...ensureArray(nested));
      }
    }
  }

  return results;
}

/**
 * 트랙 아이템에서 중첩 시퀀스 이름을 참조 체인을 따라 해석한다.
 *
 * 체인: TrackItem → SubClip(ref) → Clip(ref) → VideoClip(ID)
 *   → Source(ref) → VideoSequenceSource(ID) → SequenceSource → Sequence(ref) → Sequence(ID) → Name
 */
function resolveNestedSequenceName(trackItem, objectMap) {
  // 방법 1: SubClip 참조 체인
  const subClipRef = trackItem.SubClip;
  if (subClipRef) {
    const subClip = resolveRef(subClipRef, objectMap);
    if (subClip) {
      // SubClip → Clip → VideoClip
      const clipRef = subClip.Clip || subClip.MasterClip;
      if (clipRef) {
        const clip = resolveRef(clipRef, objectMap);
        if (clip) {
          const name = resolveFromClip(clip, objectMap);
          if (name) return name;
        }
      }

      // SubClip에 직접 Source가 있는 경우
      const sourceRef = subClip.Source;
      if (sourceRef) {
        const name = resolveFromSource(sourceRef, objectMap);
        if (name) return name;
      }
    }
  }

  // 방법 2: 직접 Source 참조
  const sourceRef = trackItem.Source;
  if (sourceRef) {
    const name = resolveFromSource(sourceRef, objectMap);
    if (name) return name;
  }

  // 방법 3: ClipID를 통한 탐색
  const clipIdRef = trackItem.ClipID;
  if (clipIdRef) {
    const clip = resolveRef(clipIdRef, objectMap);
    if (clip) {
      const name = resolveFromClip(clip, objectMap);
      if (name) return name;
    }
  }

  // 방법 4: 트랙 아이템 내부에서 Sequence 참조를 직접 탐색
  return findSequenceNameDeep(trackItem, objectMap, 0);
}

/**
 * Clip 객체에서 소스를 통해 시퀀스 이름을 해석한다.
 */
function resolveFromClip(clip, objectMap) {
  const sourceRef = clip.Source;
  if (sourceRef) {
    return resolveFromSource(sourceRef, objectMap);
  }
  return null;
}

/**
 * Source 참조에서 시퀀스 이름을 해석한다.
 * VideoSequenceSource → SequenceSource → Sequence → Name
 */
function resolveFromSource(sourceRef, objectMap) {
  const source = resolveRef(sourceRef, objectMap);
  if (!source) return null;

  // VideoSequenceSource / AudioSequenceSource 구조
  const seqSource = source.SequenceSource || source;
  const seqRef = seqSource.Sequence;

  if (seqRef) {
    const seq = resolveRef(seqRef, objectMap);
    if (seq && seq.Name !== undefined) {
      return extractTextValue(seq.Name);
    }
  }

  return null;
}

/**
 * 객체 내부를 재귀적으로 탐색하여 Sequence 참조를 통해 이름을 찾는다.
 */
function findSequenceNameDeep(obj, objectMap, depth) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = findSequenceNameDeep(item, objectMap, depth);
      if (result) return result;
    }
    return null;
  }

  // ObjectRef가 시퀀스를 가리키는 경우
  const resolved = resolveRef(obj, objectMap);
  if (resolved && resolved !== obj && resolved.Name !== undefined && resolved.TrackGroups) {
    return extractTextValue(resolved.Name);
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue;
    const result = findSequenceNameDeep(obj[key], objectMap, depth + 1);
    if (result) return result;
  }

  return null;
}

/**
 * 시퀀스에서 FPS(TimeBase/FrameRate)를 추출한다.
 */
function extractFps(sequence, objectMap) {
  // 시퀀스 내부에서 직접 탐색
  const timebase = findDeep(sequence, 'TimeBase');
  if (timebase) return Number(timebase);

  const frameRate = findDeep(sequence, 'FrameRate');
  if (frameRate) return Number(frameRate);

  // EditingModeGUID를 통해 프로젝트 레벨에서 찾기
  if (objectMap) {
    for (const [, obj] of objectMap) {
      if (obj && obj.TimeBase !== undefined) {
        return Number(extractTextValue(obj.TimeBase));
      }
    }
  }

  return 24;
}

/**
 * 시퀀스에서 TicksPerSecond 값을 추출한다.
 */
function extractTicksPerSecond(sequence) {
  const tps = findDeep(sequence, 'TicksPerSecond');
  if (tps) return Number(tps);
  return null;
}

/**
 * 객체 내부를 재귀적으로 탐색하여 특정 키의 값을 찾는다.
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
    return extractTextValue(obj[targetKey]);
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue;
    const result = findDeep(obj[key], targetKey, depth + 1);
    if (result !== null) return result;
  }
  return null;
}

/**
 * 틱 값을 숫자로 변환한다.
 * Start/End 필드가 중첩 객체일 수 있다.
 */
function parseTickValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = Number(value);
    return isNaN(num) ? null : num;
  }
  if (typeof value === 'object') {
    // #text 또는 기타 텍스트 값 추출
    const text = value['#text'] ?? value._ ?? value.toString?.();
    const num = Number(text);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * 값에서 텍스트를 추출한다. 객체인 경우 #text를 사용한다.
 */
function extractTextValue(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string' || typeof val === 'number') return val;
  if (typeof val === 'object') {
    return val['#text'] ?? val._ ?? null;
  }
  return null;
}

/**
 * 값을 항상 배열로 반환한다.
 */
function ensureArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

module.exports = { parsePrproj, parsePrprojWithSequenceId };
