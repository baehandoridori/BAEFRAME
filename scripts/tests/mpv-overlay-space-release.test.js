'use strict';

// 그리기 중 오버레이 창이 키보드 포커스를 가진 채 Space 를 눌렀다 뗐을 때, 메인 창이
// "누름"과 "뗌"을 둘 다 받는지 실제 Chromium 으로 확인한다.
//
// 가짜 이벤트를 쓰는 단위 테스트로는 이 결함을 잡을 수 없다. Chromium 은 브라우저 쪽이
// 삼킨(before-input-event 에서 preventDefault 한) 누름 뒤의 뗌을 아예 내보내지 않는데,
// 단위 테스트는 그 뗌을 손으로 만들어 넣기 때문이다.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROBE_PREFIX = '__BAEFRAME_OVERLAY_SPACE_RELEASE__';
const KEYBOARD_CHANNEL = 'mpv-overlay:keyboard-input';
const rootDir = path.resolve(__dirname, '../..');

async function runElectronProbe() {
  const { app, BrowserWindow } = require('electron');
  const esbuild = require('esbuild');
  const { MPVOverlayHost } = require('../../main/mpv-overlay-host');
  const tempDir = process.env.BAEFRAME_SPACE_RELEASE_TEMP_DIR;
  if (!tempDir) throw new Error('space release probe temp directory is missing');
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
      webPreferences: { sandbox: true, backgroundThrottling: false }
    });
    await mainWindow.loadURL('data:text/html;charset=utf-8,<body></body>');
    // 호스트가 메인 창으로 넘기는 키를 그대로 받아 적는다.
    const relayed = [];
    const originalSend = mainWindow.webContents.send.bind(mainWindow.webContents);
    mainWindow.webContents.send = (channel, ...args) => {
      if (channel === KEYBOARD_CHANNEL) relayed.push(args[0]);
      return originalSend(channel, ...args);
    };

    host = new MPVOverlayHost({
      BrowserWindow,
      getMainWindow: () => mainWindow,
      fabricBundlePath: bundlePath,
      logger: { debug() {}, warn() {}, error() {} }
    });
    host.setVisible(false);
    const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
    if (ensured.success !== true) throw new Error(`overlay ensure failed: ${ensured.error}`);
    const primed = await host.setDrawingInput({
      hostGeneration: host.hostGeneration,
      videoGeneration: 1,
      inputRevision: 1,
      enabled: false
    });
    if (primed.accepted !== true) {
      throw new Error(`drawing input prime failed: ${JSON.stringify(primed)}`);
    }
    const enabled = await host.setDrawingInput({
      hostGeneration: host.hostGeneration,
      videoGeneration: 1,
      inputRevision: 2,
      enabled: true,
      session: {
        sessionId: 'space-release-session',
        stableVideoIdentity: 'space-release-video',
        targetFrame: 0,
        sourceWidth: 1920,
        sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 640, height: 360 },
        tool: 'brush'
      }
    });
    if (enabled.accepted !== true) {
      throw new Error(`drawing input activation failed: ${JSON.stringify(enabled)}`);
    }

    const overlay = host.window.webContents;
    // 팔레트 버튼을 방금 누른 상황을 만든다 — 그 버튼이 문서의 포커스를 쥐고 있다.
    await overlay.executeJavaScript(`
      (() => {
        const button = document.querySelector('[data-fabric-pilot-action="brush"]');
        window.__spaceProbe = { keys: [], clicks: 0 };
        button.addEventListener('click', () => { window.__spaceProbe.clicks += 1; });
        for (const type of ['keydown', 'keyup']) {
          // 버블 단계의 맨 끝에서 기본 동작이 막혔는지까지 본다.
          window.addEventListener(type, event => {
            window.__spaceProbe.keys.push(type + ':' + event.code + ':' + (event.defaultPrevented ? 'prevented' : 'default'));
          });
        }
        button.focus();
        return document.activeElement === button;
      })();
    `, true);
    const settle = () => new Promise(resolve => setTimeout(resolve, 150));
    const press = async keyCode => {
      overlay.sendInputEvent({ type: 'keyDown', keyCode });
      await settle();
      overlay.sendInputEvent({ type: 'keyUp', keyCode });
      await settle();
    };
    const takeRelayed = () => relayed.splice(0).map(input => `${input.type}:${input.code}`);
    const takePage = () => overlay.executeJavaScript(`
      (() => {
        const snapshot = { keys: window.__spaceProbe.keys.splice(0), clicks: window.__spaceProbe.clicks };
        return snapshot;
      })();
    `, true);

    await press('Space');
    const space = { relayed: takeRelayed(), page: await takePage() };
    await press('Space');
    const spaceAgain = { relayed: takeRelayed(), page: await takePage() };
    await press('A');
    const letter = { relayed: takeRelayed(), page: await takePage() };

    // Space 를 누른 채 다른 키를 눌렀다 뗀 뒤 Space 를 뗀다. 다른 키의 누름을 삼키는 순간
    // Chromium 은 다음 누름까지 모든 뗌을 버리므로 Space 의 실제 뗌은 오지 않는다.
    overlay.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    await settle();
    overlay.sendInputEvent({ type: 'keyDown', keyCode: 'A' });
    await settle();
    overlay.sendInputEvent({ type: 'keyUp', keyCode: 'A' });
    await settle();
    overlay.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await settle();
    const interrupted = { relayed: takeRelayed(), page: await takePage() };
    await press('Space');
    const afterInterrupted = { relayed: takeRelayed(), page: await takePage() };

    process.stdout.write(`${PROBE_PREFIX}${JSON.stringify({
      space, spaceAgain, letter, interrupted, afterInterrupted
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

  test('real Chromium delivers both the press and the release of Space from the drawing overlay', {
    timeout: 45000
  }, () => {
    const electronPath = require('electron');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-space-release-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.BAEFRAME_SPACE_RELEASE_TEMP_DIR = tempDir;
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
        'hidden Electron Space release probe failed',
        result.stdout,
        result.stderr
      ].filter(Boolean).join('\n'));
      const outputLine = result.stdout
        .split(/\r?\n/)
        .find(line => line.startsWith(PROBE_PREFIX));
      assert.ok(outputLine, `probe returned no result:\n${result.stdout}\n${result.stderr}`);
      probe = JSON.parse(outputLine.slice(PROBE_PREFIX.length));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // 메인 창의 Space 처리(탭이면 재생, 누른 채 끌면 화면 이동)는 뗌이 와야 끝난다.
    // 뗌이 오지 않으면 메인 창은 Space 를 계속 누르고 있다고 보고 재생도, 다음 획도 막는다.
    assert.deepEqual(probe.space.relayed, ['keyDown:Space', 'keyUp:Space']);
    assert.deepEqual(probe.spaceAgain.relayed, ['keyDown:Space', 'keyUp:Space']);

    // 누름이 오버레이 문서까지 오더라도 포커스가 남은 팔레트 버튼을 누르면 안 된다.
    assert.deepEqual(probe.space.page.keys, ['keydown:Space:prevented']);
    assert.deepEqual(probe.spaceAgain.page.keys, ['keydown:Space:prevented']);
    assert.equal(probe.spaceAgain.page.clicks, 0);

    // 다른 키는 지금처럼 호스트가 삼켜 오버레이 문서에 닿지 않는다.
    assert.deepEqual(probe.letter.relayed, ['keyDown:KeyA']);
    assert.deepEqual(probe.letter.page.keys, []);

    // Space 를 누른 채 다른 키를 누르면, 그 키를 삼키기 전에 Space 의 뗌을 먼저 넘긴다.
    // 실제 뗌은 오지 않으므로 그러지 않으면 메인 창이 다시 Space 를 누른 채로 남는다.
    assert.deepEqual(probe.interrupted.relayed, ['keyDown:Space', 'keyUp:Space', 'keyDown:KeyA']);
    assert.deepEqual(probe.interrupted.page.keys, ['keydown:Space:prevented']);
    // 그 뒤의 Space 는 다시 평소대로 동작한다.
    assert.deepEqual(probe.afterInterrupted.relayed, ['keyDown:Space', 'keyUp:Space']);
    assert.equal(probe.afterInterrupted.page.clicks, 0);
  });
}
