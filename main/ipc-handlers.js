/**
 * baeframe - IPC 핸들러 등록
 */

const { ipcMain, dialog, app, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createLogger } = require('./logger');
const { getMainWindow, minimizeWindow, toggleMaximize, closeWindow, isMaximized, toggleFullscreen, isFullscreen } = require('./window');

const log = createLogger('IPC');

/**
 * IPC 핸들러 설정
 */
function setupIpcHandlers() {
  log.info('IPC 핸들러 등록 시작');

  // ====== 파일 관련 ======

  // 파일 열기 다이얼로그
  ipcMain.handle('file:open-dialog', async (event, options = {}) => {
    const trace = log.trace('file:open-dialog');
    try {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: '영상 파일 열기',
        filters: [
          { name: '비디오 파일', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
          { name: '모든 파일', extensions: ['*'] }
        ],
        properties: ['openFile'],
        ...options
      });
      trace.end({ canceled: result.canceled });
      return result;
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // 파일 정보 가져오기
  ipcMain.handle('file:get-info', async (event, filePath) => {
    const trace = log.trace('file:get-info');
    try {
      const stats = await fs.promises.stat(filePath);
      const info = {
        path: filePath,
        name: path.basename(filePath),
        dir: path.dirname(filePath),
        ext: path.extname(filePath),
        size: stats.size,
        mtime: stats.mtime
      };
      trace.end(info);
      return info;
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // 리뷰 데이터 저장
  ipcMain.handle('file:save-review', async (event, filePath, data) => {
    const trace = log.trace('file:save-review');
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      trace.end({ filePath });
      return { success: true };
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // 리뷰 데이터 로드
  ipcMain.handle('file:load-review', async (event, filePath) => {
    const trace = log.trace('file:load-review');
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      trace.end({ filePath });
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        trace.end({ filePath, exists: false });
        return null;
      }
      trace.error(error);
      throw error;
    }
  });

  // 파일 존재 여부 확인
  ipcMain.handle('file:exists', async (event, filePath) => {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  });

  // 파일 상태 정보 조회 (협업 동기화용)
  ipcMain.handle('file:get-stats', async (event, filePath) => {
    try {
      const stats = await fs.promises.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs
      };
    } catch {
      return null;
    }
  });

  // ====== 협업 파일 관련 ======

  // 협업 파일 읽기 (.bframe.collab)
  ipcMain.handle('collab:read', async (event, filePath) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // 파일 없음
      }
      log.warn('협업 파일 읽기 실패', { filePath, error: error.message });
      return null;
    }
  });

  // 협업 파일 쓰기 (.bframe.collab)
  ipcMain.handle('collab:write', async (event, filePath, data) => {
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      log.error('협업 파일 쓰기 실패', { filePath, error: error.message });
      throw error;
    }
  });

  // ====== 파일 감시 (File Watching) ======
  // 파일 변경 시 즉시 동기화를 위한 기능

  const fileWatchers = new Map(); // filePath -> watcher
  const watchDebounceTimers = new Map(); // filePath -> timer

  // 파일 감시 시작
  ipcMain.handle('file:watch-start', async (event, filePath) => {
    try {
      // 이미 감시 중이면 무시
      if (fileWatchers.has(filePath)) {
        return { success: true, alreadyWatching: true };
      }

      const watcher = fs.watch(filePath, { persistent: false }, (eventType) => {
        // 디바운스 (같은 파일의 연속 이벤트 방지)
        if (watchDebounceTimers.has(filePath)) {
          clearTimeout(watchDebounceTimers.get(filePath));
        }

        const timer = setTimeout(() => {
          watchDebounceTimers.delete(filePath);

          // 렌더러에 파일 변경 알림
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('file:changed', {
              filePath,
              eventType
            });
            log.info('파일 변경 감지됨', { filePath, eventType });
          }
        }, 300); // 300ms 디바운스

        watchDebounceTimers.set(filePath, timer);
      });

      watcher.on('error', (error) => {
        log.warn('파일 감시 에러', { filePath, error: error.message });
        fileWatchers.delete(filePath);
      });

      fileWatchers.set(filePath, watcher);
      log.info('파일 감시 시작', { filePath });
      return { success: true };
    } catch (error) {
      log.error('파일 감시 시작 실패', { filePath, error: error.message });
      return { success: false, error: error.message };
    }
  });

  // 파일 감시 중지
  ipcMain.handle('file:watch-stop', async (event, filePath) => {
    try {
      const watcher = fileWatchers.get(filePath);
      if (watcher) {
        watcher.close();
        fileWatchers.delete(filePath);
        log.info('파일 감시 중지', { filePath });
      }

      // 타이머도 정리
      if (watchDebounceTimers.has(filePath)) {
        clearTimeout(watchDebounceTimers.get(filePath));
        watchDebounceTimers.delete(filePath);
      }

      return { success: true };
    } catch (error) {
      log.error('파일 감시 중지 실패', { filePath, error: error.message });
      return { success: false, error: error.message };
    }
  });

  // 모든 파일 감시 중지 (앱 종료 시)
  ipcMain.handle('file:watch-stop-all', async () => {
    for (const [filePath, watcher] of fileWatchers) {
      watcher.close();
      log.info('파일 감시 중지', { filePath });
    }
    fileWatchers.clear();
    watchDebounceTimers.clear();
    return { success: true };
  });

  // 버전 파일 스캔 (같은 폴더에서 같은 시리즈의 버전 파일들을 찾음)
  ipcMain.handle('file:scan-versions', async (event, filePath) => {
    const trace = log.trace('file:scan-versions');
    try {
      const directory = path.dirname(filePath);
      const currentFileName = path.basename(filePath);
      const currentBaseName = extractBaseName(currentFileName);

      if (!currentBaseName) {
        trace.end({ versions: [], reason: 'no base name' });
        return { baseName: '', currentVersion: null, versions: [] };
      }

      // 폴더의 모든 파일 읽기
      const files = await fs.promises.readdir(directory);

      // 지원하는 비디오 확장자
      const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

      // 같은 시리즈의 버전 파일들 필터링
      const versions = [];
      let currentVersion = null;

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!videoExtensions.includes(ext)) continue;

        const fileBaseName = extractBaseName(file);
        if (fileBaseName !== currentBaseName) continue;

        const versionInfo = parseVersionFromFileName(file);
        const fullPath = path.join(directory, file);

        try {
          const stats = await fs.promises.stat(fullPath);
          const versionEntry = {
            version: versionInfo.version,
            fileName: file,
            path: fullPath,
            displayLabel: versionInfo.displayLabel,
            suffix: versionInfo.suffix,
            mtime: stats.mtime.toISOString(),
            size: stats.size
          };

          versions.push(versionEntry);

          // 현재 파일인지 확인
          if (file === currentFileName) {
            currentVersion = versionInfo.version;
          }
        } catch (statError) {
          log.warn('파일 정보 읽기 실패', { file, error: statError.message });
        }
      }

      // 버전순 정렬
      versions.sort((a, b) => {
        const vA = a.version ?? -1;
        const vB = b.version ?? -1;
        return vA - vB;
      });

      trace.end({
        baseName: currentBaseName,
        currentVersion,
        count: versions.length
      });

      return {
        baseName: currentBaseName,
        currentVersion,
        versions
      };
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // ====== 윈도우 관련 ======

  ipcMain.handle('window:minimize', () => {
    minimizeWindow();
  });

  ipcMain.handle('window:maximize', () => {
    toggleMaximize();
  });

  ipcMain.handle('window:close', () => {
    closeWindow();
  });

  ipcMain.handle('window:is-maximized', () => {
    return isMaximized();
  });

  ipcMain.handle('window:toggle-fullscreen', () => {
    toggleFullscreen();
  });

  ipcMain.handle('window:is-fullscreen', () => {
    return isFullscreen();
  });

  // ====== 앱 관련 ======

  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:get-path', (event, name) => {
    return app.getPath(name);
  });

  // ====== 클립보드/링크 관련 ======

  ipcMain.handle('link:copy', (event, text) => {
    clipboard.writeText(text);
    log.info('클립보드에 복사됨', { text });
    return { success: true };
  });

  // ====== 폴더/탐색기 관련 ======

  // 폴더 열기 (탐색기에서 폴더 열기)
  ipcMain.handle('folder:open', async (event, folderPath) => {
    const trace = log.trace('folder:open');
    try {
      await shell.openPath(folderPath);
      trace.end({ folderPath });
      return { success: true };
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // 파일 위치 보기 (탐색기에서 파일 선택된 상태로 열기)
  ipcMain.handle('folder:show-item', async (event, filePath) => {
    const trace = log.trace('folder:show-item');
    try {
      shell.showItemInFolder(filePath);
      trace.end({ filePath });
      return { success: true };
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // ====== 외부 링크 열기 ======

  // 외부 URL 브라우저에서 열기
  ipcMain.handle('shell:open-external', async (event, url) => {
    const trace = log.trace('shell:open-external');
    try {
      await shell.openExternal(url);
      trace.end({ url });
      return { success: true };
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // ====== 사용자 정보 관련 ======

  // OS 사용자 이름 가져오기
  ipcMain.handle('user:get-os-user', async () => {
    const os = require('os');
    try {
      // Windows에서는 환경변수에서 사용자 이름 가져오기
      const userName = process.env.USERNAME || process.env.USER || os.userInfo().username;
      log.info('OS 사용자 이름', { userName });
      return userName;
    } catch (error) {
      log.error('OS 사용자 이름 가져오기 실패', error);
      return null;
    }
  });

  // Slack 사용자 정보 가져오기
  ipcMain.handle('user:get-slack-user', async () => {
    try {
      const slackUser = await getSlackUserInfo();
      if (slackUser) {
        log.info('Slack 사용자 감지됨', { name: slackUser.name });
      }
      return slackUser;
    } catch (error) {
      log.debug('Slack 사용자 감지 실패', error);
      return null;
    }
  });

  // ====== Google Drive 로컬 파일 ID 추출 ======

  // 로컬 경로에서 Google Drive 파일 ID 추출
  ipcMain.handle('gdrive:get-file-id', async (event, localPath) => {
    const trace = log.trace('gdrive:get-file-id');
    try {
      const fileId = await getGoogleDriveFileId(localPath);
      if (fileId) {
        const shareLink = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
        trace.end({ success: true, fileId });
        return { success: true, fileId, shareLink };
      }
      trace.end({ success: false, reason: 'not found' });
      return { success: false, error: '파일 ID를 찾을 수 없습니다' };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 웹 공유 링크 자동 생성 (로컬 경로에서)
  // 재시도 로직 포함 - Google Drive 동기화 대기
  ipcMain.handle('gdrive:generate-share-link', async (event, videoPath, bframePath) => {
    const trace = log.trace('gdrive:generate-share-link');
    const maxRetries = 3;
    const retryDelay = 1000; // 1초 대기

    // 재시도 로직을 포함한 파일 ID 검색
    const getFileIdWithRetry = async (filePath, fileType) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const fileId = await getGoogleDriveFileId(filePath);
        if (fileId) {
          return fileId;
        }
        if (attempt < maxRetries) {
          log.info(`${fileType} 파일 ID 검색 재시도 (${attempt}/${maxRetries})`, { filePath });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
      return null;
    };

    try {
      log.info('Google Drive 공유 링크 생성 시작', { videoPath, bframePath });

      const videoResult = await getFileIdWithRetry(videoPath, '영상');
      if (!videoResult) {
        throw new Error('영상 파일의 Drive ID를 찾을 수 없습니다. Google Drive 동기화를 확인해주세요.');
      }

      const bframeResult = await getFileIdWithRetry(bframePath, 'Bframe');
      if (!bframeResult) {
        throw new Error('Bframe 파일의 Drive ID를 찾을 수 없습니다. 파일 저장 후 잠시 기다려주세요 (Google Drive 동기화 필요).');
      }

      const videoUrl = `https://drive.google.com/file/d/${videoResult}/view?usp=sharing`;
      const bframeUrl = `https://drive.google.com/file/d/${bframeResult}/view?usp=sharing`;
      const webShareUrl = `https://baeframe.vercel.app/open.html?video=${encodeURIComponent(videoUrl)}&bframe=${encodeURIComponent(bframeUrl)}`;

      trace.end({ success: true });
      return { success: true, videoUrl, bframeUrl, webShareUrl };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // ====== 클립보드 Google Drive 링크 감지 ======

  // 클립보드에서 Google Drive 링크 읽기
  ipcMain.handle('clipboard:read-gdrive-link', () => {
    const text = clipboard.readText();
    // Google Drive 링크 패턴 감지
    const drivePattern = /https:\/\/drive\.google\.com\/(file\/d\/[a-zA-Z0-9_-]+|open\?id=[a-zA-Z0-9_-]+)/;
    if (drivePattern.test(text)) {
      return { hasLink: true, link: text.trim() };
    }
    return { hasLink: false, link: null };
  });

  // 클립보드 텍스트 읽기
  ipcMain.handle('clipboard:read', () => {
    return clipboard.readText();
  });

  // 웹 공유 링크 생성 (URL에서)
  ipcMain.handle('webshare:generate-link', (event, videoUrl, bframeUrl) => {
    const webShareUrl = `https://baeframe.vercel.app/open.html?video=${encodeURIComponent(videoUrl)}&bframe=${encodeURIComponent(bframeUrl)}`;
    return { success: true, webShareUrl };
  });

  // ====== 설정 파일 관련 ======

  // 설정 파일 경로 가져오기
  const getSettingsFilePath = () => {
    const settingsDir = path.join(app.getPath('userData'), 'settings');
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    return path.join(settingsDir, 'user-settings.json');
  };

  // 설정 파일 로드
  ipcMain.handle('settings:load', async () => {
    const trace = log.trace('settings:load');
    try {
      const filePath = getSettingsFilePath();
      log.info('설정 파일 경로', { filePath, exists: fs.existsSync(filePath) });
      if (fs.existsSync(filePath)) {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        log.info('설정 파일 로드됨', { userName: data?.userName, hasSetNameOnce: data?.hasSetNameOnce });
        trace.end({ success: true });
        return { success: true, data };
      }
      trace.end({ success: true, empty: true });
      return { success: true, data: null };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 설정 파일 저장
  ipcMain.handle('settings:save', async (event, data) => {
    const trace = log.trace('settings:save');
    try {
      const filePath = getSettingsFilePath();
      log.info('설정 파일 저장', { filePath, userName: data?.userName, hasSetNameOnce: data?.hasSetNameOnce });
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      trace.end({ success: true });
      return { success: true };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 설정 파일 경로 반환
  ipcMain.handle('settings:get-path', () => {
    return getSettingsFilePath();
  });

  // ====== 썸네일 캐시 관련 ======

  /**
   * 비디오 파일의 해시 생성 (캐시 키)
   */
  const getThumbnailCacheDir = () => {
    const cacheDir = path.join(app.getPath('userData'), 'thumbnails');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
  };

  const getVideoHash = (filePath, fileSize, mtime) => {
    const data = `${filePath}|${fileSize}|${mtime}`;
    return crypto.createHash('md5').update(data).digest('hex').slice(0, 16);
  };

  // 썸네일 캐시 경로 가져오기
  ipcMain.handle('thumbnail:get-cache-path', () => {
    return getThumbnailCacheDir();
  });

  // 캐시 유효성 검사 (비디오 파일의 mtime이 바뀌었는지 확인)
  ipcMain.handle('thumbnail:check-valid', async (event, videoPath) => {
    const trace = log.trace('thumbnail:check-valid');
    try {
      const stats = await fs.promises.stat(videoPath);
      const videoHash = getVideoHash(videoPath, stats.size, stats.mtimeMs);
      const cachePath = path.join(getThumbnailCacheDir(), videoHash);
      const metaPath = path.join(cachePath, 'meta.json');

      if (!fs.existsSync(metaPath)) {
        trace.end({ valid: false, reason: 'no cache' });
        return { valid: false, videoHash };
      }

      const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));

      // mtime 비교
      if (meta.mtime !== stats.mtimeMs) {
        trace.end({ valid: false, reason: 'mtime mismatch' });
        return { valid: false, videoHash };
      }

      trace.end({ valid: true, count: meta.frameCount });
      return {
        valid: true,
        videoHash,
        frameCount: meta.frameCount,
        duration: meta.duration
      };
    } catch (error) {
      trace.error(error);
      return { valid: false, error: error.message };
    }
  });

  // 캐시된 썸네일 전체 로드
  ipcMain.handle('thumbnail:load-all', async (event, videoHash) => {
    const trace = log.trace('thumbnail:load-all');
    try {
      const cachePath = path.join(getThumbnailCacheDir(), videoHash);
      const metaPath = path.join(cachePath, 'meta.json');

      if (!fs.existsSync(metaPath)) {
        trace.end({ success: false, reason: 'no cache' });
        return { success: false };
      }

      const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
      const thumbnails = {};

      // 썸네일 파일들 로드
      const files = await fs.promises.readdir(cachePath);
      for (const file of files) {
        if (file === 'meta.json') continue;
        if (!file.endsWith('.jpg')) continue;

        const time = parseFloat(file.replace('.jpg', '')) / 1000; // ms → sec
        const filePath = path.join(cachePath, file);
        const buffer = await fs.promises.readFile(filePath);
        const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        thumbnails[time] = dataUrl;
      }

      trace.end({ success: true, count: Object.keys(thumbnails).length });
      return {
        success: true,
        thumbnails,
        duration: meta.duration
      };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 썸네일 일괄 저장
  ipcMain.handle('thumbnail:save-batch', async (event, { videoPath, videoHash, duration, thumbnails }) => {
    const trace = log.trace('thumbnail:save-batch');
    try {
      const stats = await fs.promises.stat(videoPath);
      const cachePath = path.join(getThumbnailCacheDir(), videoHash);

      // 캐시 디렉토리 생성
      if (!fs.existsSync(cachePath)) {
        fs.mkdirSync(cachePath, { recursive: true });
      }

      // 메타데이터 저장
      const meta = {
        videoPath,
        mtime: stats.mtimeMs,
        frameCount: Object.keys(thumbnails).length,
        duration,
        quality: 0.6,
        createdAt: Date.now()
      };
      await fs.promises.writeFile(
        path.join(cachePath, 'meta.json'),
        JSON.stringify(meta, null, 2)
      );

      // 썸네일 파일 저장 (data URL → JPEG 파일)
      let savedCount = 0;
      for (const [time, dataUrl] of Object.entries(thumbnails)) {
        const timeMs = Math.round(parseFloat(time) * 1000);
        const fileName = `${timeMs}.jpg`;
        const filePath = path.join(cachePath, fileName);

        // data URL에서 base64 추출
        const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
        await fs.promises.writeFile(filePath, Buffer.from(base64Data, 'base64'));
        savedCount++;
      }

      trace.end({ success: true, savedCount });
      return { success: true, savedCount };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 특정 비디오의 캐시 삭제
  ipcMain.handle('thumbnail:clear-video-cache', async (event, videoHash) => {
    const trace = log.trace('thumbnail:clear-video-cache');
    try {
      const cachePath = path.join(getThumbnailCacheDir(), videoHash);
      if (fs.existsSync(cachePath)) {
        await fs.promises.rm(cachePath, { recursive: true });
        trace.end({ success: true });
        return { success: true };
      }
      trace.end({ success: true, reason: 'no cache' });
      return { success: true };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 전체 썸네일 캐시 삭제
  ipcMain.handle('thumbnail:clear-all-cache', async () => {
    const trace = log.trace('thumbnail:clear-all-cache');
    try {
      const cacheDir = getThumbnailCacheDir();
      const entries = await fs.promises.readdir(cacheDir);
      let deletedCount = 0;

      for (const entry of entries) {
        const entryPath = path.join(cacheDir, entry);
        const stat = await fs.promises.stat(entryPath);
        if (stat.isDirectory()) {
          await fs.promises.rm(entryPath, { recursive: true });
          deletedCount++;
        }
      }

      trace.end({ success: true, deletedCount });
      return { success: true, deletedCount };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 캐시 용량 확인
  ipcMain.handle('thumbnail:get-cache-size', async () => {
    const trace = log.trace('thumbnail:get-cache-size');
    try {
      const cacheDir = getThumbnailCacheDir();
      let totalSize = 0;
      let videoCount = 0;

      const getDirSize = async (dirPath) => {
        const entries = await fs.promises.readdir(dirPath);
        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry);
          const stat = await fs.promises.stat(entryPath);
          if (stat.isDirectory()) {
            videoCount++;
            await getDirSize(entryPath);
          } else {
            totalSize += stat.size;
          }
        }
      };

      await getDirSize(cacheDir);

      trace.end({ totalSize, videoCount });
      return {
        success: true,
        totalSize,
        videoCount,
        formattedSize: formatBytes(totalSize)
      };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // ====== FFmpeg 트랜스코딩 관련 ======

  const { ffmpegManager, SUPPORTED_CODECS } = require('./ffmpeg-manager');

  // FFmpeg 사용 가능 여부 확인
  ipcMain.handle('ffmpeg:is-available', async () => {
    await ffmpegManager.initialize();
    const available = ffmpegManager.isAvailable();
    return {
      available,
      ffmpegPath: ffmpegManager.ffmpegPath,
      ffprobePath: ffmpegManager.ffprobePath,
      hint: available
        ? null
        : 'FFmpeg가 설치되어 있지 않습니다. ffmpeg/win32/ 폴더에 ffmpeg.exe와 ffprobe.exe를 넣거나 시스템에 FFmpeg를 설치하세요.'
    };
  });

  // 비디오 코덱 정보 조회
  ipcMain.handle('ffmpeg:probe-codec', async (event, filePath) => {
    const trace = log.trace('ffmpeg:probe-codec');
    try {
      const codecInfo = await ffmpegManager.probeCodec(filePath);
      trace.end({ codec: codecInfo.codecName, isSupported: codecInfo.isSupported });
      return { success: true, ...codecInfo };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 캐시 확인
  ipcMain.handle('ffmpeg:check-cache', async (event, filePath) => {
    const trace = log.trace('ffmpeg:check-cache');
    try {
      const result = await ffmpegManager.checkCache(filePath);
      trace.end({ valid: result.valid });
      return { success: true, ...result };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 트랜스코딩 실행 (진행률은 별도 이벤트로 전송)
  ipcMain.handle('ffmpeg:transcode', async (event, filePath) => {
    const trace = log.trace('ffmpeg:transcode');
    const mainWindow = getMainWindow();

    // FFmpeg 사용 가능 여부 먼저 확인
    await ffmpegManager.initialize();
    if (!ffmpegManager.isAvailable()) {
      const errorMsg = 'FFmpeg가 설치되어 있지 않아 영상 변환이 불가능합니다.\n\n' +
        '해결 방법:\n' +
        '1. ffmpeg/win32/ 폴더에 ffmpeg.exe와 ffprobe.exe를 넣어주세요.\n' +
        '2. 또는 시스템에 FFmpeg를 설치하고 PATH에 추가하세요.\n\n' +
        '다운로드: https://github.com/BtbN/FFmpeg-Builds/releases';
      trace.end({ success: false, reason: 'FFmpeg not available' });
      return { success: false, error: errorMsg, ffmpegMissing: true };
    }

    try {
      const result = await ffmpegManager.transcode(filePath, (progress) => {
        // 진행률을 Renderer에 전송
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ffmpeg:transcode-progress', { filePath, progress });
        }
      });

      trace.end({ success: result.success, fromCache: result.fromCache });
      return { success: true, ...result };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 트랜스코딩 취소
  ipcMain.handle('ffmpeg:cancel', async () => {
    ffmpegManager.cancelAll();
    return { success: true };
  });

  // 캐시 크기 조회
  ipcMain.handle('ffmpeg:get-cache-size', async () => {
    const trace = log.trace('ffmpeg:get-cache-size');
    try {
      const result = await ffmpegManager.getCacheSize();
      trace.end({ bytes: result.bytes, count: result.count });
      return { success: true, ...result };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 캐시 용량 제한 설정
  ipcMain.handle('ffmpeg:set-cache-limit', async (event, limitGB) => {
    ffmpegManager.setCacheLimit(limitGB);
    return { success: true, limitGB };
  });

  // 특정 비디오 캐시 삭제
  ipcMain.handle('ffmpeg:clear-video-cache', async (event, filePath) => {
    const trace = log.trace('ffmpeg:clear-video-cache');
    try {
      const deleted = await ffmpegManager.clearVideoCache(filePath);
      trace.end({ deleted });
      return { success: true, deleted };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 전체 캐시 삭제
  ipcMain.handle('ffmpeg:clear-all-cache', async () => {
    const trace = log.trace('ffmpeg:clear-all-cache');
    try {
      const result = await ffmpegManager.clearAllCache();
      trace.end(result);
      return { success: true, ...result };
    } catch (error) {
      trace.error(error);
      return { success: false, error: error.message };
    }
  });

  // 지원 코덱 목록 반환
  ipcMain.handle('ffmpeg:get-supported-codecs', () => {
    return { success: true, codecs: SUPPORTED_CODECS };
  });

  // ====== 로그 관련 ======

  ipcMain.on('log:write', (event, logData) => {
    // 렌더러에서 온 로그를 파일에 기록
    const rendererLog = createLogger(`Renderer:${logData.module}`);
    const level = logData.level?.toLowerCase() || 'info';
    if (typeof rendererLog[level] === 'function') {
      rendererLog[level](logData.message, logData.data);
    }
  });

  log.info('IPC 핸들러 등록 완료');
}

/**
 * Slack 로컬 데이터에서 사용자 정보 읽기
 * Windows: %APPDATA%\Slack\storage\
 */
async function getSlackUserInfo() {
  const os = require('os');
  const path = require('path');

  // Slack 데이터 경로 (Windows)
  const slackPaths = [];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      slackPaths.push(path.join(appData, 'Slack', 'storage'));
      slackPaths.push(path.join(appData, 'Slack', 'Local Storage', 'leveldb'));
    }
  } else if (process.platform === 'darwin') {
    const home = os.homedir();
    slackPaths.push(path.join(home, 'Library', 'Application Support', 'Slack', 'storage'));
  } else {
    const home = os.homedir();
    slackPaths.push(path.join(home, '.config', 'Slack', 'storage'));
  }

  // Slack 설정 파일에서 사용자 정보 읽기 시도
  for (const slackPath of slackPaths) {
    try {
      const rootStatePath = path.join(slackPath, 'root-state.json');
      if (fs.existsSync(rootStatePath)) {
        const content = await fs.promises.readFile(rootStatePath, 'utf-8');
        const data = JSON.parse(content);

        // Slack root-state에서 사용자 정보 추출
        if (data.teams) {
          const teams = Object.values(data.teams);
          for (const team of teams) {
            // 디버그: team 객체의 모든 이름 관련 필드 출력
            log.info('Slack team 데이터 발견', {
              user_id: team.user_id,
              name: team.name,
              real_name: team.real_name,
              display_name: team.display_name,
              profile_real_name: team.profile?.real_name,
              profile_display_name: team.profile?.display_name,
              // team 객체의 키들 확인
              teamKeys: Object.keys(team).slice(0, 20)
            });

            if (team.user_id) {
              // 표시 이름 우선순위: real_name > display_name > profile.real_name > name
              const rawName =
                team.real_name ||
                team.display_name ||
                team.profile?.real_name ||
                team.profile?.display_name ||
                team.name;

              log.info('Slack 이름 추출', { rawName });

              if (rawName) {
                // 한글만 추출 (공백, 특수문자, 이모지 제외)
                const koreanOnly = rawName.match(/[\uAC00-\uD7A3]/g);
                const displayName = koreanOnly ? koreanOnly.join('') : rawName;

                log.info('Slack 최종 이름', { koreanOnly, displayName });

                return {
                  id: team.user_id,
                  name: displayName,
                  username: team.name, // 영어 사용자명 (백업용)
                  workspace: team.team_name || team.team_id
                };
              }
            }
          }
        }

        // 다른 구조 시도: users 객체가 있는 경우
        if (data.users) {
          const users = Object.values(data.users);
          for (const user of users) {
            const rawName =
              user.real_name ||
              user.display_name ||
              user.profile?.real_name ||
              user.profile?.display_name;

            if (rawName) {
              // 한글만 추출
              const koreanOnly = rawName.match(/[\uAC00-\uD7A3]/g);
              const displayName = koreanOnly ? koreanOnly.join('') : rawName;

              return {
                id: user.id || user.user_id,
                name: displayName,
                username: user.name,
                workspace: null
              };
            }
          }
        }
      }
    } catch (error) {
      // 이 경로에서 실패하면 다음 경로 시도
      continue;
    }
  }

  // Slack 프로세스가 실행 중인지 확인
  try {
    const { execSync } = require('child_process');
    let isSlackRunning = false;

    if (process.platform === 'win32') {
      const result = execSync('tasklist /FI "IMAGENAME eq slack.exe" /NH', { encoding: 'utf-8' });
      isSlackRunning = result.toLowerCase().includes('slack.exe');
    } else {
      const result = execSync('pgrep -x slack || pgrep -x Slack', { encoding: 'utf-8' });
      isSlackRunning = result.trim().length > 0;
    }

    if (isSlackRunning) {
      log.debug('Slack 실행 중이지만 사용자 정보를 읽을 수 없음');
    }
  } catch (error) {
    // Slack이 실행 중이 아님
  }

  return null;
}

/**
 * Google Drive 로컬 경로에서 파일 ID 추출
 * Google Drive for Desktop의 SQLite 메타데이터 DB를 읽음
 */
async function getGoogleDriveFileId(localPath) {
  const os = require('os');
  const path = require('path');
  const initSqlJs = require('sql.js');

  if (!localPath) return null;

  // 경로 정규화
  const normalizedPath = path.normalize(localPath);
  const fileName = path.basename(normalizedPath);

  log.info('Google Drive 파일 ID 검색 시작', { localPath, fileName });

  // Google Drive 메타데이터 DB 경로 찾기
  const driveDbPaths = [];

  if (process.platform === 'win32') {
    // Windows: %LOCALAPPDATA%\Google\DriveFS\<account_id>\metadata_sqlite_db
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const driveFsPath = path.join(localAppData, 'Google', 'DriveFS');

    log.info('Google Drive 경로 확인', { driveFsPath, exists: fs.existsSync(driveFsPath) });

    try {
      const accounts = fs.readdirSync(driveFsPath);
      log.info('발견된 계정 폴더', { accounts });

      for (const account of accounts) {
        const dbPath = path.join(driveFsPath, account, 'metadata_sqlite_db');
        const dbExists = fs.existsSync(dbPath);
        log.info('DB 경로 확인', { account, dbPath, exists: dbExists });

        if (dbExists) {
          driveDbPaths.push(dbPath);
        }
      }
    } catch (error) {
      log.warn('Google Drive 폴더 읽기 실패', { driveFsPath, error: error.message });
    }
  } else if (process.platform === 'darwin') {
    // Mac: ~/Library/Application Support/Google/DriveFS/<account_id>/metadata_sqlite_db
    const driveFsPath = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'DriveFS');

    try {
      const accounts = fs.readdirSync(driveFsPath);
      for (const account of accounts) {
        const dbPath = path.join(driveFsPath, account, 'metadata_sqlite_db');
        if (fs.existsSync(dbPath)) {
          driveDbPaths.push(dbPath);
        }
      }
    } catch (error) {
      log.warn('Google Drive 폴더 읽기 실패', { error: error.message });
    }
  }

  log.info('찾은 DB 경로 목록', { count: driveDbPaths.length, paths: driveDbPaths });

  if (driveDbPaths.length === 0) {
    log.warn('Google Drive 메타데이터 DB를 찾을 수 없음 - Google Drive for Desktop이 설치되어 있나요?');
    return null;
  }

  // sql.js 초기화
  let SQL;
  try {
    SQL = await initSqlJs();
  } catch (e) {
    log.error('sql.js 초기화 실패', { error: e.message });
    return null;
  }

  // 각 DB에서 파일 검색
  for (const dbPath of driveDbPaths) {
    try {
      log.info('DB 검색 중', { dbPath });

      // DB 파일 읽기 (비동기 - 이벤트 루프 블로킹 방지)
      const dbBuffer = await fs.promises.readFile(dbPath);
      const db = new SQL.Database(dbBuffer);

      try {
        // 테이블 구조 확인 (디버깅용)
        const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
        const tables = tablesResult[0]?.values?.map(v => v[0]) || [];
        log.info('DB 테이블 목록', { tables });

        // 모든 테이블에서 파일명 관련 데이터 찾기
        let rows = [];
        let columns = [];

        // items 테이블 시도
        try {
          const result = db.exec(`SELECT * FROM items WHERE local_title LIKE '%${fileName}%' LIMIT 10`);
          if (result[0]) {
            columns = result[0].columns;
            rows = result[0].values.map(v => {
              const obj = {};
              columns.forEach((col, i) => obj[col] = v[i]);
              return obj;
            });
          }
          log.info('items 테이블 검색 결과', { count: rows.length, columns, sample: rows[0] });
        } catch (e) {
          log.warn('items 쿼리 실패', { error: e.message });
        }

        // cloud_entry 테이블 시도
        if (rows.length === 0) {
          try {
            const result = db.exec(`SELECT * FROM cloud_entry WHERE filename LIKE '%${fileName}%' LIMIT 10`);
            if (result[0]) {
              columns = result[0].columns;
              rows = result[0].values.map(v => {
                const obj = {};
                columns.forEach((col, i) => obj[col] = v[i]);
                return obj;
              });
            }
            log.info('cloud_entry 테이블 검색 결과', { count: rows.length, columns });
          } catch (e) {
            log.warn('cloud_entry 쿼리 실패', { error: e.message });
          }
        }

        log.info('최종 검색 결과', { count: rows.length, firstRow: rows[0] });

        if (rows.length > 0) {
          const row = rows[0];

          // 모든 컬럼과 값 출력 (디버깅용)
          log.info('행 데이터 전체:', row);

          // Google Drive 파일 ID는 긴 영숫자 문자열 (보통 33자)
          // stable_id는 로컬 DB 내부용 숫자 ID이므로 사용하면 안됨
          // doc_id, cloud_doc_id, remote_id, id 등에서 찾아야 함
          let fileId = null;

          // 가능한 컬럼들 확인 (긴 영숫자 ID를 찾음)
          const possibleIdColumns = ['doc_id', 'cloud_doc_id', 'remote_id', 'target_id', 'id'];
          for (const col of possibleIdColumns) {
            if (row[col] && typeof row[col] === 'string' && row[col].length > 20) {
              fileId = row[col];
              log.info(`파일 ID 발견 (${col}):`, fileId);
              break;
            }
          }

          // 모든 문자열 컬럼에서 긴 ID 패턴 검색 (백업)
          if (!fileId) {
            for (const [key, value] of Object.entries(row)) {
              if (typeof value === 'string' && value.length >= 25 && value.length <= 50 && /^[a-zA-Z0-9_-]+$/.test(value)) {
                fileId = value;
                log.info(`파일 ID 발견 (패턴 매칭, ${key}):`, fileId);
                break;
              }
            }
          }

          log.info('최종 파일 ID:', { fileId, rowKeys: Object.keys(row) });

          if (fileId) {
            db.close();
            return fileId;
          } else {
            log.warn('긴 형식의 파일 ID를 찾지 못함. 행 데이터 확인 필요:', row);
          }
        }

        db.close();

      } catch (queryError) {
        log.error('DB 쿼리 오류', { error: queryError.message });
        try { db.close(); } catch (e) {}
      }
    } catch (dbError) {
      log.error('DB 열기 오류', { dbPath, error: dbError.message });
    }
  }

  return null;
}

// ============================================================================
// 버전 파싱 유틸리티 (Main Process용)
// ============================================================================

/**
 * 버전 패턴 목록
 */
const VERSION_PATTERNS = [
  { regex: /_v(\d+)/i, extract: (m) => parseInt(m[1], 10), suffix: (m) => m[0], type: 'version' },
  { regex: /_re(\d+)/i, extract: (m) => parseInt(m[1], 10) + 1, suffix: (m) => m[0], type: 'retake' },
  { regex: /_re$/i, extract: () => 2, suffix: () => '_re', type: 'retake' },
  { regex: /_final/i, extract: () => 999, suffix: (m) => m[0], type: 'final' }
];

/**
 * 파일명에서 버전 정보 파싱
 */
function parseVersionFromFileName(fileName) {
  if (!fileName) {
    return { version: null, suffix: null, displayLabel: '-', type: null };
  }

  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');

  for (const pattern of VERSION_PATTERNS) {
    const match = nameWithoutExt.match(pattern.regex);
    if (match) {
      const version = pattern.extract(match);
      const suffix = pattern.suffix(match);
      let displayLabel;

      if (pattern.type === 'final') {
        displayLabel = 'FINAL';
      } else if (pattern.type === 'retake') {
        displayLabel = `v${version} (${suffix})`;
      } else {
        displayLabel = `v${version}`;
      }

      return { version, suffix, displayLabel, type: pattern.type };
    }
  }

  return { version: null, suffix: null, displayLabel: '-', type: null };
}

/**
 * 파일명에서 기본 이름 추출 (버전 접미사 제거)
 */
function extractBaseName(fileName) {
  if (!fileName) return '';

  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');

  for (const pattern of VERSION_PATTERNS) {
    const match = nameWithoutExt.match(pattern.regex);
    if (match) {
      return nameWithoutExt.replace(pattern.regex, '');
    }
  }

  return nameWithoutExt;
}

/**
 * 바이트를 읽기 쉬운 형식으로 변환
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { setupIpcHandlers };
