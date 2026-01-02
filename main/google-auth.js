/**
 * baeframe - Google Drive OAuth 인증 및 파일 검색
 */

const { BrowserWindow, session } = require('electron');
const { createLogger } = require('./logger');
const Store = require('electron-store');

const log = createLogger('GoogleAuth');

// 토큰 저장소
const store = new Store({
  name: 'google-auth',
  encryptionKey: 'baeframe-secure-key-2024'
});

// Google OAuth 설정
const CONFIG = {
  CLIENT_ID: '798911270101-1lmnk5evmusf3kmls3hrh4nfrp6d57ph.apps.googleusercontent.com',
  CLIENT_SECRET: 'GOCSPX-placeholder', // 실제 시크릿은 환경변수나 별도 설정에서 가져와야 함
  REDIRECT_URI: 'http://localhost:8234/oauth2callback',
  SCOPES: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly'
  ]
};

let authWindow = null;

/**
 * 저장된 토큰 가져오기
 */
function getStoredToken() {
  const token = store.get('accessToken');
  const expiry = store.get('tokenExpiry');

  if (token && expiry && Date.now() < expiry) {
    log.info('저장된 토큰 유효함');
    return token;
  }

  log.info('저장된 토큰 없거나 만료됨');
  return null;
}

/**
 * 토큰 저장
 */
function saveToken(accessToken, expiresIn = 3600) {
  store.set('accessToken', accessToken);
  store.set('tokenExpiry', Date.now() + (expiresIn * 1000));
  log.info('토큰 저장됨');
}

/**
 * 토큰 삭제
 */
function clearToken() {
  store.delete('accessToken');
  store.delete('tokenExpiry');
  log.info('토큰 삭제됨');
}

/**
 * Google OAuth 인증 창 열기
 */
async function authenticate() {
  return new Promise((resolve, reject) => {
    // 이미 유효한 토큰이 있으면 반환
    const existingToken = getStoredToken();
    if (existingToken) {
      resolve(existingToken);
      return;
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${CONFIG.CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(CONFIG.SCOPES.join(' '))}` +
      `&prompt=consent`;

    authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    authWindow.loadURL(authUrl);

    // URL 변경 감지 (토큰이 fragment로 전달됨)
    authWindow.webContents.on('will-redirect', (event, url) => {
      handleRedirect(url, resolve, reject);
    });

    authWindow.webContents.on('did-navigate', (event, url) => {
      handleRedirect(url, resolve, reject);
    });

    authWindow.on('closed', () => {
      authWindow = null;
      reject(new Error('인증 창이 닫혔습니다'));
    });
  });
}

/**
 * 리다이렉트 URL에서 토큰 추출
 */
function handleRedirect(url, resolve, reject) {
  if (!url.startsWith(CONFIG.REDIRECT_URI)) return;

  try {
    // fragment에서 토큰 추출
    const fragment = url.split('#')[1];
    if (fragment) {
      const params = new URLSearchParams(fragment);
      const accessToken = params.get('access_token');
      const expiresIn = parseInt(params.get('expires_in') || '3600', 10);

      if (accessToken) {
        saveToken(accessToken, expiresIn);
        if (authWindow) {
          authWindow.close();
          authWindow = null;
        }
        resolve(accessToken);
        return;
      }
    }

    // 에러 확인
    const urlParams = new URLSearchParams(url.split('?')[1] || '');
    const error = urlParams.get('error');
    if (error) {
      reject(new Error(`인증 실패: ${error}`));
    }
  } catch (error) {
    reject(error);
  }
}

/**
 * Google Drive에서 파일명으로 검색
 */
async function searchFile(fileName, accessToken) {
  const token = accessToken || getStoredToken();
  if (!token) {
    throw new Error('인증이 필요합니다');
  }

  log.info('파일 검색 시작', { fileName });

  try {
    // 파일명에서 특수문자 이스케이프
    const escapedName = fileName.replace(/'/g, "\\'");
    const query = `name = '${escapedName}' and trashed = false`;

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(query)}` +
      `&fields=files(id,name,mimeType,webViewLink)` +
      `&supportsAllDrives=true` +
      `&includeItemsFromAllDrives=true`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        clearToken();
        throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
      }
      throw new Error(`검색 실패: ${response.status}`);
    }

    const data = await response.json();
    log.info('검색 결과', { count: data.files?.length || 0 });
    return data.files || [];
  } catch (error) {
    log.error('파일 검색 실패', error);
    throw error;
  }
}

/**
 * 파일 ID로 공유 링크 가져오기
 */
function getShareLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
}

/**
 * 인증 상태 확인
 */
function isAuthenticated() {
  return !!getStoredToken();
}

module.exports = {
  authenticate,
  getStoredToken,
  saveToken,
  clearToken,
  searchFile,
  getShareLink,
  isAuthenticated
};
