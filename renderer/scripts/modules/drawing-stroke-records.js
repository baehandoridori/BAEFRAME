export const ERASER_MODES = Object.freeze({
  PIXEL: 'pixel',
  STROKE: 'stroke'
});

const RECORDABLE_TOOLS = new Set(['pen', 'brush']);
let nextStrokeId = 1;

export function normalizeEraserMode(mode) {
  return mode === ERASER_MODES.STROKE ? ERASER_MODES.STROKE : ERASER_MODES.PIXEL;
}

export function isRecordableStrokeTool(tool) {
  return RECORDABLE_TOOLS.has(tool);
}

export function normalizeStrokeRecords(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter(record => record && isRecordableStrokeTool(record.tool) && Array.isArray(record.points))
    .map(record => ({
      id: record.id || `stroke-${nextStrokeId++}`,
      tool: record.tool,
      points: record.points.map(point => ({
        x: Number(point.x) || 0,
        y: Number(point.y) || 0
      })),
      color: record.color || '#ff4757',
      lineWidth: Math.max(1, Number(record.lineWidth) || 1),
      opacity: Number.isFinite(Number(record.opacity)) ? Number(record.opacity) : 1,
      strokeEnabled: record.strokeEnabled === true,
      strokeWidth: Math.max(0, Number(record.strokeWidth) || 0),
      strokeColor: record.strokeColor || '#ffffff'
    }));
}

export function createStrokeRecord(options = {}) {
  const points = Array.isArray(options.points)
    ? options.points.map(point => ({
      x: Number(point.x) || 0,
      y: Number(point.y) || 0
    }))
    : [];

  return {
    id: options.id || `stroke-${Date.now()}-${nextStrokeId++}`,
    tool: isRecordableStrokeTool(options.tool) ? options.tool : 'pen',
    points,
    color: options.color || '#ff4757',
    lineWidth: Math.max(1, Number(options.lineWidth) || 1),
    opacity: Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : 1,
    strokeEnabled: options.strokeEnabled === true,
    strokeWidth: Math.max(0, Number(options.strokeWidth) || 0),
    strokeColor: options.strokeColor || '#ffffff'
  };
}

function distanceBetweenPoints(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distanceBetweenPoints(point, a);

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return distanceBetweenPoints(point, {
    x: a.x + t * dx,
    y: a.y + t * dy
  });
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.000001) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    b.x <= Math.max(a.x, c.x) &&
    b.x >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) &&
    b.y >= Math.min(a.y, c.y)
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function distanceSegmentToSegment(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distancePointToSegment(a, c, d),
    distancePointToSegment(b, c, d),
    distancePointToSegment(c, a, b),
    distancePointToSegment(d, a, b)
  );
}

function pathSegments(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length === 1) return [[points[0], points[0]]];
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    segments.push([points[i - 1], points[i]]);
  }
  return segments;
}

export function strokeIntersectsEraserPath(stroke, eraserPath, eraserSize) {
  const strokePoints = Array.isArray(stroke?.points) ? stroke.points : [];
  const erasePoints = Array.isArray(eraserPath) ? eraserPath : [];
  if (strokePoints.length === 0 || erasePoints.length === 0) return false;

  const threshold = Math.max(1, Number(eraserSize) || 1) / 2 + (Math.max(1, Number(stroke.lineWidth) || 1) / 2);
  const strokeSegments = pathSegments(strokePoints);
  const eraseSegments = pathSegments(erasePoints);

  for (const [a, b] of strokeSegments) {
    for (const [c, d] of eraseSegments) {
      if (distanceSegmentToSegment(a, b, c, d) <= threshold) {
        return true;
      }
    }
  }
  return false;
}

export function removeIntersectingStrokes(strokes, eraserPath, eraserSize) {
  const remaining = [];
  const removed = [];

  for (const stroke of normalizeStrokeRecords(strokes)) {
    if (strokeIntersectsEraserPath(stroke, eraserPath, eraserSize)) {
      removed.push(stroke);
    } else {
      remaining.push(stroke);
    }
  }

  return { remaining, removed };
}
