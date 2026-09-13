const { test } = require('node:test');
const assert = require('node:assert/strict');
for (const pointerType of ['mouse', 'pen', 'touch']) {
  test(`pan captures initial transform and CSS coordinates for ${pointerType}`, async () => {
    const { createVideoPanGesture } = await import('../../renderer/scripts/modules/video-pan-gesture.js');
    const updates = []; const finished = []; const captures = [];
    let transform = { scale: 2, panX: 5, panY: 7 };
    const target = { setPointerCapture: id => captures.push(id), releasePointerCapture: () => gesture.cancel() };
    const gesture = createVideoPanGesture({ canStart: () => true, getTransform: () => transform,
      onChange: v => updates.push(v), onFinish: v => finished.push(v) });
    const base = { pointerId: 3, pointerType, isPrimary: true, button: 0, buttons: 1, currentTarget: target, target,
      preventDefault() {}, stopPropagation() {} };
    gesture.pointerDown({ ...base, clientX: 10, clientY: 20 });
    transform = { scale: 8, panX: 100, panY: 200 };
    gesture.pointerMove({ ...base, clientX: 50, clientY: 40 });
    assert.deepEqual(updates.at(-1), { panX: 25, panY: 17 });
    gesture.pointerUp({ ...base, clientX: 60, clientY: 50 });
    assert.deepEqual(updates.at(-1), { panX: 30, panY: 22 });
    assert.deepEqual(captures, [3]); assert.equal(finished.length, 1);
  });
}
test('secondary pointers, hover, editable controls and disabled pan never own a gesture', async () => {
  const { createVideoPanGesture } = await import('../../renderer/scripts/modules/video-pan-gesture.js');
  let enabled = false; let updates = 0; let ends = 0;
  const gesture = createVideoPanGesture({ canStart: () => enabled, getTransform: () => ({ scale: 1, panX: 0, panY: 0 }), onChange: () => updates++, onFinish: () => ends++ });
  const event = { pointerId: 1, button: 0, isPrimary: true, clientX: 0, clientY: 0 };
  gesture.pointerDown(event); enabled = true;
  gesture.pointerDown({ ...event, isPrimary: false }); gesture.pointerDown({ ...event, button: 2 });
  gesture.pointerDown({ ...event, target: { closest: () => ({}) } });
  gesture.pointerMove({ ...event, buttons: 0, clientX: 20 }); assert.equal(updates, 0);
  gesture.pointerDown(event);
  gesture.pointerMove({ ...event, pointerId: 2, buttons: 1, clientX: 20 });
  gesture.pointerUp({ ...event, pointerId: 2 }); assert.equal(updates, 0); assert.equal(ends, 0);
  gesture.cancel(); gesture.cancel(); assert.equal(ends, 1);
});
