'use strict';

// 그리기 중 오버레이 창이 키보드 포커스를 가진 채 Space 를 눌렀다 뗐을 때, 메인 창이
// "누름"과 "뗌"을 둘 다 받는지, Ctrl+Z 후 펜을 다시 쓸 수 있는지 실제 Chromium으로 확인한다.
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
  const { app, BrowserWindow, ipcMain } = require('electron');
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
    const hydrated = await host.hydrateDrawingVideo({
      hostGeneration: host.hostGeneration, videoGeneration: 1,
      persistenceSessionId: 'pen-persistence', stableVideoIdentity: 'space-release-video',
      fps: 24, totalFrames: 240, keyframes: []
    });
    if (!hydrated.accepted) throw new Error(`pen hydration failed: ${JSON.stringify(hydrated)}`);
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

    // 이 probe의 메인 창은 Space 키를 기록만 한다. 실제 앱의 pan 종료 응답을 대신해
    // 새 입력 세션으로 이전 Space 제스처를 정리하고 펜 시나리오를 시작한다.
    const penEnabled = await host.setDrawingInput({
      hostGeneration: host.hostGeneration, videoGeneration: 1, inputRevision: 3, enabled: true,
      session: {
        sessionId: 'space-release-session', stableVideoIdentity: 'space-release-video',
        targetFrame: 0, sourceWidth: 1920, sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 640, height: 360 }, tool: 'brush'
      }
    });
    if (!penEnabled.accepted) throw new Error('pen input session failed');

    // 실제 키보드 이벤트를 사용해야 Chromium이 Ctrl 뗌을 누락하는 결함을 잡는다.
    // 포인터는 타블렛의 modifier 누락을 재현하기 위해 pen/ctrlKey:false로 넣는다.
    const pendingFrameConfirmations = [];
    const { PAN_CHANNEL, PAN_COMMAND_CHANNEL, panCommandFields } = require('../../shared/viewport-pan-message');
    ipcMain.on(PAN_CHANNEL, (event, message) => {
      if (event.sender !== overlay || message.phase !== 'start') return;
      // 이 시나리오는 Space를 누르지 않는다. 메인 창의 그리기 소유권 응답이다.
      overlay.send(PAN_COMMAND_CHANNEL, {
        ...panCommandFields(message), type: 'decision', disposition: 'draw',
        transform: { scale: 1, panX: 0, panY: 0 }
      });
    });
    ipcMain.on('mpv-overlay:drawing-pointerdown-frame-request', (event, request) => {
      if (event.sender !== overlay) return;
      pendingFrameConfirmations.push(host.confirmDrawingPointerdownFrame({ ...request, targetFrame: 0 }));
    });
    const drawPen = async pointerId => {
      await overlay.executeJavaScript(`
      (() => {
        const canvas = document.querySelector('canvas.upper-canvas');
        // 합성 포인터에는 OS capture가 없다. 키보드는 아래 sendInputEvent의 실제 경로다.
        canvas.setPointerCapture = () => {};
        canvas.releasePointerCapture = () => {};
        const rect = canvas.getBoundingClientRect();
        for (const [type, x, buttons] of [
          ['pointerdown', 30, 1], ['pointermove', 80, 1], ['pointerup', 80, 0]
        ]) {
          canvas.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: ${pointerId}, pointerType: 'pen',
            isPrimary: true, button: 0, buttons, pressure: buttons ? 0.5 : 0,
            ctrlKey: false, clientX: rect.left + x, clientY: rect.top + 60
          }));
        }
      })();
    `, true);
      await settle();
      for (const result of await Promise.all(pendingFrameConfirmations.splice(0))) {
        if (!result.accepted) throw new Error(`pen frame confirmation failed: ${JSON.stringify(result)}`);
      }
      return diagnostics();
    };
    const diagnostics = () => overlay.executeJavaScript('window.__mpvFabricOverlay.getDiagnostics();', true);
    const sendKey = async (type, keyCode, modifiers = []) => {
      overlay.sendInputEvent({ type, keyCode, modifiers });
      await settle();
    };
    const beforeUndo = await drawPen(401);
    await sendKey('keyDown', 'Control', ['control']);
    const controlDown = await diagnostics();
    await sendKey('keyDown', 'Z', ['control']);
    const historyRelayed = takeRelayed();
    const undoResult = await host.applyDrawingAction({
      hostGeneration: host.hostGeneration, videoGeneration: 1, inputRevision: 3,
      sessionId: 'space-release-session', actionId: 'pen-undo', action: 'undo'
    });
    await sendKey('keyUp', 'Z', ['control']);
    await sendKey('keyUp', 'Control');
    const afterRelease = await diagnostics();
    const afterUndo = await drawPen(402);
    // Ctrl만 실제로 누른 동안에는 modifier 없는 펜도 여전히 임시 지우개다.
    await sendKey('keyDown', 'Control', ['control']);
    const heldErase = await drawPen(403);
    await sendKey('keyUp', 'Control');
    const afterErase = await drawPen(404);
    const otherChords = [];
    for (const [key, modifiers] of [['Y', ['control']], ['Z', ['control', 'shift']], ['C', ['control']]]) {
      await sendKey('keyDown', 'Control', ['control']);
      await sendKey('keyDown', key, modifiers);
      // Ctrl을 글자보다 먼저 떼는 순서도 확인한다.
      await sendKey('keyUp', 'Control');
      await sendKey('keyUp', key);
      otherChords.push({ key, state: await drawPen(410 + otherChords.length) });
    }
    const tablet = { beforeUndo, controlDown, historyRelayed, undoResult, afterRelease, afterUndo, heldErase, afterErase, otherChords };

    process.stdout.write(`${PROBE_PREFIX}${JSON.stringify({
      space, spaceAgain, letter, interrupted, afterInterrupted, tablet
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

  test('real Chromium preserves Space releases and pen drawing after Ctrl history shortcuts', {
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

    assert.equal(probe.tablet.beforeUndo.objectCount, 1, 'the first pen stroke is drawn');
    assert.equal(probe.tablet.controlDown.gestures.modifierCtrl, true);
    assert.deepEqual(probe.tablet.historyRelayed, ['keyDown:KeyZ']);
    assert.equal(probe.tablet.undoResult.applied, true, 'undo removes the first stroke');
    assert.equal(probe.tablet.afterRelease.gestures.modifierCtrl, false, 'Ctrl release reaches the pen modifier latch');
    assert.equal(probe.tablet.afterUndo.objectCount, 1, 'a new pen stroke works after undo');
    assert.equal(probe.tablet.heldErase.objectCount, 0, 'held Ctrl still erases with a tablet');
    assert.equal(probe.tablet.afterErase.objectCount, 1, 'releasing Ctrl restores pen drawing');
    for (const [index, { key, state }] of probe.tablet.otherChords.entries()) {
      assert.equal(state.gestures.modifierCtrl, false, `Ctrl release survives Ctrl+${key}`);
      assert.equal(state.objectCount, index + 2, `pen drawing resumes after Ctrl+${key}`);
    }
  });
}
