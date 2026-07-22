'use strict';

const EPSILON = 1e-7;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function pointOnSegment(point, start, end) {
  const px = finiteNumber(point?.x);
  const py = finiteNumber(point?.y);
  const ax = finiteNumber(start?.x);
  const ay = finiteNumber(start?.y);
  const bx = finiteNumber(end?.x);
  const by = finiteNumber(end?.y);
  const area = cross(px - ax, py - ay, bx - ax, by - ay);
  if (Math.abs(area) > EPSILON) return false;
  return px >= Math.min(ax, bx) - EPSILON && px <= Math.max(ax, bx) + EPSILON &&
    py >= Math.min(ay, by) - EPSILON && py <= Math.max(ay, by) + EPSILON;
}

function pointInPolygon(point, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    const startY = finiteNumber(start?.y);
    const endY = finiteNumber(end?.y);
    const pointY = finiteNumber(point?.y);
    const crossesRay = (endY > pointY) !== (startY > pointY);
    if (!crossesRay) continue;
    const crossingX = (finiteNumber(start?.x) - finiteNumber(end?.x)) *
      (pointY - endY) / (startY - endY) + finiteNumber(end?.x);
    if (finiteNumber(point?.x) < crossingX) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(point, start, end) {
  const px = finiteNumber(point?.x);
  const py = finiteNumber(point?.y);
  const ax = finiteNumber(start?.x);
  const ay = finiteNumber(start?.y);
  const dx = finiteNumber(end?.x) - ax;
  const dy = finiteNumber(end?.y) - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(px - ax, py - ay);
  const amount = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * amount), py - (ay + dy * amount));
}

function pointToPolygonDistance(point, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length === 0) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(point, polygon)) return 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(distance, pointToSegmentDistance(
      point,
      polygon[index],
      polygon[(index + 1) % polygon.length]
    ));
  }
  return distance;
}

function polygonHasArea(polygon = [], minimumArea = 1) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let doubleArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    doubleArea += finiteNumber(current?.x) * finiteNumber(next?.y) -
      finiteNumber(next?.x) * finiteNumber(current?.y);
  }
  return Math.abs(doubleArea) + EPSILON >= Math.max(0, finiteNumber(minimumArea, 1)) * 2;
}

function boundsForPoints(points = [], padding = 0) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const x = finiteNumber(point?.x);
    const y = finiteNumber(point?.y);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const safePadding = Math.max(0, finiteNumber(padding));
  return {
    left: left - safePadding,
    right: right + safePadding,
    top: top - safePadding,
    bottom: bottom + safePadding
  };
}

function boundsIntersect(left, right) {
  return !!left && !!right &&
    left.right >= right.left - EPSILON &&
    left.left <= right.right + EPSILON &&
    left.bottom >= right.top - EPSILON &&
    left.top <= right.bottom + EPSILON;
}

function simplifyOpenPolyline(points, tolerance) {
  if (points.length <= 2) return points.map(point => ({ ...point }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop();
    let farthestIndex = -1;
    let farthestDistance = tolerance;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = pointToSegmentDistance(points[index], points[startIndex], points[endIndex]);
      if (distance <= farthestDistance) continue;
      farthestDistance = distance;
      farthestIndex = index;
    }
    if (farthestIndex < 0) continue;
    keep[farthestIndex] = 1;
    stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
  }
  return points.filter((_point, index) => keep[index]).map(point => ({ ...point }));
}

function simplifyClosedPolygon(points = [], tolerance = 1) {
  const deduplicated = [];
  for (const point of points) {
    const normalized = { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
    const previous = deduplicated[deduplicated.length - 1];
    if (!previous || Math.hypot(normalized.x - previous.x, normalized.y - previous.y) > EPSILON) {
      deduplicated.push(normalized);
    }
  }
  if (deduplicated.length > 1) {
    const first = deduplicated[0];
    const last = deduplicated[deduplicated.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON) deduplicated.pop();
  }
  if (deduplicated.length <= 3 || finiteNumber(tolerance) <= 0) return deduplicated;
  let farthestIndex = 1;
  let farthestDistance = -1;
  for (let index = 1; index < deduplicated.length; index += 1) {
    const dx = deduplicated[index].x - deduplicated[0].x;
    const dy = deduplicated[index].y - deduplicated[0].y;
    const distance = dx * dx + dy * dy;
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  const safeTolerance = Math.max(EPSILON, finiteNumber(tolerance, 1));
  const firstHalf = simplifyOpenPolyline(deduplicated.slice(0, farthestIndex + 1), safeTolerance);
  const secondHalf = simplifyOpenPolyline(
    [...deduplicated.slice(farthestIndex), deduplicated[0]],
    safeTolerance
  );
  const simplified = [...firstHalf, ...secondHalf.slice(1, -1)];
  return simplified.length >= 3 ? simplified : deduplicated;
}

function segmentPolygonIntersectionParameters(start, end, polygon = []) {
  const ax = finiteNumber(start?.x);
  const ay = finiteNumber(start?.y);
  const rx = finiteNumber(end?.x) - ax;
  const ry = finiteNumber(end?.y) - ay;
  const parameters = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const qx = finiteNumber(edgeStart?.x);
    const qy = finiteNumber(edgeStart?.y);
    const sx = finiteNumber(edgeEnd?.x) - qx;
    const sy = finiteNumber(edgeEnd?.y) - qy;
    const denominator = cross(rx, ry, sx, sy);
    const qpx = qx - ax;
    const qpy = qy - ay;

    if (Math.abs(denominator) <= EPSILON) {
      if (Math.abs(cross(qpx, qpy, rx, ry)) > EPSILON) continue;
      const lengthSquared = rx * rx + ry * ry;
      if (lengthSquared <= EPSILON) continue;
      for (const edgePoint of [edgeStart, edgeEnd]) {
        const t = ((finiteNumber(edgePoint?.x) - ax) * rx +
          (finiteNumber(edgePoint?.y) - ay) * ry) / lengthSquared;
        if (t > EPSILON && t < 1 - EPSILON) parameters.push(t);
      }
      continue;
    }

    const t = cross(qpx, qpy, sx, sy) / denominator;
    const u = cross(qpx, qpy, rx, ry) / denominator;
    if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) {
      parameters.push(Math.min(1, Math.max(0, t)));
    }
  }

  return parameters
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > EPSILON);
}

module.exports = {
  EPSILON,
  pointInPolygon,
  pointToSegmentDistance,
  pointToPolygonDistance,
  polygonHasArea,
  boundsForPoints,
  boundsIntersect,
  simplifyClosedPolygon,
  segmentPolygonIntersectionParameters
};
