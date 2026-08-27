'use strict';

/**
 * Fabric 드로잉 지속화(persistence) 한도 상수 단일 소스.
 *
 * 세 계층이 같은 한도를 써야 한 계층이 통과시킨 스냅샷을 다른 계층이 거부하는
 * 비대칭 검증(= invalid-persistence-snapshot 래치의 발원)이 생기지 않는다.
 *
 * - main/mpv-overlay-host.js: require (Node CommonJS)
 * - renderer/scripts/modules/mpv-fabric-overlay-runtime.js: require
 *   (esbuild 번들 시 인라인됨 — shared/drawing-render-geometry.js와 동일 경로)
 * - renderer/scripts/modules/fabric-drawing-persistence-store.js: 브라우저 네이티브
 *   ES 모듈이라 CommonJS를 import 할 수 없으므로 리터럴을 유지하고,
 *   scripts/tests/fabric-drawing-persistence-store.test.mjs의 파리티 테스트가
 *   이 파일과 값이 같음을 강제한다.
 */

const FABRIC_DRAWING_MAX_DOCUMENT_BYTES = 128 * 1024 * 1024;
const FABRIC_DRAWING_MAX_TRANSITION_BYTES = 8 * 1024 * 1024;
const FABRIC_DRAWING_MAX_KEYFRAMES = 10000;
const FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME = 10000;
const FABRIC_DRAWING_MAX_OBJECTS_TOTAL = 100000;
const FABRIC_DRAWING_MAX_POINTS_PER_STROKE = 20000;
const FABRIC_DRAWING_MAX_SOURCE_DIMENSION = 1_000_000;
const FABRIC_DRAWING_MAX_TOTAL_FRAMES = 1_000_000_000;
const FABRIC_DRAWING_MAX_POINT_COORDINATE = 1_000_000_000;
const FABRIC_DRAWING_MAX_POINT_TIME = 1_000_000_000_000;
const FABRIC_DRAWING_MAX_BRUSH_SIZE = 1_000_000;
const FABRIC_DRAWING_MAX_TRANSFORM_MAGNITUDE = 1_000_000_000;
const FABRIC_DRAWING_MAX_STRING_LENGTH = 32768;

/**
 * fabric-drawing-persistence-store.js의 DEFAULT_LIMITS와 키·값이 완전히 같아야 한다.
 * 파리티 테스트가 deepEqual로 대조한다.
 */
const FABRIC_DRAWING_STORE_LIMITS = Object.freeze({
  maxDocumentBytes: FABRIC_DRAWING_MAX_DOCUMENT_BYTES,
  maxTransitionBytes: FABRIC_DRAWING_MAX_TRANSITION_BYTES,
  maxKeyframes: FABRIC_DRAWING_MAX_KEYFRAMES,
  maxObjectsPerKeyframe: FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME,
  maxObjectsTotal: FABRIC_DRAWING_MAX_OBJECTS_TOTAL,
  maxPointsPerStroke: FABRIC_DRAWING_MAX_POINTS_PER_STROKE
});

module.exports = {
  FABRIC_DRAWING_MAX_BRUSH_SIZE,
  FABRIC_DRAWING_MAX_DOCUMENT_BYTES,
  FABRIC_DRAWING_MAX_KEYFRAMES,
  FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME,
  FABRIC_DRAWING_MAX_OBJECTS_TOTAL,
  FABRIC_DRAWING_MAX_POINTS_PER_STROKE,
  FABRIC_DRAWING_MAX_POINT_COORDINATE,
  FABRIC_DRAWING_MAX_POINT_TIME,
  FABRIC_DRAWING_MAX_SOURCE_DIMENSION,
  FABRIC_DRAWING_MAX_STRING_LENGTH,
  FABRIC_DRAWING_MAX_TOTAL_FRAMES,
  FABRIC_DRAWING_MAX_TRANSFORM_MAGNITUDE,
  FABRIC_DRAWING_MAX_TRANSITION_BYTES,
  FABRIC_DRAWING_STORE_LIMITS
};
