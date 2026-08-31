/**
 * MPV overlay host window.
 *
 * mpv renders in a native child window, so Chromium DOM overlays inside the
 * main renderer cannot reliably appear above it. This host mirrors the visual
 * overlay state in a second transparent, click-through child window.
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const { normalizeEmbedBounds } = require('./mpv-embed-host');
const {
  validateDrawingRenderGeometry
} = require('../shared/drawing-render-geometry');
const {
  FABRIC_DRAWING_MAX_TRANSITION_BYTES: FABRIC_DRAWING_TRANSITION_MAX_BYTES,
  FABRIC_DRAWING_MAX_DOCUMENT_BYTES: FABRIC_DRAWING_SNAPSHOT_MAX_BYTES,
  FABRIC_DRAWING_MAX_KEYFRAMES,
  FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME,
  FABRIC_DRAWING_MAX_OBJECTS_TOTAL,
  FABRIC_DRAWING_MAX_POINTS_PER_STROKE,
  FABRIC_DRAWING_MAX_SOURCE_DIMENSION,
  FABRIC_DRAWING_MAX_TOTAL_FRAMES,
  FABRIC_DRAWING_MAX_POINT_COORDINATE,
  FABRIC_DRAWING_MAX_POINT_TIME,
  FABRIC_DRAWING_MAX_BRUSH_SIZE,
  FABRIC_DRAWING_MAX_TRANSFORM_MAGNITUDE,
  FABRIC_DRAWING_MAX_STRING_LENGTH
} = require('../shared/fabric-drawing-limits');
const {
  isFabricDrawingTool,
  normalizeFabricDrawingTool
} = require('../shared/fabric-drawing-tools.js');

// [ / ] 한 번에 허용하는 최대 증감. 실제 상한·하한은 오버레이 런타임이 자른다.
const FABRIC_DRAWING_MAX_BRUSH_STEP = 64;

const log = createLogger('MPVOverlayHost');
const DEFAULT_FABRIC_BUNDLE_PATH = path.join(
  __dirname,
  '..',
  'renderer',
  'scripts',
  'lib',
  'mpv-fabric-overlay.iife.js'
);
const FABRIC_PREPARE_SCRIPT = "window.__mpvFabricOverlay.prepare(document.getElementById('root'));";
const PARENT_REPOSITION_EVENTS = [
  'move',
  'moved',
  'resize',
  'resized',
  'restore',
  'maximize',
  'unmaximize',
  'enter-full-screen',
  'leave-full-screen'
];
const PARENT_HIDE_EVENTS = ['minimize', 'hide'];
const PARENT_SHOW_EVENTS = ['restore', 'show'];
const HOST_DRAWING_ACTIONS = new Set([
  'delete-selection',
  'clear-session',
  'undo',
  'redo',
  // 프레임·키프레임 구조 조작(레거시 2 / 3 / Shift+2 / Shift+3 / 4 / Ctrl+Alt+C·V).
  // 저장 스키마는 그대로 두고 키프레임 집합만 바꾼다.
  'frame-insert-blank-keyframe',
  'frame-insert',
  'frame-remove',
  'keyframe-to-frame',
  'frame-to-keyframe',
  'frame-copy',
  'frame-paste',
  // 레이어 단위 오브젝트 조작(레거시 Shift+` / Ctrl+Shift+X·C). 이것만 **페이로드**를
  // 나른다 — 지울 id 목록이나 오브젝트별 랭크다. 아래에서 형식을 따로 검사한다.
  'layer-objects-remove',
  'layer-objects-reorder',
  // 씬은 그대로 두고 짝 id 만 만드는 표식(페이로드 없음).
  'layer-model-marker'
]);
// 랭크는 레이어 순서 인덱스다. 레이어 상한이 훨씬 낮으므로 넉넉히 잡아도 충분하다.
const MAX_LAYER_OBJECT_RANK = 4096;
const MAX_MPV_REMOTE_CURSOR_HTML_BYTES = 256 * 1024;
const MAX_MPV_COLLABORATION_STATE_BYTES = 1024 * 1024;
const MAX_MPV_COLLABORATION_SNAPSHOT_BYTES = 768 * 1024;
const MAX_MPV_COLLABORATION_USERS = 64;
const MAX_MPV_COLLABORATION_NAME_LENGTH = 64;
const MAX_MPV_COLLABORATION_BOUND = 32768;
const MPV_COLLABORATION_FALLBACK_COLOR = '#ffd000';
const MPV_OVERLAY_COLLABORATION_ACTION_CHANNEL = 'mpv-overlay:collaboration-action';
const MPV_OVERLAY_COLLABORATION_DRAG_RESET_CHANNEL = 'mpv-overlay:collaboration-drag-reset';
const MPV_OVERLAY_DRAWING_POINTERDOWN_FRAME_CHANNEL =
  'mpv-overlay:drawing-pointerdown-frame-request';
const MPV_OVERLAY_COLLABORATION_NON_DRAG_ACTIONS = new Set([
  'collab.indicator-enter',
  'collab.indicator-leave',
  'collab.panel-enter',
  'collab.panel-leave',
  'collab.sync-status',
  'collab.cursor-toggle',
  'collab.open-sync',
  'sync.toggle',
  'sync.lead',
  'sync.follow',
  'sync.collapse',
  'sync.close'
]);
const MPV_OVERLAY_COLLABORATION_DRAG_ACTIONS = new Set([
  'sync.drag-start',
  'sync.drag-move',
  'sync.drag-end'
]);
const FABRIC_DRAWING_TRANSITION_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'persistenceSessionId',
  'stableVideoIdentity',
  'scene',
  'mutationSequence',
  'origin',
  'kind',
  'estimatedBytes',
  'unsupportedReason',
  'removals',
  'insertions',
  'transforms'
]);
const FABRIC_DRAWING_SCENE_KEYS = Object.freeze([
  'sceneInstanceId',
  'targetFrame',
  'sourceWidth',
  'sourceHeight'
]);
const FABRIC_DRAWING_HYDRATE_REQUEST_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'persistenceSessionId',
  'stableVideoIdentity',
  'fps',
  'totalFrames',
  'keyframes'
]);
const FABRIC_DRAWING_EXPORT_REQUEST_KEYS = Object.freeze(
  FABRIC_DRAWING_HYDRATE_REQUEST_KEYS.filter(key => key !== 'keyframes')
);
const FABRIC_DRAWING_PRESENTATION_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'presentationRevision',
  'stableVideoIdentity',
  'storeRevision',
  'targetFrame',
  'sourceFrame',
  'sourceWidth',
  'sourceHeight',
  'canvasRect',
  'viewportRevision',
  'viewportTransform'
]);
const FABRIC_DRAWING_CANVAS_RECT_KEYS = Object.freeze(['left', 'top', 'width', 'height']);
const FABRIC_DRAWING_VIEWPORT_TRANSFORM_KEYS = Object.freeze(['scale', 'panX', 'panY']);
const FABRIC_DRAWING_ACTIVE_FRAME_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'inputRevision',
  'sessionId',
  'frameRevision',
  'targetFrame'
]);
const FABRIC_DRAWING_POINTERDOWN_FRAME_REQUEST_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'inputRevision',
  'sessionId',
  'pointerdownId',
  'pointerdownAt'
]);
const FABRIC_DRAWING_POINTERDOWN_FRAME_CONFIRM_KEYS = Object.freeze([
  ...FABRIC_DRAWING_POINTERDOWN_FRAME_REQUEST_KEYS,
  'targetFrame'
]);
const FABRIC_DRAWING_POINTERDOWN_FRAME_CANCEL_KEYS = Object.freeze([
  ...FABRIC_DRAWING_POINTERDOWN_FRAME_REQUEST_KEYS,
  'cancelled'
]);
const FABRIC_DRAWING_POINTERDOWN_FRAME_CANCEL_RESULT_KEYS = Object.freeze([
  'accepted',
  ...FABRIC_DRAWING_POINTERDOWN_FRAME_CANCEL_KEYS
]);
const FABRIC_DRAWING_HYDRATE_KEYFRAME_KEYS = Object.freeze([
  'id',
  'frame',
  'sourceWidth',
  'sourceHeight',
  'mutationSequence',
  'objects'
]);
const FABRIC_DRAWING_SNAPSHOT_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'persistenceSessionId',
  'stableVideoIdentity',
  'fps',
  'totalFrames',
  'scenes'
]);
const FABRIC_DRAWING_SNAPSHOT_SCENE_KEYS = Object.freeze([
  'sceneInstanceId',
  'targetFrame',
  'sourceWidth',
  'sourceHeight',
  'mutationSequence',
  'objects'
]);
const FABRIC_DRAWING_RECORD_REQUIRED_KEYS = Object.freeze([
  'id',
  'type',
  'pathData',
  'sourcePoints',
  'style',
  'transform'
]);
const FABRIC_DRAWING_RECORD_OPTIONAL_KEYS = Object.freeze([
  'strokeCaps',
  'renderGeometry'
]);
const FABRIC_DRAWING_STYLE_KEYS = Object.freeze(['color', 'size', 'opacity']);
const FABRIC_DRAWING_TRANSFORM_KEYS = Object.freeze([
  'left',
  'top',
  'scaleX',
  'scaleY',
  'angle',
  'skewX',
  'skewY',
  'flipX',
  'flipY'
]);
const FABRIC_DRAWING_POINT_REQUIRED_KEYS = Object.freeze([
  'x',
  'y',
  'pressure',
  'time'
]);
const FABRIC_DRAWING_POINT_OPTIONAL_KEYS = Object.freeze(['pointerType']);
const FABRIC_DRAWING_CAPS_KEYS = Object.freeze(['start', 'end']);
const FABRIC_DRAWING_RENDER_GEOMETRY_KEYS = Object.freeze([
  'version',
  'pathData',
  'fillRule'
]);
const FABRIC_DRAWING_REMOVAL_KEYS = Object.freeze(['id', 'index']);
const FABRIC_DRAWING_INSERTION_KEYS = Object.freeze([
  'index',
  'record',
  'baseTransform'
]);
const FABRIC_DRAWING_TRANSFORM_CHANGE_KEYS = Object.freeze([
  'id',
  'beforeTransform',
  'afterTransform'
]);
// 오버레이 팔레트의 되돌리기·다시하기가 **레이어 조작**을 되돌렸을 때 알린다.
// 그 조작은 씬만 되돌릴 수 있고 레이어 목록·배정은 렌더러 쪽에 있어서, 짝 id 를
// 렌더러로 넘겨 줘야 모델까지 함께 돌아간다.
const FABRIC_DRAWING_LAYER_HISTORY_KEYS = Object.freeze([
  'type',
  'hostGeneration',
  'videoGeneration',
  'persistenceSessionId',
  'stableVideoIdentity',
  'commandId',
  'direction'
]);
const FABRIC_DRAWING_RESYNC_KEYS = Object.freeze([
  'type',
  'hostGeneration',
  'videoGeneration',
  'persistenceSessionId',
  'stableVideoIdentity',
  'reason'
]);
const FABRIC_DRAWING_TRANSITION_ORIGINS = new Set(['live', 'history']);
const FABRIC_DRAWING_TRANSITION_KINDS = new Set([
  'add-objects',
  'transform-objects',
  'split-stroke',
  'delete-objects',
  'clear-keyframe'
]);
const FABRIC_DRAWING_RESYNC_REASONS = new Set([
  'transition-too-large',
  'transition-serialization-failed',
  'transition-invalid-at-boundary'
]);
const FABRIC_DRAWING_POINTER_TYPES = new Set(['mouse', 'pen', 'touch']);
const FABRIC_DRAWING_HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FABRIC_DRAWING_PUBLIC_RUNTIME_REASON_MAP = new Map([
  ['destroyed', 'drawing-runtime-unavailable'],
  ['not-prepared', 'drawing-runtime-unavailable'],
  ['input-enabled', 'drawing-input-enabled'],
  ['persistence-unavailable', 'drawing-runtime-unavailable'],
  ['invalid-hydration-request', 'drawing-hydration-rejected'],
  ['store-destroyed', 'drawing-runtime-unavailable'],
  ['video-active', 'drawing-hydration-rejected'],
  ['stale-fence', 'stale-persistence-fence'],
  ['scene-capacity-exceeded', 'drawing-hydration-rejected'],
  ['invalid-export-request', 'drawing-export-rejected'],
  ['timeline-mismatch', 'drawing-export-rejected'],
  ['snapshot-export-failed', 'drawing-export-rejected']
]);
const DRAWING_V3_DIAGNOSTIC_STATUSES = new Set([
  'active',
  'degraded',
  'desynced',
  'destroyed',
  'disabled',
  'idle',
  'not-connected',
  'synced'
]);
const DRAWING_V3_DIAGNOSTIC_REASONS = new Set([
  'adapter-failed',
  'document-rejected',
  'document-sequence-mismatch',
  'invalid-seed',
  'invalid-transition',
  'missing-baseline',
  'observer-failed',
  'queue-capacity-exceeded',
  'queue-event-too-large',
  'scheduler-failed',
  'seed-capacity-exceeded',
  'seed-signature-changed',
  'sequence-gap',
  'stale-transition',
  'transition-before-mismatch',
  'unsupported-field-mutation',
  'unsupported-order-mutation',
  'unsupported-transform',
  'warm-seed-mismatch'
]);

function createDrawingV3BootstrapScript(enabled) {
  return `(() => {
    const slot = '__mpvFabricOverlayBootstrap';
    let bootstrap;
    try {
      bootstrap = Object.freeze(${JSON.stringify({
    drawingV3ShadowEnabled: enabled === true
  })});
      Object.defineProperty(window, slot, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: bootstrap
      });
      const descriptor = Object.getOwnPropertyDescriptor(window, slot);
      if (descriptor?.configurable === true &&
          descriptor.enumerable === false &&
          descriptor.writable === false &&
          descriptor.value === bootstrap) {
        return true;
      }
    } catch (_error) {}
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, slot);
      if (descriptor?.configurable === true && descriptor.value === bootstrap) {
        Reflect.deleteProperty(window, slot);
      }
    } catch (_error) {}
    return false;
  })();`;
}

const OVERLAY_HTML = String.raw`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    :root {
      --accent-primary: #ff5555;
      --accent-secondary: #ff7070;
      --accent-shadow-strong: rgba(255, 85, 85, 0.35);
      --bg-elevated: #151515;
      --bg-primary: #0f0f0f;
      --border-subtle: rgba(255, 255, 255, 0.16);
      --text-primary: #f5f5f5;
      --text-tertiary: rgba(255, 255, 255, 0.55);
      --text-faint: rgba(255, 255, 255, 0.34);
      --track-idle: rgba(255, 255, 255, 0.14);
      --success: #2ed573;
      --error: #ff5555;
      --shadow-lg: 0 10px 30px rgba(0, 0, 0, 0.38);
      --transition-fast: 0.15s ease;
    }
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: transparent;
      pointer-events: none;
      user-select: none;
    }
    #root {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      pointer-events: none;
    }
    /* 오버레이는 별도 BrowserWindow 라 renderer/styles/main.css 를 불러오지 않는다.
       그대로 두면 윈도우 기본 스크롤바(밝은 회색 화살표 막대)가 그려져 어두운
       팔레트 위에 홀로 튄다. 본체와 **같은 값**으로 다시 적어 테마를 맞춘다
       (main.css 의 Scrollbar 절과 대조). */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    ::-webkit-scrollbar-corner {
      background: transparent;
    }
    .mpv-fabric-pilot-toolbar {
      display: block;
      --fabric-palette-gap: 6px;
      width: 220px;
      max-width: calc(100% - 24px);
      box-sizing: border-box;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(15, 15, 15, 0.86);
      box-shadow: var(--shadow-lg);
      color: var(--text-primary);
      font-family: Inter, Pretendard, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      user-select: none;
    }
    .mpv-fabric-pilot-toolbar-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      box-sizing: border-box;
      border-radius: 12px 12px 0 0;
      border-bottom: 1px solid var(--border-subtle);
      background: rgba(255, 255, 255, 0.03);
      cursor: move;
      touch-action: none;
    }
    .mpv-fabric-pilot-toolbar[data-collapsed="true"] .mpv-fabric-pilot-toolbar-header {
      border-radius: 12px;
      border-bottom: none;
    }
    .mpv-fabric-pilot-toolbar-handle {
      display: inline-flex;
      align-items: center;
      color: var(--text-tertiary);
    }
    .mpv-fabric-pilot-toolbar-title {
      flex: 1;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .mpv-fabric-pilot-toolbar-content {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px;
      box-sizing: border-box;
      max-height: 70vh;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .mpv-fabric-pilot-toolbar[data-collapsed="true"] .mpv-fabric-pilot-toolbar-content {
      display: none;
    }
    .mpv-fabric-pilot-section-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
      color: var(--text-tertiary);
      font-size: 11px;
      font-weight: 600;
    }
    .mpv-fabric-pilot-section-row {
      display: flex;
      flex-flow: row wrap;
      gap: var(--fabric-palette-gap);
    }
    .mpv-fabric-pilot-section-row > * {
      flex: 0 0 auto;
    }
    .mpv-fabric-pilot-toolbar button {
      min-width: 40px;
      min-height: 40px;
      padding: 0 12px;
      border: 0;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
      color: var(--text-primary);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
      transition-property: transform, background-color, box-shadow;
      transition-duration: 120ms;
      transition-timing-function: ease-out;
    }
    .mpv-fabric-pilot-toolbar button:hover {
      background: rgba(255, 255, 255, 0.14);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
    }
    .mpv-fabric-pilot-toolbar button[data-active="true"] {
      background: rgba(255, 85, 85, 0.22);
      box-shadow:
        0 0 0 1px rgba(255, 112, 112, 0.72),
        0 0 16px rgba(255, 85, 85, 0.18);
      color: #fff;
    }
    .mpv-fabric-pilot-toolbar button:active {
      transform: scale(0.96);
    }
    .mpv-fabric-pilot-toolbar button:focus-visible {
      outline: 2px solid var(--accent-secondary);
      outline-offset: 2px;
    }
    .mpv-fabric-pilot-toolbar button.mpv-fabric-pilot-collapse-button {
      min-width: 24px;
      min-height: 24px;
      padding: 0;
      background: transparent;
      box-shadow: none;
      color: var(--text-tertiary);
    }
    .mpv-fabric-pilot-toolbar[data-collapsed="true"] .mpv-fabric-pilot-collapse-button svg {
      transform: rotate(-90deg);
    }
    .mpv-fabric-pilot-toolbar [data-fabric-pilot-panel="brush-settings"] button:not([data-fabric-pilot-color]) {
      min-width: 32px;
      min-height: 32px;
      padding: 0;
    }
    /* 색 견본은 한 줄에 넷이 들어가야 8개가 두 줄로 끝난다.
       팔레트 220px → 패널 안쪽 166px, 4*36 + 3*6 = 162 <= 166. */
    .mpv-fabric-pilot-toolbar [data-fabric-pilot-panel="brush-settings"] button[data-fabric-pilot-color] {
      width: 36px;
      height: 36px;
      min-width: 36px;
      min-height: 36px;
      padding: 0;
    }
    /* 목업(§0.3 시안)의 field 구성 — 라벨과 수치를 한 줄에, 그 아래 3px 트랙.
       버튼이 없으므로 트랙이 이 줄에서 가장 큰 요소가 된다. */
    .mpv-fabric-pilot-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .mpv-fabric-pilot-field-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.11em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .mpv-fabric-pilot-field-top b {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0;
      text-transform: none;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
    /* range 입력을 목업의 트랙 모양으로 다시 그린다. 기본 렌더는 OS 위젯이라
       팔레트와 따로 논다(스크롤바와 같은 이유). */
    .mpv-fabric-pilot-toolbar input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      /* 9px 손잡이가 잘리지 않을 만큼만. 더 키우면 필드 사이가 벌어진다. */
      height: 9px;
      margin: 0;
      padding: 0;
      background: transparent;
      cursor: pointer;
    }
    .mpv-fabric-pilot-toolbar input[type="range"]::-webkit-slider-runnable-track {
      height: 3px;
      border-radius: 2px;
      /* 채운 부분과 남은 부분의 경계는 런타임이 --fabric-range-fill 로 넘긴다.
         range 입력은 기본으로 채움을 그리지 않는다. */
      background: linear-gradient(
        to right,
        var(--text-tertiary) 0 var(--fabric-range-fill, 0%),
        var(--track-idle) var(--fabric-range-fill, 0%) 100%
      );
    }
    .mpv-fabric-pilot-toolbar input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--text-primary);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      /* 트랙 3px 한가운데에 9px 손잡이를 앉힌다: (3 - 9) / 2 */
      margin-top: -3px;
    }
    .mpv-fabric-pilot-toolbar input[type="range"]:focus-visible {
      outline: 2px solid var(--accent-secondary);
      outline-offset: 2px;
    }
    .mpv-fabric-pilot-brush-status {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      color: var(--text-tertiary);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .mpv-fabric-pilot-brush-status [data-fabric-pilot-output="brush-status-swatch"] {
      flex: 0 0 auto;
    }
    .mpv-fabric-pilot-brush-status [data-fabric-pilot-output="brush-status-text"] {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .mpv-fabric-pilot-eraser-mode,
    .mpv-fabric-pilot-recent-colors {
      display: flex;
      flex-flow: row wrap;
      gap: var(--fabric-palette-gap);
    }
    .mpv-fabric-pilot-badge {
      display: block;
      width: 100%;
      min-height: 28px;
      line-height: 28px;
      padding: 0 10px;
      box-sizing: border-box;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.28);
      color: var(--text-tertiary);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (max-width: 800px) {
      .mpv-fabric-pilot-toolbar {
        --fabric-palette-gap: 4px;
        width: 190px;
      }
      .mpv-fabric-pilot-toolbar-content {
        gap: 8px;
        padding: 8px;
      }
      .mpv-fabric-pilot-toolbar button {
        padding-inline: 8px;
      }
      .mpv-fabric-pilot-toolbar [data-fabric-pilot-group="selection-controls"] {
        gap: 4px !important;
        padding: 4px !important;
      }
      .mpv-fabric-pilot-toolbar [data-fabric-pilot-output="selection-summary"] {
        display: none;
      }
      /* 팔레트가 190px 로 좁아지면 패널 안쪽은 약 156px 이다.
         36px 그대로면 4*36 + 3*4 = 156 을 넘겨 3/3/2 로 흘러 세 줄이 된다.
         32px 이면 4*32 + 3*4 = 140 이라 넉넉히 넷이 앉는다. */
      .mpv-fabric-pilot-toolbar [data-fabric-pilot-panel="brush-settings"] button[data-fabric-pilot-color] {
        width: 32px;
        height: 32px;
        min-width: 32px;
        min-height: 32px;
      }
    }
    .mirror-canvas {
      position: absolute;
      display: none;
      object-fit: fill;
      pointer-events: none;
      user-select: none;
    }
    #onionCanvasMirror {
      z-index: 2;
    }
    #drawingCanvasMirror {
      z-index: 3;
    }
    #remoteStrokeMirror {
      z-index: 42;
    }
    #collabRippleMirror {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 44;
      display: none;
      pointer-events: none;
    }
    #markerMirror,
    #tooltipMirror,
    #toastMirror,
    #remoteCursorMirror,
    #compositionMirror,
    #htmlOverlay {
      position: absolute;
      inset: 0;
      z-index: 15;
      pointer-events: none;
    }
    #htmlOverlay {
      z-index: 14;
    }
    #compositionMirror {
      z-index: 13;
      overflow: visible;
    }
    #tooltipMirror {
      z-index: 16;
    }
    #toastMirror {
      z-index: 50;
    }
    #remoteCursorMirror {
      z-index: 45;
    }
    #collaborationMirror {
      position: absolute;
      inset: 0;
      z-index: 46;
      pointer-events: none;
      color: var(--text-primary);
      font-family: Inter, Pretendard, "Segoe UI", sans-serif;
      font-size: 12px;
    }
    #collaborationMirror[data-theme="light"] {
      --bg-elevated: rgba(250, 250, 250, 0.96);
      --bg-primary: #ffffff;
      --border-subtle: rgba(0, 0, 0, 0.16);
      --text-primary: #202124;
      --text-tertiary: rgba(32, 33, 36, 0.62);
    }
    .mpv-collaboration-surface {
      position: absolute;
      display: none;
      box-sizing: border-box;
      pointer-events: auto;
      touch-action: none;
    }
    #mpvCollaborationIndicator {
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 20px;
      background: var(--bg-elevated);
      overflow: hidden;
    }
    #mpvCollaborationAvatars {
      display: flex;
      flex-direction: row-reverse;
      min-width: 0;
    }
    .mpv-collaboration-avatar {
      width: 24px;
      height: 24px;
      margin-left: -8px;
      box-sizing: border-box;
      border: 2px solid var(--bg-primary);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 10px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .mpv-collaboration-avatar:first-child { margin-left: 0; }
    .mpv-collaboration-avatar.is-me { border-color: var(--accent-primary); }
    .mpv-collaboration-info {
      display: flex;
      gap: 2px;
      align-items: center;
      white-space: nowrap;
      color: var(--text-tertiary);
    }
    #mpvCollaborationCount { color: var(--text-primary); font-weight: 650; }
    #mpvCollaborationBadge {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-tertiary);
      font-size: 15px;
    }
    #mpvCollaborationBadge[data-badge="syncing"] { color: #ffb347; }
    #mpvCollaborationBadge[data-badge="synced"] { color: var(--success); }
    #mpvCollaborationBadge[data-badge="error"] { color: var(--error); }
    #mpvCollaborationPlexus {
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      background: var(--bg-elevated);
      box-shadow: var(--shadow-lg);
    }
    #mpvCollaborationPlexusImage {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: fill;
    }
    .mpv-collaboration-plexus-footer {
      position: absolute;
      inset: auto 0 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 10px;
      background: linear-gradient(transparent, var(--bg-elevated) 40%);
    }
    .mpv-collaboration-plexus-label {
      color: var(--text-tertiary);
      font-size: 10px;
      letter-spacing: 0.5px;
    }
    .mpv-collaboration-actions { display: flex; gap: 6px; }
    .mpv-collaboration-action {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-tertiary);
      font: inherit;
      font-size: 10px;
    }
    .mpv-collaboration-action.is-muted { opacity: 0.58; }
    #mpvPlaybackSyncPanel {
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      background: var(--bg-elevated);
      box-shadow: var(--shadow-lg);
    }
    .mpv-playback-sync-header {
      height: 39px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .mpv-playback-sync-title { flex: 1; font-weight: 650; }
    .mpv-playback-sync-header button {
      width: 20px;
      height: 20px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text-tertiary);
      font: inherit;
    }
    .mpv-playback-sync-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      box-sizing: border-box;
    }
    #mpvPlaybackSyncPanel.collapsed .mpv-playback-sync-body { display: none; }
    #mpvPlaybackSyncPanel.collapsed .mpv-playback-sync-header { border-bottom: 0; }
    .mpv-playback-sync-toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-tertiary);
    }
    .mpv-playback-sync-track {
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.1);
    }
    .mpv-playback-sync-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--text-tertiary);
    }
    .mpv-playback-sync-toggle.enabled .mpv-playback-sync-track { background: var(--accent-primary); }
    .mpv-playback-sync-toggle.enabled .mpv-playback-sync-knob {
      left: 18px;
      background: var(--bg-primary);
    }
    .mpv-playback-sync-modes {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
    }
    .mpv-playback-sync-radio {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-tertiary);
      font-size: 11px;
    }
    .mpv-playback-sync-radio-ring {
      width: 14px;
      height: 14px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--border-subtle);
      border-radius: 50%;
    }
    .mpv-playback-sync-radio-dot {
      width: 6px;
      height: 6px;
      display: none;
      border-radius: 50%;
      background: var(--accent-primary);
    }
    .mpv-playback-sync-radio.selected .mpv-playback-sync-radio-ring { border-color: var(--accent-primary); }
    .mpv-playback-sync-radio.selected .mpv-playback-sync-radio-dot { display: block; }
    .mpv-playback-sync-status {
      display: flex;
      align-items: center;
      gap: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--border-subtle);
      color: var(--text-tertiary);
      font-size: 11px;
    }
    .mpv-playback-sync-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-tertiary);
    }
    .mpv-playback-sync-status-dot.active { background: var(--success); }
    .mpv-playback-sync-status-dot.leading { background: var(--accent-primary); }
    #markerMirror *,
    #tooltipMirror *,
    #toastMirror *,
    #remoteCursorMirror *,
    #htmlOverlay * {
      pointer-events: none !important;
    }
    .remote-cursors-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 50;
      overflow: hidden;
    }
    .remote-cursor {
      position: absolute;
      top: 0;
      left: 0;
      display: none;
      transition: transform 120ms ease-out;
      will-change: transform;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
    }
    .remote-cursor-icon {
      display: block;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .remote-cursor-label {
      position: absolute;
      top: 16px;
      left: 10px;
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.3;
      color: #fff;
      white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      opacity: 0.92;
    }
    .composition-layer-mirror {
      position: absolute;
      min-width: 1px;
      min-height: 1px;
      overflow: visible;
      pointer-events: none;
    }
    .composition-layer-mirror > img,
    .composition-layer-mirror > video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
      background: transparent;
    }
    .comment-marker {
      width: 24px;
      height: 24px;
      background: var(--error);
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      transition: all 0.15s ease;
      z-index: 20;
      box-sizing: border-box;
    }
    .comment-marker.resolved {
      background: var(--success);
      opacity: 0.7;
    }
    .comment-marker.hidden {
      opacity: 0;
      visibility: hidden;
    }
    .comment-marker.pending {
      background: var(--accent-primary);
      animation: pulse 1.5s infinite;
    }
    .comment-marker.dragging {
      z-index: 1000;
      transform: translate(-50%, -50%) scale(1.2);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
      opacity: 1 !important;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--accent-shadow-strong); }
      50% { box-shadow: 0 0 0 8px transparent; }
    }
    .comment-marker-input-wrapper {
      position: absolute;
      left: 20px;
      top: 50%;
      transform: translateY(-50%);
      background: var(--bg-elevated);
      border: 1px solid var(--accent-primary);
      border-radius: 8px;
      padding: 8px;
      min-width: 200px;
      box-shadow: var(--shadow-lg);
      z-index: 100;
      box-sizing: border-box;
    }
    .comment-marker-input {
      width: 100%;
      min-width: 180px;
      padding: 8px 10px;
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-primary);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      outline: none;
      resize: none;
      line-height: 1.4;
      overflow-y: auto;
      max-height: 150px;
      box-sizing: border-box;
    }
    .comment-marker-input-hint {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-tertiary);
      text-align: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .marker-replies-badge {
      position: absolute;
      bottom: -8px;
      left: 50%;
      transform: translateX(-50%);
      padding: 2px 6px;
      background: var(--accent-primary);
      color: #000;
      font-size: 10px;
      font-weight: 600;
      border-radius: 10px;
      white-space: nowrap;
      z-index: 10;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .comment-marker-tooltip {
      position: absolute;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 10px 12px;
      min-width: 180px;
      max-width: 280px;
      box-shadow: var(--shadow-lg);
      opacity: 0;
      visibility: hidden;
      z-index: 10000;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .comment-marker-tooltip.visible {
      opacity: 1;
      visibility: visible;
    }
    .comment-marker-tooltip.pinned {
      border-color: var(--accent-primary);
    }
    .tooltip-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .tooltip-timecode {
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      font-weight: 600;
      color: var(--accent-primary);
      background: var(--accent-glow);
      padding: 2px 6px;
      border-radius: 3px;
    }
    .tooltip-author {
      font-size: 11px;
      color: var(--text-secondary);
    }
    .tooltip-text {
      font-size: 13px;
      line-height: 1.4;
      color: var(--text-primary);
      word-break: break-word;
      margin-bottom: 8px;
    }
    .tooltip-actions {
      display: flex;
      gap: 6px;
      border-top: 1px solid var(--border-subtle);
      padding-top: 8px;
    }
    .tooltip-btn {
      padding: 4px 8px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-primary);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div id="root">
    <img id="onionCanvasMirror" class="mirror-canvas" alt="">
    <img id="drawingCanvasMirror" class="mirror-canvas" alt="">
    <img id="remoteStrokeMirror" class="mirror-canvas" alt="">
    <div id="compositionMirror"></div>
    <div id="htmlOverlay"></div>
    <div id="markerMirror"></div>
    <div id="tooltipMirror"></div>
    <canvas id="collabRippleMirror"></canvas>
    <div id="remoteCursorMirror" class="remote-cursors-container"></div>
    <div id="collaborationMirror" data-theme="dark">
      <div id="mpvCollaborationIndicator" class="mpv-collaboration-surface" data-mpv-collab-target="collab.indicator" data-mpv-collab-surface="indicator">
        <div id="mpvCollaborationAvatars"></div>
        <div class="mpv-collaboration-info">
          <span id="mpvCollaborationCount">0</span><span>명 작업 중</span>
        </div>
        <span id="mpvCollaborationBadge" aria-label="동기화 상태" data-mpv-collab-target="collab.sync-status">↻</span>
      </div>
      <div id="mpvCollaborationPlexus" class="mpv-collaboration-surface" data-mpv-collab-target="collab.panel" data-mpv-collab-surface="panel">
        <img id="mpvCollaborationPlexusImage" alt="">
        <div class="mpv-collaboration-plexus-footer">
          <span class="mpv-collaboration-plexus-label">실시간 협업 중</span>
          <div class="mpv-collaboration-actions">
            <button id="mpvCollaborationCursorToggle" class="mpv-collaboration-action" data-mpv-collab-target="collab.cursor-toggle">◉ <span id="mpvCollaborationCursorLabel">커서 숨기기</span></button>
            <button class="mpv-collaboration-action" data-mpv-collab-target="collab.open-sync">⇧ <span>동기화 작업</span></button>
          </div>
        </div>
      </div>
      <div id="mpvPlaybackSyncPanel" class="mpv-collaboration-surface" data-mpv-collab-target="sync.panel">
        <div class="mpv-playback-sync-header" data-mpv-collab-target="sync.drag-handle">
          <span>⇧</span><span class="mpv-playback-sync-title">동기화 작업</span>
          <button data-mpv-collab-target="sync.collapse" aria-label="접기/펼치기">⌄</button>
          <button data-mpv-collab-target="sync.close" aria-label="패널 닫기">×</button>
        </div>
        <div class="mpv-playback-sync-body">
          <div id="mpvPlaybackSyncToggle" class="mpv-playback-sync-toggle" role="checkbox" aria-checked="false" data-mpv-collab-target="sync.toggle">
            <span class="mpv-playback-sync-track"><span class="mpv-playback-sync-knob"></span></span>
            <span id="mpvPlaybackSyncToggleLabel">동기화 꺼짐</span>
          </div>
          <div class="mpv-playback-sync-modes">
            <div id="mpvPlaybackSyncLead" class="mpv-playback-sync-radio" role="radio" aria-checked="true" data-mpv-collab-target="sync.lead">
              <span class="mpv-playback-sync-radio-ring"><span class="mpv-playback-sync-radio-dot"></span></span><span>내가 주도</span>
            </div>
            <div id="mpvPlaybackSyncFollow" class="mpv-playback-sync-radio" role="radio" aria-checked="false" data-mpv-collab-target="sync.follow">
              <span class="mpv-playback-sync-radio-ring"><span class="mpv-playback-sync-radio-dot"></span></span><span>팔로잉하기</span>
            </div>
          </div>
          <div class="mpv-playback-sync-status">
            <span id="mpvPlaybackSyncStatusDot" class="mpv-playback-sync-status-dot"></span>
            <span id="mpvPlaybackSyncStatusText">동기화 꺼짐</span>
          </div>
        </div>
      </div>
    </div>
    <div id="toastMirror"></div>
  </div>
  <script>
    function applyOverlayTransform(element, state) {
      element.style.transform = state.markerTransform || '';
      element.style.transformOrigin = state.markerTransformOrigin || 'center center';
    }

    function applyImage(id, dataUrl, canvas) {
      const element = document.getElementById(id);
      if (!element) return;
      if (!dataUrl || !canvas || canvas.width <= 0 || canvas.height <= 0) {
        element.removeAttribute('src');
        element.style.display = 'none';
        return;
      }
      element.src = dataUrl;
      element.style.display = 'block';
      element.style.left = canvas.left + 'px';
      element.style.top = canvas.top + 'px';
      element.style.width = canvas.width + 'px';
      element.style.height = canvas.height + 'px';
      element.style.transform = 'none';
      element.style.transformOrigin = 'center center';
    }

    function sanitizeRemoteCursorHtml(value) {
      const allowedTags = new Set(['div', 'span', 'svg', 'path']);
      const allowedAttrs = new Set([
        'class',
        'style',
        'width',
        'height',
        'viewbox',
        'fill',
        'stroke',
        'stroke-width',
        'd'
      ]);
      const template = document.createElement('template');
      template.innerHTML = typeof value === 'string' ? value : '';

      template.content.querySelectorAll('*').forEach((element) => {
        if (!allowedTags.has(element.localName)) {
          element.remove();
          return;
        }

        [...element.attributes].forEach((attribute) => {
          const name = attribute.name.toLowerCase();
          const attrValue = attribute.value || '';
          const hasUnsafeValue = /javascript:/i.test(attrValue) ||
            /expression\s*\(/i.test(attrValue) ||
            (name === 'style' && /url\s*\(/i.test(attrValue));
          if (!allowedAttrs.has(name) || name.startsWith('on') || hasUnsafeValue) {
            element.removeAttribute(attribute.name);
          }
        });
      });

      return template.innerHTML;
    }

    function applyRemoteCursorHtml(remoteCursorHtml) {
      const remoteCursorMirror = document.getElementById('remoteCursorMirror');
      if (!remoteCursorMirror) return;
      remoteCursorMirror.innerHTML = sanitizeRemoteCursorHtml(remoteCursorHtml);
    }

    let remoteCursorRevision = -1;
    window.__applyMpvRemoteCursorState = function applyMpvRemoteCursorState(state) {
      const revision = Number(state?.revision);
      if (!Number.isSafeInteger(revision) || revision <= remoteCursorRevision) return false;
      remoteCursorRevision = revision;
      applyRemoteCursorHtml(state?.html);
      return true;
    };

    function applyMpvCollaborationBounds(element, surface, display) {
      if (!element || !surface || !surface.bounds) return;
      element.style.display = surface.visible ? display : 'none';
      element.style.left = surface.bounds.left + 'px';
      element.style.top = surface.bounds.top + 'px';
      element.style.width = surface.bounds.width + 'px';
      element.style.height = surface.bounds.height + 'px';
    }

    function applyMpvCollaborationUsers(users) {
      const avatars = document.getElementById('mpvCollaborationAvatars');
      if (!avatars) return;
      const avatarElements = [];
      for (const user of users) {
        const avatar = document.createElement('span');
        avatar.className = 'mpv-collaboration-avatar' + (user.isMe ? ' is-me' : '');
        avatar.style.backgroundColor = user.color;
        avatar.title = user.name + (user.isMe ? ' (나)' : '');
        avatar.textContent = user.name.slice(0, 2);
        avatarElements.unshift(avatar);
      }
      avatars.replaceChildren(...avatarElements);
    }

    let collaborationRevision = -1;
    window.__applyMpvCollaborationState = function applyMpvCollaborationState(state) {
      const revision = Number(state && state.revision);
      if (!Number.isSafeInteger(revision) || revision <= collaborationRevision) return false;
      collaborationRevision = revision;

      const root = document.getElementById('collaborationMirror');
      const indicator = document.getElementById('mpvCollaborationIndicator');
      const plexus = document.getElementById('mpvCollaborationPlexus');
      const playback = document.getElementById('mpvPlaybackSyncPanel');
      if (!root || !indicator || !plexus || !playback) return false;
      root.dataset.theme = state.theme;

      applyMpvCollaborationBounds(indicator, state.indicator, 'flex');
      applyMpvCollaborationUsers(state.indicator.users);
      document.getElementById('mpvCollaborationCount').textContent = String(state.indicator.users.length);
      const badge = document.getElementById('mpvCollaborationBadge');
      badge.dataset.badge = state.indicator.badge;
      badge.setAttribute('aria-label', {
        idle: '동기화 대기',
        syncing: '동기화 중',
        synced: '동기화 완료',
        error: '동기화 오류'
      }[state.indicator.badge]);

      applyMpvCollaborationBounds(plexus, state.plexus, 'block');
      const plexusImage = document.getElementById('mpvCollaborationPlexusImage');
      if (state.plexus.visible && state.plexus.snapshotDataUrl) {
        plexusImage.src = state.plexus.snapshotDataUrl;
      } else {
        plexusImage.removeAttribute('src');
      }
      const cursorToggle = document.getElementById('mpvCollaborationCursorToggle');
      cursorToggle.classList.toggle('is-muted', !state.plexus.showRemoteCursors);
      cursorToggle.setAttribute('aria-pressed', String(!state.plexus.showRemoteCursors));
      document.getElementById('mpvCollaborationCursorLabel').textContent =
        state.plexus.showRemoteCursors ? '커서 숨기기' : '커서 보이기';

      applyMpvCollaborationBounds(playback, state.playback, 'block');
      playback.classList.toggle('collapsed', state.playback.collapsed);
      const toggle = document.getElementById('mpvPlaybackSyncToggle');
      toggle.classList.toggle('enabled', state.playback.syncEnabled);
      toggle.setAttribute('aria-checked', String(state.playback.syncEnabled));
      document.getElementById('mpvPlaybackSyncToggleLabel').textContent =
        state.playback.syncEnabled ? '동기화 켜짐' : '동기화 꺼짐';
      const lead = document.getElementById('mpvPlaybackSyncLead');
      const follow = document.getElementById('mpvPlaybackSyncFollow');
      const isLead = state.playback.leaderMode === 'lead';
      lead.classList.toggle('selected', isLead);
      lead.setAttribute('aria-checked', String(isLead));
      follow.classList.toggle('selected', !isLead);
      follow.setAttribute('aria-checked', String(!isLead));
      const statusDot = document.getElementById('mpvPlaybackSyncStatusDot');
      statusDot.classList.toggle('leading', state.playback.syncEnabled && isLead);
      statusDot.classList.toggle('active', state.playback.syncEnabled && !isLead);
      document.getElementById('mpvPlaybackSyncStatusText').textContent = !state.playback.syncEnabled
        ? '동기화 꺼짐'
        : isLead ? '내가 주도 중' : '팔로잉 중';
      return true;
    };

    let collabRippleAnimationId = null;
    window.__triggerMpvCollabRipple = function triggerMpvCollabRipple(state) {
      const canvas = document.getElementById('collabRippleMirror');
      if (!canvas) return false;
      if (collabRippleAnimationId !== null) cancelAnimationFrame(collabRippleAnimationId);

      const width = Math.max(1, canvas.clientWidth || document.documentElement.clientWidth || 1);
      const height = Math.max(1, canvas.clientHeight || document.documentElement.clientHeight || 1);
      const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas.style.display = 'block';

      const originX = Math.max(0, Math.min(1, Number(state?.x) || 0)) * width;
      const originY = Math.max(0, Math.min(1, Number(state?.y) || 0)) * height;
      const maxRadius = Math.hypot(width, height);
      const duration = 1800;
      const startedAt = performance.now();
      const waves = [
        { delay: 0, thickness: 80, color: [255, 208, 0] },
        { delay: 120, thickness: 60, color: [255, 180, 40] },
        { delay: 280, thickness: 40, color: [255, 220, 100] }
      ];

      function draw(now) {
        const elapsed = now - startedAt;
        ctx.clearRect(0, 0, width, height);
        if (elapsed > duration + 400) {
          canvas.style.display = 'none';
          collabRippleAnimationId = null;
          return;
        }

        for (const wave of waves) {
          const waveElapsed = elapsed - wave.delay;
          if (waveElapsed < 0) continue;
          const progress = Math.min(waveElapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const radius = eased * maxRadius;
          const thickness = wave.thickness * (1 - progress * 0.5);
          let alpha = progress < 0.1
            ? progress / 0.1
            : progress < 0.4
              ? 1
              : 1 - (progress - 0.4) / 0.6;
          alpha *= 0.35;
          const [r, g, b] = wave.color;
          const glow = ctx.createRadialGradient(
            originX, originY, Math.max(0, radius - thickness * 2),
            originX, originY, radius + thickness
          );
          glow.addColorStop(0, 'rgba(' + r + ', ' + g + ', ' + b + ', 0)');
          glow.addColorStop(0.3, 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (alpha * 0.3) + ')');
          glow.addColorStop(0.5, 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (alpha * 0.6) + ')');
          glow.addColorStop(0.7, 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (alpha * 0.3) + ')');
          glow.addColorStop(1, 'rgba(' + r + ', ' + g + ', ' + b + ', 0)');
          ctx.beginPath();
          ctx.arc(originX, originY, radius + thickness, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(originX, originY, radius, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (alpha * 0.8) + ')';
          ctx.lineWidth = 2 * (1 - progress * 0.7);
          ctx.stroke();
        }

        collabRippleAnimationId = requestAnimationFrame(draw);
      }

      collabRippleAnimationId = requestAnimationFrame(draw);
      return true;
    };

    function getCompositionElement(root, layer) {
      const children = Array.from(root.children);
      let wrapper = children.find((child) => child.dataset.layerId === layer.id);
      const existingMedia = wrapper ? wrapper.querySelector('img, video') : null;
      const needsRecreate = !wrapper || !existingMedia ||
        (layer.type === 'video' && existingMedia.tagName !== 'VIDEO') ||
        (layer.type !== 'video' && existingMedia.tagName !== 'IMG');

      if (!needsRecreate) return wrapper;
      if (wrapper) wrapper.remove();

      wrapper = document.createElement('div');
      wrapper.className = 'composition-layer-mirror';
      wrapper.dataset.layerId = layer.id;
      const media = document.createElement(layer.type === 'video' ? 'video' : 'img');
      if (layer.type === 'video') {
        const element = media;
        element.muted = true;
        element.playsInline = true;
        element.preload = 'metadata';
      } else {
        media.alt = '';
      }
      wrapper.appendChild(media);
      root.appendChild(wrapper);
      return wrapper;
    }

    function applyCompositionMirrorFrame(root, canvas) {
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
        root.style.display = 'none';
        return false;
      }

      root.style.display = 'block';
      root.style.left = canvas.left + 'px';
      root.style.top = canvas.top + 'px';
      root.style.width = canvas.width + 'px';
      root.style.height = canvas.height + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.transform = 'none';
      root.style.transformOrigin = 'center center';
      return true;
    }

    function applyCompositionLayers(layers, canvas) {
      const root = document.getElementById('compositionMirror');
      if (!root) return;
      if (!applyCompositionMirrorFrame(root, canvas)) {
        root.innerHTML = '';
        return;
      }

      const nextLayers = Array.isArray(layers) ? layers : [];
      const nextIds = new Set(nextLayers.map((layer) => layer.id));

      Array.from(root.children).forEach((child) => {
        if (!nextIds.has(child.dataset.layerId)) child.remove();
      });

      nextLayers.forEach((layer) => {
        const wrapper = getCompositionElement(root, layer);
        const media = wrapper.querySelector('img, video');
        if (!media) return;

        wrapper.style.left = (layer.x * 100) + '%';
        wrapper.style.top = (layer.y * 100) + '%';
        wrapper.style.width = (layer.width * 100) + '%';
        wrapper.style.height = (layer.height * 100) + '%';
        wrapper.style.opacity = String(layer.opacity);
        wrapper.style.zIndex = String(20 + layer.order);

        if (media.getAttribute('src') !== layer.fileUrl) {
          media.setAttribute('src', layer.fileUrl);
        }

        if (layer.type === 'video') {
          const element = media;
          element.muted = true;
          const localTime = Math.max(0, Number(layer.localTime) || 0);
          const seekThreshold = layer.isPlaying ? 0.08 : 0.001;
          if (Number.isFinite(localTime) && Math.abs((element.currentTime || 0) - localTime) > seekThreshold) {
            try { element.currentTime = localTime; } catch (_) {}
          }
          if (layer.isPlaying) {
            element.play?.().catch?.(() => {});
          } else {
            element.pause?.();
          }
        }
      });
    }

    window.__applyMpvOverlayState = function applyMpvOverlayState(state) {
      const nextState = state || {};
      const htmlOverlay = document.getElementById('htmlOverlay');
      const markerMirror = document.getElementById('markerMirror');
      const tooltipMirror = document.getElementById('tooltipMirror');
      const toastMirror = document.getElementById('toastMirror');
      if (nextState.fabricViewport !== undefined) {
        window.__mpvFabricOverlay?.updateViewport?.(nextState.fabricViewport);
      }
      // 32 잔존: 필드가 생략(undefined)되면 이전 DOM을 유지한다 — 무-diff 통째 재주입이
      // 재생 중 프레임마다 미러를 파괴·재생성해 등장/확대 애니메이션을 반복 재생하던 문제의 수정.
      if (nextState.onionDataUrl !== undefined) applyImage('onionCanvasMirror', nextState.onionDataUrl, nextState.canvas);
      if (nextState.drawingDataUrl !== undefined) applyImage('drawingCanvasMirror', nextState.drawingDataUrl, nextState.canvas);
      if (nextState.remoteStrokeDataUrl !== undefined) applyImage('remoteStrokeMirror', nextState.remoteStrokeDataUrl, nextState.canvas);
      if (nextState.remoteStrokeOpacity !== undefined) {
        const remoteStrokeMirror = document.getElementById('remoteStrokeMirror');
        if (remoteStrokeMirror) remoteStrokeMirror.style.opacity = String(nextState.remoteStrokeOpacity);
      }
      applyCompositionLayers(nextState.compositionLayers, nextState.canvas);
      if (typeof nextState.htmlOverlayHtml === 'string') htmlOverlay.innerHTML = nextState.htmlOverlayHtml;
      if (typeof nextState.markerHtml === 'string') markerMirror.innerHTML = nextState.markerHtml;
      if (typeof nextState.tooltipHtml === 'string') tooltipMirror.innerHTML = nextState.tooltipHtml;
      if (typeof nextState.toastHtml === 'string') toastMirror.innerHTML = nextState.toastHtml;
      applyOverlayTransform(markerMirror, nextState);
      tooltipMirror.style.transform = 'none';
      tooltipMirror.style.transformOrigin = 'center center';
      const playheadMirror = htmlOverlay.querySelector('.video-comment-range-playhead');
      if (playheadMirror && nextState.commentPlayheadLeft) {
        playheadMirror.style.left = nextState.commentPlayheadLeft;
      }
    };
  </script>
</body>
</html>`;

const OVERLAY_HOST_URL = `data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`;
const OVERLAY_API_READY_SCRIPT = [
  "typeof window.__applyMpvOverlayState === 'function'",
  "typeof window.__applyMpvRemoteCursorState === 'function'",
  "typeof window.__applyMpvCollaborationState === 'function'",
  "typeof window.__triggerMpvCollabRipple === 'function'"
].join(' && ');

function getDefaultBrowserWindow() {
  return require('electron').BrowserWindow;
}

function getDefaultMainWindow() {
  return require('./window').getMainWindow();
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function normalizeFloat(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeImageDataUrl(value) {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith('data:image/') ? text : '';
}

function isExactPlainRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length &&
    ownKeys.every(key => typeof key === 'string' && keys.includes(key));
}

function isDensePlainArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return Reflect.ownKeys(value).every(key => key === 'length' ||
    (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length));
}

function normalizeMpvCollaborationBounds(value) {
  const keys = ['left', 'top', 'width', 'height'];
  if (!isExactPlainRecord(value, keys)) return null;
  if (!keys.every(key => Number.isFinite(value[key]) &&
      Math.abs(value[key]) <= MAX_MPV_COLLABORATION_BOUND)) {
    return null;
  }
  if (value.width < 0 || value.height < 0) return null;
  return {
    left: value.left,
    top: value.top,
    width: value.width,
    height: value.height
  };
}

function normalizeMpvCollaborationName(value) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, MAX_MPV_COLLABORATION_NAME_LENGTH);
}

function normalizeMpvCollaborationUser(value) {
  if (!isExactPlainRecord(value, ['name', 'color', 'isMe', 'syncActive'])) return null;
  const name = normalizeMpvCollaborationName(value.name);
  if (name === null || typeof value.color !== 'string' ||
      typeof value.isMe !== 'boolean' || typeof value.syncActive !== 'boolean') {
    return null;
  }
  const color = /^#[0-9a-f]{6}$/i.test(value.color)
    ? value.color.toLowerCase()
    : MPV_COLLABORATION_FALLBACK_COLOR;
  return { name, color, isMe: value.isMe, syncActive: value.syncActive };
}

function normalizeMpvCollaborationSnapshotDataUrl(value) {
  if (value === '') return '';
  if (typeof value !== 'string' ||
      !/^data:image\/png;base64,[a-z0-9+/]*={0,2}$/i.test(value) ||
      Buffer.byteLength(value, 'utf8') > MAX_MPV_COLLABORATION_SNAPSHOT_BYTES) {
    return null;
  }
  return value;
}

function normalizeMpvCollaborationState(value) {
  try {
    if (!isExactPlainRecord(value, [
      'revision',
      'theme',
      'indicator',
      'plexus',
      'playback'
    ])) return null;
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_MPV_COLLABORATION_STATE_BYTES ||
        !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        !['dark', 'light'].includes(value.theme)) {
      return null;
    }

    if (!isExactPlainRecord(value.indicator, ['visible', 'bounds', 'badge', 'users']) ||
        typeof value.indicator.visible !== 'boolean' ||
        !['idle', 'syncing', 'synced', 'error'].includes(value.indicator.badge) ||
        !isDensePlainArray(value.indicator.users) ||
        value.indicator.users.length > MAX_MPV_COLLABORATION_USERS) {
      return null;
    }
    const indicatorBounds = normalizeMpvCollaborationBounds(value.indicator.bounds);
    const users = value.indicator.users.map(normalizeMpvCollaborationUser);
    if (!indicatorBounds || users.some(user => user === null)) return null;

    if (!isExactPlainRecord(value.plexus, [
      'visible',
      'bounds',
      'showRemoteCursors',
      'snapshotDataUrl'
    ]) || typeof value.plexus.visible !== 'boolean' ||
        typeof value.plexus.showRemoteCursors !== 'boolean') {
      return null;
    }
    const plexusBounds = normalizeMpvCollaborationBounds(value.plexus.bounds);
    const snapshotDataUrl = normalizeMpvCollaborationSnapshotDataUrl(
      value.plexus.snapshotDataUrl
    );
    if (!plexusBounds || snapshotDataUrl === null) return null;

    if (!isExactPlainRecord(value.playback, [
      'visible',
      'bounds',
      'collapsed',
      'syncEnabled',
      'leaderMode'
    ]) || typeof value.playback.visible !== 'boolean' ||
        typeof value.playback.collapsed !== 'boolean' ||
        typeof value.playback.syncEnabled !== 'boolean' ||
        !['lead', 'follow'].includes(value.playback.leaderMode)) {
      return null;
    }
    const playbackBounds = normalizeMpvCollaborationBounds(value.playback.bounds);
    if (!playbackBounds) return null;

    return {
      revision: value.revision,
      theme: value.theme,
      indicator: {
        visible: value.indicator.visible,
        bounds: indicatorBounds,
        badge: value.indicator.badge,
        users
      },
      plexus: {
        visible: value.plexus.visible,
        bounds: plexusBounds,
        showRemoteCursors: value.plexus.showRemoteCursors,
        snapshotDataUrl
      },
      playback: {
        visible: value.playback.visible,
        bounds: playbackBounds,
        collapsed: value.playback.collapsed,
        syncEnabled: value.playback.syncEnabled,
        leaderMode: value.playback.leaderMode
      }
    };
  } catch (_error) {
    return null;
  }
}

function normalizeMpvOverlayCollaborationAction(value) {
  try {
    if (!isExactPlainRecord(value, ['action', 'payload']) ||
        typeof value.action !== 'string') {
      return null;
    }
    if (MPV_OVERLAY_COLLABORATION_NON_DRAG_ACTIONS.has(value.action)) {
      return value.payload === null ? { action: value.action, payload: null } : null;
    }
    if (MPV_OVERLAY_COLLABORATION_DRAG_ACTIONS.has(value.action)) {
      if (!isExactPlainRecord(value.payload, ['pointerId', 'clientX', 'clientY']) ||
          !Number.isSafeInteger(value.payload.pointerId) || value.payload.pointerId < 0 ||
          !Number.isFinite(value.payload.clientX) ||
          Math.abs(value.payload.clientX) > MAX_MPV_COLLABORATION_BOUND ||
          !Number.isFinite(value.payload.clientY) ||
          Math.abs(value.payload.clientY) > MAX_MPV_COLLABORATION_BOUND) {
        return null;
      }
      return {
        action: value.action,
        payload: {
          pointerId: value.payload.pointerId,
          clientX: value.payload.clientX,
          clientY: value.payload.clientY
        }
      };
    }
    if (value.action === 'sync.drag-cancel' &&
        isExactPlainRecord(value.payload, ['pointerId']) &&
        Number.isSafeInteger(value.payload.pointerId) && value.payload.pointerId >= 0) {
      return {
        action: value.action,
        payload: { pointerId: value.payload.pointerId }
      };
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function normalizeCompositionLayer(layer = {}) {
  const type = layer.type === 'video' ? 'video' : layer.type === 'image' ? 'image' : null;
  const rawFileUrl = typeof layer.fileUrl === 'string' ? layer.fileUrl : '';
  const isEmbeddedImageUrl = type === 'image' && rawFileUrl.startsWith('data:image/');
  const fileUrl = /^file:\/\//i.test(rawFileUrl) || isEmbeddedImageUrl ? rawFileUrl : '';
  if (!type || !fileUrl || !layer.id) return null;

  return {
    id: String(layer.id),
    name: typeof layer.name === 'string' ? layer.name : '',
    type,
    filePath: typeof layer.filePath === 'string' ? layer.filePath : '',
    fileUrl,
    order: Math.max(0, normalizeNumber(layer.order, 0)),
    opacity: Math.max(0, Math.min(1, normalizeFloat(layer.opacity, 1))),
    x: normalizeFloat(layer.x, 0),
    y: normalizeFloat(layer.y, 0),
    width: Math.max(0.001, normalizeFloat(layer.width, 0)),
    height: Math.max(0.001, normalizeFloat(layer.height, 0)),
    startTime: Math.max(0, normalizeFloat(layer.startTime, 0)),
    endTime: Math.max(0, normalizeFloat(layer.endTime, 0)),
    localTime: Math.max(0, normalizeFloat(layer.localTime, 0)),
    isPlaying: layer.isPlaying === true
  };
}

function normalizeCompositionLayers(layers) {
  if (!Array.isArray(layers)) return [];
  return layers
    .map(normalizeCompositionLayer)
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeFabricViewport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const canvasRect = value.canvasRect && typeof value.canvasRect === 'object'
    ? value.canvasRect
    : {};
  const rawRevision = normalizeFloat(value.revision, 0);
  const scale = normalizeFloat(value.scale, 1);
  const devicePixelRatio = normalizeFloat(value.devicePixelRatio, 1);
  return {
    revision: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(rawRevision))),
    canvasRect: {
      left: normalizeFloat(canvasRect.left, 0),
      top: normalizeFloat(canvasRect.top, 0),
      width: Math.max(0, normalizeFloat(canvasRect.width, 0)),
      height: Math.max(0, normalizeFloat(canvasRect.height, 0))
    },
    scale: scale > 0 ? scale : 1,
    panX: normalizeFloat(value.panX, 0),
    panY: normalizeFloat(value.panY, 0),
    devicePixelRatio: devicePixelRatio > 0 ? devicePixelRatio : 1
  };
}

function normalizeOverlayState(state = {}) {
  const canvas = state.canvas || {};
  return {
    drawingDataUrl: state.drawingDataUrl === undefined ? undefined : normalizeImageDataUrl(state.drawingDataUrl),
    remoteStrokeDataUrl: state.remoteStrokeDataUrl === undefined ? undefined : normalizeImageDataUrl(state.remoteStrokeDataUrl),
    remoteStrokeOpacity: state.remoteStrokeOpacity === undefined
      ? undefined
      : Math.max(0, Math.min(1, normalizeFloat(state.remoteStrokeOpacity, 1))),
    onionDataUrl: state.onionDataUrl === undefined ? undefined : normalizeImageDataUrl(state.onionDataUrl),
    markerHtml: state.markerHtml === undefined ? undefined : (typeof state.markerHtml === 'string' ? state.markerHtml : ''),
    tooltipHtml: state.tooltipHtml === undefined ? undefined : (typeof state.tooltipHtml === 'string' ? state.tooltipHtml : ''),
    htmlOverlayHtml: state.htmlOverlayHtml === undefined ? undefined : (typeof state.htmlOverlayHtml === 'string' ? state.htmlOverlayHtml : ''),
    toastHtml: state.toastHtml === undefined ? undefined : (typeof state.toastHtml === 'string' ? state.toastHtml : ''),
    commentPlayheadLeft: typeof state.commentPlayheadLeft === 'string' ? state.commentPlayheadLeft : '',
    fabricViewport: normalizeFabricViewport(state.fabricViewport),
    compositionLayers: normalizeCompositionLayers(state.compositionLayers),
    markerTransform: typeof state.markerTransform === 'string' ? state.markerTransform : '',
    markerTransformOrigin: typeof state.markerTransformOrigin === 'string'
      ? state.markerTransformOrigin
      : 'center center',
    canvas: {
      left: normalizeNumber(canvas.left, 0),
      top: normalizeNumber(canvas.top, 0),
      width: Math.max(0, normalizeNumber(canvas.width, 0)),
      height: Math.max(0, normalizeNumber(canvas.height, 0))
    }
  };
}

const FORWARDED_KEYBOARD_CHANNEL = 'mpv-overlay:keyboard-input';
const FORWARDED_NAMED_KEY_CODES = new Set([
  'Backspace',
  'Tab',
  'Enter',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'CapsLock',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'PrintScreen',
  'ScrollLock',
  'Pause',
  'NumLock',
  'ContextMenu',
  'IntlBackslash',
  'IntlRo',
  'IntlYen',
  'Convert',
  'NonConvert',
  'KanaMode',
  'Lang1',
  'Lang2',
  'Lang3',
  'Lang4',
  'Lang5',
  'Help',
  'Again',
  'Undo',
  'Cut',
  'Copy',
  'Paste',
  'Find',
  'Props',
  'Select',
  'Open',
  'Eject',
  'Power',
  'WakeUp',
  'BrowserBack',
  'BrowserForward',
  'BrowserRefresh',
  'BrowserStop',
  'BrowserSearch',
  'BrowserFavorites',
  'BrowserHome',
  'AudioVolumeMute',
  'AudioVolumeDown',
  'AudioVolumeUp',
  'MediaTrackNext',
  'MediaTrackPrevious',
  'MediaStop',
  'MediaPlayPause',
  'MediaSelect',
  'LaunchMail',
  'LaunchApp1',
  'LaunchApp2'
]);

function isForwardedPhysicalKeyCode(code) {
  if (typeof code !== 'string' || code.length === 0 || code.length > 32) return false;
  if (/^Key[A-Z]$/.test(code) ||
      /^Digit[0-9]$/.test(code) ||
      /^F(?:[1-9]|1\d|2[0-4])$/.test(code) ||
      /^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma|ParenLeft|ParenRight|Backspace|Clear|ClearEntry|MemoryAdd|MemoryClear|MemoryRecall|MemoryStore|MemorySubtract)$/.test(code)) {
    return true;
  }
  return FORWARDED_NAMED_KEY_CODES.has(code);
}

function isOptionalBoolean(value) {
  return value === undefined || typeof value === 'boolean';
}

function createForwardedKeyboardInput(input = {}, drawModeShortcut = null) {
  if (input.type !== 'keyDown' && input.type !== 'keyUp') return null;
  const key = typeof input.key === 'string' ? input.key : '';
  const code = typeof input.code === 'string' ? input.code : '';
  if (key.length === 0 || key.length > 64 || key.includes('\u0000') ||
      !isForwardedPhysicalKeyCode(code) ||
      !isOptionalBoolean(input.shift) ||
      !isOptionalBoolean(input.control) ||
      !isOptionalBoolean(input.alt) ||
      !isOptionalBoolean(input.meta) ||
      !isOptionalBoolean(input.isAutoRepeat) ||
      !isOptionalBoolean(input.isComposing)) {
    return null;
  }
  // 그리기 토글 물리 키는 IME 조합 플래그가 붙어도 릴레이한다. 조합 대상이 없는
  // 오버레이 창에서 조합 플래그만으로 B가 통째로 사라지던 비대칭을 없앤다.
  // key 자체가 'Process'/'Dead'/'Unidentified'면 식별 가능한 키 정보가 없고
  // 렌더러 릴레이 모듈도 독립적으로 거부하므로 예외 없이 계속 차단한다.
  if ((input.isComposing === true && !matchesDrawModeShortcutInput(input, drawModeShortcut)) ||
      ['Process', 'Dead', 'Unidentified'].includes(key) ||
      ['Process', 'Dead', 'Unidentified'].includes(code)) {
    return null;
  }

  return {
    type: input.type,
    key,
    code,
    shiftKey: input.shift === true,
    ctrlKey: input.control === true,
    altKey: input.alt === true,
    metaKey: input.meta === true,
    repeat: input.isAutoRepeat === true
  };
}

// 렌더러가 상태 sync로 실어 보낸 drawMode 단축키 서술자. 아직 동기화 전이면 null이며,
// null이면 기존 기본값(KeyB 단독)과 완전히 같은 판정을 유지한다.
function normalizeDrawModeShortcutDescriptor(value, previous = null) {
  if (value === undefined) return previous;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!isForwardedPhysicalKeyCode(value.key)) return null;
  return {
    key: value.key,
    ctrl: value.ctrl === true,
    shift: value.shift === true,
    alt: value.alt === true
  };
}

function matchesDrawModeShortcutInput(input = {}, drawModeShortcut = null) {
  if (!drawModeShortcut) return false;
  return input.code === drawModeShortcut.key &&
    (input.shift === true) === (drawModeShortcut.shift === true) &&
    (input.control === true) === (drawModeShortcut.ctrl === true) &&
    (input.alt === true) === (drawModeShortcut.alt === true) &&
    input.meta !== true;
}

function forwardedInputNeedsMainFocus(input = {}, drawModeShortcut = null) {
  return input.type === 'keyDown' &&
    input.code === (drawModeShortcut ? drawModeShortcut.key : 'KeyB') &&
    input.repeat !== true &&
    input.shiftKey === (drawModeShortcut ? drawModeShortcut.shift === true : false) &&
    input.ctrlKey === (drawModeShortcut ? drawModeShortcut.ctrl === true : false) &&
    input.altKey === (drawModeShortcut ? drawModeShortcut.alt === true : false) &&
    input.metaKey !== true;
}

function overlayHistoryActionFromInput(input = {}) {
  if (input.type !== 'keyDown' ||
      input.isComposing === true ||
      ['Process', 'Dead', 'Unidentified'].includes(String(input.key || '')) ||
      ['Process', 'Dead'].includes(String(input.code || ''))) {
    return null;
  }
  const exactlyOnePrimaryModifier =
    (input.control === true) !== (input.meta === true);
  if (!exactlyOnePrimaryModifier || input.alt === true) return null;
  if (input.code === 'KeyZ') return input.shift === true ? 'redo' : 'undo';
  if (input.code === 'KeyY' && input.shift !== true) return 'redo';
  return null;
}

// 오버레이 제스처 진단 중계. 지금까지 이 블록은 화이트리스트에 없어 통째로 버려졌고,
// 그 탓에 Alt 제스처 결함을 실기에서 관측할 방법이 없었다. 값 범위를 여기서 고정한다.
function sanitizeFabricGestureDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pointerdown = value.lastPointerdown &&
    typeof value.lastPointerdown === 'object' &&
    !Array.isArray(value.lastPointerdown)
    ? value.lastPointerdown
    : null;
  return {
    altSizeAdjustActive: value.altSizeAdjustActive === true,
    ctrlStrokeEraseActive: value.ctrlStrokeEraseActive === true,
    strokeEraseCandidateCount: Math.max(
      0,
      Math.trunc(finiteDiagnosticNumber(value.strokeEraseCandidateCount))
    ),
    modifierAlt: value.modifierAlt === true,
    modifierCtrl: value.modifierCtrl === true,
    overlayAltKeyDownCount: Math.max(
      0,
      Math.trunc(finiteDiagnosticNumber(value.overlayAltKeyDownCount))
    ),
    overlayCtrlKeyDownCount: Math.max(
      0,
      Math.trunc(finiteDiagnosticNumber(value.overlayCtrlKeyDownCount))
    ),
    lastPointerdown: pointerdown
      ? {
        pointerType: typeof pointerdown.pointerType === 'string'
          ? pointerdown.pointerType.slice(0, 32)
          : null,
        button: Number.isInteger(pointerdown.button) ? pointerdown.button : null,
        altKey: pointerdown.altKey === true,
        ctrlKey: pointerdown.ctrlKey === true,
        latchAlt: pointerdown.latchAlt === true,
        latchCtrl: pointerdown.latchCtrl === true,
        documentHasFocus: pointerdown.documentHasFocus === true
          ? true
          : (pointerdown.documentHasFocus === false ? false : null),
        replayed: pointerdown.replayed === true
      }
      : null
  };
}

function finiteDiagnosticNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function drawingV3DiagnosticCount(value) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function drawingV3DiagnosticLatency(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(number, 60_000) : 0;
}

function sanitizeDrawingV3Diagnostics(value) {
  const diagnostics = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { status: 'degraded', failureCount: 1, lastReason: 'adapter-failed' };
  return {
    enabled: diagnostics.enabled === true,
    status: DRAWING_V3_DIAGNOSTIC_STATUSES.has(diagnostics.status)
      ? diagnostics.status
      : 'degraded',
    sceneCount: drawingV3DiagnosticCount(diagnostics.sceneCount),
    bootstrapCount: drawingV3DiagnosticCount(diagnostics.bootstrapCount),
    commitCount: drawingV3DiagnosticCount(diagnostics.commitCount),
    failureCount: drawingV3DiagnosticCount(diagnostics.failureCount),
    divergenceCount: drawingV3DiagnosticCount(diagnostics.divergenceCount),
    resyncCount: drawingV3DiagnosticCount(diagnostics.resyncCount),
    staleCount: drawingV3DiagnosticCount(diagnostics.staleCount),
    gapCount: drawingV3DiagnosticCount(diagnostics.gapCount),
    headSequence: drawingV3DiagnosticCount(diagnostics.headSequence),
    objectCount: drawingV3DiagnosticCount(diagnostics.objectCount),
    estimatedBytes: drawingV3DiagnosticCount(diagnostics.estimatedBytes),
    latencyP50Ms: drawingV3DiagnosticLatency(diagnostics.latencyP50Ms),
    latencyP95Ms: drawingV3DiagnosticLatency(diagnostics.latencyP95Ms),
    lastReason: DRAWING_V3_DIAGNOSTIC_REASONS.has(diagnostics.lastReason)
      ? diagnostics.lastReason
      : null
  };
}

function sanitizeFabricMetrics(metrics = {}) {
  const scalarKeys = [
    'maxSamples',
    'duplicateActionCount',
    'saveAttemptCount',
    'staleMessageDropCount',
    'surfaceErrorCount'
  ];
  const sanitized = {};
  for (const key of scalarKeys) {
    if (metrics[key] !== undefined) sanitized[key] = finiteDiagnosticNumber(metrics[key]);
  }
  for (const key of ['toggleLatency', 'pointerPreviewLatency', 'longTasks']) {
    const series = metrics[key];
    if (!series || typeof series !== 'object') continue;
    sanitized[key] = {
      count: finiteDiagnosticNumber(series.count),
      average: finiteDiagnosticNumber(series.average),
      max: finiteDiagnosticNumber(series.max),
      p50: finiteDiagnosticNumber(series.p50),
      p95: finiteDiagnosticNumber(series.p95)
    };
  }
  if (metrics.pointerSamples && typeof metrics.pointerSamples === 'object') {
    sanitized.pointerSamples = {
      count: finiteDiagnosticNumber(metrics.pointerSamples.count),
      pressureMin: metrics.pointerSamples.pressureMin === null
        ? null
        : finiteDiagnosticNumber(metrics.pointerSamples.pressureMin),
      pressureMax: metrics.pointerSamples.pressureMax === null
        ? null
        : finiteDiagnosticNumber(metrics.pointerSamples.pressureMax),
      pressureRange: finiteDiagnosticNumber(metrics.pointerSamples.pressureRange)
    };
  }
  if (metrics.objectCount && typeof metrics.objectCount === 'object') {
    sanitized.objectCount = {
      current: finiteDiagnosticNumber(metrics.objectCount.current),
      peak: finiteDiagnosticNumber(metrics.objectCount.peak)
    };
  }
  return sanitized;
}

function isPlainPersistenceRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactPersistenceKeys(value, expectedKeys, optionalKeys = []) {
  if (!isPlainPersistenceRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return false;
  const allowedKeys = new Set([...expectedKeys, ...optionalKeys]);
  return keys.every(key => allowedKeys.has(key)) &&
    expectedKeys.every(key => Object.hasOwn(value, key));
}

function isDensePersistenceArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return Reflect.ownKeys(value).every(key =>
    key === 'length' ||
    (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length)
  );
}

function isSafePersistenceCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isBoundedPersistenceString(value, maximum = FABRIC_DRAWING_MAX_STRING_LENGTH) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum;
}

function clonePersistenceJson(value, maxBytes) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_error) {
    return { success: false, reason: 'serialization-failed' };
  }
  if (typeof serialized !== 'string') {
    return { success: false, reason: 'serialization-failed' };
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    return { success: false, reason: 'too-large' };
  }
  try {
    return { success: true, value: JSON.parse(serialized) };
  } catch (_error) {
    return { success: false, reason: 'serialization-failed' };
  }
}

function validateFabricDrawingTimeline(value) {
  return Number.isFinite(value.fps) &&
    value.fps > 0 &&
    value.fps <= 1000 &&
    Number.isSafeInteger(value.totalFrames) &&
    value.totalFrames > 0 &&
    value.totalFrames <= FABRIC_DRAWING_MAX_TOTAL_FRAMES;
}

function validateFabricDrawingTransform(value) {
  if (!hasExactPersistenceKeys(value, FABRIC_DRAWING_TRANSFORM_KEYS)) return false;
  for (const key of FABRIC_DRAWING_TRANSFORM_KEYS) {
    if (key === 'flipX' || key === 'flipY') {
      if (typeof value[key] !== 'boolean') return false;
      continue;
    }
    if (!Number.isFinite(value[key]) ||
        Math.abs(value[key]) > FABRIC_DRAWING_MAX_TRANSFORM_MAGNITUDE) {
      return false;
    }
  }
  return value.scaleX !== 0 && value.scaleY !== 0;
}

function fabricDrawingTransformsEqual(left, right) {
  return FABRIC_DRAWING_TRANSFORM_KEYS.every(key => left[key] === right[key]);
}

function validateFabricDrawingPoint(value) {
  if (!hasExactPersistenceKeys(
    value,
    FABRIC_DRAWING_POINT_REQUIRED_KEYS,
    FABRIC_DRAWING_POINT_OPTIONAL_KEYS
  )) {
    return false;
  }
  if (!Number.isFinite(value.x) ||
      Math.abs(value.x) > FABRIC_DRAWING_MAX_POINT_COORDINATE ||
      !Number.isFinite(value.y) ||
      Math.abs(value.y) > FABRIC_DRAWING_MAX_POINT_COORDINATE ||
      !Number.isFinite(value.pressure) ||
      value.pressure < 0 ||
      value.pressure > 1 ||
      !Number.isFinite(value.time) ||
      value.time < 0 ||
      value.time > FABRIC_DRAWING_MAX_POINT_TIME) {
    return false;
  }
  return value.pointerType === undefined ||
    (typeof value.pointerType === 'string' &&
     FABRIC_DRAWING_POINTER_TYPES.has(value.pointerType));
}

function validateFabricDrawingRecord(value, maxPathLength) {
  if (!hasExactPersistenceKeys(
    value,
    FABRIC_DRAWING_RECORD_REQUIRED_KEYS,
    FABRIC_DRAWING_RECORD_OPTIONAL_KEYS
  ) ||
      !isBoundedPersistenceString(value.id, 512) ||
      value.type !== 'stroke' ||
      !isBoundedPersistenceString(value.pathData, maxPathLength) ||
      !isDensePersistenceArray(value.sourcePoints) ||
      value.sourcePoints.length === 0 ||
      value.sourcePoints.length > FABRIC_DRAWING_MAX_POINTS_PER_STROKE ||
      !hasExactPersistenceKeys(value.style, FABRIC_DRAWING_STYLE_KEYS) ||
      !FABRIC_DRAWING_HEX_COLOR.test(value.style.color) ||
      !Number.isFinite(value.style.size) ||
      value.style.size <= 0 ||
      value.style.size > FABRIC_DRAWING_MAX_BRUSH_SIZE ||
      !Number.isFinite(value.style.opacity) ||
      value.style.opacity < 0 ||
      value.style.opacity > 1 ||
      !validateFabricDrawingTransform(value.transform)) {
    return false;
  }

  let previousTime = 0;
  for (const point of value.sourcePoints) {
    if (!validateFabricDrawingPoint(point) || point.time < previousTime) return false;
    previousTime = point.time;
  }
  if (value.strokeCaps !== undefined &&
      (!hasExactPersistenceKeys(value.strokeCaps, FABRIC_DRAWING_CAPS_KEYS) ||
       typeof value.strokeCaps.start !== 'boolean' ||
       typeof value.strokeCaps.end !== 'boolean')) {
    return false;
  }
  if (value.renderGeometry !== undefined &&
      (!hasExactPersistenceKeys(
        value.renderGeometry,
        FABRIC_DRAWING_RENDER_GEOMETRY_KEYS
      ) ||
       !validateDrawingRenderGeometry(value.renderGeometry, {
         maxPathLength: Math.min(FABRIC_DRAWING_MAX_STRING_LENGTH, maxPathLength),
         maxCoordinate: FABRIC_DRAWING_MAX_POINT_COORDINATE +
           FABRIC_DRAWING_MAX_BRUSH_SIZE
       }))) {
    return false;
  }
  return true;
}

// failedCheck 진단 전용 — validateFabricDrawingRecord가 false를 돌려준 뒤에만 호출한다.
// 어떤 하위 검사에서 걸렸는지만 짧은 토큰으로 돌려주고, 레코드 내용은 남기지 않는다.
// 검사 순서가 validateFabricDrawingRecord와 어긋나면 'unknown'이 나오며 그 자체로도
// "열거한 검사 밖에서 실패했다"는 정보가 된다.
function describeFabricDrawingRecordFailure(value, maxPathLength) {
  if (!hasExactPersistenceKeys(
    value,
    FABRIC_DRAWING_RECORD_REQUIRED_KEYS,
    FABRIC_DRAWING_RECORD_OPTIONAL_KEYS
  )) {
    return 'record-keys';
  }
  if (!isBoundedPersistenceString(value.id, 512)) return 'id';
  if (value.type !== 'stroke') return 'type';
  if (!isBoundedPersistenceString(value.pathData, maxPathLength)) return 'path-data';
  if (!isDensePersistenceArray(value.sourcePoints) ||
      value.sourcePoints.length === 0 ||
      value.sourcePoints.length > FABRIC_DRAWING_MAX_POINTS_PER_STROKE) {
    return 'source-points';
  }
  if (!hasExactPersistenceKeys(value.style, FABRIC_DRAWING_STYLE_KEYS)) return 'style-keys';
  if (!FABRIC_DRAWING_HEX_COLOR.test(value.style.color) ||
      !Number.isFinite(value.style.size) ||
      value.style.size <= 0 ||
      value.style.size > FABRIC_DRAWING_MAX_BRUSH_SIZE ||
      !Number.isFinite(value.style.opacity) ||
      value.style.opacity < 0 ||
      value.style.opacity > 1) {
    return 'style-values';
  }
  if (!validateFabricDrawingTransform(value.transform)) return 'transform';
  let previousTime = 0;
  for (let index = 0; index < value.sourcePoints.length; index += 1) {
    const point = value.sourcePoints[index];
    if (!validateFabricDrawingPoint(point)) return `point:${index}`;
    if (point.time < previousTime) return `point-time:${index}`;
    previousTime = point.time;
  }
  if (value.strokeCaps !== undefined &&
      (!hasExactPersistenceKeys(value.strokeCaps, FABRIC_DRAWING_CAPS_KEYS) ||
       typeof value.strokeCaps.start !== 'boolean' ||
       typeof value.strokeCaps.end !== 'boolean')) {
    return 'stroke-caps';
  }
  if (value.renderGeometry !== undefined) {
    if (!hasExactPersistenceKeys(
      value.renderGeometry,
      FABRIC_DRAWING_RENDER_GEOMETRY_KEYS
    )) {
      return 'render-geometry-keys';
    }
    if (!validateDrawingRenderGeometry(value.renderGeometry, {
      maxPathLength: Math.min(FABRIC_DRAWING_MAX_STRING_LENGTH, maxPathLength),
      maxCoordinate: FABRIC_DRAWING_MAX_POINT_COORDINATE +
        FABRIC_DRAWING_MAX_BRUSH_SIZE
    })) {
      return 'render-geometry';
    }
  }
  return 'unknown';
}

function normalizeFabricDrawingPersistenceRequest(request, {
  includeKeyframes,
  maxBytes
}) {
  const cloned = clonePersistenceJson(request, maxBytes);
  if (!cloned.success) return null;
  const value = cloned.value;
  const expectedKeys = includeKeyframes
    ? FABRIC_DRAWING_HYDRATE_REQUEST_KEYS
    : FABRIC_DRAWING_EXPORT_REQUEST_KEYS;
  if (!hasExactPersistenceKeys(value, expectedKeys) ||
      !readFabricDrawingPersistenceFence(value) ||
      !validateFabricDrawingTimeline(value)) {
    return null;
  }
  if (!includeKeyframes) return value;
  if (!isDensePersistenceArray(value.keyframes) ||
      value.keyframes.length > FABRIC_DRAWING_MAX_KEYFRAMES) {
    return null;
  }

  const keyframeIds = new Set();
  const frames = new Set();
  let previousFrame = -1;
  let objectCount = 0;
  for (const keyframe of value.keyframes) {
    if (!hasExactPersistenceKeys(keyframe, FABRIC_DRAWING_HYDRATE_KEYFRAME_KEYS) ||
        !isBoundedPersistenceString(keyframe.id, 512) ||
        !Number.isSafeInteger(keyframe.frame) ||
        keyframe.frame < 0 ||
        keyframe.frame >= value.totalFrames ||
        keyframe.frame <= previousFrame ||
        !Number.isFinite(keyframe.sourceWidth) ||
        keyframe.sourceWidth <= 0 ||
        keyframe.sourceWidth > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
        !Number.isFinite(keyframe.sourceHeight) ||
        keyframe.sourceHeight <= 0 ||
        keyframe.sourceHeight > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
        !isSafePersistenceCount(keyframe.mutationSequence) ||
        !isDensePersistenceArray(keyframe.objects) ||
        keyframe.objects.length > FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME ||
        keyframeIds.has(keyframe.id) ||
        frames.has(keyframe.frame)) {
      return null;
    }
    const objectIds = new Set();
    for (const object of keyframe.objects) {
      if (!validateFabricDrawingRecord(object, maxBytes) || objectIds.has(object.id)) {
        return null;
      }
      objectIds.add(object.id);
    }
    objectCount += keyframe.objects.length;
    if (objectCount > FABRIC_DRAWING_MAX_OBJECTS_TOTAL) return null;
    keyframeIds.add(keyframe.id);
    frames.add(keyframe.frame);
    previousFrame = keyframe.frame;
  }
  return value;
}

function normalizeFabricDrawingPresentationRequest(request) {
  if (!isPlainPersistenceRecord(request) ||
      !hasExactPersistenceKeys(request, FABRIC_DRAWING_PRESENTATION_KEYS)) {
    return null;
  }
  const value = {};
  for (const key of FABRIC_DRAWING_PRESENTATION_KEYS) value[key] = request[key];
  if (!isSafePersistenceCount(value.hostGeneration) ||
      !isSafePersistenceCount(value.videoGeneration) ||
      !Number.isSafeInteger(value.presentationRevision) ||
      value.presentationRevision <= 0 ||
      !isBoundedPersistenceString(value.stableVideoIdentity) ||
      !isSafePersistenceCount(value.storeRevision) ||
      !isSafePersistenceCount(value.targetFrame) ||
      (value.sourceFrame !== null &&
        (!isSafePersistenceCount(value.sourceFrame) ||
          value.sourceFrame > value.targetFrame)) ||
      !Number.isFinite(value.sourceWidth) ||
      value.sourceWidth <= 0 ||
      value.sourceWidth > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
      !Number.isFinite(value.sourceHeight) ||
      value.sourceHeight <= 0 ||
      value.sourceHeight > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
      !hasExactPersistenceKeys(value.canvasRect, FABRIC_DRAWING_CANVAS_RECT_KEYS) ||
      !FABRIC_DRAWING_CANVAS_RECT_KEYS.every(key => Number.isFinite(value.canvasRect[key])) ||
      value.canvasRect.width <= 0 || value.canvasRect.height <= 0 ||
      value.canvasRect.width > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
      value.canvasRect.height > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
      !isSafePersistenceCount(value.viewportRevision) ||
      !hasExactPersistenceKeys(
        value.viewportTransform,
        FABRIC_DRAWING_VIEWPORT_TRANSFORM_KEYS
      ) ||
      !FABRIC_DRAWING_VIEWPORT_TRANSFORM_KEYS.every(
        key => Number.isFinite(value.viewportTransform[key]) &&
          Math.abs(value.viewportTransform[key]) <= FABRIC_DRAWING_MAX_TRANSFORM_MAGNITUDE
      ) ||
      value.viewportTransform.scale <= 0) {
    return null;
  }
  return {
    ...value,
    canvasRect: { ...value.canvasRect },
    viewportTransform: { ...value.viewportTransform }
  };
}

function normalizeFabricDrawingActiveFrameRequest(request) {
  if (!isPlainPersistenceRecord(request) ||
      !hasExactPersistenceKeys(request, FABRIC_DRAWING_ACTIVE_FRAME_KEYS)) {
    return null;
  }
  if (!isSafePersistenceCount(request.hostGeneration) ||
      !isSafePersistenceCount(request.videoGeneration) ||
      !isSafePersistenceCount(request.inputRevision) ||
      !isBoundedPersistenceString(request.sessionId) ||
      !Number.isSafeInteger(request.frameRevision) ||
      request.frameRevision <= 0 ||
      !isSafePersistenceCount(request.targetFrame)) {
    return null;
  }
  return { ...request };
}

function normalizeFabricDrawingPointerdownFrameRequest(request, {
  includeResolution = false
} = {}) {
  const isConfirmation = includeResolution &&
    hasExactPersistenceKeys(request, FABRIC_DRAWING_POINTERDOWN_FRAME_CONFIRM_KEYS);
  const isCancellation = includeResolution &&
    hasExactPersistenceKeys(request, FABRIC_DRAWING_POINTERDOWN_FRAME_CANCEL_KEYS) &&
    request.cancelled === true;
  const hasExpectedKeys = includeResolution
    ? isConfirmation || isCancellation
    : hasExactPersistenceKeys(request, FABRIC_DRAWING_POINTERDOWN_FRAME_REQUEST_KEYS);
  if (!isPlainPersistenceRecord(request) ||
      !hasExpectedKeys ||
      !Number.isSafeInteger(request.hostGeneration) || request.hostGeneration <= 0 ||
      !Number.isSafeInteger(request.videoGeneration) || request.videoGeneration <= 0 ||
      !Number.isSafeInteger(request.inputRevision) || request.inputRevision <= 0 ||
      !isBoundedPersistenceString(request.sessionId, 256) ||
      !isBoundedPersistenceString(request.pointerdownId, 256) ||
      !Number.isSafeInteger(request.pointerdownAt) || request.pointerdownAt < 0 ||
      (isConfirmation && !isSafePersistenceCount(request.targetFrame))) {
    return null;
  }
  return {
    hostGeneration: request.hostGeneration,
    videoGeneration: request.videoGeneration,
    inputRevision: request.inputRevision,
    sessionId: request.sessionId,
    pointerdownId: request.pointerdownId,
    pointerdownAt: request.pointerdownAt,
    ...(isConfirmation
      ? { targetFrame: request.targetFrame }
      : isCancellation
        ? { cancelled: true }
        : {})
  };
}

function readFabricDrawingPersistenceFence(value) {
  try {
    if (!value ||
        !isSafePersistenceCount(value.hostGeneration) ||
        !isSafePersistenceCount(value.videoGeneration) ||
        !isBoundedPersistenceString(value.persistenceSessionId) ||
        !isBoundedPersistenceString(value.stableVideoIdentity)) {
      return null;
    }
    return {
      hostGeneration: value.hostGeneration,
      videoGeneration: value.videoGeneration,
      persistenceSessionId: value.persistenceSessionId,
      stableVideoIdentity: value.stableVideoIdentity
    };
  } catch (_error) {
    return null;
  }
}

function createFabricDrawingResyncMessage(fence, reason) {
  return {
    type: 'resync-required',
    ...fence,
    reason
  };
}

function validateFabricDrawingRemoval(value) {
  return hasExactPersistenceKeys(value, FABRIC_DRAWING_REMOVAL_KEYS) &&
    isBoundedPersistenceString(value.id, 512) &&
    isSafePersistenceCount(value.index) &&
    value.index < FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME;
}

function validateFabricDrawingInsertion(value) {
  if (!hasExactPersistenceKeys(value, FABRIC_DRAWING_INSERTION_KEYS) ||
      !isSafePersistenceCount(value.index) ||
      value.index > FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME ||
      !validateFabricDrawingRecord(value.record, FABRIC_DRAWING_TRANSITION_MAX_BYTES) ||
      (value.baseTransform !== null &&
       !validateFabricDrawingTransform(value.baseTransform))) {
    return false;
  }
  return value.baseTransform === null ||
    fabricDrawingTransformsEqual(value.record.transform, value.baseTransform);
}

function validateFabricDrawingTransformChange(value) {
  return hasExactPersistenceKeys(value, FABRIC_DRAWING_TRANSFORM_CHANGE_KEYS) &&
    isBoundedPersistenceString(value.id, 512) &&
    validateFabricDrawingTransform(value.beforeTransform) &&
    validateFabricDrawingTransform(value.afterTransform) &&
    !fabricDrawingTransformsEqual(value.beforeTransform, value.afterTransform);
}

function deriveFabricDrawingTransitionKind(value) {
  if (value.removals.length > 0 && value.insertions.length > 0) return 'split-stroke';
  if (value.insertions.length > 0) return 'add-objects';
  if (value.removals.length > 0) {
    return value.kind === 'clear-keyframe' ? 'clear-keyframe' : 'delete-objects';
  }
  if (value.transforms.length > 0) return 'transform-objects';
  return null;
}

function isValidFabricDrawingTransitionEnvelope(value) {
  if (!hasExactPersistenceKeys(value, FABRIC_DRAWING_TRANSITION_KEYS) ||
      !hasExactPersistenceKeys(value.scene, FABRIC_DRAWING_SCENE_KEYS) ||
      !isBoundedPersistenceString(value.scene.sceneInstanceId, 512) ||
      !isSafePersistenceCount(value.scene.targetFrame) ||
      value.scene.targetFrame >= FABRIC_DRAWING_MAX_TOTAL_FRAMES ||
      !Number.isFinite(value.scene.sourceWidth) ||
      value.scene.sourceWidth <= 0 ||
      value.scene.sourceWidth > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
      !Number.isFinite(value.scene.sourceHeight) ||
      value.scene.sourceHeight <= 0 ||
      value.scene.sourceHeight > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
      !isSafePersistenceCount(value.mutationSequence) ||
      !FABRIC_DRAWING_TRANSITION_ORIGINS.has(value.origin) ||
      !FABRIC_DRAWING_TRANSITION_KINDS.has(value.kind) ||
      !isSafePersistenceCount(value.estimatedBytes) ||
      value.unsupportedReason !== null ||
      !isDensePersistenceArray(value.removals) ||
      !isDensePersistenceArray(value.insertions) ||
      !isDensePersistenceArray(value.transforms) ||
      value.removals.length > FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME ||
      value.insertions.length > FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME ||
      value.transforms.length > FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME ||
      !value.removals.every(validateFabricDrawingRemoval) ||
      !value.insertions.every(validateFabricDrawingInsertion) ||
      !value.transforms.every(validateFabricDrawingTransformChange)) {
    return false;
  }

  const removalIds = new Set(value.removals.map(item => item.id));
  const insertionIds = new Set(value.insertions.map(item => item.record.id));
  const transformIds = new Set(value.transforms.map(item => item.id));
  if (removalIds.size !== value.removals.length ||
      insertionIds.size !== value.insertions.length ||
      transformIds.size !== value.transforms.length ||
      value.removals.some((item, index) =>
        index > 0 && value.removals[index - 1].index >= item.index) ||
      value.insertions.some((item, index) =>
        index > 0 && value.insertions[index - 1].index > item.index)) {
    return false;
  }
  return deriveFabricDrawingTransitionKind(value) === value.kind;
}

function normalizeFabricDrawingPersistenceMessage(message) {
  if (!isPlainPersistenceRecord(message)) return null;
  if (message.type === 'resync-required') {
    const fence = readFabricDrawingPersistenceFence(message);
    if (!fence ||
        !hasExactPersistenceKeys(message, FABRIC_DRAWING_RESYNC_KEYS) ||
        !FABRIC_DRAWING_RESYNC_REASONS.has(message.reason)) {
      return null;
    }
    return createFabricDrawingResyncMessage(fence, message.reason);
  }
  if (message.type === 'layer-history') {
    const fence = readFabricDrawingPersistenceFence(message);
    if (!fence ||
        !hasExactPersistenceKeys(message, FABRIC_DRAWING_LAYER_HISTORY_KEYS) ||
        !isBoundedPersistenceString(message.commandId, 256) ||
        (message.direction !== 'undo' && message.direction !== 'redo')) {
      return null;
    }
    return {
      type: 'layer-history',
      ...fence,
      commandId: message.commandId,
      direction: message.direction
    };
  }
  if (message.type !== 'transition' ||
      !hasExactPersistenceKeys(message, ['type', 'transition'])) {
    return null;
  }

  const fence = readFabricDrawingPersistenceFence(message.transition);
  if (!fence) return null;
  let serialized;
  try {
    serialized = JSON.stringify(message.transition);
  } catch (_error) {
    return createFabricDrawingResyncMessage(
      fence,
      'transition-serialization-failed'
    );
  }
  if (typeof serialized !== 'string') {
    return createFabricDrawingResyncMessage(
      fence,
      'transition-serialization-failed'
    );
  }
  if (Buffer.byteLength(serialized, 'utf8') > FABRIC_DRAWING_TRANSITION_MAX_BYTES) {
    return createFabricDrawingResyncMessage(fence, 'transition-too-large');
  }

  let transition;
  try {
    transition = JSON.parse(serialized);
  } catch (_error) {
    return createFabricDrawingResyncMessage(
      fence,
      'transition-serialization-failed'
    );
  }
  if (isSafePersistenceCount(transition.estimatedBytes) &&
      transition.estimatedBytes > FABRIC_DRAWING_TRANSITION_MAX_BYTES) {
    return createFabricDrawingResyncMessage(fence, 'transition-too-large');
  }
  if (!isValidFabricDrawingTransitionEnvelope(transition)) {
    return createFabricDrawingResyncMessage(
      fence,
      'transition-invalid-at-boundary'
    );
  }
  return { type: 'transition', transition };
}

function normalizeFabricDrawingExportSnapshot(snapshot, request, maxBytes) {
  const cloned = clonePersistenceJson(snapshot, maxBytes);
  if (!cloned.success) {
    return {
      success: false,
      reason: cloned.reason === 'too-large'
        ? 'persistence-snapshot-too-large'
        : 'invalid-persistence-snapshot',
      failedCheck: cloned.reason === 'too-large'
        ? 'snapshot-clone-too-large'
        : 'snapshot-clone-failed'
    };
  }
  const value = cloned.value;
  // 요청-스냅샷 펜스 불일치는 데이터 손상이 아니라 신선도(회수 타이밍) 문제다.
  // 손상과 같은 사유로 뭉개면 저장 차단 래치까지 승격되므로(2026-08-27 실측),
  // 봉투 구조가 멀쩡한 경우에 한해 먼저 stale 사유로 분리한다.
  if (hasExactPersistenceKeys(value, FABRIC_DRAWING_SNAPSHOT_KEYS) &&
      readFabricDrawingPersistenceFence(value) &&
      validateFabricDrawingTimeline(value) &&
      FABRIC_DRAWING_EXPORT_REQUEST_KEYS.some(key => value[key] !== request[key])) {
    return {
      success: false,
      reason: 'stale-drawing-snapshot',
      failedCheck: 'export-request-fence-mismatch'
    };
  }
  if (!hasExactPersistenceKeys(value, FABRIC_DRAWING_SNAPSHOT_KEYS) ||
      !readFabricDrawingPersistenceFence(value) ||
      !validateFabricDrawingTimeline(value) ||
      !isDensePersistenceArray(value.scenes) ||
      value.scenes.length > FABRIC_DRAWING_MAX_KEYFRAMES) {
    return {
      success: false,
      reason: 'invalid-persistence-snapshot',
      failedCheck: 'snapshot-envelope'
    };
  }

  const sceneIds = new Set();
  const frames = new Set();
  let objectCount = 0;
  let previousFrame = -1;
  for (let sceneIndex = 0; sceneIndex < value.scenes.length; sceneIndex += 1) {
    const scene = value.scenes[sceneIndex];
    if (!hasExactPersistenceKeys(scene, FABRIC_DRAWING_SNAPSHOT_SCENE_KEYS) ||
        !isBoundedPersistenceString(scene.sceneInstanceId, 512) ||
        !Number.isSafeInteger(scene.targetFrame) ||
        scene.targetFrame < 0 ||
        scene.targetFrame >= value.totalFrames ||
        scene.targetFrame <= previousFrame ||
        !Number.isFinite(scene.sourceWidth) ||
        scene.sourceWidth <= 0 ||
        scene.sourceWidth > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
        !Number.isFinite(scene.sourceHeight) ||
        scene.sourceHeight <= 0 ||
        scene.sourceHeight > FABRIC_DRAWING_MAX_SOURCE_DIMENSION ||
        !isSafePersistenceCount(scene.mutationSequence) ||
        !isDensePersistenceArray(scene.objects) ||
        scene.objects.length > FABRIC_DRAWING_MAX_OBJECTS_PER_KEYFRAME ||
        sceneIds.has(scene.sceneInstanceId) ||
        frames.has(scene.targetFrame)) {
      return {
        success: false,
        reason: 'invalid-persistence-snapshot',
        failedCheck: `snapshot-scene@${sceneIndex}`
      };
    }
    const objectIds = new Set();
    for (let objectIndex = 0; objectIndex < scene.objects.length; objectIndex += 1) {
      const object = scene.objects[objectIndex];
      const duplicateId = objectIds.has(object?.id);
      if (!validateFabricDrawingRecord(object, maxBytes) || duplicateId) {
        // 어느 하위 검사에서 걸렸는지까지 남긴다 — 'snapshot-record' 하나로는
        // 10종 검사와 id 중복을 구분할 수 없어 원인 추적이 불가능하다.
        const detail = duplicateId
          ? 'duplicate-id'
          : describeFabricDrawingRecordFailure(object, maxBytes);
        return {
          success: false,
          reason: 'invalid-persistence-snapshot',
          failedCheck: `snapshot-record:${detail}@${sceneIndex}.${objectIndex}`
        };
      }
      objectIds.add(object.id);
    }
    objectCount += scene.objects.length;
    if (objectCount > FABRIC_DRAWING_MAX_OBJECTS_TOTAL) {
      return {
        success: false,
        reason: 'persistence-snapshot-too-large',
        failedCheck: 'snapshot-object-total'
      };
    }
    sceneIds.add(scene.sceneInstanceId);
    frames.add(scene.targetFrame);
    previousFrame = scene.targetFrame;
  }
  return { success: true, snapshot: value };
}

class MPVOverlayHost {
  constructor(options = {}) {
    this.BrowserWindow = options.BrowserWindow || getDefaultBrowserWindow();
    this.getMainWindow = options.getMainWindow || getDefaultMainWindow;
    this.logger = options.logger || log;
    this.window = null;
    this.contentLoaded = false;
    this.contentLoadGeneration = 0;
    this.lastBounds = null;
    this.parentWindow = null;
    this.parentRepositionHandler = null;
    this.parentHideHandler = null;
    this.parentShowHandler = null;
    this.parentClosedHandler = null;
    this.repositionPending = false;
    this.requestedVisible = true;
    this.hostGeneration = 0;
    this.fabricReadyGeneration = 0;
    this.fabricAttemptGeneration = 0;
    this.fabricPreparationPromise = null;
    this.fabricPreparationResult = null;
    this.fabricLastError = null;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    const retryBaseMs = Number(options.fabricRetryBaseMs);
    const retryMaxMs = Number(options.fabricRetryMaxMs);
    this.fabricRetryBaseMs = Number.isFinite(retryBaseMs) && retryBaseMs >= 0
      ? retryBaseMs
      : 250;
    this.fabricRetryMaxMs = Number.isFinite(retryMaxMs) && retryMaxMs >= this.fabricRetryBaseMs
      ? retryMaxMs
      : Math.max(2000, this.fabricRetryBaseMs);
    this.fabricFailureCount = 0;
    this.fabricRetryAfter = 0;
    this.fabricBundlePath = options.fabricBundlePath || DEFAULT_FABRIC_BUNDLE_PATH;
    this.readFile = options.readFile || fs.promises.readFile.bind(fs.promises);
    const snapshotMaxBytes = Number(options.fabricDrawingSnapshotMaxBytes);
    this.fabricDrawingSnapshotMaxBytes =
      Number.isSafeInteger(snapshotMaxBytes) && snapshotMaxBytes > 0
        ? Math.min(snapshotMaxBytes, FABRIC_DRAWING_SNAPSHOT_MAX_BYTES)
        : FABRIC_DRAWING_SNAPSHOT_MAX_BYTES;
    this.currentVideoGeneration = -1;
    this.currentInputRevision = -1;
    this.currentDrawingFrameRevision = -1;
    this.currentPresentationRevision = -1;
    this.currentStableVideoIdentity = null;
    this.remoteCursorRevision = -1;
    this.collaborationRevision = -1;
    this.collaborationActionSequence = 0;
    this.activeCollaborationDragPointerId = null;
    this.desiredInputEnabled = false;
    this.activeSessionId = null;
    this.currentToolRevision = -1;
    this.currentBrushRevision = -1;
    this.currentLayerViewRevision = -1;
    this.keyboardRelayCount = 0;
    this.lastKeyboardRelayCode = null;
    this.drawModeShortcutDescriptor = null;
    this.completedActionIds = new Map();
    this.inFlightDrawingActions = new Map();
    this.maxProcessedActionIds = 2048;
    this.drawingActionQueue = Promise.resolve();
    this.suppressedOverlayHistoryKeys = new Set();
    this.drawingV3ShadowEnabled = false;
    this.drawingV3ShadowConfigured = false;
    this.drawingV3ShadowLocked = false;
  }

  configureDrawingV3Shadow(enabled) {
    if (typeof enabled !== 'boolean') {
      return { success: false, enabled: this.drawingV3ShadowEnabled, reason: 'invalid-value' };
    }
    if (this.drawingV3ShadowConfigured || this.drawingV3ShadowLocked) {
      return { success: false, enabled: this.drawingV3ShadowEnabled, reason: 'configuration-locked' };
    }
    this.drawingV3ShadowEnabled = enabled;
    this.drawingV3ShadowConfigured = true;
    return { success: true, enabled };
  }

  getDrawingCapability() {
    const passiveReady = !!this.window && !this.window.isDestroyed?.() && this.contentLoaded;
    return {
      hostGeneration: this.hostGeneration,
      passiveReady,
      fabricReady: passiveReady && this.fabricReadyGeneration === this.hostGeneration
    };
  }

  isCurrentOverlaySender(event) {
    const hostWindow = this.window;
    return !!hostWindow &&
      !hostWindow.isDestroyed?.() &&
      !hostWindow.webContents?.isDestroyed?.() &&
      event?.sender === hostWindow.webContents;
  }

  _collaborationActionRelayIsReady({ allowHidden = false } = {}) {
    const hostWindow = this.window;
    if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded ||
        (!allowHidden && this.requestedVisible === false) ||
        this.desiredInputEnabled !== true ||
        this.fabricReadyGeneration !== this.hostGeneration ||
        !Number.isSafeInteger(this.currentVideoGeneration) || this.currentVideoGeneration < 0 ||
        !Number.isSafeInteger(this.currentInputRevision) || this.currentInputRevision < 0 ||
        typeof this.activeSessionId !== 'string' || this.activeSessionId.length === 0) {
      return false;
    }
    if (!allowHidden && typeof hostWindow.isVisible === 'function' && hostWindow.isVisible() !== true) {
      return false;
    }
    const mainWindow = this.getMainWindow();
    const mainWebContents = mainWindow?.webContents;
    return !!mainWindow && !mainWindow.isDestroyed?.() &&
      !!mainWebContents && !mainWebContents.isDestroyed?.() &&
      typeof mainWebContents.send === 'function';
  }

  _sendCollaborationActionToMain(action, { allowHidden = false } = {}) {
    if (!this._collaborationActionRelayIsReady({ allowHidden }) ||
        this.collaborationActionSequence >= Number.MAX_SAFE_INTEGER) {
      return { success: false, accepted: false, error: 'mpv collaboration action session is not active' };
    }
    const mainWindow = this.getMainWindow();
    const sequence = this.collaborationActionSequence + 1;
    const message = {
      action: action.action,
      payload: action.payload === null ? null : { ...action.payload },
      hostGeneration: this.hostGeneration,
      videoGeneration: this.currentVideoGeneration,
      inputRevision: this.currentInputRevision,
      activeSessionId: this.activeSessionId,
      sequence
    };
    try {
      mainWindow.webContents.send(MPV_OVERLAY_COLLABORATION_ACTION_CHANNEL, message);
      this.collaborationActionSequence = sequence;
      return { success: true, accepted: true, sequence };
    } catch (error) {
      this.logger.debug('mpv collaboration action forwarding failed', { error: error.message });
      return { success: false, accepted: false, error: 'mpv collaboration action forwarding failed' };
    }
  }

  forwardCollaborationAction(event, value) {
    if (!this.isCurrentOverlaySender(event)) {
      return { success: false, accepted: false, error: 'mpv collaboration action sender is not allowed' };
    }
    const action = normalizeMpvOverlayCollaborationAction(value);
    if (!action) {
      return { success: false, accepted: false, error: 'invalid mpv collaboration action' };
    }
    if (!this._collaborationActionRelayIsReady()) {
      return { success: false, accepted: false, error: 'mpv collaboration action session is not active' };
    }
    const pointerId = action.payload?.pointerId;
    if (action.action === 'sync.drag-start') {
      if (this.activeCollaborationDragPointerId !== null) {
        return { success: false, accepted: false, error: 'mpv collaboration drag is already active' };
      }
    } else if (MPV_OVERLAY_COLLABORATION_DRAG_ACTIONS.has(action.action) ||
        action.action === 'sync.drag-cancel') {
      if (this.activeCollaborationDragPointerId !== pointerId) {
        return { success: false, accepted: false, error: 'stale mpv collaboration drag action' };
      }
    }
    const result = this._sendCollaborationActionToMain(action);
    if (!result.accepted) return result;
    if (action.action === 'sync.drag-start') {
      this.activeCollaborationDragPointerId = pointerId;
    } else if (action.action === 'sync.drag-end' || action.action === 'sync.drag-cancel') {
      this.activeCollaborationDragPointerId = null;
    }
    return result;
  }

  forwardDrawingPointerdownFrameRequest(event, value) {
    if (!this.isCurrentOverlaySender(event)) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-pointerdown-frame-sender-not-allowed'
      };
    }
    const request = normalizeFabricDrawingPointerdownFrameRequest(value);
    if (!request) {
      return {
        success: false,
        accepted: false,
        reason: 'invalid-drawing-pointerdown-frame-request'
      };
    }
    const hostWindow = this.window;
    const mainWindow = this.getMainWindow();
    const mainWebContents = mainWindow?.webContents;
    if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded ||
        this.fabricReadyGeneration !== this.hostGeneration ||
        !this._drawingTokensMatch(request) ||
        !mainWindow || mainWindow.isDestroyed?.() ||
        !mainWebContents || mainWebContents.isDestroyed?.() ||
        typeof mainWebContents.send !== 'function') {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-pointerdown-frame-session-not-active'
      };
    }
    try {
      mainWebContents.send(MPV_OVERLAY_DRAWING_POINTERDOWN_FRAME_CHANNEL, request);
      return { success: true, accepted: true };
    } catch (_error) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-pointerdown-frame-forward-failed'
      };
    }
  }

  _resetCollaborationActionRelay({ cancelCurrent = true, resetSequence = true } = {}) {
    const pointerId = this.activeCollaborationDragPointerId;
    if (cancelCurrent && pointerId !== null) {
      this._sendCollaborationActionToMain({
        action: 'sync.drag-cancel',
        payload: { pointerId }
      }, { allowHidden: true });
    }
    this.activeCollaborationDragPointerId = null;
    if (resetSequence) this.collaborationActionSequence = 0;
    try {
      this.window?.webContents?.send?.(MPV_OVERLAY_COLLABORATION_DRAG_RESET_CHANNEL);
    } catch (_error) {
      // The overlay may already be closing; the renderer fence still rejects stale drag input.
    }
  }

  async setDrawingInput() {
    const request = arguments[0] || {};
    const hostWindow = this.window;
    if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded) {
      // 호스트 창이 이미 없으면 차단할 드로잉 입력 표면도 없다.
      // disable 요청을 실패로 돌려주면 영상 전환의 입력 펜스가 죽은 호스트에
      // 막혀 교착되므로, fabric 미준비 disable와 같은 원리로 no-op 성공 처리한다.
      if (request.enabled === false) {
        return { success: true, accepted: true, enabled: false, fabricReady: false, hostUnavailable: true };
      }
      return { success: false, error: 'mpv overlay host is not ready' };
    }

    const hostGeneration = Number(request.hostGeneration);
    const videoGeneration = Number(request.videoGeneration);
    const inputRevision = Number(request.inputRevision);
    if (hostGeneration !== this.hostGeneration ||
        !Number.isInteger(videoGeneration) || videoGeneration < 0 ||
        !Number.isInteger(inputRevision) || inputRevision <= this.currentInputRevision ||
        typeof request.enabled !== 'boolean') {
      return { success: false, accepted: false, error: 'stale or invalid drawing input request' };
    }
    if (request.enabled && videoGeneration !== this.currentVideoGeneration) {
      return { success: false, accepted: false, error: 'stale drawing video generation' };
    }
    if (!request.enabled && videoGeneration < this.currentVideoGeneration) {
      return { success: false, accepted: false, error: 'stale drawing video generation' };
    }
    this._resetCollaborationActionRelay();
    if (!request.enabled) {
      this._setNativeDrawingInput(hostWindow, false);
    }

    const videoGenerationChanged = videoGeneration !== this.currentVideoGeneration;
    this.currentVideoGeneration = videoGeneration;
    this.currentInputRevision = inputRevision;
    this.currentDrawingFrameRevision = -1;
    if (videoGenerationChanged) {
      this.currentPresentationRevision = -1;
      this.currentStableVideoIdentity = null;
    }
    this.desiredInputEnabled = request.enabled;
    this.activeSessionId = null;
    this.currentToolRevision = -1;
    this.currentBrushRevision = -1;
    this.currentLayerViewRevision = -1;
    if (!request.enabled) {
      this.suppressedOverlayHistoryKeys.clear();
    }

    // 준비된 Fabric surface가 없다면 disable은 native click-through만 보장하면 된다.
    // 영구적인 bundle 오류 상태에서 B-off가 또 read/injection을 시작하지 않게 한다.
    if (!request.enabled && this.fabricReadyGeneration !== this.hostGeneration) {
      // 2767-2769행에서 이미 focusable:false로 전환했으므로 sibling mpv 창이
      // 위로 올라올 수 있다. Fabric 준비 여부와 무관하게 창 순서를 복원한다.
      hostWindow.moveTop?.();
      hostWindow.webContents?.invalidate?.();
      return { success: true, accepted: true, enabled: false, fabricReady: false };
    }

    const prepared = await this._ensureFabricRuntime();
    if (!prepared.success) {
      if (!request.enabled) {
        // (g)와 동일 — focusable:false 전환은 이미 끝났으므로 준비 실패로 되돌아가도
        // 창 순서는 반드시 복원한다. (j)의 restack 완전일치 계약이 이 경로를 포함한다.
        hostWindow.moveTop?.();
        hostWindow.webContents?.invalidate?.();
        return { success: true, accepted: true, enabled: false, fabricReady: false };
      }
      return { success: false, accepted: false, enabled: false, error: prepared.error };
    }
    if (!this._inputRequestStillDesired(hostWindow, request)) {
      return { success: false, accepted: false, enabled: false, error: 'stale drawing input request' };
    }

    let runtimeResult;
    try {
      runtimeResult = await this._executeFabricMethod('setDrawingInput', request);
    } catch (error) {
      this._setNativeDrawingInput(hostWindow, false);
      this.fabricLastError = error.message;
      return { success: false, accepted: false, enabled: false, error: error.message };
    }

    const stillCurrent = this._inputRequestStillDesired(hostWindow, request);
    if (!request.enabled && stillCurrent) {
      // focusable:false 전환은 Windows에서 sibling mpv 창을 위로 올릴 수 있다.
      // runtime이 passive 장면을 거부해도 focusable 전환은 이미 일어났으므로,
      // 창 순서 복원은 승인 여부와 무관하게 disable 요청마다 대칭으로 수행한다.
      hostWindow.moveTop?.();
      hostWindow.webContents?.invalidate?.();
    }
    if (request.enabled && runtimeResult?.accepted === true && stillCurrent) {
      this.activeSessionId = request.session?.sessionId || null;
      this.currentToolRevision = 0;
      this.currentBrushRevision = 0;
      this.currentLayerViewRevision = 0;
      this._setNativeDrawingInput(hostWindow, true);
    } else if (request.enabled && runtimeResult?.accepted === true && !stillCurrent) {
      await this._compensateStaleDrawingEnable(hostWindow, hostGeneration);
    }

    const response = {
      success: runtimeResult?.accepted === true && (!request.enabled || stillCurrent),
      accepted: runtimeResult?.accepted === true,
      enabled: request.enabled && runtimeResult?.accepted === true && stillCurrent,
      restored: runtimeResult?.restored === true
    };
    if (isFabricDrawingTool(runtimeResult?.tool)) {
      response.tool = runtimeResult.tool;
    }
    return response;
  }

  async updateDrawingTool(request = {}) {
    const hostWindow = this.window;
    const toolRevision = Number(request.toolRevision);
    const currentTokensMatch = request.hostGeneration === this.hostGeneration &&
      request.videoGeneration === this.currentVideoGeneration &&
      request.inputRevision === this.currentInputRevision &&
      request.sessionId === this.activeSessionId;
    const validTool = isFabricDrawingTool(request.tool) || request.tool === 'V';
    if (!this.desiredInputEnabled ||
        this.fabricReadyGeneration !== this.hostGeneration ||
        !currentTokensMatch ||
        !Number.isInteger(toolRevision) || toolRevision <= this.currentToolRevision ||
        !validTool) {
      return { success: false, accepted: false, error: 'stale or invalid drawing tool request' };
    }

    try {
      const result = await this._executeFabricMethod('updateDrawingTool', request);
      if (result?.accepted !== true) {
        return { success: false, accepted: false, error: result?.reason || 'drawing tool update rejected' };
      }
      if (!this._drawingTokensMatch(request) || toolRevision <= this.currentToolRevision) {
        return { success: false, accepted: false, error: 'stale drawing tool response' };
      }
      this.currentToolRevision = toolRevision;
      // V는 overlay에서 메인 renderer로 전달되며 처리 중 main 창이 잠시 포커스를
      // 소유한다. 도구 변경이 확정된 뒤 overlay를 다시 활성화해야 다음 툴바
      // 클릭이 Windows의 창 활성화 클릭으로 소모되지 않는다.
      if (this.window === hostWindow && !hostWindow?.isDestroyed?.()) {
        hostWindow.focus?.();
      }
      return { success: true, accepted: true, tool: normalizeFabricDrawingTool(result.tool) };
    } catch (error) {
      return { success: false, accepted: false, error: error.message };
    }
  }

  async updateDrawingBrush(request = {}) {
    const brushRevision = Number(request.brushRevision);
    const currentTokensMatch = request.hostGeneration === this.hostGeneration &&
      request.videoGeneration === this.currentVideoGeneration &&
      request.inputRevision === this.currentInputRevision &&
      request.sessionId === this.activeSessionId;
    // 절대 크기와 상대 증감 둘 중 정확히 하나여야 한다. 상대 증감은 오버레이의
    // 현재 굵기를 기준으로 적용되므로 컨트롤러가 낡은 값을 들고 있어도 안전하다.
    // Number.isInteger 는 자르기 **전** 값에 걸어야 한다. 먼저 Math.trunc 하면
    // 1.5 같은 값이 정수로 둔갑해 통과한다.
    const hasStep = request.step !== undefined;
    const step = Number(request.step);
    const size = Number(request.size);
    const validMagnitude = hasStep
      ? (request.size === undefined &&
         Number.isInteger(step) && step !== 0 &&
         Math.abs(step) <= FABRIC_DRAWING_MAX_BRUSH_STEP)
      : (Number.isInteger(size) && size >= 1 && size <= FABRIC_DRAWING_MAX_BRUSH_SIZE);
    if (!this.desiredInputEnabled ||
        this.fabricReadyGeneration !== this.hostGeneration ||
        !currentTokensMatch ||
        !Number.isInteger(brushRevision) || brushRevision <= this.currentBrushRevision ||
        !validMagnitude) {
      return { success: false, accepted: false, error: 'stale or invalid drawing brush request' };
    }

    try {
      const result = await this._executeFabricMethod('updateDrawingBrush', request);
      if (result?.accepted !== true) {
        return { success: false, accepted: false, error: result?.reason || 'drawing brush update rejected' };
      }
      if (!this._drawingTokensMatch(request) || brushRevision <= this.currentBrushRevision) {
        return { success: false, accepted: false, error: 'stale drawing brush response' };
      }
      this.currentBrushRevision = brushRevision;
      // updateDrawingTool 과 달리 오버레이에 포커스를 주지 않는다. 크기 변경은
      // [ / ] 연타로 오는데 매번 포커스를 옮기면 화면이 튄다.
      return { success: true, accepted: true, size: Math.trunc(Number(result.size)) };
    } catch (error) {
      return { success: false, accepted: false, error: error.message };
    }
  }

  // 레이어 표시·잠금은 **뷰 상태**다. 문서를 바꾸지 않으므로 프레임 왕복이나
  // 재동기가 필요 없고, 렌더러가 계산한 id 집합을 그대로 전달하기만 한다.
  // 델타가 아니라 전체 집합이라 리비전으로 늦게 온 것만 버리면 된다.
  async updateDrawingLayerView(request = {}) {
    const layerViewRevision = Number(request.layerViewRevision);
    // passive 투영에서도 받는다. 저장된 레이어 모델이 숨겨 둔 획은 보기만 하는
    // 동안에도 숨겨져 있어야 한다. 그때는 세션 id 가 없으므로 영상 정체로 맞춘다.
    // 문서를 나르지 않는 메시지라 실패해도 그림이 아니라 표시만 어긋난다.
    const tokensMatch = () => request.hostGeneration === this.hostGeneration &&
      request.videoGeneration === this.currentVideoGeneration &&
      request.inputRevision === this.currentInputRevision &&
      (this.desiredInputEnabled
        ? request.sessionId === this.activeSessionId
        : this.currentStableVideoIdentity !== null &&
          request.stableVideoIdentity === this.currentStableVideoIdentity);
    const currentTokensMatch = tokensMatch();
    const validIds = value =>
      Array.isArray(value) &&
      value.length <= FABRIC_DRAWING_MAX_OBJECTS_TOTAL &&
      value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 512);
    if (this.fabricReadyGeneration !== this.hostGeneration ||
        !currentTokensMatch ||
        !Number.isInteger(layerViewRevision) ||
        layerViewRevision <= this.currentLayerViewRevision ||
        !validIds(request.hiddenObjectIds) ||
        !validIds(request.lockedObjectIds) ||
        typeof request.activeLayerDrawable !== 'boolean' ||
        (request.layerHistoryBusy !== undefined &&
          typeof request.layerHistoryBusy !== 'boolean') ||
        // 겹침 순서 랭크도 같은 메시지로 올 수 있다. **선택 항목**이다 — 없으면
        // 오버레이가 들고 있던 랭크를 그대로 쓴다. 오면 레이어 조작과 같은
        // 형식으로 검사한다.
        (request.objectRanks !== undefined && this._normalizeLayerObjectsPayload({
          action: 'layer-objects-reorder',
          objectRanks: request.objectRanks,
          defaultRank: request.defaultRank,
          activeLayerRank: request.activeLayerRank
        }) === null)) {
      return { success: false, accepted: false, error: 'stale or invalid layer view request' };
    }

    try {
      const result = await this._executeFabricMethod('updateDrawingLayerView', {
        ...request,
        // **activeLayerRank 도 함께 넘긴다.** 정규화 결과가 request 를 덮으므로
        // 여기서 빠지면 새 획이 늘 기준 레이어 자리에 꽂힌다.
        ...(request.objectRanks === undefined ? {} : this._normalizeLayerObjectsPayload({
          action: 'layer-objects-reorder',
          objectRanks: request.objectRanks,
          defaultRank: request.defaultRank,
          activeLayerRank: request.activeLayerRank
        }))
      });
      if (result?.accepted !== true) {
        return { success: false, accepted: false, error: result?.reason || 'layer view update rejected' };
      }
      // **응답 검사도 같은 술어로 한다.** _drawingTokensMatch 는 활성 세션을
      // 요구하므로, passive 갱신은 적용해 놓고 거절로 보고돼 리비전이 전진하지
      // 않는다. 그러면 늦게 도착한 옛 갱신이 다시 통과해 지금 집합을 덮는다.
      if (!tokensMatch() || layerViewRevision <= this.currentLayerViewRevision) {
        return { success: false, accepted: false, error: 'stale layer view response' };
      }
      this.currentLayerViewRevision = layerViewRevision;
      return { success: true, accepted: true };
    } catch (error) {
      return { success: false, accepted: false, error: error.message };
    }
  }

  async updateDrawingFrame(request = {}) {
    const normalizedRequest = normalizeFabricDrawingActiveFrameRequest(request);
    const hostWindow = this.window;
    if (!normalizedRequest ||
        !hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded ||
        this.fabricReadyGeneration !== this.hostGeneration ||
        !this._drawingTokensMatch(normalizedRequest) ||
        normalizedRequest.frameRevision <= this.currentDrawingFrameRevision) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-or-invalid-active-frame'
      };
    }

    this.currentDrawingFrameRevision = normalizedRequest.frameRevision;
    try {
      const result = await this._executeFabricMethod(
        'updateDrawingFrame',
        normalizedRequest
      );
      if (!this._drawingFrameRequestIsCurrent(hostWindow, normalizedRequest)) {
        return {
          success: false,
          accepted: false,
          reason: 'stale-active-frame-response'
        };
      }
      if (result?.accepted !== true) {
        return {
          success: false,
          accepted: false,
          reason: result?.reason || 'active-frame-update-rejected'
        };
      }
      if (result.repainted === true) hostWindow.webContents?.invalidate?.();
      return {
        success: true,
        accepted: true,
        frameRevision: normalizedRequest.frameRevision,
        targetFrame: normalizedRequest.targetFrame,
        sourceFrame: Number.isSafeInteger(result.sourceFrame) ? result.sourceFrame : null
      };
    } catch (error) {
      return {
        success: false,
        accepted: false,
        reason: 'active-frame-update-failed',
        error: error.message
      };
    }
  }

  async confirmDrawingPointerdownFrame(request = {}) {
    const normalizedRequest = normalizeFabricDrawingPointerdownFrameRequest(request, {
      includeResolution: true
    });
    const hostWindow = this.window;
    if (!normalizedRequest ||
        !hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded ||
        this.fabricReadyGeneration !== this.hostGeneration ||
        !this._drawingTokensMatch(normalizedRequest)) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-or-invalid-drawing-pointerdown-frame'
      };
    }

    const isCancellation = normalizedRequest.cancelled === true;
    let result;
    try {
      result = await this._executeFabricMethod(
        'confirmDrawingPointerdownFrame',
        normalizedRequest
      );
    } catch (_error) {
      if (!this._drawingPointerdownFrameRequestIsCurrent(hostWindow, normalizedRequest)) {
        return {
          success: false,
          accepted: false,
          reason: 'stale-drawing-pointerdown-frame-response'
        };
      }
      return {
        success: false,
        accepted: false,
        reason: isCancellation
          ? 'drawing-pointerdown-frame-cancel-failed'
          : 'drawing-pointerdown-frame-confirm-failed'
      };
    }

    if (!this._drawingPointerdownFrameRequestIsCurrent(hostWindow, normalizedRequest)) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-drawing-pointerdown-frame-response'
      };
    }
    if (isCancellation) {
      const exactCancellationResult =
        hasExactPersistenceKeys(result, FABRIC_DRAWING_POINTERDOWN_FRAME_CANCEL_RESULT_KEYS) &&
        result.accepted === true && result.cancelled === true &&
        FABRIC_DRAWING_POINTERDOWN_FRAME_REQUEST_KEYS.every(
          key => result[key] === normalizedRequest[key]
        );
      if (!exactCancellationResult) {
        return {
          success: false,
          accepted: false,
          reason: 'drawing-pointerdown-frame-cancel-rejected'
        };
      }
      return {
        success: true,
        accepted: true,
        cancelled: true,
        hostGeneration: normalizedRequest.hostGeneration,
        videoGeneration: normalizedRequest.videoGeneration,
        inputRevision: normalizedRequest.inputRevision,
        sessionId: normalizedRequest.sessionId,
        pointerdownId: normalizedRequest.pointerdownId,
        pointerdownAt: normalizedRequest.pointerdownAt
      };
    }
    if (result?.accepted !== true ||
        result.pointerdownId !== normalizedRequest.pointerdownId ||
        result.targetFrame !== normalizedRequest.targetFrame) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-pointerdown-frame-confirm-rejected'
      };
    }
    return {
      success: true,
      accepted: true,
      pointerdownId: normalizedRequest.pointerdownId,
      targetFrame: normalizedRequest.targetFrame
    };
  }

  // 레이어 조작의 페이로드를 검사해 **새 객체로** 돌려준다. 원본을 그대로 넘기면
  // 프로토타입 오염 키가 런타임의 조회에 섞일 수 있다.
  _normalizeLayerObjectsPayload(request) {
    if (request.action === 'layer-objects-remove') {
      const ids = request.objectIds;
      if (!Array.isArray(ids) || ids.length === 0 ||
          ids.length > FABRIC_DRAWING_MAX_OBJECTS_TOTAL ||
          !ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 512)) {
        return null;
      }
      return { objectIds: [...ids] };
    }
    if (request.action === 'layer-objects-reorder' && request.silent !== undefined &&
        typeof request.silent !== 'boolean') {
      return null;
    }
    if (request.action === 'layer-objects-reorder') {
      // 랭크는 **쌍 배열**로 온다. 객체로 받으면 페이로드를 소스에 끼울 때
      // 객체 리터럴이 되어 `"__proto__"` id 의 랭크가 사라진다.
      const ranks = request.objectRanks;
      if (!Array.isArray(ranks)) return null;
      if (ranks.length > FABRIC_DRAWING_MAX_OBJECTS_TOTAL) return null;
      const normalized = [];
      for (const pair of ranks) {
        if (!Array.isArray(pair) || pair.length !== 2) return null;
        const [id, rank] = pair;
        if (typeof id !== 'string' || id.length === 0 || id.length > 512) return null;
        if (!Number.isInteger(rank) || rank < 0 || rank > MAX_LAYER_OBJECT_RANK) return null;
        normalized.push([id, rank]);
      }
      if (!Number.isInteger(request.defaultRank) ||
          request.defaultRank < 0 || request.defaultRank > MAX_LAYER_OBJECT_RANK) {
        return null;
      }
      // 새로 그리는 획이 들어갈 자리(활성 레이어의 랭크). 없으면 기본 랭크를 쓴다.
      if (request.activeLayerRank !== undefined &&
          (!Number.isInteger(request.activeLayerRank) ||
           request.activeLayerRank < 0 ||
           request.activeLayerRank > MAX_LAYER_OBJECT_RANK)) {
        return null;
      }
      return {
        objectRanks: normalized,
        defaultRank: request.defaultRank,
        // 정규화(silent)는 히스토리를 남기지 않는다.
        ...(request.silent === true ? { silent: true } : {}),
        ...(request.activeLayerRank === undefined
          ? {}
          : { activeLayerRank: request.activeLayerRank })
      };
    }
    return {};
  }

  async applyDrawingAction(request = {}) {
    const validAction = HOST_DRAWING_ACTIONS.has(request.action);
    const layerObjectsPayload = validAction
      ? this._normalizeLayerObjectsPayload(request)
      : null;
    if (!this._drawingTokensMatch(request) ||
        !validAction ||
        layerObjectsPayload === null ||
        typeof request.actionId !== 'string' ||
        request.actionId.length === 0 || request.actionId.length > 256 ||
        (request.targetFrame !== undefined && !isSafePersistenceCount(request.targetFrame))) {
      return { success: false, applied: false, error: 'stale or invalid drawing action request' };
    }
    if (this.completedActionIds.has(request.actionId)) {
      // 중복 액션은 아무것도 바꾸지 않으므로 keyframeSetChanged 는 항상 false 다.
      // 성공 응답의 형태를 _performDrawingAction 과 같게 유지한다.
      return {
        success: true, applied: false, duplicate: true, deletedCount: 0, keyframeSetChanged: false
      };
    }
    const inFlight = this.inFlightDrawingActions.get(request.actionId);
    if (inFlight) return inFlight;

    const queuedRequest = {
      hostGeneration: request.hostGeneration,
      videoGeneration: request.videoGeneration,
      inputRevision: request.inputRevision,
      sessionId: request.sessionId,
      actionId: request.actionId,
      action: request.action,
      ...layerObjectsPayload,
      ...(request.targetFrame === undefined ? {} : { targetFrame: request.targetFrame })
    };
    const executionContext = {
      hostWindow: this.window,
      hostGeneration: this.hostGeneration,
      fabricReadyGeneration: this.fabricReadyGeneration
    };
    const actionId = queuedRequest.actionId;
    const operation = this.drawingActionQueue.then(
      () => this._performDrawingAction(queuedRequest, executionContext)
    );
    const trackedOperation = operation.then(result => {
      if (result.success) this._rememberDrawingAction(actionId);
      return result;
    }).finally(() => {
      if (this.inFlightDrawingActions.get(actionId) === trackedOperation) {
        this.inFlightDrawingActions.delete(actionId);
      }
    });
    this.inFlightDrawingActions.set(actionId, trackedOperation);
    this.drawingActionQueue = trackedOperation.catch(() => undefined);
    try {
      return await trackedOperation;
    } catch (error) {
      return { success: false, applied: false, error: error.message };
    }
  }

  _drawingActionExecutionIsCurrent(request, executionContext) {
    const hostWindow = executionContext?.hostWindow;
    return !!hostWindow &&
      this.window === hostWindow &&
      !hostWindow.isDestroyed?.() &&
      this.contentLoaded === true &&
      this.hostGeneration === executionContext.hostGeneration &&
      this.fabricReadyGeneration === executionContext.fabricReadyGeneration &&
      this.fabricReadyGeneration === this.hostGeneration &&
      this._drawingTokensMatch(request);
  }

  async _performDrawingAction(request, executionContext) {
    if (!this._drawingActionExecutionIsCurrent(request, executionContext)) {
      return { success: false, applied: false, error: 'stale drawing action request' };
    }
    try {
      const result = await this._executeFabricMethod('applyDrawingAction', request);
      if (!this._drawingActionExecutionIsCurrent(request, executionContext)) {
        return { success: false, applied: false, error: 'stale drawing action response' };
      }
      // 투명 오버레이는 다시 그린 내용을 다음 입력까지 늦게 합성할 수 있다. 실행취소·
      // 삭제로 화면이 바뀌었으면 프레임 변경 경로와 같이 합성을 강제한다. 이게 없으면
      // 되돌린 획이 잠깐 남아 보인다.
      if (result?.repainted === true) {
        executionContext.hostWindow.webContents?.invalidate?.();
      }
      return {
        success: result?.applied === true || result?.duplicate === true,
        applied: result?.applied === true,
        duplicate: result?.duplicate === true,
        ...(typeof result?.reason === 'string' ? { reason: result.reason } : {}),
        // 레이어 조작만 짝 id 를 돌려준다. 렌더러가 레이어 **모델**의 before/after
        // 를 이 id 로 찾아 함께 되돌린다 — 오버레이는 씬만 되돌릴 수 있다.
        ...(typeof result?.commandId === 'string' && result.commandId.length <= 256
          ? { commandId: result.commandId }
          : {}),
        ...(result?.historyDirection === 'undo' || result?.historyDirection === 'redo'
          ? { historyDirection: result.historyDirection }
          : {}),
        deletedCount: Math.max(0, Math.trunc(finiteDiagnosticNumber(result?.deletedCount))),
        keyframeSetChanged: result?.keyframeSetChanged === true,
        // 레이어 조작은 씬을 갈아 끼우고 전이를 내보내지 않는다. 컨트롤러가
        // 이 신호를 보고 수화 문서를 다시 받아 온다. 응답을 가볍게 유지하려고
        // 필요할 때만 싣는다(reason·commandId 와 같은 규칙).
        ...(result?.persistenceResyncRequired === true
          ? { persistenceResyncRequired: true }
          : {})
      };
    } catch (error) {
      return { success: false, applied: false, error: error.message };
    }
  }

  async getDrawingDiagnostics() {
    const hostDiagnostics = {
      hostGeneration: this.hostGeneration,
      videoGeneration: this.currentVideoGeneration,
      inputRevision: this.currentInputRevision,
      desiredInputEnabled: this.desiredInputEnabled,
      keyboardRelayCount: this.keyboardRelayCount,
      lastKeyboardRelayCode: this.lastKeyboardRelayCode
    };
    if (this.fabricReadyGeneration !== this.hostGeneration) {
      return {
        success: false,
        ...hostDiagnostics,
        error: 'Fabric drawing runtime is not ready'
      };
    }
    const { hostGeneration } = hostDiagnostics;
    try {
      const result = await this._executeFabricMethod('getDiagnostics');
      if (hostGeneration !== this.hostGeneration || this.fabricReadyGeneration !== hostGeneration) {
        return {
          success: false,
          ...hostDiagnostics,
          error: 'stale drawing diagnostics response'
        };
      }
      const cache = result?.cache && typeof result.cache === 'object' ? result.cache : {};
      const activeSelectionGesture = result?.activeSelectionGesture &&
        typeof result.activeSelectionGesture === 'object'
        ? result.activeSelectionGesture
        : null;
      const lastSelectionGesture = result?.lastSelectionGesture &&
        typeof result.lastSelectionGesture === 'object'
        ? result.lastSelectionGesture
        : null;
      const lastSelectionBounds = lastSelectionGesture?.polygonBounds &&
        typeof lastSelectionGesture.polygonBounds === 'object'
        ? lastSelectionGesture.polygonBounds
        : null;
      return {
        success: true,
        ...hostDiagnostics,
        state: result?.state === 'active' ? 'active' : 'passive',
        prepared: result?.prepared === true,
        inputEnabled: result?.inputEnabled === true,
        activeSessionId: this.activeSessionId,
        targetFrame: Number.isInteger(Number(result?.targetFrame)) ? Number(result.targetFrame) : null,
        tool: normalizeFabricDrawingTool(result?.tool),
        selectionTarget: result?.selectionTarget === 'partial' ? 'partial' : 'stroke',
        selectionShape: result?.selectionShape === 'lasso' ? 'lasso' : 'rectangle',
        selectionControlEventCount: Math.max(
          0,
          Math.trunc(finiteDiagnosticNumber(result?.selectionControlEventCount))
        ),
        lastSelectionControlAction: result?.lastSelectionControlAction &&
          typeof result.lastSelectionControlAction === 'object'
          ? {
            kind: result.lastSelectionControlAction.kind === 'shape' ? 'shape' : 'target',
            value: result.lastSelectionControlAction.kind === 'shape'
              ? (result.lastSelectionControlAction.value === 'lasso' ? 'lasso' : 'rectangle')
              : (result.lastSelectionControlAction.value === 'partial' ? 'partial' : 'stroke'),
            source: result.lastSelectionControlAction.source === 'pointerdown'
              ? 'pointerdown'
              : 'click',
            eventCount: Math.max(
              0,
              Math.trunc(finiteDiagnosticNumber(result.lastSelectionControlAction.eventCount))
            )
          }
          : null,
        activeSelectionGesture: activeSelectionGesture
          ? {
            target: activeSelectionGesture.target === 'partial' ? 'partial' : 'stroke',
            shape: activeSelectionGesture.shape === 'lasso' ? 'lasso' : 'rectangle',
            pointerPointCount: Math.max(
              0,
              Math.trunc(finiteDiagnosticNumber(activeSelectionGesture.pointerPointCount))
            )
          }
          : null,
        lastSelectionGesture: lastSelectionGesture
          ? {
            target: lastSelectionGesture.target === 'partial' ? 'partial' : 'stroke',
            shape: lastSelectionGesture.shape === 'lasso' ? 'lasso' : 'rectangle',
            pointerPointCount: Math.max(
              0,
              Math.trunc(finiteDiagnosticNumber(lastSelectionGesture.pointerPointCount))
            ),
            polygonPointCount: Math.max(
              0,
              Math.trunc(finiteDiagnosticNumber(lastSelectionGesture.polygonPointCount))
            ),
            polygonBounds: lastSelectionBounds
              ? {
                left: finiteDiagnosticNumber(lastSelectionBounds.left),
                right: finiteDiagnosticNumber(lastSelectionBounds.right),
                top: finiteDiagnosticNumber(lastSelectionBounds.top),
                bottom: finiteDiagnosticNumber(lastSelectionBounds.bottom)
              }
              : null,
            pending: lastSelectionGesture.pending === true,
            applied: lastSelectionGesture.applied === true,
            selectedCount: Math.max(
              0,
              Math.trunc(finiteDiagnosticNumber(lastSelectionGesture.selectedCount))
            ),
            reason: typeof lastSelectionGesture.reason === 'string'
              ? lastSelectionGesture.reason.slice(0, 128)
              : null
          }
          : null,
        objectCount: Math.trunc(finiteDiagnosticNumber(result?.objectCount)),
        selectionCount: Math.trunc(finiteDiagnosticNumber(result?.selectionCount)),
        mutationCount: Math.trunc(finiteDiagnosticNumber(result?.mutationCount)),
        undoDepth: Math.trunc(finiteDiagnosticNumber(result?.undoDepth)),
        redoDepth: Math.trunc(finiteDiagnosticNumber(result?.redoDepth)),
        globalUndoDepth: Math.trunc(finiteDiagnosticNumber(result?.globalUndoDepth)),
        globalRedoDepth: Math.trunc(finiteDiagnosticNumber(result?.globalRedoDepth)),
        historyBytes: Math.trunc(finiteDiagnosticNumber(result?.historyBytes)),
        dirty: result?.dirty === true,
        gestures: sanitizeFabricGestureDiagnostics(result?.gestures),
        cache: {
          videoCount: Math.trunc(finiteDiagnosticNumber(cache.videoCount)),
          sceneCount: Math.trunc(finiteDiagnosticNumber(cache.sceneCount)),
          estimatedBytes: Math.trunc(finiteDiagnosticNumber(cache.estimatedBytes)),
          evictionCount: Math.trunc(finiteDiagnosticNumber(cache.evictionCount))
        },
        drawingV3Shadow: sanitizeDrawingV3Diagnostics(result?.drawingV3Shadow),
        metrics: sanitizeFabricMetrics(result?.metrics),
        lastError: typeof result?.lastError === 'string' ? result.lastError.slice(0, 512) : null
      };
    } catch (error) {
      return {
        success: false,
        ...hostDiagnostics,
        error: error.message
      };
    }
  }

  async presentDrawingFrame(request = {}) {
    const normalizedRequest = normalizeFabricDrawingPresentationRequest(request);
    if (!normalizedRequest) {
      return {
        success: false,
        accepted: false,
        reason: 'invalid-presentation-request'
      };
    }
    const echo = {
      presentationRevision: normalizedRequest.presentationRevision,
      targetFrame: normalizedRequest.targetFrame,
      sourceFrame: normalizedRequest.sourceFrame
    };
    const hostWindow = this.window;
    if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded) {
      return {
        success: false,
        accepted: false,
        reason: 'overlay-host-unavailable',
        ...echo
      };
    }
    const fenceMatches = normalizedRequest.hostGeneration === this.hostGeneration &&
      normalizedRequest.videoGeneration === this.currentVideoGeneration &&
      normalizedRequest.stableVideoIdentity === this.currentStableVideoIdentity &&
      normalizedRequest.presentationRevision > this.currentPresentationRevision;
    if (!fenceMatches) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-presentation-fence',
        ...echo
      };
    }
    if (this.desiredInputEnabled) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-input-enabled',
        ...echo
      };
    }

    this.currentPresentationRevision = normalizedRequest.presentationRevision;
    const prepared = await this._ensureFabricRuntime();
    if (!prepared.success) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-runtime-unavailable',
        ...echo
      };
    }
    if (!this._drawingPresentationRequestIsCurrent(hostWindow, normalizedRequest, true)) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-presentation-response',
        ...echo
      };
    }

    try {
      const result = await this._executeFabricMethod(
        'presentDrawingFrame',
        normalizedRequest
      );
      if (!this._drawingPresentationRequestIsCurrent(hostWindow, normalizedRequest, true)) {
        return {
          success: false,
          accepted: false,
          reason: 'stale-presentation-response',
          ...echo
        };
      }
      if (result?.accepted !== true) {
        return {
          success: false,
          accepted: false,
          reason: this._drawingPersistenceReason(
            result?.reason,
            'drawing-presentation-rejected'
          ),
          ...echo
        };
      }
      hostWindow.moveTop?.();
      hostWindow.webContents?.invalidate?.();
      return { success: true, accepted: true, ...echo };
    } catch (_error) {
      if (!this._drawingPresentationRequestIsCurrent(hostWindow, normalizedRequest, true)) {
        return {
          success: false,
          accepted: false,
          reason: 'stale-presentation-response',
          ...echo
        };
      }
      return {
        success: false,
        accepted: false,
        reason: 'drawing-presentation-failed',
        ...echo
      };
    }
  }

  async hydrateDrawingVideo(request = {}) {
    const normalizedRequest = normalizeFabricDrawingPersistenceRequest(request, {
      includeKeyframes: true,
      maxBytes: this.fabricDrawingSnapshotMaxBytes
    });
    if (!normalizedRequest) {
      return {
        success: false,
        accepted: false,
        reason: 'invalid-persistence-request'
      };
    }
    const hostWindow = this.window;
    if (!this._drawingPersistenceRequestIsCurrent(hostWindow, normalizedRequest)) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-persistence-fence'
      };
    }
    if (this.currentStableVideoIdentity !== null &&
        normalizedRequest.stableVideoIdentity !== this.currentStableVideoIdentity) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-persistence-fence'
      };
    }
    if (this.desiredInputEnabled) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-input-enabled'
      };
    }
    const prepared = await this._ensureFabricRuntime();
    if (!prepared.success) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-runtime-unavailable'
      };
    }
    if (!this._drawingPersistenceRequestIsCurrent(hostWindow, normalizedRequest, true)) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-persistence-response'
      };
    }
    try {
      const result = await this._executeFabricMethod(
        'hydrateDrawingVideo',
        normalizedRequest
      );
      if (!this._drawingPersistenceRequestIsCurrent(
        hostWindow,
        normalizedRequest,
        true
      )) {
        return {
          success: false,
          accepted: false,
          reason: 'stale-persistence-response'
        };
      }
      if (result?.accepted !== true) {
        return {
          success: false,
          accepted: false,
          reason: this._drawingPersistenceReason(
            result?.reason,
            'drawing-hydration-rejected'
          )
        };
      }
      this.currentStableVideoIdentity = normalizedRequest.stableVideoIdentity;
      return {
        success: true,
        accepted: true,
        sceneCount: Math.min(
          FABRIC_DRAWING_MAX_KEYFRAMES,
          Math.max(0, Math.trunc(finiteDiagnosticNumber(result.sceneCount)))
        ),
        objectCount: Math.min(
          FABRIC_DRAWING_MAX_OBJECTS_TOTAL,
          Math.max(0, Math.trunc(finiteDiagnosticNumber(result.objectCount)))
        )
      };
    } catch (_error) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-hydration-failed'
      };
    }
  }

  async exportDrawingVideo(request = {}) {
    const normalizedRequest = normalizeFabricDrawingPersistenceRequest(request, {
      includeKeyframes: false,
      maxBytes: this.fabricDrawingSnapshotMaxBytes
    });
    if (!normalizedRequest) {
      return {
        success: false,
        accepted: false,
        reason: 'invalid-persistence-request'
      };
    }
    const hostWindow = this.window;
    if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded) {
      // 호스트 창 소멸은 세대 불일치(stale)와 달리 회복 불가능한 상태다.
      // 렌더러가 이를 구분해 차단 래치 대신 세션 정리를 선택할 수 있게 사유를 분리한다.
      return {
        success: false,
        accepted: false,
        reason: 'overlay-host-unavailable'
      };
    }
    if (!this._drawingPersistenceRequestIsCurrent(hostWindow, normalizedRequest)) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-persistence-fence'
      };
    }
    const prepared = await this._ensureFabricRuntime();
    if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded) {
      return {
        success: false,
        accepted: false,
        reason: 'overlay-host-unavailable'
      };
    }
    if (!prepared.success) {
      return {
        success: false,
        accepted: false,
        reason: 'drawing-runtime-unavailable'
      };
    }
    if (!this._drawingPersistenceRequestIsCurrent(hostWindow, normalizedRequest, true)) {
      return {
        success: false,
        accepted: false,
        reason: 'stale-persistence-response'
      };
    }
    try {
      const result = await this._executeFabricMethod(
        'exportDrawingVideo',
        normalizedRequest
      );
      if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded) {
        return {
          success: false,
          accepted: false,
          reason: 'overlay-host-unavailable'
        };
      }
      if (!this._drawingPersistenceRequestIsCurrent(
        hostWindow,
        normalizedRequest,
        true
      )) {
        return {
          success: false,
          accepted: false,
          reason: 'stale-persistence-response'
        };
      }
      if (result?.accepted !== true) {
        return {
          success: false,
          accepted: false,
          reason: this._drawingPersistenceReason(
            result?.reason,
            'drawing-export-rejected'
          )
        };
      }
      const normalizedSnapshot = normalizeFabricDrawingExportSnapshot(
        result.snapshot,
        normalizedRequest,
        this.fabricDrawingSnapshotMaxBytes
      );
      if (!normalizedSnapshot.success) {
        // 응답 형태(success/accepted/reason)는 그대로 두고,
        // 어떤 검사에서 걸렀는지는 main 로그로만 남긴다.
        this.logger.warn('Fabric 드로잉 스냅샷 회수 거절', {
          reason: normalizedSnapshot.reason,
          failedCheck: normalizedSnapshot.failedCheck || 'unknown'
        });
        return {
          success: false,
          accepted: false,
          reason: normalizedSnapshot.reason
        };
      }
      return {
        success: true,
        accepted: true,
        snapshot: normalizedSnapshot.snapshot
      };
    } catch (_error) {
      if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded) {
        return {
          success: false,
          accepted: false,
          reason: 'overlay-host-unavailable'
        };
      }
      return {
        success: false,
        accepted: false,
        reason: 'drawing-export-failed'
      };
    }
  }

  async _ensureFabricRuntime() {
    const hostWindow = this.window;
    const hostGeneration = this.hostGeneration;
    const contentLoadGeneration = this.contentLoadGeneration;
    if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded) {
      return { success: false, error: 'mpv overlay host is not ready' };
    }
    if (this.fabricReadyGeneration === hostGeneration) {
      return { success: true, reused: true };
    }
    if (this.fabricAttemptGeneration === hostGeneration && this.fabricPreparationPromise) {
      return this.fabricPreparationPromise;
    }
    const currentTime = this.now();
    if (this.fabricAttemptGeneration === hostGeneration &&
        this.fabricPreparationResult?.success === false &&
        currentTime < this.fabricRetryAfter) {
      return {
        ...this.fabricPreparationResult,
        retryAfterMs: Math.max(0, this.fabricRetryAfter - currentTime)
      };
    }

    this.fabricAttemptGeneration = hostGeneration;
    const preparationPromise = (async () => {
      try {
        const bundleSource = await this.readFile(this.fabricBundlePath, 'utf8');
        if (!this._isCurrentDrawingDocument(hostWindow, hostGeneration, contentLoadGeneration)) {
          return { success: false, error: 'mpv overlay host generation changed' };
        }
        const requestedBootstrap = createDrawingV3BootstrapScript(this.drawingV3ShadowEnabled);
        const disabledBootstrap = createDrawingV3BootstrapScript(false);
        let bootstrapInstalled = false;
        try {
          bootstrapInstalled = await hostWindow.webContents?.executeJavaScript?.(
            requestedBootstrap,
            true
          ) === true;
          if (!bootstrapInstalled) {
            this.logger.debug('Drawing V3 shadow bootstrap was not installed; continuing disabled');
          }
        } catch (error) {
          this.logger.debug('Drawing V3 shadow bootstrap failed; continuing disabled', {
            error: error.message
          });
        }
        if (!bootstrapInstalled) {
          try {
            const disabledInstalled = await hostWindow.webContents?.executeJavaScript?.(
              disabledBootstrap,
              true
            ) === true;
            if (!disabledInstalled) {
              this.logger.debug('Drawing V3 disabled bootstrap was not installed; loading bundle off');
            }
          } catch (fallbackError) {
            this.logger.debug('Drawing V3 disabled bootstrap retry failed; loading bundle off', {
              error: fallbackError.message
            });
          }
        }
        if (!this._isCurrentDrawingDocument(hostWindow, hostGeneration, contentLoadGeneration)) {
          return { success: false, error: 'mpv overlay host generation changed' };
        }
        await hostWindow.webContents?.executeJavaScript?.(String(bundleSource), true);
        if (!this._isCurrentDrawingDocument(hostWindow, hostGeneration, contentLoadGeneration)) {
          return { success: false, error: 'mpv overlay host generation changed' };
        }
        const preparation = await hostWindow.webContents?.executeJavaScript?.(FABRIC_PREPARE_SCRIPT, true);
        if (!this._isCurrentDrawingDocument(hostWindow, hostGeneration, contentLoadGeneration)) {
          return { success: false, error: 'mpv overlay host generation changed' };
        }
        if (preparation?.prepared !== true) {
          throw new Error(preparation?.error || preparation?.reason || 'Fabric drawing runtime prepare failed');
        }
        this.fabricReadyGeneration = hostGeneration;
        this.fabricLastError = null;
        return { success: true, reused: preparation.reused === true };
      } catch (error) {
        if (this._isCurrentDrawingDocument(hostWindow, hostGeneration, contentLoadGeneration)) {
          this.fabricLastError = error.message;
          this.logger.debug('Fabric drawing runtime prepare failed', { error: error.message });
        }
        return { success: false, error: error.message };
      }
    })();
    this.fabricPreparationPromise = preparationPromise;
    const preparationResult = await preparationPromise;
    if (this.fabricAttemptGeneration === hostGeneration &&
        this.fabricPreparationPromise === preparationPromise) {
      this.fabricPreparationResult = preparationResult;
      if (preparationResult.success) {
        this.fabricFailureCount = 0;
        this.fabricRetryAfter = 0;
      } else if (this.fabricReadyGeneration !== hostGeneration) {
        this.fabricFailureCount += 1;
        const exponent = Math.min(10, this.fabricFailureCount - 1);
        const delay = Math.min(
          this.fabricRetryMaxMs,
          this.fabricRetryBaseMs * (2 ** exponent)
        );
        this.fabricRetryAfter = this.now() + delay;
        this.fabricPreparationPromise = null;
      }
    }
    return preparationResult;
  }

  _isCurrentHostGeneration(hostWindow, hostGeneration) {
    return this.window === hostWindow &&
      !hostWindow.isDestroyed?.() &&
      this.hostGeneration === hostGeneration;
  }

  _setNativeDrawingInput(hostWindow, enabled) {
    if (!hostWindow || hostWindow.isDestroyed?.()) return;
    if (enabled) {
      // Windows의 focusable:false native 창은 mouseup/move와 달리 pointerdown을
      // Chromium에 전달하지 않는다. Fabric이 activation을 승인한 뒤에만 열어 둔다.
      // 투명 BrowserWindow는 DOM visibility 변경을 다음 입력까지 늦게 그릴 수 있다.
      hostWindow.webContents?.invalidate?.();
      hostWindow.setFocusable?.(true);
      hostWindow.setIgnoreMouseEvents?.(false);
      // 네이티브 확장 스타일 변경이 sibling mpv 창을 위로 올릴 수 있으므로
      // overlay 순서를 복원한 뒤 재합성을 한 번 더 강제한다.
      hostWindow.moveTop?.();
      hostWindow.webContents?.invalidate?.();
      // Windows 마우스 메시지에는 Ctrl/Shift 플래그만 실리고 Alt 플래그가 없다.
      // Chromium은 Alt를 그 창의 키보드 입력 큐에서 읽으므로, 포커스를 준 적이
      // 없는 overlay에서는 Alt 드래그가 altKey:false로 도착해 제스처가 열리지
      // 않는다(Ctrl 지우개만 되고 Alt 크기 조절은 안 되던 비대칭의 원인).
      // 도구 변경 경로도 이미 같은 이유로 마지막에 focus를 되돌린다.
      hostWindow.focus?.();
      return;
    }

    const mainWindow = this.getMainWindow();
    // B를 overlay에서 relay하면 sendInputEvent를 위해 main이 먼저 focus된다.
    // Windows의 setFocusable(false)는 그 직후 다른 owned window로 focus를
    // 다시 넘길 수 있으므로, disable 직전 main이 focus owner인 경우도 기억한다.
    const shouldRestoreMainFocus = hostWindow.isFocused?.() === true ||
      mainWindow?.isFocused?.() === true;
    hostWindow.setIgnoreMouseEvents?.(true);
    hostWindow.setFocusable?.(false);
    if (!shouldRestoreMainFocus) return;
    if (mainWindow && !mainWindow.isDestroyed?.()) {
      mainWindow.focus?.();
      mainWindow.webContents?.focus?.();
    }
  }

  _isCurrentDrawingDocument(hostWindow, hostGeneration, contentLoadGeneration) {
    return this._isCurrentHostGeneration(hostWindow, hostGeneration) &&
      this.contentLoaded &&
      this.contentLoadGeneration === contentLoadGeneration;
  }

  _drawingTokensMatch(request = {}) {
    return request.hostGeneration === this.hostGeneration &&
      request.videoGeneration === this.currentVideoGeneration &&
      request.inputRevision === this.currentInputRevision &&
      request.sessionId === this.activeSessionId &&
      this.desiredInputEnabled;
  }

  _drawingFrameRequestIsCurrent(hostWindow, request = {}) {
    return this.window === hostWindow &&
      !hostWindow.isDestroyed?.() &&
      this.contentLoaded === true &&
      this.fabricReadyGeneration === this.hostGeneration &&
      this._drawingTokensMatch(request) &&
      request.frameRevision === this.currentDrawingFrameRevision;
  }

  _drawingPointerdownFrameRequestIsCurrent(hostWindow, request = {}) {
    return this.window === hostWindow &&
      !hostWindow.isDestroyed?.() &&
      this.contentLoaded === true &&
      this.fabricReadyGeneration === this.hostGeneration &&
      this._drawingTokensMatch(request);
  }

  _drawingPersistenceRequestIsCurrent(hostWindow, request = {}, requireReady = false) {
    return !!hostWindow &&
      this.window === hostWindow &&
      !hostWindow.isDestroyed?.() &&
      this.contentLoaded === true &&
      request.hostGeneration === this.hostGeneration &&
      request.videoGeneration === this.currentVideoGeneration &&
      (!requireReady || this.fabricReadyGeneration === this.hostGeneration);
  }

  _drawingPresentationRequestIsCurrent(hostWindow, request = {}, requireReady = false) {
    return !!hostWindow &&
      this.window === hostWindow &&
      !hostWindow.isDestroyed?.() &&
      this.contentLoaded === true &&
      this.desiredInputEnabled === false &&
      request.hostGeneration === this.hostGeneration &&
      request.videoGeneration === this.currentVideoGeneration &&
      request.presentationRevision === this.currentPresentationRevision &&
      request.stableVideoIdentity === this.currentStableVideoIdentity &&
      (!requireReady || this.fabricReadyGeneration === this.hostGeneration);
  }

  _drawingPersistenceReason(value, fallback) {
    return FABRIC_DRAWING_PUBLIC_RUNTIME_REASON_MAP.get(value) || fallback;
  }

  _inputRequestStillDesired(hostWindow, request = {}) {
    return this.window === hostWindow &&
      !hostWindow.isDestroyed?.() &&
      Number(request.hostGeneration) === this.hostGeneration &&
      Number(request.videoGeneration) === this.currentVideoGeneration &&
      Number(request.inputRevision) === this.currentInputRevision &&
      request.enabled === this.desiredInputEnabled;
  }

  async _compensateStaleDrawingEnable(hostWindow, staleHostGeneration) {
    if (this.window !== hostWindow ||
        hostWindow.isDestroyed?.() ||
        this.hostGeneration !== staleHostGeneration ||
        this.desiredInputEnabled !== false ||
        this.fabricReadyGeneration !== this.hostGeneration ||
        this.currentVideoGeneration < 0 ||
        this.currentInputRevision < 0) {
      return;
    }
    this._setNativeDrawingInput(hostWindow, false);
    const disableRequest = {
      hostGeneration: this.hostGeneration,
      videoGeneration: this.currentVideoGeneration,
      inputRevision: this.currentInputRevision,
      enabled: false
    };
    try {
      await this._executeFabricMethod('setDrawingInput', disableRequest);
      if (this._inputRequestStillDesired(hostWindow, disableRequest)) {
        hostWindow.moveTop?.();
        hostWindow.webContents?.invalidate?.();
      }
    } catch (error) {
      this.fabricLastError = error.message;
      this.logger.debug('stale Fabric drawing enable compensation failed', { error: error.message });
    }
  }

  _rememberDrawingAction(actionId) {
    this.completedActionIds.set(actionId, true);
    while (this.completedActionIds.size > this.maxProcessedActionIds) {
      this.completedActionIds.delete(this.completedActionIds.keys().next().value);
    }
  }

  _executeFabricMethod(method, payload) {
    const argument = payload === undefined ? '' : JSON.stringify(payload);
    return this.window.webContents?.executeJavaScript?.(
      `window.__mpvFabricOverlay.${method}(${argument});`,
      true
    );
  }

  async ensure(bounds) {
    this.drawingV3ShadowLocked = true;
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed?.()) {
      return { success: false, error: 'main window is not available' };
    }

    this.lastBounds = normalizeEmbedBounds(bounds);
    const screenBounds = this._toScreenBounds(this.lastBounds, mainWindow);
    const hostWindow = this._ensureWindow(mainWindow);
    this._bindParentWindow(mainWindow);
    hostWindow.setBounds(screenBounds);

    if (!this.contentLoaded) {
      const contentLoadGeneration = ++this.contentLoadGeneration;
      try {
        await hostWindow.loadURL?.(OVERLAY_HOST_URL);
        if (!this._isCurrentContentLoad(hostWindow, contentLoadGeneration)) {
          return { success: false, error: 'mpv overlay host is no longer current' };
        }
        const overlayApiReady = await hostWindow.webContents?.executeJavaScript?.(
          OVERLAY_API_READY_SCRIPT,
          true
        );
        if (!this._isCurrentContentLoad(hostWindow, contentLoadGeneration)) {
          return { success: false, error: 'mpv overlay host is no longer current' };
        }
        if (overlayApiReady !== true) {
          return { success: false, error: 'mpv overlay API is not ready' };
        }
        this.contentLoaded = true;
      } catch (error) {
        if (this._isCurrentContentLoad(hostWindow, contentLoadGeneration)) {
          this.contentLoaded = false;
        }
        this.logger.debug('mpv overlay host load failed', { error: error.message });
        return { success: false, error: error.message };
      }
    }

    if (this.requestedVisible === false) {
      this._hideOverlayWindow();
    } else {
      this._showOverlayWindow(mainWindow);
    }
    return {
      success: true,
      bounds: screenBounds,
      drawingCapability: this.getDrawingCapability()
    };
  }

  updateBounds(bounds) {
    if (!this.window || this.window.isDestroyed?.()) {
      return { success: false, error: 'mpv overlay host is not ready' };
    }

    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed?.()) {
      return { success: false, error: 'main window is not available' };
    }

    this.lastBounds = normalizeEmbedBounds(bounds);
    const screenBounds = this._toScreenBounds(this.lastBounds, mainWindow);
    // 피드백 32: 동일 bounds 재적용은 생략 — 네이티브 창의 계단식 리사이즈/진동 방지.
    // moveTop은 기존 z-order 의미론(호출마다 최상위 보장)을 보존하기 위해 항상 호출한다.
    if (this._boundsEquals(this._lastAppliedScreenBounds, screenBounds)) {
      this.window.moveTop?.();
      return { success: true, bounds: screenBounds };
    }
    this._lastAppliedScreenBounds = { ...screenBounds };
    this.window.setBounds(screenBounds);
    this.window.moveTop?.();
    return { success: true, bounds: screenBounds };
  }

  _boundsEquals(a, b) {
    return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  async updateState(state) {
    if (!this.window || this.window.isDestroyed?.() || !this.contentLoaded) {
      return { success: false, error: 'mpv overlay host is not ready' };
    }

    // 작업4: 릴레이 판정용 서술자만 호스트에 남기고, 오버레이 페이지로 내려보내는
    // normalized 페이로드에는 넣지 않는다(오버레이 런타임 계약 불변).
    this.drawModeShortcutDescriptor = normalizeDrawModeShortcutDescriptor(
      state?.drawModeShortcut,
      this.drawModeShortcutDescriptor
    );
    const normalized = normalizeOverlayState(state);
    try {
      await this.window.webContents?.executeJavaScript?.(
        `window.__applyMpvOverlayState(${JSON.stringify(normalized)});`,
        true
      );
      return { success: true };
    } catch (error) {
      this.logger.debug('mpv overlay state update failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  async updateRemoteCursorState(state) {
    if (!this.window || this.window.isDestroyed?.() || !this.contentLoaded) {
      return { success: false, error: 'mpv overlay host is not ready' };
    }

    const revision = Number(state?.revision);
    if (!Number.isSafeInteger(revision) || revision < 0 || typeof state?.html !== 'string' ||
        Buffer.byteLength(state.html, 'utf8') > MAX_MPV_REMOTE_CURSOR_HTML_BYTES) {
      return { success: false, accepted: false, error: 'invalid remote cursor state' };
    }
    if (revision <= this.remoteCursorRevision) {
      return { success: true, accepted: false, stale: true };
    }
    this.remoteCursorRevision = revision;
    const safeState = { revision, html: state.html };
    try {
      const accepted = await this.window.webContents?.executeJavaScript?.(
        `window.__applyMpvRemoteCursorState(${JSON.stringify(safeState)});`,
        true
      );
      return { success: true, accepted: accepted !== false };
    } catch (error) {
      this.logger.debug('mpv overlay remote cursor update failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  async updateCollaborationState(state) {
    if (!this.window || this.window.isDestroyed?.() || !this.contentLoaded) {
      return { success: false, error: 'mpv overlay host is not ready' };
    }

    const normalized = normalizeMpvCollaborationState(state);
    if (!normalized) {
      return { success: false, accepted: false, error: 'invalid collaboration state' };
    }
    if (normalized.revision <= this.collaborationRevision) {
      return { success: true, accepted: false, stale: true };
    }
    this.collaborationRevision = normalized.revision;
    try {
      const accepted = await this.window.webContents?.executeJavaScript?.(
        `window.__applyMpvCollaborationState(${JSON.stringify(normalized)});`,
        true
      );
      return { success: true, accepted: accepted !== false };
    } catch (error) {
      this.logger.debug('mpv overlay collaboration state update failed', {
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }

  async triggerCollabRipple(state) {
    if (!this.window || this.window.isDestroyed?.() || !this.contentLoaded) {
      return { success: false, error: 'mpv overlay host is not ready' };
    }
    const clampUnit = value => Math.max(0, Math.min(1, normalizeFloat(value, 0)));
    const safeState = { x: clampUnit(state?.x), y: clampUnit(state?.y) };
    try {
      const accepted = await this.window.webContents?.executeJavaScript?.(
        `window.__triggerMpvCollabRipple(${JSON.stringify(safeState)});`,
        true
      );
      return { success: true, accepted: accepted !== false };
    } catch (error) {
      this.logger.debug('mpv overlay collaboration ripple failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  setVisible(visible) {
    const nextVisible = visible !== false;
    if (!nextVisible && this.requestedVisible !== false) {
      // 현재 fence가 유효한 동안 drag-cancel을 먼저 전달한 뒤 visibility를 닫는다.
      this._resetCollaborationActionRelay({ resetSequence: false });
    }
    this.requestedVisible = nextVisible;
    if (nextVisible) {
      // 표시 복귀 시에는 다음 updateBounds가 반드시 실제 적용되도록 캐시를 비운다.
      this._lastAppliedScreenBounds = null;
    }

    if (!this.window || this.window.isDestroyed?.()) {
      return { success: true, visible: nextVisible, ready: false };
    }

    if (nextVisible) {
      this._repositionToParent();
      this._showOverlayWindow(this.parentWindow || this.getMainWindow());
    } else {
      this._hideOverlayWindow();
    }

    return { success: true, visible: nextVisible, ready: true };
  }

  destroy() {
    const hostWindow = this.window;
    this._resetCollaborationActionRelay();
    hostWindow?.setIgnoreMouseEvents?.(true);
    hostWindow?.setFocusable?.(false);
    this.contentLoadGeneration += 1;
    this.window = null;
    this.contentLoaded = false;
    this.fabricReadyGeneration = 0;
    this.fabricAttemptGeneration = 0;
    this.fabricPreparationPromise = null;
    this.fabricPreparationResult = null;
    this.fabricLastError = null;
    this.fabricFailureCount = 0;
    this.fabricRetryAfter = 0;
    this.currentVideoGeneration = -1;
    this.currentInputRevision = -1;
    this.currentPresentationRevision = -1;
    this.currentStableVideoIdentity = null;
    this.remoteCursorRevision = -1;
    this.collaborationRevision = -1;
    this.collaborationActionSequence = 0;
    this.activeCollaborationDragPointerId = null;
    this.desiredInputEnabled = false;
    this.activeSessionId = null;
    this.currentToolRevision = -1;
    this.currentBrushRevision = -1;
    this.currentLayerViewRevision = -1;
    this.keyboardRelayCount = 0;
    this.lastKeyboardRelayCode = null;
    this.drawModeShortcutDescriptor = null;
    this.completedActionIds.clear();
    this.inFlightDrawingActions.clear();
    this.suppressedOverlayHistoryKeys.clear();
    this.lastBounds = null;
    // 피드백 32: 호스트 재생성 후 동일 bounds 스킵 오판 방지
    this._lastAppliedScreenBounds = null;
    this.requestedVisible = true;
    this._unbindParentWindow();

    if (!hostWindow || hostWindow.isDestroyed?.()) {
      return { success: true, destroyed: false };
    }

    hostWindow.destroy();
    return { success: true, destroyed: true };
  }

  _ensureWindow(parent) {
    if (this.window && !this.window.isDestroyed?.()) {
      return this.window;
    }

    const hostWindow = new this.BrowserWindow({
      parent,
      modal: false,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, '..', 'preload', 'mpv-overlay-preload.js'),
        webSecurity: false
      }
    });
    this.hostGeneration += 1;
    this.drawingActionQueue = Promise.resolve();
    this.fabricReadyGeneration = 0;
    this.fabricAttemptGeneration = 0;
    this.fabricPreparationPromise = null;
    this.fabricPreparationResult = null;
    this.fabricLastError = null;
    this.fabricFailureCount = 0;
    this.fabricRetryAfter = 0;
    this.currentVideoGeneration = -1;
    this.currentInputRevision = -1;
    this.currentPresentationRevision = -1;
    this.currentStableVideoIdentity = null;
    this.remoteCursorRevision = -1;
    this.collaborationRevision = -1;
    this.collaborationActionSequence = 0;
    this.activeCollaborationDragPointerId = null;
    this.desiredInputEnabled = false;
    this.activeSessionId = null;
    this.currentToolRevision = -1;
    this.currentBrushRevision = -1;
    this.currentLayerViewRevision = -1;
    this.keyboardRelayCount = 0;
    this.lastKeyboardRelayCode = null;
    this.drawModeShortcutDescriptor = null;
    this.completedActionIds.clear();
    this.inFlightDrawingActions.clear();
    this.suppressedOverlayHistoryKeys.clear();
    this.window = hostWindow;
    // 피드백 27·29·31: forward는 mousemove를 이 창의 Chromium에도 전달해
    // 기본 화살표 커서가 메인 창 커서와 경합(깜빡임)한다. 이 창은 마우스 이벤트를
    // 쓰지 않으므로 전달 없이 완전 관통시킨다.
    hostWindow.setIgnoreMouseEvents?.(true);

    // 신규: 이 네이티브 창이 OS 파일 드롭을 가로채므로(마우스 관통과 별개),
    // 드롭으로 인한 file:// 네비게이션을 메인 창의 파일 열기로 전달한다.
    // (window.js의 sendDroppedPathToRenderer와 동일한 확장자 분기 — 호스트 소스 단언
    //  및 순환 require 회피를 위해 인라인으로 라우팅)
    hostWindow.webContents?.on?.('will-navigate', (event, url) => {
      event.preventDefault();
      if (!url.startsWith('file://')) return;
      const mainWindow = this.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed?.()) return;
      try {
        const filePath = require('url').fileURLToPath(url);
        const lower = String(filePath).toLowerCase();
        if (lower.endsWith('.bplaylist')) {
          mainWindow.webContents.send('open-playlist', filePath);
        } else if (lower.endsWith('.bcutlist')) {
          mainWindow.webContents.send('open-cutlist', filePath);
        } else {
          mainWindow.webContents.send('open-from-protocol', filePath, null);
        }
      } catch (_error) { /* 차단만 */ }
    });

    const hostGeneration = this.hostGeneration;
    hostWindow.webContents?.on?.('before-input-event', (event, input) => {
      if (this.window !== hostWindow ||
          this.hostGeneration !== hostGeneration ||
          this.desiredInputEnabled !== true ||
          this.fabricReadyGeneration !== hostGeneration ||
          !this.activeSessionId) {
        return;
      }
      const inputCode = String(input?.code || '');
      if (this.suppressedOverlayHistoryKeys.has(inputCode)) {
        if (input?.type === 'keyUp') {
          this.suppressedOverlayHistoryKeys.delete(inputCode);
          event?.preventDefault?.();
          return;
        }
        if (input?.type === 'keyDown' && input.isAutoRepeat === true) {
          event?.preventDefault?.();
          return;
        }
      }
      const historyAction = overlayHistoryActionFromInput(input);
      if (historyAction) {
        this.suppressedOverlayHistoryKeys.add(inputCode);
        event?.preventDefault?.();
        if (input.isAutoRepeat === true) return;
        // renderer가 Fabric 실행과 전역 히스토리 fallback을 한 경로에서 판정하도록
        // 물리 키 입력을 즉시 릴레이한다.
      }
      const drawModeShortcut = this.drawModeShortcutDescriptor;
      const forwardedInput = createForwardedKeyboardInput(input, drawModeShortcut);
      const mainWindow = this.getMainWindow();
      if (!forwardedInput ||
          !mainWindow ||
          mainWindow.isDestroyed?.() ||
          typeof mainWindow.webContents?.send !== 'function') {
        return;
      }
      const needsMainFocusHandoff = forwardedInputNeedsMainFocus(forwardedInput, drawModeShortcut);
      try {
        // overlay가 획 클릭으로 포커스를 얻어도 물리 키 위치(code)를 보존해
        // 사용자 지정 단축키를 메인 renderer의 단일 처리 경로로 보낸다.
        // 기본 B 토글은 Windows의 창 비활성화 handoff를 위해 main을 먼저
        // 활성화하되, renderer 전달 직후 overlay를 되돌려 둔다. B가 실제
        // 토글이면 disable 경로가 main으로 최종 handoff하고, 커스텀 단축키
        // 설정이나 전달 실패라면 다음 툴바 클릭이 소모되지 않는다.
        if (needsMainFocusHandoff) {
          mainWindow.focus?.();
        }
        mainWindow.webContents.send(FORWARDED_KEYBOARD_CHANNEL, forwardedInput);
        this.keyboardRelayCount += 1;
        this.lastKeyboardRelayCode = forwardedInput.code;
        event?.preventDefault?.();
      } catch (error) {
        this.logger.debug('Fabric overlay keyboard relay failed', { error: error.message });
      } finally {
        if (needsMainFocusHandoff &&
            this.window === hostWindow &&
            this.hostGeneration === hostGeneration &&
            this.desiredInputEnabled === true &&
            !hostWindow.isDestroyed?.()) {
          try {
            hostWindow.focus?.();
          } catch (_error) { /* best-effort focus restoration */ }
        }
      }
    });
    hostWindow.webContents?.on?.('render-process-gone', () => {
      if (this.window !== hostWindow || this.hostGeneration !== hostGeneration) return;
      this._resetCollaborationActionRelay();
      hostWindow.setIgnoreMouseEvents?.(true);
      hostWindow.setFocusable?.(false);
      this.contentLoadGeneration += 1;
      this.window = null;
      this.contentLoaded = false;
      this.fabricReadyGeneration = 0;
      this.fabricAttemptGeneration = 0;
      this.fabricPreparationPromise = null;
      this.fabricPreparationResult = null;
      this.fabricLastError = null;
      this.fabricFailureCount = 0;
      this.fabricRetryAfter = 0;
      this.currentVideoGeneration = -1;
      this.currentInputRevision = -1;
      this.currentPresentationRevision = -1;
      this.currentStableVideoIdentity = null;
      this.remoteCursorRevision = -1;
      this.collaborationRevision = -1;
      this.collaborationActionSequence = 0;
      this.activeCollaborationDragPointerId = null;
      this.desiredInputEnabled = false;
      this.activeSessionId = null;
      this.currentToolRevision = -1;
      this.currentBrushRevision = -1;
      this.currentLayerViewRevision = -1;
      this.keyboardRelayCount = 0;
      this.lastKeyboardRelayCode = null;
      this.drawModeShortcutDescriptor = null;
      this.completedActionIds.clear();
      this.inFlightDrawingActions.clear();
      this.suppressedOverlayHistoryKeys.clear();
      this._lastAppliedScreenBounds = null;
      if (!hostWindow.isDestroyed?.()) hostWindow.destroy();
    });

    hostWindow.on?.('closed', () => {
      if (this.window !== hostWindow) return;
      this._resetCollaborationActionRelay();
      this.contentLoadGeneration += 1;
      this.window = null;
      this.contentLoaded = false;
      this.collaborationActionSequence = 0;
      this.activeCollaborationDragPointerId = null;
      this.suppressedOverlayHistoryKeys.clear();
    });

    return hostWindow;
  }

  _isCurrentContentLoad(hostWindow, contentLoadGeneration) {
    return this.window === hostWindow &&
      !hostWindow.isDestroyed?.() &&
      this.contentLoadGeneration === contentLoadGeneration;
  }

  _bindParentWindow(parent) {
    if (!parent || typeof parent.on !== 'function') return;
    if (this.parentWindow === parent && this.parentRepositionHandler) return;

    this._unbindParentWindow();
    this.parentWindow = parent;
    this.parentRepositionHandler = () => {
      this._scheduleRepositionToParent();
    };
    this.parentHideHandler = () => {
      this._resetCollaborationActionRelay({ resetSequence: false });
      this._hideOverlayWindow();
    };
    this.parentShowHandler = () => {
      this._repositionToParent();
      if (this.requestedVisible === false) {
        this._hideOverlayWindow();
      } else {
        this._showOverlayWindow(parent);
      }
    };
    this.parentClosedHandler = () => {
      this.destroy();
    };

    for (const eventName of PARENT_REPOSITION_EVENTS) {
      parent.on(eventName, this.parentRepositionHandler);
    }
    for (const eventName of PARENT_HIDE_EVENTS) {
      parent.on(eventName, this.parentHideHandler);
    }
    for (const eventName of PARENT_SHOW_EVENTS) {
      parent.on(eventName, this.parentShowHandler);
    }
    parent.on('closed', this.parentClosedHandler);
  }

  _unbindParentWindow() {
    if (!this.parentWindow || typeof this.parentWindow.off !== 'function') {
      this.parentWindow = null;
      this.parentRepositionHandler = null;
      this.parentHideHandler = null;
      this.parentShowHandler = null;
      this.parentClosedHandler = null;
      return;
    }

    if (this.parentRepositionHandler) {
      for (const eventName of PARENT_REPOSITION_EVENTS) {
        this.parentWindow.off(eventName, this.parentRepositionHandler);
      }
    }

    if (this.parentHideHandler) {
      for (const eventName of PARENT_HIDE_EVENTS) {
        this.parentWindow.off(eventName, this.parentHideHandler);
      }
    }

    if (this.parentShowHandler) {
      for (const eventName of PARENT_SHOW_EVENTS) {
        this.parentWindow.off(eventName, this.parentShowHandler);
      }
    }

    if (this.parentClosedHandler) {
      this.parentWindow.off('closed', this.parentClosedHandler);
    }

    this.parentWindow = null;
    this.parentRepositionHandler = null;
    this.parentHideHandler = null;
    this.parentShowHandler = null;
    this.parentClosedHandler = null;
  }

  _scheduleRepositionToParent() {
    if (this.repositionPending) return;

    this.repositionPending = true;
    setImmediate(() => {
      this.repositionPending = false;
      this._repositionToParent();
    });
  }

  _repositionToParent() {
    if (!this.window || this.window.isDestroyed?.() || !this.lastBounds) return;

    const mainWindow = this.parentWindow || this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed?.()) return;

    this.window.setBounds(this._toScreenBounds(this.lastBounds, mainWindow));
    this.window.moveTop?.();
  }

  _hideOverlayWindow() {
    if (!this.window || this.window.isDestroyed?.()) return;
    if (typeof this.window.hide === 'function') {
      this.window.hide();
    }
  }

  _showOverlayWindow(parent = this.parentWindow) {
    if (!this.window || this.window.isDestroyed?.()) return;
    if (parent?.isMinimized?.()) {
      this._hideOverlayWindow();
      return;
    }

    if (typeof this.window.showInactive === 'function') {
      this.window.showInactive();
    } else {
      this.window.show();
    }
    this.window.moveTop?.();
    // 숨김 중 갱신된 DOM(툴바·드로잉)이 이전 프레임으로 남지 않게 재표시 직후 재합성을 강제한다
    this.window.webContents?.invalidate?.();
  }

  _toScreenBounds(bounds, mainWindow) {
    const normalized = normalizeEmbedBounds(bounds);
    const contentBounds = mainWindow.getContentBounds();

    return {
      x: Math.round(contentBounds.x + normalized.x),
      y: Math.round(contentBounds.y + normalized.y),
      width: normalized.width,
      height: normalized.height
    };
  }
}

const mpvOverlayHost = new MPVOverlayHost();

module.exports = {
  MPVOverlayHost,
  mpvOverlayHost,
  normalizeOverlayState,
  normalizeMpvCollaborationState,
  normalizeMpvOverlayCollaborationAction,
  normalizeFabricDrawingPersistenceMessage
};
