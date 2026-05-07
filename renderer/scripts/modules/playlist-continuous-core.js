export const CONTINUOUS_STATUS = Object.freeze({
  IDLE: 'idle',
  CHECKING: 'checking',
  PREPARING: 'preparing',
  READY: 'ready',
  SKIPPED: 'skipped',
  MISSING: 'missing',
  ERROR: 'error'
});

export function buildPlaylistSegments(items, metadataByItemId) {
  const segments = [];
  let cursor = 0;

  (items || []).forEach((item, index) => {
    const metadata = metadataByItemId.get(item.id) || {};
    const duration = Math.max(0, Number(metadata.duration) || Number(item.duration) || 0);
    const fps = Number(metadata.fps) || Number(item.fps) || 24;
    const segment = {
      itemId: item.id,
      index,
      fileName: item.fileName,
      startTime: cursor,
      endTime: cursor + duration,
      duration,
      fps
    };
    segments.push(segment);
    cursor += duration;
  });

  return {
    segments,
    totalDuration: cursor
  };
}

export function mapGlobalTimeToSegment(segments, globalTime) {
  if (!segments || segments.length === 0) return null;
  const time = Math.max(0, Number(globalTime) || 0);
  const segment = segments.find(s => time >= s.startTime && time < s.endTime) || segments[segments.length - 1];
  return {
    segment,
    localTime: Math.max(0, Math.min(segment.duration, time - segment.startTime))
  };
}

export function mapLocalTimeToGlobal(segment, localTime) {
  if (!segment) return 0;
  return segment.startTime + Math.max(0, Number(localTime) || 0);
}

function isPlayable(item) {
  return item && ![
    CONTINUOUS_STATUS.SKIPPED,
    CONTINUOUS_STATUS.MISSING,
    CONTINUOUS_STATUS.ERROR
  ].includes(item.continuousStatus);
}

export function findNextPlayableIndex(items, currentIndex, options = {}) {
  const list = items || [];
  if (list.length === 0) return -1;

  for (let offset = 1; offset <= list.length; offset++) {
    const index = currentIndex + offset;
    if (index < list.length && isPlayable(list[index])) return index;
    if (index >= list.length && options.loop === true) {
      const wrappedIndex = index % list.length;
      if (wrappedIndex === currentIndex) return -1;
      if (isPlayable(list[wrappedIndex])) return wrappedIndex;
    }
  }

  return -1;
}

export function createSkippedToastMessage(items) {
  const count = (items || []).length;
  if (count <= 0) return '';
  if (count === 1) return `"${items[0].fileName}" 영상을 건너뜀`;
  return `${count}개 영상을 건너뜀`;
}
