const { _electron } = require('C:/Users/user/.codex/skills/develop-web-game/node_modules/playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const workspace = path.resolve(__dirname, '../../../../..');
const previous = 'C:/Users/user/.codex/worktrees/baeframe-reel-editor/BAEFRAME';
const executable = path.join(previous, 'dist/win-unpacked/BFRAME_alpha_v2.exe');
const runtime = path.join(__dirname, '_runtime');
const userData = path.join(runtime, 'user-data-final');
const roaming = path.join(runtime, 'roaming-final');
const local = path.join(runtime, 'local-final');
const source = path.join(runtime, '합성-리뷰-샘플-A.mp4');
const longSource = path.join(runtime, '합성_시퀀스012_숏034_배경캐릭터타이밍색감수정_최종검토요청_연출확인본_v12_20260906.mp4');
const report = { baseline: '5d1cb89', executable, scope: 'Actual packaged review window. Synthetic local fixtures. No external sync or sharing.', states: [], errors: [], blockedRequests: [] };
let app, page;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(selector) { await page.locator(selector).click({ timeout: 4000 }); await pause(200); }
async function resize(width, height, zoom = 1) {
  await app.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('/renderer/index.html')); window.setContentSize(size.width, size.height); window.webContents.setZoomFactor(size.zoom); }, { width, height, zoom });
  await pause(450);
}
async function metrics() {
  return page.evaluate(() => {
    const parse = value => { const m = value.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
    const blend = (front, back) => { const a = front[3] ?? 1; return [0, 1, 2].map(i => front[i] * a + back[i] * (1 - a)).concat(1); };
    const background = element => {
      const chain = []; for (let node = element; node; node = node.parentElement) chain.push(node);
      let color = [255, 255, 255, 1]; let image = false;
      for (const node of chain.reverse()) { const style = getComputedStyle(node); color = blend(parse(style.backgroundColor), color); image ||= style.backgroundImage !== 'none'; }
      return { color, image };
    };
    const luminance = c => c.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const visible = element => { const r = element.getBoundingClientRect(), s = getComputedStyle(element); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const clipped = element => {
      const box = element.getBoundingClientRect(); let area = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      for (let node = element.parentElement; node; node = node.parentElement) { const style = getComputedStyle(node), rect = node.getBoundingClientRect(); if (/(hidden|auto|scroll|clip)/.test(style.overflowX)) { area.left = Math.max(area.left, rect.left); area.right = Math.min(area.right, rect.right); } if (/(hidden|auto|scroll|clip)/.test(style.overflowY)) { area.top = Math.max(area.top, rect.top); area.bottom = Math.min(area.bottom, rect.bottom); } }
      return { clipped: box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > area.bottom + 1, area };
    };
    const selectors = ['#fileName', '#filePath', '#btnOpenEditor', '#btnSave', '#btnCopyLink', '#btnOpenOther', '#frameIndicator', '#timecode', '#btnDrawMode', '#btnAddComment', '#btnCompositionLayerPanel', '#btnMainMute', '#mainVolumeSlider', '#btnPrevComment', '#btnNextComment', '#btnAddLayer', '#frameCellModeBadge', '.input-hint', '.empty-comments-text', '.empty-comments-hint', '#commentInput', '.filter-chip', '#authorFilterBtn', '#btnCommentSettings', '#btnCompactView', '.comment-author', '.comment-timecode', '.comment-text', '.comment-content', '.comment-date', '.playlist-name-input', '.playlist-mode-tab', '.playlist-position', '.playlist-empty', '.timeline-toolbar-btn', '.layer-name', '.drawing-layer-name', '.settings-dropdown-btn', '.settings-dropdown-header', '.app-settings-tab', '.app-settings-desc', '.settings-description', '.shortcut-description', '.shortcut-key', '#userNameInput', '.form-hint', '.drop-zone-title', '.drop-zone-hint'];
    const elements = [];
    for (const selector of selectors) for (const element of document.querySelectorAll(selector)) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element), bg = background(element), foreground = blend(parse(style.color), bg.color), lum = [luminance(foreground), luminance(bg.color)];
      const contrast = (Math.max(...lum) + .05) / (Math.min(...lum) + .05);
      const placeholder = element.matches('input,textarea') ? getComputedStyle(element, '::placeholder').color : null;
      elements.push({ selector, id: element.id, text: element.textContent.trim().slice(0, 180), value: element.value, rect: element.getBoundingClientRect().toJSON(), fontSize: style.fontSize, fontWeight: style.fontWeight, foreground: style.color, background: style.backgroundColor, compositeBackground: bg.color, backgroundImageInChain: bg.image, contrast: Number(contrast.toFixed(3)), opacity: style.opacity, placeholder, title: element.title, ariaLabel: element.getAttribute('aria-label'), ariaPressed: element.getAttribute('aria-pressed'), disabled: element.disabled, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, ...clipped(element) });
    }
    const controls = [...document.querySelectorAll('button,input,textarea,select')].filter(visible).map(element => ({ id: element.id, text: element.textContent.trim().slice(0, 80), title: element.title, ariaLabel: element.getAttribute('aria-label'), ariaPressed: element.getAttribute('aria-pressed'), rect: element.getBoundingClientRect().toJSON(), disabled: element.disabled, fontSize: getComputedStyle(element).fontSize, ...clipped(element) }));
    const regions = {};
    for (const selector of ['.header', '.header-actions', '#viewerSection', '#viewerContainer', '.controls-bar', '.playback-controls-scroll', '#playlistSidebar', '#commentPanel', '#timelineSection', '#timelineTracks', '#drawingTools', '#commentSettingsDropdown', '#appSettingsModal .modal-content', '#shortcutSettingsModal .modal-content']) {
      const element = document.querySelector(selector); if (element && visible(element)) regions[selector] = { rect: element.getBoundingClientRect().toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
    }
    return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, bodyClass: document.body.className, elements, controls, regions, visibleModals: [...document.querySelectorAll('.modal-overlay.active')].map(element => element.id) };
  });
}
async function capture(name, state) {
  const data = await metrics();
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('/renderer/index.html'));
    window.show(); window.focus();
    const bounds = window.getBounds(), display = screen.getDisplayMatching(bounds);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor }, fetchWindowIcons: false });
    const own = sources.find(source => source.display_id === String(display.id));
    if (!own) return null;
    const size = own.thumbnail.getSize(); const sx = size.width / display.size.width, sy = size.height / display.size.height;
    const rect = { x: Math.max(0, Math.round((bounds.x - display.bounds.x) * sx)), y: Math.max(0, Math.round((bounds.y - display.bounds.y) * sy)), width: Math.round(bounds.width * sx), height: Math.round(bounds.height * sy) };
    rect.width = Math.min(rect.width, size.width - rect.x); rect.height = Math.min(rect.height, size.height - rect.y);
    const cropped = own.thumbnail.crop(rect);
    return { base64: cropped.toPNG().toString('base64'), size: cropped.getSize(), capture: 'Display capture immediately cropped to isolated test mainWindow bounds inside Electron; no surrounding desktop saved' };
  });
  if (png) { await fs.writeFile(path.join(__dirname, `${name}.png`), Buffer.from(png.base64, 'base64')); data.capture = { method: png.capture, size: png.size }; }
  else { await page.screenshot({ path: path.join(__dirname, `${name}.png`) }); data.capture = { method: 'renderer screenshot fallback; native video may be omitted' }; }
  await fs.writeFile(path.join(__dirname, `${name}.json`), JSON.stringify(data, null, 2));
  report.states.push({ name, state, screenshot: `${name}.png`, metrics: `${name}.json`, viewport: data.viewport });
  console.log('CAPTURE', name, data.viewport);
}
async function attempt(name, action) { try { await action(); } catch (error) { report.errors.push({ step: name, message: error.message }); console.log('STATE ERROR', name, error.message); } }
async function main() {
  for (const dir of [runtime, userData, roaming, local]) await fs.mkdir(dir, { recursive: true });
  if (!await fs.stat(source).catch(() => null)) {
    const generation = spawnSync(path.join(previous, 'ffmpeg/win32/ffmpeg.exe'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-t', '6', '-c:v', 'libopenh264', '-b:v', '2M', source], { windowsHide: true, shell: false, encoding: 'utf8' });
    assert.equal(generation.status, 0, generation.stderr);
  }
  await fs.copyFile(source, longSource);
  const template = JSON.parse(await fs.readFile(path.join(workspace, 'docs/reports/2026-09-06-ux-audit/evidence/native-drawing-sample.bframe'), 'utf8'));
  const fixture = { ...template, videoFile: path.basename(source), videoPath: source, liveblocksRoomId: null, reviewDocumentId: 'reviewdoc-a711e071-73cb-4f7d-92f3-a2d650500aaa', versionInfo: { detectedVersion: null, originalSuffix: null, baseName: path.basename(source, '.mp4') }, createdAt: '2026-09-06T00:00:00.000Z', modifiedAt: '2026-09-06T00:00:00.000Z' };
  fixture.drawingsV3.totalFrames = 144;
  fixture.comments.layers[0].markers = [
    { id: 'synthetic-1', startFrame: 33, endFrame: 60, fps: 24, x: 0.3, y: 0.4, author: '합성 검토자 A', authorId: 'synthetic-a', text: '[합성 피드백] 팔이 올라오는 타이밍을 3프레임 늦추고, 시선이 화면 오른쪽으로 이어지는지 확인해주세요. 실제 업무 자료가 아닌 UI 점검용 문장입니다.', resolved: false, createdAt: '2026-09-06T00:00:00.000Z', replies: [] },
    { id: 'synthetic-2', startFrame: 72, endFrame: 96, fps: 24, x: 0.6, y: 0.5, author: '합성 검토자 B', authorId: 'synthetic-b', text: '[합성 피드백] 배경 색감 확인 완료', resolved: true, createdAt: '2026-09-06T00:01:00.000Z', replies: [{ id: 'synthetic-reply', author: '합성 검토자 A', text: '테스트용 답글입니다.', createdAt: '2026-09-06T00:02:00.000Z' }] },
    { id: 'synthetic-3', startFrame: 100, endFrame: 130, fps: 24, x: 0.7, y: 0.6, author: '합성 검토자 A', authorId: 'synthetic-a', text: '[합성 피드백] 마지막 포즈를 조금 더 유지해주세요.', resolved: false, createdAt: '2026-09-06T00:03:00.000Z', replies: [] }
  ];
  for (const video of [source, longSource]) await fs.writeFile(video.replace(/\.mp4$/, '.bframe'), JSON.stringify({ ...fixture, videoFile: path.basename(video), videoPath: video }, null, 2));
  const env = { ...process.env, NODE_ENV: 'production', APPDATA: roaming, LOCALAPPDATA: local, BAEFRAME_MULTI_INSTANCE: '1', BAEFRAME_MULTI_INSTANCE_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: executable, args: [`--multi-instance-user-data=${userData}`, '--skip-shell-registration'], cwd: path.dirname(executable), env, timeout: 60000 });
  report.pid = app.process().pid;
  report.environment = await app.evaluate(({ app, session, dialog }) => {
    globalThis.__reviewChoices = []; globalThis.__blockedAuditRequests = [];
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => { globalThis.__blockedAuditRequests.push(request.url.split('?')[0]); callback({ cancel: true }); });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__reviewChoices.shift()] });
    return { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), isPackaged: app.isPackaged, version: app.getVersion() };
  });
  assert.equal(path.resolve(report.environment.userData), path.resolve(userData));
  for (let i = 0; i < 600; i++) { page = app.windows().find(item => /\/renderer\/index\.html/.test(item.url())); if (page) break; await pause(100); }
  assert.ok(page); page.setDefaultTimeout(6000);
  page.on('dialog', async dialog => { report.dialogs ||= []; report.dialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.accept(); });
  page.on('pageerror', error => report.errors.push({ step: 'pageerror', message: error.message }));
  await page.locator('#btnOpenFile').waitFor({ state: 'visible' });
  await pause(1000);
  await resize(1440, 900);
  if (await page.locator('#userSettingsModal').evaluate(element => element.classList.contains('active'))) {
    await capture('00-required-name', 'Fresh-profile required display name dialog blocks the media workspace');
    await page.locator('#userNameInput').fill('UI 합성 점검');
    await click('#saveUserSettings');
    await page.locator('#userSettingsModal.active').waitFor({ state: 'hidden' });
  }
  await capture('01-empty', 'Fresh isolated review window before opening any media');
  await app.evaluate((_electron, file) => globalThis.__reviewChoices.push(file), source);
  await click('#btnOpenFile');
  await page.waitForFunction(() => document.getElementById('fileName').textContent.includes('합성-리뷰-샘플-A'));
  await pause(1700);
  await capture('02-video-comments', 'Synthetic 6s video, saved synthetic comments and one V3 drawing loaded through real file picker');
  await attempt('settings-menu', async () => { await click('#btnCommentSettings'); await capture('03-settings-menu', 'Comment gear menu containing app-wide settings'); await click('#btnAppSettings'); await capture('04-app-settings', 'Actual app settings modal opened from comment settings'); await click('#closeAppSettings'); });
  await attempt('shortcuts', async () => { await click('#btnCommentSettings'); await click('#btnShortcutSettings'); await capture('05-shortcuts', 'Actual configurable shortcut settings'); await click('#closeShortcutSettings'); });
  await attempt('drawing', async () => {
    await click('#btnDrawMode'); await pause(500);
    await capture('06-drawing-tools', 'Review drawing mode and live Fabric palette');
    let palettePage;
    for (const candidate of app.windows()) if (await candidate.locator('.mpv-fabric-pilot-toolbar').count()) { palettePage = candidate; break; }
    assert.ok(palettePage, 'Live Fabric overlay window must exist');
    await palettePage.locator('[data-fabric-pilot-action="select"]').click({ timeout: 4000 }); await pause(350);
    report.overlayControls = await palettePage.evaluate(() => [...document.querySelectorAll('button,input,select')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).map(el => ({ action: el.dataset.fabricPilotAction, text: el.textContent, title: el.title, ariaLabel: el.getAttribute('aria-label'), ariaPressed: el.getAttribute('aria-pressed'), fontSize: getComputedStyle(el).fontSize, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, rect: el.getBoundingClientRect().toJSON() })));
    await capture('07-selection-tools', 'Actual review selection tool; selected via real native Fabric overlay button');
  });
  await attempt('layers', async () => { await page.keyboard.press('Shift+F1'); await pause(250); await page.keyboard.press('Shift+F1'); await pause(400); await capture('08-layers-timeline', 'Two layer-add keyboard actions via configured Shift+F1'); });
  await attempt('playlist-narrow', async () => { await click('#btnPlaylist'); await resize(1100, 720); await capture('09-narrow-panels', '1100×720 CSS viewport with playlist and comments visible'); });
  await attempt('zoom-125', async () => { await resize(1440, 900, 1.25); await capture('10-zoom125', '1440×900 content window with Electron page zoom 125%; current CSS viewport recorded'); });
  await attempt('long-name', async () => { await resize(1440, 900); await app.evaluate((_electron, file) => globalThis.__reviewChoices.push(file), longSource); await click('#btnOpenOther'); await page.waitForFunction(() => document.getElementById('fileName').textContent.includes('합성_시퀀스012')); await pause(1200); await capture('11-long-name', 'Synthetic long filename loaded through actual file picker'); });
  await attempt('save-share-ui', async () => { await click('#btnSave'); await pause(700); await capture('12-save-share-ui', 'Saved synthetic local review; share controls observed without activating share'); });
  report.blockedRequests = await app.evaluate(() => globalThis.__blockedAuditRequests);
}
main().catch(error => { report.fatal = error.stack; process.exitCode = 1; console.error(error); }).finally(async () => {
  if (app) {
    try {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
      const child = app.process();
      const exit = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Quit did not finish within 15s')), 15000); child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); }); });
      const settled = exit.then(value => ({ value }), error => ({ error }));
      await app.evaluate(({ app }) => app.quit()).catch(() => {});
      const result = await settled; if (result.error) throw result.error; report.exit = result.value;
    } catch (error) { report.cleanupError = error.message; process.exitCode = 1; try { await app.close(); } catch {} }
  }
  await fs.writeFile(path.join(__dirname, 'capture-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ captures: report.states.length, errors: report.errors, fatal: report.fatal, exit: report.exit, cleanupError: report.cleanupError }, null, 2));
});
