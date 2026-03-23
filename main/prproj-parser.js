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

const DEFAULT_TICKS_PER_SECOND = 254016000000;

async function parsePrproj(filePath) {
  logger.info(`파싱 시작: ${filePath}`);

  const fileBuffer = fs.readFileSync(filePath);

  let xmlString;
  try {
    const decompressed = zlib.gunzipSync(fileBuffer);
    xmlString = decompressed.toString('utf-8');
  } catch (err) {
    throw new Error('지원하지 않는 프리미어 프로젝트 형식입니다. GZip 해제에 실패했습니다.');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => {
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

  const result = extractSequenceData(xmlObj);
  logger.info(`파싱 완료: ${result.cuts?.length || 0}개 컷 발견`);
  return result;
}

function extractSequenceData(xmlObj) {
  const root = xmlObj.PremiereData || xmlObj;
  const sequenceMap = new Map();
  const nestedIds = new Set();

  collectSequences(root, sequenceMap);

  for (const [, entry] of sequenceMap) {
    const nestedRefs = findNestedSequenceRefs(entry.sequence);
    for (const ref of nestedRefs) {
      nestedIds.add(ref);
    }
  }

  const topLevelSequences = [];
  for (const [id, entry] of sequenceMap) {
    if (!nestedIds.has(id)) {
      topLevelSequences.push(entry);
    }
  }

  if (topLevelSequences.length === 0) {
    throw new Error('프로젝트에서 시퀀스를 찾을 수 없습니다.');
  }

  if (topLevelSequences.length > 1) {
    return {
      multipleSequences: true,
      sequences: topLevelSequences.map(s => ({
        id: s.id,
        name: s.name
      }))
    };
  }

  const mainSeq = topLevelSequences[0];
  return parseMainSequence(mainSeq.sequence, mainSeq.name, sequenceMap);
}

function collectSequences(obj, map, path = '') {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectSequences(item, map, `${path}[${i}]`));
    return;
  }

  if (obj['@_ObjectID'] !== undefined && obj.Name !== undefined) {
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

  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue;
    collectSequences(obj[key], map, `${path}.${key}`);
  }
}

function findNestedSequenceRefs(sequence) {
  const refs = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }

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

function parseMainSequence(sequence, seqName, sequenceMap) {
  const fps = extractFps(sequence);
  const ticksPerSecond = extractTicksPerSecond(sequence) || DEFAULT_TICKS_PER_SECOND;
  const ticksPerFrame = ticksPerSecond / fps;

  const trackItems = extractVideoTrackItems(sequence);

  const cuts = [];

  for (const item of trackItems) {
    const nestedSeqName = resolveNestedSequenceName(item, sequenceMap);
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

function extractFps(sequence) {
  const timebase = findDeep(sequence, 'TimeBase');
  if (timebase) return Number(timebase);

  const frameRate = findDeep(sequence, 'FrameRate');
  if (frameRate) return Number(frameRate);

  return 24;
}

function extractTicksPerSecond(sequence) {
  const tps = findDeep(sequence, 'TicksPerSecond');
  if (tps) return Number(tps);
  return null;
}

function extractVideoTrackItems(sequence) {
  const items = [];

  function walk(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;

    if (Array.isArray(obj)) {
      obj.forEach(item => walk(item, depth));
      return;
    }

    const isTrackItem = obj.Start !== undefined && obj.End !== undefined &&
      (obj.SubClip || obj.ClipID || obj.Source);

    if (isTrackItem) {
      items.push(obj);
      return;
    }

    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_')) continue;
      walk(obj[key], depth + 1);
    }
  }

  walk(sequence);
  return items;
}

function resolveNestedSequenceName(trackItem, sequenceMap) {
  function findSequenceRef(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const result = findSequenceRef(item, depth);
        if (result) return result;
      }
      return null;
    }

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

function parseTickValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = Number(value);
    return isNaN(num) ? null : num;
  }
  if (typeof value === 'object') {
    const text = value['#text'] || value._ || value.toString();
    const num = Number(text);
    return isNaN(num) ? null : num;
  }
  return null;
}

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
