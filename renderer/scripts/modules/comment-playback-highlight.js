const indexes = new WeakMap();
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function getActiveCommentKeys(ranges, { mode, currentFrame, globalTime, currentItemId }) {
  const keys = new Set();
  for (const range of ranges) {
    if (!range.key || range.timingValid === false || range.deleted) continue;
    const local = mode === 'single' || range.mode === 'single';
    if (!local && mode === 'continuous' && range.itemId !== currentItemId) continue;
    const start = local ? range.startFrame : range.globalStartTime;
    const end = (local ? range.endFrame : range.globalEndTime) ?? start;
    const position = local ? currentFrame : globalTime;
    if (valid(start) && valid(end) && valid(position) && position >= start && position <= end) keys.add(range.key);
  }
  return keys;
}
export function invalidateCommentPlaybackHighlight(container) { if (container) indexes.delete(container); }
export function applyCommentPlaybackHighlight(container, keys) {
  if (!container) return;
  let index = indexes.get(container);
  if (!index) {
    index = { rows: new Map(), active: new Set() };
    for (const row of container.querySelectorAll('[data-playback-comment-key]')) {
      const key = row.dataset.playbackCommentKey;
      if (!index.rows.has(key)) index.rows.set(key, []);
      index.rows.get(key).push(row);
      if (row.classList.contains('is-current-frame')) index.active.add(key);
    }
    indexes.set(container, index);
  }
  for (const key of new Set([...index.active, ...keys])) {
    const active = keys.has(key);
    if (active === index.active.has(key)) continue;
    for (const row of index.rows.get(key) || []) {
      row.classList.toggle('is-current-frame', active);
      row.dataset.currentFrame = String(active);
    }
  }
  index.active = new Set(keys);
}
