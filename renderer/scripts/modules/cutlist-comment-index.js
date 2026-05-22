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
