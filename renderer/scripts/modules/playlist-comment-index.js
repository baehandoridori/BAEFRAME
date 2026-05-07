export function extractPlaylistCommentRanges(options) {
  const bframeData = options.bframeData || {};
  const segment = options.segment;
  const visibleLayerIds = options.visibleLayerIds;
  const allowedAuthorIds = options.allowedAuthorIds;
  if (!segment) return [];

  const fps = Number(bframeData.fps) || Number(segment.fps) || 24;
  const layers = Array.isArray(bframeData.comments?.layers) ? bframeData.comments.layers : [];
  const ranges = [];

  for (const layer of layers) {
    if (!layer) continue;
    if (layer.visible === false) continue;
    if (visibleLayerIds && !visibleLayerIds.has(layer.id)) continue;
    const markers = Array.isArray(layer.markers) ? layer.markers : [];

    for (const marker of markers) {
      if (!marker || marker.deleted) continue;
      const authorId = marker.authorId || marker.author || 'unknown';
      if (allowedAuthorIds && !allowedAuthorIds.has(authorId)) continue;

      const startTime = (Number(marker.startFrame) || 0) / fps;
      const endTime = Math.max(startTime, (Number(marker.endFrame) || Number(marker.startFrame) || 0) / fps);
      ranges.push({
        itemId: segment.itemId,
        itemIndex: segment.index,
        fileName: segment.fileName,
        layerId: layer.id,
        markerId: marker.id,
        text: marker.text || '',
        resolved: marker.resolved === true,
        color: marker.colorInfo?.color || layer.color || '#ffcc00',
        colorKey: marker.colorInfo?.key || marker.colorKey || 'default',
        localStartTime: startTime,
        localEndTime: endTime,
        globalStartTime: segment.startTime + startTime,
        globalEndTime: segment.startTime + endTime,
        localStartFrame: Number(marker.startFrame) || 0
      });
    }
  }

  return ranges.sort((a, b) => a.globalStartTime - b.globalStartTime);
}
