const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);
const MIN_LAYER_DURATION = 0.1;
const DEFAULT_VIDEO_LAYER_DURATION = 5;
const DEFAULT_LAYER_RECT = Object.freeze({
  x: 0.25,
  y: 0.25,
  width: 0.5,
  height: 0.5
});
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const COMPOSITION_LAYER_COLOR_PALETTE = Object.freeze([
  '#ffd000',
  '#4a9eff',
  '#26de81',
  '#ff6b9d',
  '#a55eea',
  '#ffa502',
  '#38d9a9',
  '#ff5555',
  '#45aaf2',
  '#fed330'
]);
const MEDIA_STATUS = new Set(['ready', 'converting', 'error']);

function isFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number);
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toHexByte(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function expandHexColor(value) {
  const raw = String(value || '').trim();
  if (!HEX_COLOR_PATTERN.test(raw)) return null;
  const hex = raw.slice(1).toLowerCase();
  if (hex.length === 3) {
    return `#${hex.split('').map(char => `${char}${char}`).join('')}`;
  }
  return `#${hex}`;
}

function mixHexColor(color, target = '#ffffff', amount = 0.45) {
  const sourceHex = expandHexColor(color);
  const targetHex = expandHexColor(target);
  if (!sourceHex || !targetHex) return sourceHex || '#ffd000';
  const source = [1, 3, 5].map(index => parseInt(sourceHex.slice(index, index + 2), 16));
  const next = [1, 3, 5].map(index => parseInt(targetHex.slice(index, index + 2), 16));
  const ratio = clamp(toFiniteNumber(amount, 0.45), 0, 1);
  return `#${source.map((channel, index) => toHexByte(channel + (next[index] - channel) * ratio)).join('')}`;
}

function roundTime(value) {
  return Math.round(toFiniteNumber(value, 0) * 1000) / 1000;
}

function roundRectValue(value) {
  return Math.round(toFiniteNumber(value, 0) * 1000000) / 1000000;
}

function basename(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || '';
}

function extensionOf(filePath = '') {
  const name = basename(filePath).toLowerCase();
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1) : '';
}

function stripExtension(fileName) {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function getExtensionWithDot(fileName) {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(index) : '';
}

function generateLayerId() {
  return `composition_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneLayers(layers) {
  return layers.map(layer => ({ ...layer }));
}

function makeCompositionEvent(name, detail = {}) {
  if (typeof CustomEvent === 'function') {
    return new CustomEvent(name, { detail });
  }
  const event = new Event(name);
  event.detail = detail;
  return event;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCompositionLayerVisibilityIcon(enabled) {
  const slash = enabled
    ? ''
    : '<line x1="4" y1="20" x2="20" y2="4"></line>';
  return `
    <svg class="composition-layer-eye-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
      <circle cx="12" cy="12" r="2.4"></circle>
      ${slash}
    </svg>
  `;
}

function getCompositionLayerTypeIcon(type) {
  if (type === 'video') {
    return `
      <svg class="composition-layer-media-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="6" width="14" height="12" rx="2"></rect>
        <path d="M17 10.5l4-2.5v8l-4-2.5z"></path>
      </svg>
    `;
  }
  return `
    <svg class="composition-layer-media-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"></rect>
      <circle cx="8" cy="10" r="1.6"></circle>
      <path d="M4.5 17l4.2-4.2 3.2 3.2 2.4-2.4 5.2 5.2"></path>
    </svg>
  `;
}

function filePathToFileUrl(filePath) {
  const raw = String(filePath || '');
  if (!raw) return '';
  if (/^file:\/\//i.test(raw)) return raw;

  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    const [, , host = '', ...segments] = normalized.split('/');
    const encodedHost = encodeURIComponent(host);
    const encodedPath = segments.map(segment => encodeURIComponent(segment)).join('/');
    return `file://${encodedHost}/${encodedPath}`;
  }

  const prefixed = /^[a-zA-Z]:\//.test(normalized)
    ? `/${normalized}`
    : normalized.startsWith('/')
      ? normalized
      : `/${normalized}`;
  const encodedPath = prefixed
    .split('/')
    .map((segment, index) => (index === 1 && /^[a-zA-Z]:$/.test(segment)
      ? segment
      : encodeURIComponent(segment)))
    .join('/');
  return `file://${encodedPath}`;
}

export function getCompositionLayerType(filePath) {
  const extension = extensionOf(filePath);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

export function normalizeHexColor(color) {
  return expandHexColor(color);
}

export function deriveCompositionSelectedColor(color) {
  return mixHexColor(color, '#ffffff', 0.46);
}

export function getAutomaticCompositionLayerColors(index = 0) {
  const color = COMPOSITION_LAYER_COLOR_PALETTE[
    Math.abs(Math.round(toFiniteNumber(index, 0))) % COMPOSITION_LAYER_COLOR_PALETTE.length
  ];
  return {
    color,
    selectedColor: deriveCompositionSelectedColor(color)
  };
}

export function getDefaultImageLayerDuration(baseDuration) {
  const duration = toFiniteNumber(baseDuration, 0);
  if (duration > 0 && duration < 2) return roundTime(duration);
  if (duration <= 0) return 2;
  return roundTime(clamp(duration * 0.1, 2, 8));
}

export function getUniqueCompositionLayerName(filePath, existingNames = []) {
  const fileName = basename(filePath) || '합성 레이어';
  const existing = new Set(existingNames.map(name => String(name || '').trim()).filter(Boolean));
  if (!existing.has(fileName)) return fileName;

  const base = stripExtension(fileName);
  const extension = getExtensionWithDot(fileName);
  let index = 2;
  while (existing.has(`${base} ${index}${extension}`)) {
    index += 1;
  }
  return `${base} ${index}${extension}`;
}

export function normalizeCompositionLayer(layer = {}, context = {}) {
  const filePath = String(layer.filePath || '');
  const detectedType = getCompositionLayerType(filePath);
  const type = ['image', 'video'].includes(layer.type) ? layer.type : detectedType || 'image';
  const startTime = Math.max(0, roundTime(layer.startTime));
  const rawEndTime = roundTime(layer.endTime);
  const endTime = rawEndTime > startTime
    ? rawEndTime
    : roundTime(startTime + MIN_LAYER_DURATION);
  const sourceDuration = isFiniteNumber(layer.sourceDuration)
    ? Math.max(0, roundTime(layer.sourceDuration))
    : null;
  const order = Math.max(0, Math.round(toFiniteNumber(layer.order, context.index || 0)));
  const automaticColors = getAutomaticCompositionLayerColors(order);
  const color = normalizeHexColor(layer.color) || automaticColors.color;
  const selectedColor = normalizeHexColor(layer.selectedColor) || deriveCompositionSelectedColor(color);
  const mediaStatus = MEDIA_STATUS.has(layer.mediaStatus) ? layer.mediaStatus : 'ready';

  return {
    id: String(layer.id || generateLayerId()),
    name: String(layer.name || basename(filePath) || '합성 레이어').trim() || basename(filePath) || '합성 레이어',
    type,
    filePath,
    displayFilePath: typeof layer.displayFilePath === 'string' ? layer.displayFilePath : '',
    enabled: layer.enabled !== false,
    missing: layer.missing === true,
    order,
    startTime,
    endTime,
    opacity: clamp(toFiniteNumber(layer.opacity, 1), 0, 1),
    x: toFiniteNumber(layer.x, DEFAULT_LAYER_RECT.x),
    y: toFiniteNumber(layer.y, DEFAULT_LAYER_RECT.y),
    width: Math.max(MIN_LAYER_DURATION, toFiniteNumber(layer.width, DEFAULT_LAYER_RECT.width)),
    height: Math.max(MIN_LAYER_DURATION, toFiniteNumber(layer.height, DEFAULT_LAYER_RECT.height)),
    aspectLocked: layer.aspectLocked !== false,
    color,
    selectedColor,
    mediaStatus,
    mediaMessage: String(layer.mediaMessage || ''),
    sourceDuration
  };
}

export function createCompositionLayer(filePath, options = {}) {
  const type = options.mediaType || getCompositionLayerType(filePath);
  if (!type) {
    throw new Error('지원하지 않는 합성 레이어 파일입니다.');
  }

  const currentTime = Math.max(0, roundTime(options.currentTime));
  const baseDuration = Math.max(0, roundTime(options.baseDuration));
  const sourceDuration = Math.max(0, roundTime(options.sourceDuration));
  const existingNames = Array.isArray(options.existingNames) ? options.existingNames : [];
  const duration = type === 'image'
    ? getDefaultImageLayerDuration(baseDuration)
    : sourceDuration || DEFAULT_VIDEO_LAYER_DURATION;
  let endTime = roundTime(currentTime + duration);

  if (type === 'image' && baseDuration > 0) {
    endTime = Math.min(baseDuration, endTime);
    if (endTime <= currentTime) {
      endTime = roundTime(currentTime + Math.max(MIN_LAYER_DURATION, duration));
    }
  }

  return normalizeCompositionLayer({
    id: options.id || generateLayerId(),
    name: options.name || getUniqueCompositionLayerName(filePath, existingNames),
    type,
    filePath,
    enabled: true,
    order: Math.max(0, Math.round(toFiniteNumber(options.order, 0))),
    startTime: currentTime,
    endTime,
    opacity: 1,
    ...DEFAULT_LAYER_RECT,
    color: options.color,
    selectedColor: options.selectedColor,
    sourceDuration: sourceDuration || (type === 'video' ? duration : null)
  });
}

export function getVisibleCompositionLayers(layers = [], currentTime = 0) {
  const time = toFiniteNumber(currentTime, 0);
  return [...layers]
    .filter(layer => layer?.enabled !== false)
    .filter(layer => layer?.missing !== true)
    .filter(layer => !['converting', 'error'].includes(layer?.mediaStatus))
    .filter(layer => layer?.filePath)
    .filter(layer => time >= toFiniteNumber(layer.startTime, 0) && time < toFiniteNumber(layer.endTime, 0))
    .sort((a, b) => toFiniteNumber(a.order, 0) - toFiniteNumber(b.order, 0));
}

export function reorderCompositionLayers(layers = [], layerId, targetIndex) {
  const ordered = [...layers]
    .map(layer => ({ ...layer }))
    .sort((a, b) => toFiniteNumber(a.order, 0) - toFiniteNumber(b.order, 0));
  const fromIndex = ordered.findIndex(layer => layer.id === layerId);
  if (fromIndex < 0) return ordered.map((layer, index) => ({ ...layer, order: index }));

  const [moved] = ordered.splice(fromIndex, 1);
  const boundedIndex = clamp(Math.round(toFiniteNumber(targetIndex, 0)), 0, ordered.length);
  ordered.splice(boundedIndex, 0, moved);
  return ordered.map((layer, index) => ({ ...layer, order: index }));
}

export function duplicateCompositionLayer(layers = [], layerId, options = {}) {
  const ordered = [...layers]
    .map((layer, index) => normalizeCompositionLayer(layer, { index }))
    .sort((a, b) => toFiniteNumber(a.order, 0) - toFiniteNumber(b.order, 0));
  const sourceIndex = ordered.findIndex(layer => layer.id === layerId);
  if (sourceIndex < 0) return ordered.map((layer, index) => ({ ...layer, order: index }));

  const source = ordered[sourceIndex];
  const offset = Math.max(0, toFiniteNumber(options.offset, 0.03));
  const nextX = source.x + source.width + offset <= 1 ? source.x + offset : source.x - offset;
  const nextY = source.y + source.height + offset <= 1 ? source.y + offset : source.y - offset;
  const duplicateColors = getAutomaticCompositionLayerColors(ordered.length);
  const duplicate = normalizeCompositionLayer({
    ...source,
    id: options.id || generateLayerId(),
    name: options.name || getUniqueCompositionLayerName(source.name, ordered.map(layer => layer.name)),
    order: sourceIndex + 1,
    x: roundRectValue(nextX),
    y: roundRectValue(nextY),
    color: options.color || duplicateColors.color,
    selectedColor: options.selectedColor || duplicateColors.selectedColor,
    missing: source.missing === true
  }, { index: sourceIndex + 1 });

  ordered.splice(sourceIndex + 1, 0, duplicate);
  return ordered.map((layer, index) => ({ ...layer, order: index }));
}

export function resizeLayerRect(layer = {}, handle = 'se', deltaX = 0, deltaY = 0, options = {}) {
  const fromLeft = String(handle).includes('w');
  const fromTop = String(handle).includes('n');
  const minWidth = Math.max(0.05, toFiniteNumber(options.minWidth, 0.05));
  const minHeight = Math.max(0.05, toFiniteNumber(options.minHeight, 0.05));
  const overlayWidth = Math.max(1, toFiniteNumber(options.overlayWidth, 1));
  const overlayHeight = Math.max(1, toFiniteNumber(options.overlayHeight, 1));
  const start = {
    x: toFiniteNumber(layer.x, DEFAULT_LAYER_RECT.x),
    y: toFiniteNumber(layer.y, DEFAULT_LAYER_RECT.y),
    width: Math.max(minWidth, toFiniteNumber(layer.width, DEFAULT_LAYER_RECT.width)),
    height: Math.max(minHeight, toFiniteNumber(layer.height, DEFAULT_LAYER_RECT.height))
  };
  let width = Math.max(minWidth, start.width + (fromLeft ? -deltaX : deltaX));
  let height = Math.max(minHeight, start.height + (fromTop ? -deltaY : deltaY));

  if (layer.aspectLocked !== false) {
    const startPixelWidth = Math.max(1, start.width * overlayWidth);
    const startPixelHeight = Math.max(1, start.height * overlayHeight);
    const aspectRatio = startPixelWidth / startPixelHeight;
    const targetPixelWidth = width * overlayWidth;
    const targetPixelHeight = height * overlayHeight;
    const useWidth = Math.abs(targetPixelWidth - startPixelWidth) >= Math.abs(targetPixelHeight - startPixelHeight);

    if (useWidth) {
      height = Math.max(minHeight, (targetPixelWidth / aspectRatio) / overlayHeight);
    } else {
      width = Math.max(minWidth, (targetPixelHeight * aspectRatio) / overlayWidth);
    }
  }

  return {
    x: roundRectValue(fromLeft ? start.x + (start.width - width) : start.x),
    y: roundRectValue(fromTop ? start.y + (start.height - height) : start.y),
    width: roundRectValue(width),
    height: roundRectValue(height)
  };
}

export function snapCompositionLayerRect(rect = {}, options = {}) {
  const width = Math.max(0, toFiniteNumber(rect.width, 0));
  const height = Math.max(0, toFiniteNumber(rect.height, 0));
  const thresholdX = Math.max(0, toFiniteNumber(options.thresholdX, 0.01));
  const thresholdY = Math.max(0, toFiniteNumber(options.thresholdY, 0.01));
  let x = toFiniteNumber(rect.x, 0);
  let y = toFiniteNumber(rect.y, 0);
  const guides = [];
  const xCandidates = [
    { value: 0, position: 0 },
    { value: 0.5 - width / 2, position: 0.5 },
    { value: 1 - width, position: 1 }
  ];
  const yCandidates = [
    { value: 0, position: 0 },
    { value: 0.5 - height / 2, position: 0.5 },
    { value: 1 - height, position: 1 }
  ];
  const snapX = xCandidates.find(candidate => Math.abs(x - candidate.value) <= thresholdX);
  const snapY = yCandidates.find(candidate => Math.abs(y - candidate.value) <= thresholdY);

  if (snapX) {
    x = snapX.value;
    guides.push({ axis: 'x', position: snapX.position });
  }
  if (snapY) {
    y = snapY.value;
    guides.push({ axis: 'y', position: snapY.position });
  }

  return {
    rect: {
      x: roundRectValue(x),
      y: roundRectValue(y),
      width: roundRectValue(width),
      height: roundRectValue(height)
    },
    guides
  };
}

export function moveLayerRange(layer, deltaTime, options = {}) {
  const start = toFiniteNumber(layer.startTime, 0);
  const end = Math.max(start + MIN_LAYER_DURATION, toFiniteNumber(layer.endTime, start + MIN_LAYER_DURATION));
  const duration = end - start;
  const minTime = Math.max(0, toFiniteNumber(options.minTime, 0));
  const nextStart = Math.max(minTime, roundTime(start + toFiniteNumber(deltaTime, 0)));
  return {
    startTime: roundTime(nextStart),
    endTime: roundTime(nextStart + duration)
  };
}

export function resizeLayerRange(layer, edge, time, options = {}) {
  const minDuration = Math.max(MIN_LAYER_DURATION, toFiniteNumber(options.minDuration, MIN_LAYER_DURATION));
  const start = Math.max(0, toFiniteNumber(layer.startTime, 0));
  const end = Math.max(start + minDuration, toFiniteNumber(layer.endTime, start + minDuration));
  const target = Math.max(0, roundTime(time));

  if (edge === 'start') {
    return {
      startTime: roundTime(Math.min(target, end - minDuration)),
      endTime: roundTime(end)
    };
  }

  return {
    startTime: roundTime(start),
    endTime: roundTime(Math.max(target, start + minDuration))
  };
}

export function serializeCompositionLayer(layer) {
  const normalized = normalizeCompositionLayer(layer);
  return {
    id: normalized.id,
    name: normalized.name,
    type: normalized.type,
    filePath: normalized.filePath,
    enabled: normalized.enabled,
    order: normalized.order,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    opacity: normalized.opacity,
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
    aspectLocked: normalized.aspectLocked,
    color: normalized.color,
    selectedColor: normalized.selectedColor,
    sourceDuration: normalized.sourceDuration
  };
}

export class CompositionLayerManager extends EventTarget {
  constructor(options = {}) {
    super();
    this.layers = [];
    this.selectedLayerId = null;
    this.currentTime = 0;
    this.isPlaying = false;
    this.baseDuration = 0;
    this.undoSnapshot = null;
    this.redoSnapshot = null;
    this.elements = options.elements || {};
    this.timeline = options.timeline || null;
    this.openFileDialog = options.openFileDialog || null;
    this.fileExists = options.fileExists || null;
    this.showToast = options.showToast || (() => {});
    this.getCurrentTime = options.getCurrentTime || (() => this.currentTime);
    this.getBaseDuration = options.getBaseDuration || (() => this.baseDuration);
    this.scheduleOverlaySync = options.scheduleOverlaySync || (() => {});
    this.prepareMedia = typeof options.prepareMedia === 'function' ? options.prepareMedia : null;
    this.mediaPrepareTokens = new Map();
    this.dragState = null;
    this.timelineDragState = null;
    this.panelDragState = null;
    this.panelReorderState = null;
    this.panelResizeState = null;
    this.contextMenuState = null;
    this.panelContinuousEdit = null;

    this._onDocumentPointerMove = this._onDocumentPointerMove.bind(this);
    this._onDocumentPointerUp = this._onDocumentPointerUp.bind(this);
    this._onTimelinePointerMove = this._onTimelinePointerMove.bind(this);
    this._onTimelinePointerUp = this._onTimelinePointerUp.bind(this);
    this._onPanelPointerMove = this._onPanelPointerMove.bind(this);
    this._onPanelPointerUp = this._onPanelPointerUp.bind(this);
    this._onPanelResizePointerMove = this._onPanelResizePointerMove.bind(this);
    this._onPanelResizePointerUp = this._onPanelResizePointerUp.bind(this);
    this._clearPanelContinuousEdit = this._clearPanelContinuousEdit.bind(this);
    this._installDomListeners();
  }

  setTimeline(timeline) {
    this.timeline = timeline;
    this.render();
  }

  setVideoInfo({ duration } = {}) {
    this.baseDuration = Math.max(0, roundTime(duration));
    this.render();
  }

  setPlaybackState({ currentTime, isPlaying } = {}) {
    if (isFiniteNumber(currentTime)) {
      this.currentTime = Math.max(0, roundTime(currentTime));
    }
    if (typeof isPlaying === 'boolean') {
      this.isPlaying = isPlaying;
    }
    this.renderOverlay({ playbackOnly: true });
  }

  getLayer(layerId) {
    return this.layers.find(layer => layer.id === layerId) || null;
  }

  fromJSON(layers = []) {
    const source = Array.isArray(layers) ? layers : [];
    this.layers = source
      .map((layer, index) => normalizeCompositionLayer(layer, { index }))
      .sort((a, b) => a.order - b.order)
      .map((layer, index) => ({ ...layer, order: index }));
    this.selectedLayerId = this.layers.some(layer => layer.id === this.selectedLayerId)
      ? this.selectedLayerId
      : this.layers[0]?.id || null;
    this.undoSnapshot = null;
    this.redoSnapshot = null;
    this.render();
    this._checkMissingFiles();
    this._prepareAllLayerMedia();
  }

  toJSON() {
    return this.layers
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(serializeCompositionLayer);
  }

  async addLayerFromFile(filePath, options = {}) {
    if (!getCompositionLayerType(filePath)) {
      this.showToast('이미지 또는 영상 파일만 합성 레이어로 추가할 수 있습니다.', 'warning');
      return null;
    }

    const sourceDuration = options.sourceDuration || await this._probeVideoDuration(filePath);
    const layer = createCompositionLayer(filePath, {
      currentTime: options.currentTime ?? this.getCurrentTime(),
      baseDuration: options.baseDuration ?? this.getBaseDuration(),
      sourceDuration,
      existingNames: this.layers.map(item => item.name),
      order: this.layers.length
    });

    this._recordUndo();
    this.layers = [...this.layers, layer];
    this.selectedLayerId = layer.id;
    await this._checkMissingFile(layer);
    this._changed('layerAdded', { layer });
    void this.prepareLayerMedia(layer.id);
    return layer;
  }

  updateLayer(layerId, updates = {}, options = {}) {
    const index = this.layers.findIndex(layer => layer.id === layerId);
    if (index < 0) return null;
    if (options.recordUndo !== false) this._recordUndo();

    const normalizedUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'color') &&
        !Object.prototype.hasOwnProperty.call(normalizedUpdates, 'selectedColor')) {
      const color = normalizeHexColor(normalizedUpdates.color);
      if (color) normalizedUpdates.selectedColor = deriveCompositionSelectedColor(color);
    }

    const merged = normalizeCompositionLayer({
      ...this.layers[index],
      ...normalizedUpdates
    }, { index });
    this.layers = this.layers.map((layer, layerIndex) => layerIndex === index ? merged : layer);
    const renderOptions = {
      panel: options.renderPanel !== false,
      overlay: options.renderOverlay !== false,
      timeline: options.renderTimeline !== false
    };
    if (options.emitChange === false) {
      this.render(renderOptions);
      if (options.scheduleOverlaySync !== false) this.scheduleOverlaySync({ force: true });
      return merged;
    }
    this._changed('layerUpdated', { layer: merged }, {
      renderPanel: renderOptions.panel,
      renderOverlay: renderOptions.overlay,
      renderTimeline: renderOptions.timeline
    });
    return merged;
  }

  deleteLayer(layerId) {
    if (!this.getLayer(layerId)) return false;
    this._recordUndo();
    this.layers = this.layers
      .filter(layer => layer.id !== layerId)
      .map((layer, index) => ({ ...layer, order: index }));
    this.selectedLayerId = this.layers.slice().sort((a, b) => b.order - a.order)[0]?.id || null;
    if (this.contextMenuState?.layerId === layerId) this.contextMenuState = null;
    this._changed('layerDeleted', { layerId });
    return true;
  }

  duplicateLayer(layerId, options = {}) {
    if (!this.getLayer(layerId)) return null;
    this._recordUndo();
    this.layers = duplicateCompositionLayer(this.layers, layerId, options);
    const ordered = this.layers.slice().sort((a, b) => a.order - b.order);
    const sourceIndex = ordered.findIndex(layer => layer.id === layerId);
    const duplicate = ordered[sourceIndex + 1] || null;
    this.selectedLayerId = duplicate?.id || layerId;
    this._changed('layerDuplicated', { layer: duplicate, sourceLayerId: layerId });
    return duplicate;
  }

  selectLayer(layerId, options = {}) {
    if (layerId && !this.getLayer(layerId)) return false;
    this.selectedLayerId = layerId || null;
    this.render({
      panel: options.renderPanel !== false,
      overlay: options.renderOverlay !== false,
      timeline: options.renderTimeline !== false
    });
    this._emit('selectionChanged', { layerId: this.selectedLayerId });
    return true;
  }

  reorderLayer(layerId, targetIndex) {
    if (!this.getLayer(layerId)) return false;
    this._recordUndo();
    this.layers = reorderCompositionLayers(this.layers, layerId, targetIndex);
    this._changed('layerReordered', { layerId, targetIndex });
    return true;
  }

  moveLayerByOffset(layerId, offset) {
    const ordered = this.layers.slice().sort((a, b) => a.order - b.order);
    const currentIndex = ordered.findIndex(layer => layer.id === layerId);
    if (currentIndex < 0) return false;
    const targetIndex = clamp(currentIndex + Math.round(toFiniteNumber(offset, 0)), 0, ordered.length - 1);
    if (targetIndex === currentIndex) return false;
    return this.reorderLayer(layerId, targetIndex);
  }

  reorderLayerByDisplayTarget(layerId, targetLayerId, placement = 'before') {
    const targetIndex = this._getReorderIndexFromDisplayTarget(layerId, targetLayerId, placement);
    if (targetIndex < 0) return false;
    return this.reorderLayer(layerId, targetIndex);
  }

  _getReorderIndexFromDisplayTarget(layerId, targetLayerId, placement = 'before') {
    if (!layerId || !targetLayerId || layerId === targetLayerId) return -1;
    const displayOrdered = this._getPanelOrderedLayers().filter(layer => layer.id !== layerId);
    const targetDisplayIndex = displayOrdered.findIndex(layer => layer.id === targetLayerId);
    if (targetDisplayIndex < 0) return -1;
    const insertionDisplayIndex = targetDisplayIndex + (placement === 'after' ? 1 : 0);
    return clamp(displayOrdered.length - insertionDisplayIndex, 0, displayOrdered.length);
  }

  async relinkLayerFile(layerId) {
    const layer = this.getLayer(layerId);
    if (!layer) return null;
    const filePath = await this._selectMediaFile();
    if (!filePath) return layer;
    const type = getCompositionLayerType(filePath);
    if (!type) {
      this.showToast('이미지 또는 영상 파일만 다시 연결할 수 있습니다.', 'warning');
      return layer;
    }
    const sourceDuration = type === 'video' ? await this._probeVideoDuration(filePath) : null;
    const updated = this.updateLayer(layerId, {
      filePath,
      type,
      displayFilePath: '',
      mediaStatus: 'ready',
      mediaMessage: '',
      missing: false,
      sourceDuration
    });
    void this.prepareLayerMedia(layerId);
    return updated;
  }

  async prepareLayerMedia(layerId) {
    const layer = this.getLayer(layerId);
    if (!layer) return null;

    if (layer.type !== 'video' || !this.prepareMedia || !layer.filePath) {
      if (layer.mediaStatus !== 'ready' || layer.displayFilePath || layer.mediaMessage) {
        return this.updateLayer(layerId, {
          displayFilePath: '',
          mediaStatus: 'ready',
          mediaMessage: ''
        }, { recordUndo: false });
      }
      return layer;
    }

    const token = Symbol(layerId);
    this.mediaPrepareTokens.set(layerId, token);
    this.updateLayer(layerId, {
      displayFilePath: '',
      mediaStatus: 'converting',
      mediaMessage: '변환 확인 중'
    }, { recordUndo: false });

    try {
      const result = await this.prepareMedia(layer.filePath, { layer: { ...layer } });
      if (this.mediaPrepareTokens.get(layerId) !== token) return this.getLayer(layerId);

      if (result?.status === 'error' || result?.success === false) {
        return this.updateLayer(layerId, {
          displayFilePath: '',
          mediaStatus: 'error',
          mediaMessage: result?.error || '변환 실패'
        }, { recordUndo: false });
      }

      const displayFilePath = typeof result?.filePath === 'string' && result.filePath !== layer.filePath
        ? result.filePath
        : '';
      return this.updateLayer(layerId, {
        displayFilePath,
        mediaStatus: 'ready',
        mediaMessage: result?.message || ''
      }, { recordUndo: false });
    } catch (error) {
      if (this.mediaPrepareTokens.get(layerId) !== token) return this.getLayer(layerId);
      return this.updateLayer(layerId, {
        displayFilePath: '',
        mediaStatus: 'error',
        mediaMessage: error?.message || '변환 실패'
      }, { recordUndo: false });
    } finally {
      if (this.mediaPrepareTokens.get(layerId) === token) {
        this.mediaPrepareTokens.delete(layerId);
      }
    }
  }

  updateRange(layerId, range) {
    return this.updateLayer(layerId, range);
  }

  undo() {
    if (!this.undoSnapshot) return false;
    this.redoSnapshot = cloneLayers(this.layers);
    this.layers = cloneLayers(this.undoSnapshot);
    this.undoSnapshot = null;
    this.selectedLayerId = this.layers.some(layer => layer.id === this.selectedLayerId)
      ? this.selectedLayerId
      : this.layers[0]?.id || null;
    this._changed('undo', {});
    return true;
  }

  redo() {
    if (!this.redoSnapshot) return false;
    this.undoSnapshot = cloneLayers(this.layers);
    this.layers = cloneLayers(this.redoSnapshot);
    this.redoSnapshot = null;
    this._changed('redo', {});
    return true;
  }

  togglePanel(forceOpen) {
    const panel = this.elements.panel;
    const button = this.elements.toggleButton;
    if (!panel) return;
    const shouldOpen = typeof forceOpen === 'boolean'
      ? forceOpen
      : !panel.classList.contains('open');
    panel.classList.toggle('open', shouldOpen);
    button?.classList.toggle('active', shouldOpen);
    button?.setAttribute('aria-pressed', String(shouldOpen));
  }

  togglePanelCollapsed(forceCollapsed) {
    const panel = this.elements.panel;
    if (!panel) return false;
    const shouldCollapse = typeof forceCollapsed === 'boolean'
      ? forceCollapsed
      : !panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', shouldCollapse);
    this.elements.collapseButton?.setAttribute('aria-pressed', String(shouldCollapse));
    return shouldCollapse;
  }

  getMpvOverlayLayers(options = {}) {
    const currentTime = options.currentTime ?? this.currentTime;
    const isPlaying = options.isPlaying ?? this.isPlaying;
    return getVisibleCompositionLayers(this.layers, currentTime).map((layer) => {
      const displayFilePath = layer.displayFilePath || layer.filePath;
      return {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        sourceFilePath: layer.filePath,
        filePath: displayFilePath,
        fileUrl: filePathToFileUrl(displayFilePath),
        order: layer.order,
        opacity: layer.opacity,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        color: layer.color,
        selectedColor: layer.selectedColor,
        startTime: layer.startTime,
        endTime: layer.endTime,
        localTime: Math.max(0, roundTime(toFiniteNumber(currentTime, 0) - layer.startTime)),
        isPlaying
      };
    });
  }

  render(options = {}) {
    if (options.panel !== false) this.renderPanel();
    if (options.overlay !== false) this.renderOverlay();
    if (options.timeline !== false) this.renderTimeline();
  }

  renderPanel() {
    const list = this.elements.list;
    if (!list) return;

    const ordered = this._getPanelOrderedLayers();
    if (this.contextMenuState && !this.getLayer(this.contextMenuState.layerId)) {
      this.contextMenuState = null;
    }
    if (ordered.length === 0) {
      list.innerHTML = '<div class="composition-layer-empty">합성 레이어 없음</div>';
      return;
    }

    const itemsHtml = ordered.map((layer, index) => {
      const selected = layer.id === this.selectedLayerId ? ' selected' : '';
      const disabled = layer.enabled ? '' : ' is-disabled';
      const missing = layer.missing
        ? '<span class="composition-layer-missing">파일 없음</span><button class="composition-layer-mini-btn composition-layer-relink" type="button" data-action="relink" title="파일 다시 연결">찾기</button>'
        : '';
      const typeLabel = layer.type === 'video' ? '영상' : '이미지';
      const aspectState = layer.aspectLocked === false ? '' : ' active';
      const statusClass = layer.mediaStatus === 'error'
        ? ' error'
        : layer.mediaStatus === 'converting'
          ? ' converting'
          : '';
      const statusText = layer.type === 'video'
        ? layer.mediaStatus === 'converting'
          ? '변환 중'
          : layer.mediaStatus === 'error'
            ? '변환 실패'
            : layer.displayFilePath
              ? '변환본'
              : ''
        : '';
      const mediaStatus = statusText
        ? `<span class="composition-layer-media-status${statusClass}" title="${escapeHtml(layer.mediaMessage || statusText)}">${statusText}</span>`
        : '';
      const aspectLabel = layer.aspectLocked === false ? '비율 자유' : '비율 잠금';
      const visibilityLabel = layer.enabled ? '레이어 숨기기' : '레이어 보이기';
      return `
        <div class="composition-layer-item${selected}${disabled}" data-layer-id="${escapeHtml(layer.id)}" style="--composition-layer-color: ${escapeHtml(layer.color)}; --composition-layer-selected-color: ${escapeHtml(layer.selectedColor)};">
          <button class="composition-layer-drag" type="button" title="순서 변경" draggable="true">⋮⋮</button>
          <button class="composition-layer-visibility" type="button" data-action="visibility" title="${visibilityLabel}" aria-label="${visibilityLabel}">${getCompositionLayerVisibilityIcon(layer.enabled)}</button>
          <span class="composition-layer-type-badge ${escapeHtml(layer.type)}" title="${typeLabel}" aria-label="${typeLabel}">${getCompositionLayerTypeIcon(layer.type)}</span>
          <span class="composition-layer-name" title="${escapeHtml(layer.name)}">${escapeHtml(layer.name)}</span>
          <button class="composition-layer-mini-btn" type="button" data-action="move-up" title="위로 이동" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="composition-layer-mini-btn" type="button" data-action="move-down" title="아래로 이동" ${index === ordered.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="composition-layer-mini-btn composition-layer-menu-btn" type="button" data-action="open-menu" title="레이어 설정">⋯</button>
          <button class="composition-layer-mini-btn composition-layer-aspect-lock${aspectState}" type="button" data-action="aspect-lock" title="${aspectLabel}">${aspectLabel}</button>
          ${missing}
          <label class="composition-layer-opacity">
            <span>${Math.round(layer.opacity * 100)}%</span>
            <input type="range" min="0" max="100" value="${Math.round(layer.opacity * 100)}" data-action="opacity" title="불투명도">
          </label>
          ${mediaStatus}
        </div>
      `;
    }).join('');

    list.innerHTML = `${itemsHtml}${this._renderContextMenuHtml()}`;
  }

  _getPanelOrderedLayers() {
    return this.layers.slice().sort((a, b) => b.order - a.order);
  }

  _renderContextMenuHtml() {
    const layer = this.contextMenuState?.layerId
      ? this.getLayer(this.contextMenuState.layerId)
      : null;
    if (!layer) return '';
    const typeLabel = layer.type === 'video' ? '영상' : '이미지';
    const left = Number.isFinite(this.contextMenuState.x) ? this.contextMenuState.x : 0;
    const top = Number.isFinite(this.contextMenuState.y) ? this.contextMenuState.y : 0;
    const sourcePath = layer.filePath || '연결된 파일 없음';

    return `
      <div class="composition-layer-context-menu" data-layer-id="${escapeHtml(layer.id)}" style="left: ${left}px; top: ${top}px;">
        <div class="composition-layer-context-header">
          <span class="composition-layer-type-badge ${escapeHtml(layer.type)}" title="${typeLabel}" aria-label="${typeLabel}">${getCompositionLayerTypeIcon(layer.type)}</span>
          <strong>${escapeHtml(layer.name)}</strong>
          <button class="composition-layer-context-close" type="button" data-action="menu-close" title="닫기">×</button>
        </div>
        <label class="composition-layer-context-row">
          <span>이름</span>
          <input data-action="menu-name" value="${escapeHtml(layer.name)}" title="레이어 이름">
        </label>
        <label class="composition-layer-context-row">
          <span>색상</span>
          <input type="color" data-action="menu-color" value="${escapeHtml(layer.color)}" title="레이어 색상">
        </label>
        <div class="composition-layer-source-path" title="${escapeHtml(sourcePath)}">${escapeHtml(sourcePath)}</div>
        <div class="composition-layer-context-actions">
          <button type="button" data-action="menu-duplicate">복제</button>
          <button type="button" data-action="relink">파일 다시 연결</button>
          <button type="button" class="danger" data-action="menu-delete">삭제</button>
        </div>
      </div>
    `;
  }

  renderOverlay(_options = {}) {
    const overlay = this.elements.overlay;
    if (!overlay) return;

    const visibleLayers = getVisibleCompositionLayers(this.layers, this.currentTime);
    const visibleIds = new Set(visibleLayers.map(layer => layer.id));

    Array.from(overlay.children || []).forEach((child) => {
      if (child.classList?.contains('composition-layer-snap-guide')) return;
      if (!visibleIds.has(child.dataset?.layerId)) {
        this._removeOverlayLayerElement(child);
      }
    });

    visibleLayers.forEach((layer) => {
      const wrapper = this._getOrCreateOverlayLayerElement(overlay, layer);
      this._applyOverlayLayerState(wrapper, layer);
    });

    this._syncOverlayVideoPlayback();
  }

  _getOrCreateOverlayLayerElement(overlay, layer) {
    const existing = Array.from(overlay.children || [])
      .find(child => child.dataset?.layerId === layer.id);
    const existingMedia = existing?.querySelector?.('.composition-layer-preview-media');
    const expectedTag = layer.type === 'video' ? 'VIDEO' : 'IMG';
    if (existing && existingMedia?.tagName === expectedTag) return existing;

    if (existing) this._removeOverlayLayerElement(existing);

    const wrapper = document.createElement('div');
    wrapper.className = 'composition-layer-preview';
    wrapper.dataset.layerId = layer.id;

    const media = document.createElement(layer.type === 'video' ? 'video' : 'img');
    media.className = layer.type === 'video'
      ? 'composition-layer-preview-media composition-layer-preview-video'
      : 'composition-layer-preview-media';
    media.dataset.layerId = layer.id;
    if (layer.type === 'video') {
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
    } else {
      media.alt = '';
    }

    wrapper.appendChild(media);
    overlay.appendChild(wrapper);
    return wrapper;
  }

  _applyOverlayLayerState(wrapper, layer) {
    if (!wrapper) return;
    const selected = layer.id === this.selectedLayerId;
    const wasSelected = wrapper.dataset.selected === 'true';
    wrapper.className = `composition-layer-preview${selected ? ' selected' : ''}`;
    wrapper.dataset.layerId = layer.id;
    wrapper.dataset.selected = String(selected);
    wrapper.style.left = `${layer.x * 100}%`;
    wrapper.style.top = `${layer.y * 100}%`;
    wrapper.style.width = `${layer.width * 100}%`;
    wrapper.style.height = `${layer.height * 100}%`;
    wrapper.style.opacity = String(layer.opacity);
    wrapper.style.zIndex = String(20 + layer.order);
    wrapper.style.setProperty('--composition-layer-color', layer.color);
    wrapper.style.setProperty('--composition-layer-selected-color', layer.selectedColor);

    const media = wrapper.querySelector?.('.composition-layer-preview-media');
    const fileUrl = filePathToFileUrl(layer.displayFilePath || layer.filePath);
    if (media && media.getAttribute('src') !== fileUrl) {
      media.setAttribute('src', fileUrl);
    }
    const handleCount = wrapper.querySelectorAll?.('.composition-layer-transform-handle').length || 0;
    if (wasSelected !== selected || (selected && handleCount !== 4)) {
      this._syncOverlayHandles(wrapper, selected);
    }
  }

  _syncOverlayHandles(wrapper, selected) {
    wrapper.querySelectorAll?.('.composition-layer-transform-handle').forEach(handle => handle.remove());
    if (!selected) return;
    ['nw', 'ne', 'sw', 'se'].forEach((handleName) => {
      const handle = document.createElement('span');
      handle.className = `composition-layer-transform-handle ${handleName}`;
      handle.dataset.handle = handleName;
      wrapper.appendChild(handle);
    });
  }

  _syncOverlayVideoPlayback() {
    const overlay = this.elements.overlay;
    if (!overlay) return;

    overlay.querySelectorAll('.composition-layer-preview-video').forEach((video) => {
      const layer = this.getLayer(video.dataset.layerId);
      if (!layer) return;
      const localTime = Math.max(0, this.currentTime - layer.startTime);
      video.muted = true;
      video.playsInline = true;
      const seekThreshold = this.isPlaying ? 0.08 : 0.001;
      if (Number.isFinite(localTime) && Math.abs((video.currentTime || 0) - localTime) > seekThreshold) {
        try { video.currentTime = localTime; } catch (_) {}
      }
      if (this.isPlaying) {
        video.play?.().catch?.(() => {});
      } else {
        video.pause?.();
      }
    });
  }

  _removeOverlayLayerElement(element) {
    const video = element.querySelector?.('video');
    if (video) {
      video.pause?.();
      video.removeAttribute('src');
      video.load?.();
    }
    element.remove?.();
  }

  renderTimeline() {
    if (!this.timeline?.renderCompositionLayers) return;
    this.timeline.renderCompositionLayers(this.toJSON(), {
      selectedLayerId: this.selectedLayerId,
      duration: this.getBaseDuration()
    });
  }

  _installDomListeners() {
    const resizeHandle = this._ensurePanelResizeHandle();

    this.elements.toggleButton?.addEventListener('click', () => this.togglePanel());
    this.elements.addButton?.addEventListener('click', async () => {
      const filePath = await this._selectMediaFile();
      if (filePath) await this.addLayerFromFile(filePath);
    });
    this.elements.undoButton?.addEventListener('click', () => this.undo());
    this.elements.redoButton?.addEventListener('click', () => this.redo());
    this.elements.collapseButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.togglePanelCollapsed();
    });
    this.elements.panelHeader?.addEventListener('pointerdown', (event) => this._handlePanelHeaderPointerDown(event));
    this.elements.panel?.addEventListener('wheel', (event) => event.stopPropagation());
    resizeHandle?.addEventListener('pointerdown', (event) => this._handlePanelResizePointerDown(event));

    this.elements.list?.addEventListener('click', (event) => this._handlePanelClick(event));
    this.elements.list?.addEventListener('pointerdown', (event) => this._handlePanelPointerDown(event));
    this.elements.list?.addEventListener('input', (event) => this._handlePanelInput(event));
    this.elements.list?.addEventListener('change', (event) => this._handlePanelInput(event, { commit: true }));
    this.elements.list?.addEventListener('dragstart', (event) => this._handlePanelDragStart(event));
    this.elements.list?.addEventListener('dragover', (event) => this._handlePanelDragOver(event));
    this.elements.list?.addEventListener('drop', (event) => this._handlePanelDrop(event));
    this.elements.list?.addEventListener('dragend', () => this._clearPanelDragFeedback());
    this.elements.list?.addEventListener('contextmenu', (event) => this._handlePanelContextMenu(event));

    this.elements.overlay?.addEventListener('pointerdown', (event) => this._handleOverlayPointerDown(event));
  }

  _ensurePanelResizeHandle() {
    const panel = this.elements.panel;
    if (!panel) return null;
    let handle = panel.querySelector?.('.composition-layer-panel-resize');
    if (!handle) {
      handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'composition-layer-panel-resize';
      handle.title = '패널 크기 조절';
      handle.setAttribute('aria-label', '패널 크기 조절');
      panel.appendChild(handle);
    }
    this.elements.panelResize = handle;
    return handle;
  }

  async _handlePanelClick(event) {
    const menu = event.target.closest?.('.composition-layer-context-menu');
    const item = event.target.closest?.('.composition-layer-item');
    const layerId = item?.dataset.layerId || menu?.dataset.layerId;
    if (!layerId) return;
    const action = event.target.closest?.('[data-action]')?.dataset.action;

    if (['opacity', 'menu-name', 'menu-color'].includes(action)) {
      this.selectLayer(layerId, { renderPanel: false });
      return;
    }

    if (action === 'open-menu') {
      event.preventDefault();
      event.stopPropagation();
      this._openContextMenu(layerId, event);
      return;
    }

    if (action === 'menu-close') {
      this._closeContextMenu();
      return;
    }

    if (action === 'visibility') {
      const layer = this.getLayer(layerId);
      if (layer) this.updateLayer(layerId, { enabled: !layer.enabled });
      return;
    }

    if (action === 'move-up') {
      this.selectLayer(layerId);
      this.moveLayerByOffset(layerId, 1);
      return;
    }

    if (action === 'move-down') {
      this.selectLayer(layerId);
      this.moveLayerByOffset(layerId, -1);
      return;
    }

    if (action === 'menu-duplicate') {
      this.duplicateLayer(layerId);
      this.contextMenuState = null;
      this.renderPanel();
      return;
    }

    if (action === 'aspect-lock') {
      const layer = this.getLayer(layerId);
      if (layer) this.updateLayer(layerId, { aspectLocked: layer.aspectLocked === false });
      return;
    }

    if (action === 'relink') {
      await this.relinkLayerFile(layerId);
      return;
    }

    if (action === 'menu-delete') {
      this.deleteLayer(layerId);
      return;
    }

    if (!menu) this.selectLayer(layerId);
  }

  _handlePanelPointerDown(event) {
    const item = event.target.closest?.('.composition-layer-item');
    const menu = event.target.closest?.('.composition-layer-context-menu');
    if (!item && !menu) return;
    const action = event.target.dataset.action;
    if (!['opacity', 'menu-name', 'menu-color'].includes(action)) return;
    const layerId = item?.dataset.layerId || menu?.dataset.layerId;
    this.selectLayer(layerId, { renderPanel: false });
    this._beginPanelContinuousEdit(layerId, action);
  }

  _handlePanelInput(event, options = {}) {
    const item = event.target.closest?.('.composition-layer-item');
    const menu = event.target.closest?.('.composition-layer-context-menu');
    if (!item && !menu) return;
    const layerId = item?.dataset.layerId || menu?.dataset.layerId;
    const action = event.target.dataset.action;
    const isLiveInput = event.type === 'input' && options.commit !== true;

    if (action === 'opacity') {
      if (!options.commit) this._beginPanelContinuousEdit(layerId, action);
      this.updateLayer(layerId, { opacity: toFiniteNumber(event.target.value, 100) / 100 }, {
        recordUndo: false,
        renderPanel: !isLiveInput,
        emitChange: !isLiveInput,
        scheduleOverlaySync: !isLiveInput
      });
      return;
    }

    if (action === 'menu-color') {
      if (!options.commit) this._beginPanelContinuousEdit(layerId, action);
      this.updateLayer(layerId, { color: event.target.value }, {
        recordUndo: false,
        renderPanel: !isLiveInput,
        emitChange: !isLiveInput,
        scheduleOverlaySync: !isLiveInput
      });
      return;
    }

    if (action === 'menu-name') {
      if (!options.commit) this._beginPanelContinuousEdit(layerId, action);
      this.updateLayer(layerId, { name: event.target.value || basename(this.getLayer(layerId)?.filePath) }, {
        recordUndo: false,
        renderPanel: !isLiveInput,
        renderTimeline: !isLiveInput,
        emitChange: !isLiveInput,
        scheduleOverlaySync: !isLiveInput
      });
    }
  }

  _handlePanelContextMenu(event) {
    const item = event.target.closest?.('.composition-layer-item');
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    this._openContextMenu(item.dataset.layerId, event);
  }

  _openContextMenu(layerId, event) {
    if (!this.getLayer(layerId)) return;
    const targetRect = event?.target?.getBoundingClientRect?.();
    const requestedX = Number.isFinite(event?.clientX)
      ? event.clientX
      : (targetRect ? targetRect.left : 0);
    const requestedY = Number.isFinite(event?.clientY)
      ? event.clientY
      : (targetRect ? targetRect.bottom + 4 : 0);
    const maxX = Math.max(8, (window.innerWidth || 480) - 280);
    const maxY = Math.max(8, (window.innerHeight || 360) - 220);

    this.contextMenuState = {
      layerId,
      x: clamp(requestedX, 8, maxX),
      y: clamp(requestedY, 8, maxY)
    };
    this.selectLayer(layerId, { renderPanel: false });
    this.renderPanel();
  }

  _closeContextMenu() {
    if (!this.contextMenuState) return;
    this.contextMenuState = null;
    this.renderPanel();
  }

  _handlePanelDragStart(event) {
    const handle = event.target.closest?.('.composition-layer-drag');
    if (!handle) {
      event.preventDefault();
      return;
    }
    const item = handle.closest?.('.composition-layer-item');
    if (!item) return;
    this.panelReorderState = { layerId: item.dataset.layerId };
    item.classList.add('is-dragging');
    this.elements.list?.classList.add('is-reordering');
    event.dataTransfer?.setData('text/plain', item.dataset.layerId);
    event.dataTransfer?.setData('application/x-baeframe-composition-layer', item.dataset.layerId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer?.setDragImage?.(item, 12, 12);
  }

  _handlePanelDragOver(event) {
    const target = event.target.closest?.('.composition-layer-item');
    if (!target) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const sourceId = this.panelReorderState?.layerId ||
      event.dataTransfer?.getData('application/x-baeframe-composition-layer') ||
      event.dataTransfer?.getData('text/plain');
    const placement = this._getVerticalDropPlacement(event, target);
    this._setPanelDragFeedback(target, sourceId, placement);
  }

  _handlePanelDrop(event) {
    const target = event.target.closest?.('.composition-layer-item');
    if (!target) return;
    event.preventDefault();
    const sourceId = this.panelReorderState?.layerId ||
      event.dataTransfer?.getData('application/x-baeframe-composition-layer') ||
      event.dataTransfer?.getData('text/plain');
    const placement = this._getVerticalDropPlacement(event, target);
    this._clearPanelDragFeedback();
    if (sourceId) this.reorderLayerByDisplayTarget(sourceId, target.dataset.layerId, placement);
  }

  _getVerticalDropPlacement(event, element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return 'before';
    return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  }

  _setPanelDragFeedback(target, sourceId, placement = 'before') {
    this._clearPanelDropFeedback();
    if (!target || target.dataset.layerId === sourceId) return;
    target.classList.add(placement === 'after' ? 'is-drop-after' : 'is-drop-before');
  }

  _clearPanelDropFeedback() {
    this.elements.list
      ?.querySelectorAll?.('.composition-layer-item.is-drop-before, .composition-layer-item.is-drop-after')
      .forEach((item) => {
        item.classList.remove('is-drop-before', 'is-drop-after');
      });
  }

  _clearPanelDragFeedback() {
    this._clearPanelDropFeedback();
    this.elements.list
      ?.querySelectorAll?.('.composition-layer-item.is-dragging')
      .forEach(item => item.classList.remove('is-dragging'));
    this.elements.list?.classList.remove('is-reordering');
    this.panelReorderState = null;
  }

  _beginPanelContinuousEdit(layerId, action) {
    if (!layerId || !action) return;
    const key = `${layerId}:${action}`;
    if (this.panelContinuousEdit?.key === key) return;
    this._recordUndo();
    this.panelContinuousEdit = { key };
    window.addEventListener('pointerup', this._clearPanelContinuousEdit, { once: true });
    window.addEventListener('pointercancel', this._clearPanelContinuousEdit, { once: true });
  }

  _clearPanelContinuousEdit() {
    this.panelContinuousEdit = null;
    window.removeEventListener('pointerup', this._clearPanelContinuousEdit);
    window.removeEventListener('pointercancel', this._clearPanelContinuousEdit);
  }

  _handlePanelHeaderPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest?.('button,input,select,textarea')) return;
    const panel = this.elements.panel;
    if (!panel?.classList.contains('open')) return;

    const parent = panel.offsetParent || panel.parentElement || document.body;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect?.() || {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight
    };
    const initialLeft = panelRect.left - parentRect.left;
    const initialTop = panelRect.top - parentRect.top;

    panel.style.left = `${initialLeft}px`;
    panel.style.right = 'auto';
    panel.style.top = `${initialTop}px`;
    panel.classList.add('dragging');

    this.panelDragState = {
      parent,
      startX: event.clientX,
      startY: event.clientY,
      initialLeft,
      initialTop
    };

    event.preventDefault();
    window.addEventListener('pointermove', this._onPanelPointerMove);
    window.addEventListener('pointerup', this._onPanelPointerUp, { once: true });
    window.addEventListener('pointercancel', this._onPanelPointerUp, { once: true });
  }

  _onPanelPointerMove(event) {
    if (!this.panelDragState) return;
    const nextLeft = this.panelDragState.initialLeft + event.clientX - this.panelDragState.startX;
    const nextTop = this.panelDragState.initialTop + event.clientY - this.panelDragState.startY;
    this._setPanelPosition(nextLeft, nextTop);
  }

  _onPanelPointerUp() {
    this.panelDragState = null;
    this.elements.panel?.classList.remove('dragging');
    window.removeEventListener('pointermove', this._onPanelPointerMove);
    window.removeEventListener('pointercancel', this._onPanelPointerUp);
  }

  _handlePanelResizePointerDown(event) {
    if (event.button !== 0) return;
    const panel = this.elements.panel;
    if (!panel?.classList.contains('open')) return;
    const rect = panel.getBoundingClientRect();

    this.panelResizeState = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height
    };

    panel.classList.add('resizing');
    event.preventDefault();
    event.stopPropagation();
    window.addEventListener('pointermove', this._onPanelResizePointerMove);
    window.addEventListener('pointerup', this._onPanelResizePointerUp, { once: true });
    window.addEventListener('pointercancel', this._onPanelResizePointerUp, { once: true });
  }

  _onPanelResizePointerMove(event) {
    if (!this.panelResizeState) return;
    const panel = this.elements.panel;
    if (!panel) return;
    const nextWidth = clamp(
      this.panelResizeState.startWidth + event.clientX - this.panelResizeState.startX,
      260,
      Math.max(300, (window.innerWidth || 640) - 24)
    );
    const nextHeight = clamp(
      this.panelResizeState.startHeight + event.clientY - this.panelResizeState.startY,
      190,
      Math.max(220, (window.innerHeight || 480) - 24)
    );

    panel.style.width = `${nextWidth}px`;
    panel.style.height = `${nextHeight}px`;
    panel.style.maxHeight = 'none';
  }

  _onPanelResizePointerUp() {
    this.panelResizeState = null;
    this.elements.panel?.classList.remove('resizing');
    window.removeEventListener('pointermove', this._onPanelResizePointerMove);
    window.removeEventListener('pointercancel', this._onPanelResizePointerUp);
  }

  _setPanelPosition(left, top) {
    const panel = this.elements.panel;
    if (!panel) return;
    const parent = this.panelDragState?.parent || panel.offsetParent || panel.parentElement || document.body;
    const parentWidth = parent.clientWidth || window.innerWidth;
    const parentHeight = parent.clientHeight || window.innerHeight;
    const margin = 10;
    const maxLeft = Math.max(margin, parentWidth - panel.offsetWidth - margin);
    const maxTop = Math.max(margin, parentHeight - panel.offsetHeight - margin);

    panel.style.left = `${clamp(left, margin, maxLeft)}px`;
    panel.style.top = `${clamp(top, margin, maxTop)}px`;
    panel.style.right = 'auto';
  }

  _handleOverlayPointerDown(event) {
    const preview = event.target.closest?.('.composition-layer-preview');
    if (!preview) return;
    const layer = this.getLayer(preview.dataset.layerId);
    if (!layer) return;

    event.preventDefault();
    this.selectLayer(layer.id);

    const handle = event.target.closest?.('.composition-layer-transform-handle')?.dataset.handle || 'move';
    const overlayRect = this.elements.overlay.getBoundingClientRect();
    this.dragState = {
      layerId: layer.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      overlayWidth: Math.max(1, overlayRect.width),
      overlayHeight: Math.max(1, overlayRect.height),
      layer: { ...layer }
    };
    this._recordUndo();
    window.addEventListener('pointermove', this._onDocumentPointerMove);
    window.addEventListener('pointerup', this._onDocumentPointerUp, { once: true });
  }

  _onDocumentPointerMove(event) {
    if (!this.dragState) return;
    const { layerId, handle, startX, startY, overlayWidth, overlayHeight, layer } = this.dragState;
    const deltaX = (event.clientX - startX) / overlayWidth;
    const deltaY = (event.clientY - startY) / overlayHeight;
    const updates = {};

    if (handle === 'move') {
      updates.x = layer.x + deltaX;
      updates.y = layer.y + deltaY;
      updates.width = layer.width;
      updates.height = layer.height;
    } else {
      Object.assign(updates, resizeLayerRect(layer, handle, deltaX, deltaY, {
        overlayWidth,
        overlayHeight
      }));
    }
    const snapped = snapCompositionLayerRect(updates, {
      thresholdX: Math.max(0.006, 8 / overlayWidth),
      thresholdY: Math.max(0.006, 8 / overlayHeight)
    });
    this._renderSnapGuides(snapped.guides);

    this.updateLayer(layerId, snapped.rect, {
      recordUndo: false,
      renderPanel: false,
      renderTimeline: false,
      emitChange: false,
      scheduleOverlaySync: false
    });
  }

  _onDocumentPointerUp() {
    const layerId = this.dragState?.layerId;
    this.dragState = null;
    window.removeEventListener('pointermove', this._onDocumentPointerMove);
    this._clearSnapGuides();
    if (layerId) {
      this._changed('layerTransformed', { layer: this.getLayer(layerId) }, {
        renderPanel: true,
        renderOverlay: false,
        renderTimeline: true
      });
    }
  }

  _renderSnapGuides(guides = []) {
    const overlay = this.elements.overlay;
    if (!overlay) return;
    this._clearSnapGuides();
    guides.forEach((guide) => {
      const element = document.createElement('span');
      element.className = `composition-layer-snap-guide ${guide.axis === 'x' ? 'vertical' : 'horizontal'}`;
      element.dataset.snapGuide = guide.axis;
      if (guide.axis === 'x') {
        element.style.left = `${guide.position * 100}%`;
      } else {
        element.style.top = `${guide.position * 100}%`;
      }
      overlay.appendChild(element);
    });
  }

  _clearSnapGuides() {
    this.elements.overlay
      ?.querySelectorAll?.('.composition-layer-snap-guide')
      .forEach(guide => guide.remove());
  }

  startTimelineRangeDrag(layerId, mode, startClientX, trackWidth) {
    const layer = this.getLayer(layerId);
    if (!layer || !trackWidth) return false;
    this.timelineDragState = {
      layerId,
      mode,
      startClientX,
      trackWidth,
      startLayer: { ...layer },
      duration: this.getBaseDuration()
    };
    this._recordUndo();
    window.addEventListener('pointermove', this._onTimelinePointerMove);
    window.addEventListener('pointerup', this._onTimelinePointerUp, { once: true });
    return true;
  }

  _onTimelinePointerMove(event) {
    if (!this.timelineDragState) return;
    const { layerId, mode, startClientX, trackWidth, startLayer, duration } = this.timelineDragState;
    const deltaTime = duration > 0 ? ((event.clientX - startClientX) / trackWidth) * duration : 0;
    let range;
    if (mode === 'move') {
      range = moveLayerRange(startLayer, deltaTime);
    } else if (mode === 'start') {
      range = resizeLayerRange(startLayer, 'start', startLayer.startTime + deltaTime);
    } else {
      range = resizeLayerRange(startLayer, 'end', startLayer.endTime + deltaTime);
    }
    this.updateLayer(layerId, range, {
      recordUndo: false,
      renderPanel: false,
      renderOverlay: false,
      emitChange: false,
      scheduleOverlaySync: false
    });
  }

  _onTimelinePointerUp() {
    const layerId = this.timelineDragState?.layerId;
    this.timelineDragState = null;
    window.removeEventListener('pointermove', this._onTimelinePointerMove);
    if (layerId) {
      this._changed('layerRangeUpdated', { layer: this.getLayer(layerId) }, {
        renderPanel: false,
        renderOverlay: true,
        renderTimeline: true
      });
    }
  }

  async _selectMediaFile() {
    if (!this.openFileDialog) return null;
    const result = await this.openFileDialog({
      filters: [
        { name: '이미지/영상', extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] }
      ],
      properties: ['openFile']
    });
    if (result?.canceled || !result?.filePaths?.length) return null;
    return result.filePaths[0];
  }

  async _probeVideoDuration(filePath) {
    if (getCompositionLayerType(filePath) !== 'video') return null;
    if (typeof document === 'undefined') return null;

    return new Promise((resolve) => {
      const video = document.createElement('video');
      let settled = false;
      const finish = (duration = null) => {
        if (settled) return;
        settled = true;
        video.removeAttribute('src');
        video.load?.();
        resolve(duration);
      };
      video.preload = 'metadata';
      video.muted = true;
      video.addEventListener('loadedmetadata', () => finish(video.duration), { once: true });
      video.addEventListener('error', () => finish(null), { once: true });
      setTimeout(() => finish(null), 1200);
      video.src = filePathToFileUrl(filePath);
    });
  }

  _prepareAllLayerMedia() {
    this.layers
      .filter(layer => layer.type === 'video')
      .forEach(layer => {
        void this.prepareLayerMedia(layer.id);
      });
  }

  async _checkMissingFiles() {
    if (!this.fileExists) return;
    await Promise.all(this.layers.map(layer => this._checkMissingFile(layer)));
    this.render();
  }

  async _checkMissingFile(layer) {
    if (!this.fileExists || !layer?.filePath) return;
    try {
      const exists = await this.fileExists(layer.filePath);
      const target = this.getLayer(layer.id);
      if (target) target.missing = exists === false;
    } catch (_) {
      const target = this.getLayer(layer.id);
      if (target) target.missing = false;
    }
  }

  _recordUndo() {
    this.undoSnapshot = cloneLayers(this.layers);
    this.redoSnapshot = null;
  }

  _changed(type, detail = {}, options = {}) {
    this.render({
      panel: options.renderPanel !== false,
      overlay: options.renderOverlay !== false,
      timeline: options.renderTimeline !== false
    });
    this.scheduleOverlaySync({ force: true });
    this._emit('changed', { type, ...detail });
  }

  _emit(name, detail = {}) {
    this.dispatchEvent(makeCompositionEvent(name, detail));
  }
}

export default CompositionLayerManager;
