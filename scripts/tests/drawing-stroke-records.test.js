const { test } = require('node:test');
const assert = require('node:assert/strict');

let strokeRecords;

test('drawing stroke helper module loads', async () => {
  strokeRecords = await import('../../renderer/scripts/modules/drawing-stroke-records.js');
});

test('eraser mode defaults to pixel for unknown values', () => {
  assert.equal(strokeRecords.normalizeEraserMode(), strokeRecords.ERASER_MODES.PIXEL);
  assert.equal(strokeRecords.normalizeEraserMode('bad-value'), strokeRecords.ERASER_MODES.PIXEL);
  assert.equal(strokeRecords.normalizeEraserMode('stroke'), strokeRecords.ERASER_MODES.STROKE);
});

test('recordable stroke copies points and style fields', () => {
  const points = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  const record = strokeRecords.createStrokeRecord({
    tool: 'brush',
    points,
    color: '#ff0000',
    lineWidth: 7,
    opacity: 0.5,
    strokeEnabled: true,
    strokeWidth: 2,
    strokeColor: '#ffffff'
  });

  assert.equal(record.tool, 'brush');
  assert.equal(record.color, '#ff0000');
  assert.equal(record.lineWidth, 7);
  assert.equal(record.opacity, 0.5);
  assert.equal(record.strokeEnabled, true);
  assert.equal(record.strokeWidth, 2);
  assert.equal(record.strokeColor, '#ffffff');
  assert.deepEqual(record.points, points);
  assert.notEqual(record.points, points);
});

test('stroke eraser removes every stroke intersecting the eraser path', () => {
  const strokes = [
    { id: 'a', tool: 'pen', lineWidth: 2, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
    { id: 'b', tool: 'brush', lineWidth: 4, points: [{ x: 5, y: 5 }, { x: 25, y: 5 }] },
    { id: 'c', tool: 'pen', lineWidth: 2, points: [{ x: 40, y: 40 }, { x: 50, y: 50 }] }
  ];

  const result = strokeRecords.removeIntersectingStrokes(
    strokes,
    [{ x: 10, y: -3 }, { x: 10, y: 8 }],
    6
  );

  assert.deepEqual(result.removed.map(record => record.id), ['a', 'b']);
  assert.deepEqual(result.remaining.map(record => record.id), ['c']);
});

test('stroke eraser ignores strokes outside the eraser radius', () => {
  const strokes = [
    { id: 'far', tool: 'pen', lineWidth: 2, points: [{ x: 100, y: 100 }, { x: 120, y: 100 }] }
  ];

  const result = strokeRecords.removeIntersectingStrokes(
    strokes,
    [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    5
  );

  assert.equal(result.removed.length, 0);
  assert.equal(result.remaining.length, 1);
});

test('keyframe JSON preserves stroke metadata for reopen', async () => {
  const { Keyframe } = await import('../../renderer/scripts/modules/drawing-layer.js');
  const json = {
    frame: 12,
    canvasData: 'data:image/png;base64,composited',
    isEmpty: false,
    baseCanvasData: 'data:image/png;base64,base',
    strokeRecords: [
      {
        id: 'stroke-1',
        tool: 'pen',
        points: [{ x: 1, y: 1 }, { x: 4, y: 4 }],
        lineWidth: 3,
        color: '#ff4757',
        opacity: 1
      }
    ]
  };

  const keyframe = Keyframe.fromJSON(json);
  assert.equal(keyframe.baseCanvasData, json.baseCanvasData);
  assert.equal(keyframe.strokeRecords[0].id, 'stroke-1');
  assert.equal(keyframe.strokeRecords[0].tool, 'pen');
  assert.deepEqual(keyframe.strokeRecords[0].points, json.strokeRecords[0].points);
  assert.equal(keyframe.strokeRecords[0].strokeEnabled, false);
  assert.equal(keyframe.toJSON().strokeRecords[0].id, 'stroke-1');
  assert.deepEqual(keyframe.toJSON().strokeRecords[0].points, json.strokeRecords[0].points);
});
