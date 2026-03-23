/**
 * .prproj 파일의 XML 구조를 디버그하는 스크립트
 * 사용법: node debug-prproj.js "C:\경로\파일.prproj"
 */

const fs = require('fs');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');

const filePath = process.argv[2];
if (!filePath) {
  console.error('사용법: node debug-prproj.js "파일경로.prproj"');
  process.exit(1);
}

console.log(`파일: ${filePath}`);

// 1. GZip 해제
const fileBuffer = fs.readFileSync(filePath);
const decompressed = zlib.gunzipSync(fileBuffer);
const xmlString = decompressed.toString('utf-8');

console.log(`XML 크기: ${xmlString.length} bytes`);

// 2. XML 파싱
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

const xmlObj = parser.parse(xmlString);

// 3. 루트 키 출력
console.log('\n=== 루트 키 ===');
console.log(Object.keys(xmlObj));

const root = xmlObj.PremiereData || xmlObj[Object.keys(xmlObj)[0]] || xmlObj;
console.log('\n=== PremiereData (또는 루트) 키 ===');
console.log(Object.keys(root));

// 4. "Sequence" 키워드 검색
console.log('\n=== "Sequence" 포함 키 검색 (depth 3) ===');
function findKeys(obj, target, path = '', depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => findKeys(item, target, `${path}[${i}]`, depth));
    return;
  }
  for (const key of Object.keys(obj)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (key.toLowerCase().includes(target.toLowerCase())) {
      const val = obj[key];
      const type = Array.isArray(val) ? `Array(${val.length})` : typeof val;
      console.log(`  ${fullPath} → ${type}`);
    }
    if (!key.startsWith('@_')) {
      findKeys(obj[key], target, fullPath, depth + 1);
    }
  }
}
findKeys(root, 'Sequence');

// 5. "Name" 필드가 있는 객체 찾기 (시퀀스 후보)
console.log('\n=== Name + ObjectID 가진 요소 (depth 4) ===');
function findNamedObjects(obj, path = '', depth = 0, results = []) {
  if (!obj || typeof obj !== 'object' || depth > 4) return results;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => findNamedObjects(item, `${path}[${i}]`, depth, results));
    return results;
  }
  if (obj.Name !== undefined && (obj['@_ObjectID'] !== undefined || obj['@_ObjectUID'] !== undefined)) {
    results.push({
      path,
      name: obj.Name,
      objectID: obj['@_ObjectID'] || obj['@_ObjectUID'],
      keys: Object.keys(obj).filter(k => !k.startsWith('@_')).slice(0, 10)
    });
  }
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('@_')) {
      findNamedObjects(obj[key], path ? `${path}.${key}` : key, depth + 1, results);
    }
  }
  return results;
}
const namedObjects = findNamedObjects(root);
console.log(`총 ${namedObjects.length}개 발견:`);
namedObjects.forEach(o => {
  console.log(`  [${o.path}] Name="${o.name}" ID=${o.objectID} keys=[${o.keys.join(', ')}]`);
});

// 6. XML 시작 부분 (처음 3000자)
console.log('\n=== XML 시작 부분 (3000자) ===');
console.log(xmlString.substring(0, 3000));
