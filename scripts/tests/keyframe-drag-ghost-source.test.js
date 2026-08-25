const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
let Timeline;

before(async () => {
  ({ Timeline } = await import(pathToFileURL(path.join(
    rootDir,
    'renderer/scripts/modules/timeline.js'
  )).href));
});

test('keyframe drag ghost renders as an exact one-frame cell', () => {
  assert.match(timelineSource, /keyframe-drag-ghost-cell/);
  assert.match(timelineSource, /this\.dragGhost = document\.createElement\('div'\)/);
  assert.match(timelineSource, /const ghostWidthPercent = \(1 \/ this\.totalFrames\) \* 100/);
  assert.match(timelineSource, /Math\.floor\(percent \* this\.totalFrames\)/);
  assert.match(timelineSource, /\(\(targetFrame \+ 0\.5\) \/ this\.totalFrames\) \* 100/);
  assert.doesNotMatch(timelineSource, /Math\.round\(percent \* \(this\.totalFrames - 1\)\)/);
  assert.doesNotMatch(timelineSource, /cloneNode\(true\)/);
  assert.match(mainCss, /\.keyframe-drag-ghost-cell\s*\{[\s\S]*?height:\s*100%;[\s\S]*?outline:\s*2px dashed var\(--accent-primary\);/);
});

test('keyframe drag ghost previews every selected keyframe while dragging', () => {
  assert.match(timelineSource, /this\.dragGhostItems = \[\]/);
  assert.match(timelineSource, /this\.dragSourceElements = \[\]/);
  assert.match(timelineSource, /this\.dragGhostKeyframes = \[\]/);
  assert.match(timelineSource, /_getDragGhostKeyframes\(layerId, frame\)/);
  assert.match(timelineSource, /const ghostKeyframes = this\._getDragGhostKeyframes\(layerId, frame\);/);
  assert.match(timelineSource, /this\.dragGhostKeyframes = ghostKeyframes\.map\(keyframe => \(\{ \.\.\.keyframe \}\)\);/);
  assert.match(timelineSource, /ghostKeyframes\.forEach\(keyframe => \{/);
  assert.match(timelineSource, /ghostCell\.dataset\.sourceFrame = keyframe\.frame;/);
  assert.match(timelineSource, /this\.dragGhostItems\.push\(ghostCell\)/);
  assert.match(timelineSource, /const rawFrameDelta = newFrame - this\.dragStartFrame;/);
  assert.match(timelineSource, /const frameDelta = this\._clampKeyframeDragDelta\(rawFrameDelta\);/);
  assert.match(timelineSource, /this\.dragGhostItems\.forEach\(ghostCell => \{/);
  assert.match(timelineSource, /parseInt\(ghostCell\.dataset\.sourceFrame \|\| '0', 10\) \+ frameDelta/);
  assert.match(timelineSource, /this\.dragSourceElements\.forEach\(element => \{/);
  assert.match(timelineSource, /this\.dragGhostItems\.forEach\(ghost => ghost\.remove\(\)\)/);
  assert.match(
    timelineSource,
    /const keyframesToMove = this\.dragGhostKeyframes\s*\.filter\(kf => this\._isKeyframeLayerMovable\(kf\.layerId, kf\.frame\)\)\s*\.map\(kf => \(/
  );
  const movePayloadIndex = timelineSource.indexOf(
    'const keyframesToMove = this.dragGhostKeyframes'
  );
  assert.ok(
    movePayloadIndex >= 0 &&
      movePayloadIndex < timelineSource.indexOf('this.dragGhostKeyframes = [];', movePayloadIndex),
    'drag ghost keyframes must be cleared after move payload creation'
  );
});

test('keyframe drag ghost clamps group delta before preview and move emit', () => {
  assert.match(timelineSource, /_clampKeyframeDragDelta\(frameDelta\)/);
  assert.match(timelineSource, /const minFrame = Math\.min\(\.\.\.sourceFrames\);/);
  assert.match(timelineSource, /const maxFrame = Math\.max\(\.\.\.sourceFrames\);/);
  assert.match(timelineSource, /const minDelta = -minFrame;/);
  assert.match(timelineSource, /const maxDelta = \(this\.totalFrames - 1\) - maxFrame;/);
  assert.match(timelineSource, /return Math\.max\(minDelta, Math\.min\(maxDelta, frameDelta\)\);/);
  assert.match(timelineSource, /const targetFrame = this\.dragStartFrame \+ frameDelta;/);
  assert.match(timelineSource, /this\.dragGhost\.dataset\.targetFrame = targetFrame;/);
});

test('keyframe drag allows the explicit locked synthetic exception while ordinary locked layers stay blocked', () => {
  const timeline = Object.create(Timeline.prototype);
  timeline._lastDrawingLayers = [
    {
      id: 'fabric-synthetic',
      locked: true,
      timelineKeyframesMovable: true,
      keyframes: [{ frame: 10 }, { frame: 20 }]
    },
    {
      id: 'ordinary-locked',
      locked: true,
      keyframes: [{ frame: 30 }]
    },
    {
      id: 'ordinary-unlocked',
      locked: false,
      keyframes: [{ frame: 40 }]
    }
  ];
  timeline.selectedKeyframes = [
    { layerId: 'fabric-synthetic', frame: 10 },
    { layerId: 'fabric-synthetic', frame: 20 },
    { layerId: 'ordinary-locked', frame: 30 },
    { layerId: 'ordinary-unlocked', frame: 40 }
  ];

  assert.equal(timeline._isKeyframeLayerMovable('fabric-synthetic', 10), true);
  assert.equal(timeline._isKeyframeLayerMovable('ordinary-locked', 30), false);
  assert.deepEqual(timeline._getDragGhostKeyframes('fabric-synthetic', 10), [
    { layerId: 'fabric-synthetic', frame: 10 },
    { layerId: 'fabric-synthetic', frame: 20 },
    { layerId: 'ordinary-unlocked', frame: 40 }
  ]);
});

test('keyframe drag payload excludes stale selections outside the current rendered markers', () => {
  const timeline = Object.create(Timeline.prototype);
  timeline._lastDrawingLayers = [{
    id: 'fabric-synthetic',
    locked: true,
    timelineKeyframesMovable: true,
    keyframes: [{ frame: 10 }, { frame: 20 }]
  }];
  timeline.selectedKeyframes = [
    { layerId: 'fabric-synthetic', frame: 10 },
    { layerId: 'fabric-synthetic', frame: 99 },
    { layerId: 'stale-layer', frame: 10 }
  ];

  assert.deepEqual(timeline._getDragGhostKeyframes('fabric-synthetic', 10), [
    { layerId: 'fabric-synthetic', frame: 10 }
  ]);
  assert.equal(timeline._isKeyframeLayerMovable('stale-layer', 10), false);
  timeline._lastDrawingLayers = null;
  assert.equal(timeline._isKeyframeLayerMovable('fabric-synthetic', 10), false);
});

test('keyframe drag finish drops a selection that became stale during the drag', () => {
  const timeline = Object.create(Timeline.prototype);
  timeline._lastDrawingLayers = [{
    id: 'fabric-synthetic',
    locked: true,
    timelineKeyframesMovable: true,
    keyframes: [{ frame: 20 }]
  }];
  timeline.draggedKeyframe = { layerId: 'stale-layer', frame: 10 };
  timeline.dragStartFrame = 10;
  timeline.dragGhost = {
    dataset: { targetFrame: '15' },
    remove() {}
  };
  timeline.dragGhostItems = [];
  timeline.dragSourceElements = [];
  timeline.dragTooltip = null;
  timeline.dragGhostKeyframes = [
    { layerId: 'stale-layer', frame: 10 },
    { layerId: 'fabric-synthetic', frame: 20 }
  ];
  const emitted = [];
  timeline._emit = (name, detail) => emitted.push({ name, detail });
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { body: { style: {} } };
  globalThis.window = {};
  try {
    timeline._finishKeyframeDrag({});
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assert.deepEqual(emitted, [{
    name: 'keyframesMove',
    detail: {
      keyframes: [{
        layerId: 'fabric-synthetic',
        fromFrame: 20,
        toFrame: 25
      }],
      frameDelta: 5,
      anchor: null
    }
  }]);
});

test('keyframe drag finish drops the old gesture after drawing layers rerender with the same marker identity', () => {
  const timeline = Object.create(Timeline.prototype);
  timeline._lastDrawingLayers = [{
    id: 'fabric-synthetic',
    locked: true,
    timelineKeyframesMovable: true,
    keyframes: [{ frame: 10 }]
  }];
  timeline._drawingLayerRenderRevision = 4;
  timeline.dragDrawingLayerRenderRevision = 4;
  timeline.tracksContainer = { querySelectorAll: () => [] };
  timeline.layerHeaders = { querySelectorAll: () => [] };
  timeline._renderLayerHeader = () => {};
  timeline._renderLayerTrack = () => {};
  timeline._syncFrameGridContainerMetrics = () => {};
  timeline.renderDrawingLayers([{
    id: 'fabric-synthetic',
    locked: true,
    timelineKeyframesMovable: true,
    keyframes: [{ frame: 10 }]
  }], null);

  timeline.draggedKeyframe = { layerId: 'fabric-synthetic', frame: 10 };
  timeline.dragStartFrame = 10;
  timeline.dragGhost = {
    dataset: { targetFrame: '15' },
    remove() {}
  };
  timeline.dragGhostItems = [];
  timeline.dragSourceElements = [];
  timeline.dragTooltip = null;
  timeline.dragGhostKeyframes = [{ layerId: 'fabric-synthetic', frame: 10 }];
  const emitted = [];
  timeline._emit = (name, detail) => emitted.push({ name, detail });
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { body: { style: {} } };
  globalThis.window = {};
  try {
    timeline._finishKeyframeDrag({});
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assert.deepEqual(emitted, []);
});

test('frame cell mode is stored and wired through the timeline toolbar', () => {
  assert.match(userSettingsSource, /frameCellMode: 'auto'/);
  assert.match(userSettingsSource, /getFrameCellMode\(\)/);
  assert.match(userSettingsSource, /setFrameCellMode\(mode\)/);
  assert.match(userSettingsSource, /this\._emit\('frameCellModeChanged', \{ mode \}\)/);
  assert.match(indexSource, /id="btnFrameCellMode"/);
  assert.match(indexSource, /id="frameCellModeBadge"/);
  assert.match(appSource, /FRAME_CELL_MODE_ORDER = \['auto', 'on', 'off'\]/);
  assert.match(appSource, /timeline\.setFrameCellMode\(initFrameCellMode\)/);
  assert.match(appSource, /userSettings\.setFrameCellMode\(next\)/);
});

test('timeline can switch between dot markers and one-frame keyframe cells', () => {
  assert.match(timelineSource, /this\.frameCellMode = 'auto'/);
  assert.match(timelineSource, /this\._frameCellActive = false/);
  assert.match(timelineSource, /setFrameCellMode\(mode\)/);
  assert.match(timelineSource, /_applyCellModeMinZoom\(\)/);
  assert.match(timelineSource, /resolveFrameCellActive\(this\.frameCellMode, tierResult\)/);
  assert.match(timelineSource, /this\._refreshDrawingLayerRender\(\)/);
  assert.match(timelineSource, /marker\.className = `keyframe-cell keyframe-marker-dot/);
  assert.match(timelineSource, /marker\.style\.setProperty\('--kf-color', layer\.color\)/);
  assert.match(timelineSource, /marker\.innerHTML = '<span class="keyframe-cell-dot" aria-hidden="true"><\/span>'/);
  assert.match(mainCss, /\.keyframe-container \.keyframe-cell\s*\{[\s\S]*?width:[\s\S]*?height:\s*100%;/);
  assert.match(mainCss, /\.keyframe-cell \.keyframe-cell-dot/);
});

test('frame cell ON mode recomputes minimum zoom when the timeline viewport resizes', () => {
  const resizeObserverMatch = timelineSource.match(/const resizeObserver = new ResizeObserver\(\(entries\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(resizeObserverMatch, 'timeline ResizeObserver should exist');
  assert.match(resizeObserverMatch[1], /this\._applyCellModeMinZoom\(\)/);
  assert.match(resizeObserverMatch[1], /if \(this\.zoom !== prevZoom\) \{[\s\S]*?this\._applyZoom\(\);/);
});
