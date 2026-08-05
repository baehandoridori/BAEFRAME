const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const policyModulePath = path.resolve(
  __dirname,
  '../../renderer/scripts/modules/mpv-surface-policy.js'
);
const appSource = fs.readFileSync(
  path.resolve(__dirname, '../../renderer/scripts/app.js'),
  'utf8'
);

async function loadPolicy() {
  return import(`${pathToFileURL(policyModulePath).href}?test=${Date.now()}-${Math.random()}`);
}

function rect({ left, top, right, bottom }) {
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function fakeElement(bounds, { style = {}, descendants = [], parentElement = null } = {}) {
  return {
    parentElement,
    getBoundingClientRect() {
      return bounds;
    },
    querySelectorAll() {
      return descendants;
    },
    _style: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      ...style
    }
  };
}

function getComputedStyle(element) {
  return element._style;
}

test('surface registry derives block, observed mirror, and generic HTML mirror selectors', async () => {
  const {
    MPV_SURFACE_MODE,
    MPV_MIRRORED_OVERLAY_SELECTOR,
    MPV_HTML_MIRROR_OVERLAY_SELECTOR,
    MPV_SURFACE_REGISTRY,
    getMpvSurfaceSelectors
  } = await loadPolicy();

  const htmlMirrorSelectors = getMpvSurfaceSelectors(MPV_SURFACE_MODE.HTML_MIRROR);
  assert.ok(htmlMirrorSelectors.includes('.scrub-preview-overlay.active'));
  assert.ok(htmlMirrorSelectors.includes('.composition-layer-transform-handle'));
  assert.ok(htmlMirrorSelectors.includes('.composition-layer-snap-guide'));
  assert.match(MPV_HTML_MIRROR_OVERLAY_SELECTOR, /\.scrub-preview-overlay\.active/);
  assert.match(MPV_MIRRORED_OVERLAY_SELECTOR, /\.comment-marker-tooltip/);
  const scrubPreviewEntry = MPV_SURFACE_REGISTRY.find(
    entry => entry.selector === '.scrub-preview-overlay.active'
  );
  assert.equal(scrubPreviewEntry?.observeSelector, '.scrub-preview-overlay');
  assert.match(MPV_MIRRORED_OVERLAY_SELECTOR, /\.scrub-preview-overlay(?:,|$)/);
});

test('collaboration status surfaces mirror above mpv without hiding the native host', async () => {
  const { MPV_SURFACE_MODE, getMpvSurfaceSelectors } = await loadPolicy();
  const blockSelectors = getMpvSurfaceSelectors(MPV_SURFACE_MODE.BLOCK);
  const htmlMirrorSelectors = getMpvSurfaceSelectors(MPV_SURFACE_MODE.HTML_MIRROR);

  for (const selector of ['.collaborators-indicator', '.playback-sync-panel']) {
    assert.equal(blockSelectors.includes(selector), false);
    assert.equal(htmlMirrorSelectors.includes(selector), true);
  }
});

test('a registered surface blocks mpv when a visible overflow child overlaps the host', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });
  const overflowPanel = fakeElement(rect({ left: 360, top: 90, right: 480, bottom: 240 }));
  const indicator = fakeElement(
    rect({ left: 360, top: 20, right: 480, bottom: 60 }),
    { descendants: [overflowPanel] }
  );
  overflowPanel.parentElement = indicator;

  assert.equal(
    isMpvSurfaceVisiblyOverlappingHost(indicator, hostRect, getComputedStyle),
    true
  );
});

test('hidden, transparent, and non-overlapping surfaces do not block mpv', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });
  const overlappingRect = rect({ left: 120, top: 120, right: 200, bottom: 200 });

  assert.equal(isMpvSurfaceVisiblyOverlappingHost(
    fakeElement(overlappingRect, { style: { display: 'none' } }),
    hostRect,
    getComputedStyle
  ), false);
  assert.equal(isMpvSurfaceVisiblyOverlappingHost(
    fakeElement(overlappingRect, { style: { opacity: '0' } }),
    hostRect,
    getComputedStyle
  ), false);
  assert.equal(isMpvSurfaceVisiblyOverlappingHost(
    fakeElement(rect({ left: 0, top: 0, right: 40, bottom: 40 })),
    hostRect,
    getComputedStyle
  ), false);
});

test('a descendant hidden by an ancestor cannot block mpv', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });
  for (const style of [
    { display: 'none' },
    { visibility: 'hidden' },
    { opacity: '0' }
  ]) {
    const ancestor = fakeElement(
      rect({ left: 300, top: 80, right: 480, bottom: 200 }),
      { style }
    );
    const child = fakeElement(
      rect({ left: 320, top: 120, right: 470, bottom: 160 }),
      { parentElement: ancestor }
    );
    const surface = fakeElement(
      rect({ left: 300, top: 20, right: 480, bottom: 60 }),
      { descendants: [ancestor, child] }
    );
    ancestor.parentElement = surface;
    assert.equal(
      isMpvSurfaceVisiblyOverlappingHost(surface, hostRect, getComputedStyle),
      false
    );
  }
});

test('an overflow-clipped descendant outside the visible ancestor bounds cannot block mpv', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });
  for (const overflow of ['hidden', 'clip', 'auto', 'scroll']) {
    const ancestor = fakeElement(
      rect({ left: 300, top: 20, right: 480, bottom: 60 }),
      { style: { overflow, overflowX: overflow, overflowY: overflow } }
    );
    const child = fakeElement(
      rect({ left: 320, top: 20, right: 470, bottom: 240 }),
      { parentElement: ancestor }
    );
    const surface = fakeElement(
      rect({ left: 300, top: 20, right: 480, bottom: 60 }),
      { descendants: [ancestor, child] }
    );
    ancestor.parentElement = surface;
    assert.equal(
      isMpvSurfaceVisiblyOverlappingHost(surface, hostRect, getComputedStyle),
      false
    );
  }
});

test('surface lookup finds the containing registered block surface', async () => {
  const { MPV_SURFACE_MODE, findClosestMpvSurface } = await loadPolicy();
  const modal = { id: 'modal' };
  const eventTarget = {
    closest(selector) {
      return selector.includes('.modal-overlay.active') ? modal : null;
    }
  };

  assert.equal(findClosestMpvSurface(eventTarget, MPV_SURFACE_MODE.BLOCK), modal);
});

test('app consumes the registry for blocking, observation, serialization, and motion rechecks', () => {
  assert.match(appSource, /from '\.\/modules\/mpv-surface-policy\.js';/);
  assert.match(appSource, /getMpvSurfaceElements\(document, MPV_SURFACE_MODE\.BLOCK\)/);
  assert.match(appSource, /getMpvSurfaceElements\(document, MPV_SURFACE_MODE\.HTML_MIRROR\)\.forEach/);
  assert.doesNotMatch(appSource, /const MPV_BLOCKING_OVERLAY_SELECTOR = \[/);
  assert.doesNotMatch(appSource, /const MPV_MIRRORED_OVERLAY_SELECTOR = \[/);
  assert.match(appSource, /\['transitionrun', 'transitionstart', 'animationstart'\]/);
  assert.match(appSource, /\['transitionend', 'transitioncancel', 'animationend', 'animationcancel'\]/);
  assert.match(appSource, /recheckMpvBlockingSurfaceDuringMotion/);
});
