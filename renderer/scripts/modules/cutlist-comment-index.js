export function formatCutlistTimecode(seconds, fps = 24) {
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

export function getCutlistCutLabel(range = {}) {
  return range.cutLabel || range.label || range.cut?.label || '컷';
}

export function formatCutlistCommentLabel(range = {}) {
  const fps = range.fps || 24;
  const localTimecode = range.localStartTimecode || formatCutlistTimecode(range.localStartTime, fps);
  const globalTimecode = range.globalStartTimecode || formatCutlistTimecode(range.globalStartTime, fps);
  return `${getCutlistCutLabel(range)} ${localTimecode} / 전체 ${globalTimecode}`;
}

export function formatCutlistCommentPanelLine(range = {}) {
  const text = range.text || '댓글';
  return `${formatCutlistCommentLabel(range)} - ${text}`;
}

export function extractCutlistCommentRanges(options = {}) {
  const bframeData = options.bframeData || {};
  const segment = options.segment;
  const visibleLayerIds = options.visibleLayerIds;
  const allowedAuthorIds = options.allowedAuthorIds;
  if (!segment) return [];

  const segmentFps = Number(segment.fps);
  const bframeFps = Number(bframeData.fps);
  const fallbackFps = Number.isFinite(bframeFps) && bframeFps > 0 ? bframeFps : 24;
  const fps = Number.isFinite(segmentFps) && segmentFps > 0 ? segmentFps : fallbackFps;
  const sourceStartFrame = Number(segment.sourceStartFrame);
  const sourceEndFrame = Number(segment.sourceEndFrame);
  const globalStartFrame = Number(segment.globalStartFrame) || 0;
  const globalStartTime = Number(segment.globalStartTime) || 0;

  if (!Number.isFinite(sourceStartFrame) || !Number.isFinite(sourceEndFrame)) {
    return [];
  }

  const layers = Array.isArray(bframeData.comments?.layers) ? bframeData.comments.layers : [];
  const ranges = [];
  const cutLabel = getCutlistCutLabel(segment);

  for (const layer of layers) {
    if (!layer) continue;
    if (layer.visible === false) continue;
    if (visibleLayerIds && !visibleLayerIds.has(layer.id)) continue;

    const markers = Array.isArray(layer.markers) ? layer.markers : [];
    for (const marker of markers) {
      if (!marker || marker.deleted) continue;

      const authorId = marker.authorId || marker.author || 'unknown';
      if (allowedAuthorIds && !allowedAuthorIds.has(authorId)) continue;

      const markerStartFrame = Number(marker.startFrame);
      const markerEndFrame = Number(marker.endFrame);
      if (!Number.isFinite(markerStartFrame)) continue;

      const safeMarkerEndFrame = Number.isFinite(markerEndFrame)
        ? markerEndFrame
        : markerStartFrame;
      const overlapStartFrame = Math.max(markerStartFrame, sourceStartFrame);
      const overlapEndFrame = Math.min(safeMarkerEndFrame, sourceEndFrame);
      if (overlapEndFrame < overlapStartFrame) continue;

      const localStartFrame = overlapStartFrame - sourceStartFrame;
      const localEndFrame = overlapEndFrame - sourceStartFrame;
      const rangeGlobalStartFrame = globalStartFrame + localStartFrame;
      const rangeGlobalEndFrame = globalStartFrame + localEndFrame;
      const localStartTime = localStartFrame / fps;
      const localEndTime = Math.max(localStartTime, localEndFrame / fps);
      const rangeGlobalStartTime = globalStartTime + localStartTime;
      const rangeGlobalEndTime = globalStartTime + localEndTime;

      ranges.push({
        cutId: segment.cutId,
        sourceId: segment.sourceId,
        sourceVideoPath: segment.sourceVideoPath || '',
        fileName: segment.fileName || '',
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
        x: marker.x,
        y: marker.y,
        sourceStartFrame: overlapStartFrame,
        sourceEndFrame: overlapEndFrame,
        localStartFrame,
        localEndFrame,
        globalStartFrame: rangeGlobalStartFrame,
        globalEndFrame: rangeGlobalEndFrame,
        startFrame: rangeGlobalStartFrame,
        endFrame: rangeGlobalEndFrame,
        localStartTime,
        localEndTime,
        globalStartTime: rangeGlobalStartTime,
        globalEndTime: rangeGlobalEndTime,
        startTimecode: formatCutlistTimecode(localStartTime, fps),
        localStartTimecode: formatCutlistTimecode(localStartTime, fps),
        globalStartTimecode: formatCutlistTimecode(rangeGlobalStartTime, fps)
      });
    }
  }

  return ranges.sort((a, b) => a.globalStartTime - b.globalStartTime);
}

export function buildCutlistCommentContext(marker, segments = [], sourceId = '') {
  if (!marker || !Array.isArray(segments) || segments.length === 0) return null;

  const frame = Number(marker.startFrame);
  if (!Number.isFinite(frame)) return null;

  const segment = segments.find(item => {
    if (!item || item.sourceId !== sourceId) return false;
    const startFrame = Number(item.sourceStartFrame);
    const endFrame = Number(item.sourceEndFrame);
    return Number.isFinite(startFrame)
      && Number.isFinite(endFrame)
      && frame >= startFrame
      && frame <= endFrame;
  });

  if (!segment) return null;

  const fps = Math.max(1, Math.round(Number(segment.fps || marker.fps) || 24));
  const sourceStartFrame = Number(segment.sourceStartFrame) || 0;
  const globalStartFrame = Number(segment.globalStartFrame) || 0;
  const localFrame = Math.max(0, frame - sourceStartFrame);
  const globalFrame = globalStartFrame + localFrame;
  const localStartTime = localFrame / fps;
  const globalStartTime = (Number(segment.globalStartTime) || 0) + localStartTime;

  return {
    cutId: segment.cutId,
    sourceId: segment.sourceId,
    cutLabel: segment.label || segment.cut?.label || '컷',
    fps,
    markerId: marker.id,
    text: marker.text || '',
    localStartFrame: localFrame,
    globalStartFrame: globalFrame,
    localStartTime,
    globalStartTime,
    localStartTimecode: formatCutlistTimecode(localStartTime, fps),
    globalStartTimecode: formatCutlistTimecode(globalStartTime, fps)
  };
}
