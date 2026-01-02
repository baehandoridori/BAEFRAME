/**
 * baeframe - IPC 핸들러 등록
 */

const { ipcMain, dialog, app, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger');
const { getMainWindow, minimizeWindow, toggleMaximize, closeWindow, isMaximized } = require('./window');

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

module.exports = { setupIpcHandlers };
