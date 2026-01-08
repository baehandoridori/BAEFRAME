/**
 * baeframe - IPC 핸들러 등록
 */

const { ipcMain, dialog, app, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
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
  let driveDbPaths = [];

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

module.exports = { setupIpcHandlers };
