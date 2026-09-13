const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeViewportPanMessage: message, normalizeViewportPanCommand: command } = require('../../shared/viewport-pan-message');
const fence = { gestureId: 'g', sequence: 0, pointerId: 3, hostGeneration: 1, videoGeneration: 2, persistenceSessionId: 's', stableVideoIdentity: 'v' };
const start = { ...fence, phase: 'start', clientX: 10, clientY: 20 };
test('pan IPC accepts exact bounded messages and preserves actual zero', () => {
  assert.deepEqual(message(start), start);
  assert.equal(message({ ...start, clientX: 0 }).clientX, 0);
  for (const phase of ['move', 'end', 'cancel']) assert.ok(message({ ...start, phase, sequence: 1 }));
});
test('pan IPC rejects malformed and privileged payloads', () => {
  for (const patch of [{ extra: true }, { phase: 'draw' }, { sequence: 1 }, { pointerId: -1 }, { hostGeneration: -1 }, { videoGeneration: 0.5 }, { sequence: Number.MAX_SAFE_INTEGER + 1 }, { clientX: NaN }, { clientY: Infinity }, { clientX: 1000001 }, { persistenceSessionId: '' }, { stableVideoIdentity: 'v'.repeat(32769) }, { gestureId: 'g'.repeat(257) }]) assert.equal(message({ ...start, ...patch }), null);
  for (const value of [null, [], Object.assign(Object.create({}), start)]) assert.equal(message(value), null);
});
test('pan command has strict per-type keys and zoom bounds', () => {
  const transform = { scale: 2, panX: 0, panY: 1 };
  for (const disposition of ['pan', 'draw', 'blocked']) assert.ok(command({ ...fence, type: 'decision', disposition, transform }));
  assert.ok(command({ ...fence, type: 'ack', transform }));
  assert.ok(command({ ...fence, type: 'cancel', transform }));
  assert.equal(command({ ...fence, type: 'cancel' }), null);
  for (const type of ['flush']) {
    assert.ok(command({ ...fence, type }));
    assert.equal(command({ ...fence, type, transform }), null);
  }
  for (const scale of [0, -1, 0.24, 8.1, NaN, Infinity]) assert.equal(command({ ...fence, type: 'ack', transform: { ...transform, scale } }), null);
  assert.equal(command({ ...fence, type: 'ack', transform: { ...transform, extra: 1 } }), null);
});
