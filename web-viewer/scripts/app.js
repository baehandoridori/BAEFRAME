/**
 * BAEFRAME 웹 뷰어 - 메인 애플리케이션
 */

// ============================================
// 전역 상태
// ============================================

const state = {
  // Google API
  gapiLoaded: false,
  gisLoaded: false,
  tokenClient: null,
  accessToken: null,

  // 파일 정보
  videoFileId: null,
  bframeFileId: null,
  bframeData: null,

  // 비디오 상태
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  frameRate: 24,

  // UI 상태
  currentTab: 'comments',
  isDrawMode: false,
  drawTool: 'pen',
  drawColor: '#ffff00',

  // 댓글 추가 모드
  isCommentMode: false,
  pendingCommentPos: null, // { x: 0-1, y: 0-1 }
  editingCommentId: null,

  // 그리기
  drawingContext: null,
  isDrawing: false,
  currentStroke: []
};

// Google API 설정
const CONFIG = {
  CLIENT_ID: '798911270101-1lmnk5evmusf3kmls3hrh4nfrp6d57ph.apps.googleusercontent.com',
  API_KEY: 'AIzaSyANCLUx8Hmaf0UT96N7HgAhseew48cyTdY',
  SCOPES: 'https://www.googleapis.com/auth/drive', // 전체 드라이브 접근 (기존 파일 수정 가능)
  DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
};

// 개발 모드 확인 (localhost, GitHub Pages, Vercel)
const IS_DEV_MODE = window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1' ||
                    window.location.protocol === 'file:' ||
                    window.location.hostname.includes('github.io') ||
                    window.location.hostname.includes('vercel.app'); // Vercel도 데모 모드

// 모바일 환경 감지
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                  (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);

// 테스트용 공개 비디오 URL
const TEST_VIDEO_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

// 모바일 자동 저장 (debounced)
let autoSaveTimeout = null;
function scheduleAutoSave() {
  if (!IS_MOBILE) return; // 모바일에서만 자동 저장
  if (!state.bframeFileId || !state.accessToken) return; // 저장 가능한 상태인지 확인

  // 기존 타이머 취소
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }

  // 2초 후 자동 저장
  autoSaveTimeout = setTimeout(async () => {
    try {
      console.log('📱 모바일 자동 저장 중...');
      await saveToDrive();
      console.log('✅ 모바일 자동 저장 완료');
      // 조용히 저장 (토스트 없음)
    } catch (error) {
      console.error('모바일 자동 저장 실패:', error);
    }
  }, 2000);
}

// ============================================
// 초기화
// ============================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log('BAEFRAME 웹 뷰어 초기화...');

  // 화면 요소 캐싱
  cacheElements();

  // 이벤트 리스너 등록
  setupEventListeners();

  // 저장된 토큰 복원 시도
  restoreAccessToken();

  // Google API 로드
  updateLoadingStatus('Google API 로드 중...');

  try {
    await loadGoogleAPI();
    console.log('✅ Google API 로드 완료');
  } catch (error) {
    console.error('Google API 로드 실패:', error);
    console.log('🔧 API 없이 진행');
  }

  // 로그인 상태 UI 업데이트
  updateLoginButtonState();

  // URL 파라미터 확인 (공유 링크로 들어온 경우)
  const urlParams = new URLSearchParams(window.location.search);
  const videoUrl = urlParams.get('video');
  const bframeUrl = urlParams.get('bframe');

  if (videoUrl && bframeUrl) {
    console.log('📎 URL 파라미터로 파일 로드:', { videoUrl, bframeUrl });
    // 입력 필드에 자동 입력
    if (elements.inputVideoUrl) elements.inputVideoUrl.value = videoUrl;
    if (elements.inputBframeUrl) elements.inputBframeUrl.value = bframeUrl;
    // 자동 로드 시도
    await autoLoadFromUrlParams(videoUrl, bframeUrl);
  } else {
    showScreen('select');
    addDemoButton();
  }
}

/**
 * 저장된 토큰 복원
 */
function restoreAccessToken() {
  try {
    const savedToken = localStorage.getItem('baeframe_access_token');
    const tokenExpiry = localStorage.getItem('baeframe_token_expiry');

    if (savedToken && tokenExpiry) {
      const expiryTime = parseInt(tokenExpiry, 10);
      const now = Date.now();

      // 토큰이 아직 유효한 경우 (만료 5분 전까지)
      if (expiryTime > now + 300000) {
        state.accessToken = savedToken;
        console.log('✅ 저장된 토큰 복원 성공');
        return true;
      } else {
        // 만료된 토큰 삭제
        localStorage.removeItem('baeframe_access_token');
        localStorage.removeItem('baeframe_token_expiry');
        console.log('⏰ 토큰 만료됨, 재로그인 필요');
      }
    }
  } catch (error) {
    console.error('토큰 복원 실패:', error);
  }
  return false;
}

/**
 * 토큰 저장 (7일 유효 - 로컬 캐시용, 만료 시 재로그인 필요)
 */
function saveAccessToken(token) {
  try {
    localStorage.setItem('baeframe_access_token', token);
    // 7일 유효 (604800000ms = 7 * 24 * 60 * 60 * 1000)
    const expiry = Date.now() + 604800000;
    localStorage.setItem('baeframe_token_expiry', expiry.toString());
    console.log('💾 토큰 저장됨 (7일 유효)');
  } catch (error) {
    console.error('토큰 저장 실패:', error);
  }
}

/**
 * 로그인 버튼 상태 업데이트
 */
function updateLoginButtonState() {
  if (state.accessToken && elements.btnGoogleLogin) {
    elements.btnGoogleLogin.innerHTML = '✓ 로그인됨 <small style="opacity:0.7">(재인증)</small>';
  }
}

/**
 * URL 파라미터로 파일 자동 로드
 */
async function autoLoadFromUrlParams(videoUrl, bframeUrl) {
  showScreen('loading');
  updateLoadingStatus('공유 링크에서 파일 로드 중...');

  // Google Drive URL인 경우 로그인 필요 여부 확인
  const isGoogleDriveVideo = videoUrl.includes('drive.google.com');
  const isGoogleDriveBframe = bframeUrl.includes('drive.google.com');
  const needsAuth = (isGoogleDriveVideo || isGoogleDriveBframe) && !state.accessToken;

  if (needsAuth) {
    // 로그인 필요 - 선택 화면으로 이동하되 URL은 유지
    showScreen('select');
    addDemoButton();
    showToast('Google Drive 파일입니다. 먼저 로그인해주세요.', 'info');
    return;
  }

  try {
    // 파일 ID 추출
    state.videoFileId = extractDriveFileId(videoUrl);
    state.bframeFileId = extractDriveFileId(bframeUrl);

    // .bframe 파일 로드
    updateLoadingStatus('.bframe 파일 로드 중...');
    await loadBframeFile(bframeUrl);

    // 비디오 로드
    updateLoadingStatus('영상 로드 중...');
    await loadVideo(videoUrl);

    // 뷰어 화면으로 전환
    showScreen('viewer');

    // UI 업데이트
    updateCommentsList();
    renderTimelineMarkers();
    renderVideoMarkers();

    showToast('파일을 불러왔습니다!', 'success');
  } catch (error) {
    console.error('자동 로드 실패:', error);
    showScreen('select');
    addDemoButton();
    showToast('파일 로드 실패: ' + error.message, 'error');
  }
}

// DOM 요소 캐싱
const elements = {};

function cacheElements() {
  // 화면
  elements.loadingScreen = document.getElementById('loadingScreen');
  elements.selectScreen = document.getElementById('selectScreen');
  elements.viewerScreen = document.getElementById('viewerScreen');

  // 로딩
  elements.loadingStatus = document.getElementById('loadingStatus');

  // 선택 화면
  elements.btnGoogleLogin = document.getElementById('btnGoogleLogin');
  elements.inputVideoUrl = document.getElementById('inputVideoUrl');
  elements.inputBframeUrl = document.getElementById('inputBframeUrl');
  elements.btnOpenFiles = document.getElementById('btnOpenFiles');

  // 뷰어 헤더
  elements.btnBack = document.getElementById('btnBack');
  elements.fileName = document.getElementById('fileName');
  elements.btnSave = document.getElementById('btnSave');

  // 비디오
  elements.videoPlayer = document.getElementById('videoPlayer');
  elements.drawingCanvas = document.getElementById('drawingCanvas');
  elements.markerOverlay = document.getElementById('markerOverlay');
  elements.videoMarkers = document.getElementById('videoMarkers');
  elements.videoContainer = document.getElementById('videoContainer');

  // 컨트롤
  elements.timeline = document.getElementById('timeline');
  elements.timelineProgress = document.getElementById('timelineProgress');
  elements.timelineMarkers = document.getElementById('timelineMarkers');
  elements.playhead = document.getElementById('playhead');
  elements.btnPrevFrame = document.getElementById('btnPrevFrame');
  elements.btnPlayPause = document.getElementById('btnPlayPause');
  elements.btnNextFrame = document.getElementById('btnNextFrame');
  elements.timeDisplay = document.getElementById('timeDisplay');

  // 탭
  elements.tabBtns = document.querySelectorAll('.tab-btn');
  elements.commentsPanel = document.getElementById('commentsPanel');
  elements.drawPanel = document.getElementById('drawPanel');

  // 댓글
  elements.btnAddComment = document.getElementById('btnAddComment');
  elements.commentsList = document.getElementById('commentsList');
  elements.commentCount = document.getElementById('commentCount');

  // 그리기
  elements.toolBtns = document.querySelectorAll('.tool-btn');
  elements.colorBtns = document.querySelectorAll('.color-btn');
  elements.btnClearDraw = document.getElementById('btnClearDraw');

  // 댓글 모달
  elements.commentModal = document.getElementById('commentModal');
  elements.btnCloseModal = document.getElementById('btnCloseModal');
  elements.commentTime = document.getElementById('commentTime');
  elements.commentText = document.getElementById('commentText');
  elements.btnCancelComment = document.getElementById('btnCancelComment');
  elements.btnSubmitComment = document.getElementById('btnSubmitComment');

  // 스레드 모달
  elements.threadModal = document.getElementById('threadModal');
  elements.btnCloseThread = document.getElementById('btnCloseThread');
  elements.threadOriginal = document.getElementById('threadOriginal');
  elements.threadReplies = document.getElementById('threadReplies');
  elements.replyInput = document.getElementById('replyInput');
  elements.btnSubmitReply = document.getElementById('btnSubmitReply');

  // 토스트
  elements.toast = document.getElementById('toast');
}

// ============================================
// 이벤트 리스너
// ============================================

function setupEventListeners() {
  // 선택 화면
  elements.btnGoogleLogin?.addEventListener('click', handleGoogleLogin);
  elements.inputVideoUrl?.addEventListener('input', validateInputs);
  elements.inputBframeUrl?.addEventListener('input', validateInputs);
  elements.btnOpenFiles?.addEventListener('click', handleOpenFiles);

  // 뷰어 헤더
  elements.btnBack?.addEventListener('click', handleBack);
  elements.btnSave?.addEventListener('click', handleSave);
  document.getElementById('btnShare')?.addEventListener('click', handleShare);

  // 비디오 컨트롤
  elements.videoPlayer?.addEventListener('loadedmetadata', handleVideoLoaded);
  elements.videoPlayer?.addEventListener('timeupdate', handleTimeUpdate);
  elements.videoPlayer?.addEventListener('play', () => updatePlayButton(true));
  elements.videoPlayer?.addEventListener('pause', () => updatePlayButton(false));
  elements.videoPlayer?.addEventListener('ended', () => updatePlayButton(false));

  elements.timeline?.addEventListener('click', handleTimelineClick);
  elements.btnPrevFrame?.addEventListener('click', () => seekFrame(-1));
  elements.btnPlayPause?.addEventListener('click', togglePlayPause);
  elements.btnNextFrame?.addEventListener('click', () => seekFrame(1));

  // 탭
  elements.tabBtns?.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 댓글
  elements.btnAddComment?.addEventListener('click', handleAddComment);
  elements.btnCloseModal?.addEventListener('click', closeCommentModal);
  elements.btnCancelComment?.addEventListener('click', closeCommentModal);
  elements.btnSubmitComment?.addEventListener('click', submitComment);

  // 스레드
  elements.btnCloseThread?.addEventListener('click', closeThreadModal);
  elements.btnSubmitReply?.addEventListener('click', submitReply);

  // 그리기 도구
  elements.toolBtns?.forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });
  elements.colorBtns?.forEach(btn => {
    btn.addEventListener('click', () => selectColor(btn.dataset.color));
  });
  elements.btnClearDraw?.addEventListener('click', clearDrawing);

  // 캔버스 그리기
  setupCanvasEvents();

  // 키보드 단축키
  document.addEventListener('keydown', handleKeydown);

  // 터치 이벤트 (모바일)
  setupTouchEvents();

  // 비디오 클릭/터치 (댓글 위치 선택)
  elements.videoContainer?.addEventListener('click', handleVideoClick);
  elements.videoContainer?.addEventListener('touchend', handleVideoClick, { passive: false });

  // 전체화면 버튼
  document.getElementById('btnFullscreen')?.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
}

// ============================================
// Google API
// ============================================

async function loadGoogleAPI() {
  return new Promise((resolve, reject) => {
    // GAPI 로드
    if (typeof gapi !== 'undefined') {
      gapi.load('client', async () => {
        try {
          await gapi.client.init({
            apiKey: CONFIG.API_KEY,
            discoveryDocs: [CONFIG.DISCOVERY_DOC]
          });
          state.gapiLoaded = true;
          console.log('GAPI 로드 완료');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    } else {
      // 개발 모드에서는 스킵
      resolve();
    }
  });
}

async function handleGoogleLogin(forceSilent = false) {
  if (!state.gapiLoaded) {
    showToast('Google API가 로드되지 않았습니다', 'error');
    return;
  }

  // 이미 로그인된 경우 재인증 여부 확인
  const isReauth = !!state.accessToken;
  if (isReauth && !forceSilent) {
    showToast('재인증 중...', 'info');
  }

  try {
    // Google Identity Services 사용
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: (response) => {
        if (response.error) {
          console.error('로그인 에러:', response);
          if (!forceSilent) {
            showToast('로그인 실패: ' + (response.error_description || response.error), 'error');
          }
          return;
        }
        state.accessToken = response.access_token;
        console.log('✅ 로그인 성공, 토큰 획득');

        // 토큰 저장 (자동 로그인용)
        saveAccessToken(response.access_token);

        // 버튼 상태 업데이트 (재인증 가능하도록 disabled 하지 않음)
        elements.btnGoogleLogin.innerHTML = '✓ 로그인됨 <small style="opacity:0.7">(재인증)</small>';
        if (!forceSilent) {
          showToast(isReauth ? '재인증 성공!' : '로그인 성공!', 'success');
        }
      }
    });

    // 저장된 토큰이 있고 유효하면 사용, 없으면 사용자 동의 요청
    // forceSilent가 true면 prompt 없이 시도 (실패하면 조용히 무시)
    const promptType = forceSilent ? '' : 'consent';
    state.tokenClient.requestAccessToken({ prompt: promptType });
  } catch (error) {
    console.error('로그인 에러:', error);
    if (!forceSilent) {
      showToast('로그인 중 오류 발생', 'error');
    }
  }
}

/**
 * 저장된 토큰이 만료된 경우 자동으로 토큰 갱신 시도
 */
async function tryAutoRefreshToken() {
  if (state.accessToken) return; // 이미 토큰이 있음

  const savedToken = localStorage.getItem('baeframe_access_token');
  const tokenExpiry = localStorage.getItem('baeframe_token_expiry');

  if (savedToken && tokenExpiry) {
    const expiryTime = parseInt(tokenExpiry, 10);
    const now = Date.now();

    // 토큰이 만료되었거나 곧 만료될 예정이면 자동 갱신 시도
    if (expiryTime <= now + 300000) {
      console.log('🔄 토큰 만료 임박, 자동 갱신 시도...');
      // Google GIS는 자동 갱신을 직접 지원하지 않음
      // 사용자가 다음 로그인 시 갱신됨
    }
  }
}

// ============================================
// 화면 전환
// ============================================

function showScreen(screenName) {
  elements.loadingScreen?.classList.remove('active');
  elements.selectScreen?.classList.remove('active');
  elements.viewerScreen?.classList.remove('active');

  switch (screenName) {
    case 'loading':
      elements.loadingScreen?.classList.add('active');
      break;
    case 'select':
      elements.selectScreen?.classList.add('active');
      break;
    case 'viewer':
      elements.viewerScreen?.classList.add('active');
      break;
  }
}

function updateLoadingStatus(message) {
  if (elements.loadingStatus) {
    elements.loadingStatus.textContent = message;
  }
}

// ============================================
// 파일 열기
// ============================================

function validateInputs() {
  const videoUrl = elements.inputVideoUrl?.value.trim();
  const bframeUrl = elements.inputBframeUrl?.value.trim();

  // 개발 모드에서는 조건 완화
  let isValid = false;

  if (IS_DEV_MODE) {
    // 개발 모드: 둘 중 하나만 있어도 OK (또는 demo 입력)
    isValid = videoUrl || bframeUrl || videoUrl === 'demo' || bframeUrl === 'demo';
  } else {
    isValid = videoUrl && bframeUrl &&
      (videoUrl.includes('drive.google.com') || videoUrl.startsWith('http')) &&
      (bframeUrl.includes('drive.google.com') || bframeUrl.startsWith('http'));
  }

  if (elements.btnOpenFiles) {
    elements.btnOpenFiles.disabled = !isValid;
  }
}

// 개발 모드용 데모 버튼 추가
function addDemoButton() {
  const selectContent = document.querySelector('.select-content');
  if (!selectContent) return;

  // 이미 있으면 추가 안 함
  if (document.getElementById('btnDemo')) return;

  const demoSection = document.createElement('div');
  demoSection.className = 'demo-section';
  demoSection.innerHTML = `
    <div style="margin: 2rem 0; padding: 1rem; background: #1a3a1a; border-radius: 8px; border: 1px solid #2a5a2a;">
      <h3 style="color: #4aff4a; margin-bottom: 0.5rem;">🔧 개발 모드</h3>
      <p style="color: #aaa; font-size: 0.9rem; margin-bottom: 1rem;">
        실제 파일 없이 샘플 데이터로 테스트할 수 있습니다.
      </p>
      <button id="btnDemo" style="
        width: 100%;
        padding: 1rem;
        background: linear-gradient(135deg, #4a9eff, #4aff9e);
        border: none;
        border-radius: 8px;
        color: #000;
        font-size: 1rem;
        font-weight: bold;
        cursor: pointer;
      ">
        🎬 데모 보기 (샘플 영상)
      </button>
    </div>
  `;

  // 버튼 앞에 삽입
  const btnOpenFiles = elements.btnOpenFiles;
  btnOpenFiles.parentNode.insertBefore(demoSection, btnOpenFiles.nextSibling);

  // 데모 버튼 이벤트
  document.getElementById('btnDemo').addEventListener('click', openDemoMode);
}

// 데모 모드 열기
async function openDemoMode() {
  showScreen('loading');
  updateLoadingStatus('데모 영상 로드 중...');

  try {
    // 샘플 .bframe 데이터 로드
    state.bframeData = getSampleBframeData();

    // 테스트용 공개 비디오 로드
    await loadVideo(TEST_VIDEO_URL);

    // 뷰어 화면으로 전환
    showScreen('viewer');

    // UI 업데이트
    updateCommentsList();
    renderTimelineMarkers();
    renderVideoMarkers();

    showToast('데모 모드로 시작합니다!', 'success');
  } catch (error) {
    console.error('데모 로드 실패:', error);
    showToast('데모 로드 실패: ' + error.message, 'error');
    showScreen('select');
  }
}

async function handleOpenFiles() {
  const videoUrl = elements.inputVideoUrl?.value.trim();
  const bframeUrl = elements.inputBframeUrl?.value.trim();

  if (!videoUrl || !bframeUrl) {
    showToast('URL을 입력해주세요', 'error');
    return;
  }

  // Google Drive URL인 경우 로그인 체크
  const isGoogleDriveVideo = videoUrl.includes('drive.google.com');
  const isGoogleDriveBframe = bframeUrl.includes('drive.google.com');

  if ((isGoogleDriveVideo || isGoogleDriveBframe) && !state.accessToken) {
    showToast('Google Drive 파일을 열려면 먼저 로그인하세요', 'error');
    return;
  }

  showScreen('loading');
  updateLoadingStatus('파일 로드 중...');

  try {
    // Google Drive ID 추출
    state.videoFileId = extractDriveFileId(videoUrl);
    state.bframeFileId = extractDriveFileId(bframeUrl);

    // .bframe 파일 로드
    updateLoadingStatus('.bframe 파일 로드 중...');
    await loadBframeFile(bframeUrl);

    // 비디오 로드
    updateLoadingStatus('영상 로드 중...');
    await loadVideo(videoUrl);

    // 뷰어 화면으로 전환
    showScreen('viewer');

    // UI 업데이트
    updateCommentsList();
    renderTimelineMarkers();
    renderVideoMarkers();

    // 최근 파일에 추가
    saveRecentFile(videoUrl, bframeUrl);

  } catch (error) {
    console.error('파일 로드 실패:', error);
    showToast('파일 로드 실패: ' + error.message, 'error');
    showScreen('select');
  }
}

// 최근 파일 저장
function saveRecentFile(videoUrl, bframeUrl) {
  try {
    const recent = JSON.parse(localStorage.getItem('recentFiles') || '[]');
    const newEntry = {
      videoUrl,
      bframeUrl,
      name: state.bframeData?.videoFile || 'Unknown',
      date: new Date().toISOString()
    };
    // 중복 제거 후 맨 앞에 추가
    const filtered = recent.filter(r => r.bframeUrl !== bframeUrl);
    filtered.unshift(newEntry);
    // 최대 10개
    localStorage.setItem('recentFiles', JSON.stringify(filtered.slice(0, 10)));
  } catch (e) {
    console.warn('최근 파일 저장 실패:', e);
  }
}

function extractDriveFileId(url) {
  console.log('🔍 URL 파싱 시작:', url);

  // Google Drive URL에서 파일 ID 추출
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const fileId = match[1];
      console.log('✅ 추출된 파일 ID:', fileId);
      console.log('📋 ID 길이:', fileId.length, '문자');
      return fileId;
    }
  }

  console.error('❌ 파일 ID 추출 실패');
  return null;
}

async function loadBframeFile(url) {
  // 개발 모드: 샘플 데이터 사용
  if (url.startsWith('sample://') || !url.includes('drive.google.com')) {
    state.bframeData = getSampleBframeData();
    return;
  }

  // Google Drive에서 파일 로드
  const fileId = extractDriveFileId(url);
  if (!fileId) {
    throw new Error('올바른 Google Drive URL이 아닙니다');
  }

  console.log('bframe 파일 ID:', fileId);
  console.log('Access Token:', state.accessToken ? '있음 (' + state.accessToken.substring(0, 20) + '...)' : '없음');

  // 인증된 fetch 사용 (Shared Drive 지원)
  if (state.accessToken) {
    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        {
          headers: {
            'Authorization': `Bearer ${state.accessToken}`
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API 에러 응답:', errorText);

        // 에러 코드별 메시지
        if (response.status === 401) {
          throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
        } else if (response.status === 403) {
          throw new Error('파일 접근 권한이 없습니다. 해당 계정으로 로그인했는지 확인해주세요.');
        } else if (response.status === 404) {
          throw new Error('파일을 찾을 수 없습니다. URL을 확인해주세요.');
        } else {
          throw new Error(`API 오류 (${response.status}): ${errorText.substring(0, 100)}`);
        }
      }

      state.bframeData = await response.json();
      console.log('✅ bframe 로드 완료:', state.bframeData);
      return;
    } catch (error) {
      console.error('인증된 접근 실패:', error);
      throw error; // 원래 에러 메시지 그대로 전달
    }
  }

  throw new Error('로그인이 필요합니다');
}

async function loadVideo(url) {
  const fileId = extractDriveFileId(url);

  // Google Drive 영상인 경우 인증된 다운로드
  if (fileId && state.accessToken) {
    return loadVideoFromDrive(fileId);
  }

  // 일반 URL인 경우 직접 로드
  return loadVideoFromUrl(url);
}

async function loadVideoFromDrive(fileId) {
  console.log('Google Drive 영상 로드 시작:', fileId);
  updateLoadingStatus('영상 다운로드 중... (0%)');

  try {
    // 파일 메타데이터 먼저 가져오기 (Shared Drive 지원)
    const metaResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,size,mimeType&supportsAllDrives=true`,
      {
        headers: { 'Authorization': `Bearer ${state.accessToken}` }
      }
    );

    if (!metaResponse.ok) {
      const errorText = await metaResponse.text();
      console.error('메타데이터 에러:', metaResponse.status, errorText);

      if (metaResponse.status === 401) {
        throw new Error('인증이 만료되었습니다. 페이지를 새로고침하고 다시 로그인해주세요.');
      } else if (metaResponse.status === 403) {
        throw new Error('영상 파일 접근 권한이 없습니다. 파일이 공유되었는지 확인해주세요.');
      } else if (metaResponse.status === 404) {
        throw new Error('영상 파일을 찾을 수 없습니다.');
      }
      throw new Error(`영상 정보 로드 실패 (${metaResponse.status})`);
    }

    const meta = await metaResponse.json();
    console.log('파일 정보:', meta);
    elements.fileName.textContent = meta.name || '영상';

    // 영상 다운로드 (진행률 표시, Shared Drive 지원)
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      {
        headers: { 'Authorization': `Bearer ${state.accessToken}` }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('영상 다운로드 에러:', response.status, errorText);

      if (response.status === 403) {
        throw new Error('영상 파일 접근 권한이 없습니다.');
      } else if (response.status === 404) {
        throw new Error('영상 파일을 찾을 수 없습니다.');
      }
      throw new Error(`영상 다운로드 실패 (${response.status})`);
    }

    const contentLength = response.headers.get('content-length');
    const total = parseInt(contentLength, 10) || parseInt(meta.size, 10) || 0;
    let loaded = 0;

    // 스트림으로 읽기 (진행률 표시)
    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.length;

      if (total > 0) {
        const percent = Math.round((loaded / total) * 100);
        updateLoadingStatus(`영상 다운로드 중... (${percent}%)`);
      }
    }

    // Blob 생성
    const blob = new Blob(chunks, { type: meta.mimeType || 'video/mp4' });
    const videoUrl = URL.createObjectURL(blob);

    console.log('✅ 영상 다운로드 완료, Blob URL 생성');

    // 비디오 로드
    return loadVideoFromUrl(videoUrl);

  } catch (error) {
    console.error('Google Drive 영상 로드 실패:', error);
    // 원래 에러 메시지 유지
    throw error;
  }
}

function loadVideoFromUrl(url) {
  return new Promise((resolve, reject) => {
    console.log('영상 로드 시도:', url.substring(0, 100));

    // 기존 이벤트 제거
    elements.videoPlayer.oncanplay = null;
    elements.videoPlayer.onerror = null;
    elements.videoPlayer.onloadedmetadata = null;

    let resolved = false;

    const handleSuccess = () => {
      if (resolved) return;
      resolved = true;
      console.log('✅ 비디오 로드 완료');
      resolve();
    };

    const handleError = (e) => {
      if (resolved) return;
      resolved = true;
      console.error('❌ 비디오 로드 실패:', e);
      reject(new Error('영상을 불러올 수 없습니다. URL을 확인해주세요.'));
    };

    // 이벤트 리스너 등록
    elements.videoPlayer.onloadedmetadata = handleSuccess;
    elements.videoPlayer.oncanplay = handleSuccess;
    elements.videoPlayer.onerror = handleError;

    // 소스 설정 및 로드
    elements.videoPlayer.src = url;
    elements.videoPlayer.load();

    // 타임아웃 (60초)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('영상 로드 시간 초과 (60초)'));
      }
    }, 60000);
  });
}

// 샘플 데이터 (개발용)
function getSampleBframeData() {
  return {
    version: '1.0',
    videoFile: 'sample.mp4',
    frameRate: 24,
    comments: [
      {
        id: '1',
        frame: 100,
        text: '이 부분 색감 확인 부탁드립니다',
        author: '감독님',
        timestamp: Date.now() - 3600000,
        replies: [
          { id: '1-1', text: '네, 수정하겠습니다!', author: '팀원A', timestamp: Date.now() - 1800000 }
        ]
      },
      {
        id: '2',
        frame: 250,
        text: '캐릭터 움직임이 조금 부자연스러워요',
        author: '감독님',
        timestamp: Date.now() - 7200000,
        replies: []
      },
      {
        id: '3',
        frame: 500,
        text: 'OK! 여기는 좋습니다 👍',
        author: '감독님',
        timestamp: Date.now() - 1800000,
        replies: []
      }
    ],
    drawings: [],
    keyframes: []
  };
}

// ============================================
// 비디오 컨트롤
// ============================================

function handleVideoLoaded() {
  state.duration = elements.videoPlayer.duration;
  // fps는 comments.fps 또는 최상위 frameRate에서 가져옴
  state.frameRate = state.bframeData?.comments?.fps || state.bframeData?.frameRate || 24;

  // 파일명 표시
  const fileName = state.bframeData?.videoName || state.bframeData?.videoFile || '영상';
  elements.fileName.textContent = fileName;

  // 캔버스 크기 설정
  resizeCanvas();

  // 시간 표시 업데이트
  updateTimeDisplay();
}

function handleTimeUpdate() {
  state.currentTime = elements.videoPlayer.currentTime;
  updateTimeDisplay();
  updatePlayhead();
  renderDrawingForCurrentFrame();
  updateVideoMarkersVisibility();
}

function updateTimeDisplay() {
  const current = formatTime(state.currentTime);
  const total = formatTime(state.duration);
  const frame = Math.floor(state.currentTime * state.frameRate);

  elements.timeDisplay.textContent = `${current} / ${total} (F${frame})`;
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00:00';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updatePlayhead() {
  if (!state.duration) return;

  const progress = (state.currentTime / state.duration) * 100;
  elements.playhead.style.left = `${progress}%`;
  elements.timelineProgress.style.width = `${progress}%`;
}

function updatePlayButton(isPlaying) {
  state.isPlaying = isPlaying;
  elements.btnPlayPause.textContent = isPlaying ? '⏸' : '▶';
}

function togglePlayPause() {
  if (state.isPlaying) {
    elements.videoPlayer.pause();
  } else {
    elements.videoPlayer.play();
  }
}

function seekFrame(delta) {
  const frameDuration = 1 / state.frameRate;
  const newTime = Math.max(0, Math.min(state.duration, state.currentTime + (delta * frameDuration)));
  elements.videoPlayer.currentTime = newTime;
}

function seekToTime(time) {
  elements.videoPlayer.currentTime = Math.max(0, Math.min(state.duration, time));
}

function seekToFrame(frame) {
  const time = frame / state.frameRate;
  seekToTime(time);
}

function handleTimelineClick(e) {
  const rect = elements.timeline.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const progress = x / rect.width;
  const newTime = progress * state.duration;
  seekToTime(newTime);
}

// ============================================
// 댓글
// ============================================

/**
 * bframe 파일에서 모든 댓글(마커) 추출
 * 데스크톱 앱 구조: comments.layers[].markers[]
 */
function getAllComments() {
  const commentsData = state.bframeData?.comments;

  // 새 구조: comments.layers[].markers[]
  if (commentsData?.layers && Array.isArray(commentsData.layers)) {
    const allMarkers = [];
    for (const layer of commentsData.layers) {
      if (layer.markers && Array.isArray(layer.markers)) {
        for (const marker of layer.markers) {
          allMarkers.push({
            ...marker,
            frame: marker.startFrame, // startFrame을 frame으로 매핑
            layerName: layer.name,
            layerColor: layer.color
          });
        }
      }
    }
    return allMarkers.sort((a, b) => a.frame - b.frame);
  }

  // 이전 구조 (배열): comments[]
  if (Array.isArray(commentsData)) {
    return commentsData;
  }

  // comments가 없거나 알 수 없는 구조
  return [];
}

function updateCommentsList() {
  const comments = getAllComments();
  elements.commentCount.textContent = comments.length;

  elements.commentsList.innerHTML = comments.map(comment => {
    const frame = comment.frame || comment.startFrame || 0;
    const time = formatTime(frame / state.frameRate);
    const replyCount = comment.replies?.length || 0;

    return `
      <div class="comment-card" data-id="${comment.id}" data-frame="${frame}">
        <div class="comment-header">
          <span class="comment-time">${time}</span>
          <span class="comment-author">${comment.author || '익명'}</span>
        </div>
        <div class="comment-text">${escapeHtml(comment.text)}</div>
        <div class="comment-footer">
          <span class="reply-count">${replyCount > 0 ? `💬 답글 ${replyCount}개` : ''}</span>
          <div class="comment-actions">
            <button data-action="edit">수정</button>
            <button data-action="delete">삭제</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 댓글 카드 클릭 이벤트
  elements.commentsList.querySelectorAll('.comment-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const id = card.dataset.id;
      const frame = parseInt(card.dataset.frame);

      if (action === 'edit') {
        editComment(id);
      } else if (action === 'delete') {
        deleteComment(id);
      } else {
        // 해당 시간으로 이동
        seekToFrame(frame);
      }
    });

    // 더블클릭: 스레드 열기
    card.addEventListener('dblclick', () => {
      openThread(card.dataset.id);
    });
  });
}

function renderTimelineMarkers() {
  const comments = getAllComments();

  elements.timelineMarkers.innerHTML = comments.map(comment => {
    const frame = comment.frame || comment.startFrame || 0;
    const progress = (frame / state.frameRate / state.duration) * 100;
    const color = comment.layerColor || '#ff6b6b';
    return `<div class="timeline-marker" style="left: ${progress}%; background-color: ${color}" data-frame="${frame}"></div>`;
  }).join('');

  // 마커 클릭 이벤트
  elements.timelineMarkers.querySelectorAll('.timeline-marker').forEach(marker => {
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      const frame = parseInt(marker.dataset.frame);
      seekToFrame(frame);
    });
  });
}

/**
 * 영상 위에 마커 렌더링
 */
function renderVideoMarkers() {
  if (!elements.videoMarkers) return;

  const comments = getAllComments();
  elements.videoMarkers.innerHTML = '';

  comments.forEach(comment => {
    const markerEl = document.createElement('div');
    markerEl.className = `video-marker${comment.resolved ? ' resolved' : ''}`;
    markerEl.dataset.markerId = comment.id;

    const startFrame = comment.frame || comment.startFrame || 0;
    markerEl.dataset.frame = startFrame;
    // endFrame이 있으면 사용, 없으면 updateVideoMarkersVisibility에서 기본값 적용
    if (comment.endFrame) {
      markerEl.dataset.endFrame = comment.endFrame;
    }

    // x, y 위치 (0-1 정규화 좌표)
    const x = (comment.x || 0.5) * 100;
    const y = (comment.y || 0.5) * 100;
    markerEl.style.left = `${x}%`;
    markerEl.style.top = `${y}%`;

    // 레이어 색상
    if (comment.layerColor) {
      markerEl.style.setProperty('--accent-color', comment.layerColor);
    }

    // 툴팁
    const tooltip = document.createElement('div');
    tooltip.className = 'video-marker-tooltip';
    tooltip.textContent = comment.text || '';
    markerEl.appendChild(tooltip);

    // 클릭 시 해당 프레임으로 이동 & 댓글 하이라이트
    markerEl.addEventListener('click', () => {
      const frame = parseInt(markerEl.dataset.frame);
      seekToFrame(frame);
      highlightComment(comment.id);
    });

    elements.videoMarkers.appendChild(markerEl);
  });

  updateVideoMarkersVisibility();
}

/**
 * 현재 프레임에 따라 마커 가시성 업데이트
 */
function updateVideoMarkersVisibility() {
  if (!elements.videoMarkers) return;

  const currentFrame = Math.floor(state.currentTime * state.frameRate);
  // 마커 표시 시간: 4초 (프레임레이트 * 4)
  const markerDurationFrames = state.frameRate * 4;

  elements.videoMarkers.querySelectorAll('.video-marker').forEach(marker => {
    const startFrame = parseInt(marker.dataset.frame);
    // endFrame이 설정되어 있으면 사용, 아니면 기본 4초
    const endFrame = parseInt(marker.dataset.endFrame) || (startFrame + markerDurationFrames);

    if (currentFrame >= startFrame && currentFrame < endFrame) {
      marker.classList.remove('hidden');
    } else {
      marker.classList.add('hidden');
    }
  });
}

/**
 * 특정 댓글 하이라이트
 */
function highlightComment(commentId) {
  // 기존 하이라이트 제거
  document.querySelectorAll('.comment-card.highlighted').forEach(el => {
    el.classList.remove('highlighted');
  });

  // 새 하이라이트
  const card = document.querySelector(`.comment-card[data-id="${commentId}"]`);
  if (card) {
    card.classList.add('highlighted');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * 댓글 추가 모드 시작
 */
function handleAddComment() {
  elements.videoPlayer.pause();
  state.isCommentMode = true;
  state.pendingCommentPos = null;
  state.editingCommentId = null;

  // 영상 컨테이너에 댓글 모드 표시
  elements.videoContainer?.classList.add('comment-mode');
  showToast('영상을 터치하여 마커 위치를 선택하세요', 'info');
}

/**
 * 영상 클릭/터치 시 댓글 위치 선택
 */
function handleVideoClick(e) {
  if (!state.isCommentMode) return;

  // 터치 이벤트 중복 방지
  if (e.type === 'touchend') {
    e.preventDefault();
  }

  // 터치 또는 클릭 좌표 가져오기
  const rect = elements.videoContainer.getBoundingClientRect();
  let clientX, clientY;

  if (e.type === 'touchend' && e.changedTouches && e.changedTouches.length > 0) {
    // touchend: changedTouches 사용
    clientX = e.changedTouches[0].clientX;
    clientY = e.changedTouches[0].clientY;
  } else if (e.touches && e.touches.length > 0) {
    // touchstart/touchmove: touches 사용
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    // 마우스 클릭
    clientX = e.clientX;
    clientY = e.clientY;
  }

  // 좌표 유효성 검사
  if (clientX === undefined || clientY === undefined) {
    console.warn('터치 좌표를 가져올 수 없습니다');
    return;
  }

  // 정규화된 좌표 (0-1)
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;

  // 범위 체크
  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  console.log('📍 마커 위치 선택:', { x: x.toFixed(3), y: y.toFixed(3) });

  state.pendingCommentPos = { x, y };
  state.isCommentMode = false;
  elements.videoContainer?.classList.remove('comment-mode');

  // 모달 열기
  openCommentModal();
}

/**
 * 댓글 모달 열기
 */
function openCommentModal(editComment = null) {
  const time = formatTime(state.currentTime);
  elements.commentTime.textContent = time;

  if (editComment) {
    // 수정 모드
    state.editingCommentId = editComment.id;
    elements.commentText.value = editComment.text || '';
    elements.commentModal.querySelector('h3').textContent = '댓글 수정';
  } else {
    // 추가 모드
    state.editingCommentId = null;
    elements.commentText.value = '';
    elements.commentModal.querySelector('h3').textContent = '댓글 작성';
  }

  elements.commentModal.classList.remove('hidden');
  elements.commentText.focus();
}

function closeCommentModal() {
  elements.commentModal.classList.add('hidden');
  state.isCommentMode = false;
  state.pendingCommentPos = null;
  state.editingCommentId = null;
  elements.videoContainer?.classList.remove('comment-mode');
}

function submitComment() {
  const text = elements.commentText.value.trim();
  if (!text) {
    showToast('댓글 내용을 입력해주세요', 'error');
    return;
  }

  const frame = Math.floor(state.currentTime * state.frameRate);

  // 수정 모드
  if (state.editingCommentId) {
    updateExistingComment(state.editingCommentId, text);
    return;
  }

  // 새 댓글 추가 (데스크톱 앱 구조에 맞춤)
  const newMarker = {
    id: generateId(),
    x: state.pendingCommentPos?.x || 0.5,
    y: state.pendingCommentPos?.y || 0.5,
    startFrame: frame,
    endFrame: frame + state.frameRate * 4, // 4초간 표시
    text: text,
    author: '웹 사용자',
    createdAt: new Date().toISOString(),
    resolved: false,
    replies: []
  };

  // bframe 데이터 구조 확인 및 초기화
  if (!state.bframeData.comments) {
    state.bframeData.comments = {
      fps: state.frameRate,
      layers: []
    };
  }

  // layers 구조가 아닌 경우 변환
  if (!state.bframeData.comments.layers) {
    state.bframeData.comments = {
      fps: state.frameRate,
      layers: [{
        id: 'web-layer-1',
        name: '웹 댓글',
        color: '#ff6b6b',
        visible: true,
        locked: false,
        markers: Array.isArray(state.bframeData.comments) ? state.bframeData.comments : []
      }]
    };
  }

  // 첫 번째 레이어에 마커 추가
  if (state.bframeData.comments.layers.length === 0) {
    state.bframeData.comments.layers.push({
      id: 'web-layer-1',
      name: '웹 댓글',
      color: '#ff6b6b',
      visible: true,
      locked: false,
      markers: []
    });
  }

  state.bframeData.comments.layers[0].markers.push(newMarker);

  // UI 업데이트
  updateCommentsList();
  renderTimelineMarkers();
  renderVideoMarkers();
  closeCommentModal();
  showToast('댓글이 추가되었습니다', 'success');

  // 모바일 자동 저장
  scheduleAutoSave();
}

/**
 * 기존 댓글 수정
 */
function updateExistingComment(commentId, newText) {
  const layers = state.bframeData?.comments?.layers || [];

  for (const layer of layers) {
    const marker = layer.markers?.find(m => m.id === commentId);
    if (marker) {
      marker.text = newText;
      marker.modifiedAt = new Date().toISOString();
      break;
    }
  }

  updateCommentsList();
  renderVideoMarkers();
  closeCommentModal();
  showToast('댓글이 수정되었습니다', 'success');

  // 모바일 자동 저장
  scheduleAutoSave();
}

/**
 * 댓글 삭제
 */
function deleteComment(commentId) {
  if (!confirm('댓글을 삭제하시겠습니까?')) return;

  const layers = state.bframeData?.comments?.layers || [];

  for (const layer of layers) {
    const idx = layer.markers?.findIndex(m => m.id === commentId);
    if (idx !== undefined && idx >= 0) {
      layer.markers.splice(idx, 1);
      break;
    }
  }

  updateCommentsList();
  renderTimelineMarkers();
  renderVideoMarkers();
  showToast('댓글이 삭제되었습니다', 'info');

  // 모바일 자동 저장
  scheduleAutoSave();
}

/**
 * 댓글 수정 (모달 열기)
 */
function editComment(commentId) {
  const comment = findCommentById(commentId);
  if (!comment) {
    showToast('댓글을 찾을 수 없습니다', 'error');
    return;
  }

  // 해당 프레임으로 이동
  const frame = comment.startFrame || comment.frame || 0;
  seekToFrame(frame);

  // 모달 열기 (수정 모드)
  openCommentModal(comment);
}

/**
 * ID로 댓글 찾기 (layers 구조 지원)
 */
function findCommentById(commentId) {
  const layers = state.bframeData?.comments?.layers || [];

  for (const layer of layers) {
    const marker = layer.markers?.find(m => m.id === commentId);
    if (marker) {
      return { ...marker, layerName: layer.name, layerColor: layer.color };
    }
  }

  // 이전 구조 (배열)
  if (Array.isArray(state.bframeData?.comments)) {
    return state.bframeData.comments.find(c => c.id === commentId);
  }

  return null;
}

// ============================================
// 스레드
// ============================================

let currentThreadId = null;

function openThread(commentId) {
  const comment = findCommentById(commentId);
  if (!comment) return;

  currentThreadId = commentId;

  // 원본 댓글 표시
  const frame = comment.startFrame || comment.frame || 0;
  const time = formatTime(frame / state.frameRate);
  elements.threadOriginal.innerHTML = `
    <div class="comment-time">${time}</div>
    <div class="comment-author">${comment.author || '익명'}</div>
    <div class="comment-text">${escapeHtml(comment.text)}</div>
  `;

  // 답글 표시
  const replies = comment.replies || [];
  elements.threadReplies.innerHTML = replies.map(reply => `
    <div class="reply-item">
      <div class="reply-author">${reply.author || '익명'}</div>
      <div class="comment-text">${escapeHtml(reply.text)}</div>
    </div>
  `).join('');

  elements.replyInput.value = '';
  elements.threadModal.classList.remove('hidden');
}

function closeThreadModal() {
  elements.threadModal.classList.add('hidden');
  currentThreadId = null;
}

function submitReply() {
  if (!currentThreadId) return;

  const text = elements.replyInput.value.trim();
  if (!text) return;

  // layers 구조에서 실제 마커 객체 찾기
  const layers = state.bframeData?.comments?.layers || [];
  let comment = null;

  for (const layer of layers) {
    comment = layer.markers?.find(m => m.id === currentThreadId);
    if (comment) break;
  }

  // 이전 구조 (배열)
  if (!comment && Array.isArray(state.bframeData?.comments)) {
    comment = state.bframeData.comments.find(c => c.id === currentThreadId);
  }

  if (!comment) return;

  if (!comment.replies) {
    comment.replies = [];
  }

  comment.replies.push({
    id: generateId(),
    text: text,
    author: '웹 사용자',
    timestamp: Date.now()
  });

  openThread(currentThreadId); // 새로고침
  updateCommentsList();
  elements.replyInput.value = '';
  showToast('답글이 추가되었습니다', 'success');

  // 모바일 자동 저장
  scheduleAutoSave();
}

// ============================================
// 그리기
// ============================================

function resizeCanvas() {
  const container = elements.videoPlayer.parentElement;
  const video = elements.videoPlayer;

  elements.drawingCanvas.width = video.videoWidth || container.clientWidth;
  elements.drawingCanvas.height = video.videoHeight || container.clientHeight;

  state.drawingContext = elements.drawingCanvas.getContext('2d');
}

function setupCanvasEvents() {
  const canvas = elements.drawingCanvas;

  // 마우스 이벤트
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseleave', stopDrawing);

  // 터치 이벤트
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', stopDrawing);
}

function startDrawing(e) {
  if (!state.isDrawMode) return;

  state.isDrawing = true;
  state.currentStroke = [];

  const pos = getCanvasPosition(e);
  state.currentStroke.push(pos);

  state.drawingContext.beginPath();
  state.drawingContext.moveTo(pos.x, pos.y);
  state.drawingContext.strokeStyle = state.drawColor;
  state.drawingContext.lineWidth = 3;
  state.drawingContext.lineCap = 'round';
  state.drawingContext.lineJoin = 'round';
}

function draw(e) {
  if (!state.isDrawing || !state.isDrawMode) return;

  const pos = getCanvasPosition(e);
  state.currentStroke.push(pos);

  state.drawingContext.lineTo(pos.x, pos.y);
  state.drawingContext.stroke();
}

function stopDrawing() {
  if (!state.isDrawing) return;

  state.isDrawing = false;

  // 스트로크 저장
  if (state.currentStroke.length > 1) {
    const frame = Math.floor(state.currentTime * state.frameRate);

    if (!state.bframeData.drawings) {
      state.bframeData.drawings = [];
    }

    // 해당 프레임의 드로잉 찾기 또는 생성
    let frameDrawing = state.bframeData.drawings.find(d => d.frame === frame);
    if (!frameDrawing) {
      frameDrawing = { frame: frame, strokes: [] };
      state.bframeData.drawings.push(frameDrawing);
    }

    frameDrawing.strokes.push({
      points: state.currentStroke,
      color: state.drawColor,
      width: 3
    });
  }

  state.currentStroke = [];
}

function handleTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  startDrawing({ clientX: touch.clientX, clientY: touch.clientY });
}

function handleTouchMove(e) {
  e.preventDefault();
  const touch = e.touches[0];
  draw({ clientX: touch.clientX, clientY: touch.clientY });
}

function getCanvasPosition(e) {
  const rect = elements.drawingCanvas.getBoundingClientRect();
  const scaleX = elements.drawingCanvas.width / rect.width;
  const scaleY = elements.drawingCanvas.height / rect.height;

  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function renderDrawingForCurrentFrame() {
  if (!state.drawingContext) return;

  const frame = Math.floor(state.currentTime * state.frameRate);
  const drawings = state.bframeData?.drawings;

  // 캔버스 클리어
  state.drawingContext.clearRect(0, 0, elements.drawingCanvas.width, elements.drawingCanvas.height);

  // drawings가 배열인지 확인
  if (!Array.isArray(drawings)) return;

  const frameDrawing = drawings.find(d => d.frame === frame);
  if (!frameDrawing) return;

  // 스트로크 그리기
  for (const stroke of frameDrawing.strokes) {
    if (!stroke.points || stroke.points.length < 2) continue;

    state.drawingContext.beginPath();
    state.drawingContext.strokeStyle = stroke.color || '#ffff00';
    state.drawingContext.lineWidth = stroke.width || 3;
    state.drawingContext.lineCap = 'round';
    state.drawingContext.lineJoin = 'round';

    state.drawingContext.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      state.drawingContext.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    state.drawingContext.stroke();
  }
}

function selectTool(tool) {
  state.drawTool = tool;
  elements.toolBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
}

function selectColor(color) {
  state.drawColor = color;
  elements.colorBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}

function clearDrawing() {
  const frame = Math.floor(state.currentTime * state.frameRate);

  if (state.bframeData.drawings) {
    state.bframeData.drawings = state.bframeData.drawings.filter(d => d.frame !== frame);
  }

  state.drawingContext?.clearRect(0, 0, elements.drawingCanvas.width, elements.drawingCanvas.height);
  showToast('현재 프레임 그리기가 삭제되었습니다', 'success');
}

// ============================================
// 탭 전환
// ============================================

function switchTab(tabName) {
  state.currentTab = tabName;

  elements.tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  elements.commentsPanel.classList.toggle('hidden', tabName !== 'comments');
  elements.drawPanel.classList.toggle('hidden', tabName !== 'draw');

  // 그리기 모드 토글
  state.isDrawMode = tabName === 'draw';
  document.body.classList.toggle('draw-mode', state.isDrawMode);
}

// ============================================
// 저장
// ============================================

async function handleSave() {
  if (!state.bframeData) {
    showToast('저장할 데이터가 없습니다', 'error');
    return;
  }

  try {
    showToast('저장 중...', 'info');

    // Google Drive에 저장
    if (state.bframeFileId && state.accessToken) {
      await saveToDrive();
    } else {
      // 로컬 다운로드
      downloadBframe();
    }

    showToast('저장 완료!', 'success');
  } catch (error) {
    console.error('저장 실패:', error);
    showToast('저장 실패: ' + error.message, 'error');
  }
}

async function saveToDrive() {
  const content = JSON.stringify(state.bframeData, null, 2);

  // fetch API 사용 (Shared Drive 지원)
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${state.bframeFileId}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: content
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('저장 실패:', response.status, errorText);

    if (response.status === 401) {
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    } else if (response.status === 403) {
      throw new Error('파일 수정 권한이 없습니다.');
    } else {
      throw new Error(`저장 실패 (${response.status})`);
    }
  }

  console.log('✅ Google Drive 저장 완료');
}

// ============================================
// 공유
// ============================================

/**
 * 공유 링크 생성 및 복사
 */
async function handleShare() {
  // URL 파라미터에서 또는 입력 필드에서 원본 URL 가져오기
  const videoUrl = elements.inputVideoUrl?.value || new URLSearchParams(window.location.search).get('video');
  const bframeUrl = elements.inputBframeUrl?.value || new URLSearchParams(window.location.search).get('bframe');

  if (!videoUrl || !bframeUrl) {
    showToast('공유할 파일 정보가 없습니다', 'error');
    return;
  }

  // 공유 링크 생성 (open.html 사용)
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');
  const shareUrl = `${baseUrl}/open.html?video=${encodeURIComponent(videoUrl)}&bframe=${encodeURIComponent(bframeUrl)}`;

  try {
    // 클립보드에 복사
    await navigator.clipboard.writeText(shareUrl);
    showToast('공유 링크가 복사되었습니다!', 'success');
    console.log('📋 공유 링크:', shareUrl);
  } catch (error) {
    // 클립보드 API 실패 시 대체 방법
    const textArea = document.createElement('textarea');
    textArea.value = shareUrl;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('공유 링크가 복사되었습니다!', 'success');
    } catch (e) {
      showToast('복사 실패. 링크: ' + shareUrl, 'error');
    }
    document.body.removeChild(textArea);
  }
}

function downloadBframe() {
  const content = JSON.stringify(state.bframeData, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = (state.bframeData.videoFile || 'video').replace(/\.[^.]+$/, '') + '.bframe';
  a.click();

  URL.revokeObjectURL(url);
}

// ============================================
// 키보드 단축키
// ============================================

function handleKeydown(e) {
  // 모달이 열려있으면 무시
  if (!elements.commentModal.classList.contains('hidden') ||
      !elements.threadModal.classList.contains('hidden')) {
    return;
  }

  // 입력 중이면 무시
  if (document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'TEXTAREA') {
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      togglePlayPause();
      break;

    case 'ArrowLeft':
      e.preventDefault();
      seekFrame(e.shiftKey ? -10 : -1);
      break;

    case 'ArrowRight':
      e.preventDefault();
      seekFrame(e.shiftKey ? 10 : 1);
      break;

    case 'KeyC':
      if (!e.ctrlKey && !e.metaKey) {
        handleAddComment();
      }
      break;

    case 'KeyD':
      switchTab('draw');
      break;

    case 'KeyS':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        handleSave();
      }
      break;
  }
}

// ============================================
// 터치 이벤트
// ============================================

function setupTouchEvents() {
  // 타임라인 터치
  let touchStartX = 0;

  elements.timeline?.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    handleTimelineClick({ clientX: touchStartX });
  }, { passive: true });

  elements.timeline?.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    handleTimelineClick({ clientX: touch.clientX });
  }, { passive: true });
}

// ============================================
// 유틸리티
// ============================================

function handleBack() {
  if (confirm('저장하지 않은 변경사항이 있을 수 있습니다. 나가시겠습니까?')) {
    showScreen('select');
    elements.videoPlayer.pause();
    elements.videoPlayer.src = '';
    state.bframeData = null;
  }
}

function showToast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type}`;
  elements.toast.classList.remove('hidden');

  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3000);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 창 크기 변경 시 캔버스 리사이즈
window.addEventListener('resize', () => {
  if (elements.videoPlayer?.videoWidth) {
    resizeCanvas();
    renderDrawingForCurrentFrame();
  }
});

// ============================================
// 전체화면 모드
// ============================================

/**
 * 전체화면 토글
 */
function toggleFullscreen() {
  const viewerScreen = elements.viewerScreen;

  if (!document.fullscreenElement) {
    // 전체화면 진입
    if (viewerScreen.requestFullscreen) {
      viewerScreen.requestFullscreen();
    } else if (viewerScreen.webkitRequestFullscreen) {
      viewerScreen.webkitRequestFullscreen();
    } else if (viewerScreen.mozRequestFullScreen) {
      viewerScreen.mozRequestFullScreen();
    } else if (viewerScreen.msRequestFullscreen) {
      viewerScreen.msRequestFullscreen();
    }

    // 가로 모드 강제 (모바일)
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {
        // 권한 없으면 무시
      });
    }
  } else {
    // 전체화면 해제
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
}

/**
 * 전체화면 상태 변경 핸들러
 */
function handleFullscreenChange() {
  const isFullscreen = !!document.fullscreenElement;
  document.body.classList.toggle('fullscreen-mode', isFullscreen);

  // 전체화면 버튼 아이콘 변경
  const btnFullscreen = document.getElementById('btnFullscreen');
  if (btnFullscreen) {
    btnFullscreen.textContent = isFullscreen ? '⛶' : '⛶';
    btnFullscreen.title = isFullscreen ? '전체화면 해제' : '전체화면';
  }

  // 캔버스 리사이즈
  setTimeout(() => {
    resizeCanvas();
    renderDrawingForCurrentFrame();
  }, 100);
}

// ============================================
// 디버그용
// ============================================

window.baeframeState = state;
console.log('BAEFRAME 웹 뷰어 로드됨. 디버그: window.baeframeState');
