/**
 * MPV embedded host window.
 *
 * mpv can render into a native window via --wid. DOM elements do not expose
 * native handles, so BAEFRAME creates a small child BrowserWindow over the
 * viewer area and gives that window handle to mpv.
 */

const { createLogger } = require('./logger');

const log = createLogger('MPVEmbedHost');
const TRANSPARENT_HOST_URL = 'data:text/html;charset=utf-8,<html><body style="margin:0;background:transparent;overflow:hidden"></body></html>';
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

function getDefaultBrowserWindow() {
  return require('electron').BrowserWindow;
}

function getDefaultMainWindow() {
  return require('./window').getMainWindow();
}

function normalizeEmbedBounds(bounds = {}) {
  const toInt = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  };

  return {
    x: Math.max(0, toInt(bounds.x, 0)),
    y: Math.max(0, toInt(bounds.y, 0)),
    width: Math.max(1, toInt(bounds.width, 1)),
    height: Math.max(1, toInt(bounds.height, 1))
  };
}

function nativeWindowHandleToMpvWid(handleBuffer, platform = process.platform) {
  if (!Buffer.isBuffer(handleBuffer) || handleBuffer.length === 0) {
    throw new Error('native window handle must be a non-empty Buffer');
  }

  if (platform === 'win32') {
    if (handleBuffer.length >= 8 && typeof handleBuffer.readBigUInt64LE === 'function') {
      return handleBuffer.readBigUInt64LE(0).toString(10);
    }
    return String(handleBuffer.readUInt32LE(0));
  }

  if (handleBuffer.length >= 8 && typeof handleBuffer.readBigUInt64LE === 'function') {
    return handleBuffer.readBigUInt64LE(0).toString(10);
  }

  return String(handleBuffer.readUInt32LE(0));
}

class MPVEmbedHost {
  constructor(options = {}) {
    this.BrowserWindow = options.BrowserWindow || getDefaultBrowserWindow();
    this.getMainWindow = options.getMainWindow || getDefaultMainWindow;
    this.platform = options.platform || process.platform;
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
        await hostWindow.loadURL?.(TRANSPARENT_HOST_URL);
        this.contentLoaded = true;
      } catch (error) {
        this.logger.debug('mpv embed host transparent load failed', { error: error.message });
      }
    }

    this._showHostWindow(mainWindow);

    const wid = nativeWindowHandleToMpvWid(hostWindow.getNativeWindowHandle(), this.platform);
    return { success: true, wid, bounds: screenBounds };
  }

  updateBounds(bounds) {
    if (!this.window || this.window.isDestroyed?.()) {
      return { success: false, error: 'mpv embed host is not ready' };
    }

    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed?.()) {
      return { success: false, error: 'main window is not available' };
    }

    this.lastBounds = normalizeEmbedBounds(bounds);
    const screenBounds = this._toScreenBounds(this.lastBounds, mainWindow);
    this.window.setBounds(screenBounds);
    return { success: true, bounds: screenBounds };
  }

  setVisible(visible) {
    if (!this.window || this.window.isDestroyed?.()) {
      return { success: true, visible: false, ready: false };
    }

    const nextVisible = visible !== false;
    if (nextVisible) {
      this._repositionToParent();
      this._showHostWindow(this.parentWindow || this.getMainWindow());
    } else {
      this._hideHostWindow();
    }

    return { success: true, visible: nextVisible, ready: true };
  }

  destroy() {
    const hostWindow = this.window;
    this.window = null;
    this.contentLoaded = false;
    this.lastBounds = null;
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
      this._hideHostWindow();
    };
    this.parentShowHandler = () => {
      this._repositionToParent();
      this._showHostWindow(parent);
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
  }

  _hideHostWindow() {
    if (!this.window || this.window.isDestroyed?.()) return;
    if (typeof this.window.hide === 'function') {
      this.window.hide();
    }
  }

  _showHostWindow(parent = this.parentWindow) {
    if (!this.window || this.window.isDestroyed?.()) return;
    if (parent?.isMinimized?.()) {
      this._hideHostWindow();
      return;
    }

    if (typeof this.window.showInactive === 'function') {
      this.window.showInactive();
    } else {
      this.window.show();
    }
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

const mpvEmbedHost = new MPVEmbedHost();

module.exports = {
  MPVEmbedHost,
  mpvEmbedHost,
  nativeWindowHandleToMpvWid,
  normalizeEmbedBounds
};
