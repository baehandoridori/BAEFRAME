/**
 * baeframe - Renderer App Entry Point
 */

import { createLogger, setupGlobalErrorHandlers } from './logger.js';
import { VideoPlayer } from './modules/video-player.js';
import { Timeline } from './modules/timeline.js';
import { DrawingManager, DrawingTool } from './modules/drawing-manager.js';
import { CommentManager } from './modules/comment-manager.js';
import { ReviewDataManager } from './modules/review-data-manager.js';
import { getUserSettings } from './modules/user-settings.js';
import { getThumbnailGenerator } from './modules/thumbnail-generator.js';
import { PlexusEffect } from './modules/plexus.js';

const log = createLogger('App');

// 전역 에러 핸들러 설정
setupGlobalErrorHandlers();

/**
 * 앱 초기화
 */
async function initApp() {
  log.info('앱 초기화 시작');

  // DOM 요소 캐싱
  const elements = {
    // 헤더
    fileName: document.getElementById('fileName'),
    filePath: document.getElementById('filePath'),
    versionBadge: document.getElementById('versionBadge'),
    btnVersionHistory: document.getElementById('btnVersionHistory'),
    btnCopyLink: document.getElementById('btnCopyLink'),
    btnWebShare: document.getElementById('btnWebShare'),
    btnOpenFolder: document.getElementById('btnOpenFolder'),
    btnOpenOther: document.getElementById('btnOpenOther'),

    // 웹 공유 모달
    webShareModal: document.getElementById('webShareModal'),
    closeWebShare: document.getElementById('closeWebShare'),
    cancelWebShare: document.getElementById('cancelWebShare'),
    webShareVideoUrl: document.getElementById('webShareVideoUrl'),
    webShareBframeUrl: document.getElementById('webShareBframeUrl'),
    webShareResultGroup: document.getElementById('webShareResultGroup'),
    webShareResultUrl: document.getElementById('webShareResultUrl'),
    btnCopyWebShareUrl: document.getElementById('btnCopyWebShareUrl'),
    generateWebShareLink: document.getElementById('generateWebShareLink'),

    // 뷰어
    dropZone: document.getElementById('dropZone'),
    videoWrapper: document.getElementById('videoWrapper'),
    videoPlayer: document.getElementById('videoPlayer'),
    drawingCanvas: document.getElementById('drawingCanvas'),
    onionSkinCanvas: document.getElementById('onionSkinCanvas'),
    drawingTools: document.getElementById('drawingTools'),
    btnOpenFile: document.getElementById('btnOpenFile'),

    // 컨트롤
    btnFirst: document.getElementById('btnFirst'),
    btnPrevFrame: document.getElementById('btnPrevFrame'),
    btnPlay: document.getElementById('btnPlay'),
    btnNextFrame: document.getElementById('btnNextFrame'),
    btnLast: document.getElementById('btnLast'),
    timecodeCurrent: document.getElementById('timecodeCurrent'),
    timecodeTotal: document.getElementById('timecodeTotal'),
    frameIndicator: document.getElementById('frameIndicator'),
    btnDrawMode: document.getElementById('btnDrawMode'),
    btnAddComment: document.getElementById('btnAddComment'),

    // 타임라인
    timelineSection: document.getElementById('timelineSection'),
    zoomSlider: document.getElementById('zoomSlider'),
    zoomDisplay: document.getElementById('zoomDisplay'),
    playheadLine: document.getElementById('playheadLine'),
    playheadHandle: document.getElementById('playheadHandle'),
    videoTrackClip: document.getElementById('videoTrackClip'),
    tracksContainer: document.getElementById('tracksContainer'),
    timelineRuler: document.getElementById('timelineRuler'),
    timelineTracks: document.getElementById('timelineTracks'),
    layerHeaders: document.getElementById('layerHeaders'),

    // 댓글 패널
    commentCount: document.getElementById('commentCount'),
    commentsList: document.getElementById('commentsList'),
    commentInput: document.getElementById('commentInput'),
    btnSubmitComment: document.getElementById('btnSubmitComment'),

    // 리사이저
    panelResizer: document.getElementById('panelResizer'),
    viewerResizer: document.getElementById('viewerResizer'),
    commentPanel: document.getElementById('commentPanel'),
    viewerContainer: document.getElementById('viewerContainer'),

    // 단축키 메뉴
    shortcutsToggle: document.getElementById('shortcutsToggle'),
    shortcutsMenu: document.getElementById('shortcutsMenu'),

    // 토스트
    toastContainer: document.getElementById('toastContainer'),

    // 비디오 줌 컨트롤
    videoZoomControls: document.getElementById('videoZoomControls'),
    btnVideoZoomIn: document.getElementById('btnVideoZoomIn'),
    btnVideoZoomOut: document.getElementById('btnVideoZoomOut'),
    btnVideoZoomReset: document.getElementById('btnVideoZoomReset'),
    videoZoomDisplay: document.getElementById('videoZoomDisplay'),
    zoomIndicatorOverlay: document.getElementById('zoomIndicatorOverlay'),

    // 댓글 패널 토글
    commentPanelToggle: document.getElementById('commentPanelToggle'),

    // 타임라인 줌 버튼
    btnTimelineZoomIn: document.getElementById('btnTimelineZoomIn'),
    btnTimelineZoomOut: document.getElementById('btnTimelineZoomOut'),
    btnTimelineZoomReset: document.getElementById('btnTimelineZoomReset'),

    // 그리기 도구 액션 버튼
    btnUndo: document.getElementById('btnUndo'),
    btnClearDrawing: document.getElementById('btnClearDrawing'),

    // 레이어 추가/삭제 버튼
    btnAddLayer: document.getElementById('btnAddLayer'),
    btnDeleteLayer: document.getElementById('btnDeleteLayer')
  };

  // 상태
  const state = {
    isDrawMode: false,
    isCommentMode: false, // 댓글 추가 모드
    isFullscreen: false, // 전체화면 모드
    currentFile: null,
    // 비디오 줌 상태
    videoZoom: 100,
    minVideoZoom: 25,
    maxVideoZoom: 800,
    // 비디오 패닝 상태
    videoPanX: 0,
    videoPanY: 0,
    isPanningVideo: false,
    panStartX: 0,
    panStartY: 0,
    panInitialX: 0,
    panInitialY: 0
  };

  // ====== 글로벌 Undo/Redo 시스템 ======
  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO_STACK = 50;

  /**
   * Undo 스택에 작업 추가
   * @param {Object} action - { type, data, undo, redo }
   */
  function pushUndo(action) {
    undoStack.push(action);
    if (undoStack.length > MAX_UNDO_STACK) {
      undoStack.shift();
    }
    redoStack.length = 0; // Redo 스택 초기화
  }

  /**
   * 글로벌 Undo 실행
   */
  function globalUndo() {
    if (undoStack.length === 0) {
      // 댓글 스택이 비어있으면 그리기 Undo 시도
      return drawingManager.undo();
    }

    const action = undoStack.pop();
    if (action && action.undo) {
      action.undo();
      redoStack.push(action);
      return true;
    }
    return false;
  }

  /**
   * 글로벌 Redo 실행
   */
  function globalRedo() {
    if (redoStack.length === 0) {
      // Redo 스택이 비어있으면 그리기 Redo 시도
      return drawingManager.redo();
    }

    const action = redoStack.pop();
    if (action && action.redo) {
      action.redo();
      undoStack.push(action);
      return true;
    }
    return false;
  }

  // 마커 컨테이너 생성 (영상 위에 마커 표시용)
  const markerContainer = document.createElement('div');
  markerContainer.className = 'comment-markers-container';
  markerContainer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 15;
  `;
  elements.videoWrapper.appendChild(markerContainer);

  // ====== 모듈 초기화 ======

  // 비디오 플레이어
  const videoPlayer = new VideoPlayer({
    videoElement: elements.videoPlayer,
    container: elements.videoWrapper,
    fps: 24
  });

  // 타임라인
  const timeline = new Timeline({
    container: elements.timelineSection,
    tracksContainer: elements.tracksContainer,
    timelineRuler: elements.timelineRuler,
    playheadLine: elements.playheadLine,
    playheadHandle: elements.playheadHandle,
    zoomSlider: elements.zoomSlider,
    zoomDisplay: elements.zoomDisplay,
    timelineTracks: elements.timelineTracks,
    layerHeaders: elements.layerHeaders
  });

  // 드로잉 매니저
  const drawingManager = new DrawingManager({
    canvas: elements.drawingCanvas,
    onionSkinCanvas: elements.onionSkinCanvas
  });

  // 댓글 매니저
  const commentManager = new CommentManager({
    fps: 24,
    container: markerContainer
  });

  // 리뷰 데이터 매니저 (.bframe 파일 저장/로드)
  const reviewDataManager = new ReviewDataManager({
    commentManager,
    drawingManager,
    autoSave: true,
    autoSaveDelay: 2000 // 2초 디바운스
  });
  reviewDataManager.connect();

  // 사용자 설정 (단축키 세트 등)
  const userSettings = getUserSettings();

  // ====== 모듈 이벤트 연결 ======

  // 비디오 메타데이터 로드됨
  videoPlayer.addEventListener('loadedmetadata', (e) => {
    const { duration, totalFrames, fps } = e.detail;
    timeline.setVideoInfo(duration, fps);
    updateTimecodeDisplay();

    // 비디오 크기 정보가 준비되면 캔버스 오버레이 동기화
    syncCanvasOverlay();

    // 드로잉 매니저에 비디오 정보 전달
    drawingManager.setVideoInfo(totalFrames, fps);

    // 댓글 매니저에 FPS 전달
    commentManager.setFPS(fps);

    // .bframe에서 로드된 데이터가 있으면 다시 렌더링
    if (drawingManager.layers.length > 0) {
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      drawingManager.renderFrame(videoPlayer.currentFrame);
    }

    // 댓글 마커도 다시 렌더링 (FPS 설정 후)
    renderVideoMarkers();
    updateTimelineMarkers();

    log.info('비디오 정보', { duration, totalFrames, fps });
  });

  // 비디오 시간 업데이트 (일반 timeupdate - 타임라인 및 표시용)
  videoPlayer.addEventListener('timeupdate', (e) => {
    const { currentTime, currentFrame } = e.detail;
    timeline.setCurrentTime(currentTime);
    updateTimecodeDisplay();

    // 댓글 매니저에 현재 프레임 전달 (마커 가시성 업데이트)
    commentManager.setCurrentFrame(currentFrame);

    // 재생 중이 아닐 때 (seeking)만 그리기 업데이트
    // 재생 중에는 frameUpdate 이벤트에서 처리
    if (!videoPlayer.isPlaying) {
      drawingManager.setCurrentFrame(currentFrame);
    }
  });

  // 프레임 정확한 업데이트 (requestVideoFrameCallback 기반 - 그리기 동기화용)
  videoPlayer.addEventListener('frameUpdate', (e) => {
    const { frame, time } = e.detail;

    // 타임라인 플레이헤드 실시간 업데이트 (재생 중)
    timeline.setCurrentTime(time);

    // 그리기 레이어를 프레임 정확하게 동기화 (재생 중)
    drawingManager.setCurrentFrame(frame);
  });

  // 재생 아이콘 SVG
  const playIconSVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  const pauseIconSVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

  // 비디오 재생 상태 변경
  videoPlayer.addEventListener('play', () => {
    elements.btnPlay.innerHTML = pauseIconSVG;
    drawingManager.setPlaying(true);
  });

  videoPlayer.addEventListener('pause', () => {
    elements.btnPlay.innerHTML = playIconSVG;
    drawingManager.setPlaying(false);
  });

  videoPlayer.addEventListener('ended', () => {
    elements.btnPlay.innerHTML = playIconSVG;
    drawingManager.setPlaying(false);
  });

  // 비디오 에러
  videoPlayer.addEventListener('error', (e) => {
    showToast('비디오 재생 오류가 발생했습니다.', 'error');
  });

  // 코덱 미지원
  const codecErrorOverlay = document.getElementById('codecErrorOverlay');
  const btnCodecErrorClose = document.getElementById('btnCodecErrorClose');

  videoPlayer.addEventListener('codecunsupported', (e) => {
    log.warn('코덱 미지원', e.detail);
    codecErrorOverlay?.classList.add('active');
  });

  btnCodecErrorClose?.addEventListener('click', () => {
    codecErrorOverlay?.classList.remove('active');
    // 드롭존 다시 표시
    elements.dropZone?.classList.remove('hidden');
    elements.videoPlayer.style.display = 'none';
  });

  // 타임라인에서 시간 이동 요청
  timeline.addEventListener('seek', (e) => {
    videoPlayer.seek(e.detail.time);
    hideScrubPreview();
  });

  // 스크러빙 중 (드래그 중 프리뷰)
  timeline.addEventListener('scrubbing', (e) => {
    showScrubPreview(e.detail.time);
  });

  // 스크러빙 종료
  timeline.addEventListener('scrubbingEnd', (e) => {
    hideScrubPreview();
  });

  // 타임라인 마커 클릭
  timeline.addEventListener('markerClick', (e) => {
    videoPlayer.seek(e.detail.time);
  });

  // ====== 드로잉 매니저 이벤트 ======

  // 레이어 변경 시 타임라인 업데이트
  drawingManager.addEventListener('layersChanged', () => {
    timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
  });

  // 프레임 렌더링 완료 시
  drawingManager.addEventListener('frameRendered', (e) => {
    log.debug('프레임 렌더링 완료', { frame: e.detail.frame });
  });

  // ====== 타임라인 레이어 이벤트 ======

  // 레이어 선택
  timeline.addEventListener('layerSelect', (e) => {
    drawingManager.setActiveLayer(e.detail.layerId);
    timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
  });

  // 레이어 가시성 토글
  timeline.addEventListener('layerVisibilityToggle', (e) => {
    drawingManager.toggleLayerVisibility(e.detail.layerId);
  });

  // 레이어 잠금 토글
  timeline.addEventListener('layerLockToggle', (e) => {
    drawingManager.toggleLayerLock(e.detail.layerId);
  });

  // 키프레임 이동
  timeline.addEventListener('keyframesMove', (e) => {
    const { keyframes, frameDelta } = e.detail;
    if (drawingManager.moveKeyframes(keyframes)) {
      // 이동 성공 시 선택 상태 업데이트
      timeline.selectedKeyframes = keyframes.map(kf => ({
        layerId: kf.layerId,
        frame: kf.toFrame
      }));
      showToast(`키프레임 ${frameDelta > 0 ? '+' : ''}${frameDelta} 프레임 이동`, 'info');
    }
  });

  // ====== 리뷰 데이터 매니저 이벤트 ======

  // 자동 저장 완료
  reviewDataManager.addEventListener('saved', (e) => {
    log.info('.bframe 저장됨', { path: e.detail.path });
    // 조용히 저장 (토스트 생략 - 자동 저장이라 너무 자주 뜸)
  });

  // 저장 에러
  reviewDataManager.addEventListener('saveError', (e) => {
    log.error('.bframe 저장 실패', e.detail.error);
    showToast('리뷰 데이터 저장 실패', 'error');
  });

  // 로드 완료
  reviewDataManager.addEventListener('loaded', (e) => {
    log.info('.bframe 로드됨', { path: e.detail.path });
  });

  // 로드 에러
  reviewDataManager.addEventListener('loadError', (e) => {
    log.error('.bframe 로드 실패', e.detail.error);
    showToast('리뷰 데이터 로드 실패', 'error');
  });

  // ====== 댓글 매니저 이벤트 (마커 기반) ======

  // 댓글 모드 변경
  commentManager.addEventListener('commentModeChanged', (e) => {
    const { isCommentMode } = e.detail;
    state.isCommentMode = isCommentMode;

    // 커서 변경
    if (isCommentMode) {
      elements.videoWrapper.classList.add('comment-mode');
      markerContainer.style.pointerEvents = 'auto';
      // pendingText가 있으면 토스트 생략 (역순 플로우에서는 Enter 핸들러가 토스트 표시)
      if (!commentManager.getPendingText()) {
        showToast('댓글 모드: 영상을 클릭하여 댓글을 추가하세요', 'info');
      }
    } else {
      elements.videoWrapper.classList.remove('comment-mode');
      markerContainer.style.pointerEvents = 'none';
      removePendingMarkerUI();
    }

    // 버튼 상태 업데이트
    elements.btnAddComment?.classList.toggle('active', isCommentMode);
  });

  // 마커 생성 시작
  commentManager.addEventListener('markerCreationStarted', (e) => {
    const { marker } = e.detail;
    renderPendingMarker(marker);
  });

  // 마커 생성 취소
  commentManager.addEventListener('markerCreationCancelled', (e) => {
    removePendingMarkerUI();
  });

  // 마커 추가됨
  commentManager.addEventListener('markerAdded', (e) => {
    const { marker } = e.detail;
    removePendingMarkerUI();
    renderVideoMarkers();
    updateTimelineMarkers();
    updateCommentList();
    log.info('마커 추가됨', { id: marker.id, text: marker.text });

    // Undo 스택에 추가
    const markerData = marker.toJSON();
    pushUndo({
      type: 'ADD_COMMENT',
      data: markerData,
      undo: () => {
        commentManager.deleteMarker(markerData.id);
        updateCommentList();
        updateTimelineMarkers();
        updateVideoMarkers();
      },
      redo: () => {
        commentManager.restoreMarker(markerData);
        updateCommentList();
        updateTimelineMarkers();
        updateVideoMarkers();
      }
    });
  });

  // 마커 삭제됨
  commentManager.addEventListener('markerDeleted', (e) => {
    renderVideoMarkers();
    updateTimelineMarkers();
    updateCommentList();
  });

  // 마커 업데이트됨
  commentManager.addEventListener('markerUpdated', (e) => {
    renderVideoMarkers();
    updateTimelineMarkers();
    updateCommentList();
  });

  // 답글 추가됨
  commentManager.addEventListener('replyAdded', (e) => {
    renderVideoMarkers();
    updateCommentList();
  });

  // 프레임 변경 시 마커 가시성 업데이트
  commentManager.addEventListener('frameChanged', (e) => {
    updateVideoMarkersVisibility();
  });

  // 마커 고정 상태 변경
  commentManager.addEventListener('markerPinnedChanged', (e) => {
    const { marker } = e.detail;
    updateMarkerTooltipState(marker);
  });

  // pending 텍스트 설정됨 (역순 플로우)
  commentManager.addEventListener('pendingTextSet', (e) => {
    const { text } = e.detail;
    log.info('Pending 텍스트 설정됨 (역순 플로우)', { text });
  });

  // 타임라인 댓글 마커 클릭
  timeline.addEventListener('commentMarkerClick', (e) => {
    const { time, frame } = e.detail;
    videoPlayer.seek(time);
  });

  // ====== 이벤트 리스너 설정 ======

  // 파일 열기 버튼
  elements.btnOpenFile?.addEventListener('click', async () => {
    log.info('파일 열기 버튼 클릭');
    try {
      const result = await window.electronAPI.openFileDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        await loadVideo(result.filePaths[0]);
      }
    } catch (error) {
      log.error('파일 열기 실패', error);
      showToast('파일을 열 수 없습니다.', 'error');
    }
  });

  // 드래그 앤 드롭
  elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.classList.add('dragging');
  });

  elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('dragging');
  });

  elements.dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove('dragging');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (isVideoFile(file.name)) {
        await loadVideo(file.path);
      } else {
        showToast('지원하지 않는 파일 형식입니다.', 'error');
      }
    }
  });

  // 재생/일시정지
  elements.btnPlay.addEventListener('click', () => {
    videoPlayer.togglePlay();
  });

  // 프레임 이동
  elements.btnFirst.addEventListener('click', () => videoPlayer.seekToStart());
  elements.btnPrevFrame.addEventListener('click', () => videoPlayer.prevFrame());
  elements.btnNextFrame.addEventListener('click', () => videoPlayer.nextFrame());
  elements.btnLast.addEventListener('click', () => videoPlayer.seekToEnd());

  // 그리기 모드 토글
  elements.btnDrawMode.addEventListener('click', toggleDrawMode);

  // 댓글 추가 버튼 (댓글 모드 토글)
  elements.btnAddComment.addEventListener('click', () => {
    toggleCommentMode();
  });

  // 사이드바 댓글 입력 Enter 처리 (역순 플로우: 텍스트 입력 → 마커 찍기)
  elements.commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = elements.commentInput.value.trim();
      if (text) {
        // 텍스트를 pending으로 설정하고 댓글 모드 활성화
        commentManager.setPendingText(text);
        elements.commentInput.value = '';
        showToast('영상에서 마커를 찍어주세요', 'info');
      }
    }
  });

  // 마커 컨테이너 클릭 (영상 위 클릭으로 마커 생성)
  markerContainer.addEventListener('click', (e) => {
    if (!state.isCommentMode) return;

    // 마커 요소 클릭은 무시 (마커 자체의 이벤트 처리)
    if (e.target.closest('.comment-marker')) return;

    // 캔버스 영역 내 상대 좌표 계산
    const rect = markerContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // 마커 생성 시작
    commentManager.startMarkerCreation(x, y);
  });

  // 링크 복사 (.bframe 파일 경로 + 웹 뷰어 링크)
  // 원시 경로를 복사하면 AutoHotkey가 baeframe:// 링크로 변환
  // 웹 공유 링크도 함께 생성하여 복사
  elements.btnCopyLink.addEventListener('click', async () => {
    const bframePath = reviewDataManager.getBframePath();
    const videoPath = reviewDataManager.getVideoPath();

    if (!bframePath) {
      showToast('먼저 파일을 열어주세요.', 'warn');
      return;
    }

    // Windows 경로 형식으로 통일 (백슬래시 사용)
    const windowsPath = bframePath.replace(/\//g, '\\');
    const fileName = windowsPath.split('\\').pop() || 'bframe 파일';

    // Google Drive 경로인 경우 웹 공유 링크도 생성
    const isGDrive = isGoogleDrivePath(videoPath) || isGoogleDrivePath(bframePath);
    let webShareUrl = null;

    if (isGDrive && videoPath) {
      try {
        // 이미 저장된 링크가 있으면 사용
        if (storedDriveLinks.videoUrl && storedDriveLinks.bframeUrl) {
          const result = await window.electronAPI.generateWebShareLink(
            storedDriveLinks.videoUrl,
            storedDriveLinks.bframeUrl
          );
          if (result.success) {
            webShareUrl = result.webShareUrl;
          }
        } else {
          // 자동으로 Google Drive 파일 ID 추출 시도
          const result = await window.electronAPI.generateGDriveShareLink(videoPath, bframePath);
          if (result.success) {
            storedDriveLinks.videoUrl = result.videoUrl;
            storedDriveLinks.bframeUrl = result.bframeUrl;
            webShareUrl = result.webShareUrl;
          }
        }
      } catch (error) {
        log.warn('웹 공유 링크 생성 실패 (무시)', error);
      }
    }

    // 클립보드에 복사할 내용 생성
    // 형식: .bframe경로|웹공유URL|파일명
    // AutoHotkey가 이 형식을 파싱하여 Slack 메시지 생성
    let clipboardContent = windowsPath;
    if (webShareUrl) {
      clipboardContent = `${windowsPath}|${webShareUrl}|${fileName}`;
    }

    await window.electronAPI.copyToClipboard(clipboardContent);

    if (webShareUrl) {
      showToast('링크가 복사되었습니다! Slack에서 Ctrl+Shift+V로 붙여넣기 (웹 뷰어 링크 포함)', 'success');
    } else {
      showToast('.bframe 경로가 복사되었습니다! Slack에서 Ctrl+Shift+V로 하이퍼링크 붙여넣기', 'success');
    }
    log.info('경로 복사됨', { path: windowsPath, webShareUrl });
  });

  // ====== 웹 공유 모달 ======
  const WEB_VIEWER_BASE_URL = 'https://baeframe.vercel.app';

  // Google Drive 경로 감지
  function isGoogleDrivePath(path) {
    if (!path) return false;
    const lowerPath = path.toLowerCase();
    return lowerPath.includes('공유 드라이브') ||
           lowerPath.includes('shared drives') ||
           lowerPath.includes('my drive') ||
           lowerPath.includes('내 드라이브') ||
           lowerPath.includes('googledrive') ||
           lowerPath.includes('google drive');
  }

  // 파일명 추출
  function getFileName(path) {
    if (!path) return '';
    return path.split(/[/\\]/).pop() || '';
  }

  // 저장된 Google Drive 링크 (파일별)
  const storedDriveLinks = {
    videoUrl: null,
    bframeUrl: null
  };

  // 클립보드 모니터링 상태
  let clipboardMonitorInterval = null;
  let currentLinkTarget = null; // 'video' | 'bframe'

  // 웹 공유 버튼 클릭
  elements.btnWebShare.addEventListener('click', async () => {
    const videoPath = reviewDataManager.getVideoPath();
    const bframePath = reviewDataManager.getBframePath();

    if (!videoPath || !bframePath) {
      showToast('먼저 파일을 열어주세요.', 'warn');
      return;
    }

    const isGDrive = isGoogleDrivePath(videoPath) || isGoogleDrivePath(bframePath);

    if (!isGDrive) {
      showToast('Google Drive 파일만 웹 공유가 가능합니다.', 'warn');
      return;
    }

    // 이미 두 링크가 저장되어 있으면 바로 생성
    if (storedDriveLinks.videoUrl && storedDriveLinks.bframeUrl) {
      const result = await window.electronAPI.generateWebShareLink(
        storedDriveLinks.videoUrl,
        storedDriveLinks.bframeUrl
      );
      if (result.success) {
        await window.electronAPI.copyToClipboard(result.webShareUrl);
        showToast('✅ 웹 공유 링크가 클립보드에 복사되었습니다!', 'success');
        log.info('웹 공유 링크 생성 완료', { url: result.webShareUrl });
        return;
      }
    }

    // 1️⃣ 먼저 로컬 경로에서 자동으로 Google Drive 파일 ID 추출 시도
    showToast('웹 공유 링크 생성 중...', 'info');
    log.info('Google Drive 파일 ID 자동 추출 시도', { videoPath, bframePath });

    try {
      const result = await window.electronAPI.generateGDriveShareLink(videoPath, bframePath);

      if (result.success) {
        // 성공! 링크 저장 및 클립보드 복사
        storedDriveLinks.videoUrl = result.videoUrl;
        storedDriveLinks.bframeUrl = result.bframeUrl;

        await window.electronAPI.copyToClipboard(result.webShareUrl);
        showToast('✅ 웹 공유 링크가 클립보드에 복사되었습니다!', 'success');
        log.info('자동 웹 공유 링크 생성 완료', { url: result.webShareUrl });
        return;
      }

      // 자동 추출 실패 → 수동 모달 열기
      log.warn('자동 파일 ID 추출 실패', { error: result.error });
      showToast('자동 링크 생성 실패. 수동으로 입력해주세요.', 'warn');
    } catch (error) {
      log.error('자동 링크 생성 중 오류', error);
      showToast('자동 링크 생성 실패. 수동으로 입력해주세요.', 'warn');
    }

    // 2️⃣ 자동 실패 시 수동 모달 열기
    openWebShareModal();
  });

  // 웹 공유 모달 열기
  function openWebShareModal() {
    elements.webShareModal.classList.add('active');
    elements.webShareResultGroup.style.display = 'none';

    const videoPath = reviewDataManager.getVideoPath();
    const bframePath = reviewDataManager.getBframePath();
    const videoName = getFileName(videoPath);
    const bframeName = getFileName(bframePath);

    // 저장된 링크가 있으면 표시
    elements.webShareVideoUrl.value = storedDriveLinks.videoUrl || '';
    elements.webShareBframeUrl.value = storedDriveLinks.bframeUrl || '';

    const fileInfoEl = document.getElementById('webShareFileInfo');
    if (fileInfoEl) {
      fileInfoEl.innerHTML = `
        <div class="file-info-box">
          <strong>📁 Google Drive 파일</strong><br>
          <span>1️⃣ 영상: <code>${videoName || '(알 수 없음)'}</code></span><br>
          <span>2️⃣ Bframe: <code>${bframeName || '(알 수 없음)'}</code></span>
          <hr style="border-color:#444; margin:8px 0">
          <small style="color:#aaa">
            💡 파일 탐색기에서 각 파일을 우클릭 →<br>
            <strong style="color:#fff">"Google 드라이브 링크 복사"</strong> 클릭 후<br>
            아래 "클립보드에서 붙여넣기" 버튼을 누르세요.
          </small>
        </div>
      `;
      fileInfoEl.style.display = 'block';
    }

    // 어떤 링크가 없는지 확인하고 해당 필드 강조
    updateLinkFieldHighlight();

    log.info('웹 공유 모달 열림');
  }

  // 링크 필드 강조 업데이트
  function updateLinkFieldHighlight() {
    const videoEmpty = !elements.webShareVideoUrl.value.trim();
    const bframeEmpty = !elements.webShareBframeUrl.value.trim();

    elements.webShareVideoUrl.style.borderColor = videoEmpty ? '#f39c12' : '#27ae60';
    elements.webShareBframeUrl.style.borderColor = bframeEmpty ? '#f39c12' : '#27ae60';

    // 자동으로 다음 타겟 설정
    if (videoEmpty) {
      currentLinkTarget = 'video';
    } else if (bframeEmpty) {
      currentLinkTarget = 'bframe';
    } else {
      currentLinkTarget = null;
    }
  }

  // 클립보드에서 붙여넣기 버튼 추가
  const pasteFromClipboardBtn = document.getElementById('pasteFromClipboard');
  if (pasteFromClipboardBtn) {
    pasteFromClipboardBtn.addEventListener('click', async () => {
      const result = await window.electronAPI.readGDriveLink();
      if (result.hasLink) {
        // 어떤 필드에 붙여넣을지 결정
        const videoEmpty = !elements.webShareVideoUrl.value.trim();
        const bframeEmpty = !elements.webShareBframeUrl.value.trim();

        if (videoEmpty) {
          elements.webShareVideoUrl.value = result.link;
          storedDriveLinks.videoUrl = result.link;
          showToast('✅ 영상 링크가 붙여넣기 되었습니다!', 'success');
        } else if (bframeEmpty) {
          elements.webShareBframeUrl.value = result.link;
          storedDriveLinks.bframeUrl = result.link;
          showToast('✅ Bframe 링크가 붙여넣기 되었습니다!', 'success');
        } else {
          showToast('두 링크가 이미 입력되어 있습니다.', 'info');
        }

        updateLinkFieldHighlight();

        // 두 링크가 모두 있으면 자동으로 결과 표시
        if (elements.webShareVideoUrl.value && elements.webShareBframeUrl.value) {
          elements.generateWebShareLink.click();
        }
      } else {
        showToast('클립보드에 Google Drive 링크가 없습니다.', 'warn');
      }
    });
  }

  // 모달 닫기
  function closeWebShareModal() {
    elements.webShareModal.classList.remove('active');
  }

  elements.closeWebShare.addEventListener('click', closeWebShareModal);
  elements.cancelWebShare.addEventListener('click', closeWebShareModal);

  // 모달 외부 클릭 시 닫기
  elements.webShareModal.addEventListener('click', (e) => {
    if (e.target === elements.webShareModal) {
      closeWebShareModal();
    }
  });

  // 링크 생성 버튼 클릭
  elements.generateWebShareLink.addEventListener('click', () => {
    const videoUrl = elements.webShareVideoUrl.value.trim();
    const bframeUrl = elements.webShareBframeUrl.value.trim();

    if (!videoUrl || !bframeUrl) {
      showToast('영상 URL과 .bframe URL을 모두 입력해주세요.', 'warn');
      return;
    }

    // Google Drive URL 유효성 검사
    const drivePattern = /drive\.google\.com/;
    if (!drivePattern.test(videoUrl) || !drivePattern.test(bframeUrl)) {
      showToast('Google Drive URL 형식이 올바르지 않습니다.', 'warn');
      return;
    }

    // 웹 공유 URL 생성
    const shareUrl = `${WEB_VIEWER_BASE_URL}/open.html?video=${encodeURIComponent(videoUrl)}&bframe=${encodeURIComponent(bframeUrl)}`;

    elements.webShareResultUrl.value = shareUrl;
    elements.webShareResultGroup.style.display = 'block';
    log.info('웹 공유 링크 생성됨', { shareUrl });
  });

  // 생성된 링크 복사 버튼
  elements.btnCopyWebShareUrl.addEventListener('click', async () => {
    const shareUrl = elements.webShareResultUrl.value;
    if (shareUrl) {
      await window.electronAPI.copyToClipboard(shareUrl);
      showToast('웹 공유 링크가 복사되었습니다!', 'success');
      log.info('웹 공유 링크 복사됨', { shareUrl });
    }
  });

  // 파일 경로 열기 (현재 파일이 있는 폴더를 탐색기에서 열기)
  elements.btnOpenFolder.addEventListener('click', async () => {
    log.info('파일 경로 열기 버튼 클릭');
    const videoPath = reviewDataManager.getVideoPath();
    log.info('현재 비디오 경로', { videoPath });

    if (!videoPath) {
      showToast('먼저 파일을 열어주세요.', 'warn');
      return;
    }

    try {
      // Windows 경로 형식으로 변환 (백슬래시)
      const windowsPath = videoPath.replace(/\//g, '\\');
      // 폴더 경로 추출
      const folderPath = windowsPath.substring(0, windowsPath.lastIndexOf('\\'));
      log.info('폴더 경로 열기 시도', { windowsPath, folderPath });
      const result = await window.electronAPI.openFolder(folderPath);
      log.info('파일 경로 열기 완료', { path: folderPath, result });
    } catch (error) {
      log.error('파일 경로 열기 실패', error);
      showToast('경로를 열 수 없습니다.', 'error');
    }
  });

  // 다른 파일 열기
  elements.btnOpenOther.addEventListener('click', async () => {
    log.info('다른 파일 열기 버튼 클릭');
    try {
      const result = await window.electronAPI.openFileDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        await loadVideo(result.filePaths[0]);
      }
    } catch (error) {
      log.error('다른 파일 열기 실패', error);
      showToast('파일을 열 수 없습니다.', 'error');
    }
  });

  // 단축키 메뉴 토글
  elements.shortcutsToggle.addEventListener('click', () => {
    elements.shortcutsToggle.classList.toggle('active');
    elements.shortcutsMenu.classList.toggle('visible');
  });

  // 외부 클릭 시 단축키 메뉴 닫기
  document.addEventListener('click', (e) => {
    if (!elements.shortcutsToggle.contains(e.target) &&
        !elements.shortcutsMenu.contains(e.target)) {
      elements.shortcutsToggle.classList.remove('active');
      elements.shortcutsMenu.classList.remove('visible');
    }
  });

  // ====== 단축키 세트 선택 ======
  const shortcutSet1Btn = document.getElementById('shortcutSet1');
  const shortcutSet2Btn = document.getElementById('shortcutSet2');

  // 초기 단축키 세트 UI 설정
  function updateShortcutSetUI() {
    const currentSet = userSettings.getShortcutSet();
    elements.shortcutsMenu.dataset.set = currentSet;

    shortcutSet1Btn?.classList.toggle('active', currentSet === 'set1');
    shortcutSet2Btn?.classList.toggle('active', currentSet === 'set2');
  }

  // 단축키 세트 버튼 클릭 이벤트
  shortcutSet1Btn?.addEventListener('click', () => {
    userSettings.setShortcutSet('set1');
    updateShortcutSetUI();
    showToast('단축키 Set 1 (기본) 활성화', 'info');
  });

  shortcutSet2Btn?.addEventListener('click', () => {
    userSettings.setShortcutSet('set2');
    updateShortcutSetUI();
    showToast('단축키 Set 2 (애니메이션) 활성화', 'info');
  });

  // 초기 UI 업데이트
  updateShortcutSetUI();

  // 필터 칩 (댓글 목록 필터링)
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', function() {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      const filter = this.dataset.filter;
      updateCommentList(filter);
      log.debug('필터 변경', { filter });
    });
  });

  // ====== 댓글 설정 드롭다운 ======
  const btnCommentSettings = document.getElementById('btnCommentSettings');
  const commentSettingsDropdown = document.getElementById('commentSettingsDropdown');
  const toggleCommentThumbnails = document.getElementById('toggleCommentThumbnails');
  const thumbnailScaleSlider = document.getElementById('thumbnailScaleSlider');
  const thumbnailScaleValue = document.getElementById('thumbnailScaleValue');
  const thumbnailScaleItem = document.getElementById('thumbnailScaleItem');

  // 설정 초기값 로드 (요소가 있을 경우에만)
  if (toggleCommentThumbnails) {
    toggleCommentThumbnails.checked = userSettings.getShowCommentThumbnails();
  }
  if (thumbnailScaleSlider) {
    thumbnailScaleSlider.value = userSettings.getCommentThumbnailScale();
  }
  if (thumbnailScaleValue) {
    thumbnailScaleValue.textContent = `${userSettings.getCommentThumbnailScale()}%`;
  }
  if (thumbnailScaleItem && toggleCommentThumbnails) {
    thumbnailScaleItem.classList.toggle('disabled', !toggleCommentThumbnails.checked);
  }

  // 설정 버튼 클릭 - 드롭다운 토글
  btnCommentSettings?.addEventListener('click', (e) => {
    e.stopPropagation();
    commentSettingsDropdown?.classList.toggle('open');
    btnCommentSettings.classList.toggle('active', commentSettingsDropdown?.classList.contains('open'));
  });

  // 드롭다운 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (!commentSettingsDropdown?.contains(e.target) && e.target !== btnCommentSettings) {
      commentSettingsDropdown?.classList.remove('open');
      btnCommentSettings?.classList.remove('active');
    }
  });

  // 드롭다운 내부 클릭 시 이벤트 버블링 방지
  commentSettingsDropdown?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // 이름 변경 버튼 클릭
  const btnChangeUserName = document.getElementById('btnChangeUserName');
  btnChangeUserName?.addEventListener('click', () => {
    commentSettingsDropdown?.classList.remove('open');
    btnCommentSettings?.classList.remove('active');
    openUserSettingsModal(false); // 필수 모드 아님
  });

  // 썸네일 토글 변경
  toggleCommentThumbnails?.addEventListener('change', () => {
    const show = toggleCommentThumbnails.checked;
    userSettings.setShowCommentThumbnails(show);
    thumbnailScaleItem.classList.toggle('disabled', !show);
    updateCommentList(document.querySelector('.filter-chip.active')?.dataset.filter || 'all');
  });

  // 썸네일 스케일 변경
  thumbnailScaleSlider?.addEventListener('input', () => {
    const scale = parseInt(thumbnailScaleSlider.value);
    thumbnailScaleValue.textContent = `${scale}%`;
    userSettings.setCommentThumbnailScale(scale);
    // CSS 변수로 스케일 적용
    document.documentElement.style.setProperty('--comment-thumbnail-scale', scale / 100);
    updateCommentList(document.querySelector('.filter-chip.active')?.dataset.filter || 'all');
  });

  // 초기 스케일 CSS 변수 설정
  document.documentElement.style.setProperty('--comment-thumbnail-scale', userSettings.getCommentThumbnailScale() / 100);

  // 토스트 알림 토글
  const toggleToastNotifications = document.getElementById('toggleToastNotifications');
  if (toggleToastNotifications) {
    toggleToastNotifications.checked = userSettings.getShowToastNotifications();
  }
  toggleToastNotifications?.addEventListener('change', () => {
    const show = toggleToastNotifications.checked;
    userSettings.setShowToastNotifications(show);
  });

  // 도구별 설정 저장 (크기, 불투명도)
  const toolSettings = {
    eraser: { size: 20 },      // 지우개는 기본 크기 더 크게
    brush: { size: 3, opacity: 100 }  // 브러시/펜 등 다른 도구들
  };
  let currentToolType = 'brush';  // 'eraser' 또는 'brush'

  // 그리기 도구 선택
  const opacitySection = document.getElementById('opacitySection');
  const brushSizeSlider = document.getElementById('brushSizeSlider');
  const brushSizeValue = document.getElementById('brushSizeValue');
  const sizePreview = document.getElementById('sizePreview');
  const brushOpacitySlider = document.getElementById('brushOpacitySlider');
  const brushOpacityValue = document.getElementById('brushOpacityValue');

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      // 도구 매핑
      const toolMap = {
        'pen': DrawingTool.PEN,
        'brush': DrawingTool.BRUSH,
        'eraser': DrawingTool.ERASER,
        'line': DrawingTool.LINE,
        'arrow': DrawingTool.ARROW,
        'rect': DrawingTool.RECT,
        'circle': DrawingTool.CIRCLE
      };
      const toolName = this.dataset.tool;
      const tool = toolMap[toolName] || DrawingTool.PEN;
      const newToolType = toolName === 'eraser' ? 'eraser' : 'brush';

      // 이전 도구 설정 저장
      toolSettings[currentToolType].size = parseInt(brushSizeSlider.value);
      if (currentToolType === 'brush') {
        toolSettings.brush.opacity = parseInt(brushOpacitySlider.value);
      }

      // 새 도구 설정 적용
      currentToolType = newToolType;
      brushSizeSlider.value = toolSettings[currentToolType].size;
      drawingManager.setLineWidth(toolSettings[currentToolType].size);
      updateSizePreview();

      // 지우개일 때 불투명도 섹션 숨기기, 아니면 보이기
      if (newToolType === 'eraser') {
        opacitySection.style.display = 'none';
        drawingManager.setOpacity(1);  // 지우개는 항상 100%
      } else {
        opacitySection.style.display = 'block';
        brushOpacitySlider.value = toolSettings.brush.opacity;
        brushOpacityValue.textContent = `${toolSettings.brush.opacity}%`;
        drawingManager.setOpacity(toolSettings.brush.opacity / 100);
      }

      drawingManager.setTool(tool);
      log.debug('도구 선택', { tool: toolName, size: toolSettings[currentToolType].size });
    });
  });

  // 색상 선택 (8색 팔레트)
  const colorMap = {
    'red': '#ff4757',
    'yellow': '#ffd000',
    'green': '#26de81',
    'blue': '#4a9eff',
    'white': '#ffffff',
    'black': '#000000',
    'mint': '#1abc9c',
    'pink': '#ff6b9d'
  };

  let currentColor = '#ff4757';

  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      currentColor = colorMap[this.dataset.color] || '#ff4757';
      drawingManager.setColor(currentColor);
      updateSizePreview();
      log.debug('색상 선택', { color: this.dataset.color });
    });
  });

  // 브러쉬 사이즈 슬라이더 (변수는 위에서 이미 선언됨)
  function updateSizePreview() {
    const size = brushSizeSlider.value;
    brushSizeValue.textContent = `${size}px`;
    sizePreview.style.setProperty('--preview-size', `${Math.min(size, 20)}px`);
    sizePreview.style.setProperty('--preview-color', currentColor);
  }

  brushSizeSlider.addEventListener('input', function() {
    const size = parseInt(this.value);
    toolSettings[currentToolType].size = size;  // 현재 도구 설정에 저장
    drawingManager.setLineWidth(size);
    updateSizePreview();
  });

  // 불투명도 슬라이더
  brushOpacitySlider.addEventListener('input', function() {
    const opacity = parseInt(this.value);
    toolSettings.brush.opacity = opacity;  // 브러시 설정에 저장
    brushOpacityValue.textContent = `${opacity}%`;
    drawingManager.setOpacity(opacity / 100);
  });

  // 초기 사이즈 프리뷰 설정
  updateSizePreview();

  // Undo 버튼
  elements.btnUndo?.addEventListener('click', () => {
    if (drawingManager.undo()) {
      showToast('실행 취소됨', 'info');
    }
  });

  // 전체 지우기 버튼
  elements.btnClearDrawing?.addEventListener('click', () => {
    const layer = drawingManager.getActiveLayer();
    if (layer) {
      // 현재 키프레임의 데이터를 지움
      const keyframe = layer.getKeyframeAtFrame(drawingManager.currentFrame);
      if (keyframe && !keyframe.isEmpty) {
        drawingManager._saveToHistory();
        keyframe.setCanvasData(null);
        drawingManager.renderFrame(drawingManager.currentFrame);
        showToast('현재 프레임 지워짐', 'info');
      }
    }
  });

  // 레이어 추가 버튼
  elements.btnAddLayer?.addEventListener('click', () => {
    drawingManager.createLayer();
    timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
    showToast('새 레이어 추가됨', 'success');
  });

  // 레이어 삭제 버튼
  elements.btnDeleteLayer?.addEventListener('click', () => {
    const activeLayerId = drawingManager.activeLayerId;
    if (!activeLayerId) {
      showToast('삭제할 레이어가 없습니다.', 'warn');
      return;
    }
    if (drawingManager.layers.length <= 1) {
      showToast('마지막 레이어는 삭제할 수 없습니다.', 'warn');
      return;
    }
    if (drawingManager.deleteLayer(activeLayerId)) {
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      showToast('레이어 삭제됨', 'info');
    }
  });

  // ====== 그리기 도구 메뉴 이동/접기 ======
  const drawingToolsPanel = elements.drawingTools;
  const drawingToolsHeader = document.getElementById('drawingToolsHeader');
  const collapseToolsBtn = document.getElementById('collapseToolsBtn');

  // 접기/펴기 기능
  collapseToolsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    drawingToolsPanel.classList.toggle('collapsed');
  });

  // 드래그로 이동 기능
  let isDraggingTools = false;
  let toolsDragStartX = 0;
  let toolsDragStartY = 0;
  let toolsInitialLeft = 0;
  let toolsInitialTop = 0;

  drawingToolsHeader.addEventListener('mousedown', (e) => {
    if (e.target === collapseToolsBtn) return;
    isDraggingTools = true;
    toolsDragStartX = e.clientX;
    toolsDragStartY = e.clientY;
    toolsInitialLeft = drawingToolsPanel.offsetLeft;
    toolsInitialTop = drawingToolsPanel.offsetTop;
    drawingToolsPanel.style.transition = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingTools) return;

    const deltaX = e.clientX - toolsDragStartX;
    const deltaY = e.clientY - toolsDragStartY;

    const newLeft = toolsInitialLeft + deltaX;
    const newTop = toolsInitialTop + deltaY;

    // 경계 체크
    const container = elements.videoWrapper;
    const maxLeft = container.offsetWidth - drawingToolsPanel.offsetWidth - 10;
    const maxTop = container.offsetHeight - 50;

    drawingToolsPanel.style.left = `${Math.max(10, Math.min(newLeft, maxLeft))}px`;
    drawingToolsPanel.style.top = `${Math.max(10, Math.min(newTop, maxTop))}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isDraggingTools) {
      isDraggingTools = false;
      drawingToolsPanel.style.transition = '';
    }
  });

  // ====== 어니언 스킨 ======
  const onionToggle = document.getElementById('onionToggle');
  const onionControls = document.getElementById('onionControls');
  const onionBefore = document.getElementById('onionBefore');
  const onionAfter = document.getElementById('onionAfter');
  const onionOpacity = document.getElementById('onionOpacity');
  const onionOpacityValue = document.getElementById('onionOpacityValue');

  // 어니언 스킨 토글 함수 (UI 동기화 포함)
  function toggleOnionSkinWithUI() {
    const isActive = !onionToggle.classList.contains('active');
    onionToggle.classList.toggle('active', isActive);
    onionToggle.textContent = isActive ? 'ON' : 'OFF';
    onionControls.classList.toggle('visible', isActive);
    drawingManager.setOnionSkin(isActive, {
      before: parseInt(onionBefore.value),
      after: parseInt(onionAfter.value),
      opacity: parseInt(onionOpacity.value) / 100
    });
    return isActive;
  }

  onionToggle.addEventListener('click', () => {
    toggleOnionSkinWithUI();
  });

  onionBefore.addEventListener('change', updateOnionSettings);
  onionAfter.addEventListener('change', updateOnionSettings);
  onionOpacity.addEventListener('input', () => {
    onionOpacityValue.textContent = `${onionOpacity.value}%`;
    updateOnionSettings();
  });

  function updateOnionSettings() {
    if (onionToggle.classList.contains('active')) {
      drawingManager.setOnionSkin(true, {
        before: parseInt(onionBefore.value),
        after: parseInt(onionAfter.value),
        opacity: parseInt(onionOpacity.value) / 100
      });
    }
  }

  // ====== 영상 어니언 스킨 ======
  // TODO: 영상 어니언 스킨 기능 - 비디오 가림 문제로 임시 비활성화
  // 문제: 캔버스 오버레이가 비디오를 가려서 검은 화면으로 표시됨
  // 해결 필요: z-index, visibility 조정으로 해결 안됨 - 다른 접근 방식 필요
  /*
  const videoOnionToggle = document.getElementById('videoOnionToggle');
  const videoOnionControls = document.getElementById('videoOnionControls');
  const videoOnionBefore = document.getElementById('videoOnionBefore');
  const videoOnionAfter = document.getElementById('videoOnionAfter');
  const videoOnionOpacity = document.getElementById('videoOnionOpacity');
  const videoOnionOpacityValue = document.getElementById('videoOnionOpacityValue');
  const videoOnionSkinCanvas = document.getElementById('videoOnionSkinCanvas');

  // 비디오 플레이어에 영상 어니언 스킨 캔버스 설정
  videoPlayer.setVideoOnionSkinCanvas(videoOnionSkinCanvas);

  // 컨트롤바의 영상 어니언 스킨 버튼
  const btnVideoOnionSkin = document.getElementById('btnVideoOnionSkin');

  // 영상 어니언 스킨 토글 함수 (UI 동기화 포함)
  function toggleVideoOnionSkinWithUI() {
    const isActive = !videoOnionToggle.classList.contains('active');
    // 그리기 도구 패널 버튼 업데이트
    videoOnionToggle.classList.toggle('active', isActive);
    videoOnionToggle.textContent = isActive ? 'ON' : 'OFF';
    videoOnionControls.classList.toggle('visible', isActive);
    // 컨트롤바 버튼 업데이트
    btnVideoOnionSkin.classList.toggle('active', isActive);
    // 캔버스 표시/숨김
    videoOnionSkinCanvas.classList.toggle('visible', isActive);
    videoPlayer.setVideoOnionSkin(isActive, {
      before: parseInt(videoOnionBefore.value),
      after: parseInt(videoOnionAfter.value),
      opacity: parseInt(videoOnionOpacity.value) / 100
    });
    return isActive;
  }

  videoOnionToggle.addEventListener('click', () => {
    toggleVideoOnionSkinWithUI();
  });

  btnVideoOnionSkin.addEventListener('click', () => {
    toggleVideoOnionSkinWithUI();
  });

  videoOnionBefore.addEventListener('change', updateVideoOnionSettings);
  videoOnionAfter.addEventListener('change', updateVideoOnionSettings);
  videoOnionOpacity.addEventListener('input', () => {
    videoOnionOpacityValue.textContent = `${videoOnionOpacity.value}%`;
    updateVideoOnionSettings();
  });

  function updateVideoOnionSettings() {
    if (videoOnionToggle.classList.contains('active')) {
      videoPlayer.setVideoOnionSkin(true, {
        before: parseInt(videoOnionBefore.value),
        after: parseInt(videoOnionAfter.value),
        opacity: parseInt(videoOnionOpacity.value) / 100
      });
    }
  }

  // 비디오 일시정지 시 영상 어니언 스킨 렌더링
  videoPlayer.addEventListener('pause', () => {
    if (videoPlayer.videoOnionSkin?.enabled) {
      videoPlayer.renderVideoOnionSkin();
    }
  });

  // 비디오 재생 시 영상 어니언 스킨 클리어
  videoPlayer.addEventListener('play', () => {
    videoPlayer._clearVideoOnionSkin();
  });

  // 비디오 시간 변경 시 (일시정지 상태에서 seeking) 영상 어니언 스킨 업데이트
  let videoOnionSkinDebounceTimer = null;
  videoPlayer.addEventListener('timeupdate', () => {
    if (!videoPlayer.isPlaying && videoPlayer.videoOnionSkin?.enabled) {
      // 디바운스 처리 (너무 자주 렌더링하지 않도록)
      clearTimeout(videoOnionSkinDebounceTimer);
      videoOnionSkinDebounceTimer = setTimeout(() => {
        videoPlayer.renderVideoOnionSkin();
      }, 150);
    }
  });
  */

  // ====== 구간 반복 ======
  const btnSetInPoint = document.getElementById('btnSetInPoint');
  const btnSetOutPoint = document.getElementById('btnSetOutPoint');
  const btnLoopToggle = document.getElementById('btnLoopToggle');
  const btnClearLoop = document.getElementById('btnClearLoop');
  const inPointDisplay = document.getElementById('inPointDisplay');
  const outPointDisplay = document.getElementById('outPointDisplay');

  // 시작점 설정
  btnSetInPoint.addEventListener('click', () => {
    const time = videoPlayer.setInPointAtCurrent();
    inPointDisplay.textContent = videoPlayer.formatTimeShort(time);
    btnSetInPoint.classList.add('has-point');
    showToast(`시작점 설정: ${videoPlayer.formatTimeShort(time)}`, 'info');
  });

  // 종료점 설정
  btnSetOutPoint.addEventListener('click', () => {
    const time = videoPlayer.setOutPointAtCurrent();
    outPointDisplay.textContent = videoPlayer.formatTimeShort(time);
    btnSetOutPoint.classList.add('has-point');
    showToast(`종료점 설정: ${videoPlayer.formatTimeShort(time)}`, 'info');
  });

  // 구간 반복 토글
  btnLoopToggle.addEventListener('click', () => {
    // 시작점과 종료점이 설정되어 있어야 활성화 가능
    if (videoPlayer.loop.inPoint === null || videoPlayer.loop.outPoint === null) {
      showToast('시작점과 종료점을 먼저 설정하세요', 'warn');
      return;
    }
    const enabled = videoPlayer.toggleLoop();
    btnLoopToggle.classList.toggle('active', enabled);
    showToast(enabled ? '구간 반복 활성화' : '구간 반복 비활성화', 'info');
  });

  // 구간 초기화
  btnClearLoop.addEventListener('click', () => {
    videoPlayer.clearLoop();
    inPointDisplay.textContent = '--:--';
    outPointDisplay.textContent = '--:--';
    btnSetInPoint.classList.remove('has-point');
    btnSetOutPoint.classList.remove('has-point');
    btnLoopToggle.classList.remove('active');
    showToast('구간 초기화', 'info');
  });

  // 구간 변경 이벤트 수신 (UI 동기화)
  videoPlayer.addEventListener('loopChanged', (e) => {
    const { inPoint, outPoint, enabled } = e.detail;
    inPointDisplay.textContent = videoPlayer.formatTimeShort(inPoint);
    outPointDisplay.textContent = videoPlayer.formatTimeShort(outPoint);
    btnSetInPoint.classList.toggle('has-point', inPoint !== null);
    btnSetOutPoint.classList.toggle('has-point', outPoint !== null);
    btnLoopToggle.classList.toggle('active', enabled);
    // 타임라인에 구간 마커 표시
    timeline.setLoopRegion(inPoint, outPoint, enabled);
  });

  // ====== 비디오 줌/패닝 ======

  /**
   * 비디오 줌 레벨 설정
   */
  function setVideoZoom(zoom, showIndicator = true) {
    state.videoZoom = Math.max(state.minVideoZoom, Math.min(state.maxVideoZoom, zoom));
    applyVideoZoom();

    if (showIndicator) {
      showZoomIndicator(state.videoZoom);
    }
  }

  /**
   * 비디오 줌 적용
   */
  function applyVideoZoom() {
    const video = elements.videoPlayer;
    const scale = state.videoZoom / 100;

    video.style.transform = `scale(${scale}) translate(${state.videoPanX}px, ${state.videoPanY}px)`;
    video.style.transformOrigin = 'center center';

    // 줌 디스플레이 업데이트
    if (elements.videoZoomDisplay) {
      elements.videoZoomDisplay.textContent = `${Math.round(state.videoZoom)}%`;
    }

    // 줌이 100%가 아니면 줌 상태 표시
    if (state.videoZoom !== 100) {
      elements.videoWrapper?.classList.add('zoomed');
    } else {
      elements.videoWrapper?.classList.remove('zoomed');
      // 100%로 돌아오면 패닝도 리셋
      state.videoPanX = 0;
      state.videoPanY = 0;
    }

    // 캔버스도 동일하게 적용
    syncCanvasZoom();
  }

  /**
   * 캔버스 및 마커 컨테이너 줌 동기화
   */
  function syncCanvasZoom() {
    const scale = state.videoZoom / 100;
    const transform = `scale(${scale}) translate(${state.videoPanX}px, ${state.videoPanY}px)`;

    if (elements.drawingCanvas) {
      elements.drawingCanvas.style.transform = transform;
      elements.drawingCanvas.style.transformOrigin = 'center center';
    }
    if (elements.onionSkinCanvas) {
      elements.onionSkinCanvas.style.transform = transform;
      elements.onionSkinCanvas.style.transformOrigin = 'center center';
    }
    // 마커 컨테이너도 동일하게 적용 (영상 확대 시 마커가 따라다님)
    if (markerContainer) {
      markerContainer.style.transform = transform;
      markerContainer.style.transformOrigin = 'center center';
    }
  }

  /**
   * 줌 인디케이터 표시
   */
  function showZoomIndicator(zoom) {
    if (!elements.zoomIndicatorOverlay) return;

    elements.zoomIndicatorOverlay.textContent = `${Math.round(zoom)}%`;
    elements.zoomIndicatorOverlay.classList.add('visible');

    clearTimeout(window._zoomIndicatorTimeout);
    window._zoomIndicatorTimeout = setTimeout(() => {
      elements.zoomIndicatorOverlay.classList.remove('visible');
    }, 800);
  }

  /**
   * 비디오 줌 리셋
   */
  function resetVideoZoom() {
    state.videoZoom = 100;
    state.videoPanX = 0;
    state.videoPanY = 0;
    applyVideoZoom();
    showZoomIndicator(100);
  }

  // 비디오 줌 버튼 이벤트
  elements.btnVideoZoomIn?.addEventListener('click', () => {
    setVideoZoom(state.videoZoom + 25);
  });

  elements.btnVideoZoomOut?.addEventListener('click', () => {
    setVideoZoom(state.videoZoom - 25);
  });

  elements.btnVideoZoomReset?.addEventListener('click', () => {
    resetVideoZoom();
  });

  // 비디오 영역 휠 줌
  elements.viewerContainer?.addEventListener('wheel', (e) => {
    // 그리기 모드가 아닐 때만 줌 적용
    if (!state.isDrawMode) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -25 : 25;
      setVideoZoom(state.videoZoom + delta);
    }
  }, { passive: false });

  // 비디오 패닝 (줌이 100% 이상일 때)
  elements.videoWrapper?.addEventListener('mousedown', (e) => {
    if (state.videoZoom > 100 && !state.isDrawMode && e.button === 0) {
      state.isPanningVideo = true;
      state.panStartX = e.clientX;
      state.panStartY = e.clientY;
      state.panInitialX = state.videoPanX;
      state.panInitialY = state.videoPanY;
      elements.videoWrapper.classList.add('panning');
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (state.isPanningVideo) {
      const scale = state.videoZoom / 100;
      const dx = (e.clientX - state.panStartX) / scale;
      const dy = (e.clientY - state.panStartY) / scale;
      state.videoPanX = state.panInitialX + dx;
      state.videoPanY = state.panInitialY + dy;
      applyVideoZoom();
    }
  });

  document.addEventListener('mouseup', () => {
    if (state.isPanningVideo) {
      state.isPanningVideo = false;
      elements.videoWrapper?.classList.remove('panning');
    }
  });

  // ====== 댓글 패널 토글 ======

  elements.commentPanelToggle?.addEventListener('click', () => {
    const isCollapsed = elements.commentPanel?.classList.toggle('collapsed');
    elements.commentPanelToggle?.classList.toggle('collapsed', isCollapsed);
    elements.panelResizer?.classList.toggle('hidden', isCollapsed);
  });

  // ====== 타임라인 줌 버튼 ======

  elements.btnTimelineZoomIn?.addEventListener('click', () => {
    timeline.zoomIn();
  });

  elements.btnTimelineZoomOut?.addEventListener('click', () => {
    timeline.zoomOut();
  });

  elements.btnTimelineZoomReset?.addEventListener('click', () => {
    timeline.fitToView();
  });

  // 패널 리사이저
  setupResizer(elements.panelResizer, 'col', (delta) => {
    const newWidth = elements.commentPanel.offsetWidth - delta;
    if (newWidth >= 260 && newWidth <= 500) {
      elements.commentPanel.style.width = `${newWidth}px`;
    }
  });

  // 뷰어/타임라인 리사이저
  setupResizer(elements.viewerResizer, 'row', (delta) => {
    const newHeight = elements.timelineSection.offsetHeight - delta;
    if (newHeight >= 120 && newHeight <= 400) {
      elements.timelineSection.style.height = `${newHeight}px`;
      // 뷰어 크기가 바뀌므로 캔버스도 동기화
      syncCanvasOverlay();
    }
  });

  // 키보드 단축키
  document.addEventListener('keydown', handleKeydown);

  // ====== 캔버스 오버레이 동기화 ======

  /**
   * 비디오의 실제 렌더링 영역 계산
   * object-fit: contain 사용 시 레터박스/필러박스 영역을 제외한 실제 비디오 영역
   */
  function getVideoRenderArea() {
    const video = elements.videoPlayer;
    const container = elements.videoWrapper;

    if (!video || !container || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    const containerRatio = containerWidth / containerHeight;
    const videoRatio = videoWidth / videoHeight;

    let renderWidth, renderHeight, offsetX, offsetY;

    if (videoRatio > containerRatio) {
      // 비디오가 더 넓음 - 위아래 레터박스
      renderWidth = containerWidth;
      renderHeight = containerWidth / videoRatio;
      offsetX = 0;
      offsetY = (containerHeight - renderHeight) / 2;
    } else {
      // 비디오가 더 높음 - 좌우 필러박스
      renderHeight = containerHeight;
      renderWidth = containerHeight * videoRatio;
      offsetX = (containerWidth - renderWidth) / 2;
      offsetY = 0;
    }

    return {
      width: renderWidth,
      height: renderHeight,
      left: offsetX,
      top: offsetY,
      videoWidth,
      videoHeight
    };
  }

  /**
   * 캔버스 오버레이를 비디오 실제 영역에 맞게 동기화
   */
  function syncCanvasOverlay() {
    const renderArea = getVideoRenderArea();
    const canvas = elements.drawingCanvas;
    const onionCanvas = elements.onionSkinCanvas;

    if (!renderArea || !canvas) {
      return;
    }

    // 그리기 캔버스 위치와 크기를 비디오 실제 렌더 영역에 맞춤
    canvas.style.position = 'absolute';
    canvas.style.left = `${renderArea.left}px`;
    canvas.style.top = `${renderArea.top}px`;
    canvas.style.width = `${renderArea.width}px`;
    canvas.style.height = `${renderArea.height}px`;
    canvas.width = renderArea.videoWidth;
    canvas.height = renderArea.videoHeight;

    // 어니언 스킨 캔버스도 동일하게 동기화
    if (onionCanvas) {
      onionCanvas.style.position = 'absolute';
      onionCanvas.style.left = `${renderArea.left}px`;
      onionCanvas.style.top = `${renderArea.top}px`;
      onionCanvas.style.width = `${renderArea.width}px`;
      onionCanvas.style.height = `${renderArea.height}px`;
      onionCanvas.width = renderArea.videoWidth;
      onionCanvas.height = renderArea.videoHeight;
    }

    // 영상 어니언 스킨 캔버스도 동일하게 동기화 (TODO: 임시 비활성화)
    /*
    if (videoOnionSkinCanvas) {
      videoOnionSkinCanvas.style.position = 'absolute';
      videoOnionSkinCanvas.style.left = `${renderArea.left}px`;
      videoOnionSkinCanvas.style.top = `${renderArea.top}px`;
      videoOnionSkinCanvas.style.width = `${renderArea.width}px`;
      videoOnionSkinCanvas.style.height = `${renderArea.height}px`;
      videoOnionSkinCanvas.width = renderArea.videoWidth;
      videoOnionSkinCanvas.height = renderArea.videoHeight;
    }
    */

    // 드로잉 매니저에도 캔버스 크기 전달
    drawingManager.setCanvasSize(renderArea.videoWidth, renderArea.videoHeight);

    log.debug('캔버스 오버레이 동기화', {
      renderWidth: renderArea.width,
      renderHeight: renderArea.height,
      left: renderArea.left,
      top: renderArea.top
    });
  }

  // 윈도우 리사이즈 시 캔버스 동기화
  window.addEventListener('resize', syncCanvasOverlay);

  // ResizeObserver로 컨테이너 크기 변경 감지
  const resizeObserver = new ResizeObserver(() => {
    syncCanvasOverlay();
  });
  resizeObserver.observe(elements.videoWrapper);

  // ====== 헬퍼 함수 ======

  /**
   * 비디오 파일 로드
   */
  async function loadVideo(filePath) {
    const trace = log.trace('loadVideo');
    try {
      // 파일 정보 가져오기
      const fileInfo = await window.electronAPI.getFileInfo(filePath);

      // ====== 이전 데이터 초기화 ======
      // 댓글 매니저 초기화
      commentManager.clear();
      // 그리기 매니저 초기화
      drawingManager.reset();
      // 타임라인 마커 초기화
      timeline.clearMarkers();
      // 영상 위 마커 UI 초기화
      markerContainer.innerHTML = '';
      // 댓글 모드 해제
      if (state.isCommentMode) {
        state.isCommentMode = false;
        elements.btnAddComment?.classList.remove('active');
      }
      // 코덱 에러 오버레이 숨기기
      codecErrorOverlay?.classList.remove('active');

      // 비디오 플레이어에 로드
      await videoPlayer.load(filePath);

      state.currentFile = filePath;
      elements.fileName.textContent = fileInfo.name;
      elements.filePath.textContent = fileInfo.dir;
      elements.dropZone.classList.add('hidden');

      // 폴더 열기 / 다른 파일 열기 버튼 표시
      elements.btnOpenFolder.style.display = 'flex';
      elements.btnOpenOther.style.display = 'flex';

      // 버전 감지
      const versionMatch = fileInfo.name.match(/_v(\d+)/i);
      if (versionMatch) {
        elements.versionBadge.textContent = `v${versionMatch[1]}`;
        elements.versionBadge.style.display = 'inline-block';
      } else {
        elements.versionBadge.style.display = 'none';
      }

      // 비디오 트랙 업데이트
      elements.videoTrackClip.textContent = `📹 ${fileInfo.name}`;

      // 썸네일 생성 시작
      await generateThumbnails(filePath);

      // .bframe 파일 로드 시도
      const hasExistingData = await reviewDataManager.setVideoFile(filePath);
      if (hasExistingData) {
        showToast(`"${fileInfo.name}" 로드됨 (리뷰 데이터 복원)`, 'success');
      } else {
        showToast(`"${fileInfo.name}" 로드됨`, 'success');
      }

      // 마커 및 그리기 렌더링 업데이트 (항상 실행)
      renderVideoMarkers();
      updateTimelineMarkers();
      updateCommentList();
      // 그리기 레이어 UI 및 캔버스 다시 렌더링
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      drawingManager.renderFrame(videoPlayer.currentFrame);

      trace.end({ filePath, hasExistingData });

    } catch (error) {
      trace.error(error);
      showToast('파일을 로드할 수 없습니다.', 'error');
    }
  }

  /**
   * 썸네일 생성
   */
  async function generateThumbnails(filePath) {
    const loadingOverlay = document.getElementById('videoLoadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const loadingProgress = document.getElementById('loadingProgressFill');

    // 로딩 오버레이 표시
    loadingOverlay?.classList.add('active');
    loadingText.textContent = '썸네일 생성 중...';
    loadingProgress.style.width = '0%';

    try {
      // 썸네일 생성기 초기화 (2단계 생성 방식)
      const thumbnailGenerator = getThumbnailGenerator({
        thumbnailWidth: 160,
        thumbnailHeight: 90,
        quickInterval: 5,   // 1단계: 5초 간격 (빠른 스캔)
        detailInterval: 1,  // 2단계: 1초 간격 (세부)
        quality: 0.6
      });

      // 기존 썸네일 정리
      thumbnailGenerator.clear();

      // 진행률 이벤트 리스너
      const onProgress = (e) => {
        const { progress, phase, current, total } = e.detail;
        loadingProgress.style.width = `${progress * 100}%`;

        if (phase === 1) {
          loadingText.textContent = `썸네일 빠른 생성 중... (${current}/${total})`;
        } else {
          // 2단계는 로딩 오버레이가 이미 해제된 상태
          // 하지만 혹시 모르니 처리
          loadingText.textContent = `썸네일 세부 생성 중... (${current}/${total})`;
        }
      };

      // 1단계 완료 시 (빠른 스캔 완료) - 즉시 로딩 해제
      const onQuickReady = () => {
        thumbnailGenerator.removeEventListener('quickReady', onQuickReady);

        // 타임라인에 썸네일 생성기 연결 (1단계 완료 즉시)
        timeline.setThumbnailGenerator(thumbnailGenerator);

        // 댓글 리스트 업데이트 (썸네일 표시를 위해)
        updateCommentList(document.querySelector('.filter-chip.active')?.dataset.filter || 'all');

        // 로딩 오버레이 숨김
        loadingOverlay?.classList.remove('active');

        log.info('썸네일 1단계 완료 - UI 사용 가능');
        showToast('미리보기 준비 완료! (세부 생성 중...)', 'success');
      };

      // 2단계 완료 시 (모든 세부 썸네일 생성 완료)
      const onComplete = () => {
        thumbnailGenerator.removeEventListener('progress', onProgress);
        thumbnailGenerator.removeEventListener('complete', onComplete);

        log.info('썸네일 2단계 완료 - 모든 세부 생성 완료');
      };

      thumbnailGenerator.addEventListener('progress', onProgress);
      thumbnailGenerator.addEventListener('quickReady', onQuickReady);
      thumbnailGenerator.addEventListener('complete', onComplete);

      // 비디오 소스 경로 (file:// 프로토콜 추가)
      const videoSrc = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

      // 썸네일 생성 시작 (비동기, 완료 대기 안함)
      thumbnailGenerator.generate(videoSrc);

    } catch (error) {
      log.error('썸네일 생성 실패', error);
      showToast('썸네일 생성에 실패했습니다.', 'warning');
      // 실패 시에도 오버레이 숨김
      loadingOverlay?.classList.remove('active');
    }
  }

  // 스크러빙 프리뷰 오버레이 (동적 생성)
  let scrubPreviewOverlay = null;

  /**
   * 스크러빙 프리뷰 표시
   */
  function showScrubPreview(time) {
    const thumbnailGenerator = getThumbnailGenerator();
    if (!thumbnailGenerator?.isReady) return;

    const thumbnailUrl = thumbnailGenerator.getThumbnailUrlAt(time);
    if (!thumbnailUrl) return;

    // 프리뷰 오버레이 생성 (없으면)
    if (!scrubPreviewOverlay) {
      scrubPreviewOverlay = document.createElement('div');
      scrubPreviewOverlay.className = 'scrub-preview-overlay';
      scrubPreviewOverlay.innerHTML = `
        <img class="scrub-preview-image" src="" alt="Preview">
        <div class="scrub-preview-time"></div>
      `;
      elements.videoWrapper.appendChild(scrubPreviewOverlay);
    }

    // 이미지 및 시간 업데이트
    const img = scrubPreviewOverlay.querySelector('.scrub-preview-image');
    const timeDisplay = scrubPreviewOverlay.querySelector('.scrub-preview-time');

    img.src = thumbnailUrl;
    timeDisplay.textContent = formatTimecode(time, videoPlayer.fps);

    // 표시
    scrubPreviewOverlay.classList.add('active');
  }

  /**
   * 스크러빙 프리뷰 숨김
   */
  function hideScrubPreview() {
    scrubPreviewOverlay?.classList.remove('active');
  }

  /**
   * 시간을 타임코드로 변환
   */
  function formatTimecode(seconds, fps = 24) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * fps);

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  /**
   * 타임코드 디스플레이 업데이트
   */
  function updateTimecodeDisplay() {
    elements.timecodeCurrent.textContent = videoPlayer.getCurrentTimecode();
    elements.timecodeTotal.textContent = videoPlayer.getDurationTimecode();
    elements.frameIndicator.textContent =
      `${videoPlayer.fps}fps · Frame ${videoPlayer.currentFrame} / ${videoPlayer.totalFrames}`;
  }

  /**
   * 그리기 모드 토글
   */
  function toggleDrawMode() {
    state.isDrawMode = !state.isDrawMode;
    elements.btnDrawMode.classList.toggle('active', state.isDrawMode);
    elements.drawingTools.classList.toggle('visible', state.isDrawMode);
    elements.drawingCanvas.classList.toggle('active', state.isDrawMode);
    log.debug('그리기 모드 변경', { isDrawMode: state.isDrawMode });
  }

  /**
   * 댓글 모드 토글
   */
  function toggleCommentMode() {
    // 그리기 모드가 켜져있으면 끄기
    if (state.isDrawMode) {
      toggleDrawMode();
    }
    commentManager.toggleCommentMode();
  }

  /**
   * 전체화면 모드 토글
   */
  function toggleFullscreen() {
    state.isFullscreen = !state.isFullscreen;
    document.body.classList.toggle('app-fullscreen', state.isFullscreen);

    if (state.isFullscreen) {
      showToast('전체화면 모드 (C: 댓글 추가, F 또는 ESC: 해제)', 'info');
    }

    log.debug('전체화면 모드 변경', { isFullscreen: state.isFullscreen });
  }

  /**
   * Pending 마커 렌더링 (클릭 후 텍스트 입력 대기 상태)
   */
  function renderPendingMarker(marker) {
    removePendingMarkerUI();

    // 마커 동그라미 생성
    const markerEl = document.createElement('div');
    markerEl.className = 'comment-marker pending';
    markerEl.style.cssText = `
      position: absolute;
      left: ${marker.x * 100}%;
      top: ${marker.y * 100}%;
      transform: translate(-50%, -50%);
      pointer-events: auto;
    `;
    markerEl.dataset.markerId = marker.id;

    // 인라인 입력창 생성 (textarea로 변경 - 여러 줄 지원)
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'comment-marker-input-wrapper';
    inputWrapper.innerHTML = `
      <textarea class="comment-marker-input" placeholder="댓글 입력..." rows="1"></textarea>
      <div class="comment-marker-input-hint">Enter 확인 · Shift+Enter 줄바꿈 · Esc 취소</div>
    `;

    markerEl.appendChild(inputWrapper);
    markerContainer.appendChild(markerEl);

    // 입력창 포커스
    const textarea = inputWrapper.querySelector('textarea');
    setTimeout(() => textarea?.focus(), 50);

    // 자동 높이 조절 함수
    const autoResize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    };

    // 입력 시 자동 크기 조절
    textarea?.addEventListener('input', autoResize);

    // Enter로 확정, Shift+Enter로 줄바꿈
    textarea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = textarea.value.trim();
        commentManager.confirmMarker(text);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commentManager.setCommentMode(false);
      }
    });

    // pointerdown으로 클릭 대상 감지 (blur보다 먼저 발생)
    let clickedInsideMarker = false;

    const handlePointerDown = (e) => {
      clickedInsideMarker = markerEl.contains(e.target);
    };

    document.addEventListener('pointerdown', handlePointerDown);

    // 포커스 잃으면 취소 (마커 외부 클릭 시에만)
    textarea?.addEventListener('blur', () => {
      setTimeout(() => {
        if (commentManager.pendingMarker && !clickedInsideMarker) {
          commentManager.setCommentMode(false);
        }
        clickedInsideMarker = false; // 리셋
      }, 100);
    });

    // 마커 제거 시 이벤트 리스너 정리
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const removed of mutation.removedNodes) {
          if (removed === markerEl || removed.contains?.(markerEl)) {
            document.removeEventListener('pointerdown', handlePointerDown);
            observer.disconnect();
            return;
          }
        }
      }
    });
    observer.observe(markerContainer, { childList: true, subtree: true });
  }

  /**
   * Pending 마커 UI 제거
   */
  function removePendingMarkerUI() {
    const pending = markerContainer.querySelector('.comment-marker.pending');
    if (pending) {
      pending.remove();
    }
  }

  /**
   * 영상 위 마커들 렌더링
   */
  function renderVideoMarkers() {
    // 기존 확정된 마커들 제거
    markerContainer.querySelectorAll('.comment-marker:not(.pending)').forEach(el => el.remove());

    // 모든 마커 렌더링
    const allMarkers = commentManager.getAllMarkers();
    allMarkers.forEach(marker => {
      renderSingleMarker(marker);
    });

    updateVideoMarkersVisibility();
  }

  /**
   * 단일 마커 렌더링
   */
  function renderSingleMarker(marker) {
    const markerEl = document.createElement('div');
    markerEl.className = `comment-marker${marker.resolved ? ' resolved' : ''}`;
    markerEl.dataset.markerId = marker.id;
    markerEl.style.cssText = `
      position: absolute;
      left: ${marker.x * 100}%;
      top: ${marker.y * 100}%;
      transform: translate(-50%, -50%);
      pointer-events: auto;
    `;

    // 말풍선 (툴팁)
    const tooltip = document.createElement('div');
    tooltip.className = 'comment-marker-tooltip';
    const authorClass = getAuthorColorClass(marker.author);
    tooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-timecode">${marker.startTimecode}</span>
        <span class="tooltip-author ${authorClass}">${marker.author}</span>
      </div>
      <div class="tooltip-text">${escapeHtml(marker.text)}</div>
      <div class="tooltip-actions">
        <button class="tooltip-btn resolve" title="${marker.resolved ? '미해결로 변경' : '해결'}">
          ${marker.resolved ? '↩️' : '✓'}
        </button>
        <button class="tooltip-btn delete" title="삭제">🗑️</button>
      </div>
    `;

    markerEl.appendChild(tooltip);

    // 답글 배지 (스레드 개수 표시)
    const replyCount = marker.replies?.length || 0;
    if (replyCount > 0) {
      const replyBadge = document.createElement('div');
      replyBadge.className = 'marker-replies-badge';
      replyBadge.textContent = `💬 ${replyCount}`;
      replyBadge.title = `답글 ${replyCount}개 보기`;
      replyBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        window.scrollToCommentAndExpandThread(marker.id);
      });
      markerEl.appendChild(replyBadge);
    }

    // 호버 이벤트 - 말풍선 표시
    markerEl.addEventListener('mouseenter', () => {
      if (!marker.pinned) {
        tooltip.classList.add('visible');
      }
    });

    markerEl.addEventListener('mouseleave', () => {
      if (!marker.pinned) {
        tooltip.classList.remove('visible');
      }
    });

    // 클릭 - 고정 토글
    markerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.tooltip-btn')) return;
      commentManager.toggleMarkerPinned(marker.id);
    });

    // 해결 버튼
    tooltip.querySelector('.tooltip-btn.resolve')?.addEventListener('click', (e) => {
      e.stopPropagation();
      commentManager.toggleMarkerResolved(marker.id);
    });

    // 삭제 버튼
    tooltip.querySelector('.tooltip-btn.delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('댓글을 삭제하시겠습니까?')) {
        const markerData = marker.toJSON();
        commentManager.deleteMarker(marker.id);
        // Undo 스택에 추가
        pushUndo({
          type: 'DELETE_COMMENT',
          data: markerData,
          undo: () => {
            commentManager.restoreMarker(markerData);
            updateCommentList();
            updateTimelineMarkers();
            updateVideoMarkers();
          },
          redo: () => {
            commentManager.deleteMarker(markerData.id);
            updateCommentList();
            updateTimelineMarkers();
            updateVideoMarkers();
          }
        });
        showToast('댓글이 삭제되었습니다.', 'info');
      }
    });

    // 마커 객체에 DOM 요소 참조 저장
    marker.element = markerEl;
    marker.tooltipElement = tooltip;

    markerContainer.appendChild(markerEl);
  }

  /**
   * 마커 가시성 업데이트 (현재 프레임에 따라)
   */
  function updateVideoMarkersVisibility() {
    const currentFrame = videoPlayer.currentFrame;

    markerContainer.querySelectorAll('.comment-marker:not(.pending)').forEach(el => {
      const markerId = el.dataset.markerId;
      const marker = commentManager.getMarker(markerId);

      if (marker && marker.isVisibleAtFrame(currentFrame)) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
  }

  /**
   * 마커 툴팁 상태 업데이트 (고정 상태)
   */
  function updateMarkerTooltipState(marker) {
    if (marker.tooltipElement) {
      if (marker.pinned) {
        marker.tooltipElement.classList.add('visible', 'pinned');
      } else {
        marker.tooltipElement.classList.remove('pinned');
        // 마우스가 마커 위에 없으면 숨기기
        if (!marker.element?.matches(':hover')) {
          marker.tooltipElement.classList.remove('visible');
        }
      }
    }
  }

  /**
   * 타임라인 마커 업데이트
   */
  function updateTimelineMarkers() {
    const ranges = commentManager.getMarkerRanges();
    const fps = videoPlayer.fps || 24;

    // 기존 마커 제거
    timeline.clearCommentMarkers();

    // 새 마커 추가 (각 마커의 시작 프레임에)
    const frameSet = new Set();
    ranges.forEach(range => {
      if (!frameSet.has(range.startFrame)) {
        frameSet.add(range.startFrame);
        const time = range.startFrame / fps;
        timeline.addCommentMarker(time, range.resolved, range.startFrame);
      }
    });
  }

  /**
   * 댓글 목록 업데이트 (사이드 패널)
   */

  /**
   * 이름에 따른 색상 클래스 반환
   */
  function getAuthorColorClass(author) {
    if (!author) return '';
    const color = userSettings.getColorForName(author);
    if (color) {
      return 'author-colored';
    }
    return '';
  }

  /**
   * 이름에 따른 인라인 스타일 반환
   */
  function getAuthorColorStyle(author) {
    if (!author) return '';
    const color = userSettings.getColorForName(author);
    if (color) {
      return `style="color: ${color}; font-weight: bold;"`;
    }
    return '';
  }

  // 댓글 목록 업데이트 디바운싱
  let commentListUpdateTimeout = null;
  let pendingCommentListFilter = 'all';

  function updateCommentList(filter = 'all') {
    pendingCommentListFilter = filter;

    // 디바운싱: 연속 호출 시 마지막 호출만 실행 (50ms)
    if (commentListUpdateTimeout) {
      cancelAnimationFrame(commentListUpdateTimeout);
    }
    commentListUpdateTimeout = requestAnimationFrame(() => {
      updateCommentListImmediate(pendingCommentListFilter);
    });
  }

  function updateCommentListImmediate(filter = 'all') {
    const container = elements.commentsList;
    if (!container) return;

    let markers = commentManager.getAllMarkers();

    // 필터 적용
    if (filter === 'unresolved') {
      markers = markers.filter(m => !m.resolved);
    } else if (filter === 'resolved') {
      markers = markers.filter(m => m.resolved);
    }

    // 개수 업데이트
    const allMarkers = commentManager.getAllMarkers();
    const unresolvedCount = allMarkers.filter(m => !m.resolved).length;
    if (elements.commentCount) {
      elements.commentCount.textContent = allMarkers.length > 0
        ? `${unresolvedCount > 0 ? unresolvedCount + ' 미해결 / ' : ''}${allMarkers.length}개`
        : '0';
    }

    if (markers.length === 0) {
      container.innerHTML = `
        <div class="comment-empty">
          <span style="font-size: 32px; margin-bottom: 8px;">💬</span>
          <p>댓글이 없습니다</p>
          <p style="font-size: 11px; color: var(--text-muted);">C키를 눌러 영상 위에 댓글을 추가하세요</p>
        </div>
      `;
      return;
    }

    const userSettings = getUserSettings();
    const showThumbnails = userSettings.getShowCommentThumbnails();
    const thumbnailScale = userSettings.getCommentThumbnailScale();
    const thumbnailGenerator = getThumbnailGenerator();

    container.innerHTML = markers.map(marker => {
      const authorClass = getAuthorColorClass(marker.author);
      const authorStyle = getAuthorColorStyle(marker.author);
      const replyCount = marker.replies?.length || 0;
      const avatarImage = userSettings.getAvatarForName(marker.author);
      const repliesHtml = (marker.replies || []).map(reply => `
        <div class="comment-reply">
          <div class="comment-reply-header">
            <span class="comment-reply-author ${getAuthorColorClass(reply.author)}" ${getAuthorColorStyle(reply.author)}>${reply.author}</span>
            <span class="comment-reply-time">${formatRelativeTime(reply.createdAt)}</span>
          </div>
          <p class="comment-reply-text">${escapeHtml(reply.text)}</p>
        </div>
      `).join('');

      // 썸네일 URL 가져오기
      const markerTime = marker.startFrame / videoPlayer.fps;
      const thumbnailUrl = showThumbnails && thumbnailGenerator?.isReady
        ? thumbnailGenerator.getThumbnailUrlAt(markerTime)
        : null;

      const thumbnailHtml = thumbnailUrl ? `
        <div class="comment-thumbnail-wrapper" style="max-width: ${thumbnailScale}%;">
          <img class="comment-thumbnail" src="${thumbnailUrl}" alt="Frame ${marker.startFrame}">
          <div class="comment-thumbnail-overlay">
            <div class="thumbnail-play-icon">
              <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
            <span class="thumbnail-timecode">${marker.startTimecode}</span>
          </div>
        </div>
      ` : '';

      return `
      <div class="comment-item ${marker.resolved ? 'resolved' : ''} ${avatarImage ? 'has-avatar' : ''} ${thumbnailUrl ? 'has-thumbnail' : ''}" data-marker-id="${marker.id}" data-start-frame="${marker.startFrame}">
        ${avatarImage ? `<div class="comment-avatar-bg" style="background-image: url('${avatarImage}')"></div>` : ''}
        ${thumbnailHtml}
        <div class="comment-header">
          <span class="comment-timecode">${marker.startTimecode}</span>
        </div>
        <div class="comment-content">
          <p class="comment-text">${escapeHtml(marker.text)}</p>
        </div>
        <div class="comment-edit-form" style="display: none;">
          <textarea class="comment-edit-textarea" rows="3">${escapeHtml(marker.text)}</textarea>
          <div class="comment-edit-actions">
            <button class="comment-edit-save">저장</button>
            <button class="comment-edit-cancel">취소</button>
          </div>
        </div>
        <div class="comment-actions">
          <span class="comment-author-inline ${authorClass}" ${authorStyle}>${marker.author}</span>
          <span class="comment-time-inline">${formatRelativeTime(marker.createdAt)}</span>
          <button class="comment-action-btn edit-btn" title="수정">
            수정
          </button>
          <button class="comment-action-btn reply-btn" title="답글">
            답글
          </button>
          <button class="comment-action-btn resolve-btn" title="${marker.resolved ? '미해결로 변경' : '해결됨으로 변경'}">
            ${marker.resolved ? `해결됨 <span class="resolved-time">(${marker.resolvedAt ? formatRelativeTime(marker.resolvedAt) : ''})</span>` : '해결'}
          </button>
          <button class="comment-action-btn delete-btn" title="삭제">
            삭제
          </button>
        </div>
        ${replyCount > 0 ? `
        <button class="comment-thread-toggle" data-marker-id="${marker.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          답글 ${replyCount}개
        </button>
        ` : ''}
        <div class="comment-replies" data-marker-id="${marker.id}">
          ${repliesHtml}
          <div class="comment-reply-input-wrapper">
            <textarea class="comment-reply-input" placeholder="답글 입력..." rows="1"></textarea>
            <button class="comment-reply-submit">전송</button>
          </div>
        </div>
      </div>
    `;
    }).join('');

    // 이벤트 바인딩
    container.querySelectorAll('.comment-item').forEach(item => {
      // 클릭으로 해당 프레임 이동
      item.addEventListener('click', (e) => {
        if (e.target.closest('.comment-action-btn')) return;
        const frame = parseInt(item.dataset.startFrame);
        const time = frame / videoPlayer.fps;
        videoPlayer.seek(time);
        container.querySelectorAll('.comment-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });

      // 더블클릭으로 스레드 팝업 열기
      item.addEventListener('dblclick', (e) => {
        if (e.target.closest('.comment-action-btn')) return;
        e.stopPropagation();
        const markerId = item.dataset.markerId;
        openThreadPopup(markerId);
      });

      // 해결 버튼
      item.querySelector('.resolve-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        commentManager.toggleMarkerResolved(item.dataset.markerId);
      });

      // 삭제 버튼
      item.querySelector('.delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('댓글을 삭제하시겠습니까?')) {
          const markerId = item.dataset.markerId;
          const marker = commentManager.getMarker(markerId);
          if (marker) {
            const markerData = marker.toJSON();
            commentManager.deleteMarker(markerId);
            // Undo 스택에 추가
            pushUndo({
              type: 'DELETE_COMMENT',
              data: markerData,
              undo: () => {
                commentManager.restoreMarker(markerData);
                updateCommentList();
                updateTimelineMarkers();
                updateVideoMarkers();
              },
              redo: () => {
                commentManager.deleteMarker(markerData.id);
                updateCommentList();
                updateTimelineMarkers();
                updateVideoMarkers();
              }
            });
            showToast('댓글이 삭제되었습니다.', 'info');
          }
        }
      });

      // 수정 버튼
      const editBtn = item.querySelector('.edit-btn');
      const contentEl = item.querySelector('.comment-content');
      const editFormEl = item.querySelector('.comment-edit-form');
      const editTextarea = item.querySelector('.comment-edit-textarea');
      const actionsEl = item.querySelector('.comment-actions');

      editBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        // 수정 모드 진입
        contentEl.style.display = 'none';
        actionsEl.style.display = 'none';
        editFormEl.style.display = 'block';
        editTextarea.focus();
        editTextarea.select();
      });

      // 수정 저장
      item.querySelector('.comment-edit-save')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const newText = editTextarea.value.trim();
        if (newText) {
          const markerId = item.dataset.markerId;
          const marker = commentManager.getMarker(markerId);
          if (marker) {
            const oldText = marker.text;
            commentManager.updateMarker(markerId, { text: newText });
            // Undo 스택에 추가
            pushUndo({
              type: 'EDIT_COMMENT',
              data: { markerId, oldText, newText },
              undo: () => {
                commentManager.updateMarker(markerId, { text: oldText });
                updateCommentList();
              },
              redo: () => {
                commentManager.updateMarker(markerId, { text: newText });
                updateCommentList();
              }
            });
            showToast('댓글이 수정되었습니다.', 'success');
          }
        }
      });

      // 수정 취소
      item.querySelector('.comment-edit-cancel')?.addEventListener('click', (e) => {
        e.stopPropagation();
        // 원래 상태로 복원
        contentEl.style.display = 'block';
        actionsEl.style.display = 'flex';
        editFormEl.style.display = 'none';
        // 원래 텍스트로 복원
        const marker = commentManager.getMarker(item.dataset.markerId);
        if (marker) {
          editTextarea.value = marker.text;
        }
      });

      // Textarea에서 Escape로 취소
      editTextarea?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          item.querySelector('.comment-edit-cancel').click();
        } else if (e.key === 'Enter' && e.ctrlKey) {
          // Ctrl+Enter로 저장
          e.stopPropagation();
          e.preventDefault();
          item.querySelector('.comment-edit-save').click();
        }
      });

      // ====== 스레드(답글) 관련 이벤트 ======
      const threadToggle = item.querySelector('.comment-thread-toggle');
      const repliesContainer = item.querySelector('.comment-replies');
      const replyBtn = item.querySelector('.reply-btn');
      const replyInput = item.querySelector('.comment-reply-input');
      const replySubmit = item.querySelector('.comment-reply-submit');

      // 스레드 토글 버튼
      threadToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        threadToggle.classList.toggle('expanded');
        repliesContainer.classList.toggle('expanded');
      });

      // 답글 버튼 - 스레드 열고 입력창 포커스
      replyBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (threadToggle) {
          threadToggle.classList.add('expanded');
        }
        repliesContainer.classList.add('expanded');
        replyInput?.focus();
      });

      // 답글 제출
      replySubmit?.addEventListener('click', (e) => {
        e.stopPropagation();
        const replyText = replyInput.value.trim();
        if (replyText) {
          commentManager.addReplyToMarker(item.dataset.markerId, replyText);
          replyInput.value = '';
          showToast('답글이 추가되었습니다.', 'success');
        }
      });

      // Enter로 답글 제출
      replyInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          replySubmit?.click();
        }
      });
    });
  }

  /**
   * 특정 댓글로 스크롤하고 스레드 펼치기
   */
  function scrollToCommentAndExpandThread(markerId) {
    const container = elements.commentsList;
    if (!container) return;

    const commentItem = container.querySelector(`.comment-item[data-marker-id="${markerId}"]`);
    if (commentItem) {
      // 댓글 패널 열기
      const commentPanel = document.getElementById('commentPanel');
      commentPanel?.classList.add('open');

      // 스크롤
      commentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // 선택 표시
      container.querySelectorAll('.comment-item').forEach(i => i.classList.remove('selected'));
      commentItem.classList.add('selected');

      // 스레드 펼치기
      const threadToggle = commentItem.querySelector('.comment-thread-toggle');
      const repliesContainer = commentItem.querySelector('.comment-replies');
      if (threadToggle) {
        threadToggle.classList.add('expanded');
      }
      repliesContainer?.classList.add('expanded');
    }
  }

  // 전역으로 노출 (마커에서 호출용)
  window.scrollToCommentAndExpandThread = scrollToCommentAndExpandThread;

  /**
   * 상대 시간 포맷
   */
  function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return '방금';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffHour < 24) return `${diffHour}시간 전`;
    if (diffDay < 7) return `${diffDay}일 전`;

    return new Date(date).toLocaleDateString('ko-KR');
  }

  /**
   * HTML 이스케이프
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 비디오 파일 확인
   */
  function isVideoFile(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext);
  }

  /**
   * 토스트 메시지 표시
   * @param {string} message - 표시할 메시지
   * @param {string} type - 타입 ('info', 'success', 'warning', 'error')
   * @param {number} duration - 표시 시간 (ms)
   * @param {boolean} force - 설정과 무관하게 강제 표시
   */
  function showToast(message, type = 'info', duration = 3000, force = false) {
    // 토스트 알림이 비활성화된 경우 (단, error와 force는 항상 표시)
    if (!force && type !== 'error' && !userSettings.getShowToastNotifications()) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * 리사이저 설정 (마우스 커서 추적 개선)
   */
  function setupResizer(resizer, direction, onResize) {
    let isResizing = false;
    let startPos = 0;
    let rafId = null;
    let pendingDelta = 0;

    const applyResize = () => {
      if (pendingDelta !== 0) {
        onResize(pendingDelta);
        pendingDelta = 0;
      }
      rafId = null;
    };

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      startPos = direction === 'col' ? e.clientX : e.clientY;
      resizer.classList.add('dragging');
      document.body.classList.add('resizing');
      document.body.style.cursor = direction === 'col' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const currentPos = direction === 'col' ? e.clientX : e.clientY;
      pendingDelta = currentPos - startPos;
      startPos = currentPos;

      // requestAnimationFrame으로 부드럽게 리사이징
      if (!rafId) {
        rafId = requestAnimationFrame(applyResize);
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('dragging');
        document.body.classList.remove('resizing');
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      }
    });
  }

  /**
   * 키보드 단축키 처리
   */
  function handleKeydown(e) {
    // 입력 필드에서는 단축키 무시
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    // contenteditable 요소에서는 단축키 무시 (스레드 에디터 등)
    if (e.target.isContentEditable) return;

    // 스레드 팝업이 열려있으면 단축키 무시
    const threadOverlay = document.getElementById('threadOverlay');
    if (threadOverlay?.classList.contains('open')) return;

    const shortcutSet = userSettings.getShortcutSet();

    // ====== 공통 단축키 (모든 세트에서 동일) ======
    switch (e.code) {
    case 'Space':
      e.preventDefault();
      videoPlayer.togglePlay();
      return;

    case 'Home':
      e.preventDefault();
      videoPlayer.seekToStart();
      return;

    case 'End':
      e.preventDefault();
      videoPlayer.seekToEnd();
      return;

    case 'KeyC':
      if (!e.ctrlKey) {
        e.preventDefault();
        toggleCommentMode();
      }
      return;

    case 'KeyF':
      // F: 전체화면 토글
      if (!e.ctrlKey) {
        e.preventDefault();
        toggleFullscreen();
      }
      return;

    case 'Escape':
      // ESC: 전체화면 해제 (전체화면일 때)
      if (state.isFullscreen) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      break; // 다른 ESC 핸들러로 전달

    case 'KeyI':
      // 시작점 설정
      e.preventDefault();
      btnSetInPoint.click();
      return;

    case 'KeyO':
      // 종료점 설정
      e.preventDefault();
      btnSetOutPoint.click();
      return;

    case 'KeyL':
      // 구간 반복 토글
      e.preventDefault();
      btnLoopToggle.click();
      return;

    case 'F6':
      // 키프레임 복제 추가 (이전 내용 복사)
      e.preventDefault();
      if (state.isDrawMode) {
        drawingManager.addKeyframeWithContent();
        showToast('키프레임 추가됨', 'success');
      }
      return;

    case 'F7':
      // 빈 키프레임 추가
      e.preventDefault();
      if (state.isDrawMode) {
        drawingManager.addBlankKeyframe();
        showToast('빈 키프레임 추가됨', 'success');
      }
      return;

    case 'Delete':
    case 'Backspace':
      // 키프레임 삭제 (그리기 모드에서만)
      if (state.isDrawMode && !e.ctrlKey) {
        e.preventDefault();
        drawingManager.removeKeyframe();
      }
      return;

    case 'Slash':
      if (e.shiftKey) { // ?
        e.preventDefault();
        elements.shortcutsToggle.click();
      }
      return;

    case 'Backslash':
      e.preventDefault();
      timeline.fitToView();
      return;

    case 'KeyZ':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+Z: Redo
          if (globalRedo()) {
            showToast('다시 실행됨', 'info');
          }
        } else {
          // Ctrl+Z: Undo
          if (globalUndo()) {
            showToast('실행 취소됨', 'info');
          }
        }
      }
      return;

    case 'KeyY':
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Y: Redo (alternative)
        e.preventDefault();
        if (globalRedo()) {
          showToast('다시 실행됨', 'info');
        }
      }
      return;

    case 'Equal':
    case 'NumpadAdd':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        timeline.zoomIn();
      }
      return;

    case 'Minus':
    case 'NumpadSubtract':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        timeline.zoomOut();
      }
      return;
    }

    // ====== Set 1: 기존 단축키 (화살표 기반) ======
    if (shortcutSet === 'set1') {
      switch (e.code) {
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) {
          videoPlayer.rewind(1); // 1초 뒤로
        } else {
          videoPlayer.prevFrame();
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) {
          videoPlayer.forward(1); // 1초 앞으로
        } else {
          videoPlayer.nextFrame();
        }
        break;

      case 'KeyD':
        e.preventDefault();
        toggleDrawMode();
        break;
      }
    }

    // ====== Set 2: 새 단축키 (A/D 기반, 애니메이션 작업용) ======
    if (shortcutSet === 'set2') {
      switch (e.code) {
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) {
          videoPlayer.rewind(1);
        } else {
          videoPlayer.prevFrame();
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) {
          videoPlayer.forward(1);
        } else {
          videoPlayer.nextFrame();
        }
        break;

      case 'KeyA':
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+A: 1프레임 이전
          videoPlayer.prevFrame();
        } else {
          // A: 이전 키프레임으로 이동
          const prevKf = drawingManager.getPrevKeyframeFrame();
          if (prevKf !== null) {
            videoPlayer.seekToFrame(prevKf);
          }
        }
        break;

      case 'KeyD':
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+D: 1프레임 다음
          videoPlayer.nextFrame();
        } else {
          // D: 다음 키프레임으로 이동
          const nextKf = drawingManager.getNextKeyframeFrame();
          if (nextKf !== null) {
            videoPlayer.seekToFrame(nextKf);
          }
        }
        break;

      case 'Digit1':
        // 1: 어니언 스킨 토글 (UI 버튼과 동기화)
        e.preventDefault();
        toggleOnionSkinWithUI();
        break;

      case 'Digit2':
        // 2: 빈 키프레임 삽입
        e.preventDefault();
        drawingManager.addBlankKeyframe();
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        break;

      case 'Digit3':
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+3: 현재 키프레임 삭제
          drawingManager.removeKeyframe();
          showToast('키프레임이 삭제되었습니다.', 'info');
        } else {
          // 3: 프레임 삽입 (홀드 추가)
          drawingManager.insertFrame();
        }
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        break;

      case 'Digit4':
        // 4: 프레임 삭제
        e.preventDefault();
        drawingManager.deleteFrame();
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        break;

      case 'KeyB':
        // B: 브러시 모드 (드로잉 모드 켜기)
        e.preventDefault();
        if (!state.isDrawMode) {
          toggleDrawMode();
        }
        break;

      case 'KeyV':
        // V: 선택 모드 (드로잉 모드 끄기)
        e.preventDefault();
        if (state.isDrawMode) {
          toggleDrawMode();
        }
        break;
      }
    }
  }

  // 초기화 완료
  // ====== 외부에서 파일 열기 처리 ======

  /**
   * 외부에서 전달된 파일 처리 (.bframe 또는 영상 파일)
   */
  async function handleExternalFile(filePath) {
    log.info('외부 파일 열기', { filePath });

    if (filePath.endsWith('.bframe')) {
      // .bframe 파일인 경우: 내부의 videoPath를 읽어서 영상 로드
      try {
        const bframeData = await window.electronAPI.loadReview(filePath);
        if (bframeData && bframeData.videoPath) {
          // 영상 파일이 같은 폴더에 있는지 확인 (상대 경로 처리)
          let videoPath = bframeData.videoPath;

          // 상대 경로인 경우 .bframe 파일 기준으로 절대 경로 생성
          if (!videoPath.includes(':') && !videoPath.startsWith('/')) {
            const bframeDir = filePath.substring(0, filePath.lastIndexOf(filePath.includes('/') ? '/' : '\\'));
            videoPath = bframeDir + (filePath.includes('/') ? '/' : '\\') + videoPath;
          }

          await loadVideo(videoPath);
          showToast('.bframe 파일에서 영상 로드됨', 'success');
        } else {
          showToast('.bframe 파일에 영상 경로가 없습니다', 'warn');
        }
      } catch (error) {
        log.error('.bframe 파일 처리 실패', error);
        showToast('.bframe 파일을 열 수 없습니다', 'error');
      }
    } else if (filePath.startsWith('baeframe://')) {
      // 프로토콜 링크: baeframe://G:/경로/파일.bframe 또는 baeframe://G:/경로/영상.mp4
      const actualPath = filePath.replace('baeframe://', '');
      log.info('프로토콜 링크에서 경로 추출', { actualPath });

      // 실제 경로로 다시 처리 (재귀)
      await handleExternalFile(actualPath);
    } else {
      // 일반 영상 파일
      await loadVideo(filePath);
    }
  }

  // 프로토콜/파일 열기 이벤트 리스너
  window.electronAPI.onOpenFromProtocol((arg) => {
    log.info('프로토콜/파일 열기 이벤트 수신', { arg });
    handleExternalFile(arg);
  });

  // ====== 사용자 이름 초기화 ======
  let userName = await userSettings.initialize();
  log.info('사용자 이름 감지됨', { userName, source: userSettings.getUserSource() });

  // 사용자 이름 업데이트 함수
  function updateUserName(name) {
    userName = name;
    const userNameDisplay = document.getElementById('userNameDisplay');
    if (userNameDisplay) {
      userNameDisplay.textContent = name;
      userNameDisplay.title = `출처: ${userSettings.getUserSource()}`;
    }
    commentManager.setAuthor(name);
  }

  // 사용자 이름을 헤더에 표시 (옵션)
  updateUserName(userName);

  // ====== 사용자 설정 모달 ======
  const userSettingsModal = document.getElementById('userSettingsModal');
  const userNameInput = document.getElementById('userNameInput');
  // btnCommentSettings는 이미 위에서 선언됨 (댓글 설정 드롭다운)
  const closeUserSettings = document.getElementById('closeUserSettings');
  const cancelUserSettings = document.getElementById('cancelUserSettings');
  const saveUserSettings = document.getElementById('saveUserSettings');

  // 필수 입력 모드 (최초 설정 시 닫기 방지)
  let isRequiredNameInput = false;

  // 모달 열기
  function openUserSettingsModal(required = false) {
    isRequiredNameInput = required;
    userNameInput.value = required ? '' : userSettings.getUserName();
    userSettingsModal.classList.add('active');

    // 필수 모드일 때 닫기 버튼 숨기기
    if (closeUserSettings) closeUserSettings.style.display = required ? 'none' : '';
    if (cancelUserSettings) cancelUserSettings.style.display = required ? 'none' : '';

    userNameInput.focus();
    if (!required) userNameInput.select();
  }

  // 모달 닫기 (필수 모드가 아닐 때만)
  function closeUserSettingsModal() {
    if (isRequiredNameInput) {
      // 필수 모드에서는 이름을 입력해야만 닫을 수 있음
      showToast('이름을 입력해주세요.', 'warning');
      userNameInput.focus();
      return;
    }
    userSettingsModal.classList.remove('active');
  }

  // 저장
  function saveUserName() {
    const newName = userNameInput.value.trim();
    if (newName) {
      userSettings.setUserName(newName);
      updateUserName(newName);
      showToast(`이름이 "${newName}"(으)로 변경되었습니다.`, 'success');
      isRequiredNameInput = false; // 저장 성공 시 필수 모드 해제
      userSettingsModal.classList.remove('active');
      // 닫기 버튼 복원
      if (closeUserSettings) closeUserSettings.style.display = '';
      if (cancelUserSettings) cancelUserSettings.style.display = '';
    } else {
      showToast('이름을 입력해주세요.', 'warning');
      userNameInput.focus();
    }
  }

  // 설정 버튼 클릭
  // 사용자 설정 모달은 드롭다운 내 별도 버튼으로 열기 (TODO)
  // btnCommentSettings는 이제 드롭다운 토글용으로 사용됨

  // 닫기 버튼
  closeUserSettings?.addEventListener('click', closeUserSettingsModal);
  cancelUserSettings?.addEventListener('click', closeUserSettingsModal);

  // 저장 버튼
  saveUserSettings?.addEventListener('click', saveUserName);

  // Enter 키로 저장, Escape는 필수 모드가 아닐 때만 닫기
  userNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveUserName();
    } else if (e.key === 'Escape' && !isRequiredNameInput) {
      closeUserSettingsModal();
    }
  });

  // 오버레이 클릭으로 닫기 비활성화 - 명시적으로 닫기/취소 버튼만 사용
  // (이름 입력 중 실수로 외부 클릭 시 닫히는 문제 방지)

  // 최초 한 번만 이름 설정 요청 (이미 설정한 적이 있으면 표시하지 않음)
  if (!userSettings.hasSetNameOnce()) {
    // 약간의 딜레이 후 모달 열기 (필수 모드)
    setTimeout(() => {
      openUserSettingsModal(true); // required = true
      showToast('댓글에 표시될 이름을 설정해주세요.', 'info');
    }, 500);
  }

  // ====== 크레딧 모달 ======
  const creditsOverlay = document.getElementById('creditsOverlay');
  const creditsClose = document.getElementById('creditsClose');
  const creditsPlexus = document.getElementById('creditsPlexus');
  const creditsVersion = document.getElementById('creditsVersion');
  const logoIcon = document.querySelector('.logo-icon');

  let plexusEffect = null;

  async function openCreditsModal() {
    // 버전 정보 가져오기
    try {
      const version = await window.electronAPI.getVersion();
      creditsVersion.textContent = `v${version}`;
    } catch (e) {
      creditsVersion.textContent = 'v1.0.0';
    }

    // 플렉서스 효과 시작
    if (!plexusEffect) {
      plexusEffect = new PlexusEffect(creditsPlexus, {
        particleCount: 70,
        particleRadius: 2.5,
        lineDistance: 160,
        speed: 0.35,
        baseOpacity: 0.95,
        lineOpacity: 0.5,
        fillOpacity: 0.12,
        lineWidth: 1.5,
        hueSpeed: 0.15,
        hueRange: 55
      });
    }
    plexusEffect.start();

    // 모달 열기
    creditsOverlay.classList.add('active');
  }

  function closeCreditsModal() {
    creditsOverlay.classList.remove('active');

    // 애니메이션 완료 후 플렉서스 중지
    setTimeout(() => {
      if (plexusEffect) {
        plexusEffect.stop();
      }
    }, 400);
  }

  // 로고 클릭 시 크레딧 모달 열기
  logoIcon?.addEventListener('click', openCreditsModal);

  // 닫기 버튼
  creditsClose?.addEventListener('click', closeCreditsModal);

  // 오버레이 클릭 시 닫기
  creditsOverlay?.addEventListener('click', (e) => {
    if (e.target === creditsOverlay) {
      closeCreditsModal();
    }
  });

  // ESC 키로 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && creditsOverlay?.classList.contains('active')) {
      closeCreditsModal();
    }
  });

  // ========================================
  // Thread Popup (Slack-style)
  // ========================================
  const threadOverlay = document.getElementById('threadOverlay');
  const threadBack = document.getElementById('threadBack');
  const threadClose = document.getElementById('threadClose');
  const threadAuthor = document.getElementById('threadAuthor');
  const threadOriginal = document.getElementById('threadOriginal');
  const threadReplyCount = document.getElementById('threadReplyCount');
  const threadReplies = document.getElementById('threadReplies');
  const threadEditor = document.getElementById('threadEditor');
  const threadSubmit = document.getElementById('threadSubmit');

  let currentThreadMarkerId = null;

  /**
   * 스레드 팝업 열기
   */
  function openThreadPopup(markerId) {
    const marker = commentManager.getMarker(markerId);
    if (!marker) return;

    currentThreadMarkerId = markerId;

    // 헤더에 작성자 표시 (색상 포함)
    const authorColor = userSettings.getColorForName(marker.author);
    threadAuthor.textContent = marker.author;
    threadAuthor.style.color = authorColor || '';

    // 아바타 이미지 가져오기
    const avatarImage = userSettings.getAvatarForName(marker.author);

    // 원본 댓글 렌더링
    threadOriginal.innerHTML = `
      ${avatarImage ? `<div class="thread-avatar-bg" style="background-image: url('${avatarImage}')"></div>` : ''}
      <div class="thread-original-inner">
        <div class="thread-comment-header">
          <div class="thread-comment-avatar">${marker.author.charAt(0)}</div>
          <div class="thread-comment-info">
            <div class="thread-comment-author" ${getAuthorColorStyle(marker.author)}>${marker.author}</div>
            <div class="thread-comment-time">${formatRelativeTime(marker.createdAt)}</div>
          </div>
        </div>
        <div class="thread-comment-text">${formatMarkdown(marker.text)}</div>
        <div class="thread-comment-reactions">
          <button class="thread-reaction">
            <span class="thread-reaction-emoji">✅</span>
          </button>
          <button class="thread-reaction">
            <span class="thread-reaction-emoji">💯</span>
          </button>
          <button class="thread-reaction">
            <span class="thread-reaction-emoji">👍</span>
          </button>
          <button class="thread-reaction">
            <span class="thread-reaction-emoji">😀</span>
          </button>
        </div>
      </div>
    `;

    // 답글 개수 표시
    const replyCount = marker.replies?.length || 0;
    threadReplyCount.textContent = replyCount > 0 ? `${replyCount}개의 댓글` : '';
    threadReplyCount.style.display = replyCount > 0 ? 'flex' : 'none';

    // 답글들 렌더링
    threadReplies.innerHTML = (marker.replies || []).map(reply => `
      <div class="thread-reply-item">
        <div class="thread-reply-avatar">${reply.author.charAt(0)}</div>
        <div class="thread-reply-content">
          <div class="thread-reply-header">
            <span class="thread-reply-author" ${getAuthorColorStyle(reply.author)}>${reply.author}</span>
            <span class="thread-reply-time">${formatRelativeTime(reply.createdAt)}</span>
          </div>
          <div class="thread-reply-text">${formatMarkdown(reply.text)}</div>
        </div>
      </div>
    `).join('');

    // 에디터 초기화
    threadEditor.innerHTML = '';
    updateSubmitButtonState();

    // 팝업 열기
    threadOverlay.classList.add('open');
    threadEditor.focus();
  }

  /**
   * 스레드 팝업 닫기
   */
  function closeThreadPopup() {
    threadOverlay.classList.remove('open');
    currentThreadMarkerId = null;
    threadEditor.innerHTML = '';
  }

  /**
   * 마크다운 포맷팅 적용
   */
  function formatMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // Bold: *text* or **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<strong>$1</strong>');

    // Italic: _text_
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // Strikethrough: ~text~
    html = html.replace(/~(.+?)~/g, '<s>$1</s>');

    // Code: `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bullet list: - item
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    // Clean up consecutive ul tags
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  /**
   * 에디터에 포맷 적용
   */
  function applyFormat(format) {
    threadEditor.focus();
    const selection = window.getSelection();

    // Selection이 없으면 에디터 끝에 커서 배치
    if (!selection || selection.rangeCount === 0) {
      const range = document.createRange();
      range.selectNodeContents(threadEditor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    switch (format) {
      case 'bold':
        document.execCommand('bold', false, null);
        break;
      case 'italic':
        document.execCommand('italic', false, null);
        break;
      case 'underline':
        document.execCommand('underline', false, null);
        break;
      case 'strike':
        document.execCommand('strikeThrough', false, null);
        break;
      case 'bullet':
        document.execCommand('insertUnorderedList', false, null);
        break;
      case 'numbered':
        document.execCommand('insertOrderedList', false, null);
        break;
      case 'code':
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const selectedText = range.toString();
          if (selectedText) {
            document.execCommand('insertHTML', false, `<code>${escapeHtml(selectedText)}</code>`);
          }
        }
        break;
      case 'link':
        // prompt() 전에 selection 백업
        const savedRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
        const url = prompt('링크 URL을 입력하세요:');
        if (url && savedRange) {
          // selection 복원 후 링크 적용
          threadEditor.focus();
          selection.removeAllRanges();
          selection.addRange(savedRange);
          document.execCommand('createLink', false, url);
        }
        break;
    }

    updateSubmitButtonState();
  }

  /**
   * 전송 버튼 상태 업데이트
   */
  function updateSubmitButtonState() {
    const hasContent = threadEditor.textContent.trim().length > 0;
    threadSubmit.classList.toggle('active', hasContent);
  }

  /**
   * 스레드에 답글 제출
   */
  function submitThreadReply() {
    const text = threadEditor.innerText.trim();
    if (!text || !currentThreadMarkerId) return;

    commentManager.addReplyToMarker(currentThreadMarkerId, text);

    // UI 업데이트
    const marker = commentManager.getMarker(currentThreadMarkerId);
    if (marker) {
      // 답글 개수 업데이트
      const replyCount = marker.replies?.length || 0;
      threadReplyCount.textContent = `${replyCount}개의 댓글`;
      threadReplyCount.style.display = 'flex';

      // 새 답글 추가
      const newReply = marker.replies[marker.replies.length - 1];
      threadReplies.innerHTML += `
        <div class="thread-reply-item">
          <div class="thread-reply-avatar">${newReply.author.charAt(0)}</div>
          <div class="thread-reply-content">
            <div class="thread-reply-header">
              <span class="thread-reply-author" ${getAuthorColorStyle(newReply.author)}>${newReply.author}</span>
              <span class="thread-reply-time">${formatRelativeTime(newReply.createdAt)}</span>
            </div>
            <div class="thread-reply-text">${formatMarkdown(newReply.text)}</div>
          </div>
        </div>
      `;
    }

    // 에디터 초기화
    threadEditor.innerHTML = '';
    updateSubmitButtonState();
    showToast('답글이 추가되었습니다.', 'success');
  }

  // 스레드 팝업 이벤트 리스너 (X 버튼, < 버튼, ESC로만 닫기)
  threadBack?.addEventListener('click', closeThreadPopup);
  threadClose?.addEventListener('click', closeThreadPopup);

  // ESC 키로 스레드 팝업 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && threadOverlay?.classList.contains('open')) {
      closeThreadPopup();
    }
  });

  // 에디터 툴바 버튼 클릭
  document.querySelectorAll('.thread-editor-toolbar .editor-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const format = btn.dataset.format;
      if (format) {
        applyFormat(format);
      }
    });
  });

  // 에디터 키보드 단축키
  threadEditor?.addEventListener('keydown', (e) => {
    // Ctrl+B: Bold
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      applyFormat('bold');
    }
    // Ctrl+I: Italic
    if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      applyFormat('italic');
    }
    // Ctrl+U: Underline
    if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      applyFormat('underline');
    }
    // Enter: Submit (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitThreadReply();
    }
  });

  // 에디터 내용 변경 감지
  threadEditor?.addEventListener('input', () => {
    updateSubmitButtonState();

    // "- " 입력 시 자동 불릿 리스트
    const text = threadEditor.innerText;
    if (text.endsWith('- ') && text.length === 2) {
      // execCommand 대신 직접 DOM 조작으로 안정적 처리
      threadEditor.innerHTML = '<ul><li><br></li></ul>';

      // 커서를 li 안으로 명시적 이동
      const li = threadEditor.querySelector('li');
      if (li) {
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(li, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  });

  // 전송 버튼 클릭
  threadSubmit?.addEventListener('click', submitThreadReply);

  // 전역으로 노출
  window.openThreadPopup = openThreadPopup;

  log.info('앱 초기화 완료');

  // 버전 표시
  try {
    const version = await window.electronAPI.getVersion();
    log.info('앱 버전', { version });
  } catch (e) {
    log.warn('버전 정보를 가져올 수 없습니다.');
  }
}

// DOM 로드 완료 시 앱 초기화
document.addEventListener('DOMContentLoaded', initApp);
