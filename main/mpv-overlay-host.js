/**
 * MPV overlay host window.
 *
 * mpv renders in a native child window, so Chromium DOM overlays inside the
 * main renderer cannot reliably appear above it. This host mirrors the visual
 * overlay state in a second transparent, click-through child window.
 */

const { createLogger } = require('./logger');
const { normalizeEmbedBounds } = require('./mpv-embed-host');

const log = createLogger('MPVOverlayHost');
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

const OVERLAY_HTML = `
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
    #overlayRoot {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      pointer-events: none;
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
    #htmlOverlay {
      position: absolute;
      inset: 0;
      z-index: 15;
      pointer-events: none;
    }
    #htmlOverlay {
      z-index: 14;
    }
    #tooltipMirror {
      z-index: 16;
    }
    #markerMirror *,
    #tooltipMirror * {
      pointer-events: none !important;
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
  <div id="overlayRoot">
    <img id="onionCanvasMirror" class="mirror-canvas" alt="">
    <img id="drawingCanvasMirror" class="mirror-canvas" alt="">
    <div id="htmlOverlay"></div>
    <div id="markerMirror"></div>
    <div id="tooltipMirror"></div>
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

    window.__applyMpvOverlayState = function applyMpvOverlayState(state) {
      const nextState = state || {};
      const htmlOverlay = document.getElementById('htmlOverlay');
      const markerMirror = document.getElementById('markerMirror');
      const tooltipMirror = document.getElementById('tooltipMirror');
      applyImage('onionCanvasMirror', nextState.onionDataUrl, nextState.canvas);
      applyImage('drawingCanvasMirror', nextState.drawingDataUrl, nextState.canvas);
      htmlOverlay.innerHTML = nextState.htmlOverlayHtml || '';
      markerMirror.innerHTML = nextState.markerHtml || '';
      tooltipMirror.innerHTML = nextState.tooltipHtml || '';
      applyOverlayTransform(markerMirror, nextState);
      tooltipMirror.style.transform = 'none';
      tooltipMirror.style.transformOrigin = 'center center';
    };
  </script>
</body>
</html>`;

const OVERLAY_HOST_URL = `data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`;

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

function normalizeImageDataUrl(value) {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith('data:image/') ? text : '';
}

function normalizeOverlayState(state = {}) {
  const canvas = state.canvas || {};
  return {
    drawingDataUrl: normalizeImageDataUrl(state.drawingDataUrl),
    onionDataUrl: normalizeImageDataUrl(state.onionDataUrl),
    markerHtml: typeof state.markerHtml === 'string' ? state.markerHtml : '',
    tooltipHtml: typeof state.tooltipHtml === 'string' ? state.tooltipHtml : '',
    htmlOverlayHtml: typeof state.htmlOverlayHtml === 'string' ? state.htmlOverlayHtml : '',
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

class MPVOverlayHost {
  constructor(options = {}) {
    this.BrowserWindow = options.BrowserWindow || getDefaultBrowserWindow();
    this.getMainWindow = options.getMainWindow || getDefaultMainWindow;
    this.logger = options.logger || log;
    this.window = null;
    this.contentLoaded = false;
    this.lastBounds = null;
    this.parentWindow = null;
    this.parentRepositionHandler = null;
    this.parentHideHandler = null;
    this.parentShowHandler = null;
    this.parentClosedHandler = null;
    this.repositionPending = false;
    this.requestedVisible = true;
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
      try {
        await hostWindow.loadURL?.(OVERLAY_HOST_URL);
        this.contentLoaded = true;
      } catch (error) {
        this.logger.debug('mpv overlay host load failed', { error: error.message });
      }
    }

    if (this.requestedVisible === false) {
      this._hideOverlayWindow();
    } else {
      this._showOverlayWindow(mainWindow);
    }
    return { success: true, bounds: screenBounds };
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
    this.window.setBounds(screenBounds);
    this.window.moveTop?.();
    return { success: true, bounds: screenBounds };
  }

  async updateState(state) {
    if (!this.window || this.window.isDestroyed?.()) {
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

  setVisible(visible) {
    const nextVisible = visible !== false;
    this.requestedVisible = nextVisible;

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
    this.window = null;
    this.contentLoaded = false;
    this.lastBounds = null;
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

    this.window = new this.BrowserWindow({
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
        sandbox: true
      }
    });
    this.window.setIgnoreMouseEvents?.(true, { forward: true });

    this.window.on?.('closed', () => {
      this.window = null;
      this.contentLoaded = false;
    });

    return this.window;
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
