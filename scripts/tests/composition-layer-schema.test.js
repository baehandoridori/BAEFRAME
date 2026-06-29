const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function importShared(relativePath) {
  return import(pathToFileURL(path.join(__dirname, '../..', relativePath)).href);
}

test('default bframe data includes composition layer storage', async () => {
  const { createDefaultBframeData } = await importShared('shared/schema.js');

  const data = createDefaultBframeData({ videoPath: 'C:/shot/base.mp4' });

  assert.deepEqual(data.compositionLayers, []);
});

test('review validator accepts valid composition layers', async () => {
  const { validateReviewData } = await importShared('shared/validators.js');

  const result = validateReviewData({
    bframeVersion: '2.0',
    videoFile: 'base.mp4',
    videoPath: 'C:/shot/base.mp4',
    fps: 24,
    comments: { layers: [] },
    drawings: { layers: [] },
    highlights: [],
    compositionLayers: [
      {
        id: 'composition_1',
        name: 'overlay.mov',
        type: 'video',
        filePath: 'C:/shot/overlay.mov',
        enabled: true,
        order: 0,
        startTime: 1,
        endTime: 5,
        opacity: 0.5,
        x: -0.2,
        y: 0.1,
        width: 0.5,
        height: 0.5,
        aspectLocked: false,
        color: '#ffcc00',
        selectedColor: '#fff2a8',
        sourceDuration: 4
      }
    ]
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('review validator rejects invalid composition layer fields', async () => {
  const { validateReviewData } = await importShared('shared/validators.js');

  const result = validateReviewData({
    bframeVersion: '2.0',
    videoFile: 'base.mp4',
    videoPath: 'C:/shot/base.mp4',
    fps: 24,
    comments: { layers: [] },
    drawings: { layers: [] },
    highlights: [],
    compositionLayers: [
      {
        id: '',
        name: '',
        type: 'audio',
        filePath: '',
        enabled: 'true',
        order: Number.NaN,
        startTime: 3,
        endTime: 2,
        opacity: 2,
        width: 0,
        height: -1,
        aspectLocked: 'yes',
        color: 'yellow',
        selectedColor: '#12'
      }
    ]
  });

  const errors = result.errors.join('\n');
  assert.equal(result.valid, false);
  assert.match(errors, /compositionLayers\[0\].*id/);
  assert.match(errors, /compositionLayers\[0\].*name/);
  assert.match(errors, /compositionLayers\[0\].*type/);
  assert.match(errors, /compositionLayers\[0\].*filePath/);
  assert.match(errors, /compositionLayers\[0\].*enabled/);
  assert.match(errors, /compositionLayers\[0\].*order/);
  assert.match(errors, /compositionLayers\[0\].*endTime/);
  assert.match(errors, /compositionLayers\[0\].*opacity/);
  assert.match(errors, /compositionLayers\[0\].*width/);
  assert.match(errors, /compositionLayers\[0\].*height/);
  assert.match(errors, /compositionLayers\[0\].*aspectLocked/);
  assert.match(errors, /compositionLayers\[0\].*color/);
  assert.match(errors, /compositionLayers\[0\].*selectedColor/);
});
