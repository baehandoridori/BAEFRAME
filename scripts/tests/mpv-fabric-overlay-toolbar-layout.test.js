'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROBE_PREFIX = '__BAEFRAME_FABRIC_TOOLBAR_LAYOUT__';
const rootDir = path.resolve(__dirname, '../..');

const TOOL_ROW_ACTIONS = new Set(['brush', 'pen', 'eraser', 'shape-menu', 'select']);

function boxesOverlap(a, b, tolerance = 0.5) {
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
    if (process.env.BAEFRAME_TOOLBAR_LAYOUT_FORCE_FAILURE === '1') {
      throw new Error('forced toolbar layout probe failure');
    }
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
      webPreferences: { sandbox: true, backgroundThrottling: false }
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
        targetFrame: 999999999,
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

    const widths = [400, 500, 640, 641, 768, 800, 801];
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
            'pen',
            'eraser',
            'shape-menu',
            'select',
            'select-target-stroke',
            'select-target-partial',
            'select-shape-rectangle',
            'select-shape-lasso',
            'undo',
            'redo',
            'delete-selection',
            'clear-session',
            'toggle-collapse'
          ];
          const toolbar = document.querySelector('.mpv-fabric-pilot-toolbar');
          const sectionProbe = [...document.querySelectorAll('[data-fabric-pilot-section]')].map(node => [
            node.dataset.fabricPilotSection,
            getComputedStyle(node).display,
            Math.round(node.getBoundingClientRect().width)
          ]);
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
          // 스크롤과 무관한 레이아웃 좌표(offset 박스)로 겹침을 검사한다
          const offsetBox = element => {
            let left = 0;
            let top = 0;
            let node = element;
            while (node && node !== toolbar) {
              left += node.offsetLeft;
              top += node.offsetTop;
              node = node.offsetParent;
            }
            return {
              left,
              top,
              right: left + element.offsetWidth,
              bottom: top + element.offsetHeight,
              width: element.offsetWidth,
              height: element.offsetHeight
            };
          };
          const root = document.getElementById('root');
          const header = document.querySelector('.mpv-fabric-pilot-toolbar-header');
          const content = document.querySelector('.mpv-fabric-pilot-toolbar-content');
          const contentStyle = getComputedStyle(content);
          const badge = document.querySelector('.mpv-fabric-pilot-badge');
          const badgeStyle = getComputedStyle(badge);
          const controls = actions.map(action => {
            const element = document.querySelector(
              '[data-fabric-pilot-action="' + action + '"]'
            );
            const style = getComputedStyle(element);
            return {
              action,
              box: offsetBox(element),
              display: style.display,
              visibility: style.visibility,
              pointerEvents: style.pointerEvents
            };
          });
          return {
            sectionProbe,
            root: rect(root),
            toolbar: rect(toolbar),
            toolbarWidth: toolbar.offsetWidth,
            toolbarClientWidth: toolbar.clientWidth,
            headerCursor: getComputedStyle(header).cursor,
            headerTouchAction: getComputedStyle(header).touchAction,
            contentOverflowY: contentStyle.overflowY,
            contentDisplay: contentStyle.display,
            contentScrollHeight: content.scrollHeight,
            contentClientHeight: content.clientHeight,
            collapsed: toolbar.dataset.collapsed,
            badgeDisplay: badgeStyle.display,
            badgeTextOverflow: badgeStyle.textOverflow,
            badgeOverflowX: badgeStyle.overflowX,
            badgeScrollWidth: badge.scrollWidth,
            badgeClientWidth: badge.clientWidth,
            controls,
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

    // 드래그 검증 구간만 height 720으로 올린다. height 360에서는 팔레트 높이
    // (header 41 + content max 70vh = 252 + border 2 = 295) 때문에
    // maxTop = max(12, 360 - 295 - 12) = 53 이라 +80px 드래그가 클램프에 걸려
    // moved.top - start.top 이 41이 되어 단언이 결정적으로 실패한다.
    host.updateBounds({ x: 0, y: 0, width: 801, height: 720 });
    await host.window.webContents.executeJavaScript(`
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    `, true);
    const interaction = await host.window.webContents.executeJavaScript(`
      (async () => {
        const settle = () => new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const toolbar = document.querySelector('.mpv-fabric-pilot-toolbar');
        const header = document.querySelector('.mpv-fabric-pilot-toolbar-header');
        const content = document.querySelector('.mpv-fabric-pilot-toolbar-content');
        const collapseButton = document.querySelector(
          '[data-fabric-pilot-action="toggle-collapse"]'
        );
        const root = document.getElementById('root');
        const fire = (node, type, init) => node.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: 'mouse',
          button: 0,
          ...init
        }));

        collapseButton.click();
        await settle();
        const collapsed = {
          dataset: toolbar.dataset.collapsed,
          contentDisplay: getComputedStyle(content).display,
          height: toolbar.offsetHeight
        };
        collapseButton.click();
        await settle();
        const expanded = {
          dataset: toolbar.dataset.collapsed,
          contentDisplay: getComputedStyle(content).display,
          height: toolbar.offsetHeight
        };

        const start = toolbar.getBoundingClientRect();
        fire(header, 'pointerdown', { clientX: start.left + 40, clientY: start.top + 12 });
        fire(header, 'pointermove', { clientX: start.left + 140, clientY: start.top + 92 });
        fire(header, 'pointerup', { clientX: start.left + 140, clientY: start.top + 92 });
        await settle();
        const moved = toolbar.getBoundingClientRect();

        fire(header, 'pointerdown', { clientX: moved.left + 40, clientY: moved.top + 12 });
        fire(header, 'pointermove', { clientX: moved.left + 4000, clientY: moved.top + 4000 });
        fire(header, 'pointerup', { clientX: moved.left + 4000, clientY: moved.top + 4000 });
        await settle();
        const clamped = toolbar.getBoundingClientRect();

        return {
          collapsed,
          expanded,
          start: { left: start.left, top: start.top },
          moved: { left: moved.left, top: moved.top },
          clamped: {
            left: clamped.left,
            top: clamped.top,
            right: clamped.right,
            bottom: clamped.bottom
          },
          root: {
            left: root.getBoundingClientRect().left,
            top: root.getBoundingClientRect().top,
            right: root.getBoundingClientRect().right,
            bottom: root.getBoundingClientRect().bottom
          },
          rootScrollWidth: root.scrollWidth,
          rootClientWidth: root.clientWidth
        };
      })();
    `, true);

    process.stdout.write(`${PROBE_PREFIX}${JSON.stringify({
      measurements,
      interaction
    })}\n`);
  } finally {
    try {
      host?.destroy();
    } catch (_error) {}
    try {
      mainWindow?.destroy();
    } catch (_error) {}
  }
}

if (process.versions.electron) {
  runElectronProbe().then(
    () => {
      require('electron').app.exit(0);
    },
    error => {
      process.stderr.write(`${error.stack || error.message}\n`);
      try {
        require('electron').app.exit(1);
      } catch (_exitError) {
        process.exitCode = 1;
      }
    }
  );
} else {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const { spawnSync } = require('node:child_process');

  test('hidden Chromium keeps the Fabric drawing palette usable, draggable, and collapsible', {
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
        'hidden Electron palette probe failed',
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

    assert.equal(probe.measurements.length, 7);
    for (const measurement of probe.measurements) {
      const { root, toolbar, controls } = measurement;
      const label = `${measurement.width}px`;
      assert.equal(measurement.toolbarCount, 1, `${label} palette count`);
      assert.equal(measurement.sameToolbar, true, `${label} palette identity`);
      assert.equal(measurement.collapsed, 'false', `${label} palette starts expanded`);
      assert.equal(measurement.headerCursor, 'move', `${label} drag handle cursor`);
      assert.equal(measurement.headerTouchAction, 'none', `${label} drag handle touch-action`);
      assert.equal(measurement.contentDisplay, 'flex', `${label} content visible`);
      assert.equal(measurement.contentOverflowY, 'auto', `${label} content scrolls`);
      assert.ok(
        measurement.contentScrollHeight >= measurement.contentClientHeight,
        `${label} content height (scroll ${measurement.contentScrollHeight} / client ${measurement.contentClientHeight})`
      );

      const expectedWidth = measurement.width <= 800 ? 190 : 220;
      assert.equal(measurement.toolbarWidth, expectedWidth, `${label} palette width`);
      assert.ok(toolbar.left >= root.left + 11.5, `${label} left inset`);
      assert.ok(toolbar.top >= root.top + 11.5, `${label} top inset`);
      assert.ok(toolbar.right <= root.right - 11.5, `${label} right inset`);
      assert.ok(toolbar.bottom <= root.bottom - 11.5, `${label} bottom inset`);

      // 맥락 표시: 이 하네스는 select 도구로 입력을 켠다. 브러시 설정과 지우개
      // 방식은 select 에서 쓸 일이 없으므로 섹션째 숨어야 한다.
      const sectionDisplay = new Map(
        measurement.sectionProbe.map(([id, display]) => [id, display])
      );
      assert.equal(sectionDisplay.get('tools') !== 'none', true, `${label} tools section`);
      assert.equal(sectionDisplay.get('actions') !== 'none', true, `${label} actions section`);
      assert.equal(sectionDisplay.get('brush'), 'none', `${label} brush section hidden for select`);
      assert.equal(sectionDisplay.get('eraser'), 'none', `${label} eraser section hidden for select`);

      assert.equal(measurement.badgeDisplay, 'block', `${label} badge container`);
      assert.equal(measurement.badgeTextOverflow, 'ellipsis', `${label} badge ellipsis`);
      assert.equal(measurement.badgeOverflowX, 'hidden', `${label} badge overflow`);

      for (const control of controls) {
        // 도구 줄은 아이콘 5열 그리드라 텍스트 버튼보다 좁다 —
        // 220px 팔레트에서 약 37px, 190px 에서 약 31px.
        const minimum = control.action === 'toggle-collapse'
          ? 23.5
          : (TOOL_ROW_ACTIONS.has(control.action) ? 28.5 : 39.5);
        assert.notEqual(control.display, 'none', `${label} ${control.action} display`);
        assert.equal(control.visibility, 'visible', `${label} ${control.action} visibility`);
        assert.equal(control.pointerEvents, 'auto', `${label} ${control.action} pointer`);
        assert.ok(control.box.width >= minimum, `${label} ${control.action} width`);
        assert.ok(control.box.height >= minimum, `${label} ${control.action} height`);
        assert.ok(control.box.left >= -0.5, `${label} ${control.action} left`);
        assert.ok(
          control.box.right <= measurement.toolbarClientWidth + 0.5,
          `${label} ${control.action} right (${control.box.right} / ${measurement.toolbarClientWidth})`
        );
      }

      for (let left = 0; left < controls.length; left += 1) {
        for (let right = left + 1; right < controls.length; right += 1) {
          assert.equal(
            boxesOverlap(controls[left].box, controls[right].box),
            false,
            `${label} ${controls[left].action}/${controls[right].action} overlap`
          );
        }
      }
    }

    const { collapsed, expanded, start, moved, clamped, root } = probe.interaction;
    assert.equal(collapsed.dataset, 'true', 'collapse marks the palette');
    assert.equal(collapsed.contentDisplay, 'none', 'collapse hides the palette body');
    assert.ok(collapsed.height <= 60, `collapsed palette height (actual ${collapsed.height}px)`);
    assert.equal(expanded.dataset, 'false', 'second click expands the palette');
    assert.equal(expanded.contentDisplay, 'flex', 'expanded palette body is visible');
    assert.ok(expanded.height > collapsed.height, 'expanded palette is taller than collapsed');

    assert.ok(Math.abs(moved.left - (start.left + 100)) <= 1.5, 'header drag moves the palette right');
    assert.ok(Math.abs(moved.top - (start.top + 80)) <= 1.5, 'header drag moves the palette down');
    assert.ok(clamped.left >= root.left + 11.5, 'clamped palette keeps its left inset');
    assert.ok(clamped.top >= root.top + 11.5, 'clamped palette keeps its top inset');
    assert.ok(clamped.right <= root.right - 11.5, 'clamped palette stays inside the overlay width');
    assert.ok(clamped.bottom <= root.bottom - 11.5, 'clamped palette stays inside the overlay height');
    assert.equal(
      probe.interaction.rootScrollWidth,
      probe.interaction.rootClientWidth,
      'dragging never creates overlay scroll'
    );
  });

  test('hidden Chromium layout probe exits non-zero when its setup fails', {
    timeout: 45000
  }, () => {
    const electronPath = require('electron');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-toolbar-failure-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.BAEFRAME_TOOLBAR_LAYOUT_TEMP_DIR = tempDir;
    env.BAEFRAME_TOOLBAR_LAYOUT_FORCE_FAILURE = '1';
    let result;
    try {
      result = spawnSync(electronPath, [__filename], {
        cwd: rootDir,
        encoding: 'utf8',
        env,
        timeout: 40000,
        windowsHide: true
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    assert.notEqual(result.status, 0, 'failed hidden probe must not report success');
    assert.match(result.stderr, /forced toolbar layout probe failure/);
  });
}
