export const MPV_SURFACE_MODE = Object.freeze({
  BLOCK: 'block',
  HTML_MIRROR: 'htmlMirror',
  DEDICATED_MIRROR: 'dedicatedMirror',
  COLLABORATION_MIRROR: 'collaborationMirror'
});

// Native mpv is a separate Windows surface, so ordinary DOM z-index cannot place
// these surfaces above it. Keep every policy decision in this one registry:
// interactive surfaces hide mpv, generic visual surfaces are cloned, and
// dedicated mirrors only use the registry to trigger their own serializer.
export const MPV_SURFACE_REGISTRY = Object.freeze([
  ...[
    '.modal-overlay.active',
    '.thread-overlay.open',
    '.image-viewer-overlay.open',
    '.split-view-overlay.open',
    '.prompt-modal-overlay.open',
    '.credits-overlay.active',
    '.codec-error-overlay.active',
    '.app-saving-overlay.active',
    '.transcode-overlay.active',
    '.composition-layer-context-menu',
    '.comment-marker-input-wrapper',
    '.composition-drop-choice-overlay',
    '.video-wrapper.mpv-review-freeze-ready',
    '.marker-popup',
    '.layer-settings-popup',
    '.highlight-popup',
    '.shortcuts-menu.visible',
    '.comment-settings-dropdown.open',
    '.filter-dropdown-menu.open',
    '.mention-dropdown',
    '.recent-dropdown-menu.open',
    '.version-dropdown.open .version-dropdown-menu',
    '.split-version-selector.open .split-version-menu'
  ].map(selector => Object.freeze({ selector, mode: MPV_SURFACE_MODE.BLOCK })),
  ...[
    '.current-cut-overlay',
    '.zoom-indicator-overlay',
    '.fullscreen-timecode-overlay',
    '.fullscreen-scrub-overlay',
    '.composition-layer-panel',
    '.video-zoom-controls',
    '.video-comment-overlay-controls',
    '.video-comment-range-overlay',
    '.composition-layer-transform-handle',
    '.composition-layer-snap-guide'
  ].map(selector => Object.freeze({ selector, mode: MPV_SURFACE_MODE.HTML_MIRROR })),
  Object.freeze({
    selector: '.scrub-preview-overlay.active',
    observeSelector: '.scrub-preview-overlay',
    mode: MPV_SURFACE_MODE.HTML_MIRROR
  }),
  Object.freeze({
    selector: '#videoLoadingOverlay.active',
    observeSelector: '#videoLoadingOverlay',
    mode: MPV_SURFACE_MODE.HTML_MIRROR
  }),
  Object.freeze({
    selector: '.controls-bar',
    observeSelector: 'body.app-fullscreen.show-controls .controls-bar',
    mode: MPV_SURFACE_MODE.HTML_MIRROR
  }),
  ...[
    '.comment-markers-container',
    '.comment-marker',
    '.comment-marker-tooltip',
    '.toast-container',
    '#compositionLayerOverlay'
  ].map(selector => Object.freeze({ selector, mode: MPV_SURFACE_MODE.DEDICATED_MIRROR })),
  ...[
    '.collaborators-indicator',
    '.playback-sync-panel'
  ].map(selector => Object.freeze({ selector, mode: MPV_SURFACE_MODE.COLLABORATION_MIRROR }))
]);

function normalizeModes(modes) {
  return new Set(Array.isArray(modes) ? modes : [modes]);
}

export function getMpvSurfaceSelectors(modes) {
  const requestedModes = normalizeModes(modes);
  return MPV_SURFACE_REGISTRY
    .filter(entry => requestedModes.has(entry.mode))
    .map(entry => entry.selector);
}

function joinMpvSurfaceSelectors(modes) {
  return getMpvSurfaceSelectors(modes).join(',');
}

function joinMpvSurfaceObservationSelectors(modes) {
  const requestedModes = normalizeModes(modes);
  return MPV_SURFACE_REGISTRY
    .filter(entry => requestedModes.has(entry.mode))
    .map(entry => entry.observeSelector || entry.selector)
    .join(',');
}

export const MPV_BLOCKING_OVERLAY_SELECTOR = joinMpvSurfaceSelectors(
  MPV_SURFACE_MODE.BLOCK
);
export const MPV_HTML_MIRROR_OVERLAY_SELECTOR = joinMpvSurfaceSelectors(
  MPV_SURFACE_MODE.HTML_MIRROR
);
export const MPV_MIRRORED_OVERLAY_SELECTOR = joinMpvSurfaceObservationSelectors([
  MPV_SURFACE_MODE.HTML_MIRROR,
  MPV_SURFACE_MODE.DEDICATED_MIRROR,
  MPV_SURFACE_MODE.COLLABORATION_MIRROR
]);
export const MPV_COLLABORATION_MIRROR_OVERLAY_SELECTOR =
  joinMpvSurfaceObservationSelectors(MPV_SURFACE_MODE.COLLABORATION_MIRROR);

function getStyleSafely(element, getStyle, styleCache) {
  if (styleCache.has(element)) return styleCache.get(element);
  let style = null;
  try {
    style = getStyle(element);
  } catch (_error) {
    style = null;
  }
  styleCache.set(element, style);
  return style;
}

function isElementEffectivelyVisible(element, getStyle, styleCache) {
  for (let current = element; current; current = current.parentElement) {
    const style = getStyleSafely(current, getStyle, styleCache);
    if (!style || style.display === 'none' ||
        style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0) return false;
  }
  return true;
}

function intersectRects(rect, clipRect, { clipX = true, clipY = true } = {}) {
  const left = clipX ? Math.max(rect.left, clipRect.left) : rect.left;
  const right = clipX ? Math.min(rect.right, clipRect.right) : rect.right;
  const top = clipY ? Math.max(rect.top, clipRect.top) : rect.top;
  const bottom = clipY ? Math.min(rect.bottom, clipRect.bottom) : rect.bottom;
  if (right <= left || bottom <= top) return null;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function clipsOverflow(value) {
  return ['hidden', 'clip', 'auto', 'scroll'].includes(value);
}

function getElementVisibleRect(element, getStyle, styleCache) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  let visibleRect = element.getBoundingClientRect();
  if (!visibleRect || visibleRect.width <= 0 || visibleRect.height <= 0) return null;

  for (let current = element.parentElement; current; current = current.parentElement) {
    const style = getStyleSafely(current, getStyle, styleCache);
    if (!style || typeof current.getBoundingClientRect !== 'function') continue;
    const overflowX = style.overflowX || style.overflow || 'visible';
    const overflowY = style.overflowY || style.overflow || 'visible';
    if (!clipsOverflow(overflowX) && !clipsOverflow(overflowY)) continue;
    visibleRect = intersectRects(visibleRect, current.getBoundingClientRect(), {
      clipX: clipsOverflow(overflowX),
      clipY: clipsOverflow(overflowY)
    });
    if (!visibleRect) return null;
  }
  return visibleRect;
}

export function doesMpvSurfaceRectOverlapHost(rect, hostRect) {
  if (!rect || !hostRect || rect.width <= 0 || rect.height <= 0 ||
      hostRect.width <= 0 || hostRect.height <= 0) {
    return false;
  }
  return rect.right > hostRect.left &&
    rect.left < hostRect.right &&
    rect.bottom > hostRect.top &&
    rect.top < hostRect.bottom;
}

export function isMpvSurfaceVisiblyOverlappingHost(
  element,
  hostRect,
  getStyle = globalThis.getComputedStyle
) {
  if (!element || typeof element.getBoundingClientRect !== 'function' ||
      typeof getStyle !== 'function') {
    return false;
  }

  const styleCache = new Map();
  const candidates = [
    element,
    ...Array.from(element.querySelectorAll?.('*') || [])
  ];
  return candidates.some(candidate => {
    if (!candidate || typeof candidate.getBoundingClientRect !== 'function' ||
        !isElementEffectivelyVisible(candidate, getStyle, styleCache)) {
      return false;
    }
    const visibleRect = getElementVisibleRect(candidate, getStyle, styleCache);
    return doesMpvSurfaceRectOverlapHost(visibleRect, hostRect);
  });
}

export function findClosestMpvSurface(target, modes) {
  if (!target || typeof target.closest !== 'function') return null;
  const selector = joinMpvSurfaceSelectors(modes);
  return selector ? target.closest(selector) : null;
}

export function getMpvSurfaceElements(root, modes) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const selector = joinMpvSurfaceSelectors(modes);
  return selector ? Array.from(root.querySelectorAll(selector)) : [];
}
