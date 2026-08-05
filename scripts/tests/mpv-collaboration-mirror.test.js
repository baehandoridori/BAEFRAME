const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
