const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

async function probe() {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(process.env.BAEFRAME_NATIVE_PROBE_DIR, 'profile'));
  await app.whenReady();
  const { MPVEmbedHost } = require('../../main/mpv-embed-host');
  const { MPVOverlayHost } = require('../../main/mpv-overlay-host');
  const parent = new BrowserWindow({ show: false, x: 100, y: 100, width: 900, height: 700 });
  const options = { BrowserWindow, getMainWindow: () => parent };
  const embed = new MPVEmbedHost(options);
  const overlay = new MPVOverlayHost(options);
  const local = { x: 20, y: 60, width: 640, height: 360 };
  try {
    await parent.loadURL('data:text/html,<body>Native window regression probe</body>');
    parent.showInactive();
    assert.equal((await embed.ensure(local)).success, true);
    assert.equal((await overlay.ensure(local)).success, true);
    for (const [x, y] of [[170, 130], [240, 160], [100, 100]]) {
      parent.setPosition(x, y);
      const origin = parent.getContentBounds();
      for (const host of [embed, overlay]) {
        const actual = host.window.getBounds();
        // Windows DPI conversion may round a native rectangle by one DIP.
        assert.ok(Math.abs(actual.x - origin.x - local.x) <= 1, `immediate x: ${JSON.stringify(actual)}`);
        assert.ok(Math.abs(actual.y - origin.y - local.y) <= 1, `immediate y: ${JSON.stringify(actual)}`);
      }
    }
    overlay.setVisible(false);
    embed.setVisible(false);
    overlay.updateBounds(local);
    assert.equal(overlay.window.isVisible(), false, 'same bounds must keep a menu-uncovered overlay hidden');
    overlay.updateBounds({ ...local, width: 600 });
    parent.setPosition(200, 150);
    assert.equal(overlay.window.isVisible(), false, 'resize/move must preserve hidden native state');
    overlay._setNativeDrawingInput(overlay.window, true);
    assert.equal(overlay.window.isVisible(), false, 'drawing setup cannot resurrect a hidden window');
    overlay.setVisible(true);
    assert.equal(overlay.window.isVisible(), true, 'menu close restores overlay');
    parent.hide();
    overlay.updateBounds(local);
    assert.equal(overlay.window.isVisible(), false, 'hidden parent stays hidden during layout');
    process.stdout.write('NATIVE_WINDOW_PROBE_OK\n');
  } finally {
    overlay.destroy();
    embed.destroy();
    parent.destroy();
  }
}

if (process.versions.electron) {
  probe().then(() => require('electron').app.exit(0), error => {
    process.stderr.write(`${error.stack}\n`);
    require('electron').app.exit(1);
  });
} else {
  const { test } = require('node:test');
  const { spawnSync } = require('node:child_process');
  test('Windows Electron native hosts follow moves immediately and preserve menu visibility', {
    skip: process.platform !== 'win32', timeout: 45000
  }, () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-native-window-'));
    const env = { ...process.env, BAEFRAME_NATIVE_PROBE_DIR: tempDir };
    delete env.ELECTRON_RUN_AS_NODE;
    // Keep probe profiles for diagnosis; they never touch the user's app data.
    const result = spawnSync(require('electron'), [__filename], {
      cwd: path.resolve(__dirname, '../..'), env, encoding: 'utf8', windowsHide: true, timeout: 40000
    });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /NATIVE_WINDOW_PROBE_OK/);
  });
}
