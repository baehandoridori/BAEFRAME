/**
 * BAEFRAME 웹 뷰어 - 메인 애플리케이션
 */

import {
  createTrailingSingleFlight,
  isValidReviewDocumentId,
  prepareContextBoundDriveBframeForWrite,
  reconcileDriveBframeAfterWrite,
  runContextBoundBframeLoad,
  runContextBoundDriveSave,
  serializeBframeForWrite
} from './bframe-write-guard.js';

// ============================================
// 전역 상태
// ============================================

const state = {
  // Google API
  gapiLoaded: false,
  gisLoaded: false,
  tokenClient: null,
  accessToken: null,
  isRefreshing: false, // 토큰 갱신 중 플래그

  // 파일 정보
  videoFileId: null,
  bframeFileId: null,
  bframeData: null,
  bframeIdentityPersisted: false,
  bframeDocumentGeneration: 0,

  // 비디오 상태
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  frameRate: 24,

  // UI 상태
  currentTab: 'comments',
  isDrawMode: false,
  isFullscreen: false,
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

function beginBframeDocument(fileId) {
  state.bframeDocumentGeneration += 1;
  state.bframeFileId = fileId;
  state.bframeData = null;
  state.bframeIdentityPersisted = false;
}

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

// 로딩 화면 명언 목록 (정신건강 + 용감한 역사적 발언)
const LOADING_QUOTES = [
  { text: '두려움을 느끼는 것은 용기가 없는 것이 아니다. 두려움에도 불구하고 행동하는 것이 진정한 용기다.', author: '마크 트웨인' },
  { text: '우리가 두려워해야 할 유일한 것은 두려움 그 자체다.', author: '프랭클린 D. 루스벨트' },
  { text: '불가능은 소심한 자의 환상이다.', author: '나폴레옹 보나파르트' },
  { text: '오늘 할 수 있는 일에 최선을 다하라. 그러면 내일은 한 걸음 더 나아갈 수 있다.', author: '아이작 뉴턴' },
  { text: '승리는 가장 끈기 있는 자에게 돌아간다.', author: '나폴레옹 보나파르트' },
  { text: '위대한 영광은 넘어지지 않는 것이 아니라, 넘어질 때마다 일어서는 데 있다.', author: '공자' },
  { text: '먼저 자신을 믿어라. 그러면 다른 모든 것이 따라온다.', author: '괴테' },
  { text: '행동은 두려움을 치유하고, 우유부단함은 두려움을 키운다.', author: '윌리엄 제임스' },
  { text: '여기서 죽으면 뭐가 남나? 싸워라! 적어도 죽기 전에 발자국을 남겨라.', author: '윌리엄 월러스' },
  { text: '나는 왔고, 보았고, 이겼다.', author: '율리우스 카이사르' },
  { text: '적을 용서할 수는 있지만, 그 전에 먼저 그들을 무력화해야 한다.', author: '마하트마 간디' },
  { text: '어둠을 저주하기보다 촛불 하나를 켜는 것이 낫다.', author: '엘리너 루스벨트' },
  { text: '삶이 레몬을 주면 레모네이드를 만들어라.', author: '미국 속담' },
  { text: '지금 흘리는 땀은 전쟁에서 흘릴 피를 줄여준다.', author: '에르빈 롬멜' },
  { text: '우리는 해변에서 싸울 것이다. 우리는 결코 항복하지 않을 것이다.', author: '윈스턴 처칠' },
  { text: '고통은 일시적이다. 포기는 영원하다.', author: '랜스 암스트롱' },
  { text: '가장 어두운 밤도 끝나고 태양은 뜬다.', author: '빅토르 위고' },
  { text: '매 순간 새로운 시작이다.', author: 'T.S. 엘리엇' },
  { text: '자신의 한계를 아는 것이 지혜의 시작이다.', author: '소크라테스' },
  { text: '포기하지 않는 한 실패란 없다.', author: '앤 래투로' },
  { text: '시련은 그것을 견딜 수 있는 자에게 주어진다.', author: '탈무드' },
  { text: '스파르타인은 적이 몇 명인지 묻지 않는다. 어디 있는지만 묻는다.', author: '아게시라오스 2세' },
  { text: '죽음을 두려워하면 아무것도 시작할 수 없다.', author: '세네카' },
  { text: '모든 위대한 업적은 처음에는 불가능해 보였다.', author: '토마스 칼라일' },
  { text: '오늘의 고통은 내일의 힘이 된다.', author: '아놀드 슈워제네거' },
  { text: '진정한 용기는 두려움 속에서도 앞으로 나아가는 것이다.', author: '넬슨 만델라' },
  { text: '휴식은 게으름이 아니다. 여름의 나른한 오후에 풀밭에 누워 물소리를 듣는 것은 결코 시간 낭비가 아니다.', author: '존 러버드' },
  { text: '자신을 돌보는 것은 이기적인 게 아니라 생존이다.', author: '오드리 로드' },
  { text: '가끔은 가장 생산적인 일이 휴식을 취하는 것이다.', author: '마크 트웨인' },
  { text: '완벽하지 않아도 괜찮다. 성장하고 있으면 충분하다.', author: '작자 미상' }
];

let quoteInterval = null;

/**
 * 로딩 화면 명언 로테이션 시작
 */
function startQuoteRotation() {
  // 기존 인터벌 정리 (중복 방지)
  stopQuoteRotation();

  const quotesContainer = document.getElementById('loadingQuotes');
  const quoteText = document.getElementById('quoteText');
  const quoteAuthor = document.getElementById('quoteAuthor');

  if (!quotesContainer || !quoteText || !quoteAuthor) return;

  // 랜덤 시작
  let currentIndex = Math.floor(Math.random() * LOADING_QUOTES.length);
  const showQuote = (index) => {
    const quote = LOADING_QUOTES[index];
    quoteText.textContent = `"${quote.text}"`;
    quoteAuthor.textContent = `— ${quote.author}`;
  };

  // 첫 번째 명언 표시
  showQuote(currentIndex);

  // 4초마다 명언 변경 (페이드 애니메이션)
  quoteInterval = setInterval(() => {
    // 페이드 아웃
    quotesContainer.classList.remove('fade-in');
    quotesContainer.classList.add('fade-out');

    setTimeout(() => {
      // 다음 명언 (순환)
      currentIndex = (currentIndex + 1) % LOADING_QUOTES.length;
      showQuote(currentIndex);

      // 페이드 인
      quotesContainer.classList.remove('fade-out');
      quotesContainer.classList.add('fade-in');
    }, 300);
  }, 4000);
}

/**
 * 로딩 화면 명언 로테이션 중지
 */
function stopQuoteRotation() {
  if (quoteInterval) {
    clearInterval(quoteInterval);
    quoteInterval = null;
  }
}

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

  // 로딩 화면 명언 로테이션 시작
  startQuoteRotation();

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

      // 로컬 캐시 만료 전이면 일단 토큰 복원 (365일)
      // 실제 Google 토큰 만료 시 API 호출에서 자동 갱신 시도됨
      if (expiryTime > now) {
        state.accessToken = savedToken;
        console.log('✅ 저장된 토큰 복원 성공 (API 호출 시 유효성 확인)');
        return true;
      } else {
        // 캐시도 만료됨 - 재로그인 필요
        localStorage.removeItem('baeframe_access_token');
        localStorage.removeItem('baeframe_token_expiry');
        console.log('⏰ 토큰 캐시 만료됨 (365일 초과), 재로그인 필요');
      }
    }
  } catch (error) {
    console.error('토큰 복원 실패:', error);
  }
  return false;
}

/**
 * 토큰 저장 (365일 유효 - 로컬 캐시용)
 * Google 토큰 자체는 1시간마다 만료되지만, 자동 갱신을 시도함
 */
function saveAccessToken(token) {
  try {
    localStorage.setItem('baeframe_access_token', token);
    // 365일 유효 (31536000000ms = 365 * 24 * 60 * 60 * 1000)
    const expiry = Date.now() + 31536000000;
    localStorage.setItem('baeframe_token_expiry', expiry.toString());
    console.log('💾 토큰 저장됨 (365일 유효)');
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
    beginBframeDocument(extractDriveFileId(bframeUrl));

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
  elements.btnSkipBack = document.getElementById('btnSkipBack');
  elements.btnPrevFrame = document.getElementById('btnPrevFrame');
  elements.btnPlayPause = document.getElementById('btnPlayPause');
  elements.btnNextFrame = document.getElementById('btnNextFrame');
  elements.btnSkipForward = document.getElementById('btnSkipForward');
  elements.timeDisplay = document.getElementById('timeDisplay');

  // 재생/일시정지 아이콘
  elements.iconPlay = document.getElementById('iconPlay');
  elements.iconPause = document.getElementById('iconPause');

  // 타임라인 썸네일
  elements.timelineThumbnail = document.getElementById('timelineThumbnail');
  elements.thumbnailCanvas = document.getElementById('thumbnailCanvas');
  elements.thumbnailTime = document.getElementById('thumbnailTime');

  // 탭
  elements.tabBtns = document.querySelectorAll('.tab-btn');
  elements.commentsPanel = document.getElementById('commentsPanel');
  elements.drawPanel = document.getElementById('drawPanel');

  // 댓글
  elements.btnAddComment = document.getElementById('btnAddComment');
  elements.btnFullscreenMarker = document.getElementById('btnFullscreenMarker');
  elements.btnExitFullscreen = document.getElementById('btnExitFullscreen');
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
  elements.btnSkipBack?.addEventListener('click', () => seekSeconds(-5));
  elements.btnPrevFrame?.addEventListener('click', () => seekFrame(-1));
  elements.btnPlayPause?.addEventListener('click', togglePlayPause);
  elements.btnNextFrame?.addEventListener('click', () => seekFrame(1));
  elements.btnSkipForward?.addEventListener('click', () => seekSeconds(5));

  // 타임라인 썸네일 미리보기
  setupTimelineThumbnail();

  // 탭
  elements.tabBtns?.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 댓글
  elements.btnAddComment?.addEventListener('click', handleAddComment);
  elements.btnFullscreenMarker?.addEventListener('click', handleFullscreenMarkerButton);
  elements.btnExitFullscreen?.addEventListener('click', exitFullscreenMode);
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
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
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
      callback: async (response) => {
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
        if (elements.btnGoogleLogin) {
          elements.btnGoogleLogin.innerHTML = '✓ 로그인됨 <small style="opacity:0.7">(재인증)</small>';
        }
        if (!forceSilent) {
          showToast(isReauth ? '재인증 성공!' : '로그인 성공!', 'success');
        }

        // 🔥 로그인 후 URL 파라미터가 있으면 자동으로 파일 열기
        const urlParams = new URLSearchParams(window.location.search);
        const videoUrl = urlParams.get('video');
        const bframeUrl = urlParams.get('bframe');

        if (videoUrl && bframeUrl) {
          console.log('📂 로그인 완료, 파일 자동 로드 시작');
          await autoLoadFromUrlParams(videoUrl, bframeUrl);
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
 * Google API 호출 실패 시에도 호출됨
 */
async function tryAutoRefreshToken() {
  // 이미 갱신 시도 중이면 중복 방지
  if (state.isRefreshing) return false;
  state.isRefreshing = true;

  try {
    console.log('🔄 토큰 자동 갱신 시도 (silent)...');

    // TokenClient가 없으면 초기화
    if (!state.tokenClient) {
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: (response) => {
          state.isRefreshing = false;
          if (response.error) {
            console.log('⚠️ Silent 갱신 실패, 사용자 재인증 필요');
            return;
          }
          state.accessToken = response.access_token;
          saveAccessToken(response.access_token);
          console.log('✅ 토큰 자동 갱신 성공!');
          updateLoginButtonState();
        }
      });
    }

    // prompt: '' 또는 'none'으로 사일런트 갱신 시도
    state.tokenClient.requestAccessToken({ prompt: '' });
    return true;
  } catch (error) {
    console.log('⚠️ 자동 갱신 실패:', error);
    state.isRefreshing = false;
    return false;
  }
}

/**
 * API 호출 래퍼 - 401 에러 시 자동 재인증 시도
 */
async function fetchWithAutoRefresh(url, options = {}) {
  try {
    const response = await fetch(url, options);

    // 401/403 에러 시 토큰 갱신 시도 후 재요청
    if (response.status === 401 || response.status === 403) {
      console.log('🔐 인증 만료, 자동 갱신 시도...');
      await tryAutoRefreshToken();

      // 잠시 대기 후 재시도
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (state.accessToken) {
        // 새 토큰으로 재요청
        options.headers = {
          ...options.headers,
          'Authorization': `Bearer ${state.accessToken}`
        };
        return fetch(url, options);
      }
    }

    return response;
  } catch (error) {
    throw error;
  }
}

// ============================================
// 화면 전환
// ============================================

function showScreen(screenName) {
  elements.loadingScreen?.classList.remove('active');
  elements.selectScreen?.classList.remove('active');
  elements.viewerScreen?.classList.remove('active');

  // 로딩 화면에서 벗어날 때 명언 로테이션 중지
  if (screenName !== 'loading') {
    stopQuoteRotation();
  }

  switch (screenName) {
  case 'loading':
    elements.loadingScreen?.classList.add('active');
    startQuoteRotation(); // 로딩 화면으로 돌아오면 다시 시작
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

// 개발 모드용 데모 버튼 추가 (데스크톱 전용)
function addDemoButton() {
  // 모바일에서는 데모 버튼 표시 안 함
  if (IS_MOBILE) return;

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
    beginBframeDocument(null);
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
    beginBframeDocument(extractDriveFileId(bframeUrl));

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

  if (!url) {
    console.error('❌ URL이 비어있음');
    return null;
  }

  // URL 디코딩 (혹시 인코딩된 경우)
  try {
    url = decodeURIComponent(url);
    console.log('🔗 디코딩된 URL:', url);
  } catch (e) {
    console.log('URL 디코딩 스킵 (이미 디코딩됨)');
  }

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

  console.error('❌ 파일 ID 추출 실패. URL 패턴 확인 필요:', url);
  return null;
}

async function loadBframeFile(url) {
  const isSample = url.startsWith('sample://') || !url.includes('drive.google.com');
  const fileId = isSample ? state.bframeFileId : extractDriveFileId(url);
  if (!isSample && !fileId) {
    throw new Error('올바른 Google Drive URL이 아닙니다');
  }
  const loadContext = {
    fileId: fileId,
    documentGeneration: state.bframeDocumentGeneration,
    accessToken: state.accessToken
  };

  try {
    const loadedRoot = await runContextBoundBframeLoad(loadContext, {
      isCurrent: context => state.bframeFileId === context.fileId &&
        state.bframeDocumentGeneration === context.documentGeneration,
      load: async () => {
        if (isSample) return getSampleBframeData();
        if (!loadContext.accessToken) throw new Error('로그인이 필요합니다');

        console.log('📁 bframe 파일 ID:', fileId);
        console.log('🔑 Access Token:', loadContext.accessToken ? '있음 (' + loadContext.accessToken.substring(0, 20) + '...)' : '없음');

        const apiUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
        console.log('🌐 API 요청 URL:', apiUrl);

        const response = await fetch(apiUrl, {
          headers: {
            'Authorization': `Bearer ${loadContext.accessToken}`
          }
        });

        console.log('📡 API 응답 상태:', response.status, response.statusText);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ API 에러 응답:', errorText);
          console.error('❌ 파일 ID 확인:', fileId, '(길이:', fileId.length, ')');

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

        return response.json();
      },
      commit: root => {
        state.bframeData = root;
        state.bframeIdentityPersisted = isValidReviewDocumentId(root?.reviewDocumentId);
      }
    });

    console.log('✅ bframe 로드 완료:', loadedRoot);
    return loadedRoot;
  } catch (error) {
    if (!isSample) console.error('인증된 접근 실패:', error);
    throw error;
  }
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
  updateLoadingStatus('영상 정보 확인 중...');

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

    // 🎬 스트리밍 URL로 즉시 재생 시작
    const streamUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    updateLoadingStatus('스트리밍 준비 중...');

    // 비디오 소스 설정 (Authorization 헤더가 필요하므로 Blob으로 시작)
    // Google Drive는 직접 스트리밍을 지원하지 않으므로 Range request 사용
    await loadVideoWithStreaming(fileId, meta);

    console.log('✅ 영상 스트리밍 시작');

  } catch (error) {
    console.error('Google Drive 영상 로드 실패:', error);
    throw error;
  }
}

/**
 * 프로그레시브 다운로드 방식으로 영상 로드
 * - 파일의 80%를 먼저 다운로드 (필수)
 * - 재생 시작
 * - 백그라운드에서 나머지 20% 다운로드
 */
async function loadVideoWithStreaming(fileId, meta) {
  const total = parseInt(meta.size, 10) || 0;
  const mimeType = meta.mimeType || 'video/mp4';

  // 항상 80%를 초기 다운로드 (용량 제한 없음)
  const initialSize = Math.floor(total * 0.8);

  console.log(`📥 프로그레시브 다운로드 시작: 전체 ${(total / 1024 / 1024).toFixed(1)}MB, 초기 ${(initialSize / 1024 / 1024).toFixed(1)}MB (80%)`);

  // 초기 다운로드 (더 큰 청크로 분할)
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB 청크 (기존 5MB → 10MB)
  const chunks = [];
  let offset = 0;

  while (offset < initialSize) {
    const end = Math.min(offset + CHUNK_SIZE - 1, initialSize - 1, total - 1);
    const percent = Math.round((offset / initialSize) * 100);
    updateLoadingStatus(`영상 다운로드 중... (${percent}%)`);

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      {
        headers: {
          'Authorization': `Bearer ${state.accessToken}`,
          'Range': `bytes=${offset}-${end}`
        }
      }
    );

    if (!response.ok && response.status !== 206) {
      throw new Error(`영상 다운로드 실패 (${response.status})`);
    }

    const chunk = await response.arrayBuffer();
    chunks.push(chunk);
    offset = end + 1;
  }

  console.log(`✅ 초기 ${(offset / 1024 / 1024).toFixed(1)}MB 다운로드 완료`);
  updateLoadingStatus('영상 준비 중...');

  // Blob 생성 및 재생 시작
  const initialBlob = new Blob(chunks, { type: mimeType });
  const initialUrl = URL.createObjectURL(initialBlob);

  await loadVideoFromUrl(initialUrl);
  updateLoadingStatus('');

  // 백그라운드에서 나머지 다운로드
  if (offset < total) {
    downloadRemainingInBackground(fileId, chunks, offset, total, mimeType);
  }
}

/**
 * 백그라운드에서 나머지 영상 다운로드 (병렬 청크 다운로드로 개선)
 */
async function downloadRemainingInBackground(fileId, initialChunks, startOffset, total, mimeType) {
  console.log(`🔄 백그라운드 다운로드 시작... (${Math.round(startOffset / total * 100)}% → 100%)`);

  const CHUNK_SIZE = 15 * 1024 * 1024; // 15MB chunks (기존 5MB → 15MB로 개선)
  const chunks = [...initialChunks]; // 기존 청크 복사
  let offset = startOffset;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE - 1, total - 1);

    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        {
          headers: {
            'Authorization': `Bearer ${state.accessToken}`,
            'Range': `bytes=${offset}-${end}`
          }
        }
      );

      if (!response.ok && response.status !== 206) {
        console.error('백그라운드 다운로드 실패:', response.status);
        break;
      }

      const chunk = await response.arrayBuffer();
      chunks.push(chunk);
      offset = end + 1;

      const percent = Math.round((offset / total) * 100);
      console.log(`📥 백그라운드 다운로드: ${percent}%`);

    } catch (error) {
      console.error('백그라운드 다운로드 에러:', error);
      break;
    }
  }

  // 전체 다운로드 완료 시 전체 Blob 캐시 (URL 교체 없이)
  if (offset >= total) {
    console.log('✅ 백그라운드 다운로드 완료');

    // 전체 Blob 생성 및 캐시 (나중에 필요할 때 사용)
    const fullBlob = new Blob(chunks, { type: mimeType });
    state.fullVideoBlob = fullBlob;
    state.fullVideoBlobUrl = URL.createObjectURL(fullBlob);

    console.log('✅ 전체 영상 캐시 완료 (백그라운드)');

    // 참고: Blob URL 교체는 불안정할 수 있어서 수행하지 않음
    // 사용자가 뒷부분 seek 시 자동으로 처리됨
  } else {
    console.log(`⚠️ 백그라운드 다운로드 중단됨 (${Math.round(offset / total * 100)}%)`);
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
  // fps는 comments.fps 또는 최상위 fps/frameRate에서 가져옴
  state.frameRate = state.bframeData?.comments?.fps || state.bframeData?.fps || state.bframeData?.frameRate || 24;

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

  // SVG 아이콘 토글
  if (elements.iconPlay && elements.iconPause) {
    if (isPlaying) {
      elements.iconPlay.classList.add('hidden');
      elements.iconPause.classList.remove('hidden');
    } else {
      elements.iconPlay.classList.remove('hidden');
      elements.iconPause.classList.add('hidden');
    }
  } else {
    // 폴백: 이모지 사용
    elements.btnPlayPause.textContent = isPlaying ? '⏸' : '▶';
  }
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

/**
 * 초 단위로 탐색 (5초 건너뛰기용)
 */
function seekSeconds(seconds) {
  const newTime = Math.max(0, Math.min(state.duration, state.currentTime + seconds));
  elements.videoPlayer.currentTime = newTime;
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
          <span class="comment-author">${escapeHtml(comment.author || '익명')}</span>
          <span class="comment-time">${time}</span>
          <div class="comment-actions">
            <button data-action="edit">수정</button>
            <button data-action="delete">삭제</button>
          </div>
        </div>
        <div class="comment-text">${escapeHtml(comment.text)}</div>
        ${replyCount > 0 ? `<div class="comment-footer"><span class="reply-count">💬 답글 ${replyCount}개</span></div>` : ''}
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
    author: '모바일 사용자',
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
    <div class="comment-author">${escapeHtml(comment.author || '익명')}</div>
    <div class="comment-text">${escapeHtml(comment.text)}</div>
  `;

  // 답글 표시 (XSS 방지: author 필드 이스케이프)
  const replies = comment.replies || [];
  elements.threadReplies.innerHTML = replies.map(reply => `
    <div class="reply-item">
      <div class="reply-author">${escapeHtml(reply.author || '익명')}</div>
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
    author: '모바일 사용자',
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

const requestDriveSave = createTrailingSingleFlight(persistDriveBframe);

async function saveToDrive() {
  return requestDriveSave(captureDriveSaveContext());
}

function captureDriveSaveContext() {
  return {
    fileId: state.bframeFileId,
    documentGeneration: state.bframeDocumentGeneration,
    root: state.bframeData,
    accessToken: state.accessToken,
    localIdentityPersisted: state.bframeIdentityPersisted
  };
}

function isDriveSaveContextCurrent(saveContext) {
  return state.bframeFileId === saveContext.fileId &&
    state.bframeDocumentGeneration === saveContext.documentGeneration &&
    state.bframeData === saveContext.root;
}

async function persistDriveBframe(saveContext) {
  const result = await runContextBoundDriveSave(saveContext, {
    isCurrent: isDriveSaveContextCurrent,
    loadLatest: async () => {
      const latestResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${saveContext.fileId}?alt=media&supportsAllDrives=true`,
        {
          headers: { 'Authorization': `Bearer ${saveContext.accessToken}` },
          cache: 'no-store'
        }
      );
      if (!latestResponse.ok) {
        throw new Error(`최신 .bframe 확인 실패 (${latestResponse.status})`);
      }
      const latestRoot = await latestResponse.json();
      return latestRoot;
    },
    prepare: latestRoot => {
      const prepared = prepareContextBoundDriveBframeForWrite(
        latestRoot,
        saveContext,
        { currentIdentityPersisted: state.bframeIdentityPersisted }
      );
      if (prepared.identityPersisted) {
        state.bframeIdentityPersisted = true;
      }
      return prepared;
    },
    persist: async prepared => {
      const content = serializeBframeForWrite(prepared.data);

      // fetch API 사용 (Shared Drive 지원)
      const response = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${saveContext.fileId}?uploadType=media&supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${saveContext.accessToken}`,
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
    },
    commit: prepared => {
      reconcileDriveBframeAfterWrite(prepared.data, saveContext.root);
      state.bframeIdentityPersisted = true;
    }
  });

  if (result.applied) {
    console.log('✅ Google Drive 저장 완료');
  } else {
    console.log('ℹ️ 이전 문서 저장 완료: 현재 문서 상태는 변경하지 않음');
  }
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
  const content = serializeBframeForWrite(state.bframeData);
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
    beginBframeDocument(null);
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
// 타임라인 썸네일 미리보기
// ============================================

/**
 * 타임라인 썸네일 미리보기 설정
 */
function setupTimelineThumbnail() {
  if (!elements.timeline || !elements.thumbnailCanvas) return;

  let isDragging = false;
  let thumbnailVisible = false;

  // 마우스 이벤트
  elements.timeline.addEventListener('mouseenter', () => {
    if (state.duration > 0) {
      thumbnailVisible = true;
    }
  });

  elements.timeline.addEventListener('mouseleave', () => {
    thumbnailVisible = false;
    hideThumbnail();
  });

  elements.timeline.addEventListener('mousemove', (e) => {
    if (thumbnailVisible && state.duration > 0) {
      updateThumbnailPreview(e);
    }
  });

  // 터치 이벤트
  elements.timeline.addEventListener('touchstart', (e) => {
    isDragging = true;
    if (state.duration > 0) {
      updateThumbnailPreview(e.touches[0]);
    }
  }, { passive: true });

  elements.timeline.addEventListener('touchmove', (e) => {
    if (isDragging && state.duration > 0) {
      updateThumbnailPreview(e.touches[0]);
    }
  }, { passive: true });

  elements.timeline.addEventListener('touchend', () => {
    isDragging = false;
    setTimeout(hideThumbnail, 500);
  });
}

/**
 * 썸네일 미리보기 업데이트
 */
function updateThumbnailPreview(e) {
  if (!elements.timelineThumbnail || !elements.thumbnailCanvas || !elements.videoPlayer) return;

  const rect = elements.timeline.getBoundingClientRect();
  const x = (e.clientX || e.pageX) - rect.left;
  const progress = Math.max(0, Math.min(1, x / rect.width));
  const previewTime = progress * state.duration;

  // 썸네일 위치 업데이트 (화면 밖으로 나가지 않도록 클램핑)
  const thumbnailWidth = 168; // 160px canvas + 8px padding
  const maxLeft = rect.width - thumbnailWidth;
  const clampedX = Math.max(0, Math.min(maxLeft, x - thumbnailWidth / 2));

  elements.timelineThumbnail.classList.remove('hidden');
  elements.timelineThumbnail.style.left = `${clampedX}px`;

  // 시간 표시 업데이트
  if (elements.thumbnailTime) {
    elements.thumbnailTime.textContent = formatTime(previewTime);
  }

  // 캔버스에 해당 시간의 프레임 그리기
  drawThumbnailFrame(previewTime);
}

/**
 * 썸네일 프레임 그리기
 */
function drawThumbnailFrame(time) {
  if (!elements.thumbnailCanvas || !elements.videoPlayer) return;

  const canvas = elements.thumbnailCanvas;
  const ctx = canvas.getContext('2d');
  const video = elements.videoPlayer;

  // 캔버스 크기 설정 (16:9 비율)
  canvas.width = 160;
  canvas.height = 90;

  // 현재 비디오 위치에서 프레임 캡처
  // 참고: 실시간 시크 없이 현재 프레임 사용 (성능상 이유)
  // 더 정확한 썸네일을 원하면 별도의 비디오 엘리먼트 필요
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 해당 시간 마커 오버레이
    ctx.fillStyle = 'rgba(74, 158, 255, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 시간 위치 인디케이터
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(formatTime(time), canvas.width / 2, canvas.height / 2 + 4);
  } catch (error) {
    // 크로스 오리진 비디오는 캡처 불가
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatTime(time), canvas.width / 2, canvas.height / 2);
  }
}

/**
 * 썸네일 숨기기
 */
function hideThumbnail() {
  if (elements.timelineThumbnail) {
    elements.timelineThumbnail.classList.add('hidden');
  }
}

// ============================================
// 전체화면 모드
// ============================================

// 컨트롤 자동 숨김 타이머
let controlsHideTimer = null;

// 롱프레스 마커 추가용 변수
let longPressTimer = null;
const longPressPos = { x: 0, y: 0 };
const longPressStartPos = { x: 0, y: 0 }; // 터치 시작 위치 (이동 감지용)
let isLongPressActive = false;
const LONG_PRESS_DURATION = 500; // 500ms 길게 누르기
const LONG_PRESS_MOVE_THRESHOLD = 15; // 15px 이내 이동은 허용

/**
 * 전체화면 토글
 */
function toggleFullscreen() {
  const viewerScreen = elements.viewerScreen;
  const video = elements.videoPlayer;

  // 이미 전체화면인 경우 해제
  if (document.fullscreenElement || document.webkitFullscreenElement || state.isFullscreen) {
    exitFullscreenMode();
    return;
  }

  // 모바일: 항상 CSS 기반 전체화면 사용 (앱 UI 유지, 마커 추가 가능)
  // 네이티브 전체화면(webkitEnterFullscreen)은 OS UI만 표시되어 마커 추가 불가
  if (IS_MOBILE) {
    enterCSSFullscreen();
    return;
  }

  // 데스크톱: 표준 Fullscreen API 시도
  const enterFullscreen = viewerScreen.requestFullscreen ||
                          viewerScreen.webkitRequestFullscreen ||
                          viewerScreen.mozRequestFullScreen ||
                          viewerScreen.msRequestFullscreen;

  if (enterFullscreen) {
    enterFullscreen.call(viewerScreen).then(() => {
      state.isFullscreen = true;
    }).catch((err) => {
      console.log('전체화면 진입 실패:', err);
      // 폴백: CSS 기반 전체화면
      enterCSSFullscreen();
    });
  } else {
    // Fullscreen API 미지원: CSS 기반 전체화면
    enterCSSFullscreen();
  }
}

/**
 * CSS 기반 전체화면 진입
 */
function enterCSSFullscreen() {
  document.body.classList.add('fullscreen-mode');
  document.body.classList.add('landscape-lock');
  state.isFullscreen = true;

  // 모바일: 가로 모드 강제
  if (IS_MOBILE && screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }

  handleFullscreenChange();
}

/**
 * 전체화면 해제
 */
function exitFullscreenMode() {
  const exitFullscreen = document.exitFullscreen ||
                         document.webkitExitFullscreen ||
                         document.mozCancelFullScreen ||
                         document.msExitFullscreen;

  if (exitFullscreen && (document.fullscreenElement || document.webkitFullscreenElement)) {
    exitFullscreen.call(document).catch(() => {});
  }

  // CSS 기반 전체화면도 해제
  document.body.classList.remove('fullscreen-mode');
  document.body.classList.remove('landscape-lock');
  state.isFullscreen = false;

  // 화면 회전 잠금 해제
  if (screen.orientation && screen.orientation.unlock) {
    screen.orientation.unlock();
  }

  handleFullscreenChange();
}

/**
 * 전체화면 상태 변경 핸들러
 */
function handleFullscreenChange() {
  const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || state.isFullscreen);
  state.isFullscreen = isFullscreen;
  document.body.classList.toggle('fullscreen-mode', isFullscreen);
  document.body.classList.toggle('landscape-lock', isFullscreen && IS_MOBILE);

  // 전체화면 버튼 아이콘 변경
  const btnFullscreen = document.getElementById('btnFullscreen');
  if (btnFullscreen) {
    btnFullscreen.innerHTML = isFullscreen ?
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6m0 0v6m0-6L3 21M20 10h-6m0 0V4m0 6l7-7M14 14l7 7M4 4l6 6"/></svg>' :
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    btnFullscreen.title = isFullscreen ? '전체화면 해제' : '전체화면';
  }

  // 모바일 전체화면: 컨트롤 자동 숨김 설정
  if (isFullscreen && IS_MOBILE) {
    setupFullscreenControls();
  } else {
    clearFullscreenControls();
  }

  // 캔버스 리사이즈
  setTimeout(() => {
    resizeCanvas();
    renderDrawingForCurrentFrame();
  }, 100);
}

/**
 * 모바일 전체화면 컨트롤 설정
 */
function setupFullscreenControls() {
  const videoContainer = elements.videoContainer;
  if (!videoContainer) return;

  // 컨트롤 초기 표시
  showFullscreenControls();

  // 롱프레스 + 일반 탭 이벤트
  videoContainer.addEventListener('touchstart', handleFullscreenTouchStart, { passive: false });
  videoContainer.addEventListener('touchend', handleFullscreenTouchEnd, { passive: true });
  videoContainer.addEventListener('touchmove', handleFullscreenTouchMove, { passive: true });
  videoContainer.addEventListener('click', handleFullscreenClick);
}

/**
 * 모바일 전체화면 컨트롤 정리
 */
function clearFullscreenControls() {
  const videoContainer = elements.videoContainer;
  if (!videoContainer) return;

  if (controlsHideTimer) {
    clearTimeout(controlsHideTimer);
    controlsHideTimer = null;
  }

  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  videoContainer.removeEventListener('touchstart', handleFullscreenTouchStart);
  videoContainer.removeEventListener('touchend', handleFullscreenTouchEnd);
  videoContainer.removeEventListener('touchmove', handleFullscreenTouchMove);
  videoContainer.removeEventListener('click', handleFullscreenClick);
  document.body.classList.remove('controls-visible');
}

/**
 * 전체화면 터치 시작 핸들러 (롱프레스 감지)
 */
function handleFullscreenTouchStart(e) {
  // 컨트롤 버튼 위에서는 롱프레스 무시
  const target = e.target;
  if (target.closest('.controls-bar') || target.closest('.viewer-header') ||
      target.closest('button') || target.closest('.panel')) {
    return;
  }

  // 터치 위치 저장
  if (e.touches && e.touches.length > 0) {
    const touch = e.touches[0];
    longPressPos.x = touch.clientX;
    longPressPos.y = touch.clientY;
    longPressStartPos.x = touch.clientX;
    longPressStartPos.y = touch.clientY;
  }

  isLongPressActive = false;

  // 기존 타이머 취소
  if (longPressTimer) {
    clearTimeout(longPressTimer);
  }

  // 롱프레스 타이머 시작
  longPressTimer = setTimeout(() => {
    isLongPressActive = true;
    // 햅틱 피드백 (지원되는 경우)
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
    // 롱프레스 → 마커 추가
    handleLongPressMarker(longPressPos.x, longPressPos.y);
  }, LONG_PRESS_DURATION);
}

/**
 * 전체화면 터치 끝 핸들러
 */
function handleFullscreenTouchEnd(e) {
  // 롱프레스 타이머 취소
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  // 롱프레스가 발동되지 않았으면 일반 탭 처리
  if (!isLongPressActive) {
    toggleFullscreenControls();
  }

  isLongPressActive = false;
}

/**
 * 전체화면 터치 이동 핸들러 (롱프레스 취소)
 */
function handleFullscreenTouchMove(e) {
  if (!longPressTimer) return;

  // 이동 거리 계산
  if (e.touches && e.touches.length > 0) {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - longPressStartPos.x);
    const dy = Math.abs(touch.clientY - longPressStartPos.y);
    const distance = Math.sqrt(dx * dx + dy * dy);

    // 이동 거리가 임계값 초과 시에만 롱프레스 취소
    if (distance > LONG_PRESS_MOVE_THRESHOLD) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }
}

/**
 * 롱프레스로 마커 추가 (전체화면에서)
 */
function handleLongPressMarker(screenX, screenY) {
  const videoContainer = elements.videoContainer;
  const video = elements.videoPlayer;
  if (!videoContainer || !video) return;

  // 비디오 영역 기준 상대 좌표 계산
  const rect = videoContainer.getBoundingClientRect();
  const relativeX = (screenX - rect.left) / rect.width;
  const relativeY = (screenY - rect.top) / rect.height;

  // 0~1 범위로 클램핑
  const x = Math.max(0, Math.min(1, relativeX));
  const y = Math.max(0, Math.min(1, relativeY));

  // 댓글 추가 모드 진입
  state.isCommentMode = true;
  state.pendingCommentPos = { x, y };

  // 마커 프리뷰 표시
  const markerOverlay = document.getElementById('markerOverlay');
  const markerPin = markerOverlay?.querySelector('.marker-pin');
  if (markerOverlay) {
    markerOverlay.classList.remove('hidden');
    markerOverlay.classList.add('active');
    if (markerPin) {
      markerPin.style.left = `${x * 100}%`;
      markerPin.style.top = `${y * 100}%`;
    }
  }

  // 컨트롤 표시
  showFullscreenControls();

  // 댓글 작성 모달 열기
  openCommentModal();
}

function handleFullscreenClick(e) {
  // 댓글 모드가 아닐 때만 컨트롤 토글
  if (!state.isCommentMode && document.body.classList.contains('fullscreen-mode')) {
    toggleFullscreenControls();
  }
}

// 마커 추가 모드 상태
let isMarkerAddMode = false;

/**
 * 전체화면 마커 추가 버튼 클릭 핸들러 (iOS 대안)
 */
function handleFullscreenMarkerButton() {
  const btn = elements.btnFullscreenMarker;

  if (isMarkerAddMode) {
    // 마커 추가 모드 종료
    isMarkerAddMode = false;
    btn?.classList.remove('active');
    elements.videoContainer?.removeEventListener('click', handleMarkerPlacement);
    showToast('마커 추가 모드 종료');
  } else {
    // 마커 추가 모드 시작
    isMarkerAddMode = true;
    btn?.classList.add('active');
    elements.videoContainer?.addEventListener('click', handleMarkerPlacement, { once: true });
    showToast('화면을 터치하여 마커를 추가하세요');

    // 컨트롤 자동 숨김 방지
    if (controlsHideTimer) {
      clearTimeout(controlsHideTimer);
    }
  }
}

/**
 * 마커 위치 선택 핸들러 (전체화면 마커 버튼용)
 */
function handleMarkerPlacement(e) {
  // 버튼 자체를 클릭한 경우 무시
  if (e.target.closest('.btn-fullscreen-marker')) {
    elements.videoContainer?.addEventListener('click', handleMarkerPlacement, { once: true });
    return;
  }

  // 마커 모드 종료
  isMarkerAddMode = false;
  elements.btnFullscreenMarker?.classList.remove('active');

  // 터치/클릭 위치 계산
  const rect = elements.videoContainer.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  // 마커 추가 처리
  handleLongPressMarker(clientX, clientY);
}

/**
 * 전체화면 컨트롤 토글
 */
function toggleFullscreenControls() {
  if (document.body.classList.contains('controls-visible')) {
    document.body.classList.remove('controls-visible');
  } else {
    showFullscreenControls();
  }
}

/**
 * 전체화면 컨트롤 표시 (자동 숨김 타이머 시작)
 */
function showFullscreenControls() {
  document.body.classList.add('controls-visible');

  // 기존 타이머 취소
  if (controlsHideTimer) {
    clearTimeout(controlsHideTimer);
  }

  // 3초 후 자동 숨김
  controlsHideTimer = setTimeout(() => {
    if (document.body.classList.contains('fullscreen-mode') && state.isPlaying) {
      document.body.classList.remove('controls-visible');
    }
  }, 3000);
}

// ============================================
// 디버그용
// ============================================

window.baeframeState = state;
console.log('BAEFRAME 웹 뷰어 로드됨. 디버그: window.baeframeState');
