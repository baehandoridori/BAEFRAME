const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8');
const hostSource = fs.readFileSync(path.join(rootDir, 'main/mpv-overlay-host.js'), 'utf8');
const {
  MPVOverlayHost,
  normalizeMpvCollaborationState
} = require('../../main/mpv-overlay-host');

function validBounds(overrides = {}) {
  return { left: 12, top: 18, width: 220, height: 40, ...overrides };
}

function validState(overrides = {}) {
  return {
    revision: 1,
    theme: 'dark',
    indicator: {
      visible: true,
      bounds: validBounds(),
      badge: 'syncing',
      users: [
        { name: ' 한\u0000솔\u202E ', color: '#Aa11Ff', isMe: true, syncActive: true },
        { name: '<img src=x onerror=1>', color: 'red', isMe: false, syncActive: false }
      ]
    },
    plexus: {
      visible: true,
      bounds: validBounds({ top: 66, width: 280, height: 240 }),
      showRemoteCursors: true,
      snapshotDataUrl: 'data:image/png;base64,AA=='
    },
    playback: {
      visible: true,
      bounds: validBounds({ left: 400, top: 280, height: 160 }),
      collapsed: false,
      syncEnabled: true,
      leaderMode: 'lead'
    },
    ...overrides
  };
}

function stateWithRevision(revision, overrides = {}) {
  const state = validState({ revision });
  return {
    ...state,
    ...overrides,
    indicator: { ...state.indicator, ...(overrides.indicator || {}) },
    plexus: { ...state.plexus, ...(overrides.plexus || {}) },
    playback: { ...state.playback, ...(overrides.playback || {}) }
  };
}

async function createGeneratedOverlayHarness() {
  let overlayDom = null;
  const parentListeners = new Map();
  const mainWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
    on: (eventName, handler) => parentListeners.set(eventName, handler),
    off: (eventName, handler) => {
      if (parentListeners.get(eventName) === handler) parentListeners.delete(eventName);
    },
    webContents: {
      isDestroyed: () => false,
      send() {}
    }
  };

  class GeneratedOverlayWindow {
    constructor() {
      this.destroyed = false;
      this.listeners = new Map();
      this.webContents = {
        isDestroyed: () => this.destroyed,
        on() {},
        executeJavaScript: async script => overlayDom.window.eval(script)
      };
    }

    async loadURL(url) {
      const overlayDocument = decodeURIComponent(
        url.replace(/^data:text\/html;charset=utf-8,/, '')
      );
      overlayDom = new JSDOM(overlayDocument, {
        pretendToBeVisual: true,
        runScripts: 'dangerously'
      });
    }

    setBounds() {}
    setIgnoreMouseEvents() {}
    showInactive() {}
    moveTop() {}
    isDestroyed() { return this.destroyed; }
    isVisible() { return true; }
    on(eventName, handler) { this.listeners.set(eventName, handler); }
    destroy() { this.destroyed = true; }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: GeneratedOverlayWindow,
    getMainWindow: () => mainWindow
  });
  const ensured = await host.ensure({ x: 0, y: 0, width: 1280, height: 720 });
  assert.equal(ensured.success, true, ensured.error);
  assert.ok(overlayDom, 'generated overlay document should be loaded');

  return {
    host,
    window: overlayDom.window,
    document: overlayDom.window.document,
    close() {
      host.destroy();
      overlayDom.window.close();
    }
  };
}

function getExactSelectorZIndex(document, selector) {
  for (const styleSheet of document.styleSheets) {
    for (const rule of styleSheet.cssRules) {
      if (rule.selectorText === selector) {
        const zIndex = rule.style.getPropertyValue('z-index').trim();
        if (zIndex) return zIndex;
      }
    }
  }
  return null;
}

test('collaboration state accepts only the exact bounded schema and normalizes untrusted users', () => {
  const normalized = normalizeMpvCollaborationState(validState());
  assert.equal(normalized.indicator.users[0].name, '한솔');
  assert.equal(normalized.indicator.users[0].color, '#aa11ff');
  assert.equal(normalized.indicator.users[1].name, '<img src=x onerror=1>');
  assert.equal(normalized.indicator.users[1].color, '#ffd000');
  assert.equal(normalized.indicator.users.length, 2);

  assert.equal(normalizeMpvCollaborationState(validState({ injected: true })), null);
  assert.equal(normalizeMpvCollaborationState(validState({ theme: 'sepia' })), null);
  assert.equal(normalizeMpvCollaborationState(validState({
    indicator: {
      ...validState().indicator,
      bounds: validBounds({ width: 32769 })
    }
  })), null);
  assert.equal(normalizeMpvCollaborationState(validState({
    indicator: {
      ...validState().indicator,
      bounds: validBounds({ left: Number.POSITIVE_INFINITY })
    }
  })), null);
  const sparseUsers = [];
  sparseUsers.length = 1;
  assert.equal(normalizeMpvCollaborationState(validState({
    indicator: { ...validState().indicator, users: sparseUsers }
  })), null);
  assert.equal(normalizeMpvCollaborationState(validState({
    plexus: {
      visible: true,
      bounds: validBounds(),
      showRemoteCursors: true,
      snapshotDataUrl: 'data:text/html;base64,PHNjcmlwdD4='
    }
  })), null);
  assert.equal(normalizeMpvCollaborationState(validState({
    plexus: {
      ...validState().plexus,
      snapshotDataUrl: `data:image/png;base64,${'A'.repeat(768 * 1024)}`
    }
  })), null);
  assert.equal(normalizeMpvCollaborationState(validState({
    indicator: {
      ...validState().indicator,
      users: [{
        name: 'x'.repeat(1024 * 1024),
        color: '#123456',
        isMe: true,
        syncActive: false
      }]
    }
  })), null);

  const overCapacity = normalizeMpvCollaborationState(validState({
    indicator: {
      ...validState().indicator,
      users: Array.from({ length: 65 }, (_, index) => ({
        name: `user-${index}`,
        color: '#123456',
        isMe: index === 0,
        syncActive: false
      }))
    }
  }));
  assert.equal(overCapacity, null);
});

test('collaboration overlay document uses the fixed z-order and trusted static controls', () => {
  assert.match(hostSource, /#collaborationMirror \{[\s\S]*?z-index: 46;/);
  assert.match(hostSource, /class="mpv-playback-sync-knob"/);
  assert.match(hostSource, /class="mpv-playback-sync-radio-dot"/);
  assert.match(hostSource, /window\.__applyMpvCollaborationState = function applyMpvCollaborationState/);
  const applySource = hostSource.match(
    /window\.__applyMpvCollaborationState = function applyMpvCollaborationState\(state\) \{([\s\S]*?)\n    \};\n\n    let collabRippleAnimationId/
  )?.[1] || '';
  assert.match(applySource, /\.textContent =/);
  assert.doesNotMatch(applySource, /innerHTML/);
  assert.doesNotMatch(hostSource, /collaborationMirror\.innerHTML/);
});

test('collaboration host applies only increasing revisions to the trusted overlay API', async () => {
  const scripts = [];
  const host = new MPVOverlayHost({ BrowserWindow: class {}, getMainWindow: () => null });
  host.window = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async script => {
        scripts.push(script);
        return true;
      }
    }
  };
  host.contentLoaded = true;

  assert.deepEqual(await host.updateCollaborationState(validState({ revision: 4 })), {
    success: true,
    accepted: true
  });
  assert.deepEqual(await host.updateCollaborationState(validState({ revision: 4 })), {
    success: true,
    accepted: false,
    stale: true
  });
  assert.deepEqual(await host.updateCollaborationState(validState({ revision: 3 })), {
    success: true,
    accepted: false,
    stale: true
  });
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /^window\.__applyMpvCollaborationState\(/);
});

test('renderer builds collaboration UI with DOM properties and keeps it out of generic HTML serialization', () => {
  const updateMatch = appSource.match(
    /function updateCollaboratorsUI\(collaborators\) \{([\s\S]*?)\n  \}\n\n  let _plexusStartTimer/
  );
  assert.ok(updateMatch, 'collaborator updater must remain discoverable');
  assert.match(updateMatch[1], /document\.createElement\('div'\)/);
  assert.match(updateMatch[1], /avatar\.textContent = initials/);
  assert.match(updateMatch[1], /collaboratorsAvatars\.replaceChildren/);
  assert.doesNotMatch(updateMatch[1], /innerHTML/);

  const serializer = appSource.match(
    /function serializeMpvOverlayHtml\(\) \{([\s\S]*?)\n  \}/
  );
  assert.ok(serializer);
  assert.match(serializer[1], /MPV_SURFACE_MODE\.HTML_MIRROR/);
  assert.doesNotMatch(serializer[1], /COLLABORATION_MIRROR/);
  assert.match(appSource, /plexus\.visible = plexus\.visible &&\n      plexusElement\?\.classList\.contains\('active'\) === true;/);
});

test('generated collaboration overlay renders real toggle and radio state transitions', async (t) => {
  const harness = await createGeneratedOverlayHarness();
  t.after(() => harness.close());

  const toggle = harness.document.getElementById('mpvPlaybackSyncToggle');
  const toggleLabel = harness.document.getElementById('mpvPlaybackSyncToggleLabel');
  const knob = toggle.querySelector('.mpv-playback-sync-knob');
  const lead = harness.document.getElementById('mpvPlaybackSyncLead');
  const follow = harness.document.getElementById('mpvPlaybackSyncFollow');
  const leadDot = lead.querySelector('.mpv-playback-sync-radio-dot');
  const followDot = follow.querySelector('.mpv-playback-sync-radio-dot');
  assert.ok(knob, 'the generated overlay must contain a real toggle knob element');

  await harness.host.updateCollaborationState(stateWithRevision(10, {
    playback: { syncEnabled: false, leaderMode: 'lead' }
  }));
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.equal(toggleLabel.textContent, '동기화 꺼짐');
  assert.equal(harness.window.getComputedStyle(knob).left, '2px');
  assert.deepEqual(
    [lead, follow].map(element => element.classList.contains('selected')),
    [true, false]
  );
  assert.deepEqual(
    [leadDot, followDot].map(element => harness.window.getComputedStyle(element).display),
    ['block', 'none']
  );

  await harness.host.updateCollaborationState(stateWithRevision(11, {
    playback: { syncEnabled: true, leaderMode: 'follow' }
  }));
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(toggleLabel.textContent, '동기화 켜짐');
  assert.equal(harness.window.getComputedStyle(knob).left, '18px');
  assert.deepEqual(
    [lead, follow].map(element => element.getAttribute('aria-checked')),
    ['false', 'true']
  );
  assert.deepEqual(
    [lead, follow].map(element => element.classList.contains('selected')),
    [false, true]
  );
  assert.deepEqual(
    [leadDot, followDot].map(element => harness.window.getComputedStyle(element).display),
    ['none', 'block']
  );
});

test('generated collaboration overlay preserves badge, plexus and monotonic revision state', async (t) => {
  const harness = await createGeneratedOverlayHarness();
  t.after(() => harness.close());

  const badge = harness.document.getElementById('mpvCollaborationBadge');
  const plexus = harness.document.getElementById('mpvCollaborationPlexus');
  const plexusImage = harness.document.getElementById('mpvCollaborationPlexusImage');
  const expectedBadges = [
    ['idle', '동기화 대기'],
    ['syncing', '동기화 중'],
    ['synced', '동기화 완료'],
    ['error', '동기화 오류']
  ];

  for (const [index, [badgeState, label]] of expectedBadges.entries()) {
    const result = await harness.host.updateCollaborationState(stateWithRevision(20 + index, {
      indicator: { badge: badgeState }
    }));
    assert.deepEqual(result, { success: true, accepted: true });
    assert.equal(badge.dataset.badge, badgeState);
    assert.equal(badge.getAttribute('aria-label'), label);
  }

  const snapshotDataUrl = 'data:image/png;base64,AA==';
  await harness.host.updateCollaborationState(stateWithRevision(24, {
    indicator: { badge: 'synced' },
    plexus: { visible: true, snapshotDataUrl }
  }));
  assert.equal(plexus.style.display, 'block');
  assert.equal(plexusImage.getAttribute('src'), snapshotDataUrl);

  await harness.host.updateCollaborationState(stateWithRevision(25, {
    indicator: { badge: 'idle' },
    plexus: { visible: false, snapshotDataUrl }
  }));
  assert.equal(plexus.style.display, 'none');
  assert.equal(plexusImage.hasAttribute('src'), false);
  assert.equal(badge.dataset.badge, 'idle');

  const stale = await harness.host.updateCollaborationState(stateWithRevision(24, {
    indicator: { badge: 'error' },
    plexus: { visible: true, snapshotDataUrl }
  }));
  assert.deepEqual(stale, { success: true, accepted: false, stale: true });
  assert.equal(plexus.style.display, 'none');
  assert.equal(plexusImage.hasAttribute('src'), false);
  assert.equal(badge.dataset.badge, 'idle');
});

test('generated overlay keeps collaboration between remote cursors and toasts', async (t) => {
  const harness = await createGeneratedOverlayHarness();
  t.after(() => harness.close());

  assert.equal(getExactSelectorZIndex(harness.document, '#remoteCursorMirror'), '45');
  assert.equal(getExactSelectorZIndex(harness.document, '#collaborationMirror'), '46');
  assert.equal(getExactSelectorZIndex(harness.document, '#toastMirror'), '50');
});

test('host sanitizes hostile collaborator values before the generated overlay DOM', async (t) => {
  const harness = await createGeneratedOverlayHarness();
  t.after(() => harness.close());

  const hostileName = '<img id="owned" src=x onerror="window.owned=true">';
  const hostileState = stateWithRevision(30, {
    indicator: {
      users: [{
        name: hostileName,
        color: 'url(javascript:window.owned=true)',
        isMe: false,
        syncActive: false
      }]
    }
  });
  const normalized = normalizeMpvCollaborationState(hostileState);
  assert.equal(normalized.indicator.users[0].color, '#ffd000');

  assert.deepEqual(await harness.host.updateCollaborationState(hostileState), {
    success: true,
    accepted: true
  });
  const avatars = harness.document.getElementById('mpvCollaborationAvatars');
  const avatar = avatars.querySelector('.mpv-collaboration-avatar');
  assert.equal(avatars.querySelector('img'), null);
  assert.equal(harness.document.getElementById('owned'), null);
  assert.equal(harness.window.owned, undefined);
  assert.equal(avatar.textContent, '<i');
  assert.equal(avatar.title, hostileName);
  assert.equal(harness.window.getComputedStyle(avatar).backgroundColor, 'rgb(255, 208, 0)');

  const rejected = await harness.host.updateCollaborationState({
    ...stateWithRevision(31),
    injected: '<style id="owned-style">#collaborationMirror{z-index:9999}</style>'
  });
  assert.deepEqual(rejected, {
    success: false,
    accepted: false,
    error: 'invalid collaboration state'
  });
  assert.equal(avatar.title, hostileName);
  assert.equal(harness.document.getElementById('owned-style'), null);
  assert.equal(getExactSelectorZIndex(harness.document, '#collaborationMirror'), '46');

  const nestedExtraKey = stateWithRevision(31, {
    indicator: {
      users: [{
        name: '공격자',
        color: '#123456',
        isMe: false,
        syncActive: false,
        style: 'position:fixed;inset:0'
      }]
    }
  });
  assert.equal(normalizeMpvCollaborationState(nestedExtraKey), null);
  assert.deepEqual(await harness.host.updateCollaborationState(nestedExtraKey), {
    success: false,
    accepted: false,
    error: 'invalid collaboration state'
  });
  assert.equal(avatars.children.length, 1);
  assert.equal(avatar.title, hostileName);

  const recovered = stateWithRevision(31, {
    indicator: {
      users: [{ name: '정상 사용자', color: '#123456', isMe: true, syncActive: true }]
    }
  });
  assert.deepEqual(await harness.host.updateCollaborationState(recovered), {
    success: true,
    accepted: true
  });
  assert.equal(avatars.children.length, 1);
  assert.equal(avatars.firstElementChild.title, '정상 사용자 (나)');
});
