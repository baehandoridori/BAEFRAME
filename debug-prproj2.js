const fs = require('fs');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');

const filePath = process.argv[2];
const xmlString = zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf-8');
const root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xmlString).PremiereData;

const objectMap = new Map();
for (const key of Object.keys(root)) {
  for (const el of [].concat(root[key] || [])) {
    if (el && typeof el === 'object') {
      if (el['@_ObjectID'] !== undefined) objectMap.set(String(el['@_ObjectID']), el);
      if (el['@_ObjectUID'] !== undefined) objectMap.set(String(el['@_ObjectUID']), el);
    }
  }
}

function resolve(obj) {
  if (!obj) return null;
  for (const k of ['@_ObjectRef', '@_ObjectURef']) {
    if (obj[k] !== undefined) return objectMap.get(String(obj[k])) || null;
  }
  return obj;
}

// ClipTrackItem.TrackItem 구조 분석
const vcti = [].concat(root.VideoClipTrackItem || [])[0];
const cti = vcti?.ClipTrackItem;
const ti = cti?.TrackItem;
console.log('=== ClipTrackItem.TrackItem ===');
console.log('키:', ti ? Object.keys(ti).filter(k => !k.startsWith('@_')).join(', ') : 'null');
console.log('Start:', ti?.Start);
console.log('End:', ti?.End);
console.log('InPoint:', ti?.InPoint);
console.log('OutPoint:', ti?.OutPoint);

// 전체 구조 덤프 (첫 번째 아이템)
console.log('\n전체 JSON (depth 제한):');
function safeStringify(obj, depth = 0) {
  if (depth > 2 || !obj) return String(obj);
  if (typeof obj !== 'object') return String(obj);
  if (obj['@_ObjectRef']) return `Ref(${obj['@_ObjectRef']})`;
  const keys = Object.keys(obj).filter(k => !k.startsWith('@_'));
  const parts = keys.map(k => `${k}: ${safeStringify(obj[k], depth + 1)}`);
  return `{ ${parts.join(', ')} }`;
}
console.log(safeStringify(ti));

// V1 첫 5개 - TrackItem 안의 Start/End 탐색
console.log('\n=== V1 첫 5개 (TrackItem 레벨) ===');
const reel = [].concat(root.Sequence).find(s => s.Name?.includes('릴'));
const vtgOuter = resolve([].concat(reel.TrackGroups?.TrackGroup || [])[0]?.Second);
const v1Wrapper = resolve([].concat(vtgOuter?.TrackGroup?.Tracks?.Track || [])[0]);
const v1ClipTrack = resolve(v1Wrapper?.ClipTrack);
const v1Items = [].concat(v1ClipTrack?.ClipItems?.TrackItems?.TrackItem || []);

for (let i = 0; i < Math.min(5, v1Items.length); i++) {
  const vctiObj = resolve(v1Items[i]);
  if (!vctiObj) continue;
  const inner = vctiObj.ClipTrackItem;
  if (!inner) continue;

  const trackItem = inner.TrackItem;
  const sc = resolve(inner.SubClip);
  const name = sc?.Name || '?';

  console.log(`[${i}] "${name}"`);
  if (trackItem) {
    console.log(`     TrackItem 키: ${Object.keys(trackItem).filter(k=>!k.startsWith('@_')).join(', ')}`);
    console.log(`     Start=${trackItem.Start} End=${trackItem.End}`);
  }
}
