const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modulePath = path.resolve(
  __dirname,
  '../../renderer/scripts/modules/mpv-overlay-collaboration-action-relay.js'
);

async function loadRelayModule() {
  return import(`${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`);
}

function makeSnapshot(overrides = {}) {
  return {
    state: 'active',
    enabled: true,
    hostGeneration: 3,
    videoGeneration: 7,
    inputRevision: 11,
    desiredInputEnabled: true,
    sessionId: 'fabric-session-current',
    ...overrides
  };
}

function makeMessage(action, overrides = {}) {
  return {
    action,
    payload: null,
    hostGeneration: 3,
    videoGeneration: 7,
    inputRevision: 11,
    activeSessionId: 'fabric-session-current',
    sequence: 1,
    ...overrides
  };
}

test('renderer collaboration relay accepts only the current active fence and increasing sequence', async () => {
  const { createMpvOverlayCollaborationActionRelay } = await loadRelayModule();
  let snapshot = makeSnapshot();
  const calls = [];
  const relay = createMpvOverlayCollaborationActionRelay({
    getStatusSnapshot: () => ({ ...snapshot }),
    getVideoWrapperRect: () => ({ left: 40, top: 70, width: 640, height: 360 }),
    actions: {
      setPlaybackSyncPanelVisible(visible) {
        calls.push(['visible', visible]);
      },
      setPlaybackSyncLeaderMode(mode) {
        calls.push(['mode', mode]);
      }
    }
  });

  assert.equal(relay.apply(makeMessage('collab.open-sync')), true);
  assert.deepEqual(calls, [['visible', true]]);
  assert.equal(relay.apply(makeMessage('sync.close', { sequence: 1 })), false,
    'duplicate sequence must be ignored');
  assert.equal(relay.apply(makeMessage('sync.follow', { sequence: 0 })), false,
    'reverse sequence must be ignored');
  assert.equal(relay.apply(makeMessage('sync.follow', { sequence: 2 })), true);
  assert.deepEqual(calls.at(-1), ['mode', 'follow']);

  for (const staleField of ['hostGeneration', 'videoGeneration', 'inputRevision', 'activeSessionId']) {
    assert.equal(relay.apply(makeMessage('sync.lead', {
      sequence: 3,
      [staleField]: staleField === 'activeSessionId' ? 'stale-session' : 999
    })), false);
  }
  snapshot = makeSnapshot({ desiredInputEnabled: false });
  assert.equal(relay.apply(makeMessage('sync.lead', { sequence: 3 })), false);
  snapshot = makeSnapshot({ state: 'preparing' });
  assert.equal(relay.apply(makeMessage('sync.lead', { sequence: 3 })), false);
  assert.equal(calls.length, 2);
});

test('renderer collaboration sequence resets only after a matching new current fence', async () => {
  const { createMpvOverlayCollaborationActionRelay } = await loadRelayModule();
  let snapshot = makeSnapshot();
  const calls = [];
  const relay = createMpvOverlayCollaborationActionRelay({
    getStatusSnapshot: () => ({ ...snapshot }),
    getVideoWrapperRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
    actions: {
      setPlaybackSyncLeaderMode(mode) {
        calls.push(mode);
      }
    }
  });
  assert.equal(relay.apply(makeMessage('sync.lead', { sequence: 8 })), true);

  const unconfirmedNewFence = makeMessage('sync.follow', {
    inputRevision: 12,
    activeSessionId: 'fabric-session-new',
    sequence: 1
  });
  assert.equal(relay.apply(unconfirmedNewFence), false);
  assert.equal(relay.apply(makeMessage('sync.follow', { sequence: 7 })), false,
    'an unconfirmed fence must not reset the previous sequence');

  snapshot = makeSnapshot({ inputRevision: 12, sessionId: 'fabric-session-new' });
  assert.equal(relay.apply(unconfirmedNewFence), true);
  assert.deepEqual(calls, ['lead', 'follow']);
});

test('renderer collaboration relay converts overlay-local drag coordinates to main client coordinates', async () => {
  const { createMpvOverlayCollaborationActionRelay } = await loadRelayModule();
  const calls = [];
  const relay = createMpvOverlayCollaborationActionRelay({
    getStatusSnapshot: () => makeSnapshot(),
    getVideoWrapperRect: () => ({ left: 40, top: 70, width: 640, height: 360 }),
    actions: {
      startPlaybackSyncPanelDrag(payload) {
        calls.push(['start', payload]);
      },
      movePlaybackSyncPanelDrag(payload) {
        calls.push(['move', payload]);
      },
      endPlaybackSyncPanelDrag(payload) {
        calls.push(['end', payload]);
      },
      cancelPlaybackSyncPanelDrag(payload) {
        calls.push(['cancel', payload]);
      }
    }
  });

  assert.equal(relay.apply(makeMessage('sync.drag-start', {
    payload: { pointerId: 5, clientX: 100, clientY: 80 },
    sequence: 1
  })), true);
  assert.equal(relay.apply(makeMessage('sync.drag-move', {
    payload: { pointerId: 5, clientX: -20, clientY: 500 },
    sequence: 2
  })), true);
  assert.equal(relay.apply(makeMessage('sync.drag-end', {
    payload: { pointerId: 5, clientX: 900, clientY: -30 },
    sequence: 3
  })), true);
  assert.equal(relay.apply(makeMessage('sync.drag-cancel', {
    payload: { pointerId: 5 },
    sequence: 4
  })), true);
  assert.deepEqual(calls, [
    ['start', { pointerId: 5, clientX: 140, clientY: 150 }],
    ['move', { pointerId: 5, clientX: 20, clientY: 570 }],
    ['end', { pointerId: 5, clientX: 940, clientY: 40 }],
    ['cancel', { pointerId: 5 }]
  ]);

  assert.equal(relay.apply(makeMessage('sync.drag-move', {
    payload: { pointerId: 5, clientX: 32769, clientY: 10 },
    sequence: 5
  })), false,
  'coordinates outside the finite IPC bound must be rejected');
});

test('renderer collaboration relay maps every semantic action to the authoritative named handler', async () => {
  const { createMpvOverlayCollaborationActionRelay } = await loadRelayModule();
  const calls = [];
  const actionHandlers = {
    handleCollaborationIndicatorEnter: () => calls.push('indicator-enter'),
    handleCollaborationIndicatorLeave: () => calls.push('indicator-leave'),
    handleCollaborationPanelEnter: () => calls.push('panel-enter'),
    handleCollaborationPanelLeave: () => calls.push('panel-leave'),
    showCollaborationSyncStatus: () => calls.push('sync-status'),
    toggleRemoteCollaboratorCursors: () => calls.push('cursor-toggle'),
    setPlaybackSyncPanelVisible: visible => calls.push(`visible:${visible}`),
    togglePlaybackSyncEnabled: () => calls.push('sync-toggle'),
    setPlaybackSyncLeaderMode: mode => calls.push(`mode:${mode}`),
    togglePlaybackSyncPanelCollapsed: () => calls.push('collapse')
  };
  const relay = createMpvOverlayCollaborationActionRelay({
    getStatusSnapshot: () => makeSnapshot(),
    getVideoWrapperRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
    actions: actionHandlers
  });
  const actions = [
    'collab.indicator-enter', 'collab.indicator-leave',
    'collab.panel-enter', 'collab.panel-leave',
    'collab.sync-status', 'collab.cursor-toggle', 'collab.open-sync',
    'sync.toggle', 'sync.lead', 'sync.follow', 'sync.collapse', 'sync.close'
  ];
  actions.forEach((action, index) => {
    assert.equal(relay.apply(makeMessage(action, { sequence: index + 1 })), true, action);
  });
  assert.deepEqual(calls, [
    'indicator-enter', 'indicator-leave', 'panel-enter', 'panel-leave',
    'sync-status', 'cursor-toggle', 'visible:true', 'sync-toggle',
    'mode:lead', 'mode:follow', 'collapse', 'visible:false'
  ]);
});
