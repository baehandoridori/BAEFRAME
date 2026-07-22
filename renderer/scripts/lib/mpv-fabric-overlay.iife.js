"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // renderer/scripts/modules/fabric-drawing-pilot-metrics.js
  var require_fabric_drawing_pilot_metrics = __commonJS({
    "renderer/scripts/modules/fabric-drawing-pilot-metrics.js"(exports, module) {
      "use strict";
      var DEFAULT_MAX_SAMPLES = 512;
      function finiteNonNegative(value) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : 0;
      }
      function createBoundedSeries(maxSamples) {
        const samples = [];
        let count = 0;
        let total = 0;
        let max = 0;
        return {
          add(value) {
            const sample = finiteNonNegative(value);
            count += 1;
            total += sample;
            max = Math.max(max, sample);
            samples.push(sample);
            if (samples.length > maxSamples) samples.shift();
          },
          snapshot() {
            const sorted = [...samples].sort((left, right) => left - right);
            const percentile = (ratio) => {
              if (sorted.length === 0) return 0;
              const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
              return sorted[Math.max(0, index)];
            };
            return {
              count,
              average: count > 0 ? total / count : 0,
              max,
              p50: percentile(0.5),
              p95: percentile(0.95),
              samples: [...samples]
            };
          }
        };
      }
      function createFabricDrawingPilotMetrics(options = {}) {
        const requestedMaxSamples = Number(options.maxSamples);
        const maxSamples = Number.isInteger(requestedMaxSamples) && requestedMaxSamples > 0 ? requestedMaxSamples : DEFAULT_MAX_SAMPLES;
        const toggleLatency = createBoundedSeries(maxSamples);
        const pointerPreviewLatency = createBoundedSeries(maxSamples);
        const longTaskDurations = createBoundedSeries(maxSamples);
        let pointerSampleCount = 0;
        let pressureMin = null;
        let pressureMax = null;
        let objectCount = 0;
        let peakObjectCount = 0;
        let duplicateActionCount = 0;
        let saveAttemptCount = 0;
        let staleMessageDropCount = 0;
        let surfaceErrorCount = 0;
        return {
          recordToggleLatency(durationMs) {
            toggleLatency.add(durationMs);
          },
          recordPointerPreviewLatency(durationMs) {
            pointerPreviewLatency.add(durationMs);
          },
          recordPointerSample(pressure) {
            pointerSampleCount += 1;
            const value = Number(pressure);
            if (!Number.isFinite(value)) return;
            pressureMin = pressureMin === null ? value : Math.min(pressureMin, value);
            pressureMax = pressureMax === null ? value : Math.max(pressureMax, value);
          },
          recordLongTask(durationMs) {
            longTaskDurations.add(durationMs);
          },
          setObjectCount(count) {
            objectCount = Math.max(0, Number.isFinite(Number(count)) ? Number(count) : 0);
            peakObjectCount = Math.max(peakObjectCount, objectCount);
          },
          recordDuplicateAction() {
            duplicateActionCount += 1;
          },
          recordSaveAttempt() {
            saveAttemptCount += 1;
          },
          recordStaleMessageDrop() {
            staleMessageDropCount += 1;
          },
          recordSurfaceError() {
            surfaceErrorCount += 1;
          },
          snapshot() {
            return {
              maxSamples,
              toggleLatency: toggleLatency.snapshot(),
              pointerPreviewLatency: pointerPreviewLatency.snapshot(),
              pointerSamples: {
                count: pointerSampleCount,
                pressureMin,
                pressureMax,
                pressureRange: pressureMin === null || pressureMax === null ? 0 : pressureMax - pressureMin
              },
              longTasks: longTaskDurations.snapshot(),
              objectCount: {
                current: objectCount,
                peak: peakObjectCount
              },
              duplicateActionCount,
              saveAttemptCount,
              staleMessageDropCount,
              surfaceErrorCount
            };
          }
        };
      }
      module.exports = {
        createFabricDrawingPilotMetrics
      };
    }
  });

  // renderer/scripts/modules/drawing-v3/lasso-geometry.js
  var require_lasso_geometry = __commonJS({
    "renderer/scripts/modules/drawing-v3/lasso-geometry.js"(exports, module) {
      "use strict";
      var EPSILON = 1e-7;
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
        return px >= Math.min(ax, bx) - EPSILON && px <= Math.max(ax, bx) + EPSILON && py >= Math.min(ay, by) - EPSILON && py <= Math.max(ay, by) + EPSILON;
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
          const crossesRay = endY > pointY !== startY > pointY;
          if (!crossesRay) continue;
          const crossingX = (finiteNumber(start?.x) - finiteNumber(end?.x)) * (pointY - endY) / (startY - endY) + finiteNumber(end?.x);
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
          doubleArea += finiteNumber(current?.x) * finiteNumber(next?.y) - finiteNumber(next?.x) * finiteNumber(current?.y);
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
        return !!left && !!right && left.right >= right.left - EPSILON && left.left <= right.right + EPSILON && left.bottom >= right.top - EPSILON && left.top <= right.bottom + EPSILON;
      }
      function simplifyOpenPolyline(points, tolerance) {
        if (points.length <= 2) return points.map((point) => ({ ...point }));
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
        return points.filter((_point, index) => keep[index]).map((point) => ({ ...point }));
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
              const t2 = ((finiteNumber(edgePoint?.x) - ax) * rx + (finiteNumber(edgePoint?.y) - ay) * ry) / lengthSquared;
              if (t2 > EPSILON && t2 < 1 - EPSILON) parameters.push(t2);
            }
            continue;
          }
          const t = cross(qpx, qpy, sx, sy) / denominator;
          const u = cross(qpx, qpy, rx, ry) / denominator;
          if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) {
            parameters.push(Math.min(1, Math.max(0, t)));
          }
        }
        return parameters.sort((left, right) => left - right).filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > EPSILON);
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
    }
  });

  // renderer/scripts/modules/drawing-v3/stroke-splitter.js
  var require_stroke_splitter = __commonJS({
    "renderer/scripts/modules/drawing-v3/stroke-splitter.js"(exports, module) {
      "use strict";
      var {
        EPSILON,
        pointInPolygon,
        pointToSegmentDistance,
        segmentPolygonIntersectionParameters
      } = require_lasso_geometry();
      var DEFAULT_THINNING = 0.65;
      var MINIMIZE_ITERATIONS = 14;
      var ROOT_ITERATIONS = 20;
      function finiteNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      }
      function interpolateSample(start, end, amount) {
        const t = Math.min(1, Math.max(0, finiteNumber(amount)));
        const sample = {
          ...start,
          x: finiteNumber(start?.x) + (finiteNumber(end?.x) - finiteNumber(start?.x)) * t,
          y: finiteNumber(start?.y) + (finiteNumber(end?.y) - finiteNumber(start?.y)) * t,
          pressure: finiteNumber(start?.pressure, 0.5) + (finiteNumber(end?.pressure, 0.5) - finiteNumber(start?.pressure, 0.5)) * t,
          time: finiteNumber(start?.time) + (finiteNumber(end?.time) - finiteNumber(start?.time)) * t
        };
        if (t >= 1) return { ...end, ...sample };
        return sample;
      }
      function samePoint(left, right) {
        return Math.abs(finiteNumber(left?.x) - finiteNumber(right?.x)) <= EPSILON && Math.abs(finiteNumber(left?.y) - finiteNumber(right?.y)) <= EPSILON;
      }
      function appendPoint(run, point) {
        if (!run.length || !samePoint(run[run.length - 1], point)) run.push(point);
      }
      function hasVisibleLength(run) {
        let length = 0;
        for (let index = 1; index < run.length; index += 1) {
          const dx = finiteNumber(run[index]?.x) - finiteNumber(run[index - 1]?.x);
          const dy = finiteNumber(run[index]?.y) - finiteNumber(run[index - 1]?.y);
          length += Math.hypot(dx, dy);
        }
        return length + EPSILON >= 1;
      }
      function strokeRadius(sample, options = {}) {
        const size = Math.max(1, finiteNumber(options.size, 0));
        if (size <= 1 && !Number.isFinite(Number(options.size))) return 0;
        const thinning = finiteNumber(options.thinning, DEFAULT_THINNING);
        const pressure = Math.min(1, Math.max(0, finiteNumber(sample?.pressure, 0.5)));
        return Math.max(0.01, size * (0.5 - thinning * (0.5 - pressure)));
      }
      function boundsOverlapWithPadding(start, end, edgeStart, edgeEnd, padding) {
        const left = Math.min(finiteNumber(start?.x), finiteNumber(end?.x)) - padding;
        const right = Math.max(finiteNumber(start?.x), finiteNumber(end?.x)) + padding;
        const top = Math.min(finiteNumber(start?.y), finiteNumber(end?.y)) - padding;
        const bottom = Math.max(finiteNumber(start?.y), finiteNumber(end?.y)) + padding;
        return right >= Math.min(finiteNumber(edgeStart?.x), finiteNumber(edgeEnd?.x)) - EPSILON && left <= Math.max(finiteNumber(edgeStart?.x), finiteNumber(edgeEnd?.x)) + EPSILON && bottom >= Math.min(finiteNumber(edgeStart?.y), finiteNumber(edgeEnd?.y)) - EPSILON && top <= Math.max(finiteNumber(edgeStart?.y), finiteNumber(edgeEnd?.y)) + EPSILON;
      }
      function proximityMetric(start, end, edgeStart, edgeEnd, options, amount) {
        const sample = interpolateSample(start, end, amount);
        return pointToSegmentDistance(sample, edgeStart, edgeEnd) - strokeRadius(sample, options);
      }
      function findRoot(metric, low, high, lowIsHit) {
        let left = low;
        let right = high;
        for (let iteration = 0; iteration < ROOT_ITERATIONS; iteration += 1) {
          const middle = (left + right) / 2;
          const middleIsHit = metric(middle) <= EPSILON;
          if (middleIsHit === lowIsHit) left = middle;
          else right = middle;
        }
        return (left + right) / 2;
      }
      function edgeProximityInterval(start, end, edgeStart, edgeEnd, options) {
        const maximumRadius = Math.max(strokeRadius(start, options), strokeRadius(end, options));
        if (!boundsOverlapWithPadding(start, end, edgeStart, edgeEnd, maximumRadius)) return null;
        const metric = (amount) => proximityMetric(start, end, edgeStart, edgeEnd, options, amount);
        let left = 0;
        let right = 1;
        for (let iteration = 0; iteration < MINIMIZE_ITERATIONS; iteration += 1) {
          const first = left + (right - left) / 3;
          const second = right - (right - left) / 3;
          if (metric(first) <= metric(second)) right = second;
          else left = first;
        }
        const minimum = (left + right) / 2;
        if (metric(minimum) > EPSILON) return null;
        const startAmount = metric(0) <= EPSILON ? 0 : findRoot(metric, 0, minimum, false);
        const endAmount = metric(1) <= EPSILON ? 1 : findRoot(metric, minimum, 1, true);
        return [startAmount, endAmount];
      }
      function centerlineIntervals(start, end, polygon) {
        const cuts = [0, ...segmentPolygonIntersectionParameters(start, end, polygon), 1].sort((left, right) => left - right).filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > EPSILON);
        const intervals = [];
        for (let index = 0; index < cuts.length - 1; index += 1) {
          const from = cuts[index];
          const to = cuts[index + 1];
          if (pointInPolygon(interpolateSample(start, end, (from + to) / 2), polygon)) {
            intervals.push([from, to]);
          }
        }
        return intervals;
      }
      function mergeIntervals(intervals) {
        const ordered = intervals.filter((interval) => interval && interval[1] - interval[0] > EPSILON).sort((left, right) => left[0] - right[0]);
        const merged = [];
        for (const interval of ordered) {
          const previous = merged[merged.length - 1];
          if (!previous || interval[0] > previous[1] + EPSILON) merged.push([...interval]);
          else previous[1] = Math.max(previous[1], interval[1]);
        }
        return merged;
      }
      function segmentSelectionIntervals(start, end, polygon, options) {
        const intervals = centerlineIntervals(start, end, polygon);
        const radiusEnabled = Number.isFinite(Number(options?.size)) && Number(options.size) > 0;
        if (radiusEnabled) {
          for (let index = 0; index < polygon.length; index += 1) {
            const interval = edgeProximityInterval(
              start,
              end,
              polygon[index],
              polygon[(index + 1) % polygon.length],
              options
            );
            if (interval) intervals.push(interval);
          }
        }
        return mergeIntervals(intervals);
      }
      function intervalContains(intervals, amount) {
        return intervals.some((interval) => amount >= interval[0] - EPSILON && amount <= interval[1] + EPSILON);
      }
      function splitStrokePointsByPolygon(points = [], polygon = [], options = {}) {
        if (!Array.isArray(points) || points.length < 2 || !Array.isArray(polygon) || polygon.length < 3) {
          const outside = Array.isArray(points) && points.length ? [[...points]] : [];
          return { inside: [], outside, runs: outside.map((run) => ({ kind: "outside", points: run })) };
        }
        const result = { inside: [], outside: [], runs: [], limitExceeded: false };
        const maxRuns = Number.isInteger(Number(options.maxRuns)) && Number(options.maxRuns) > 0 ? Number(options.maxRuns) : Number.POSITIVE_INFINITY;
        let currentKind = null;
        let currentRun = null;
        const startRun = (kind, point) => {
          if (result.runs.length >= maxRuns) {
            result.limitExceeded = true;
            return false;
          }
          currentKind = kind;
          currentRun = [point];
          result[kind].push(currentRun);
          result.runs.push({ kind, points: currentRun });
          return true;
        };
        outer: for (let index = 0; index < points.length - 1; index += 1) {
          const start = points[index];
          const end = points[index + 1];
          const selectionIntervals = segmentSelectionIntervals(start, end, polygon, options);
          const cuts = [0, ...selectionIntervals.flat(), 1].sort((left, right) => left - right).filter((value, cutIndex, values) => cutIndex === 0 || Math.abs(value - values[cutIndex - 1]) > EPSILON);
          for (let cutIndex = 0; cutIndex < cuts.length - 1; cutIndex += 1) {
            const from = interpolateSample(start, end, cuts[cutIndex]);
            const to = interpolateSample(start, end, cuts[cutIndex + 1]);
            const midpoint = (cuts[cutIndex] + cuts[cutIndex + 1]) / 2;
            const kind = intervalContains(selectionIntervals, midpoint) ? "inside" : "outside";
            if ((currentKind !== kind || !currentRun) && !startRun(kind, from)) break outer;
            else appendPoint(currentRun, from);
            appendPoint(currentRun, to);
          }
        }
        result.runs = result.runs.filter(({ points: run }) => run.length >= 2 && hasVisibleLength(run));
        result.inside = result.runs.filter((run) => run.kind === "inside").map((run) => run.points);
        result.outside = result.runs.filter((run) => run.kind === "outside").map((run) => run.points);
        return result;
      }
      module.exports = {
        interpolateSample,
        strokeRadius,
        splitStrokePointsByPolygon
      };
    }
  });

  // node_modules/perfect-freehand/dist/cjs/index.js
  var require_cjs = __commonJS({
    "node_modules/perfect-freehand/dist/cjs/index.js"(exports) {
      Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: `Module` } });
      var { PI: e } = Math;
      var t = e + 1e-4;
      var n = 0.5;
      var r = [1, 1];
      function i(e2, t2, n2, r2 = (e3) => e3) {
        return e2 * r2(0.5 - t2 * (0.5 - n2));
      }
      var { min: a } = Math;
      function o(e2, t2, n2) {
        let r2 = a(1, t2 / n2);
        return a(1, e2 + (a(1, 1 - r2) - e2) * (r2 * 0.275));
      }
      function s(e2) {
        return [-e2[0], -e2[1]];
      }
      function c(e2, t2) {
        return [e2[0] + t2[0], e2[1] + t2[1]];
      }
      function l(e2, t2, n2) {
        return e2[0] = t2[0] + n2[0], e2[1] = t2[1] + n2[1], e2;
      }
      function u(e2, t2) {
        return [e2[0] - t2[0], e2[1] - t2[1]];
      }
      function d(e2, t2, n2) {
        return e2[0] = t2[0] - n2[0], e2[1] = t2[1] - n2[1], e2;
      }
      function f(e2, t2) {
        return [e2[0] * t2, e2[1] * t2];
      }
      function p(e2, t2, n2) {
        return e2[0] = t2[0] * n2, e2[1] = t2[1] * n2, e2;
      }
      function m(e2, t2) {
        return [e2[0] / t2, e2[1] / t2];
      }
      function h(e2) {
        return [e2[1], -e2[0]];
      }
      function g(e2, t2) {
        let n2 = t2[0];
        return e2[0] = t2[1], e2[1] = -n2, e2;
      }
      function ee(e2, t2) {
        return e2[0] * t2[0] + e2[1] * t2[1];
      }
      function _(e2, t2) {
        return e2[0] === t2[0] && e2[1] === t2[1];
      }
      function v(e2) {
        return Math.hypot(e2[0], e2[1]);
      }
      function y(e2, t2) {
        let n2 = e2[0] - t2[0], r2 = e2[1] - t2[1];
        return n2 * n2 + r2 * r2;
      }
      function b(e2) {
        return m(e2, v(e2));
      }
      function x(e2, t2) {
        return Math.hypot(e2[1] - t2[1], e2[0] - t2[0]);
      }
      function S(e2, t2, n2) {
        let r2 = Math.sin(n2), i2 = Math.cos(n2), a2 = e2[0] - t2[0], o2 = e2[1] - t2[1], s2 = a2 * i2 - o2 * r2, c2 = a2 * r2 + o2 * i2;
        return [s2 + t2[0], c2 + t2[1]];
      }
      function C(e2, t2, n2, r2) {
        let i2 = Math.sin(r2), a2 = Math.cos(r2), o2 = t2[0] - n2[0], s2 = t2[1] - n2[1], c2 = o2 * a2 - s2 * i2, l2 = o2 * i2 + s2 * a2;
        return e2[0] = c2 + n2[0], e2[1] = l2 + n2[1], e2;
      }
      function w(e2, t2, n2) {
        return c(e2, f(u(t2, e2), n2));
      }
      function te(e2, t2, n2, r2) {
        let i2 = n2[0] - t2[0], a2 = n2[1] - t2[1];
        return e2[0] = t2[0] + i2 * r2, e2[1] = t2[1] + a2 * r2, e2;
      }
      function T(e2, t2, n2) {
        return c(e2, f(t2, n2));
      }
      var E = [0, 0];
      var D = [0, 0];
      var O = [0, 0];
      function k(e2, n2) {
        let r2 = T(e2, b(h(u(e2, c(e2, [1, 1])))), -n2), i2 = [], a2 = 1 / 13;
        for (let n3 = a2; n3 <= 1; n3 += a2) i2.push(S(r2, e2, t * 2 * n3));
        return i2;
      }
      function A(e2, n2, r2) {
        let i2 = [], a2 = 1 / r2;
        for (let r3 = a2; r3 <= 1; r3 += a2) i2.push(S(n2, e2, t * r3));
        return i2;
      }
      function j(e2, t2, n2) {
        let r2 = u(t2, n2), i2 = f(r2, 0.5), a2 = f(r2, 0.51);
        return [u(e2, i2), u(e2, a2), c(e2, a2), c(e2, i2)];
      }
      function M(e2, n2, r2, i2) {
        let a2 = [], o2 = T(e2, n2, r2), s2 = 1 / i2;
        for (let n3 = s2; n3 < 1; n3 += s2) a2.push(S(o2, e2, t * 3 * n3));
        return a2;
      }
      function ne(e2, t2, n2) {
        return [c(e2, f(t2, n2)), c(e2, f(t2, n2 * 0.99)), u(e2, f(t2, n2 * 0.99)), u(e2, f(t2, n2))];
      }
      function N(e2, t2, n2) {
        return e2 === false || e2 === void 0 ? 0 : e2 === true ? Math.max(t2, n2) : e2;
      }
      function re(e2, t2, n2) {
        return e2.slice(0, 10).reduce((e3, r2) => {
          let i2 = r2.pressure;
          return t2 && (i2 = o(e3, r2.distance, n2)), (e3 + i2) / 2;
        }, e2[0].pressure);
      }
      function P(e2, n2 = {}) {
        let { size: r2 = 16, smoothing: a2 = 0.5, thinning: f2 = 0.5, simulatePressure: m2 = true, easing: _2 = (e3) => e3, start: v2 = {}, end: b2 = {}, last: x2 = false } = n2, { cap: S2 = true, easing: w2 = (e3) => e3 * (2 - e3) } = v2, { cap: T2 = true, easing: P2 = (e3) => --e3 * e3 * e3 + 1 } = b2;
        if (e2.length === 0 || r2 <= 0) return [];
        let F2 = e2[e2.length - 1].runningLength, I2 = N(v2.taper, r2, F2), L2 = N(b2.taper, r2, F2), R2 = (r2 * a2) ** 2, z2 = [], B = [], V = re(e2, m2, r2), H = i(r2, f2, e2[e2.length - 1].pressure, _2), U, W = e2[0].vector, G = e2[0].point, K = G, q = G, J = K, Y = false;
        for (let n3 = 0; n3 < e2.length; n3++) {
          let { pressure: a3 } = e2[n3], { point: s2, vector: h2, distance: v3, runningLength: b3 } = e2[n3], x3 = n3 === e2.length - 1;
          if (!x3 && F2 - b3 < 3) continue;
          f2 ? (m2 && (a3 = o(V, v3, r2)), H = i(r2, f2, a3, _2)) : H = r2 / 2, U === void 0 && (U = H);
          let S3 = b3 < I2 ? w2(b3 / I2) : 1, T3 = F2 - b3 < L2 ? P2((F2 - b3) / L2) : 1;
          H = Math.max(0.01, H * Math.min(S3, T3));
          let k2 = (x3 ? e2[n3] : e2[n3 + 1]).vector, A2 = x3 ? 1 : ee(h2, k2), j2 = ee(h2, W) < 0 && !Y, M2 = A2 !== null && A2 < 0;
          if (j2 || M2) {
            g(E, W), p(E, E, H);
            for (let e3 = 0; e3 <= 1; e3 += 0.07692307692307693) d(D, s2, E), C(D, D, s2, t * e3), q = [D[0], D[1]], z2.push(q), l(O, s2, E), C(O, O, s2, t * -e3), J = [O[0], O[1]], B.push(J);
            G = q, K = J, M2 && (Y = true);
            continue;
          }
          if (Y = false, x3) {
            g(E, h2), p(E, E, H), z2.push(u(s2, E)), B.push(c(s2, E));
            continue;
          }
          te(E, k2, h2, A2), g(E, E), p(E, E, H), d(D, s2, E), q = [D[0], D[1]], (n3 <= 1 || y(G, q) > R2) && (z2.push(q), G = q), l(O, s2, E), J = [O[0], O[1]], (n3 <= 1 || y(K, J) > R2) && (B.push(J), K = J), V = a3, W = h2;
        }
        let X = [e2[0].point[0], e2[0].point[1]], Z = e2.length > 1 ? [e2[e2.length - 1].point[0], e2[e2.length - 1].point[1]] : c(e2[0].point, [1, 1]), Q = [], $ = [];
        if (e2.length === 1) {
          if (!(I2 || L2) || x2) return k(X, U || H);
        } else {
          I2 || L2 && e2.length === 1 || (S2 ? Q.push(...A(X, B[0], 13)) : Q.push(...j(X, z2[0], B[0])));
          let t2 = h(s(e2[e2.length - 1].vector));
          L2 || I2 && e2.length === 1 ? $.push(Z) : T2 ? $.push(...M(Z, t2, H, 29)) : $.push(...ne(Z, t2, H));
        }
        return z2.concat($, B.reverse(), Q);
      }
      var F = [0, 0];
      function I(e2) {
        return e2 != null && e2 >= 0;
      }
      function L(e2, t2 = {}) {
        let { streamline: i2 = 0.5, size: a2 = 16, last: o2 = false } = t2;
        if (e2.length === 0) return [];
        let s2 = 0.15 + (1 - i2) * 0.85, l2 = Array.isArray(e2[0]) ? e2 : e2.map(({ x: e3, y: t3, pressure: r2 = n }) => [e3, t3, r2]);
        if (l2.length === 2) {
          let e3 = l2[1];
          l2 = l2.slice(0, -1);
          for (let t3 = 1; t3 < 5; t3++) l2.push(w(l2[0], e3, t3 / 4));
        }
        l2.length === 1 && (l2 = [...l2, [...c(l2[0], r), ...l2[0].slice(2)]]);
        let u2 = [{ point: [l2[0][0], l2[0][1]], pressure: I(l2[0][2]) ? l2[0][2] : 0.25, vector: [...r], distance: 0, runningLength: 0 }], f2 = false, p2 = 0, m2 = u2[0], h2 = l2.length - 1;
        for (let e3 = 1; e3 < l2.length; e3++) {
          let t3 = o2 && e3 === h2 ? [l2[e3][0], l2[e3][1]] : w(m2.point, l2[e3], s2);
          if (_(m2.point, t3)) continue;
          let r2 = x(t3, m2.point);
          if (p2 += r2, e3 < h2 && !f2) {
            if (p2 < a2) continue;
            f2 = true;
          }
          d(F, m2.point, t3), m2 = { point: t3, pressure: I(l2[e3][2]) ? l2[e3][2] : n, vector: b(F), distance: r2, runningLength: p2 }, u2.push(m2);
        }
        return u2[0].vector = u2[1]?.vector || [0, 0], u2;
      }
      function R(e2, t2 = {}) {
        return P(L(e2, t2), t2);
      }
      var z = R;
      exports.default = z, exports.getStroke = R, exports.getStrokeOutlinePoints = P, exports.getStrokePoints = L;
    }
  });

  // node_modules/fabric/dist/index.min.js
  var require_index_min = __commonJS({
    "node_modules/fabric/dist/index.min.js"(exports, module) {
      (function(e, t) {
        typeof exports == `object` && typeof module < `u` ? t(exports) : typeof define == `function` && define.amd ? define([`exports`], t) : t((e = typeof globalThis < `u` ? globalThis : e || self).fabric = {});
      })(exports, function(e) {
        Object.defineProperty(e, Symbol.toStringTag, { value: `Module` });
        var t = Object.defineProperty, n = (e2, n2) => {
          let r2 = {};
          for (var i2 in e2) t(r2, i2, { get: e2[i2], enumerable: true });
          return n2 || t(r2, Symbol.toStringTag, { value: `Module` }), r2;
        };
        function r(e2) {
          return r = typeof Symbol == `function` && typeof Symbol.iterator == `symbol` ? function(e3) {
            return typeof e3;
          } : function(e3) {
            return e3 && typeof Symbol == `function` && e3.constructor === Symbol && e3 !== Symbol.prototype ? `symbol` : typeof e3;
          }, r(e2);
        }
        function i(e2) {
          var t2 = function(e3, t3) {
            if (r(e3) != `object` || !e3) return e3;
            var n2 = e3[Symbol.toPrimitive];
            if (n2 !== void 0) {
              var i2 = n2.call(e3, t3 || `default`);
              if (r(i2) != `object`) return i2;
              throw TypeError(`@@toPrimitive must return a primitive value.`);
            }
            return (t3 === `string` ? String : Number)(e3);
          }(e2, `string`);
          return r(t2) == `symbol` ? t2 : t2 + ``;
        }
        function a(e2, t2, n2) {
          return (t2 = i(t2)) in e2 ? Object.defineProperty(e2, t2, { value: n2, enumerable: true, configurable: true, writable: true }) : e2[t2] = n2, e2;
        }
        var o = class {
          constructor() {
            a(this, `browserShadowBlurConstant`, 1), a(this, `DPI`, 96), a(this, `devicePixelRatio`, typeof window < `u` ? window.devicePixelRatio : 1), a(this, `perfLimitSizeTotal`, 2097152), a(this, `maxCacheSideLimit`, 4096), a(this, `minCacheSideLimit`, 256), a(this, `disableStyleCopyPaste`, false), a(this, `enableGLFiltering`, true), a(this, `textureSize`, 4096), a(this, `forceGLPutImageData`, false), a(this, `cachesBoundsOfCurve`, false), a(this, `fontPaths`, {}), a(this, `NUM_FRACTION_DIGITS`, 4);
          }
        };
        let s = new class extends o {
          constructor(e2) {
            super(), this.configure(e2);
          }
          configure(e2 = {}) {
            Object.assign(this, e2);
          }
          addFonts(e2 = {}) {
            this.fontPaths = { ...this.fontPaths, ...e2 };
          }
          removeFonts(e2 = []) {
            e2.forEach((e3) => {
              delete this.fontPaths[e3];
            });
          }
          clearFonts() {
            this.fontPaths = {};
          }
          restoreDefaults(e2) {
            let t2 = new o(), n2 = (e2 == null ? void 0 : e2.reduce((e3, n3) => (e3[n3] = t2[n3], e3), {})) || t2;
            this.configure(n2);
          }
        }(), c = (e2, ...t2) => console[e2](`fabric`, ...t2);
        var l = class extends Error {
          constructor(e2, t2) {
            super(`fabric: ${e2}`, t2);
          }
        }, u = class extends l {
          constructor(e2) {
            super(`${e2} 'options.signal' is in 'aborted' state`);
          }
        }, d = class {
        }, f = class extends d {
          testPrecision(e2, t2) {
            let n2 = `precision ${t2} float;
void main(){}`, r2 = e2.createShader(e2.FRAGMENT_SHADER);
            return !!r2 && (e2.shaderSource(r2, n2), e2.compileShader(r2), !!e2.getShaderParameter(r2, e2.COMPILE_STATUS));
          }
          queryWebGL(e2) {
            let t2 = e2.getContext(`webgl`);
            t2 && (this.maxTextureSize = t2.getParameter(t2.MAX_TEXTURE_SIZE), this.GLPrecision = [`highp`, `mediump`, `lowp`].find((e3) => this.testPrecision(t2, e3)), t2.getExtension(`WEBGL_lose_context`).loseContext(), c(`log`, `WebGL: max texture size ${this.maxTextureSize}`));
          }
          isSupported(e2) {
            return !!this.maxTextureSize && this.maxTextureSize >= e2;
          }
        };
        let p = {}, m, h = () => m || (m = { document, window, isTouchSupported: `ontouchstart` in window || `ontouchstart` in document || window && window.navigator && window.navigator.maxTouchPoints > 0, WebGLProbe: new f(), dispose() {
        }, copyPasteData: p }), g = () => h().document, _ = () => h().window, v = () => {
          var e2;
          return Math.max((e2 = s.devicePixelRatio) == null ? _().devicePixelRatio : e2, 1);
        }, y = new class {
          constructor() {
            a(this, `boundsOfCurveCache`, {}), this.charWidthsCache = /* @__PURE__ */ new Map();
          }
          getFontCache({ fontFamily: e2, fontStyle: t2, fontWeight: n2 }) {
            e2 = e2.toLowerCase();
            let r2 = this.charWidthsCache;
            r2.has(e2) || r2.set(e2, /* @__PURE__ */ new Map());
            let i2 = r2.get(e2), a2 = `${t2.toLowerCase()}_${(n2 + ``).toLowerCase()}`;
            return i2.has(a2) || i2.set(a2, /* @__PURE__ */ new Map()), i2.get(a2);
          }
          clearFontCache(e2) {
            e2 ? this.charWidthsCache.delete((e2 || ``).toLowerCase()) : this.charWidthsCache = /* @__PURE__ */ new Map();
          }
          limitDimsByArea(e2) {
            let { perfLimitSizeTotal: t2 } = s, n2 = Math.sqrt(t2 * e2);
            return [Math.floor(n2), Math.floor(t2 / n2)];
          }
        }(), b = `7.4.0`;
        function x() {
        }
        let S = Math.PI / 2, C = Math.PI / 4, w = 2 * Math.PI, ee = Math.PI / 180, T = Object.freeze([1, 0, 0, 1, 0, 0]), E = `center`, D = `left`, O = `bottom`, k = `right`, te = `none`, ne = /\r?\n/, re = `moving`, ie = `scaling`, ae = `rotating`, oe = `rotate`, A = `skewing`, se = `resizing`, ce = `modifyPoly`, le = `changed`, ue = `scale`, de = `scaleX`, fe = `scaleY`, pe = `skewX`, me = `skewY`, j = `fill`, he = `stroke`, ge = `modified`, _e = `normal`, ve = `json`, M = new class {
          constructor() {
            this[ve] = /* @__PURE__ */ new Map(), this.svg = /* @__PURE__ */ new Map();
          }
          has(e2) {
            return this[ve].has(e2);
          }
          getClass(e2) {
            let t2 = this[ve].get(e2);
            if (!t2) throw new l(`No class registered for ${e2}`);
            return t2;
          }
          setClass(e2, t2) {
            t2 ? this[ve].set(t2, e2) : (this[ve].set(e2.type, e2), this[ve].set(e2.type.toLowerCase(), e2));
          }
          getSVGClass(e2) {
            return this.svg.get(e2);
          }
          setSVGClass(e2, t2) {
            this.svg.set(t2 == null ? e2.type.toLowerCase() : t2, e2);
          }
        }(), ye = new class extends Array {
          remove(e2) {
            let t2 = this.indexOf(e2);
            t2 > -1 && this.splice(t2, 1);
          }
          cancelAll() {
            let e2 = this.splice(0);
            return e2.forEach((e3) => e3.abort()), e2;
          }
          cancelByCanvas(e2) {
            if (!e2) return [];
            let t2 = this.filter((t3) => {
              var n2;
              return t3.target === e2 || typeof t3.target == `object` && ((n2 = t3.target) == null ? void 0 : n2.canvas) === e2;
            });
            return t2.forEach((e3) => e3.abort()), t2;
          }
          cancelByTarget(e2) {
            if (!e2) return [];
            let t2 = this.filter((t3) => t3.target === e2);
            return t2.forEach((e3) => e3.abort()), t2;
          }
        }();
        var be = class {
          constructor() {
            a(this, `__eventListeners`, {});
          }
          on(e2, t2) {
            if (this.__eventListeners || (this.__eventListeners = {}), typeof e2 == `object`) return Object.entries(e2).forEach(([e3, t3]) => {
              this.on(e3, t3);
            }), () => this.off(e2);
            if (t2) {
              let n2 = e2;
              return this.__eventListeners[n2] || (this.__eventListeners[n2] = []), this.__eventListeners[n2].push(t2), () => this.off(n2, t2);
            }
            return () => false;
          }
          once(e2, t2) {
            if (typeof e2 == `object`) {
              let t3 = [];
              return Object.entries(e2).forEach(([e3, n2]) => {
                t3.push(this.once(e3, n2));
              }), () => t3.forEach((e3) => e3());
            }
            if (t2) {
              let n2 = this.on(e2, function(...e3) {
                t2.call(this, ...e3), n2();
              });
              return n2;
            }
            return () => false;
          }
          _removeEventListener(e2, t2) {
            if (this.__eventListeners[e2]) if (t2) {
              let n2 = this.__eventListeners[e2], r2 = n2.indexOf(t2);
              r2 > -1 && n2.splice(r2, 1);
            } else this.__eventListeners[e2] = [];
          }
          off(e2, t2) {
            if (this.__eventListeners) if (e2 === void 0) for (let e3 in this.__eventListeners) this._removeEventListener(e3);
            else typeof e2 == `object` ? Object.entries(e2).forEach(([e3, t3]) => {
              this._removeEventListener(e3, t3);
            }) : this._removeEventListener(e2, t2);
          }
          fire(e2, t2) {
            var n2;
            if (!this.__eventListeners) return;
            let r2 = (n2 = this.__eventListeners[e2]) == null ? void 0 : n2.concat();
            if (r2) for (let e3 = 0; e3 < r2.length; e3++) r2[e3].call(this, t2 || {});
          }
        };
        let xe = (e2, t2) => {
          let n2 = e2.indexOf(t2);
          return n2 !== -1 && e2.splice(n2, 1), e2;
        }, Se = (e2) => {
          if (e2 === 0) return 1;
          switch (Math.abs(e2) / S) {
            case 1:
            case 3:
              return 0;
            case 2:
              return -1;
          }
          return Math.cos(e2);
        }, Ce = (e2) => {
          if (e2 === 0) return 0;
          let t2 = e2 / S, n2 = Math.sign(e2);
          switch (t2) {
            case 1:
              return n2;
            case 2:
              return 0;
            case 3:
              return -n2;
          }
          return Math.sin(e2);
        };
        var N = class e2 {
          constructor(e3 = 0, t2 = 0) {
            typeof e3 == `object` ? (this.x = e3.x, this.y = e3.y) : (this.x = e3, this.y = t2);
          }
          add(t2) {
            return new e2(this.x + t2.x, this.y + t2.y);
          }
          addEquals(e3) {
            return this.x += e3.x, this.y += e3.y, this;
          }
          scalarAdd(t2) {
            return new e2(this.x + t2, this.y + t2);
          }
          scalarAddEquals(e3) {
            return this.x += e3, this.y += e3, this;
          }
          subtract(t2) {
            return new e2(this.x - t2.x, this.y - t2.y);
          }
          subtractEquals(e3) {
            return this.x -= e3.x, this.y -= e3.y, this;
          }
          scalarSubtract(t2) {
            return new e2(this.x - t2, this.y - t2);
          }
          scalarSubtractEquals(e3) {
            return this.x -= e3, this.y -= e3, this;
          }
          multiply(t2) {
            return new e2(this.x * t2.x, this.y * t2.y);
          }
          scalarMultiply(t2) {
            return new e2(this.x * t2, this.y * t2);
          }
          scalarMultiplyEquals(e3) {
            return this.x *= e3, this.y *= e3, this;
          }
          divide(t2) {
            return new e2(this.x / t2.x, this.y / t2.y);
          }
          scalarDivide(t2) {
            return new e2(this.x / t2, this.y / t2);
          }
          scalarDivideEquals(e3) {
            return this.x /= e3, this.y /= e3, this;
          }
          eq(e3) {
            return this.x === e3.x && this.y === e3.y;
          }
          lt(e3) {
            return this.x < e3.x && this.y < e3.y;
          }
          lte(e3) {
            return this.x <= e3.x && this.y <= e3.y;
          }
          gt(e3) {
            return this.x > e3.x && this.y > e3.y;
          }
          gte(e3) {
            return this.x >= e3.x && this.y >= e3.y;
          }
          lerp(t2, n2 = 0.5) {
            return n2 = Math.max(Math.min(1, n2), 0), new e2(this.x + (t2.x - this.x) * n2, this.y + (t2.y - this.y) * n2);
          }
          distanceFrom(e3) {
            let t2 = this.x - e3.x, n2 = this.y - e3.y;
            return Math.sqrt(t2 * t2 + n2 * n2);
          }
          midPointFrom(e3) {
            return this.lerp(e3);
          }
          min(t2) {
            return new e2(Math.min(this.x, t2.x), Math.min(this.y, t2.y));
          }
          max(t2) {
            return new e2(Math.max(this.x, t2.x), Math.max(this.y, t2.y));
          }
          toString() {
            return `${this.x},${this.y}`;
          }
          setXY(e3, t2) {
            return this.x = e3, this.y = t2, this;
          }
          setX(e3) {
            return this.x = e3, this;
          }
          setY(e3) {
            return this.y = e3, this;
          }
          setFromPoint(e3) {
            return this.x = e3.x, this.y = e3.y, this;
          }
          swap(e3) {
            let t2 = this.x, n2 = this.y;
            this.x = e3.x, this.y = e3.y, e3.x = t2, e3.y = n2;
          }
          clone() {
            return new e2(this.x, this.y);
          }
          rotate(t2, n2 = we) {
            let r2 = Ce(t2), i2 = Se(t2), a2 = this.subtract(n2);
            return new e2(a2.x * i2 - a2.y * r2, a2.x * r2 + a2.y * i2).add(n2);
          }
          transform(t2, n2 = false) {
            return new e2(t2[0] * this.x + t2[2] * this.y + (n2 ? 0 : t2[4]), t2[1] * this.x + t2[3] * this.y + (n2 ? 0 : t2[5]));
          }
        };
        let we = new N(0, 0), Te = (e2) => !!e2 && Array.isArray(e2._objects);
        function Ee(e2) {
          class t2 extends e2 {
            constructor(...e3) {
              super(...e3), a(this, `_objects`, []);
            }
            _onObjectAdded(e3) {
            }
            _onObjectRemoved(e3) {
            }
            _onStackOrderChanged(e3) {
            }
            add(...e3) {
              let t3 = this._objects.push(...e3);
              return e3.forEach((e4) => this._onObjectAdded(e4)), t3;
            }
            insertAt(e3, ...t3) {
              return this._objects.splice(e3, 0, ...t3), t3.forEach((e4) => this._onObjectAdded(e4)), this._objects.length;
            }
            remove(...e3) {
              let t3 = this._objects, n2 = [];
              return e3.forEach((e4) => {
                let r2 = t3.indexOf(e4);
                r2 !== -1 && (t3.splice(r2, 1), n2.push(e4), this._onObjectRemoved(e4));
              }), n2;
            }
            forEachObject(e3) {
              this.getObjects().forEach((t3, n2, r2) => e3(t3, n2, r2));
            }
            getObjects(...e3) {
              return e3.length === 0 ? [...this._objects] : this._objects.filter((t3) => t3.isType(...e3));
            }
            item(e3) {
              return this._objects[e3];
            }
            isEmpty() {
              return this._objects.length === 0;
            }
            size() {
              return this._objects.length;
            }
            contains(e3, n2) {
              return !!this._objects.includes(e3) || !!n2 && this._objects.some((n3) => n3 instanceof t2 && n3.contains(e3, true));
            }
            complexity() {
              return this._objects.reduce((e3, t3) => e3 += t3.complexity ? t3.complexity() : 0, 0);
            }
            sendObjectToBack(e3) {
              return !(!e3 || e3 === this._objects[0]) && (xe(this._objects, e3), this._objects.unshift(e3), this._onStackOrderChanged(e3), true);
            }
            bringObjectToFront(e3) {
              return !(!e3 || e3 === this._objects[this._objects.length - 1]) && (xe(this._objects, e3), this._objects.push(e3), this._onStackOrderChanged(e3), true);
            }
            sendObjectBackwards(e3, t3) {
              if (!e3) return false;
              let n2 = this._objects.indexOf(e3);
              if (n2 !== 0) {
                let r2 = this.findNewLowerIndex(e3, n2, t3);
                return xe(this._objects, e3), this._objects.splice(r2, 0, e3), this._onStackOrderChanged(e3), true;
              }
              return false;
            }
            bringObjectForward(e3, t3) {
              if (!e3) return false;
              let n2 = this._objects.indexOf(e3);
              if (n2 !== this._objects.length - 1) {
                let r2 = this.findNewUpperIndex(e3, n2, t3);
                return xe(this._objects, e3), this._objects.splice(r2, 0, e3), this._onStackOrderChanged(e3), true;
              }
              return false;
            }
            moveObjectTo(e3, t3) {
              return e3 !== this._objects[t3] && (xe(this._objects, e3), this._objects.splice(t3, 0, e3), this._onStackOrderChanged(e3), true);
            }
            findNewLowerIndex(e3, t3, n2) {
              let r2;
              if (n2) {
                r2 = t3;
                for (let n3 = t3 - 1; n3 >= 0; --n3) if (e3.isOverlapping(this._objects[n3])) {
                  r2 = n3;
                  break;
                }
              } else r2 = t3 - 1;
              return r2;
            }
            findNewUpperIndex(e3, t3, n2) {
              let r2;
              if (n2) {
                r2 = t3;
                for (let n3 = t3 + 1; n3 < this._objects.length; ++n3) if (e3.isOverlapping(this._objects[n3])) {
                  r2 = n3;
                  break;
                }
              } else r2 = t3 + 1;
              return r2;
            }
            collectObjects({ left: e3, top: t3, width: n2, height: r2 }, { includeIntersecting: i2 = true } = {}) {
              let a2 = [], o2 = new N(e3, t3), s2 = o2.add(new N(n2, r2));
              for (let e4 = this._objects.length - 1; e4 >= 0; e4--) {
                let t4 = this._objects[e4];
                t4.selectable && t4.visible && (i2 && t4.intersectsWithRect(o2, s2) || t4.isContainedWithinRect(o2, s2) || i2 && t4.containsPoint(o2) || i2 && t4.containsPoint(s2)) && a2.push(t4);
              }
              return a2;
            }
          }
          return t2;
        }
        var De = class extends be {
          _setOptions(e2 = {}) {
            for (let t2 in e2) this.set(t2, e2[t2]);
          }
          _setObject(e2) {
            for (let t2 in e2) this._set(t2, e2[t2]);
          }
          set(e2, t2) {
            return typeof e2 == `object` ? this._setObject(e2) : this._set(e2, t2), this;
          }
          _set(e2, t2) {
            this[e2] = t2;
          }
          toggle(e2) {
            let t2 = this.get(e2);
            return typeof t2 == `boolean` && this.set(e2, !t2), this;
          }
          get(e2) {
            return this[e2];
          }
        };
        function Oe(e2) {
          return _().requestAnimationFrame(e2);
        }
        function ke(e2) {
          return _().cancelAnimationFrame(e2);
        }
        let Ae = 0, je = () => Ae++, P = () => {
          let e2 = g().createElement(`canvas`);
          if (!e2 || e2.getContext === void 0) throw new l("Failed to create `canvas` element");
          return e2;
        }, Me = () => g().createElement(`img`), Ne = (e2) => {
          var t2;
          let n2 = F(e2);
          return (t2 = n2.getContext(`2d`)) == null || t2.drawImage(e2, 0, 0), n2;
        }, F = (e2) => {
          let t2 = P();
          return t2.width = e2.width, t2.height = e2.height, t2;
        }, Pe = (e2, t2, n2) => e2.toDataURL(`image/${t2}`, n2), Fe = (e2, t2, n2) => new Promise((r2, i2) => {
          e2.toBlob(r2, `image/${t2}`, n2);
        }), I = (e2) => e2 * ee, Ie = (e2) => e2 / ee, Le = (e2) => e2.every((e3, t2) => e3 === T[t2]), L = (e2, t2, n2) => new N(e2).transform(t2, n2), R = (e2) => {
          let t2 = 1 / (e2[0] * e2[3] - e2[1] * e2[2]), n2 = [t2 * e2[3], -t2 * e2[1], -t2 * e2[2], t2 * e2[0], 0, 0], { x: r2, y: i2 } = new N(e2[4], e2[5]).transform(n2, true);
          return n2[4] = -r2, n2[5] = -i2, n2;
        }, z = (e2, t2, n2) => [e2[0] * t2[0] + e2[2] * t2[1], e2[1] * t2[0] + e2[3] * t2[1], e2[0] * t2[2] + e2[2] * t2[3], e2[1] * t2[2] + e2[3] * t2[3], n2 ? 0 : e2[0] * t2[4] + e2[2] * t2[5] + e2[4], n2 ? 0 : e2[1] * t2[4] + e2[3] * t2[5] + e2[5]], Re = (e2, t2) => e2.reduceRight((e3, n2) => n2 && e3 ? z(n2, e3, t2) : n2 || e3, void 0) || T.concat(), ze = ([e2, t2]) => Math.atan2(t2, e2), Be = ([e2, t2]) => Math.sqrt(e2 * e2 + t2 * t2), Ve = ([, , e2, t2]) => Math.sqrt(e2 * e2 + t2 * t2), He = (e2) => {
          let t2 = ze(e2), n2 = e2[0] ** 2 + e2[1] ** 2, r2 = Math.sqrt(n2), i2 = (e2[0] * e2[3] - e2[2] * e2[1]) / r2, a2 = Math.atan2(e2[0] * e2[2] + e2[1] * e2[3], n2);
          return { angle: Ie(t2), scaleX: r2, scaleY: i2, skewX: Ie(a2), skewY: 0, translateX: e2[4] || 0, translateY: e2[5] || 0 };
        }, Ue = (e2, t2 = 0) => [1, 0, 0, 1, e2, t2];
        function We({ angle: e2 = 0 } = {}, { x: t2 = 0, y: n2 = 0 } = {}) {
          let r2 = I(e2), i2 = Se(r2), a2 = Ce(r2);
          return [i2, a2, -a2, i2, t2 ? t2 - (i2 * t2 - a2 * n2) : 0, n2 ? n2 - (a2 * t2 + i2 * n2) : 0];
        }
        let Ge = (e2, t2 = e2) => [e2, 0, 0, t2, 0, 0], Ke = (e2) => Math.tan(I(e2)), qe = (e2) => [1, 0, Ke(e2), 1, 0, 0], Je = (e2) => [1, Ke(e2), 0, 1, 0, 0], Ye = ({ scaleX: e2 = 1, scaleY: t2 = 1, flipX: n2 = false, flipY: r2 = false, skewX: i2 = 0, skewY: a2 = 0 }) => {
          let o2 = Ge(n2 ? -e2 : e2, r2 ? -t2 : t2);
          return i2 && (o2 = z(o2, qe(i2), true)), a2 && (o2 = z(o2, Je(a2), true)), o2;
        }, Xe = (e2) => {
          let { translateX: t2 = 0, translateY: n2 = 0, angle: r2 = 0 } = e2, i2 = Ue(t2, n2);
          r2 && (i2 = z(i2, We({ angle: r2 })));
          let a2 = Ye(e2);
          return Le(a2) || (i2 = z(i2, a2)), i2;
        }, Ze = (e2, { signal: t2, crossOrigin: n2 = null } = {}) => new Promise(function(r2, i2) {
          if (t2 && t2.aborted) return i2(new u(`loadImage`));
          let a2 = Me(), o2;
          t2 && (o2 = function(e3) {
            a2.src = ``, i2(e3);
          }, t2.addEventListener(`abort`, o2, { once: true }));
          let s2 = function() {
            a2.onload = a2.onerror = null, o2 && (t2 == null || t2.removeEventListener(`abort`, o2)), r2(a2);
          };
          e2 ? (a2.onload = s2, a2.onerror = function() {
            o2 && (t2 == null || t2.removeEventListener(`abort`, o2)), i2(new l(`Error loading ${a2.src}`));
          }, n2 && (a2.crossOrigin = n2), a2.src = e2) : s2();
        }), Qe = (e2, { signal: t2, reviver: n2 = x } = {}) => new Promise((r2, i2) => {
          let a2 = [];
          t2 && t2.addEventListener(`abort`, i2, { once: true }), Promise.allSettled(e2.map((e3) => M.getClass(e3.type).fromObject(e3, { signal: t2 }))).then(async (t3) => {
            for (let [r3, i3] of t3.entries()) if (i3.status === `fulfilled` && (await n2(e2[r3], i3.value), a2.push(i3.value)), i3.status === `rejected`) {
              let t4 = await n2(e2[r3], void 0, i3.reason);
              t4 && a2.push(t4);
            }
            r2(a2);
          }).catch((e3) => {
            a2.forEach((e4) => {
              e4.dispose && e4.dispose();
            }), i2(e3);
          }).finally(() => {
            t2 && t2.removeEventListener(`abort`, i2);
          });
        }), $e = (e2, { signal: t2 } = {}) => new Promise((n2, r2) => {
          let i2 = [];
          t2 && t2.addEventListener(`abort`, r2, { once: true });
          let a2 = Object.values(e2).map((e3) => e3 && e3.type && M.has(e3.type) ? Qe([e3], { signal: t2 }).then(([e4]) => (i2.push(e4), e4)) : e3), o2 = Object.keys(e2);
          Promise.all(a2).then((e3) => e3.reduce((e4, t3, n3) => (e4[o2[n3]] = t3, e4), {})).then(n2).catch((e3) => {
            i2.forEach((e4) => {
              e4.dispose && e4.dispose();
            }), r2(e3);
          }).finally(() => {
            t2 && t2.removeEventListener(`abort`, r2);
          });
        }), et = (e2, t2 = []) => t2.reduce((t3, n2) => (n2 in e2 && (t3[n2] = e2[n2]), t3), {}), tt = (e2, t2) => Object.keys(e2).reduce((n2, r2) => (t2(e2[r2], r2, e2) && (n2[r2] = e2[r2]), n2), {}), B = (e2, t2) => parseFloat(Number(e2).toFixed(t2)), nt = (e2) => `matrix(` + e2.map((e3) => B(e3, s.NUM_FRACTION_DIGITS)).join(` `) + `)`, V = (e2) => !!e2 && e2.toLive !== void 0, rt = (e2) => !!e2 && typeof e2.toObject == `function`, it = (e2) => !!e2 && e2.offsetX !== void 0 && `source` in e2, at = (e2) => !!e2 && `multiSelectionStacking` in e2;
        function ot(e2) {
          let t2 = e2 && H(e2), n2 = 0, r2 = 0;
          if (!e2 || !t2) return { left: n2, top: r2 };
          let i2 = e2, a2 = t2.documentElement, o2 = t2.body || { scrollLeft: 0, scrollTop: 0 };
          for (; i2 && (i2.parentNode || i2.host) && (i2 = i2.parentNode || i2.host, i2 === t2 ? (n2 = o2.scrollLeft || a2.scrollLeft || 0, r2 = o2.scrollTop || a2.scrollTop || 0) : (n2 += i2.scrollLeft || 0, r2 += i2.scrollTop || 0), i2.nodeType !== 1 || i2.style.position !== `fixed`); ) ;
          return { left: n2, top: r2 };
        }
        let H = (e2) => e2.ownerDocument || null, st = (e2) => {
          var t2;
          return ((t2 = e2.ownerDocument) == null ? void 0 : t2.defaultView) || null;
        }, ct = (e2, t2, { width: n2, height: r2 }, i2 = 1) => {
          e2.width = n2, e2.height = r2, i2 > 1 && (e2.setAttribute(`width`, (n2 * i2).toString()), e2.setAttribute(`height`, (r2 * i2).toString()), t2.scale(i2, i2));
        }, lt = (e2, { width: t2, height: n2 }) => {
          t2 && (e2.style.width = typeof t2 == `number` ? `${t2}px` : t2), n2 && (e2.style.height = typeof n2 == `number` ? `${n2}px` : n2);
        };
        function ut(e2) {
          return e2.onselectstart !== void 0 && (e2.onselectstart = () => false), e2.style.userSelect = te, e2;
        }
        var dt = class {
          constructor(e2) {
            a(this, `_originalCanvasStyle`, void 0), a(this, `lower`, void 0);
            let t2 = this.createLowerCanvas(e2);
            this.lower = { el: t2, ctx: t2.getContext(`2d`) };
          }
          createLowerCanvas(e2) {
            let t2 = (n2 = e2) && n2.getContext !== void 0 ? e2 : e2 && g().getElementById(e2) || P();
            var n2;
            if (t2.hasAttribute(`data-fabric`)) throw new l(`Trying to initialize a canvas that has already been initialized. Did you forget to dispose the canvas?`);
            return this._originalCanvasStyle = t2.style.cssText, t2.setAttribute(`data-fabric`, `main`), t2.classList.add(`lower-canvas`), t2;
          }
          cleanupDOM({ width: e2, height: t2 }) {
            let { el: n2 } = this.lower;
            n2.classList.remove(`lower-canvas`), n2.removeAttribute(`data-fabric`), n2.setAttribute(`width`, `${e2}`), n2.setAttribute(`height`, `${t2}`), n2.style.cssText = this._originalCanvasStyle || ``, this._originalCanvasStyle = void 0;
          }
          setDimensions(e2, t2) {
            let { el: n2, ctx: r2 } = this.lower;
            ct(n2, r2, e2, t2);
          }
          setCSSDimensions(e2) {
            lt(this.lower.el, e2);
          }
          calcOffset() {
            return function(e2) {
              var t2;
              let n2 = e2 && H(e2), r2 = { left: 0, top: 0 };
              if (!n2) return r2;
              let i2 = ((t2 = st(e2)) == null ? void 0 : t2.getComputedStyle(e2, null)) || {};
              r2.left += parseInt(i2.borderLeftWidth, 10) || 0, r2.top += parseInt(i2.borderTopWidth, 10) || 0, r2.left += parseInt(i2.paddingLeft, 10) || 0, r2.top += parseInt(i2.paddingTop, 10) || 0;
              let a2 = { left: 0, top: 0 }, o2 = n2.documentElement;
              e2.getBoundingClientRect !== void 0 && (a2 = e2.getBoundingClientRect());
              let s2 = ot(e2);
              return { left: a2.left + s2.left - (o2.clientLeft || 0) + r2.left, top: a2.top + s2.top - (o2.clientTop || 0) + r2.top };
            }(this.lower.el);
          }
          dispose() {
            h().dispose(this.lower.el), delete this.lower;
          }
        };
        let ft = { backgroundVpt: true, backgroundColor: ``, overlayVpt: true, overlayColor: ``, includeDefaultValues: true, svgViewportTransformation: true, renderOnAddRemove: true, skipOffscreen: true, enableRetinaScaling: true, imageSmoothingEnabled: true, controlsAboveOverlay: false, allowTouchScrolling: false, viewportTransform: [...T], patternQuality: `best` };
        var pt = n({ capitalize: () => mt, escapeXml: () => U, graphemeSplit: () => gt });
        let mt = (e2, t2 = false) => `${e2.charAt(0).toUpperCase()}${t2 ? e2.slice(1) : e2.slice(1).toLowerCase()}`, U = (e2) => e2.toString().replace(/&/g, `&amp;`).replace(/"/g, `&quot;`).replace(/'/g, `&apos;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`), ht, gt = (e2) => {
          if (ht || ht || (ht = `Intl` in _() && `Segmenter` in Intl && new Intl.Segmenter(void 0, { granularity: `grapheme` })), ht) {
            let t2 = ht.segment(e2);
            return Array.from(t2).map(({ segment: e3 }) => e3);
          }
          return _t(e2);
        }, _t = (e2) => {
          let t2 = [];
          for (let n2, r2 = 0; r2 < e2.length; r2++) false !== (n2 = vt(e2, r2)) && t2.push(n2);
          return t2;
        }, vt = (e2, t2) => {
          let n2 = e2.charCodeAt(t2);
          if (isNaN(n2)) return ``;
          if (n2 < 55296 || n2 > 57343) return e2.charAt(t2);
          if (55296 <= n2 && n2 <= 56319) {
            if (e2.length <= t2 + 1) throw `High surrogate without following low surrogate`;
            let n3 = e2.charCodeAt(t2 + 1);
            if (56320 > n3 || n3 > 57343) throw `High surrogate without following low surrogate`;
            return e2.charAt(t2) + e2.charAt(t2 + 1);
          }
          if (t2 === 0) throw `Low surrogate without preceding high surrogate`;
          let r2 = e2.charCodeAt(t2 - 1);
          if (55296 > r2 || r2 > 56319) throw `Low surrogate without preceding high surrogate`;
          return false;
        };
        var yt = class e2 extends Ee(De) {
          get lowerCanvasEl() {
            var e3;
            return (e3 = this.elements.lower) == null ? void 0 : e3.el;
          }
          get contextContainer() {
            var e3;
            return (e3 = this.elements.lower) == null ? void 0 : e3.ctx;
          }
          static getDefaults() {
            return e2.ownDefaults;
          }
          constructor(e3, t2 = {}) {
            super(), Object.assign(this, this.constructor.getDefaults()), this.set(t2), this.initElements(e3), this._setDimensionsImpl({ width: this.width || this.elements.lower.el.width || 0, height: this.height || this.elements.lower.el.height || 0 }), this.skipControlsDrawing = false, this.viewportTransform = [...this.viewportTransform], this.calcViewportBoundaries();
          }
          initElements(e3) {
            this.elements = new dt(e3);
          }
          add(...e3) {
            let t2 = super.add(...e3);
            return e3.length > 0 && this.renderOnAddRemove && this.requestRenderAll(), t2;
          }
          insertAt(e3, ...t2) {
            let n2 = super.insertAt(e3, ...t2);
            return t2.length > 0 && this.renderOnAddRemove && this.requestRenderAll(), n2;
          }
          remove(...e3) {
            let t2 = super.remove(...e3);
            return t2.length > 0 && this.renderOnAddRemove && this.requestRenderAll(), t2;
          }
          _onObjectAdded(e3) {
            e3.canvas && e3.canvas !== this && (c(`warn`, `Canvas is trying to add an object that belongs to a different canvas.
Resulting to default behavior: removing object from previous canvas and adding to new canvas`), e3.canvas.remove(e3)), e3._set(`canvas`, this), e3.setCoords(), this.fire(`object:added`, { target: e3 }), e3.fire(`added`, { target: this });
          }
          _onObjectRemoved(e3) {
            e3._set(`canvas`, void 0), this.fire(`object:removed`, { target: e3 }), e3.fire(`removed`, { target: this });
          }
          _onStackOrderChanged() {
            this.renderOnAddRemove && this.requestRenderAll();
          }
          getRetinaScaling() {
            return this.enableRetinaScaling ? v() : 1;
          }
          calcOffset() {
            return this._offset = this.elements.calcOffset();
          }
          getWidth() {
            return this.width;
          }
          getHeight() {
            return this.height;
          }
          _setDimensionsImpl(e3, { cssOnly: t2 = false, backstoreOnly: n2 = false } = {}) {
            if (!t2) {
              let t3 = { width: this.width, height: this.height, ...e3 };
              this.elements.setDimensions(t3, this.getRetinaScaling()), this.hasLostContext = true, this.width = t3.width, this.height = t3.height;
            }
            n2 || this.elements.setCSSDimensions(e3), this.calcOffset();
          }
          setDimensions(e3, t2) {
            this._setDimensionsImpl(e3, t2), t2 && t2.cssOnly || this.requestRenderAll();
          }
          getZoom() {
            return Be(this.viewportTransform);
          }
          setViewportTransform(e3) {
            this.viewportTransform = e3, this.calcViewportBoundaries(), this.renderOnAddRemove && this.requestRenderAll();
          }
          zoomToPoint(e3, t2) {
            let n2 = e3, r2 = [...this.viewportTransform], i2 = L(e3, R(r2));
            r2[0] = t2, r2[3] = t2;
            let a2 = L(i2, r2);
            r2[4] += n2.x - a2.x, r2[5] += n2.y - a2.y, this.setViewportTransform(r2);
          }
          setZoom(e3) {
            this.zoomToPoint(new N(0, 0), e3);
          }
          absolutePan(e3) {
            let t2 = [...this.viewportTransform];
            return t2[4] = -e3.x, t2[5] = -e3.y, this.setViewportTransform(t2);
          }
          relativePan(e3) {
            return this.absolutePan(new N(-e3.x - this.viewportTransform[4], -e3.y - this.viewportTransform[5]));
          }
          getElement() {
            return this.elements.lower.el;
          }
          clearContext(e3) {
            e3.clearRect(0, 0, this.width, this.height);
          }
          getContext() {
            return this.elements.lower.ctx;
          }
          clear() {
            this.remove(...this.getObjects()), this.backgroundImage = void 0, this.overlayImage = void 0, this.backgroundColor = ``, this.overlayColor = ``, this.clearContext(this.getContext()), this.fire(`canvas:cleared`), this.renderOnAddRemove && this.requestRenderAll();
          }
          renderAll() {
            this.cancelRequestedRender(), this.destroyed || this.renderCanvas(this.getContext(), this._objects);
          }
          renderAndReset() {
            this.nextRenderHandle = 0, this.renderAll();
          }
          requestRenderAll() {
            this.nextRenderHandle || this.disposed || this.destroyed || (this.nextRenderHandle = Oe(() => this.renderAndReset()));
          }
          calcViewportBoundaries() {
            let e3 = this.width, t2 = this.height, n2 = R(this.viewportTransform), r2 = L({ x: 0, y: 0 }, n2), i2 = L({ x: e3, y: t2 }, n2), a2 = r2.min(i2), o2 = r2.max(i2);
            return this.vptCoords = { tl: a2, tr: new N(o2.x, a2.y), bl: new N(a2.x, o2.y), br: o2 };
          }
          cancelRequestedRender() {
            this.nextRenderHandle && (ke(this.nextRenderHandle), this.nextRenderHandle = 0);
          }
          drawControls(e3) {
          }
          renderCanvas(e3, t2) {
            if (this.destroyed) return;
            let n2 = this.viewportTransform, r2 = this.clipPath;
            this.calcViewportBoundaries(), this.clearContext(e3), e3.imageSmoothingEnabled = this.imageSmoothingEnabled, e3.patternQuality = this.patternQuality, this.fire(`before:render`, { ctx: e3 }), this._renderBackground(e3), e3.save(), e3.transform(n2[0], n2[1], n2[2], n2[3], n2[4], n2[5]), this._renderObjects(e3, t2), e3.restore(), this.controlsAboveOverlay || this.skipControlsDrawing || this.drawControls(e3), r2 && (r2._set(`canvas`, this), r2.shouldCache(), r2._transformDone = true, r2.renderCache({ forClipping: true }), this.drawClipPathOnCanvas(e3, r2)), this._renderOverlay(e3), this.controlsAboveOverlay && !this.skipControlsDrawing && this.drawControls(e3), this.fire(`after:render`, { ctx: e3 }), this.__cleanupTask && (this.__cleanupTask(), this.__cleanupTask = void 0);
          }
          drawClipPathOnCanvas(e3, t2) {
            let n2 = this.viewportTransform;
            e3.save(), e3.transform(...n2), e3.globalCompositeOperation = `destination-in`, t2.transform(e3), e3.scale(1 / t2.zoomX, 1 / t2.zoomY), e3.drawImage(t2._cacheCanvas, -t2.cacheTranslationX, -t2.cacheTranslationY), e3.restore();
          }
          _renderObjects(e3, t2) {
            for (let n2 = 0, r2 = t2.length; n2 < r2; ++n2) t2[n2] && t2[n2].render(e3);
          }
          _renderBackgroundOrOverlay(e3, t2) {
            let n2 = this[`${t2}Color`], r2 = this[`${t2}Image`], i2 = this.viewportTransform, a2 = this[`${t2}Vpt`];
            if (!n2 && !r2) return;
            let o2 = V(n2);
            if (n2) {
              if (e3.save(), e3.beginPath(), e3.moveTo(0, 0), e3.lineTo(this.width, 0), e3.lineTo(this.width, this.height), e3.lineTo(0, this.height), e3.closePath(), e3.fillStyle = o2 ? n2.toLive(e3) : n2, a2 && e3.transform(...i2), o2) {
                e3.transform(1, 0, 0, 1, n2.offsetX || 0, n2.offsetY || 0);
                let t3 = n2.gradientTransform || n2.patternTransform;
                t3 && e3.transform(...t3);
              }
              e3.fill(), e3.restore();
            }
            if (r2) {
              e3.save();
              let { skipOffscreen: t3 } = this;
              this.skipOffscreen = a2, a2 && e3.transform(...i2), r2.render(e3), this.skipOffscreen = t3, e3.restore();
            }
          }
          _renderBackground(e3) {
            this._renderBackgroundOrOverlay(e3, `background`);
          }
          _renderOverlay(e3) {
            this._renderBackgroundOrOverlay(e3, `overlay`);
          }
          getCenterPoint() {
            return new N(this.width / 2, this.height / 2);
          }
          centerObjectH(e3) {
            return this._centerObject(e3, new N(this.getCenterPoint().x, e3.getCenterPoint().y));
          }
          centerObjectV(e3) {
            return this._centerObject(e3, new N(e3.getCenterPoint().x, this.getCenterPoint().y));
          }
          centerObject(e3) {
            return this._centerObject(e3, this.getCenterPoint());
          }
          viewportCenterObject(e3) {
            return this._centerObject(e3, this.getVpCenter());
          }
          viewportCenterObjectH(e3) {
            return this._centerObject(e3, new N(this.getVpCenter().x, e3.getCenterPoint().y));
          }
          viewportCenterObjectV(e3) {
            return this._centerObject(e3, new N(e3.getCenterPoint().x, this.getVpCenter().y));
          }
          getVpCenter() {
            return L(this.getCenterPoint(), R(this.viewportTransform));
          }
          _centerObject(e3, t2) {
            e3.setXY(t2, E, E), e3.setCoords(), this.renderOnAddRemove && this.requestRenderAll();
          }
          toDatalessJSON(e3) {
            return this.toDatalessObject(e3);
          }
          toObject(e3) {
            return this._toObjectMethod(`toObject`, e3);
          }
          toJSON() {
            return this.toObject();
          }
          toDatalessObject(e3) {
            return this._toObjectMethod(`toDatalessObject`, e3);
          }
          _toObjectMethod(e3, t2) {
            let n2 = this.clipPath, r2 = n2 && !n2.excludeFromExport ? this._toObject(n2, e3, t2) : null;
            return { version: b, ...et(this, t2), objects: this._objects.filter((e4) => !e4.excludeFromExport).map((n3) => this._toObject(n3, e3, t2)), ...this.__serializeBgOverlay(e3, t2), ...r2 ? { clipPath: r2 } : null };
          }
          _toObject(e3, t2, n2) {
            let r2;
            this.includeDefaultValues || (r2 = e3.includeDefaultValues, e3.includeDefaultValues = false);
            let i2 = e3[t2](n2);
            return this.includeDefaultValues || (e3.includeDefaultValues = !!r2), i2;
          }
          __serializeBgOverlay(e3, t2) {
            let n2 = {}, r2 = this.backgroundImage, i2 = this.overlayImage, a2 = this.backgroundColor, o2 = this.overlayColor;
            return V(a2) ? a2.excludeFromExport || (n2.background = a2.toObject(t2)) : a2 && (n2.background = a2), V(o2) ? o2.excludeFromExport || (n2.overlay = o2.toObject(t2)) : o2 && (n2.overlay = o2), r2 && !r2.excludeFromExport && (n2.backgroundImage = this._toObject(r2, e3, t2)), i2 && !i2.excludeFromExport && (n2.overlayImage = this._toObject(i2, e3, t2)), n2;
          }
          toSVG(e3 = {}, t2) {
            e3.reviver = t2;
            let n2 = [];
            var r2;
            return (this._setSVGPreamble(n2, e3), this._setSVGHeader(n2, e3), this.clipPath) && n2.push(`<g clip-path="url(#${U((r2 = this.clipPath.clipPathId) == null ? `` : r2)})" >
`), this._setSVGBgOverlayColor(n2, `background`), this._setSVGBgOverlayImage(n2, `backgroundImage`, t2), this._setSVGObjects(n2, t2), this.clipPath && n2.push(`</g>
`), this._setSVGBgOverlayColor(n2, `overlay`), this._setSVGBgOverlayImage(n2, `overlayImage`, t2), n2.push(`</svg>`), n2.join(``);
          }
          _setSVGPreamble(e3, t2) {
            t2.suppressPreamble || e3.push(`<?xml version="1.0" encoding="`, t2.encoding || `UTF-8`, `" standalone="no" ?>
`, `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" `, `"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
`);
          }
          _setSVGHeader(e3, t2) {
            let n2 = t2.width || `${this.width}`, r2 = t2.height || `${this.height}`, i2 = s.NUM_FRACTION_DIGITS, a2 = t2.viewBox, o2;
            if (a2) o2 = `viewBox="${a2.x} ${a2.y} ${a2.width} ${a2.height}" `;
            else if (this.svgViewportTransformation) {
              let e4 = this.viewportTransform;
              o2 = `viewBox="${B(-e4[4] / e4[0], i2)} ${B(-e4[5] / e4[3], i2)} ${B(this.width / e4[0], i2)} ${B(this.height / e4[3], i2)}" `;
            } else o2 = `viewBox="0 0 ${this.width} ${this.height}" `;
            e3.push(`<svg `, `xmlns="http://www.w3.org/2000/svg" `, `xmlns:xlink="http://www.w3.org/1999/xlink" `, `version="1.1" `, `width="`, n2, `" `, `height="`, r2, `" `, o2, `xml:space="preserve">
`, `<desc>Created with Fabric.js `, b, `</desc>
`, `<defs>
`, this.createSVGFontFacesMarkup(), this.createSVGRefElementsMarkup(), this.createSVGClipPathMarkup(t2), `</defs>
`);
          }
          createSVGClipPathMarkup(e3) {
            let t2 = this.clipPath;
            return t2 ? (t2.clipPathId = `CLIPPATH_${je()}`, `<clipPath id="${t2.clipPathId}" >
${t2.toClipPathSVG(e3.reviver)}</clipPath>
`) : ``;
          }
          createSVGRefElementsMarkup() {
            return [`background`, `overlay`].map((e3) => {
              let t2 = this[`${e3}Color`];
              if (V(t2)) {
                let n2 = this[`${e3}Vpt`], r2 = this.viewportTransform, i2 = { isType: () => false, width: this.width / (n2 ? r2[0] : 1), height: this.height / (n2 ? r2[3] : 1) };
                return t2.toSVG(i2, { additionalTransform: n2 ? nt(r2) : `` });
              }
            }).join(``);
          }
          createSVGFontFacesMarkup() {
            let e3 = [], t2 = {}, n2 = s.fontPaths;
            this._objects.forEach(function t3(n3) {
              e3.push(n3), Te(n3) && n3._objects.forEach(t3);
            }), e3.forEach((e4) => {
              if (!(r3 = e4) || typeof r3._renderText != `function`) return;
              var r3;
              let { styles: i2, fontFamily: a2 } = e4;
              !t2[a2] && n2[a2] && (t2[a2] = true, i2 && Object.values(i2).forEach((e5) => {
                Object.values(e5).forEach(({ fontFamily: e6 = `` }) => {
                  !t2[e6] && n2[e6] && (t2[e6] = true);
                });
              }));
            });
            let r2 = Object.keys(t2).map((e4) => `		@font-face {
			font-family: '${e4}';
			src: url('${n2[e4]}');
		}
`).join(``);
            return r2 ? `	<style type="text/css"><![CDATA[
${r2}]]></style>
` : ``;
          }
          _setSVGObjects(e3, t2) {
            this.forEachObject((n2) => {
              n2.excludeFromExport || this._setSVGObject(e3, n2, t2);
            });
          }
          _setSVGObject(e3, t2, n2) {
            e3.push(t2.toSVG(n2));
          }
          _setSVGBgOverlayImage(e3, t2, n2) {
            let r2 = this[t2];
            r2 && !r2.excludeFromExport && r2.toSVG && e3.push(r2.toSVG(n2));
          }
          _setSVGBgOverlayColor(e3, t2) {
            let n2 = this[`${t2}Color`];
            if (n2) if (V(n2)) {
              let r2 = n2.repeat || ``, i2 = this.width, a2 = this.height, o2 = this[`${t2}Vpt`] ? nt(R(this.viewportTransform)) : ``;
              e3.push(`<rect transform="${o2} translate(${i2 / 2},${a2 / 2})" x="${n2.offsetX - i2 / 2}" y="${n2.offsetY - a2 / 2}" width="${r2 !== `repeat-y` && r2 !== `no-repeat` || !it(n2) ? i2 : n2.source.width}" height="${r2 !== `repeat-x` && r2 !== `no-repeat` || !it(n2) ? a2 : n2.source.height}" fill="url(#SVGID_${n2.id})"></rect>
`);
            } else e3.push(`<rect x="0" y="0" width="100%" height="100%" `, `fill="`, n2, `"`, `></rect>
`);
          }
          loadFromJSON(e3, t2, { signal: n2 } = {}) {
            if (!e3) return Promise.reject(new l("`json` is undefined"));
            let { objects: r2 = [], ...i2 } = typeof e3 == `string` ? JSON.parse(e3) : e3, { backgroundImage: a2, background: o2, overlayImage: s2, overlay: c2, clipPath: u2 } = i2, d2 = this.renderOnAddRemove;
            return this.renderOnAddRemove = false, Promise.all([Qe(r2, { reviver: t2, signal: n2 }), $e({ backgroundImage: a2, backgroundColor: o2, overlayImage: s2, overlayColor: c2, clipPath: u2 }, { signal: n2 })]).then(([e4, t3]) => (this.clear(), this.add(...e4), this.set(i2), this.set(t3), this.renderOnAddRemove = d2, this));
          }
          clone(e3) {
            let t2 = this.toObject(e3);
            return this.cloneWithoutData().loadFromJSON(t2);
          }
          cloneWithoutData() {
            let e3 = F(this);
            return new this.constructor(e3);
          }
          toDataURL(e3 = {}) {
            let { format: t2 = `png`, quality: n2 = 1, multiplier: r2 = 1, enableRetinaScaling: i2 = false } = e3, a2 = r2 * (i2 ? this.getRetinaScaling() : 1);
            return Pe(this.toCanvasElement(a2, e3), t2, n2);
          }
          toBlob(e3 = {}) {
            let { format: t2 = `png`, quality: n2 = 1, multiplier: r2 = 1, enableRetinaScaling: i2 = false } = e3, a2 = r2 * (i2 ? this.getRetinaScaling() : 1);
            return Fe(this.toCanvasElement(a2, e3), t2, n2);
          }
          toCanvasElement(e3 = 1, { width: t2, height: n2, left: r2, top: i2, filter: a2 } = {}) {
            let o2 = (t2 || this.width) * e3, s2 = (n2 || this.height) * e3, c2 = this.getZoom(), l2 = this.width, u2 = this.height, d2 = this.skipControlsDrawing, f2 = c2 * e3, p2 = this.viewportTransform, m2 = [f2, 0, 0, f2, (p2[4] - (r2 || 0)) * e3, (p2[5] - (i2 || 0)) * e3], h2 = this.enableRetinaScaling, g2 = F({ width: o2, height: s2 }), _2 = a2 ? this._objects.filter((e4) => a2(e4)) : this._objects;
            return this.enableRetinaScaling = false, this.viewportTransform = m2, this.width = o2, this.height = s2, this.skipControlsDrawing = true, this.calcViewportBoundaries(), this.renderCanvas(g2.getContext(`2d`), _2), this.viewportTransform = p2, this.width = l2, this.height = u2, this.calcViewportBoundaries(), this.enableRetinaScaling = h2, this.skipControlsDrawing = d2, g2;
          }
          dispose() {
            return !this.disposed && this.elements.cleanupDOM({ width: this.width, height: this.height }), ye.cancelByCanvas(this), this.disposed = true, new Promise((e3, t2) => {
              let n2 = () => {
                this.destroy(), e3(true);
              };
              n2.kill = t2, this.__cleanupTask && this.__cleanupTask.kill(`aborted`), this.destroyed ? e3(false) : this.nextRenderHandle ? this.__cleanupTask = n2 : n2();
            });
          }
          destroy() {
            this.destroyed = true, this.cancelRequestedRender(), this.forEachObject((e3) => e3.dispose()), this._objects = [], this.backgroundImage && this.backgroundImage.dispose(), this.backgroundImage = void 0, this.overlayImage && this.overlayImage.dispose(), this.overlayImage = void 0, this.elements.dispose();
          }
          toString() {
            return `#<Canvas (${this.complexity()}): { objects: ${this._objects.length} }>`;
          }
        };
        a(yt, `ownDefaults`, ft);
        let bt = [`touchstart`, `touchmove`, `touchend`], xt = (e2) => {
          let t2 = ot(e2.target), n2 = function(e3) {
            let t3 = e3.changedTouches;
            return t3 && t3[0] ? t3[0] : e3;
          }(e2);
          return new N(n2.clientX + t2.left, n2.clientY + t2.top);
        }, St = (e2) => bt.includes(e2.type) || e2.pointerType === `touch`, Ct = (e2) => {
          e2.preventDefault(), e2.stopPropagation();
        }, wt = (e2) => {
          let t2 = 0, n2 = 0, r2 = 0, i2 = 0;
          for (let a2 = 0, o2 = e2.length; a2 < o2; a2++) {
            let { x: o3, y: s2 } = e2[a2];
            (o3 > r2 || !a2) && (r2 = o3), (o3 < t2 || !a2) && (t2 = o3), (s2 > i2 || !a2) && (i2 = s2), (s2 < n2 || !a2) && (n2 = s2);
          }
          return { left: t2, top: n2, width: r2 - t2, height: i2 - n2 };
        }, Tt = (e2, t2) => {
          Dt(e2, z(R(t2), e2.calcOwnMatrix()));
        }, Et = (e2, t2) => Dt(e2, z(t2, e2.calcOwnMatrix())), Dt = (e2, t2) => {
          let { translateX: n2, translateY: r2, scaleX: i2, scaleY: a2, ...o2 } = He(t2), s2 = new N(n2, r2);
          e2.flipX = false, e2.flipY = false, Object.assign(e2, o2), e2.set({ scaleX: i2, scaleY: a2 }), e2.setPositionByOrigin(s2, E, E);
        }, Ot = (e2) => {
          e2.scaleX = 1, e2.scaleY = 1, e2.skewX = 0, e2.skewY = 0, e2.flipX = false, e2.flipY = false, e2.rotate(0);
        }, kt = (e2) => ({ scaleX: e2.scaleX, scaleY: e2.scaleY, skewX: e2.skewX, skewY: e2.skewY, angle: e2.angle, left: e2.left, flipX: e2.flipX, flipY: e2.flipY, top: e2.top }), At = (e2, t2, n2) => {
          let r2 = e2 / 2, i2 = t2 / 2, a2 = wt([new N(-r2, -i2), new N(r2, -i2), new N(-r2, i2), new N(r2, i2)].map((e3) => e3.transform(n2)));
          return new N(a2.width, a2.height);
        }, jt = (e2 = T, t2 = T) => z(R(t2), e2), Mt = (e2, t2 = T, n2 = T) => e2.transform(jt(t2, n2)), Nt = (e2, t2 = T, n2 = T) => e2.transform(jt(t2, n2), true), Pt = (e2, t2, n2) => {
          let r2 = jt(t2, n2);
          return Dt(e2, z(r2, e2.calcOwnMatrix())), r2;
        }, Ft = { left: -0.5, top: -0.5, center: 0, bottom: 0.5, right: 0.5 }, W = (e2) => typeof e2 == `string` ? Ft[e2] : e2 - 0.5, It = new N(1, 0), Lt = new N(), Rt = (e2, t2) => e2.rotate(t2), zt = (e2, t2) => new N(t2).subtract(e2), Bt = (e2) => e2.distanceFrom(Lt), Vt = (e2, t2) => Math.atan2(Gt(e2, t2), Kt(e2, t2)), Ht = (e2) => Vt(It, e2), Ut = (e2) => e2.eq(Lt) ? e2 : e2.scalarDivide(Bt(e2)), Wt = (e2, t2 = true) => Ut(new N(-e2.y, e2.x).scalarMultiply(t2 ? 1 : -1)), Gt = (e2, t2) => e2.x * t2.y - e2.y * t2.x, Kt = (e2, t2) => e2.x * t2.x + e2.y * t2.y, qt = (e2, t2, n2) => {
          if (e2.eq(t2) || e2.eq(n2)) return true;
          let r2 = Gt(t2, n2), i2 = Gt(t2, e2), a2 = Gt(n2, e2);
          return r2 >= 0 ? i2 >= 0 && a2 <= 0 : !(i2 <= 0 && a2 >= 0);
        }, Jt = `not-allowed`;
        function Yt(e2) {
          return W(e2.originX) === W(`center`) && W(e2.originY) === W(`center`);
        }
        function Xt(e2) {
          return 0.5 - W(e2);
        }
        let Zt = (e2, t2) => e2[t2], Qt = (e2, t2, n2, r2) => ({ e: e2, transform: t2, pointer: new N(n2, r2) });
        function $t(e2, t2, n2) {
          let r2 = n2, i2 = Ht(zt(Mt(e2.getCenterPoint(), e2.canvas.viewportTransform, void 0), r2)) + w;
          return Math.round(i2 % w / C);
        }
        function en({ target: e2, corner: t2 }, n2, r2, i2, a2) {
          var o2;
          let s2 = e2.controls[t2], c2 = ((o2 = e2.canvas) == null ? void 0 : o2.getZoom()) || 1, l2 = e2.padding / c2, u2 = function(e3, t3, n3, r3) {
            let i3 = e3.getRelativeCenterPoint(), a3 = n3 !== void 0 && r3 !== void 0 ? e3.translateToGivenOrigin(i3, E, E, n3, r3) : new N(e3.left, e3.top);
            return (e3.angle ? t3.rotate(-I(e3.angle), i3) : t3).subtract(a3);
          }(e2, new N(i2, a2), n2, r2);
          return u2.x >= l2 && (u2.x -= l2), u2.x <= -l2 && (u2.x += l2), u2.y >= l2 && (u2.y -= l2), u2.y <= l2 && (u2.y += l2), u2.x -= s2.offsetX, u2.y -= s2.offsetY, u2;
        }
        let tn = new RegExp(String.raw`[\0-\x1F\x7F;<>\\]|\/\*|\*\/|url\s*\(|expression\s*\(|(?:java|vb)script\s*:|data\s*:|@import\b`, `iu`), nn = (e2) => typeof e2 == `string` && e2.trim().length > 0 && !tn.test(e2), rn = (e2, t2 = ``) => {
          let n2 = Number(e2);
          return Number.isFinite(n2) ? `${n2}` : t2;
        }, an = (e2, t2 = ``) => typeof e2 == `string` && nn(e2) ? e2 : t2, on = (e2) => e2.replace(/\s+/g, ` `), sn = { aliceblue: `#F0F8FF`, antiquewhite: `#FAEBD7`, aqua: `#0FF`, aquamarine: `#7FFFD4`, azure: `#F0FFFF`, beige: `#F5F5DC`, bisque: `#FFE4C4`, black: `#000`, blanchedalmond: `#FFEBCD`, blue: `#00F`, blueviolet: `#8A2BE2`, brown: `#A52A2A`, burlywood: `#DEB887`, cadetblue: `#5F9EA0`, chartreuse: `#7FFF00`, chocolate: `#D2691E`, coral: `#FF7F50`, cornflowerblue: `#6495ED`, cornsilk: `#FFF8DC`, crimson: `#DC143C`, cyan: `#0FF`, darkblue: `#00008B`, darkcyan: `#008B8B`, darkgoldenrod: `#B8860B`, darkgray: `#A9A9A9`, darkgrey: `#A9A9A9`, darkgreen: `#006400`, darkkhaki: `#BDB76B`, darkmagenta: `#8B008B`, darkolivegreen: `#556B2F`, darkorange: `#FF8C00`, darkorchid: `#9932CC`, darkred: `#8B0000`, darksalmon: `#E9967A`, darkseagreen: `#8FBC8F`, darkslateblue: `#483D8B`, darkslategray: `#2F4F4F`, darkslategrey: `#2F4F4F`, darkturquoise: `#00CED1`, darkviolet: `#9400D3`, deeppink: `#FF1493`, deepskyblue: `#00BFFF`, dimgray: `#696969`, dimgrey: `#696969`, dodgerblue: `#1E90FF`, firebrick: `#B22222`, floralwhite: `#FFFAF0`, forestgreen: `#228B22`, fuchsia: `#F0F`, gainsboro: `#DCDCDC`, ghostwhite: `#F8F8FF`, gold: `#FFD700`, goldenrod: `#DAA520`, gray: `#808080`, grey: `#808080`, green: `#008000`, greenyellow: `#ADFF2F`, honeydew: `#F0FFF0`, hotpink: `#FF69B4`, indianred: `#CD5C5C`, indigo: `#4B0082`, ivory: `#FFFFF0`, khaki: `#F0E68C`, lavender: `#E6E6FA`, lavenderblush: `#FFF0F5`, lawngreen: `#7CFC00`, lemonchiffon: `#FFFACD`, lightblue: `#ADD8E6`, lightcoral: `#F08080`, lightcyan: `#E0FFFF`, lightgoldenrodyellow: `#FAFAD2`, lightgray: `#D3D3D3`, lightgrey: `#D3D3D3`, lightgreen: `#90EE90`, lightpink: `#FFB6C1`, lightsalmon: `#FFA07A`, lightseagreen: `#20B2AA`, lightskyblue: `#87CEFA`, lightslategray: `#789`, lightslategrey: `#789`, lightsteelblue: `#B0C4DE`, lightyellow: `#FFFFE0`, lime: `#0F0`, limegreen: `#32CD32`, linen: `#FAF0E6`, magenta: `#F0F`, maroon: `#800000`, mediumaquamarine: `#66CDAA`, mediumblue: `#0000CD`, mediumorchid: `#BA55D3`, mediumpurple: `#9370DB`, mediumseagreen: `#3CB371`, mediumslateblue: `#7B68EE`, mediumspringgreen: `#00FA9A`, mediumturquoise: `#48D1CC`, mediumvioletred: `#C71585`, midnightblue: `#191970`, mintcream: `#F5FFFA`, mistyrose: `#FFE4E1`, moccasin: `#FFE4B5`, navajowhite: `#FFDEAD`, navy: `#000080`, oldlace: `#FDF5E6`, olive: `#808000`, olivedrab: `#6B8E23`, orange: `#FFA500`, orangered: `#FF4500`, orchid: `#DA70D6`, palegoldenrod: `#EEE8AA`, palegreen: `#98FB98`, paleturquoise: `#AFEEEE`, palevioletred: `#DB7093`, papayawhip: `#FFEFD5`, peachpuff: `#FFDAB9`, peru: `#CD853F`, pink: `#FFC0CB`, plum: `#DDA0DD`, powderblue: `#B0E0E6`, purple: `#800080`, rebeccapurple: `#639`, red: `#F00`, rosybrown: `#BC8F8F`, royalblue: `#4169E1`, saddlebrown: `#8B4513`, salmon: `#FA8072`, sandybrown: `#F4A460`, seagreen: `#2E8B57`, seashell: `#FFF5EE`, sienna: `#A0522D`, silver: `#C0C0C0`, skyblue: `#87CEEB`, slateblue: `#6A5ACD`, slategray: `#708090`, slategrey: `#708090`, snow: `#FFFAFA`, springgreen: `#00FF7F`, steelblue: `#4682B4`, tan: `#D2B48C`, teal: `#008080`, thistle: `#D8BFD8`, tomato: `#FF6347`, turquoise: `#40E0D0`, violet: `#EE82EE`, wheat: `#F5DEB3`, white: `#FFF`, whitesmoke: `#F5F5F5`, yellow: `#FF0`, yellowgreen: `#9ACD32` }, cn = (e2, t2, n2) => (n2 < 0 && (n2 += 1), n2 > 1 && --n2, n2 < 1 / 6 ? e2 + 6 * (t2 - e2) * n2 : n2 < 0.5 ? t2 : n2 < 2 / 3 ? e2 + (t2 - e2) * (2 / 3 - n2) * 6 : e2), ln = (e2, t2, n2, r2) => {
          e2 /= 255, t2 /= 255, n2 /= 255;
          let i2 = Math.max(e2, t2, n2), a2 = Math.min(e2, t2, n2), o2, s2, c2 = (i2 + a2) / 2;
          if (i2 === a2) o2 = s2 = 0;
          else {
            let r3 = i2 - a2;
            switch (s2 = c2 > 0.5 ? r3 / (2 - i2 - a2) : r3 / (i2 + a2), i2) {
              case e2:
                o2 = (t2 - n2) / r3 + (t2 < n2 ? 6 : 0);
                break;
              case t2:
                o2 = (n2 - e2) / r3 + 2;
                break;
              case n2:
                o2 = (e2 - t2) / r3 + 4;
            }
            o2 /= 6;
          }
          return [Math.round(360 * o2), Math.round(100 * s2), Math.round(100 * c2), r2];
        }, un = (e2 = `1`) => parseFloat(e2) / (e2.endsWith(`%`) ? 100 : 1), dn = (e2) => Math.min(Math.round(e2), 255).toString(16).toUpperCase().padStart(2, `0`), fn = ([e2, t2, n2, r2 = 1]) => {
          let i2 = Math.round(0.3 * e2 + 0.59 * t2 + 0.11 * n2);
          return [i2, i2, i2, r2];
        };
        var G = class e2 {
          constructor(t2) {
            if (a(this, `isUnrecognised`, false), t2) if (t2 instanceof e2) this.setSource([...t2._source]);
            else if (Array.isArray(t2)) {
              let [e3, n2, r2, i2 = 1] = t2;
              this.setSource([e3, n2, r2, i2]);
            } else this.setSource(this._tryParsingColor(t2));
            else this.setSource([0, 0, 0, 1]);
          }
          _tryParsingColor(t2) {
            return (t2 = t2.toLowerCase()) in sn && (t2 = sn[t2]), t2 === `transparent` ? [255, 255, 255, 0] : e2.sourceFromHex(t2) || e2.sourceFromRgb(t2) || e2.sourceFromHsl(t2) || (this.isUnrecognised = true) && [0, 0, 0, 1];
          }
          getSource() {
            return this._source;
          }
          setSource(e3) {
            this._source = e3;
          }
          toRgb() {
            let [e3, t2, n2] = this.getSource();
            return `rgb(${e3},${t2},${n2})`;
          }
          toRgba() {
            return `rgba(${this.getSource().join(`,`)})`;
          }
          toHsl() {
            let [e3, t2, n2] = ln(...this.getSource());
            return `hsl(${e3},${t2}%,${n2}%)`;
          }
          toHsla() {
            let [e3, t2, n2, r2] = ln(...this.getSource());
            return `hsla(${e3},${t2}%,${n2}%,${r2})`;
          }
          toHex() {
            return this.toHexa().slice(0, 6);
          }
          toHexa() {
            let [e3, t2, n2, r2] = this.getSource();
            return `${dn(e3)}${dn(t2)}${dn(n2)}${dn(Math.round(255 * r2))}`;
          }
          getAlpha() {
            return this.getSource()[3];
          }
          setAlpha(e3) {
            return this._source[3] = e3, this;
          }
          toGrayscale() {
            return this.setSource(fn(this.getSource())), this;
          }
          toBlackWhite(e3) {
            let [t2, , , n2] = fn(this.getSource()), r2 = t2 < (e3 || 127) ? 0 : 255;
            return this.setSource([r2, r2, r2, n2]), this;
          }
          overlayWith(t2) {
            t2 instanceof e2 || (t2 = new e2(t2));
            let n2 = this.getSource(), r2 = t2.getSource(), [i2, a2, o2] = n2.map((e3, t3) => Math.round(0.5 * e3 + 0.5 * r2[t3]));
            return this.setSource([i2, a2, o2, n2[3]]), this;
          }
          static fromRgb(t2) {
            return e2.fromRgba(t2);
          }
          static fromRgba(t2) {
            return new e2(e2.sourceFromRgb(t2));
          }
          static sourceFromRgb(e3) {
            let t2 = on(e3).match(/^rgba?\(\s?(\d{0,3}(?:\.\d+)?%?)\s?[\s|,]\s?(\d{0,3}(?:\.\d+)?%?)\s?[\s|,]\s?(\d{0,3}(?:\.\d+)?%?)\s?(?:\s?[,/]\s?(\d{0,3}(?:\.\d+)?%?)\s?)?\)$/i);
            if (t2) {
              let [e4, n2, r2] = t2.slice(1, 4).map((e5) => {
                let t3 = parseFloat(e5);
                return e5.endsWith(`%`) ? Math.round(2.55 * t3) : t3;
              });
              return [e4, n2, r2, un(t2[4])];
            }
          }
          static fromHsl(t2) {
            return e2.fromHsla(t2);
          }
          static fromHsla(t2) {
            return new e2(e2.sourceFromHsl(t2));
          }
          static sourceFromHsl(t2) {
            let n2 = on(t2).match(/^hsla?\(\s?([+-]?\d{0,3}(?:\.\d+)?(?:deg|turn|rad)?)\s?[\s|,]\s?(\d{0,3}(?:\.\d+)?%?)\s?[\s|,]\s?(\d{0,3}(?:\.\d+)?%?)\s?(?:\s?[,/]\s?(\d*(?:\.\d+)?%?)\s?)?\)$/i);
            if (!n2) return;
            let r2 = (e2.parseAngletoDegrees(n2[1]) % 360 + 360) % 360 / 360, i2 = parseFloat(n2[2]) / 100, a2 = parseFloat(n2[3]) / 100, o2, s2, c2;
            if (i2 === 0) o2 = s2 = c2 = a2;
            else {
              let e3 = a2 <= 0.5 ? a2 * (i2 + 1) : a2 + i2 - a2 * i2, t3 = 2 * a2 - e3;
              o2 = cn(t3, e3, r2 + 1 / 3), s2 = cn(t3, e3, r2), c2 = cn(t3, e3, r2 - 1 / 3);
            }
            return [Math.round(255 * o2), Math.round(255 * s2), Math.round(255 * c2), un(n2[4])];
          }
          static fromHex(t2) {
            return new e2(e2.sourceFromHex(t2));
          }
          static sourceFromHex(e3) {
            if (e3.match(/^#?(([0-9a-f]){3,4}|([0-9a-f]{2}){3,4})$/i)) {
              let t2 = e3.slice(e3.indexOf(`#`) + 1), n2;
              n2 = t2.length <= 4 ? t2.split(``).map((e4) => e4 + e4) : t2.match(/.{2}/g);
              let [r2, i2, a2, o2 = 255] = n2.map((e4) => parseInt(e4, 16));
              return [r2, i2, a2, o2 / 255];
            }
          }
          static parseAngletoDegrees(e3) {
            let t2 = e3.toLowerCase(), n2 = parseFloat(t2);
            return t2.includes(`rad`) ? Ie(n2) : t2.includes(`turn`) ? 360 * n2 : n2;
          }
        };
        let pn = (e2) => {
          let t2 = [`instantiated_by_use`, `style`, `id`, `class`];
          switch (e2) {
            case `linearGradient`:
              return t2.concat([`x1`, `y1`, `x2`, `y2`, `gradientUnits`, `gradientTransform`]);
            case `radialGradient`:
              return t2.concat([`gradientUnits`, `gradientTransform`, `cx`, `cy`, `r`, `fx`, `fy`, `fr`]);
            case `stop`:
              return t2.concat([`offset`, `stop-color`, `stop-opacity`]);
          }
          return t2;
        }, K = (e2, t2 = 16) => {
          let n2 = /\D{0,2}$/.exec(e2), r2 = parseFloat(e2), i2 = s.DPI;
          switch (n2 == null ? void 0 : n2[0]) {
            case `mm`:
              return r2 * i2 / 25.4;
            case `cm`:
              return r2 * i2 / 2.54;
            case `in`:
              return r2 * i2;
            case `pt`:
              return r2 * i2 / 72;
            case `pc`:
              return r2 * i2 / 72 * 12;
            case `em`:
              return r2 * t2;
            default:
              return r2;
          }
        }, mn = (e2) => {
          let [t2, n2] = e2.trim().split(` `), [r2, i2] = (a2 = t2) && a2 !== `none` ? [a2.slice(1, 4), a2.slice(5, 8)] : a2 === `none` ? [a2, a2] : [`Mid`, `Mid`];
          var a2;
          return { meetOrSlice: n2 || `meet`, alignX: r2, alignY: i2 };
        }, hn = (e2, t2, n2 = true) => {
          let r2, i2;
          if (t2) if (t2.toLive) r2 = `url(#SVGID_${U(t2.id)})`;
          else {
            let e3 = String(t2);
            if (nn(e3)) {
              let t3 = new G(e3), n3 = t3.getAlpha();
              r2 = t3.toRgb(), n3 !== 1 && (i2 = n3.toString());
            } else r2 = new G(`black`).toRgb();
          }
          else r2 = `none`;
          return n2 ? `${e2}: ${r2}; ${i2 ? `${e2}-opacity: ${i2}; ` : ``}` : `${e2}="${r2}" ${i2 ? `${e2}-opacity="${i2}" ` : ``}`;
        };
        var gn = class {
          getSvgStyles(e2) {
            let t2 = this.fillRule == null ? `nonzero` : an(this.fillRule), n2 = this.strokeWidth == null ? `0` : rn(this.strokeWidth), r2 = this.strokeDashArray == null ? te : this.strokeDashArray.every((e3) => Number.isFinite(Number(e3))) ? this.strokeDashArray.join(` `) : ``, i2 = this.strokeDashOffset == null ? `0` : rn(this.strokeDashOffset), a2 = this.strokeLineCap == null ? `butt` : an(this.strokeLineCap), o2 = this.strokeLineJoin == null ? `miter` : an(this.strokeLineJoin), s2 = this.strokeMiterLimit == null ? `4` : rn(this.strokeMiterLimit), c2 = this.opacity == null ? `1` : rn(this.opacity), l2 = this.visible ? `` : ` visibility: hidden;`, u2 = e2 ? `` : this.getSvgFilter(), d2 = hn(j, this.fill);
            return [hn(he, this.stroke), n2 ? `stroke-width: ${n2}; ` : ``, r2 ? `stroke-dasharray: ${r2}; ` : ``, a2 ? `stroke-linecap: ${a2}; ` : ``, i2 ? `stroke-dashoffset: ${i2}; ` : ``, o2 ? `stroke-linejoin: ${o2}; ` : ``, s2 ? `stroke-miterlimit: ${s2}; ` : ``, d2, t2 ? `fill-rule: ${t2}; ` : ``, c2 ? `opacity: ${c2};` : ``, u2, l2].map((e3) => U(e3)).join(``);
          }
          getSvgFilter() {
            return this.shadow ? `filter: url(#SVGID_${U(this.shadow.id)});` : ``;
          }
          getSvgCommons() {
            return [this.id ? `id="${U(String(this.id))}" ` : ``, this.clipPath ? `clip-path="url(#${U(this.clipPath.clipPathId)})" ` : ``].join(``);
          }
          getSvgTransform(e2, t2 = ``) {
            return `transform="${nt(e2 ? this.calcTransformMatrix() : this.calcOwnMatrix())}${t2}" `;
          }
          _toSVG(e2) {
            return [``];
          }
          toSVG(e2) {
            return this._createBaseSVGMarkup(this._toSVG(e2), { reviver: e2 });
          }
          toClipPathSVG(e2) {
            return `	` + this._createBaseClipPathSVGMarkup(this._toSVG(e2), { reviver: e2 });
          }
          _createBaseClipPathSVGMarkup(e2, { reviver: t2, additionalTransform: n2 = `` } = {}) {
            let r2 = [this.getSvgTransform(true, n2), this.getSvgCommons()].join(``), i2 = e2.indexOf(`COMMON_PARTS`);
            return e2[i2] = r2, t2 ? t2(e2.join(``)) : e2.join(``);
          }
          _createBaseSVGMarkup(e2, { noStyle: t2, reviver: n2, withShadow: r2, additionalTransform: i2 } = {}) {
            let a2 = t2 ? `` : `style="${this.getSvgStyles()}" `, o2 = r2 ? `style="${this.getSvgFilter()}" ` : ``, s2 = this.clipPath, c2 = this.strokeUniform ? `vector-effect="non-scaling-stroke" ` : ``, l2 = s2 && s2.absolutePositioned, u2 = this.stroke, d2 = this.fill, f2 = this.shadow, p2 = [], m2 = e2.indexOf(`COMMON_PARTS`), h2;
            return s2 && (s2.clipPathId = `CLIPPATH_${je()}`, h2 = `<clipPath id="${s2.clipPathId}" >
${s2.toClipPathSVG(n2)}</clipPath>
`), l2 && p2.push(`<g `, o2, this.getSvgCommons(), ` >
`), p2.push(`<g `, this.getSvgTransform(false), l2 ? `` : o2 + this.getSvgCommons(), ` >
`), e2[m2] = [a2, c2, t2 ? `` : this.addPaintOrder(), ` `, i2 ? `transform="${i2}" ` : ``].join(``), V(d2) && p2.push(d2.toSVG(this)), V(u2) && p2.push(u2.toSVG(this)), f2 && p2.push(f2.toSVG(this)), s2 && p2.push(h2), p2.push(e2.join(``)), p2.push(`</g>
`), l2 && p2.push(`</g>
`), n2 ? n2(p2.join(``)) : p2.join(``);
          }
          addPaintOrder() {
            return this.paintFirst === `fill` ? `` : ` paint-order="${U(this.paintFirst)}" `;
          }
        };
        function _n(e2) {
          return RegExp(`^(` + e2.join(`|`) + `)\\b`, `i`);
        }
        let vn = `textDecorationThickness`, yn = `textDecorationColor`, bn = [`fontSize`, `fontWeight`, `fontFamily`, `fontStyle`], xn = [`underline`, `overline`, `linethrough`], Sn = [...bn, `lineHeight`, `text`, `charSpacing`, `textAlign`, `styles`, `path`, `pathStartOffset`, `pathSide`, `pathAlign`], Cn = [...Sn, ...xn, `textBackgroundColor`, `direction`, vn, yn], wn = [...bn, ...xn, he, `strokeWidth`, j, `deltaY`, `textBackgroundColor`, vn, yn], Tn = { _reNewline: ne, _reSpacesAndTabs: /[ \t\r]/g, _reSpaceAndTab: /[ \t\r]/, _reWords: /\S+/g, fontSize: 40, fontWeight: _e, fontFamily: `Times New Roman`, underline: false, overline: false, linethrough: false, textAlign: D, fontStyle: _e, lineHeight: 1.16, textBackgroundColor: ``, stroke: null, shadow: null, path: void 0, pathStartOffset: 0, pathSide: D, pathAlign: `baseline`, charSpacing: 0, deltaY: 0, direction: `ltr`, CACHE_FONT_SIZE: 400, MIN_TEXT_WIDTH: 2, superscript: { size: 0.6, baseline: -0.35 }, subscript: { size: 0.6, baseline: 0.11 }, _fontSizeFraction: 0.222, offsets: { underline: 0.1, linethrough: -0.28167, overline: -0.81333 }, _fontSizeMult: 1.13, [vn]: 66.667 }, En = `justify`, Dn = String.raw`[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?`, On = String.raw`(?:\s*,?\s+|\s*,\s*)`, kn = `http://www.w3.org/2000/svg`, An = RegExp(`(normal|italic)?\\s*(normal|small-caps)?\\s*(normal|bold|bolder|lighter|100|200|300|400|500|600|700|800|900)?\\s*(` + Dn + `(?:px|cm|mm|em|pt|pc|in)*)(?:\\/(normal|` + Dn + `))?\\s+(.*)`), jn = { cx: D, x: D, r: `radius`, cy: `top`, y: `top`, display: `visible`, visibility: `visible`, transform: `transformMatrix`, "fill-opacity": `fillOpacity`, "fill-rule": `fillRule`, "font-family": `fontFamily`, "font-size": `fontSize`, "font-style": `fontStyle`, "font-weight": `fontWeight`, "letter-spacing": `charSpacing`, "paint-order": `paintFirst`, "stroke-dasharray": `strokeDashArray`, "stroke-dashoffset": `strokeDashOffset`, "stroke-linecap": `strokeLineCap`, "stroke-linejoin": `strokeLineJoin`, "stroke-miterlimit": `strokeMiterLimit`, "stroke-opacity": `strokeOpacity`, "stroke-width": `strokeWidth`, "text-decoration": `textDecoration`, "text-anchor": `textAnchor`, opacity: `opacity`, "clip-path": `clipPath`, "clip-rule": `clipRule`, "vector-effect": `strokeUniform`, "image-rendering": `imageSmoothing`, "text-decoration-thickness": vn, "text-decoration-color": yn }, Mn = `font-size`, Nn = `clip-path`, Pn = _n([`path`, `circle`, `polygon`, `polyline`, `ellipse`, `rect`, `line`, `image`, `text`]), Fn = _n([`symbol`, `image`, `marker`, `pattern`, `view`, `svg`]), In = _n([`symbol`, `g`, `a`, `svg`, `clipPath`, `defs`]), Ln = new RegExp(String.raw`^\s*(${Dn})${On}(${Dn})${On}(${Dn})${On}(${Dn})\s*$`), Rn = `(-?\\d+(?:\\.\\d*)?(?:px)?(?:\\s?|$))?`, zn = RegExp(`(?:\\s|^)` + Rn + Rn + `(` + Dn + `?(?:px)?)?(?:\\s?|$)(?:$|\\s)`);
        var Bn = class e2 {
          constructor(t2 = {}) {
            let n2 = typeof t2 == `string` ? e2.parseShadow(t2) : t2;
            Object.assign(this, e2.ownDefaults, n2), this.id = je();
          }
          static parseShadow(e3) {
            let t2 = e3.trim(), [, n2 = 0, r2 = 0, i2 = 0] = (zn.exec(t2) || []).map((e4) => parseFloat(e4) || 0);
            return { color: (t2.replace(zn, ``) || `rgb(0,0,0)`).trim(), offsetX: n2, offsetY: r2, blur: i2 };
          }
          toString() {
            return [this.offsetX, this.offsetY, this.blur, this.color].join(`px `);
          }
          toSVG(e3) {
            let t2 = Rt(new N(this.offsetX, this.offsetY), I(-e3.angle)), n2 = s.NUM_FRACTION_DIGITS, r2 = new G(this.color), i2 = 40, a2 = 40;
            return e3.width && e3.height && (i2 = 100 * B((Math.abs(t2.x) + this.blur) / e3.width, n2) + 20, a2 = 100 * B((Math.abs(t2.y) + this.blur) / e3.height, n2) + 20), e3.flipX && (t2.x *= -1), e3.flipY && (t2.y *= -1), `<filter id="SVGID_${U(this.id)}" y="-${a2}%" height="${100 + 2 * a2}%" x="-${i2}%" width="${100 + 2 * i2}%" >
	<feGaussianBlur in="SourceAlpha" stdDeviation="${B(this.blur ? this.blur / 2 : 0, n2)}"></feGaussianBlur>
	<feOffset dx="${B(t2.x, n2)}" dy="${B(t2.y, n2)}" result="oBlur" ></feOffset>
	<feFlood flood-color="${r2.toRgb()}" flood-opacity="${r2.getAlpha()}"/>
	<feComposite in2="oBlur" operator="in" />
	<feMerge>
		<feMergeNode></feMergeNode>
		<feMergeNode in="SourceGraphic"></feMergeNode>
	</feMerge>
</filter>
`;
          }
          toObject() {
            let t2 = { color: this.color, blur: this.blur, offsetX: this.offsetX, offsetY: this.offsetY, affectStroke: this.affectStroke, nonScaling: this.nonScaling, type: this.constructor.type }, n2 = e2.ownDefaults;
            return this.includeDefaultValues ? t2 : tt(t2, (e3, t3) => e3 !== n2[t3]);
          }
          static async fromObject(e3) {
            return new this(e3);
          }
        };
        a(Bn, `ownDefaults`, { color: `rgb(0,0,0)`, blur: 0, offsetX: 0, offsetY: 0, affectStroke: false, includeDefaultValues: true, nonScaling: false }), a(Bn, `type`, `shadow`), M.setClass(Bn, `shadow`);
        let Vn = (e2, t2, n2) => Math.max(e2, Math.min(t2, n2)), Hn = [`top`, D, de, fe, `flipX`, `flipY`, `originX`, `originY`, `angle`, `opacity`, `globalCompositeOperation`, `shadow`, `visible`, pe, me], Un = [j, he, `strokeWidth`, `strokeDashArray`, `width`, `height`, `paintFirst`, `strokeUniform`, `strokeLineCap`, `strokeDashOffset`, `strokeLineJoin`, `strokeMiterLimit`, `backgroundColor`, `clipPath`], Wn = { top: 0, left: 0, width: 0, height: 0, angle: 0, flipX: false, flipY: false, scaleX: 1, scaleY: 1, minScaleLimit: 0, skewX: 0, skewY: 0, originX: E, originY: E, strokeWidth: 1, strokeUniform: false, padding: 0, opacity: 1, paintFirst: j, fill: `rgb(0,0,0)`, fillRule: `nonzero`, stroke: null, strokeDashArray: null, strokeDashOffset: 0, strokeLineCap: `butt`, strokeLineJoin: `miter`, strokeMiterLimit: 4, globalCompositeOperation: `source-over`, backgroundColor: ``, shadow: null, visible: true, includeDefaultValues: true, excludeFromExport: false, objectCaching: true, clipPath: void 0, inverted: false, absolutePositioned: false, centeredRotation: true, centeredScaling: false, dirty: true };
        var Gn = n({ defaultEasing: () => Jn, easeInBack: () => gr, easeInBounce: () => br, easeInCirc: () => ur, easeInCubic: () => Yn, easeInElastic: () => pr, easeInExpo: () => sr, easeInOutBack: () => vr, easeInOutBounce: () => xr, easeInOutCirc: () => fr, easeInOutCubic: () => Zn, easeInOutElastic: () => hr, easeInOutExpo: () => lr, easeInOutQuad: () => wr, easeInOutQuart: () => er, easeInOutQuint: () => rr, easeInOutSine: () => or, easeInQuad: () => Sr, easeInQuart: () => Qn, easeInQuint: () => tr, easeInSine: () => ir, easeOutBack: () => _r, easeOutBounce: () => yr, easeOutCirc: () => dr, easeOutCubic: () => Xn, easeOutElastic: () => mr, easeOutExpo: () => cr, easeOutQuad: () => Cr, easeOutQuart: () => $n, easeOutQuint: () => nr, easeOutSine: () => ar });
        let Kn = (e2, t2, n2, r2) => (e2 < Math.abs(t2) ? (e2 = t2, r2 = n2 / 4) : r2 = t2 === 0 && e2 === 0 ? n2 / w * Math.asin(1) : n2 / w * Math.asin(t2 / e2), { a: e2, c: t2, p: n2, s: r2 }), qn = (e2, t2, n2, r2, i2) => e2 * 2 ** (10 * --r2) * Math.sin((r2 * i2 - t2) * w / n2), Jn = (e2, t2, n2, r2) => -n2 * Math.cos(e2 / r2 * S) + n2 + t2, Yn = (e2, t2, n2, r2) => n2 * (e2 / r2) ** 3 + t2, Xn = (e2, t2, n2, r2) => n2 * ((e2 / r2 - 1) ** 3 + 1) + t2, Zn = (e2, t2, n2, r2) => (e2 /= r2 / 2) < 1 ? n2 / 2 * e2 ** 3 + t2 : n2 / 2 * ((e2 - 2) ** 3 + 2) + t2, Qn = (e2, t2, n2, r2) => n2 * (e2 /= r2) * e2 ** 3 + t2, $n = (e2, t2, n2, r2) => -n2 * ((e2 = e2 / r2 - 1) * e2 ** 3 - 1) + t2, er = (e2, t2, n2, r2) => (e2 /= r2 / 2) < 1 ? n2 / 2 * e2 ** 4 + t2 : -n2 / 2 * ((e2 -= 2) * e2 ** 3 - 2) + t2, tr = (e2, t2, n2, r2) => n2 * (e2 / r2) ** 5 + t2, nr = (e2, t2, n2, r2) => n2 * ((e2 / r2 - 1) ** 5 + 1) + t2, rr = (e2, t2, n2, r2) => (e2 /= r2 / 2) < 1 ? n2 / 2 * e2 ** 5 + t2 : n2 / 2 * ((e2 - 2) ** 5 + 2) + t2, ir = (e2, t2, n2, r2) => -n2 * Math.cos(e2 / r2 * S) + n2 + t2, ar = (e2, t2, n2, r2) => n2 * Math.sin(e2 / r2 * S) + t2, or = (e2, t2, n2, r2) => -n2 / 2 * (Math.cos(Math.PI * e2 / r2) - 1) + t2, sr = (e2, t2, n2, r2) => e2 === 0 ? t2 : n2 * 2 ** (10 * (e2 / r2 - 1)) + t2, cr = (e2, t2, n2, r2) => e2 === r2 ? t2 + n2 : n2 * -(2 ** (-10 * e2 / r2) + 1) + t2, lr = (e2, t2, n2, r2) => e2 === 0 ? t2 : e2 === r2 ? t2 + n2 : (e2 /= r2 / 2) < 1 ? n2 / 2 * 2 ** (10 * (e2 - 1)) + t2 : n2 / 2 * -(2 ** (-10 * (e2 - 1)) + 2) + t2, ur = (e2, t2, n2, r2) => -n2 * (Math.sqrt(1 - (e2 /= r2) * e2) - 1) + t2, dr = (e2, t2, n2, r2) => n2 * Math.sqrt(1 - (e2 = e2 / r2 - 1) * e2) + t2, fr = (e2, t2, n2, r2) => (e2 /= r2 / 2) < 1 ? -n2 / 2 * (Math.sqrt(1 - e2 ** 2) - 1) + t2 : n2 / 2 * (Math.sqrt(1 - (e2 -= 2) * e2) + 1) + t2, pr = (e2, t2, n2, r2) => {
          let i2 = n2, a2 = 0;
          if (e2 === 0) return t2;
          if ((e2 /= r2) === 1) return t2 + n2;
          a2 || (a2 = 0.3 * r2);
          let { a: o2, s: s2, p: c2 } = Kn(i2, n2, a2, 1.70158);
          return -qn(o2, s2, c2, e2, r2) + t2;
        }, mr = (e2, t2, n2, r2) => {
          let i2 = n2, a2 = 0;
          if (e2 === 0) return t2;
          if ((e2 /= r2) === 1) return t2 + n2;
          a2 || (a2 = 0.3 * r2);
          let { a: o2, s: s2, p: c2, c: l2 } = Kn(i2, n2, a2, 1.70158);
          return o2 * 2 ** (-10 * e2) * Math.sin((e2 * r2 - s2) * w / c2) + l2 + t2;
        }, hr = (e2, t2, n2, r2) => {
          let i2 = n2, a2 = 0;
          if (e2 === 0) return t2;
          if ((e2 /= r2 / 2) == 2) return t2 + n2;
          a2 || (a2 = 0.3 * 1.5 * r2);
          let { a: o2, s: s2, p: c2, c: l2 } = Kn(i2, n2, a2, 1.70158);
          return e2 < 1 ? -0.5 * qn(o2, s2, c2, e2, r2) + t2 : o2 * 2 ** (-10 * --e2) * Math.sin((e2 * r2 - s2) * w / c2) * 0.5 + l2 + t2;
        }, gr = (e2, t2, n2, r2, i2 = 1.70158) => n2 * (e2 /= r2) * e2 * ((i2 + 1) * e2 - i2) + t2, _r = (e2, t2, n2, r2, i2 = 1.70158) => n2 * ((e2 = e2 / r2 - 1) * e2 * ((i2 + 1) * e2 + i2) + 1) + t2, vr = (e2, t2, n2, r2, i2 = 1.70158) => (e2 /= r2 / 2) < 1 ? n2 / 2 * (e2 * e2 * ((1 + (i2 *= 1.525)) * e2 - i2)) + t2 : n2 / 2 * ((e2 -= 2) * e2 * ((1 + (i2 *= 1.525)) * e2 + i2) + 2) + t2, yr = (e2, t2, n2, r2) => (e2 /= r2) < 1 / 2.75 ? n2 * (7.5625 * e2 * e2) + t2 : e2 < 2 / 2.75 ? n2 * (7.5625 * (e2 -= 1.5 / 2.75) * e2 + 0.75) + t2 : e2 < 2.5 / 2.75 ? n2 * (7.5625 * (e2 -= 2.25 / 2.75) * e2 + 0.9375) + t2 : n2 * (7.5625 * (e2 -= 2.625 / 2.75) * e2 + 0.984375) + t2, br = (e2, t2, n2, r2) => n2 - yr(r2 - e2, 0, n2, r2) + t2, xr = (e2, t2, n2, r2) => e2 < r2 / 2 ? 0.5 * br(2 * e2, 0, n2, r2) + t2 : 0.5 * yr(2 * e2 - r2, 0, n2, r2) + 0.5 * n2 + t2, Sr = (e2, t2, n2, r2) => n2 * (e2 /= r2) * e2 + t2, Cr = (e2, t2, n2, r2) => -n2 * (e2 /= r2) * (e2 - 2) + t2, wr = (e2, t2, n2, r2) => (e2 /= r2 / 2) < 1 ? n2 / 2 * e2 ** 2 + t2 : -n2 / 2 * (--e2 * (e2 - 2) - 1) + t2, Tr = () => false;
        var Er = class {
          constructor({ startValue: e2, byValue: t2, duration: n2 = 500, delay: r2 = 0, easing: i2 = Jn, onStart: o2 = x, onChange: s2 = x, onComplete: c2 = x, abort: l2 = Tr, target: u2 }) {
            a(this, `_state`, `pending`), a(this, `durationProgress`, 0), a(this, `valueProgress`, 0), this.tick = this.tick.bind(this), this.duration = n2, this.delay = r2, this.easing = i2, this._onStart = o2, this._onChange = s2, this._onComplete = c2, this._abort = l2, this.target = u2, this.startValue = e2, this.byValue = t2, this.value = this.startValue, this.endValue = Object.freeze(this.calculate(this.duration).value);
          }
          get state() {
            return this._state;
          }
          isDone() {
            return this._state === `aborted` || this._state === `completed`;
          }
          start() {
            let e2 = (e3) => {
              this._state === `pending` && (this.startTime = e3 || +/* @__PURE__ */ new Date(), this._state = `running`, this._onStart(), this.tick(this.startTime));
            };
            this.register(), this.delay > 0 ? this.timeout = _().setTimeout(() => Oe(e2), this.delay) : Oe(e2);
          }
          tick(e2) {
            let t2 = (e2 || +/* @__PURE__ */ new Date()) - this.startTime, n2 = Math.min(t2, this.duration);
            this.durationProgress = n2 / this.duration;
            let { value: r2, valueProgress: i2 } = this.calculate(n2);
            this.value = Object.freeze(r2), this.valueProgress = i2, this._state !== `aborted` && (this._abort(this.value, this.valueProgress, this.durationProgress) ? (this._state = `aborted`, this.unregister()) : t2 >= this.duration ? (this.durationProgress = this.valueProgress = 1, this._onChange(this.endValue, this.valueProgress, this.durationProgress), this._state = `completed`, this._onComplete(this.endValue, this.valueProgress, this.durationProgress), this.unregister(), this.timeout = null) : (this._onChange(this.value, this.valueProgress, this.durationProgress), Oe(this.tick)));
          }
          register() {
            ye.push(this);
          }
          unregister() {
            ye.remove(this);
          }
          abort() {
            this._state = `aborted`, this.unregister(), this.timeout && _().clearTimeout(this.timeout);
          }
        }, Dr = class extends Er {
          constructor({ startValue: e2 = 0, endValue: t2 = 100, ...n2 }) {
            super({ ...n2, startValue: e2, byValue: t2 - e2 });
          }
          calculate(e2) {
            let t2 = this.easing(e2, this.startValue, this.byValue, this.duration);
            return { value: t2, valueProgress: Math.abs((t2 - this.startValue) / this.byValue) };
          }
        }, Or = class extends Er {
          constructor({ startValue: e2 = [0], endValue: t2 = [100], ...n2 }) {
            super({ ...n2, startValue: e2, byValue: t2.map((t3, n3) => t3 - e2[n3]) });
          }
          calculate(e2) {
            let t2 = this.startValue.map((t3, n2) => this.easing(e2, t3, this.byValue[n2], this.duration, n2));
            return { value: t2, valueProgress: Math.abs((t2[0] - this.startValue[0]) / this.byValue[0]) };
          }
        };
        let kr = (e2, t2, n2, r2) => t2 + n2 * (1 - Math.cos(e2 / r2 * S)), Ar = (e2) => e2 && ((t2, n2, r2) => e2(new G(t2).toRgba(), n2, r2));
        var jr = class extends Er {
          constructor({ startValue: e2, endValue: t2, easing: n2 = kr, onChange: r2, onComplete: i2, abort: a2, ...o2 }) {
            let s2 = new G(e2).getSource(), c2 = new G(t2).getSource();
            super({ ...o2, startValue: s2, byValue: c2.map((e3, t3) => e3 - s2[t3]), easing: n2, onChange: Ar(r2), onComplete: Ar(i2), abort: Ar(a2) });
          }
          calculate(e2) {
            let [t2, n2, r2, i2] = this.startValue.map((t3, n3) => this.easing(e2, t3, this.byValue[n3], this.duration, n3)), a2 = [...[t2, n2, r2].map(Math.round), Vn(0, i2, 1)];
            return { value: a2, valueProgress: a2.map((e3, t3) => this.byValue[t3] === 0 ? 0 : Math.abs((e3 - this.startValue[t3]) / this.byValue[t3])).find((e3) => e3 !== 0) || 0 };
          }
        };
        function Mr(e2) {
          let t2 = ((e3) => Array.isArray(e3.startValue) || Array.isArray(e3.endValue))(e2) ? new Or(e2) : new Dr(e2);
          return t2.start(), t2;
        }
        function Nr(e2) {
          let t2 = new jr(e2);
          return t2.start(), t2;
        }
        var Pr = class e2 {
          constructor(e3) {
            this.status = e3, this.points = [];
          }
          includes(e3) {
            return this.points.some((t2) => t2.eq(e3));
          }
          append(...e3) {
            return this.points = this.points.concat(e3.filter((e4) => !this.includes(e4))), this;
          }
          static isPointContained(e3, t2, n2, r2 = false) {
            if (t2.eq(n2)) return e3.eq(t2);
            if (t2.x === n2.x) return e3.x === t2.x && (r2 || e3.y >= Math.min(t2.y, n2.y) && e3.y <= Math.max(t2.y, n2.y));
            if (t2.y === n2.y) return e3.y === t2.y && (r2 || e3.x >= Math.min(t2.x, n2.x) && e3.x <= Math.max(t2.x, n2.x));
            {
              let i2 = zt(t2, n2), a2 = zt(t2, e3).divide(i2);
              return r2 ? Math.abs(a2.x) === Math.abs(a2.y) : a2.x === a2.y && a2.x >= 0 && a2.x <= 1;
            }
          }
          static isPointInPolygon(e3, t2) {
            let n2 = new N(e3).setX(Math.min(e3.x - 1, ...t2.map((e4) => e4.x))), r2 = 0;
            for (let i2 = 0; i2 < t2.length; i2++) {
              let a2 = this.intersectSegmentSegment(t2[i2], t2[(i2 + 1) % t2.length], e3, n2);
              if (a2.includes(e3)) return true;
              r2 += Number(a2.status === `Intersection`);
            }
            return r2 % 2 == 1;
          }
          static intersectLineLine(t2, n2, r2, i2, a2 = true, o2 = true) {
            let s2 = n2.x - t2.x, c2 = n2.y - t2.y, l2 = i2.x - r2.x, u2 = i2.y - r2.y, d2 = t2.x - r2.x, f2 = t2.y - r2.y, p2 = l2 * f2 - u2 * d2, m2 = s2 * f2 - c2 * d2, h2 = u2 * s2 - l2 * c2;
            if (h2 !== 0) {
              let n3 = p2 / h2, r3 = m2 / h2;
              return (a2 || 0 <= n3 && n3 <= 1) && (o2 || 0 <= r3 && r3 <= 1) ? new e2(`Intersection`).append(new N(t2.x + n3 * s2, t2.y + n3 * c2)) : new e2();
            }
            return new e2(p2 === 0 || m2 === 0 ? a2 || o2 || e2.isPointContained(t2, r2, i2) || e2.isPointContained(n2, r2, i2) || e2.isPointContained(r2, t2, n2) || e2.isPointContained(i2, t2, n2) ? `Coincident` : void 0 : `Parallel`);
          }
          static intersectSegmentLine(t2, n2, r2, i2) {
            return e2.intersectLineLine(t2, n2, r2, i2, false, true);
          }
          static intersectSegmentSegment(t2, n2, r2, i2) {
            return e2.intersectLineLine(t2, n2, r2, i2, false, false);
          }
          static intersectLinePolygon(t2, n2, r2, i2 = true) {
            let a2 = new e2(), o2 = r2.length;
            for (let s2, c2, l2, u2 = 0; u2 < o2; u2++) {
              if (s2 = r2[u2], c2 = r2[(u2 + 1) % o2], l2 = e2.intersectLineLine(t2, n2, s2, c2, i2, false), l2.status === `Coincident`) return l2;
              a2.append(...l2.points);
            }
            return a2.points.length > 0 && (a2.status = `Intersection`), a2;
          }
          static intersectSegmentPolygon(t2, n2, r2) {
            return e2.intersectLinePolygon(t2, n2, r2, false);
          }
          static intersectPolygonPolygon(t2, n2) {
            let r2 = new e2(), i2 = t2.length, a2 = [];
            for (let o2 = 0; o2 < i2; o2++) {
              let s2 = t2[o2], c2 = t2[(o2 + 1) % i2], l2 = e2.intersectSegmentPolygon(s2, c2, n2);
              l2.status === `Coincident` ? (a2.push(l2), r2.append(s2, c2)) : r2.append(...l2.points);
            }
            return a2.length > 0 && a2.length === t2.length ? new e2(`Coincident`) : (r2.points.length > 0 && (r2.status = `Intersection`), r2);
          }
          static intersectPolygonRectangle(t2, n2, r2) {
            let i2 = n2.min(r2), a2 = n2.max(r2), o2 = new N(a2.x, i2.y), s2 = new N(i2.x, a2.y);
            return e2.intersectPolygonPolygon(t2, [i2, o2, a2, s2]);
          }
        }, Fr = class extends De {
          getX() {
            return this.getXY().x;
          }
          setX(e2) {
            this.setXY(this.getXY().setX(e2));
          }
          getY() {
            return this.getXY().y;
          }
          setY(e2) {
            this.setXY(this.getXY().setY(e2));
          }
          getRelativeX() {
            return this.left;
          }
          setRelativeX(e2) {
            this.left = e2;
          }
          getRelativeY() {
            return this.top;
          }
          setRelativeY(e2) {
            this.top = e2;
          }
          getXY() {
            let e2 = this.getRelativeXY();
            return this.group ? L(e2, this.group.calcTransformMatrix()) : e2;
          }
          setXY(e2, t2, n2) {
            this.group && (e2 = L(e2, R(this.group.calcTransformMatrix()))), this.setRelativeXY(e2, t2, n2);
          }
          getRelativeXY() {
            return new N(this.left, this.top);
          }
          setRelativeXY(e2, t2 = this.originX, n2 = this.originY) {
            this.setPositionByOrigin(e2, t2, n2);
          }
          isStrokeAccountedForInDimensions() {
            return false;
          }
          getCoords() {
            let { tl: e2, tr: t2, br: n2, bl: r2 } = this.aCoords || (this.aCoords = this.calcACoords()), i2 = [e2, t2, n2, r2];
            if (this.group) {
              let e3 = this.group.calcTransformMatrix();
              return i2.map((t3) => L(t3, e3));
            }
            return i2;
          }
          intersectsWithRect(e2, t2) {
            return Pr.intersectPolygonRectangle(this.getCoords(), e2, t2).status === `Intersection`;
          }
          intersectsWithObject(e2) {
            let t2 = Pr.intersectPolygonPolygon(this.getCoords(), e2.getCoords());
            return t2.status === `Intersection` || t2.status === `Coincident` || e2.isContainedWithinObject(this) || this.isContainedWithinObject(e2);
          }
          isContainedWithinObject(e2) {
            return this.getCoords().every((t2) => e2.containsPoint(t2));
          }
          isContainedWithinRect(e2, t2) {
            let { left: n2, top: r2, width: i2, height: a2 } = this.getBoundingRect();
            return n2 >= e2.x && n2 + i2 <= t2.x && r2 >= e2.y && r2 + a2 <= t2.y;
          }
          isOverlapping(e2) {
            return this.intersectsWithObject(e2) || this.isContainedWithinObject(e2) || e2.isContainedWithinObject(this);
          }
          containsPoint(e2) {
            return Pr.isPointInPolygon(e2, this.getCoords());
          }
          isOnScreen() {
            if (!this.canvas) return false;
            let { tl: e2, br: t2 } = this.canvas.vptCoords;
            return !!this.getCoords().some((n2) => n2.x <= t2.x && n2.x >= e2.x && n2.y <= t2.y && n2.y >= e2.y) || !!this.intersectsWithRect(e2, t2) || this.containsPoint(e2.midPointFrom(t2));
          }
          isPartiallyOnScreen() {
            if (!this.canvas) return false;
            let { tl: e2, br: t2 } = this.canvas.vptCoords;
            return !!this.intersectsWithRect(e2, t2) || this.getCoords().every((n2) => (n2.x >= t2.x || n2.x <= e2.x) && (n2.y >= t2.y || n2.y <= e2.y)) && this.containsPoint(e2.midPointFrom(t2));
          }
          getBoundingRect() {
            return wt(this.getCoords());
          }
          getScaledWidth() {
            return this._getTransformedDimensions().x;
          }
          getScaledHeight() {
            return this._getTransformedDimensions().y;
          }
          scale(e2) {
            this._set(de, e2), this._set(fe, e2), this.setCoords();
          }
          scaleToWidth(e2) {
            let t2 = this.getBoundingRect().width / this.getScaledWidth();
            return this.scale(e2 / this.width / t2);
          }
          scaleToHeight(e2) {
            let t2 = this.getBoundingRect().height / this.getScaledHeight();
            return this.scale(e2 / this.height / t2);
          }
          getCanvasRetinaScaling() {
            var e2;
            return ((e2 = this.canvas) == null ? void 0 : e2.getRetinaScaling()) || 1;
          }
          getTotalAngle() {
            return this.group ? Ie(ze(this.calcTransformMatrix())) : this.angle;
          }
          getViewportTransform() {
            var e2;
            return ((e2 = this.canvas) == null ? void 0 : e2.viewportTransform) || T.concat();
          }
          calcACoords() {
            let e2 = We({ angle: this.angle }), { x: t2, y: n2 } = this.getRelativeCenterPoint(), r2 = z(Ue(t2, n2), e2), i2 = this._getTransformedDimensions(), a2 = i2.x / 2, o2 = i2.y / 2;
            return { tl: L({ x: -a2, y: -o2 }, r2), tr: L({ x: a2, y: -o2 }, r2), bl: L({ x: -a2, y: o2 }, r2), br: L({ x: a2, y: o2 }, r2) };
          }
          setCoords() {
            this.aCoords = this.calcACoords();
          }
          transformMatrixKey(e2 = false) {
            let t2 = [];
            return !e2 && this.group && (t2 = this.group.transformMatrixKey(e2)), t2.push(this.top, this.left, this.width, this.height, this.scaleX, this.scaleY, this.angle, this.strokeWidth, this.skewX, this.skewY, +this.flipX, +this.flipY, W(this.originX), W(this.originY)), t2;
          }
          calcTransformMatrix(e2 = false) {
            let t2 = this.calcOwnMatrix();
            if (e2 || !this.group) return t2;
            let n2 = this.transformMatrixKey(e2), r2 = this.matrixCache;
            return r2 && r2.key.every((e3, t3) => e3 === n2[t3]) ? r2.value : (this.group && (t2 = z(this.group.calcTransformMatrix(false), t2)), this.matrixCache = { key: n2, value: t2 }, t2);
          }
          calcOwnMatrix() {
            let e2 = this.transformMatrixKey(true), t2 = this.ownMatrixCache;
            if (t2 && t2.key.every((t3, n3) => t3 === e2[n3])) return t2.value;
            let n2 = this.getRelativeCenterPoint(), r2 = Xe({ angle: this.angle, translateX: n2.x, translateY: n2.y, scaleX: this.scaleX, scaleY: this.scaleY, skewX: this.skewX, skewY: this.skewY, flipX: this.flipX, flipY: this.flipY });
            return this.ownMatrixCache = { key: e2, value: r2 }, r2;
          }
          _getNonTransformedDimensions() {
            return new N(this.width, this.height).scalarAdd(this.strokeWidth);
          }
          _calculateCurrentDimensions(e2) {
            var t2;
            let n2 = (t2 = this.canvas) == null ? void 0 : t2.viewportTransform, r2 = this._getTransformedDimensions(e2);
            return n2 ? r2.multiply(new N(Be(n2), Ve(n2))).scalarAdd(2 * this.padding) : r2.scalarAdd(2 * this.padding);
          }
          _getTransformedDimensions(e2 = {}) {
            let t2 = { scaleX: this.scaleX, scaleY: this.scaleY, skewX: this.skewX, skewY: this.skewY, width: this.width, height: this.height, strokeWidth: this.strokeWidth, ...e2 }, n2 = t2.strokeWidth, r2 = n2, i2 = 0;
            this.strokeUniform && (r2 = 0, i2 = n2);
            let a2 = t2.width + r2, o2 = t2.height + r2, s2;
            return s2 = t2.skewX === 0 && t2.skewY === 0 ? new N(a2 * t2.scaleX, o2 * t2.scaleY) : At(a2, o2, Ye(t2)), s2.scalarAdd(i2);
          }
          translateToGivenOrigin(e2, t2, n2, r2, i2) {
            let a2 = e2.x, o2 = e2.y, s2 = W(r2) - W(t2), c2 = W(i2) - W(n2);
            if (s2 || c2) {
              let e3 = this._getTransformedDimensions();
              a2 += s2 * e3.x, o2 += c2 * e3.y;
            }
            return new N(a2, o2);
          }
          translateToCenterPoint(e2, t2, n2) {
            if (t2 === `center` && n2 === `center`) return e2;
            let r2 = this.translateToGivenOrigin(e2, t2, n2, E, E);
            return this.angle ? r2.rotate(I(this.angle), e2) : r2;
          }
          translateToOriginPoint(e2, t2, n2) {
            let r2 = this.translateToGivenOrigin(e2, E, E, t2, n2);
            return this.angle ? r2.rotate(I(this.angle), e2) : r2;
          }
          getCenterPoint() {
            let e2 = this.getRelativeCenterPoint();
            return this.group ? L(e2, this.group.calcTransformMatrix()) : e2;
          }
          getRelativeCenterPoint() {
            return this.translateToCenterPoint(new N(this.left, this.top), this.originX, this.originY);
          }
          getPointByOrigin(e2, t2) {
            return this.getPositionByOrigin(e2, t2);
          }
          getPositionByOrigin(e2, t2) {
            return this.translateToOriginPoint(this.getRelativeCenterPoint(), e2, t2);
          }
          setPositionByOrigin(e2, t2, n2) {
            let r2 = this.translateToCenterPoint(e2, t2, n2), i2 = this.translateToOriginPoint(r2, this.originX, this.originY);
            this.set({ left: i2.x, top: i2.y });
          }
          _getLeftTopCoords() {
            return this.getPositionByOrigin(D, `top`);
          }
          positionByLeftTop(e2) {
            return this.setPositionByOrigin(e2, D, `top`);
          }
        }, Ir = class e2 extends Fr {
          static getDefaults() {
            return e2.ownDefaults;
          }
          get type() {
            let e3 = this.constructor.type;
            return e3 === `FabricObject` ? `object` : e3.toLowerCase();
          }
          set type(e3) {
            c(`warn`, `Setting type has no effect`, e3);
          }
          constructor(t2) {
            super(), a(this, `_cacheContext`, null), Object.assign(this, e2.ownDefaults), this.setOptions(t2);
          }
          _createCacheCanvas() {
            this._cacheCanvas = P(), this._cacheContext = this._cacheCanvas.getContext(`2d`), this._updateCacheCanvas(), this.dirty = true;
          }
          _limitCacheSize(e3) {
            let t2 = e3.width, n2 = e3.height, r2 = s.maxCacheSideLimit, i2 = s.minCacheSideLimit;
            if (t2 <= r2 && n2 <= r2 && t2 * n2 <= s.perfLimitSizeTotal) return t2 < i2 && (e3.width = i2), n2 < i2 && (e3.height = i2), e3;
            let a2 = t2 / n2, [o2, c2] = y.limitDimsByArea(a2), l2 = Vn(i2, o2, r2), u2 = Vn(i2, c2, r2);
            return t2 > l2 && (e3.zoomX /= t2 / l2, e3.width = l2, e3.capped = true), n2 > u2 && (e3.zoomY /= n2 / u2, e3.height = u2, e3.capped = true), e3;
          }
          _getCacheCanvasDimensions() {
            let e3 = this.getTotalObjectScaling(), t2 = this._getTransformedDimensions({ skewX: 0, skewY: 0 }), n2 = t2.x * e3.x / this.scaleX, r2 = t2.y * e3.y / this.scaleY;
            return { width: Math.ceil(n2 + 2), height: Math.ceil(r2 + 2), zoomX: e3.x, zoomY: e3.y, x: n2, y: r2 };
          }
          _updateCacheCanvas() {
            let e3 = this._cacheCanvas, t2 = this._cacheContext, { width: n2, height: r2, zoomX: i2, zoomY: a2, x: o2, y: s2 } = this._limitCacheSize(this._getCacheCanvasDimensions()), c2 = n2 !== e3.width || r2 !== e3.height, l2 = this.zoomX !== i2 || this.zoomY !== a2;
            if (!e3 || !t2) return false;
            if (c2 || l2) {
              n2 !== e3.width || r2 !== e3.height ? (e3.width = n2, e3.height = r2) : (t2.setTransform(1, 0, 0, 1, 0, 0), t2.clearRect(0, 0, e3.width, e3.height));
              let c3 = o2 / 2, l3 = s2 / 2;
              return this.cacheTranslationX = Math.round(e3.width / 2 - c3) + c3, this.cacheTranslationY = Math.round(e3.height / 2 - l3) + l3, t2.translate(this.cacheTranslationX, this.cacheTranslationY), t2.scale(i2, a2), this.zoomX = i2, this.zoomY = a2, true;
            }
            return false;
          }
          setOptions(e3 = {}) {
            this._setOptions(e3);
          }
          transform(e3) {
            let t2 = this.group && !this.group._transformDone || this.group && this.canvas && e3 === this.canvas.contextTop, n2 = this.calcTransformMatrix(!t2);
            e3.transform(n2[0], n2[1], n2[2], n2[3], n2[4], n2[5]);
          }
          getObjectScaling() {
            if (!this.group) return new N(Math.abs(this.scaleX), Math.abs(this.scaleY));
            let e3 = He(this.calcTransformMatrix());
            return new N(Math.abs(e3.scaleX), Math.abs(e3.scaleY));
          }
          getTotalObjectScaling() {
            let e3 = this.getObjectScaling();
            if (this.canvas) {
              let t2 = this.canvas.getZoom(), n2 = this.getCanvasRetinaScaling();
              return e3.scalarMultiply(t2 * n2);
            }
            return e3;
          }
          getObjectOpacity() {
            let e3 = this.opacity;
            return this.group && (e3 *= this.group.getObjectOpacity()), e3;
          }
          _constrainScale(e3) {
            return Math.abs(e3) < this.minScaleLimit ? e3 < 0 ? -this.minScaleLimit : this.minScaleLimit : e3 === 0 ? 1e-4 : e3;
          }
          _set(e3, t2) {
            e3 !== `scaleX` && e3 !== `scaleY` || (t2 = this._constrainScale(t2)), e3 === `scaleX` && t2 < 0 ? (this.flipX = !this.flipX, t2 *= -1) : e3 === `scaleY` && t2 < 0 ? (this.flipY = !this.flipY, t2 *= -1) : e3 !== `shadow` || !t2 || t2 instanceof Bn || (t2 = new Bn(t2));
            let n2 = this[e3] !== t2;
            return this[e3] = t2, n2 && this.constructor.cacheProperties.includes(e3) && (this.dirty = true), this.parent && (this.dirty || n2 && this.constructor.stateProperties.includes(e3)) && this.parent._set(`dirty`, true), this;
          }
          isNotVisible() {
            return this.opacity === 0 || !this.width && !this.height && this.strokeWidth === 0 || !this.visible;
          }
          render(e3) {
            this.isNotVisible() || this.canvas && this.canvas.skipOffscreen && !this.group && !this.isOnScreen() || (e3.save(), this._setupCompositeOperation(e3), this.drawSelectionBackground(e3), this.transform(e3), this._setOpacity(e3), this._setShadow(e3), this.shouldCache() ? (this.renderCache(), this.drawCacheOnCanvas(e3)) : (this._removeCacheCanvas(), this.drawObject(e3, false, {}), this.dirty = false), e3.restore());
          }
          drawSelectionBackground(e3) {
          }
          renderCache(e3) {
            if (e3 = e3 || {}, this._cacheCanvas && this._cacheContext || this._createCacheCanvas(), this.isCacheDirty() && this._cacheContext) {
              let { zoomX: t2, zoomY: n2, cacheTranslationX: r2, cacheTranslationY: i2 } = this, { width: a2, height: o2 } = this._cacheCanvas;
              this.drawObject(this._cacheContext, e3.forClipping, { zoomX: t2, zoomY: n2, cacheTranslationX: r2, cacheTranslationY: i2, width: a2, height: o2, parentClipPaths: [] }), this.dirty = false;
            }
          }
          _removeCacheCanvas() {
            this._cacheCanvas = void 0, this._cacheContext = null;
          }
          hasStroke() {
            return !!this.stroke && this.stroke !== `transparent` && this.strokeWidth !== 0;
          }
          hasFill() {
            return !!this.fill && this.fill !== `transparent`;
          }
          needsItsOwnCache() {
            return !!(this.paintFirst === `stroke` && this.hasFill() && this.hasStroke() && this.shadow) || !!this.clipPath;
          }
          shouldCache() {
            return this.ownCaching = this.objectCaching && (!this.parent || !this.parent.isOnACache()) || this.needsItsOwnCache(), this.ownCaching;
          }
          willDrawShadow() {
            return !!this.shadow && (this.shadow.offsetX !== 0 || this.shadow.offsetY !== 0);
          }
          drawClipPathOnCache(e3, t2, n2) {
            e3.save(), t2.inverted ? e3.globalCompositeOperation = `destination-out` : e3.globalCompositeOperation = `destination-in`, e3.setTransform(1, 0, 0, 1, 0, 0), e3.drawImage(n2, 0, 0), e3.restore();
          }
          drawObject(e3, t2, n2) {
            let r2 = this.fill, i2 = this.stroke;
            t2 ? (this.fill = `black`, this.stroke = ``, this._setClippingProperties(e3)) : this._renderBackground(e3), this.fire(`before:render`, { ctx: e3 }), this._render(e3), this._drawClipPath(e3, this.clipPath, n2), this.fill = r2, this.stroke = i2;
          }
          createClipPathLayer(e3, t2) {
            let n2 = F(t2), r2 = n2.getContext(`2d`);
            if (r2.translate(t2.cacheTranslationX, t2.cacheTranslationY), r2.scale(t2.zoomX, t2.zoomY), e3._cacheCanvas = n2, t2.parentClipPaths.forEach((e4) => {
              e4.transform(r2);
            }), t2.parentClipPaths.push(e3), e3.absolutePositioned) {
              let e4 = R(this.calcTransformMatrix());
              r2.transform(e4[0], e4[1], e4[2], e4[3], e4[4], e4[5]);
            }
            return e3.transform(r2), e3.drawObject(r2, true, t2), n2;
          }
          _drawClipPath(e3, t2, n2) {
            if (!t2) return;
            t2._transformDone = true;
            let r2 = this.createClipPathLayer(t2, n2);
            this.drawClipPathOnCache(e3, t2, r2);
          }
          drawCacheOnCanvas(e3) {
            e3.scale(1 / this.zoomX, 1 / this.zoomY), e3.drawImage(this._cacheCanvas, -this.cacheTranslationX, -this.cacheTranslationY);
          }
          isCacheDirty(e3 = false) {
            if (this.isNotVisible()) return false;
            let t2 = this._cacheCanvas, n2 = this._cacheContext;
            return !(!t2 || !n2 || e3 || !this._updateCacheCanvas()) || !!(this.dirty || this.clipPath && this.clipPath.absolutePositioned) && (t2 && n2 && !e3 && (n2.save(), n2.setTransform(1, 0, 0, 1, 0, 0), n2.clearRect(0, 0, t2.width, t2.height), n2.restore()), true);
          }
          _renderBackground(e3) {
            if (!this.backgroundColor) return;
            let t2 = this._getNonTransformedDimensions();
            e3.fillStyle = this.backgroundColor, e3.fillRect(-t2.x / 2, -t2.y / 2, t2.x, t2.y), this._removeShadow(e3);
          }
          _setOpacity(e3) {
            this.group && !this.group._transformDone ? e3.globalAlpha = this.getObjectOpacity() : e3.globalAlpha *= this.opacity;
          }
          _setStrokeStyles(e3, t2) {
            let n2 = t2.stroke;
            n2 && (e3.lineWidth = t2.strokeWidth, e3.lineCap = t2.strokeLineCap, e3.lineDashOffset = t2.strokeDashOffset, e3.lineJoin = t2.strokeLineJoin, e3.miterLimit = t2.strokeMiterLimit, V(n2) ? n2.gradientUnits === `percentage` || n2.gradientTransform || n2.patternTransform ? this._applyPatternForTransformedGradient(e3, n2) : (e3.strokeStyle = n2.toLive(e3), this._applyPatternGradientTransform(e3, n2)) : e3.strokeStyle = t2.stroke);
          }
          _setFillStyles(e3, { fill: t2 }) {
            t2 && (V(t2) ? (e3.fillStyle = t2.toLive(e3), this._applyPatternGradientTransform(e3, t2)) : e3.fillStyle = t2);
          }
          _setClippingProperties(e3) {
            e3.globalAlpha = 1, e3.strokeStyle = `transparent`, e3.fillStyle = `#000000`;
          }
          _setLineDash(e3, t2) {
            t2 && t2.length !== 0 && e3.setLineDash(t2);
          }
          _setShadow(e3) {
            if (!this.shadow) return;
            let t2 = this.shadow, n2 = this.canvas, r2 = this.getCanvasRetinaScaling(), [i2, , , a2] = (n2 == null ? void 0 : n2.viewportTransform) || T, o2 = i2 * r2, c2 = a2 * r2, l2 = t2.nonScaling ? new N(1, 1) : this.getObjectScaling();
            e3.shadowColor = t2.color, e3.shadowBlur = t2.blur * s.browserShadowBlurConstant * (o2 + c2) * (l2.x + l2.y) / 4, e3.shadowOffsetX = t2.offsetX * o2 * l2.x, e3.shadowOffsetY = t2.offsetY * c2 * l2.y;
          }
          _removeShadow(e3) {
            this.shadow && (e3.shadowColor = ``, e3.shadowBlur = e3.shadowOffsetX = e3.shadowOffsetY = 0);
          }
          _applyPatternGradientTransform(e3, t2) {
            if (!V(t2)) return { offsetX: 0, offsetY: 0 };
            let n2 = t2.gradientTransform || t2.patternTransform, r2 = -this.width / 2 + t2.offsetX || 0, i2 = -this.height / 2 + t2.offsetY || 0;
            return t2.gradientUnits === `percentage` ? e3.transform(this.width, 0, 0, this.height, r2, i2) : e3.transform(1, 0, 0, 1, r2, i2), n2 && e3.transform(n2[0], n2[1], n2[2], n2[3], n2[4], n2[5]), { offsetX: r2, offsetY: i2 };
          }
          _renderPaintInOrder(e3) {
            this.paintFirst === `stroke` ? (this._renderStroke(e3), this._renderFill(e3)) : (this._renderFill(e3), this._renderStroke(e3));
          }
          _render(e3) {
          }
          _renderFill(e3) {
            this.fill && (e3.save(), this._setFillStyles(e3, this), this.fillRule === `evenodd` ? e3.fill(`evenodd`) : e3.fill(), e3.restore());
          }
          _renderStroke(e3) {
            if (this.stroke && this.strokeWidth !== 0) {
              if (this.shadow && !this.shadow.affectStroke && this._removeShadow(e3), e3.save(), this.strokeUniform) {
                let t2 = this.getObjectScaling();
                e3.scale(1 / t2.x, 1 / t2.y);
              }
              this._setLineDash(e3, this.strokeDashArray), this._setStrokeStyles(e3, this), e3.stroke(), e3.restore();
            }
          }
          _applyPatternForTransformedGradient(e3, t2) {
            var n2;
            let r2 = this._limitCacheSize(this._getCacheCanvasDimensions()), i2 = this.getCanvasRetinaScaling(), a2 = r2.x / this.scaleX / i2, o2 = r2.y / this.scaleY / i2, s2 = F({ width: Math.ceil(a2), height: Math.ceil(o2) }), c2 = s2.getContext(`2d`);
            c2 && (c2.beginPath(), c2.moveTo(0, 0), c2.lineTo(a2, 0), c2.lineTo(a2, o2), c2.lineTo(0, o2), c2.closePath(), c2.translate(a2 / 2, o2 / 2), c2.scale(r2.zoomX / this.scaleX / i2, r2.zoomY / this.scaleY / i2), this._applyPatternGradientTransform(c2, t2), c2.fillStyle = t2.toLive(e3), c2.fill(), e3.translate(-this.width / 2 - this.strokeWidth / 2, -this.height / 2 - this.strokeWidth / 2), e3.scale(i2 * this.scaleX / r2.zoomX, i2 * this.scaleY / r2.zoomY), e3.strokeStyle = (n2 = c2.createPattern(s2, `no-repeat`)) == null ? `` : n2);
          }
          _findCenterFromElement() {
            return new N(this.left + this.width / 2, this.top + this.height / 2);
          }
          clone(e3) {
            let t2 = this.toObject(e3);
            return this.constructor.fromObject(t2);
          }
          cloneAsImage(e3) {
            let t2 = this.toCanvasElement(e3);
            return new (M.getClass(`image`))(t2);
          }
          toCanvasElement(e3 = {}) {
            let t2 = kt(this), n2 = this.group, r2 = this.shadow, i2 = Math.abs, a2 = e3.enableRetinaScaling ? v() : 1, o2 = (e3.multiplier || 1) * a2, s2 = e3.canvasProvider || ((e4) => new yt(e4, { enableRetinaScaling: false, renderOnAddRemove: false, skipOffscreen: false }));
            delete this.group, e3.withoutTransform && Ot(this), e3.withoutShadow && (this.shadow = null), e3.viewportTransform && Pt(this, this.getViewportTransform()), this.setCoords();
            let c2 = P(), l2 = this.getBoundingRect(), u2 = this.shadow, d2 = new N();
            if (u2) {
              let e4 = u2.blur, t3 = u2.nonScaling ? new N(1, 1) : this.getObjectScaling();
              d2.x = 2 * Math.round(i2(u2.offsetX) + e4) * i2(t3.x), d2.y = 2 * Math.round(i2(u2.offsetY) + e4) * i2(t3.y);
            }
            let f2 = l2.width + d2.x, p2 = l2.height + d2.y;
            c2.width = Math.ceil(f2), c2.height = Math.ceil(p2);
            let m2 = s2(c2);
            e3.format === `jpeg` && (m2.backgroundColor = `#fff`), this.setPositionByOrigin(new N(m2.width / 2, m2.height / 2), E, E);
            let h2 = this.canvas;
            m2._objects = [this], this.set(`canvas`, m2), this.setCoords();
            let g2 = m2.toCanvasElement(o2 || 1, e3);
            return this.set(`canvas`, h2), this.shadow = r2, n2 && (this.group = n2), this.set(t2), this.setCoords(), m2._objects = [], m2.destroy(), g2;
          }
          toDataURL(e3 = {}) {
            return Pe(this.toCanvasElement(e3), e3.format || `png`, e3.quality || 1);
          }
          toBlob(e3 = {}) {
            return Fe(this.toCanvasElement(e3), e3.format || `png`, e3.quality || 1);
          }
          isType(...e3) {
            return e3.includes(this.constructor.type) || e3.includes(this.type);
          }
          complexity() {
            return 1;
          }
          toJSON() {
            return this.toObject();
          }
          rotate(e3) {
            let { centeredRotation: t2, originX: n2, originY: r2 } = this;
            if (t2) {
              let { x: e4, y: t3 } = this.getRelativeCenterPoint();
              this.originX = E, this.originY = E, this.left = e4, this.top = t3;
            }
            if (this.set(`angle`, e3), t2) {
              let { x: e4, y: t3 } = this.getPositionByOrigin(n2, r2);
              this.left = e4, this.top = t3, this.originX = n2, this.originY = r2;
            }
          }
          setOnGroup() {
          }
          _setupCompositeOperation(e3) {
            this.globalCompositeOperation && (e3.globalCompositeOperation = this.globalCompositeOperation);
          }
          dispose() {
            ye.cancelByTarget(this), this.off(), this._set(`canvas`, void 0), this._cacheCanvas && h().dispose(this._cacheCanvas), this._cacheCanvas = void 0, this._cacheContext = null;
          }
          animate(e3, t2) {
            return Object.entries(e3).reduce((e4, [n2, r2]) => (e4[n2] = this._animate(n2, r2, t2), e4), {});
          }
          _animate(e3, t2, n2 = {}) {
            let r2 = e3.split(`.`), i2 = this.constructor.colorProperties.includes(r2[r2.length - 1]), { abort: a2, startValue: o2, onChange: s2, onComplete: c2 } = n2, l2 = { ...n2, target: this, startValue: o2 == null ? r2.reduce((e4, t3) => e4[t3], this) : o2, endValue: t2, abort: a2 == null ? void 0 : a2.bind(this), onChange: (e4, t3, n3) => {
              r2.reduce((t4, n4, i3) => (i3 === r2.length - 1 && (t4[n4] = e4), t4[n4]), this), s2 && s2(e4, t3, n3);
            }, onComplete: (e4, t3, n3) => {
              this.setCoords(), c2 && c2(e4, t3, n3);
            } };
            return i2 ? Nr(l2) : Mr(l2);
          }
          isDescendantOf(e3) {
            let { parent: t2, group: n2 } = this;
            return t2 === e3 || n2 === e3 || !!t2 && t2.isDescendantOf(e3) || !!n2 && n2 !== t2 && n2.isDescendantOf(e3);
          }
          getAncestors() {
            let e3 = [], t2 = this;
            do
              t2 = t2.parent, t2 && e3.push(t2);
            while (t2);
            return e3;
          }
          findCommonAncestors(e3) {
            if (this === e3) return { fork: [], otherFork: [], common: [this, ...this.getAncestors()] };
            let t2 = this.getAncestors(), n2 = e3.getAncestors();
            if (t2.length === 0 && n2.length > 0 && this === n2[n2.length - 1]) return { fork: [], otherFork: [e3, ...n2.slice(0, n2.length - 1)], common: [this] };
            for (let r2, i2 = 0; i2 < t2.length; i2++) {
              if (r2 = t2[i2], r2 === e3) return { fork: [this, ...t2.slice(0, i2)], otherFork: [], common: t2.slice(i2) };
              for (let a2 = 0; a2 < n2.length; a2++) {
                if (this === n2[a2]) return { fork: [], otherFork: [e3, ...n2.slice(0, a2)], common: [this, ...t2] };
                if (r2 === n2[a2]) return { fork: [this, ...t2.slice(0, i2)], otherFork: [e3, ...n2.slice(0, a2)], common: t2.slice(i2) };
              }
            }
            return { fork: [this, ...t2], otherFork: [e3, ...n2], common: [] };
          }
          hasCommonAncestors(e3) {
            let t2 = this.findCommonAncestors(e3);
            return t2 && !!t2.common.length;
          }
          isInFrontOf(e3) {
            if (this === e3) return;
            let t2 = this.findCommonAncestors(e3);
            if (t2.fork.includes(e3)) return true;
            if (t2.otherFork.includes(this)) return false;
            let n2 = t2.common[0] || this.canvas;
            if (!n2) return;
            let r2 = t2.fork.pop(), i2 = t2.otherFork.pop(), a2 = n2._objects.indexOf(r2), o2 = n2._objects.indexOf(i2);
            return a2 > -1 && a2 > o2;
          }
          toObject(t2 = []) {
            let n2 = t2.concat(e2.customProperties, this.constructor.customProperties || []), r2, i2 = s.NUM_FRACTION_DIGITS, { clipPath: a2, fill: o2, stroke: c2, shadow: l2, strokeDashArray: u2, left: d2, top: f2, originX: p2, originY: m2, width: h2, height: g2, strokeWidth: _2, strokeLineCap: v2, strokeDashOffset: y2, strokeLineJoin: x2, strokeUniform: S2, strokeMiterLimit: C2, scaleX: w2, scaleY: ee2, angle: T2, flipX: E2, flipY: D2, opacity: O2, visible: k2, backgroundColor: te2, fillRule: ne2, paintFirst: re2, globalCompositeOperation: ie2, skewX: ae2, skewY: oe2 } = this;
            a2 && !a2.excludeFromExport && (r2 = a2.toObject(n2.concat(`inverted`, `absolutePositioned`)));
            let A2 = (e3) => B(e3, i2), se2 = { ...et(this, n2), type: this.constructor.type, version: b, originX: p2, originY: m2, left: A2(d2), top: A2(f2), width: A2(h2), height: A2(g2), fill: rt(o2) ? o2.toObject() : o2, stroke: rt(c2) ? c2.toObject() : c2, strokeWidth: A2(_2), strokeDashArray: u2 && u2.concat(), strokeLineCap: v2, strokeDashOffset: y2, strokeLineJoin: x2, strokeUniform: S2, strokeMiterLimit: A2(C2), scaleX: A2(w2), scaleY: A2(ee2), angle: A2(T2), flipX: E2, flipY: D2, opacity: A2(O2), shadow: l2 && l2.toObject(), visible: k2, backgroundColor: te2, fillRule: ne2, paintFirst: re2, globalCompositeOperation: ie2, skewX: A2(ae2), skewY: A2(oe2), ...r2 ? { clipPath: r2 } : null };
            return this.includeDefaultValues ? se2 : this._removeDefaultValues(se2);
          }
          toDatalessObject(e3) {
            return this.toObject(e3);
          }
          _removeDefaultValues(e3) {
            let t2 = this.constructor.getDefaults(), n2 = Object.keys(t2).length > 0 ? t2 : Object.getPrototypeOf(this);
            return tt(e3, (e4, t3) => {
              if (t3 === `left` || t3 === `top` || t3 === `type`) return true;
              let r2 = n2[t3];
              return e4 !== r2 && !(Array.isArray(e4) && Array.isArray(r2) && e4.length === 0 && r2.length === 0);
            });
          }
          toString() {
            return `#<${this.constructor.type}>`;
          }
          static _fromObject({ type: e3, ...t2 }, { extraParam: n2, ...r2 } = {}) {
            return $e(t2, r2).then((e4) => n2 ? (delete e4[n2], new this(t2[n2], e4)) : new this(e4));
          }
          static fromObject(e3, t2) {
            return this._fromObject(e3, t2);
          }
        };
        a(Ir, `stateProperties`, Hn), a(Ir, `cacheProperties`, Un), a(Ir, `ownDefaults`, Wn), a(Ir, `type`, `FabricObject`), a(Ir, `colorProperties`, [j, he, `backgroundColor`]), a(Ir, `customProperties`, []), M.setClass(Ir), M.setClass(Ir, `object`);
        let Lr = (e2, t2) => {
          var n2;
          let { transform: { target: r2 } } = t2;
          (n2 = r2.canvas) == null || n2.fire(`object:${e2}`, { ...t2, target: r2 }), r2.fire(e2, t2);
        }, Rr = (e2, t2, n2) => (r2, i2, a2, o2) => {
          let s2 = t2(r2, i2, a2, o2);
          return s2 && Lr(e2, { ...Qt(r2, i2, a2, o2), ...n2 }), s2;
        };
        function zr(e2) {
          return (t2, n2, r2, i2) => {
            let { target: a2, originX: o2, originY: s2 } = n2, c2 = a2.getPositionByOrigin(o2, s2), l2 = e2(t2, n2, r2, i2);
            return a2.setPositionByOrigin(c2, n2.originX, n2.originY), l2;
          };
        }
        let Br = (e2, t2, n2, r2) => (i2, a2, o2, s2) => {
          let c2 = en(a2, a2.originX, a2.originY, o2, s2)[n2], l2 = W(a2[t2]);
          if (l2 === 0 || l2 > 0 && c2 < 0 || l2 < 0 && c2 > 0) {
            let { target: t3 } = a2, n3 = t3.strokeWidth / (t3.strokeUniform ? t3[r2] : 1), i3 = Yt(a2) ? 2 : 1, o3 = t3[e2], s3 = Math.abs(c2 * i3 / t3[r2]) - n3;
            return t3.set(e2, Math.max(s3, 1)), o3 !== t3[e2];
          }
          return false;
        }, Vr = Br(`width`, `originX`, `x`, `scaleX`), Hr = Br(`height`, `originY`, `y`, `scaleY`), Ur = Rr(se, zr(Vr)), Wr = Rr(se, zr(Hr));
        function Gr(e2, t2, n2, r2, i2) {
          e2.save();
          let { stroke: a2, xSize: o2, ySize: s2, opName: c2 } = this.commonRenderProps(e2, t2, n2, i2, r2), l2 = o2;
          o2 > s2 ? e2.scale(1, s2 / o2) : s2 > o2 && (l2 = s2, e2.scale(o2 / s2, 1)), e2.beginPath(), e2.arc(0, 0, l2 / 2, 0, w, false), e2[c2](), a2 && e2.stroke(), e2.restore();
        }
        function Kr(e2, t2, n2, r2, i2) {
          e2.save();
          let { stroke: a2, xSize: o2, ySize: s2, opName: c2 } = this.commonRenderProps(e2, t2, n2, i2, r2), l2 = o2 / 2, u2 = s2 / 2;
          e2[`${c2}Rect`](-l2, -u2, o2, s2), a2 && e2.strokeRect(-l2, -u2, o2, s2), e2.restore();
        }
        var q = class {
          constructor(e2) {
            a(this, `visible`, true), a(this, `actionName`, ue), a(this, `angle`, 0), a(this, `x`, 0), a(this, `y`, 0), a(this, `offsetX`, 0), a(this, `offsetY`, 0), a(this, `sizeX`, 0), a(this, `sizeY`, 0), a(this, `touchSizeX`, 0), a(this, `touchSizeY`, 0), a(this, `cursorStyle`, `crosshair`), a(this, `withConnection`, false), Object.assign(this, e2);
          }
          getTransformAnchorPoint() {
            var e2;
            return (e2 = this.transformAnchorPoint) == null ? new N(0.5 - this.x, 0.5 - this.y) : e2;
          }
          shouldActivate(e2, t2, n2, { tl: r2, tr: i2, br: a2, bl: o2 }) {
            var s2;
            return ((s2 = t2.canvas) == null ? void 0 : s2.getActiveObject()) === t2 && t2.isControlVisible(e2) && Pr.isPointInPolygon(n2, [r2, i2, a2, o2]);
          }
          getActionHandler(e2, t2, n2) {
            return this.actionHandler;
          }
          getMouseDownHandler(e2, t2, n2) {
            return this.mouseDownHandler;
          }
          getMouseUpHandler(e2, t2, n2) {
            return this.mouseUpHandler;
          }
          cursorStyleHandler(e2, t2, n2, r2) {
            return t2.cursorStyle;
          }
          getActionName(e2, t2, n2) {
            return t2.actionName;
          }
          getVisibility(e2, t2) {
            var n2, r2;
            return (n2 = (r2 = e2._controlsVisibility) == null ? void 0 : r2[t2]) == null ? this.visible : n2;
          }
          setVisibility(e2, t2, n2) {
            this.visible = e2;
          }
          positionHandler(e2, t2, n2, r2) {
            return new N(this.x * e2.x + this.offsetX, this.y * e2.y + this.offsetY).transform(t2);
          }
          calcCornerCoords(e2, t2, n2, r2, i2, a2) {
            let o2 = Re([Ue(n2, r2), We({ angle: e2 }), Ge((i2 ? this.touchSizeX : this.sizeX) || t2, (i2 ? this.touchSizeY : this.sizeY) || t2)]);
            return { tl: new N(-0.5, -0.5).transform(o2), tr: new N(0.5, -0.5).transform(o2), br: new N(0.5, 0.5).transform(o2), bl: new N(-0.5, 0.5).transform(o2) };
          }
          commonRenderProps(e2, t2, n2, r2, i2 = {}) {
            let { cornerSize: a2, cornerColor: o2, transparentCorners: s2, cornerStrokeColor: c2 } = i2, l2 = a2 || r2.cornerSize, u2 = this.sizeX || l2, d2 = this.sizeY || l2, f2 = s2 === void 0 ? r2.transparentCorners : s2, p2 = f2 ? he : j, m2 = c2 || r2.cornerStrokeColor, h2 = !f2 && !!m2;
            return e2.fillStyle = o2 || r2.cornerColor || ``, e2.strokeStyle = m2 || ``, e2.translate(t2, n2), e2.rotate(I(r2.getTotalAngle())), { stroke: h2, xSize: u2, ySize: d2, transparentCorners: f2, opName: p2 };
          }
          render(e2, t2, n2, r2, i2) {
            ((r2 = r2 || {}).cornerStyle || i2.cornerStyle) === `circle` ? Gr.call(this, e2, t2, n2, r2, i2) : Kr.call(this, e2, t2, n2, r2, i2);
          }
        };
        let qr = (e2, t2, n2) => n2.lockRotation ? Jt : t2.cursorStyle, Jr = Rr(ae, zr((e2, { target: t2, ex: n2, ey: r2, theta: i2, originX: a2, originY: o2 }, s2, c2) => {
          let l2 = t2.getPositionByOrigin(a2, o2);
          if (Zt(t2, `lockRotation`)) return false;
          let u2 = Math.atan2(r2 - l2.y, n2 - l2.x), d2 = Ie(Math.atan2(c2 - l2.y, s2 - l2.x) - u2 + i2);
          if (t2.snapAngle && t2.snapAngle > 0) {
            let e3 = t2.snapAngle, n3 = t2.snapThreshold || e3, r3 = Math.ceil(d2 / e3) * e3, i3 = Math.floor(d2 / e3) * e3;
            Math.abs(d2 - i3) < n3 ? d2 = i3 : Math.abs(d2 - r3) < n3 && (d2 = r3);
          }
          d2 < 0 && (d2 = 360 + d2), d2 %= 360;
          let f2 = t2.angle !== d2;
          return t2.angle = d2, f2;
        }));
        function Yr(e2, t2) {
          let n2 = t2.canvas, r2 = e2[n2.uniScaleKey];
          return n2.uniformScaling && !r2 || !n2.uniformScaling && r2;
        }
        function Xr(e2, t2, n2) {
          let r2 = Zt(e2, `lockScalingX`), i2 = Zt(e2, `lockScalingY`);
          if (r2 && i2 || !t2 && (r2 || i2) && n2 || r2 && t2 === `x` || i2 && t2 === `y`) return true;
          let { width: a2, height: o2, strokeWidth: s2 } = e2;
          return a2 === 0 && s2 === 0 && t2 !== `y` || o2 === 0 && s2 === 0 && t2 !== `x`;
        }
        let Zr = [`e`, `se`, `s`, `sw`, `w`, `nw`, `n`, `ne`, `e`], Qr = (e2, t2, n2, r2) => {
          let i2 = Yr(e2, n2);
          return Xr(n2, t2.x !== 0 && t2.y === 0 ? `x` : t2.x === 0 && t2.y !== 0 ? `y` : ``, i2) ? Jt : `${Zr[$t(n2, 0, r2)]}-resize`;
        };
        function $r(e2, t2, n2, r2, i2 = {}) {
          let a2 = t2.target, o2 = i2.by, s2 = Yr(e2, a2), c2, l2, u2, d2, f2, p2;
          if (Xr(a2, o2, s2)) return false;
          if (t2.gestureScale) l2 = t2.scaleX * t2.gestureScale, u2 = t2.scaleY * t2.gestureScale;
          else {
            if (c2 = en(t2, t2.originX, t2.originY, n2, r2), f2 = o2 === `y` ? 1 : Math.sign(c2.x || t2.signX || 1), p2 = o2 === `x` ? 1 : Math.sign(c2.y || t2.signY || 1), t2.signX || (t2.signX = f2), t2.signY || (t2.signY = p2), Zt(a2, `lockScalingFlip`) && (t2.signX !== f2 || t2.signY !== p2)) return false;
            if (d2 = a2._getTransformedDimensions(), s2 && !o2) {
              let e3 = Math.abs(c2.x) + Math.abs(c2.y), { original: n3 } = t2, r3 = e3 / (Math.abs(d2.x * n3.scaleX / a2.scaleX) + Math.abs(d2.y * n3.scaleY / a2.scaleY));
              l2 = n3.scaleX * r3, u2 = n3.scaleY * r3;
            } else l2 = Math.abs(c2.x * a2.scaleX / d2.x), u2 = Math.abs(c2.y * a2.scaleY / d2.y);
            Yt(t2) && (l2 *= 2, u2 *= 2), t2.signX !== f2 && o2 !== `y` && (t2.originX = Xt(t2.originX), l2 *= -1, t2.signX = f2), t2.signY !== p2 && o2 !== `x` && (t2.originY = Xt(t2.originY), u2 *= -1, t2.signY = p2);
          }
          let m2 = a2.scaleX, h2 = a2.scaleY;
          return o2 ? (o2 === `x` && a2.set(`scaleX`, l2), o2 === `y` && a2.set(`scaleY`, u2)) : (!Zt(a2, `lockScalingX`) && a2.set(`scaleX`, l2), !Zt(a2, `lockScalingY`) && a2.set(`scaleY`, u2)), m2 !== a2.scaleX || h2 !== a2.scaleY;
        }
        let ei = Rr(ie, zr((e2, t2, n2, r2) => $r(e2, t2, n2, r2))), ti = Rr(ie, zr((e2, t2, n2, r2) => $r(e2, t2, n2, r2, { by: `x` }))), ni = Rr(ie, zr((e2, t2, n2, r2) => $r(e2, t2, n2, r2, { by: `y` }))), ri = { x: { counterAxis: `y`, scale: de, skew: pe, lockSkewing: `lockSkewingX`, origin: `originX`, flip: `flipX` }, y: { counterAxis: `x`, scale: fe, skew: me, lockSkewing: `lockSkewingY`, origin: `originY`, flip: `flipY` } }, ii = [`ns`, `nesw`, `ew`, `nwse`], ai = (e2, t2, n2, r2) => t2.x !== 0 && Zt(n2, `lockSkewingY`) || t2.y !== 0 && Zt(n2, `lockSkewingX`) ? Jt : `${ii[$t(n2, 0, r2) % 4]}-resize`;
        function oi(e2, t2, n2, r2, i2) {
          let { target: a2 } = n2, { counterAxis: o2, origin: s2, lockSkewing: c2, skew: l2, flip: u2 } = ri[e2];
          if (Zt(a2, c2)) return false;
          let { origin: d2, flip: f2 } = ri[o2], p2 = W(n2[d2]) * (a2[f2] ? -1 : 1), m2 = -Math.sign(p2) * (a2[u2] ? -1 : 1), h2 = -(a2[l2] === 0 && en(n2, `center`, `center`, r2, i2)[e2] > 0 || a2[l2] > 0 ? 1 : -1) * m2 * 0.5 + 0.5;
          return Rr(A, zr((t3, n3, r3, i3) => function(e3, { target: t4, ex: n4, ey: r4, skewingSide: i4, ...a3 }, o3) {
            let { skew: s3 } = ri[e3], c3 = o3.subtract(new N(n4, r4)).divide(new N(t4.scaleX, t4.scaleY))[e3], l3 = t4[s3], u3 = a3[s3], d3 = Math.tan(I(u3)), f3 = e3 === `y` ? t4._getTransformedDimensions({ scaleX: 1, scaleY: 1, skewX: 0 }).x : t4._getTransformedDimensions({ scaleX: 1, scaleY: 1 }).y, p3 = 2 * c3 * i4 / Math.max(f3, 1) + d3, m3 = Ie(Math.atan(p3));
            t4.set(s3, m3);
            let h3 = l3 !== t4[s3];
            if (h3 && e3 === `y`) {
              let { skewX: e4, scaleX: n5 } = t4, r5 = t4._getTransformedDimensions({ skewY: l3 }), i5 = t4._getTransformedDimensions(), a4 = e4 === 0 ? 1 : r5.x / i5.x;
              a4 !== 1 && t4.set(`scaleX`, a4 * n5);
            }
            return h3;
          }(e2, n3, new N(r3, i3))))(t2, { ...n2, [s2]: h2, skewingSide: m2 }, r2, i2);
        }
        let si = (e2, t2, n2, r2) => oi(`x`, e2, t2, n2, r2), ci = (e2, t2, n2, r2) => oi(`y`, e2, t2, n2, r2);
        function li(e2, t2) {
          return e2[t2.canvas.altActionKey];
        }
        let ui = (e2, t2, n2) => {
          let r2 = li(e2, n2);
          return t2.x === 0 ? r2 ? pe : fe : t2.y === 0 ? r2 ? me : de : ``;
        }, di = (e2, t2, n2, r2) => li(e2, n2) ? ai(0, t2, n2, r2) : Qr(e2, t2, n2, r2), fi = (e2, t2, n2, r2) => li(e2, t2.target) ? ci(e2, t2, n2, r2) : ti(e2, t2, n2, r2), pi = (e2, t2, n2, r2) => li(e2, t2.target) ? si(e2, t2, n2, r2) : ni(e2, t2, n2, r2), mi = () => ({ ml: new q({ x: -0.5, y: 0, cursorStyleHandler: di, actionHandler: fi, getActionName: ui }), mr: new q({ x: 0.5, y: 0, cursorStyleHandler: di, actionHandler: fi, getActionName: ui }), mb: new q({ x: 0, y: 0.5, cursorStyleHandler: di, actionHandler: pi, getActionName: ui }), mt: new q({ x: 0, y: -0.5, cursorStyleHandler: di, actionHandler: pi, getActionName: ui }), tl: new q({ x: -0.5, y: -0.5, cursorStyleHandler: Qr, actionHandler: ei }), tr: new q({ x: 0.5, y: -0.5, cursorStyleHandler: Qr, actionHandler: ei }), bl: new q({ x: -0.5, y: 0.5, cursorStyleHandler: Qr, actionHandler: ei }), br: new q({ x: 0.5, y: 0.5, cursorStyleHandler: Qr, actionHandler: ei }), mtr: new q({ x: 0, y: -0.5, actionHandler: Jr, cursorStyleHandler: qr, offsetY: -40, withConnection: true, actionName: oe }) }), hi = () => ({ mr: new q({ x: 0.5, y: 0, actionHandler: Ur, cursorStyleHandler: di, actionName: se }), ml: new q({ x: -0.5, y: 0, actionHandler: Ur, cursorStyleHandler: di, actionName: se }) }), gi = () => ({ ...mi(), ...hi() });
        var _i = class e2 extends Ir {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2) {
            super(), Object.assign(this, this.constructor.createControls(), e2.ownDefaults), this.setOptions(t2);
          }
          static createControls() {
            return { controls: mi() };
          }
          _updateCacheCanvas() {
            let e3 = this.canvas;
            if (this.noScaleCache && e3 && e3._currentTransform) {
              let t2 = e3._currentTransform, n2 = t2.target, r2 = t2.action;
              if (this === n2 && r2 && r2.startsWith(`scale`)) return false;
            }
            return super._updateCacheCanvas();
          }
          getActiveControl() {
            let e3 = this.__corner;
            return e3 ? { key: e3, control: this.controls[e3], coord: this.oCoords[e3] } : void 0;
          }
          findControl(e3, t2 = false) {
            if (!this.hasControls || !this.canvas) return;
            this.__corner = void 0;
            let n2 = Object.entries(this.oCoords);
            for (let r2 = n2.length - 1; r2 >= 0; r2--) {
              let [i2, a2] = n2[r2], o2 = this.controls[i2];
              if (o2.shouldActivate(i2, this, e3, t2 ? a2.touchCorner : a2.corner)) return this.__corner = i2, { key: i2, control: o2, coord: this.oCoords[i2] };
            }
          }
          calcOCoords() {
            let e3 = this.getViewportTransform(), t2 = Be(e3), n2 = Ve(e3), r2 = this.getCenterPoint(), i2 = z(z(e3, z(Ue(r2.x, r2.y), We({ angle: this.getTotalAngle() - (this.group && this.flipX ? 180 : 0) }))), [1 / t2, 0, 0, 1 / n2, 0, 0]), a2 = this.group ? He(this.calcTransformMatrix()) : void 0;
            a2 && (a2.scaleX = Math.abs(a2.scaleX), a2.scaleY = Math.abs(a2.scaleY));
            let o2 = this._calculateCurrentDimensions(a2), s2 = {};
            return this.forEachControl((e4, t3) => {
              let n3 = e4.positionHandler(o2, i2, this, e4);
              s2[t3] = Object.assign(n3, this._calcCornerCoords(e4, n3));
            }), s2;
          }
          _calcCornerCoords(e3, t2) {
            let n2 = this.getTotalAngle();
            return { corner: e3.calcCornerCoords(n2, this.cornerSize, t2.x, t2.y, false, this), touchCorner: e3.calcCornerCoords(n2, this.touchCornerSize, t2.x, t2.y, true, this) };
          }
          setCoords() {
            super.setCoords(), this.canvas && (this.oCoords = this.calcOCoords());
          }
          forEachControl(e3) {
            for (let t2 in this.controls) e3(this.controls[t2], t2, this);
          }
          drawSelectionBackground(e3) {
            if (!this.selectionBackgroundColor || this.canvas && this.canvas._activeObject !== this) return;
            e3.save();
            let t2 = this.getRelativeCenterPoint(), n2 = this._calculateCurrentDimensions(), r2 = this.getViewportTransform();
            e3.translate(t2.x, t2.y), e3.scale(1 / r2[0], 1 / r2[3]), e3.rotate(I(this.angle)), e3.fillStyle = this.selectionBackgroundColor, e3.fillRect(-n2.x / 2, -n2.y / 2, n2.x, n2.y), e3.restore();
          }
          strokeBorders(e3, t2) {
            e3.strokeRect(-t2.x / 2, -t2.y / 2, t2.x, t2.y);
          }
          _drawBorders(e3, t2, n2 = {}) {
            let r2 = { hasControls: this.hasControls, borderColor: this.borderColor, borderDashArray: this.borderDashArray, ...n2 };
            e3.save(), e3.strokeStyle = r2.borderColor, this._setLineDash(e3, r2.borderDashArray), this.strokeBorders(e3, t2), r2.hasControls && this.drawControlsConnectingLines(e3, t2), e3.restore();
          }
          _renderControls(e3, t2 = {}) {
            let { hasBorders: n2, hasControls: r2 } = this, i2 = { hasBorders: n2, hasControls: r2, ...t2 }, a2 = this.getViewportTransform(), o2 = i2.hasBorders, s2 = i2.hasControls, c2 = He(z(a2, this.calcTransformMatrix()));
            e3.save(), e3.translate(c2.translateX, c2.translateY), e3.lineWidth = this.borderScaleFactor, this.group === this.parent && (e3.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1), this.flipX && (c2.angle -= 180);
            let l2 = ze(a2);
            e3.rotate(this.group ? I(c2.angle) : I(this.angle) + l2), o2 && this.drawBorders(e3, c2, t2), s2 && this.drawControls(e3, t2), e3.restore();
          }
          drawBorders(e3, t2, n2) {
            let r2;
            if (n2 && n2.forActiveSelection || this.group) {
              let e4 = At(this.width, this.height, Ye(t2)), n3 = this.isStrokeAccountedForInDimensions() ? we : (this.strokeUniform ? new N().scalarAdd(this.canvas ? this.canvas.getZoom() : 1) : new N(t2.scaleX, t2.scaleY)).scalarMultiply(this.strokeWidth);
              r2 = e4.add(n3).scalarAdd(this.borderScaleFactor).scalarAdd(2 * this.padding);
            } else r2 = this._calculateCurrentDimensions().scalarAdd(this.borderScaleFactor);
            this._drawBorders(e3, r2, n2);
          }
          drawControlsConnectingLines(e3, t2) {
            let n2 = false;
            e3.beginPath(), this.forEachControl((r2, i2) => {
              r2.withConnection && r2.getVisibility(this, i2) && (n2 = true, e3.moveTo(r2.x * t2.x, r2.y * t2.y), e3.lineTo(r2.x * t2.x + r2.offsetX, r2.y * t2.y + r2.offsetY));
            }), n2 && e3.stroke();
          }
          drawControls(e3, t2 = {}) {
            e3.save();
            let n2 = this.getCanvasRetinaScaling(), { cornerStrokeColor: r2, cornerDashArray: i2, cornerColor: a2 } = this, o2 = { cornerStrokeColor: r2, cornerDashArray: i2, cornerColor: a2, ...t2 };
            e3.setTransform(n2, 0, 0, n2, 0, 0), e3.strokeStyle = e3.fillStyle = o2.cornerColor, this.transparentCorners || (e3.strokeStyle = o2.cornerStrokeColor), this._setLineDash(e3, o2.cornerDashArray), this.forEachControl((t3, n3) => {
              if (t3.getVisibility(this, n3)) {
                let r3 = this.oCoords[n3];
                t3.render(e3, r3.x, r3.y, o2, this);
              }
            }), e3.restore();
          }
          isControlVisible(e3) {
            return this.controls[e3] && this.controls[e3].getVisibility(this, e3);
          }
          setControlVisible(e3, t2) {
            this._controlsVisibility || (this._controlsVisibility = {}), this._controlsVisibility[e3] = t2;
          }
          setControlsVisibility(e3 = {}) {
            Object.entries(e3).forEach(([e4, t2]) => this.setControlVisible(e4, t2));
          }
          clearContextTop(e3) {
            if (!this.canvas) return;
            let t2 = this.canvas.contextTop;
            if (!t2) return;
            let n2 = this.canvas.viewportTransform;
            t2.save(), t2.transform(n2[0], n2[1], n2[2], n2[3], n2[4], n2[5]), this.transform(t2);
            let r2 = this.width + 4, i2 = this.height + 4;
            return t2.clearRect(-r2 / 2, -i2 / 2, r2, i2), e3 || t2.restore(), t2;
          }
          onDeselect(e3) {
            return false;
          }
          onSelect(e3) {
            return false;
          }
          shouldStartDragging(e3) {
            return false;
          }
          onDragStart(e3) {
            return false;
          }
          canDrop(e3) {
            return false;
          }
          renderDragSourceEffect(e3) {
          }
          renderDropTargetEffect(e3) {
          }
        };
        function vi(e2, t2) {
          return t2.forEach((t3) => {
            Object.getOwnPropertyNames(t3.prototype).forEach((n2) => {
              n2 !== `constructor` && Object.defineProperty(e2.prototype, n2, Object.getOwnPropertyDescriptor(t3.prototype, n2) || /* @__PURE__ */ Object.create(null));
            });
          }), e2;
        }
        a(_i, `ownDefaults`, { noScaleCache: true, lockMovementX: false, lockMovementY: false, lockRotation: false, lockScalingX: false, lockScalingY: false, lockSkewingX: false, lockSkewingY: false, lockScalingFlip: false, cornerSize: 13, touchCornerSize: 24, transparentCorners: true, cornerColor: `rgb(178,204,255)`, cornerStrokeColor: ``, cornerStyle: `rect`, cornerDashArray: null, hasControls: true, borderColor: `rgb(178,204,255)`, borderDashArray: null, borderOpacityWhenMoving: 0.4, borderScaleFactor: 1, hasBorders: true, selectionBackgroundColor: ``, selectable: true, evented: true, perPixelTargetFind: false, activeOn: `down`, hoverCursor: null, moveCursor: null });
        var J = class extends _i {
        };
        vi(J, [gn]), M.setClass(J), M.setClass(J, `object`);
        let yi = (e2, t2, n2, r2) => {
          let i2 = 2 * (r2 = Math.round(r2)) + 1, { data: a2 } = e2.getImageData(t2 - r2, n2 - r2, i2, i2);
          for (let e3 = 3; e3 < a2.length; e3 += 4) if (a2[e3] > 0) return false;
          return true;
        };
        var bi = class {
          constructor(e2) {
            this.options = e2, this.strokeProjectionMagnitude = this.options.strokeWidth / 2, this.scale = new N(this.options.scaleX, this.options.scaleY), this.strokeUniformScalar = this.options.strokeUniform ? new N(1 / this.options.scaleX, 1 / this.options.scaleY) : new N(1, 1);
          }
          createSideVector(e2, t2) {
            let n2 = zt(e2, t2);
            return this.options.strokeUniform ? n2.multiply(this.scale) : n2;
          }
          projectOrthogonally(e2, t2, n2) {
            return this.applySkew(e2.add(this.calcOrthogonalProjection(e2, t2, n2)));
          }
          isSkewed() {
            return this.options.skewX !== 0 || this.options.skewY !== 0;
          }
          applySkew(e2) {
            let t2 = new N(e2);
            return t2.y += t2.x * Math.tan(I(this.options.skewY)), t2.x += t2.y * Math.tan(I(this.options.skewX)), t2;
          }
          scaleUnitVector(e2, t2) {
            return e2.multiply(this.strokeUniformScalar).scalarMultiply(t2);
          }
        };
        let xi = new N();
        var Si = class e2 extends bi {
          static getOrthogonalRotationFactor(e3, t2) {
            let n2 = t2 ? Vt(e3, t2) : Ht(e3);
            return Math.abs(n2) < S ? -1 : 1;
          }
          constructor(e3, t2, n2, r2) {
            super(r2), a(this, `AB`, void 0), a(this, `AC`, void 0), a(this, `alpha`, void 0), a(this, `bisector`, void 0), this.A = new N(e3), this.B = new N(t2), this.C = new N(n2), this.AB = this.createSideVector(this.A, this.B), this.AC = this.createSideVector(this.A, this.C), this.alpha = Vt(this.AB, this.AC), this.bisector = Ut(Rt(this.AB.eq(xi) ? this.AC : this.AB, this.alpha / 2));
          }
          calcOrthogonalProjection(t2, n2, r2 = this.strokeProjectionMagnitude) {
            let i2 = Wt(this.createSideVector(t2, n2)), a2 = e2.getOrthogonalRotationFactor(i2, this.bisector);
            return this.scaleUnitVector(i2, r2 * a2);
          }
          projectBevel() {
            let e3 = [];
            return (this.alpha % w === 0 ? [this.B] : [this.B, this.C]).forEach((t2) => {
              e3.push(this.projectOrthogonally(this.A, t2)), e3.push(this.projectOrthogonally(this.A, t2, -this.strokeProjectionMagnitude));
            }), e3;
          }
          projectMiter() {
            let e3 = [], t2 = Math.abs(this.alpha), n2 = 1 / Math.sin(t2 / 2), r2 = this.scaleUnitVector(this.bisector, -this.strokeProjectionMagnitude * n2), i2 = this.options.strokeUniform ? Bt(this.scaleUnitVector(this.bisector, this.options.strokeMiterLimit)) : this.options.strokeMiterLimit;
            return Bt(r2) / this.strokeProjectionMagnitude <= i2 && e3.push(this.applySkew(this.A.add(r2))), e3.push(...this.projectBevel()), e3;
          }
          projectRoundNoSkew(t2, n2) {
            let r2 = [], i2 = new N(e2.getOrthogonalRotationFactor(this.bisector), e2.getOrthogonalRotationFactor(new N(this.bisector.y, this.bisector.x)));
            return [new N(1, 0).scalarMultiply(this.strokeProjectionMagnitude).multiply(this.strokeUniformScalar).multiply(i2), new N(0, 1).scalarMultiply(this.strokeProjectionMagnitude).multiply(this.strokeUniformScalar).multiply(i2)].forEach((e3) => {
              qt(e3, t2, n2) && r2.push(this.A.add(e3));
            }), r2;
          }
          projectRoundWithSkew(e3, t2) {
            let n2 = [], { skewX: r2, skewY: i2, scaleX: a2, scaleY: o2, strokeUniform: s2 } = this.options, c2 = new N(Math.tan(I(r2)), Math.tan(I(i2))), l2 = this.strokeProjectionMagnitude, u2 = s2 ? l2 / o2 / Math.sqrt(1 / o2 ** 2 + 1 / a2 ** 2 * c2.y ** 2) : l2 / Math.sqrt(1 + c2.y ** 2), d2 = new N(Math.sqrt(Math.max(l2 ** 2 - u2 ** 2, 0)), u2), f2 = s2 ? l2 / Math.sqrt(1 + c2.x ** 2 * (1 / o2) ** 2 / (1 / a2 + 1 / a2 * c2.x * c2.y) ** 2) : l2 / Math.sqrt(1 + c2.x ** 2 / (1 + c2.x * c2.y) ** 2), p2 = new N(f2, Math.sqrt(Math.max(l2 ** 2 - f2 ** 2, 0)));
            return [p2, p2.scalarMultiply(-1), d2, d2.scalarMultiply(-1)].map((e4) => this.applySkew(s2 ? e4.multiply(this.strokeUniformScalar) : e4)).forEach((r3) => {
              qt(r3, e3, t2) && n2.push(this.applySkew(this.A).add(r3));
            }), n2;
          }
          projectRound() {
            let e3 = [];
            e3.push(...this.projectBevel());
            let t2 = this.alpha % w === 0, n2 = this.applySkew(this.A), r2 = e3[t2 ? 0 : 2].subtract(n2), i2 = e3[+!!t2].subtract(n2), a2 = Gt(r2, t2 ? this.applySkew(this.AB.scalarMultiply(-1)) : this.applySkew(this.bisector.multiply(this.strokeUniformScalar).scalarMultiply(-1))) > 0, o2 = a2 ? r2 : i2, s2 = a2 ? i2 : r2;
            return this.isSkewed() ? e3.push(...this.projectRoundWithSkew(o2, s2)) : e3.push(...this.projectRoundNoSkew(o2, s2)), e3;
          }
          projectPoints() {
            switch (this.options.strokeLineJoin) {
              case `miter`:
                return this.projectMiter();
              case `round`:
                return this.projectRound();
              default:
                return this.projectBevel();
            }
          }
          project() {
            return this.projectPoints().map((e3) => ({ originPoint: this.A, projectedPoint: e3, angle: this.alpha, bisector: this.bisector }));
          }
        }, Ci = class extends bi {
          constructor(e2, t2, n2) {
            super(n2), this.A = new N(e2), this.T = new N(t2);
          }
          calcOrthogonalProjection(e2, t2, n2 = this.strokeProjectionMagnitude) {
            let r2 = this.createSideVector(e2, t2);
            return this.scaleUnitVector(Wt(r2), n2);
          }
          projectButt() {
            return [this.projectOrthogonally(this.A, this.T, this.strokeProjectionMagnitude), this.projectOrthogonally(this.A, this.T, -this.strokeProjectionMagnitude)];
          }
          projectRound() {
            let e2 = [];
            if (!this.isSkewed() && this.A.eq(this.T)) {
              let t2 = new N(1, 1).scalarMultiply(this.strokeProjectionMagnitude).multiply(this.strokeUniformScalar);
              e2.push(this.applySkew(this.A.add(t2)), this.applySkew(this.A.subtract(t2)));
            } else e2.push(...new Si(this.A, this.T, this.T, this.options).projectRound());
            return e2;
          }
          projectSquare() {
            let e2 = [];
            if (this.A.eq(this.T)) {
              let t2 = new N(1, 1).scalarMultiply(this.strokeProjectionMagnitude).multiply(this.strokeUniformScalar);
              e2.push(this.A.add(t2), this.A.subtract(t2));
            } else {
              let t2 = this.calcOrthogonalProjection(this.A, this.T, this.strokeProjectionMagnitude), n2 = this.scaleUnitVector(Ut(this.createSideVector(this.A, this.T)), -this.strokeProjectionMagnitude), r2 = this.A.add(n2);
              e2.push(r2.add(t2), r2.subtract(t2));
            }
            return e2.map((e3) => this.applySkew(e3));
          }
          projectPoints() {
            switch (this.options.strokeLineCap) {
              case `round`:
                return this.projectRound();
              case `square`:
                return this.projectSquare();
              default:
                return this.projectButt();
            }
          }
          project() {
            return this.projectPoints().map((e2) => ({ originPoint: this.A, projectedPoint: e2 }));
          }
        };
        let wi = (e2, t2, n2 = false) => {
          let r2 = [];
          if (e2.length === 0) return r2;
          let i2 = e2.reduce((e3, t3) => (e3[e3.length - 1].eq(t3) || e3.push(new N(t3)), e3), [new N(e2[0])]);
          if (i2.length === 1) n2 = true;
          else if (!n2) {
            let e3 = i2[0], t3 = ((e4, t4) => {
              for (let n3 = e4.length - 1; n3 >= 0; n3--) if (t4(e4[n3], n3, e4)) return n3;
              return -1;
            })(i2, (t4) => !t4.eq(e3));
            i2.splice(t3 + 1);
          }
          return i2.forEach((e3, i3, a2) => {
            let o2, s2;
            i3 === 0 ? (s2 = a2[1], o2 = n2 ? e3 : a2[a2.length - 1]) : i3 === a2.length - 1 ? (o2 = a2[i3 - 1], s2 = n2 ? e3 : a2[0]) : (o2 = a2[i3 - 1], s2 = a2[i3 + 1]), n2 && a2.length === 1 ? r2.push(...new Ci(e3, e3, t2).project()) : !n2 || i3 !== 0 && i3 !== a2.length - 1 ? r2.push(...new Si(e3, o2, s2, t2).project()) : r2.push(...new Ci(e3, i3 === 0 ? s2 : o2, t2).project());
          }), r2;
        }, Ti = (e2) => {
          let t2 = {};
          return Object.keys(e2).forEach((n2) => {
            t2[n2] = {}, Object.keys(e2[n2]).forEach((r2) => {
              t2[n2][r2] = { ...e2[n2][r2] };
            });
          }), t2;
        }, Ei = (e2, t2, n2 = false) => e2.fill !== t2.fill || e2.stroke !== t2.stroke || e2.strokeWidth !== t2.strokeWidth || e2.fontSize !== t2.fontSize || e2.fontFamily !== t2.fontFamily || e2.fontWeight !== t2.fontWeight || e2.fontStyle !== t2.fontStyle || e2.textDecorationThickness !== t2.textDecorationThickness || e2.textDecorationColor !== t2.textDecorationColor || e2.textBackgroundColor !== t2.textBackgroundColor || e2.deltaY !== t2.deltaY || n2 && (e2.overline !== t2.overline || e2.underline !== t2.underline || e2.linethrough !== t2.linethrough), Di = (e2, t2) => {
          let n2 = t2.split(`
`), r2 = [], i2 = -1, a2 = {};
          e2 = Ti(e2);
          for (let t3 = 0; t3 < n2.length; t3++) {
            let o2 = gt(n2[t3]);
            if (e2[t3]) for (let n3 = 0; n3 < o2.length; n3++) {
              i2++;
              let o3 = e2[t3][n3];
              o3 && Object.keys(o3).length > 0 && (Ei(a2, o3, true) ? r2.push({ start: i2, end: i2 + 1, style: o3 }) : r2[r2.length - 1].end++), a2 = o3 || {};
            }
            else i2 += o2.length, a2 = {};
          }
          return r2;
        }, Oi = (e2, t2) => {
          if (!Array.isArray(e2)) return Ti(e2);
          let n2 = t2.split(ne), r2 = {}, i2 = -1, a2 = 0;
          for (let t3 = 0; t3 < n2.length; t3++) {
            let o2 = gt(n2[t3]);
            for (let n3 = 0; n3 < o2.length; n3++) i2++, e2[a2] && e2[a2].start <= i2 && i2 < e2[a2].end && (r2[t3] = r2[t3] || {}, r2[t3][n3] = { ...e2[a2].style }, i2 === e2[a2].end - 1 && a2++);
          }
          return r2;
        }, ki = [`display`, `transform`, j, `fill-opacity`, `fill-rule`, `opacity`, he, `stroke-dasharray`, `stroke-linecap`, `stroke-dashoffset`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-opacity`, `stroke-width`, `id`, `paint-order`, `vector-effect`, `instantiated_by_use`, `clip-path`];
        function Ai(e2, t2) {
          let n2 = e2.nodeName, r2 = e2.getAttribute(`class`), i2 = e2.getAttribute(`id`), a2 = `(?![a-zA-Z\\-]+)`, o2;
          if (o2 = RegExp(`^` + n2, `i`), t2 = t2.replace(o2, ``), i2 && t2.length && (o2 = RegExp(`#` + i2 + a2, `i`), t2 = t2.replace(o2, ``)), r2 && t2.length) {
            let e3 = r2.split(` `);
            for (let n3 = e3.length; n3--; ) o2 = RegExp(`\\.` + e3[n3] + a2, `i`), t2 = t2.replace(o2, ``);
          }
          return t2.length === 0;
        }
        function ji(e2, t2) {
          let n2 = true, r2 = Ai(e2, t2.pop());
          return r2 && t2.length && (n2 = function(e3, t3) {
            let n3, r3 = true;
            for (; e3.parentElement && e3.parentElement.nodeType === 1 && t3.length; ) r3 && (n3 = t3.pop()), r3 = Ai(e3 = e3.parentElement, n3);
            return t3.length === 0;
          }(e2, t2)), r2 && n2 && t2.length === 0;
        }
        function Mi(e2, t2 = {}) {
          let n2 = {};
          for (let r2 in t2) ji(e2, r2.split(` `)) && (n2 = { ...n2, ...t2[r2] });
          return n2;
        }
        let Ni = (e2) => {
          var t2;
          return (t2 = jn[e2]) == null ? e2 : t2;
        }, Pi = RegExp(`(${Dn})`, `gi`), Y = `(${Dn})`, Fi = String.raw`(skewX)\(${Y}\)`, Ii = String.raw`(skewY)\(${Y}\)`, Li = String.raw`(rotate)\(${Y}(?: ${Y} ${Y})?\)`, Ri = String.raw`(scale)\(${Y}(?: ${Y})?\)`, zi = String.raw`(translate)\(${Y}(?: ${Y})?\)`, Bi = `(?:${String.raw`(matrix)\(${Y} ${Y} ${Y} ${Y} ${Y} ${Y}\)`}|${zi}|${Li}|${Ri}|${Fi}|${Ii})`, Vi = `(?:${Bi}*)`, Hi = String.raw`^\s*(?:${Vi}?)\s*$`, Ui = new RegExp(Hi), Wi = new RegExp(Bi), Gi = new RegExp(Bi, `g`);
        function Ki(e2) {
          let t2 = [];
          if (!(e2 = ((e3) => on(e3.replace(Pi, ` $1 `).replace(/,/gi, ` `)))(e2).replace(/\s*([()])\s*/gi, `$1`)) || e2 && !Ui.test(e2)) return [...T];
          for (let n2 of e2.matchAll(Gi)) {
            let e3 = Wi.exec(n2[0]);
            if (!e3) continue;
            let r2 = T, [, i2, ...a2] = e3.filter((e4) => !!e4), [o2, s2, c2, l2, u2, d2] = a2.map((e4) => parseFloat(e4));
            switch (i2) {
              case `translate`:
                r2 = Ue(o2, s2);
                break;
              case oe:
                r2 = We({ angle: o2 }, { x: s2, y: c2 });
                break;
              case ue:
                r2 = Ge(o2, s2);
                break;
              case pe:
                r2 = qe(o2);
                break;
              case me:
                r2 = Je(o2);
                break;
              case `matrix`:
                r2 = [o2, s2, c2, l2, u2, d2];
            }
            t2.push(r2);
          }
          return Re(t2);
        }
        function qi(e2, t2, n2, r2) {
          let i2 = Array.isArray(t2), a2, o2 = t2;
          if (e2 !== `fill` && e2 !== `stroke` || t2 !== `none`) {
            if (e2 === `strokeUniform`) return t2 === `non-scaling-stroke`;
            if (e2 === `strokeDashArray`) o2 = t2 === `none` ? null : t2.replace(/,/g, ` `).split(/\s+/).map(parseFloat);
            else if (e2 === `transformMatrix`) o2 = n2 && n2.transformMatrix ? z(n2.transformMatrix, Ki(t2)) : Ki(t2);
            else if (e2 === `visible`) o2 = t2 !== `none` && t2 !== `hidden`, n2 && false === n2.visible && (o2 = false);
            else if (e2 === `opacity`) o2 = parseFloat(t2), n2 && n2.opacity !== void 0 && (o2 *= n2.opacity);
            else if (e2 === `textAnchor`) o2 = t2 === `start` ? D : t2 === `end` ? k : E;
            else if (e2 === `charSpacing` || e2 === `textDecorationThickness`) a2 = K(t2, r2) / r2 * 1e3;
            else if (e2 === `paintFirst`) {
              let e3 = t2.indexOf(j), n3 = t2.indexOf(he);
              o2 = j, (e3 > -1 && n3 > -1 && n3 < e3 || e3 === -1 && n3 > -1) && (o2 = he);
            } else {
              if (e2 === `href` || e2 === `xlink:href` || e2 === `font` || e2 === `id`) return t2;
              if (e2 === `imageSmoothing`) return t2 === `optimizeQuality`;
              a2 = i2 ? t2.map(K) : K(t2, r2);
            }
          } else o2 = ``;
          return !i2 && isNaN(a2) ? o2 : a2;
        }
        function Ji(e2, t2) {
          e2.replace(/;\s*$/, ``).split(`;`).forEach((e3) => {
            if (!e3) return;
            let [n2, r2] = e3.split(`:`);
            t2[n2.trim().toLowerCase()] = r2.trim();
          });
        }
        function Yi(e2) {
          let t2 = {}, n2 = e2.getAttribute(`style`);
          return n2 && (typeof n2 == `string` ? Ji(n2, t2) : function(e3, t3) {
            Object.entries(e3).forEach(([e4, n3]) => {
              n3 !== void 0 && (t3[e4.toLowerCase()] = n3);
            });
          }(n2, t2)), t2;
        }
        let Xi = { stroke: `strokeOpacity`, fill: `fillOpacity` };
        function Zi(e2, t2, n2) {
          if (!e2) return {};
          let r2, i2 = {}, a2 = 16;
          e2.parentNode && In.test(e2.parentNode.nodeName) && (i2 = Zi(e2.parentElement, t2, n2), i2.fontSize && (r2 = a2 = K(i2.fontSize)));
          let o2 = { ...t2.reduce((t3, n3) => {
            let r3 = e2.getAttribute(n3);
            return r3 && (t3[n3] = r3), t3;
          }, {}), ...Mi(e2, n2), ...Yi(e2) };
          o2[`clip-path`] && e2.setAttribute(Nn, o2[Nn]), o2[`font-size`] && (r2 = K(o2[Mn], a2), o2[Mn] = `${r2}`);
          let s2 = {};
          for (let e3 in o2) {
            let t3 = Ni(e3);
            s2[t3] = qi(t3, o2[e3], i2, r2);
          }
          s2 && s2.font && function(e3, t3) {
            let n3 = e3.match(An);
            if (!n3) return;
            let r3 = n3[1], i3 = n3[3], a3 = n3[4], o3 = n3[5], s3 = n3[6];
            r3 && (t3.fontStyle = r3), i3 && (t3.fontWeight = isNaN(parseFloat(i3)) ? i3 : parseFloat(i3)), a3 && (t3.fontSize = K(a3)), s3 && (t3.fontFamily = s3), o3 && (t3.lineHeight = o3 === `normal` ? 1 : o3);
          }(s2.font, s2);
          let c2 = { ...i2, ...s2 };
          return In.test(e2.nodeName) ? c2 : function(e3) {
            let t3 = J.getDefaults();
            return Object.entries(Xi).forEach(([n3, r3]) => {
              if (e3[r3] === void 0 || e3[n3] === ``) return;
              if (e3[n3] === void 0) {
                if (!t3[n3]) return;
                e3[n3] = t3[n3];
              }
              if (e3[n3].indexOf(`url(`) === 0) return;
              let i3 = new G(e3[n3]);
              e3[n3] = i3.setAlpha(B(i3.getAlpha() * e3[r3], 2)).toRgba();
            }), e3;
          }(c2);
        }
        let Qi = [`rx`, `ry`];
        var $i = class e2 extends J {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2) {
            super(), Object.assign(this, e2.ownDefaults), this.setOptions(t2), this._initRxRy();
          }
          _initRxRy() {
            let { rx: e3, ry: t2 } = this;
            e3 && !t2 ? this.ry = e3 : t2 && !e3 && (this.rx = t2);
          }
          _render(e3) {
            let { width: t2, height: n2 } = this, r2 = -t2 / 2, i2 = -n2 / 2, a2 = this.rx ? Math.min(this.rx, t2 / 2) : 0, o2 = this.ry ? Math.min(this.ry, n2 / 2) : 0, s2 = a2 !== 0 || o2 !== 0;
            e3.beginPath(), e3.moveTo(r2 + a2, i2), e3.lineTo(r2 + t2 - a2, i2), s2 && e3.bezierCurveTo(r2 + t2 - 0.4477152502 * a2, i2, r2 + t2, i2 + 0.4477152502 * o2, r2 + t2, i2 + o2), e3.lineTo(r2 + t2, i2 + n2 - o2), s2 && e3.bezierCurveTo(r2 + t2, i2 + n2 - 0.4477152502 * o2, r2 + t2 - 0.4477152502 * a2, i2 + n2, r2 + t2 - a2, i2 + n2), e3.lineTo(r2 + a2, i2 + n2), s2 && e3.bezierCurveTo(r2 + 0.4477152502 * a2, i2 + n2, r2, i2 + n2 - 0.4477152502 * o2, r2, i2 + n2 - o2), e3.lineTo(r2, i2 + o2), s2 && e3.bezierCurveTo(r2, i2 + 0.4477152502 * o2, r2 + 0.4477152502 * a2, i2, r2 + a2, i2), e3.closePath(), this._renderPaintInOrder(e3);
          }
          toObject(e3 = []) {
            return super.toObject([...Qi, ...e3]);
          }
          _toSVG() {
            let { width: e3, height: t2, rx: n2, ry: r2 } = this;
            return [`<rect `, `COMMON_PARTS`, `x="${-e3 / 2}" y="${-t2 / 2}" rx="${U(n2)}" ry="${U(r2)}" width="${U(e3)}" height="${U(t2)}" />
`];
          }
          static async fromElement(e3, t2, n2) {
            let { left: r2 = 0, top: i2 = 0, width: a2 = 0, height: o2 = 0, visible: s2 = true, ...c2 } = Zi(e3, this.ATTRIBUTE_NAMES, n2);
            return new this({ ...t2, ...c2, left: r2, top: i2, width: a2, height: o2, visible: !!(s2 && a2 && o2) });
          }
        };
        a($i, `type`, `Rect`), a($i, `cacheProperties`, [...Un, ...Qi]), a($i, `ownDefaults`, { rx: 0, ry: 0 }), a($i, `ATTRIBUTE_NAMES`, [...ki, `x`, `y`, `rx`, `ry`, `width`, `height`]), M.setClass($i), M.setSVGClass($i);
        let ea = `initialization`, ta = `added`, na = (e2, t2) => {
          let { strokeUniform: n2, strokeWidth: r2, width: i2, height: a2, group: o2 } = t2, s2 = o2 && o2 !== e2 ? jt(o2.calcTransformMatrix(), e2.calcTransformMatrix()) : null, c2 = s2 ? t2.getRelativeCenterPoint().transform(s2) : t2.getRelativeCenterPoint(), l2 = !t2.isStrokeAccountedForInDimensions(), u2 = n2 && l2 ? Nt(new N(r2, r2), void 0, e2.calcTransformMatrix()) : we, d2 = !n2 && l2 ? r2 : 0, f2 = At(i2 + d2, a2 + d2, Re([s2, t2.calcOwnMatrix()], true)).add(u2).scalarDivide(2);
          return [c2.subtract(f2), c2.add(f2)];
        };
        var ra = class {
          calcLayoutResult(e2, t2) {
            if (this.shouldPerformLayout(e2)) return this.calcBoundingBox(t2, e2);
          }
          shouldPerformLayout({ type: e2, prevStrategy: t2, strategy: n2 }) {
            return e2 === `initialization` || e2 === `imperative` || !!t2 && n2 !== t2;
          }
          shouldLayoutClipPath({ type: e2, target: { clipPath: t2 } }) {
            return e2 !== `initialization` && t2 && !t2.absolutePositioned;
          }
          getInitialSize(e2, t2) {
            return t2.size;
          }
          calcBoundingBox(e2, t2) {
            let { type: n2, target: r2 } = t2;
            if (n2 === `imperative` && t2.overrides) return t2.overrides;
            if (e2.length === 0) return;
            let { left: i2, top: a2, width: o2, height: s2 } = wt(e2.map((e3) => na(r2, e3)).reduce((e3, t3) => e3.concat(t3), [])), c2 = new N(o2, s2), l2 = new N(i2, a2).add(c2.scalarDivide(2));
            if (n2 === `initialization`) {
              let e3 = this.getInitialSize(t2, { size: c2, center: l2 });
              return { center: l2, relativeCorrection: new N(0, 0), size: e3 };
            }
            return { center: l2.transform(r2.calcOwnMatrix()), size: c2 };
          }
        };
        a(ra, `type`, `strategy`);
        var ia = class extends ra {
          shouldPerformLayout(e2) {
            return true;
          }
        };
        a(ia, `type`, `fit-content`), M.setClass(ia);
        let aa = `layoutManager`;
        var oa = class {
          constructor(e2 = new ia()) {
            a(this, `strategy`, void 0), this.strategy = e2, this._subscriptions = /* @__PURE__ */ new Map();
          }
          performLayout(e2) {
            let t2 = { bubbles: true, strategy: this.strategy, ...e2, prevStrategy: this._prevLayoutStrategy, stopPropagation() {
              this.bubbles = false;
            } };
            this.onBeforeLayout(t2);
            let n2 = this.getLayoutResult(t2);
            n2 && this.commitLayout(t2, n2), this.onAfterLayout(t2, n2), this._prevLayoutStrategy = t2.strategy;
          }
          attachHandlers(e2, t2) {
            let { target: n2 } = t2;
            return [ge, re, se, ae, ie, A, le, ce, `modifyPath`].map((t3) => e2.on(t3, (e3) => this.performLayout(t3 === `modified` ? { type: `object_modified`, trigger: t3, e: e3, target: n2 } : { type: `object_modifying`, trigger: t3, e: e3, target: n2 })));
          }
          subscribe(e2, t2) {
            this.unsubscribe(e2, t2);
            let n2 = this.attachHandlers(e2, t2);
            this._subscriptions.set(e2, n2);
          }
          unsubscribe(e2, t2) {
            (this._subscriptions.get(e2) || []).forEach((e3) => e3()), this._subscriptions.delete(e2);
          }
          unsubscribeTargets(e2) {
            e2.targets.forEach((t2) => this.unsubscribe(t2, e2));
          }
          subscribeTargets(e2) {
            e2.targets.forEach((t2) => this.subscribe(t2, e2));
          }
          onBeforeLayout(e2) {
            let { target: t2, type: n2 } = e2, { canvas: r2 } = t2;
            if (n2 === `initialization` || n2 === `added` ? this.subscribeTargets(e2) : n2 === `removed` && this.unsubscribeTargets(e2), t2.fire(`layout:before`, { context: e2 }), r2 && r2.fire(`object:layout:before`, { target: t2, context: e2 }), n2 === `imperative` && e2.deep) {
              let { strategy: n3, ...r3 } = e2;
              t2.forEachObject((e3) => e3.layoutManager && e3.layoutManager.performLayout({ ...r3, bubbles: false, target: e3 }));
            }
          }
          getLayoutResult(e2) {
            let { target: t2, strategy: n2, type: r2 } = e2, i2 = n2.calcLayoutResult(e2, t2.getObjects());
            if (!i2) return;
            let a2 = r2 === `initialization` ? new N() : t2.getRelativeCenterPoint(), { center: o2, correction: s2 = new N(), relativeCorrection: c2 = new N() } = i2;
            return { result: i2, prevCenter: a2, nextCenter: o2, offset: a2.subtract(o2).add(s2).transform(r2 === `initialization` ? T : R(t2.calcOwnMatrix()), true).add(c2) };
          }
          commitLayout(e2, t2) {
            let { target: n2 } = e2, { result: { size: r2 }, nextCenter: i2 } = t2;
            var a2, o2;
            n2.set({ width: r2.x, height: r2.y }), this.layoutObjects(e2, t2), e2.type === `initialization` ? n2.set({ left: (a2 = e2.x) == null ? i2.x + r2.x * W(n2.originX) : a2, top: (o2 = e2.y) == null ? i2.y + r2.y * W(n2.originY) : o2 }) : (n2.setPositionByOrigin(i2, E, E), n2.setCoords(), n2.set(`dirty`, true));
          }
          layoutObjects(e2, t2) {
            let { target: n2 } = e2;
            n2.forEachObject((r2) => {
              r2.group === n2 && this.layoutObject(e2, t2, r2);
            }), e2.strategy.shouldLayoutClipPath(e2) && this.layoutObject(e2, t2, n2.clipPath);
          }
          layoutObject(e2, { offset: t2 }, n2) {
            n2.set({ left: n2.left + t2.x, top: n2.top + t2.y });
          }
          onAfterLayout(e2, t2) {
            let { target: n2, strategy: r2, bubbles: i2, prevStrategy: a2, ...o2 } = e2, { canvas: s2 } = n2;
            n2.fire(`layout:after`, { context: e2, result: t2 }), s2 && s2.fire(`object:layout:after`, { context: e2, result: t2, target: n2 });
            let c2 = n2.parent;
            i2 && c2 != null && c2.layoutManager && ((o2.path || (o2.path = [])).push(n2), c2.layoutManager.performLayout({ ...o2, target: c2 })), n2.set(`dirty`, true);
          }
          dispose() {
            let { _subscriptions: e2 } = this;
            e2.forEach((e3) => e3.forEach((e4) => e4())), e2.clear();
          }
          toObject() {
            return { type: aa, strategy: this.strategy.constructor.type };
          }
          toJSON() {
            return this.toObject();
          }
        };
        M.setClass(oa, aa);
        var sa = class extends oa {
          performLayout() {
          }
        }, ca = class e2 extends Ee(J) {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2 = [], n2 = {}) {
            super(), a(this, `_activeObjects`, []), a(this, `__objectSelectionTracker`, void 0), a(this, `__objectSelectionDisposer`, void 0), Object.assign(this, e2.ownDefaults), this.setOptions(n2), this.groupInit(t2, n2);
          }
          groupInit(e3, t2) {
            var n2;
            this._objects = [...e3], this.__objectSelectionTracker = this.__objectSelectionMonitor.bind(this, true), this.__objectSelectionDisposer = this.__objectSelectionMonitor.bind(this, false), this.forEachObject((e4) => {
              this.enterGroup(e4, false);
            }), this.layoutManager = (n2 = t2.layoutManager) == null ? new oa() : n2, this.layoutManager.performLayout({ type: ea, target: this, targets: [...e3], x: t2.left, y: t2.top });
          }
          canEnterGroup(e3) {
            return e3 === this || this.isDescendantOf(e3) ? (c(`error`, `Group: circular object trees are not supported, this call has no effect`), false) : this._objects.indexOf(e3) === -1 || (c(`error`, `Group: duplicate objects are not supported inside group, this call has no effect`), false);
          }
          _filterObjectsBeforeEnteringGroup(e3) {
            return e3.filter((e4, t2, n2) => this.canEnterGroup(e4) && n2.indexOf(e4) === t2);
          }
          add(...e3) {
            let t2 = this._filterObjectsBeforeEnteringGroup(e3), n2 = super.add(...t2);
            return this._onAfterObjectsChange(ta, t2), n2;
          }
          insertAt(e3, ...t2) {
            let n2 = this._filterObjectsBeforeEnteringGroup(t2), r2 = super.insertAt(e3, ...n2);
            return this._onAfterObjectsChange(ta, n2), r2;
          }
          remove(...e3) {
            let t2 = super.remove(...e3);
            return this._onAfterObjectsChange(`removed`, t2), t2;
          }
          _onObjectAdded(e3) {
            this.enterGroup(e3, true), this.fire(`object:added`, { target: e3 }), e3.fire(`added`, { target: this });
          }
          _onObjectRemoved(e3, t2) {
            this.exitGroup(e3, t2), this.fire(`object:removed`, { target: e3 }), e3.fire(`removed`, { target: this });
          }
          _onAfterObjectsChange(e3, t2) {
            this.layoutManager.performLayout({ type: e3, targets: t2, target: this });
          }
          _onStackOrderChanged() {
            this._set(`dirty`, true);
          }
          _set(e3, t2) {
            let n2 = this[e3];
            return super._set(e3, t2), e3 === `canvas` && n2 !== t2 && (this._objects || []).forEach((n3) => {
              n3._set(e3, t2);
            }), this;
          }
          _shouldSetNestedCoords() {
            return this.subTargetCheck;
          }
          removeAll() {
            return this._activeObjects = [], this.remove(...this._objects);
          }
          __objectSelectionMonitor(e3, { target: t2 }) {
            let n2 = this._activeObjects;
            if (e3) n2.push(t2), this._set(`dirty`, true);
            else if (n2.length > 0) {
              let e4 = n2.indexOf(t2);
              e4 > -1 && (n2.splice(e4, 1), this._set(`dirty`, true));
            }
          }
          _watchObject(e3, t2) {
            e3 && this._watchObject(false, t2), e3 ? (t2.on(`selected`, this.__objectSelectionTracker), t2.on(`deselected`, this.__objectSelectionDisposer)) : (t2.off(`selected`, this.__objectSelectionTracker), t2.off(`deselected`, this.__objectSelectionDisposer));
          }
          enterGroup(e3, t2) {
            e3.group && e3.group.remove(e3), e3._set(`parent`, this), this._enterGroup(e3, t2);
          }
          _enterGroup(e3, t2) {
            t2 && Dt(e3, z(R(this.calcTransformMatrix()), e3.calcTransformMatrix())), this._shouldSetNestedCoords() && e3.setCoords(), e3._set(`group`, this), e3._set(`canvas`, this.canvas), this._watchObject(true, e3);
            let n2 = this.canvas && this.canvas.getActiveObject && this.canvas.getActiveObject();
            n2 && (n2 === e3 || e3.isDescendantOf(n2)) && this._activeObjects.push(e3);
          }
          exitGroup(e3, t2) {
            this._exitGroup(e3, t2), e3._set(`parent`, void 0), e3._set(`canvas`, void 0);
          }
          _exitGroup(e3, t2) {
            e3._set(`group`, void 0), t2 || (Dt(e3, z(this.calcTransformMatrix(), e3.calcTransformMatrix())), e3.setCoords()), this._watchObject(false, e3);
            let n2 = this._activeObjects.length > 0 ? this._activeObjects.indexOf(e3) : -1;
            n2 > -1 && this._activeObjects.splice(n2, 1);
          }
          shouldCache() {
            let e3 = J.prototype.shouldCache.call(this);
            if (e3) {
              for (let e4 = 0; e4 < this._objects.length; e4++) if (this._objects[e4].willDrawShadow()) return this.ownCaching = false, false;
            }
            return e3;
          }
          willDrawShadow() {
            if (super.willDrawShadow()) return true;
            for (let e3 = 0; e3 < this._objects.length; e3++) if (this._objects[e3].willDrawShadow()) return true;
            return false;
          }
          isOnACache() {
            return this.ownCaching || !!this.parent && this.parent.isOnACache();
          }
          drawObject(e3, t2, n2) {
            this._renderBackground(e3);
            for (let t3 = 0; t3 < this._objects.length; t3++) {
              var r2;
              let n3 = this._objects[t3];
              (r2 = this.canvas) != null && r2.preserveObjectStacking && n3.group !== this ? (e3.save(), e3.transform(...R(this.calcTransformMatrix())), n3.render(e3), e3.restore()) : n3.group === this && n3.render(e3);
            }
            this._drawClipPath(e3, this.clipPath, n2);
          }
          setCoords() {
            super.setCoords(), this._shouldSetNestedCoords() && this.forEachObject((e3) => e3.setCoords());
          }
          triggerLayout(e3 = {}) {
            this.layoutManager.performLayout({ target: this, type: `imperative`, ...e3 });
          }
          render(e3) {
            this._transformDone = true, super.render(e3), this._transformDone = false;
          }
          __serializeObjects(e3, t2) {
            let n2 = this.includeDefaultValues;
            return this._objects.filter(function(e4) {
              return !e4.excludeFromExport;
            }).map(function(r2) {
              let i2 = r2.includeDefaultValues;
              r2.includeDefaultValues = n2;
              let a2 = r2[e3 || `toObject`](t2);
              return r2.includeDefaultValues = i2, a2;
            });
          }
          toObject(e3 = []) {
            let t2 = this.layoutManager.toObject();
            return { ...super.toObject([`subTargetCheck`, `interactive`, ...e3]), ...t2.strategy !== `fit-content` || this.includeDefaultValues ? { layoutManager: t2 } : {}, objects: this.__serializeObjects(`toObject`, e3) };
          }
          toString() {
            return `#<Group: (${this.complexity()})>`;
          }
          dispose() {
            this.layoutManager.unsubscribeTargets({ targets: this.getObjects(), target: this }), this._activeObjects = [], this.forEachObject((e3) => {
              this._watchObject(false, e3), e3.dispose();
            }), super.dispose();
          }
          _createSVGBgRect(e3) {
            if (!this.backgroundColor) return ``;
            let t2 = $i.prototype._toSVG.call(this), n2 = t2.indexOf(`COMMON_PARTS`);
            t2[n2] = `for="group" `;
            let r2 = t2.join(``);
            return e3 ? e3(r2) : r2;
          }
          _toSVG(e3) {
            let t2 = [`<g `, `COMMON_PARTS`, ` >
`], n2 = this._createSVGBgRect(e3);
            n2 && t2.push(`		`, n2);
            for (let n3 = 0; n3 < this._objects.length; n3++) t2.push(`		`, this._objects[n3].toSVG(e3));
            return t2.push(`</g>
`), t2;
          }
          getSvgStyles() {
            let e3 = this.opacity !== void 0 && this.opacity !== 1 ? `opacity: ${U(this.opacity)};` : ``, t2 = this.visible ? `` : ` visibility: hidden;`;
            return [e3, this.getSvgFilter(), t2].join(``);
          }
          toClipPathSVG(e3) {
            let t2 = [], n2 = this._createSVGBgRect(e3);
            n2 && t2.push(`	`, n2);
            for (let n3 = 0; n3 < this._objects.length; n3++) t2.push(`	`, this._objects[n3].toClipPathSVG(e3));
            return this._createBaseClipPathSVGMarkup(t2, { reviver: e3 });
          }
          static fromObject({ type: e3, objects: t2 = [], layoutManager: n2, ...r2 }, i2) {
            return Promise.all([Qe(t2, i2), $e(r2, i2)]).then(([e4, t3]) => {
              let i3 = new this(e4, { ...r2, ...t3, layoutManager: new sa() });
              return i3.layoutManager = n2 ? new (M.getClass(n2.type))(new (M.getClass(n2.strategy))()) : new oa(), i3.layoutManager.subscribeTargets({ type: ea, target: i3, targets: i3.getObjects() }), i3.setCoords(), i3;
            });
          }
        };
        a(ca, `type`, `Group`), a(ca, `ownDefaults`, { strokeWidth: 0, subTargetCheck: false, interactive: false }), M.setClass(ca);
        let la = (e2, t2) => e2 && e2.length === 1 ? e2[0] : new ca(e2, t2), ua = (e2, t2) => Math.min(t2.width / e2.width, t2.height / e2.height), da = (e2, t2) => Math.max(t2.width / e2.width, t2.height / e2.height), fa = `\\s*,?\\s*`, pa = `${fa}(${Dn})`, ma = `${pa}${pa}${pa}${fa}([01])${fa}([01])${pa}${pa}`, ha = { m: `l`, M: `L` }, ga = (e2, t2, n2, r2, i2, a2, o2, s2, c2, l2, u2) => {
          let d2 = Se(e2), f2 = Ce(e2), p2 = Se(t2), m2 = Ce(t2), h2 = n2 * i2 * p2 - r2 * a2 * m2 + o2, g2 = r2 * i2 * p2 + n2 * a2 * m2 + s2;
          return [`C`, l2 + c2 * (-n2 * i2 * f2 - r2 * a2 * d2), u2 + c2 * (-r2 * i2 * f2 + n2 * a2 * d2), h2 + c2 * (n2 * i2 * m2 + r2 * a2 * p2), g2 + c2 * (r2 * i2 * m2 - n2 * a2 * p2), h2, g2];
        }, _a = (e2, t2, n2, r2) => {
          let i2 = Math.atan2(t2, e2), a2 = Math.atan2(r2, n2);
          return a2 >= i2 ? a2 - i2 : 2 * Math.PI - (i2 - a2);
        };
        function va(e2, t2, n2, r2, i2, a2, o2, c2) {
          let l2;
          if (s.cachesBoundsOfCurve && (l2 = [...arguments].join(), y.boundsOfCurveCache[l2])) return y.boundsOfCurveCache[l2];
          let u2 = Math.sqrt, d2 = Math.abs, f2 = [], p2 = [[0, 0], [0, 0]], m2 = 6 * e2 - 12 * n2 + 6 * i2, h2 = -3 * e2 + 9 * n2 - 9 * i2 + 3 * o2, g2 = 3 * n2 - 3 * e2;
          for (let e3 = 0; e3 < 2; ++e3) {
            if (e3 > 0 && (m2 = 6 * t2 - 12 * r2 + 6 * a2, h2 = -3 * t2 + 9 * r2 - 9 * a2 + 3 * c2, g2 = 3 * r2 - 3 * t2), d2(h2) < 1e-12) {
              if (d2(m2) < 1e-12) continue;
              let e4 = -g2 / m2;
              0 < e4 && e4 < 1 && f2.push(e4);
              continue;
            }
            let n3 = m2 * m2 - 4 * g2 * h2;
            if (n3 < 0) continue;
            let i3 = u2(n3), o3 = (-m2 + i3) / (2 * h2);
            0 < o3 && o3 < 1 && f2.push(o3);
            let s2 = (-m2 - i3) / (2 * h2);
            0 < s2 && s2 < 1 && f2.push(s2);
          }
          let _2 = f2.length, v2 = _2, b2 = Sa(e2, t2, n2, r2, i2, a2, o2, c2);
          for (; _2--; ) {
            let { x: e3, y: t3 } = b2(f2[_2]);
            p2[0][_2] = e3, p2[1][_2] = t3;
          }
          p2[0][v2] = e2, p2[1][v2] = t2, p2[0][v2 + 1] = o2, p2[1][v2 + 1] = c2;
          let x2 = [new N(Math.min(...p2[0]), Math.min(...p2[1])), new N(Math.max(...p2[0]), Math.max(...p2[1]))];
          return s.cachesBoundsOfCurve && (y.boundsOfCurveCache[l2] = x2), x2;
        }
        let ya = (e2, t2, [n2, r2, i2, a2, o2, s2, c2, l2]) => {
          let u2 = ((e3, t3, n3, r3, i3, a3, o3) => {
            if (n3 === 0 || r3 === 0) return [];
            let s3 = 0, c3 = 0, l3 = 0, u3 = Math.PI, d2 = o3 * ee, f2 = Ce(d2), p2 = Se(d2), m2 = 0.5 * (-p2 * e3 - f2 * t3), h2 = 0.5 * (-p2 * t3 + f2 * e3), g2 = n3 ** 2, _2 = r3 ** 2, v2 = h2 ** 2, y2 = m2 ** 2, b2 = g2 * _2 - g2 * v2 - _2 * y2, x2 = Math.abs(n3), S2 = Math.abs(r3);
            if (b2 < 0) {
              let e4 = Math.sqrt(1 - b2 / (g2 * _2));
              x2 *= e4, S2 *= e4;
            } else l3 = (i3 === a3 ? -1 : 1) * Math.sqrt(b2 / (g2 * v2 + _2 * y2));
            let C2 = l3 * x2 * h2 / S2, w2 = -l3 * S2 * m2 / x2, T2 = p2 * C2 - f2 * w2 + 0.5 * e3, E2 = f2 * C2 + p2 * w2 + 0.5 * t3, D2 = _a(1, 0, (m2 - C2) / x2, (h2 - w2) / S2), O2 = _a((m2 - C2) / x2, (h2 - w2) / S2, (-m2 - C2) / x2, (-h2 - w2) / S2);
            a3 === 0 && O2 > 0 ? O2 -= 2 * u3 : a3 === 1 && O2 < 0 && (O2 += 2 * u3);
            let k2 = Math.ceil(Math.abs(O2 / u3 * 2)), te2 = [], ne2 = O2 / k2, re2 = 8 / 3 * Math.sin(ne2 / 4) * Math.sin(ne2 / 4) / Math.sin(ne2 / 2), ie2 = D2 + ne2;
            for (let e4 = 0; e4 < k2; e4++) te2[e4] = ga(D2, ie2, p2, f2, x2, S2, T2, E2, re2, s3, c3), s3 = te2[e4][5], c3 = te2[e4][6], D2 = ie2, ie2 += ne2;
            return te2;
          })(c2 - e2, l2 - t2, r2, i2, o2, s2, a2);
          for (let n3 = 0, r3 = u2.length; n3 < r3; n3++) u2[n3][1] += e2, u2[n3][2] += t2, u2[n3][3] += e2, u2[n3][4] += t2, u2[n3][5] += e2, u2[n3][6] += t2;
          return u2;
        }, ba = (e2) => {
          let t2 = 0, n2 = 0, r2 = 0, i2 = 0, a2 = [], o2, s2 = 0, c2 = 0;
          for (let l2 of e2) {
            let e3 = [...l2], u2;
            switch (e3[0]) {
              case `l`:
                e3[1] += t2, e3[2] += n2;
              case `L`:
                t2 = e3[1], n2 = e3[2], u2 = [`L`, t2, n2];
                break;
              case `h`:
                e3[1] += t2;
              case `H`:
                t2 = e3[1], u2 = [`L`, t2, n2];
                break;
              case `v`:
                e3[1] += n2;
              case `V`:
                n2 = e3[1], u2 = [`L`, t2, n2];
                break;
              case `m`:
                e3[1] += t2, e3[2] += n2;
              case `M`:
                t2 = e3[1], n2 = e3[2], r2 = e3[1], i2 = e3[2], u2 = [`M`, t2, n2];
                break;
              case `c`:
                e3[1] += t2, e3[2] += n2, e3[3] += t2, e3[4] += n2, e3[5] += t2, e3[6] += n2;
              case `C`:
                s2 = e3[3], c2 = e3[4], t2 = e3[5], n2 = e3[6], u2 = [`C`, e3[1], e3[2], s2, c2, t2, n2];
                break;
              case `s`:
                e3[1] += t2, e3[2] += n2, e3[3] += t2, e3[4] += n2;
              case `S`:
                o2 === `C` ? (s2 = 2 * t2 - s2, c2 = 2 * n2 - c2) : (s2 = t2, c2 = n2), t2 = e3[3], n2 = e3[4], u2 = [`C`, s2, c2, e3[1], e3[2], t2, n2], s2 = u2[3], c2 = u2[4];
                break;
              case `q`:
                e3[1] += t2, e3[2] += n2, e3[3] += t2, e3[4] += n2;
              case `Q`:
                s2 = e3[1], c2 = e3[2], t2 = e3[3], n2 = e3[4], u2 = [`Q`, s2, c2, t2, n2];
                break;
              case `t`:
                e3[1] += t2, e3[2] += n2;
              case `T`:
                o2 === `Q` ? (s2 = 2 * t2 - s2, c2 = 2 * n2 - c2) : (s2 = t2, c2 = n2), t2 = e3[1], n2 = e3[2], u2 = [`Q`, s2, c2, t2, n2];
                break;
              case `a`:
                e3[6] += t2, e3[7] += n2;
              case `A`:
                ya(t2, n2, e3).forEach((e4) => a2.push(e4)), t2 = e3[6], n2 = e3[7];
                break;
              case `z`:
              case `Z`:
                t2 = r2, n2 = i2, u2 = [`Z`];
            }
            u2 ? (a2.push(u2), o2 = u2[0]) : o2 = ``;
          }
          return a2;
        }, xa = (e2, t2, n2, r2) => Math.sqrt((n2 - e2) ** 2 + (r2 - t2) ** 2), Sa = (e2, t2, n2, r2, i2, a2, o2, s2) => (c2) => {
          let l2 = c2 ** 3, u2 = ((e3) => 3 * e3 ** 2 * (1 - e3))(c2), d2 = ((e3) => 3 * e3 * (1 - e3) ** 2)(c2), f2 = ((e3) => (1 - e3) ** 3)(c2);
          return new N(o2 * l2 + i2 * u2 + n2 * d2 + e2 * f2, s2 * l2 + a2 * u2 + r2 * d2 + t2 * f2);
        }, Ca = (e2) => e2 ** 2, wa = (e2) => 2 * e2 * (1 - e2), Ta = (e2) => (1 - e2) ** 2, Ea = (e2, t2, n2, r2, i2, a2, o2, s2) => (c2) => {
          let l2 = Ca(c2), u2 = wa(c2), d2 = Ta(c2), f2 = 3 * (d2 * (n2 - e2) + u2 * (i2 - n2) + l2 * (o2 - i2)), p2 = 3 * (d2 * (r2 - t2) + u2 * (a2 - r2) + l2 * (s2 - a2));
          return Math.atan2(p2, f2);
        }, Da = (e2, t2, n2, r2, i2, a2) => (o2) => {
          let s2 = Ca(o2), c2 = wa(o2), l2 = Ta(o2);
          return new N(i2 * s2 + n2 * c2 + e2 * l2, a2 * s2 + r2 * c2 + t2 * l2);
        }, Oa = (e2, t2, n2, r2, i2, a2) => (o2) => {
          let s2 = 1 - o2, c2 = 2 * (s2 * (n2 - e2) + o2 * (i2 - n2)), l2 = 2 * (s2 * (r2 - t2) + o2 * (a2 - r2));
          return Math.atan2(l2, c2);
        }, ka = (e2, t2, n2) => {
          let r2 = new N(t2, n2), i2 = 0;
          for (let t3 = 1; t3 <= 100; t3 += 1) {
            let n3 = e2(t3 / 100);
            i2 += xa(r2.x, r2.y, n3.x, n3.y), r2 = n3;
          }
          return i2;
        }, Aa = (e2, t2) => {
          let n2, r2 = 0, i2 = 0, a2 = { x: e2.x, y: e2.y }, o2 = { ...a2 }, s2 = 0.01, c2 = 0, l2 = e2.iterator, u2 = e2.angleFinder;
          for (; i2 < t2 && s2 > 1e-4; ) o2 = l2(r2), c2 = r2, n2 = xa(a2.x, a2.y, o2.x, o2.y), n2 + i2 > t2 ? (r2 -= s2, s2 /= 2) : (a2 = o2, r2 += s2, i2 += n2);
          return { ...o2, angle: u2(c2) };
        }, ja = (e2) => {
          let t2, n2, r2 = 0, i2 = 0, a2 = 0, o2 = 0, s2 = 0, c2 = [];
          for (let l2 of e2) {
            let e3 = { x: i2, y: a2, command: l2[0], length: 0 };
            switch (l2[0]) {
              case `M`:
                n2 = e3, n2.x = o2 = i2 = l2[1], n2.y = s2 = a2 = l2[2];
                break;
              case `L`:
                n2 = e3, n2.length = xa(i2, a2, l2[1], l2[2]), i2 = l2[1], a2 = l2[2];
                break;
              case `C`:
                t2 = Sa(i2, a2, l2[1], l2[2], l2[3], l2[4], l2[5], l2[6]), n2 = e3, n2.iterator = t2, n2.angleFinder = Ea(i2, a2, l2[1], l2[2], l2[3], l2[4], l2[5], l2[6]), n2.length = ka(t2, i2, a2), i2 = l2[5], a2 = l2[6];
                break;
              case `Q`:
                t2 = Da(i2, a2, l2[1], l2[2], l2[3], l2[4]), n2 = e3, n2.iterator = t2, n2.angleFinder = Oa(i2, a2, l2[1], l2[2], l2[3], l2[4]), n2.length = ka(t2, i2, a2), i2 = l2[3], a2 = l2[4];
                break;
              case `Z`:
                n2 = e3, n2.destX = o2, n2.destY = s2, n2.length = xa(i2, a2, o2, s2), i2 = o2, a2 = s2;
            }
            r2 += n2.length, c2.push(n2);
          }
          return c2.push({ length: r2, x: i2, y: a2 }), c2;
        }, Ma = (e2, t2, n2 = ja(e2)) => {
          let r2 = 0;
          for (; t2 - n2[r2].length > 0 && r2 < n2.length - 2; ) t2 -= n2[r2].length, r2++;
          let i2 = n2[r2], a2 = t2 / i2.length, o2 = e2[r2];
          switch (i2.command) {
            case `M`:
              return { x: i2.x, y: i2.y, angle: 0 };
            case `Z`:
              return { ...new N(i2.x, i2.y).lerp(new N(i2.destX, i2.destY), a2), angle: Math.atan2(i2.destY - i2.y, i2.destX - i2.x) };
            case `L`:
              return { ...new N(i2.x, i2.y).lerp(new N(o2[1], o2[2]), a2), angle: Math.atan2(o2[2] - i2.y, o2[1] - i2.x) };
            case `C`:
            case `Q`:
              return Aa(i2, t2);
          }
        }, Na = RegExp(`[mzlhvcsqta][^mzlhvcsqta]*`, `gi`), Pa = new RegExp(ma, `g`), Fa = new RegExp(Dn, `gi`), Ia = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 }, La = (e2) => {
          var t2;
          let n2 = [], r2 = (t2 = e2.match(Na)) == null ? [] : t2;
          for (let e3 of r2) {
            let t3 = e3[0];
            if (t3 === `z` || t3 === `Z`) {
              n2.push([t3]);
              continue;
            }
            let r3 = Ia[t3.toLowerCase()], i2 = [];
            if (t3 === `a` || t3 === `A`) {
              let t4;
              for (Pa.lastIndex = 0; t4 = Pa.exec(e3); ) i2.push(...t4.slice(1));
            } else i2 = e3.match(Fa) || [];
            for (let e4 = 0; e4 < i2.length; e4 += r3) {
              let a2 = Array(r3), o2 = ha[t3];
              a2[0] = e4 > 0 && o2 ? o2 : t3;
              for (let t4 = 0; t4 < r3; t4++) a2[t4 + 1] = parseFloat(i2[e4 + t4]);
              n2.push(a2);
            }
          }
          return n2;
        }, Ra = (e2, t2 = 0) => {
          let n2 = new N(e2[0]), r2 = new N(e2[1]), i2 = 1, a2 = 0, o2 = [], s2 = e2.length, c2 = s2 > 2, l2;
          for (c2 && (i2 = e2[2].x < r2.x ? -1 : e2[2].x === r2.x ? 0 : 1, a2 = e2[2].y < r2.y ? -1 : e2[2].y === r2.y ? 0 : 1), o2.push([`M`, n2.x - i2 * t2, n2.y - a2 * t2]), l2 = 1; l2 < s2; l2++) {
            if (!n2.eq(r2)) {
              let e3 = n2.midPointFrom(r2);
              o2.push([`Q`, n2.x, n2.y, e3.x, e3.y]);
            }
            n2 = e2[l2], l2 + 1 < e2.length && (r2 = e2[l2 + 1]);
          }
          return c2 && (i2 = n2.x > e2[l2 - 2].x ? 1 : n2.x === e2[l2 - 2].x ? 0 : -1, a2 = n2.y > e2[l2 - 2].y ? 1 : n2.y === e2[l2 - 2].y ? 0 : -1), o2.push([`L`, n2.x + i2 * t2, n2.y + a2 * t2]), o2;
        }, za = (e2, t2, n2) => (n2 && (t2 = z(t2, [1, 0, 0, 1, -n2.x, -n2.y])), e2.map((e3) => {
          let n3 = [...e3];
          for (let r2 = 1; r2 < e3.length - 1; r2 += 2) {
            let { x: i2, y: a2 } = L({ x: e3[r2], y: e3[r2 + 1] }, t2);
            n3[r2] = i2, n3[r2 + 1] = a2;
          }
          return n3;
        })), Ba = (e2, t2) => {
          let n2 = 2 * Math.PI / e2, r2 = -S;
          e2 % 2 == 0 && (r2 += n2 / 2);
          let i2 = Array(e2 + 1);
          for (let a2 = 0; a2 < e2; a2++) {
            let e3 = a2 * n2 + r2, { x: o2, y: s2 } = new N(Se(e3), Ce(e3)).scalarMultiply(t2);
            i2[a2] = [a2 === 0 ? `M` : `L`, o2, s2];
          }
          return i2[e2] = [`Z`], i2;
        }, Va = (e2, t2) => e2.map((e3) => e3.map((e4, n2) => n2 === 0 || t2 === void 0 ? e4 : B(e4, t2)).join(` `)).join(` `), Ha = (e2, t2) => {
          var n2;
          let r2 = e2, i2 = t2;
          r2.inverted && !i2.inverted && (r2 = t2, i2 = e2), Pt(i2, (n2 = i2.group) == null ? void 0 : n2.calcTransformMatrix(), r2.calcTransformMatrix());
          let a2 = r2.inverted && i2.inverted;
          return a2 && (r2.inverted = i2.inverted = false), new ca([r2], { clipPath: i2, inverted: a2 });
        }, Ua = (e2, t2) => Math.floor(Math.random() * (t2 - e2 + 1)) + e2, Wa = (e2, t2) => {
          let n2 = e2._findCenterFromElement();
          e2.transformMatrix && (((e3) => {
            if (e3.transformMatrix) {
              let { scaleX: t3, scaleY: n3, angle: r2, skewX: i2 } = He(e3.transformMatrix);
              e3.flipX = false, e3.flipY = false, e3.set(de, t3), e3.set(fe, n3), e3.angle = r2, e3.skewX = i2, e3.skewY = 0;
            }
          })(e2), n2 = n2.transform(e2.transformMatrix)), delete e2.transformMatrix, t2 && (e2.scaleX *= t2.scaleX, e2.scaleY *= t2.scaleY, e2.cropX = t2.cropX, e2.cropY = t2.cropY, n2.x += t2.offsetLeft, n2.y += t2.offsetTop, e2.width = t2.width, e2.height = t2.height), e2.setPositionByOrigin(n2, E, E);
        };
        var Ga = n({ addTransformToObject: () => Et, animate: () => Mr, animateColor: () => Nr, applyTransformToObject: () => Dt, calcAngleBetweenVectors: () => Vt, calcDimensionsMatrix: () => Ye, calcPlaneChangeMatrix: () => jt, calcVectorRotation: () => Ht, cancelAnimFrame: () => ke, capValue: () => Vn, composeMatrix: () => Xe, copyCanvasElement: () => Ne, cos: () => Se, createCanvasElement: () => P, createImage: () => Me, createRotateMatrix: () => We, createScaleMatrix: () => Ge, createSkewXMatrix: () => qe, createSkewYMatrix: () => Je, createTranslateMatrix: () => Ue, createVector: () => zt, crossProduct: () => Gt, degreesToRadians: () => I, dotProduct: () => Kt, ease: () => Gn, enlivenObjectEnlivables: () => $e, enlivenObjects: () => Qe, findScaleToCover: () => da, findScaleToFit: () => ua, getBoundsOfCurve: () => va, getOrthonormalVector: () => Wt, getPathSegmentsInfo: () => ja, getPointOnPath: () => Ma, getPointer: () => xt, getRandomInt: () => Ua, getRegularPolygonPath: () => Ba, getSmoothPathFromPoints: () => Ra, getSvgAttributes: () => pn, getUnitVector: () => Ut, groupSVGElements: () => la, hasStyleChanged: () => Ei, invertTransform: () => R, isBetweenVectors: () => qt, isIdentityMatrix: () => Le, isTouchEvent: () => St, isTransparent: () => yi, joinPath: () => Va, loadImage: () => Ze, magnitude: () => Bt, makeBoundingBoxFromPoints: () => wt, makePathSimpler: () => ba, matrixToSVG: () => nt, mergeClipPaths: () => Ha, multiplyTransformMatrices: () => z, multiplyTransformMatrixArray: () => Re, parsePath: () => La, parsePreserveAspectRatioAttribute: () => mn, parseUnit: () => K, pick: () => et, projectStrokeOnPoints: () => wi, qrDecompose: () => He, radiansToDegrees: () => Ie, removeFromArray: () => xe, removeTransformFromObject: () => Tt, removeTransformMatrixForSvgParsing: () => Wa, requestAnimFrame: () => Oe, resetObjectTransform: () => Ot, rotateVector: () => Rt, saveObjectTransform: () => kt, sendObjectToPlane: () => Pt, sendPointToPlane: () => Mt, sendVectorToPlane: () => Nt, sin: () => Ce, sizeAfterTransform: () => At, string: () => pt, stylesFromArray: () => Oi, stylesToArray: () => Di, toBlob: () => Fe, toDataURL: () => Pe, toFixed: () => B, transformPath: () => za, transformPoint: () => L });
        function Ka(e2, t2) {
          let n2 = e2.style;
          n2 && Object.entries(t2).forEach(([e3, t3]) => n2.setProperty(e3, t3));
        }
        var qa = class extends dt {
          constructor(e2, { allowTouchScrolling: t2 = false, containerClass: n2 = `` } = {}) {
            super(e2), a(this, `upper`, void 0), a(this, `container`, void 0);
            let { el: r2 } = this.lower, i2 = this.createUpperCanvas();
            this.upper = { el: i2, ctx: i2.getContext(`2d`) }, this.applyCanvasStyle(r2, { allowTouchScrolling: t2 }), this.applyCanvasStyle(i2, { allowTouchScrolling: t2, styles: { position: `absolute`, left: `0`, top: `0` } });
            let o2 = this.createContainerElement();
            o2.classList.add(n2), r2.parentNode && r2.parentNode.replaceChild(o2, r2), o2.append(r2, i2), this.container = o2;
          }
          createUpperCanvas() {
            let { el: e2 } = this.lower, t2 = P();
            return t2.className = e2.className, t2.classList.remove(`lower-canvas`), t2.classList.add(`upper-canvas`), t2.setAttribute(`data-fabric`, `top`), t2.style.cssText = e2.style.cssText, t2.setAttribute(`draggable`, `true`), t2;
          }
          createContainerElement() {
            let e2 = g().createElement(`div`);
            return e2.setAttribute(`data-fabric`, `wrapper`), Ka(e2, { position: `relative` }), ut(e2), e2;
          }
          applyCanvasStyle(e2, t2) {
            let { styles: n2, allowTouchScrolling: r2 } = t2;
            Ka(e2, { ...n2, "touch-action": r2 ? `manipulation` : te }), ut(e2);
          }
          setDimensions(e2, t2) {
            super.setDimensions(e2, t2);
            let { el: n2, ctx: r2 } = this.upper;
            ct(n2, r2, e2, t2);
          }
          setCSSDimensions(e2) {
            super.setCSSDimensions(e2), lt(this.upper.el, e2), lt(this.container, e2);
          }
          cleanupDOM(e2) {
            let t2 = this.container, { el: n2 } = this.lower, { el: r2 } = this.upper;
            super.cleanupDOM(e2), t2.removeChild(r2), t2.removeChild(n2), t2.parentNode && t2.parentNode.replaceChild(n2, t2);
          }
          dispose() {
            super.dispose(), h().dispose(this.upper.el), delete this.upper, delete this.container;
          }
        };
        let Ja = (e2, t2, n2, r2) => {
          let { target: i2, offsetX: a2, offsetY: o2 } = t2, s2 = n2 - a2, c2 = r2 - o2, l2 = !Zt(i2, `lockMovementX`) && i2.left !== s2, u2 = !Zt(i2, `lockMovementY`) && i2.top !== c2;
          return l2 && i2.set(`left`, s2), u2 && i2.set(`top`, c2), (l2 || u2) && Lr(re, Qt(e2, t2, n2, r2)), l2 || u2;
        }, Ya = ce, Xa = (e2) => function(t2, n2, r2) {
          let { points: i2, pathOffset: a2 } = r2;
          return new N(i2[e2]).subtract(a2).transform(z(r2.getViewportTransform(), r2.calcTransformMatrix()));
        }, Za = (e2, t2, n2, r2) => {
          let { target: i2, pointIndex: a2 } = t2, o2 = i2, s2 = Mt(new N(n2, r2), void 0, o2.calcOwnMatrix());
          return o2.points[a2] = s2.add(o2.pathOffset), o2.setDimensions(), o2.set(`dirty`, true), true;
        }, Qa = (e2, t2) => function(n2, r2, i2, a2) {
          let o2 = r2.target, s2 = new N(o2.points[(e2 > 0 ? e2 : o2.points.length) - 1]), c2 = s2.subtract(o2.pathOffset).transform(o2.calcOwnMatrix()), l2 = t2(n2, { ...r2, pointIndex: e2 }, i2, a2), u2 = s2.subtract(o2.pathOffset).transform(o2.calcOwnMatrix()).subtract(c2);
          return o2.left -= u2.x, o2.top -= u2.y, l2;
        }, $a = (e2) => Rr(Ya, Qa(e2, Za));
        function eo(e2, t2 = {}) {
          let n2 = {};
          for (let r2 = 0; r2 < (typeof e2 == `number` ? e2 : e2.points.length); r2++) n2[`p${r2}`] = new q({ actionName: Ya, positionHandler: Xa(r2), actionHandler: $a(r2), ...t2 });
          return n2;
        }
        let to = (e2, t2, n2) => {
          let { path: r2, pathOffset: i2 } = e2, a2 = r2[t2];
          return new N(a2[n2] - i2.x, a2[n2 + 1] - i2.y).transform(z(e2.getViewportTransform(), e2.calcTransformMatrix()));
        };
        function no(e2, t2, n2) {
          let { commandIndex: r2, pointIndex: i2 } = this;
          return to(n2, r2, i2);
        }
        function ro(e2, t2, n2, r2) {
          let { target: i2 } = t2, { commandIndex: a2, pointIndex: o2 } = this, s2 = ((e3, t3, n3, r3, i3) => {
            let { path: a3, pathOffset: o3 } = e3, s3 = a3[(r3 > 0 ? r3 : a3.length) - 1], c2 = new N(s3[i3], s3[i3 + 1]), l2 = c2.subtract(o3).transform(e3.calcOwnMatrix()), u2 = Mt(new N(t3, n3), void 0, e3.calcOwnMatrix());
            a3[r3][i3] = u2.x + o3.x, a3[r3][i3 + 1] = u2.y + o3.y, e3.setDimensions();
            let d2 = c2.subtract(e3.pathOffset).transform(e3.calcOwnMatrix()).subtract(l2);
            return e3.left -= d2.x, e3.top -= d2.y, e3.set(`dirty`, true), true;
          })(i2, n2, r2, a2, o2);
          return s2 && Lr(this.actionName, { ...Qt(e2, t2, n2, r2), commandIndex: a2, pointIndex: o2 }), s2;
        }
        var io = class extends q {
          constructor(e2) {
            super(e2);
          }
          render(e2, t2, n2, r2, i2) {
            let a2 = { ...r2, cornerColor: this.controlFill, cornerStrokeColor: this.controlStroke, transparentCorners: !this.controlFill };
            super.render(e2, t2, n2, a2, i2);
          }
        }, ao = class extends io {
          constructor(e2) {
            super(e2);
          }
          render(e2, t2, n2, r2, i2) {
            let { path: a2 } = i2, { commandIndex: o2, pointIndex: s2, connectToCommandIndex: c2, connectToPointIndex: l2 } = this;
            e2.save(), e2.strokeStyle = this.controlStroke, this.connectionDashArray && e2.setLineDash(this.connectionDashArray);
            let [u2] = a2[o2], d2 = to(i2, c2, l2);
            if (u2 === `Q`) {
              let r3 = to(i2, o2, s2 + 2);
              e2.moveTo(r3.x, r3.y), e2.lineTo(t2, n2);
            } else e2.moveTo(t2, n2);
            e2.lineTo(d2.x, d2.y), e2.stroke(), e2.restore(), super.render(e2, t2, n2, r2, i2);
          }
        };
        let oo = (e2, t2, n2, r2, i2, a2) => new (n2 ? ao : io)({ commandIndex: e2, pointIndex: t2, actionName: `modifyPath`, positionHandler: no, actionHandler: ro, connectToCommandIndex: i2, connectToPointIndex: a2, ...r2, ...n2 ? r2.controlPointStyle : r2.pointStyle });
        function so(e2, t2 = {}) {
          let n2 = {}, r2 = `M`;
          return e2.path.forEach((e3, i2) => {
            let a2 = e3[0];
            switch (a2 !== `Z` && (n2[`c_${i2}_${a2}`] = oo(i2, e3.length - 2, false, t2)), a2) {
              case `C`:
                n2[`c_${i2}_C_CP_1`] = oo(i2, 1, true, t2, i2 - 1, /* @__PURE__ */ ((e4) => e4 === `C` ? 5 : e4 === `Q` ? 3 : 1)(r2)), n2[`c_${i2}_C_CP_2`] = oo(i2, 3, true, t2, i2, 5);
                break;
              case `Q`:
                n2[`c_${i2}_Q_CP_1`] = oo(i2, 1, true, t2, i2, 3);
            }
            r2 = a2;
          }), n2;
        }
        var co = n({ changeHeight: () => Wr, changeObjectHeight: () => Hr, changeObjectWidth: () => Vr, changeWidth: () => Ur, createObjectDefaultControls: () => mi, createPathControls: () => so, createPolyActionHandler: () => $a, createPolyControls: () => eo, createPolyPositionHandler: () => Xa, createResizeControls: () => hi, createTextboxDefaultControls: () => gi, dragHandler: () => Ja, factoryPolyActionHandler: () => Qa, getLocalPoint: () => en, polyActionHandler: () => Za, renderCircleControl: () => Gr, renderSquareControl: () => Kr, rotationStyleHandler: () => qr, rotationWithSnapping: () => Jr, scaleCursorStyleHandler: () => Qr, scaleOrSkewActionName: () => ui, scaleSkewCursorStyleHandler: () => di, scalingEqually: () => ei, scalingX: () => ti, scalingXOrSkewingY: () => fi, scalingY: () => ni, scalingYOrSkewingX: () => pi, skewCursorStyleHandler: () => ai, skewHandlerX: () => si, skewHandlerY: () => ci, wrapWithFireEvent: () => Rr, wrapWithFixedAnchor: () => zr }), lo = class e2 extends yt {
          constructor(...e3) {
            super(...e3), a(this, `_hoveredTargets`, []), a(this, `_currentTransform`, null), a(this, `_groupSelector`, null), a(this, `contextTopDirty`, false);
          }
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          get upperCanvasEl() {
            var e3;
            return (e3 = this.elements.upper) == null ? void 0 : e3.el;
          }
          get contextTop() {
            var e3;
            return (e3 = this.elements.upper) == null ? void 0 : e3.ctx;
          }
          get wrapperEl() {
            return this.elements.container;
          }
          initElements(e3) {
            this.elements = new qa(e3, { allowTouchScrolling: this.allowTouchScrolling, containerClass: this.containerClass }), this._createCacheCanvas();
          }
          _onObjectAdded(e3) {
            this._objectsToRender = void 0, super._onObjectAdded(e3);
          }
          _onObjectRemoved(e3) {
            this._objectsToRender = void 0, e3 === this._activeObject && (this.fire(`before:selection:cleared`, { deselected: [e3] }), this._discardActiveObject(), this.fire(`selection:cleared`, { deselected: [e3] }), e3.fire(`deselected`, { target: e3 })), e3 === this._hoveredTarget && (this._hoveredTarget = void 0, this._hoveredTargets = []), super._onObjectRemoved(e3);
          }
          _onStackOrderChanged() {
            this._objectsToRender = void 0, super._onStackOrderChanged();
          }
          _chooseObjectsToRender() {
            let e3 = this._activeObject;
            return !this.preserveObjectStacking && e3 ? this._objects.filter((t2) => !t2.group && t2 !== e3).concat(e3) : this._objects;
          }
          renderAll() {
            this.cancelRequestedRender(), this.destroyed || (!this.contextTopDirty || this._groupSelector || this.isDrawingMode || (this.clearContext(this.contextTop), this.contextTopDirty = false), this.hasLostContext && (this.renderTopLayer(this.contextTop), this.hasLostContext = false), !this._objectsToRender && (this._objectsToRender = this._chooseObjectsToRender()), this.renderCanvas(this.getContext(), this._objectsToRender));
          }
          renderTopLayer(e3) {
            e3.save(), this.isDrawingMode && this._isCurrentlyDrawing && (this.freeDrawingBrush && this.freeDrawingBrush._render(), this.contextTopDirty = true), this.selection && this._groupSelector && (this._drawSelection(e3), this.contextTopDirty = true), e3.restore();
          }
          renderTop() {
            let e3 = this.contextTop;
            this.clearContext(e3), this.renderTopLayer(e3), this.fire(`after:render`, { ctx: e3 });
          }
          setTargetFindTolerance(e3) {
            e3 = Math.round(e3), this.targetFindTolerance = e3;
            let t2 = this.getRetinaScaling(), n2 = Math.ceil((2 * e3 + 1) * t2);
            this.pixelFindCanvasEl.width = this.pixelFindCanvasEl.height = n2, this.pixelFindContext.scale(t2, t2);
          }
          isTargetTransparent(e3, t2, n2) {
            let r2 = this.targetFindTolerance, i2 = this.pixelFindContext;
            this.clearContext(i2), i2.save(), i2.translate(-t2 + r2, -n2 + r2), i2.transform(...this.viewportTransform);
            let a2 = e3.selectionBackgroundColor;
            e3.selectionBackgroundColor = ``, e3.render(i2), e3.selectionBackgroundColor = a2, i2.restore();
            let o2 = Math.round(r2 * this.getRetinaScaling());
            return yi(i2, o2, o2, o2);
          }
          _isSelectionKeyPressed(e3) {
            let t2 = this.selectionKey;
            return !!t2 && (Array.isArray(t2) ? !!t2.find((t3) => !!t3 && true === e3[t3]) : e3[t2]);
          }
          _shouldClearSelection(e3, t2) {
            let n2 = this.getActiveObjects(), r2 = this._activeObject;
            return !!(!t2 || t2 && r2 && n2.length > 1 && n2.indexOf(t2) === -1 && r2 !== t2 && !this._isSelectionKeyPressed(e3) || t2 && !t2.evented || t2 && !t2.selectable && r2 && r2 !== t2);
          }
          _shouldCenterTransform(e3, t2, n2) {
            if (!e3) return;
            let r2;
            return t2 === `scale` || t2 === `scaleX` || t2 === `scaleY` || t2 === `resizing` ? r2 = this.centeredScaling || e3.centeredScaling : t2 === `rotate` && (r2 = this.centeredRotation || e3.centeredRotation), r2 ? !n2 : n2;
          }
          _getOriginFromCorner(e3, t2) {
            let n2 = t2 ? e3.controls[t2].getTransformAnchorPoint() : { x: e3.originX, y: e3.originY };
            return t2 ? ([`ml`, `tl`, `bl`].includes(t2) ? n2.x = k : [`mr`, `tr`, `br`].includes(t2) && (n2.x = D), [`tl`, `mt`, `tr`].includes(t2) ? n2.y = O : [`bl`, `mb`, `br`].includes(t2) && (n2.y = `top`), n2) : n2;
          }
          _setupCurrentTransform(e3, t2, n2) {
            var r2;
            let i2 = t2.group ? Mt(this.getScenePoint(e3), void 0, t2.group.calcTransformMatrix()) : this.getScenePoint(e3), { key: a2 = ``, control: o2 } = t2.getActiveControl() || {}, s2 = n2 && o2 ? (r2 = o2.getActionHandler(e3, t2, o2)) == null ? void 0 : r2.bind(o2) : Ja, c2 = ((e4, t3, n3, r3) => {
              if (!t3 || !e4) return `drag`;
              let i3 = r3.controls[t3];
              return i3.getActionName(n3, i3, r3);
            })(n2, a2, e3, t2), l2 = e3[this.centeredKey], u2 = this._shouldCenterTransform(t2, c2, l2) ? { x: E, y: E } : this._getOriginFromCorner(t2, a2), { scaleX: d2, scaleY: f2, skewX: p2, skewY: m2, left: h2, top: g2, angle: _2, width: v2, height: y2, cropX: b2, cropY: x2 } = t2, S2 = { target: t2, action: c2, actionHandler: s2, actionPerformed: false, corner: a2, scaleX: d2, scaleY: f2, skewX: p2, skewY: m2, offsetX: i2.x - h2, offsetY: i2.y - g2, originX: u2.x, originY: u2.y, ex: i2.x, ey: i2.y, lastX: i2.x, lastY: i2.y, theta: I(_2), width: v2, height: y2, shiftKey: e3.shiftKey, altKey: l2, original: { ...kt(t2), originX: u2.x, originY: u2.y, cropX: b2, cropY: x2 } };
            this._currentTransform = S2, this.fire(`before:transform`, { e: e3, transform: S2 });
          }
          setCursor(e3) {
            this.upperCanvasEl.style.cursor = e3;
          }
          _drawSelection(e3) {
            let { x: t2, y: n2, deltaX: r2, deltaY: i2 } = this._groupSelector, a2 = new N(t2, n2).transform(this.viewportTransform), o2 = new N(t2 + r2, n2 + i2).transform(this.viewportTransform), s2 = this.selectionLineWidth / 2, c2 = Math.min(a2.x, o2.x), l2 = Math.min(a2.y, o2.y), u2 = Math.max(a2.x, o2.x), d2 = Math.max(a2.y, o2.y);
            this.selectionColor && (e3.fillStyle = this.selectionColor, e3.fillRect(c2, l2, u2 - c2, d2 - l2)), this.selectionLineWidth && this.selectionBorderColor && (e3.lineWidth = this.selectionLineWidth, e3.strokeStyle = this.selectionBorderColor, c2 += s2, l2 += s2, u2 -= s2, d2 -= s2, J.prototype._setLineDash.call(this, e3, this.selectionDashArray), e3.strokeRect(c2, l2, u2 - c2, d2 - l2));
          }
          findTarget(e3) {
            if (this._targetInfo) return this._targetInfo;
            if (this.skipTargetFind) return { subTargets: [], currentSubTargets: [] };
            let t2 = this.getScenePoint(e3), n2 = this._activeObject, r2 = this.getActiveObjects(), i2 = this.searchPossibleTargets(this._objects, t2), { subTargets: a2, container: o2, target: s2 } = i2, c2 = { ...i2, currentSubTargets: a2, currentContainer: o2, currentTarget: s2 };
            if (!n2) return c2;
            let l2 = { ...this.searchPossibleTargets([n2], t2), currentSubTargets: a2, currentContainer: o2, currentTarget: s2 };
            return n2.findControl(this.getViewportPoint(e3), St(e3)) ? { ...l2, target: n2 } : l2.target && (r2.length > 1 || !this.preserveObjectStacking || this.preserveObjectStacking && e3[this.altSelectionKey]) ? l2 : c2;
          }
          _pointIsInObjectSelectionArea(e3, t2) {
            let n2 = e3.getCoords(), r2 = this.getZoom(), i2 = e3.padding / r2;
            if (i2) {
              let [e4, t3, r3, a2] = n2, o2 = Math.atan2(t3.y - e4.y, t3.x - e4.x), s2 = Se(o2) * i2, c2 = Ce(o2) * i2, l2 = s2 + c2, u2 = s2 - c2;
              n2 = [new N(e4.x - u2, e4.y - l2), new N(t3.x + l2, t3.y - u2), new N(r3.x + u2, r3.y + l2), new N(a2.x - l2, a2.y + u2)];
            }
            return Pr.isPointInPolygon(t2, n2);
          }
          _checkTarget(e3, t2) {
            if (e3 && e3.visible && e3.evented && this._pointIsInObjectSelectionArea(e3, t2)) {
              if (!this.perPixelTargetFind && !e3.perPixelTargetFind || e3.isEditing) return true;
              {
                let n2 = t2.transform(this.viewportTransform);
                if (!this.isTargetTransparent(e3, n2.x, n2.y)) return true;
              }
            }
            return false;
          }
          _searchPossibleTargets(e3, t2, n2) {
            let r2 = e3.length;
            for (; r2--; ) {
              let i2 = e3[r2];
              if (this._checkTarget(i2, t2)) {
                if (Te(i2) && i2.subTargetCheck) {
                  let { target: e4 } = this._searchPossibleTargets(i2._objects, t2, n2);
                  e4 && n2.push(e4);
                }
                return { target: i2, subTargets: n2 };
              }
            }
            return { subTargets: [] };
          }
          searchPossibleTargets(e3, t2) {
            let n2 = this._searchPossibleTargets(e3, t2, []);
            n2.container = n2.target;
            let { container: r2, subTargets: i2 } = n2;
            if (r2 && Te(r2) && r2.interactive && i2[0]) {
              for (let e4 = i2.length - 1; e4 > 0; e4--) {
                let t3 = i2[e4];
                if (!Te(t3) || !t3.interactive) return n2.target = t3, n2;
              }
              return n2.target = i2[0], n2;
            }
            return n2;
          }
          getViewportPoint(e3) {
            return this._viewportPoint ? this._viewportPoint : this._getPointerImpl(e3, true);
          }
          getScenePoint(e3) {
            return this._scenePoint ? this._scenePoint : this._getPointerImpl(e3);
          }
          _getPointerImpl(e3, t2 = false) {
            let n2 = this.upperCanvasEl, r2 = n2.getBoundingClientRect(), i2 = xt(e3), a2 = r2.width || 0, o2 = r2.height || 0;
            a2 && o2 || (`top` in r2 && `bottom` in r2 && (o2 = Math.abs(r2.top - r2.bottom)), `right` in r2 && `left` in r2 && (a2 = Math.abs(r2.right - r2.left))), this.calcOffset(), i2.x -= this._offset.left, i2.y -= this._offset.top, t2 || (i2 = Mt(i2, void 0, this.viewportTransform));
            let s2 = this.getRetinaScaling();
            s2 !== 1 && (i2.x /= s2, i2.y /= s2);
            let c2 = a2 === 0 || o2 === 0 ? new N(1, 1) : new N(n2.width / a2, n2.height / o2);
            return i2.multiply(c2);
          }
          _setDimensionsImpl(e3, t2) {
            this._resetTransformEventData(), super._setDimensionsImpl(e3, t2), this._isCurrentlyDrawing && this.freeDrawingBrush && this.freeDrawingBrush._setBrushStyles(this.contextTop);
          }
          _createCacheCanvas() {
            this.pixelFindCanvasEl = P(), this.pixelFindContext = this.pixelFindCanvasEl.getContext(`2d`, { willReadFrequently: true }), this.setTargetFindTolerance(this.targetFindTolerance);
          }
          getTopContext() {
            return this.elements.upper.ctx;
          }
          getSelectionContext() {
            return this.elements.upper.ctx;
          }
          getSelectionElement() {
            return this.elements.upper.el;
          }
          getActiveObject() {
            return this._activeObject;
          }
          getActiveObjects() {
            let e3 = this._activeObject;
            return at(e3) ? e3.getObjects() : e3 ? [e3] : [];
          }
          _fireSelectionEvents(e3, t2) {
            let n2 = false, r2 = false, i2 = this.getActiveObjects(), a2 = [], o2 = [];
            e3.forEach((e4) => {
              i2.includes(e4) || (n2 = true, e4.fire(`deselected`, { e: t2, target: e4 }), o2.push(e4));
            }), i2.forEach((r3) => {
              e3.includes(r3) || (n2 = true, r3.fire(`selected`, { e: t2, target: r3 }), a2.push(r3));
            }), e3.length > 0 && i2.length > 0 ? (r2 = true, n2 && this.fire(`selection:updated`, { e: t2, selected: a2, deselected: o2 })) : i2.length > 0 ? (r2 = true, this.fire(`selection:created`, { e: t2, selected: a2 })) : e3.length > 0 && (r2 = true, this.fire(`selection:cleared`, { e: t2, deselected: o2 })), r2 && (this._objectsToRender = void 0);
          }
          setActiveObject(e3, t2) {
            let n2 = this.getActiveObjects(), r2 = this._setActiveObject(e3, t2);
            return this._fireSelectionEvents(n2, t2), r2;
          }
          _setActiveObject(e3, t2) {
            let n2 = this._activeObject;
            return n2 !== e3 && !(!this._discardActiveObject(t2, e3) && this._activeObject) && !e3.onSelect({ e: t2 }) && (this._activeObject = e3, at(e3) && n2 !== e3 && e3.set(`canvas`, this), e3.setCoords(), true);
          }
          _discardActiveObject(e3, t2) {
            let n2 = this._activeObject;
            return !!n2 && !n2.onDeselect({ e: e3, object: t2 }) && (this._currentTransform && this._currentTransform.target === n2 && this.endCurrentTransform(e3), at(n2) && n2 === this._hoveredTarget && (this._hoveredTarget = void 0), this._activeObject = void 0, true);
          }
          discardActiveObject(e3) {
            let t2 = this.getActiveObjects(), n2 = this.getActiveObject();
            t2.length && this.fire(`before:selection:cleared`, { e: e3, deselected: [n2] });
            let r2 = this._discardActiveObject(e3);
            return this._fireSelectionEvents(t2, e3), r2;
          }
          endCurrentTransform(e3) {
            let t2 = this._currentTransform;
            this._finalizeCurrentTransform(e3), t2 && t2.target && (t2.target.isMoving = false), this._currentTransform = null;
          }
          _finalizeCurrentTransform(e3) {
            let t2 = this._currentTransform, n2 = t2.target, r2 = { e: e3, target: n2, transform: t2, action: t2.action };
            n2._scaling && (n2._scaling = false), n2.setCoords(), t2.actionPerformed && (this.fire(`object:modified`, r2), n2.fire(ge, r2));
          }
          setViewportTransform(e3) {
            super.setViewportTransform(e3);
            let t2 = this._activeObject;
            t2 && t2.setCoords();
          }
          destroy() {
            let e3 = this._activeObject;
            at(e3) && (e3.removeAll(), e3.dispose()), delete this._activeObject, super.destroy(), this.pixelFindContext = null, this.pixelFindCanvasEl = void 0;
          }
          clear() {
            this.discardActiveObject(), this._activeObject = void 0, this.clearContext(this.contextTop), super.clear();
          }
          drawControls(e3) {
            let t2 = this._activeObject;
            t2 && t2._renderControls(e3);
          }
          _toObject(e3, t2, n2) {
            let r2 = this._realizeGroupTransformOnObject(e3), i2 = super._toObject(e3, t2, n2);
            return e3.set(r2), i2;
          }
          _realizeGroupTransformOnObject(e3) {
            let { group: t2 } = e3;
            if (t2 && at(t2) && this._activeObject === t2) {
              let n2 = et(e3, [`angle`, `flipX`, `flipY`, D, de, fe, pe, me, `top`]);
              return Et(e3, t2.calcOwnMatrix()), n2;
            }
            return {};
          }
          _setSVGObject(e3, t2, n2) {
            let r2 = this._realizeGroupTransformOnObject(t2);
            super._setSVGObject(e3, t2, n2), t2.set(r2);
          }
        };
        a(lo, `ownDefaults`, { uniformScaling: true, uniScaleKey: `shiftKey`, centeredScaling: false, centeredRotation: false, centeredKey: `altKey`, altActionKey: `shiftKey`, selection: true, selectionKey: `shiftKey`, selectionColor: `rgba(100, 100, 255, 0.3)`, selectionDashArray: [], selectionBorderColor: `rgba(255, 255, 255, 0.3)`, selectionLineWidth: 1, selectionFullyContained: false, hoverCursor: `move`, moveCursor: `move`, defaultCursor: `default`, freeDrawingCursor: `crosshair`, notAllowedCursor: `not-allowed`, perPixelTargetFind: false, targetFindTolerance: 0, skipTargetFind: false, stopContextMenu: true, fireRightClick: true, fireMiddleClick: true, enablePointerEvents: false, containerClass: `canvas-container`, preserveObjectStacking: true });
        var uo = class {
          constructor(e2) {
            a(this, `targets`, []), a(this, `__disposer`, void 0);
            let t2 = () => {
              let { hiddenTextarea: t3 } = e2.getActiveObject() || {};
              t3 && t3.focus();
            }, n2 = e2.upperCanvasEl;
            n2.addEventListener(`click`, t2), this.__disposer = () => n2.removeEventListener(`click`, t2);
          }
          exitTextEditing() {
            this.target = void 0, this.targets.forEach((e2) => {
              e2.isEditing && e2.exitEditing();
            });
          }
          add(e2) {
            this.targets.push(e2);
          }
          remove(e2) {
            this.unregister(e2), xe(this.targets, e2);
          }
          register(e2) {
            this.target = e2;
          }
          unregister(e2) {
            e2 === this.target && (this.target = void 0);
          }
          onMouseMove(e2) {
            var t2;
            (t2 = this.target) != null && t2.isEditing && this.target.updateSelectionOnMouseMove(e2);
          }
          clear() {
            this.targets = [], this.target = void 0;
          }
          dispose() {
            this.clear(), this.__disposer(), delete this.__disposer;
          }
        };
        let X = { passive: false }, fo = (e2, t2) => ({ viewportPoint: e2.getViewportPoint(t2), scenePoint: e2.getScenePoint(t2) }), po = (e2, ...t2) => e2.addEventListener(...t2), Z = (e2, ...t2) => e2.removeEventListener(...t2), mo = { mouse: { in: `over`, out: `out`, targetIn: `mouseover`, targetOut: `mouseout`, canvasIn: `mouse:over`, canvasOut: `mouse:out` }, drag: { in: `enter`, out: `leave`, targetIn: `dragenter`, targetOut: `dragleave`, canvasIn: `drag:enter`, canvasOut: `drag:leave` } };
        var ho = class extends lo {
          constructor(e2, t2 = {}) {
            super(e2, t2), a(this, `_isClick`, void 0), a(this, `textEditingManager`, new uo(this)), [`_onMouseDown`, `_onTouchStart`, `_onMouseMove`, `_onMouseUp`, `_onTouchEnd`, `_onResize`, `_onMouseWheel`, `_onMouseOut`, `_onMouseEnter`, `_onContextMenu`, `_onClick`, `_onDragStart`, `_onDragEnd`, `_onDragProgress`, `_onDragOver`, `_onDragEnter`, `_onDragLeave`, `_onDrop`].forEach((e3) => {
              this[e3] = this[e3].bind(this);
            }), this.addOrRemove(po);
          }
          _getEventPrefix() {
            return this.enablePointerEvents ? `pointer` : `mouse`;
          }
          addOrRemove(e2, t2 = false) {
            let n2 = this.upperCanvasEl, r2 = this._getEventPrefix();
            e2(st(n2), `resize`, this._onResize), e2(n2, r2 + `down`, this._onMouseDown), e2(n2, `${r2}move`, this._onMouseMove, X), e2(n2, `${r2}out`, this._onMouseOut), e2(n2, `${r2}enter`, this._onMouseEnter), e2(n2, `wheel`, this._onMouseWheel, { passive: false }), e2(n2, `contextmenu`, this._onContextMenu), t2 || (e2(n2, `click`, this._onClick), e2(n2, `dblclick`, this._onClick)), e2(n2, `dragstart`, this._onDragStart), e2(n2, `dragend`, this._onDragEnd), e2(n2, `dragover`, this._onDragOver), e2(n2, `dragenter`, this._onDragEnter), e2(n2, `dragleave`, this._onDragLeave), e2(n2, `drop`, this._onDrop), this.enablePointerEvents || e2(n2, `touchstart`, this._onTouchStart, X);
          }
          removeListeners() {
            this.addOrRemove(Z);
            let e2 = this._getEventPrefix(), t2 = H(this.upperCanvasEl);
            Z(t2, `${e2}up`, this._onMouseUp), Z(t2, `touchend`, this._onTouchEnd, X), Z(t2, `${e2}move`, this._onMouseMove, X), Z(t2, `touchmove`, this._onMouseMove, X), clearTimeout(this._willAddMouseDown);
          }
          _onMouseWheel(e2) {
            this._cacheTransformEventData(e2), this._handleEvent(e2, `wheel`), this._resetTransformEventData();
          }
          _onMouseOut(e2) {
            let t2 = this._hoveredTarget, n2 = { e: e2, ...fo(this, e2) };
            this.fire(`mouse:out`, { ...n2, target: t2 }), this._hoveredTarget = void 0, t2 && t2.fire(`mouseout`, { ...n2 }), this._hoveredTargets.forEach((e3) => {
              this.fire(`mouse:out`, { ...n2, target: e3 }), e3 && e3.fire(`mouseout`, { ...n2 });
            }), this._hoveredTargets = [];
          }
          _onMouseEnter(e2) {
            let { target: t2 } = this.findTarget(e2);
            this._currentTransform || t2 || (this.fire(`mouse:over`, { e: e2, ...fo(this, e2) }), this._hoveredTarget = void 0, this._hoveredTargets = []);
          }
          _onDragStart(e2) {
            this._isClick = false;
            let t2 = this.getActiveObject();
            if (t2 && t2.onDragStart(e2)) {
              this._dragSource = t2;
              let n2 = { e: e2, target: t2 };
              this.fire(`dragstart`, n2), t2.fire(`dragstart`, n2), po(this.upperCanvasEl, `drag`, this._onDragProgress);
              return;
            }
            Ct(e2);
          }
          _renderDragEffects(e2, t2, n2) {
            let r2 = false, i2 = this._dropTarget;
            i2 && i2 !== t2 && i2 !== n2 && (i2.clearContextTop(), r2 = true), t2 == null || t2.clearContextTop(), n2 !== t2 && (n2 == null || n2.clearContextTop());
            let a2 = this.contextTop;
            a2.save(), a2.transform(...this.viewportTransform), t2 && (a2.save(), t2.transform(a2), t2.renderDragSourceEffect(e2), a2.restore(), r2 = true), n2 && (a2.save(), n2.transform(a2), n2.renderDropTargetEffect(e2), a2.restore(), r2 = true), a2.restore(), r2 && (this.contextTopDirty = true);
          }
          _onDragEnd(e2) {
            let { currentSubTargets: t2 } = this.findTarget(e2), n2 = !!e2.dataTransfer && e2.dataTransfer.dropEffect !== `none`, r2 = n2 ? this._activeObject : void 0, i2 = { e: e2, target: this._dragSource, subTargets: t2, dragSource: this._dragSource, didDrop: n2, dropTarget: r2 };
            Z(this.upperCanvasEl, `drag`, this._onDragProgress), this.fire(`dragend`, i2), this._dragSource && this._dragSource.fire(`dragend`, i2), delete this._dragSource, this._onMouseUp(e2);
          }
          _onDragProgress(e2) {
            let t2 = { e: e2, target: this._dragSource, dragSource: this._dragSource, dropTarget: this._draggedoverTarget };
            this.fire(`drag`, t2), this._dragSource && this._dragSource.fire(`drag`, t2);
          }
          _onDragOver(e2) {
            let t2 = `dragover`, { currentContainer: n2, currentSubTargets: r2 } = this.findTarget(e2), i2 = this._dragSource, a2 = { e: e2, target: n2, subTargets: r2, dragSource: i2, canDrop: false, dropTarget: void 0 }, o2;
            this.fire(t2, a2), this._fireEnterLeaveEvents(e2, n2, a2), n2 && (n2.canDrop(e2) && (o2 = n2), n2.fire(t2, a2));
            for (let n3 = 0; n3 < r2.length; n3++) {
              let i3 = r2[n3];
              i3.canDrop(e2) && (o2 = i3), i3.fire(t2, a2);
            }
            this._renderDragEffects(e2, i2, o2), this._dropTarget = o2;
          }
          _onDragEnter(e2) {
            let { currentContainer: t2, currentSubTargets: n2 } = this.findTarget(e2), r2 = { e: e2, target: t2, subTargets: n2, dragSource: this._dragSource };
            this.fire(`dragenter`, r2), this._fireEnterLeaveEvents(e2, t2, r2);
          }
          _onDragLeave(e2) {
            let { currentSubTargets: t2 } = this.findTarget(e2), n2 = { e: e2, target: this._draggedoverTarget, subTargets: t2, dragSource: this._dragSource };
            this.fire(`dragleave`, n2), this._fireEnterLeaveEvents(e2, void 0, n2), this._renderDragEffects(e2, this._dragSource), this._dropTarget = void 0, this._hoveredTargets = [];
          }
          _onDrop(e2) {
            let { currentContainer: t2, currentSubTargets: n2 } = this.findTarget(e2), r2 = this._basicEventHandler(`drop:before`, { e: e2, target: t2, subTargets: n2, dragSource: this._dragSource, ...fo(this, e2) });
            r2.didDrop = false, r2.dropTarget = void 0, this._basicEventHandler(`drop`, r2), this.fire(`drop:after`, r2);
          }
          _onContextMenu(e2) {
            let { target: t2, subTargets: n2 } = this.findTarget(e2), r2 = this._basicEventHandler(`contextmenu:before`, { e: e2, target: t2, subTargets: n2 });
            return this.stopContextMenu && Ct(e2), this._basicEventHandler(`contextmenu`, r2), false;
          }
          _onClick(e2) {
            let t2 = e2.detail;
            t2 > 3 || t2 < 2 || (this._cacheTransformEventData(e2), t2 == 2 && e2.type === `dblclick` && this._handleEvent(e2, `dblclick`), t2 == 3 && this._handleEvent(e2, `tripleclick`), this._resetTransformEventData());
          }
          fireEventFromPointerEvent(e2, t2, n2, r2 = {}) {
            this._cacheTransformEventData(e2);
            let { target: i2, subTargets: a2 } = this.findTarget(e2), o2 = { e: e2, target: i2, subTargets: a2, ...fo(this, e2), transform: this._currentTransform, ...r2 };
            this.fire(t2, o2), i2 && i2.fire(n2, o2);
            for (let e3 = 0; e3 < a2.length; e3++) a2[e3] !== i2 && a2[e3].fire(n2, o2);
            this._resetTransformEventData();
          }
          getPointerId(e2) {
            let t2 = e2.changedTouches;
            return t2 ? t2[0] && t2[0].identifier : this.enablePointerEvents ? e2.pointerId : -1;
          }
          _isMainEvent(e2) {
            return true === e2.isPrimary || false !== e2.isPrimary && (e2.type === `touchend` && e2.touches.length === 0 || !e2.changedTouches || e2.changedTouches[0].identifier === this.mainTouchId);
          }
          _onTouchStart(e2) {
            this._cacheTransformEventData(e2);
            let t2 = !this.allowTouchScrolling, n2 = this._activeObject;
            this.mainTouchId === void 0 && (this.mainTouchId = this.getPointerId(e2)), this.__onMouseDown(e2);
            let { target: r2 } = this.findTarget(e2);
            (this.isDrawingMode || n2 && r2 === n2) && (t2 = true), t2 && e2.preventDefault();
            let i2 = this.upperCanvasEl, a2 = this._getEventPrefix(), o2 = H(i2);
            po(o2, `touchend`, this._onTouchEnd, X), t2 && po(o2, `touchmove`, this._onMouseMove, X), Z(i2, `${a2}down`, this._onMouseDown), this._resetTransformEventData();
          }
          _onMouseDown(e2) {
            this._cacheTransformEventData(e2), this.__onMouseDown(e2);
            let t2 = this.upperCanvasEl, n2 = this._getEventPrefix();
            Z(t2, `${n2}move`, this._onMouseMove, X);
            let r2 = H(t2);
            po(r2, `${n2}up`, this._onMouseUp), po(r2, `${n2}move`, this._onMouseMove, X), this._resetTransformEventData();
          }
          _onTouchEnd(e2) {
            if (e2.touches.length > 0) return;
            this._cacheTransformEventData(e2), this.__onMouseUp(e2), this._resetTransformEventData(), delete this.mainTouchId;
            let t2 = this._getEventPrefix(), n2 = H(this.upperCanvasEl);
            Z(n2, `touchend`, this._onTouchEnd, X), Z(n2, `touchmove`, this._onMouseMove, X), this._willAddMouseDown && clearTimeout(this._willAddMouseDown), this._willAddMouseDown = setTimeout(() => {
              po(this.upperCanvasEl, `${t2}down`, this._onMouseDown), this._willAddMouseDown = 0;
            }, 400);
          }
          _onMouseUp(e2) {
            this._cacheTransformEventData(e2), this.__onMouseUp(e2);
            let t2 = this.upperCanvasEl, n2 = this._getEventPrefix();
            if (this._isMainEvent(e2)) {
              let e3 = H(this.upperCanvasEl);
              Z(e3, `${n2}up`, this._onMouseUp), Z(e3, `${n2}move`, this._onMouseMove, X), po(t2, `${n2}move`, this._onMouseMove, X);
            }
            this._resetTransformEventData();
          }
          _onMouseMove(e2) {
            this._cacheTransformEventData(e2);
            let t2 = this.getActiveObject();
            !this.allowTouchScrolling && (!t2 || !t2.shouldStartDragging(e2)) && e2.preventDefault && e2.preventDefault(), this.__onMouseMove(e2), this._resetTransformEventData();
          }
          _onResize() {
            this.calcOffset(), this._resetTransformEventData();
          }
          _shouldRender(e2) {
            let t2 = this.getActiveObject();
            return !!t2 != !!e2 || t2 && e2 && t2 !== e2;
          }
          __onMouseUp(e2) {
            var t2;
            this._handleEvent(e2, `up:before`);
            let n2 = this._currentTransform, r2 = this._isClick, { target: i2 } = this.findTarget(e2), { button: a2 } = e2;
            if (a2) return void ((this.fireMiddleClick && a2 === 1 || this.fireRightClick && a2 === 2) && this._handleEvent(e2, `up`));
            if (this.isDrawingMode && this._isCurrentlyDrawing) return void this._onMouseUpInDrawingMode(e2);
            if (!this._isMainEvent(e2)) return;
            let o2, s2, c2 = false;
            if (n2 && (this._finalizeCurrentTransform(e2), c2 = n2.actionPerformed), !r2) {
              let t3 = i2 === this._activeObject;
              this.handleSelection(e2), c2 || (c2 = this._shouldRender(i2) || !t3 && i2 === this._activeObject);
            }
            if (i2) {
              let { key: t3, control: r3 } = i2.findControl(this.getViewportPoint(e2), St(e2)) || {};
              if (s2 = t3, i2.selectable && i2 !== this._activeObject && i2.activeOn === `up`) this.setActiveObject(i2, e2), c2 = true;
              else if (r3) {
                let t4 = r3.getMouseUpHandler(e2, i2, r3);
                t4 && (o2 = this.getScenePoint(e2), t4.call(r3, e2, n2, o2.x, o2.y));
              }
              i2.isMoving = false;
            }
            if (n2 && (n2.target !== i2 || n2.corner !== s2)) {
              let t3 = n2.target && n2.target.controls[n2.corner], r3 = t3 && t3.getMouseUpHandler(e2, n2.target, t3);
              o2 = o2 || this.getScenePoint(e2), r3 && r3.call(t3, e2, n2, o2.x, o2.y);
            }
            this._setCursorFromEvent(e2, i2), this._handleEvent(e2, `up`), this._groupSelector = null, this._currentTransform = null, i2 && (i2.__corner = void 0), c2 ? this.requestRenderAll() : r2 || (t2 = this._activeObject) != null && t2.isEditing || this.renderTop();
          }
          _basicEventHandler(e2, t2) {
            let { target: n2, subTargets: r2 = [] } = t2;
            this.fire(e2, t2), n2 && n2.fire(e2, t2);
            for (let i2 = 0; i2 < r2.length; i2++) r2[i2] !== n2 && r2[i2].fire(e2, t2);
            return t2;
          }
          _handleEvent(e2, t2, n2) {
            let { target: r2, subTargets: i2 } = this.findTarget(e2), a2 = { e: e2, target: r2, subTargets: i2, ...fo(this, e2), transform: this._currentTransform, ...t2 === `down:before` || t2 === `down` ? n2 : {} };
            t2 !== `up:before` && t2 !== `up` || (a2.isClick = this._isClick), this.fire(`mouse:${t2}`, a2), r2 && r2.fire(`mouse${t2}`, a2);
            for (let e3 = 0; e3 < i2.length; e3++) i2[e3] !== r2 && i2[e3].fire(`mouse${t2}`, a2);
          }
          _onMouseDownInDrawingMode(e2) {
            this._isCurrentlyDrawing = true, this.getActiveObject() && (this.discardActiveObject(e2), this.requestRenderAll());
            let t2 = this.getScenePoint(e2);
            this.freeDrawingBrush && this.freeDrawingBrush.onMouseDown(t2, { e: e2, pointer: t2 }), this._handleEvent(e2, `down`, { alreadySelected: false });
          }
          _onMouseMoveInDrawingMode(e2) {
            if (this._isCurrentlyDrawing) {
              let t2 = this.getScenePoint(e2);
              this.freeDrawingBrush && this.freeDrawingBrush.onMouseMove(t2, { e: e2, pointer: t2 });
            }
            this.setCursor(this.freeDrawingCursor), this._handleEvent(e2, `move`);
          }
          _onMouseUpInDrawingMode(e2) {
            let t2 = this.getScenePoint(e2);
            this.freeDrawingBrush ? this._isCurrentlyDrawing = !!this.freeDrawingBrush.onMouseUp({ e: e2, pointer: t2 }) : this._isCurrentlyDrawing = false, this._handleEvent(e2, `up`);
          }
          __onMouseDown(e2) {
            this._isClick = true, this._handleEvent(e2, `down:before`);
            let { target: t2 } = this.findTarget(e2), n2 = !!t2 && t2 === this._activeObject, { button: r2 } = e2;
            if (r2) return void ((this.fireMiddleClick && r2 === 1 || this.fireRightClick && r2 === 2) && this._handleEvent(e2, `down`, { alreadySelected: n2 }));
            if (this.isDrawingMode) return void this._onMouseDownInDrawingMode(e2);
            if (!this._isMainEvent(e2) || this._currentTransform) return;
            let i2 = this._shouldRender(t2), a2 = false;
            if (this.handleMultiSelection(e2, t2) ? (t2 = this._activeObject, a2 = true, i2 = true) : this._shouldClearSelection(e2, t2) && this.discardActiveObject(e2), this.selection && (!t2 || !t2.selectable && !t2.isEditing && t2 !== this._activeObject)) {
              let t3 = this.getScenePoint(e2);
              this._groupSelector = { x: t3.x, y: t3.y, deltaY: 0, deltaX: 0 };
            }
            if (n2 = !!t2 && t2 === this._activeObject, t2) {
              t2.selectable && t2.activeOn === `down` && this.setActiveObject(t2, e2);
              let r3 = t2.findControl(this.getViewportPoint(e2), St(e2));
              if (t2 === this._activeObject && (r3 || !a2)) {
                this._setupCurrentTransform(e2, t2, n2);
                let i3 = r3 ? r3.control : void 0, a3 = this.getScenePoint(e2), o2 = i3 && i3.getMouseDownHandler(e2, t2, i3);
                o2 && o2.call(i3, e2, this._currentTransform, a3.x, a3.y);
              }
            }
            i2 && (this._objectsToRender = void 0), this._handleEvent(e2, `down`, { alreadySelected: n2 }), i2 && this.requestRenderAll();
          }
          _resetTransformEventData() {
            this._targetInfo = this._viewportPoint = this._scenePoint = void 0;
          }
          _cacheTransformEventData(e2) {
            this._resetTransformEventData(), this._viewportPoint = this.getViewportPoint(e2), this._scenePoint = Mt(this._viewportPoint, void 0, this.viewportTransform), this._targetInfo = this.findTarget(e2), this._currentTransform && (this._targetInfo.target = this._currentTransform.target);
          }
          __onMouseMove(e2) {
            if (this._isClick = false, this._handleEvent(e2, `move:before`), this.isDrawingMode) return void this._onMouseMoveInDrawingMode(e2);
            if (!this._isMainEvent(e2)) return;
            let t2 = this._groupSelector;
            if (t2) {
              let n2 = this.getScenePoint(e2);
              t2.deltaX = n2.x - t2.x, t2.deltaY = n2.y - t2.y, this.renderTop();
            } else if (this._currentTransform) this._transformObject(e2);
            else {
              let { target: t3 } = this.findTarget(e2);
              this._setCursorFromEvent(e2, t3), this._fireOverOutEvents(e2, t3);
            }
            this.textEditingManager.onMouseMove(e2), this._handleEvent(e2, `move`);
          }
          _fireOverOutEvents(e2, t2) {
            let { _hoveredTarget: n2, _hoveredTargets: r2 } = this, { subTargets: i2, currentTarget: a2 } = this.findTarget(e2), o2 = Math.max(r2.length, i2.length);
            this.fireSyntheticInOutEvents(`mouse`, { e: e2, target: t2, oldTarget: n2, actualTarget: a2, oldActualTarget: this._hoveredActualTarget, fireCanvas: true });
            for (let a3 = 0; a3 < o2; a3++) i2[a3] === t2 || r2[a3] && r2[a3] === n2 || this.fireSyntheticInOutEvents(`mouse`, { e: e2, target: i2[a3], oldTarget: r2[a3] });
            this._hoveredActualTarget = a2, this._hoveredTarget = t2, this._hoveredTargets = i2;
          }
          _fireEnterLeaveEvents(e2, t2, n2) {
            let r2 = this._draggedoverTarget, i2 = this._hoveredTargets, { subTargets: a2 } = this.findTarget(e2), o2 = Math.max(i2.length, a2.length);
            this.fireSyntheticInOutEvents(`drag`, { ...n2, target: t2, oldTarget: r2, fireCanvas: true });
            for (let e3 = 0; e3 < o2; e3++) this.fireSyntheticInOutEvents(`drag`, { ...n2, target: a2[e3], oldTarget: i2[e3] });
            this._draggedoverTarget = t2;
          }
          fireSyntheticInOutEvents(e2, { target: t2, oldTarget: n2, actualTarget: r2, oldActualTarget: i2, fireCanvas: a2, e: o2, ...s2 }) {
            let { targetIn: c2, targetOut: l2, canvasIn: u2, canvasOut: d2 } = mo[e2], f2 = n2 !== t2, p2 = i2 !== r2, m2 = t2 && f2, h2 = r2 && p2, g2 = n2 && f2, _2 = i2 && p2, v2 = { ...s2, e: o2, ...fo(this, o2) }, y2 = { ...v2, target: n2, nextTarget: t2, actualTarget: i2, nextActualTarget: r2 };
            (g2 || _2) && a2 && this.fire(d2, y2), g2 && n2.fire(l2, y2), _2 && n2 !== i2 && i2.fire(l2, y2);
            let b2 = { ...v2, target: t2, previousTarget: n2, actualTarget: r2, previousActualTarget: i2 };
            (m2 || h2) && a2 && this.fire(u2, b2), m2 && t2.fire(c2, b2), h2 && r2 !== t2 && r2.fire(c2, b2);
          }
          _transformObject(e2) {
            let t2 = this.getScenePoint(e2), n2 = this._currentTransform, r2 = n2.target, i2 = r2.group ? Mt(t2, void 0, r2.group.calcTransformMatrix()) : t2;
            n2.shiftKey = e2.shiftKey, n2.altKey = !!this.centeredKey && e2[this.centeredKey], this._performTransformAction(e2, n2, i2), n2.actionPerformed && this.requestRenderAll();
          }
          _performTransformAction(e2, t2, n2) {
            let { action: r2, actionHandler: i2, target: a2 } = t2, o2 = !!i2 && i2(e2, t2, n2.x, n2.y);
            o2 && a2.setCoords(), r2 === `drag` && o2 && (t2.target.isMoving = true, this.setCursor(t2.target.moveCursor || this.moveCursor)), t2.actionPerformed = t2.actionPerformed || o2;
          }
          _setCursorFromEvent(e2, t2) {
            if (!t2) return void this.setCursor(this.defaultCursor);
            let n2 = t2.hoverCursor || this.hoverCursor, r2 = at(this._activeObject) ? this._activeObject : null, i2 = (!r2 || t2.group !== r2) && t2.findControl(this.getViewportPoint(e2));
            if (i2) {
              let { control: n3, coord: r3 } = i2;
              this.setCursor(n3.cursorStyleHandler(e2, n3, t2, r3));
            } else {
              if (t2.subTargetCheck) {
                let { subTargets: t3 } = this.findTarget(e2);
                t3.concat().reverse().forEach((e3) => {
                  n2 = e3.hoverCursor || n2;
                });
              }
              this.setCursor(n2);
            }
          }
          handleMultiSelection(e2, t2) {
            let n2 = this._activeObject, r2 = at(n2);
            if (n2 && this._isSelectionKeyPressed(e2) && this.selection && t2 && t2.selectable && (n2 !== t2 || r2) && (r2 || !t2.isDescendantOf(n2) && !n2.isDescendantOf(t2)) && !t2.onSelect({ e: e2 }) && !n2.getActiveControl()) {
              if (r2) {
                let r3 = n2.getObjects(), i2 = [];
                if (t2 === n2) {
                  let n3 = this.getScenePoint(e2), a2 = this.searchPossibleTargets(r3, n3);
                  if (a2.target ? (t2 = a2.target, i2 = a2.subTargets) : (a2 = this.searchPossibleTargets(this._objects, n3), t2 = a2.target, i2 = a2.subTargets), !t2 || !t2.selectable) return false;
                }
                t2.group === n2 ? (n2.remove(t2), this._hoveredTarget = t2, this._hoveredTargets = i2, n2.size() === 1 && this._setActiveObject(n2.item(0), e2)) : (n2.multiSelectAdd(t2), this._hoveredTarget = n2, this._hoveredTargets = i2), this._fireSelectionEvents(r3, e2);
              } else {
                n2.isEditing && n2.exitEditing();
                let r3 = new (M.getClass(`ActiveSelection`))([], { canvas: this });
                r3.multiSelectAdd(n2, t2), this._hoveredTarget = r3, this._setActiveObject(r3, e2), this._fireSelectionEvents([n2], e2);
              }
              return true;
            }
            return false;
          }
          handleSelection(e2) {
            if (!this.selection || !this._groupSelector) return false;
            let { x: t2, y: n2, deltaX: r2, deltaY: i2 } = this._groupSelector, a2 = new N(t2, n2), o2 = a2.add(new N(r2, i2)), s2 = a2.min(o2), c2 = a2.max(o2).subtract(s2), l2 = this.collectObjects({ left: s2.x, top: s2.y, width: c2.x, height: c2.y }, { includeIntersecting: !this.selectionFullyContained }), u2 = a2.eq(o2) ? l2[0] ? [l2[0]] : [] : l2.length > 1 ? l2.filter((t3) => !t3.onSelect({ e: e2 })).reverse() : l2;
            if (u2.length === 1) this.setActiveObject(u2[0], e2);
            else if (u2.length > 1) {
              let t3 = M.getClass(`ActiveSelection`);
              this.setActiveObject(new t3(u2, { canvas: this }), e2);
            }
            return this._groupSelector = null, true;
          }
          toCanvasElement(e2 = 1, t2) {
            let { upper: n2 } = this.elements;
            n2.ctx = void 0;
            let r2 = super.toCanvasElement(e2, t2);
            return n2.ctx = n2.el.getContext(`2d`), r2;
          }
          clear() {
            this.textEditingManager.clear(), super.clear();
          }
          destroy() {
            this.removeListeners(), this.textEditingManager.dispose(), super.destroy();
          }
        };
        let go = { x1: 0, y1: 0, x2: 0, y2: 0 }, _o = { ...go, r1: 0, r2: 0 }, vo = (e2, t2) => isNaN(e2) && typeof t2 == `number` ? t2 : e2;
        function yo(e2) {
          return e2 && /%$/.test(e2) && Number.isFinite(parseFloat(e2));
        }
        function bo(e2, t2) {
          return Vn(0, vo(typeof e2 == `number` ? e2 : typeof e2 == `string` ? parseFloat(e2) / (yo(e2) ? 100 : 1) : NaN, t2), 1);
        }
        let xo = /\s*;\s*/, So = /\s*:\s*/;
        function Co(e2, t2) {
          let n2, r2, i2 = e2.getAttribute(`style`);
          if (i2) {
            let e3 = i2.split(xo);
            e3[e3.length - 1] === `` && e3.pop();
            for (let t3 = e3.length; t3--; ) {
              let [i3, a3] = e3[t3].split(So).map((e4) => e4.trim());
              i3 === `stop-color` ? n2 = a3 : i3 === `stop-opacity` && (r2 = a3);
            }
          }
          n2 = n2 || e2.getAttribute(`stop-color`) || `rgb(0,0,0)`, r2 = vo(parseFloat(r2 || e2.getAttribute(`stop-opacity`) || ``), 1);
          let a2 = new G(n2);
          return a2.setAlpha(a2.getAlpha() * r2 * t2), { offset: bo(e2.getAttribute(`offset`), 0), color: a2.toRgba() };
        }
        function wo(e2, t2) {
          let n2 = [], r2 = e2.getElementsByTagName(`stop`), i2 = bo(t2, 1);
          for (let e3 = r2.length; e3--; ) n2.push(Co(r2[e3], i2));
          return n2;
        }
        function To(e2) {
          return e2.nodeName === `linearGradient` || e2.nodeName === `LINEARGRADIENT` ? `linear` : `radial`;
        }
        function Eo(e2) {
          return e2.getAttribute(`gradientUnits`) === `userSpaceOnUse` ? `pixels` : `percentage`;
        }
        function Do(e2, t2) {
          return e2.getAttribute(t2);
        }
        function Oo(e2, t2) {
          return function(e3, { width: t3, height: n2, gradientUnits: r2 }) {
            let i2;
            return Object.entries(e3).reduce((e4, [a2, o2]) => {
              if (o2 === `Infinity`) i2 = 1;
              else if (o2 === `-Infinity`) i2 = 0;
              else {
                let e5 = typeof o2 == `string`;
                i2 = e5 ? parseFloat(o2) : o2, e5 && yo(o2) && (i2 *= 0.01, r2 === `pixels` && (a2 !== `x1` && a2 !== `x2` && a2 !== `r2` || (i2 *= t3), a2 !== `y1` && a2 !== `y2` || (i2 *= n2)));
              }
              return e4[a2] = i2, e4;
            }, {});
          }(To(e2) === `linear` ? function(e3) {
            return { x1: Do(e3, `x1`) || 0, y1: Do(e3, `y1`) || 0, x2: Do(e3, `x2`) || `100%`, y2: Do(e3, `y2`) || 0 };
          }(e2) : function(e3) {
            return { x1: Do(e3, `fx`) || Do(e3, `cx`) || `50%`, y1: Do(e3, `fy`) || Do(e3, `cy`) || `50%`, r1: 0, x2: Do(e3, `cx`) || `50%`, y2: Do(e3, `cy`) || `50%`, r2: Do(e3, `r`) || `50%` };
          }(e2), { ...t2, gradientUnits: Eo(e2) });
        }
        var ko = class {
          constructor(e2) {
            let { type: t2 = `linear`, gradientUnits: n2 = `pixels`, coords: r2 = {}, colorStops: i2 = [], offsetX: a2 = 0, offsetY: o2 = 0, gradientTransform: s2, id: c2 } = e2 || {};
            Object.assign(this, { type: t2, gradientUnits: n2, coords: { ...t2 === `radial` ? _o : go, ...r2 }, colorStops: i2, offsetX: a2, offsetY: o2, gradientTransform: s2, id: c2 ? `${c2}_${je()}` : je() });
          }
          addColorStop(e2) {
            for (let t2 in e2) this.colorStops.push({ offset: parseFloat(t2), color: e2[t2] });
            return this;
          }
          toObject(e2) {
            return { ...et(this, e2), type: this.type, coords: { ...this.coords }, colorStops: this.colorStops.map((e3) => ({ ...e3 })), offsetX: this.offsetX, offsetY: this.offsetY, gradientUnits: this.gradientUnits, gradientTransform: this.gradientTransform ? [...this.gradientTransform] : void 0 };
          }
          toSVG(e2, { additionalTransform: t2 } = {}) {
            let n2 = [], r2 = this.gradientTransform ? this.gradientTransform.concat() : T.concat(), i2 = this.gradientUnits === `pixels` ? `userSpaceOnUse` : `objectBoundingBox`, a2 = this.colorStops.map((e3) => ({ ...e3 })).sort((e3, t3) => e3.offset - t3.offset), o2 = -this.offsetX, s2 = -this.offsetY;
            var c2;
            i2 === `objectBoundingBox` ? (o2 /= e2.width, s2 /= e2.height) : (o2 += e2.width / 2, s2 += e2.height / 2), (c2 = e2) && typeof c2._renderPathCommands == `function` && this.gradientUnits !== `percentage` && (o2 -= e2.pathOffset.x, s2 -= e2.pathOffset.y), r2[4] -= o2, r2[5] -= s2;
            let l2 = [`id="SVGID_${U(String(this.id))}"`, `gradientUnits="${i2}"`, `gradientTransform="${t2 ? t2 + ` ` : ``}${nt(r2)}"`, ``].join(` `), u2 = (e3) => parseFloat(String(e3));
            if (this.type === `linear`) {
              let { x1: e3, y1: t3, x2: r3, y2: i3 } = this.coords, a3 = u2(e3), o3 = u2(t3), s3 = u2(r3), c3 = u2(i3);
              n2.push(`<linearGradient `, l2, ` x1="`, a3, `" y1="`, o3, `" x2="`, s3, `" y2="`, c3, `">
`);
            } else if (this.type === `radial`) {
              let { x1: e3, y1: t3, x2: r3, y2: i3, r1: o3, r2: s3 } = this.coords, c3 = u2(e3), d2 = u2(t3), f2 = u2(r3), p2 = u2(i3), m2 = u2(o3), h2 = u2(s3), g2 = m2 > h2;
              n2.push(`<radialGradient `, l2, ` cx="`, g2 ? c3 : f2, `" cy="`, g2 ? d2 : p2, `" r="`, g2 ? m2 : h2, `" fx="`, g2 ? f2 : c3, `" fy="`, g2 ? p2 : d2, `">
`), g2 && (a2.reverse(), a2.forEach((e4) => {
                e4.offset = 1 - e4.offset;
              }));
              let _2 = Math.min(m2, h2);
              if (_2 > 0) {
                let e4 = _2 / Math.max(m2, h2);
                a2.forEach((t4) => {
                  t4.offset += e4 * (1 - t4.offset);
                });
              }
            }
            return a2.forEach(({ color: e3, offset: t3 }) => {
              let r3 = String(e3), i3 = nn(r3) ? r3 : new G(r3).toRgba();
              n2.push(`<stop offset="${100 * t3}%" style="stop-color:${U(i3)};"/>
`);
            }), n2.push(this.type === `linear` ? `</linearGradient>` : `</radialGradient>`, `
`), n2.join(``);
          }
          toLive(e2) {
            let { x1: t2, y1: n2, x2: r2, y2: i2, r1: a2, r2: o2 } = this.coords, s2 = this.type === `linear` ? e2.createLinearGradient(t2, n2, r2, i2) : e2.createRadialGradient(t2, n2, a2, r2, i2, o2);
            return this.colorStops.forEach(({ color: e3, offset: t3 }) => {
              s2.addColorStop(t3, e3);
            }), s2;
          }
          static async fromObject(e2) {
            let { colorStops: t2, gradientTransform: n2 } = e2;
            return new this({ ...e2, colorStops: t2 ? t2.map((e3) => ({ ...e3 })) : void 0, gradientTransform: n2 ? [...n2] : void 0 });
          }
          static fromElement(e2, t2, n2) {
            let r2 = Eo(e2), i2 = t2._findCenterFromElement();
            return new this({ id: e2.getAttribute(`id`) || void 0, type: To(e2), coords: Oo(e2, { width: n2.viewBoxWidth || n2.width, height: n2.viewBoxHeight || n2.height }), colorStops: wo(e2, n2.opacity), gradientUnits: r2, gradientTransform: Ki(e2.getAttribute(`gradientTransform`) || ``), ...r2 === `pixels` ? { offsetX: t2.width / 2 - i2.x, offsetY: t2.height / 2 - i2.y } : { offsetX: 0, offsetY: 0 } });
          }
        };
        a(ko, `type`, `Gradient`), M.setClass(ko, `gradient`), M.setClass(ko, `linear`), M.setClass(ko, `radial`);
        var Ao = class {
          get type() {
            return `pattern`;
          }
          set type(e2) {
            c(`warn`, `Setting type has no effect`, e2);
          }
          constructor(e2) {
            a(this, `repeat`, `repeat`), a(this, `offsetX`, 0), a(this, `offsetY`, 0), a(this, `crossOrigin`, ``), this.id = je(), Object.assign(this, e2);
          }
          isImageSource() {
            return !!this.source && typeof this.source.src == `string`;
          }
          isCanvasSource() {
            return !!this.source && !!this.source.toDataURL;
          }
          sourceToString() {
            return this.isImageSource() ? this.source.src : this.isCanvasSource() ? this.source.toDataURL() : ``;
          }
          toLive(e2) {
            return this.source && (!this.isImageSource() || this.source.complete && this.source.naturalWidth !== 0 && this.source.naturalHeight !== 0) ? e2.createPattern(this.source, this.repeat) : null;
          }
          toObject(e2 = []) {
            let { repeat: t2, crossOrigin: n2 } = this;
            return { ...et(this, e2), type: `pattern`, source: this.sourceToString(), repeat: t2, crossOrigin: n2, offsetX: B(this.offsetX, s.NUM_FRACTION_DIGITS), offsetY: B(this.offsetY, s.NUM_FRACTION_DIGITS), patternTransform: this.patternTransform ? [...this.patternTransform] : null };
          }
          toSVG({ width: e2, height: t2 }) {
            let { source: n2, repeat: r2, id: i2 } = this, a2 = vo(this.offsetX / e2, 0), o2 = vo(this.offsetY / t2, 0), s2 = r2 === `repeat-y` || r2 === `no-repeat` ? 1 + Math.abs(a2 || 0) : vo(n2.width / e2, 0), c2 = r2 === `repeat-x` || r2 === `no-repeat` ? 1 + Math.abs(o2 || 0) : vo(n2.height / t2, 0);
            return [`<pattern id="SVGID_${U(i2)}" x="${a2}" y="${o2}" width="${s2}" height="${c2}">`, `<image x="0" y="0" width="${n2.width}" height="${n2.height}" xlink:href="${U(this.sourceToString())}"></image>`, `</pattern>`, ``].join(`
`);
          }
          static async fromObject({ type: e2, source: t2, patternTransform: n2, ...r2 }, i2) {
            let a2 = await Ze(t2, { ...i2, crossOrigin: r2.crossOrigin });
            return new this({ ...r2, patternTransform: n2 && n2.slice(0), source: a2 });
          }
        };
        a(Ao, `type`, `Pattern`), M.setClass(Ao), M.setClass(Ao, `pattern`);
        var jo = class {
          constructor(e2) {
            a(this, `color`, `rgb(0, 0, 0)`), a(this, `width`, 1), a(this, `shadow`, null), a(this, `strokeLineCap`, `round`), a(this, `strokeLineJoin`, `round`), a(this, `strokeMiterLimit`, 10), a(this, `strokeDashArray`, null), a(this, `limitedToCanvasSize`, false), this.canvas = e2;
          }
          _setBrushStyles(e2) {
            e2.strokeStyle = this.color, e2.lineWidth = this.width, e2.lineCap = this.strokeLineCap, e2.miterLimit = this.strokeMiterLimit, e2.lineJoin = this.strokeLineJoin, e2.setLineDash(this.strokeDashArray || []);
          }
          _saveAndTransform(e2) {
            let t2 = this.canvas.viewportTransform;
            e2.save(), e2.transform(t2[0], t2[1], t2[2], t2[3], t2[4], t2[5]);
          }
          needsFullRender() {
            return new G(this.color).getAlpha() < 1 || !!this.shadow;
          }
          _setShadow() {
            if (!this.shadow || !this.canvas) return;
            let e2 = this.canvas, t2 = this.shadow, n2 = e2.contextTop, r2 = e2.getZoom() * e2.getRetinaScaling();
            n2.shadowColor = t2.color, n2.shadowBlur = t2.blur * r2, n2.shadowOffsetX = t2.offsetX * r2, n2.shadowOffsetY = t2.offsetY * r2;
          }
          _resetShadow() {
            let e2 = this.canvas.contextTop;
            e2.shadowColor = ``, e2.shadowBlur = e2.shadowOffsetX = e2.shadowOffsetY = 0;
          }
          _isOutSideCanvas(e2) {
            return e2.x < 0 || e2.x > this.canvas.getWidth() || e2.y < 0 || e2.y > this.canvas.getHeight();
          }
        }, Mo = class e2 extends J {
          constructor(t2, { path: n2, left: r2, top: i2, ...a2 } = {}) {
            super(), Object.assign(this, e2.ownDefaults), this.setOptions(a2), this._setPath(t2 || [], true), typeof r2 == `number` && this.set(`left`, r2), typeof i2 == `number` && this.set(`top`, i2);
          }
          _setPath(e3, t2) {
            this.path = ba(Array.isArray(e3) ? e3 : La(e3)), this.setBoundingBox(t2);
          }
          _findCenterFromElement() {
            let e3 = this._calcBoundsFromPath();
            return new N(e3.left + e3.width / 2, e3.top + e3.height / 2);
          }
          _renderPathCommands(e3) {
            let t2 = -this.pathOffset.x, n2 = -this.pathOffset.y;
            e3.beginPath();
            for (let r2 of this.path) switch (r2[0]) {
              case `L`:
                e3.lineTo(r2[1] + t2, r2[2] + n2);
                break;
              case `M`:
                e3.moveTo(r2[1] + t2, r2[2] + n2);
                break;
              case `C`:
                e3.bezierCurveTo(r2[1] + t2, r2[2] + n2, r2[3] + t2, r2[4] + n2, r2[5] + t2, r2[6] + n2);
                break;
              case `Q`:
                e3.quadraticCurveTo(r2[1] + t2, r2[2] + n2, r2[3] + t2, r2[4] + n2);
                break;
              case `Z`:
                e3.closePath();
            }
          }
          _render(e3) {
            this._renderPathCommands(e3), this._renderPaintInOrder(e3);
          }
          toString() {
            return `#<Path (${this.complexity()}): { "top": ${this.top}, "left": ${this.left} }>`;
          }
          toObject(e3 = []) {
            return { ...super.toObject(e3), path: this.path.map((e4) => e4.slice()) };
          }
          toDatalessObject(e3 = []) {
            let t2 = this.toObject(e3);
            return this.sourcePath && (delete t2.path, t2.sourcePath = this.sourcePath), t2;
          }
          _toSVG() {
            return [`<path `, `COMMON_PARTS`, `d="${Va(this.path, s.NUM_FRACTION_DIGITS)}" stroke-linecap="round" />
`];
          }
          _getOffsetTransform() {
            let e3 = s.NUM_FRACTION_DIGITS;
            return ` translate(${B(-this.pathOffset.x, e3)}, ${B(-this.pathOffset.y, e3)})`;
          }
          toClipPathSVG(e3) {
            let t2 = this._getOffsetTransform();
            return `	` + this._createBaseClipPathSVGMarkup(this._toSVG(), { reviver: e3, additionalTransform: t2 });
          }
          toSVG(e3) {
            let t2 = this._getOffsetTransform();
            return this._createBaseSVGMarkup(this._toSVG(), { reviver: e3, additionalTransform: t2 });
          }
          complexity() {
            return this.path.length;
          }
          setDimensions() {
            this.setBoundingBox();
          }
          setBoundingBox(e3) {
            let { width: t2, height: n2, pathOffset: r2 } = this._calcDimensions();
            this.set({ width: t2, height: n2, pathOffset: r2 }), e3 && this.setPositionByOrigin(r2, `center`, `center`);
          }
          _calcBoundsFromPath() {
            let e3 = [], t2 = 0, n2 = 0, r2 = 0, i2 = 0;
            for (let a2 of this.path) switch (a2[0]) {
              case `L`:
                r2 = a2[1], i2 = a2[2], e3.push({ x: t2, y: n2 }, { x: r2, y: i2 });
                break;
              case `M`:
                r2 = a2[1], i2 = a2[2], t2 = r2, n2 = i2;
                break;
              case `C`:
                e3.push(...va(r2, i2, a2[1], a2[2], a2[3], a2[4], a2[5], a2[6])), r2 = a2[5], i2 = a2[6];
                break;
              case `Q`:
                e3.push(...va(r2, i2, a2[1], a2[2], a2[1], a2[2], a2[3], a2[4])), r2 = a2[3], i2 = a2[4];
                break;
              case `Z`:
                r2 = t2, i2 = n2;
            }
            return wt(e3);
          }
          _calcDimensions() {
            let e3 = this._calcBoundsFromPath();
            return { ...e3, pathOffset: new N(e3.left + e3.width / 2, e3.top + e3.height / 2) };
          }
          static fromObject(e3) {
            return this._fromObject(e3, { extraParam: `path` });
          }
          static async fromElement(e3, t2, n2) {
            let { d: r2, ...i2 } = Zi(e3, this.ATTRIBUTE_NAMES, n2);
            return new this(r2, { ...i2, ...t2, left: void 0, top: void 0 });
          }
        };
        a(Mo, `type`, `Path`), a(Mo, `cacheProperties`, [...Un, `path`, `fillRule`]), a(Mo, `ATTRIBUTE_NAMES`, [...ki, `d`]), M.setClass(Mo), M.setSVGClass(Mo);
        var No = class e2 extends jo {
          constructor(e3) {
            super(e3), a(this, `decimate`, 0.4), a(this, `drawStraightLine`, false), a(this, `straightLineKey`, `shiftKey`), this._points = [], this._hasStraightLine = false;
          }
          needsFullRender() {
            return super.needsFullRender() || this._hasStraightLine;
          }
          static drawSegment(e3, t2, n2) {
            let r2 = t2.midPointFrom(n2);
            return e3.quadraticCurveTo(t2.x, t2.y, r2.x, r2.y), r2;
          }
          onMouseDown(e3, { e: t2 }) {
            this.canvas._isMainEvent(t2) && (this.drawStraightLine = !!this.straightLineKey && t2[this.straightLineKey], this._prepareForDrawing(e3), this._addPoint(e3), this._render());
          }
          onMouseMove(t2, { e: n2 }) {
            if (this.canvas._isMainEvent(n2) && (this.drawStraightLine = !!this.straightLineKey && n2[this.straightLineKey], (true !== this.limitedToCanvasSize || !this._isOutSideCanvas(t2)) && this._addPoint(t2) && this._points.length > 1)) if (this.needsFullRender()) this.canvas.clearContext(this.canvas.contextTop), this._render();
            else {
              let t3 = this._points, n3 = t3.length, r2 = this.canvas.contextTop;
              this._saveAndTransform(r2), this.oldEnd && (r2.beginPath(), r2.moveTo(this.oldEnd.x, this.oldEnd.y)), this.oldEnd = e2.drawSegment(r2, t3[n3 - 2], t3[n3 - 1]), r2.stroke(), r2.restore();
            }
          }
          onMouseUp({ e: e3 }) {
            return !this.canvas._isMainEvent(e3) || (this.drawStraightLine = false, this.oldEnd = void 0, this._finalizeAndAddPath(), false);
          }
          _prepareForDrawing(e3) {
            this._reset(), this._addPoint(e3), this.canvas.contextTop.moveTo(e3.x, e3.y);
          }
          _addPoint(e3) {
            return !(this._points.length > 1 && e3.eq(this._points[this._points.length - 1])) && (this.drawStraightLine && this._points.length > 1 && (this._hasStraightLine = true, this._points.pop()), this._points.push(e3), true);
          }
          _reset() {
            this._points = [], this._setBrushStyles(this.canvas.contextTop), this._setShadow(), this._hasStraightLine = false;
          }
          _render(t2 = this.canvas.contextTop) {
            let n2 = this._points[0], r2 = this._points[1];
            if (this._saveAndTransform(t2), t2.beginPath(), this._points.length === 2 && n2.x === r2.x && n2.y === r2.y) {
              let e3 = this.width / 1e3;
              n2.x -= e3, r2.x += e3;
            }
            t2.moveTo(n2.x, n2.y);
            for (let i2 = 1; i2 < this._points.length; i2++) e2.drawSegment(t2, n2, r2), n2 = this._points[i2], r2 = this._points[i2 + 1];
            t2.lineTo(n2.x, n2.y), t2.stroke(), t2.restore();
          }
          convertPointsToSVGPath(e3) {
            return Ra(e3, this.width / 1e3);
          }
          createPath(e3) {
            let t2 = new Mo(e3, { fill: null, stroke: this.color, strokeWidth: this.width, strokeLineCap: this.strokeLineCap, strokeMiterLimit: this.strokeMiterLimit, strokeLineJoin: this.strokeLineJoin, strokeDashArray: this.strokeDashArray });
            return this.shadow && (this.shadow.affectStroke = true, t2.shadow = new Bn(this.shadow)), t2;
          }
          decimatePoints(e3, t2) {
            if (e3.length <= 2) return e3;
            let n2, r2 = e3[0], i2 = (t2 / this.canvas.getZoom()) ** 2, a2 = e3.length - 1, o2 = [r2];
            for (let t3 = 1; t3 < a2 - 1; t3++) n2 = (r2.x - e3[t3].x) ** 2 + (r2.y - e3[t3].y) ** 2, n2 >= i2 && (r2 = e3[t3], o2.push(r2));
            return o2.push(e3[a2]), o2;
          }
          _finalizeAndAddPath() {
            this.canvas.contextTop.closePath(), this.decimate && (this._points = this.decimatePoints(this._points, this.decimate));
            let e3 = this.convertPointsToSVGPath(this._points);
            if (function(e4) {
              return Va(e4) === `M 0 0 Q 0 0 0 0 L 0 0`;
            }(e3)) return void this.canvas.requestRenderAll();
            let t2 = this.createPath(e3);
            this.canvas.clearContext(this.canvas.contextTop), this.canvas.fire(`before:path:created`, { path: t2 }), this.canvas.add(t2), this.canvas.requestRenderAll(), t2.setCoords(), this._resetShadow(), this.canvas.fire(`path:created`, { path: t2 });
          }
        };
        let Po = [`radius`, `startAngle`, `endAngle`, `counterClockwise`];
        var Fo = class e2 extends J {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2) {
            super(), Object.assign(this, e2.ownDefaults), this.setOptions(t2);
          }
          _set(e3, t2) {
            return super._set(e3, t2), e3 === `radius` && this.setRadius(t2), this;
          }
          _render(e3) {
            e3.beginPath(), e3.arc(0, 0, this.radius, I(this.startAngle), I(this.endAngle), this.counterClockwise), this._renderPaintInOrder(e3);
          }
          getRadiusX() {
            return this.get(`radius`) * this.get(de);
          }
          getRadiusY() {
            return this.get(`radius`) * this.get(fe);
          }
          setRadius(e3) {
            this.radius = e3, this.set({ width: 2 * e3, height: 2 * e3 });
          }
          toObject(e3 = []) {
            return super.toObject([...Po, ...e3]);
          }
          _toSVG() {
            let { radius: e3, startAngle: t2, endAngle: n2 } = this, r2 = (n2 - t2) % 360;
            if (r2 === 0) return [`<circle `, `COMMON_PARTS`, `cx="0" cy="0" `, `r="`, `${U(e3)}`, `" />
`];
            {
              let i2 = I(t2), a2 = I(n2), o2 = Se(i2) * e3, s2 = Ce(i2) * e3, c2 = Se(a2) * e3, l2 = Ce(a2) * e3;
              return [`<path d="M ${o2} ${s2} A ${e3} ${e3} 0 ${+(r2 > 180)} ${+!this.counterClockwise} ${c2} ${l2}" `, `COMMON_PARTS`, ` />
`];
            }
          }
          static async fromElement(e3, t2, n2) {
            let { left: r2 = 0, top: i2 = 0, radius: a2 = 0, ...o2 } = Zi(e3, this.ATTRIBUTE_NAMES, n2);
            return new this({ ...o2, radius: a2, left: r2 - a2, top: i2 - a2 });
          }
          static fromObject(e3) {
            return super._fromObject(e3);
          }
        };
        a(Fo, `type`, `Circle`), a(Fo, `cacheProperties`, [...Un, ...Po]), a(Fo, `ownDefaults`, { radius: 0, startAngle: 0, endAngle: 360, counterClockwise: false }), a(Fo, `ATTRIBUTE_NAMES`, [`cx`, `cy`, `r`, ...ki]), M.setClass(Fo), M.setSVGClass(Fo);
        let Io = [`x1`, `x2`, `y1`, `y2`];
        var Lo = class e2 extends J {
          constructor([t2, n2, r2, i2] = [0, 0, 0, 0], a2 = {}) {
            super(), Object.assign(this, e2.ownDefaults), this.setOptions(a2), this.x1 = t2, this.x2 = r2, this.y1 = n2, this.y2 = i2, this._setWidthHeight();
            let { left: o2, top: s2 } = a2;
            typeof o2 == `number` && this.set(`left`, o2), typeof s2 == `number` && this.set(`top`, s2);
          }
          _setWidthHeight() {
            let { x1: e3, y1: t2, x2: n2, y2: r2 } = this;
            this.width = Math.abs(n2 - e3), this.height = Math.abs(r2 - t2);
            let { left: i2, top: a2, width: o2, height: s2 } = wt([{ x: e3, y: t2 }, { x: n2, y: r2 }]), c2 = new N(i2 + o2 / 2, a2 + s2 / 2);
            this.setPositionByOrigin(c2, E, E);
          }
          _set(e3, t2) {
            return super._set(e3, t2), Io.includes(e3) && this._setWidthHeight(), this;
          }
          _render(e3) {
            e3.beginPath();
            let t2 = this.calcLinePoints();
            e3.moveTo(t2.x1, t2.y1), e3.lineTo(t2.x2, t2.y2), e3.lineWidth = this.strokeWidth;
            let n2 = e3.strokeStyle;
            var r2;
            V(this.stroke) ? e3.strokeStyle = this.stroke.toLive(e3) : e3.strokeStyle = (r2 = this.stroke) == null ? e3.fillStyle : r2, this.stroke && this._renderStroke(e3), e3.strokeStyle = n2;
          }
          _findCenterFromElement() {
            return new N((this.x1 + this.x2) / 2, (this.y1 + this.y2) / 2);
          }
          toObject(e3 = []) {
            return { ...super.toObject(e3), ...this.calcLinePoints() };
          }
          _getNonTransformedDimensions() {
            let e3 = super._getNonTransformedDimensions();
            return this.strokeLineCap === `butt` && (this.width === 0 && (e3.y -= this.strokeWidth), this.height === 0 && (e3.x -= this.strokeWidth)), e3;
          }
          calcLinePoints() {
            let { x1: e3, x2: t2, y1: n2, y2: r2, width: i2, height: a2 } = this, o2 = e3 <= t2 ? -0.5 : 0.5, s2 = n2 <= r2 ? -0.5 : 0.5;
            return { x1: o2 * i2, x2: o2 * -i2, y1: s2 * a2, y2: s2 * -a2 };
          }
          _toSVG() {
            let { x1: e3, x2: t2, y1: n2, y2: r2 } = this.calcLinePoints();
            return [`<line `, `COMMON_PARTS`, `x1="${e3}" y1="${n2}" x2="${t2}" y2="${r2}" />
`];
          }
          static async fromElement(e3, t2, n2) {
            let { x1: r2 = 0, y1: i2 = 0, x2: a2 = 0, y2: o2 = 0, ...s2 } = Zi(e3, this.ATTRIBUTE_NAMES, n2);
            return new this([r2, i2, a2, o2], s2);
          }
          static fromObject({ x1: e3, y1: t2, x2: n2, y2: r2, ...i2 }) {
            return this._fromObject({ ...i2, points: [e3, t2, n2, r2] }, { extraParam: `points` });
          }
        };
        a(Lo, `type`, `Line`), a(Lo, `cacheProperties`, [...Un, ...Io]), a(Lo, `ATTRIBUTE_NAMES`, ki.concat(Io)), M.setClass(Lo), M.setSVGClass(Lo);
        var Ro = class e2 extends J {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2) {
            super(), Object.assign(this, e2.ownDefaults), this.setOptions(t2);
          }
          _render(e3) {
            let t2 = this.width / 2, n2 = this.height / 2;
            e3.beginPath(), e3.moveTo(-t2, n2), e3.lineTo(0, -n2), e3.lineTo(t2, n2), e3.closePath(), this._renderPaintInOrder(e3);
          }
          _toSVG() {
            let e3 = this.width / 2, t2 = this.height / 2;
            return [`<polygon `, `COMMON_PARTS`, `points="`, `${-e3} ${t2},0 ${-t2},${e3} ${t2}`, `" />`];
          }
        };
        a(Ro, `type`, `Triangle`), a(Ro, `ownDefaults`, { width: 100, height: 100 }), M.setClass(Ro), M.setSVGClass(Ro);
        let zo = [`rx`, `ry`];
        var Bo = class e2 extends J {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2) {
            super(), Object.assign(this, e2.ownDefaults), this.setOptions(t2);
          }
          _set(e3, t2) {
            switch (super._set(e3, t2), e3) {
              case `rx`:
                this.rx = t2, this.set(`width`, 2 * t2);
                break;
              case `ry`:
                this.ry = t2, this.set(`height`, 2 * t2);
            }
            return this;
          }
          getRx() {
            return this.get(`rx`) * this.get(de);
          }
          getRy() {
            return this.get(`ry`) * this.get(fe);
          }
          toObject(e3 = []) {
            return super.toObject([...zo, ...e3]);
          }
          _toSVG() {
            return [`<ellipse `, `COMMON_PARTS`, `cx="0" cy="0" rx="${U(this.rx)}" ry="${U(this.ry)}" />
`];
          }
          _render(e3) {
            e3.beginPath(), e3.save(), e3.transform(1, 0, 0, this.ry / this.rx, 0, 0), e3.arc(0, 0, this.rx, 0, w, false), e3.restore(), this._renderPaintInOrder(e3);
          }
          static async fromElement(e3, t2, n2) {
            let r2 = Zi(e3, this.ATTRIBUTE_NAMES, n2);
            return r2.left = (r2.left || 0) - r2.rx, r2.top = (r2.top || 0) - r2.ry, new this(r2);
          }
        };
        a(Bo, `type`, `Ellipse`), a(Bo, `cacheProperties`, [...Un, ...zo]), a(Bo, `ownDefaults`, { rx: 0, ry: 0 }), a(Bo, `ATTRIBUTE_NAMES`, [...ki, `cx`, `cy`, `rx`, `ry`]), M.setClass(Bo), M.setSVGClass(Bo);
        let Vo = { exactBoundingBox: false };
        var Ho = class e2 extends J {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2 = [], n2 = {}) {
            super(), a(this, `strokeDiff`, void 0), Object.assign(this, e2.ownDefaults), this.setOptions(n2), this.points = t2;
            let { left: r2, top: i2 } = n2;
            this.initialized = true, this.setBoundingBox(true), typeof r2 == `number` && this.set(`left`, r2), typeof i2 == `number` && this.set(`top`, i2);
          }
          isOpen() {
            return true;
          }
          _projectStrokeOnPoints(e3) {
            return wi(this.points, e3, this.isOpen());
          }
          _calcDimensions(e3) {
            e3 = { scaleX: this.scaleX, scaleY: this.scaleY, skewX: this.skewX, skewY: this.skewY, strokeLineCap: this.strokeLineCap, strokeLineJoin: this.strokeLineJoin, strokeMiterLimit: this.strokeMiterLimit, strokeUniform: this.strokeUniform, strokeWidth: this.strokeWidth, ...e3 || {} };
            let t2 = this.exactBoundingBox ? this._projectStrokeOnPoints(e3).map((e4) => e4.projectedPoint) : this.points;
            if (t2.length === 0) return { left: 0, top: 0, width: 0, height: 0, pathOffset: new N(), strokeOffset: new N(), strokeDiff: new N() };
            let n2 = wt(t2), r2 = Ye({ ...e3, scaleX: 1, scaleY: 1 }), i2 = wt(this.points.map((e4) => L(e4, r2, true))), a2 = new N(this.scaleX, this.scaleY), o2 = n2.left + n2.width / 2, s2 = n2.top + n2.height / 2;
            return this.exactBoundingBox && (o2 -= s2 * Math.tan(I(this.skewX)), s2 -= o2 * Math.tan(I(this.skewY))), { ...n2, pathOffset: new N(o2, s2), strokeOffset: new N(i2.left, i2.top).subtract(new N(n2.left, n2.top)).multiply(a2), strokeDiff: new N(n2.width, n2.height).subtract(new N(i2.width, i2.height)).multiply(a2) };
          }
          _findCenterFromElement() {
            let e3 = wt(this.points);
            return new N(e3.left + e3.width / 2, e3.top + e3.height / 2);
          }
          setDimensions() {
            this.setBoundingBox();
          }
          setBoundingBox(e3) {
            let { left: t2, top: n2, width: r2, height: i2, pathOffset: a2, strokeOffset: o2, strokeDiff: s2 } = this._calcDimensions();
            this.set({ width: r2, height: i2, pathOffset: a2, strokeOffset: o2, strokeDiff: s2 }), e3 && this.setPositionByOrigin(new N(t2 + r2 / 2, n2 + i2 / 2), `center`, `center`);
          }
          isStrokeAccountedForInDimensions() {
            return this.exactBoundingBox;
          }
          _getNonTransformedDimensions() {
            return this.exactBoundingBox ? new N(this.width, this.height) : super._getNonTransformedDimensions();
          }
          _getTransformedDimensions(e3 = {}) {
            if (this.exactBoundingBox) {
              let a2;
              if (Object.keys(e3).some((e4) => this.strokeUniform || this.constructor.layoutProperties.includes(e4))) {
                var t2, n2;
                let { width: r3, height: i3 } = this._calcDimensions(e3);
                a2 = new N((t2 = e3.width) == null ? r3 : t2, (n2 = e3.height) == null ? i3 : n2);
              } else {
                var r2, i2;
                a2 = new N((r2 = e3.width) == null ? this.width : r2, (i2 = e3.height) == null ? this.height : i2);
              }
              return a2.multiply(new N(e3.scaleX || this.scaleX, e3.scaleY || this.scaleY));
            }
            return super._getTransformedDimensions(e3);
          }
          _set(e3, t2) {
            let n2 = this.initialized && this[e3] !== t2, r2 = super._set(e3, t2);
            return this.exactBoundingBox && n2 && ((e3 === `scaleX` || e3 === `scaleY`) && this.strokeUniform && this.constructor.layoutProperties.includes(`strokeUniform`) || this.constructor.layoutProperties.includes(e3)) && this.setDimensions(), r2;
          }
          toObject(e3 = []) {
            return { ...super.toObject(e3), points: this.points.map(({ x: e4, y: t2 }) => ({ x: e4, y: t2 })) };
          }
          _toSVG() {
            let e3 = this.pathOffset.x, t2 = this.pathOffset.y, n2 = s.NUM_FRACTION_DIGITS, r2 = this.points.map(({ x: r3, y: i2 }) => `${B(r3 - e3, n2)},${B(i2 - t2, n2)}`).join(` `);
            return [`<${U(this.constructor.type).toLowerCase()} `, `COMMON_PARTS`, `points="${r2}" />
`];
          }
          _render(e3) {
            let t2 = this.points.length, n2 = this.pathOffset.x, r2 = this.pathOffset.y;
            if (t2 && !isNaN(this.points[t2 - 1].y)) {
              e3.beginPath(), e3.moveTo(this.points[0].x - n2, this.points[0].y - r2);
              for (let i2 = 0; i2 < t2; i2++) {
                let t3 = this.points[i2];
                e3.lineTo(t3.x - n2, t3.y - r2);
              }
              !this.isOpen() && e3.closePath(), this._renderPaintInOrder(e3);
            }
          }
          complexity() {
            return this.points.length;
          }
          static async fromElement(e3, t2, n2) {
            let r2 = function(e4) {
              if (!e4) return [];
              let t3 = e4.replace(/,/g, ` `).trim().split(/\s+/), n3 = [];
              for (let e5 = 0; e5 < t3.length; e5 += 2) n3.push({ x: parseFloat(t3[e5]), y: parseFloat(t3[e5 + 1]) });
              return n3;
            }(e3.getAttribute(`points`)), { left: i2, top: a2, ...o2 } = Zi(e3, this.ATTRIBUTE_NAMES, n2);
            return new this(r2, { ...o2, ...t2 });
          }
          static fromObject(e3) {
            return this._fromObject(e3, { extraParam: `points` });
          }
        };
        a(Ho, `ownDefaults`, Vo), a(Ho, `type`, `Polyline`), a(Ho, `layoutProperties`, [pe, me, `strokeLineCap`, `strokeLineJoin`, `strokeMiterLimit`, `strokeWidth`, `strokeUniform`, `points`]), a(Ho, `cacheProperties`, [...Un, `points`]), a(Ho, `ATTRIBUTE_NAMES`, [...ki]), M.setClass(Ho), M.setSVGClass(Ho);
        var Uo = class extends Ho {
          isOpen() {
            return false;
          }
        };
        a(Uo, `ownDefaults`, Vo), a(Uo, `type`, `Polygon`), M.setClass(Uo), M.setSVGClass(Uo);
        var Wo = class extends J {
          isEmptyStyles(e2) {
            if (!this.styles || e2 !== void 0 && !this.styles[e2]) return true;
            let t2 = e2 === void 0 ? this.styles : { line: this.styles[e2] };
            for (let e3 in t2) for (let n2 in t2[e3]) for (let r2 in t2[e3][n2]) return false;
            return true;
          }
          styleHas(e2, t2) {
            if (!this.styles || t2 !== void 0 && !this.styles[t2]) return false;
            let n2 = t2 === void 0 ? this.styles : { 0: this.styles[t2] };
            for (let t3 in n2) for (let r2 in n2[t3]) if (n2[t3][r2][e2] !== void 0) return true;
            return false;
          }
          cleanStyle(e2) {
            if (!this.styles) return false;
            let t2 = this.styles, n2, r2, i2 = 0, a2 = true, o2 = 0;
            for (let o3 in t2) {
              n2 = 0;
              for (let s2 in t2[o3]) {
                let c2 = t2[o3][s2] || {};
                i2++, c2[e2] === void 0 ? a2 = false : (r2 ? c2[e2] !== r2 && (a2 = false) : r2 = c2[e2], c2[e2] === this[e2] && delete c2[e2]), Object.keys(c2).length === 0 ? delete t2[o3][s2] : n2++;
              }
              n2 === 0 && delete t2[o3];
            }
            for (let e3 = 0; e3 < this._textLines.length; e3++) o2 += this._textLines[e3].length;
            a2 && i2 === o2 && (this[e2] = r2, this.removeStyle(e2));
          }
          removeStyle(e2) {
            if (!this.styles) return;
            let t2 = this.styles, n2, r2, i2;
            for (r2 in t2) {
              for (i2 in n2 = t2[r2], n2) delete n2[i2][e2], Object.keys(n2[i2]).length === 0 && delete n2[i2];
              Object.keys(n2).length === 0 && delete t2[r2];
            }
          }
          _extendStyles(e2, t2) {
            let { lineIndex: n2, charIndex: r2 } = this.get2DCursorLocation(e2);
            this._getLineStyle(n2) || this._setLineStyle(n2);
            let i2 = tt({ ...this._getStyleDeclaration(n2, r2), ...t2 }, (e3) => e3 !== void 0);
            this._setStyleDeclaration(n2, r2, i2);
          }
          getSelectionStyles(e2, t2, n2) {
            let r2 = [];
            for (let i2 = e2; i2 < (t2 || e2); i2++) r2.push(this.getStyleAtPosition(i2, n2));
            return r2;
          }
          getStyleAtPosition(e2, t2) {
            let { lineIndex: n2, charIndex: r2 } = this.get2DCursorLocation(e2);
            return t2 ? this.getCompleteStyleDeclaration(n2, r2) : this._getStyleDeclaration(n2, r2);
          }
          setSelectionStyles(e2, t2, n2) {
            for (let r2 = t2; r2 < (n2 || t2); r2++) this._extendStyles(r2, e2);
            this._forceClearCache = true;
          }
          _getStyleDeclaration(e2, t2) {
            var n2;
            let r2 = this.styles && this.styles[e2];
            return r2 && (n2 = r2[t2]) != null ? n2 : {};
          }
          getCompleteStyleDeclaration(e2, t2) {
            return { ...et(this, this.constructor._styleProperties), ...this._getStyleDeclaration(e2, t2) };
          }
          _setStyleDeclaration(e2, t2, n2) {
            this.styles[e2][t2] = n2;
          }
          _deleteStyleDeclaration(e2, t2) {
            delete this.styles[e2][t2];
          }
          _getLineStyle(e2) {
            return !!this.styles[e2];
          }
          _setLineStyle(e2) {
            this.styles[e2] = {};
          }
          _deleteLineStyle(e2) {
            delete this.styles[e2];
          }
        };
        a(Wo, `_styleProperties`, wn);
        let Go = /  +/g, Ko = /"/g;
        function qo(e2, t2, n2, r2, i2) {
          return `		${((e3, { left: t3, top: n3, width: r3, height: i3 }, a2 = s.NUM_FRACTION_DIGITS) => {
            let o2 = hn(j, e3, false), [c2, l2, u2, d2] = [t3, n3, r3, i3].map((e4) => B(e4, a2));
            return `<rect ${o2} x="${c2}" y="${l2}" width="${u2}" height="${d2}"></rect>`;
          })(e2, { left: t2, top: n2, width: r2, height: i2 })}
`;
        }
        let Jo;
        var Q = class e2 extends Wo {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2, n2) {
            super(), a(this, `__charBounds`, []), Object.assign(this, e2.ownDefaults), this.setOptions(n2), this.styles || (this.styles = {}), this.text = t2, this.initialized = true, this.path && this.setPathInfo(), this.initDimensions(), this.setCoords();
          }
          setPathInfo() {
            let e3 = this.path;
            e3 && (e3.segmentsInfo = ja(e3.path));
          }
          _splitText() {
            let e3 = this._splitTextIntoLines(this.text);
            return this.textLines = e3.lines, this._textLines = e3.graphemeLines, this._unwrappedTextLines = e3._unwrappedLines, this._text = e3.graphemeText, e3;
          }
          initDimensions() {
            this._splitText(), this._clearCache(), this.dirty = true, this.path ? (this.width = this.path.width, this.height = this.path.height) : (this.width = this.calcTextWidth() || this.cursorWidth || this.MIN_TEXT_WIDTH, this.height = this.calcTextHeight()), this.textAlign.includes(`justify`) && this.enlargeSpaces();
          }
          enlargeSpaces() {
            let e3, t2, n2, r2, i2, a2, o2;
            for (let s2 = 0, c2 = this._textLines.length; s2 < c2; s2++) if ((this.textAlign === `justify` || s2 !== c2 - 1 && !this.isEndOfWrapping(s2)) && (r2 = 0, i2 = this._textLines[s2], t2 = this.getLineWidth(s2), t2 < this.width && (o2 = this.textLines[s2].match(this._reSpacesAndTabs)))) {
              n2 = o2.length, e3 = (this.width - t2) / n2;
              for (let t3 = 0; t3 <= i2.length; t3++) a2 = this.__charBounds[s2][t3], this._reSpaceAndTab.test(i2[t3]) ? (a2.width += e3, a2.kernedWidth += e3, a2.left += r2, r2 += e3) : a2.left += r2;
            }
          }
          isEndOfWrapping(e3) {
            return e3 === this._textLines.length - 1;
          }
          missingNewlineOffset(e3) {
            return 1;
          }
          get2DCursorLocation(e3, t2) {
            let n2 = t2 ? this._unwrappedTextLines : this._textLines, r2;
            for (r2 = 0; r2 < n2.length; r2++) {
              if (e3 <= n2[r2].length) return { lineIndex: r2, charIndex: e3 };
              e3 -= n2[r2].length + this.missingNewlineOffset(r2, t2);
            }
            return { lineIndex: r2 - 1, charIndex: n2[r2 - 1].length < e3 ? n2[r2 - 1].length : e3 };
          }
          toString() {
            return `#<Text (${this.complexity()}): { "text": "${this.text}", "fontFamily": "${this.fontFamily}" }>`;
          }
          _getCacheCanvasDimensions() {
            let e3 = super._getCacheCanvasDimensions(), t2 = this.fontSize;
            return e3.width += t2 * e3.zoomX, e3.height += t2 * e3.zoomY, e3;
          }
          _render(e3) {
            let t2 = this.path;
            t2 && !t2.isNotVisible() && t2._render(e3), this._setTextStyles(e3), this._renderTextLinesBackground(e3), this._renderTextDecoration(e3, `underline`), this._renderText(e3), this._renderTextDecoration(e3, `overline`), this._renderTextDecoration(e3, `linethrough`);
          }
          _renderText(e3) {
            this.paintFirst === `stroke` ? (this._renderTextStroke(e3), this._renderTextFill(e3)) : (this._renderTextFill(e3), this._renderTextStroke(e3));
          }
          _setTextStyles(e3, t2, n2) {
            if (e3.textBaseline = `alphabetic`, this.path) switch (this.pathAlign) {
              case E:
                e3.textBaseline = `middle`;
                break;
              case `ascender`:
                e3.textBaseline = `top`;
                break;
              case `descender`:
                e3.textBaseline = O;
            }
            e3.font = this._getFontDeclaration(t2, n2);
          }
          calcTextWidth() {
            let e3 = this.getLineWidth(0);
            for (let t2 = 1, n2 = this._textLines.length; t2 < n2; t2++) {
              let n3 = this.getLineWidth(t2);
              n3 > e3 && (e3 = n3);
            }
            return e3;
          }
          _renderTextLine(e3, t2, n2, r2, i2, a2) {
            this._renderChars(e3, t2, n2, r2, i2, a2);
          }
          _renderTextLinesBackground(e3) {
            if (!this.textBackgroundColor && !this.styleHas(`textBackgroundColor`)) return;
            let t2 = e3.fillStyle, n2 = this._getLeftOffset(), r2 = this._getTopOffset();
            for (let t3 = 0, i2 = this._textLines.length; t3 < i2; t3++) {
              let i3 = this.getHeightOfLine(t3);
              if (!this.textBackgroundColor && !this.styleHas(`textBackgroundColor`, t3)) {
                r2 += i3;
                continue;
              }
              let a2 = this._textLines[t3].length, o2 = this._getLineLeftOffset(t3), s2, c2, l2 = 0, u2 = 0, d2 = this.getValueOfPropertyAt(t3, 0, `textBackgroundColor`), f2 = this.getHeightOfLineImpl(t3);
              for (let i4 = 0; i4 < a2; i4++) {
                let a3 = this.__charBounds[t3][i4];
                c2 = this.getValueOfPropertyAt(t3, i4, `textBackgroundColor`), this.path ? (e3.save(), e3.translate(a3.renderLeft, a3.renderTop), e3.rotate(a3.angle), e3.fillStyle = c2, c2 && e3.fillRect(-a3.width / 2, -f2 * (1 - this._fontSizeFraction), a3.width, f2), e3.restore()) : c2 === d2 ? l2 += a3.kernedWidth : (s2 = n2 + o2 + u2, this.direction === `rtl` && (s2 = this.width - s2 - l2), e3.fillStyle = d2, d2 && e3.fillRect(s2, r2, l2, f2), u2 = a3.left, l2 = a3.width, d2 = c2);
              }
              c2 && !this.path && (s2 = n2 + o2 + u2, this.direction === `rtl` && (s2 = this.width - s2 - l2), e3.fillStyle = c2, e3.fillRect(s2, r2, l2, f2)), r2 += i3;
            }
            e3.fillStyle = t2, this._removeShadow(e3);
          }
          _measureChar(e3, t2, n2, r2) {
            let i2 = y.getFontCache(t2), a2 = this._getFontDeclaration(t2), o2 = n2 ? n2 + e3 : e3, s2 = n2 && a2 === this._getFontDeclaration(r2), c2 = t2.fontSize / this.CACHE_FONT_SIZE, l2, u2, d2, f2;
            if (n2 && i2.has(n2) && (d2 = i2.get(n2)), i2.has(e3) && (f2 = l2 = i2.get(e3)), s2 && i2.has(o2) && (u2 = i2.get(o2), f2 = u2 - d2), l2 === void 0 || d2 === void 0 || u2 === void 0) {
              let r3 = (Jo || (Jo = F({ width: 0, height: 0 }).getContext(`2d`)), Jo);
              this._setTextStyles(r3, t2, true), l2 === void 0 && (f2 = l2 = r3.measureText(e3).width, i2.set(e3, l2)), d2 === void 0 && s2 && n2 && (d2 = r3.measureText(n2).width, i2.set(n2, d2)), s2 && u2 === void 0 && (u2 = r3.measureText(o2).width, i2.set(o2, u2), f2 = u2 - d2);
            }
            return { width: l2 * c2, kernedWidth: f2 * c2 };
          }
          getHeightOfChar(e3, t2) {
            return this.getValueOfPropertyAt(e3, t2, `fontSize`);
          }
          measureLine(e3) {
            let t2 = this._measureLine(e3);
            return this.charSpacing !== 0 && (t2.width -= this._getWidthOfCharSpacing()), t2.width < 0 && (t2.width = 0), t2;
          }
          _measureLine(e3) {
            let t2, n2, r2 = 0, i2 = this.pathSide === k, a2 = this.path, o2 = this._textLines[e3], s2 = o2.length, c2 = Array(s2);
            this.__charBounds[e3] = c2;
            for (let i3 = 0; i3 < s2; i3++) {
              let a3 = o2[i3];
              n2 = this._getGraphemeBox(a3, e3, i3, t2), c2[i3] = n2, r2 += n2.kernedWidth, t2 = a3;
            }
            if (c2[s2] = { left: n2 ? n2.left + n2.width : 0, width: 0, kernedWidth: 0, height: this.fontSize, deltaY: 0 }, a2 && a2.segmentsInfo) {
              let e4 = 0, t3 = a2.segmentsInfo[a2.segmentsInfo.length - 1].length;
              switch (this.textAlign) {
                case D:
                  e4 = i2 ? t3 - r2 : 0;
                  break;
                case E:
                  e4 = (t3 - r2) / 2;
                  break;
                case k:
                  e4 = i2 ? 0 : t3 - r2;
              }
              e4 += this.pathStartOffset * (i2 ? -1 : 1);
              for (let r3 = i2 ? s2 - 1 : 0; i2 ? r3 >= 0 : r3 < s2; i2 ? r3-- : r3++) n2 = c2[r3], e4 > t3 ? e4 %= t3 : e4 < 0 && (e4 += t3), this._setGraphemeOnPath(e4, n2), e4 += n2.kernedWidth;
            }
            return { width: r2, numOfSpaces: 0 };
          }
          _setGraphemeOnPath(e3, t2) {
            let n2 = e3 + t2.kernedWidth / 2, r2 = this.path, i2 = Ma(r2.path, n2, r2.segmentsInfo);
            t2.renderLeft = i2.x - r2.pathOffset.x, t2.renderTop = i2.y - r2.pathOffset.y, t2.angle = i2.angle + (this.pathSide === `right` ? Math.PI : 0);
          }
          _getGraphemeBox(e3, t2, n2, r2, i2) {
            let a2 = this.getCompleteStyleDeclaration(t2, n2), o2 = r2 ? this.getCompleteStyleDeclaration(t2, n2 - 1) : {}, s2 = this._measureChar(e3, a2, r2, o2), c2, l2 = s2.kernedWidth, u2 = s2.width;
            this.charSpacing !== 0 && (c2 = this._getWidthOfCharSpacing(), u2 += c2, l2 += c2);
            let d2 = { width: u2, left: 0, height: a2.fontSize, kernedWidth: l2, deltaY: a2.deltaY };
            if (n2 > 0 && !i2) {
              let e4 = this.__charBounds[t2][n2 - 1];
              d2.left = e4.left + e4.width + s2.kernedWidth - s2.width;
            }
            return d2;
          }
          getHeightOfLineImpl(e3) {
            let t2 = this.__lineHeights;
            if (t2[e3]) return t2[e3];
            let n2 = this.getHeightOfChar(e3, 0);
            for (let t3 = 1, r2 = this._textLines[e3].length; t3 < r2; t3++) n2 = Math.max(this.getHeightOfChar(e3, t3), n2);
            return t2[e3] = n2 * this._fontSizeMult;
          }
          getHeightOfLine(e3) {
            return this.getHeightOfLineImpl(e3) * this.lineHeight;
          }
          calcTextHeight() {
            let e3 = 0;
            for (let t2 = 0, n2 = this._textLines.length; t2 < n2; t2++) e3 += t2 === n2 - 1 ? this.getHeightOfLineImpl(t2) : this.getHeightOfLine(t2);
            return e3;
          }
          _getLeftOffset() {
            return this.direction === `ltr` ? -this.width / 2 : this.width / 2;
          }
          _getTopOffset() {
            return -this.height / 2;
          }
          _renderTextCommon(e3, t2) {
            e3.save();
            let n2 = 0, r2 = this._getLeftOffset(), i2 = this._getTopOffset();
            for (let a2 = 0, o2 = this._textLines.length; a2 < o2; a2++) this._renderTextLine(t2, e3, this._textLines[a2], r2 + this._getLineLeftOffset(a2), i2 + n2 + this.getHeightOfLineImpl(a2), a2), n2 += this.getHeightOfLine(a2);
            e3.restore();
          }
          _renderTextFill(e3) {
            (this.fill || this.styleHas(`fill`)) && this._renderTextCommon(e3, `fillText`);
          }
          _renderTextStroke(e3) {
            (this.stroke && this.strokeWidth !== 0 || !this.isEmptyStyles()) && (this.shadow && !this.shadow.affectStroke && this._removeShadow(e3), e3.save(), this._setLineDash(e3, this.strokeDashArray), e3.beginPath(), this._renderTextCommon(e3, `strokeText`), e3.closePath(), e3.restore());
          }
          _renderChars(e3, t2, n2, r2, i2, a2) {
            let o2 = this.textAlign.includes(En), s2 = this.path, c2 = !o2 && this.charSpacing === 0 && this.isEmptyStyles(a2) && !s2, l2 = this.direction === `ltr`, u2 = this.direction === `ltr` ? 1 : -1, d2 = t2.direction, f2, p2, m2, h2, g2, _2 = ``, v2 = 0;
            if (t2.save(), d2 !== this.direction && (t2.canvas.setAttribute(`dir`, l2 ? `ltr` : `rtl`), t2.direction = l2 ? `ltr` : `rtl`, t2.textAlign = l2 ? D : k), i2 -= this.getHeightOfLineImpl(a2) * this._fontSizeFraction, c2) return this._renderChar(e3, t2, a2, 0, n2.join(``), r2, i2), void t2.restore();
            for (let c3 = 0, l3 = n2.length - 1; c3 <= l3; c3++) h2 = c3 === l3 || this.charSpacing || s2, _2 += n2[c3], m2 = this.__charBounds[a2][c3], v2 === 0 ? (r2 += u2 * (m2.kernedWidth - m2.width), v2 += m2.width) : v2 += m2.kernedWidth, o2 && !h2 && this._reSpaceAndTab.test(n2[c3]) && (h2 = true), h2 || (f2 = f2 || this.getCompleteStyleDeclaration(a2, c3), p2 = this.getCompleteStyleDeclaration(a2, c3 + 1), h2 = Ei(f2, p2, false)), h2 && (s2 ? (t2.save(), t2.translate(m2.renderLeft, m2.renderTop), t2.rotate(m2.angle), this._renderChar(e3, t2, a2, c3, _2, -v2 / 2, 0), t2.restore()) : (g2 = r2, this._renderChar(e3, t2, a2, c3, _2, g2, i2)), _2 = ``, f2 = p2, r2 += u2 * v2, v2 = 0);
            t2.restore();
          }
          _applyPatternGradientTransformText(e3) {
            let t2 = this.width + this.strokeWidth, n2 = this.height + this.strokeWidth, r2 = F({ width: t2, height: n2 }), i2 = r2.getContext(`2d`);
            return r2.width = t2, r2.height = n2, i2.beginPath(), i2.moveTo(0, 0), i2.lineTo(t2, 0), i2.lineTo(t2, n2), i2.lineTo(0, n2), i2.closePath(), i2.translate(t2 / 2, n2 / 2), i2.fillStyle = e3.toLive(i2), this._applyPatternGradientTransform(i2, e3), i2.fill(), i2.createPattern(r2, `no-repeat`);
          }
          handleFiller(e3, t2, n2) {
            let r2, i2;
            return V(n2) ? n2.gradientUnits === `percentage` || n2.gradientTransform || n2.patternTransform ? (r2 = -this.width / 2, i2 = -this.height / 2, e3.translate(r2, i2), e3[t2] = this._applyPatternGradientTransformText(n2), { offsetX: r2, offsetY: i2 }) : (e3[t2] = n2.toLive(e3), this._applyPatternGradientTransform(e3, n2)) : (e3[t2] = n2, { offsetX: 0, offsetY: 0 });
          }
          _setStrokeStyles(e3, { stroke: t2, strokeWidth: n2 }) {
            return e3.lineWidth = n2, e3.lineCap = this.strokeLineCap, e3.lineDashOffset = this.strokeDashOffset, e3.lineJoin = this.strokeLineJoin, e3.miterLimit = this.strokeMiterLimit, this.handleFiller(e3, `strokeStyle`, t2);
          }
          _setFillStyles(e3, { fill: t2 }) {
            return this.handleFiller(e3, `fillStyle`, t2);
          }
          _renderChar(e3, t2, n2, r2, i2, a2, o2) {
            let s2 = this._getStyleDeclaration(n2, r2), c2 = this.getCompleteStyleDeclaration(n2, r2), l2 = e3 === `fillText` && c2.fill, u2 = e3 === `strokeText` && c2.stroke && c2.strokeWidth;
            if (u2 || l2) {
              if (t2.save(), t2.font = this._getFontDeclaration(c2), s2.textBackgroundColor && this._removeShadow(t2), s2.deltaY && (o2 += s2.deltaY), l2) {
                let e4 = this._setFillStyles(t2, c2);
                t2.fillText(i2, a2 - e4.offsetX, o2 - e4.offsetY);
              }
              if (u2) {
                let e4 = this._setStrokeStyles(t2, c2);
                t2.strokeText(i2, a2 - e4.offsetX, o2 - e4.offsetY);
              }
              t2.restore();
            }
          }
          setSuperscript(e3, t2) {
            this._setScript(e3, t2, this.superscript);
          }
          setSubscript(e3, t2) {
            this._setScript(e3, t2, this.subscript);
          }
          _setScript(e3, t2, n2) {
            let r2 = this.get2DCursorLocation(e3, true), i2 = this.getValueOfPropertyAt(r2.lineIndex, r2.charIndex, `fontSize`), a2 = this.getValueOfPropertyAt(r2.lineIndex, r2.charIndex, `deltaY`), o2 = { fontSize: i2 * n2.size, deltaY: a2 + i2 * n2.baseline };
            this.setSelectionStyles(o2, e3, t2);
          }
          _getLineLeftOffset(e3) {
            let t2 = this.getLineWidth(e3), n2 = this.width - t2, r2 = this.textAlign, i2 = this.direction, a2 = this.isEndOfWrapping(e3), o2 = 0;
            return r2 === `justify` || r2 === `justify-center` && !a2 || r2 === `justify-right` && !a2 || r2 === `justify-left` && !a2 ? 0 : (r2 === `center` && (o2 = n2 / 2), r2 === `right` && (o2 = n2), r2 === `justify-center` && (o2 = n2 / 2), r2 === `justify-right` && (o2 = n2), i2 === `rtl` && (r2 === `right` || r2 === `justify-right` ? o2 = 0 : r2 === `left` || r2 === `justify-left` ? o2 = -n2 : r2 !== `center` && r2 !== `justify-center` || (o2 = -n2 / 2)), o2);
          }
          _clearCache() {
            this._forceClearCache = false, this.__lineWidths = [], this.__lineHeights = [], this.__charBounds = [];
          }
          getLineWidth(e3) {
            if (this.__lineWidths[e3] !== void 0) return this.__lineWidths[e3];
            let { width: t2 } = this.measureLine(e3);
            return this.__lineWidths[e3] = t2, t2;
          }
          _getWidthOfCharSpacing() {
            return this.charSpacing === 0 ? 0 : this.fontSize * this.charSpacing / 1e3;
          }
          getValueOfPropertyAt(e3, t2, n2) {
            var r2;
            return (r2 = this._getStyleDeclaration(e3, t2)[n2]) == null ? this[n2] : r2;
          }
          _renderTextDecoration(e3, t2) {
            if (!this[t2] && !this.styleHas(t2)) return;
            let n2 = this._getTopOffset(), r2 = this._getLeftOffset(), i2 = this.path, a2 = this._getWidthOfCharSpacing(), o2 = t2 === `linethrough` ? 0.5 : +(t2 === `overline`), s2 = this.offsets[t2];
            for (let c2 = 0, l2 = this._textLines.length; c2 < l2; c2++) {
              let l3 = this.getHeightOfLine(c2);
              if (!this[t2] && !this.styleHas(t2, c2)) {
                n2 += l3;
                continue;
              }
              let u2 = this._textLines[c2], d2 = l3 / this.lineHeight, f2 = this._getLineLeftOffset(c2), p2, m2 = 0, h2 = 0, g2 = this.getValueOfPropertyAt(c2, 0, t2), _2 = this.getValueOfPropertyAt(c2, 0, j), v2 = this.getValueOfPropertyAt(c2, 0, `textDecorationColor`) || _2, y2 = this.getValueOfPropertyAt(c2, 0, vn), b2 = g2, x2 = v2, S2 = y2, C2 = n2 + d2 * (1 - this._fontSizeFraction), w2 = this.getHeightOfChar(c2, 0), ee2 = this.getValueOfPropertyAt(c2, 0, `deltaY`);
              for (let n3 = 0, a3 = u2.length; n3 < a3; n3++) {
                let a4 = this.__charBounds[c2][n3];
                b2 = this.getValueOfPropertyAt(c2, n3, t2), p2 = this.getValueOfPropertyAt(c2, n3, j), x2 = this.getValueOfPropertyAt(c2, n3, `textDecorationColor`) || p2, S2 = this.getValueOfPropertyAt(c2, n3, vn);
                let l4 = this.getHeightOfChar(c2, n3), u3 = this.getValueOfPropertyAt(c2, n3, `deltaY`);
                if (i2 && b2 && p2) {
                  let t3 = this.fontSize * S2 / 1e3;
                  e3.save(), e3.fillStyle = x2, e3.translate(a4.renderLeft, a4.renderTop), e3.rotate(a4.angle), e3.fillRect(-a4.kernedWidth / 2, s2 * l4 + u3 - o2 * t3, a4.kernedWidth, t3), e3.restore();
                } else if ((b2 !== g2 || p2 !== _2 || x2 !== v2 || l4 !== w2 || S2 !== y2 || u3 !== ee2) && h2 > 0) {
                  let t3 = this.fontSize * y2 / 1e3, n4 = r2 + f2 + m2;
                  this.direction === `rtl` && (n4 = this.width - n4 - h2), g2 && v2 && y2 && (e3.fillStyle = v2, e3.fillRect(n4, C2 + s2 * w2 + ee2 - o2 * t3, h2, t3)), m2 = a4.left, h2 = a4.width, g2 = b2, v2 = x2, y2 = S2, _2 = p2, w2 = l4, ee2 = u3;
                } else h2 += a4.kernedWidth;
              }
              let T2 = r2 + f2 + m2;
              this.direction === `rtl` && (T2 = this.width - T2 - h2), e3.fillStyle = x2;
              let E2 = this.fontSize * S2 / 1e3;
              b2 && x2 && S2 && e3.fillRect(T2, C2 + s2 * w2 + ee2 - o2 * E2, h2 - a2, E2), n2 += l3;
            }
            this._removeShadow(e3);
          }
          _getFontDeclaration({ fontFamily: t2 = this.fontFamily, fontStyle: n2 = this.fontStyle, fontWeight: r2 = this.fontWeight, fontSize: i2 = this.fontSize } = {}, a2) {
            let o2 = t2.includes(`'`) || t2.includes(`"`) || t2.includes(`,`) || e2.genericFonts.includes(t2.toLowerCase()) ? t2 : `"${t2}"`;
            return [n2, r2, `${a2 ? this.CACHE_FONT_SIZE : i2}px`, o2].join(` `);
          }
          render(e3) {
            this.visible && (this.canvas && this.canvas.skipOffscreen && !this.group && !this.isOnScreen() || (this._forceClearCache && this.initDimensions(), super.render(e3)));
          }
          graphemeSplit(e3) {
            return gt(e3);
          }
          _splitTextIntoLines(e3) {
            let t2 = e3.split(this._reNewline), n2 = Array(t2.length), r2 = [`
`], i2 = [];
            for (let e4 = 0; e4 < t2.length; e4++) n2[e4] = this.graphemeSplit(t2[e4]), i2 = i2.concat(n2[e4], r2);
            return i2.pop(), { _unwrappedLines: n2, lines: t2, graphemeText: i2, graphemeLines: n2 };
          }
          toObject(e3 = []) {
            return { ...super.toObject([...Cn, ...e3]), styles: Di(this.styles, this.text), ...this.path ? { path: this.path.toObject() } : {} };
          }
          set(e3, t2) {
            let { textLayoutProperties: n2 } = this.constructor;
            super.set(e3, t2);
            let r2 = false, i2 = false;
            if (typeof e3 == `object`) for (let t3 in e3) t3 === `path` && this.setPathInfo(), r2 = r2 || n2.includes(t3), i2 = i2 || t3 === `path`;
            else r2 = n2.includes(e3), i2 = e3 === `path`;
            return i2 && this.setPathInfo(), r2 && this.initialized && (this.initDimensions(), this.setCoords()), this;
          }
          complexity() {
            return 1;
          }
          static async fromElement(t2, n2, r2) {
            let i2 = Zi(t2, e2.ATTRIBUTE_NAMES, r2), { textAnchor: a2 = D, textDecoration: o2 = ``, dx: s2 = 0, dy: c2 = 0, top: l2 = 0, left: u2 = 0, fontSize: d2 = 16, strokeWidth: f2 = 1, ...p2 } = { ...n2, ...i2 }, m2 = new this(on(t2.textContent || ``).trim(), { left: u2 + s2, top: l2 + c2, underline: o2.includes(`underline`), overline: o2.includes(`overline`), linethrough: o2.includes(`line-through`), strokeWidth: 0, fontSize: d2, ...p2 }), h2 = m2.getScaledHeight() / m2.height, g2 = ((m2.height + m2.strokeWidth) * m2.lineHeight - m2.height) * h2, _2 = m2.getScaledHeight() + g2, v2 = 0;
            return a2 === `center` && (v2 = m2.getScaledWidth() / 2), a2 === `right` && (v2 = m2.getScaledWidth()), m2.set({ left: m2.left - v2, top: m2.top - (_2 - m2.fontSize * (0.07 + m2._fontSizeFraction)) / m2.lineHeight, strokeWidth: f2 }), m2;
          }
          static fromObject(e3) {
            return this._fromObject({ ...e3, styles: Oi(e3.styles || {}, e3.text) }, { extraParam: `text` });
          }
        };
        a(Q, `textLayoutProperties`, Sn), a(Q, `cacheProperties`, [...Un, ...Cn]), a(Q, `ownDefaults`, Tn), a(Q, `type`, `Text`), a(Q, `genericFonts`, [`serif`, `sans-serif`, `monospace`, `cursive`, `fantasy`, `system-ui`, `ui-serif`, `ui-sans-serif`, `ui-monospace`, `ui-rounded`, `math`, `emoji`, `fangsong`]), a(Q, `ATTRIBUTE_NAMES`, ki.concat(`x`, `y`, `dx`, `dy`, `font-family`, `font-style`, `font-weight`, `font-size`, `letter-spacing`, `text-decoration`, `text-decoration-thickness`, `text-decoration-color`, `text-anchor`)), vi(Q, [class extends gn {
          _toSVG() {
            let e2 = this._getSVGLeftTopOffsets(), t2 = this._getSVGTextAndBg(e2.textTop, e2.textLeft);
            return this._wrapSVGTextAndBg(t2);
          }
          toSVG(e2) {
            let t2 = this._createBaseSVGMarkup(this._toSVG(), { reviver: e2, noStyle: true, withShadow: true }), n2 = this.path;
            return n2 ? t2 + n2._createBaseSVGMarkup(n2._toSVG(), { reviver: e2, withShadow: true, additionalTransform: nt(this.calcOwnMatrix()) }) : t2;
          }
          _getSVGLeftTopOffsets() {
            return { textLeft: -this.width / 2, textTop: -this.height / 2, lineTop: this.getHeightOfLine(0) };
          }
          _wrapSVGTextAndBg({ textBgRects: e2, textSpans: t2 }) {
            let n2 = this.getSvgTextDecoration(this);
            return [e2.join(``), `		<text xml:space="preserve" `, `font-family="${U(this.fontFamily.replace(Ko, `'`))}" `, `font-size="${U(this.fontSize)}" `, this.fontStyle ? `font-style="${U(this.fontStyle)}" ` : ``, this.fontWeight ? `font-weight="${U(this.fontWeight)}" ` : ``, n2 ? `text-decoration="${n2}" ` : ``, this.direction === `rtl` ? `direction="rtl" ` : ``, `style="`, this.getSvgStyles(true), `"`, this.addPaintOrder(), ` >`, t2.join(``), `</text>
`];
          }
          _getSVGTextAndBg(e2, t2) {
            let n2 = [], r2 = [], i2, a2 = e2;
            this.backgroundColor && r2.push(qo(this.backgroundColor, -this.width / 2, -this.height / 2, this.width, this.height));
            for (let e3 = 0, o2 = this._textLines.length; e3 < o2; e3++) i2 = this._getLineLeftOffset(e3), this.direction === `rtl` && (i2 += this.width), (this.textBackgroundColor || this.styleHas(`textBackgroundColor`, e3)) && this._setSVGTextLineBg(r2, e3, t2 + i2, a2), this._setSVGTextLineText(n2, e3, t2 + i2, a2), a2 += this.getHeightOfLine(e3);
            return { textSpans: n2, textBgRects: r2 };
          }
          _createTextCharSpan(e2, t2, n2, r2, i2) {
            let a2 = s.NUM_FRACTION_DIGITS, o2 = this.getSvgSpanStyles(t2, e2 !== e2.trim() || !!e2.match(Go)), c2 = o2 ? `style="${o2}"` : ``, l2 = t2.deltaY, u2 = l2 ? ` dy="${B(l2, a2)}" ` : ``, { angle: d2, renderLeft: f2, renderTop: p2, width: m2 } = i2, h2 = ``;
            if (f2 !== void 0) {
              let e3 = m2 / 2;
              d2 && (h2 = ` rotate="${B(Ie(d2), a2)}"`);
              let t3 = We({ angle: Ie(d2) });
              t3[4] = f2, t3[5] = p2;
              let i3 = new N(-e3, 0).transform(t3);
              n2 = i3.x, r2 = i3.y;
            }
            return `<tspan x="${B(n2, a2)}" y="${B(r2, a2)}" ${u2}${h2}${c2}>${U(e2)}</tspan>`;
          }
          _setSVGTextLineText(e2, t2, n2, r2) {
            let i2 = this.getHeightOfLine(t2), a2 = this.textAlign.includes(En), o2 = this._textLines[t2], s2, c2, l2, u2, d2, f2 = ``, p2 = 0;
            r2 += i2 * (1 - this._fontSizeFraction) / this.lineHeight;
            for (let i3 = 0, m2 = o2.length - 1; i3 <= m2; i3++) d2 = i3 === m2 || this.charSpacing || this.path, f2 += o2[i3], l2 = this.__charBounds[t2][i3], p2 === 0 ? (n2 += l2.kernedWidth - l2.width, p2 += l2.width) : p2 += l2.kernedWidth, a2 && !d2 && this._reSpaceAndTab.test(o2[i3]) && (d2 = true), d2 || (s2 = s2 || this.getCompleteStyleDeclaration(t2, i3), c2 = this.getCompleteStyleDeclaration(t2, i3 + 1), d2 = Ei(s2, c2, true)), d2 && (u2 = this._getStyleDeclaration(t2, i3), e2.push(this._createTextCharSpan(f2, u2, n2, r2, l2)), f2 = ``, s2 = c2, this.direction === `rtl` ? n2 -= p2 : n2 += p2, p2 = 0);
          }
          _setSVGTextLineBg(e2, t2, n2, r2) {
            let i2 = this._textLines[t2], a2 = this.getHeightOfLine(t2) / this.lineHeight, o2, s2 = 0, c2 = 0, l2 = this.getValueOfPropertyAt(t2, 0, `textBackgroundColor`);
            for (let u2 = 0; u2 < i2.length; u2++) {
              let { left: i3, width: d2, kernedWidth: f2 } = this.__charBounds[t2][u2];
              o2 = this.getValueOfPropertyAt(t2, u2, `textBackgroundColor`), o2 === l2 ? s2 += f2 : (l2 && e2.push(qo(l2, n2 + c2, r2, s2, a2)), c2 = i3, s2 = d2, l2 = o2);
            }
            o2 && e2.push(qo(l2, n2 + c2, r2, s2, a2));
          }
          getSvgStyles(e2) {
            let t2 = nn(this.textDecorationColor) ? ` text-decoration-color: ${U(this[yn])};` : ``;
            return `${super.getSvgStyles(e2)} text-decoration-thickness: ${B(this.textDecorationThickness * this.getObjectScaling().y / 10, s.NUM_FRACTION_DIGITS)}%;${t2} white-space: pre;`;
          }
          getSvgSpanStyles(e2, t2) {
            let { fontFamily: n2, strokeWidth: r2, stroke: i2, fill: a2, fontSize: o2, fontStyle: c2, fontWeight: l2, textDecorationThickness: u2, textDecorationColor: d2, linethrough: f2, overline: p2, underline: m2 } = e2, h2 = this.getSvgTextDecoration({ underline: m2 == null ? this.underline : m2, overline: p2 == null ? this.overline : p2, linethrough: f2 == null ? this.linethrough : f2 }), g2 = u2 || this.textDecorationThickness, _2 = d2 || this.textDecorationColor, v2 = rn(r2), y2 = an(n2), b2 = rn(o2), x2 = an(c2), S2 = rn(l2) || an(l2), C2 = an(_2);
            return [i2 ? hn(he, i2) : ``, v2 ? `stroke-width: ${U(v2)}; ` : ``, y2 ? `font-family: ${y2.includes(`'`) || y2.includes(`"`) ? U(y2) : `'${U(y2)}'`}; ` : ``, b2 ? `font-size: ${U(b2)}px; ` : ``, x2 ? `font-style: ${U(x2)}; ` : ``, S2 ? `font-weight: ${U(S2)}; ` : ``, h2 ? `text-decoration: ${h2}; text-decoration-thickness: ${B(g2 * this.getObjectScaling().y / 10, s.NUM_FRACTION_DIGITS)}%;${C2 ? ` text-decoration-color: ${U(C2)};` : ``} ` : ``, a2 ? hn(j, a2) : ``, t2 ? `white-space: pre; ` : ``].join(``);
          }
          getSvgTextDecoration(e2) {
            return [`overline`, `underline`, `line-through`].filter((t2) => e2[t2.replace(`-`, ``)]).join(` `);
          }
        }]), M.setClass(Q), M.setSVGClass(Q);
        var Yo = class {
          constructor(e2) {
            a(this, `target`, void 0), a(this, `__mouseDownInPlace`, false), a(this, `__dragStartFired`, false), a(this, `__isDraggingOver`, false), a(this, `__dragStartSelection`, void 0), a(this, `__dragImageDisposer`, void 0), a(this, `_dispose`, void 0), this.target = e2;
            let t2 = [this.target.on(`dragenter`, this.dragEnterHandler.bind(this)), this.target.on(`dragover`, this.dragOverHandler.bind(this)), this.target.on(`dragleave`, this.dragLeaveHandler.bind(this)), this.target.on(`dragend`, this.dragEndHandler.bind(this)), this.target.on(`drop`, this.dropHandler.bind(this))];
            this._dispose = () => {
              t2.forEach((e3) => e3()), this._dispose = void 0;
            };
          }
          isPointerOverSelection(e2) {
            let t2 = this.target, n2 = t2.getSelectionStartFromPointer(e2);
            return t2.isEditing && n2 >= t2.selectionStart && n2 <= t2.selectionEnd && t2.selectionStart < t2.selectionEnd;
          }
          start(e2) {
            return this.__mouseDownInPlace = this.isPointerOverSelection(e2);
          }
          isActive() {
            return this.__mouseDownInPlace;
          }
          end(e2) {
            let t2 = this.isActive();
            return t2 && !this.__dragStartFired && (this.target.setCursorByClick(e2), this.target.initDelayedCursor(true)), this.__mouseDownInPlace = false, this.__dragStartFired = false, this.__isDraggingOver = false, t2;
          }
          getDragStartSelection() {
            return this.__dragStartSelection;
          }
          setDragImage(e2, { selectionStart: t2, selectionEnd: n2 }) {
            var r2;
            let i2 = this.target, a2 = i2.canvas, o2 = new N(i2.flipX ? -1 : 1, i2.flipY ? -1 : 1), s2 = i2._getCursorBoundaries(t2), c2 = new N(s2.left + s2.leftOffset, s2.top + s2.topOffset).multiply(o2).transform(i2.calcTransformMatrix()), l2 = a2.getScenePoint(e2).subtract(c2), u2 = i2.getCanvasRetinaScaling(), d2 = i2.getBoundingRect(), f2 = c2.subtract(new N(d2.left, d2.top)), p2 = a2.viewportTransform, m2 = f2.add(l2).transform(p2, true), h2 = i2.backgroundColor, g2 = Ti(i2.styles);
            i2.backgroundColor = ``;
            let _2 = { stroke: `transparent`, fill: `transparent`, textBackgroundColor: `transparent` };
            i2.setSelectionStyles(_2, 0, t2), i2.setSelectionStyles(_2, n2, i2.text.length), i2.dirty = true;
            let v2 = i2.toCanvasElement({ enableRetinaScaling: a2.enableRetinaScaling, viewportTransform: true });
            i2.backgroundColor = h2, i2.styles = g2, i2.dirty = true, Ka(v2, { position: `fixed`, left: -v2.width + `px`, border: te, width: v2.width / u2 + `px`, height: v2.height / u2 + `px` }), this.__dragImageDisposer && this.__dragImageDisposer(), this.__dragImageDisposer = () => {
              v2.remove();
            }, H(e2.target || this.target.hiddenTextarea).body.appendChild(v2), (r2 = e2.dataTransfer) == null || r2.setDragImage(v2, m2.x, m2.y);
          }
          onDragStart(e2) {
            this.__dragStartFired = true;
            let t2 = this.target, n2 = this.isActive();
            if (n2 && e2.dataTransfer) {
              let n3 = this.__dragStartSelection = { selectionStart: t2.selectionStart, selectionEnd: t2.selectionEnd }, r2 = t2._text.slice(n3.selectionStart, n3.selectionEnd).join(``), i2 = { text: t2.text, value: r2, ...n3 };
              e2.dataTransfer.setData(`text/plain`, r2), e2.dataTransfer.setData(`application/fabric`, JSON.stringify({ value: r2, styles: t2.getSelectionStyles(n3.selectionStart, n3.selectionEnd, true) })), e2.dataTransfer.effectAllowed = `copyMove`, this.setDragImage(e2, i2);
            }
            return t2.abortCursorAnimation(), n2;
          }
          canDrop(e2) {
            if (this.target.editable && !this.target.getActiveControl() && !e2.defaultPrevented) {
              if (this.isActive() && this.__dragStartSelection) {
                let t2 = this.target.getSelectionStartFromPointer(e2), n2 = this.__dragStartSelection;
                return t2 < n2.selectionStart || t2 > n2.selectionEnd;
              }
              return true;
            }
            return false;
          }
          targetCanDrop(e2) {
            return this.target.canDrop(e2);
          }
          dragEnterHandler({ e: e2 }) {
            let t2 = this.targetCanDrop(e2);
            !this.__isDraggingOver && t2 && (this.__isDraggingOver = true);
          }
          dragOverHandler(e2) {
            let { e: t2 } = e2, n2 = this.targetCanDrop(t2);
            !this.__isDraggingOver && n2 ? this.__isDraggingOver = true : this.__isDraggingOver && !n2 && (this.__isDraggingOver = false), this.__isDraggingOver && (t2.preventDefault(), e2.canDrop = true, e2.dropTarget = this.target);
          }
          dragLeaveHandler() {
            (this.__isDraggingOver || this.isActive()) && (this.__isDraggingOver = false);
          }
          dropHandler(e2) {
            var t2;
            let { e: n2 } = e2, r2 = n2.defaultPrevented;
            this.__isDraggingOver = false, n2.preventDefault();
            let i2 = (t2 = n2.dataTransfer) == null ? void 0 : t2.getData(`text/plain`);
            if (i2 && !r2) {
              let t3 = this.target, r3 = t3.canvas, a2 = t3.getSelectionStartFromPointer(n2), { styles: o2 } = n2.dataTransfer.types.includes(`application/fabric`) ? JSON.parse(n2.dataTransfer.getData(`application/fabric`)) : {}, s2 = i2[Math.max(0, i2.length - 1)];
              if (this.__dragStartSelection) {
                let e3 = this.__dragStartSelection.selectionStart, n3 = this.__dragStartSelection.selectionEnd;
                a2 > e3 && a2 <= n3 ? a2 = e3 : a2 > n3 && (a2 -= n3 - e3), t3.removeChars(e3, n3), delete this.__dragStartSelection;
              }
              t3._reNewline.test(s2) && (t3._reNewline.test(t3._text[a2]) || a2 === t3._text.length) && (i2 = i2.trimEnd()), e2.didDrop = true, e2.dropTarget = t3, t3.insertChars(i2, o2, a2), r3.setActiveObject(t3), t3.enterEditing(n2), t3.selectionStart = Math.min(a2 + 0, t3._text.length), t3.selectionEnd = Math.min(t3.selectionStart + i2.length, t3._text.length), t3.hiddenTextarea.value = t3.text, t3._updateTextarea(), t3.hiddenTextarea.focus(), t3.fire(le, { index: a2 + 0, action: `drop` }), r3.fire(`text:changed`, { target: t3 }), r3.contextTopDirty = true, r3.requestRenderAll();
            }
          }
          dragEndHandler({ e: e2 }) {
            if (this.isActive() && this.__dragStartFired && this.__dragStartSelection) {
              var t2;
              let n2 = this.target, r2 = this.target.canvas, { selectionStart: i2, selectionEnd: a2 } = this.__dragStartSelection, o2 = ((t2 = e2.dataTransfer) == null ? void 0 : t2.dropEffect) || `none`;
              o2 === `none` ? (n2.selectionStart = i2, n2.selectionEnd = a2, n2._updateTextarea(), n2.hiddenTextarea.focus()) : (n2.clearContextTop(), o2 === `move` && (n2.removeChars(i2, a2), n2.selectionStart = n2.selectionEnd = i2, n2.hiddenTextarea && (n2.hiddenTextarea.value = n2.text), n2._updateTextarea(), n2.fire(le, { index: i2, action: `dragend` }), r2.fire(`text:changed`, { target: n2 }), r2.requestRenderAll()), n2.exitEditing());
            }
            this.__dragImageDisposer && this.__dragImageDisposer(), delete this.__dragImageDisposer, delete this.__dragStartSelection, this.__isDraggingOver = false;
          }
          dispose() {
            this._dispose && this._dispose();
          }
        };
        let Xo = /[ \n\.,;!\?\-]/;
        var Zo = class extends Q {
          constructor(...e2) {
            super(...e2), a(this, `_currentCursorOpacity`, 1);
          }
          initBehavior() {
            this._tick = this._tick.bind(this), this._onTickComplete = this._onTickComplete.bind(this), this.updateSelectionOnMouseMove = this.updateSelectionOnMouseMove.bind(this);
          }
          onDeselect(e2) {
            return this.isEditing && this.exitEditing(), this.selected = false, super.onDeselect(e2);
          }
          _animateCursor({ toValue: e2, duration: t2, delay: n2, onComplete: r2 }) {
            return Mr({ startValue: this._currentCursorOpacity, endValue: e2, duration: t2, delay: n2, onComplete: r2, abort: () => !this.canvas || this.selectionStart !== this.selectionEnd, onChange: (e3) => {
              this._currentCursorOpacity = e3, this.renderCursorOrSelection();
            } });
          }
          _tick(e2) {
            this._currentTickState = this._animateCursor({ toValue: 0, duration: this.cursorDuration / 2, delay: Math.max(e2 || 0, 100), onComplete: this._onTickComplete });
          }
          _onTickComplete() {
            var e2;
            (e2 = this._currentTickCompleteState) == null || e2.abort(), this._currentTickCompleteState = this._animateCursor({ toValue: 1, duration: this.cursorDuration, onComplete: this._tick });
          }
          initDelayedCursor(e2) {
            this.abortCursorAnimation(), this._tick(e2 ? 0 : this.cursorDelay);
          }
          abortCursorAnimation() {
            let e2 = false;
            [this._currentTickState, this._currentTickCompleteState].forEach((t2) => {
              t2 && !t2.isDone() && (e2 = true, t2.abort());
            }), this._currentCursorOpacity = 1, e2 && this.clearContextTop();
          }
          restartCursorIfNeeded() {
            [this._currentTickState, this._currentTickCompleteState].some((e2) => !e2 || e2.isDone()) && this.initDelayedCursor();
          }
          selectAll() {
            return this.selectionStart = 0, this.selectionEnd = this._text.length, this._fireSelectionChanged(), this._updateTextarea(), this;
          }
          cmdAll() {
            this.selectAll(), this.renderCursorOrSelection();
          }
          getSelectedText() {
            return this._text.slice(this.selectionStart, this.selectionEnd).join(``);
          }
          findWordBoundaryLeft(e2) {
            let t2 = 0, n2 = e2 - 1;
            if (this._reSpace.test(this._text[n2])) for (; this._reSpace.test(this._text[n2]); ) t2++, n2--;
            for (; /\S/.test(this._text[n2]) && n2 > -1; ) t2++, n2--;
            return e2 - t2;
          }
          findWordBoundaryRight(e2) {
            let t2 = 0, n2 = e2;
            if (this._reSpace.test(this._text[n2])) for (; this._reSpace.test(this._text[n2]); ) t2++, n2++;
            for (; /\S/.test(this._text[n2]) && n2 < this._text.length; ) t2++, n2++;
            return e2 + t2;
          }
          findLineBoundaryLeft(e2) {
            let t2 = 0, n2 = e2 - 1;
            for (; !/\n/.test(this._text[n2]) && n2 > -1; ) t2++, n2--;
            return e2 - t2;
          }
          findLineBoundaryRight(e2) {
            let t2 = 0, n2 = e2;
            for (; !/\n/.test(this._text[n2]) && n2 < this._text.length; ) t2++, n2++;
            return e2 + t2;
          }
          searchWordBoundary(e2, t2) {
            let n2 = this._text, r2 = e2 > 0 && this._reSpace.test(n2[e2]) && (t2 === -1 || !ne.test(n2[e2 - 1])) ? e2 - 1 : e2, i2 = n2[r2];
            for (; r2 > 0 && r2 < n2.length && !Xo.test(i2); ) r2 += t2, i2 = n2[r2];
            return t2 === -1 && Xo.test(i2) && r2++, r2;
          }
          selectWord(e2) {
            var t2;
            e2 = (t2 = e2) == null ? this.selectionStart : t2;
            let n2 = this.searchWordBoundary(e2, -1), r2 = Math.max(n2, this.searchWordBoundary(e2, 1));
            this.selectionStart = n2, this.selectionEnd = r2, this._fireSelectionChanged(), this._updateTextarea(), this.renderCursorOrSelection();
          }
          selectLine(e2) {
            var t2;
            e2 = (t2 = e2) == null ? this.selectionStart : t2;
            let n2 = this.findLineBoundaryLeft(e2), r2 = this.findLineBoundaryRight(e2);
            this.selectionStart = n2, this.selectionEnd = r2, this._fireSelectionChanged(), this._updateTextarea();
          }
          enterEditing(e2) {
            !this.isEditing && this.editable && (this.enterEditingImpl(), this.fire(`editing:entered`, e2 ? { e: e2 } : void 0), this._fireSelectionChanged(), this.canvas && (this.canvas.fire(`text:editing:entered`, { target: this, e: e2 }), this.canvas.requestRenderAll()));
          }
          enterEditingImpl() {
            this.canvas && (this.canvas.calcOffset(), this.canvas.textEditingManager.exitTextEditing()), this.isEditing = true, this.initHiddenTextarea(), this.hiddenTextarea.focus(), this.hiddenTextarea.value = this.text, this._updateTextarea(), this._saveEditingProps(), this._setEditingProps(), this._textBeforeEdit = this.text, this._tick();
          }
          updateSelectionOnMouseMove(e2) {
            if (this.getActiveControl()) return;
            let t2 = this.hiddenTextarea;
            H(t2).activeElement !== t2 && t2.focus();
            let n2 = this.getSelectionStartFromPointer(e2), r2 = this.selectionStart, i2 = this.selectionEnd;
            (n2 === this.__selectionStartOnMouseDown && r2 !== i2 || r2 !== n2 && i2 !== n2) && (n2 > this.__selectionStartOnMouseDown ? (this.selectionStart = this.__selectionStartOnMouseDown, this.selectionEnd = n2) : (this.selectionStart = n2, this.selectionEnd = this.__selectionStartOnMouseDown), this.selectionStart === r2 && this.selectionEnd === i2 || (this._fireSelectionChanged(), this._updateTextarea(), this.renderCursorOrSelection()));
          }
          _setEditingProps() {
            this.hoverCursor = `text`, this.canvas && (this.canvas.defaultCursor = this.canvas.moveCursor = `text`), this.borderColor = this.editingBorderColor, this.hasControls = this.selectable = false, this.lockMovementX = this.lockMovementY = true;
          }
          fromStringToGraphemeSelection(e2, t2, n2) {
            let r2 = n2.slice(0, e2), i2 = this.graphemeSplit(r2).length;
            if (e2 === t2) return { selectionStart: i2, selectionEnd: i2 };
            let a2 = n2.slice(e2, t2);
            return { selectionStart: i2, selectionEnd: i2 + this.graphemeSplit(a2).length };
          }
          fromGraphemeToStringSelection(e2, t2, n2) {
            let r2 = n2.slice(0, e2).join(``).length;
            return e2 === t2 ? { selectionStart: r2, selectionEnd: r2 } : { selectionStart: r2, selectionEnd: r2 + n2.slice(e2, t2).join(``).length };
          }
          _updateTextarea() {
            if (this.cursorOffsetCache = {}, this.hiddenTextarea) {
              if (!this.inCompositionMode) {
                let e2 = this.fromGraphemeToStringSelection(this.selectionStart, this.selectionEnd, this._text);
                this.hiddenTextarea.selectionStart = e2.selectionStart, this.hiddenTextarea.selectionEnd = e2.selectionEnd;
              }
              this.updateTextareaPosition();
            }
          }
          updateFromTextArea() {
            let { hiddenTextarea: e2, direction: t2, textAlign: n2, inCompositionMode: r2 } = this;
            if (!e2) return;
            let i2 = n2 === `justify` ? t2 === `ltr` ? D : k : n2.replace(`justify-`, ``), a2 = this.getPositionByOrigin(i2, `top`);
            this.cursorOffsetCache = {}, this.text = e2.value, this.set(`dirty`, true), this.initDimensions(), this.setPositionByOrigin(a2, i2, `top`), this.setCoords();
            let o2 = this.fromStringToGraphemeSelection(e2.selectionStart, e2.selectionEnd, e2.value);
            this.selectionEnd = this.selectionStart = o2.selectionEnd, r2 || (this.selectionStart = o2.selectionStart), this.updateTextareaPosition();
          }
          updateTextareaPosition() {
            if (this.selectionStart === this.selectionEnd) {
              let e2 = this._calcTextareaPosition();
              this.hiddenTextarea.style.left = e2.left, this.hiddenTextarea.style.top = e2.top;
            }
          }
          _calcTextareaPosition() {
            if (!this.canvas) return { left: `1px`, top: `1px` };
            let e2 = this.inCompositionMode ? this.compositionStart : this.selectionStart, t2 = this._getCursorBoundaries(e2), n2 = this.get2DCursorLocation(e2), r2 = n2.lineIndex, i2 = n2.charIndex, a2 = this.getValueOfPropertyAt(r2, i2, `fontSize`) * this.lineHeight, o2 = t2.leftOffset, s2 = this.getCanvasRetinaScaling(), c2 = this.canvas.upperCanvasEl, l2 = c2.width / s2, u2 = c2.height / s2, d2 = l2 - a2, f2 = u2 - a2, p2 = new N(t2.left + o2, t2.top + t2.topOffset + a2).transform(this.calcTransformMatrix()).transform(this.canvas.viewportTransform).multiply(new N(c2.clientWidth / l2, c2.clientHeight / u2));
            return p2.x < 0 && (p2.x = 0), p2.x > d2 && (p2.x = d2), p2.y < 0 && (p2.y = 0), p2.y > f2 && (p2.y = f2), p2.x += this.canvas._offset.left, p2.y += this.canvas._offset.top, { left: `${p2.x}px`, top: `${p2.y}px`, fontSize: `${a2}px`, charHeight: a2 };
          }
          _saveEditingProps() {
            this._savedProps = { hasControls: this.hasControls, borderColor: this.borderColor, lockMovementX: this.lockMovementX, lockMovementY: this.lockMovementY, hoverCursor: this.hoverCursor, selectable: this.selectable, defaultCursor: this.canvas && this.canvas.defaultCursor, moveCursor: this.canvas && this.canvas.moveCursor };
          }
          _restoreEditingProps() {
            this._savedProps && (this.hoverCursor = this._savedProps.hoverCursor, this.hasControls = this._savedProps.hasControls, this.borderColor = this._savedProps.borderColor, this.selectable = this._savedProps.selectable, this.lockMovementX = this._savedProps.lockMovementX, this.lockMovementY = this._savedProps.lockMovementY, this.canvas && (this.canvas.defaultCursor = this._savedProps.defaultCursor || this.canvas.defaultCursor, this.canvas.moveCursor = this._savedProps.moveCursor || this.canvas.moveCursor), delete this._savedProps);
          }
          exitEditingImpl() {
            let e2 = this.hiddenTextarea;
            this.selected = false, this.isEditing = false, e2 && (e2.blur && e2.blur(), e2.parentNode && e2.parentNode.removeChild(e2)), this.hiddenTextarea = null, this.abortCursorAnimation(), this.selectionStart !== this.selectionEnd && this.clearContextTop(), this.selectionEnd = this.selectionStart, this._restoreEditingProps(), this._forceClearCache && (this.initDimensions(), this.setCoords());
          }
          exitEditing() {
            let e2 = this._textBeforeEdit !== this.text;
            return this.exitEditingImpl(), this.fire(`editing:exited`), e2 && this.fire(`modified`), this.canvas && (this.canvas.fire(`text:editing:exited`, { target: this }), e2 && this.canvas.fire(`object:modified`, { target: this })), this;
          }
          _removeExtraneousStyles() {
            for (let e2 in this.styles) this._textLines[e2] || delete this.styles[e2];
          }
          removeStyleFromTo(e2, t2) {
            let { lineIndex: n2, charIndex: r2 } = this.get2DCursorLocation(e2, true), { lineIndex: i2, charIndex: a2 } = this.get2DCursorLocation(t2, true);
            if (n2 !== i2) {
              if (this.styles[n2]) for (let e3 = r2; e3 < this._unwrappedTextLines[n2].length; e3++) delete this.styles[n2][e3];
              if (this.styles[i2]) for (let e3 = a2; e3 < this._unwrappedTextLines[i2].length; e3++) {
                let t3 = this.styles[i2][e3];
                t3 && (this.styles[n2] || (this.styles[n2] = {}), this.styles[n2][r2 + e3 - a2] = t3);
              }
              for (let e3 = n2 + 1; e3 <= i2; e3++) delete this.styles[e3];
              this.shiftLineStyles(i2, n2 - i2);
            } else if (this.styles[n2]) {
              let e3 = this.styles[n2], t3 = a2 - r2;
              for (let t4 = r2; t4 < a2; t4++) delete e3[t4];
              for (let r3 in this.styles[n2]) {
                let n3 = parseInt(r3, 10);
                n3 >= a2 && (e3[n3 - t3] = e3[r3], delete e3[r3]);
              }
            }
          }
          shiftLineStyles(e2, t2) {
            let n2 = Object.assign({}, this.styles);
            for (let r2 in this.styles) {
              let i2 = parseInt(r2, 10);
              i2 > e2 && (this.styles[i2 + t2] = n2[i2], n2[i2 - t2] || delete this.styles[i2]);
            }
          }
          insertNewlineStyleObject(e2, t2, n2, r2) {
            let i2 = {}, a2 = this._unwrappedTextLines[e2].length, o2 = a2 === t2, s2 = false;
            n2 || (n2 = 1), this.shiftLineStyles(e2, n2);
            let c2 = this.styles[e2] ? this.styles[e2][t2 === 0 ? t2 : t2 - 1] : void 0;
            for (let n3 in this.styles[e2]) {
              let r3 = parseInt(n3, 10);
              r3 >= t2 && (s2 = true, i2[r3 - t2] = this.styles[e2][n3], o2 && t2 === 0 || delete this.styles[e2][n3]);
            }
            let l2 = false;
            for (s2 && !o2 && (this.styles[e2 + n2] = i2, l2 = true), (l2 || a2 > t2) && n2--; n2 > 0; ) r2 && r2[n2 - 1] ? this.styles[e2 + n2] = { 0: { ...r2[n2 - 1] } } : c2 ? this.styles[e2 + n2] = { 0: { ...c2 } } : delete this.styles[e2 + n2], n2--;
            this._forceClearCache = true;
          }
          insertCharStyleObject(e2, t2, n2, r2) {
            this.styles || (this.styles = {});
            let i2 = this.styles[e2], a2 = i2 ? { ...i2 } : {};
            n2 || (n2 = 1);
            for (let e3 in a2) {
              let r3 = parseInt(e3, 10);
              r3 >= t2 && (i2[r3 + n2] = a2[r3], a2[r3 - n2] || delete i2[r3]);
            }
            if (this._forceClearCache = true, r2) {
              for (; n2--; ) Object.keys(r2[n2]).length && (this.styles[e2] || (this.styles[e2] = {}), this.styles[e2][t2 + n2] = { ...r2[n2] });
              return;
            }
            if (!i2) return;
            let o2 = i2[t2 ? t2 - 1 : 1];
            for (; o2 && n2--; ) this.styles[e2][t2 + n2] = { ...o2 };
          }
          insertNewStyleBlock(e2, t2, n2) {
            let r2 = this.get2DCursorLocation(t2, true), i2 = [0], a2, o2 = 0;
            for (let t3 = 0; t3 < e2.length; t3++) e2[t3] === `
` ? (o2++, i2[o2] = 0) : i2[o2]++;
            for (i2[0] > 0 && (this.insertCharStyleObject(r2.lineIndex, r2.charIndex, i2[0], n2), n2 = n2 && n2.slice(i2[0] + 1)), o2 && this.insertNewlineStyleObject(r2.lineIndex, r2.charIndex + i2[0], o2), a2 = 1; a2 < o2; a2++) i2[a2] > 0 ? this.insertCharStyleObject(r2.lineIndex + a2, 0, i2[a2], n2) : n2 && this.styles[r2.lineIndex + a2] && n2[0] && (this.styles[r2.lineIndex + a2][0] = n2[0]), n2 = n2 && n2.slice(i2[a2] + 1);
            i2[a2] > 0 && this.insertCharStyleObject(r2.lineIndex + a2, 0, i2[a2], n2);
          }
          removeChars(e2, t2 = e2 + 1) {
            this.removeStyleFromTo(e2, t2), this._text.splice(e2, t2 - e2), this.text = this._text.join(``), this.set(`dirty`, true), this.initDimensions(), this.setCoords(), this._removeExtraneousStyles();
          }
          insertChars(e2, t2, n2, r2 = n2) {
            r2 > n2 && this.removeStyleFromTo(n2, r2);
            let i2 = this.graphemeSplit(e2);
            this.insertNewStyleBlock(i2, n2, t2), this._text = [...this._text.slice(0, n2), ...i2, ...this._text.slice(r2)], this.text = this._text.join(``), this.set(`dirty`, true), this.initDimensions(), this.setCoords(), this._removeExtraneousStyles();
          }
          setSelectionStartEndWithShift(e2, t2, n2) {
            n2 <= e2 ? (t2 === e2 ? this._selectionDirection = D : this._selectionDirection === `right` && (this._selectionDirection = D, this.selectionEnd = e2), this.selectionStart = n2) : n2 > e2 && n2 < t2 ? this._selectionDirection === `right` ? this.selectionEnd = n2 : this.selectionStart = n2 : (t2 === e2 ? this._selectionDirection = k : this._selectionDirection === `left` && (this._selectionDirection = k, this.selectionStart = t2), this.selectionEnd = n2);
          }
        }, Qo = class extends Zo {
          initHiddenTextarea() {
            let e2 = this.canvas && H(this.canvas.getElement()) || g(), t2 = e2.createElement(`textarea`);
            Object.entries({ autocapitalize: `off`, autocorrect: `off`, autocomplete: `off`, spellcheck: `false`, "data-fabric": `textarea`, wrap: `off`, name: `fabricTextarea` }).map(([e3, n3]) => t2.setAttribute(e3, n3));
            let { top: n2, left: r2, fontSize: i2 } = this._calcTextareaPosition();
            t2.style.cssText = `position: absolute; top: ${n2}; left: ${r2}; z-index: -999; opacity: 0; width: 1px; height: 1px; font-size: 1px; padding-top: ${i2};`, (this.hiddenTextareaContainer || e2.body).appendChild(t2), Object.entries({ blur: `blur`, keydown: `onKeyDown`, keyup: `onKeyUp`, input: `onInput`, copy: `copy`, cut: `copy`, paste: `paste`, compositionstart: `onCompositionStart`, compositionupdate: `onCompositionUpdate`, compositionend: `onCompositionEnd` }).map(([e3, n3]) => t2.addEventListener(e3, this[n3].bind(this))), this.hiddenTextarea = t2;
          }
          blur() {
            this.abortCursorAnimation();
          }
          onKeyDown(e2) {
            if (!this.isEditing) return;
            let t2 = this.direction === `rtl` ? this.keysMapRtl : this.keysMap;
            if (e2.keyCode in t2) this[t2[e2.keyCode]](e2);
            else {
              if (!(e2.keyCode in this.ctrlKeysMapDown) || !e2.ctrlKey && !e2.metaKey) return;
              this[this.ctrlKeysMapDown[e2.keyCode]](e2);
            }
            e2.stopImmediatePropagation(), e2.preventDefault(), e2.keyCode >= 33 && e2.keyCode <= 40 ? (this.inCompositionMode = false, this.clearContextTop(), this.renderCursorOrSelection()) : this.canvas && this.canvas.requestRenderAll();
          }
          onKeyUp(e2) {
            !this.isEditing || this._copyDone || this.inCompositionMode ? this._copyDone = false : e2.keyCode in this.ctrlKeysMapUp && (e2.ctrlKey || e2.metaKey) && (this[this.ctrlKeysMapUp[e2.keyCode]](e2), e2.stopImmediatePropagation(), e2.preventDefault(), this.canvas && this.canvas.requestRenderAll());
          }
          onInput(e2) {
            let t2 = this.fromPaste, { value: n2, selectionStart: r2, selectionEnd: i2 } = this.hiddenTextarea;
            if (this.fromPaste = false, e2 && e2.stopPropagation(), !this.isEditing) return;
            let a2 = () => {
              this.updateFromTextArea(), this.fire(le), this.canvas && (this.canvas.fire(`text:changed`, { target: this }), this.canvas.requestRenderAll());
            };
            if (this.hiddenTextarea.value === ``) return this.styles = {}, void a2();
            let o2 = this._splitTextIntoLines(n2).graphemeText, c2 = this._text.length, l2 = o2.length, u2 = this.selectionStart, d2 = this.selectionEnd, f2 = u2 !== d2, p2, m2, g2, _2, v2 = l2 - c2, y2 = this.fromStringToGraphemeSelection(r2, i2, n2), b2 = u2 > y2.selectionStart;
            f2 ? (m2 = this._text.slice(u2, d2), v2 += d2 - u2) : l2 < c2 && (m2 = b2 ? this._text.slice(d2 + v2, d2) : this._text.slice(u2, u2 - v2));
            let x2 = o2.slice(y2.selectionEnd - v2, y2.selectionEnd);
            if (m2 && m2.length && (x2.length && (p2 = this.getSelectionStyles(u2, u2 + 1, false), p2 = x2.map(() => p2[0])), f2 ? (g2 = u2, _2 = d2) : b2 ? (g2 = d2 - m2.length, _2 = d2) : (g2 = d2, _2 = d2 + m2.length), this.removeStyleFromTo(g2, _2)), x2.length) {
              let { copyPasteData: e3 } = h();
              t2 && x2.join(``) === e3.copiedText && !s.disableStyleCopyPaste && (p2 = e3.copiedTextStyle), this.insertNewStyleBlock(x2, u2, p2);
            }
            a2();
          }
          onCompositionStart() {
            this.inCompositionMode = true;
          }
          onCompositionEnd() {
            this.inCompositionMode = false;
          }
          onCompositionUpdate({ target: e2 }) {
            let { selectionStart: t2, selectionEnd: n2 } = e2;
            this.compositionStart = t2, this.compositionEnd = n2, this.updateTextareaPosition();
          }
          copy() {
            if (this.selectionStart === this.selectionEnd) return;
            let { copyPasteData: e2 } = h();
            e2.copiedText = this.getSelectedText(), s.disableStyleCopyPaste ? e2.copiedTextStyle = void 0 : e2.copiedTextStyle = this.getSelectionStyles(this.selectionStart, this.selectionEnd, true), this._copyDone = true;
          }
          paste() {
            this.fromPaste = true;
          }
          _getWidthBeforeCursor(e2, t2) {
            let n2, r2 = this._getLineLeftOffset(e2);
            return t2 > 0 && (n2 = this.__charBounds[e2][t2 - 1], r2 += n2.left + n2.width), r2;
          }
          getDownCursorOffset(e2, t2) {
            let n2 = this._getSelectionForOffset(e2, t2), r2 = this.get2DCursorLocation(n2), i2 = r2.lineIndex;
            if (i2 === this._textLines.length - 1 || e2.metaKey || e2.keyCode === 34) return this._text.length - n2;
            let a2 = r2.charIndex, o2 = this._getWidthBeforeCursor(i2, a2), s2 = this._getIndexOnLine(i2 + 1, o2);
            return this._textLines[i2].slice(a2).length + s2 + 1 + this.missingNewlineOffset(i2);
          }
          _getSelectionForOffset(e2, t2) {
            return e2.shiftKey && this.selectionStart !== this.selectionEnd && t2 ? this.selectionEnd : this.selectionStart;
          }
          getUpCursorOffset(e2, t2) {
            let n2 = this._getSelectionForOffset(e2, t2), r2 = this.get2DCursorLocation(n2), i2 = r2.lineIndex;
            if (i2 === 0 || e2.metaKey || e2.keyCode === 33) return -n2;
            let a2 = r2.charIndex, o2 = this._getWidthBeforeCursor(i2, a2), s2 = this._getIndexOnLine(i2 - 1, o2), c2 = this._textLines[i2].slice(0, a2), l2 = this.missingNewlineOffset(i2 - 1);
            return -this._textLines[i2 - 1].length + s2 - c2.length + (1 - l2);
          }
          _getIndexOnLine(e2, t2) {
            let n2 = this._textLines[e2], r2, i2, a2 = this._getLineLeftOffset(e2), o2 = 0;
            for (let s2 = 0, c2 = n2.length; s2 < c2; s2++) if (r2 = this.__charBounds[e2][s2].width, a2 += r2, a2 > t2) {
              i2 = true;
              let e3 = a2 - r2, n3 = a2, c3 = Math.abs(e3 - t2);
              o2 = Math.abs(n3 - t2) < c3 ? s2 : s2 - 1;
              break;
            }
            return i2 || (o2 = n2.length - 1), o2;
          }
          moveCursorDown(e2) {
            this.selectionStart >= this._text.length && this.selectionEnd >= this._text.length || this._moveCursorUpOrDown(`Down`, e2);
          }
          moveCursorUp(e2) {
            this.selectionStart === 0 && this.selectionEnd === 0 || this._moveCursorUpOrDown(`Up`, e2);
          }
          _moveCursorUpOrDown(e2, t2) {
            let n2 = this[`get${e2}CursorOffset`](t2, this._selectionDirection === k);
            if (t2.shiftKey ? this.moveCursorWithShift(n2) : this.moveCursorWithoutShift(n2), n2 !== 0) {
              let e3 = this.text.length;
              this.selectionStart = Vn(0, this.selectionStart, e3), this.selectionEnd = Vn(0, this.selectionEnd, e3), this.abortCursorAnimation(), this.initDelayedCursor(), this._fireSelectionChanged(), this._updateTextarea();
            }
          }
          moveCursorWithShift(e2) {
            let t2 = this._selectionDirection === `left` ? this.selectionStart + e2 : this.selectionEnd + e2;
            return this.setSelectionStartEndWithShift(this.selectionStart, this.selectionEnd, t2), e2 !== 0;
          }
          moveCursorWithoutShift(e2) {
            return e2 < 0 ? (this.selectionStart += e2, this.selectionEnd = this.selectionStart) : (this.selectionEnd += e2, this.selectionStart = this.selectionEnd), e2 !== 0;
          }
          moveCursorLeft(e2) {
            this.selectionStart === 0 && this.selectionEnd === 0 || this._moveCursorLeftOrRight(`Left`, e2);
          }
          _move(e2, t2, n2) {
            let r2;
            if (e2.altKey) r2 = this[`findWordBoundary${n2}`](this[t2]);
            else {
              if (!e2.metaKey && e2.keyCode !== 35 && e2.keyCode !== 36) return this[t2] += n2 === `Left` ? -1 : 1, true;
              r2 = this[`findLineBoundary${n2}`](this[t2]);
            }
            return r2 !== void 0 && this[t2] !== r2 && (this[t2] = r2, true);
          }
          _moveLeft(e2, t2) {
            return this._move(e2, t2, `Left`);
          }
          _moveRight(e2, t2) {
            return this._move(e2, t2, `Right`);
          }
          moveCursorLeftWithoutShift(e2) {
            let t2 = true;
            return this._selectionDirection = D, this.selectionEnd === this.selectionStart && this.selectionStart !== 0 && (t2 = this._moveLeft(e2, `selectionStart`)), this.selectionEnd = this.selectionStart, t2;
          }
          moveCursorLeftWithShift(e2) {
            return this._selectionDirection === `right` && this.selectionStart !== this.selectionEnd ? this._moveLeft(e2, `selectionEnd`) : this.selectionStart === 0 ? void 0 : (this._selectionDirection = D, this._moveLeft(e2, `selectionStart`));
          }
          moveCursorRight(e2) {
            this.selectionStart >= this._text.length && this.selectionEnd >= this._text.length || this._moveCursorLeftOrRight(`Right`, e2);
          }
          _moveCursorLeftOrRight(e2, t2) {
            let n2 = `moveCursor${e2}${t2.shiftKey ? `WithShift` : `WithoutShift`}`;
            this._currentCursorOpacity = 1, this[n2](t2) && (this.abortCursorAnimation(), this.initDelayedCursor(), this._fireSelectionChanged(), this._updateTextarea());
          }
          moveCursorRightWithShift(e2) {
            return this._selectionDirection === `left` && this.selectionStart !== this.selectionEnd ? this._moveRight(e2, `selectionStart`) : this.selectionEnd === this._text.length ? void 0 : (this._selectionDirection = k, this._moveRight(e2, `selectionEnd`));
          }
          moveCursorRightWithoutShift(e2) {
            let t2 = true;
            return this._selectionDirection = k, this.selectionStart === this.selectionEnd ? (t2 = this._moveRight(e2, `selectionStart`), this.selectionEnd = this.selectionStart) : this.selectionStart = this.selectionEnd, t2;
          }
        };
        let $o = (e2) => !!e2.button;
        var es = class extends Qo {
          constructor(...e2) {
            super(...e2), a(this, `draggableTextDelegate`, void 0);
          }
          initBehavior() {
            this.on(`mousedown`, this._mouseDownHandler), this.on(`mouseup`, this.mouseUpHandler), this.on(`mousedblclick`, this.doubleClickHandler), this.on(`mousetripleclick`, this.tripleClickHandler), this.draggableTextDelegate = new Yo(this), super.initBehavior();
          }
          shouldStartDragging() {
            return this.draggableTextDelegate.isActive();
          }
          onDragStart(e2) {
            return this.draggableTextDelegate.onDragStart(e2);
          }
          canDrop(e2) {
            return this.draggableTextDelegate.canDrop(e2);
          }
          doubleClickHandler(e2) {
            this.isEditing && (this.selectWord(this.getSelectionStartFromPointer(e2.e)), this.renderCursorOrSelection());
          }
          tripleClickHandler(e2) {
            this.isEditing && (this.selectLine(this.getSelectionStartFromPointer(e2.e)), this.renderCursorOrSelection());
          }
          _mouseDownHandler({ e: e2, alreadySelected: t2 }) {
            this.canvas && this.editable && !$o(e2) && !this.getActiveControl() && (this.draggableTextDelegate.start(e2) || (this.canvas.textEditingManager.register(this), t2 && (this.inCompositionMode = false, this.setCursorByClick(e2)), this.isEditing && (this.__selectionStartOnMouseDown = this.selectionStart, this.selectionStart === this.selectionEnd && this.abortCursorAnimation(), this.renderCursorOrSelection()), this.selected || (this.selected = t2 || this.isEditing)));
          }
          mouseUpHandler({ e: e2, transform: t2 }) {
            let n2 = this.draggableTextDelegate.end(e2);
            if (this.canvas) {
              this.canvas.textEditingManager.unregister(this);
              let e3 = this.canvas._activeObject;
              if (e3 && e3 !== this) return;
            }
            !this.editable || this.group && !this.group.interactive || t2 && t2.actionPerformed || $o(e2) || n2 || this.selected && !this.getActiveControl() && (this.enterEditing(e2), this.selectionStart === this.selectionEnd ? this.initDelayedCursor(true) : this.renderCursorOrSelection());
          }
          setCursorByClick(e2) {
            let t2 = this.getSelectionStartFromPointer(e2), n2 = this.selectionStart, r2 = this.selectionEnd;
            e2.shiftKey ? this.setSelectionStartEndWithShift(n2, r2, t2) : (this.selectionStart = t2, this.selectionEnd = t2), this.isEditing && (this._fireSelectionChanged(), this._updateTextarea());
          }
          getSelectionStartFromPointer(e2) {
            let t2 = this.canvas.getScenePoint(e2).transform(R(this.calcTransformMatrix())).add(new N(-this._getLeftOffset(), -this._getTopOffset())), n2 = 0, r2 = 0, i2 = 0;
            for (let e3 = 0; e3 < this._textLines.length && n2 <= t2.y; e3++) n2 += this.getHeightOfLine(e3), i2 = e3, e3 > 0 && (r2 += this._textLines[e3 - 1].length + this.missingNewlineOffset(e3 - 1));
            let a2 = Math.abs(this._getLineLeftOffset(i2)), o2 = this._textLines[i2].length, s2 = this.__charBounds[i2];
            for (let e3 = 0; e3 < o2; e3++) {
              let n3 = a2 + s2[e3].kernedWidth;
              if (t2.x <= n3) {
                Math.abs(t2.x - n3) <= Math.abs(t2.x - a2) && r2++;
                break;
              }
              a2 = n3, r2++;
            }
            return Math.min(this.flipX ? o2 - r2 : r2, this._text.length);
          }
        };
        let ts = `moveCursorUp`, ns = `moveCursorDown`, rs = `moveCursorLeft`, is = `moveCursorRight`, as = `exitEditing`, os = (e2, t2) => {
          let n2 = t2.getRetinaScaling();
          e2.setTransform(n2, 0, 0, n2, 0, 0);
          let r2 = t2.viewportTransform;
          e2.transform(r2[0], r2[1], r2[2], r2[3], r2[4], r2[5]);
        }, ss = { selectionStart: 0, selectionEnd: 0, selectionColor: `rgba(17,119,255,0.3)`, isEditing: false, editable: true, editingBorderColor: `rgba(102,153,255,0.25)`, cursorWidth: 2, cursorColor: ``, cursorDelay: 1e3, cursorDuration: 600, caching: true, hiddenTextareaContainer: null, keysMap: { 9: as, 27: as, 33: ts, 34: ns, 35: is, 36: rs, 37: rs, 38: ts, 39: is, 40: ns }, keysMapRtl: { 9: as, 27: as, 33: ts, 34: ns, 35: rs, 36: is, 37: is, 38: ts, 39: rs, 40: ns }, ctrlKeysMapDown: { 65: `cmdAll` }, ctrlKeysMapUp: { 67: `copy`, 88: `cut` }, _selectionDirection: null, _reSpace: /\s|\r?\n/, inCompositionMode: false };
        var cs = class e2 extends es {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          get type() {
            let e3 = super.type;
            return e3 === `itext` ? `i-text` : e3;
          }
          constructor(t2, n2) {
            super(t2, { ...e2.ownDefaults, ...n2 }), this.initBehavior();
          }
          _set(e3, t2) {
            return this.isEditing && this._savedProps && e3 in this._savedProps ? (this._savedProps[e3] = t2, this) : (e3 === `canvas` && (this.canvas instanceof ho && this.canvas.textEditingManager.remove(this), t2 instanceof ho && t2.textEditingManager.add(this)), super._set(e3, t2));
          }
          setSelectionStart(e3) {
            e3 = Math.max(e3, 0), this._updateAndFire(`selectionStart`, e3);
          }
          setSelectionEnd(e3) {
            e3 = Math.min(e3, this.text.length), this._updateAndFire(`selectionEnd`, e3);
          }
          _updateAndFire(e3, t2) {
            this[e3] !== t2 && (this._fireSelectionChanged(), this[e3] = t2), this._updateTextarea();
          }
          _fireSelectionChanged() {
            this.fire(`selection:changed`), this.canvas && this.canvas.fire(`text:selection:changed`, { target: this });
          }
          initDimensions() {
            this.isEditing && this.initDelayedCursor(), super.initDimensions();
          }
          getSelectionStyles(e3 = this.selectionStart || 0, t2 = this.selectionEnd, n2) {
            return super.getSelectionStyles(e3, t2, n2);
          }
          setSelectionStyles(e3, t2 = this.selectionStart || 0, n2 = this.selectionEnd) {
            return super.setSelectionStyles(e3, t2, n2);
          }
          get2DCursorLocation(e3 = this.selectionStart, t2) {
            return super.get2DCursorLocation(e3, t2);
          }
          render(e3) {
            super.render(e3), this.cursorOffsetCache = {}, this.renderCursorOrSelection();
          }
          toCanvasElement(e3) {
            let t2 = this.isEditing;
            this.isEditing = false;
            let n2 = super.toCanvasElement(e3);
            return this.isEditing = t2, n2;
          }
          renderCursorOrSelection() {
            if (!this.isEditing || !this.canvas) return;
            let e3 = this.clearContextTop(true);
            if (!e3) return;
            let t2 = this._getCursorBoundaries(), n2 = this.findAncestorsWithClipPath(), r2 = n2.length > 0, i2, a2 = e3;
            if (r2) {
              i2 = F(e3.canvas), a2 = i2.getContext(`2d`), os(a2, this.canvas);
              let t3 = this.calcTransformMatrix();
              a2.transform(t3[0], t3[1], t3[2], t3[3], t3[4], t3[5]);
            }
            if (this.selectionStart !== this.selectionEnd || this.inCompositionMode ? this.renderSelection(a2, t2) : this.renderCursor(a2, t2), r2) for (let t3 of n2) {
              let n3 = t3.clipPath, r3 = F(e3.canvas), i3 = r3.getContext(`2d`);
              if (os(i3, this.canvas), !n3.absolutePositioned) {
                let e4 = t3.calcTransformMatrix();
                i3.transform(e4[0], e4[1], e4[2], e4[3], e4[4], e4[5]);
              }
              n3.transform(i3), n3.drawObject(i3, true, {}), this.drawClipPathOnCache(a2, n3, r3);
            }
            r2 && (e3.setTransform(1, 0, 0, 1, 0, 0), e3.drawImage(i2, 0, 0)), this.canvas.contextTopDirty = true, e3.restore();
          }
          findAncestorsWithClipPath() {
            let e3 = [], t2 = this;
            for (; t2; ) t2.clipPath && e3.push(t2), t2 = t2.parent;
            return e3;
          }
          _getCursorBoundaries(e3 = this.selectionStart, t2) {
            let n2 = this._getLeftOffset(), r2 = this._getTopOffset(), i2 = this._getCursorBoundariesOffsets(e3, t2);
            return { left: n2, top: r2, leftOffset: i2.left, topOffset: i2.top };
          }
          _getCursorBoundariesOffsets(e3, t2) {
            return t2 ? this.__getCursorBoundariesOffsets(e3) : this.cursorOffsetCache && `top` in this.cursorOffsetCache ? this.cursorOffsetCache : this.cursorOffsetCache = this.__getCursorBoundariesOffsets(e3);
          }
          __getCursorBoundariesOffsets(e3) {
            let t2 = 0, n2 = 0, { charIndex: r2, lineIndex: i2 } = this.get2DCursorLocation(e3), { textAlign: a2, direction: o2 } = this;
            for (let e4 = 0; e4 < i2; e4++) t2 += this.getHeightOfLine(e4);
            let s2 = this._getLineLeftOffset(i2), c2 = this.__charBounds[i2][r2];
            c2 && (n2 = c2.left), this.charSpacing !== 0 && r2 === this._textLines[i2].length && (n2 -= this._getWidthOfCharSpacing());
            let l2 = s2 + (n2 > 0 ? n2 : 0);
            return o2 === `rtl` && (a2 === `right` || a2 === `justify` || a2 === `justify-right` ? l2 *= -1 : a2 === `left` || a2 === `justify-left` ? l2 = s2 - (n2 > 0 ? n2 : 0) : a2 !== `center` && a2 !== `justify-center` || (l2 = s2 - (n2 > 0 ? n2 : 0))), { top: t2, left: l2 };
          }
          renderCursorAt(e3) {
            this._renderCursor(this.canvas.contextTop, this._getCursorBoundaries(e3, true), e3);
          }
          renderCursor(e3, t2) {
            this._renderCursor(e3, t2, this.selectionStart);
          }
          getCursorRenderingData(e3 = this.selectionStart, t2 = this._getCursorBoundaries(e3)) {
            let n2 = this.get2DCursorLocation(e3), r2 = n2.lineIndex, i2 = n2.charIndex > 0 ? n2.charIndex - 1 : 0, a2 = this.getValueOfPropertyAt(r2, i2, `fontSize`), o2 = this.getObjectScaling().x * this.canvas.getZoom(), s2 = this.cursorWidth / o2, c2 = this.getValueOfPropertyAt(r2, i2, `deltaY`), l2 = t2.topOffset + (1 - this._fontSizeFraction) * this.getHeightOfLine(r2) / this.lineHeight - a2 * (1 - this._fontSizeFraction);
            return { color: this.cursorColor || this.getValueOfPropertyAt(r2, i2, `fill`), opacity: this._currentCursorOpacity, left: t2.left + t2.leftOffset - s2 / 2, top: l2 + t2.top + c2, width: s2, height: a2 };
          }
          _renderCursor(e3, t2, n2) {
            let { color: r2, opacity: i2, left: a2, top: o2, width: s2, height: c2 } = this.getCursorRenderingData(n2, t2);
            e3.fillStyle = r2, e3.globalAlpha = i2, e3.fillRect(a2, o2, s2, c2);
          }
          renderSelection(e3, t2) {
            let n2 = { selectionStart: this.inCompositionMode ? this.hiddenTextarea.selectionStart : this.selectionStart, selectionEnd: this.inCompositionMode ? this.hiddenTextarea.selectionEnd : this.selectionEnd };
            this._renderSelection(e3, n2, t2);
          }
          renderDragSourceEffect() {
            let e3 = this.draggableTextDelegate.getDragStartSelection();
            this._renderSelection(this.canvas.contextTop, e3, this._getCursorBoundaries(e3.selectionStart, true));
          }
          renderDropTargetEffect(e3) {
            let t2 = this.getSelectionStartFromPointer(e3);
            this.renderCursorAt(t2);
          }
          _renderSelection(e3, t2, n2) {
            let { textAlign: r2, direction: i2 } = this, a2 = t2.selectionStart, o2 = t2.selectionEnd, s2 = r2.includes(En), c2 = this.get2DCursorLocation(a2), l2 = this.get2DCursorLocation(o2), u2 = c2.lineIndex, d2 = l2.lineIndex, f2 = c2.charIndex < 0 ? 0 : c2.charIndex, p2 = l2.charIndex < 0 ? 0 : l2.charIndex;
            for (let t3 = u2; t3 <= d2; t3++) {
              let a3 = this._getLineLeftOffset(t3) || 0, o3 = this.getHeightOfLine(t3), c3 = 0, l3 = 0;
              if (t3 === u2 && (c3 = this.__charBounds[u2][f2].left), t3 >= u2 && t3 < d2) l3 = s2 && !this.isEndOfWrapping(t3) ? this.width : this.getLineWidth(t3) || 5;
              else if (t3 === d2) if (p2 === 0) l3 = this.__charBounds[d2][p2].left;
              else {
                let e4 = this._getWidthOfCharSpacing();
                l3 = this.__charBounds[d2][p2 - 1].left + this.__charBounds[d2][p2 - 1].width - e4;
              }
              let m2 = o3;
              (this.lineHeight < 1 || t3 === d2 && this.lineHeight > 1) && (o3 /= this.lineHeight);
              let h2 = n2.left + a3 + c3, g2 = o3, _2 = 0, v2 = l3 - c3;
              this.inCompositionMode ? (e3.fillStyle = this.compositionColor || `black`, g2 = 1, _2 = o3) : e3.fillStyle = this.selectionColor, i2 === `rtl` && (r2 === `right` || r2 === `justify` || r2 === `justify-right` ? h2 = this.width - h2 - v2 : r2 === `left` || r2 === `justify-left` ? h2 = n2.left + a3 - l3 : r2 !== `center` && r2 !== `justify-center` || (h2 = n2.left + a3 - l3)), e3.fillRect(h2, n2.top + n2.topOffset + _2, v2, g2), n2.topOffset += m2;
            }
          }
          getCurrentCharFontSize() {
            let e3 = this._getCurrentCharIndex();
            return this.getValueOfPropertyAt(e3.l, e3.c, `fontSize`);
          }
          getCurrentCharColor() {
            let e3 = this._getCurrentCharIndex();
            return this.getValueOfPropertyAt(e3.l, e3.c, j);
          }
          _getCurrentCharIndex() {
            let e3 = this.get2DCursorLocation(this.selectionStart, true), t2 = e3.charIndex > 0 ? e3.charIndex - 1 : 0;
            return { l: e3.lineIndex, c: t2 };
          }
          dispose() {
            this.exitEditingImpl(), this.draggableTextDelegate.dispose(), super.dispose();
          }
        };
        a(cs, `ownDefaults`, ss), a(cs, `type`, `IText`), M.setClass(cs), M.setClass(cs, `i-text`);
        var ls = class e2 extends cs {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2, n2) {
            super(t2, { ...e2.ownDefaults, ...n2 });
          }
          static createControls() {
            return { controls: gi() };
          }
          initDimensions() {
            this.initialized && (this.isEditing && this.initDelayedCursor(), this._clearCache(), this.dynamicMinWidth = 0, this._styleMap = this._generateStyleMap(this._splitText()), this.dynamicMinWidth > this.width && this._set(`width`, this.dynamicMinWidth), this.textAlign.includes(`justify`) && this.enlargeSpaces(), this.height = this.calcTextHeight());
          }
          _generateStyleMap(e3) {
            let t2 = 0, n2 = 0, r2 = 0, i2 = {};
            for (let a2 = 0; a2 < e3.graphemeLines.length; a2++) e3.graphemeText[r2] === `
` && a2 > 0 ? (n2 = 0, r2++, t2++) : !this.splitByGrapheme && this._reSpaceAndTab.test(e3.graphemeText[r2]) && a2 > 0 && (n2++, r2++), i2[a2] = { line: t2, offset: n2 }, r2 += e3.graphemeLines[a2].length, n2 += e3.graphemeLines[a2].length;
            return i2;
          }
          styleHas(e3, t2) {
            if (this._styleMap && !this.isWrapping) {
              let e4 = this._styleMap[t2];
              e4 && (t2 = e4.line);
            }
            return super.styleHas(e3, t2);
          }
          isEmptyStyles(e3) {
            if (!this.styles) return true;
            let t2, n2, r2 = 0, i2 = false, a2 = this._styleMap[e3], o2 = this._styleMap[e3 + 1];
            a2 && (e3 = a2.line, r2 = a2.offset), o2 && (t2 = o2.line, i2 = t2 === e3, n2 = o2.offset);
            let s2 = e3 === void 0 ? this.styles : { line: this.styles[e3] };
            for (let e4 in s2) for (let t3 in s2[e4]) {
              let a3 = parseInt(t3, 10);
              if (a3 >= r2 && (!i2 || a3 < n2)) for (let n3 in s2[e4][t3]) return false;
            }
            return true;
          }
          _getStyleDeclaration(e3, t2) {
            if (this._styleMap && !this.isWrapping) {
              let n2 = this._styleMap[e3];
              if (!n2) return {};
              e3 = n2.line, t2 = n2.offset + t2;
            }
            return super._getStyleDeclaration(e3, t2);
          }
          _setStyleDeclaration(e3, t2, n2) {
            let r2 = this._styleMap[e3];
            super._setStyleDeclaration(r2.line, r2.offset + t2, n2);
          }
          _deleteStyleDeclaration(e3, t2) {
            let n2 = this._styleMap[e3];
            super._deleteStyleDeclaration(n2.line, n2.offset + t2);
          }
          _getLineStyle(e3) {
            let t2 = this._styleMap[e3];
            return !!this.styles[t2.line];
          }
          _setLineStyle(e3) {
            let t2 = this._styleMap[e3];
            super._setLineStyle(t2.line);
          }
          _wrapText(e3, t2) {
            this.isWrapping = true;
            let n2 = this.getGraphemeDataForRender(e3), r2 = [];
            for (let e4 = 0; e4 < n2.wordsData.length; e4++) r2.push(...this._wrapLine(e4, t2, n2));
            return this.isWrapping = false, r2;
          }
          getGraphemeDataForRender(e3) {
            let t2 = this.splitByGrapheme, n2 = t2 ? `` : ` `, r2 = 0;
            return { wordsData: e3.map((e4, i2) => {
              let a2 = 0, o2 = t2 ? this.graphemeSplit(e4) : this.wordSplit(e4);
              return o2.length === 0 ? [{ word: [], width: 0 }] : o2.map((e5) => {
                let o3 = t2 ? [e5] : this.graphemeSplit(e5), s2 = this._measureWord(o3, i2, a2);
                return r2 = Math.max(s2, r2), a2 += o3.length + n2.length, { word: o3, width: s2 };
              });
            }), largestWordWidth: r2 };
          }
          _measureWord(e3, t2, n2 = 0) {
            let r2, i2 = 0;
            for (let a2 = 0, o2 = e3.length; a2 < o2; a2++) i2 += this._getGraphemeBox(e3[a2], t2, a2 + n2, r2, true).kernedWidth, r2 = e3[a2];
            return i2;
          }
          wordSplit(e3) {
            return e3.split(this._wordJoiners);
          }
          _wrapLine(e3, t2, { largestWordWidth: n2, wordsData: r2 }, i2 = 0) {
            let a2 = this._getWidthOfCharSpacing(), o2 = this.splitByGrapheme, s2 = [], c2 = o2 ? `` : ` `, l2 = 0, u2 = [], d2 = 0, f2 = 0, p2 = true;
            t2 -= i2;
            let m2 = Math.max(t2, n2, this.dynamicMinWidth), h2 = r2[e3], g2;
            for (g2 = 0; g2 < h2.length; g2++) {
              let { word: t3, width: n3 } = h2[g2];
              d2 += t3.length, l2 += f2 + n3 - a2, l2 > m2 && !p2 ? (s2.push(u2), u2 = [], l2 = n3, p2 = true) : l2 += a2, p2 || o2 || u2.push(c2), u2 = u2.concat(t3), f2 = o2 ? 0 : this._measureWord([c2], e3, d2), d2++, p2 = false;
            }
            return g2 && s2.push(u2), n2 + i2 > this.dynamicMinWidth && (this.dynamicMinWidth = n2 - a2 + i2), s2;
          }
          isEndOfWrapping(e3) {
            return !this._styleMap[e3 + 1] || this._styleMap[e3 + 1].line !== this._styleMap[e3].line;
          }
          missingNewlineOffset(e3, t2) {
            return this.splitByGrapheme && !t2 ? +!!this.isEndOfWrapping(e3) : 1;
          }
          _splitTextIntoLines(e3) {
            let t2 = super._splitTextIntoLines(e3), n2 = this._wrapText(t2.lines, this.width), r2 = Array(n2.length);
            for (let e4 = 0; e4 < n2.length; e4++) r2[e4] = n2[e4].join(``);
            return t2.lines = r2, t2.graphemeLines = n2, t2;
          }
          getMinWidth() {
            return Math.max(this.minWidth, this.dynamicMinWidth);
          }
          _removeExtraneousStyles() {
            let e3 = /* @__PURE__ */ new Map();
            for (let t2 in this._styleMap) {
              let n2 = parseInt(t2, 10);
              if (this._textLines[n2]) {
                let n3 = this._styleMap[t2].line;
                e3.set(`${n3}`, true);
              }
            }
            for (let t2 in this.styles) e3.has(t2) || delete this.styles[t2];
          }
          toObject(e3 = []) {
            return super.toObject([`minWidth`, `splitByGrapheme`, ...e3]);
          }
        };
        a(ls, `type`, `Textbox`), a(ls, `textLayoutProperties`, [...cs.textLayoutProperties, `width`]), a(ls, `ownDefaults`, { minWidth: 20, dynamicMinWidth: 2, lockScalingFlip: true, noScaleCache: false, _wordJoiners: /[ \t\r]/, splitByGrapheme: false }), M.setClass(ls);
        var us = class extends ra {
          shouldPerformLayout(e2) {
            return !!e2.target.clipPath && super.shouldPerformLayout(e2);
          }
          shouldLayoutClipPath() {
            return false;
          }
          calcLayoutResult(e2, t2) {
            let { target: n2 } = e2, { clipPath: r2, group: i2 } = n2;
            if (!r2 || !this.shouldPerformLayout(e2)) return;
            let { width: a2, height: o2 } = wt(na(n2, r2)), s2 = new N(a2, o2);
            if (r2.absolutePositioned) return { center: Mt(r2.getRelativeCenterPoint(), void 0, i2 ? i2.calcTransformMatrix() : void 0), size: s2 };
            {
              let i3 = r2.getRelativeCenterPoint().transform(n2.calcOwnMatrix(), true);
              if (this.shouldPerformLayout(e2)) {
                let { center: n3 = new N(), correction: r3 = new N() } = this.calcBoundingBox(t2, e2) || {};
                return { center: n3.add(i3), correction: r3.subtract(i3), size: s2 };
              }
              return { center: n2.getRelativeCenterPoint().add(i3), size: s2 };
            }
          }
        };
        a(us, `type`, `clip-path`), M.setClass(us);
        var ds = class extends ra {
          getInitialSize({ target: e2 }, { size: t2 }) {
            return new N(e2.width || t2.x, e2.height || t2.y);
          }
        };
        a(ds, `type`, `fixed`), M.setClass(ds);
        var fs = class extends oa {
          subscribeTargets(e2) {
            let t2 = e2.target;
            e2.targets.reduce((e3, t3) => (t3.parent && e3.add(t3.parent), e3), /* @__PURE__ */ new Set()).forEach((e3) => {
              e3.layoutManager.subscribeTargets({ target: e3, targets: [t2] });
            });
          }
          unsubscribeTargets(e2) {
            let t2 = e2.target, n2 = t2.getObjects();
            e2.targets.reduce((e3, t3) => (t3.parent && e3.add(t3.parent), e3), /* @__PURE__ */ new Set()).forEach((e3) => {
              !n2.some((t3) => t3.parent === e3) && e3.layoutManager.unsubscribeTargets({ target: e3, targets: [t2] });
            });
          }
        }, ps = class e2 extends ca {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2 = [], n2 = {}) {
            super(), Object.assign(this, e2.ownDefaults), this.setOptions(n2);
            let { left: r2, top: i2, layoutManager: a2 } = n2;
            this.groupInit(t2, { left: r2, top: i2, layoutManager: a2 == null ? new fs() : a2 });
          }
          _shouldSetNestedCoords() {
            return true;
          }
          __objectSelectionMonitor() {
          }
          multiSelectAdd(...e3) {
            this.multiSelectionStacking === `selection-order` ? this.add(...e3) : e3.forEach((e4) => {
              let t2 = this._objects.findIndex((t3) => t3.isInFrontOf(e4)), n2 = t2 === -1 ? this.size() : t2;
              this.insertAt(n2, e4);
            });
          }
          canEnterGroup(e3) {
            return this.getObjects().some((t2) => t2.isDescendantOf(e3) || e3.isDescendantOf(t2)) ? (c(`error`, `ActiveSelection: circular object trees are not supported, this call has no effect`), false) : super.canEnterGroup(e3);
          }
          enterGroup(e3, t2) {
            e3.parent && e3.parent === e3.group ? e3.parent._exitGroup(e3) : e3.group && e3.parent !== e3.group && e3.group.remove(e3), this._enterGroup(e3, t2);
          }
          exitGroup(e3, t2) {
            this._exitGroup(e3, t2), e3.parent && e3.parent._enterGroup(e3, true);
          }
          _onAfterObjectsChange(e3, t2) {
            super._onAfterObjectsChange(e3, t2);
            let n2 = /* @__PURE__ */ new Set();
            t2.forEach((e4) => {
              let { parent: t3 } = e4;
              t3 && n2.add(t3);
            }), e3 === `removed` ? n2.forEach((e4) => {
              e4._onAfterObjectsChange(ta, t2);
            }) : n2.forEach((e4) => {
              e4._set(`dirty`, true);
            });
          }
          onDeselect() {
            return this.removeAll(), false;
          }
          toString() {
            return `#<ActiveSelection: (${this.complexity()})>`;
          }
          shouldCache() {
            return false;
          }
          isOnACache() {
            return false;
          }
          _renderControls(e3, t2, n2) {
            e3.save(), e3.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;
            let r2 = { hasControls: false, ...n2, forActiveSelection: true };
            for (let t3 = 0; t3 < this._objects.length; t3++) this._objects[t3]._renderControls(e3, r2);
            super._renderControls(e3, t2), e3.restore();
          }
        };
        a(ps, `type`, `ActiveSelection`), a(ps, `ownDefaults`, { multiSelectionStacking: `canvas-stacking` }), M.setClass(ps), M.setClass(ps, `activeSelection`);
        var ms = class {
          constructor() {
            a(this, `resources`, {});
          }
          applyFilters(e2, t2, n2, r2, i2) {
            let a2 = i2.getContext(`2d`, { willReadFrequently: true, desynchronized: true });
            if (!a2) return;
            a2.drawImage(t2, 0, 0, n2, r2);
            let o2 = { sourceWidth: n2, sourceHeight: r2, imageData: a2.getImageData(0, 0, n2, r2), originalEl: t2, originalImageData: a2.getImageData(0, 0, n2, r2), canvasEl: i2, ctx: a2, filterBackend: this };
            e2.forEach((e3) => {
              e3.applyTo(o2);
            });
            let { imageData: s2 } = o2;
            return s2.width === n2 && s2.height === r2 || (i2.width = s2.width, i2.height = s2.height), a2.putImageData(s2, 0, 0), o2;
          }
        }, hs = class {
          constructor({ tileSize: e2 = s.textureSize } = {}) {
            a(this, `aPosition`, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1])), a(this, `resources`, {}), this.tileSize = e2, this.setupGLContext(e2, e2), this.captureGPUInfo();
          }
          setupGLContext(e2, t2) {
            this.dispose(), this.createWebGLCanvas(e2, t2);
          }
          createWebGLCanvas(e2, t2) {
            let n2 = F({ width: e2, height: t2 }), r2 = n2.getContext(`webgl`, { alpha: true, premultipliedAlpha: false, depth: false, stencil: false, antialias: false });
            r2 && (r2.clearColor(0, 0, 0, 0), this.canvas = n2, this.gl = r2);
          }
          applyFilters(e2, t2, n2, r2, i2, a2) {
            let o2 = this.gl, s2 = i2.getContext(`2d`);
            if (!o2 || !s2) return;
            let c2;
            a2 && (c2 = this.getCachedTexture(a2, t2));
            let l2 = { originalWidth: t2.width || t2.naturalWidth || 0, originalHeight: t2.height || t2.naturalHeight || 0, sourceWidth: n2, sourceHeight: r2, destinationWidth: n2, destinationHeight: r2, context: o2, sourceTexture: this.createTexture(o2, n2, r2, c2 ? void 0 : t2), targetTexture: this.createTexture(o2, n2, r2), originalTexture: c2 || this.createTexture(o2, n2, r2, c2 ? void 0 : t2), passes: e2.length, webgl: true, aPosition: this.aPosition, programCache: this.programCache, pass: 0, filterBackend: this, targetCanvas: i2 }, u2 = o2.createFramebuffer();
            return o2.bindFramebuffer(o2.FRAMEBUFFER, u2), e2.forEach((e3) => {
              e3 && e3.applyTo(l2);
            }), function(e3) {
              let t3 = e3.targetCanvas, n3 = t3.width, r3 = t3.height, i3 = e3.destinationWidth, a3 = e3.destinationHeight;
              n3 === i3 && r3 === a3 || (t3.width = i3, t3.height = a3);
            }(l2), this.copyGLTo2D(o2, l2), o2.bindTexture(o2.TEXTURE_2D, null), o2.deleteTexture(l2.sourceTexture), o2.deleteTexture(l2.targetTexture), o2.deleteFramebuffer(u2), s2.setTransform(1, 0, 0, 1, 0, 0), l2;
          }
          dispose() {
            this.canvas && (this.canvas = null, this.gl = null), this.clearWebGLCaches();
          }
          clearWebGLCaches() {
            this.programCache = {}, this.textureCache = {};
          }
          createTexture(e2, t2, n2, r2, i2) {
            let { NEAREST: a2, TEXTURE_2D: o2, RGBA: s2, UNSIGNED_BYTE: c2, CLAMP_TO_EDGE: l2, TEXTURE_MAG_FILTER: u2, TEXTURE_MIN_FILTER: d2, TEXTURE_WRAP_S: f2, TEXTURE_WRAP_T: p2 } = e2, m2 = e2.createTexture();
            return e2.bindTexture(o2, m2), e2.texParameteri(o2, u2, i2 || a2), e2.texParameteri(o2, d2, i2 || a2), e2.texParameteri(o2, f2, l2), e2.texParameteri(o2, p2, l2), r2 ? e2.texImage2D(o2, 0, s2, s2, c2, r2) : e2.texImage2D(o2, 0, s2, t2, n2, 0, s2, c2, null), m2;
          }
          getCachedTexture(e2, t2, n2) {
            let { textureCache: r2 } = this;
            if (r2[e2]) return r2[e2];
            {
              let i2 = this.createTexture(this.gl, t2.width, t2.height, t2, n2);
              return i2 && (r2[e2] = i2), i2;
            }
          }
          evictCachesForKey(e2) {
            this.textureCache[e2] && (this.gl.deleteTexture(this.textureCache[e2]), delete this.textureCache[e2]);
          }
          copyGLTo2D(e2, t2) {
            let n2 = e2.canvas, r2 = t2.targetCanvas, i2 = r2.getContext(`2d`);
            if (!i2) return;
            i2.translate(0, r2.height), i2.scale(1, -1);
            let a2 = n2.height - r2.height;
            i2.drawImage(n2, 0, a2, r2.width, r2.height, 0, 0, r2.width, r2.height);
          }
          copyGLTo2DPutImageData(e2, t2) {
            let n2 = t2.targetCanvas.getContext(`2d`), r2 = t2.destinationWidth, i2 = t2.destinationHeight, a2 = r2 * i2 * 4;
            if (!n2) return;
            let o2 = new Uint8Array(this.imageBuffer, 0, a2), s2 = new Uint8ClampedArray(this.imageBuffer, 0, a2);
            e2.readPixels(0, 0, r2, i2, e2.RGBA, e2.UNSIGNED_BYTE, o2);
            let c2 = new ImageData(s2, r2, i2);
            n2.putImageData(c2, 0, 0);
          }
          captureGPUInfo() {
            if (this.gpuInfo) return this.gpuInfo;
            let e2 = this.gl, t2 = { renderer: ``, vendor: `` };
            if (!e2) return t2;
            let n2 = e2.getExtension(`WEBGL_debug_renderer_info`);
            if (n2) {
              let r2 = e2.getParameter(n2.UNMASKED_RENDERER_WEBGL), i2 = e2.getParameter(n2.UNMASKED_VENDOR_WEBGL);
              r2 && (t2.renderer = r2.toLowerCase()), i2 && (t2.vendor = i2.toLowerCase());
            }
            return this.gpuInfo = t2, t2;
          }
        };
        let gs;
        function _s() {
          let { WebGLProbe: e2 } = h();
          return e2.queryWebGL(P()), s.enableGLFiltering && e2.isSupported(s.textureSize) ? new hs({ tileSize: s.textureSize }) : new ms();
        }
        function vs(e2 = true) {
          return !gs && e2 && (gs = _s()), gs;
        }
        let ys = [`cropX`, `cropY`];
        var bs = class e2 extends J {
          static getDefaults() {
            return { ...super.getDefaults(), ...e2.ownDefaults };
          }
          constructor(t2, n2) {
            super(), a(this, `_lastScaleX`, 1), a(this, `_lastScaleY`, 1), a(this, `_filterScalingX`, 1), a(this, `_filterScalingY`, 1), this.filters = [], Object.assign(this, e2.ownDefaults), this.setOptions(n2), this.cacheKey = `texture${je()}`, this.setElement(typeof t2 == `string` ? (this.canvas && H(this.canvas.getElement()) || g()).getElementById(t2) : t2, n2);
          }
          getElement() {
            return this._element;
          }
          setElement(e3, t2 = {}) {
            this.removeTexture(this.cacheKey), this.removeTexture(`${this.cacheKey}_filtered`), this._element = e3, this._originalElement = e3, this._setWidthHeight(t2), this.filters.length !== 0 && this.applyFilters(), this.resizeFilter && this.applyResizeFilters();
          }
          removeTexture(e3) {
            let t2 = vs(false);
            t2 instanceof hs && t2.evictCachesForKey(e3);
          }
          dispose() {
            super.dispose(), this.removeTexture(this.cacheKey), this.removeTexture(`${this.cacheKey}_filtered`), this._cacheContext = null, [`_originalElement`, `_element`, `_filteredEl`, `_cacheCanvas`].forEach((e3) => {
              let t2 = this[e3];
              t2 && h().dispose(t2), this[e3] = void 0;
            });
          }
          getCrossOrigin() {
            return this._originalElement && (this._originalElement.crossOrigin || null);
          }
          getOriginalSize() {
            let e3 = this.getElement();
            return e3 ? { width: e3.naturalWidth || e3.width, height: e3.naturalHeight || e3.height } : { width: 0, height: 0 };
          }
          _stroke(e3) {
            if (!this.stroke || this.strokeWidth === 0) return;
            let t2 = this.width / 2, n2 = this.height / 2;
            e3.beginPath(), e3.moveTo(-t2, -n2), e3.lineTo(t2, -n2), e3.lineTo(t2, n2), e3.lineTo(-t2, n2), e3.lineTo(-t2, -n2), e3.closePath();
          }
          toObject(e3 = []) {
            let t2 = [];
            return this.filters.forEach((e4) => {
              e4 && t2.push(e4.toObject());
            }), { ...super.toObject([...ys, ...e3]), src: this.getSrc(), crossOrigin: this.getCrossOrigin(), filters: t2, ...this.resizeFilter ? { resizeFilter: this.resizeFilter.toObject() } : {} };
          }
          hasCrop() {
            return !!this.cropX || !!this.cropY || this.width < this._element.width || this.height < this._element.height;
          }
          _toSVG() {
            let e3 = [], t2 = this._element, n2 = -this.width / 2, r2 = -this.height / 2, i2 = [], a2 = [], o2 = ``, s2 = ``;
            if (!t2) return [];
            if (this.hasCrop()) {
              let e4 = je();
              i2.push(`<clipPath id="imageCrop_` + e4 + `">
`, `	<rect x="` + n2 + `" y="` + r2 + `" width="` + U(this.width) + `" height="` + U(this.height) + `" />
`, `</clipPath>
`), o2 = ` clip-path="url(#imageCrop_` + e4 + `)" `;
            }
            if (this.imageSmoothing || (s2 = ` image-rendering="optimizeSpeed"`), e3.push(`	<image `, `COMMON_PARTS`, `xlink:href="${U(this.getSrc(true))}" x="${n2 - this.cropX}" y="${r2 - this.cropY}" width="${t2.width || t2.naturalWidth}" height="${t2.height || t2.naturalHeight}"${s2}${o2}></image>
`), this.stroke || this.strokeDashArray) {
              let e4 = this.fill;
              this.fill = null, a2 = [`	<rect x="${n2}" y="${r2}" width="${U(this.width)}" height="${U(this.height)}" style="${this.getSvgStyles()}" />
`], this.fill = e4;
            }
            return i2 = this.paintFirst === `fill` ? i2.concat(e3, a2) : i2.concat(a2, e3), i2;
          }
          getSrc(e3) {
            let t2 = e3 ? this._element : this._originalElement;
            return t2 ? t2.toDataURL ? t2.toDataURL() : this.srcFromAttribute ? t2.getAttribute(`src`) || `` : t2.src : this.src || ``;
          }
          getSvgSrc(e3) {
            return this.getSrc(e3);
          }
          setSrc(e3, { crossOrigin: t2, signal: n2 } = {}) {
            return Ze(e3, { crossOrigin: t2, signal: n2 }).then((e4) => {
              t2 !== void 0 && this.set({ crossOrigin: t2 }), this.setElement(e4);
            });
          }
          toString() {
            return `#<Image: { src: "${this.getSrc()}" }>`;
          }
          applyResizeFilters() {
            let e3 = this.resizeFilter, t2 = this.minimumScaleTrigger, n2 = this.getTotalObjectScaling(), r2 = n2.x, i2 = n2.y, a2 = this._filteredEl || this._originalElement;
            if (this.group && this.set(`dirty`, true), !e3 || r2 > t2 && i2 > t2) return this._element = a2, this._filterScalingX = 1, this._filterScalingY = 1, this._lastScaleX = r2, void (this._lastScaleY = i2);
            let o2 = F(a2), { width: s2, height: c2 } = a2;
            this._element = o2, this._lastScaleX = e3.scaleX = r2, this._lastScaleY = e3.scaleY = i2, vs().applyFilters([e3], a2, s2, c2, this._element), this._filterScalingX = o2.width / this._originalElement.width, this._filterScalingY = o2.height / this._originalElement.height;
          }
          applyFilters(e3 = this.filters || []) {
            if (e3 = e3.filter((e4) => e4 && !e4.isNeutralState()), this.set(`dirty`, true), this.removeTexture(`${this.cacheKey}_filtered`), e3.length === 0) return this._element = this._originalElement, this._filteredEl = void 0, this._filterScalingX = 1, void (this._filterScalingY = 1);
            let t2 = this._originalElement, n2 = t2.naturalWidth || t2.width, r2 = t2.naturalHeight || t2.height;
            if (this._element === this._originalElement) {
              let e4 = F({ width: n2, height: r2 });
              this._element = e4, this._filteredEl = e4;
            } else this._filteredEl && (this._element = this._filteredEl, this._filteredEl.getContext(`2d`).clearRect(0, 0, n2, r2), this._lastScaleX = 1, this._lastScaleY = 1);
            vs().applyFilters(e3, this._originalElement, n2, r2, this._element, this.cacheKey), this._originalElement.width === this._element.width && this._originalElement.height === this._element.height || (this._filterScalingX = this._element.width / this._originalElement.width, this._filterScalingY = this._element.height / this._originalElement.height);
          }
          _render(e3) {
            e3.imageSmoothingEnabled = this.imageSmoothing, true !== this.isMoving && this.resizeFilter && this._needsResize() && this.applyResizeFilters(), this._stroke(e3), this._renderPaintInOrder(e3);
          }
          drawCacheOnCanvas(e3) {
            e3.imageSmoothingEnabled = this.imageSmoothing, super.drawCacheOnCanvas(e3);
          }
          shouldCache() {
            return this.needsItsOwnCache();
          }
          _renderFill(e3) {
            let t2 = this._element;
            if (!t2) return;
            let n2 = this._filterScalingX, r2 = this._filterScalingY, i2 = this.width, a2 = this.height, o2 = Math.max(this.cropX, 0), s2 = Math.max(this.cropY, 0), c2 = t2.naturalWidth || t2.width, l2 = t2.naturalHeight || t2.height, u2 = o2 * n2, d2 = s2 * r2, f2 = Math.min(i2 * n2, c2 - u2), p2 = Math.min(a2 * r2, l2 - d2), m2 = -i2 / 2, h2 = -a2 / 2, g2 = Math.min(i2, c2 / n2 - o2), _2 = Math.min(a2, l2 / r2 - s2);
            t2 && e3.drawImage(t2, u2, d2, f2, p2, m2, h2, g2, _2);
          }
          _needsResize() {
            let e3 = this.getTotalObjectScaling();
            return e3.x !== this._lastScaleX || e3.y !== this._lastScaleY;
          }
          _resetWidthHeight() {
            this.set(this.getOriginalSize());
          }
          _setWidthHeight({ width: e3, height: t2 } = {}) {
            let n2 = this.getOriginalSize();
            this.width = e3 || n2.width, this.height = t2 || n2.height;
          }
          parsePreserveAspectRatioAttribute() {
            let e3 = mn(this.preserveAspectRatio || ``), t2 = this.width, n2 = this.height, r2 = { width: t2, height: n2 }, i2, a2 = this._element.width, o2 = this._element.height, s2 = 1, c2 = 1, l2 = 0, u2 = 0, d2 = 0, f2 = 0;
            return !e3 || e3.alignX === `none` && e3.alignY === `none` ? (s2 = t2 / a2, c2 = n2 / o2) : (e3.meetOrSlice === `meet` && (s2 = c2 = ua(this._element, r2), i2 = (t2 - a2 * s2) / 2, e3.alignX === `Min` && (l2 = -i2), e3.alignX === `Max` && (l2 = i2), i2 = (n2 - o2 * c2) / 2, e3.alignY === `Min` && (u2 = -i2), e3.alignY === `Max` && (u2 = i2)), e3.meetOrSlice === `slice` && (s2 = c2 = da(this._element, r2), i2 = a2 - t2 / s2, e3.alignX === `Mid` && (d2 = i2 / 2), e3.alignX === `Max` && (d2 = i2), i2 = o2 - n2 / c2, e3.alignY === `Mid` && (f2 = i2 / 2), e3.alignY === `Max` && (f2 = i2), a2 = t2 / s2, o2 = n2 / c2)), { width: a2, height: o2, scaleX: s2, scaleY: c2, offsetLeft: l2, offsetTop: u2, cropX: d2, cropY: f2 };
          }
          static fromObject({ filters: e3, resizeFilter: t2, src: n2, crossOrigin: r2, type: i2, ...a2 }, o2) {
            return Promise.all([Ze(n2, { ...o2, crossOrigin: r2 }), e3 && Qe(e3, o2), t2 ? Qe([t2], o2) : [], $e(a2, o2)]).then(([e4, t3 = [], [r3], i3 = {}]) => new this(e4, { ...a2, src: n2, filters: t3, resizeFilter: r3, ...i3 }));
          }
          static fromURL(e3, { crossOrigin: t2 = null, signal: n2 } = {}, r2) {
            return Ze(e3, { crossOrigin: t2, signal: n2 }).then((e4) => new this(e4, r2));
          }
          static async fromElement(e3, t2 = {}, n2) {
            let r2 = Zi(e3, this.ATTRIBUTE_NAMES, n2);
            return this.fromURL(r2[`xlink:href`] || r2.href, t2, r2).catch((e4) => (c(`log`, `Unable to parse Image`, e4), null));
          }
        };
        function xs(e2) {
          if (!Fn.test(e2.nodeName)) return {};
          let t2 = e2.getAttribute(`viewBox`), n2, r2, i2 = 1, a2 = 1, o2 = e2.getAttribute(`width`), s2 = e2.getAttribute(`height`), c2 = e2.getAttribute(`x`) || 0, l2 = e2.getAttribute(`y`) || 0, u2 = !(t2 && Ln.test(t2)), d2 = !o2 || !s2 || o2 === `100%` || s2 === `100%`, f2 = ``, p2 = 0, m2 = 0;
          if (u2 && (c2 || l2) && e2.parentNode && e2.parentNode.nodeName !== `#document` && (f2 = ` translate(` + K(c2 || `0`) + ` ` + K(l2 || `0`) + `) `, n2 = (e2.getAttribute(`transform`) || ``) + f2, e2.setAttribute(`transform`, n2), e2.removeAttribute(`x`), e2.removeAttribute(`y`)), u2 && d2) return { width: 0, height: 0 };
          let h2 = { width: 0, height: 0 };
          if (u2) return h2.width = K(o2), h2.height = K(s2), h2;
          let g2 = t2.match(Ln), _2 = -parseFloat(g2[1]), v2 = -parseFloat(g2[2]), y2 = parseFloat(g2[3]), b2 = parseFloat(g2[4]);
          h2.minX = _2, h2.minY = v2, h2.viewBoxWidth = y2, h2.viewBoxHeight = b2, d2 ? (h2.width = y2, h2.height = b2) : (h2.width = K(o2), h2.height = K(s2), i2 = h2.width / y2, a2 = h2.height / b2);
          let x2 = mn(e2.getAttribute(`preserveAspectRatio`) || ``);
          if (x2.alignX !== `none` && (x2.meetOrSlice === `meet` && (a2 = i2 = i2 > a2 ? a2 : i2), x2.meetOrSlice === `slice` && (a2 = i2 = i2 > a2 ? i2 : a2), p2 = h2.width - y2 * i2, m2 = h2.height - b2 * i2, x2.alignX === `Mid` && (p2 /= 2), x2.alignY === `Mid` && (m2 /= 2), x2.alignX === `Min` && (p2 = 0), x2.alignY === `Min` && (m2 = 0)), i2 === 1 && a2 === 1 && _2 === 0 && v2 === 0 && c2 === 0 && l2 === 0) return h2;
          if ((c2 || l2) && e2.parentNode.nodeName !== `#document` && (f2 = ` translate(` + K(c2 || `0`) + ` ` + K(l2 || `0`) + `) `), n2 = f2 + ` matrix(` + i2 + ` 0 0 ` + a2 + ` ` + (_2 * i2 + p2) + ` ` + (v2 * a2 + m2) + `) `, e2.nodeName === `svg`) {
            for (r2 = e2.ownerDocument.createElementNS(kn, `g`); e2.firstChild; ) r2.appendChild(e2.firstChild);
            e2.appendChild(r2);
          } else r2 = e2, r2.removeAttribute(`x`), r2.removeAttribute(`y`), n2 = r2.getAttribute(`transform`) + n2;
          return r2.setAttribute(`transform`, n2), h2;
        }
        a(bs, `type`, `Image`), a(bs, `cacheProperties`, [...Un, ...ys]), a(bs, `ownDefaults`, { strokeWidth: 0, srcFromAttribute: false, minimumScaleTrigger: 0.5, cropX: 0, cropY: 0, imageSmoothing: true }), a(bs, `ATTRIBUTE_NAMES`, [...ki, `x`, `y`, `width`, `height`, `preserveAspectRatio`, `xlink:href`, `href`, `crossOrigin`, `image-rendering`]), M.setClass(bs), M.setSVGClass(bs);
        let Ss = (e2) => e2.tagName.replace(`svg:`, ``), Cs = _n([`pattern`, `defs`, `symbol`, `metadata`, `clipPath`, `mask`, `desc`]);
        function ws(e2, t2) {
          let n2, r2, i2, a2, o2 = [];
          for (i2 = 0, a2 = t2.length; i2 < a2; i2++) n2 = t2[i2], r2 = e2.getElementsByTagNameNS(`http://www.w3.org/2000/svg`, n2), o2 = o2.concat(Array.from(r2));
          return o2;
        }
        let Ts = [`gradientTransform`, `x1`, `x2`, `y1`, `y2`, `gradientUnits`, `cx`, `cy`, `r`, `fx`, `fy`], Es = `xlink:href`;
        function Ds(e2, t2) {
          var n2;
          let r2 = ((n2 = t2.getAttribute(Es)) == null ? void 0 : n2.slice(1)) || ``, i2 = e2.getElementById(r2);
          if (i2 && i2.getAttribute(Es) && Ds(e2, i2), i2 && (Ts.forEach((e3) => {
            let n3 = i2.getAttribute(e3);
            !t2.hasAttribute(e3) && n3 && t2.setAttribute(e3, n3);
          }), !t2.children.length)) {
            let e3 = i2.cloneNode(true);
            for (; e3.firstChild; ) t2.appendChild(e3.firstChild);
          }
          t2.removeAttribute(Es);
        }
        let Os = [`linearGradient`, `radialGradient`, `svg:linearGradient`, `svg:radialGradient`], ks = (e2) => M.getSVGClass(Ss(e2).toLowerCase());
        var As = class {
          constructor(e2, t2, n2, r2, i2) {
            this.elements = e2, this.options = t2, this.reviver = n2, this.regexUrl = /^url\(['"]?#([^'"]+)['"]?\)/g, this.doc = r2, this.clipPaths = i2, this.gradientDefs = function(e3) {
              let t3 = ws(e3, Os), n3 = {}, r3 = t3.length;
              for (; r3--; ) {
                let i3 = t3[r3];
                i3.getAttribute(`xlink:href`) && Ds(e3, i3);
                let a2 = i3.getAttribute(`id`);
                a2 && (n3[a2] = i3);
              }
              return n3;
            }(r2), this.cssRules = function(e3) {
              let t3 = e3.getElementsByTagName(`style`), n3 = {};
              for (let e4 = 0; e4 < t3.length; e4++) {
                let r3 = (t3[e4].textContent || ``).replace(/\/\*[\s\S]*?\*\//g, ``);
                r3.trim() !== `` && r3.split(`}`).filter((e5, t4, n4) => n4.length > 1 && e5.trim()).forEach((e5) => {
                  if ((e5.match(/{/g) || []).length > 1 && e5.trim().startsWith(`@`)) return;
                  let t4 = e5.split(`{`), r4 = {}, i3 = t4[1].trim().split(`;`).filter(function(e6) {
                    return e6.trim();
                  });
                  for (let e6 = 0; e6 < i3.length; e6++) {
                    let t5 = i3[e6].split(`:`), n4 = t5[0].trim();
                    r4[n4] = t5[1].trim();
                  }
                  (e5 = t4[0].trim()).split(`,`).forEach((e6) => {
                    (e6 = e6.replace(/^svg/i, ``).trim()) !== `` && (n3[e6] = { ...n3[e6] || {}, ...r4 });
                  });
                });
              }
              return n3;
            }(r2);
          }
          parse() {
            return Promise.all(this.elements.map((e2) => this.createObject(e2)));
          }
          async createObject(e2) {
            let t2 = ks(e2);
            if (t2) {
              let n2 = await t2.fromElement(e2, this.options, this.cssRules);
              return this.resolveGradient(n2, e2, j), this.resolveGradient(n2, e2, he), n2 instanceof bs && n2._originalElement ? Wa(n2, n2.parsePreserveAspectRatioAttribute()) : Wa(n2), await this.resolveClipPath(n2, e2), this.reviver && this.reviver(e2, n2), n2;
            }
            return null;
          }
          extractPropertyDefinition(e2, t2, n2) {
            let r2 = e2[t2], i2 = this.regexUrl;
            if (!i2.test(r2)) return;
            i2.lastIndex = 0;
            let a2 = i2.exec(r2)[1];
            return i2.lastIndex = 0, n2[a2];
          }
          resolveGradient(e2, t2, n2) {
            let r2 = this.extractPropertyDefinition(e2, n2, this.gradientDefs);
            if (r2) {
              let i2 = t2.getAttribute(n2 + `-opacity`), a2 = ko.fromElement(r2, e2, { ...this.options, opacity: i2 });
              e2.set(n2, a2);
            }
          }
          async resolveClipPath(e2, t2, n2) {
            let r2 = this.extractPropertyDefinition(e2, `clipPath`, this.clipPaths);
            if (r2) {
              let i2 = R(e2.calcTransformMatrix()), a2 = r2[0].parentElement, o2 = t2;
              for (; !n2 && o2.parentElement && o2.getAttribute(`clip-path`) !== e2.clipPath; ) o2 = o2.parentElement;
              o2.parentElement.appendChild(a2);
              let s2 = Ki(`${o2.getAttribute(`transform`) || ``} ${a2.getAttribute(`originalTransform`) || ``}`);
              a2.setAttribute(`transform`, `matrix(${s2.join(`,`)})`);
              let c2 = await Promise.all(r2.map((e3) => ks(e3).fromElement(e3, this.options, this.cssRules).then((e4) => (Wa(e4), e4.fillRule = e4.clipRule, delete e4.clipRule, e4)))), l2 = c2.length === 1 ? c2[0] : new ca(c2), u2 = z(i2, l2.calcTransformMatrix());
              l2.clipPath && await this.resolveClipPath(l2, o2, a2.getAttribute(`clip-path`) ? o2 : void 0);
              let { scaleX: d2, scaleY: f2, angle: p2, skewX: m2, translateX: h2, translateY: g2 } = He(u2);
              l2.set({ flipX: false, flipY: false }), l2.set({ scaleX: d2, scaleY: f2, angle: p2, skewX: m2, skewY: 0 }), l2.setPositionByOrigin(new N(h2, g2), E, E), e2.clipPath = l2;
            } else delete e2.clipPath;
          }
        };
        let js = (e2) => Pn.test(Ss(e2));
        async function Ms(e2, t2, { crossOrigin: n2, signal: r2 } = {}) {
          if (r2 && r2.aborted) return c(`log`, new u(`parseSVGDocument`)), { objects: [], elements: [], options: {}, allElements: [] };
          let i2 = e2.documentElement;
          (function(e3) {
            let t3 = ws(e3, [`use`, `svg:use`]), n3 = [`x`, `y`, `xlink:href`, `href`, `transform`];
            for (let r3 of t3) {
              let t4 = r3.attributes, i3 = {};
              for (let e4 of t4) e4.value && (i3[e4.name] = e4.value);
              let a3 = (i3[`xlink:href`] || i3.href || ``).slice(1);
              if (a3 === ``) return;
              let o3 = e3.getElementById(a3);
              if (o3 === null) return;
              let s3 = o3.cloneNode(true), c2 = s3.attributes, l3 = {};
              for (let e4 of c2) e4.value && (l3[e4.name] = e4.value);
              let { x: u2 = 0, y: d2 = 0, transform: f2 = `` } = i3, p2 = `${f2} ${l3.transform || ``} translate(${u2}, ${d2})`;
              if (xs(s3), /^svg$/i.test(s3.nodeName)) {
                let e4 = s3.ownerDocument.createElementNS(kn, `g`);
                Object.entries(l3).forEach(([t5, n4]) => e4.setAttributeNS(kn, t5, n4)), e4.append(...s3.childNodes), s3 = e4;
              }
              for (let e4 of t4) {
                if (!e4) continue;
                let { name: t5, value: r4 } = e4;
                if (!n3.includes(t5)) if (t5 === `style`) {
                  let e5 = {};
                  Ji(r4, e5), Object.entries(l3).forEach(([t6, n5]) => {
                    e5[t6] = n5;
                  }), Ji(l3.style || ``, e5);
                  let n4 = Object.entries(e5).map((e6) => e6.join(`:`)).join(`;`);
                  s3.setAttribute(t5, n4);
                } else !l3[t5] && s3.setAttribute(t5, r4);
              }
              s3.setAttribute(`transform`, p2), s3.setAttribute(`instantiated_by_use`, `1`), s3.removeAttribute(`id`), r3.parentNode.replaceChild(s3, r3);
            }
          })(e2);
          let a2 = Array.from(i2.getElementsByTagName(`*`)), o2 = { ...xs(i2), crossOrigin: n2, signal: r2 }, s2 = a2.filter((e3) => (xs(e3), js(e3) && !function(e4) {
            let t3 = e4;
            for (; t3 && (t3 = t3.parentElement); ) if (t3 && t3.nodeName && Cs.test(Ss(t3)) && !t3.getAttribute(`instantiated_by_use`)) return true;
            return false;
          }(e3)));
          if (!s2 || s2 && !s2.length) return { objects: [], elements: [], options: {}, allElements: [], options: o2, allElements: a2 };
          let l2 = {};
          return a2.filter((e3) => Ss(e3) === `clipPath`).forEach((e3) => {
            e3.setAttribute(`originalTransform`, e3.getAttribute(`transform`) || ``);
            let t3 = e3.getAttribute(`id`);
            l2[t3] = Array.from(e3.getElementsByTagName(`*`)).filter((e4) => js(e4));
          }), { objects: await new As(s2, o2, t2, e2, l2).parse(), elements: s2, options: o2, allElements: a2 };
        }
        function Ns(e2, t2, n2) {
          return Ms(new (_()).DOMParser().parseFromString(e2.trim(), `text/xml`), t2, n2);
        }
        let Ps = (e2) => e2.webgl !== void 0, Fs = `precision highp float`, Is = `
    ${Fs};
    varying vec2 vTexCoord;
    uniform sampler2D uTexture;
    void main() {
      gl_FragColor = texture2D(uTexture, vTexCoord);
    }`, Ls = new RegExp(Fs, `g`);
        var $ = class {
          get type() {
            return this.constructor.type;
          }
          constructor({ type: e2, ...t2 } = {}) {
            Object.assign(this, this.constructor.defaults, t2);
          }
          getFragmentSource() {
            return Is;
          }
          getVertexSource() {
            return `
    attribute vec2 aPosition;
    varying vec2 vTexCoord;
    void main() {
      vTexCoord = aPosition;
      gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
    }`;
          }
          createProgram(e2, t2 = this.getFragmentSource(), n2 = this.getVertexSource()) {
            let { WebGLProbe: { GLPrecision: r2 = `highp` } } = h();
            r2 !== `highp` && (t2 = t2.replace(Ls, Fs.replace(`highp`, r2)));
            let i2 = e2.createShader(e2.VERTEX_SHADER), a2 = e2.createShader(e2.FRAGMENT_SHADER), o2 = e2.createProgram();
            if (!i2 || !a2 || !o2) throw new l(`Vertex, fragment shader or program creation error`);
            if (e2.shaderSource(i2, n2), e2.compileShader(i2), !e2.getShaderParameter(i2, e2.COMPILE_STATUS)) throw new l(`Vertex shader compile error for ${this.type}: ${e2.getShaderInfoLog(i2)}`);
            if (e2.shaderSource(a2, t2), e2.compileShader(a2), !e2.getShaderParameter(a2, e2.COMPILE_STATUS)) throw new l(`Fragment shader compile error for ${this.type}: ${e2.getShaderInfoLog(a2)}`);
            if (e2.attachShader(o2, i2), e2.attachShader(o2, a2), e2.linkProgram(o2), !e2.getProgramParameter(o2, e2.LINK_STATUS)) throw new l(`Shader link error for "${this.type}" ${e2.getProgramInfoLog(o2)}`);
            let s2 = this.getUniformLocations(e2, o2) || {};
            return s2.uStepW = e2.getUniformLocation(o2, `uStepW`), s2.uStepH = e2.getUniformLocation(o2, `uStepH`), { program: o2, attributeLocations: this.getAttributeLocations(e2, o2), uniformLocations: s2 };
          }
          getAttributeLocations(e2, t2) {
            return { aPosition: e2.getAttribLocation(t2, `aPosition`) };
          }
          getUniformLocations(e2, t2) {
            let n2 = this.constructor.uniformLocations, r2 = {};
            for (let i2 = 0; i2 < n2.length; i2++) r2[n2[i2]] = e2.getUniformLocation(t2, n2[i2]);
            return r2;
          }
          sendAttributeData(e2, t2, n2) {
            let r2 = t2.aPosition, i2 = e2.createBuffer();
            e2.bindBuffer(e2.ARRAY_BUFFER, i2), e2.enableVertexAttribArray(r2), e2.vertexAttribPointer(r2, 2, e2.FLOAT, false, 0, 0), e2.bufferData(e2.ARRAY_BUFFER, n2, e2.STATIC_DRAW);
          }
          _setupFrameBuffer(e2) {
            let t2 = e2.context;
            if (e2.passes > 1) {
              let n2 = e2.destinationWidth, r2 = e2.destinationHeight;
              e2.sourceWidth === n2 && e2.sourceHeight === r2 || (t2.deleteTexture(e2.targetTexture), e2.targetTexture = e2.filterBackend.createTexture(t2, n2, r2)), t2.framebufferTexture2D(t2.FRAMEBUFFER, t2.COLOR_ATTACHMENT0, t2.TEXTURE_2D, e2.targetTexture, 0);
            } else t2.bindFramebuffer(t2.FRAMEBUFFER, null), t2.finish();
          }
          _swapTextures(e2) {
            e2.passes--, e2.pass++;
            let t2 = e2.targetTexture;
            e2.targetTexture = e2.sourceTexture, e2.sourceTexture = t2;
          }
          isNeutralState(e2) {
            return false;
          }
          applyTo(e2) {
            Ps(e2) ? (this._setupFrameBuffer(e2), this.applyToWebGL(e2), this._swapTextures(e2)) : this.applyTo2d(e2);
          }
          applyTo2d(e2) {
          }
          getCacheKey() {
            return this.type;
          }
          retrieveShader(e2) {
            let t2 = this.getCacheKey();
            return e2.programCache[t2] || (e2.programCache[t2] = this.createProgram(e2.context)), e2.programCache[t2];
          }
          applyToWebGL(e2) {
            let t2 = e2.context, n2 = this.retrieveShader(e2);
            e2.pass === 0 && e2.originalTexture ? t2.bindTexture(t2.TEXTURE_2D, e2.originalTexture) : t2.bindTexture(t2.TEXTURE_2D, e2.sourceTexture), t2.useProgram(n2.program), this.sendAttributeData(t2, n2.attributeLocations, e2.aPosition), t2.uniform1f(n2.uniformLocations.uStepW, 1 / e2.sourceWidth), t2.uniform1f(n2.uniformLocations.uStepH, 1 / e2.sourceHeight), this.sendUniformData(t2, n2.uniformLocations), t2.viewport(0, 0, e2.destinationWidth, e2.destinationHeight), t2.drawArrays(t2.TRIANGLE_STRIP, 0, 4);
          }
          bindAdditionalTexture(e2, t2, n2) {
            e2.activeTexture(n2), e2.bindTexture(e2.TEXTURE_2D, t2), e2.activeTexture(e2.TEXTURE0);
          }
          unbindAdditionalTexture(e2, t2) {
            e2.activeTexture(t2), e2.bindTexture(e2.TEXTURE_2D, null), e2.activeTexture(e2.TEXTURE0);
          }
          sendUniformData(e2, t2) {
          }
          createHelpLayer(e2) {
            if (!e2.helpLayer) {
              let { sourceWidth: t2, sourceHeight: n2 } = e2;
              e2.helpLayer = F({ width: t2, height: n2 });
            }
          }
          toObject() {
            let e2 = Object.keys(this.constructor.defaults || {});
            return { type: this.type, ...e2.reduce((e3, t2) => (e3[t2] = this[t2], e3), {}) };
          }
          toJSON() {
            return this.toObject();
          }
          static async fromObject({ type: e2, ...t2 }, n2) {
            return new this(t2);
          }
        };
        a($, `type`, `BaseFilter`), a($, `uniformLocations`, []);
        let Rs = { multiply: `gl_FragColor.rgb *= uColor.rgb;
`, screen: `gl_FragColor.rgb = 1.0 - (1.0 - gl_FragColor.rgb) * (1.0 - uColor.rgb);
`, add: `gl_FragColor.rgb += uColor.rgb;
`, difference: `gl_FragColor.rgb = abs(gl_FragColor.rgb - uColor.rgb);
`, subtract: `gl_FragColor.rgb -= uColor.rgb;
`, lighten: `gl_FragColor.rgb = max(gl_FragColor.rgb, uColor.rgb);
`, darken: `gl_FragColor.rgb = min(gl_FragColor.rgb, uColor.rgb);
`, exclusion: `gl_FragColor.rgb += uColor.rgb - 2.0 * (uColor.rgb * gl_FragColor.rgb);
`, overlay: `
    if (uColor.r < 0.5) {
      gl_FragColor.r *= 2.0 * uColor.r;
    } else {
      gl_FragColor.r = 1.0 - 2.0 * (1.0 - gl_FragColor.r) * (1.0 - uColor.r);
    }
    if (uColor.g < 0.5) {
      gl_FragColor.g *= 2.0 * uColor.g;
    } else {
      gl_FragColor.g = 1.0 - 2.0 * (1.0 - gl_FragColor.g) * (1.0 - uColor.g);
    }
    if (uColor.b < 0.5) {
      gl_FragColor.b *= 2.0 * uColor.b;
    } else {
      gl_FragColor.b = 1.0 - 2.0 * (1.0 - gl_FragColor.b) * (1.0 - uColor.b);
    }
    `, tint: `
    gl_FragColor.rgb *= (1.0 - uColor.a);
    gl_FragColor.rgb += uColor.rgb;
    ` };
        var zs = class extends $ {
          getCacheKey() {
            return `${this.type}_${this.mode}`;
          }
          getFragmentSource() {
            return `
      precision highp float;
      uniform sampler2D uTexture;
      uniform vec4 uColor;
      varying vec2 vTexCoord;
      void main() {
        vec4 color = texture2D(uTexture, vTexCoord);
        gl_FragColor = color;
        if (color.a > 0.0) {
          ${Rs[this.mode]}
        }
      }
      `;
          }
          applyTo2d({ imageData: { data: e2 } }) {
            let t2 = new G(this.color).getSource(), n2 = this.alpha, r2 = t2[0] * n2, i2 = t2[1] * n2, a2 = t2[2] * n2, o2 = 1 - n2;
            for (let t3 = 0; t3 < e2.length; t3 += 4) {
              let n3 = e2[t3], s2 = e2[t3 + 1], c2 = e2[t3 + 2], l2, u2, d2;
              switch (this.mode) {
                case `multiply`:
                  l2 = n3 * r2 / 255, u2 = s2 * i2 / 255, d2 = c2 * a2 / 255;
                  break;
                case `screen`:
                  l2 = 255 - (255 - n3) * (255 - r2) / 255, u2 = 255 - (255 - s2) * (255 - i2) / 255, d2 = 255 - (255 - c2) * (255 - a2) / 255;
                  break;
                case `add`:
                  l2 = n3 + r2, u2 = s2 + i2, d2 = c2 + a2;
                  break;
                case `difference`:
                  l2 = Math.abs(n3 - r2), u2 = Math.abs(s2 - i2), d2 = Math.abs(c2 - a2);
                  break;
                case `subtract`:
                  l2 = n3 - r2, u2 = s2 - i2, d2 = c2 - a2;
                  break;
                case `darken`:
                  l2 = Math.min(n3, r2), u2 = Math.min(s2, i2), d2 = Math.min(c2, a2);
                  break;
                case `lighten`:
                  l2 = Math.max(n3, r2), u2 = Math.max(s2, i2), d2 = Math.max(c2, a2);
                  break;
                case `overlay`:
                  l2 = r2 < 128 ? 2 * n3 * r2 / 255 : 255 - 2 * (255 - n3) * (255 - r2) / 255, u2 = i2 < 128 ? 2 * s2 * i2 / 255 : 255 - 2 * (255 - s2) * (255 - i2) / 255, d2 = a2 < 128 ? 2 * c2 * a2 / 255 : 255 - 2 * (255 - c2) * (255 - a2) / 255;
                  break;
                case `exclusion`:
                  l2 = r2 + n3 - 2 * r2 * n3 / 255, u2 = i2 + s2 - 2 * i2 * s2 / 255, d2 = a2 + c2 - 2 * a2 * c2 / 255;
                  break;
                case `tint`:
                  l2 = r2 + n3 * o2, u2 = i2 + s2 * o2, d2 = a2 + c2 * o2;
              }
              e2[t3] = l2, e2[t3 + 1] = u2, e2[t3 + 2] = d2;
            }
          }
          sendUniformData(e2, t2) {
            let n2 = new G(this.color).getSource();
            n2[0] = this.alpha * n2[0] / 255, n2[1] = this.alpha * n2[1] / 255, n2[2] = this.alpha * n2[2] / 255, n2[3] = this.alpha, e2.uniform4fv(t2.uColor, n2);
          }
        };
        a(zs, `defaults`, { color: `#F95C63`, mode: `multiply`, alpha: 1 }), a(zs, `type`, `BlendColor`), a(zs, `uniformLocations`, [`uColor`]), M.setClass(zs);
        let Bs = { multiply: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform sampler2D uImage;
    uniform vec4 uColor;
    varying vec2 vTexCoord;
    varying vec2 vTexCoord2;
    void main() {
      vec4 color = texture2D(uTexture, vTexCoord);
      vec4 color2 = texture2D(uImage, vTexCoord2);
      color.rgba *= color2.rgba;
      gl_FragColor = color;
    }
    `, mask: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform sampler2D uImage;
    uniform vec4 uColor;
    varying vec2 vTexCoord;
    varying vec2 vTexCoord2;
    void main() {
      vec4 color = texture2D(uTexture, vTexCoord);
      vec4 color2 = texture2D(uImage, vTexCoord2);
      color.a = color2.a;
      gl_FragColor = color;
    }
    ` };
        var Vs = class extends $ {
          getCacheKey() {
            return `${this.type}_${this.mode}`;
          }
          getFragmentSource() {
            return Bs[this.mode];
          }
          getVertexSource() {
            return `
    attribute vec2 aPosition;
    varying vec2 vTexCoord;
    varying vec2 vTexCoord2;
    uniform mat3 uTransformMatrix;
    void main() {
      vTexCoord = aPosition;
      vTexCoord2 = (uTransformMatrix * vec3(aPosition, 1.0)).xy;
      gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
    }
    `;
          }
          applyToWebGL(e2) {
            let t2 = e2.context, n2 = this.createTexture(e2.filterBackend, this.image);
            this.bindAdditionalTexture(t2, n2, t2.TEXTURE1), super.applyToWebGL(e2), this.unbindAdditionalTexture(t2, t2.TEXTURE1);
          }
          createTexture(e2, t2) {
            return e2.getCachedTexture(t2.cacheKey, t2.getElement());
          }
          calculateMatrix() {
            let e2 = this.image, { width: t2, height: n2 } = e2.getElement();
            return [1 / e2.scaleX, 0, 0, 0, 1 / e2.scaleY, 0, -e2.left / t2, -e2.top / n2, 1];
          }
          applyTo2d({ imageData: { data: e2, width: t2, height: n2 }, filterBackend: { resources: r2 } }) {
            let i2 = this.image;
            r2.blendImage || (r2.blendImage = P());
            let a2 = r2.blendImage, o2 = a2.getContext(`2d`);
            a2.width !== t2 || a2.height !== n2 ? (a2.width = t2, a2.height = n2) : o2.clearRect(0, 0, t2, n2), o2.setTransform(i2.scaleX, 0, 0, i2.scaleY, i2.left, i2.top), o2.drawImage(i2.getElement(), 0, 0, t2, n2);
            let s2 = o2.getImageData(0, 0, t2, n2).data;
            for (let t3 = 0; t3 < e2.length; t3 += 4) {
              let n3 = e2[t3], r3 = e2[t3 + 1], i3 = e2[t3 + 2], a3 = e2[t3 + 3], o3 = s2[t3], c2 = s2[t3 + 1], l2 = s2[t3 + 2], u2 = s2[t3 + 3];
              switch (this.mode) {
                case `multiply`:
                  e2[t3] = n3 * o3 / 255, e2[t3 + 1] = r3 * c2 / 255, e2[t3 + 2] = i3 * l2 / 255, e2[t3 + 3] = a3 * u2 / 255;
                  break;
                case `mask`:
                  e2[t3 + 3] = u2;
              }
            }
          }
          sendUniformData(e2, t2) {
            let n2 = this.calculateMatrix();
            e2.uniform1i(t2.uImage, 1), e2.uniformMatrix3fv(t2.uTransformMatrix, false, n2);
          }
          toObject() {
            return { ...super.toObject(), image: this.image && this.image.toObject() };
          }
          static async fromObject({ type: e2, image: t2, ...n2 }, r2) {
            return bs.fromObject(t2, r2).then((e3) => new this({ ...n2, image: e3 }));
          }
        };
        a(Vs, `type`, `BlendImage`), a(Vs, `defaults`, { mode: `multiply`, alpha: 1 }), a(Vs, `uniformLocations`, [`uTransformMatrix`, `uImage`]), M.setClass(Vs);
        var Hs = class extends $ {
          getFragmentSource() {
            return `
    precision highp float;
    uniform sampler2D uTexture;
    uniform vec2 uDelta;
    varying vec2 vTexCoord;
    const float nSamples = 15.0;
    vec3 v3offset = vec3(12.9898, 78.233, 151.7182);
    float random(vec3 scale) {
      /* use the fragment position for a different seed per-pixel */
      return fract(sin(dot(gl_FragCoord.xyz, scale)) * 43758.5453);
    }
    void main() {
      vec4 color = vec4(0.0);
      float totalC = 0.0;
      float totalA = 0.0;
      float offset = random(v3offset);
      for (float t = -nSamples; t <= nSamples; t++) {
        float percent = (t + offset - 0.5) / nSamples;
        vec4 sample = texture2D(uTexture, vTexCoord + uDelta * percent);
        float weight = 1.0 - abs(percent);
        float alpha = weight * sample.a;
        color.rgb += sample.rgb * alpha;
        color.a += alpha;
        totalA += weight;
        totalC += alpha;
      }
      gl_FragColor.rgb = color.rgb / totalC;
      gl_FragColor.a = color.a / totalA;
    }
  `;
          }
          applyTo(e2) {
            Ps(e2) ? (this.aspectRatio = e2.sourceWidth / e2.sourceHeight, e2.passes++, this._setupFrameBuffer(e2), this.horizontal = true, this.applyToWebGL(e2), this._swapTextures(e2), this._setupFrameBuffer(e2), this.horizontal = false, this.applyToWebGL(e2), this._swapTextures(e2)) : this.applyTo2d(e2);
          }
          applyTo2d({ imageData: { data: e2, width: t2, height: n2 } }) {
            this.aspectRatio = t2 / n2, this.horizontal = true;
            let r2 = this.getBlurValue() * t2, i2 = new Uint8ClampedArray(e2), a2 = 4 * t2;
            for (let t3 = 0; t3 < e2.length; t3 += 4) {
              let n3 = 0, o2 = 0, s2 = 0, c2 = 0, l2 = 0, u2 = t3 - t3 % a2, d2 = u2 + a2;
              for (let i3 = -14; i3 < 15; i3++) {
                let a3 = i3 / 15, f2 = 4 * Math.floor(r2 * a3), p2 = 1 - Math.abs(a3), m2 = t3 + f2;
                m2 < u2 ? m2 = u2 : m2 > d2 && (m2 = d2);
                let h2 = e2[m2 + 3] * p2;
                n3 += e2[m2] * h2, o2 += e2[m2 + 1] * h2, s2 += e2[m2 + 2] * h2, c2 += h2, l2 += p2;
              }
              i2[t3] = n3 / c2, i2[t3 + 1] = o2 / c2, i2[t3 + 2] = s2 / c2, i2[t3 + 3] = c2 / l2;
            }
            this.horizontal = false, r2 = this.getBlurValue() * n2;
            for (let t3 = 0; t3 < i2.length; t3 += 4) {
              let n3 = 0, o2 = 0, s2 = 0, c2 = 0, l2 = 0, u2 = t3 % a2, d2 = i2.length - a2 + u2;
              for (let e3 = -14; e3 < 15; e3++) {
                let f2 = e3 / 15, p2 = Math.floor(r2 * f2) * a2, m2 = 1 - Math.abs(f2), h2 = t3 + p2;
                h2 < u2 ? h2 = u2 : h2 > d2 && (h2 = d2);
                let g2 = i2[h2 + 3] * m2;
                n3 += i2[h2] * g2, o2 += i2[h2 + 1] * g2, s2 += i2[h2 + 2] * g2, c2 += g2, l2 += m2;
              }
              e2[t3] = n3 / c2, e2[t3 + 1] = o2 / c2, e2[t3 + 2] = s2 / c2, e2[t3 + 3] = c2 / l2;
            }
          }
          sendUniformData(e2, t2) {
            let n2 = this.chooseRightDelta();
            e2.uniform2fv(t2.uDelta, n2);
          }
          isNeutralState() {
            return this.blur === 0;
          }
          getBlurValue() {
            let e2 = 1, { horizontal: t2, aspectRatio: n2 } = this;
            return t2 ? n2 > 1 && (e2 = 1 / n2) : n2 < 1 && (e2 = n2), e2 * this.blur * 0.12;
          }
          chooseRightDelta() {
            let e2 = this.getBlurValue();
            return this.horizontal ? [e2, 0] : [0, e2];
          }
        };
        a(Hs, `type`, `Blur`), a(Hs, `defaults`, { blur: 0 }), a(Hs, `uniformLocations`, [`uDelta`]), M.setClass(Hs);
        var Us = class extends $ {
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uBrightness;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    color.rgb += uBrightness;
    gl_FragColor = color;
  }
`;
          }
          applyTo2d({ imageData: { data: e2 } }) {
            let t2 = Math.round(255 * this.brightness);
            for (let n2 = 0; n2 < e2.length; n2 += 4) e2[n2] += t2, e2[n2 + 1] += t2, e2[n2 + 2] += t2;
          }
          isNeutralState() {
            return this.brightness === 0;
          }
          sendUniformData(e2, t2) {
            e2.uniform1f(t2.uBrightness, this.brightness);
          }
        };
        a(Us, `type`, `Brightness`), a(Us, `defaults`, { brightness: 0 }), a(Us, `uniformLocations`, [`uBrightness`]), M.setClass(Us);
        let Ws = { matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0], colorsOnly: true };
        var Gs = class extends $ {
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  varying vec2 vTexCoord;
  uniform mat4 uColorMatrix;
  uniform vec4 uConstants;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    color *= uColorMatrix;
    color += uConstants;
    gl_FragColor = color;
  }`;
          }
          applyTo2d(e2) {
            let t2 = e2.imageData.data, n2 = this.matrix, r2 = this.colorsOnly;
            for (let e3 = 0; e3 < t2.length; e3 += 4) {
              let i2 = t2[e3], a2 = t2[e3 + 1], o2 = t2[e3 + 2];
              if (t2[e3] = i2 * n2[0] + a2 * n2[1] + o2 * n2[2] + 255 * n2[4], t2[e3 + 1] = i2 * n2[5] + a2 * n2[6] + o2 * n2[7] + 255 * n2[9], t2[e3 + 2] = i2 * n2[10] + a2 * n2[11] + o2 * n2[12] + 255 * n2[14], !r2) {
                let r3 = t2[e3 + 3];
                t2[e3] += r3 * n2[3], t2[e3 + 1] += r3 * n2[8], t2[e3 + 2] += r3 * n2[13], t2[e3 + 3] = i2 * n2[15] + a2 * n2[16] + o2 * n2[17] + r3 * n2[18] + 255 * n2[19];
              }
            }
          }
          sendUniformData(e2, t2) {
            let n2 = this.matrix, r2 = [n2[0], n2[1], n2[2], n2[3], n2[5], n2[6], n2[7], n2[8], n2[10], n2[11], n2[12], n2[13], n2[15], n2[16], n2[17], n2[18]], i2 = [n2[4], n2[9], n2[14], n2[19]];
            e2.uniformMatrix4fv(t2.uColorMatrix, false, r2), e2.uniform4fv(t2.uConstants, i2);
          }
          toObject() {
            return { ...super.toObject(), matrix: [...this.matrix] };
          }
        };
        function Ks(e2, t2) {
          var n2;
          let r2 = (a(n2 = class extends Gs {
            toObject() {
              return { type: this.type, colorsOnly: this.colorsOnly };
            }
          }, `type`, e2), a(n2, `defaults`, { colorsOnly: false, matrix: t2 }), n2);
          return M.setClass(r2, e2), r2;
        }
        a(Gs, `type`, `ColorMatrix`), a(Gs, `defaults`, Ws), a(Gs, `uniformLocations`, [`uColorMatrix`, `uConstants`]), M.setClass(Gs);
        let qs = Ks(`Brownie`, [0.5997, 0.34553, -0.27082, 0, 0.186, -0.0377, 0.86095, 0.15059, 0, -0.1449, 0.24113, -0.07441, 0.44972, 0, -0.02965, 0, 0, 0, 1, 0]), Js = Ks(`Vintage`, [0.62793, 0.32021, -0.03965, 0, 0.03784, 0.02578, 0.64411, 0.03259, 0, 0.02926, 0.0466, -0.08512, 0.52416, 0, 0.02023, 0, 0, 0, 1, 0]), Ys = Ks(`Kodachrome`, [1.12855, -0.39673, -0.03992, 0, 0.24991, -0.16404, 1.08352, -0.05498, 0, 0.09698, -0.16786, -0.56034, 1.60148, 0, 0.13972, 0, 0, 0, 1, 0]), Xs = Ks(`Technicolor`, [1.91252, -0.85453, -0.09155, 0, 0.04624, -0.30878, 1.76589, -0.10601, 0, -0.27589, -0.2311, -0.75018, 1.84759, 0, 0.12137, 0, 0, 0, 1, 0]), Zs = Ks(`Polaroid`, [1.438, -0.062, -0.062, 0, 0, -0.122, 1.378, -0.122, 0, 0, -0.016, -0.016, 1.483, 0, 0, 0, 0, 0, 1, 0]), Qs = Ks(`Sepia`, [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0]), $s = Ks(`BlackWhite`, [1.5, 1.5, 1.5, 0, -1, 1.5, 1.5, 1.5, 0, -1, 1.5, 1.5, 1.5, 0, -1, 0, 0, 0, 1, 0]);
        var ec = class extends $ {
          constructor(e2 = {}) {
            super(e2), this.subFilters = e2.subFilters || [];
          }
          applyTo(e2) {
            Ps(e2) && (e2.passes += this.subFilters.length - 1), this.subFilters.forEach((t2) => {
              t2.applyTo(e2);
            });
          }
          toObject() {
            return { type: this.type, subFilters: this.subFilters.map((e2) => e2.toObject()) };
          }
          isNeutralState() {
            return !this.subFilters.some((e2) => !e2.isNeutralState());
          }
          static fromObject(e2, t2) {
            return Promise.all((e2.subFilters || []).map((e3) => M.getClass(e3.type).fromObject(e3, t2))).then((e3) => new this({ subFilters: e3 }));
          }
        };
        a(ec, `type`, `Composed`), M.setClass(ec);
        var tc = class extends $ {
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uContrast;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    float contrastF = 1.015 * (uContrast + 1.0) / (1.0 * (1.015 - uContrast));
    color.rgb = contrastF * (color.rgb - 0.5) + 0.5;
    gl_FragColor = color;
  }`;
          }
          isNeutralState() {
            return this.contrast === 0;
          }
          applyTo2d({ imageData: { data: e2 } }) {
            let t2 = Math.floor(255 * this.contrast), n2 = 259 * (t2 + 255) / (255 * (259 - t2));
            for (let t3 = 0; t3 < e2.length; t3 += 4) e2[t3] = n2 * (e2[t3] - 128) + 128, e2[t3 + 1] = n2 * (e2[t3 + 1] - 128) + 128, e2[t3 + 2] = n2 * (e2[t3 + 2] - 128) + 128;
          }
          sendUniformData(e2, t2) {
            e2.uniform1f(t2.uContrast, this.contrast);
          }
        };
        a(tc, `type`, `Contrast`), a(tc, `defaults`, { contrast: 0 }), a(tc, `uniformLocations`, [`uContrast`]), M.setClass(tc);
        let nc = { Convolute_3_1: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[9];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 0);
      for (float h = 0.0; h < 3.0; h+=1.0) {
        for (float w = 0.0; w < 3.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 1), uStepH * (h - 1));
          color += texture2D(uTexture, vTexCoord + matrixPos) * uMatrix[int(h * 3.0 + w)];
        }
      }
      gl_FragColor = color;
    }
    `, Convolute_3_0: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[9];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 1);
      for (float h = 0.0; h < 3.0; h+=1.0) {
        for (float w = 0.0; w < 3.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 1.0), uStepH * (h - 1.0));
          color.rgb += texture2D(uTexture, vTexCoord + matrixPos).rgb * uMatrix[int(h * 3.0 + w)];
        }
      }
      float alpha = texture2D(uTexture, vTexCoord).a;
      gl_FragColor = color;
      gl_FragColor.a = alpha;
    }
    `, Convolute_5_1: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[25];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 0);
      for (float h = 0.0; h < 5.0; h+=1.0) {
        for (float w = 0.0; w < 5.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 2.0), uStepH * (h - 2.0));
          color += texture2D(uTexture, vTexCoord + matrixPos) * uMatrix[int(h * 5.0 + w)];
        }
      }
      gl_FragColor = color;
    }
    `, Convolute_5_0: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[25];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 1);
      for (float h = 0.0; h < 5.0; h+=1.0) {
        for (float w = 0.0; w < 5.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 2.0), uStepH * (h - 2.0));
          color.rgb += texture2D(uTexture, vTexCoord + matrixPos).rgb * uMatrix[int(h * 5.0 + w)];
        }
      }
      float alpha = texture2D(uTexture, vTexCoord).a;
      gl_FragColor = color;
      gl_FragColor.a = alpha;
    }
    `, Convolute_7_1: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[49];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 0);
      for (float h = 0.0; h < 7.0; h+=1.0) {
        for (float w = 0.0; w < 7.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 3.0), uStepH * (h - 3.0));
          color += texture2D(uTexture, vTexCoord + matrixPos) * uMatrix[int(h * 7.0 + w)];
        }
      }
      gl_FragColor = color;
    }
    `, Convolute_7_0: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[49];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 1);
      for (float h = 0.0; h < 7.0; h+=1.0) {
        for (float w = 0.0; w < 7.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 3.0), uStepH * (h - 3.0));
          color.rgb += texture2D(uTexture, vTexCoord + matrixPos).rgb * uMatrix[int(h * 7.0 + w)];
        }
      }
      float alpha = texture2D(uTexture, vTexCoord).a;
      gl_FragColor = color;
      gl_FragColor.a = alpha;
    }
    `, Convolute_9_1: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[81];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 0);
      for (float h = 0.0; h < 9.0; h+=1.0) {
        for (float w = 0.0; w < 9.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 4.0), uStepH * (h - 4.0));
          color += texture2D(uTexture, vTexCoord + matrixPos) * uMatrix[int(h * 9.0 + w)];
        }
      }
      gl_FragColor = color;
    }
    `, Convolute_9_0: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[81];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 1);
      for (float h = 0.0; h < 9.0; h+=1.0) {
        for (float w = 0.0; w < 9.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 4.0), uStepH * (h - 4.0));
          color.rgb += texture2D(uTexture, vTexCoord + matrixPos).rgb * uMatrix[int(h * 9.0 + w)];
        }
      }
      float alpha = texture2D(uTexture, vTexCoord).a;
      gl_FragColor = color;
      gl_FragColor.a = alpha;
    }
    ` };
        var rc = class extends $ {
          getCacheKey() {
            return `${this.type}_${Math.sqrt(this.matrix.length)}_${+!!this.opaque}`;
          }
          getFragmentSource() {
            return nc[this.getCacheKey()];
          }
          applyTo2d(e2) {
            let t2 = e2.imageData, n2 = t2.data, r2 = this.matrix, i2 = Math.round(Math.sqrt(r2.length)), a2 = Math.floor(i2 / 2), o2 = t2.width, s2 = t2.height, c2 = e2.ctx.createImageData(o2, s2), l2 = c2.data, u2 = +!!this.opaque, d2, f2, p2, m2, h2, g2, _2, v2, y2, b2, x2, S2, C2;
            for (x2 = 0; x2 < s2; x2++) for (b2 = 0; b2 < o2; b2++) {
              for (h2 = 4 * (x2 * o2 + b2), d2 = 0, f2 = 0, p2 = 0, m2 = 0, C2 = 0; C2 < i2; C2++) for (S2 = 0; S2 < i2; S2++) _2 = x2 + C2 - a2, g2 = b2 + S2 - a2, _2 < 0 || _2 >= s2 || g2 < 0 || g2 >= o2 || (v2 = 4 * (_2 * o2 + g2), y2 = r2[C2 * i2 + S2], d2 += n2[v2] * y2, f2 += n2[v2 + 1] * y2, p2 += n2[v2 + 2] * y2, u2 || (m2 += n2[v2 + 3] * y2));
              l2[h2] = d2, l2[h2 + 1] = f2, l2[h2 + 2] = p2, l2[h2 + 3] = u2 ? n2[h2 + 3] : m2;
            }
            e2.imageData = c2;
          }
          sendUniformData(e2, t2) {
            e2.uniform1fv(t2.uMatrix, this.matrix);
          }
          toObject() {
            return { ...super.toObject(), opaque: this.opaque, matrix: [...this.matrix] };
          }
        };
        a(rc, `type`, `Convolute`), a(rc, `defaults`, { opaque: false, matrix: [0, 0, 0, 0, 1, 0, 0, 0, 0] }), a(rc, `uniformLocations`, [`uMatrix`, `uOpaque`, `uHalfSize`, `uSize`]), M.setClass(rc);
        let ic = `Gamma`;
        var ac = class extends $ {
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform vec3 uGamma;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec3 correction = (1.0 / uGamma);
    color.r = pow(color.r, correction.r);
    color.g = pow(color.g, correction.g);
    color.b = pow(color.b, correction.b);
    gl_FragColor = color;
    gl_FragColor.rgb *= color.a;
  }
`;
          }
          constructor(e2 = {}) {
            super(e2), this.gamma = e2.gamma || this.constructor.defaults.gamma.concat();
          }
          applyTo2d({ imageData: { data: e2 } }) {
            let t2 = this.gamma, n2 = 1 / t2[0], r2 = 1 / t2[1], i2 = 1 / t2[2];
            this.rgbValues || (this.rgbValues = { r: new Uint8Array(256), g: new Uint8Array(256), b: new Uint8Array(256) });
            let a2 = this.rgbValues;
            for (let e3 = 0; e3 < 256; e3++) a2.r[e3] = 255 * (e3 / 255) ** n2, a2.g[e3] = 255 * (e3 / 255) ** r2, a2.b[e3] = 255 * (e3 / 255) ** i2;
            for (let t3 = 0; t3 < e2.length; t3 += 4) e2[t3] = a2.r[e2[t3]], e2[t3 + 1] = a2.g[e2[t3 + 1]], e2[t3 + 2] = a2.b[e2[t3 + 2]];
          }
          sendUniformData(e2, t2) {
            e2.uniform3fv(t2.uGamma, this.gamma);
          }
          isNeutralState() {
            let { gamma: e2 } = this;
            return e2[0] === 1 && e2[1] === 1 && e2[2] === 1;
          }
          toObject() {
            return { type: ic, gamma: this.gamma.concat() };
          }
        };
        a(ac, `type`, ic), a(ac, `defaults`, { gamma: [1, 1, 1] }), a(ac, `uniformLocations`, [`uGamma`]), M.setClass(ac);
        let oc = { average: `
    precision highp float;
    uniform sampler2D uTexture;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = texture2D(uTexture, vTexCoord);
      float average = (color.r + color.b + color.g) / 3.0;
      gl_FragColor = vec4(average, average, average, color.a);
    }
    `, lightness: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform int uMode;
    varying vec2 vTexCoord;
    void main() {
      vec4 col = texture2D(uTexture, vTexCoord);
      float average = (max(max(col.r, col.g),col.b) + min(min(col.r, col.g),col.b)) / 2.0;
      gl_FragColor = vec4(average, average, average, col.a);
    }
    `, luminosity: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform int uMode;
    varying vec2 vTexCoord;
    void main() {
      vec4 col = texture2D(uTexture, vTexCoord);
      float average = 0.21 * col.r + 0.72 * col.g + 0.07 * col.b;
      gl_FragColor = vec4(average, average, average, col.a);
    }
    ` };
        var sc = class extends $ {
          applyTo2d({ imageData: { data: e2 } }) {
            for (let t2, n2 = 0; n2 < e2.length; n2 += 4) {
              let r2 = e2[n2], i2 = e2[n2 + 1], a2 = e2[n2 + 2];
              switch (this.mode) {
                case `average`:
                  t2 = (r2 + i2 + a2) / 3;
                  break;
                case `lightness`:
                  t2 = (Math.min(r2, i2, a2) + Math.max(r2, i2, a2)) / 2;
                  break;
                case `luminosity`:
                  t2 = 0.21 * r2 + 0.72 * i2 + 0.07 * a2;
              }
              e2[n2 + 2] = e2[n2 + 1] = e2[n2] = t2;
            }
          }
          getCacheKey() {
            return `${this.type}_${this.mode}`;
          }
          getFragmentSource() {
            return oc[this.mode];
          }
          sendUniformData(e2, t2) {
            e2.uniform1i(t2.uMode, 1);
          }
          isNeutralState() {
            return false;
          }
        };
        a(sc, `type`, `Grayscale`), a(sc, `defaults`, { mode: `average` }), a(sc, `uniformLocations`, [`uMode`]), M.setClass(sc);
        let cc = { ...Ws, rotation: 0 };
        var lc = class extends Gs {
          calculateMatrix() {
            let e2 = this.rotation * Math.PI, t2 = Se(e2), n2 = Ce(e2), r2 = 1 / 3, i2 = Math.sqrt(r2) * n2, a2 = 1 - t2;
            this.matrix = [t2 + a2 / 3, r2 * a2 - i2, r2 * a2 + i2, 0, 0, r2 * a2 + i2, t2 + r2 * a2, r2 * a2 - i2, 0, 0, r2 * a2 - i2, r2 * a2 + i2, t2 + r2 * a2, 0, 0, 0, 0, 0, 1, 0];
          }
          isNeutralState() {
            return this.rotation === 0;
          }
          applyTo(e2) {
            this.calculateMatrix(), super.applyTo(e2);
          }
          toObject() {
            return { type: this.type, rotation: this.rotation };
          }
        };
        a(lc, `type`, `HueRotation`), a(lc, `defaults`, cc), M.setClass(lc);
        var uc = class extends $ {
          applyTo2d({ imageData: { data: e2 } }) {
            for (let t2 = 0; t2 < e2.length; t2 += 4) e2[t2] = 255 - e2[t2], e2[t2 + 1] = 255 - e2[t2 + 1], e2[t2 + 2] = 255 - e2[t2 + 2], this.alpha && (e2[t2 + 3] = 255 - e2[t2 + 3]);
          }
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform int uInvert;
  uniform int uAlpha;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    if (uInvert == 1) {
      if (uAlpha == 1) {
        gl_FragColor = vec4(1.0 - color.r,1.0 -color.g,1.0 -color.b,1.0 -color.a);
      } else {
        gl_FragColor = vec4(1.0 - color.r,1.0 -color.g,1.0 -color.b,color.a);
      }
    } else {
      gl_FragColor = color;
    }
  }
`;
          }
          isNeutralState() {
            return !this.invert;
          }
          sendUniformData(e2, t2) {
            e2.uniform1i(t2.uInvert, Number(this.invert)), e2.uniform1i(t2.uAlpha, Number(this.alpha));
          }
        };
        a(uc, `type`, `Invert`), a(uc, `defaults`, { alpha: false, invert: true }), a(uc, `uniformLocations`, [`uInvert`, `uAlpha`]), M.setClass(uc);
        var dc = class extends $ {
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uStepH;
  uniform float uNoise;
  uniform float uSeed;
  varying vec2 vTexCoord;
  float rand(vec2 co, float seed, float vScale) {
    return fract(sin(dot(co.xy * vScale ,vec2(12.9898 , 78.233))) * 43758.5453 * (seed + 0.01) / 2.0);
  }
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    color.rgb += (0.5 - rand(vTexCoord, uSeed, 0.1 / uStepH)) * uNoise;
    gl_FragColor = color;
  }
`;
          }
          applyTo2d({ imageData: { data: e2 } }) {
            let t2 = this.noise;
            for (let n2 = 0; n2 < e2.length; n2 += 4) {
              let r2 = (0.5 - Math.random()) * t2;
              e2[n2] += r2, e2[n2 + 1] += r2, e2[n2 + 2] += r2;
            }
          }
          sendUniformData(e2, t2) {
            e2.uniform1f(t2.uNoise, this.noise / 255), e2.uniform1f(t2.uSeed, Math.random());
          }
          isNeutralState() {
            return this.noise === 0;
          }
        };
        a(dc, `type`, `Noise`), a(dc, `defaults`, { noise: 0 }), a(dc, `uniformLocations`, [`uNoise`, `uSeed`]), M.setClass(dc);
        var fc = class extends $ {
          applyTo2d({ imageData: { data: e2, width: t2, height: n2 } }) {
            for (let r2 = 0; r2 < n2; r2 += this.blocksize) for (let i2 = 0; i2 < t2; i2 += this.blocksize) {
              let a2 = 4 * r2 * t2 + 4 * i2, o2 = e2[a2], s2 = e2[a2 + 1], c2 = e2[a2 + 2], l2 = e2[a2 + 3];
              for (let a3 = r2; a3 < Math.min(r2 + this.blocksize, n2); a3++) for (let n3 = i2; n3 < Math.min(i2 + this.blocksize, t2); n3++) {
                let r3 = 4 * a3 * t2 + 4 * n3;
                e2[r3] = o2, e2[r3 + 1] = s2, e2[r3 + 2] = c2, e2[r3 + 3] = l2;
              }
            }
          }
          isNeutralState() {
            return this.blocksize === 1;
          }
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uBlocksize;
  uniform float uStepW;
  uniform float uStepH;
  varying vec2 vTexCoord;
  void main() {
    float blockW = uBlocksize * uStepW;
    float blockH = uBlocksize * uStepH;
    int posX = int(vTexCoord.x / blockW);
    int posY = int(vTexCoord.y / blockH);
    float fposX = float(posX);
    float fposY = float(posY);
    vec2 squareCoords = vec2(fposX * blockW, fposY * blockH);
    vec4 color = texture2D(uTexture, squareCoords);
    gl_FragColor = color;
  }
`;
          }
          sendUniformData(e2, t2) {
            e2.uniform1f(t2.uBlocksize, this.blocksize);
          }
        };
        a(fc, `type`, `Pixelate`), a(fc, `defaults`, { blocksize: 4 }), a(fc, `uniformLocations`, [`uBlocksize`]), M.setClass(fc);
        var pc = class extends $ {
          getFragmentSource() {
            return `
precision highp float;
uniform sampler2D uTexture;
uniform vec4 uLow;
uniform vec4 uHigh;
varying vec2 vTexCoord;
void main() {
  gl_FragColor = texture2D(uTexture, vTexCoord);
  if(all(greaterThan(gl_FragColor.rgb,uLow.rgb)) && all(greaterThan(uHigh.rgb,gl_FragColor.rgb))) {
    gl_FragColor.a = 0.0;
  }
}
`;
          }
          applyTo2d({ imageData: { data: e2 } }) {
            let t2 = 255 * this.distance, n2 = new G(this.color).getSource(), r2 = [n2[0] - t2, n2[1] - t2, n2[2] - t2], i2 = [n2[0] + t2, n2[1] + t2, n2[2] + t2];
            for (let t3 = 0; t3 < e2.length; t3 += 4) {
              let n3 = e2[t3], a2 = e2[t3 + 1], o2 = e2[t3 + 2];
              n3 > r2[0] && a2 > r2[1] && o2 > r2[2] && n3 < i2[0] && a2 < i2[1] && o2 < i2[2] && (e2[t3 + 3] = 0);
            }
          }
          sendUniformData(e2, t2) {
            let n2 = new G(this.color).getSource(), r2 = this.distance, i2 = [0 + n2[0] / 255 - r2, 0 + n2[1] / 255 - r2, 0 + n2[2] / 255 - r2, 1], a2 = [n2[0] / 255 + r2, n2[1] / 255 + r2, n2[2] / 255 + r2, 1];
            e2.uniform4fv(t2.uLow, i2), e2.uniform4fv(t2.uHigh, a2);
          }
        };
        a(pc, `type`, `RemoveColor`), a(pc, `defaults`, { color: `#FFFFFF`, distance: 0.02, useAlpha: false }), a(pc, `uniformLocations`, [`uLow`, `uHigh`]), M.setClass(pc);
        var mc = class extends $ {
          sendUniformData(e2, t2) {
            e2.uniform2fv(t2.uDelta, this.horizontal ? [1 / this.width, 0] : [0, 1 / this.height]), e2.uniform1fv(t2.uTaps, this.taps);
          }
          getFilterWindow() {
            let e2 = this.tempScale;
            return Math.ceil(this.lanczosLobes / e2);
          }
          getCacheKey() {
            let e2 = this.getFilterWindow();
            return `${this.type}_${e2}`;
          }
          getFragmentSource() {
            let e2 = this.getFilterWindow();
            return this.generateShader(e2);
          }
          getTaps() {
            let e2 = this.lanczosCreate(this.lanczosLobes), t2 = this.tempScale, n2 = this.getFilterWindow(), r2 = Array(n2);
            for (let i2 = 1; i2 <= n2; i2++) r2[i2 - 1] = e2(i2 * t2);
            return r2;
          }
          generateShader(e2) {
            let t2 = Array(e2);
            for (let n2 = 1; n2 <= e2; n2++) t2[n2 - 1] = `${n2}.0 * uDelta`;
            return `
      precision highp float;
      uniform sampler2D uTexture;
      uniform vec2 uDelta;
      varying vec2 vTexCoord;
      uniform float uTaps[${e2}];
      void main() {
        vec4 color = texture2D(uTexture, vTexCoord);
        float sum = 1.0;
        ${t2.map((e3, t3) => `
              color += texture2D(uTexture, vTexCoord + ${e3}) * uTaps[${t3}] + texture2D(uTexture, vTexCoord - ${e3}) * uTaps[${t3}];
              sum += 2.0 * uTaps[${t3}];
            `).join(`
`)}
        gl_FragColor = color / sum;
      }
    `;
          }
          applyToForWebgl(e2) {
            e2.passes++, this.width = e2.sourceWidth, this.horizontal = true, this.dW = Math.round(this.width * this.scaleX), this.dH = e2.sourceHeight, this.tempScale = this.dW / this.width, this.taps = this.getTaps(), e2.destinationWidth = this.dW, super.applyTo(e2), e2.sourceWidth = e2.destinationWidth, this.height = e2.sourceHeight, this.horizontal = false, this.dH = Math.round(this.height * this.scaleY), this.tempScale = this.dH / this.height, this.taps = this.getTaps(), e2.destinationHeight = this.dH, super.applyTo(e2), e2.sourceHeight = e2.destinationHeight;
          }
          applyTo(e2) {
            Ps(e2) ? this.applyToForWebgl(e2) : this.applyTo2d(e2);
          }
          isNeutralState() {
            return this.scaleX === 1 && this.scaleY === 1;
          }
          lanczosCreate(e2) {
            return (t2) => {
              if (t2 >= e2 || t2 <= -e2) return 0;
              if (t2 < 11920929e-14 && t2 > -11920929e-14) return 1;
              let n2 = (t2 *= Math.PI) / e2;
              return Math.sin(t2) / t2 * Math.sin(n2) / n2;
            };
          }
          applyTo2d(e2) {
            let t2 = e2.imageData, n2 = this.scaleX, r2 = this.scaleY;
            this.rcpScaleX = 1 / n2, this.rcpScaleY = 1 / r2;
            let i2 = t2.width, a2 = t2.height, o2 = Math.round(i2 * n2), s2 = Math.round(a2 * r2), c2;
            c2 = this.resizeType === `sliceHack` ? this.sliceByTwo(e2, i2, a2, o2, s2) : this.resizeType === `hermite` ? this.hermiteFastResize(e2, i2, a2, o2, s2) : this.resizeType === `bilinear` ? this.bilinearFiltering(e2, i2, a2, o2, s2) : this.resizeType === `lanczos` ? this.lanczosResize(e2, i2, a2, o2, s2) : new ImageData(o2, s2), e2.imageData = c2;
          }
          sliceByTwo(e2, t2, n2, r2, i2) {
            let a2 = e2.imageData, o2 = 0.5, s2 = false, c2 = false, l2 = t2 * o2, u2 = n2 * o2, d2 = e2.filterBackend.resources, f2 = 0, p2 = 0, m2 = t2, h2 = 0;
            d2.sliceByTwo || (d2.sliceByTwo = P());
            let g2 = d2.sliceByTwo;
            (g2.width < 1.5 * t2 || g2.height < n2) && (g2.width = 1.5 * t2, g2.height = n2);
            let _2 = g2.getContext(`2d`);
            for (_2.clearRect(0, 0, 1.5 * t2, n2), _2.putImageData(a2, 0, 0), r2 = Math.floor(r2), i2 = Math.floor(i2); !s2 || !c2; ) t2 = l2, n2 = u2, r2 < Math.floor(l2 * o2) ? l2 = Math.floor(l2 * o2) : (l2 = r2, s2 = true), i2 < Math.floor(u2 * o2) ? u2 = Math.floor(u2 * o2) : (u2 = i2, c2 = true), _2.drawImage(g2, f2, p2, t2, n2, m2, h2, l2, u2), f2 = m2, p2 = h2, h2 += u2;
            return _2.getImageData(f2, p2, r2, i2);
          }
          lanczosResize(e2, t2, n2, r2, i2) {
            let a2 = e2.imageData.data, o2 = e2.ctx.createImageData(r2, i2), s2 = o2.data, c2 = this.lanczosCreate(this.lanczosLobes), l2 = this.rcpScaleX, u2 = this.rcpScaleY, d2 = 2 / this.rcpScaleX, f2 = 2 / this.rcpScaleY, p2 = Math.ceil(l2 * this.lanczosLobes / 2), m2 = Math.ceil(u2 * this.lanczosLobes / 2), h2 = {}, g2 = { x: 0, y: 0 }, _2 = { x: 0, y: 0 };
            return function e3(v2) {
              let y2, b2, x2, S2, C2, w2, ee2, T2, E2, D2, O2;
              for (g2.x = (v2 + 0.5) * l2, _2.x = Math.floor(g2.x), y2 = 0; y2 < i2; y2++) {
                for (g2.y = (y2 + 0.5) * u2, _2.y = Math.floor(g2.y), C2 = 0, w2 = 0, ee2 = 0, T2 = 0, E2 = 0, b2 = _2.x - p2; b2 <= _2.x + p2; b2++) if (!(b2 < 0 || b2 >= t2)) {
                  D2 = Math.floor(1e3 * Math.abs(b2 - g2.x)), h2[D2] || (h2[D2] = {});
                  for (let e4 = _2.y - m2; e4 <= _2.y + m2; e4++) e4 < 0 || e4 >= n2 || (O2 = Math.floor(1e3 * Math.abs(e4 - g2.y)), h2[D2][O2] || (h2[D2][O2] = c2(Math.sqrt((D2 * d2) ** 2 + (O2 * f2) ** 2) / 1e3)), x2 = h2[D2][O2], x2 > 0 && (S2 = 4 * (e4 * t2 + b2), C2 += x2, w2 += x2 * a2[S2], ee2 += x2 * a2[S2 + 1], T2 += x2 * a2[S2 + 2], E2 += x2 * a2[S2 + 3]));
                }
                S2 = 4 * (y2 * r2 + v2), s2[S2] = w2 / C2, s2[S2 + 1] = ee2 / C2, s2[S2 + 2] = T2 / C2, s2[S2 + 3] = E2 / C2;
              }
              return ++v2 < r2 ? e3(v2) : o2;
            }(0);
          }
          bilinearFiltering(e2, t2, n2, r2, i2) {
            let a2, o2, s2, c2, l2, u2, d2, f2, p2, m2, h2, g2, _2, v2 = 0, y2 = this.rcpScaleX, b2 = this.rcpScaleY, x2 = 4 * (t2 - 1), S2 = e2.imageData.data, C2 = e2.ctx.createImageData(r2, i2), w2 = C2.data;
            for (d2 = 0; d2 < i2; d2++) for (f2 = 0; f2 < r2; f2++) for (l2 = Math.floor(y2 * f2), u2 = Math.floor(b2 * d2), p2 = y2 * f2 - l2, m2 = b2 * d2 - u2, _2 = 4 * (u2 * t2 + l2), h2 = 0; h2 < 4; h2++) a2 = S2[_2 + h2], o2 = S2[_2 + 4 + h2], s2 = S2[_2 + x2 + h2], c2 = S2[_2 + x2 + 4 + h2], g2 = a2 * (1 - p2) * (1 - m2) + o2 * p2 * (1 - m2) + s2 * m2 * (1 - p2) + c2 * p2 * m2, w2[v2++] = g2;
            return C2;
          }
          hermiteFastResize(e2, t2, n2, r2, i2) {
            let a2 = this.rcpScaleX, o2 = this.rcpScaleY, s2 = Math.ceil(a2 / 2), c2 = Math.ceil(o2 / 2), l2 = e2.imageData.data, u2 = e2.ctx.createImageData(r2, i2), d2 = u2.data;
            for (let e3 = 0; e3 < i2; e3++) for (let n3 = 0; n3 < r2; n3++) {
              let i3 = 4 * (n3 + e3 * r2), u3, f2 = 0, p2 = 0, m2 = 0, h2 = 0, g2 = 0, _2 = 0, v2 = (e3 + 0.5) * o2;
              for (let r3 = Math.floor(e3 * o2); r3 < (e3 + 1) * o2; r3++) {
                let e4 = Math.abs(v2 - (r3 + 0.5)) / c2, i4 = (n3 + 0.5) * a2, o3 = e4 * e4;
                for (let e5 = Math.floor(n3 * a2); e5 < (n3 + 1) * a2; e5++) {
                  let n4 = Math.abs(i4 - (e5 + 0.5)) / s2, a3 = Math.sqrt(o3 + n4 * n4);
                  a3 > 1 && a3 < -1 || (u3 = 2 * a3 * a3 * a3 - 3 * a3 * a3 + 1, u3 > 0 && (n4 = 4 * (e5 + r3 * t2), _2 += u3 * l2[n4 + 3], p2 += u3, l2[n4 + 3] < 255 && (u3 = u3 * l2[n4 + 3] / 250), m2 += u3 * l2[n4], h2 += u3 * l2[n4 + 1], g2 += u3 * l2[n4 + 2], f2 += u3));
                }
              }
              d2[i3] = m2 / f2, d2[i3 + 1] = h2 / f2, d2[i3 + 2] = g2 / f2, d2[i3 + 3] = _2 / p2;
            }
            return u2;
          }
        };
        a(mc, `type`, `Resize`), a(mc, `defaults`, { resizeType: `hermite`, scaleX: 1, scaleY: 1, lanczosLobes: 3 }), a(mc, `uniformLocations`, [`uDelta`, `uTaps`]), M.setClass(mc);
        var hc = class extends $ {
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uSaturation;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    float rgMax = max(color.r, color.g);
    float rgbMax = max(rgMax, color.b);
    color.r += rgbMax != color.r ? (rgbMax - color.r) * uSaturation : 0.00;
    color.g += rgbMax != color.g ? (rgbMax - color.g) * uSaturation : 0.00;
    color.b += rgbMax != color.b ? (rgbMax - color.b) * uSaturation : 0.00;
    gl_FragColor = color;
  }
`;
          }
          applyTo2d({ imageData: { data: e2 } }) {
            let t2 = -this.saturation;
            for (let n2 = 0; n2 < e2.length; n2 += 4) {
              let r2 = e2[n2], i2 = e2[n2 + 1], a2 = e2[n2 + 2], o2 = Math.max(r2, i2, a2);
              e2[n2] += o2 === r2 ? 0 : (o2 - r2) * t2, e2[n2 + 1] += o2 === i2 ? 0 : (o2 - i2) * t2, e2[n2 + 2] += o2 === a2 ? 0 : (o2 - a2) * t2;
            }
          }
          sendUniformData(e2, t2) {
            e2.uniform1f(t2.uSaturation, -this.saturation);
          }
          isNeutralState() {
            return this.saturation === 0;
          }
        };
        a(hc, `type`, `Saturation`), a(hc, `defaults`, { saturation: 0 }), a(hc, `uniformLocations`, [`uSaturation`]), M.setClass(hc);
        var gc = class extends $ {
          getFragmentSource() {
            return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uVibrance;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    float max = max(color.r, max(color.g, color.b));
    float avg = (color.r + color.g + color.b) / 3.0;
    float amt = (abs(max - avg) * 2.0) * uVibrance;
    color.r += max != color.r ? (max - color.r) * amt : 0.00;
    color.g += max != color.g ? (max - color.g) * amt : 0.00;
    color.b += max != color.b ? (max - color.b) * amt : 0.00;
    gl_FragColor = color;
  }
`;
          }
          applyTo2d({ imageData: { data: e2 } }) {
            let t2 = -this.vibrance;
            for (let n2 = 0; n2 < e2.length; n2 += 4) {
              let r2 = e2[n2], i2 = e2[n2 + 1], a2 = e2[n2 + 2], o2 = Math.max(r2, i2, a2), s2 = (r2 + i2 + a2) / 3, c2 = 2 * Math.abs(o2 - s2) / 255 * t2;
              e2[n2] += o2 === r2 ? 0 : (o2 - r2) * c2, e2[n2 + 1] += o2 === i2 ? 0 : (o2 - i2) * c2, e2[n2 + 2] += o2 === a2 ? 0 : (o2 - a2) * c2;
            }
          }
          sendUniformData(e2, t2) {
            e2.uniform1f(t2.uVibrance, -this.vibrance);
          }
          isNeutralState() {
            return this.vibrance === 0;
          }
        };
        a(gc, `type`, `Vibrance`), a(gc, `defaults`, { vibrance: 0 }), a(gc, `uniformLocations`, [`uVibrance`]), M.setClass(gc);
        var _c = n({ BaseFilter: () => $, BlackWhite: () => $s, BlendColor: () => zs, BlendImage: () => Vs, Blur: () => Hs, Brightness: () => Us, Brownie: () => qs, ColorMatrix: () => Gs, Composed: () => ec, Contrast: () => tc, Convolute: () => rc, Gamma: () => ac, Grayscale: () => sc, HueRotation: () => lc, Invert: () => uc, Kodachrome: () => Ys, Noise: () => dc, Pixelate: () => fc, Polaroid: () => Zs, RemoveColor: () => pc, Resize: () => mc, Saturation: () => hc, Sepia: () => Qs, Technicolor: () => Xs, Vibrance: () => gc, Vintage: () => Js });
        e.ActiveSelection = ps, e.BaseBrush = jo, e.BaseFabricObject = Ir, e.Canvas = ho, e.Canvas2dFilterBackend = ms, e.CanvasDOMManager = qa, e.Circle = Fo, e.CircleBrush = class extends jo {
          constructor(e2) {
            super(e2), a(this, `width`, 10), this.points = [];
          }
          drawDot(e2) {
            let t2 = this.addPoint(e2), n2 = this.canvas.contextTop;
            this._saveAndTransform(n2), this.dot(n2, t2), n2.restore();
          }
          dot(e2, t2) {
            e2.fillStyle = t2.fill, e2.beginPath(), e2.arc(t2.x, t2.y, t2.radius, 0, 2 * Math.PI, false), e2.closePath(), e2.fill();
          }
          onMouseDown(e2) {
            this.points = [], this.canvas.clearContext(this.canvas.contextTop), this._setShadow(), this.drawDot(e2);
          }
          _render() {
            let e2 = this.canvas.contextTop, t2 = this.points;
            this._saveAndTransform(e2);
            for (let n2 = 0; n2 < t2.length; n2++) this.dot(e2, t2[n2]);
            e2.restore();
          }
          onMouseMove(e2) {
            true === this.limitedToCanvasSize && this._isOutSideCanvas(e2) || (this.needsFullRender() ? (this.canvas.clearContext(this.canvas.contextTop), this.addPoint(e2), this._render()) : this.drawDot(e2));
          }
          onMouseUp() {
            let e2 = this.canvas.renderOnAddRemove;
            this.canvas.renderOnAddRemove = false;
            let t2 = [];
            for (let e3 = 0; e3 < this.points.length; e3++) {
              let n3 = this.points[e3], r2 = new Fo({ radius: n3.radius, left: n3.x, top: n3.y, originX: E, originY: E, fill: n3.fill });
              this.shadow && (r2.shadow = new Bn(this.shadow)), t2.push(r2);
            }
            let n2 = new ca(t2, { canvas: this.canvas });
            this.canvas.fire(`before:path:created`, { path: n2 }), this.canvas.add(n2), this.canvas.fire(`path:created`, { path: n2 }), this.canvas.clearContext(this.canvas.contextTop), this._resetShadow(), this.canvas.renderOnAddRemove = e2, this.canvas.requestRenderAll();
          }
          addPoint({ x: e2, y: t2 }) {
            let n2 = { x: e2, y: t2, radius: Ua(Math.max(0, this.width - 20), this.width + 20) / 2, fill: new G(this.color).setAlpha(Ua(0, 100) / 100).toRgba() };
            return this.points.push(n2), n2;
          }
        }, e.ClipPathLayout = us, e.Color = G, e.Control = q, e.Ellipse = Bo, e.FabricImage = bs, e.Image = bs, e.FabricObject = J, e.Object = J, e.FabricText = Q, e.Text = Q, e.FitContentLayout = ia, e.FixedLayout = ds, e.Gradient = ko, e.Group = ca, e.IText = cs, e.InteractiveFabricObject = _i, e.Intersection = Pr, e.LayoutManager = oa, e.LayoutStrategy = ra, e.Line = Lo, e.Observable = be, e.Path = Mo, e.Pattern = Ao, e.PatternBrush = class extends No {
          constructor(e2) {
            super(e2);
          }
          getPatternSrc() {
            let e2 = P(), t2 = e2.getContext(`2d`);
            return e2.width = e2.height = 25, t2 && (t2.fillStyle = this.color, t2.beginPath(), t2.arc(10, 10, 10, 0, 2 * Math.PI, false), t2.closePath(), t2.fill()), e2;
          }
          getPattern(e2) {
            return e2.createPattern(this.source || this.getPatternSrc(), `repeat`);
          }
          _setBrushStyles(e2) {
            super._setBrushStyles(e2);
            let t2 = this.getPattern(e2);
            t2 && (e2.strokeStyle = t2);
          }
          createPath(e2) {
            let t2 = super.createPath(e2), n2 = t2._getLeftTopCoords().scalarAdd(t2.strokeWidth / 2);
            return t2.stroke = new Ao({ source: this.source || this.getPatternSrc(), offsetX: -n2.x, offsetY: -n2.y }), t2;
          }
        }, e.PencilBrush = No, e.Point = N, e.Polygon = Uo, e.Polyline = Ho, e.Rect = $i, e.Shadow = Bn, e.SprayBrush = class extends jo {
          constructor(e2) {
            super(e2), a(this, `width`, 10), a(this, `density`, 20), a(this, `dotWidth`, 1), a(this, `dotWidthVariance`, 1), a(this, `randomOpacity`, false), a(this, `optimizeOverlapping`, true), this.sprayChunks = [], this.sprayChunk = [];
          }
          onMouseDown(e2) {
            this.sprayChunks = [], this.canvas.clearContext(this.canvas.contextTop), this._setShadow(), this.addSprayChunk(e2), this.renderChunck(this.sprayChunk);
          }
          onMouseMove(e2) {
            true === this.limitedToCanvasSize && this._isOutSideCanvas(e2) || (this.addSprayChunk(e2), this.renderChunck(this.sprayChunk));
          }
          onMouseUp() {
            let e2 = this.canvas.renderOnAddRemove;
            this.canvas.renderOnAddRemove = false;
            let t2 = [];
            for (let e3 = 0; e3 < this.sprayChunks.length; e3++) {
              let n3 = this.sprayChunks[e3];
              for (let e4 = 0; e4 < n3.length; e4++) {
                let r2 = n3[e4], i2 = new $i({ width: r2.width, height: r2.width, left: r2.x + 1, top: r2.y + 1, originX: E, originY: E, fill: this.color });
                t2.push(i2);
              }
            }
            let n2 = new ca(this.optimizeOverlapping ? function(e3) {
              let t3 = {}, n3 = [];
              for (let r2, i2 = 0; i2 < e3.length; i2++) r2 = `${e3[i2].left}${e3[i2].top}`, t3[r2] || (t3[r2] = true, n3.push(e3[i2]));
              return n3;
            }(t2) : t2, { objectCaching: true, subTargetCheck: false, interactive: false });
            this.shadow && n2.set(`shadow`, new Bn(this.shadow)), this.canvas.fire(`before:path:created`, { path: n2 }), this.canvas.add(n2), this.canvas.fire(`path:created`, { path: n2 }), this.canvas.clearContext(this.canvas.contextTop), this._resetShadow(), this.canvas.renderOnAddRemove = e2, this.canvas.requestRenderAll();
          }
          renderChunck(e2) {
            let t2 = this.canvas.contextTop;
            t2.fillStyle = this.color, this._saveAndTransform(t2);
            for (let n2 = 0; n2 < e2.length; n2++) {
              let r2 = e2[n2];
              t2.globalAlpha = r2.opacity, t2.fillRect(r2.x, r2.y, r2.width, r2.width);
            }
            t2.restore();
          }
          _render() {
            let e2 = this.canvas.contextTop;
            e2.fillStyle = this.color, this._saveAndTransform(e2);
            for (let e3 = 0; e3 < this.sprayChunks.length; e3++) this.renderChunck(this.sprayChunks[e3]);
            e2.restore();
          }
          addSprayChunk(e2) {
            this.sprayChunk = [];
            let t2 = this.width / 2;
            for (let n2 = 0; n2 < this.density; n2++) this.sprayChunk.push({ x: Ua(e2.x - t2, e2.x + t2), y: Ua(e2.y - t2, e2.y + t2), width: this.dotWidthVariance ? Ua(Math.max(1, this.dotWidth - this.dotWidthVariance), this.dotWidth + this.dotWidthVariance) : this.dotWidth, opacity: this.randomOpacity ? Ua(0, 100) / 100 : 1 });
            this.sprayChunks.push(this.sprayChunk);
          }
        }, e.StaticCanvas = yt, e.StaticCanvasDOMManager = dt, e.Textbox = ls, e.Triangle = Ro, e.WebGLFilterBackend = hs, e.cache = y, e.classRegistry = M, e.config = s, Object.defineProperty(e, `controlsUtils`, { enumerable: true, get: function() {
          return co;
        } }), e.createCollectionMixin = Ee, Object.defineProperty(e, `filters`, { enumerable: true, get: function() {
          return _c;
        } }), e.getEnv = h, e.getFabricDocument = g, e.getFabricWindow = _, e.getFilterBackend = vs, e.iMatrix = T, e.initFilterBackend = _s, e.isPutImageFaster = (e2, t2) => {
          let n2 = F({ width: e2, height: t2 }), r2 = P().getContext(`webgl`), i2 = { imageBuffer: new ArrayBuffer(e2 * t2 * 4) }, a2 = { destinationWidth: e2, destinationHeight: t2, targetCanvas: n2 }, o2;
          o2 = _().performance.now(), hs.prototype.copyGLTo2D.call(i2, r2, a2);
          let s2 = _().performance.now() - o2;
          return o2 = _().performance.now(), hs.prototype.copyGLTo2DPutImageData.call(i2, r2, a2), s2 > _().performance.now() - o2;
        }, e.isWebGLPipelineState = Ps, e.loadSVGFromString = Ns, e.loadSVGFromURL = function(e2, t2, n2 = {}) {
          return fetch(e2.replace(/^\n\s*/, ``).trim(), { signal: n2.signal }).then((e3) => {
            if (!e3.ok) throw new l(`HTTP error! status: ${e3.status}`);
            return e3.text();
          }).then((e3) => Ns(e3, t2, n2)).catch(() => ({ objects: [], elements: [], options: {}, allElements: [] }));
        }, e.parseSVGDocument = Ms, e.runningAnimations = ye, e.setEnv = (e2) => {
          m = e2;
        }, e.setFilterBackend = function(e2) {
          gs = e2;
        }, Object.defineProperty(e, `util`, { enumerable: true, get: function() {
          return Ga;
        } }), e.version = b;
      });
    }
  });

  // renderer/scripts/modules/mpv-fabric-overlay-runtime.js
  var require_mpv_fabric_overlay_runtime = __commonJS({
    "renderer/scripts/modules/mpv-fabric-overlay-runtime.js"(exports, module) {
      var {
        createFabricDrawingPilotMetrics
      } = require_fabric_drawing_pilot_metrics();
      var {
        splitStrokePointsByPolygon
      } = require_stroke_splitter();
      var {
        polygonHasArea,
        boundsForPoints,
        boundsIntersect,
        simplifyClosedPolygon
      } = require_lasso_geometry();
      var SCENE_KEY_SEPARATOR = "\0";
      var DEFAULT_MAX_VIDEOS = 10;
      var DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
      var DEFAULT_MAX_ACTIONS = 2048;
      var MAX_STROKE_POINTS = 2e4;
      var MAX_LASSO_POINTS = 1024;
      var DEFAULT_MAX_OBJECTS = 1e4;
      var TRANSFORM_FIELDS = ["left", "top", "scaleX", "scaleY", "angle", "skewX", "skewY", "flipX", "flipY"];
      var UNSUPPORTED_PHASE0_TRANSFORM_FIELDS = ["scaleX", "scaleY", "angle", "skewX", "skewY", "flipX", "flipY"];
      var BRUSH_COLORS = Object.freeze([
        "#ff4757",
        "#ffd000",
        "#26de81",
        "#4a9eff",
        "#ffffff",
        "#000000",
        "#1abc9c",
        "#ff6b9d"
      ]);
      var BRUSH_COLOR_LABELS = Object.freeze({
        "#ff4757": "\uBE68\uAC15",
        "#ffd000": "\uB178\uB791",
        "#26de81": "\uCD08\uB85D",
        "#4a9eff": "\uD30C\uB791",
        "#ffffff": "\uD558\uC591",
        "#000000": "\uAC80\uC815",
        "#1abc9c": "\uBBFC\uD2B8",
        "#ff6b9d": "\uD551\uD06C"
      });
      var DEFAULT_BRUSH_STYLE = Object.freeze({ color: "#ff4757", size: 3, opacity: 1 });
      var MIN_BRUSH_SIZE = 1;
      var MAX_BRUSH_SIZE = 50;
      var MIN_BRUSH_OPACITY_PERCENT = 10;
      var MAX_BRUSH_OPACITY_PERCENT = 100;
      var SELECTION_HIT_MARGIN_CSS_PX = 6;
      var MIN_SELECTION_HIT_TOLERANCE = 2;
      var MAX_SELECTION_HIT_TOLERANCE = 96;
      function clonePlain(value) {
        if (value === void 0) return void 0;
        return JSON.parse(JSON.stringify(value));
      }
      function finiteNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      }
      function boundedInteger(value, min, max, fallback) {
        if (value === null || value === void 0 || value === "") return fallback;
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
      }
      function normalizePathOpacity(value) {
        if (value === null || value === void 0 || value === "") return 1;
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0.1 || number > 1) return 1;
        return number;
      }
      function normalizeViewportTransform(value = {}) {
        const scale = finiteNumber(value.scale, 1);
        return {
          scale: scale > 0 ? scale : 1,
          panX: finiteNumber(value.panX, 0),
          panY: finiteNumber(value.panY, 0)
        };
      }
      function resolveSelectionHitTolerance(session = {}) {
        const rect = session.canvasRect || {};
        const sourceWidth = Math.max(0, finiteNumber(session.sourceWidth));
        const sourceHeight = Math.max(0, finiteNumber(session.sourceHeight));
        const displayWidth = Math.max(0, finiteNumber(rect.width));
        const displayHeight = Math.max(0, finiteNumber(rect.height));
        const scale = normalizeViewportTransform(session.viewportTransform).scale;
        if (!sourceWidth || !sourceHeight || !displayWidth || !displayHeight) {
          return SELECTION_HIT_MARGIN_CSS_PX;
        }
        const sourcePerCssPixel = Math.max(
          sourceWidth / displayWidth / scale,
          sourceHeight / displayHeight / scale
        );
        return Math.min(
          MAX_SELECTION_HIT_TOLERANCE,
          Math.max(MIN_SELECTION_HIT_TOLERANCE, Math.ceil(SELECTION_HIT_MARGIN_CSS_PX * sourcePerCssPixel))
        );
      }
      function resolveEffectiveCanvasRect(canvasRect = {}, viewportTransform = {}) {
        const left = finiteNumber(canvasRect.left, 0);
        const top = finiteNumber(canvasRect.top, 0);
        const width = Math.max(0, finiteNumber(canvasRect.width, 0));
        const height = Math.max(0, finiteNumber(canvasRect.height, 0));
        const { scale, panX, panY } = normalizeViewportTransform(viewportTransform);
        return {
          left: left + (1 - scale) * width / 2 + scale * panX,
          top: top + (1 - scale) * height / 2 + scale * panY,
          width: width * scale,
          height: height * scale
        };
      }
      function mapClientPointToSource(point = {}, canvasRect = {}, viewportTransform = {}, source = {}) {
        const effectiveRect = resolveEffectiveCanvasRect(canvasRect, viewportTransform);
        const sourceWidth = Math.max(0, finiteNumber(source.width, 0));
        const sourceHeight = Math.max(0, finiteNumber(source.height, 0));
        if (effectiveRect.width <= 0 || effectiveRect.height <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
          return null;
        }
        const x = (finiteNumber(point.clientX) - effectiveRect.left) * sourceWidth / effectiveRect.width;
        const y = (finiteNumber(point.clientY) - effectiveRect.top) * sourceHeight / effectiveRect.height;
        return {
          x: Math.min(sourceWidth, Math.max(0, x)),
          y: Math.min(sourceHeight, Math.max(0, y))
        };
      }
      function positiveInteger(value, fallback) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
      }
      function makeSceneKey(stableVideoIdentity, targetFrame) {
        return `${stableVideoIdentity}${SCENE_KEY_SEPARATOR}${targetFrame}`;
      }
      function defaultEstimateObjectBytes(object) {
        try {
          return Math.max(1, JSON.stringify(object).length * 2);
        } catch (_error) {
          return 1;
        }
      }
      function createSessionSceneStore(options = {}) {
        const maxVideos = positiveInteger(options.maxVideos, DEFAULT_MAX_VIDEOS);
        const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
        const maxObjects = positiveInteger(options.maxObjects, DEFAULT_MAX_OBJECTS);
        const maxHistory = positiveInteger(options.maxHistory, 32);
        const maxHistoryBytes = positiveInteger(
          options.maxHistoryBytes,
          Math.max(1, Math.min(16 * 1024 * 1024, Math.floor(maxBytes / 4)))
        );
        const estimateObjectBytes = typeof options.estimateObjectBytes === "function" ? options.estimateObjectBytes : defaultEstimateObjectBytes;
        const scenes = /* @__PURE__ */ new Map();
        const videoAccess = /* @__PURE__ */ new Map();
        let accessClock = 0;
        let latestVideoGeneration = -1;
        let activeSession = null;
        let evictionCount = 0;
        function activeScene() {
          return activeSession ? scenes.get(activeSession.sceneKey) || null : null;
        }
        function touchVideo(stableVideoIdentity) {
          accessClock += 1;
          videoAccess.delete(stableVideoIdentity);
          videoAccess.set(stableVideoIdentity, accessClock);
        }
        function calculateEstimatedBytes() {
          let total = 0;
          for (const scene of scenes.values()) total += scene.estimatedBytes + finiteNumber(scene.undoBytes);
          return total;
        }
        function evictVideo(stableVideoIdentity) {
          for (const [key, scene] of scenes) {
            if (scene.stableVideoIdentity === stableVideoIdentity) scenes.delete(key);
          }
          videoAccess.delete(stableVideoIdentity);
          evictionCount += 1;
        }
        function enforceLimits() {
          let estimatedBytes = calculateEstimatedBytes();
          while (videoAccess.size > maxVideos || estimatedBytes > maxBytes) {
            const candidate = [...videoAccess.keys()].find((identity) => identity !== activeSession?.stableVideoIdentity);
            if (!candidate) break;
            evictVideo(candidate);
            estimatedBytes = calculateEstimatedBytes();
          }
          return estimatedBytes;
        }
        function snapshotScene(scene) {
          if (!scene) return null;
          return {
            key: scene.key,
            stableVideoIdentity: scene.stableVideoIdentity,
            targetFrame: scene.targetFrame,
            objects: [...scene.objects.values()].map(clonePlain),
            selectedObjectIds: [...scene.selectedObjectIds],
            dirty: scene.dirty,
            mutationCount: scene.mutationCount,
            estimatedBytes: scene.estimatedBytes
          };
        }
        function noteMutation(scene) {
          scene.dirty = true;
          scene.mutationCount += 1;
        }
        function recalculateSceneBytes(scene) {
          scene.estimatedBytes = [...scene.objects.values()].reduce((total, object) => {
            const estimated = finiteNumber(estimateObjectBytes(object), 1);
            return total + Math.max(1, estimated);
          }, 0);
        }
        function clearUndoHistory(scene) {
          if (!scene) return;
          scene.undoStack.length = 0;
          scene.undoBytes = 0;
        }
        function estimateUndoEntryBytes(entry) {
          let bytes = 0;
          for (const object of entry.removedObjects || []) {
            bytes += Math.max(1, finiteNumber(estimateObjectBytes(object), 1));
          }
          for (const id of [
            ...entry.previousOrder || [],
            ...entry.addedIds || [],
            ...entry.previousSelection || [],
            ...entry.coalesceIds || []
          ]) {
            bytes += Math.max(2, String(id).length * 2);
          }
          bytes += defaultEstimateObjectBytes(entry.survivingTransforms || []);
          return bytes;
        }
        function pushUndoEntry(scene, entry) {
          const estimatedBytes = estimateUndoEntryBytes(entry);
          while (scene.undoStack.length > 0 && (scene.undoStack.length >= maxHistory || scene.undoBytes + estimatedBytes > maxHistoryBytes || calculateEstimatedBytes() + estimatedBytes > maxBytes)) {
            const removed = scene.undoStack.shift();
            scene.undoBytes = Math.max(0, scene.undoBytes - finiteNumber(removed?.estimatedBytes));
          }
          if (estimatedBytes > maxHistoryBytes || calculateEstimatedBytes() + estimatedBytes > maxBytes) return false;
          scene.undoStack.push({ ...entry, estimatedBytes });
          scene.undoBytes += estimatedBytes;
          return true;
        }
        function activateSession(session) {
          if (!session || typeof session.sessionId !== "string" || session.sessionId.length === 0) {
            return { accepted: false, reason: "invalid-session" };
          }
          if (typeof session.stableVideoIdentity !== "string" || session.stableVideoIdentity.length === 0) {
            return { accepted: false, reason: "invalid-video-identity" };
          }
          const targetFrame = Number(session.targetFrame);
          const videoGeneration = Number(session.videoGeneration);
          if (!Number.isInteger(targetFrame) || targetFrame < 0 || !Number.isInteger(videoGeneration) || videoGeneration < 0) {
            return { accepted: false, reason: "invalid-session-coordinates" };
          }
          if (videoGeneration < latestVideoGeneration) {
            return { accepted: false, reason: "stale-video-generation" };
          }
          latestVideoGeneration = Math.max(latestVideoGeneration, videoGeneration);
          const sceneKey = makeSceneKey(session.stableVideoIdentity, targetFrame);
          const restored = scenes.has(sceneKey);
          if (!restored) {
            scenes.set(sceneKey, {
              key: sceneKey,
              stableVideoIdentity: session.stableVideoIdentity,
              targetFrame,
              objects: /* @__PURE__ */ new Map(),
              selectedObjectIds: /* @__PURE__ */ new Set(),
              undoStack: [],
              undoBytes: 0,
              dirty: false,
              mutationCount: 0,
              estimatedBytes: 0
            });
          }
          activeSession = {
            sessionId: session.sessionId,
            stableVideoIdentity: session.stableVideoIdentity,
            targetFrame,
            sceneKey,
            videoGeneration,
            tool: session.tool === "select" ? "select" : "brush",
            toolRevision: -1
          };
          const scene = activeScene();
          scene.selectedObjectIds.clear();
          touchVideo(session.stableVideoIdentity);
          enforceLimits();
          return { accepted: true, restored, sceneKey };
        }
        function deactivateSession(sessionId) {
          if (!activeSession) return { accepted: true, active: false };
          if (sessionId && sessionId !== activeSession.sessionId) {
            return { accepted: false, reason: "stale-session" };
          }
          activeScene()?.selectedObjectIds.clear();
          activeSession = null;
          return { accepted: true, active: false };
        }
        function addStroke(stroke) {
          const scene = activeScene();
          if (!scene) return { applied: false, reason: "no-active-session" };
          if (!stroke || typeof stroke.id !== "string" || stroke.id.length === 0) {
            return { applied: false, reason: "invalid-stroke" };
          }
          if (scene.objects.has(stroke.id)) return { applied: false, reason: "duplicate-object-id" };
          if (scene.objects.size >= maxObjects) return { applied: false, reason: "scene-object-limit-exceeded" };
          if (!Array.isArray(stroke.sourcePoints) || stroke.sourcePoints.length > MAX_STROKE_POINTS) {
            return { applied: false, reason: "invalid-stroke-points" };
          }
          const record = clonePlain(stroke);
          clearUndoHistory(scene);
          scene.objects.set(record.id, record);
          recalculateSceneBytes(scene);
          enforceLimits();
          if (calculateEstimatedBytes() - scene.undoBytes > maxBytes) {
            scene.objects.delete(record.id);
            recalculateSceneBytes(scene);
            return { applied: false, reason: "scene-capacity-exceeded" };
          }
          noteMutation(scene);
          touchVideo(scene.stableVideoIdentity);
          return { applied: true, objectId: record.id };
        }
        function selectObjects(objectIds = []) {
          const scene = activeScene();
          if (!scene) return { changed: false, selection: [] };
          const next = new Set(objectIds.filter((id) => scene.objects.has(id)));
          const changed = next.size !== scene.selectedObjectIds.size || [...next].some((id) => !scene.selectedObjectIds.has(id));
          scene.selectedObjectIds = next;
          return { changed, selection: [...next] };
        }
        function transformSelection(change = {}) {
          const scene = activeScene();
          if (!scene || scene.selectedObjectIds.size === 0) return { applied: false, objectIds: [] };
          let changed = false;
          const changedIds = [];
          const transformById = new Map((change.transforms || []).map((item) => [item.id, item.transform]));
          const dx = finiteNumber(change.dx, 0);
          const dy = finiteNumber(change.dy, 0);
          for (const id of scene.selectedObjectIds) {
            const object = scene.objects.get(id);
            if (!object) continue;
            const current = { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0, ...object.transform || {} };
            let next = current;
            if (transformById.has(id)) {
              next = { ...current, ...clonePlain(transformById.get(id)) };
            } else if (dx !== 0 || dy !== 0) {
              next = { ...current, left: finiteNumber(current.left) + dx, top: finiteNumber(current.top) + dy };
            }
            const objectChanged = TRANSFORM_FIELDS.some((field) => current[field] !== next[field]);
            if (!objectChanged) continue;
            object.transform = next;
            changed = true;
            changedIds.push(id);
          }
          if (!changed) return { applied: false, objectIds: [] };
          const latestUndo = scene.undoStack.at(-1);
          const coalesceIds = new Set(latestUndo?.coalesceIds || latestUndo?.addedIds || []);
          const selectedIds = [...scene.selectedObjectIds];
          const coalescesLatestSplit = !!latestUndo && selectedIds.length === coalesceIds.size && selectedIds.every((id) => coalesceIds.has(id)) && changedIds.every((id) => coalesceIds.has(id));
          if (!coalescesLatestSplit) clearUndoHistory(scene);
          recalculateSceneBytes(scene);
          noteMutation(scene);
          touchVideo(scene.stableVideoIdentity);
          return { applied: true, objectIds: changedIds };
        }
        function replaceObjects(change = {}) {
          const scene = activeScene();
          if (!scene) return { applied: false, reason: "no-active-session" };
          let replacements = Array.isArray(change.replacements) ? change.replacements.map((replacement) => ({
            removeId: replacement?.removeId,
            addObjects: Array.isArray(replacement?.addObjects) ? replacement.addObjects.map(clonePlain) : []
          })) : [];
          if (replacements.length === 0 && Array.isArray(change.removeIds)) {
            const legacyRemoveIds = [...new Set(change.removeIds)];
            replacements = legacyRemoveIds.map((removeId, index) => ({
              removeId,
              addObjects: index === 0 && Array.isArray(change.addObjects) ? change.addObjects.map(clonePlain) : []
            }));
          }
          const removeIds = new Set(replacements.map((replacement) => replacement.removeId));
          const additions = replacements.flatMap((replacement) => replacement.addObjects);
          if (removeIds.size === 0 || ![...removeIds].every((id) => scene.objects.has(id))) {
            return { applied: false, reason: "invalid-replacement-source" };
          }
          if (removeIds.size !== replacements.length) {
            return { applied: false, reason: "duplicate-replacement-source" };
          }
          const survivingIds = new Set([...scene.objects.keys()].filter((id) => !removeIds.has(id)));
          const additionIds = /* @__PURE__ */ new Set();
          for (const object of additions) {
            if (!object || typeof object.id !== "string" || !object.id || !Array.isArray(object.sourcePoints) || object.sourcePoints.length > MAX_STROKE_POINTS || survivingIds.has(object.id) || additionIds.has(object.id)) {
              return { applied: false, reason: "invalid-replacement-object" };
            }
            additionIds.add(object.id);
          }
          if (survivingIds.size + additions.length > maxObjects) {
            return { applied: false, reason: "scene-object-limit-exceeded" };
          }
          const previousObjects = scene.objects;
          const previousSelection = scene.selectedObjectIds;
          const previousBytes = scene.estimatedBytes;
          const requestedSelection = Array.isArray(change.selectedObjectIds) ? change.selectedObjectIds : [];
          const historyEntry = {
            previousOrder: [...previousObjects.keys()],
            removedObjects: [...removeIds].map((id) => clonePlain(previousObjects.get(id))),
            addedIds: additions.map((object) => object.id),
            previousSelection: [...previousSelection],
            coalesceIds: [...requestedSelection],
            survivingTransforms: requestedSelection.filter((id) => previousObjects.has(id) && !removeIds.has(id)).map((id) => ({ id, transform: clonePlain(previousObjects.get(id)?.transform || {}) }))
          };
          const nextObjects = /* @__PURE__ */ new Map();
          const replacementsById = new Map(replacements.map((replacement) => [replacement.removeId, replacement.addObjects]));
          for (const [id, object] of previousObjects) {
            if (!removeIds.has(id)) {
              nextObjects.set(id, object);
              continue;
            }
            for (const addition of replacementsById.get(id) || []) nextObjects.set(addition.id, addition);
          }
          scene.objects = nextObjects;
          scene.selectedObjectIds = new Set(
            (Array.isArray(change.selectedObjectIds) ? change.selectedObjectIds : []).filter((id) => nextObjects.has(id))
          );
          recalculateSceneBytes(scene);
          if (calculateEstimatedBytes() - scene.undoBytes > maxBytes) {
            scene.objects = previousObjects;
            scene.selectedObjectIds = previousSelection;
            scene.estimatedBytes = previousBytes;
            return { applied: false, reason: "scene-capacity-exceeded" };
          }
          const undoRecorded = pushUndoEntry(scene, historyEntry);
          noteMutation(scene);
          touchVideo(scene.stableVideoIdentity);
          return {
            applied: true,
            removedIds: [...removeIds],
            addedIds: additions.map((object) => object.id),
            selectedObjectIds: [...scene.selectedObjectIds],
            undoRecorded
          };
        }
        function undo() {
          const scene = activeScene();
          if (!scene || scene.undoStack.length === 0) return { applied: false, reason: "history-empty" };
          const previous = scene.undoStack.pop();
          scene.undoBytes = Math.max(0, scene.undoBytes - finiteNumber(previous.estimatedBytes));
          const restoredById = new Map(scene.objects);
          for (const id of previous.addedIds) restoredById.delete(id);
          for (const object of previous.removedObjects) restoredById.set(object.id, clonePlain(object));
          for (const item of previous.survivingTransforms || []) {
            const object = restoredById.get(item.id);
            if (object) object.transform = clonePlain(item.transform);
          }
          scene.objects = new Map(
            previous.previousOrder.filter((id) => restoredById.has(id)).map((id) => [id, restoredById.get(id)])
          );
          scene.selectedObjectIds = /* @__PURE__ */ new Set();
          recalculateSceneBytes(scene);
          noteMutation(scene);
          touchVideo(scene.stableVideoIdentity);
          return { applied: true, objectCount: scene.objects.size, selectedObjectIds: [] };
        }
        function deleteSelection() {
          const scene = activeScene();
          if (!scene || scene.selectedObjectIds.size === 0) {
            return { applied: false, deletedCount: 0, deletedIds: [] };
          }
          const deletedIds = [];
          for (const id of scene.selectedObjectIds) {
            if (!scene.objects.delete(id)) continue;
            deletedIds.push(id);
          }
          scene.selectedObjectIds.clear();
          if (deletedIds.length === 0) return { applied: false, deletedCount: 0, deletedIds };
          clearUndoHistory(scene);
          recalculateSceneBytes(scene);
          noteMutation(scene);
          touchVideo(scene.stableVideoIdentity);
          return { applied: true, deletedCount: deletedIds.length, deletedIds };
        }
        function clearSession() {
          const scene = activeScene();
          const deletedCount = scene?.objects.size || 0;
          if (!scene || deletedCount === 0) return { applied: false, deletedCount: 0, deletedIds: [] };
          const deletedIds = [...scene.objects.keys()];
          clearUndoHistory(scene);
          scene.objects.clear();
          scene.selectedObjectIds.clear();
          recalculateSceneBytes(scene);
          noteMutation(scene);
          touchVideo(scene.stableVideoIdentity);
          return { applied: true, deletedCount, deletedIds };
        }
        function updateTool(command = {}) {
          if (!activeSession || command.sessionId !== activeSession.sessionId) {
            return { accepted: false, reason: "stale-session" };
          }
          const toolRevision = Number(command.toolRevision);
          if (!Number.isInteger(toolRevision) || toolRevision <= activeSession.toolRevision) {
            return { accepted: false, reason: "stale-tool-revision" };
          }
          if (command.tool !== "brush" && command.tool !== "select") {
            return { accepted: false, reason: "invalid-tool" };
          }
          activeSession.toolRevision = toolRevision;
          activeSession.tool = command.tool;
          return { accepted: true, tool: command.tool, toolRevision };
        }
        function setLocalTool(command = {}) {
          if (!activeSession || command.sessionId !== activeSession.sessionId) {
            return { accepted: false, reason: "stale-session" };
          }
          if (command.tool !== "brush" && command.tool !== "select") {
            return { accepted: false, reason: "invalid-tool" };
          }
          activeSession.tool = command.tool;
          return { accepted: true, tool: command.tool, toolRevision: activeSession.toolRevision };
        }
        function getSceneSnapshot(stableVideoIdentity, targetFrame) {
          return snapshotScene(scenes.get(makeSceneKey(stableVideoIdentity, targetFrame)));
        }
        function getActiveSceneSnapshot() {
          return snapshotScene(activeScene());
        }
        function hasScene(stableVideoIdentity, targetFrame) {
          return scenes.has(makeSceneKey(stableVideoIdentity, targetFrame));
        }
        function getDiagnostics() {
          const scene = activeScene();
          return {
            maxVideos,
            maxBytes,
            maxObjects,
            maxHistoryBytes,
            videoCount: videoAccess.size,
            sceneCount: scenes.size,
            estimatedBytes: calculateEstimatedBytes(),
            evictionCount,
            latestVideoGeneration,
            activeSessionId: activeSession?.sessionId || null,
            activeSceneKey: activeSession?.sceneKey || null,
            tool: activeSession?.tool || null,
            toolRevision: activeSession?.toolRevision ?? -1,
            objectCount: scene?.objects.size || 0,
            selectionCount: scene?.selectedObjectIds.size || 0,
            mutationCount: scene?.mutationCount || 0,
            dirty: scene?.dirty || false,
            undoDepth: scene?.undoStack.length || 0,
            undoBytes: scene?.undoBytes || 0,
            sceneKeys: [...scenes.keys()]
          };
        }
        function destroy() {
          scenes.clear();
          videoAccess.clear();
          activeSession = null;
        }
        return {
          activateSession,
          deactivateSession,
          addStroke,
          selectObjects,
          transformSelection,
          replaceObjects,
          undo,
          deleteSelection,
          clearSession,
          updateTool,
          setLocalTool,
          getSceneSnapshot,
          getActiveSceneSnapshot,
          hasScene,
          getDiagnostics,
          destroy
        };
      }
      function normalizePressure(value, pointerType = "mouse") {
        const pressure = Number(value);
        if (!Number.isFinite(pressure)) return 0.5;
        if (pointerType === "mouse" && pressure === 0) return 0.5;
        return Math.min(1, Math.max(0, pressure));
      }
      function formatCoordinate(value) {
        return Number(finiteNumber(value).toFixed(3)).toString();
      }
      function outlineToPathData(outline) {
        if (!Array.isArray(outline) || outline.length === 0) return "";
        const first = outline[0];
        const commands = [`M ${formatCoordinate(first[0])} ${formatCoordinate(first[1])}`];
        for (let index = 1; index < outline.length; index += 1) {
          const current = outline[index];
          const next = outline[(index + 1) % outline.length];
          const midpointX = (current[0] + next[0]) / 2;
          const midpointY = (current[1] + next[1]) / 2;
          commands.push(`Q ${formatCoordinate(current[0])} ${formatCoordinate(current[1])} ${formatCoordinate(midpointX)} ${formatCoordinate(midpointY)}`);
        }
        commands.push("Z");
        return commands.join(" ");
      }
      function createStrokePathData(samples, options = {}) {
        if (!Array.isArray(samples) || samples.length === 0) {
          return { sourcePoints: [], outline: [], pathData: "" };
        }
        if (samples.length > MAX_STROKE_POINTS) {
          throw new RangeError(`stroke point limit exceeded: ${samples.length}/${MAX_STROKE_POINTS}`);
        }
        const sourcePoints = samples.map((sample) => ({
          x: finiteNumber(sample.x),
          y: finiteNumber(sample.y),
          pressure: normalizePressure(sample.pressure, sample.pointerType),
          time: finiteNumber(sample.time ?? sample.timeStamp)
        }));
        const { getStroke } = require_cjs();
        const outline = getStroke(
          sourcePoints.map((point) => [point.x, point.y, point.pressure]),
          {
            size: Math.max(1, finiteNumber(options.size, 8)),
            thinning: finiteNumber(options.thinning, 0.65),
            smoothing: finiteNumber(options.smoothing, 0.55),
            streamline: finiteNumber(options.streamline, 0.5),
            easing: options.easing,
            simulatePressure: false,
            start: options.start,
            end: options.end,
            last: options.last === true
          }
        );
        return {
          sourcePoints,
          outline: outline.map((point) => [point[0], point[1]]),
          pathData: outlineToPathData(outline)
        };
      }
      function createActionDeduper(options = {}) {
        const maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ACTIONS);
        const entries = /* @__PURE__ */ new Map();
        return {
          accept(actionId) {
            if (typeof actionId !== "string" || actionId.length === 0) return false;
            if (entries.has(actionId)) {
              const value = entries.get(actionId);
              entries.delete(actionId);
              entries.set(actionId, value);
              return false;
            }
            entries.set(actionId, true);
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
            return true;
          },
          clear() {
            entries.clear();
          },
          get size() {
            return entries.size;
          }
        };
      }
      function shouldAcceptInputRequest(current = {}, request = {}) {
        if (typeof request.enabled !== "boolean") return false;
        const hostGeneration = Number(request.hostGeneration);
        const videoGeneration = Number(request.videoGeneration);
        const inputRevision = Number(request.inputRevision);
        if (!Number.isInteger(hostGeneration) || hostGeneration < 0) return false;
        if (!Number.isInteger(videoGeneration) || videoGeneration < 0) return false;
        if (!Number.isInteger(inputRevision) || inputRevision < 0) return false;
        const currentHost = Number.isInteger(Number(current.hostGeneration)) ? Number(current.hostGeneration) : -1;
        const currentVideo = Number.isInteger(Number(current.videoGeneration)) ? Number(current.videoGeneration) : -1;
        const currentInput = Number.isInteger(Number(current.inputRevision)) ? Number(current.inputRevision) : -1;
        if (hostGeneration < currentHost || videoGeneration < currentVideo || inputRevision <= currentInput) return false;
        if (request.enabled && !request.session) return false;
        if (request.enabled && currentVideo >= 0 && videoGeneration > currentVideo) return false;
        return true;
      }
      function createFabricOverlayRuntime(options = {}) {
        const documentRef = options.document || (typeof document !== "undefined" ? document : null);
        const windowRef = options.window || (typeof window !== "undefined" ? window : null);
        const performanceRef = options.performance || (typeof performance !== "undefined" ? performance : null);
        const queueMicrotaskRef = options.queueMicrotask || windowRef?.queueMicrotask?.bind(windowRef) || globalThis.queueMicrotask?.bind(globalThis) || ((callback) => Promise.resolve().then(callback));
        const now = () => typeof performanceRef?.now === "function" ? performanceRef.now() : Date.now();
        const devicePixelRatio = finiteNumber(options.devicePixelRatio ?? windowRef?.devicePixelRatio, 1) || 1;
        const metrics = options.metrics || createFabricDrawingPilotMetrics(options.metricsOptions);
        const sceneStore = options.sceneStore || createSessionSceneStore(options.sceneStoreOptions);
        const actionDeduper = options.actionDeduper || createActionDeduper(options.actionDeduperOptions);
        const strokePathFactory = options.strokePathFactory || createStrokePathData;
        const maxLassoFragments = positiveInteger(options.maxLassoFragments, 512);
        const tokenState = { hostGeneration: -1, videoGeneration: -1, inputRevision: -1 };
        const domListeners = [];
        const fabricListeners = [];
        let fabricModule = null;
        let root = null;
        let container = null;
        let viewportElement = null;
        let canvasElement = null;
        let toolbar = null;
        let badge = null;
        const toolButtons = /* @__PURE__ */ new Map();
        let fabricCanvas = null;
        let prepared = false;
        let destroyed = false;
        let inputEnabled = false;
        let currentSession = null;
        let activeStroke = null;
        let activeLasso = null;
        let pendingLassoVisual = null;
        let brushStyle = { ...DEFAULT_BRUSH_STYLE };
        let brushControls = null;
        let brushPanelOpen = false;
        let selectionMode = "stroke";
        let selectionControls = null;
        let transformStart = null;
        let selectGesture = null;
        let deferredViewport = null;
        let longTaskObserver = null;
        let localSequence = 0;
        let lastError = null;
        let appliedSourceWidth = null;
        let appliedSourceHeight = null;
        function resolveFabric() {
          if (!fabricModule) fabricModule = options.fabric || require_index_min();
          if (!fabricModule?.Canvas || !fabricModule?.Path) throw new Error("Fabric Canvas and Path exports are required");
          return fabricModule;
        }
        function addDomListener(target, type, listener, listenerOptions) {
          domListeners.push({ target, type, listener, listenerOptions });
          target?.addEventListener?.(type, listener, listenerOptions);
        }
        function addFabricListener(type, listener) {
          fabricListeners.push({ type, listener });
          fabricCanvas.on(type, listener);
        }
        function setStyles(element, styles) {
          if (!element?.style) return;
          Object.assign(element.style, styles);
        }
        function createButton(label, action) {
          const button = documentRef.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.dataset.fabricPilotAction = action;
          if (action === "brush" || action === "select") {
            button.dataset.active = "false";
            button.setAttribute?.("aria-pressed", "false");
            toolButtons.set(action, button);
          }
          return button;
        }
        function syncSelectionControls(tool = currentSession?.tool) {
          if (!selectionControls) return;
          selectionControls.group.style.display = tool === "select" ? "flex" : "none";
          for (const [mode, button] of selectionControls.buttons) {
            const active = selectionMode === mode;
            button.dataset.active = String(active);
            button.setAttribute?.("aria-pressed", String(active));
          }
        }
        function setSelectionMode(mode) {
          const nextMode = mode === "lasso" ? "lasso" : "stroke";
          if (selectionMode !== nextMode) rollbackPendingLassoVisual();
          const selectedObjectIds = sceneStore.getActiveSceneSnapshot()?.selectedObjectIds || [];
          if (selectionMode !== nextMode && (activeLasso || selectGesture || transformStart || deferredViewport)) {
            cancelActiveLasso();
            cancelSelectInteraction();
          }
          selectionMode = nextMode;
          if (currentSession?.tool === "select") {
            setToolMode("select");
            if (selectionMode === "lasso" && selectedObjectIds.length > 0) activateObjectIds(selectedObjectIds);
          } else syncSelectionControls();
          return selectionMode;
        }
        function createSelectionModeControls() {
          const group = documentRef.createElement("div");
          group.dataset.fabricPilotGroup = "selection-mode";
          group.setAttribute?.("role", "group");
          group.setAttribute?.("aria-label", "\uC120\uD0DD \uBC29\uC2DD");
          setStyles(group, {
            display: "none",
            alignItems: "center",
            gap: "4px",
            padding: "3px",
            borderRadius: "8px",
            background: "rgba(255, 255, 255, 0.08)"
          });
          const strokeButton = createButton("\uD68D", "select-stroke");
          strokeButton.setAttribute?.("aria-label", "\uD68D \uC804\uCCB4 \uC120\uD0DD");
          const lassoButton = createButton("\uB77C\uC3D8", "select-lasso");
          lassoButton.setAttribute?.("aria-label", "\uB77C\uC3D8 \uBD80\uBD84 \uC120\uD0DD");
          const buttons = /* @__PURE__ */ new Map([
            ["stroke", strokeButton],
            ["lasso", lassoButton]
          ]);
          for (const button of buttons.values()) {
            button.setAttribute?.("aria-pressed", "false");
            group.appendChild(button);
          }
          addDomListener(strokeButton, "click", () => setSelectionMode("stroke"));
          addDomListener(lassoButton, "click", () => setSelectionMode("lasso"));
          return { group, buttons, strokeButton, lassoButton };
        }
        function setBrushColor(color) {
          if (!BRUSH_COLORS.includes(color)) return brushStyle.color;
          brushStyle = { ...brushStyle, color };
          syncBrushControls();
          return brushStyle.color;
        }
        function setBrushSize(value) {
          brushStyle = {
            ...brushStyle,
            size: boundedInteger(value, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, brushStyle.size)
          };
          syncBrushControls();
          return brushStyle.size;
        }
        function setBrushOpacityPercent(value) {
          const currentPercent = Math.round(brushStyle.opacity * 100);
          const percent = boundedInteger(
            value,
            MIN_BRUSH_OPACITY_PERCENT,
            MAX_BRUSH_OPACITY_PERCENT,
            currentPercent
          );
          brushStyle = { ...brushStyle, opacity: percent / 100 };
          syncBrushControls();
          return percent;
        }
        function syncBrushControls() {
          if (!brushControls) return;
          const opacityPercent = Math.round(brushStyle.opacity * 100);
          brushControls.settingsButton.setAttribute?.("aria-expanded", String(brushPanelOpen));
          brushControls.panel.style.display = brushPanelOpen ? "flex" : "none";
          brushControls.sizeInput.value = String(brushStyle.size);
          brushControls.opacityInput.value = String(opacityPercent);
          brushControls.sizeOutput.textContent = `${brushStyle.size}px`;
          brushControls.opacityOutput.textContent = `${opacityPercent}%`;
          brushControls.summary.textContent = `${brushStyle.size}px \xB7 ${opacityPercent}%`;
          brushControls.colorPreview.style.background = brushStyle.color;
          brushControls.sizePreview.style.width = `${Math.min(22, Math.max(2, brushStyle.size))}px`;
          brushControls.sizePreview.style.height = brushControls.sizePreview.style.width;
          brushControls.sizePreview.style.background = brushStyle.color;
          brushControls.sizePreview.style.opacity = String(brushStyle.opacity);
          for (const button of brushControls.colorButtons) {
            const active = button.dataset.fabricPilotColor === brushStyle.color;
            button.setAttribute?.("aria-pressed", String(active));
            button.style.boxShadow = active ? "0 0 0 2px #fff, 0 0 0 4px rgba(255, 71, 87, 0.75)" : "none";
          }
        }
        function createBrushSettingsControls() {
          const settingsButton = createButton("", "brush-settings");
          settingsButton.setAttribute?.("aria-expanded", "false");
          settingsButton.setAttribute?.("aria-label", "\uBE0C\uB7EC\uC2DC \uC124\uC815");
          setStyles(settingsButton, {
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            minHeight: "40px"
          });
          const colorPreview = documentRef.createElement("span");
          colorPreview.dataset.fabricPilotOutput = "color-preview";
          setStyles(colorPreview, {
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            border: "1px solid rgba(0, 0, 0, 0.35)",
            flex: "0 0 auto"
          });
          const summary = documentRef.createElement("span");
          summary.dataset.fabricPilotOutput = "summary";
          settingsButton.appendChild(colorPreview);
          settingsButton.appendChild(summary);
          const panel = documentRef.createElement("div");
          panel.dataset.fabricPilotPanel = "brush-settings";
          panel.setAttribute?.("role", "group");
          panel.setAttribute?.("aria-label", "\uBE0C\uB7EC\uC2DC \uC124\uC815");
          setStyles(panel, {
            display: "none",
            position: "absolute",
            top: "52px",
            left: "0",
            width: "360px",
            maxWidth: "calc(100vw - 24px)",
            flexDirection: "column",
            gap: "12px",
            padding: "12px",
            boxSizing: "border-box",
            borderRadius: "8px",
            background: "rgba(24, 24, 28, 0.96)",
            color: "#fff"
          });
          const previewRow = documentRef.createElement("div");
          setStyles(previewRow, {
            display: "flex",
            alignItems: "center",
            minHeight: "22px"
          });
          const sizePreview = documentRef.createElement("span");
          sizePreview.dataset.fabricPilotOutput = "size-preview";
          setStyles(sizePreview, {
            display: "block",
            borderRadius: "50%",
            flex: "0 0 auto"
          });
          previewRow.appendChild(sizePreview);
          const palette = documentRef.createElement("div");
          setStyles(palette, {
            display: "flex",
            flexWrap: "wrap",
            gap: "6px"
          });
          const colorButtons = BRUSH_COLORS.map((color) => {
            const button = createButton("", "brush-color");
            button.dataset.fabricPilotColor = color;
            button.setAttribute?.("aria-label", `\uBE0C\uB7EC\uC2DC \uC0C9\uC0C1 ${BRUSH_COLOR_LABELS[color]}`);
            button.setAttribute?.("aria-pressed", "false");
            setStyles(button, {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "40px",
              minHeight: "40px"
            });
            const dot = documentRef.createElement("span");
            setStyles(dot, {
              width: "22px",
              height: "22px",
              borderRadius: "50%",
              background: color,
              border: color === "#ffffff" ? "1px solid rgba(0, 0, 0, 0.7)" : "none"
            });
            button.appendChild(dot);
            palette.appendChild(button);
            return button;
          });
          const createRangeRow = ({
            label,
            setting,
            min,
            max,
            decreaseAction,
            decreaseLabel,
            increaseAction,
            increaseLabel,
            output
          }) => {
            const row = documentRef.createElement("div");
            setStyles(row, {
              display: "flex",
              alignItems: "center",
              gap: "6px"
            });
            const labelElement = documentRef.createElement("span");
            labelElement.textContent = label;
            const decrease = createButton("\u2212", decreaseAction);
            decrease.setAttribute?.("aria-label", decreaseLabel);
            const input = documentRef.createElement("input");
            input.type = "range";
            input.tabIndex = -1;
            input.min = String(min);
            input.max = String(max);
            input.step = "1";
            input.dataset.fabricPilotSetting = setting;
            input.setAttribute?.("aria-label", label);
            setStyles(input, { flex: "1 1 auto", minWidth: "0" });
            const increase = createButton("+", increaseAction);
            increase.setAttribute?.("aria-label", increaseLabel);
            const outputElement = documentRef.createElement("span");
            outputElement.dataset.fabricPilotOutput = output;
            outputElement.setAttribute?.("role", "status");
            outputElement.setAttribute?.("aria-live", "polite");
            outputElement.setAttribute?.("aria-atomic", "true");
            setStyles(outputElement, { minWidth: "42px", textAlign: "right" });
            row.appendChild(labelElement);
            row.appendChild(decrease);
            row.appendChild(input);
            row.appendChild(increase);
            row.appendChild(outputElement);
            return { row, decrease, input, increase, output: outputElement };
          };
          const sizeRow = createRangeRow({
            label: "\uBE0C\uB7EC\uC2DC \uD06C\uAE30",
            setting: "size",
            min: MIN_BRUSH_SIZE,
            max: MAX_BRUSH_SIZE,
            decreaseAction: "size-decrease",
            decreaseLabel: "\uBE0C\uB7EC\uC2DC \uD06C\uAE30 1px \uC904\uC774\uAE30",
            increaseAction: "size-increase",
            increaseLabel: "\uBE0C\uB7EC\uC2DC \uD06C\uAE30 1px \uB298\uB9AC\uAE30",
            output: "size"
          });
          const opacityRow = createRangeRow({
            label: "\uBE0C\uB7EC\uC2DC \uBD88\uD22C\uBA85\uB3C4",
            setting: "opacity",
            min: MIN_BRUSH_OPACITY_PERCENT,
            max: MAX_BRUSH_OPACITY_PERCENT,
            decreaseAction: "opacity-decrease",
            decreaseLabel: "\uBE0C\uB7EC\uC2DC \uBD88\uD22C\uBA85\uB3C4 1% \uC904\uC774\uAE30",
            increaseAction: "opacity-increase",
            increaseLabel: "\uBE0C\uB7EC\uC2DC \uBD88\uD22C\uBA85\uB3C4 1% \uB298\uB9AC\uAE30",
            output: "opacity"
          });
          panel.appendChild(previewRow);
          panel.appendChild(palette);
          panel.appendChild(sizeRow.row);
          panel.appendChild(opacityRow.row);
          addDomListener(settingsButton, "click", () => {
            brushPanelOpen = !brushPanelOpen;
            syncBrushControls();
          });
          addDomListener(sizeRow.input, "input", () => setBrushSize(sizeRow.input.value));
          addDomListener(opacityRow.input, "input", () => setBrushOpacityPercent(opacityRow.input.value));
          addDomListener(sizeRow.decrease, "click", () => setBrushSize(brushStyle.size - 1));
          addDomListener(sizeRow.increase, "click", () => setBrushSize(brushStyle.size + 1));
          addDomListener(opacityRow.decrease, "click", () => {
            setBrushOpacityPercent(Math.round(brushStyle.opacity * 100) - 1);
          });
          addDomListener(opacityRow.increase, "click", () => {
            setBrushOpacityPercent(Math.round(brushStyle.opacity * 100) + 1);
          });
          for (const button of colorButtons) {
            addDomListener(button, "click", () => setBrushColor(button.dataset.fabricPilotColor));
          }
          return {
            settingsButton,
            panel,
            colorButtons,
            sizeInput: sizeRow.input,
            opacityInput: opacityRow.input,
            sizeOutput: sizeRow.output,
            opacityOutput: opacityRow.output,
            summary,
            colorPreview,
            sizePreview
          };
        }
        function createId(prefix) {
          localSequence += 1;
          const randomUUID = windowRef?.crypto?.randomUUID || globalThis.crypto?.randomUUID;
          return typeof randomUUID === "function" ? randomUUID.call(windowRef?.crypto || globalThis.crypto) : `${prefix}-${Date.now()}-${localSequence}`;
        }
        function captureTransform(object) {
          const transform = {};
          for (const field of TRANSFORM_FIELDS) {
            if (typeof object?.[field] === "boolean") transform[field] = object[field];
            else transform[field] = finiteNumber(object?.[field], field === "scaleX" || field === "scaleY" ? 1 : 0);
          }
          return transform;
        }
        function applyMoveOnlyConstraints(object) {
          if (!object?.set) return;
          object.set({
            hasControls: false,
            lockMovementX: false,
            lockMovementY: false,
            lockScalingX: true,
            lockScalingY: true,
            lockScalingFlip: true,
            lockRotation: true,
            lockSkewingX: true,
            lockSkewingY: true
          });
        }
        function applyUnselectedPermanentPathPolicy(object, tolerance = resolveSelectionHitTolerance(currentSession || {})) {
          if (!object?.set) return;
          object.set({
            padding: tolerance,
            perPixelTargetFind: true,
            hoverCursor: "grab",
            moveCursor: "grabbing"
          });
        }
        function applySelectedActivePolicy(object) {
          if (!object?.set) return;
          object.set({
            perPixelTargetFind: false,
            hoverCursor: "move",
            moveCursor: "grabbing"
          });
        }
        function restoreUnsupportedTransform(object, persistedTransform = {}) {
          const values = {};
          for (const field of UNSUPPORTED_PHASE0_TRANSFORM_FIELDS) {
            const fallback = field === "scaleX" || field === "scaleY" ? 1 : field === "flipX" || field === "flipY" ? false : 0;
            values[field] = persistedTransform[field] ?? fallback;
          }
          object.set(values);
          applyMoveOnlyConstraints(object);
          object.setCoords?.();
        }
        function makeFabricPath(record, transient = false) {
          const { Path } = resolveFabric();
          const path = new Path(record.pathData, {
            fill: record.style?.color || DEFAULT_BRUSH_STYLE.color,
            opacity: normalizePathOpacity(record.style?.opacity),
            stroke: null,
            strokeWidth: 0,
            selectable: !transient && sceneStore.getDiagnostics().tool === "select",
            evented: !transient && sceneStore.getDiagnostics().tool === "select",
            objectCaching: !transient,
            perPixelTargetFind: !transient,
            padding: transient ? 0 : resolveSelectionHitTolerance(currentSession || {}),
            hoverCursor: transient ? null : "grab",
            moveCursor: transient ? null : "grabbing",
            hasControls: false,
            lockMovementX: false,
            lockMovementY: false,
            lockScalingX: true,
            lockScalingY: true,
            lockScalingFlip: true,
            lockRotation: true,
            lockSkewingX: true,
            lockSkewingY: true
          });
          if (record.transform) path.set(record.transform);
          if (!transient) {
            applyMoveOnlyConstraints(path);
            applyUnselectedPermanentPathPolicy(path);
          }
          path.__baeframeObjectId = record.id || null;
          path.__baeframeTransient = transient;
          path.setCoords?.();
          return path;
        }
        function updateObjectMetric() {
          metrics.setObjectCount(sceneStore.getDiagnostics().objectCount);
        }
        function renderActiveScene() {
          if (!fabricCanvas) return;
          const snapshot = sceneStore.getActiveSceneSnapshot();
          fabricCanvas.clear();
          for (const record of snapshot?.objects || []) fabricCanvas.add(makeFabricPath(record));
          refreshSelectionInteractionPolicy();
          fabricCanvas.requestRenderAll();
          updateObjectMetric();
        }
        function setToolMode(tool) {
          if (!fabricCanvas) return;
          if (tool !== "select") rollbackPendingLassoVisual();
          const selectMode = tool === "select";
          const nativeSelectMode = selectMode && selectionMode === "stroke";
          for (const [buttonTool, button] of toolButtons) {
            const active = buttonTool === tool;
            button.dataset.active = String(active);
            button.setAttribute?.("aria-pressed", String(active));
          }
          fabricCanvas.isDrawingMode = false;
          fabricCanvas.selection = nativeSelectMode;
          fabricCanvas.defaultCursor = selectMode ? selectionMode === "lasso" ? "crosshair" : "default" : "crosshair";
          fabricCanvas.hoverCursor = "grab";
          fabricCanvas.moveCursor = "grabbing";
          fabricCanvas.freeDrawingCursor = "crosshair";
          for (const object of fabricCanvas.getObjects()) {
            if (object.__baeframeTransient) continue;
            object.set({ selectable: nativeSelectMode, evented: nativeSelectMode });
          }
          if (!selectMode) {
            fabricCanvas.discardActiveObject();
            sceneStore.selectObjects([]);
          }
          syncSelectionControls(tool);
          refreshSelectionInteractionPolicy();
          fabricCanvas.setCursor?.(fabricCanvas.defaultCursor);
          fabricCanvas.requestRenderAll();
        }
        function setSurfaceInput(enabled) {
          const pointerEvents = enabled ? "auto" : "none";
          setStyles(fabricCanvas?.upperCanvasEl, { pointerEvents });
          setStyles(fabricCanvas?.lowerCanvasEl, { pointerEvents });
          setStyles(toolbar, {
            pointerEvents,
            visibility: enabled ? "visible" : "hidden",
            opacity: enabled ? "1" : "0"
          });
        }
        function toSourceSample(event) {
          if (!currentSession) return null;
          const point = mapClientPointToSource(
            event,
            currentSession.canvasRect,
            currentSession.viewportTransform,
            { width: currentSession.sourceWidth, height: currentSession.sourceHeight }
          );
          if (!point) return null;
          return {
            ...point,
            pressure: normalizePressure(event.pressure, event.pointerType),
            pointerType: event.pointerType || "mouse",
            time: finiteNumber(event.timeStamp, now())
          };
        }
        function appendPointerSample(event) {
          const sample = toSourceSample(event);
          if (!sample) return;
          activeStroke.samples.push(sample);
          metrics.recordPointerSample(sample.pressure);
        }
        function removeTransientPreview() {
          if (!activeStroke?.preview || !fabricCanvas) return;
          fabricCanvas.remove(activeStroke.preview);
          activeStroke.preview = null;
        }
        function updateTransientPreview() {
          if (!activeStroke || activeStroke.samples.length === 0) return;
          const startedAt = now();
          removeTransientPreview();
          try {
            const strokeData = strokePathFactory(activeStroke.samples, { size: activeStroke.style.size });
            if (!strokeData.pathData) return;
            activeStroke.preview = makeFabricPath({
              id: null,
              pathData: strokeData.pathData,
              style: { ...activeStroke.style }
            }, true);
            fabricCanvas.add(activeStroke.preview);
            fabricCanvas.requestRenderAll();
            metrics.recordPointerPreviewLatency(now() - startedAt);
          } catch (error) {
            lastError = error.message;
            metrics.recordSurfaceError();
            cancelActiveStroke();
          }
        }
        function cancelActiveStroke() {
          removeTransientPreview();
          activeStroke = null;
          activeLasso = null;
          fabricCanvas?.requestRenderAll();
        }
        function removeLassoPreview() {
          if (!activeLasso?.preview || !fabricCanvas) return;
          fabricCanvas.remove(activeLasso.preview);
          activeLasso.preview = null;
        }
        function appendLassoPoint(event) {
          if (!activeLasso) return;
          const point = mapClientPointToSource(
            event,
            currentSession?.canvasRect,
            currentSession?.viewportTransform,
            { width: currentSession?.sourceWidth, height: currentSession?.sourceHeight }
          );
          if (!point) return;
          const previous = activeLasso.points[activeLasso.points.length - 1];
          if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) return;
          if (activeLasso.points.length >= MAX_LASSO_POINTS) {
            activeLasso.points = activeLasso.points.filter((_sample, index) => index === 0 || index % 2 === 0);
          }
          activeLasso.points.push(point);
        }
        function updateLassoPreview() {
          if (!activeLasso || activeLasso.points.length < 2 || !fabricCanvas) return;
          removeLassoPreview();
          const { Path } = resolveFabric();
          const [first, ...rest] = activeLasso.points;
          const pathData = `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
          const preview = new Path(pathData, {
            fill: "rgba(255, 208, 0, 0.08)",
            stroke: "#ffd000",
            strokeWidth: Math.max(1, resolveSelectionHitTolerance(currentSession || {}) / 3),
            strokeDashArray: [8, 6],
            selectable: false,
            evented: false,
            objectCaching: false,
            perPixelTargetFind: false
          });
          preview.__baeframeObjectId = null;
          preview.__baeframeTransient = true;
          activeLasso.preview = preview;
          fabricCanvas.add(preview);
          fabricCanvas.requestRenderAll();
        }
        function cancelActiveLasso() {
          if (!activeLasso) return;
          const pointerId = activeLasso.pointerId;
          removeLassoPreview();
          activeLasso = null;
          releasePointerCapture(fabricCanvas?.upperCanvasEl || canvasElement, pointerId);
          fabricCanvas?.requestRenderAll();
        }
        function flattenStrokeSourcePoints(record, object) {
          const points = Array.isArray(record?.sourcePoints) ? record.sourcePoints : [];
          const { Point, util } = resolveFabric();
          if (!object?.calcTransformMatrix || !object?.pathOffset || !Point || !util?.transformPoint) {
            return points.map((point) => ({ ...point }));
          }
          const matrix = object.calcTransformMatrix();
          return points.map((point) => {
            const local = new Point(
              finiteNumber(point.x) - finiteNumber(object.pathOffset.x),
              finiteNumber(point.y) - finiteNumber(object.pathOffset.y)
            );
            const transformed = util.transformPoint(local, matrix);
            return { ...point, x: transformed.x, y: transformed.y };
          });
        }
        function createStrokeFragment(record, points, selected, caps = {}) {
          if (!Array.isArray(points) || points.length < 2) return null;
          let strokeData;
          try {
            strokeData = strokePathFactory(points, {
              size: record.style?.size,
              last: true,
              start: { cap: caps.start !== false },
              end: { cap: caps.end !== false }
            });
          } catch (error) {
            lastError = error.message;
            metrics.recordSurfaceError();
            return null;
          }
          if (!strokeData?.pathData || !Array.isArray(strokeData.sourcePoints) || strokeData.sourcePoints.length < 2) {
            return null;
          }
          const fragment = {
            id: createId(selected ? "lasso-selected" : "lasso-remain"),
            type: "stroke",
            pathData: strokeData.pathData,
            sourcePoints: strokeData.sourcePoints,
            style: clonePlain(record.style || DEFAULT_BRUSH_STYLE),
            strokeCaps: {
              start: caps.start !== false,
              end: caps.end !== false
            }
          };
          const path = makeFabricPath(fragment);
          fragment.transform = captureTransform(path);
          return fragment;
        }
        function pendingTargetIncludes(target, objectIds) {
          if (!target || !objectIds?.size) return false;
          const children = typeof target.getObjects === "function" ? target.getObjects() : [target];
          return children.some((object) => objectIds.has(object?.__baeframeObjectId));
        }
        function materializePendingLassoVisual() {
          const pending = pendingLassoVisual;
          if (!pending || !fabricCanvas) return false;
          if (pending.sessionId !== currentSession?.sessionId || pending.inputRevision !== tokenState.inputRevision) {
            pendingLassoVisual = null;
            renderActiveScene();
            return false;
          }
          pendingLassoVisual = null;
          const selectedObjects = new Map(
            fabricCanvas.getObjects().filter((object) => pending.selectedIds.has(object.__baeframeObjectId)).map((object) => [object.__baeframeObjectId, object])
          );
          for (const original of pending.originalObjects) fabricCanvas.remove(original);
          for (const record of pending.addedObjects) {
            const selectedObject = selectedObjects.get(record.id);
            if (selectedObject) {
              selectedObject.set({ opacity: normalizePathOpacity(record.style?.opacity) });
              selectedObject.__baeframePendingLasso = false;
              selectedObject.setCoords?.();
              continue;
            }
            fabricCanvas.add(makeFabricPath(record));
          }
          const order = sceneStore.getActiveSceneSnapshot()?.objects.map((object) => object.id) || [];
          const objectsById = new Map(
            fabricCanvas.getObjects().filter((object) => object.__baeframeObjectId).map((object) => [object.__baeframeObjectId, object])
          );
          order.forEach((id, index) => {
            const object = objectsById.get(id);
            if (object) fabricCanvas.moveObjectTo?.(object, index);
          });
          refreshSelectionInteractionPolicy();
          fabricCanvas.requestRenderAll();
          return true;
        }
        function rollbackPendingLassoVisual() {
          const pending = pendingLassoVisual;
          if (!pending || !fabricCanvas) return false;
          pendingLassoVisual = null;
          fabricCanvas.discardActiveObject();
          for (const object of [...fabricCanvas.getObjects()]) {
            if (object.__baeframePendingLasso) fabricCanvas.remove(object);
          }
          const result = sceneStore.undo();
          if (!result.applied) {
            renderActiveScene();
            return false;
          }
          sceneStore.selectObjects([]);
          refreshSelectionInteractionPolicy();
          fabricCanvas.requestRenderAll();
          updateObjectMetric();
          return true;
        }
        function activateObjectIds(objectIds = []) {
          if (!fabricCanvas) return;
          const ids = new Set(objectIds);
          fabricCanvas.discardActiveObject();
          const objects = fabricCanvas.getObjects().filter((object) => ids.has(object.__baeframeObjectId));
          for (const object of fabricCanvas.getObjects()) {
            if (object.__baeframeTransient) continue;
            const selected = ids.has(object.__baeframeObjectId);
            object.set({ selectable: selected, evented: selected });
          }
          if (objects.length === 1) {
            fabricCanvas.setActiveObject?.(objects[0]);
          } else if (objects.length > 1) {
            const { ActiveSelection } = resolveFabric();
            if (ActiveSelection) {
              fabricCanvas.setActiveObject?.(new ActiveSelection(objects, { canvas: fabricCanvas }));
            }
          }
          sceneStore.selectObjects(objects.map((object) => object.__baeframeObjectId));
          refreshSelectionInteractionPolicy();
          fabricCanvas.requestRenderAll();
        }
        function finalizeActiveLasso() {
          if (!activeLasso) return { applied: false, reason: "no-active-lasso" };
          const sourcePerCssPixel = currentSession ? currentSession.sourceWidth / Math.max(1, currentSession.canvasRect.width) / Math.max(0.01, Math.abs(finiteNumber(currentSession.viewportTransform?.scale, 1))) : 1;
          const polygon = simplifyClosedPolygon(
            activeLasso.points,
            Math.min(8, Math.max(0.25, sourcePerCssPixel * 1.5))
          );
          removeLassoPreview();
          activeLasso = null;
          if (polygon.length < 3 || !polygonHasArea(polygon, 1)) {
            activateObjectIds([]);
            return { applied: false, reason: "lasso-too-small" };
          }
          const snapshot = sceneStore.getActiveSceneSnapshot();
          const canvasObjects = new Map(
            fabricCanvas.getObjects().filter((object) => object.__baeframeObjectId).map((object) => [object.__baeframeObjectId, object])
          );
          const replacements = [];
          const selectedObjectIds = [];
          const polygonBounds = boundsForPoints(polygon);
          const sceneLimits = sceneStore.getDiagnostics();
          let accumulatedFragments = 0;
          for (const record of snapshot?.objects || []) {
            if (record.type !== "stroke") continue;
            const flattenedPoints = flattenStrokeSourcePoints(record, canvasObjects.get(record.id));
            const maximumRadius = Math.max(1, finiteNumber(record.style?.size, 1)) * 0.825;
            if (!boundsIntersect(boundsForPoints(flattenedPoints, maximumRadius), polygonBounds)) continue;
            const split = splitStrokePointsByPolygon(flattenedPoints, polygon, {
              size: record.style?.size,
              thinning: 0.65,
              maxRuns: Math.max(1, maxLassoFragments - accumulatedFragments + 1)
            });
            if (split.limitExceeded) {
              activateObjectIds([]);
              return { applied: false, reason: "lasso-fragment-limit-exceeded", selectedObjectIds: [] };
            }
            if (split.inside.length === 0) continue;
            if (split.outside.length === 0) {
              selectedObjectIds.push(record.id);
              continue;
            }
            accumulatedFragments += split.runs.length;
            const projectedObjectCount = snapshot.objects.length - (replacements.length + 1) + accumulatedFragments;
            if (accumulatedFragments > maxLassoFragments || projectedObjectCount > sceneLimits.maxObjects) {
              activateObjectIds([]);
              return { applied: false, reason: "lasso-fragment-limit-exceeded", selectedObjectIds: [] };
            }
            const addObjects = [];
            let fragmentBuildFailed = false;
            const originalCaps = record.strokeCaps || { start: true, end: true };
            for (let runIndex = 0; runIndex < split.runs.length; runIndex += 1) {
              const run = split.runs[runIndex];
              const selected = run.kind === "inside";
              const fragment = createStrokeFragment(record, run.points, selected, {
                start: runIndex === 0 ? originalCaps.start !== false : false,
                end: runIndex === split.runs.length - 1 ? originalCaps.end !== false : false
              });
              if (!fragment) {
                fragmentBuildFailed = true;
                break;
              }
              addObjects.push(fragment);
              if (selected) selectedObjectIds.push(fragment.id);
            }
            if (fragmentBuildFailed) {
              activateObjectIds([]);
              return { applied: false, reason: "fragment-build-failed", selectedObjectIds: [] };
            }
            replacements.push({ removeId: record.id, addObjects });
          }
          let result = { applied: false, selectedObjectIds };
          if (replacements.length > 0 && selectedObjectIds.length > 0) {
            result = sceneStore.replaceObjects({ replacements, selectedObjectIds });
            if (!result.applied) {
              activateObjectIds([]);
              return result;
            }
            const addedObjects = replacements.flatMap((replacement) => replacement.addObjects);
            const selectedIds = new Set(selectedObjectIds);
            const originalObjects = replacements.map((replacement) => canvasObjects.get(replacement.removeId)).filter(Boolean);
            const selectedFragments = addedObjects.filter((record) => selectedIds.has(record.id));
            const canDeferVisualSplit = result.undoRecorded === true && originalObjects.length === replacements.length && selectedFragments.length > 0;
            if (canDeferVisualSplit) {
              const proxyObjects = [];
              for (const record of selectedFragments) {
                const proxy = makeFabricPath(record);
                proxy.set({ opacity: 0 });
                proxy.__baeframePendingLasso = true;
                proxyObjects.push(proxy);
                fabricCanvas.add(proxy);
              }
              pendingLassoVisual = {
                sessionId: currentSession?.sessionId,
                inputRevision: tokenState.inputRevision,
                originalObjects,
                addedObjects,
                selectedIds,
                proxyObjects
              };
              refreshSelectionInteractionPolicy();
              fabricCanvas.requestRenderAll();
            } else {
              renderActiveScene();
            }
            updateObjectMetric();
          }
          activateObjectIds(selectedObjectIds);
          return { ...result, selectedObjectIds };
        }
        function pointerTargetsActiveSelection(event) {
          const activeObject = fabricCanvas?.getActiveObject?.();
          if (!activeObject) return false;
          try {
            const point = fabricCanvas.getScenePoint?.(event) || {
              x: finiteNumber(event?.clientX),
              y: finiteNumber(event?.clientY)
            };
            const bounds = activeObject.getBoundingRect?.();
            if (bounds && point.x >= bounds.left && point.x <= bounds.left + bounds.width && point.y >= bounds.top && point.y <= bounds.top + bounds.height) {
              return true;
            }
          } catch (_error) {
          }
          let target = null;
          try {
            target = fabricCanvas.findTarget?.(event) || null;
          } catch (_error) {
          }
          if (target === activeObject) return true;
          const activeChildren = typeof activeObject.getObjects === "function" ? activeObject.getObjects() : [];
          return activeChildren.includes(target);
        }
        function finalizeActiveStroke() {
          if (!activeStroke || activeStroke.samples.length === 0) {
            cancelActiveStroke();
            return { applied: false };
          }
          const samples = activeStroke.samples;
          const style = { ...activeStroke.style };
          removeTransientPreview();
          let strokeData;
          try {
            strokeData = strokePathFactory(samples, { size: style.size, last: true });
          } catch (error) {
            lastError = error.message;
            metrics.recordSurfaceError();
            activeStroke = null;
            return { applied: false, reason: "stroke-path-error" };
          }
          const record = {
            id: createId("stroke"),
            type: "stroke",
            pathData: strokeData.pathData,
            sourcePoints: strokeData.sourcePoints,
            style
          };
          const path = makeFabricPath(record);
          record.transform = captureTransform(path);
          const result = sceneStore.addStroke(record);
          activeStroke = null;
          if (!result.applied) return result;
          fabricCanvas.add(path);
          fabricCanvas.requestRenderAll();
          updateObjectMetric();
          return result;
        }
        function releasePointerCapture(target, pointerId) {
          try {
            if (typeof target?.hasPointerCapture === "function" && !target.hasPointerCapture(pointerId)) return;
            target?.releasePointerCapture?.(pointerId);
          } catch (_error) {
          }
        }
        function rollbackSelectTransform(event, shouldEndTransform) {
          const start = transformStart;
          if (!start?.target) {
            transformStart = null;
            return;
          }
          try {
            start.target.set?.(start.transform);
            applyMoveOnlyConstraints(start.target);
            start.target.setCoords?.();
            if (shouldEndTransform) fabricCanvas?.endCurrentTransform?.(event);
          } catch (error) {
            lastError = error.message;
            metrics.recordSurfaceError();
          }
          transformStart = null;
          fabricCanvas?.requestRenderAll();
        }
        function drainFabricPointerLifecycle(gesture, event) {
          const targetDocument = fabricCanvas?.upperCanvasEl?.ownerDocument || documentRef;
          if (!gesture || typeof targetDocument?.dispatchEvent !== "function") return;
          try {
            const properties = {
              clientX: finiteNumber(event?.clientX),
              clientY: finiteNumber(event?.clientY),
              pointerId: gesture.pointerId,
              pointerType: event?.pointerType || "mouse",
              isPrimary: true,
              button: 0,
              buttons: 0,
              pressure: 0
            };
            let pointerUp;
            if (typeof windowRef?.PointerEvent === "function") {
              pointerUp = new windowRef.PointerEvent("pointerup", {
                bubbles: true,
                cancelable: true,
                ...properties
              });
            } else {
              pointerUp = new windowRef.Event("pointerup", { bubbles: true, cancelable: true });
              for (const [name, value] of Object.entries(properties)) {
                Object.defineProperty(pointerUp, name, { value });
              }
            }
            targetDocument.dispatchEvent(pointerUp);
          } catch (_error) {
          }
        }
        function cancelSelectInteraction(event) {
          const gesture = selectGesture;
          const hadTransformTarget = !!transformStart?.target;
          const wasTracking = gesture?.phase === "tracking";
          if (gesture) gesture.phase = "cancelling";
          rollbackSelectTransform(event, wasTracking);
          drainFabricPointerLifecycle(gesture, event);
          if (gesture && !hadTransformTarget) {
            fabricCanvas?.discardActiveObject();
            sceneStore.selectObjects([]);
          }
          if (gesture) {
            releasePointerCapture(fabricCanvas?.upperCanvasEl || canvasElement, gesture.pointerId);
          }
          selectGesture = null;
          transformStart = null;
          deferredViewport = null;
          if (gesture && pendingLassoVisual) {
            rollbackPendingLassoVisual();
            return;
          }
          refreshSelectionInteractionPolicy();
          fabricCanvas?.requestRenderAll();
        }
        function settleDeferredViewport(sessionId, inputRevision) {
          const pending = deferredViewport;
          deferredViewport = null;
          if (!pending || pending.sessionId !== sessionId || pending.inputRevision !== inputRevision) return false;
          if (destroyed || !inputEnabled || !fabricCanvas || currentSession?.sessionId !== sessionId) return false;
          if (pending.command.revision <= currentSession.viewportRevision) return false;
          applyViewportCommand(pending.command);
          return true;
        }
        function scheduleSelectGestureSettle(gesture) {
          const pointerId = gesture.pointerId;
          queueMicrotaskRef(() => {
            if (selectGesture !== gesture || gesture.pointerId !== pointerId || gesture.phase !== "settling") return;
            if (destroyed || !inputEnabled || !fabricCanvas || currentSession?.sessionId !== gesture.sessionId || tokenState.inputRevision !== gesture.inputRevision) {
              selectGesture = null;
              transformStart = null;
              deferredViewport = null;
              return;
            }
            transformStart = null;
            selectGesture = null;
            settleDeferredViewport(gesture.sessionId, gesture.inputRevision);
          });
        }
        function onPointerDown(event) {
          if (!inputEnabled || event.button !== 0) return;
          const tool = sceneStore.getDiagnostics().tool;
          if (tool === "brush") {
            if (activeStroke || selectGesture) return;
            activeStroke = {
              pointerId: event.pointerId,
              samples: [],
              preview: null,
              style: { ...brushStyle }
            };
            event.currentTarget?.setPointerCapture?.(event.pointerId);
            appendPointerSample(event);
            updateTransientPreview();
            event.preventDefault?.();
            return;
          }
          if (tool !== "select" || selectGesture || activeStroke) return;
          if (selectionMode === "lasso") {
            if (activeLasso) return;
            if (pointerTargetsActiveSelection(event)) {
              selectGesture = {
                pointerId: event.pointerId,
                sessionId: currentSession?.sessionId,
                inputRevision: tokenState.inputRevision,
                phase: "tracking"
              };
              try {
                event.currentTarget?.setPointerCapture?.(event.pointerId);
              } catch (_error) {
              }
              return;
            }
            rollbackPendingLassoVisual();
            activeLasso = {
              pointerId: event.pointerId,
              sessionId: currentSession?.sessionId,
              inputRevision: tokenState.inputRevision,
              points: [],
              preview: null
            };
            fabricCanvas.discardActiveObject();
            sceneStore.selectObjects([]);
            try {
              event.currentTarget?.setPointerCapture?.(event.pointerId);
            } catch (_error) {
            }
            appendLassoPoint(event);
            event.preventDefault?.();
            return;
          }
          selectGesture = {
            pointerId: event.pointerId,
            sessionId: currentSession?.sessionId,
            inputRevision: tokenState.inputRevision,
            phase: "tracking"
          };
          try {
            event.currentTarget?.setPointerCapture?.(event.pointerId);
          } catch (_error) {
          }
        }
        function onPointerMove(event) {
          if (activeLasso) {
            if (event.pointerId !== activeLasso.pointerId) return;
            appendLassoPoint(event);
            updateLassoPreview();
            event.preventDefault?.();
            return;
          }
          if (!activeStroke || event.pointerId !== activeStroke.pointerId) return;
          const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
          const samples = coalesced.length > 0 ? coalesced : [event];
          for (const sample of samples) appendPointerSample(sample);
          updateTransientPreview();
          event.preventDefault?.();
        }
        function onPointerUp(event) {
          if (activeLasso) {
            if (event.pointerId !== activeLasso.pointerId) return;
            const { sessionId, inputRevision } = activeLasso;
            appendLassoPoint(event);
            releasePointerCapture(event.currentTarget || fabricCanvas?.upperCanvasEl, event.pointerId);
            finalizeActiveLasso();
            settleDeferredViewport(sessionId, inputRevision);
            event.preventDefault?.();
            return;
          }
          if (activeStroke) {
            if (event.pointerId !== activeStroke.pointerId) return;
            appendPointerSample(event);
            releasePointerCapture(event.currentTarget, event.pointerId);
            finalizeActiveStroke();
            event.preventDefault?.();
            return;
          }
          const gesture = selectGesture;
          if (!gesture || gesture.phase !== "tracking" || event.pointerId !== gesture.pointerId) return;
          gesture.phase = "settling";
          releasePointerCapture(fabricCanvas?.upperCanvasEl || canvasElement, event.pointerId);
          scheduleSelectGestureSettle(gesture);
        }
        function onPointerCancel(event) {
          if (activeLasso) {
            if (event.pointerId !== void 0 && event.pointerId !== activeLasso.pointerId) return;
            const { sessionId, inputRevision } = activeLasso;
            cancelActiveLasso();
            settleDeferredViewport(sessionId, inputRevision);
            return;
          }
          if (activeStroke) {
            if (event.pointerId !== void 0 && event.pointerId !== activeStroke.pointerId) return;
            cancelActiveStroke();
            return;
          }
          const gesture = selectGesture;
          if (!gesture || event.pointerId !== void 0 && event.pointerId !== gesture.pointerId) return;
          if (event.type === "lostpointercapture" && gesture.phase === "settling") return;
          cancelSelectInteraction(event);
        }
        function onDocumentPointerUp(event) {
          if (activeLasso && event.pointerId === activeLasso.pointerId) {
            onPointerUp(event);
            return;
          }
          if (!selectGesture || event.pointerId !== selectGesture.pointerId) return;
          onPointerUp(event);
        }
        function onDocumentPointerCancel(event) {
          if (activeLasso && event.pointerId === activeLasso.pointerId) {
            onPointerCancel(event);
            return;
          }
          if (!selectGesture || event.pointerId !== selectGesture.pointerId) return;
          onPointerCancel(event);
        }
        function selectionIds() {
          const objects = fabricCanvas?.getActiveObjects?.() || [];
          return objects.map((object) => object.__baeframeObjectId).filter(Boolean);
        }
        function scheduleMovedMultiSelectionRelease(target, selectedIds) {
          const sessionId = currentSession?.sessionId;
          const inputRevision = tokenState.inputRevision;
          const expectedSelection = [...selectedIds].sort().join(SCENE_KEY_SEPARATOR);
          queueMicrotaskRef(() => {
            if (destroyed || !inputEnabled || !fabricCanvas) return;
            if (currentSession?.sessionId !== sessionId || tokenState.inputRevision !== inputRevision) return;
            if (fabricCanvas.getActiveObject?.() !== target) return;
            if (selectionIds().sort().join(SCENE_KEY_SEPARATOR) !== expectedSelection) return;
            fabricCanvas.discardActiveObject();
            sceneStore.selectObjects([]);
            refreshSelectionInteractionPolicy();
            fabricCanvas.setCursor?.(fabricCanvas.defaultCursor || "default");
            fabricCanvas.requestRenderAll();
          });
        }
        function onSelectionChanged() {
          refreshSelectionInteractionPolicy();
          sceneStore.selectObjects(selectionIds());
        }
        function onSelectionCleared() {
          refreshSelectionInteractionPolicy();
          sceneStore.selectObjects([]);
        }
        function onBeforeTransform(event) {
          const target = event?.transform?.target || event?.target;
          if (!target) return;
          transformStart = {
            target,
            transform: captureTransform(target)
          };
        }
        function onObjectMoving(event) {
          const target = event?.target;
          if (!pendingLassoVisual || !pendingTargetIncludes(target, pendingLassoVisual.selectedIds)) return;
          materializePendingLassoVisual();
        }
        function onObjectModified(event) {
          const target = event?.target;
          if (!target) return;
          const children = typeof target.getObjects === "function" ? target.getObjects() : [target];
          const ids = children.map((object) => object.__baeframeObjectId).filter(Boolean);
          sceneStore.selectObjects(ids);
          let result;
          if (children.length > 1 && transformStart?.target === target) {
            restoreUnsupportedTransform(target, transformStart.transform);
            result = sceneStore.transformSelection({
              dx: finiteNumber(target.left) - finiteNumber(transformStart.transform.left),
              dy: finiteNumber(target.top) - finiteNumber(transformStart.transform.top)
            });
          } else {
            const persistedObjects = new Map(
              (sceneStore.getActiveSceneSnapshot()?.objects || []).map((object) => [object.id, object.transform || {}])
            );
            result = sceneStore.transformSelection({
              transforms: children.map((object) => {
                const persisted = persistedObjects.get(object.__baeframeObjectId) || {};
                const left = finiteNumber(object.left, finiteNumber(persisted.left));
                const top = finiteNumber(object.top, finiteNumber(persisted.top));
                restoreUnsupportedTransform(object, persisted);
                return { id: object.__baeframeObjectId, transform: { ...captureTransform(object), left, top } };
              })
            });
          }
          const shouldReleaseMultiSelection = result.applied && children.length > 1;
          transformStart = null;
          if (result.applied) updateObjectMetric();
          if (shouldReleaseMultiSelection) scheduleMovedMultiSelectionRelease(target, ids);
        }
        function configureCanvasEvents() {
          const pointerTarget = fabricCanvas.upperCanvasEl || canvasElement;
          addDomListener(pointerTarget, "pointerdown", onPointerDown, true);
          addDomListener(pointerTarget, "pointermove", onPointerMove);
          addDomListener(pointerTarget, "pointerup", onPointerUp);
          addDomListener(pointerTarget, "pointercancel", onPointerCancel);
          addDomListener(pointerTarget, "lostpointercapture", onPointerCancel);
          addDomListener(documentRef, "pointerup", onDocumentPointerUp);
          addDomListener(documentRef, "pointercancel", onDocumentPointerCancel);
          addDomListener(windowRef, "blur", onPointerCancel);
          addFabricListener("selection:created", onSelectionChanged);
          addFabricListener("selection:updated", onSelectionChanged);
          addFabricListener("selection:cleared", onSelectionCleared);
          addFabricListener("before:transform", onBeforeTransform);
          addFabricListener("object:moving", onObjectMoving);
          addFabricListener("object:modified", onObjectModified);
        }
        function configureLongTaskObserver() {
          const Observer = options.PerformanceObserver || windowRef?.PerformanceObserver;
          if (typeof Observer !== "function") return;
          try {
            longTaskObserver = new Observer((list) => {
              for (const entry of list.getEntries()) metrics.recordLongTask(entry.duration);
            });
            longTaskObserver.observe({ type: "longtask", buffered: true });
          } catch (_error) {
            longTaskObserver = null;
          }
        }
        function refreshSelectionInteractionPolicy(session = currentSession) {
          if (!fabricCanvas) return;
          const tolerance = resolveSelectionHitTolerance(session || {});
          const selectTool = sceneStore.getDiagnostics().tool === "select";
          const nativeSelection = selectTool && selectionMode === "stroke";
          const activeIds = new Set(selectionIds());
          fabricCanvas.setTargetFindTolerance?.(tolerance);
          for (const object of fabricCanvas.getObjects()) {
            if (object.__baeframeTransient) continue;
            applyMoveOnlyConstraints(object);
            applyUnselectedPermanentPathPolicy(object, tolerance);
            const activeInLasso = selectTool && selectionMode === "lasso" && activeIds.has(object.__baeframeObjectId);
            object.set({ selectable: nativeSelection || activeInLasso, evented: nativeSelection || activeInLasso });
            object.setCoords?.();
          }
          const activeObject = fabricCanvas.getActiveObject?.();
          const activeChildren = typeof activeObject?.getObjects === "function" ? activeObject.getObjects() : [];
          const isPermanentPath = !!activeObject?.__baeframeObjectId && !activeObject.__baeframeTransient;
          const isPermanentActiveSelection = activeChildren.length > 0 && activeChildren.every(
            (object) => !!object?.__baeframeObjectId && !object.__baeframeTransient
          );
          if (isPermanentPath || isPermanentActiveSelection) {
            applyMoveOnlyConstraints(activeObject);
            applySelectedActivePolicy(activeObject);
            activeObject.set?.({ selectable: true, evented: true });
            activeObject.setCoords?.();
          }
        }
        function applyViewport(session) {
          const rect = session.canvasRect;
          if (session.sourceWidth !== appliedSourceWidth || session.sourceHeight !== appliedSourceHeight) {
            fabricCanvas.setDimensions(
              { width: session.sourceWidth, height: session.sourceHeight },
              { backstoreOnly: true }
            );
            appliedSourceWidth = session.sourceWidth;
            appliedSourceHeight = session.sourceHeight;
          }
          fabricCanvas.setDimensions(
            { width: rect.width, height: rect.height },
            { cssOnly: true }
          );
          refreshSelectionInteractionPolicy(session);
          const viewportTransform = normalizeViewportTransform(session.viewportTransform);
          setStyles(viewportElement, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            transform: `scale(${viewportTransform.scale}) translate(${viewportTransform.panX}px, ${viewportTransform.panY}px)`,
            transformOrigin: "center center"
          });
          fabricCanvas.calcOffset();
          fabricCanvas.requestRenderAll();
        }
        function applyViewportCommand(command) {
          currentSession.canvasRect = {
            left: finiteNumber(command.canvasRect.left),
            top: finiteNumber(command.canvasRect.top),
            width: finiteNumber(command.canvasRect.width),
            height: finiteNumber(command.canvasRect.height)
          };
          currentSession.viewportTransform = normalizeViewportTransform(command);
          currentSession.viewportRevision = command.revision;
          applyViewport(currentSession);
        }
        function validateSession(session) {
          return !!session && typeof session.sessionId === "string" && session.sessionId.length > 0 && typeof session.stableVideoIdentity === "string" && session.stableVideoIdentity.length > 0 && Number.isInteger(Number(session.targetFrame)) && Number(session.targetFrame) >= 0 && finiteNumber(session.sourceWidth) > 0 && finiteNumber(session.sourceHeight) > 0 && finiteNumber(session.canvasRect?.width) > 0 && finiteNumber(session.canvasRect?.height) > 0;
        }
        function disableInput() {
          rollbackPendingLassoVisual();
          cancelActiveLasso();
          cancelSelectInteraction();
          setSurfaceInput(false);
          fabricCanvas?.setCursor?.("default");
          cancelActiveStroke();
          fabricCanvas?.discardActiveObject();
          refreshSelectionInteractionPolicy();
          sceneStore.selectObjects([]);
          inputEnabled = false;
          currentSession = null;
          sceneStore.deactivateSession();
          if (badge) badge.textContent = "\uC0C8 \uB4DC\uB85C\uC789 \uC2DC\uD5D8\uD310 \xB7 \uC800\uC7A5 \uC548 \uB428 \xB7 \uC2DC\uD5D8 \uD504\uB808\uC784 -";
        }
        function releaseSurfaceResources() {
          cancelSelectInteraction();
          for (const { target, type, listener, listenerOptions } of domListeners.splice(0)) {
            try {
              target?.removeEventListener?.(type, listener, listenerOptions);
            } catch (_error) {
            }
          }
          for (const { type, listener } of fabricListeners.splice(0)) {
            try {
              fabricCanvas?.off?.(type, listener);
            } catch (_error) {
            }
          }
          try {
            longTaskObserver?.disconnect?.();
          } catch (_error) {
          }
          longTaskObserver = null;
          try {
            fabricCanvas?.dispose?.();
          } catch (_error) {
          }
          try {
            container?.remove?.();
          } catch (_error) {
          }
          toolButtons.clear();
          fabricCanvas = null;
          appliedSourceWidth = null;
          appliedSourceHeight = null;
          activeStroke = null;
          pendingLassoVisual = null;
          transformStart = null;
          selectGesture = null;
          deferredViewport = null;
          inputEnabled = false;
          currentSession = null;
          viewportElement = null;
          canvasElement = null;
          toolbar = null;
          brushControls = null;
          selectionControls = null;
          badge = null;
          container = null;
          root = null;
          prepared = false;
        }
        function prepare(nextRoot) {
          if (destroyed) return { prepared: false, reason: "destroyed" };
          if (prepared) {
            return nextRoot === root ? { prepared: true, reused: true } : { prepared: false, reason: "already-prepared-for-another-root" };
          }
          if (!nextRoot?.appendChild || !documentRef?.createElement) {
            return { prepared: false, reason: "invalid-root" };
          }
          try {
            resolveFabric();
            root = nextRoot;
            container = documentRef.createElement("div");
            container.className = "mpv-fabric-overlay-surface";
            setStyles(container, {
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: "40"
            });
            viewportElement = documentRef.createElement("div");
            viewportElement.className = "mpv-fabric-pilot-viewport";
            setStyles(viewportElement, { position: "absolute", pointerEvents: "none" });
            canvasElement = documentRef.createElement("canvas");
            canvasElement.className = "mpv-fabric-delta-canvas";
            toolbar = documentRef.createElement("div");
            toolbar.className = "mpv-fabric-pilot-toolbar";
            setStyles(toolbar, {
              position: "absolute",
              top: "12px",
              left: "12px",
              display: "flex",
              gap: "6px",
              zIndex: "2",
              transition: "opacity 100ms ease",
              pointerEvents: "none"
            });
            const brushButton = createButton("Brush", "brush");
            const selectButton = createButton("V", "select");
            const deleteButton = createButton("Delete", "delete-selection");
            const clearButton = createButton("Clear", "clear-session");
            brushControls = createBrushSettingsControls();
            selectionControls = createSelectionModeControls();
            badge = documentRef.createElement("span");
            badge.className = "mpv-fabric-pilot-badge";
            badge.textContent = "\uC0C8 \uB4DC\uB85C\uC789 \uC2DC\uD5D8\uD310 \xB7 \uC800\uC7A5 \uC548 \uB428 \xB7 \uC2DC\uD5D8 \uD504\uB808\uC784 -";
            toolbar.appendChild(brushButton);
            toolbar.appendChild(selectButton);
            toolbar.appendChild(selectionControls.group);
            toolbar.appendChild(deleteButton);
            toolbar.appendChild(clearButton);
            toolbar.appendChild(brushControls.settingsButton);
            toolbar.appendChild(brushControls.panel);
            toolbar.appendChild(badge);
            viewportElement.appendChild(canvasElement);
            container.appendChild(viewportElement);
            container.appendChild(toolbar);
            root.appendChild(container);
            const { Canvas } = resolveFabric();
            fabricCanvas = new Canvas(canvasElement, {
              selection: true,
              preserveObjectStacking: true,
              enableRetinaScaling: false,
              enablePointerEvents: true,
              defaultCursor: "default",
              hoverCursor: "grab",
              moveCursor: "grabbing",
              freeDrawingCursor: "crosshair"
            });
            configureCanvasEvents();
            addDomListener(brushButton, "click", () => updateLocalDrawingTool("brush"));
            addDomListener(selectButton, "click", () => updateLocalDrawingTool("select"));
            addDomListener(deleteButton, "click", () => applyDrawingAction({
              sessionId: currentSession?.sessionId,
              actionId: createId("delete"),
              action: "delete-selection"
            }));
            addDomListener(clearButton, "click", () => applyDrawingAction({
              sessionId: currentSession?.sessionId,
              actionId: createId("clear"),
              action: "clear-session"
            }));
            syncBrushControls();
            syncSelectionControls("brush");
            setSurfaceInput(false);
            configureLongTaskObserver();
            prepared = true;
            return { prepared: true, reused: false };
          } catch (error) {
            releaseSurfaceResources();
            lastError = error.message;
            metrics.recordSurfaceError();
            return { prepared: false, reason: "fabric-prepare-failed", error: error.message };
          }
        }
        function setDrawingInput(request = {}) {
          const startedAt = now();
          if (!prepared || destroyed) return { accepted: false, reason: destroyed ? "destroyed" : "not-prepared" };
          if (!shouldAcceptInputRequest(tokenState, request)) {
            metrics.recordStaleMessageDrop();
            return { accepted: false, reason: "stale-or-invalid-input-request" };
          }
          if (request.enabled && !validateSession(request.session)) {
            return { accepted: false, reason: "invalid-session" };
          }
          rollbackPendingLassoVisual();
          if (activeStroke) cancelActiveStroke();
          if (activeLasso) cancelActiveLasso();
          if (selectGesture || transformStart || deferredViewport) cancelSelectInteraction();
          tokenState.hostGeneration = Number(request.hostGeneration);
          tokenState.videoGeneration = Number(request.videoGeneration);
          tokenState.inputRevision = Number(request.inputRevision);
          if (!request.enabled) {
            const lastTool = currentSession?.tool === "select" ? "select" : "brush";
            disableInput();
            metrics.recordToggleLatency(now() - startedAt);
            return { accepted: true, enabled: false, tool: lastTool };
          }
          const session = {
            ...clonePlain(request.session),
            targetFrame: Number(request.session.targetFrame),
            sourceWidth: Number(request.session.sourceWidth),
            sourceHeight: Number(request.session.sourceHeight),
            videoGeneration: Number(request.videoGeneration),
            viewportRevision: Math.max(-1, Math.trunc(Number(request.session.viewportRevision) || 0)),
            viewportTransform: normalizeViewportTransform(request.session.viewportTransform),
            tool: request.session.tool === "select" ? "select" : "brush"
          };
          const activation = sceneStore.activateSession(session);
          if (!activation.accepted) {
            metrics.recordStaleMessageDrop();
            return activation;
          }
          currentSession = session;
          applyViewport(session);
          renderActiveScene();
          setToolMode(session.tool);
          inputEnabled = true;
          setSurfaceInput(true);
          badge.textContent = `\uC0C8 \uB4DC\uB85C\uC789 \uC2DC\uD5D8\uD310 \xB7 \uC800\uC7A5 \uC548 \uB428 \xB7 \uC2DC\uD5D8 \uD504\uB808\uC784 ${session.targetFrame}`;
          metrics.recordToggleLatency(now() - startedAt);
          return { accepted: true, enabled: true, restored: activation.restored };
        }
        function updateViewport(command = {}) {
          if (!inputEnabled || !currentSession) return { accepted: false, reason: "input-disabled" };
          const revision = Number(command.revision);
          const rect = command.canvasRect;
          if (!Number.isInteger(revision) || revision < 0 || !rect || finiteNumber(rect.width) <= 0 || finiteNumber(rect.height) <= 0) {
            return { accepted: false, reason: "invalid-viewport" };
          }
          const pendingRevision = deferredViewport?.command?.revision ?? -1;
          if (revision <= Math.max(currentSession.viewportRevision, pendingRevision)) {
            return { accepted: false, reason: "stale-viewport" };
          }
          const normalizedCommand = {
            revision,
            canvasRect: {
              left: finiteNumber(rect.left),
              top: finiteNumber(rect.top),
              width: finiteNumber(rect.width),
              height: finiteNumber(rect.height)
            },
            ...normalizeViewportTransform(command)
          };
          if (activeLasso || selectGesture || transformStart !== null) {
            deferredViewport = {
              sessionId: currentSession.sessionId,
              inputRevision: tokenState.inputRevision,
              command: normalizedCommand
            };
            return { accepted: true, deferred: true, revision };
          }
          cancelActiveStroke();
          applyViewportCommand(normalizedCommand);
          return { accepted: true, revision };
        }
        function updateDrawingTool(command = {}) {
          if (!inputEnabled) return { accepted: false, reason: "input-disabled" };
          const normalized = { ...command, tool: command.tool === "select" || command.tool === "V" ? "select" : command.tool };
          const result = sceneStore.updateTool(normalized);
          if (!result.accepted) {
            metrics.recordStaleMessageDrop();
            return result;
          }
          currentSession.tool = result.tool;
          setToolMode(result.tool);
          return result;
        }
        function updateLocalDrawingTool(tool) {
          if (!inputEnabled) return { accepted: false, reason: "input-disabled" };
          const result = sceneStore.setLocalTool({ sessionId: currentSession?.sessionId, tool });
          if (!result.accepted) return result;
          currentSession.tool = result.tool;
          setToolMode(result.tool);
          return result;
        }
        function applyDrawingAction(command = {}) {
          if (!inputEnabled || command.sessionId !== currentSession?.sessionId) {
            return { applied: false, reason: "stale-session" };
          }
          const action = command.action || command.type;
          if (action !== "delete-selection" && action !== "clear-session" && action !== "undo") {
            return { applied: false, reason: "invalid-action" };
          }
          if (!actionDeduper.accept(command.actionId)) {
            metrics.recordDuplicateAction();
            return { applied: false, duplicate: true };
          }
          materializePendingLassoVisual();
          const result = action === "delete-selection" ? sceneStore.deleteSelection() : action === "clear-session" ? sceneStore.clearSession() : sceneStore.undo();
          if (result.applied) {
            if (action === "undo") {
              renderActiveScene();
              fabricCanvas.discardActiveObject();
              sceneStore.selectObjects([]);
              setToolMode(currentSession?.tool || "brush");
              updateObjectMetric();
              return result;
            }
            const deletedIds = new Set(result.deletedIds);
            for (const object of fabricCanvas.getObjects()) {
              if (action === "clear-session" || deletedIds.has(object.__baeframeObjectId)) fabricCanvas.remove(object);
            }
            fabricCanvas.discardActiveObject();
            refreshSelectionInteractionPolicy();
            fabricCanvas.requestRenderAll();
            updateObjectMetric();
          }
          return result;
        }
        function getDiagnostics() {
          const scene = sceneStore.getDiagnostics();
          return {
            state: destroyed ? "destroyed" : inputEnabled ? "active" : "passive",
            prepared,
            inputEnabled,
            devicePixelRatio,
            tokens: { ...tokenState },
            activeSessionId: scene.activeSessionId,
            activeSceneKey: scene.activeSceneKey,
            targetFrame: currentSession?.targetFrame ?? null,
            viewportRevision: currentSession?.viewportRevision ?? null,
            tool: scene.tool,
            selectionMode,
            objectCount: scene.objectCount,
            selectionCount: scene.selectionCount,
            mutationCount: scene.mutationCount,
            dirty: scene.dirty,
            undoDepth: scene.undoDepth,
            undoBytes: scene.undoBytes,
            cache: {
              videoCount: scene.videoCount,
              sceneCount: scene.sceneCount,
              estimatedBytes: scene.estimatedBytes,
              evictionCount: scene.evictionCount
            },
            metrics: metrics.snapshot(),
            lastError
          };
        }
        function destroy() {
          if (destroyed) return { destroyed: true, reused: true };
          disableInput();
          releaseSurfaceResources();
          sceneStore.destroy();
          actionDeduper.clear();
          destroyed = true;
          return { destroyed: true, reused: false };
        }
        return {
          prepare,
          setDrawingInput,
          updateDrawingTool,
          updateViewport,
          applyDrawingAction,
          getDiagnostics,
          destroy
        };
      }
      if (typeof window !== "undefined" && window && !window.__mpvFabricOverlay) {
        window.__mpvFabricOverlay = createFabricOverlayRuntime({
          window,
          document: typeof document !== "undefined" ? document : null
        });
      }
      module.exports = {
        createFabricOverlayRuntime,
        createSessionSceneStore,
        normalizePressure,
        createStrokePathData,
        createActionDeduper,
        shouldAcceptInputRequest,
        resolveEffectiveCanvasRect,
        resolveSelectionHitTolerance,
        mapClientPointToSource,
        splitStrokePointsByPolygon
      };
    }
  });
  require_mpv_fabric_overlay_runtime();
})();
