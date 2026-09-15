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
export function invalidateCommentPlaybackHighlight(container) {
  const index = container && indexes.get(container);
  if (!index) return;
  index.observer?.disconnect();
  clearTimeout(index.resizeTimer);
  index.resizeTimer = null;
  index.observer = null;
  index.rows = null;
}

function revealActiveComment(container, row) {
  const panel = container.closest('.comment-panel, .pr-history-popout') || container;
  if (panel.classList.contains('collapsed') || container.clientHeight <= 0 || container.clientWidth <= 0) return false;
  const focused = container.ownerDocument.activeElement;
  if (panel.contains(focused) && focused.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable]:not([contenteditable="false"])')) return true;

  const viewport = container.getBoundingClientRect();
  const bounds = row.getBoundingClientRect();
  const padding = 12;
  // Move only this list. Do not scroll the whole window or steal keyboard focus.
  if (bounds.top < viewport.top || bounds.height > viewport.height) {
    container.scrollTop += bounds.top - viewport.top - padding;
  } else if (bounds.bottom > viewport.bottom) {
    container.scrollTop += bounds.bottom - viewport.bottom + padding;
  }
  return true;
}

function cancelPendingReveal(index) {
  index.pendingKey = null;
  index.waitingForVisibility = false;
  clearTimeout(index.resizeTimer);
  index.resizeTimer = null;
  index.observer?.disconnect();
  index.observer = null;
}

function revealPendingComment(container, index, afterResize = false) {
  if (!index.pendingKey) return;
  const row = index.rows?.get(index.pendingKey)?.[0];
  if (!row) {
    cancelPendingReveal(index);
    return;
  }
  if (!index.waitingForVisibility || afterResize) {
    if (revealActiveComment(container, row)) {
      cancelPendingReveal(index);
      return;
    }
    index.waitingForVisibility = true;
  }
  // A paused playhead emits no new frame when a hidden panel returns.
  const Observer = container.ownerDocument.defaultView?.ResizeObserver;
  if (!index.observer && Observer) {
    index.observer = new Observer(() => {
      // Wait for the panel's width transition to settle before measuring rows.
      clearTimeout(index.resizeTimer);
      index.resizeTimer = setTimeout(() => {
        index.resizeTimer = null;
        revealPendingComment(container, index, true);
      }, 60);
    });
    index.observer.observe(container);
  }
}

export function applyCommentPlaybackHighlight(container, keys, { autoScroll = true } = {}) {
  if (!container) return;
  let index = indexes.get(container);
  if (!index) {
    index = { rows: null, active: new Set(), pendingKey: null, observer: null, resizeTimer: null, waitingForVisibility: false };
    indexes.set(container, index);
  }
  if (!index.rows) {
    index.rows = new Map();
    index.active = new Set();
    for (const row of container.querySelectorAll('[data-playback-comment-key]')) {
      const key = row.dataset.playbackCommentKey;
      if (!index.rows.has(key)) index.rows.set(key, []);
      index.rows.get(key).push(row);
      if (row.classList.contains('is-current-frame')) index.active.add(key);
    }
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
    index.pendingKey = newlyActive[0] || keys.values().next().value;
  }
  if (!autoScroll || !keys.size) cancelPendingReveal(index);
  else revealPendingComment(container, index);
}
