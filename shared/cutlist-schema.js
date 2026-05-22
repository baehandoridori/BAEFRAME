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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnField(value, fieldName) {
  return Object.prototype.hasOwnProperty.call(value, fieldName);
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
  if (!data.createdAt || typeof data.createdAt !== 'string') errors.push('createdAt 필드가 유효하지 않습니다.');
  if (!data.modifiedAt || typeof data.modifiedAt !== 'string') errors.push('modifiedAt 필드가 유효하지 않습니다.');
  if (!hasOwnField(data, 'createdBy') || typeof data.createdBy !== 'string') errors.push('createdBy 필드가 유효하지 않습니다.');
  if (!hasOwnField(data, 'createdById') || typeof data.createdById !== 'string') errors.push('createdById 필드가 유효하지 않습니다.');
  if (!Array.isArray(data.sources)) errors.push('sources 필드가 배열이 아닙니다.');
  if (!Array.isArray(data.cuts)) errors.push('cuts 필드가 배열이 아닙니다.');
  if (!isPlainObject(data.settings)) {
    errors.push('settings 필드가 객체가 아닙니다.');
  } else {
    if (typeof data.settings.showMissingScenes !== 'boolean') errors.push('settings.showMissingScenes 필드가 boolean이 아닙니다.');
    if (typeof data.settings.manualOrder !== 'boolean') errors.push('settings.manualOrder 필드가 boolean이 아닙니다.');
  }
  if (!isPlainObject(data.future)) errors.push('future 필드가 객체가 아닙니다.');

  (data.sources || []).forEach((source, index) => {
    if (!source.id) errors.push(`sources[${index}]: id 필드가 없습니다.`);
    if (!source.videoPath) errors.push(`sources[${index}]: videoPath 필드가 없습니다.`);
    if (!source.infoPath) errors.push(`sources[${index}]: infoPath 필드가 없습니다.`);
    if (!hasOwnField(source, 'infoText') || typeof source.infoText !== 'string') errors.push(`sources[${index}]: infoText 필드가 유효하지 않습니다.`);
    if (!source.fileName || typeof source.fileName !== 'string') errors.push(`sources[${index}]: fileName 필드가 유효하지 않습니다.`);
    if (!Number.isFinite(Number(source.fps)) || Number(source.fps) <= 0) errors.push(`sources[${index}]: fps가 유효하지 않습니다.`);
    if (typeof source.missing !== 'boolean') errors.push(`sources[${index}]: missing 필드는 boolean이어야 합니다.`);
    if (!source.addedAt || typeof source.addedAt !== 'string') errors.push(`sources[${index}]: addedAt 필드가 유효하지 않습니다.`);
  });

  (data.cuts || []).forEach((cut, index) => {
    if (!cut.id) errors.push(`cuts[${index}]: id 필드가 없습니다.`);
    if (!cut.sourceId) errors.push(`cuts[${index}]: sourceId 필드가 없습니다.`);
    if (!Number.isFinite(Number(cut.sceneNumber))) errors.push(`cuts[${index}]: sceneNumber가 유효하지 않습니다.`);
    if (!cut.label) errors.push(`cuts[${index}]: label 필드가 없습니다.`);
    if (!Number.isFinite(Number(cut.startFrame))) errors.push(`cuts[${index}]: startFrame이 유효하지 않습니다.`);
    if (!Number.isFinite(Number(cut.endFrame))) errors.push(`cuts[${index}]: endFrame이 유효하지 않습니다.`);
    if (Number(cut.endFrame) < Number(cut.startFrame)) errors.push(`cuts[${index}]: endFrame은 startFrame보다 작을 수 없습니다.`);
    if (!Number.isFinite(Number(cut.mohoStartFrame))) errors.push(`cuts[${index}]: mohoStartFrame이 유효하지 않습니다.`);
    if (!Number.isFinite(Number(cut.mohoEndFrame))) errors.push(`cuts[${index}]: mohoEndFrame이 유효하지 않습니다.`);
    if (Number(cut.mohoEndFrame) < Number(cut.mohoStartFrame)) errors.push(`cuts[${index}]: mohoEndFrame은 mohoStartFrame보다 작을 수 없습니다.`);
    if (!Number.isFinite(Number(cut.fps)) || Number(cut.fps) <= 0) errors.push(`cuts[${index}]: fps가 유효하지 않습니다.`);
    if (!Number.isFinite(Number(cut.order))) errors.push(`cuts[${index}]: order가 유효하지 않습니다.`);
    if (!hasOwnField(cut, 'ignored') || typeof cut.ignored !== 'boolean') errors.push(`cuts[${index}]: ignored 필드는 boolean이어야 합니다.`);
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
