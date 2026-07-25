'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROBE_PREFIX = '__BAEFRAME_FABRIC_TOOLBAR_LAYOUT__';
const rootDir = path.resolve(__dirname, '../..');

function clusterRows(rectangles, tolerance = 6) {
  const rows = [];
  for (const rect of rectangles.slice().sort((a, b) => a.top - b.top)) {
    const row = rows.find(candidate => Math.abs(candidate - rect.top) <= tolerance);
    if (row === undefined) rows.push(rect.top);
  }
  return rows;
}

function rectanglesOverlap(a, b, tolerance = 0.5) {
  return a.left < b.right - tolerance &&
    a.right > b.left + tolerance &&
    a.top < b.bottom - tolerance &&
    a.bottom > b.top + tolerance;
}

async function runElectronProbe() {
  const { app, BrowserWindow } = require('electron');
  const esbuild = require('esbuild');
  const { MPVOverlayHost } = require('../../main/mpv-overlay-host');
  const tempDir = process.env.BAEFRAME_TOOLBAR_LAYOUT_TEMP_DIR;
  if (!tempDir) throw new Error('layout probe temp directory is missing');
  const bundlePath = path.join(tempDir, 'mpv-fabric-overlay.iife.js');
  let mainWindow = null;
  let host = null;

  try {
    app.setPath('userData', path.join(tempDir, 'user-data'));
    app.commandLine.appendSwitch('disable-gpu');
    esbuild.buildSync({
      entryPoints: [
        path.join(rootDir, 'renderer/scripts/modules/mpv-fabric-overlay-runtime.js')
      ],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'chrome120',
      outfile: bundlePath,
      legalComments: 'eof',
      logLevel: 'silent'
    });

    await app.whenReady();
    mainWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: { sandbox: true }
    });
    await mainWindow.loadURL('data:text/html;charset=utf-8,<body></body>');
    host = new MPVOverlayHost({
      BrowserWindow,
      getMainWindow: () => mainWindow,
      fabricBundlePath: bundlePath,
      logger: { debug() {}, warn() {}, error() {} }
    });
    host.setVisible(false);
    const ensured = await host.ensure({ x: 0, y: 0, width: 400, height: 360 });
    if (ensured.success !== true) throw new Error(`overlay ensure failed: ${ensured.error}`);
    const primed = await host.setDrawingInput({
      hostGeneration: host.hostGeneration,
      videoGeneration: 1,
      inputRevision: 1,
      enabled: false
    });
    if (primed.accepted !== true) {
      throw new Error(`Fabric toolbar generation prime failed: ${JSON.stringify(primed)}`);
    }
    const enabled = await host.setDrawingInput({
      hostGeneration: host.hostGeneration,
      videoGeneration: 1,
      inputRevision: 2,
      enabled: true,
      session: {
        sessionId: 'toolbar-layout-session',
        stableVideoIdentity: 'toolbar-layout-video',
        targetFrame: 12345,
        sourceWidth: 1920,
        sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 400, height: 360 },
        tool: 'select'
      }
    });
    if (enabled.accepted !== true) {
      throw new Error(`Fabric toolbar input activation failed: ${JSON.stringify(enabled)}`);
    }

    await host.window.webContents.executeJavaScript(`
      window.__baeframeToolbarLayoutNode =
        document.querySelector('.mpv-fabric-pilot-toolbar');
      true;
    `, true);

    const widths = [400, 500, 640];
    const measurements = [];
    for (const width of widths) {
      host.updateBounds({ x: 0, y: 0, width, height: 360 });
      await host.window.webContents.executeJavaScript(`
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      `, true);
      const measurement = await host.window.webContents.executeJavaScript(`
        (() => {
          const actions = [
            'brush',
            'select',
            'select-target-stroke',
            'select-target-partial',
            'select-shape-rectangle',
            'select-shape-lasso',
            'undo',
            'redo',
            'delete-selection',
            'clear-session',
            'brush-settings'
          ];
          const rect = element => {
            const value = element.getBoundingClientRect();
            return {
              left: value.left,
              top: value.top,
              right: value.right,
              bottom: value.bottom,
              width: value.width,
              height: value.height
            };
          };
          const root = document.getElementById('root');
          const toolbar = document.querySelector('.mpv-fabric-pilot-toolbar');
          const badge = document.querySelector('.mpv-fabric-pilot-badge');
          const controls = actions.map(action => {
            const element = document.querySelector(
              '[data-fabric-pilot-action="' + action + '"]'
            );
            const style = getComputedStyle(element);
            return {
              action,
              rect: rect(element),
              display: style.display,
              visibility: style.visibility,
              pointerEvents: style.pointerEvents
            };
          });
          const directItems = Array.from(toolbar.children)
            .filter(element =>
              element.dataset.fabricPilotPanel !== 'brush-settings' &&
              getComputedStyle(element).display !== 'none')
            .map(rect);
          const summary = document.querySelector(
            '[data-fabric-pilot-output="summary"]'
          );
          return {
            root: rect(root),
            toolbar: rect(toolbar),
            badge: rect(badge),
            controls,
            directItems,
            summaryDisplay: getComputedStyle(summary).display,
            toolbarCount: document.querySelectorAll(
              '.mpv-fabric-pilot-toolbar'
            ).length,
            sameToolbar:
              window.__baeframeToolbarLayoutNode === toolbar
          };
        })();
      `, true);
      measurements.push({ width, ...measurement });
    }

    const panelMeasurement = await host.window.webContents.executeJavaScript(`
      (async () => {
        document.querySelector(
          '[data-fabric-pilot-action="brush-settings"]'
        ).click();
        await new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = element => {
          const value = element.getBoundingClientRect();
          return {
            left: value.left,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            width: value.width,
            height: value.height
          };
        };
        const root = document.getElementById('root');
        const toolbar = document.querySelector('.mpv-fabric-pilot-toolbar');
        const panel = document.querySelector(
          '[data-fabric-pilot-panel="brush-settings"]'
        );
        return {
          root: rect(root),
          toolbar: rect(toolbar),
          panel: rect(panel),
          overflowY: getComputedStyle(panel).overflowY
        };
      })();
    `, true);

    process.stdout.write(`${PROBE_PREFIX}${JSON.stringify({
      measurements,
      panelMeasurement
    })}\n`);
  } finally {
    try {
      host?.destroy();
    } catch (_error) {}
    try {
      mainWindow?.destroy();
    } catch (_error) {}
    app.exit(0);
  }
}

if (process.versions.electron) {
  runElectronProbe().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    try {
      require('electron').app.exit(1);
    } catch (_exitError) {
      process.exitCode = 1;
    }
  });
} else {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const { spawnSync } = require('node:child_process');

  test('hidden Chromium keeps every Fabric toolbar control usable at 400 500 and 640px', {
    timeout: 45000
  }, () => {
    const electronPath = require('electron');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-toolbar-layout-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.BAEFRAME_TOOLBAR_LAYOUT_TEMP_DIR = tempDir;
    let result;
    let probe;
    try {
      result = spawnSync(electronPath, [__filename], {
        cwd: rootDir,
        encoding: 'utf8',
        env,
        timeout: 40000,
        windowsHide: true
      });
      assert.equal(result.status, 0, [
        'hidden Electron toolbar probe failed',
        result.stdout,
        result.stderr
      ].filter(Boolean).join('\n'));
      const outputLine = result.stdout
        .split(/\r?\n/)
        .find(line => line.startsWith(PROBE_PREFIX));
      assert.ok(outputLine, `layout probe returned no result:\n${result.stdout}\n${result.stderr}`);
      probe = JSON.parse(outputLine.slice(PROBE_PREFIX.length));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    for (const measurement of probe.measurements) {
      const { root, toolbar, controls, directItems } = measurement;
      assert.equal(measurement.toolbarCount, 1, `${measurement.width}px toolbar count`);
      assert.equal(measurement.sameToolbar, true, `${measurement.width}px toolbar identity`);
      assert.equal(measurement.summaryDisplay, 'none', `${measurement.width}px compact summary`);
      assert.ok(toolbar.left >= root.left + 11.5, `${measurement.width}px left inset`);
      assert.ok(toolbar.right <= root.right - 11.5, `${measurement.width}px right inset`);
      assert.ok(toolbar.height <= 100.5, `${measurement.width}px two-row toolbar height`);
      assert.ok(clusterRows(directItems).length <= 2, `${measurement.width}px row count`);

      for (const control of controls) {
        assert.notEqual(control.display, 'none', `${measurement.width}px ${control.action} display`);
        assert.equal(control.visibility, 'visible', `${measurement.width}px ${control.action} visibility`);
        assert.equal(control.pointerEvents, 'auto', `${measurement.width}px ${control.action} pointer`);
        assert.ok(control.rect.width >= 39.5, `${measurement.width}px ${control.action} width`);
        assert.ok(control.rect.height >= 39.5, `${measurement.width}px ${control.action} height`);
        assert.ok(control.rect.left >= root.left - 0.5, `${measurement.width}px ${control.action} left`);
        assert.ok(control.rect.right <= root.right + 0.5, `${measurement.width}px ${control.action} right`);
        assert.ok(control.rect.top >= root.top - 0.5, `${measurement.width}px ${control.action} top`);
        assert.ok(control.rect.bottom <= root.bottom + 0.5, `${measurement.width}px ${control.action} bottom`);
      }

      for (let left = 0; left < controls.length; left += 1) {
        for (let right = left + 1; right < controls.length; right += 1) {
          assert.equal(
            rectanglesOverlap(controls[left].rect, controls[right].rect),
            false,
            `${measurement.width}px ${controls[left].action}/${controls[right].action} overlap`
          );
        }
      }
    }

    const { root, toolbar, panel, overflowY } = probe.panelMeasurement;
    assert.ok(panel.top >= toolbar.bottom + 5.5, 'brush panel starts below wrapped toolbar');
    assert.ok(panel.left >= root.left + 11.5, 'brush panel keeps left inset');
    assert.ok(panel.right <= root.right - 11.5, 'brush panel stays within root width');
    assert.ok(panel.bottom <= root.bottom - 11.5, 'brush panel stays within root height');
    assert.equal(overflowY, 'auto');
  });
}
