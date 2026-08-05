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

test('collaboration status surfaces use the dedicated collaboration mirror without hiding the native host', async () => {
  const { MPV_SURFACE_MODE, getMpvSurfaceSelectors } = await loadPolicy();
  const blockSelectors = getMpvSurfaceSelectors(MPV_SURFACE_MODE.BLOCK);
  const htmlMirrorSelectors = getMpvSurfaceSelectors(MPV_SURFACE_MODE.HTML_MIRROR);
  const collaborationMirrorSelectors = getMpvSurfaceSelectors(
    MPV_SURFACE_MODE.COLLABORATION_MIRROR
  );

  for (const selector of ['.collaborators-indicator', '.playback-sync-panel']) {
    assert.equal(blockSelectors.includes(selector), false);
    assert.equal(htmlMirrorSelectors.includes(selector), false);
    assert.equal(collaborationMirrorSelectors.includes(selector), true);
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

test('overflow-x clips only the x axis while overflow-y remains visible', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });

  const xClippedChild = fakeElement(rect({ left: 20, top: 20, right: 200, bottom: 180 }));
  const xClippingSurface = fakeElement(
    rect({ left: 20, top: 20, right: 80, bottom: 80 }),
    {
      style: { overflowX: 'hidden', overflowY: 'visible' },
      descendants: [xClippedChild]
    }
  );
  xClippedChild.parentElement = xClippingSurface;
  assert.equal(
    isMpvSurfaceVisiblyOverlappingHost(xClippingSurface, hostRect, getComputedStyle),
    false,
    'the clipped x portion must not block mpv'
  );

  const yOverflowChild = fakeElement(rect({ left: 130, top: 20, right: 190, bottom: 180 }));
  const yVisibleSurface = fakeElement(
    rect({ left: 120, top: 20, right: 200, bottom: 80 }),
    {
      style: { overflowX: 'hidden', overflowY: 'visible' },
      descendants: [yOverflowChild]
    }
  );
  yOverflowChild.parentElement = yVisibleSurface;
  assert.equal(
    isMpvSurfaceVisiblyOverlappingHost(yVisibleSurface, hostRect, getComputedStyle),
    true,
    'visible y overflow must still block mpv when it reaches the host'
  );
});

test('overflow-y clips only the y axis while overflow-x remains visible', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });

  const yClippedChild = fakeElement(rect({ left: 20, top: 20, right: 200, bottom: 180 }));
  const yClippingSurface = fakeElement(
    rect({ left: 20, top: 20, right: 80, bottom: 80 }),
    {
      style: { overflowX: 'visible', overflowY: 'hidden' },
      descendants: [yClippedChild]
    }
  );
  yClippedChild.parentElement = yClippingSurface;
  assert.equal(
    isMpvSurfaceVisiblyOverlappingHost(yClippingSurface, hostRect, getComputedStyle),
    false,
    'the clipped y portion must not block mpv'
  );

  const xOverflowChild = fakeElement(rect({ left: 20, top: 130, right: 200, bottom: 190 }));
  const xVisibleSurface = fakeElement(
    rect({ left: 20, top: 120, right: 80, bottom: 200 }),
    {
      style: { overflowX: 'visible', overflowY: 'hidden' },
      descendants: [xOverflowChild]
    }
  );
  xOverflowChild.parentElement = xVisibleSurface;
  assert.equal(
    isMpvSurfaceVisiblyOverlappingHost(xVisibleSurface, hostRect, getComputedStyle),
    true,
    'visible x overflow must still block mpv when it reaches the host'
  );
});

test('zero-size candidates and clipping ancestors never block mpv', async () => {
  const { isMpvSurfaceVisiblyOverlappingHost } = await loadPolicy();
  const hostRect = rect({ left: 100, top: 100, right: 500, bottom: 400 });

  for (const zeroCandidate of [
    fakeElement(rect({ left: 150, top: 140, right: 150, bottom: 220 })),
    fakeElement(rect({ left: 150, top: 140, right: 220, bottom: 140 }))
  ]) {
    assert.equal(
      isMpvSurfaceVisiblyOverlappingHost(zeroCandidate, hostRect, getComputedStyle),
      false
    );
  }

  const zeroWidthAncestor = fakeElement(
    rect({ left: 150, top: 80, right: 150, bottom: 260 }),
    { style: { overflowX: 'hidden', overflowY: 'visible' } }
  );
  const widthClippedChild = fakeElement(
    rect({ left: 120, top: 120, right: 220, bottom: 220 }),
    { parentElement: zeroWidthAncestor }
  );
  const widthSurface = fakeElement(
    rect({ left: 0, top: 0, right: 20, bottom: 20 }),
    { descendants: [zeroWidthAncestor, widthClippedChild] }
  );
  zeroWidthAncestor.parentElement = widthSurface;
  assert.equal(
    isMpvSurfaceVisiblyOverlappingHost(widthSurface, hostRect, getComputedStyle),
    false
  );

  const zeroHeightAncestor = fakeElement(
    rect({ left: 80, top: 150, right: 260, bottom: 150 }),
    { style: { overflowX: 'visible', overflowY: 'hidden' } }
  );
  const heightClippedChild = fakeElement(
    rect({ left: 120, top: 120, right: 220, bottom: 220 }),
    { parentElement: zeroHeightAncestor }
  );
  const heightSurface = fakeElement(
    rect({ left: 0, top: 0, right: 20, bottom: 20 }),
    { descendants: [zeroHeightAncestor, heightClippedChild] }
  );
  zeroHeightAncestor.parentElement = heightSurface;
  assert.equal(
    isMpvSurfaceVisiblyOverlappingHost(heightSurface, hostRect, getComputedStyle),
    false
  );
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
