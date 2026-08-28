'use strict';

/**
 * Fabric 드로잉 도구 집합 단일 소스.
 *
 * 두 계층이 같은 목록을 써야 한 계층이 통과시킨 도구를 다른 계층이 거부하는
 * 비대칭 검증이 생기지 않는다.
 *
 * - main/mpv-overlay-host.js: require (Node CommonJS)
 * - renderer/scripts/modules/mpv-fabric-overlay-runtime.js: require
 *   (esbuild 번들 시 인라인됨 — shared/fabric-drawing-limits.js와 동일 경로)
 * - renderer/scripts/modules/fabric-drawing-pilot-controller.js: 브라우저 네이티브
 *   ES 모듈이라 CommonJS를 import 할 수 없으므로 리터럴을 유지하고,
 *   scripts/tests/fabric-drawing-pilot-source.test.js의 파리티 테스트가
 *   이 파일과 값이 같음을 강제한다.
 *
 * 주의: 이 목록은 **런타임 입력 도구**이며 drawingsV3 저장 스키마와 무관하다.
 * 저장 레코드의 type 은 여전히 'stroke' 하나뿐이고, 도형은 미리 계산된 경로를
 * 따라 그은 획으로 굳혀 저장한다.
 */

// 자유 드래그로 새 획을 만드는 도구
const FABRIC_FREEHAND_TOOLS = Object.freeze(['brush', 'pen']);
// 시작점→끝점 드래그로 기하 도형을 만드는 도구
const FABRIC_SHAPE_TOOLS = Object.freeze(['line', 'rect', 'circle', 'arrow']);
// 기존 획을 지우는 도구
const FABRIC_ERASER_TOOL = 'eraser';
// 획을 선택·이동하는 도구
const FABRIC_SELECT_TOOL = 'select';

const FABRIC_DRAWING_TOOLS = Object.freeze([
  ...FABRIC_FREEHAND_TOOLS,
  FABRIC_ERASER_TOOL,
  ...FABRIC_SHAPE_TOOLS,
  FABRIC_SELECT_TOOL
]);

const FABRIC_DEFAULT_DRAWING_TOOL = 'brush';

function isFabricDrawingTool(value) {
  return typeof value === 'string' && FABRIC_DRAWING_TOOLS.includes(value);
}

// 알 수 없는 값은 기본 도구로 접는다. 기존 코드의
// `tool === 'select' ? 'select' : 'brush'` 관용구를 대체한다.
function normalizeFabricDrawingTool(value) {
  return isFabricDrawingTool(value) ? value : FABRIC_DEFAULT_DRAWING_TOOL;
}

module.exports = {
  FABRIC_DEFAULT_DRAWING_TOOL,
  FABRIC_DRAWING_TOOLS,
  FABRIC_ERASER_TOOL,
  FABRIC_FREEHAND_TOOLS,
  FABRIC_SELECT_TOOL,
  FABRIC_SHAPE_TOOLS,
  isFabricDrawingTool,
  normalizeFabricDrawingTool
};
