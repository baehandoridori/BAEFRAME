const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modulePath = path.resolve(
  __dirname,
  '../../renderer/scripts/modules/mpv-collaboration-retry.js'
);

async function loadRetryModule() {
  return import(`${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`);
}

function createFakeClock() {
  let nextId = 1;
  const timers = new Map();
  const cleared = [];

  return {
    setTimer(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { callback, delayMs });
      return id;
    },
    clearTimer(id) {
      cleared.push(id);
      timers.delete(id);
    },
    run(id = timers.keys().next().value) {
      const timer = timers.get(id);
      assert.ok(timer, `timer ${id} should exist`);
      timers.delete(id);
      timer.callback();
    },
    peek(id = timers.keys().next().value) {
      return timers.get(id) || null;
    },
    ids() {
      return [...timers.keys()];
    },
    get size() {
      return timers.size;
    },
    cleared
  };
}

async function createHarness() {
  const { createMpvCollaborationRetryController } = await loadRetryModule();
  const clock = createFakeClock();
  const ownerA = Object.freeze({ generation: 1 });
  const ownerB = Object.freeze({ generation: 2 });
  let currentOwner = ownerA;
  let currentEpoch = 0;
  let active = true;
  const runs = [];
  const delays = [];
  const controller = createMpvCollaborationRetryController({
    baseDelayMs: 250,
    maxDelayMs: 4000,
    isCurrentFence: (owner, epoch) => owner === currentOwner && epoch === currentEpoch,
    shouldRun: () => active,
    run: (owner, epoch) => {
      runs.push([owner, epoch]);
      return true;
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onSchedule: ({ delayMs }) => delays.push(delayMs)
  });

  return {
    controller,
    clock,
    ownerA,
    ownerB,
    runs,
    delays,
    setFence(owner, epoch) {
      currentOwner = owner;
      currentEpoch = epoch;
    },
    setActive(value) {
      active = value;
    }
  };
}

test('collaboration retry coalesces one fence and backs off to the cap', async () => {
  const harness = await createHarness();
  const { controller, clock, ownerA, delays, runs } = harness;

  assert.equal(controller.recordFailure(ownerA, 0, 1, 'first'), true);
  assert.equal(controller.recordFailure(ownerA, 0, 2, 'newer'), true);
  assert.equal(clock.size, 1, 'same-fence failures must share one timer');
  assert.equal(controller.getState().pending.failedRevision, 2);

  for (let revision = 3; revision <= 7; revision += 1) {
    clock.run();
    assert.deepEqual(runs.at(-1), [ownerA, 0]);
    assert.equal(controller.recordFailure(ownerA, 0, revision, 'persistent'), true);
  }

  assert.deepEqual(delays, [250, 500, 1000, 2000, 4000, 4000]);
  assert.equal(clock.size, 1);
});

test('collaboration retry fences out reversed success and failure settlements', async () => {
  const { controller, clock, ownerA } = await createHarness();

  assert.equal(controller.recordSuccess(ownerA, 0, 2), true);
  assert.equal(controller.recordFailure(ownerA, 0, 1, 'late old failure'), false);
  assert.equal(clock.size, 0, 'R2 success followed by R1 failure must not retry');

  assert.equal(controller.recordFailure(ownerA, 0, 3, 'current failure'), true);
  assert.equal(controller.recordSuccess(ownerA, 0, 2), false);
  assert.equal(clock.size, 1, 'R1/R2 success must not clear a newer R3 failure');
  assert.equal(controller.recordSuccess(ownerA, 0, 4), true);
  assert.equal(clock.size, 0, 'a newer success must clear the pending retry');
  assert.equal(controller.getState().pending, null);
});

test('collaboration retry replaces fences without allowing stale callbacks to cancel the new timer', async () => {
  const harness = await createHarness();
  const { controller, clock, ownerA, ownerB } = harness;

  controller.recordFailure(ownerA, 0, 1, 'owner A');
  const oldTimerId = clock.ids()[0];
  const oldCallback = clock.peek(oldTimerId).callback;

  harness.setFence(ownerB, 0);
  controller.recordFailure(ownerB, 0, 1, 'owner B');
  const ownerBTimerId = clock.ids()[0];
  assert.notEqual(ownerBTimerId, oldTimerId);
  assert.ok(clock.cleared.includes(oldTimerId));

  oldCallback();
  assert.deepEqual(clock.ids(), [ownerBTimerId]);
  assert.equal(controller.cancel(ownerA, 0), false);
  assert.deepEqual(clock.ids(), [ownerBTimerId]);

  harness.setFence(ownerB, 1);
  controller.recordFailure(ownerB, 1, 2, 'new epoch');
  const nextEpochTimerId = clock.ids()[0];
  assert.notEqual(nextEpochTimerId, ownerBTimerId);
  assert.ok(clock.cleared.includes(ownerBTimerId));
  assert.equal(controller.getState().pending.epoch, 1);
});

test('collaboration retry clears without running after mpv mode ends or owned teardown wins', async () => {
  const harness = await createHarness();
  const { controller, clock, ownerA, ownerB, runs } = harness;

  controller.recordFailure(ownerA, 0, 1, 'mode ending');
  harness.setActive(false);
  clock.run();
  assert.equal(runs.length, 0);
  assert.equal(controller.getState().pending, null);

  harness.setActive(true);
  controller.recordFailure(ownerA, 0, 2, 'teardown');
  assert.equal(controller.cancelOwner(ownerB), false, 'stale teardown must not cancel owner A');
  assert.equal(clock.size, 1);
  assert.equal(controller.cancelOwner(ownerA), true);
  assert.equal(clock.size, 0);
  assert.equal(controller.getState().pending, null);

  controller.recordSuccess(ownerA, 0, 3);
  assert.equal(controller.dispose(), true);
  assert.deepEqual(controller.getState(), { pending: null, lastSuccess: null });
});

test('collaboration retry defers again when a retry attempt cannot start', async () => {
  const { controller, clock, ownerA, delays } = await createHarness();

  controller.recordFailure(ownerA, 0, 1, 'first');
  clock.run();
  assert.equal(clock.size, 0);
  assert.equal(controller.defer(ownerA, 0, 'state unavailable'), true);
  assert.equal(clock.size, 1);
  assert.deepEqual(delays, [250, 500]);
});
