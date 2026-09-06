const fs = require('node:fs/promises');
const path = require('node:path');
const { validateProject } = require('../shared/edit-project');
const { MAX_PROJECT_BYTES, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, getRuntimePaths, probeMedia, preparePreview, captureFileVersion, writeAtomic, assertSafeDestination } = require('./editor-media');
const { exportProject } = require('./editor-export');

function isTrustedSender(event, window) {
  return !!window && !window.isDestroyed?.() && !!window.webContents && !window.webContents.isDestroyed?.() && event?.sender === window.webContents && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
}

function validateAuthorizedProject(project, authorizedSources) {
  validateProject(project);
  for (const source of project.sources) {
    const authorized = authorizedSources.get(source.id);
    if (!authorized || ['path', 'durationSeconds', 'width', 'height', 'fps', 'hasAudio'].some((field) => source[field] !== authorized[field]) || (source.previewPath && source.previewPath !== authorized.previewPath)) throw new Error('이 편집창에서 가져오지 않은 미디어입니다. 파일 가져오기를 이용하세요.');
  }
  return structuredClone(project);
}

let singleton;
function setupEditorIpc({ getMainWindow, electron = require('electron'), runtimeProvider = getRuntimePaths }) {
  if (singleton) return singleton;
  const { BrowserWindow, ipcMain, dialog, app } = electron;
  let editorWindow = null;
  let dirty = false;
  let closeAllowed = false;
  let confirming = null;
  let activeExport = null;
  let exportController = null;
  let lifetime = null;
  let currentPath = null;
  let currentVersion = null;
  let fileBusy = false;
  const authorizedSources = new Map();
  const handles = [];
  const listeners = [];

  const ensureEditor = (event) => {
    if (!isTrustedSender(event, editorWindow)) throw new Error('편집창에서만 사용할 수 있는 요청입니다.');
    return editorWindow;
  };
  const ensureSameWindow = (window) => {
    if (window !== editorWindow || window.isDestroyed()) throw new Error('편집창이 닫혔습니다.');
  };
  const handle = (channel, callback, main = false) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (main) {
        if (!isTrustedSender(event, getMainWindow())) throw new Error('리뷰창에서만 편집창을 열 수 있습니다.');
      } else ensureEditor(event);
      return callback(event, ...args);
    });
    handles.push(channel);
  };
  const exclusiveFile = async (callback) => {
    if (fileBusy || activeExport) throw new Error('현재 파일 작업이 끝난 다음 다시 시도하세요.');
    fileBusy = true;
    try { return await callback(); } finally { fileBusy = false; }
  };
  const needsCloseConfirmation = () => !!editorWindow && !editorWindow.isDestroyed() && !closeAllowed && (dirty || !!activeExport);
  async function confirmDiscard() {
    if (!dirty && !activeExport) return true;
    if (confirming) return confirming;
    confirming = (async () => {
      const owner = editorWindow;
      if (!owner || owner.isDestroyed()) return true;
      const result = await dialog.showMessageBox(owner, {
        type: 'warning', title: 'BEditer · 프로토타입',
        message: activeExport ? '출력을 취소하고 편집을 닫을까요?' : '저장하지 않은 편집 내용을 버릴까요?',
        detail: activeExport ? '아직 완성되지 않은 출력은 저장되지 않습니다. 저장하지 않은 편집 내용도 사라집니다.' : '계속 편집하려면 취소를 선택하세요.',
        buttons: ['계속 편집', '변경 버리기'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (result.response !== 1) return false;
      if (activeExport) {
        exportController?.abort();
        try { await activeExport; } catch { /* The exporting renderer receives any actual error. */ }
      }
      return true;
    })();
    try { return await confirming; } finally { confirming = null; }
  }
  async function confirmClose() {
    if (!needsCloseConfirmation()) return true;
    const accepted = await confirmDiscard();
    if (accepted) closeAllowed = true;
    return accepted;
  }
  function openEditor() {
    if (editorWindow && !editorWindow.isDestroyed()) {
      if (editorWindow.isMinimized()) editorWindow.restore();
      editorWindow.show();
      editorWindow.focus();
      return { opened: true };
    }
    dirty = false;
    closeAllowed = false;
    currentPath = null;
    currentVersion = null;
    authorizedSources.clear();
    lifetime = new AbortController();
    const windowLifetime = lifetime;
    const window = new BrowserWindow({
      width: 1440, height: 940, minWidth: 1050, minHeight: 700,
      title: 'BEditer · 프로토타입', backgroundColor: '#101216', autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, '../preload/editor-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false }
    });
    editorWindow = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
    window.on('close', (event) => {
      if (!needsCloseConfirmation()) return;
      event.preventDefault();
      void confirmClose().then((accepted) => { if (accepted && !window.isDestroyed()) window.close(); }).catch(() => {});
    });
    window.on('closed', () => {
      windowLifetime.abort();
      exportController?.abort();
      if (editorWindow === window) {
        editorWindow = null;
        dirty = false;
        closeAllowed = false;
        authorizedSources.clear();
      }
    });
    void window.loadFile(path.join(__dirname, '../renderer/editor.html'));
    return { opened: true };
  }

  handle('editor:open', () => openEditor(), true);
  handle('editor:pick-media', (event, kind) => exclusiveFile(async () => {
    if (!['video', 'audio', 'music'].includes(kind)) throw new Error('가져오기 종류가 올바르지 않습니다.');
    const window = ensureEditor(event);
    const ownerSignal = lifetime.signal;
    const music = kind !== 'video';
    const choice = await dialog.showOpenDialog(window, { title: music ? '배경음악 가져오기' : '편집할 영상 가져오기', properties: music ? ['openFile'] : ['openFile', 'multiSelections'], filters: [{ name: music ? '오디오' : '영상', extensions: music ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS }] });
    if (choice.canceled) return { cancelled: true, sources: [] };
    ensureSameWindow(window);
    if (choice.filePaths.length > 100) throw new Error('한 번에 100개 이하의 영상을 가져오세요.');
    const runtime = await runtimeProvider();
    ensureSameWindow(window);
    const sources = [];
    for (const selected of choice.filePaths) {
      const probed = await probeMedia(selected, { ...runtime, signal: ownerSignal });
      if (music ? !probed.source.hasAudio : !probed.source.width) throw new Error(music ? '오디오가 없는 파일입니다.' : '영상이 없는 파일입니다.');
      sources.push(await preparePreview(probed, path.join(app.getPath('userData'), 'editor-previews'), runtime, ownerSignal));
    }
    ensureSameWindow(window);
    for (const source of sources) authorizedSources.set(source.id, source);
    return { cancelled: false, sources };
  }));
  handle('editor:open-project', (event) => exclusiveFile(async () => {
    const window = ensureEditor(event);
    const ownerSignal = lifetime.signal;
    if (!await confirmDiscard()) return { cancelled: true };
    const choice = await dialog.showOpenDialog(window, { title: '편집 프로젝트 열기', properties: ['openFile'], filters: [{ name: 'BAEFRAME 편집 프로젝트', extensions: ['bedit'] }] });
    if (choice.canceled) return { cancelled: true };
    ensureSameWindow(window);
    const selected = choice.filePaths[0];
    if (path.extname(selected).toLowerCase() !== '.bedit' || (await fs.stat(selected)).size > MAX_PROJECT_BYTES) throw new Error('올바른 크기의 .bedit 프로젝트를 선택하세요.');
    const version = await captureFileVersion(selected);
    const project = JSON.parse(await fs.readFile(selected, 'utf8'));
    validateProject(project);
    const runtime = project.sources.length ? await runtimeProvider() : null;
    ensureSameWindow(window);
    const sources = [];
    for (const stored of project.sources) {
      const probed = await probeMedia(stored.path, { ...runtime, signal: ownerSignal });
      const source = await preparePreview(probed, path.join(app.getPath('userData'), 'editor-previews'), runtime, ownerSignal);
      sources.push({ ...source, id: stored.id });
    }
    project.sources = sources;
    validateProject(project);
    if (await captureFileVersion(selected) !== version) throw new Error('프로젝트를 여는 동안 파일이 변경되었습니다. 다시 열어주세요.');
    ensureSameWindow(window);
    authorizedSources.clear();
    for (const source of sources) authorizedSources.set(source.id, source);
    currentPath = selected;
    currentVersion = version;
    return { cancelled: false, project, path: selected };
  }));
  handle('editor:save-project', (event, project, saveAs) => exclusiveFile(async () => {
    const window = ensureEditor(event);
    const ownerSignal = lifetime.signal;
    const validated = validateAuthorizedProject(project, authorizedSources);
    let destination = currentPath;
    let expectedVersion = currentVersion;
    if (!destination || saveAs === true) {
      const choice = await dialog.showSaveDialog(window, { title: '편집 프로젝트 저장', defaultPath: currentPath || `${project.name || '새 편집'}.bedit`, filters: [{ name: 'BAEFRAME 편집 프로젝트', extensions: ['bedit'] }] });
      if (choice.canceled || !choice.filePath) return { cancelled: true };
      destination = choice.filePath;
      expectedVersion = await captureFileVersion(destination);
    }
    ensureSameWindow(window);
    const originals = [...authorizedSources.values()].map((source) => source.path);
    const writtenVersion = await writeAtomic(destination, JSON.stringify(validated, null, 2) + '\n', { expectedVersion, originals, extension: '.bedit', signal: ownerSignal });
    ensureSameWindow(window);
    currentPath = destination;
    currentVersion = writtenVersion;
    return { cancelled: false, path: destination };
  }));
  handle('editor:export-video', async (event, payload) => {
    if (fileBusy || activeExport) throw new Error('이미 파일 작업이 진행 중입니다.');
    if (!payload || Object.keys(payload).some((key) => !['project', 'overlays'].includes(key))) throw new Error('출력 요청이 올바르지 않습니다.');
    const window = ensureEditor(event);
    const project = validateAuthorizedProject(payload.project, authorizedSources);
    fileBusy = true;
    try {
      const choice = await dialog.showSaveDialog(window, { title: 'MP4 영상 만들기', defaultPath: `${project.name || '편집 영상'}.mp4`, filters: [{ name: 'MP4 영상', extensions: ['mp4'] }] });
      if (choice.canceled || !choice.filePath) return { cancelled: true };
      ensureSameWindow(window);
      await assertSafeDestination(choice.filePath, [...authorizedSources.values()].map((source) => source.path), '.mp4');
      const expectedVersion = await captureFileVersion(choice.filePath);
      const runtime = await runtimeProvider();
      ensureSameWindow(window);
      exportController = new AbortController();
      activeExport = exportProject({ project, overlays: payload.overlays, outputPath: choice.filePath, expectedVersion, ...runtime, signal: exportController.signal, onProgress: (progress) => { if (window === editorWindow && !window.isDestroyed()) window.webContents.send('editor:export-progress', progress); } });
      return await activeExport;
    } finally { activeExport = null; exportController = null; fileBusy = false; }
  });
  handle('editor:cancel-export', () => { exportController?.abort(); return { cancelled: !!activeExport }; });
  handle('editor:confirm-discard', () => confirmDiscard());
  const onDirty = (event, value) => {
    if (!isTrustedSender(event, editorWindow) || typeof value !== 'boolean') return;
    dirty = value;
    closeAllowed = false;
    editorWindow.setDocumentEdited?.(dirty);
  };
  ipcMain.on('editor:set-dirty', onDirty);
  listeners.push(['editor:set-dirty', onDirty]);
  singleton = {
    openEditor, getWindow: () => editorWindow, confirmClose, needsCloseConfirmation,
    revokeCloseApproval() { closeAllowed = false; },
    dispose() {
      lifetime?.abort();
      exportController?.abort();
      for (const channel of handles) ipcMain.removeHandler(channel);
      for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
      singleton = null;
    }
  };
  return singleton;
}

module.exports = { setupEditorIpc, isTrustedSender, validateAuthorizedProject };
