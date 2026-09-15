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

function revealActiveComment(container, row) {
  const panel = container.closest('.comment-panel, .pr-history-popout') || container;
  const focused = container.ownerDocument.activeElement;
  if (panel.contains(focused) && focused.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable]:not([contenteditable="false"])')) return;
  if (!row || container.clientHeight <= 0) return;

  const viewport = container.getBoundingClientRect();
  const bounds = row.getBoundingClientRect();
  const padding = 12;
  // Move only this list. Do not scroll the whole window or steal keyboard focus.
  if (bounds.top < viewport.top || bounds.height > viewport.height) {
    container.scrollTop += bounds.top - viewport.top - padding;
  } else if (bounds.bottom > viewport.bottom) {
    container.scrollTop += bounds.bottom - viewport.bottom + padding;
  }
}

export function applyCommentPlaybackHighlight(container, keys, { autoScroll = true } = {}) {
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
  const newlyActive = [...keys].filter(key => !index.active.has(key));
  const resumed = autoScroll && index.autoScroll === false;
  let changed = false;
  for (const key of new Set([...index.active, ...keys])) {
    const active = keys.has(key);
    if (active === index.active.has(key)) continue;
    changed = true;
    for (const row of index.rows.get(key) || []) {
      row.classList.toggle('is-current-frame', active);
      row.dataset.currentFrame = String(active);
    }
  }
  index.active = new Set(keys);
  index.autoScroll = autoScroll;
  // Follow once when the active range changes, allowing manual reading within it.
  if (autoScroll && (changed || resumed)) {
    const targetKey = newlyActive[0] || keys.values().next().value;
    revealActiveComment(container, index.rows.get(targetKey)?.[0]);
  }
}
