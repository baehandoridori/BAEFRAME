/** Independent snapshots of previous reviews. Never writes to source comments. */
export const REVIEW_CARRYOVER_ROOT_KEY = 'reviewCarryoverV1';
export const REVIEW_CARRYOVER_STATUSES = Object.freeze(['pending', 'verified', 'needs-fix']);

export function cloneReviewCarryover(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function normalizeReviewSourcePath(path) {
  return typeof path === 'string' ? path.replace(/\\/g, '/').toLowerCase() : '';
}

export function reviewSourceKey(path, commentId) {
  return JSON.stringify([normalizeReviewSourcePath(path), String(commentId)]);
}

export function isSafeReviewImage(value) {
  return typeof value === 'string' &&
    /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif);base64,[a-z0-9+/]+={0,2}$/i.test(value);
}

function imagesOf(value) {
  return [...new Set([value?.image, ...(Array.isArray(value?.images) ? value.images : [])]
    .filter(isSafeReviewImage))];
}

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const text = value => typeof value === 'string' ? value : '';

export function createPreviousReviewSources(reviewData, versionInfo) {
  if (!versionInfo?.path || typeof versionInfo.path !== 'string') return [];
  const comments = reviewData?.comments;
  const markers = Array.isArray(comments) ? comments :
    (Array.isArray(comments?.layers) ? comments.layers : [])
      .filter(layer => layer && !layer.deleted)
      .flatMap(layer => Array.isArray(layer.markers) ? layer.markers : []);
  const result = new Map();
  for (const marker of markers) {
    if (!marker || marker.deleted || (typeof marker.id !== 'string' && typeof marker.id !== 'number')) continue;
    if (String(marker.id).length === 0) continue;
    const sourcePath = versionInfo.path;
    const key = reviewSourceKey(sourcePath, marker.id);
    if (result.has(key)) continue;
    const frame = marker.startFrame ?? marker.frame;
    result.set(key, {
      key, sourcePath,
      sourceLabel: text(versionInfo.displayLabel) || text(versionInfo.fileName) ||
        (versionInfo.version !== null && versionInfo.version !== undefined ? `V${versionInfo.version}` : sourcePath.split(/[\\/]/).pop()),
      sourceDocumentId: text(reviewData?.reviewDocumentId),
      commentId: String(marker.id), author: text(marker.author), authorId: text(marker.authorId), text: text(marker.text ?? marker.content),
      startFrame: typeof frame === 'number' && Number.isFinite(frame) && frame >= 0 ? frame : null,
      fps: positive(marker.fps) ? marker.fps : positive(reviewData?.fps) ? reviewData.fps : 24,
      resolved: marker.resolved === true, images: imagesOf(marker),
      replies: (Array.isArray(marker.replies) ? marker.replies : [])
        .filter(reply => reply && !reply.deleted)
        .map(reply => ({ id: String(reply.id ?? ''), author: text(reply.author), text: text(reply.text ?? reply.content), images: imagesOf(reply) }))
    });
  }
  return [...result.values()];
}

export function isValidReviewSource(source) {
  return source && typeof source === 'object' && !Array.isArray(source) &&
    typeof source.sourcePath === 'string' && source.sourcePath.length > 0 &&
    typeof source.commentId === 'string' && source.commentId.length > 0 &&
    source.key === reviewSourceKey(source.sourcePath, source.commentId) &&
    ['sourceLabel', 'sourceDocumentId', 'author', 'text'].every(key => typeof source[key] === 'string') &&
    (source.startFrame === null || (typeof source.startFrame === 'number' && Number.isFinite(source.startFrame) && source.startFrame >= 0)) &&
    positive(source.fps) && typeof source.resolved === 'boolean' &&
    Array.isArray(source.images) && source.images.every(isSafeReviewImage) &&
    Array.isArray(source.replies) && source.replies.every(reply => reply &&
      ['id', 'author', 'text'].every(key => typeof reply[key] === 'string') &&
      Array.isArray(reply.images) && reply.images.every(isSafeReviewImage));
}

/** Unknown/invalid values are opaque, not partially salvaged or silently truncated. */
export function isSupportedReviewCarryover(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.items)) return false;
  return value.items.every(item => item && typeof item === 'object' &&
    isValidReviewSource(item.source) && item.id === item.source.key &&
    REVIEW_CARRYOVER_STATUSES.includes(item.status) && typeof item.deleted === 'boolean' &&
    typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt)) &&
    typeof item.updatedBy === 'string' &&
    (item.generation === undefined || (Number.isSafeInteger(item.generation) && item.generation >= 0)));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const serialized = value => JSON.stringify(canonical(value));
const equal = (a, b) => serialized(a) === serialized(b);

function resolveItem(base, local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  // Only an explicit re-carry increments generation. Wall clocks alone cannot
  // distinguish restoring a cancelled item from receiving an old file copy.
  const localGeneration = local.generation || 0;
  const remoteGeneration = remote.generation || 0;
  if (localGeneration !== remoteGeneration) return localGeneration > remoteGeneration ? local : remote;
  if (local.deleted !== remote.deleted) return local.deleted ? local : remote;
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  const delta = Date.parse(local.updatedAt) - Date.parse(remote.updatedAt);
  if (delta) return delta > 0 ? local : remote;
  return serialized(local) >= serialized(remote) ? local : remote;
}

export function mergeReviewCarryover(base, local, remote) {
  const supported = value => value === undefined || isSupportedReviewCarryover(value);
  if (![base, local, remote].every(supported)) {
    // A missing field in an old writer is not a request to erase this feature.
    if (remote === undefined) return cloneReviewCarryover(local === undefined ? base : local);
    if (local === undefined) return cloneReviewCarryover(remote);
    if (equal(local, remote) || equal(remote, base)) return cloneReviewCarryover(local);
    if (equal(local, base)) return cloneReviewCarryover(remote);
    throw new Error('reviewCarryoverV1 형식을 해석할 수 없어 충돌 병합을 중단했습니다.');
  }
  if (base === undefined && local === undefined && remote === undefined) return undefined;
  const makeMap = value => {
    const map = new Map();
    for (const item of value?.items || []) map.set(item.id, resolveItem(undefined, map.get(item.id), item));
    return map;
  };
  const b = makeMap(base); const l = makeMap(local); const r = makeMap(remote);
  const ids = [...new Set([...b.keys(), ...l.keys(), ...r.keys()])].sort();
  const items = ids.map(id => {
    // Preserve tombstones even if an older writer removes the optional field.
    return resolveItem(b.get(id), l.get(id) || b.get(id), r.get(id) || b.get(id));
  }).filter(Boolean);
  // Preserve extension metadata without treating it as comment content.
  const metadata = Object.create(null);
  for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})])) {
    if (key === 'version' || key === 'items') continue;
    const bv = base?.[key]; const lv = local?.[key]; const rv = remote?.[key];
    metadata[key] = equal(lv, bv) ? rv : equal(rv, bv) ? lv :
      (serialized(lv) ?? '') >= (serialized(rv) ?? '') ? lv : rv;
  }
  return cloneReviewCarryover({ ...metadata, version: 1, items });
}
