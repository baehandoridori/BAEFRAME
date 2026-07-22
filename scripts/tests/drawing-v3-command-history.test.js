'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createDrawingCommandHistory
} = require('../../renderer/scripts/modules/drawing-v3/drawing-command-history.js');

function command(id, undoValue, redoValue) {
  return {
    id,
    kind: 'add-objects',
    undoState: { value: undoValue },
    redoState: { value: redoValue }
  };
}

test('record undo and redo preserve command order', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  const applied = [];
  assert.equal(history.record({
    id: 'add-1', kind: 'add-objects',
    undoState: { value: 0 }, redoState: { value: 1 }
  }).recorded, true);
  assert.equal(history.undo(state => (applied.push(state.value), { applied: true })).applied, true);
  assert.equal(history.getDiagnostics().redoDepth, 1);
  assert.equal(history.redo(state => (applied.push(state.value), { applied: true })).applied, true);
  assert.deepEqual(applied, [0, 1]);
});

test('new record clears redo but keeps older undo entries', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  const applied = [];

  history.record(command('add-1', 0, 1));
  history.record(command('add-2', 1, 2));
  history.undo(() => ({ applied: true }));

  assert.equal(history.record(command('add-3', 1, 3)).recorded, true);
  const diagnostics = history.getDiagnostics();
  assert.equal(diagnostics.undoDepth, 2);
  assert.equal(diagnostics.redoDepth, 0);
  assert.equal(diagnostics.undoBytes, diagnostics.historyBytes);
  assert.equal(diagnostics.redoBytes, 0);
  history.undo(state => (applied.push(state.value), { applied: true }));
  history.undo(state => (applied.push(state.value), { applied: true }));
  assert.deepEqual(applied, [1, 0]);
  assert.equal(history.redo(() => ({ applied: true })).applied, true);
});

test('failed apply leaves the entry on its original stack', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  history.record(command('add-1', 0, 1));

  assert.deepEqual(history.undo(() => ({ applied: false, reason: 'scene-locked' })), {
    applied: false,
    reason: 'scene-locked'
  });
  assert.equal(history.getDiagnostics().undoDepth, 1);
  assert.equal(history.getDiagnostics().redoDepth, 0);

  history.undo(() => ({ applied: true }));
  assert.deepEqual(history.redo(() => ({ applied: false, reason: 'scene-locked' })), {
    applied: false,
    reason: 'scene-locked'
  });
  assert.equal(history.getDiagnostics().undoDepth, 0);
  assert.equal(history.getDiagnostics().redoDepth, 1);
});

test('throwing apply leaves the entry on its original stack', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  history.record(command('add-1', 0, 1));

  assert.deepEqual(history.undo(() => {
    throw new Error('apply exploded');
  }), {
    applied: false,
    reason: 'apply exploded'
  });
  assert.equal(history.getDiagnostics().undoDepth, 1);
  assert.equal(history.getDiagnostics().redoDepth, 0);
});

test('oldest undo entries are evicted at maxEntries', () => {
  const history = createDrawingCommandHistory({
    maxEntries: 2,
    maxBytes: 4096,
    estimateEntryBytes: () => 1
  });
  const applied = [];

  history.record(command('add-1', 0, 1));
  history.record(command('add-2', 1, 2));
  history.record(command('add-3', 2, 3));

  history.undo(state => (applied.push(state.value), { applied: true }));
  history.undo(state => (applied.push(state.value), { applied: true }));
  assert.deepEqual(applied, [2, 1]);
  assert.deepEqual(history.undo(() => ({ applied: true })), {
    applied: false,
    reason: 'history-empty'
  });
});

test('undo and redo bytes are both included in historyBytes', () => {
  const sizes = new Map([['add-1', 10], ['add-2', 20]]);
  const history = createDrawingCommandHistory({
    maxEntries: 3,
    maxBytes: 4096,
    estimateEntryBytes: entry => sizes.get(entry.id)
  });

  history.record(command('add-1', 0, 1));
  history.record(command('add-2', 1, 2));
  assert.deepEqual(history.getDiagnostics(), {
    undoDepth: 2,
    redoDepth: 0,
    undoBytes: 30,
    redoBytes: 0,
    historyBytes: 30,
    maxEntries: 3,
    maxBytes: 4096
  });

  history.undo(() => ({ applied: true }));
  assert.deepEqual(history.getDiagnostics(), {
    undoDepth: 1,
    redoDepth: 1,
    undoBytes: 10,
    redoBytes: 20,
    historyBytes: 30,
    maxEntries: 3,
    maxBytes: 4096
  });
});

test('one command larger than maxBytes is rejected without changing stacks', () => {
  const history = createDrawingCommandHistory({
    maxEntries: 3,
    maxBytes: 10,
    estimateEntryBytes: entry => entry.id === 'oversized' ? 11 : 4
  });

  history.record(command('add-1', 0, 1));
  history.undo(() => ({ applied: true }));
  const before = history.getDiagnostics();

  assert.deepEqual(history.record(command('oversized', 1, 2)), {
    recorded: false,
    reason: 'history-capacity-exceeded'
  });
  assert.deepEqual(history.getDiagnostics(), before);
});

test('invalid and duplicate command ids are rejected', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });

  for (const id of [undefined, '', 42]) {
    assert.deepEqual(history.record(command(id, 0, 1)), {
      recorded: false,
      reason: 'invalid-command'
    });
  }

  assert.equal(history.record(command('add-1', 0, 1)).recorded, true);
  assert.deepEqual(history.record(command('add-1', 1, 2)), {
    recorded: false,
    reason: 'duplicate-command'
  });
  assert.equal(history.getDiagnostics().undoDepth, 1);
});

test('clear removes both stacks and bytes', () => {
  const history = createDrawingCommandHistory({
    maxEntries: 3,
    maxBytes: 4096,
    estimateEntryBytes: () => 10
  });
  history.record(command('add-1', 0, 1));
  history.record(command('add-2', 1, 2));
  history.undo(() => ({ applied: true }));

  history.clear();

  assert.deepEqual(history.getDiagnostics(), {
    undoDepth: 0,
    redoDepth: 0,
    undoBytes: 0,
    redoBytes: 0,
    historyBytes: 0,
    maxEntries: 3,
    maxBytes: 4096
  });
});
