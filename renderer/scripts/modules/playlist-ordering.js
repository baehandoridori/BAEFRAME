export const PLAYLIST_SORT_MODES = Object.freeze({
  FILE_NAME: 'fileName',
  ADDED_AT: 'addedAt',
  MODIFIED_AT: 'modifiedAt'
});

export const DEFAULT_CONTINUOUS_SETTINGS = Object.freeze({
  loop: false,
  sortMode: PLAYLIST_SORT_MODES.FILE_NAME,
  manualOrder: false
});

const collator = new Intl.Collator('ko-KR', {
  numeric: true,
  sensitivity: 'base'
});

export function naturalCompare(a, b) {
  return collator.compare(String(a || ''), String(b || ''));
}

export function normalizePlaylistSettings(playlist) {
  const current = playlist?.settings && typeof playlist.settings === 'object'
    ? playlist.settings
    : {};
  const currentContinuous = current.continuous && typeof current.continuous === 'object'
    ? current.continuous
    : {};

  return {
    autoPlay: current.autoPlay === true,
    floatingMode: current.floatingMode === true,
    continuous: {
      loop: currentContinuous.loop === true,
      sortMode: Object.values(PLAYLIST_SORT_MODES).includes(currentContinuous.sortMode)
        ? currentContinuous.sortMode
        : DEFAULT_CONTINUOUS_SETTINGS.sortMode,
      manualOrder: currentContinuous.manualOrder === true
    }
  };
}

export function normalizeItemOrders(items) {
  return [...(items || [])]
    .sort((a, b) => {
      const orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return naturalCompare(a.fileName, b.fileName);
    })
    .map((item, index) => ({ ...item, order: index }));
}

export function sortPlaylistItems(items, sortMode = PLAYLIST_SORT_MODES.FILE_NAME) {
  const indexed = [...(items || [])].map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    let result = 0;
    if (sortMode === PLAYLIST_SORT_MODES.ADDED_AT) {
      result = String(a.item.addedAt || '').localeCompare(String(b.item.addedAt || ''));
    } else if (sortMode === PLAYLIST_SORT_MODES.MODIFIED_AT) {
      const aTime = Number.isFinite(a.item.modifiedAtMs) ? a.item.modifiedAtMs : 0;
      const bTime = Number.isFinite(b.item.modifiedAtMs) ? b.item.modifiedAtMs : 0;
      result = bTime - aTime;
    } else {
      result = naturalCompare(a.item.fileName, b.item.fileName);
    }
    return result || a.index - b.index;
  });
  return indexed.map(({ item }, index) => ({ ...item, order: index }));
}

export function appendSortedNewItems(existingItems, newItems) {
  const existing = normalizeItemOrders(existingItems || []);
  const sortedNew = sortPlaylistItems(newItems || [], PLAYLIST_SORT_MODES.FILE_NAME);
  return [...existing, ...sortedNew].map((item, index) => ({ ...item, order: index }));
}
