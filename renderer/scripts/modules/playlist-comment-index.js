export function formatPlaylistTimecode(seconds, fps = 24) {
  const safeFps = Math.max(1, Math.round(Number(fps) || 24));
  const totalFrames = Math.max(0, Math.round((Number(seconds) || 0) * safeFps));
  const frame = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const second = totalSeconds % 60;
  const minute = Math.floor((totalSeconds % 3600) / 60);
  const hour = Math.floor(totalSeconds / 3600);

  return [
    String(hour).padStart(2, '0'),
    String(minute).padStart(2, '0'),
    String(second).padStart(2, '0'),
    String(frame).padStart(2, '0')
  ].join(':');
}

export function getPlaylistCutLabel(rangeOrSegment = {}) {
  if (rangeOrSegment.cutLabel) return rangeOrSegment.cutLabel;

  const fileName = rangeOrSegment.fileName || '';
  const baseName = fileName.split(/[\\/]/).pop() || '';
  const dotIndex = baseName.lastIndexOf('.');
  if (dotIndex > 0) return baseName.slice(0, dotIndex);
  if (baseName) return baseName;

  const index = Number(rangeOrSegment.itemIndex ?? rangeOrSegment.index);
  if (Number.isFinite(index) && index >= 0) {
    return `a${String(index + 1).padStart(3, '0')}`;
  }

  return '컷';
}

export function formatPlaylistCommentLabel(range = {}) {
  const fps = range.fps || 24;
  const localTimecode = range.localStartTimecode || formatPlaylistTimecode(range.localStartTime, fps);
  return `${getPlaylistCutLabel(range)} ${localTimecode}`;
}

export function formatPlaylistCommentPanelLine(range = {}) {
  const text = range.text || '댓글';
  return `${formatPlaylistCommentLabel(range)} - ${text}`;
}

export function formatPlaylistCommentTitle(range = {}) {
  const fps = range.fps || 24;
  const localTimecode = range.localStartTimecode || formatPlaylistTimecode(range.localStartTime, fps);
  const globalTimecode = range.globalStartTimecode || formatPlaylistTimecode(range.globalStartTime, fps);
  return `${getPlaylistCutLabel(range)} 컷 ${localTimecode} / 전체 ${globalTimecode} - ${range.text || '댓글'}`;
}

export function getPlaylistAggregateCommentKey(range = {}) {
  return `${range.itemId || ''}:${range.layerId || ''}:${range.markerId || ''}`;
}

export function extractPlaylistCommentRanges(options) {
  const bframeData = options.bframeData || {};
  const segment = options.segment;
  const visibleLayerIds = options.visibleLayerIds;
  const allowedAuthorIds = options.allowedAuthorIds;
  if (!segment) return [];

  const segmentFps = Number(segment.fps);
  const bframeFps = Number(bframeData.fps);
  const fallbackFps = Number.isFinite(bframeFps) && bframeFps > 0 ? bframeFps : 24;
  const layers = Array.isArray(bframeData.comments?.layers) ? bframeData.comments.layers : [];
  const ranges = [];
  const cutLabel = getPlaylistCutLabel(segment);

  for (const layer of layers) {
    if (!layer) continue;
    if (layer.visible === false) continue;
    if (visibleLayerIds && !visibleLayerIds.has(layer.id)) continue;
    const markers = Array.isArray(layer.markers) ? layer.markers : [];

    for (const marker of markers) {
      if (!marker || marker.deleted) continue;
      const authorId = marker.authorId || marker.author || 'unknown';
      if (allowedAuthorIds && !allowedAuthorIds.has(authorId)) continue;

      const markerFps = Number(marker.fps);
      const fps = Number.isFinite(segmentFps) && segmentFps > 0
        ? segmentFps
        : (Number.isFinite(markerFps) && markerFps > 0 ? markerFps : fallbackFps);
      const startFrame = Number(marker.startFrame) || 0;
      const endFrame = Number(marker.endFrame) || startFrame;
      const rawStartTime = startFrame / fps;
      const rawEndTime = Math.max(rawStartTime, endFrame / fps);
      const segmentDuration = Number(segment.duration);
      const maxLocalTime = Number.isFinite(segmentDuration) && segmentDuration > 0
        ? segmentDuration
        : Infinity;
      if (rawStartTime > maxLocalTime) continue;
      const startTime = Math.max(0, Math.min(rawStartTime, maxLocalTime));
      const endTime = Math.max(startTime, Math.min(rawEndTime, maxLocalTime));
      const globalStartTime = segment.startTime + startTime;
      const globalEndTime = segment.startTime + endTime;
      const localStartFrame = Math.round(startTime * fps);
      const localEndFrame = Math.round(endTime * fps);
      ranges.push({
        itemId: segment.itemId,
        itemIndex: segment.index,
        fileName: segment.fileName,
        cutLabel,
        fps,
        layerId: layer.id,
        markerId: marker.id,
        text: marker.text || '',
        author: marker.author || marker.authorName || authorId || '알 수 없음',
        authorId,
        createdAt: marker.createdAt || marker.updatedAt || null,
        replies: Array.isArray(marker.replies) ? marker.replies : [],
        image: marker.image || null,
        resolved: marker.resolved === true,
        resolvedBy: marker.resolvedBy || '',
        resolvedAt: marker.resolvedAt || null,
        color: marker.colorInfo?.color || layer.color || '#ffcc00',
        colorKey: marker.colorInfo?.key || marker.colorKey || 'default',
        localStartTime: startTime,
        localEndTime: endTime,
        globalStartTime,
        globalEndTime,
        localStartFrame,
        localEndFrame,
        startFrame: localStartFrame,
        endFrame: localEndFrame,
        startTimecode: formatPlaylistTimecode(startTime, fps),
        localStartTimecode: formatPlaylistTimecode(startTime, fps),
        globalStartTimecode: formatPlaylistTimecode(globalStartTime, fps)
      });
    }
  }

  return ranges.sort((a, b) => a.globalStartTime - b.globalStartTime);
}
