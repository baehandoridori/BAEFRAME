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
    .mpv-fabric-pilot-toolbar {
      align-items: center;
      padding: 6px;
      border-radius: 14px;
      background: rgba(15, 15, 15, 0.86);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.1),
        0 8px 24px rgba(0, 0, 0, 0.35);
      color: var(--text-primary);
      font-family: Inter, Pretendard, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
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
    .mpv-fabric-pilot-badge {
      display: flex;
      align-items: center;
      min-height: 40px;
      padding: 0 12px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.28);
      color: var(--text-tertiary);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
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
    #markerMirror *,
    #tooltipMirror *,
    #toastMirror *,
    #remoteCursorMirror * {
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
    <div id="compositionMirror"></div>
    <div id="htmlOverlay"></div>
    <div id="markerMirror"></div>
    <div id="tooltipMirror"></div>
    <div id="remoteCursorMirror" class="remote-cursors-container"></div>
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

    window.__applyMpvRemoteCursorState = function applyMpvRemoteCursorState(remoteCursorHtml) {
      applyRemoteCursorHtml(remoteCursorHtml);
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
      applyCompositionLayers(nextState.compositionLayers, nextState.canvas);
      if (typeof nextState.htmlOverlayHtml === 'string') htmlOverlay.innerHTML = nextState.htmlOverlayHtml;
      if (typeof nextState.markerHtml === 'string') markerMirror.innerHTML = nextState.markerHtml;
      if (typeof nextState.tooltipHtml === 'string') tooltipMirror.innerHTML = nextState.tooltipHtml;
      applyRemoteCursorHtml(nextState.remoteCursorHtml);
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
  "typeof window.__applyMpvRemoteCursorState === 'function'"
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
    onionDataUrl: state.onionDataUrl === undefined ? undefined : normalizeImageDataUrl(state.onionDataUrl),
    markerHtml: state.markerHtml === undefined ? undefined : (typeof state.markerHtml === 'string' ? state.markerHtml : ''),
    tooltipHtml: state.tooltipHtml === undefined ? undefined : (typeof state.tooltipHtml === 'string' ? state.tooltipHtml : ''),
    htmlOverlayHtml: state.htmlOverlayHtml === undefined ? undefined : (typeof state.htmlOverlayHtml === 'string' ? state.htmlOverlayHtml : ''),
    toastHtml: state.toastHtml === undefined ? undefined : (typeof state.toastHtml === 'string' ? state.toastHtml : ''),
    commentPlayheadLeft: typeof state.commentPlayheadLeft === 'string' ? state.commentPlayheadLeft : '',
    remoteCursorHtml: typeof state.remoteCursorHtml === 'string' ? state.remoteCursorHtml : '',
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

const FORWARDED_KEY_ALIASES = Object.freeze({
  ' ': 'Space',
  Spacebar: 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Esc: 'Escape'
});
const FORWARDED_NAMED_KEYS = new Set([
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape'
]);

function createForwardedKeyboardInput(input = {}) {
  if (input.type !== 'keyDown' && input.type !== 'keyUp') return null;
  const key = typeof input.key === 'string' ? input.key : '';
  const code = typeof input.code === 'string' ? input.code : '';
  if (input.isComposing === true ||
      ['Process', 'Dead', 'Unidentified'].includes(key) ||
      ['Process', 'Dead'].includes(code) ||
      key === 'Tab' || key === 'Enter') {
    return null;
  }

  let keyCode = FORWARDED_KEY_ALIASES[key] || '';
  if (!keyCode && /^[\x21-\x7e]$/.test(key)) keyCode = key;
  if (!keyCode && (FORWARDED_NAMED_KEYS.has(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key))) {
    keyCode = key;
  }
  if (!keyCode) return null;

  const modifiers = [];
  if (input.shift === true) modifiers.push('shift');
  if (input.control === true) modifiers.push('control');
  if (input.alt === true) modifiers.push('alt');
  if (input.meta === true) modifiers.push('meta');
  if (input.isAutoRepeat === true) modifiers.push('isAutoRepeat');
  return { type: input.type, keyCode, modifiers };
}

function finiteDiagnosticNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
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
    this.currentVideoGeneration = -1;
    this.currentInputRevision = -1;
    this.desiredInputEnabled = false;
    this.activeSessionId = null;
    this.currentToolRevision = -1;
    this.completedActionIds = new Map();
    this.inFlightDrawingActions = new Map();
    this.maxProcessedActionIds = 2048;
  }

  getDrawingCapability() {
    const passiveReady = !!this.window && !this.window.isDestroyed?.() && this.contentLoaded;
    return {
      hostGeneration: this.hostGeneration,
      passiveReady,
      fabricReady: passiveReady && this.fabricReadyGeneration === this.hostGeneration
    };
  }

  async setDrawingInput() {
    const request = arguments[0] || {};
    const hostWindow = this.window;
    if (!hostWindow || hostWindow.isDestroyed?.() || !this.contentLoaded) {
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
    if (!request.enabled) {
      this._setNativeDrawingInput(hostWindow, false);
    }

    this.currentVideoGeneration = videoGeneration;
    this.currentInputRevision = inputRevision;
    this.desiredInputEnabled = request.enabled;
    if (!request.enabled) {
      this.activeSessionId = null;
      this.currentToolRevision = -1;
    }

    // 준비된 Fabric surface가 없다면 disable은 native click-through만 보장하면 된다.
    // 영구적인 bundle 오류 상태에서 B-off가 또 read/injection을 시작하지 않게 한다.
    if (!request.enabled && this.fabricReadyGeneration !== this.hostGeneration) {
      return { success: true, accepted: true, enabled: false, fabricReady: false };
    }

    const prepared = await this._ensureFabricRuntime();
    if (!prepared.success) {
      if (!request.enabled) {
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
    if (request.enabled && runtimeResult?.accepted === true && stillCurrent) {
      this.activeSessionId = request.session?.sessionId || null;
      this.currentToolRevision = 0;
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
    if (runtimeResult?.tool === 'brush' || runtimeResult?.tool === 'select') {
      response.tool = runtimeResult.tool;
    }
    return response;
  }

  async updateDrawingTool(request = {}) {
    const toolRevision = Number(request.toolRevision);
    const currentTokensMatch = request.hostGeneration === this.hostGeneration &&
      request.videoGeneration === this.currentVideoGeneration &&
      request.inputRevision === this.currentInputRevision &&
      request.sessionId === this.activeSessionId;
    const validTool = request.tool === 'brush' || request.tool === 'select' || request.tool === 'V';
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
      return { success: true, accepted: true, tool: result.tool === 'select' ? 'select' : 'brush' };
    } catch (error) {
      return { success: false, accepted: false, error: error.message };
    }
  }

  async applyDrawingAction(request = {}) {
    const validAction = request.action === 'delete-selection' || request.action === 'clear-session';
    if (!this._drawingTokensMatch(request) ||
        !validAction ||
        typeof request.actionId !== 'string' ||
        request.actionId.length === 0 || request.actionId.length > 256) {
      return { success: false, applied: false, error: 'stale or invalid drawing action request' };
    }
    if (this.completedActionIds.has(request.actionId)) {
      return { success: true, applied: false, duplicate: true, deletedCount: 0 };
    }
    const inFlight = this.inFlightDrawingActions.get(request.actionId);
    if (inFlight) return inFlight;

    const operation = this._performDrawingAction(request);
    this.inFlightDrawingActions.set(request.actionId, operation);
    try {
      const result = await operation;
      if (result.success) this._rememberDrawingAction(request.actionId);
      return result;
    } finally {
      if (this.inFlightDrawingActions.get(request.actionId) === operation) {
        this.inFlightDrawingActions.delete(request.actionId);
      }
    }
  }

  async _performDrawingAction(request) {
    try {
      const result = await this._executeFabricMethod('applyDrawingAction', request);
      if (!this._drawingTokensMatch(request)) {
        return { success: false, applied: false, error: 'stale drawing action response' };
      }
      return {
        success: result?.applied === true || result?.duplicate === true,
        applied: result?.applied === true,
        duplicate: result?.duplicate === true,
        deletedCount: Math.max(0, Math.trunc(finiteDiagnosticNumber(result?.deletedCount)))
      };
    } catch (error) {
      return { success: false, applied: false, error: error.message };
    }
  }

  async getDrawingDiagnostics() {
    if (this.fabricReadyGeneration !== this.hostGeneration) {
      return { success: false, error: 'Fabric drawing runtime is not ready' };
    }
    const hostGeneration = this.hostGeneration;
    try {
      const result = await this._executeFabricMethod('getDiagnostics');
      if (hostGeneration !== this.hostGeneration || this.fabricReadyGeneration !== hostGeneration) {
        return { success: false, error: 'stale drawing diagnostics response' };
      }
      const cache = result?.cache && typeof result.cache === 'object' ? result.cache : {};
      return {
        success: true,
        state: result?.state === 'active' ? 'active' : 'passive',
        prepared: result?.prepared === true,
        inputEnabled: result?.inputEnabled === true,
        hostGeneration,
        videoGeneration: this.currentVideoGeneration,
        inputRevision: this.currentInputRevision,
        activeSessionId: this.activeSessionId,
        targetFrame: Number.isInteger(Number(result?.targetFrame)) ? Number(result.targetFrame) : null,
        tool: result?.tool === 'select' ? 'select' : 'brush',
        objectCount: Math.trunc(finiteDiagnosticNumber(result?.objectCount)),
        selectionCount: Math.trunc(finiteDiagnosticNumber(result?.selectionCount)),
        mutationCount: Math.trunc(finiteDiagnosticNumber(result?.mutationCount)),
        dirty: result?.dirty === true,
        cache: {
          videoCount: Math.trunc(finiteDiagnosticNumber(cache.videoCount)),
          sceneCount: Math.trunc(finiteDiagnosticNumber(cache.sceneCount)),
          estimatedBytes: Math.trunc(finiteDiagnosticNumber(cache.estimatedBytes)),
          evictionCount: Math.trunc(finiteDiagnosticNumber(cache.evictionCount))
        },
        metrics: sanitizeFabricMetrics(result?.metrics),
        lastError: typeof result?.lastError === 'string' ? result.lastError.slice(0, 512) : null
      };
    } catch (error) {
      return { success: false, error: error.message };
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
      hostWindow.setFocusable?.(true);
      hostWindow.setIgnoreMouseEvents?.(false);
      return;
    }

    const shouldRestoreMainFocus = hostWindow.isFocused?.() === true;
    hostWindow.setIgnoreMouseEvents?.(true);
    hostWindow.setFocusable?.(false);
    if (!shouldRestoreMainFocus) return;
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed?.()) mainWindow.focus?.();
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

  async updateRemoteCursorState(remoteCursorHtml) {
    if (!this.window || this.window.isDestroyed?.() || !this.contentLoaded) {
      return { success: false, error: 'mpv overlay host is not ready' };
    }

    const safeRemoteCursorHtml = typeof remoteCursorHtml === 'string' ? remoteCursorHtml : '';
    try {
      await this.window.webContents?.executeJavaScript?.(
        `window.__applyMpvRemoteCursorState(${JSON.stringify(safeRemoteCursorHtml)});`,
        true
      );
      return { success: true };
    } catch (error) {
      this.logger.debug('mpv overlay remote cursor update failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  setVisible(visible) {
    const nextVisible = visible !== false;
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
    this.desiredInputEnabled = false;
    this.activeSessionId = null;
    this.currentToolRevision = -1;
    this.completedActionIds.clear();
    this.inFlightDrawingActions.clear();
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
        webSecurity: false
      }
    });
    this.hostGeneration += 1;
    this.fabricReadyGeneration = 0;
    this.fabricAttemptGeneration = 0;
    this.fabricPreparationPromise = null;
    this.fabricPreparationResult = null;
    this.fabricLastError = null;
    this.fabricFailureCount = 0;
    this.fabricRetryAfter = 0;
    this.currentVideoGeneration = -1;
    this.currentInputRevision = -1;
    this.desiredInputEnabled = false;
    this.activeSessionId = null;
    this.currentToolRevision = -1;
    this.completedActionIds.clear();
    this.inFlightDrawingActions.clear();
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
      const forwardedInput = createForwardedKeyboardInput(input);
      const mainWindow = this.getMainWindow();
      if (!forwardedInput ||
          !mainWindow ||
          mainWindow.isDestroyed?.() ||
          typeof mainWindow.webContents?.sendInputEvent !== 'function') {
        return;
      }
      try {
        // overlay가 획 클릭으로 포커스를 얻어도 기존 B/V/Delete/Space 단축키는
        // 메인 renderer의 단일 처리 경로를 그대로 이용한다.
        mainWindow.focus?.();
        mainWindow.webContents.sendInputEvent(forwardedInput);
        event?.preventDefault?.();
      } catch (error) {
        this.logger.debug('Fabric overlay keyboard relay failed', { error: error.message });
      }
    });
    hostWindow.webContents?.on?.('render-process-gone', () => {
      if (this.window !== hostWindow || this.hostGeneration !== hostGeneration) return;
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
      this.desiredInputEnabled = false;
      this.activeSessionId = null;
      this.currentToolRevision = -1;
      this.completedActionIds.clear();
      this.inFlightDrawingActions.clear();
      this._lastAppliedScreenBounds = null;
      if (!hostWindow.isDestroyed?.()) hostWindow.destroy();
    });

    hostWindow.on?.('closed', () => {
      if (this.window !== hostWindow) return;
      this.contentLoadGeneration += 1;
      this.window = null;
      this.contentLoaded = false;
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
  normalizeOverlayState
};
