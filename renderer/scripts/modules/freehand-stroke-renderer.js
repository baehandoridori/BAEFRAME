import { getStroke } from '../lib/perfect-freehand.js';

const DEFAULT_COLOR = '#ff4757';

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];

  return points
    .map(point => ({
      x: toFiniteNumber(point?.x),
      y: toFiniteNumber(point?.y),
      pressure: Math.max(0, Math.min(1, toFiniteNumber(point?.pressure, 0.5)))
    }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function getFreehandOptions({ tool, size, last }) {
  const isBrush = tool === 'brush';

  return {
    size,
    thinning: isBrush ? 0.22 : 0.5,
    smoothing: isBrush ? 0.68 : 0.56,
    streamline: isBrush ? 0.42 : 0.48,
    simulatePressure: true,
    last,
    start: {
      cap: true,
      taper: 0
    },
    end: {
      cap: true,
      taper: 0
    }
  };
}

function drawPoint(ctx, point, size) {
  const radius = Math.max(0.5, size / 2);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawOutline(ctx, outlinePoints) {
  if (!Array.isArray(outlinePoints) || outlinePoints.length < 2) return false;

  ctx.beginPath();
  ctx.moveTo(outlinePoints[0][0], outlinePoints[0][1]);

  if (outlinePoints.length < 4) {
    for (let i = 1; i < outlinePoints.length; i++) {
      ctx.lineTo(outlinePoints[i][0], outlinePoints[i][1]);
    }
  } else {
    for (let i = 1; i < outlinePoints.length - 1; i++) {
      const current = outlinePoints[i];
      const next = outlinePoints[i + 1];
      ctx.quadraticCurveTo(
        current[0],
        current[1],
        (current[0] + next[0]) / 2,
        (current[1] + next[1]) / 2
      );
    }
  }

  ctx.closePath();
  ctx.fill();
  return true;
}

function drawSingleStroke(ctx, points, { color, lineWidth, tool, last }) {
  const size = Math.max(1, toFiniteNumber(lineWidth, 1));
  ctx.fillStyle = color || DEFAULT_COLOR;

  if (points.length === 1) {
    drawPoint(ctx, points[0], size);
    return true;
  }

  const inputPoints = points.map(point => [point.x, point.y, point.pressure]);
  const outlinePoints = getStroke(inputPoints, getFreehandOptions({ tool, size, last }));
  return drawOutline(ctx, outlinePoints);
}

function drawFallbackPath(ctx, points, { color, lineWidth }) {
  if (points.length === 0) return false;

  const width = Math.max(1, toFiniteNumber(lineWidth, 1));
  ctx.strokeStyle = color || DEFAULT_COLOR;
  ctx.fillStyle = color || DEFAULT_COLOR;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    drawPoint(ctx, points[0], width);
    return true;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  return true;
}

export function drawFreehandStroke(ctx, points, options = {}) {
  const normalizedPoints = normalizePoints(points);
  if (!ctx || normalizedPoints.length === 0) return false;

  const lineWidth = Math.max(1, toFiniteNumber(options.lineWidth, 1));
  const opacity = Math.max(0, Math.min(1, toFiniteNumber(options.opacity, 1)));
  const strokeWidth = Math.max(0, toFiniteNumber(options.strokeWidth, 0));
  const strokeEnabled = options.strokeEnabled === true && strokeWidth > 0;
  const last = options.last !== false;
  const tool = options.tool === 'brush' ? 'brush' : 'pen';

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = opacity;

  try {
    if (strokeEnabled) {
      drawSingleStroke(ctx, normalizedPoints, {
        color: options.strokeColor || '#ffffff',
        lineWidth: lineWidth + (strokeWidth * 2),
        tool,
        last
      });
    }

    drawSingleStroke(ctx, normalizedPoints, {
      color: options.color || DEFAULT_COLOR,
      lineWidth,
      tool,
      last
    });
  } catch (error) {
    if (strokeEnabled) {
      drawFallbackPath(ctx, normalizedPoints, {
        color: options.strokeColor || '#ffffff',
        lineWidth: lineWidth + (strokeWidth * 2)
      });
    }
    drawFallbackPath(ctx, normalizedPoints, {
      color: options.color || DEFAULT_COLOR,
      lineWidth
    });
  } finally {
    ctx.restore();
  }

  return true;
}
