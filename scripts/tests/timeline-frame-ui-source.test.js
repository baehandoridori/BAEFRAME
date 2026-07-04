const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('playhead position is centered within the current frame cell', () => {
  assert.match(timelineSource, /_getDisplayTotalFrames\(\)/);
  assert.match(timelineSource, /if \(this\.playlistDuration > 0\) \{/);
  assert.match(timelineSource, /const playlistFrames = Math\.floor\(this\.playlistDuration \* \(this\.fps \|\| 0\)\);/);
  assert.match(timelineSource, /const timelineFrames = this\._getTimelineTotalFrames\(\);/);
  assert.match(timelineSource, /if \(timelineFrames > 0\) return timelineFrames;/);
  assert.match(timelineSource, /const derivedFrames = Math\.floor\(duration \* \(this\.fps \|\| 0\)\);/);
  assert.match(timelineSource, /_getFrameMappedSegments\(\)/);
  assert.match(timelineSource, /_getSegmentFrameCount\(segment\)/);
  assert.match(timelineSource, /_getTimelineSegmentTotalFrames\(segments = this\._getFrameMappedSegments\(\)\)/);
  assert.match(timelineSource, /const segmentFrames = this\._getTimelineSegmentTotalFrames\(\);\n    if \(segmentFrames > 0\) return segmentFrames;/);
  assert.match(timelineSource, /_getSegmentTimeFromDisplayFrame\(frame\)/);
  assert.match(timelineSource, /return this\._getSegmentStartTime\(segment\) \+ \(localFrame \/ this\._getSegmentFps\(segment\)\);/);
  assert.match(timelineSource, /_getDisplayFrameFromSegmentTime\(time\)/);
  assert.match(timelineSource, /const localFrame = Math\.floor\(\(\(targetTime - startTime\) \* fps\) \+ 1e-6\);/);
  assert.match(timelineSource, /_getPlayheadFrameCenterPx\(time = this\.currentTime\)/);
  assert.match(timelineSource, /const mappedFrame = this\._getDisplayFrameFromSegmentTime\(time\);/);
  assert.match(timelineSource, /const rawFrame = mappedFrame !== null/);
  assert.match(timelineSource, /Math\.floor\(\(time \* fps\) \+ 1e-6\)/);
  assert.match(timelineSource, /const frame = Math\.max\(0, Math\.min\(totalFrames - 1, rawFrame\)\);/);
  assert.match(timelineSource, /return \(\(frame \+ 0\.5\) \/ totalFrames\) \* containerWidth;/);
  assert.match(timelineSource, /_getTimelineTimeFromCellPercent\(percent\)/);
  assert.match(timelineSource, /Math\.floor\(percent \* totalFrames\)/);
  assert.match(timelineSource, /const mappedTime = this\._getSegmentTimeFromDisplayFrame\(frame\);/);
  assert.match(timelineSource, /if \(mappedTime !== null\) \{\n      return Math\.max\(0, Math\.min\(mappedTime, duration\)\);\n    \}/);
  assert.match(timelineSource, /return \(frame \/ totalFrames\) \* duration;/);
  assert.match(timelineSource, /return frame \/ this\.fps;/);
  assert.match(timelineSource, /const time = this\._getTimelineTimeFromCellPercent\(percent\);/);
  assert.match(timelineSource, /const positionPx = this\._getPlayheadFrameCenterPx\(time\);/);
  assert.match(timelineSource, /const positionPx = this\._getPlayheadFrameCenterPx\(\);/);
  assert.match(timelineSource, /const playheadPx = this\._getPlayheadFrameCenterPx\(\);/);
  assert.match(timelineSource, /const duration = this\._getTimelineDuration\(\);\n    const totalFrames = this\._getDisplayTotalFrames\(\);\n    if \(!this\.tracksContainer \|\| duration === 0 \|\| totalFrames === 0\) \{/);
  assert.match(timelineSource, /_computePxPerFrame\(\) \{\n    const containerWidth = this\.tracksContainer\?\.offsetWidth \|\| 0;\n    const totalFrames = this\._getDisplayTotalFrames\(\);/);
  assert.match(timelineSource, /setPlaylistTimeline\(segments, totalDuration\) \{[\s\S]*?this\._renderPlaylistSegments\(\);\n    this\._updateFrameGrid\(\);/);
  assert.match(timelineSource, /clearPlaylistTimeline\(\) \{[\s\S]*?this\.clearPlaylistCommentRanges\(\);\n    this\._updateFrameGrid\(\);/);
  assert.match(timelineSource, /setCutlistTimeline\(segments, totalDuration\) \{[\s\S]*?this\._renderCutlistSegments\(\);\n    this\._updateFrameGrid\(\);/);
  assert.doesNotMatch(timelineSource, /_computePxPerFrame\(\) \{[\s\S]*?this\._getTimelineTotalFrames\(\) \|\| this\.totalFrames/);
});

test('drawing hold ranges are filled with the layer color', () => {
  assert.match(timelineSource, /rangeBar\.style\.setProperty\('--kf-color', layer\.color\);/);
  assert.doesNotMatch(timelineSource, /rangeBar\.style\.background = '#5a5a5a'/);
  assert.match(mainCss, /\.keyframe-range-bar\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--kf-color, #4a9eff\) 34%, transparent\);/);
  assert.match(mainCss, /\.keyframe-range-bar\s*\{[\s\S]*?box-shadow:\s*inset 1px 0 0 color-mix\(in srgb, var\(--kf-color, #4a9eff\) 70%, transparent\);/);
});

test('frame grid overlay is pinned to the same pixel width as the tracks', () => {
  assert.match(timelineSource, /_syncFrameGridContainerMetrics\(\)/);
  assert.match(timelineSource, /const contentWidth = this\.tracksContainer\.offsetWidth \|\| 0;/);
  assert.match(timelineSource, /this\.frameGridContainer\.style\.width = `\$\{contentWidth\}px`;/);
  assert.match(timelineSource, /this\.frameGridContainer\.style\.height = `\$\{this\._getTrackContentHeight\(\)\}px`;/);
  assert.match(timelineSource, /_getTrackContentHeight\(\)/);
  assert.match(timelineSource, /if \(child === this\.frameGridContainer\) return;/);
  assert.match(timelineSource, /if \(style\.position === 'absolute' \|\| style\.position === 'fixed'\) return;/);
  assert.doesNotMatch(timelineSource, /this\.tracksContainer\.scrollHeight \|\| this\.tracksContainer\.offsetHeight/);
  assert.match(timelineSource, /_setCommentTrackRowHeight\(height = 24\) \{[\s\S]*?this\._syncFrameGridContainerMetrics\(\);[\s\S]*?\n  \}/);
  assert.match(timelineSource, /renderCommentRanges\(comments\) \{[\s\S]*?this\._setCommentTrackRowHeight\(targetHeight\);/);
  assert.match(timelineSource, /renderPlaylistCommentRanges\(ranges, totalDuration\) \{[\s\S]*?this\.commentTrack\.style\.display = 'block';[\s\S]*?this\._syncFrameGridContainerMetrics\(\);/);
  assert.match(timelineSource, /renderHighlights\(highlights\) \{[\s\S]*?this\.tracksContainer\?\.style\.setProperty\('--marker-top-offset', '0px'\);\n      this\._syncFrameGridContainerMetrics\(\);/);
  assert.match(timelineSource, /renderHighlights\(highlights\) \{[\s\S]*?highlights\.forEach\(highlight => \{[\s\S]*?\}\);\n\n    this\._syncFrameGridContainerMetrics\(\);/);
  assert.match(timelineSource, /if \(this\.zoom !== prevZoom\) \{[\s\S]*?this\._applyZoom\(\);[\s\S]*?\}\n\n        this\._syncFrameGridContainerMetrics\(\);/);
  assert.match(timelineSource, /renderCompositionLayers\(layers, options = \{\}\) \{[\s\S]*?sourceLayers[\s\S]*?\.forEach\(\(layer\) => \{[\s\S]*?\}\);\n\n    this\._syncFrameGridContainerMetrics\(\);/);
  assert.match(timelineSource, /layers\.forEach\(\(layer, index\) => \{[\s\S]*?this\._syncFrameGridContainerMetrics\(\);[\s\S]*?\n  \}/);
  assert.match(timelineSource, /_formatGridPx\(value\)/);
  assert.match(timelineSource, /backgroundPosition = '0px 0px';/);
  assert.match(timelineSource, /sizes\.push\(`\$\{this\._formatGridPx\(pxPerFrame\)\} 100%`\);/);
});

test('timeline frame UI source coverage runs with frame grid tests', () => {
  assert.match(packageJson.scripts['test:frame-grid'], /timeline-frame-ui-source\.test\.js/);
});
