/**
 * prproj-parser.js
 * Premiere Pro 프로젝트 파일(.prproj) 파서
 *
 * 실제 .prproj XML 구조 (검증 완료):
 *
 * Sequence → TrackGroups.TrackGroup[0].Second → (resolve VideoTrackGroup)
 *   → TrackGroup.Tracks.Track[] → (resolve each)
 *     → ClipTrack → (resolve VideoClipTrack)
 *       → ClipItems.TrackItems.TrackItem[] → (resolve each VideoClipTrackItem)
 *         → ClipTrackItem.TrackItem.Start/End (ticks)
 *         → ClipTrackItem.SubClip → (resolve) → Name
 */

const fs = require('fs');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');
const { createLogger } = require('./logger');

const logger = createLogger('PrprojParser');

const DEFAULT_TICKS_PER_SECOND = 254016000000;

// isArray에 등록하면 해당 태그명이 등장하는 모든 곳에서 배열로 파싱됨
// TrackItem, SubClip, Track, TrackGroup은 컨텍스트에 따라 단일/복수가 달라서 제외
// → 코드에서 [].concat()로 수동 처리
const ARRAY_TAGS = new Set([
  'Sequence', 'VideoClipTrackItem', 'AudioClipTrackItem',
  'VideoSequenceSource', 'AudioSequenceSource',
  'VideoClipTrack', 'AudioClipTrack',
  'VideoTrackGroup', 'AudioTrackGroup',
  'MasterClip'
]);

/**
 * 글로벌 ObjectID/ObjectUID → 객체 맵 구축
 * .prproj XML은 플랫 구조 + 깊은 참조를 혼용하므로 재귀적으로 수집
 */
function buildObjectMap(root) {
  const map = new Map();

  function collect(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    if (Array.isArray(obj)) {
      for (const item of obj) collect(item, depth);
      return;
    }
    // 현재 객체에 ObjectID/ObjectUID가 있으면 등록
    if (obj['@_ObjectID'] !== undefined) map.set(String(obj['@_ObjectID']), obj);
    if (obj['@_ObjectUID'] !== undefined) map.set(String(obj['@_ObjectUID']), obj);
    // 자식 탐색
    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_')) continue;
      collect(obj[key], depth + 1);
    }
  }

  collect(root, 0);
  return map;
}

/**
 * ObjectRef/ObjectURef를 실제 객체로 해석
 */
function resolve(obj, objectMap) {
  if (!obj) return null;
  for (const k of ['@_ObjectRef', '@_ObjectURef']) {
    if (obj[k] !== undefined) return objectMap.get(String(obj[k])) || null;
  }
  return obj;
}

/**
 * .prproj 파일을 파싱하여 중첩 시퀀스 정보를 추출
 */
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
    isArray: (name) => ARRAY_TAGS.has(name)
  });

  let xmlObj;
  try {
    xmlObj = parser.parse(xmlString);
  } catch (err) {
    throw new Error('프로젝트 파일을 읽을 수 없습니다. XML 파싱에 실패했습니다.');
  }

  const root = xmlObj.PremiereData;
  if (!root) {
    throw new Error('PremiereData를 찾을 수 없습니다.');
  }

  const objectMap = buildObjectMap(root);
  logger.info(`글로벌 맵: ${objectMap.size}개 객체`);

  // 시퀀스 목록
  const sequences = [].concat(root.Sequence || []);
  if (sequences.length === 0) {
    throw new Error('프로젝트에서 시퀀스를 찾을 수 없습니다.');
  }

  logger.info(`시퀀스 ${sequences.length}개 발견`);

  // 여러 시퀀스 → 사용자 선택
  if (sequences.length > 1) {
    return {
      multipleSequences: true,
      sequences: sequences.map(s => ({
        id: String(s['@_ObjectUID'] || s['@_ObjectID'] || ''),
        name: s.Name || 'Unnamed'
      }))
    };
  }

  // 1개면 바로 파싱
  return parseSequenceCuts(sequences[0], objectMap);
}

/**
 * 특정 시퀀스 ID를 지정하여 파싱
 */
async function parsePrprojWithSequenceId(filePath, sequenceId) {
  logger.info(`파싱 시작 (시퀀스 지정): ${filePath} → ${sequenceId}`);

  const fileBuffer = fs.readFileSync(filePath);
  let xmlString;
  try {
    xmlString = zlib.gunzipSync(fileBuffer).toString('utf-8');
  } catch (err) {
    throw new Error('지원하지 않는 프리미어 프로젝트 형식입니다.');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ARRAY_TAGS.has(name)
  });

  const root = parser.parse(xmlString).PremiereData;
  if (!root) throw new Error('PremiereData를 찾을 수 없습니다.');

  const objectMap = buildObjectMap(root);

  // sequenceId로 시퀀스 찾기
  const sequences = [].concat(root.Sequence || []);
  const target = sequences.find(s =>
    String(s['@_ObjectUID'] || '') === sequenceId ||
    String(s['@_ObjectID'] || '') === sequenceId
  );

  if (!target) {
    throw new Error('지정한 시퀀스를 찾을 수 없습니다.');
  }

  return parseSequenceCuts(target, objectMap);
}

/**
 * 시퀀스에서 컷 데이터를 추출
 *
 * 경로:
 * Sequence.TrackGroups.TrackGroup[0].Second → resolve(VideoTrackGroup)
 *   .TrackGroup.Tracks.Track[] → resolve(각 트랙)
 *     .ClipTrack → resolve(VideoClipTrack)
 *       .ClipItems.TrackItems.TrackItem[] → resolve(VideoClipTrackItem)
 *         .ClipTrackItem.TrackItem.Start/End (ticks)
 *         .ClipTrackItem.SubClip → resolve → Name
 */
function parseSequenceCuts(sequence, objectMap) {
  const seqName = sequence.Name || 'Unnamed';
  logger.info(`시퀀스 파싱: "${seqName}"`);

  // FPS 추출 (비디오 트랙그룹의 FrameRate = ticks per frame)
  const trackGroupPairs = [].concat(sequence.TrackGroups?.TrackGroup || []);
  const videoTrackGroupOuter = resolve(trackGroupPairs[0]?.Second, objectMap);

  if (!videoTrackGroupOuter) {
    throw new Error('비디오 트랙 그룹을 찾을 수 없습니다.');
  }

  // TrackGroup이 배열로 파싱될 수도 있고 단일 객체일 수도 있음
  let videoTrackGroupInner = videoTrackGroupOuter.TrackGroup;
  if (Array.isArray(videoTrackGroupInner)) videoTrackGroupInner = videoTrackGroupInner[0];
  if (!videoTrackGroupInner) {
    throw new Error('비디오 트랙 정보를 찾을 수 없습니다.');
  }

  // FrameRate는 ticks per frame
  const ticksPerFrame = Number(videoTrackGroupInner.FrameRate) || (DEFAULT_TICKS_PER_SECOND / 24);
  const fps = Math.round(DEFAULT_TICKS_PER_SECOND / ticksPerFrame);

  logger.info(`FPS: ${fps} (ticksPerFrame: ${ticksPerFrame})`);

  // 비디오 트랙 목록
  const tracks = [].concat(videoTrackGroupInner.Tracks?.Track || []);
  logger.info(`비디오 트랙 수: ${tracks.length}`);

  // 모든 트랙에서 아이템 수집
  const cuts = [];

  for (let t = 0; t < tracks.length; t++) {
    const rawTrack = tracks[t];
    const trackWrapper = resolve(rawTrack, objectMap);
    if (!trackWrapper) { logger.info(`T${t}: resolve 실패`); continue; }

    // ClipTrack resolve
    let clipTrack = trackWrapper.ClipTrack;
    if (clipTrack) {
      clipTrack = resolve(clipTrack, objectMap);
    } else {
      clipTrack = trackWrapper.ClipItems ? trackWrapper : null;
    }
    if (!clipTrack) { logger.info(`T${t}: ClipTrack 없음, keys=${Object.keys(trackWrapper)}`); continue; }

    const clipItems = clipTrack.ClipItems;
    if (!clipItems) { logger.info(`T${t}: ClipItems 없음, keys=${Object.keys(clipTrack)}`); continue; }

    const trackItemsContainer = clipItems.TrackItems;
    if (!trackItemsContainer) { logger.info(`T${t}: TrackItems 없음, ClipItems keys=${Object.keys(clipItems)}`); continue; }

    const trackItems = [].concat(trackItemsContainer.TrackItem || []);
    logger.info(`T${t}: ${trackItems.length}개 아이템`);

    // 첫 아이템 상세 진단
    if (trackItems.length > 0 && t === 0) {
      const ti0 = trackItems[0];
      logger.info(`T0[0] raw keys: ${ti0 ? Object.keys(ti0) : 'null'}`);
      const r0 = resolve(ti0, objectMap);
      logger.info(`T0[0] resolved: ${r0 ? Object.keys(r0) : 'null'}`);
      if (r0?.ClipTrackItem) {
        const cti = r0.ClipTrackItem;
        logger.info(`T0[0] CTI keys: ${Object.keys(cti)}`);
        logger.info(`T0[0] CTI.TrackItem: ${cti.TrackItem ? JSON.stringify(cti.TrackItem) : 'null'}`);
        logger.info(`T0[0] CTI.SubClip: ${cti.SubClip ? JSON.stringify(cti.SubClip).substring(0, 100) : 'null'}`);
        const sc = resolve(cti.SubClip, objectMap);
        logger.info(`T0[0] SubClip.Name: ${sc?.Name}`);
      }
    }

    for (const tiRef of trackItems) {
      const vcti = resolve(tiRef, objectMap);
      if (!vcti) continue;

      const clipTrackItem = vcti.ClipTrackItem;
      if (!clipTrackItem) continue;

      // Start/End는 ClipTrackItem.TrackItem 안에 있음 (배열일 수 있음)
      let trackItemData = clipTrackItem.TrackItem;
      if (Array.isArray(trackItemData)) trackItemData = trackItemData[0];
      const startTicks = Number(trackItemData?.Start || 0);
      const endTicks = Number(trackItemData?.End || 0);

      if (endTicks === 0) continue;

      // 이름: SubClip → resolve → Name (배열일 수 있음)
      let subClipRef = clipTrackItem.SubClip;
      if (Array.isArray(subClipRef)) subClipRef = subClipRef[0];
      const subClip = resolve(subClipRef, objectMap);
      const name = subClip?.Name || '?';

      const startFrame = Math.round(startTicks / ticksPerFrame);
      const endFrame = Math.round(endTicks / ticksPerFrame);
      const startTime = Math.round((startTicks / DEFAULT_TICKS_PER_SECOND) * 1000) / 1000;
      const endTime = Math.round((endTicks / DEFAULT_TICKS_PER_SECOND) * 1000) / 1000;

      cuts.push({ name, startFrame, endFrame, startTime, endTime });
    }
  }

  // 시작 프레임 기준 정렬
  cuts.sort((a, b) => a.startFrame - b.startFrame);

  if (cuts.length === 0) {
    throw new Error('선택한 프로젝트에 중첩 시퀀스가 없습니다.');
  }

  const lastCut = cuts[cuts.length - 1];

  const result = {
    sequenceName: seqName,
    fps,
    duration: lastCut.endTime,
    totalFrames: lastCut.endFrame,
    cuts
  };

  logger.info(`파싱 완료: ${cuts.length}개 컷 (${result.duration}초)`);
  return result;
}

module.exports = { parsePrproj, parsePrprojWithSequenceId };
