export const MPV_SURFACE_MODE = Object.freeze({
  BLOCK: 'block',
  HTML_MIRROR: 'htmlMirror',
  DEDICATED_MIRROR: 'dedicatedMirror'
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
    '#videoLoadingOverlay.active',
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
    '.split-version-selector.open .split-version-menu',
    '.collaborators-indicator',
    '.playback-sync-panel'
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
    '.scrub-preview-overlay.active',
    '.composition-layer-transform-handle',
    '.composition-layer-snap-guide'
  ].map(selector => Object.freeze({ selector, mode: MPV_SURFACE_MODE.HTML_MIRROR })),
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
  ].map(selector => Object.freeze({ selector, mode: MPV_SURFACE_MODE.DEDICATED_MIRROR }))
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
  MPV_SURFACE_MODE.DEDICATED_MIRROR
]);

function isStyleVisible(element, getStyle) {
  let style;
  try {
    style = getStyle(element);
  } catch (_error) {
    return false;
  }
  if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
  const opacity = Number.parseFloat(style.opacity);
  return !Number.isFinite(opacity) || opacity > 0;
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
      typeof getStyle !== 'function' || !isStyleVisible(element, getStyle)) {
    return false;
  }

  const candidates = [
    element,
    ...Array.from(element.querySelectorAll?.('*') || [])
  ];
  return candidates.some(candidate => (
    candidate &&
    typeof candidate.getBoundingClientRect === 'function' &&
    isStyleVisible(candidate, getStyle) &&
    doesMpvSurfaceRectOverlapHost(candidate.getBoundingClientRect(), hostRect)
  ));
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
