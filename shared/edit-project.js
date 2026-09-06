(function exposeEditProject(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.window || root).BAEEditProject = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createEditProjectApi() {
  'use strict';

  // A short editing reel has deliberately tighter budgets than the review store.
  // These bounds apply before copying or serializing caller-owned data.
  const LIMITS = Object.freeze({
    maxSources: 256,
    maxClips: 1000,
    maxDurationSeconds: 86400,
    maxFrames: 10368000,
    maxProjectBytes: 64 * 1024 * 1024,
    maxJsonNodes: 2000000,
    maxJsonDepth: 32,
    maxHistoryEntries: 100,
    maxHistoryBytes: 128 * 1024 * 1024
  });
  const PROJECT_KEYS = ['type', 'schemaVersion', 'name', 'fps', 'width', 'height', 'sources', 'clips', 'music'];
  const SOURCE_KEYS = ['id', 'path', 'name', 'durationSeconds', 'width', 'height', 'fps', 'hasAudio'];
  const CLIP_KEYS = ['id', 'sourceId', 'kind', 'sourceStartSeconds', 'durationFrames', 'volume', 'fit',
    'drawingOffsetFrames', 'drawingsV3', 'drawingLayersV1'];
  const DRAWING_KEYS = ['storageSchema', 'storageVersion', 'engine', 'documentId', 'revision',
    'fps', 'totalFrames', 'keyframes'];
  const KEYFRAME_KEYS = ['id', 'frame', 'sourceWidth', 'sourceHeight', 'mutationSequence', 'objects'];
  const STROKE_KEYS = ['id', 'type', 'pathData', 'sourcePoints', 'style', 'transform'];
  const TRANSFORM_KEYS = ['left', 'top', 'scaleX', 'scaleY', 'angle', 'skewX', 'skewY', 'flipX', 'flipY'];

  function fail(message) {
    throw new TypeError(`편집 프로젝트: ${message}`);
  }

  function check(condition, message) {
    if (!condition) fail(message);
  }

  function finite(value, minimum, maximum) {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
  }

  function integer(value, minimum = 0, maximum = LIMITS.maxFrames) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  }

  function string(value, maximum = 512) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !value.includes('\0');
  }

  function record(value, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} 객체가 필요합니다.`);
    const prototype = Object.getPrototypeOf(value);
    // Cross-realm ordinary records are valid (Electron/contextBridge, browser VM).
    const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor');
    check(prototype === null || (Object.getPrototypeOf(prototype) === null &&
      constructor && Object.hasOwn(constructor, 'value') && typeof constructor.value === 'function' &&
      Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object) &&
      !Object.hasOwn(prototype, 'toJSON')), `${label}는 일반 객체여야 합니다.`);
  }

  function exactKeys(value, required, optional = [], label = '항목') {
    record(value, label);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    check(keys.every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key))),
      `${label}에 알 수 없는 필드가 있습니다.`);
    check(required.every(key => Object.hasOwn(descriptors, key)), `${label}의 필수 필드가 없습니다.`);
    check(keys.every(key => Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable),
      `${label}에 실행 가능한 속성을 사용할 수 없습니다.`);
  }

  function array(value, maximum, label) {
    check(Array.isArray(value) && value.length <= maximum, `${label} 배열의 크기가 잘못되었습니다.`);
    const keys = Object.keys(value);
    check(keys.length === value.length && keys.every((key, index) => key === String(index)),
      `${label} 배열에 빈 칸이나 추가 필드가 있습니다.`);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(Object.hasOwn(descriptor, 'value'), `${label}에 실행 가능한 속성을 사용할 수 없습니다.`);
    }
  }

  function validateSource(source) {
    exactKeys(source, SOURCE_KEYS, ['previewPath'], '원본');
    check(string(source.id) && string(source.path, 32768) && string(source.name, 1024), '원본 이름과 경로가 잘못되었습니다.');
    if (source.previewPath !== undefined) check(string(source.previewPath, 32768), '미리보기 경로가 잘못되었습니다.');
    check(finite(source.durationSeconds, Number.MIN_VALUE, LIMITS.maxDurationSeconds), '원본 길이가 잘못되었습니다.');
    check(typeof source.hasAudio === 'boolean', '원본 음성 정보가 잘못되었습니다.');
    const audioOnly = source.width === 0 && source.height === 0 && source.fps === 0 && source.hasAudio;
    check(audioOnly || (integer(source.width, 1, 1000000) && integer(source.height, 1, 1000000) &&
      finite(source.fps, Number.MIN_VALUE, 1000)), '원본 영상 규격이 잘못되었습니다.');
  }

  function validateTimeline(project) {
    exactKeys(project, PROJECT_KEYS, [], '프로젝트');
    check(project.type === 'baeframe-edit' && project.schemaVersion === 1, '지원하지 않는 파일 형식입니다.');
    check(string(project.name, 1024), '프로젝트 이름이 잘못되었습니다.');
    check(finite(project.fps, 1, 120), '출력 FPS는 1~120이어야 합니다.');
    check(integer(project.width, 2, 8192) && integer(project.height, 2, 8192) &&
      project.width % 2 === 0 && project.height % 2 === 0, '출력 크기는 8192 이하의 양의 짝수여야 합니다.');
    array(project.sources, LIMITS.maxSources, '원본');
    array(project.clips, LIMITS.maxClips, '컷');
    const sources = new Map();
    for (const source of project.sources) {
      validateSource(source);
      check(!sources.has(source.id), '원본 ID가 중복되었습니다.');
      sources.set(source.id, source);
    }
    const clipIds = new Set();
    let total = 0;
    for (const clip of project.clips) {
      exactKeys(clip, CLIP_KEYS, [], '컷');
      check(string(clip.id) && !clipIds.has(clip.id), '컷 ID가 없거나 중복되었습니다.');
      clipIds.add(clip.id);
      const source = sources.get(clip.sourceId);
      check(source && source.width > 0 && source.height > 0, '컷에 해당하는 영상 원본이 없습니다.');
      check(clip.kind === 'video' || clip.kind === 'freeze', '컷 종류가 잘못되었습니다.');
      check(integer(clip.durationFrames, 1) && integer(clip.drawingOffsetFrames) &&
        integer(clip.drawingOffsetFrames + clip.durationFrames), '컷 프레임 범위가 잘못되었습니다.');
      check(finite(clip.sourceStartSeconds, 0, source.durationSeconds) &&
        clip.sourceStartSeconds < source.durationSeconds, '컷 시작 위치가 원본 범위를 벗어났습니다.');
      // A small absolute tolerance absorbs only floating point arithmetic noise.
      // Complete frame coverage is required; one extra output frame is not allowed.
      if (clip.kind === 'video') {
        check(clip.sourceStartSeconds + clip.durationFrames / project.fps <= source.durationSeconds + 1e-9,
          '컷 끝 위치가 원본 범위를 벗어났습니다.');
      }
      check(finite(clip.volume, 0, 2), '컷 음량은 0~2이어야 합니다.');
      check(clip.fit === 'contain' || clip.fit === 'cover', '영상 맞춤 방식이 잘못되었습니다.');
      total += clip.durationFrames;
      check(integer(total) && total / project.fps <= LIMITS.maxDurationSeconds, '전체 편집 길이가 너무 깁니다.');
    }
    if (project.music !== null) {
      exactKeys(project.music, ['sourceId', 'volume', 'offsetFrames'], [], '배경음악');
      const source = sources.get(project.music.sourceId);
      check(source && source.hasAudio, '배경음악에 해당하는 음성 원본이 없습니다.');
      check(finite(project.music.volume, 0, 2) && integer(project.music.offsetFrames) &&
        project.music.offsetFrames / project.fps <= LIMITS.maxDurationSeconds, '배경음악 음량 또는 시작 위치가 잘못되었습니다.');
    }
    return { total, sources };
  }

  // Inspect before JSON.stringify/clone so cycles, getters, unusual prototypes,
  // non-finite numbers and unbounded nesting cannot enter saved files or history.
  // Accounting uses an upper bound of serialized UTF-8 bytes, including escapes.
  function inspectJson(root) {
    const ancestors = new Set();
    let bytes = 0;
    let nodes = 0;
    function add(amount) {
      bytes += amount;
      check(bytes <= LIMITS.maxProjectBytes, '프로젝트 데이터가 너무 큽니다.');
    }
    function visit(value, depth) {
      check(++nodes <= LIMITS.maxJsonNodes && depth <= LIMITS.maxJsonDepth, '프로젝트 구조가 너무 큽니다.');
      if (value === null) { add(4); return; }
      if (typeof value === 'string') { add(2 + value.length * 6); return; }
      if (typeof value === 'boolean') { add(5); return; }
      if (typeof value === 'number') { check(Number.isFinite(value), '유한한 숫자만 저장할 수 있습니다.'); add(25); return; }
      check(typeof value === 'object', 'JSON 데이터만 저장할 수 있습니다.');
      check(!ancestors.has(value), '순환 데이터는 저장할 수 없습니다.');
      ancestors.add(value);
      const isArray = Array.isArray(value);
      if (isArray) array(value, LIMITS.maxJsonNodes, '데이터');
      else record(value, '데이터');
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (isArray && key === 'length') continue;
        const descriptor = descriptors[key];
        check(typeof key === 'string' && descriptor.enumerable && Object.hasOwn(descriptor, 'value'),
          '실행 가능한 속성이나 숨겨진 필드는 저장할 수 없습니다.');
        add(4 + key.length * 6);
        visit(descriptor.value, depth + 1);
      }
      add(2);
      ancestors.delete(value);
    }
    visit(root, 0);
    return bytes;
  }

  // This UMD file also runs as a plain browser script without require(). Keep the
  // bounded geometry rules in parity with shared/drawing-render-geometry.js;
  // behavior tests exercise acceptance through the real persistence store.
  const DRAWING_RENDER_GEOMETRY_KEYS = Object.freeze([
    'version',
    'pathData',
    'fillRule'
  ]);
  const DRAWING_RENDER_GEOMETRY_VERSION = 1;
  const DRAWING_RENDER_GEOMETRY_FILL_RULE = 'evenodd';
  const DRAWING_RENDER_GEOMETRY_MAX_PATH_LENGTH = 32_768;
  const DRAWING_RENDER_GEOMETRY_MAX_COORDINATE = 1_001_000_000;
  const DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_OPERATIONS = 250_000;
  const DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_POINTS = 4_096;
  const PATH_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i;

  function hasExactRenderGeometryKeys(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === DRAWING_RENDER_GEOMETRY_KEYS.length &&
      keys.every(key => (
        typeof key === 'string' &&
        DRAWING_RENDER_GEOMETRY_KEYS.includes(key)
      )) &&
      DRAWING_RENDER_GEOMETRY_KEYS.every(key => Object.hasOwn(value, key));
  }

  function validPathCoordinate(token, maximumCoordinate) {
    if (typeof token !== 'string' || !PATH_NUMBER_PATTERN.test(token)) return false;
    const value = Number(token);
    return Number.isFinite(value) && Math.abs(value) <= maximumCoordinate;
  }

  function boundedTopologyLimit(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0
      ? Math.trunc(number)
      : fallback;
  }

  function pointKey(point) {
    return `${point.x}\u0000${point.y}`;
  }

  function edgeKey(start, end) {
    const startKey = pointKey(start);
    const endKey = pointKey(end);
    return startKey < endKey
      ? `${startKey}\u0001${endKey}`
      : `${endKey}\u0001${startKey}`;
  }

  function crossProduct(start, end, point) {
    return (end.x - start.x) * (point.y - start.y) -
      (end.y - start.y) * (point.x - start.x);
  }

  function pointWithinEdgeBounds(point, start, end) {
    return point.x >= Math.min(start.x, end.x) &&
      point.x <= Math.max(start.x, end.x) &&
      point.y >= Math.min(start.y, end.y) &&
      point.y <= Math.max(start.y, end.y);
  }

  function edgesIntersect(left, right) {
    const leftStart = crossProduct(left.start, left.end, right.start);
    const leftEnd = crossProduct(left.start, left.end, right.end);
    const rightStart = crossProduct(right.start, right.end, left.start);
    const rightEnd = crossProduct(right.start, right.end, left.end);
    if (leftStart === 0 && pointWithinEdgeBounds(right.start, left.start, left.end)) return true;
    if (leftEnd === 0 && pointWithinEdgeBounds(right.end, left.start, left.end)) return true;
    if (rightStart === 0 && pointWithinEdgeBounds(left.start, right.start, right.end)) return true;
    if (rightEnd === 0 && pointWithinEdgeBounds(left.end, right.start, right.end)) return true;
    return (leftStart < 0) !== (leftEnd < 0) &&
      (rightStart < 0) !== (rightEnd < 0);
  }

  function validateDrawingRenderContours(contours, options = {}) {
    const maximumPoints = boundedTopologyLimit(
      options.maxTopologyPoints,
      DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_POINTS
    );
    const maximumOperations = boundedTopologyLimit(
      options.maxTopologyOperations,
      DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_OPERATIONS
    );
    const totalPointCount = contours.reduce((count, contour) => count + contour.length, 0);
    if (totalPointCount > maximumPoints) return false;
    let operations = 0;
    const consume = (count = 1) => {
      if (operations + count > maximumOperations) return false;
      operations += count;
      return true;
    };
    const seenEdges = new Set();

    for (const contour of contours) {
      if (!consume(contour.length)) return false;
      const distinctVertices = new Set(contour.map(pointKey));
      if (distinctVertices.size < 3 || distinctVertices.size !== contour.length) return false;

      let doubleArea = 0;
      const origin = contour[0];
      const edges = [];
      for (let index = 0; index < contour.length; index += 1) {
        const start = contour[index];
        const end = contour[(index + 1) % contour.length];
        if (start.x === end.x && start.y === end.y) return false;
        const signature = edgeKey(start, end);
        if (seenEdges.has(signature)) return false;
        seenEdges.add(signature);
        doubleArea += (start.x - origin.x) * (end.y - origin.y) -
          (end.x - origin.x) * (start.y - origin.y);
        edges.push({
          index,
          start,
          end,
          minX: Math.min(start.x, end.x),
          maxX: Math.max(start.x, end.x),
          minY: Math.min(start.y, end.y),
          maxY: Math.max(start.y, end.y)
        });
      }
      if (!Number.isFinite(doubleArea) || doubleArea === 0) return false;

      const sortCost = edges.length * Math.ceil(Math.log2(edges.length + 1));
      if (!consume(sortCost)) return false;
      const orderedEdges = [...edges].sort((left, right) => (
        left.minX - right.minX ||
        left.minY - right.minY ||
        left.index - right.index
      ));
      for (let leftIndex = 0; leftIndex < orderedEdges.length; leftIndex += 1) {
        const left = orderedEdges[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < orderedEdges.length; rightIndex += 1) {
          const right = orderedEdges[rightIndex];
          if (right.minX > left.maxX) break;
          if (!consume()) return false;
          const adjacentDistance = Math.abs(left.index - right.index);
          if (adjacentDistance === 1 || adjacentDistance === contour.length - 1) continue;
          if (right.minY > left.maxY || right.maxY < left.minY) continue;
          if (edgesIntersect(left, right)) return false;
        }
      }
    }
    return true;
  }

  function validateDrawingRenderPathData(pathData, options = {}) {
    const maximumLength = Math.max(
      1,
      Math.trunc(Number(options.maxPathLength) || DRAWING_RENDER_GEOMETRY_MAX_PATH_LENGTH)
    );
    const maximumCoordinate = Math.max(
      1,
      Number(options.maxCoordinate) || DRAWING_RENDER_GEOMETRY_MAX_COORDINATE
    );
    if (typeof pathData !== 'string' ||
        pathData.length === 0 ||
        pathData.length > maximumLength ||
        pathData.trim() !== pathData) {
      return false;
    }

    const tokens = pathData.split(/\s+/);
    let cursor = 0;
    const contours = [];
    while (cursor < tokens.length) {
      if (tokens[cursor] !== 'M' ||
          !validPathCoordinate(tokens[cursor + 1], maximumCoordinate) ||
          !validPathCoordinate(tokens[cursor + 2], maximumCoordinate)) {
        return false;
      }
      const contour = [{
        x: Number(tokens[cursor + 1]),
        y: Number(tokens[cursor + 2])
      }];
      cursor += 3;
      while (tokens[cursor] === 'L') {
        if (!validPathCoordinate(tokens[cursor + 1], maximumCoordinate) ||
            !validPathCoordinate(tokens[cursor + 2], maximumCoordinate)) {
          return false;
        }
        contour.push({
          x: Number(tokens[cursor + 1]),
          y: Number(tokens[cursor + 2])
        });
        cursor += 3;
      }
      if (contour.length < 3 || tokens[cursor] !== 'Z') return false;
      cursor += 1;
      contours.push(contour);
    }
    return contours.length > 0 && validateDrawingRenderContours(contours, options);
  }

  function validateDrawingRenderGeometry(value, options = {}) {
    return hasExactRenderGeometryKeys(value) &&
      value.version === DRAWING_RENDER_GEOMETRY_VERSION &&
      value.fillRule === DRAWING_RENDER_GEOMETRY_FILL_RULE &&
      validateDrawingRenderPathData(value.pathData, options);
  }

  function validateStroke(stroke) {
    exactKeys(stroke, STROKE_KEYS, ['strokeCaps', 'renderGeometry'], 'V3 획');
    check(string(stroke.id) && stroke.type === 'stroke' && string(stroke.pathData, LIMITS.maxProjectBytes),
      'V3 획 식별자 또는 경로가 잘못되었습니다.');
    exactKeys(stroke.style, ['color', 'size', 'opacity'], [], 'V3 획 스타일');
    check(/^#[0-9a-f]{6}$/i.test(stroke.style.color) && finite(stroke.style.size, Number.MIN_VALUE, 1000000) &&
      finite(stroke.style.opacity, 0, 1), 'V3 획 스타일이 잘못되었습니다.');
    exactKeys(stroke.transform, TRANSFORM_KEYS, [], 'V3 획 변형');
    for (const key of TRANSFORM_KEYS) {
      const value = stroke.transform[key];
      check(key === 'flipX' || key === 'flipY' ? typeof value === 'boolean' : finite(value, -1e9, 1e9),
        'V3 획 변형 값이 잘못되었습니다.');
    }
    check(stroke.transform.scaleX !== 0 && stroke.transform.scaleY !== 0, 'V3 획 크기가 잘못되었습니다.');
    array(stroke.sourcePoints, 20000, 'V3 획 포인트');
    check(stroke.sourcePoints.length > 0, 'V3 획 포인트가 없습니다.');
    let previousTime = 0;
    for (const point of stroke.sourcePoints) {
      exactKeys(point, ['x', 'y', 'pressure', 'time'], ['pointerType'], 'V3 포인트');
      check(finite(point.x, -1e9, 1e9) && finite(point.y, -1e9, 1e9) && finite(point.pressure, 0, 1) &&
        finite(point.time, previousTime, 1e12), 'V3 포인트 값이 잘못되었습니다.');
      if (point.pointerType !== undefined) check(['mouse', 'pen', 'touch'].includes(point.pointerType), 'V3 포인터 종류가 잘못되었습니다.');
      previousTime = point.time;
    }
    if (stroke.strokeCaps !== undefined) {
      exactKeys(stroke.strokeCaps, ['start', 'end'], [], 'V3 획 끝');
      check(typeof stroke.strokeCaps.start === 'boolean' && typeof stroke.strokeCaps.end === 'boolean', 'V3 획 끝 정보가 잘못되었습니다.');
    }
    if (stroke.renderGeometry !== undefined) {
      exactKeys(stroke.renderGeometry, ['version', 'pathData', 'fillRule'], [], 'V3 렌더 도형');
      check(validateDrawingRenderGeometry(stroke.renderGeometry), 'V3 렌더 도형이 잘못되었습니다.');
    }
  }

  function validateDrawings(drawings, project) {
    if (drawings === null) return;
    exactKeys(drawings, DRAWING_KEYS, [], 'V3 문서');
    check(drawings.storageSchema === 'baeframe-fabric-scenes' && drawings.storageVersion === '1.0.0' &&
      drawings.engine === 'fabric-7' && string(drawings.documentId) &&
      integer(drawings.revision, 0, Number.MAX_SAFE_INTEGER) && drawings.fps === project.fps &&
      integer(drawings.totalFrames, 1), 'V3 문서 형식 또는 프레임 정보가 잘못되었습니다.');
    array(drawings.keyframes, 10000, 'V3 키프레임');
    const ids = new Set();
    let previousFrame = -1;
    let objectCount = 0;
    for (const keyframe of drawings.keyframes) {
      exactKeys(keyframe, KEYFRAME_KEYS, [], 'V3 키프레임');
      check(string(keyframe.id) && !ids.has(keyframe.id) && integer(keyframe.frame, 0, drawings.totalFrames - 1) &&
        keyframe.frame > previousFrame && finite(keyframe.sourceWidth, Number.MIN_VALUE, 1000000) &&
        finite(keyframe.sourceHeight, Number.MIN_VALUE, 1000000) &&
        integer(keyframe.mutationSequence, 0, Number.MAX_SAFE_INTEGER), 'V3 키프레임 정보가 잘못되었습니다.');
      ids.add(keyframe.id);
      previousFrame = keyframe.frame;
      array(keyframe.objects, 10000, 'V3 오브젝트');
      objectCount += keyframe.objects.length;
      check(objectCount <= 100000, 'V3 오브젝트가 너무 많습니다.');
      const objectIds = new Set();
      for (const object of keyframe.objects) {
        validateStroke(object);
        check(!objectIds.has(object.id), 'V3 키프레임 안에 중복 오브젝트가 있습니다.');
        objectIds.add(object.id);
      }
    }
  }

  function validateLayers(layers) {
    if (layers === null) return;
    exactKeys(layers, ['version', 'layers', 'activeLayerId', 'baseLayerId', 'assignments'], [], '드로잉 레이어');
    check(layers.version === 1, '지원하지 않는 드로잉 레이어 형식입니다.');
    array(layers.layers, 64, '드로잉 레이어');
    check(layers.layers.length > 0, '드로잉 레이어가 없습니다.');
    const ids = new Set();
    for (const layer of layers.layers) {
      exactKeys(layer, ['id', 'name', 'visible', 'locked', 'color'], ['origin'], '레이어');
      check(string(layer.id, 128) && !ids.has(layer.id) && string(layer.name, 120) &&
        typeof layer.visible === 'boolean' && typeof layer.locked === 'boolean' &&
        /^#[0-9a-fA-F]{6}$/.test(layer.color), '레이어 정보가 잘못되었습니다.');
      if (layer.origin !== undefined) check(string(layer.origin, 128), '레이어 출처가 잘못되었습니다.');
      ids.add(layer.id);
    }
    check(ids.has(layers.activeLayerId) && ids.has(layers.baseLayerId), '활성 또는 기준 레이어가 없습니다.');
    record(layers.assignments, '레이어 배정');
    check(Object.keys(layers.assignments).length <= 100000, '레이어 배정이 너무 많습니다.');
    for (const [id, layerId] of Object.entries(layers.assignments)) {
      check(string(id) && ids.has(layerId), '레이어 배정 대상이 잘못되었습니다.');
    }
  }

  function validateProject(project) {
    inspectJson(project);
    validateTimeline(project);
    for (const clip of project.clips) {
      validateDrawings(clip.drawingsV3, project);
      validateLayers(clip.drawingLayersV1);
    }
    return true;
  }

  function clone(value) {
    // Callers validate first. Parsing also preserves own "__proto__" assignment keys.
    return JSON.parse(JSON.stringify(value));
  }

  function createProject(options = {}) {
    exactKeys(options, [], PROJECT_KEYS, '프로젝트 옵션');
    inspectJson(options);
    const project = {
      type: 'baeframe-edit', schemaVersion: 1, name: '새 편집', fps: 24,
      width: 1920, height: 1080, sources: [], clips: [], music: null,
      ...clone(options)
    };
    validateProject(project);
    return project;
  }

  function durationFrames(project) {
    return validateTimeline(project).total;
  }

  function resolveFrame(project, frame) {
    check(integer(frame, 0, Number.MAX_SAFE_INTEGER), '출력 프레임은 음수가 아닌 정수여야 합니다.');
    // Frame reads deliberately inspect the timeline only, avoiding repeated traversal
    // of potentially large drawing payloads on every playback tick.
    const { total, sources } = validateTimeline(project);
    if (frame >= total) return null;
    let startFrame = 0;
    for (let clipIndex = 0; clipIndex < project.clips.length; clipIndex++) {
      const clip = project.clips[clipIndex];
      if (frame < startFrame + clip.durationFrames) {
        const localFrame = frame - startFrame;
        return {
          clip, clipIndex, source: sources.get(clip.sourceId), localFrame,
          drawingFrame: clip.drawingOffsetFrames + localFrame,
          sourceTime: clip.sourceStartSeconds + (clip.kind === 'freeze' ? 0 : localFrame / project.fps),
          outputFrame: frame
        };
      }
      startFrame += clip.durationFrames;
    }
    return null;
  }

  function uniqueId(prefix, used) {
    let index = 1;
    while (used.has(`${prefix}-${index}`)) index++;
    const id = `${prefix}-${index}`;
    used.add(id);
    return id;
  }

  function edit(project, callback) {
    validateProject(project);
    const next = clone(project);
    callback(next);
    validateProject(next);
    return next;
  }

  function clipIndex(project, id) {
    check(string(id), '컷 ID가 잘못되었습니다.');
    const index = project.clips.findIndex(clip => clip.id === id);
    check(index !== -1, '선택한 컷을 찾을 수 없습니다.');
    return index;
  }

  function appendSource(project, source) {
    inspectJson(source);
    validateSource(source);
    check(source.width > 0 && source.height > 0, '영상 원본만 컷으로 추가할 수 있습니다.');
    return edit(project, next => {
      const existing = next.sources.find(item => item.id === source.id);
      if (existing) {
        check([...SOURCE_KEYS, 'previewPath'].every(key => existing[key] === source[key]), '같은 원본 ID의 정보가 다릅니다.');
      }
      else next.sources.push(clone(source));
      // Sub-frame remnants are omitted, never stretched past the source end.
      const frames = Math.floor(source.durationSeconds * next.fps + 1e-9);
      check(integer(frames, 1), '출력 프레임보다 짧거나 너무 긴 영상입니다.');
      next.clips.push({
        id: uniqueId('clip', new Set(next.clips.map(clip => clip.id))),
        sourceId: source.id, kind: 'video', sourceStartSeconds: 0,
        durationFrames: frames, volume: 1, fit: 'contain', drawingOffsetFrames: 0,
        drawingsV3: null, drawingLayersV1: null
      });
    });
  }

  function sliceClip(clip, start, end, fps, id) {
    const result = clone(clip);
    result.id = id;
    result.durationFrames = end - start;
    result.sourceStartSeconds += clip.kind === 'freeze' ? 0 : start / fps;
    result.drawingOffsetFrames += start;
    return result;
  }

  function splitClip(project, id, localFrame) {
    return edit(project, next => {
      const index = clipIndex(next, id);
      const clip = next.clips[index];
      check(integer(localFrame, 1, clip.durationFrames - 1), '컷 안쪽 프레임에서만 분할할 수 있습니다.');
      const rightId = uniqueId('clip', new Set(next.clips.map(item => item.id)));
      next.clips.splice(index, 1,
        sliceClip(clip, 0, localFrame, next.fps, clip.id),
        sliceClip(clip, localFrame, clip.durationFrames, next.fps, rightId));
    });
  }

  function trimClip(project, id, trimStartFrames, trimEndFrames) {
    return edit(project, next => {
      const index = clipIndex(next, id);
      const clip = next.clips[index];
      check(integer(trimStartFrames) && integer(trimEndFrames) &&
        trimStartFrames + trimEndFrames < clip.durationFrames, '트림 후 최소 한 프레임이 남아야 합니다.');
      next.clips[index] = sliceClip(clip, trimStartFrames,
        clip.durationFrames - trimEndFrames, next.fps, clip.id);
    });
  }

  function moveClip(project, id, targetIndex) {
    return edit(project, next => {
      const index = clipIndex(next, id);
      check(integer(targetIndex, 0, next.clips.length - 1), '컷 이동 위치가 잘못되었습니다.');
      const [clip] = next.clips.splice(index, 1);
      next.clips.splice(targetIndex, 0, clip);
    });
  }

  function removeClip(project, id) {
    return edit(project, next => { next.clips.splice(clipIndex(next, id), 1); });
  }

  function freezeDrawings(clip, localFrame, holdFrames, fps, usedDocumentIds) {
    if (clip.drawingsV3 === null) return null;
    const drawings = clone(clip.drawingsV3);
    const drawingFrame = clip.drawingOffsetFrames + localFrame;
    let exposure = null;
    for (const keyframe of drawings.keyframes) {
      if (keyframe.frame > drawingFrame) break;
      exposure = keyframe;
    }
    drawings.documentId = uniqueId('hold-drawing', usedDocumentIds);
    drawings.revision = 0;
    drawings.fps = fps;
    drawings.totalFrames = holdFrames;
    // Preserve explicit blank exposures as well as held non-empty exposures.
    drawings.keyframes = exposure ? [{ ...exposure, frame: 0 }] : [];
    return drawings;
  }

  function insertHold(project, id, localFrame, holdFrames, replace = false) {
    return edit(project, next => {
      const index = clipIndex(next, id);
      const clip = next.clips[index];
      check(integer(localFrame, 0, clip.durationFrames - 1) && integer(holdFrames, 1) &&
        typeof replace === 'boolean', '정지 구간 위치 또는 길이가 잘못되었습니다.');
      check(!replace || localFrame + holdFrames <= clip.durationFrames, '대체 범위가 선택한 컷을 벗어났습니다.');
      const usedIds = new Set(next.clips.map(item => item.id));
      const usedDocumentIds = new Set(next.clips.map(item => item.drawingsV3?.documentId).filter(Boolean));
      const parts = [];
      if (localFrame > 0) parts.push(sliceClip(clip, 0, localFrame, next.fps, clip.id));
      const freeze = clone(clip);
      freeze.id = localFrame === 0 && replace ? clip.id : uniqueId('clip', usedIds);
      freeze.kind = 'freeze';
      freeze.durationFrames = holdFrames;
      freeze.sourceStartSeconds += clip.kind === 'freeze' ? 0 : localFrame / next.fps;
      freeze.volume = 0;
      freeze.drawingOffsetFrames = 0;
      freeze.drawingsV3 = freezeDrawings(clip, localFrame, holdFrames, next.fps, usedDocumentIds);
      parts.push(freeze);
      const resumeFrame = localFrame + (replace ? holdFrames : 0);
      if (resumeFrame < clip.durationFrames) {
        const rightId = localFrame === 0 && !replace ? clip.id : uniqueId('clip', usedIds);
        parts.push(sliceClip(clip, resumeFrame, clip.durationFrames, next.fps, rightId));
      }
      next.clips.splice(index, 1, ...parts);
    });
  }

  function createHistory(project) {
    validateProject(project);
    const snapshots = [{ json: JSON.stringify(project), bytes: inspectJson(project) }];
    let cursor = 0;
    function read() { return JSON.parse(snapshots[cursor].json); }
    return Object.freeze({
      get present() { return read(); },
      get canUndo() { return cursor > 0; },
      get canRedo() { return cursor < snapshots.length - 1; },
      commit(next) {
        validateProject(next);
        const json = JSON.stringify(next);
        if (json === snapshots[cursor].json) return read();
        const snapshot = { json, bytes: inspectJson(next) };
        snapshots.splice(cursor + 1);
        snapshots.push(snapshot);
        cursor = snapshots.length - 1;
        let bytes = snapshots.reduce((sum, item) => sum + item.bytes, 0);
        while (snapshots.length > LIMITS.maxHistoryEntries + 1 ||
          (snapshots.length > 1 && bytes > LIMITS.maxHistoryBytes)) {
          bytes -= snapshots.shift().bytes;
          cursor--;
        }
        return read();
      },
      undo() { if (cursor > 0) cursor--; return read(); },
      redo() { if (cursor < snapshots.length - 1) cursor++; return read(); }
    });
  }

  return Object.freeze({
    LIMITS, createProject, validateProject, durationFrames, resolveFrame, appendSource,
    splitClip, trimClip, moveClip, removeClip, insertHold, createHistory
  });
});
