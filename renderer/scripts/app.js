/**
 * baeframe - Renderer App Entry Point
 */

import { createLogger, setupGlobalErrorHandlers } from './logger.js';
import { VideoPlayer } from './modules/video-player.js';
import { Timeline } from './modules/timeline.js';
import { DrawingManager, DrawingTool } from './modules/drawing-manager.js';
import { CommentManager, MARKER_COLORS } from './modules/comment-manager.js';
import { ReviewDataManager } from './modules/review-data-manager.js';
import { CollaborationManager } from './modules/collaboration-manager.js';
import { HighlightManager, HIGHLIGHT_COLORS } from './modules/highlight-manager.js';
import { getUserSettings } from './modules/user-settings.js';
import { getThumbnailGenerator } from './modules/thumbnail-generator.js';
import { PlexusEffect } from './modules/plexus.js';
import { getImageFromClipboard, selectImageFile, isValidImageBase64 } from './modules/image-utils.js';
import { parseVersion, toVersionInfo } from './modules/version-parser.js';
import { getVersionManager } from './modules/version-manager.js';
import { getVersionDropdown } from './modules/version-dropdown.js';
import { getSplitViewManager } from './modules/split-view-manager.js';
import { getPlaylistManager } from './modules/playlist-manager.js';

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
    // btnVersionHistory 제거됨 - 버전 드롭다운으로 대체
    btnSave: document.getElementById('btnSave'),
    btnCopyLink: document.getElementById('btnCopyLink'),
    btnOpenFolder: document.getElementById('btnOpenFolder'),
    btnOpenOther: document.getElementById('btnOpenOther'),

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
    btnPrevComment: document.getElementById('btnPrevComment'),
    btnNextComment: document.getElementById('btnNextComment'),
    btnPrevHighlight: document.getElementById('btnPrevHighlight'),
    btnNextHighlight: document.getElementById('btnNextHighlight'),

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
    btnCommentImage: document.getElementById('btnCommentImage'),
    commentImagePreview: document.getElementById('commentImagePreview'),
    commentPreviewImg: document.getElementById('commentPreviewImg'),
    commentImageRemove: document.getElementById('commentImageRemove'),
    btnCompactView: document.getElementById('btnCompactView'),
    feedbackProgress: document.getElementById('feedbackProgress'),
    feedbackProgressValue: document.getElementById('feedbackProgressValue'),
    feedbackProgressFill: document.getElementById('feedbackProgressFill'),

    // 이미지 뷰어
    imageViewerOverlay: document.getElementById('imageViewerOverlay'),
    imageViewerImg: document.getElementById('imageViewerImg'),
    imageViewerClose: document.getElementById('imageViewerClose'),

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
    btnDeleteLayer: document.getElementById('btnDeleteLayer'),

    // 재생목록 관련
    btnPlaylist: document.getElementById('btnPlaylist'),
    playlistSidebar: document.getElementById('playlistSidebar'),
    playlistResizer: document.getElementById('playlistResizer'),
    playlistNameInput: document.getElementById('playlistNameInput'),
    btnPlaylistAdd: document.getElementById('btnPlaylistAdd'),
    btnPlaylistCopyLink: document.getElementById('btnPlaylistCopyLink'),
    btnPlaylistClose: document.getElementById('btnPlaylistClose'),
    playlistProgressFill: document.getElementById('playlistProgressFill'),
    playlistProgressText: document.getElementById('playlistProgressText'),
    btnPlaylistPrev: document.getElementById('btnPlaylistPrev'),
    btnPlaylistNext: document.getElementById('btnPlaylistNext'),
    playlistPosition: document.getElementById('playlistPosition'),
    playlistAutoPlay: document.getElementById('playlistAutoPlay'),
    playlistItems: document.getElementById('playlistItems'),
    playlistDropzone: document.getElementById('playlistDropzone'),
    playlistEmpty: document.getElementById('playlistEmpty'),
    playlistAddArea: document.getElementById('playlistAddArea'),
    playlistAddZone: document.getElementById('playlistAddZone')
  };

  // 상태
  const state = {
    isDrawMode: false,
    isCommentMode: false, // 댓글 추가 모드
    isFullscreen: false, // 전체화면 모드
    isCompactView: false, // 댓글 컴팩트 뷰
    currentFile: null,
    pendingCommentImage: null, // 댓글 첨부 이미지 { base64, width, height }
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
   * 드로잉 모드일 때는 그리기 Undo를 먼저 시도
   */
  function globalUndo() {
    // 드로잉 모드: 그리기 Undo 먼저 시도
    if (state.isDrawMode) {
      if (drawingManager.undo()) {
        return true;
      }
      // 그리기 히스토리가 없으면 댓글 Undo 시도
      if (undoStack.length > 0) {
        const action = undoStack.pop();
        if (action && action.undo) {
          action.undo();
          redoStack.push(action);
          return true;
        }
      }
      return false;
    }

    // 일반 모드: 댓글 Undo 먼저 시도
    if (undoStack.length === 0) {
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
   * 드로잉 모드일 때는 그리기 Redo를 먼저 시도
   */
  function globalRedo() {
    // 드로잉 모드: 그리기 Redo 먼저 시도
    if (state.isDrawMode) {
      if (drawingManager.redo()) {
        return true;
      }
      // 그리기 히스토리가 없으면 댓글 Redo 시도
      if (redoStack.length > 0) {
        const action = redoStack.pop();
        if (action && action.redo) {
          action.redo();
          undoStack.push(action);
          return true;
        }
      }
      return false;
    }

    // 일반 모드: 댓글 Redo 먼저 시도
    if (redoStack.length === 0) {
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

  // 하이라이트 매니저
  const highlightManager = new HighlightManager();

  // 리뷰 데이터 매니저 (.bframe 파일 저장/로드)
  const reviewDataManager = new ReviewDataManager({
    commentManager,
    drawingManager,
    highlightManager,
    autoSave: true,
    autoSaveDelay: 500 // 500ms 디바운스
  });
  reviewDataManager.connect();

  // 협업 매니저 (실시간 동기화)
  const collaborationManager = new CollaborationManager({
    syncInterval: 10000,  // 10초마다 동기화
    presenceUpdateInterval: 5000  // 5초마다 presence 업데이트
  });

  // ReviewDataManager에 CollaborationManager 연결 (저장 시 머지용)
  reviewDataManager.setCollaborationManager(collaborationManager);

  // 앱 종료/새로고침 시 정리
  window.addEventListener('beforeunload', () => {
    // 협업 편집 잠금 해제
    collaborationManager.releaseAllEditingLocks();
    // 모든 파일 감시 중지 (누적 방지)
    window.electronAPI.watchFileStopAll();
  });

  // 사용자 설정
  const userSettings = getUserSettings();

  // ====== 단축키 힌트 동적 업데이트 ======

  /**
   * 키 코드를 표시 문자열로 변환
   */
  function keyCodeToDisplay(keyCode) {
    const keyMap = {
      'Space': 'Space',
      'ArrowLeft': '←',
      'ArrowRight': '→',
      'ArrowUp': '↑',
      'ArrowDown': '↓',
      'Delete': 'Del',
      'Backspace': '⌫',
      'Enter': '↵',
      'Escape': 'Esc',
      'Tab': 'Tab',
      'Home': 'Home',
      'End': 'End',
      'PageUp': 'PgUp',
      'PageDown': 'PgDn'
    };

    if (keyMap[keyCode]) return keyMap[keyCode];
    if (keyCode.startsWith('Key')) return keyCode.slice(3);
    if (keyCode.startsWith('Digit')) return keyCode.slice(5);
    if (keyCode.startsWith('Numpad')) return 'Num' + keyCode.slice(6);
    if (keyCode.startsWith('F') && keyCode.length <= 3) return keyCode;
    return keyCode;
  }

  /**
   * 단축키 힌트 UI 업데이트
   */
  function updateShortcutHints() {
    const drawHint = document.getElementById('btnDrawModeHint');
    const commentHint = document.getElementById('btnAddCommentHint');
    const hintDrawMode = document.getElementById('hintDrawMode');
    const hintCommentMode = document.getElementById('hintCommentMode');

    const drawShortcut = userSettings.getShortcut('drawMode');
    const commentShortcut = userSettings.getShortcut('commentMode');

    if (drawShortcut) {
      const displayKey = keyCodeToDisplay(drawShortcut.key);
      if (drawHint) drawHint.textContent = displayKey;
      if (hintDrawMode) hintDrawMode.textContent = displayKey;
    }

    if (commentShortcut) {
      const displayKey = keyCodeToDisplay(commentShortcut.key);
      if (commentHint) commentHint.textContent = displayKey;
      if (hintCommentMode) hintCommentMode.textContent = displayKey;
    }
  }

  // 초기 힌트 업데이트
  updateShortcutHints();

  // 단축키 변경 시 힌트 업데이트
  userSettings.addEventListener('shortcutChanged', updateShortcutHints);
  userSettings.addEventListener('shortcutsReset', updateShortcutHints);

  // 설정 파일 로드 완료 시 힌트 업데이트
  userSettings.addEventListener('ready', () => {
    log.info('설정 파일 로드 완료, UI 업데이트');
    updateShortcutHints();
  });

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
    updateFullscreenTimecode(); // 전체화면 타임코드 업데이트
    updateFullscreenSeekbar(); // 전체화면 시크바 업데이트

    // 댓글 매니저에 현재 프레임 전달 (마커 가시성 업데이트)
    commentManager.setCurrentFrame(currentFrame);

    // 비디오 댓글 범위 오버레이 플레이헤드 업데이트
    if (typeof updateVideoCommentPlayhead === 'function') {
      updateVideoCommentPlayhead();
    }

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
    timeline.setPlayingState(true);
    // 재생 시작 시 플레이헤드가 화면 밖에 있으면 스크롤
    timeline.scrollToPlayhead();
  });

  videoPlayer.addEventListener('pause', () => {
    elements.btnPlay.innerHTML = playIconSVG;
    drawingManager.setPlaying(false);
    timeline.setPlayingState(false);
  });

  videoPlayer.addEventListener('ended', () => {
    elements.btnPlay.innerHTML = playIconSVG;
    drawingManager.setPlaying(false);
    timeline.setPlayingState(false);
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
      undo: async () => {
        commentManager.deleteMarker(markerData.id);
        updateCommentList();
        updateTimelineMarkers();
        updateVideoMarkers();
        await reviewDataManager.save();
      },
      redo: async () => {
        commentManager.restoreMarker(markerData);
        updateCommentList();
        updateTimelineMarkers();
        updateVideoMarkers();
        await reviewDataManager.save();
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
    const { frame, markerInfos } = e.detail;
    videoPlayer.seekToFrame(frame);

    // 프리뷰 마커 클릭과 동일한 효과 (패널 열기 + 스크롤 + 글로우)
    if (markerInfos && markerInfos.length > 0) {
      const firstMarkerId = markerInfos[0].markerId;
      scrollToCommentWithGlow(firstMarkerId);
    }
  });

  // 타임라인 줌 변경 시 마커 다시 렌더링 (클러스터링 재계산)
  timeline.addEventListener('zoomChanged', () => {
    updateTimelineMarkers();
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

  // "파일을 열어주세요" 텍스트 클릭 시 파일 열기
  elements.fileName?.addEventListener('click', async () => {
    // 파일이 로드된 상태면 무시 (클릭 가능한 상태일 때만)
    if (!elements.fileName.classList.contains('file-name-clickable')) return;

    log.info('파일명 텍스트 클릭 - 파일 열기');
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

  // 이전 댓글로 이동
  elements.btnPrevComment?.addEventListener('click', () => {
    if (!videoPlayer.duration) {
      showToast('영상을 먼저 로드하세요', 'warn');
      return;
    }

    const currentFrame = videoPlayer.currentFrame || 0;
    const prevFrame = commentManager.getPrevMarkerFrame(currentFrame);

    if (prevFrame !== null) {
      videoPlayer.seekToFrame(prevFrame);
      timeline.scrollToPlayhead();
      log.info('이전 댓글로 이동', { frame: prevFrame });
    } else {
      showToast('이전 댓글이 없습니다', 'info');
    }
  });

  // 다음 댓글로 이동
  elements.btnNextComment?.addEventListener('click', () => {
    if (!videoPlayer.duration) {
      showToast('영상을 먼저 로드하세요', 'warn');
      return;
    }

    const currentFrame = videoPlayer.currentFrame || 0;
    const nextFrame = commentManager.getNextMarkerFrame(currentFrame);

    if (nextFrame !== null) {
      videoPlayer.seekToFrame(nextFrame);
      timeline.scrollToPlayhead();
      log.info('다음 댓글로 이동', { frame: nextFrame });
    } else {
      showToast('다음 댓글이 없습니다', 'info');
    }
  });

  // 사이드바 댓글 입력 Enter 처리 (역순 플로우: 텍스트 입력 → 마커 찍기)
  elements.commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = elements.commentInput.value.trim();
      if (text || state.pendingCommentImage) {
        // 텍스트/이미지를 pending으로 설정하고 댓글 모드 활성화
        commentManager.setPendingText(text || '(이미지)');
        // 이미지가 있으면 commentManager에 임시 저장
        if (state.pendingCommentImage) {
          commentManager._pendingImage = state.pendingCommentImage;
        }
        elements.commentInput.value = '';
        clearCommentImage();
        showToast('영상에서 마커를 찍어주세요', 'info');
      }
    }
  });

  // 전송 버튼 클릭 처리 (Enter와 동일한 동작)
  elements.btnSubmitComment?.addEventListener('click', () => {
    const text = elements.commentInput.value.trim();
    if (text || state.pendingCommentImage) {
      // 텍스트/이미지를 pending으로 설정하고 댓글 모드 활성화
      commentManager.setPendingText(text || '(이미지)');
      // 이미지가 있으면 commentManager에 임시 저장
      if (state.pendingCommentImage) {
        commentManager._pendingImage = state.pendingCommentImage;
      }
      elements.commentInput.value = '';
      clearCommentImage();
      showToast('영상에서 마커를 찍어주세요', 'info');
    }
  });

  // ====== 댓글 이미지 기능 ======

  /**
   * 댓글 이미지 미리보기 표시
   */
  function showCommentImagePreview(imageData) {
    state.pendingCommentImage = imageData;
    elements.commentPreviewImg.src = imageData.base64;
    elements.commentImagePreview.style.display = 'block';
    log.info('댓글 이미지 첨부됨', { width: imageData.width, height: imageData.height });
  }

  /**
   * 댓글 이미지 초기화
   */
  function clearCommentImage() {
    state.pendingCommentImage = null;
    elements.commentPreviewImg.src = '';
    elements.commentImagePreview.style.display = 'none';
  }

  // 댓글 입력창 이미지 붙여넣기
  elements.commentInput.addEventListener('paste', async (e) => {
    const imageData = await getImageFromClipboard(e);
    if (imageData) {
      e.preventDefault();
      showCommentImagePreview(imageData);
      showToast('이미지가 첨부되었습니다', 'success');
    }
  });

  // 이미지 버튼 클릭 (파일 선택)
  elements.btnCommentImage?.addEventListener('click', async () => {
    const imageData = await selectImageFile();
    if (imageData) {
      showCommentImagePreview(imageData);
      showToast('이미지가 첨부되었습니다', 'success');
    }
  });

  // 이미지 제거 버튼
  elements.commentImageRemove?.addEventListener('click', () => {
    clearCommentImage();
  });

  // 컴팩트 뷰 토글 버튼
  elements.btnCompactView?.addEventListener('click', () => {
    state.isCompactView = !state.isCompactView;
    elements.commentsList?.classList.toggle('compact', state.isCompactView);
    elements.btnCompactView.classList.toggle('active', state.isCompactView);
    elements.btnCompactView.title = state.isCompactView ? '일반 뷰로 전환' : '컴팩트 뷰로 전환';
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

  // 수동 저장 버튼
  elements.btnSave?.addEventListener('click', async () => {
    if (!reviewDataManager.getBframePath()) {
      showToast('저장할 파일이 없습니다', 'warn');
      return;
    }
    const saved = await reviewDataManager.save();
    if (saved) {
      showToast('저장되었습니다', 'success');
    }
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

    // #70: .bframe 파일 자동 생성 - 저장되지 않은 변경사항이 있거나 파일이 없으면 저장
    try {
      const fileExists = await window.electronAPI.fileExists(bframePath);
      if (!fileExists || reviewDataManager.hasUnsavedChanges()) {
        log.info('링크 복사 전 .bframe 파일 자동 저장', {
          fileExists,
          hasUnsavedChanges: reviewDataManager.hasUnsavedChanges()
        });
        await reviewDataManager.save();
        showToast('.bframe 파일이 자동 저장되었습니다.', 'info');
      }
    } catch (error) {
      log.warn('.bframe 파일 자동 저장 실패', error);
      // 저장 실패해도 링크 복사는 진행
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
          log.info('Google Drive 파일 ID 검색 중...');
          const result = await window.electronAPI.generateGDriveShareLink(videoPath, bframePath);
          if (result.success) {
            storedDriveLinks.videoUrl = result.videoUrl;
            storedDriveLinks.bframeUrl = result.bframeUrl;
            webShareUrl = result.webShareUrl;
          } else if (result.error) {
            log.warn('웹 공유 링크 생성 실패', result.error);
            // 사용자에게 피드백 (토스트 아님 - 로그만)
          }
        }
      } catch (error) {
        log.warn('웹 공유 링크 생성 실패 (무시)', error);
      }
    }

    // 클립보드에 복사할 내용 생성
    // 형식: .bframe경로\n웹공유URL\n파일명 (줄바꿈 구분)
    // AutoHotkey가 첫 줄만 baeframe:// URL로 사용
    let clipboardContent = windowsPath;
    if (webShareUrl) {
      clipboardContent = `${windowsPath}\n${webShareUrl}\n${fileName}`;
    }

    await window.electronAPI.copyToClipboard(clipboardContent);

    if (webShareUrl) {
      showToast('링크가 복사되었습니다! Slack에서 Ctrl+Shift+V로 붙여넣기 (웹 뷰어 링크 포함)', 'success');
    } else {
      showToast('.bframe 경로가 복사되었습니다! Slack에서 Ctrl+Shift+V로 하이퍼링크 붙여넣기', 'success');
    }
    log.info('경로 복사됨', { path: windowsPath, webShareUrl });
  });

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

  // 저장된 Google Drive 링크 (파일별)
  const storedDriveLinks = {
    videoUrl: null,
    bframeUrl: null
  };

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

  // 설정 초기값 로드는 waitForReady() 이후에 수행 (initializeCommentSettings 함수 참조)
  // 여기서는 DOM 요소만 참조하고, 실제 값 설정은 나중에 수행

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

  // ====== 브러시 외곽선 ======
  const strokeToggle = document.getElementById('strokeToggle');
  const strokeControls = document.getElementById('strokeControls');
  const strokeWidthSlider = document.getElementById('strokeWidthSlider');
  const strokeWidthValue = document.getElementById('strokeWidthValue');

  // 외곽선 토글
  strokeToggle?.addEventListener('click', () => {
    const isActive = !strokeToggle.classList.contains('active');
    strokeToggle.classList.toggle('active', isActive);
    strokeToggle.textContent = isActive ? 'ON' : 'OFF';
    strokeControls?.classList.toggle('visible', isActive);
    drawingManager.setStrokeEnabled(isActive);
  });

  // 외곽선 두께
  strokeWidthSlider?.addEventListener('input', function() {
    const width = parseInt(this.value);
    strokeWidthValue.textContent = `${width}px`;
    drawingManager.setStrokeWidth(width);
  });

  // 외곽선 색상
  document.querySelectorAll('.stroke-color-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.stroke-color-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const color = this.dataset.strokeColor;
      drawingManager.setStrokeColor(color);
    });
  });

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

  // ====== 하이라이트 ======
  const btnAddHighlight = document.getElementById('btnAddHighlight');
  const highlightTrack = document.getElementById('highlightTrack');
  const highlightLayerHeader = document.getElementById('highlightLayerHeader');
  const highlightPopup = document.getElementById('highlightPopup');
  const highlightNoteInput = document.getElementById('highlightNoteInput');
  const highlightColorPicker = document.getElementById('highlightColorPicker');
  const highlightCopyBtn = document.getElementById('highlightCopyBtn');
  const highlightDeleteBtn = document.getElementById('highlightDeleteBtn');

  // 마커 팝업 관련 요소
  const markerPopup = document.getElementById('markerPopup');
  const markerColorPicker = document.getElementById('markerColorPicker');

  // 현재 선택된 마커 ID
  let selectedMarkerId = null;

  // 하이라이트 트랙 연결 (좌측 레이어 헤더도 연동)
  timeline.setHighlightTrack(highlightTrack, highlightLayerHeader);

  // 현재 선택된 하이라이트 ID
  let selectedHighlightId = null;

  // 하이라이트 생성 버튼
  btnAddHighlight.addEventListener('click', () => {
    if (!videoPlayer.duration) {
      showToast('영상을 먼저 로드하세요', 'warn');
      return;
    }
    const currentTime = videoPlayer.currentTime || 0;
    const highlight = highlightManager.createHighlight(currentTime);
    renderHighlights();
    showToast('하이라이트가 추가되었습니다', 'info');

    // Undo 스택에 추가
    pushUndo({
      type: 'highlight-add',
      data: { highlightId: highlight.id },
      undo: () => {
        highlightManager.deleteHighlight(highlight.id);
        renderHighlights();
        reviewDataManager.save();
      },
      redo: () => {
        // 하이라이트 복원 (같은 속성으로)
        const restored = highlightManager.createHighlight(highlight.startTime);
        restored.id = highlight.id;
        restored.endTime = highlight.endTime;
        restored.note = highlight.note;
        restored.colorInfo = highlight.colorInfo;
        renderHighlights();
        reviewDataManager.save();
      }
    });
  });

  // 이전 하이라이트로 이동
  elements.btnPrevHighlight?.addEventListener('click', () => {
    if (!videoPlayer.duration) {
      showToast('영상을 먼저 로드하세요', 'warn');
      return;
    }

    const currentTime = videoPlayer.currentTime || 0;
    const prevTime = highlightManager.getPrevHighlightTime(currentTime);

    if (prevTime !== null) {
      videoPlayer.seek(prevTime);
      timeline.scrollToPlayhead();
      log.info('이전 하이라이트로 이동', { time: prevTime });
    } else {
      showToast('이전 하이라이트가 없습니다', 'info');
    }
  });

  // 다음 하이라이트로 이동
  elements.btnNextHighlight?.addEventListener('click', () => {
    if (!videoPlayer.duration) {
      showToast('영상을 먼저 로드하세요', 'warn');
      return;
    }

    const currentTime = videoPlayer.currentTime || 0;
    const nextTime = highlightManager.getNextHighlightTime(currentTime);

    if (nextTime !== null) {
      videoPlayer.seek(nextTime);
      timeline.scrollToPlayhead();
      log.info('다음 하이라이트로 이동', { time: nextTime });
    } else {
      showToast('다음 하이라이트가 없습니다', 'info');
    }
  });

  // 하이라이트 렌더링 함수
  function renderHighlights() {
    const highlights = highlightManager.getAllHighlights();
    timeline.renderHighlights(highlights);
    setupHighlightInteractions();
  }

  // 하이라이트 상호작용 설정 (드래그, 우클릭)
  function setupHighlightInteractions() {
    const items = highlightTrack.querySelectorAll('.highlight-item');

    items.forEach(item => {
      const highlightId = item.dataset.highlightId;

      // 우클릭 - 팝업 메뉴
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showHighlightPopup(highlightId, e.clientX, e.clientY);
      });

      // 바 전체 드래그 (이동)
      item.addEventListener('mousedown', (e) => {
        // 핸들 클릭이면 무시 (핸들에서 처리)
        if (e.target.classList.contains('highlight-handle')) return;
        e.preventDefault();
        e.stopPropagation();
        startHighlightDrag(highlightId, 'move', e);
      });

      // 드래그 핸들
      const leftHandle = item.querySelector('.highlight-handle-left');
      const rightHandle = item.querySelector('.highlight-handle-right');

      if (leftHandle) {
        leftHandle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          startHighlightDrag(highlightId, 'left', e);
        });
      }

      if (rightHandle) {
        rightHandle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          startHighlightDrag(highlightId, 'right', e);
        });
      }
    });
  }

  // 하이라이트 드래그 시작
  let highlightDragState = null;

  function startHighlightDrag(highlightId, handle, e) {
    const highlight = highlightManager.getHighlight(highlightId);
    if (!highlight) return;

    highlightDragState = {
      highlightId,
      handle,
      startX: e.clientX,
      startTime: highlight.startTime,
      endTime: highlight.endTime,
      duration: highlight.endTime - highlight.startTime,
      // Undo용 원본 값 저장
      originalStartTime: highlight.startTime,
      originalEndTime: highlight.endTime
    };

    document.addEventListener('mousemove', onHighlightDrag);
    document.addEventListener('mouseup', endHighlightDrag);
  }

  // 마그넷 스냅 - 플레이헤드에 달라붙기 (픽셀 기반)
  const SNAP_THRESHOLD_PIXELS = 15; // 기본 15픽셀
  const SNAP_THRESHOLD_PIXELS_SHIFT = 50; // Shift 누르면 50픽셀

  // 현재 타임라인 줌에 따른 프레임당 픽셀 계산
  function getPixelsPerFrame() {
    const zoom = timeline.zoom || 100;
    const totalFrames = timeline.totalFrames || 1;
    const containerWidth = timeline.container?.clientWidth || 1000;
    // 줌 100%일 때 컨테이너 너비가 전체 프레임을 표시
    // 줌이 높아지면 프레임당 픽셀이 증가
    return (containerWidth * (zoom / 100)) / totalFrames;
  }

  // 픽셀 범위를 프레임으로 변환
  function getSnapThresholdFrames(shiftKey) {
    const pixelThreshold = shiftKey ? SNAP_THRESHOLD_PIXELS_SHIFT : SNAP_THRESHOLD_PIXELS;
    const pixelsPerFrame = getPixelsPerFrame();
    // 최소 1프레임, 최대 없음 (줌 축소 시 넓은 범위)
    return Math.max(1, Math.round(pixelThreshold / pixelsPerFrame));
  }

  function snapToPlayhead(time, shiftKey = false) {
    // Shift 키를 눌렀을 때만 스냅
    if (!shiftKey) return time;

    const fps = videoPlayer.fps || 24;
    const playheadTime = videoPlayer.currentTime || 0;
    const thresholdFrames = getSnapThresholdFrames(shiftKey);
    const thresholdTime = thresholdFrames / fps;

    if (Math.abs(time - playheadTime) <= thresholdTime) {
      return playheadTime;
    }
    return time;
  }

  function snapFrameToPlayhead(frame, shiftKey = false) {
    // Shift 키를 눌렀을 때만 스냅
    if (!shiftKey) return frame;

    const currentFrame = videoPlayer.currentFrame || 0;
    const thresholdFrames = getSnapThresholdFrames(shiftKey);
    if (Math.abs(frame - currentFrame) <= thresholdFrames) {
      return currentFrame;
    }
    return frame;
  }

  function onHighlightDrag(e) {
    if (!highlightDragState) return;

    const { highlightId, handle, startX, startTime, endTime, duration } = highlightDragState;
    const deltaX = e.clientX - startX;
    const trackRect = highlightTrack.getBoundingClientRect();
    const deltaTime = (deltaX / trackRect.width) * videoPlayer.duration;
    const shiftKey = e.shiftKey; // Shift 키로 스냅 범위 확대

    let updates;
    if (handle === 'move') {
      // 전체 이동
      let newStart = startTime + deltaTime;
      let newEnd = endTime + deltaTime;

      // 경계 체크
      if (newStart < 0) {
        newStart = 0;
        newEnd = duration;
      }
      if (newEnd > videoPlayer.duration) {
        newEnd = videoPlayer.duration;
        newStart = videoPlayer.duration - duration;
      }

      // 마그넷 스냅 (시작점 또는 끝점이 플레이헤드에 가까우면 스냅)
      const snappedStart = snapToPlayhead(newStart, shiftKey);
      const snappedEnd = snapToPlayhead(newEnd, shiftKey);

      if (snappedStart !== newStart) {
        newStart = snappedStart;
        newEnd = snappedStart + duration;
      } else if (snappedEnd !== newEnd) {
        newEnd = snappedEnd;
        newStart = snappedEnd - duration;
      }

      updates = { startTime: newStart, endTime: newEnd };
    } else if (handle === 'left') {
      let newTime = Math.max(0, Math.min(endTime - 0.1, startTime + deltaTime));
      newTime = snapToPlayhead(newTime, shiftKey); // 마그넷 스냅
      updates = { startTime: newTime };
    } else {
      let newTime = Math.max(startTime + 0.1, Math.min(videoPlayer.duration, endTime + deltaTime));
      newTime = snapToPlayhead(newTime, shiftKey); // 마그넷 스냅
      updates = { endTime: newTime };
    }

    highlightManager.updateHighlight(highlightId, updates);

    // UI 즉시 업데이트
    const highlight = highlightManager.getHighlight(highlightId);
    timeline.updateHighlightElement(highlight);
  }

  function endHighlightDrag() {
    if (highlightDragState) {
      const { highlightId, originalStartTime, originalEndTime } = highlightDragState;
      const highlight = highlightManager.getHighlight(highlightId);

      if (highlight) {
        const newStartTime = highlight.startTime;
        const newEndTime = highlight.endTime;

        // 값이 변경된 경우에만 Undo 스택에 추가
        if (newStartTime !== originalStartTime || newEndTime !== originalEndTime) {
          pushUndo({
            type: 'highlight-drag',
            data: { highlightId },
            undo: () => {
              highlightManager.updateHighlight(highlightId, {
                startTime: originalStartTime,
                endTime: originalEndTime
              });
              renderHighlights();
              reviewDataManager.save();
            },
            redo: () => {
              highlightManager.updateHighlight(highlightId, {
                startTime: newStartTime,
                endTime: newEndTime
              });
              renderHighlights();
              reviewDataManager.save();
            }
          });
        }
      }
    }

    highlightDragState = null;
    document.removeEventListener('mousemove', onHighlightDrag);
    document.removeEventListener('mouseup', endHighlightDrag);
  }

  // 하이라이트 팝업 표시
  function showHighlightPopup(highlightId, x, y) {
    const highlight = highlightManager.getHighlight(highlightId);
    if (!highlight) return;

    selectedHighlightId = highlightId;

    // 입력값 설정
    highlightNoteInput.value = highlight.note || '';

    // 색상 버튼 선택 상태
    highlightColorPicker.querySelectorAll('.highlight-color-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.color === highlight.colorKey);
    });

    // 위치 설정 (화면 경계 고려)
    const popupWidth = 220;
    const popupHeight = 180;
    const adjustedX = Math.min(x, window.innerWidth - popupWidth - 10);
    const adjustedY = Math.min(y, window.innerHeight - popupHeight - 10);

    highlightPopup.style.left = `${adjustedX}px`;
    highlightPopup.style.top = `${adjustedY}px`;
    highlightPopup.style.display = 'block';

    // 입력 필드에 포커스
    setTimeout(() => highlightNoteInput.focus(), 50);
  }

  // 팝업 숨기기
  function hideHighlightPopup() {
    highlightPopup.style.display = 'none';
    selectedHighlightId = null;
  }

  // 팝업 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (highlightPopup.style.display === 'block' &&
        !highlightPopup.contains(e.target) &&
        !e.target.closest('.highlight-item')) {
      hideHighlightPopup();
    }
  });

  // 주석 입력
  highlightNoteInput.addEventListener('input', (e) => {
    if (selectedHighlightId) {
      highlightManager.updateHighlight(selectedHighlightId, { note: e.target.value });
      const highlight = highlightManager.getHighlight(selectedHighlightId);
      timeline.updateHighlightElement(highlight);
    }
  });

  // 색상 선택
  highlightColorPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.highlight-color-btn');
    if (!btn || !selectedHighlightId) return;

    const colorKey = btn.dataset.color;
    highlightManager.updateHighlight(selectedHighlightId, { colorKey });

    // 버튼 선택 상태 업데이트
    highlightColorPicker.querySelectorAll('.highlight-color-btn').forEach(b => {
      b.classList.toggle('selected', b === btn);
    });

    // UI 업데이트
    const highlight = highlightManager.getHighlight(selectedHighlightId);
    timeline.updateHighlightElement(highlight);
  });

  // 복사 버튼
  highlightCopyBtn.addEventListener('click', () => {
    if (selectedHighlightId) {
      highlightManager.copyHighlight(selectedHighlightId);
      hideHighlightPopup();
      showToast('하이라이트가 복사되었습니다 (Ctrl+V로 붙여넣기)', 'info');
    }
  });

  // 삭제 버튼
  highlightDeleteBtn.addEventListener('click', () => {
    if (selectedHighlightId) {
      // Undo를 위해 삭제 전 하이라이트 정보 저장
      const highlight = highlightManager.getHighlight(selectedHighlightId);
      const deletedHighlight = { ...highlight };
      const deletedId = selectedHighlightId;

      highlightManager.deleteHighlight(selectedHighlightId);
      hideHighlightPopup();
      renderHighlights();
      showToast('하이라이트가 삭제되었습니다', 'info');

      // Undo 스택에 추가
      pushUndo({
        type: 'highlight-delete',
        data: { highlightId: deletedId },
        undo: () => {
          // 하이라이트 복원
          const restored = highlightManager.createHighlight(deletedHighlight.startTime);
          restored.id = deletedHighlight.id;
          restored.endTime = deletedHighlight.endTime;
          restored.note = deletedHighlight.note;
          restored.colorKey = deletedHighlight.colorKey;
          restored.colorInfo = deletedHighlight.colorInfo;
          renderHighlights();
          reviewDataManager.save();
        },
        redo: () => {
          highlightManager.deleteHighlight(deletedId);
          renderHighlights();
          reviewDataManager.save();
        }
      });
    }
  });

  // 하이라이트 변경 이벤트 수신
  highlightManager.addEventListener('loaded', () => {
    renderHighlights();
  });

  // 하이라이트 복사/붙여넣기 키보드 단축키
  document.addEventListener('keydown', (e) => {
    // input, textarea에서는 무시
    if (e.target.matches('input, textarea')) return;

    // Ctrl+C: 선택된 하이라이트 복사
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      // 하이라이트 팝업이 열려있고 선택된 하이라이트가 있으면 복사
      if (highlightPopup.style.display === 'block' && selectedHighlightId) {
        e.preventDefault();
        highlightManager.copyHighlight(selectedHighlightId);
        showToast('하이라이트가 복사되었습니다', 'info');
      }
    }

    // Ctrl+V: 하이라이트 붙여넣기
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (highlightManager.hasClipboard() && videoPlayer.duration) {
        e.preventDefault();
        const currentTime = videoPlayer.currentTime || 0;
        const highlight = highlightManager.pasteHighlight(currentTime);
        if (highlight) {
          renderHighlights();
          showToast('하이라이트가 붙여넣기 되었습니다', 'info');
        }
      }
    }
  });

  // ====== 마커 색상 팝업 ======

  // 마커 팝업 표시
  function showMarkerPopup(markerId, x, y) {
    const marker = commentManager.getMarker(markerId);
    if (!marker) return;

    selectedMarkerId = markerId;

    // 색상 버튼 선택 상태
    markerColorPicker.querySelectorAll('.marker-color-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.color === (marker.colorKey || 'default'));
    });

    // 위치 설정 (화면 경계 고려)
    const popupWidth = 200;
    const popupHeight = 80;
    const adjustedX = Math.min(x, window.innerWidth - popupWidth - 10);
    const adjustedY = Math.min(y, window.innerHeight - popupHeight - 10);

    markerPopup.style.left = `${adjustedX}px`;
    markerPopup.style.top = `${adjustedY}px`;
    markerPopup.style.display = 'block';
  }

  // 마커 팝업 숨기기
  function hideMarkerPopup() {
    markerPopup.style.display = 'none';
    selectedMarkerId = null;
  }

  // 마커 팝업 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (markerPopup.style.display === 'block' &&
        !markerPopup.contains(e.target) &&
        !e.target.closest('.comment-range-item') &&
        !e.target.closest('.video-comment-range-bar')) {
      hideMarkerPopup();
    }
  });

  // 마커 색상 선택
  markerColorPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.marker-color-btn');
    if (!btn || !selectedMarkerId) return;

    const colorKey = btn.dataset.color;
    commentManager.updateMarker(selectedMarkerId, { colorKey });

    // 버튼 선택 상태 업데이트
    markerColorPicker.querySelectorAll('.marker-color-btn').forEach(b => {
      b.classList.toggle('selected', b === btn);
    });

    // UI 업데이트 (타임라인 + 비디오 오버레이)
    renderCommentRanges();
    updateCommentList();
    hideMarkerPopup();
    showToast('마커 색상이 변경되었습니다', 'info');
  });

  // ====== 댓글 범위 트랙 ======
  const commentTrack = document.getElementById('commentTrack');
  const commentLayerHeader = document.getElementById('commentLayerHeader');

  // 댓글 트랙 연결
  timeline.setCommentTrack(commentTrack, commentLayerHeader);

  // 현재 선택된 댓글 범위
  let selectedCommentRange = null; // { layerId, markerId }

  // 댓글 드래그 상태
  let commentDragState = null;

  // ====== 비디오 댓글 범위 오버레이 ======
  const videoCommentRangeOverlay = document.getElementById('videoCommentRangeOverlay');
  const btnOverlayToggle = document.getElementById('btnOverlayToggle');
  const btnOverlayPosition = document.getElementById('btnOverlayPosition');
  let videoCommentPlayhead = null;
  let overlayEnabled = true;
  let overlayPositionTop = false;

  // 오버레이 토글 버튼
  if (btnOverlayToggle) {
    // 초기 상태: 활성화
    btnOverlayToggle.classList.add('active');

    btnOverlayToggle.addEventListener('click', () => {
      overlayEnabled = !overlayEnabled;
      btnOverlayToggle.classList.toggle('active', overlayEnabled);

      if (videoCommentRangeOverlay) {
        videoCommentRangeOverlay.classList.toggle('hidden', !overlayEnabled);
      }
    });
  }

  // 오버레이 위치 전환 버튼
  if (btnOverlayPosition) {
    btnOverlayPosition.addEventListener('click', () => {
      overlayPositionTop = !overlayPositionTop;
      btnOverlayPosition.classList.toggle('active', overlayPositionTop);

      if (videoCommentRangeOverlay) {
        videoCommentRangeOverlay.classList.toggle('position-top', overlayPositionTop);
      }
    });
  }

  // 비디오 오버레이에 댓글 범위 렌더링
  function renderVideoCommentRanges() {
    if (!videoCommentRangeOverlay) return;

    const ranges = commentManager.getMarkerRanges();

    // 기존 요소 제거
    videoCommentRangeOverlay.innerHTML = '';

    // 댓글이 없으면 숨김
    if (!ranges || ranges.length === 0) {
      videoCommentRangeOverlay.classList.remove('visible');
      return;
    }

    // 오버레이 표시
    videoCommentRangeOverlay.classList.add('visible');

    const totalFrames = timeline.totalFrames || 1;

    // 플레이헤드 추가
    videoCommentPlayhead = document.createElement('div');
    videoCommentPlayhead.className = 'video-comment-range-playhead';
    videoCommentRangeOverlay.appendChild(videoCommentPlayhead);

    // 댓글 범위 바 생성
    ranges.forEach(comment => {
      const bar = document.createElement('div');
      bar.className = 'video-comment-range-bar';
      bar.dataset.layerId = comment.layerId;
      bar.dataset.markerId = comment.markerId;

      // resolved 상태
      if (comment.resolved) {
        bar.classList.add('resolved');
      }

      // 위치 및 크기 계산
      const leftPercent = (comment.startFrame / totalFrames) * 100;
      const widthPercent = ((comment.endFrame - comment.startFrame) / totalFrames) * 100;

      // 최소 너비 보장
      const minWidthPercent = Math.max(widthPercent, 1);

      // 색상 (레이어 색상)
      const color = comment.color || '#4a9eff';
      bar.style.left = `${leftPercent}%`;
      bar.style.width = `${minWidthPercent}%`;
      bar.style.background = hexToRgba(color, 0.6);
      bar.style.borderColor = hexToRgba(color, 0.8);

      // 클릭 이벤트 - 해당 프레임으로 이동 + 댓글 하이라이트
      bar.addEventListener('click', () => {
        const marker = commentManager.getMarker(comment.markerId);
        if (marker) {
          videoPlayer.seekToFrame(marker.startFrame);
          scrollToCommentWithGlow(comment.markerId);
        }
      });

      // 우클릭 이벤트 - 마커 색상 팝업
      bar.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMarkerPopup(comment.markerId, e.clientX, e.clientY);
      });

      videoCommentRangeOverlay.appendChild(bar);
    });

    // 초기 플레이헤드 위치 업데이트
    updateVideoCommentPlayhead();
  }

  // 플레이헤드 위치 업데이트
  function updateVideoCommentPlayhead() {
    if (!videoCommentPlayhead || !videoCommentRangeOverlay.classList.contains('visible')) return;

    const totalFrames = timeline.totalFrames || 1;
    const currentFrame = videoPlayer.currentFrame || 0;
    const leftPercent = (currentFrame / totalFrames) * 100;
    videoCommentPlayhead.style.left = `${leftPercent}%`;

    // 현재 프레임에 활성화된 댓글 범위 하이라이트
    const bars = videoCommentRangeOverlay.querySelectorAll('.video-comment-range-bar');
    bars.forEach(bar => {
      const markerId = bar.dataset.markerId;
      const marker = commentManager.getMarker(markerId);
      if (marker) {
        const isActive = currentFrame >= marker.startFrame && currentFrame <= marker.endFrame;
        bar.classList.toggle('active', isActive);
      }
    });
  }

  // HEX to RGBA 변환 헬퍼
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // 댓글 범위 렌더링 함수 (타임라인 + 비디오 오버레이)
  function renderCommentRanges() {
    const ranges = commentManager.getMarkerRanges();
    timeline.renderCommentRanges(ranges);
    setupCommentRangeInteractions();
    renderVideoCommentRanges();
  }

  // 댓글 범위 상호작용 설정 (드래그, 리사이즈, 클릭)
  function setupCommentRangeInteractions() {
    const items = commentTrack.querySelectorAll('.comment-range-item');

    items.forEach(item => {
      const layerId = item.dataset.layerId;
      const markerId = item.dataset.markerId;

      // 클릭 - 해당 댓글로 이동 및 선택 + 댓글 하이라이트
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('comment-handle')) return;

        // 해당 프레임으로 이동
        const marker = commentManager.getMarker(markerId);
        if (marker) {
          videoPlayer.seekToFrame(marker.startFrame);
          videoPlayer.pause();
          // 프리뷰 마커 클릭과 동일한 효과
          scrollToCommentWithGlow(markerId);
        }

        // 선택 표시
        items.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedCommentRange = { layerId, markerId };
      });

      // 우클릭 - 마커 색상 팝업
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMarkerPopup(markerId, e.clientX, e.clientY);
      });

      // 드래그 시작 (전체 이동)
      item.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('comment-handle')) return;
        if (e.button !== 0) return;

        e.preventDefault();
        const marker = commentManager.getMarker(markerId);
        if (!marker) return;

        commentDragState = {
          layerId,
          markerId,
          handle: 'move',
          startX: e.clientX,
          startFrame: marker.startFrame,
          endFrame: marker.endFrame,
          duration: marker.endFrame - marker.startFrame,
          // Undo용 원본 값 저장
          originalStartFrame: marker.startFrame,
          originalEndFrame: marker.endFrame
        };

        item.classList.add('dragging');
        document.body.style.cursor = 'grabbing';
      });

      // 핸들 드래그 시작 (리사이즈)
      const handles = item.querySelectorAll('.comment-handle');
      handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const marker = commentManager.getMarker(markerId);
          if (!marker) return;

          commentDragState = {
            layerId,
            markerId,
            handle: handle.dataset.handle, // 'left' or 'right'
            startX: e.clientX,
            startFrame: marker.startFrame,
            endFrame: marker.endFrame,
            duration: marker.endFrame - marker.startFrame,
            // Undo용 원본 값 저장
            originalStartFrame: marker.startFrame,
            originalEndFrame: marker.endFrame
          };

          item.classList.add('dragging');
          document.body.style.cursor = 'ew-resize';
        });
      });
    });
  }

  // 댓글 드래그 처리 (mousemove)
  document.addEventListener('mousemove', (e) => {
    if (!commentDragState) return;

    const { layerId, markerId, handle, startX, startFrame, endFrame, duration } = commentDragState;
    const trackRect = commentTrack.getBoundingClientRect();
    const totalFrames = timeline.totalFrames || 1;
    const deltaX = e.clientX - startX;
    const deltaFrames = Math.round((deltaX / trackRect.width) * totalFrames);
    const shiftKey = e.shiftKey; // Shift 키로 스냅 범위 확대

    let updates;

    if (handle === 'move') {
      // 전체 이동
      let newStart = Math.max(0, Math.min(totalFrames - duration, startFrame + deltaFrames));
      let newEnd = newStart + duration;

      // 마그넷 스냅 (시작점 또는 끝점이 플레이헤드에 가까우면 스냅)
      const snappedStart = snapFrameToPlayhead(newStart, shiftKey);
      const snappedEnd = snapFrameToPlayhead(newEnd, shiftKey);

      if (snappedStart !== newStart) {
        newStart = snappedStart;
        newEnd = snappedStart + duration;
      } else if (snappedEnd !== newEnd) {
        newEnd = snappedEnd;
        newStart = snappedEnd - duration;
      }

      updates = {
        startFrame: newStart,
        endFrame: newEnd
      };
    } else if (handle === 'left') {
      // 왼쪽 핸들 (시작점 조정)
      let newStart = Math.max(0, Math.min(endFrame - 1, startFrame + deltaFrames));
      newStart = snapFrameToPlayhead(newStart, shiftKey); // 마그넷 스냅
      updates = { startFrame: newStart };
    } else if (handle === 'right') {
      // 오른쪽 핸들 (종료점 조정)
      let newEnd = Math.max(startFrame + 1, Math.min(totalFrames, endFrame + deltaFrames));
      newEnd = snapFrameToPlayhead(newEnd, shiftKey); // 마그넷 스냅
      updates = { endFrame: newEnd };
    }

    // 마커 업데이트
    if (updates) {
      commentManager.updateMarker(markerId, updates);

      // 범위 정보로 업데이트
      const marker = commentManager.getMarker(markerId);
      const layer = commentManager.layers.find(l => l.id === layerId);
      if (marker && layer) {
        // 마커 개별 색상 사용 (없으면 레이어 색상)
        const markerColor = marker.colorInfo?.color || layer.color;
        timeline.updateCommentRangeElement({
          layerId,
          markerId,
          startFrame: marker.startFrame,
          endFrame: marker.endFrame,
          color: markerColor,
          text: marker.text,
          resolved: marker.resolved
        });
      }
    }
  });

  // 댓글 드래그 종료
  document.addEventListener('mouseup', () => {
    if (commentDragState) {
      const { layerId, markerId, originalStartFrame, originalEndFrame } = commentDragState;

      const item = commentTrack.querySelector(
        `[data-layer-id="${layerId}"][data-marker-id="${markerId}"]`
      );
      if (item) {
        item.classList.remove('dragging');
      }

      // 현재 마커의 새 값 가져오기
      const marker = commentManager.getMarker(markerId);
      if (marker) {
        const newStartFrame = marker.startFrame;
        const newEndFrame = marker.endFrame;

        // 값이 실제로 변경되었을 때만 Undo 스택에 추가
        if (newStartFrame !== originalStartFrame || newEndFrame !== originalEndFrame) {
          pushUndo({
            type: 'comment-range',
            data: { markerId, layerId },
            undo: () => {
              commentManager.updateMarker(markerId, {
                startFrame: originalStartFrame,
                endFrame: originalEndFrame
              });
              renderCommentRanges();
              reviewDataManager.save();
            },
            redo: () => {
              commentManager.updateMarker(markerId, {
                startFrame: newStartFrame,
                endFrame: newEndFrame
              });
              renderCommentRanges();
              reviewDataManager.save();
            }
          });
        }
      }

      commentDragState = null;
      document.body.style.cursor = '';

      // 데이터 저장
      reviewDataManager.save();
    }
  });

  // 댓글 매니저 이벤트 수신 - 마커 변경 시 렌더링
  commentManager.addEventListener('markerAdded', () => {
    renderCommentRanges();
  });

  commentManager.addEventListener('markerUpdated', () => {
    renderCommentRanges();
  });

  commentManager.addEventListener('markerDeleted', () => {
    renderCommentRanges();
  });

  commentManager.addEventListener('loaded', () => {
    renderCommentRanges();
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

  // ====== 트랜스코딩 상태 관리 ======
  let isTranscoding = false;
  let transcodeResolve = null;

  /**
   * 트랜스코딩 오버레이 표시 및 진행
   * @param {string} filePath - 원본 파일 경로
   * @param {string} codecName - 원본 코덱 이름
   * @returns {Promise<{success: boolean, outputPath?: string, error?: string}>}
   */
  async function showTranscodeOverlay(filePath, codecName) {
    const overlay = document.getElementById('transcodeOverlay');
    const subtitle = document.getElementById('transcodeSubtitle');
    const progressFill = document.getElementById('transcodeProgressFill');
    const percentText = document.getElementById('transcodePercent');
    const statusText = document.getElementById('transcodeStatus');
    const cancelBtn = document.getElementById('btnCancelTranscode');

    // UI 초기화
    subtitle.textContent = `${codecName.toUpperCase()} → H.264`;
    progressFill.style.width = '0%';
    percentText.textContent = '0%';
    statusText.textContent = '변환 준비 중...';
    overlay.classList.add('active');
    isTranscoding = true;

    // 진행률 이벤트 리스너
    const progressHandler = (data) => {
      if (data.filePath === filePath) {
        progressFill.style.width = `${data.progress}%`;
        percentText.textContent = `${data.progress}%`;
        statusText.textContent = data.progress < 100 ? '변환 중...' : '완료 처리 중...';
      }
    };
    window.electronAPI.onTranscodeProgress(progressHandler);

    // 취소 버튼 핸들러
    const handleCancel = async () => {
      log.info('사용자가 트랜스코딩 취소 요청');
      await window.electronAPI.ffmpegCancel();
      isTranscoding = false;
      overlay.classList.remove('active');
      window.electronAPI.removeAllListeners('ffmpeg:transcode-progress');
      if (transcodeResolve) {
        transcodeResolve({ success: false, error: '사용자 취소' });
        transcodeResolve = null;
      }
    };
    cancelBtn.addEventListener('click', handleCancel, { once: true });

    return new Promise(async (resolve) => {
      transcodeResolve = resolve;

      try {
        const result = await window.electronAPI.ffmpegTranscode(filePath);

        isTranscoding = false;
        overlay.classList.remove('active');
        window.electronAPI.removeAllListeners('ffmpeg:transcode-progress');
        cancelBtn.removeEventListener('click', handleCancel);

        if (result.success) {
          log.info('트랜스코딩 완료', { outputPath: result.outputPath, fromCache: result.fromCache });
          resolve({ success: true, outputPath: result.outputPath });
        } else {
          log.error('트랜스코딩 실패', { error: result.error });
          resolve({ success: false, error: result.error });
        }
      } catch (error) {
        isTranscoding = false;
        overlay.classList.remove('active');
        window.electronAPI.removeAllListeners('ffmpeg:transcode-progress');
        cancelBtn.removeEventListener('click', handleCancel);

        log.error('트랜스코딩 예외', { error: error.message });
        resolve({ success: false, error: error.message });
      }

      transcodeResolve = null;
    });
  }

  /**
   * 비디오 파일 로드
   * @param {string} filePath - 파일 경로
   * @param {Object} options - 옵션
   * @param {boolean} options.keepVersionContext - 버전 컨텍스트 유지 (수동 버전 전환 시 사용)
   * @param {number} options.targetVersion - 전환할 버전 번호 (수동 버전 선택 시)
   */
  async function loadVideo(filePath, options = {}) {
    const { keepVersionContext = false, targetVersion = null } = options;
    const trace = log.trace('loadVideo');
    try {
      // 파일 정보 가져오기
      const fileInfo = await window.electronAPI.getFileInfo(filePath);

      // ====== 코덱 확인 및 트랜스코딩 ======
      let actualVideoPath = filePath;
      const ffmpegAvailable = await window.electronAPI.ffmpegIsAvailable();

      if (ffmpegAvailable) {
        const codecInfo = await window.electronAPI.ffmpegProbeCodec(filePath);

        if (codecInfo.success && !codecInfo.isSupported) {
          log.info('미지원 코덱 감지, 트랜스코딩 필요', { codec: codecInfo.codecName });

          // 캐시 확인
          const cacheResult = await window.electronAPI.ffmpegCheckCache(filePath);
          if (cacheResult.valid) {
            log.info('캐시된 변환 파일 사용', { path: cacheResult.convertedPath });
            actualVideoPath = cacheResult.convertedPath;
          } else {
            // 트랜스코딩 필요 - UI 표시
            const transcoded = await showTranscodeOverlay(filePath, codecInfo.codecName);
            if (transcoded.success) {
              actualVideoPath = transcoded.outputPath;
            } else {
              // 트랜스코딩 실패 또는 취소
              log.warn('트랜스코딩 실패 또는 취소', { error: transcoded.error });
              showToast(`코덱 변환 실패: ${transcoded.error || '취소됨'}`, 'error');
              return;
            }
          }
        }
      } else {
        log.debug('FFmpeg 사용 불가, 코덱 변환 건너뜀');
      }

      // ====== 이전 데이터 저장 (clear 전에 수행!) ======
      // 저장되지 않은 변경사항이 있으면 먼저 저장
      if (reviewDataManager.hasUnsavedChanges()) {
        log.info('파일 전환 전 변경사항 저장 시도');
        const saved = await reviewDataManager.save();
        if (!saved) {
          // 저장 실패 시 사용자에게 확인
          const proceed = confirm('현재 파일 저장에 실패했습니다. 저장하지 않고 전환할까요?');
          if (!proceed) {
            log.info('사용자가 파일 전환 취소');
            return;
          }
          log.warn('저장 실패했지만 사용자가 전환 진행 선택');
        }
      }

      // ====== 이전 파일 감시 및 협업 세션 정리 (누적 방지) ======
      if (reviewDataManager.currentBframePath) {
        await window.electronAPI.watchFileStop(reviewDataManager.currentBframePath);
        log.info('이전 파일 감시 중지', { path: reviewDataManager.currentBframePath });
        await collaborationManager.stop();
        log.info('이전 협업 세션 종료');
      }

      // ====== 이전 데이터 초기화 ======
      // 자동 저장 일시 중지 (초기화 중 빈 데이터가 저장되는 것 방지)
      reviewDataManager.pauseAutoSave();

      // 댓글 매니저 초기화
      commentManager.clear();
      // 그리기 매니저 초기화
      drawingManager.reset();
      // 하이라이트 매니저 초기화
      highlightManager.reset();
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

      // 비디오 플레이어에 로드 (트랜스코딩된 경우 변환된 파일 사용)
      await videoPlayer.load(actualVideoPath);

      // 원본 파일 경로 저장 (UI/메타데이터용)
      state.currentFile = filePath;
      elements.fileName.textContent = fileInfo.name;
      elements.fileName.classList.remove('file-name-clickable'); // 파일 로드 후 클릭 가능 상태 제거
      elements.filePath.textContent = fileInfo.dir;
      elements.dropZone.classList.add('hidden');

      // 폴더 열기 / 다른 파일 열기 버튼 표시
      elements.btnOpenFolder.style.display = 'flex';
      elements.btnOpenOther.style.display = 'flex';

      // 버전 감지 및 드롭다운 초기화 (version-parser/manager/dropdown 모듈 사용)
      const versionResult = parseVersion(fileInfo.name);
      const versionManager = getVersionManager();
      const versionDropdown = getVersionDropdown();

      // keepVersionContext가 true면 폴더 스캔 건너뛰기 (버전 목록 유지)
      if (!keepVersionContext) {
        // VersionManager에 현재 파일 설정 (폴더 스캔 포함)
        await versionManager.setCurrentFile(filePath);
      } else {
        log.info('버전 컨텍스트 유지 모드 - 폴더 스캔 건너뜀');
      }

      // versionInfo를 reviewDataManager에 설정
      reviewDataManager.setVersionInfo(toVersionInfo(fileInfo.name));

      // 버전 드롭다운 표시 및 버전 선택 콜백 설정
      // keepVersionContext일 때는 targetVersion 사용, 아니면 파일명에서 파싱한 버전 사용
      const displayVersion = keepVersionContext && targetVersion !== null
        ? targetVersion
        : versionResult.version;
      versionDropdown.show(displayVersion);
      versionDropdown.onVersionSelect(async (versionInfo) => {
        log.info('버전 전환 요청', versionInfo);
        if (versionInfo.path) {
          // 버전 컨텍스트 유지하고, 해당 버전 번호도 함께 전달
          await loadVideo(versionInfo.path, {
            keepVersionContext: true,
            targetVersion: versionInfo.version
          });
        }
      });

      // 비디오 트랙 업데이트
      elements.videoTrackClip.textContent = `📹 ${fileInfo.name}`;

      // 썸네일 생성 시작 (트랜스코딩된 경우 변환된 파일 사용)
      await generateThumbnails(actualVideoPath);

      // .bframe 파일 로드 시도 (이미 저장했으므로 skipSave: true)
      const hasExistingData = await reviewDataManager.setVideoFile(filePath, { skipSave: true });

      // keepVersionContext가 false일 때만 manualVersions 복원
      // (true면 기존 버전 목록 유지)
      if (!keepVersionContext) {
        // .bframe에서 manualVersions 복원 → version-manager에 설정
        const savedManualVersions = reviewDataManager.getManualVersions();
        if (savedManualVersions && savedManualVersions.length > 0) {
          versionManager.setManualVersions(savedManualVersions);
          log.info('수동 버전 목록 복원됨', { count: savedManualVersions.length });
        }
      }
      // 드롭다운 다시 렌더링 (버전 목록 갱신)
      versionDropdown._render();

      if (hasExistingData) {
        showToast(`"${fileInfo.name}" 로드됨 (리뷰 데이터 복원)`, 'success');
      } else {
        showToast(`"${fileInfo.name}" 로드됨`, 'success');
      }

      // ====== 협업 세션 시작 ======
      const userName = userSettings.userName || '익명';
      await collaborationManager.start(reviewDataManager.currentBframePath, userName);

      // ====== 파일 감시 시작 (실시간 동기화) ======
      if (reviewDataManager.currentBframePath) {
        await window.electronAPI.watchFileStart(reviewDataManager.currentBframePath);
        log.info('파일 감시 시작됨', { path: reviewDataManager.currentBframePath });
      }

      // 마커 및 그리기 렌더링 업데이트 (항상 실행)
      renderVideoMarkers();
      updateTimelineMarkers();
      updateCommentList();
      // 그리기 레이어 UI 및 캔버스 다시 렌더링
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      drawingManager.renderFrame(videoPlayer.currentFrame);

      // 하이라이트 매니저 영상 정보 설정 및 렌더링
      highlightManager.setVideoInfo(videoPlayer.duration, videoPlayer.fps);
      renderHighlights();

      // 댓글 범위 렌더링
      renderCommentRanges();

      trace.end({ filePath, hasExistingData });

    } catch (error) {
      trace.error(error);
      // 에러 발생 시에도 자동 저장 재개
      reviewDataManager.resumeAutoSave();
      showToast('파일을 로드할 수 없습니다.', 'error');
    }
  }

  // 썸네일 리스너 참조 저장 (파일 전환 시 정리용)
  const thumbnailListeners = {
    progress: null,
    quickReady: null,
    complete: null
  };

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

      // 이전 리스너 정리 (파일 전환 시 누적 방지)
      if (thumbnailListeners.progress) {
        thumbnailGenerator.removeEventListener('progress', thumbnailListeners.progress);
      }
      if (thumbnailListeners.quickReady) {
        thumbnailGenerator.removeEventListener('quickReady', thumbnailListeners.quickReady);
      }
      if (thumbnailListeners.complete) {
        thumbnailGenerator.removeEventListener('complete', thumbnailListeners.complete);
      }

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

      // 리스너 참조 저장 (다음 파일 전환 시 정리용)
      thumbnailListeners.progress = onProgress;
      thumbnailListeners.quickReady = onQuickReady;
      thumbnailListeners.complete = onComplete;

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
    // Math.round로 부동소수점 오차 방지
    const totalFrames = Math.round(seconds * fps);
    const f = totalFrames % fps;
    const totalSeconds = Math.floor(totalFrames / fps);
    const s = totalSeconds % 60;
    const m = Math.floor((totalSeconds % 3600) / 60);
    const h = Math.floor(totalSeconds / 3600);

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
    // 그리기 모드에서 댓글 마커 클릭 방지
    markerContainer.classList.toggle('drawing-active', state.isDrawMode);
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
   * 전체화면 모드 토글 (시스템 전체화면)
   */
  let fullscreenMouseHandler = null;
  let fullscreenTimecodeOverlay = null;

  async function toggleFullscreen() {
    // Electron 시스템 전체화면 API 호출
    await window.electronAPI.toggleFullscreen();
    const isFullscreen = await window.electronAPI.isFullscreen();

    state.isFullscreen = isFullscreen;
    document.body.classList.toggle('app-fullscreen', isFullscreen);

    if (isFullscreen) {
      showToast('전체화면 모드 (C: 댓글 추가, F 또는 ESC: 해제)', 'info');

      // 타임코드 오버레이 생성
      fullscreenTimecodeOverlay = document.createElement('div');
      fullscreenTimecodeOverlay.className = 'fullscreen-timecode-overlay';
      fullscreenTimecodeOverlay.innerHTML = `
        <span class="current-time">00:00:00:00</span>
        <span class="separator">/</span>
        <span class="total-time">00:00:00:00</span>
      `;
      document.body.appendChild(fullscreenTimecodeOverlay);
      updateFullscreenTimecode();

      // 마우스 이동 감지 - 하단 80px 이내면 컨트롤바 표시
      fullscreenMouseHandler = (e) => {
        const bottomThreshold = 80;
        const isNearBottom = window.innerHeight - e.clientY < bottomThreshold;

        if (isNearBottom) {
          document.body.classList.add('show-controls');
        } else {
          document.body.classList.remove('show-controls');
        }
      };
      document.addEventListener('mousemove', fullscreenMouseHandler);
    } else {
      // 전체화면 해제 시 이벤트 리스너 제거
      if (fullscreenMouseHandler) {
        document.removeEventListener('mousemove', fullscreenMouseHandler);
        fullscreenMouseHandler = null;
      }
      // 타임코드 오버레이 제거
      if (fullscreenTimecodeOverlay) {
        fullscreenTimecodeOverlay.remove();
        fullscreenTimecodeOverlay = null;
      }
      document.body.classList.remove('show-controls');
    }

    log.debug('전체화면 모드 변경', { isFullscreen });
  }

  /**
   * 전체화면 타임코드 업데이트
   */
  function updateFullscreenTimecode() {
    if (!fullscreenTimecodeOverlay) return;

    const currentTime = videoPlayer.currentTime || 0;
    const duration = videoPlayer.duration || 0;
    const fps = videoPlayer.fps || 24;

    const formatTimecode = (seconds) => {
      const totalFrames = Math.round(seconds * fps);
      const f = totalFrames % fps;
      const totalSeconds = Math.floor(totalFrames / fps);
      const s = totalSeconds % 60;
      const m = Math.floor((totalSeconds % 3600) / 60);
      const h = Math.floor(totalSeconds / 3600);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
    };

    fullscreenTimecodeOverlay.querySelector('.current-time').textContent = formatTimecode(currentTime);
    fullscreenTimecodeOverlay.querySelector('.total-time').textContent = formatTimecode(duration);
  }

  /**
   * 전체화면 시크바 업데이트
   */
  function updateFullscreenSeekbar() {
    const seekbarProgress = document.getElementById('seekbarProgress');
    const seekbarHandle = document.getElementById('seekbarHandle');
    if (!seekbarProgress || !seekbarHandle) return;

    const duration = videoPlayer.duration || 0;
    const currentTime = videoPlayer.currentTime || 0;
    if (duration === 0) return;

    const percent = (currentTime / duration) * 100;
    seekbarProgress.style.width = `${percent}%`;
    seekbarHandle.style.left = `${percent}%`;
  }

  // 전체화면 시크바 이벤트 설정
  const fullscreenSeekbar = document.getElementById('fullscreenSeekbar');
  if (fullscreenSeekbar) {
    let isSeeking = false;

    const seekToPosition = (e) => {
      const rect = fullscreenSeekbar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const duration = videoPlayer.duration || 0;
      if (duration > 0) {
        videoPlayer.seek(percent * duration);
      }
    };

    fullscreenSeekbar.addEventListener('mousedown', (e) => {
      isSeeking = true;
      seekToPosition(e);
    });

    document.addEventListener('mousemove', (e) => {
      if (isSeeking) {
        seekToPosition(e);
      }
    });

    document.addEventListener('mouseup', () => {
      isSeeking = false;
    });

    fullscreenSeekbar.addEventListener('click', seekToPosition);
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
    // body에 있는 기존 툴팁들도 제거
    document.querySelectorAll('.comment-marker-tooltip').forEach(el => el.remove());

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

    // 말풍선 (툴팁) - body에 추가하여 transform 영향 안받게
    const tooltip = document.createElement('div');
    tooltip.className = 'comment-marker-tooltip';
    tooltip.dataset.markerId = marker.id;
    const authorClass = getAuthorColorClass(marker.author);
    tooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-timecode">${marker.startTimecode}</span>
        <span class="tooltip-author ${authorClass}">${escapeHtml(marker.author)}</span>
      </div>
      <div class="tooltip-text">${escapeHtml(marker.text)}</div>
      <div class="tooltip-actions">
        <button class="tooltip-btn resolve" title="${marker.resolved ? '미해결로 변경' : '해결'}">
          ${marker.resolved ? '↩️' : '✓'}
        </button>
        <button class="tooltip-btn delete" title="삭제">🗑️</button>
      </div>
    `;

    // 툴팁을 body에 추가 (markerEl 내부가 아님)
    document.body.appendChild(tooltip);

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

    // 드래그 상태
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let markerStartX = marker.x;
    let markerStartY = marker.y;

    // 드래그 중 (마우스 이동)
    const onMouseMove = (e) => {
      if (!isDragging) return;

      const rect = markerContainer.getBoundingClientRect();
      const deltaX = (e.clientX - dragStartX) / rect.width;
      const deltaY = (e.clientY - dragStartY) / rect.height;

      // 새 위치 계산 (0~1 범위로 제한)
      const newX = Math.max(0, Math.min(1, markerStartX + deltaX));
      const newY = Math.max(0, Math.min(1, markerStartY + deltaY));

      // 마커 요소 위치 업데이트
      markerEl.style.left = `${newX * 100}%`;
      markerEl.style.top = `${newY * 100}%`;
    };

    // 드래그 종료 (마우스 업)
    const onMouseUp = (e) => {
      if (!isDragging) return;

      isDragging = false;
      markerEl.classList.remove('dragging');
      document.body.style.cursor = '';

      const rect = markerContainer.getBoundingClientRect();
      const deltaX = (e.clientX - dragStartX) / rect.width;
      const deltaY = (e.clientY - dragStartY) / rect.height;

      const newX = Math.max(0, Math.min(1, markerStartX + deltaX));
      const newY = Math.max(0, Math.min(1, markerStartY + deltaY));

      // 위치가 변경되었으면 저장 (재렌더링 없이 직접 업데이트)
      if (newX !== markerStartX || newY !== markerStartY) {
        marker.x = newX;
        marker.y = newY;
        markerStartX = newX;
        markerStartY = newY;
        // 타임라인 마커만 업데이트 (비디오 마커 재렌더링 안함)
        updateTimelineMarkers();
        // 데이터 자동 저장
        reviewDataManager.save();
        log.info('마커 위치 변경 및 저장', { markerId: marker.id, x: newX, y: newY });
      }

      // 이벤트 리스너 제거
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    // 드래그 시작 (마우스 다운)
    markerEl.addEventListener('mousedown', (e) => {
      // 툴팁 버튼 클릭은 무시
      if (e.target.closest('.tooltip-btn') || e.target.closest('.marker-replies-badge')) return;

      // 현재 프레임에서 마커가 보이지 않으면 드래그 무시
      const currentFrame = videoPlayer.currentFrame;
      if (!marker.isVisibleAtFrame(currentFrame)) return;

      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      markerStartX = marker.x;
      markerStartY = marker.y;

      // 드래그 중 툴팁 숨기기
      tooltip.classList.remove('visible');
      markerEl.classList.add('dragging');
      document.body.style.cursor = 'grabbing';

      // document에 이벤트 추가
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // 툴팁 위치 계산 함수
    const positionTooltip = () => {
      const markerRect = markerEl.getBoundingClientRect();
      const tooltipWidth = 280; // CSS max-width
      const padding = 12;

      // 기본: 마커 오른쪽에 배치
      let left = markerRect.right + padding;
      const top = markerRect.top + markerRect.height / 2;

      // 화면 오른쪽 밖으로 나가면 왼쪽에 배치
      if (left + tooltipWidth > window.innerWidth - 20) {
        left = markerRect.left - tooltipWidth - padding;
        tooltip.classList.add('left-side');
      } else {
        tooltip.classList.remove('left-side');
      }

      tooltip.style.left = `${Math.max(10, left)}px`;
      tooltip.style.top = `${top}px`;
    };

    // 호버 이벤트 - 말풍선 표시
    let hideTimeout = null;

    const showTooltipHover = () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      // 현재 프레임에서 마커가 보이지 않으면 툴팁 안보임
      const currentFrame = videoPlayer.currentFrame;
      if (!marker.isVisibleAtFrame(currentFrame)) return;

      if (!marker.pinned && !isDragging) {
        positionTooltip();
        tooltip.classList.add('visible');
      }
    };

    const hideTooltipHover = () => {
      if (!marker.pinned && !isDragging) {
        hideTimeout = setTimeout(() => {
          tooltip.classList.remove('visible');
        }, 100); // 100ms 딜레이로 툴팁으로 이동할 시간 확보
      }
    };

    markerEl.addEventListener('mouseenter', showTooltipHover);
    markerEl.addEventListener('mouseleave', hideTooltipHover);

    // 툴팁 호버 시에도 유지
    tooltip.addEventListener('mouseenter', showTooltipHover);
    tooltip.addEventListener('mouseleave', hideTooltipHover);

    // 클릭 - 우측 댓글로 스크롤 및 고정 토글
    markerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.tooltip-btn')) return;

      // 드래그 후 클릭은 무시 (드래그 종료 시 클릭 이벤트 발생 방지)
      if (markerEl.classList.contains('dragging')) return;

      // 현재 프레임에서 마커가 보이지 않으면 클릭 무시
      const currentFrame = videoPlayer.currentFrame;
      if (!marker.isVisibleAtFrame(currentFrame)) {
        log.debug('마커 클릭 무시 - 현재 프레임에서 보이지 않음', {
          markerId: marker.id,
          currentFrame,
          startFrame: marker.startFrame,
          endFrame: marker.endFrame
        });
        return;
      }

      // 우측 댓글 패널로 스크롤 및 글로우 효과
      scrollToCommentWithGlow(marker.id);
    });

    // 우클릭 - 마커 색상 팝업
    markerEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMarkerPopup(marker.id, e.clientX, e.clientY);
    });

    // 해결 버튼
    tooltip.querySelector('.tooltip-btn.resolve')?.addEventListener('click', (e) => {
      e.stopPropagation();
      commentManager.toggleMarkerResolved(marker.id);
    });

    // 삭제 버튼
    tooltip.querySelector('.tooltip-btn.delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('댓글을 삭제하시겠습니까?')) {
        const markerData = marker.toJSON();
        commentManager.deleteMarker(marker.id);

        // UI 업데이트
        updateCommentList();
        updateTimelineMarkers();
        renderVideoMarkers();

        // 삭제 상태 저장 (협업 동기화용)
        await reviewDataManager.save();

        // Undo 스택에 추가
        pushUndo({
          type: 'DELETE_COMMENT',
          data: markerData,
          undo: async () => {
            commentManager.restoreMarker(markerData);
            updateCommentList();
            updateTimelineMarkers();
            renderVideoMarkers();
            await reviewDataManager.save();
          },
          redo: async () => {
            commentManager.deleteMarker(markerData.id);
            updateCommentList();
            updateTimelineMarkers();
            renderVideoMarkers();
            await reviewDataManager.save();
          }
        });
        showToast('댓글이 삭제되었습니다.', 'info');
      }
    });

    // 마커 객체에 DOM 요소 참조 저장
    marker.element = markerEl;
    marker.tooltipElement = tooltip;
    marker.positionTooltip = positionTooltip;

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
        // 마커가 숨겨지면 툴팁도 숨김
        if (marker && marker.tooltipElement && !marker.pinned) {
          marker.tooltipElement.classList.remove('visible');
        }
      }
    });
  }

  /**
   * 마커 툴팁 상태 업데이트 (고정 상태)
   */
  function updateMarkerTooltipState(marker) {
    if (marker.tooltipElement) {
      if (marker.pinned) {
        // 핀 상태일 때 위치 재계산
        if (marker.positionTooltip) {
          marker.positionTooltip();
        }
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
   * 클러스터링 기반 렌더링 - 줌 레벨에 따라 가까운 마커 그룹화
   */
  function updateTimelineMarkers() {
    const ranges = commentManager.getMarkerRanges();
    const fps = videoPlayer.fps || 24;

    // 프레임별로 마커 그룹화
    const frameMap = new Map();
    ranges.forEach(range => {
      if (!frameMap.has(range.startFrame)) {
        frameMap.set(range.startFrame, []);
      }
      frameMap.get(range.startFrame).push(range);
    });

    // 클러스터링용 마커 데이터 배열 생성
    const allMarkerData = [];
    frameMap.forEach((markersAtFrame, frame) => {
      const time = frame / fps;
      const allResolved = markersAtFrame.every(m => m.resolved);
      allMarkerData.push({
        time,
        frame,
        resolved: allResolved,
        infos: markersAtFrame
      });
    });

    // 클러스터링된 마커 렌더링
    timeline.renderClusteredCommentMarkers(allMarkerData);
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

  // ========== 가상 스크롤 상태 ==========
  const virtualScrollState = {
    allMarkers: [],
    filteredMarkers: [],
    renderedRange: { start: 0, end: 0 },
    itemHeight: 120, // 예상 아이템 높이
    bufferSize: 5,   // 위아래 버퍼
    currentFilter: 'all',
    scrollHandler: null
  };

  // 피드백 완료율 업데이트
  function updateFeedbackProgress(total, resolved) {
    if (!elements.feedbackProgress) return;

    // 댓글이 없으면 프로그레스 바 숨김
    if (total === 0) {
      elements.feedbackProgress.classList.add('hidden');
      return;
    }

    elements.feedbackProgress.classList.remove('hidden');

    const percent = Math.round((resolved / total) * 100);
    elements.feedbackProgressValue.textContent = `${percent}% (${resolved}/${total})`;
    elements.feedbackProgressFill.style.width = `${percent}%`;
  }

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
    const resolvedCount = allMarkers.filter(m => m.resolved).length;
    if (elements.commentCount) {
      elements.commentCount.textContent = allMarkers.length > 0
        ? `${unresolvedCount > 0 ? unresolvedCount + ' 미해결 / ' : ''}${allMarkers.length}개`
        : '0';
    }

    // 피드백 완료율 업데이트
    updateFeedbackProgress(allMarkers.length, resolvedCount);

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

    // 가상 스크롤 상태 저장
    virtualScrollState.filteredMarkers = markers;
    virtualScrollState.currentFilter = filter;

    // 댓글 개수 경고 (성능 최적화 권장)
    const COMMENT_THRESHOLD = 100;
    if (markers.length > COMMENT_THRESHOLD) {
      log.warn(`댓글 ${markers.length}개 - 성능 저하 가능`, {
        threshold: COMMENT_THRESHOLD
      });
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
            <span class="comment-reply-author ${getAuthorColorClass(reply.author)}" ${getAuthorColorStyle(reply.author)}>${escapeHtml(reply.author)}</span>
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
      <div class="comment-item ${marker.resolved ? 'resolved' : ''} ${avatarImage ? 'has-avatar' : ''} ${thumbnailUrl ? 'has-thumbnail' : ''} ${marker.image ? 'has-image' : ''}" data-marker-id="${marker.id}" data-start-frame="${marker.startFrame}">
        ${avatarImage ? `<div class="comment-avatar-bg" style="background-image: url('${avatarImage}')"></div>` : ''}
        <button class="comment-resolve-toggle resolve-btn" title="${marker.resolved ? '미해결로 변경' : '해결됨으로 변경'}">
          ${marker.resolved ? '✓ 해결됨' : '○ 미해결'}
        </button>
        ${thumbnailHtml}
        <div class="comment-header">
          <span class="comment-timecode">${marker.startTimecode}</span>
        </div>
        <div class="comment-content">
          <p class="comment-text">${escapeHtml(marker.text)}</p>
          ${marker.image ? `<div class="comment-attached-image"><img src="${marker.image}" alt="첨부 이미지" data-full-image="${marker.image}"></div>` : ''}
        </div>
        <div class="comment-edit-form" style="display: none;">
          <textarea class="comment-edit-textarea" rows="3">${escapeHtml(marker.text)}</textarea>
          <div class="comment-edit-actions">
            <button class="comment-edit-save">저장</button>
            <button class="comment-edit-cancel">취소</button>
          </div>
        </div>
        <div class="comment-actions">
          <span class="comment-author-inline ${authorClass}" ${authorStyle}>${escapeHtml(marker.author)}</span>
          <span class="comment-time-inline">${formatRelativeTime(marker.createdAt)}</span>
          <button class="comment-action-btn edit-btn" title="수정">수정</button>
          <button class="comment-action-btn reply-btn" title="답글">답글</button>
          <button class="comment-action-btn delete-btn" title="삭제">삭제</button>
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
        videoPlayer.seekToFrame(frame);
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
      item.querySelector('.delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('댓글을 삭제하시겠습니까?')) {
          const markerId = item.dataset.markerId;
          const marker = commentManager.getMarker(markerId);
          if (marker) {
            const markerData = marker.toJSON();
            commentManager.deleteMarker(markerId);

            // UI 업데이트
            updateCommentList();
            updateTimelineMarkers();
            renderVideoMarkers();

            // 삭제 상태 저장 (협업 동기화용)
            await reviewDataManager.save();

            // Undo 스택에 추가
            pushUndo({
              type: 'DELETE_COMMENT',
              data: markerData,
              undo: async () => {
                commentManager.restoreMarker(markerData);
                updateCommentList();
                updateTimelineMarkers();
                renderVideoMarkers();
                await reviewDataManager.save();
              },
              redo: async () => {
                commentManager.deleteMarker(markerData.id);
                updateCommentList();
                updateTimelineMarkers();
                renderVideoMarkers();
                await reviewDataManager.save();
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

      editBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const markerId = item.dataset.markerId;

        // 편집 잠금 획득 시도 (이미 잠금 여부 체크 포함)
        const startResult = await collaborationManager.startEditing(markerId);
        if (!startResult.success) {
          showToast(`${startResult.lockedBy}님이 수정 중입니다`, 'warn');
          return;
        }

        // 수정 모드 진입
        contentEl.style.display = 'none';
        actionsEl.style.display = 'none';
        editFormEl.style.display = 'block';
        editTextarea.focus();
        editTextarea.select();
      });

      // 수정 저장
      item.querySelector('.comment-edit-save')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const markerId = item.dataset.markerId;
        const newText = editTextarea.value.trim();

        if (newText) {
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

            // 수정 후 UI 업데이트
            updateCommentList();
            renderVideoMarkers();
            updateTimelineMarkers();

            showToast('댓글이 수정되었습니다.', 'success');
          }
        }

        // 편집 잠금 해제
        await collaborationManager.stopEditing(markerId);
      });

      // 수정 취소
      item.querySelector('.comment-edit-cancel')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const markerId = item.dataset.markerId;

        // 편집 잠금 해제
        await collaborationManager.stopEditing(markerId);

        // 원래 상태로 복원
        contentEl.style.display = 'block';
        actionsEl.style.display = 'flex';
        editFormEl.style.display = 'none';
        // 원래 텍스트로 복원
        const marker = commentManager.getMarker(markerId);
        if (marker) {
          editTextarea.value = marker.text;
        }
      });

      // Textarea에서 Escape로 취소
      editTextarea?.addEventListener('keydown', (e) => {
        // 이미 처리 중이면 무시 (중복 호출 방지)
        if (editFormEl.style.display === 'none') return;

        if (e.key === 'Escape') {
          e.stopPropagation();
          const cancelBtn = item.querySelector('.comment-edit-cancel');
          if (!cancelBtn.disabled) {
            cancelBtn.click();
          }
        } else if (e.key === 'Enter' && e.ctrlKey) {
          // Ctrl+Enter로 저장
          e.stopPropagation();
          e.preventDefault();
          const saveBtn = item.querySelector('.comment-edit-save');
          if (!saveBtn.disabled) {
            saveBtn.click();
          }
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
   * 특정 댓글로 스크롤하고 글로우 효과 표시
   */
  function scrollToCommentWithGlow(markerId) {
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

      // 글로우 효과
      commentItem.classList.add('glow');
      setTimeout(() => {
        commentItem.classList.remove('glow');
      }, 1500);
    }
  }

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

    // pending 마커 입력 중이면 단축키 무시 (textarea 포커스 전에도 적용)
    if (commentManager.pendingMarker) return;

    // 스레드 팝업이 열려있으면 단축키 무시
    const threadOverlay = document.getElementById('threadOverlay');
    if (threadOverlay?.classList.contains('open')) return;

    // 스플릿 뷰가 열려있으면 단축키 무시 (스플릿 뷰에서 자체 처리)
    const splitViewManager = getSplitViewManager();
    if (splitViewManager.isOpen()) return;

    // ====== 공통 단축키 ======
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

    case 'KeyH':
      // 하이라이트 추가
      e.preventDefault();
      btnAddHighlight.click();
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

    case 'KeyS':
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+S: 수동 저장
        e.preventDefault();
        if (reviewDataManager.getBframePath()) {
          reviewDataManager.save().then(saved => {
            if (saved) {
              showToast('저장되었습니다', 'success');
            }
          });
        } else {
          showToast('저장할 파일이 없습니다', 'warn');
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

    // 사용자 정의 단축키 처리 (F6, F7 등)
    default:
      // 키프레임 추가 (복사) - F6
      if (userSettings.matchShortcut('keyframeAddWithCopy', e)) {
        e.preventDefault();
        if (state.isDrawMode) {
          drawingManager.addKeyframeWithContent();
          showToast('키프레임 추가됨', 'success');
        }
        return;
      }
      // 빈 키프레임 추가 - F7
      if (userSettings.matchShortcut('keyframeAddBlank', e)) {
        e.preventDefault();
        if (state.isDrawMode) {
          drawingManager.addBlankKeyframe();
          showToast('빈 키프레임 추가됨', 'success');
        }
        return;
      }
      break;
    }

    // ====== 프레임 이동 및 그리기 모드 단축키 ======
    switch (e.code) {
    case 'ArrowLeft':
      e.preventDefault();
      if (e.ctrlKey) {
        // Ctrl+←: 초 단위 뒤로 이동
        const secondAmount = userSettings.getSecondSkipAmount();
        const newTime = Math.max(0, (videoPlayer.currentTime || 0) - secondAmount);
        videoPlayer.seek(newTime);
        timeline.scrollToPlayhead();
        log.info('초 단위 뒤로 이동 (단축키)', { seconds: secondAmount, newTime });
      } else if (e.shiftKey) {
        // Shift+←: 프레임 빨리 뒤로 이동
        const frameAmount = userSettings.getFrameSkipAmount();
        const currentFrame = videoPlayer.currentFrame || 0;
        const newFrame = Math.max(0, currentFrame - frameAmount);
        videoPlayer.seekToFrame(newFrame);
        timeline.scrollToPlayhead();
        log.info('프레임 빨리 뒤로 이동 (단축키)', { frames: frameAmount, newFrame });
      } else if (e.altKey) {
        // Alt+←: 이전 하이라이트로 이동
        const prevHighlightTime = highlightManager.getPrevHighlightTime(videoPlayer.currentTime || 0);
        if (prevHighlightTime !== null) {
          videoPlayer.seek(prevHighlightTime);
          timeline.scrollToPlayhead();
          log.info('이전 하이라이트로 이동 (단축키)', { time: prevHighlightTime });
        } else {
          showToast('이전 하이라이트가 없습니다', 'info');
        }
      } else {
        videoPlayer.prevFrame();
      }
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (e.ctrlKey) {
        // Ctrl+→: 초 단위 앞으로 이동
        const secondAmount = userSettings.getSecondSkipAmount();
        const duration = videoPlayer.duration || 0;
        const newTime = Math.min(duration, (videoPlayer.currentTime || 0) + secondAmount);
        videoPlayer.seek(newTime);
        timeline.scrollToPlayhead();
        log.info('초 단위 앞으로 이동 (단축키)', { seconds: secondAmount, newTime });
      } else if (e.shiftKey) {
        // Shift+→: 프레임 빨리 앞으로 이동
        const frameAmount = userSettings.getFrameSkipAmount();
        const currentFrame = videoPlayer.currentFrame || 0;
        const totalFrames = videoPlayer.totalFrames || 0;
        const newFrame = Math.min(totalFrames - 1, currentFrame + frameAmount);
        videoPlayer.seekToFrame(newFrame);
        timeline.scrollToPlayhead();
        log.info('프레임 빨리 앞으로 이동 (단축키)', { frames: frameAmount, newFrame });
      } else if (e.altKey) {
        // Alt+→: 다음 하이라이트로 이동
        const nextHighlightTime = highlightManager.getNextHighlightTime(videoPlayer.currentTime || 0);
        if (nextHighlightTime !== null) {
          videoPlayer.seek(nextHighlightTime);
          timeline.scrollToPlayhead();
          log.info('다음 하이라이트로 이동 (단축키)', { time: nextHighlightTime });
        } else {
          showToast('다음 하이라이트가 없습니다', 'info');
        }
      } else {
        videoPlayer.nextFrame();
      }
      break;

    // 사용자 정의 단축키를 통한 처리
    default:
      // Shift+A: 1프레임 이전
      if (userSettings.matchShortcut('prevFrameDraw', e)) {
        e.preventDefault();
        videoPlayer.prevFrame();
        break;
      }
      // Shift+D: 1프레임 다음
      if (userSettings.matchShortcut('nextFrameDraw', e)) {
        e.preventDefault();
        videoPlayer.nextFrame();
        break;
      }
      // A: 이전 키프레임으로 이동
      if (userSettings.matchShortcut('prevKeyframe', e)) {
        e.preventDefault();
        const prevKf = drawingManager.getPrevKeyframeFrame();
        if (prevKf !== null) {
          videoPlayer.seekToFrame(prevKf);
        }
        break;
      }
      // D: 다음 키프레임으로 이동
      if (userSettings.matchShortcut('nextKeyframe', e)) {
        e.preventDefault();
        const nextKf = drawingManager.getNextKeyframeFrame();
        if (nextKf !== null) {
          videoPlayer.seekToFrame(nextKf);
        }
        break;
      }
      // 1: 어니언 스킨 토글
      if (userSettings.matchShortcut('onionSkinToggle', e)) {
        e.preventDefault();
        toggleOnionSkinWithUI();
        break;
      }
      // 2: 빈 키프레임 삽입
      if (userSettings.matchShortcut('keyframeAddBlank2', e)) {
        e.preventDefault();
        drawingManager.addBlankKeyframe();
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        break;
      }
      // Shift+3: 현재 키프레임 삭제
      if (userSettings.matchShortcut('keyframeDeleteAlt', e)) {
        e.preventDefault();
        drawingManager.removeKeyframe();
        showToast('키프레임이 삭제되었습니다.', 'info');
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        break;
      }
      // 3: 프레임 삽입 (홀드 추가)
      if (userSettings.matchShortcut('insertFrame', e)) {
        e.preventDefault();
        drawingManager.insertFrame();
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        break;
      }
      // 4: 프레임 삭제
      if (userSettings.matchShortcut('deleteFrame', e)) {
        e.preventDefault();
        drawingManager.deleteFrame();
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        break;
      }
      // B: 브러시 모드 (드로잉 모드 켜기 + 브러시 도구)
      if (e.code === 'KeyB') {
        e.preventDefault();
        if (!state.isDrawMode) {
          toggleDrawMode();
        }
        // 브러시 버튼 클릭으로 UI와 도구 함께 전환
        const brushBtn = document.querySelector('.tool-btn[data-tool="brush"]');
        if (brushBtn) {
          brushBtn.click();
        }
        break;
      }
      // E: 지우개 모드 (드로잉 모드에서만 작동)
      if (e.code === 'KeyE') {
        // 드로잉 모드가 아니면 무시
        if (!state.isDrawMode) {
          break;
        }
        e.preventDefault();
        // 지우개 버튼 클릭으로 UI와 도구 함께 전환
        const eraserBtn = document.querySelector('.tool-btn[data-tool="eraser"]');
        if (eraserBtn) {
          eraserBtn.click();
        }
        break;
      }
      // V: 선택 모드 (드로잉 모드 끄기)
      if (e.code === 'KeyV') {
        e.preventDefault();
        if (state.isDrawMode) {
          toggleDrawMode();
        }
        break;
      }
      break;
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
      let actualPath = filePath.replace('baeframe://', '');
      // URL 인코딩 디코딩 (공백 등 특수문자 처리)
      try {
        actualPath = decodeURIComponent(actualPath);
      } catch (e) {
        log.warn('URL 디코딩 실패, 원본 경로 사용', { actualPath, error: e.message });
      }
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

  // ====== 앱 종료 전 저장 처리 ======
  window.electronAPI.onRequestSaveBeforeQuit(async () => {
    log.info('앱 종료 전 저장 요청 수신');
    const savingOverlay = document.getElementById('appSavingOverlay');

    // 협업 세션 종료 (presence 제거)
    await collaborationManager.stop();

    // 미저장 변경사항 확인
    if (!reviewDataManager.hasUnsavedChanges()) {
      log.info('저장할 변경사항 없음, 바로 종료');
      await window.electronAPI.confirmQuit();
      return;
    }

    // 저장 오버레이 표시
    savingOverlay?.classList.add('active');

    try {
      log.info('종료 전 저장 시작');
      const saved = await reviewDataManager.save();

      if (saved) {
        log.info('저장 완료, 앱 종료 진행');
        await window.electronAPI.confirmQuit();
      } else {
        // 저장 실패 - 사용자 선택
        savingOverlay?.classList.remove('active');
        const forceQuit = confirm(
          '저장에 실패했습니다.\n\n저장하지 않고 종료하시겠습니까?'
        );
        if (forceQuit) {
          await window.electronAPI.confirmQuit();
        } else {
          await window.electronAPI.cancelQuit();
        }
      }
    } catch (error) {
      log.error('종료 전 저장 오류', error);
      savingOverlay?.classList.remove('active');
      const forceQuit = confirm(
        `저장 중 오류가 발생했습니다: ${error.message}\n\n저장하지 않고 종료하시겠습니까?`
      );
      if (forceQuit) {
        await window.electronAPI.confirmQuit();
      } else {
        await window.electronAPI.cancelQuit();
      }
    }
  });

  // ====== 사용자 이름 초기화 ======
  // 설정 파일 로드 완료 대기 (파일에서 hasSetNameOnce 등 로드)
  await userSettings.waitForReady();
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

  // ====== 댓글 설정 초기화 (waitForReady 이후) ======
  // 썸네일 표시 설정
  if (toggleCommentThumbnails) {
    toggleCommentThumbnails.checked = userSettings.getShowCommentThumbnails();
  }
  // 썸네일 크기 설정
  if (thumbnailScaleSlider) {
    const scale = userSettings.getCommentThumbnailScale();
    thumbnailScaleSlider.value = scale;
    if (thumbnailScaleValue) {
      thumbnailScaleValue.textContent = `${scale}%`;
    }
    // 썸네일 크기 즉시 적용
    document.documentElement.style.setProperty('--comment-thumbnail-scale', `${scale}%`);
  }
  // 썸네일 크기 조절 항목 활성화/비활성화
  if (thumbnailScaleItem && toggleCommentThumbnails) {
    thumbnailScaleItem.classList.toggle('disabled', !toggleCommentThumbnails.checked);
  }
  log.info('댓글 설정 초기화 완료', {
    showThumbnails: userSettings.getShowCommentThumbnails(),
    thumbnailScale: userSettings.getCommentThumbnailScale()
  });

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
  const threadImageBtn = document.getElementById('threadImageBtn');
  const threadImagePreview = document.getElementById('threadImagePreview');
  const threadPreviewImg = document.getElementById('threadPreviewImg');
  const threadImageRemove = document.getElementById('threadImageRemove');

  let currentThreadMarkerId = null;
  let pendingThreadImage = null; // 스레드 답글 첨부 이미지

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

    // 원본 댓글 렌더링 (XSS 방지: author 필드 이스케이프)
    threadOriginal.innerHTML = `
      ${avatarImage ? `<div class="thread-avatar-bg" style="background-image: url('${avatarImage}')"></div>` : ''}
      <div class="thread-original-inner">
        <div class="thread-comment-header">
          <div class="thread-comment-avatar">${escapeHtml(marker.author.charAt(0))}</div>
          <div class="thread-comment-info">
            <div class="thread-comment-author" ${getAuthorColorStyle(marker.author)}>${escapeHtml(marker.author)}</div>
            <div class="thread-comment-time">${formatRelativeTime(marker.createdAt)}</div>
          </div>
        </div>
        <div class="thread-comment-text">${formatMarkdown(marker.text)}</div>
        ${marker.image ? `<div class="thread-comment-image"><img src="${marker.image}" alt="첨부 이미지" data-full-image="${marker.image}"></div>` : ''}
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

    // 답글들 렌더링 (XSS 방지: author 필드 이스케이프)
    threadReplies.innerHTML = (marker.replies || []).map(reply => `
      <div class="thread-reply-item">
        <div class="thread-reply-avatar">${escapeHtml(reply.author.charAt(0))}</div>
        <div class="thread-reply-content">
          <div class="thread-reply-header">
            <span class="thread-reply-author" ${getAuthorColorStyle(reply.author)}>${escapeHtml(reply.author)}</span>
            <span class="thread-reply-time">${formatRelativeTime(reply.createdAt)}</span>
          </div>
          <div class="thread-reply-text">${formatMarkdown(reply.text)}</div>
          ${reply.image ? `<div class="thread-reply-image"><img src="${reply.image}" alt="첨부 이미지" data-full-image="${reply.image}"></div>` : ''}
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
    clearThreadImage();
  }

  /**
   * 스레드 이미지 미리보기 표시
   */
  function showThreadImagePreview(imageData) {
    pendingThreadImage = imageData;
    threadPreviewImg.src = imageData.base64;
    threadImagePreview.style.display = 'block';
    log.info('스레드 이미지 첨부됨', { width: imageData.width, height: imageData.height });
  }

  /**
   * 스레드 이미지 초기화
   */
  function clearThreadImage() {
    pendingThreadImage = null;
    if (threadPreviewImg) threadPreviewImg.src = '';
    if (threadImagePreview) threadImagePreview.style.display = 'none';
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
    const hasImage = pendingThreadImage && pendingThreadImage.base64;
    threadSubmit.classList.toggle('active', hasContent || hasImage);
  }

  /**
   * 스레드에 답글 제출
   */
  function submitThreadReply() {
    const text = threadEditor.innerText.trim();
    const hasImage = pendingThreadImage && pendingThreadImage.base64;

    if ((!text && !hasImage) || !currentThreadMarkerId) return;

    // 이미지와 함께 답글 추가
    const replyData = {
      text: text || '',
      author: commentManager.getAuthor()
    };

    if (hasImage) {
      replyData.image = pendingThreadImage.base64;
      replyData.imageWidth = pendingThreadImage.width;
      replyData.imageHeight = pendingThreadImage.height;
    }

    // 직접 마커의 addReply 호출 (이미지 포함)
    const marker = commentManager.getMarker(currentThreadMarkerId);
    if (!marker) return;

    const newReply = marker.addReply(replyData);
    commentManager._emit('replyAdded', { marker, reply: newReply });
    commentManager._emit('markersChanged');

    // UI 업데이트 - 답글 개수
    const replyCount = marker.replies?.length || 0;
    threadReplyCount.textContent = `${replyCount}개의 댓글`;
    threadReplyCount.style.display = 'flex';

    // UI 업데이트 - 새 답글 추가 (XSS 방지: author 필드 이스케이프)
    threadReplies.innerHTML += `
      <div class="thread-reply-item">
        <div class="thread-reply-avatar">${escapeHtml(newReply.author.charAt(0))}</div>
        <div class="thread-reply-content">
          <div class="thread-reply-header">
            <span class="thread-reply-author" ${getAuthorColorStyle(newReply.author)}>${escapeHtml(newReply.author)}</span>
            <span class="thread-reply-time">${formatRelativeTime(newReply.createdAt)}</span>
          </div>
          <div class="thread-reply-text">${formatMarkdown(newReply.text)}</div>
          ${newReply.image ? `<div class="thread-reply-image"><img src="${newReply.image}" alt="첨부 이미지" data-full-image="${newReply.image}"></div>` : ''}
        </div>
      </div>
    `;

    // 에디터 및 이미지 초기화
    threadEditor.innerHTML = '';
    clearThreadImage();
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

  // 스레드 이미지 버튼 클릭
  threadImageBtn?.addEventListener('click', async () => {
    const imageData = await selectImageFile();
    if (imageData) {
      showThreadImagePreview(imageData);
      showToast('이미지가 첨부되었습니다', 'success');
    }
  });

  // 스레드 이미지 제거 버튼
  threadImageRemove?.addEventListener('click', () => {
    clearThreadImage();
  });

  // 스레드 에디터 이미지 붙여넣기
  threadEditor?.addEventListener('paste', async (e) => {
    const imageData = await getImageFromClipboard(e);
    if (imageData) {
      e.preventDefault();
      showThreadImagePreview(imageData);
      showToast('이미지가 첨부되었습니다', 'success');
    }
  });

  // 전역으로 노출
  window.openThreadPopup = openThreadPopup;

  // ========================================
  // Image Viewer Modal
  // ========================================

  /**
   * 이미지 뷰어 열기
   */
  function openImageViewer(imageSrc) {
    if (!imageSrc) return;
    elements.imageViewerImg.src = imageSrc;
    elements.imageViewerOverlay.classList.add('open');
    log.info('이미지 뷰어 열림');
  }

  /**
   * 이미지 뷰어 닫기
   */
  function closeImageViewer() {
    elements.imageViewerOverlay.classList.remove('open');
    elements.imageViewerImg.src = '';
  }

  // 이미지 뷰어 닫기 버튼
  elements.imageViewerClose?.addEventListener('click', closeImageViewer);

  // 배경 클릭으로 이미지 뷰어 닫기
  elements.imageViewerOverlay?.addEventListener('click', (e) => {
    if (e.target === elements.imageViewerOverlay) {
      closeImageViewer();
    }
  });

  // ESC 키로 이미지 뷰어 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.imageViewerOverlay?.classList.contains('open')) {
      closeImageViewer();
    }
  });

  // 댓글/스레드 이미지 클릭 이벤트 위임
  document.addEventListener('click', (e) => {
    // 댓글 이미지 클릭
    const commentImg = e.target.closest('.comment-attached-image img');
    if (commentImg) {
      e.stopPropagation();
      openImageViewer(commentImg.dataset.fullImage || commentImg.src);
      return;
    }

    // 스레드 이미지 클릭
    const threadImg = e.target.closest('.thread-comment-image img, .thread-reply-image img');
    if (threadImg) {
      e.stopPropagation();
      openImageViewer(threadImg.dataset.fullImage || threadImg.src);
      return;
    }
  });

  // 전역 노출
  window.openImageViewer = openImageViewer;

  // ====== 단축키 설정 모달 ======
  const shortcutSettingsModal = document.getElementById('shortcutSettingsModal');
  const shortcutList = document.getElementById('shortcutList');
  const btnShortcutSettings = document.getElementById('btnShortcutSettings');
  const closeShortcutSettings = document.getElementById('closeShortcutSettings');
  const closeShortcutSettingsBtn = document.getElementById('closeShortcutSettingsBtn');
  const resetAllShortcuts = document.getElementById('resetAllShortcuts');

  let editingShortcut = null; // 현재 편집 중인 단축키

  // 키 코드를 표시용 문자열로 변환
  function formatKeyCode(code) {
    const keyMap = {
      'Space': 'Space',
      'ArrowLeft': '←',
      'ArrowRight': '→',
      'ArrowUp': '↑',
      'ArrowDown': '↓',
      'Home': 'Home',
      'End': 'End',
      'Escape': 'Esc'
    };
    if (keyMap[code]) return keyMap[code];
    if (code.startsWith('Key')) return code.substring(3);
    if (code.startsWith('Digit')) return code.substring(5);
    return code;
  }

  // 단축키 표시 문자열 생성
  function formatShortcut(shortcut) {
    const parts = [];
    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.shift) parts.push('Shift');
    if (shortcut.alt) parts.push('Alt');
    parts.push(formatKeyCode(shortcut.key));
    return parts.join(' + ');
  }

  // 단축키 리스트 렌더링
  function renderShortcutList() {
    const shortcuts = userSettings.getShortcuts();
    shortcutList.innerHTML = Object.entries(shortcuts).map(([action, shortcut]) => `
      <div class="shortcut-item" data-action="${action}">
        <span class="shortcut-label">${shortcut.label}</span>
        <div class="shortcut-key" data-action="${action}">${formatShortcut(shortcut)}</div>
      </div>
    `).join('');

    // 클릭 이벤트 추가
    shortcutList.querySelectorAll('.shortcut-key').forEach(el => {
      el.addEventListener('click', () => startEditingShortcut(el));
    });
  }

  // 단축키 편집 시작
  function startEditingShortcut(el) {
    // 기존 편집 취소
    if (editingShortcut) {
      editingShortcut.classList.remove('editing');
    }
    editingShortcut = el;
    el.classList.add('editing');
    el.textContent = '키 입력 대기...';
  }

  // 단축키 편집 완료
  function finishEditingShortcut(event) {
    if (!editingShortcut) return;

    // 수정자 키만 누른 경우 무시 (실제 키 입력 대기)
    const modifierKeys = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
      'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];
    if (modifierKeys.includes(event.code)) {
      return; // 수정자 키만 눌렀으면 무시하고 계속 대기
    }

    event.preventDefault();
    event.stopPropagation();

    const action = editingShortcut.dataset.action;
    const newShortcut = {
      key: event.code,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey
    };

    userSettings.setShortcut(action, newShortcut);
    editingShortcut.classList.remove('editing');
    editingShortcut.textContent = formatShortcut(userSettings.getShortcut(action));
    editingShortcut = null;

    showToast('단축키가 변경되었습니다.', 'success');
  }

  // 프레임/초 이동 설정 요소
  const frameSkipInput = document.getElementById('frameSkipInput');
  const secondSkipInput = document.getElementById('secondSkipInput');

  // 프레임/초 이동 설정 로드
  function loadSkipSettings() {
    if (frameSkipInput) {
      frameSkipInput.value = userSettings.getFrameSkipAmount();
    }
    if (secondSkipInput) {
      secondSkipInput.value = userSettings.getSecondSkipAmount();
    }
  }

  // 프레임/초 이동 설정 이벤트 리스너
  frameSkipInput?.addEventListener('change', () => {
    const value = parseInt(frameSkipInput.value, 10);
    if (!isNaN(value) && value >= 1 && value <= 100) {
      userSettings.setFrameSkipAmount(value);
      showToast(`프레임 이동량: ${value}프레임`, 'info');
    }
  });

  secondSkipInput?.addEventListener('change', () => {
    const value = parseFloat(secondSkipInput.value);
    if (!isNaN(value) && value >= 0.1 && value <= 10) {
      userSettings.setSecondSkipAmount(value);
      showToast(`초 이동량: ${value}초`, 'info');
    }
  });

  // 단축키 설정 모달 열기
  function openShortcutSettingsModal() {
    renderShortcutList();
    loadSkipSettings();
    shortcutSettingsModal?.classList.add('active');
  }

  // 단축키 설정 모달 닫기
  function closeShortcutSettingsModal() {
    if (editingShortcut) {
      editingShortcut.classList.remove('editing');
      editingShortcut = null;
    }
    shortcutSettingsModal?.classList.remove('active');
  }

  // 이벤트 리스너
  btnShortcutSettings?.addEventListener('click', () => {
    // 설정 드롭다운 닫기
    document.getElementById('commentSettingsDropdown')?.classList.remove('show');
    openShortcutSettingsModal();
  });

  closeShortcutSettings?.addEventListener('click', closeShortcutSettingsModal);
  closeShortcutSettingsBtn?.addEventListener('click', closeShortcutSettingsModal);

  resetAllShortcuts?.addEventListener('click', () => {
    userSettings.resetAllShortcuts();
    renderShortcutList();
    showToast('모든 단축키가 기본값으로 초기화되었습니다.', 'info');
  });

  // 모달 외부 클릭 시 닫기
  shortcutSettingsModal?.addEventListener('click', (e) => {
    if (e.target === shortcutSettingsModal) {
      closeShortcutSettingsModal();
    }
  });

  // 키 입력 감지 (단축키 편집 중일 때)
  document.addEventListener('keydown', (e) => {
    if (editingShortcut && shortcutSettingsModal?.classList.contains('active')) {
      // ESC는 편집 취소
      if (e.code === 'Escape') {
        editingShortcut.classList.remove('editing');
        renderShortcutList(); // 원래 값으로 복원
        editingShortcut = null;
        return;
      }
      // 그 외의 키는 단축키로 설정
      finishEditingShortcut(e);
    }
  });

  // ====== 캐시 설정 모달 ======
  const cacheSettingsModal = document.getElementById('cacheSettingsModal');
  const btnCacheSettings = document.getElementById('btnCacheSettings');
  const closeCacheSettings = document.getElementById('closeCacheSettings');
  const closeCacheSettingsBtn = document.getElementById('closeCacheSettingsBtn');
  const thumbnailCacheSizeEl = document.getElementById('thumbnailCacheSize');
  const transcodeCacheSizeEl = document.getElementById('transcodeCacheSize');
  const cacheLimitSlider = document.getElementById('cacheLimitSlider');
  const cacheLimitValue = document.getElementById('cacheLimitValue');
  const btnClearThumbnailCache = document.getElementById('btnClearThumbnailCache');
  const btnClearTranscodeCache = document.getElementById('btnClearTranscodeCache');
  const btnClearAllCache = document.getElementById('btnClearAllCache');

  // 캐시 크기 업데이트
  async function updateCacheSizes() {
    try {
      // 썸네일 캐시
      const thumbResult = await window.electronAPI.thumbnailGetCacheSize();
      if (thumbResult.success) {
        thumbnailCacheSizeEl.textContent = `${thumbResult.formattedSize} (${thumbResult.videoCount}개 영상)`;
      }

      // 트랜스코딩 캐시
      const transcodeResult = await window.electronAPI.ffmpegGetCacheSize();
      if (transcodeResult.success) {
        transcodeCacheSizeEl.textContent = `${transcodeResult.formatted} (${transcodeResult.count}개 파일)`;
        cacheLimitSlider.value = transcodeResult.limitBytes / (1024 * 1024 * 1024);
        cacheLimitValue.textContent = `${cacheLimitSlider.value} GB`;
      }
    } catch (error) {
      log.error('캐시 크기 조회 실패', { error: error.message });
    }
  }

  // 캐시 설정 모달 열기
  function openCacheSettingsModal() {
    cacheSettingsModal?.classList.add('active');
    updateCacheSizes();
  }

  // 캐시 설정 모달 닫기
  function closeCacheSettingsModal() {
    cacheSettingsModal?.classList.remove('active');
  }

  // 이벤트 리스너
  btnCacheSettings?.addEventListener('click', () => {
    document.getElementById('commentSettingsDropdown')?.classList.remove('show');
    openCacheSettingsModal();
  });

  closeCacheSettings?.addEventListener('click', closeCacheSettingsModal);
  closeCacheSettingsBtn?.addEventListener('click', closeCacheSettingsModal);

  // 캐시 용량 제한 슬라이더
  cacheLimitSlider?.addEventListener('input', () => {
    cacheLimitValue.textContent = `${cacheLimitSlider.value} GB`;
  });

  cacheLimitSlider?.addEventListener('change', async () => {
    const limitGB = parseInt(cacheLimitSlider.value);
    await window.electronAPI.ffmpegSetCacheLimit(limitGB);
    showToast(`캐시 용량 제한이 ${limitGB}GB로 설정되었습니다.`, 'info');
  });

  // 썸네일 캐시 비우기
  btnClearThumbnailCache?.addEventListener('click', async () => {
    if (!confirm('썸네일 캐시를 모두 삭제하시겠습니까?\n다음에 영상을 열 때 썸네일이 다시 생성됩니다.')) return;

    try {
      const result = await window.electronAPI.thumbnailClearAllCache();
      if (result.success) {
        showToast('썸네일 캐시가 삭제되었습니다.', 'success');
        updateCacheSizes();
      } else {
        showToast('캐시 삭제 실패', 'error');
      }
    } catch (error) {
      showToast(`오류: ${error.message}`, 'error');
    }
  });

  // 트랜스코딩 캐시 비우기
  btnClearTranscodeCache?.addEventListener('click', async () => {
    if (!confirm('트랜스코딩 캐시를 모두 삭제하시겠습니까?\n다음에 미지원 코덱 영상을 열 때 다시 변환됩니다.')) return;

    try {
      const result = await window.electronAPI.ffmpegClearAllCache();
      if (result.success) {
        showToast(`트랜스코딩 캐시가 삭제되었습니다. (${result.formatted} 확보)`, 'success');
        updateCacheSizes();
      } else {
        showToast('캐시 삭제 실패', 'error');
      }
    } catch (error) {
      showToast(`오류: ${error.message}`, 'error');
    }
  });

  // 전체 캐시 비우기
  btnClearAllCache?.addEventListener('click', async () => {
    if (!confirm('모든 캐시를 삭제하시겠습니까?\n(썸네일 + 트랜스코딩 캐시)')) return;

    try {
      await window.electronAPI.thumbnailClearAllCache();
      await window.electronAPI.ffmpegClearAllCache();
      showToast('모든 캐시가 삭제되었습니다.', 'success');
      updateCacheSizes();
    } catch (error) {
      showToast(`오류: ${error.message}`, 'error');
    }
  });

  // 모달 외부 클릭 시 닫기
  cacheSettingsModal?.addEventListener('click', (e) => {
    if (e.target === cacheSettingsModal) {
      closeCacheSettingsModal();
    }
  });

  // 버전 드롭다운 DOM 초기화
  const versionDropdown = getVersionDropdown();
  versionDropdown.init();
  versionDropdown.setReviewDataManager(reviewDataManager);

  // 스플릿 뷰 매니저 초기화
  const splitViewManager = getSplitViewManager();
  splitViewManager.init();

  // 버전 비교 버튼 이벤트
  const btnCompareVersions = document.getElementById('btnCompareVersions');
  if (btnCompareVersions) {
    btnCompareVersions.addEventListener('click', () => {
      log.info('버전 비교 버튼 클릭됨');
      versionDropdown.close();
      const versionManager = getVersionManager();
      const versions = versionManager.getAllVersions();
      const currentPath = state.currentFile;
      log.info('버전 비교 시작', { versionsCount: versions.length, currentPath });

      if (versions.length >= 2) {
        const leftVersion = versions.find((v) => v.path === currentPath) || versions[0];
        const rightVersion = versions.find((v) => v.path !== currentPath) || versions[1];
        log.info('스플릿 뷰 열기', { leftVersion, rightVersion });
        splitViewManager.open({ leftVersion, rightVersion });
      } else {
        showToast('버전 비교를 위해서는 2개 이상의 버전이 필요합니다.', 'warning');
      }
    });
  }

  // ====== 협업 시스템 초기화 ======

  // 협업 UI 요소
  const collaboratorsIndicator = document.getElementById('collaboratorsIndicator');
  const collaboratorsAvatars = document.getElementById('collaboratorsAvatars');
  const collaboratorsCount = document.getElementById('collaboratorsCount');
  const syncStatus = document.getElementById('syncStatus');

  /**
   * 협업자 UI 업데이트
   */
  function updateCollaboratorsUI(collaborators) {
    if (!collaboratorsIndicator) return;

    if (collaborators.length === 0) {
      collaboratorsIndicator.style.display = 'none';
      return;
    }

    collaboratorsIndicator.style.display = 'flex';
    collaboratorsCount.textContent = collaborators.length;

    // 아바타 렌더링
    collaboratorsAvatars.innerHTML = collaborators.map(collab => {
      const initials = collab.name.substring(0, 2);
      const isMe = collab.isMe ? 'is-me' : '';
      return `<div class="collaborator-avatar ${isMe}"
                   style="background-color: ${collab.color}"
                   title="${collab.name}${collab.isMe ? ' (나)' : ''}">
                ${initials}
              </div>`;
    }).reverse().join(''); // reverse for proper stacking order
  }

  /**
   * 동기화 상태 UI 업데이트
   */
  function updateSyncStatusUI(status) {
    if (!syncStatus) return;

    syncStatus.classList.remove('syncing', 'synced', 'error');

    if (status === 'syncing') {
      syncStatus.classList.add('syncing');
      syncStatus.title = '동기화 중...';
    } else if (status === 'synced') {
      syncStatus.classList.add('synced');
      syncStatus.title = '동기화 완료';
    } else if (status === 'error') {
      syncStatus.classList.add('error');
      syncStatus.title = '동기화 오류';
    }
  }

  // 협업 이벤트 리스너
  collaborationManager.addEventListener('collaboratorsChanged', (e) => {
    log.info('협업자 목록 변경', e.detail);
    updateCollaboratorsUI(e.detail.collaborators);
  });

  collaborationManager.addEventListener('collaborationStarted', (e) => {
    log.info('협업 시작됨', e.detail);
    showToast(`${e.detail.collaborators.length}명이 이 파일을 보고 있습니다`, 'info');
  });

  collaborationManager.addEventListener('syncStarted', () => {
    updateSyncStatusUI('syncing');
  });

  collaborationManager.addEventListener('syncCompleted', () => {
    updateSyncStatusUI('synced');
    // 3초 후 아이콘 원래대로
    setTimeout(() => updateSyncStatusUI(''), 3000);
  });

  collaborationManager.addEventListener('syncError', () => {
    updateSyncStatusUI('error');
  });

  // 원격 데이터 로드 콜백 설정 (동기화 시 호출됨)
  collaborationManager.setRemoteDataLoader(async () => {
    if (!reviewDataManager.currentBframePath) return;

    try {
      // ReviewDataManager의 reloadAndMerge 사용 (비디오 유지하면서 데이터만 머지)
      const result = await reviewDataManager.reloadAndMerge({ merge: true });

      if (result.success) {
        // 타임라인/비디오 마커는 항상 업데이트
        renderVideoMarkers();
        updateTimelineMarkers();

        // 댓글 수정 중이면 댓글 목록 업데이트 건너뛰기 (편집 폼 유지)
        const isEditingComment = document.querySelector('.comment-edit-form[style*="display: block"]');
        if (!isEditingComment) {
          updateCommentList();
        }

        if (result.added > 0 || result.updated > 0) {
          log.info('원격 변경사항 머지됨', { added: result.added, updated: result.updated });

          if (result.added > 0) {
            showToast(`새 댓글 ${result.added}개가 동기화되었습니다`, 'info');
          }
        }
      }
    } catch (error) {
      log.warn('원격 데이터 머지 실패', { error: error.message });
    }
  });

  // 수동 동기화 버튼 (sync status 클릭)
  syncStatus?.addEventListener('click', async () => {
    if (!collaborationManager.hasOtherCollaborators()) {
      showToast('다른 협업자가 없습니다', 'info');
      return;
    }
    await collaborationManager.syncNow();
  });

  // ====== 파일 변경 감지 (실시간 동기화) ======
  // 다른 사용자가 저장하면 즉시 동기화
  let lastSyncTime = 0;
  const MIN_SYNC_INTERVAL = 500; // 최소 500ms 간격

  window.electronAPI.onFileChanged(async ({ filePath }) => {
    // 현재 열린 파일이 아니면 무시
    if (filePath !== reviewDataManager.currentBframePath) return;

    // 너무 빠른 연속 호출 방지
    const now = Date.now();
    if (now - lastSyncTime < MIN_SYNC_INTERVAL) return;
    lastSyncTime = now;

    log.info('파일 변경 감지됨, 즉시 동기화', { filePath });

    try {
      // ReviewDataManager의 reloadAndMerge 사용
      const result = await reviewDataManager.reloadAndMerge({ merge: true });

      if (result.success) {
        renderVideoMarkers();
        updateTimelineMarkers();

        // 편집 중이 아닐 때만 댓글 목록 업데이트
        const isEditingComment = document.querySelector('.comment-edit-form[style*="display: block"]');
        if (!isEditingComment) {
          updateCommentList();
        }

        if (result.added > 0 || result.updated > 0) {
          showToast(`동기화 완료 (${result.added > 0 ? `추가 ${result.added}` : ''}${result.updated > 0 ? ` 수정 ${result.updated}` : ''})`, 'info');
        }
      }
    } catch (error) {
      log.warn('파일 변경 동기화 실패', { error: error.message });
    }
  });

  // ====== 재생목록 초기화 ======
  initPlaylistFeature();

  log.info('앱 초기화 완료');

  // 버전 표시
  try {
    const version = await window.electronAPI.getVersion();
    log.info('앱 버전', { version });
  } catch (e) {
    log.warn('버전 정보를 가져올 수 없습니다.');
  }

  // ============================================================================
  // 재생목록 기능
  // ============================================================================

  function initPlaylistFeature() {
    const playlistManager = getPlaylistManager();

    // 콜백 설정
    playlistManager.onPlaylistLoaded = (playlist) => {
      log.info('재생목록 로드됨', { name: playlist.name });
      updatePlaylistUI();
    };

    playlistManager.onPlaylistModified = () => {
      updatePlaylistUI();
      // 자동 저장 (딜레이)
      clearTimeout(playlistManager._autoSaveTimeout);
      playlistManager._autoSaveTimeout = setTimeout(async () => {
        if (playlistManager.isModified && playlistManager.playlistPath) {
          try {
            await playlistManager.save();
            log.info('재생목록 자동 저장');
          } catch (err) {
            log.warn('재생목록 자동 저장 실패', err);
          }
        }
      }, 2000);
    };

    playlistManager.onItemSelected = async (item, index) => {
      log.info('재생목록 아이템 선택', { index, fileName: item.fileName });
      await loadVideoFromPlaylist(item);
      updatePlaylistCurrentItem();
      updatePlaylistPosition();
    };

    playlistManager.onPlaylistClosed = () => {
      hidePlaylistSidebar();
    };

    playlistManager.onError = (error) => {
      showToast(error.message, 'error');
    };

    // 헤더 재생목록 버튼
    elements.btnPlaylist?.addEventListener('click', () => {
      if (elements.playlistSidebar.classList.contains('hidden')) {
        showPlaylistSidebar();
        if (!playlistManager.isActive()) {
          playlistManager.createNew();
          // 현재 영상이 있으면 추가
          if (state.currentFile) {
            playlistManager.addItems([state.currentFile.videoPath]).then(updatePlaylistUI);
          }
        }
      } else {
        hidePlaylistSidebar();
      }
    });

    // 닫기 버튼
    elements.btnPlaylistClose?.addEventListener('click', async () => {
      await playlistManager.close();
      hidePlaylistSidebar();
    });

    // 이름 변경
    elements.playlistNameInput?.addEventListener('change', (e) => {
      playlistManager.setName(e.target.value);
    });

    // 파일 추가 버튼 - 추가 모드 토글
    elements.btnPlaylistAdd?.addEventListener('click', () => {
      togglePlaylistAddMode();
    });

    // 추가 영역 클릭 - 파일 선택 대화상자
    elements.playlistAddZone?.addEventListener('click', async () => {
      const result = await window.electronAPI.openFileDialog({
        title: '재생목록에 추가할 영상 선택',
        filters: [
          { name: '비디오 파일', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }
        ],
        properties: ['openFile', 'multiSelections']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        try {
          await playlistManager.addItems(result.filePaths);
          exitPlaylistAddMode();
          updatePlaylistUI();
          showToast(`${result.filePaths.length}개 파일이 추가되었습니다.`, 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    });

    // 추가 영역 드래그 앤 드롭
    initPlaylistAddZoneDragDrop();

    // 링크 복사 버튼
    elements.btnPlaylistCopyLink?.addEventListener('click', async () => {
      if (playlistManager.isEmpty()) {
        showToast('재생목록에 영상을 먼저 추가해주세요.', 'warning');
        return;
      }

      try {
        // 저장 안 된 상태면 먼저 저장
        if (!playlistManager.playlistPath) {
          await playlistManager.save();
          showToast('재생목록이 저장되었습니다.', 'info');
        }

        const link = await window.electronAPI.generatePlaylistLink(playlistManager.playlistPath);
        await window.electronAPI.copyToClipboard(link);
        showToast('재생목록 링크가 복사되었습니다!', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });

    // 이전/다음 버튼
    elements.btnPlaylistPrev?.addEventListener('click', () => {
      playlistManager.prev();
    });

    elements.btnPlaylistNext?.addEventListener('click', () => {
      playlistManager.next();
    });

    // 자동 재생 토글
    elements.playlistAutoPlay?.addEventListener('change', (e) => {
      playlistManager.setAutoPlay(e.target.checked);
    });

    // 드래그 앤 드롭 - 파일 추가
    initPlaylistDragDrop();

    // 드래그 앤 드롭 - 순서 변경
    initPlaylistDragReorder();

    // 재생목록 리사이저
    initPlaylistResizer();

    // 단축키 추가
    document.addEventListener('keydown', (e) => {
      if (!playlistManager.isActive()) return;

      // Ctrl+왼쪽: 이전 영상
      if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        playlistManager.prev();
      }

      // Ctrl+오른쪽: 다음 영상
      if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        playlistManager.next();
      }

      // P: 재생목록 토글 (입력 필드가 아닐 때)
      if (e.key === 'p' || e.key === 'P') {
        if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          elements.btnPlaylist?.click();
        }
      }
    });

    // 재생목록 링크로 열기 이벤트 리스너
    window.electronAPI.onOpenPlaylist?.(async (path) => {
      log.info('재생목록 링크로 열기', { path });
      try {
        await playlistManager.open(path);
        showPlaylistSidebar();
        // 첫 번째 아이템 자동 로드
        if (playlistManager.getItemCount() > 0) {
          playlistManager.selectItem(0);
        }
      } catch (error) {
        showToast(`재생목록을 열 수 없습니다: ${error.message}`, 'error');
      }
    });
  }

  // 재생목록에서 영상 로드
  async function loadVideoFromPlaylist(item) {
    // 파일 존재 확인
    const exists = await window.electronAPI.fileExists(item.videoPath);
    if (!exists) {
      showToast(`파일을 찾을 수 없습니다: ${item.fileName}`, 'error');
      markPlaylistItemAsMissing(item.id);
      return false;
    }

    // 현재 영상 저장
    if (reviewDataManager.isModified) {
      await reviewDataManager.save();
    }

    // 새 영상 로드
    await loadVideo(item.videoPath);
    return true;
  }

  // 사이드바 표시
  function showPlaylistSidebar() {
    elements.playlistSidebar?.classList.remove('hidden');
    updatePlaylistUI();
  }

  // 사이드바 숨김
  function hidePlaylistSidebar() {
    elements.playlistSidebar?.classList.add('hidden');
    exitPlaylistAddMode();
  }

  // 추가 모드 토글
  function togglePlaylistAddMode() {
    elements.playlistSidebar?.classList.toggle('add-mode');
  }

  // 추가 모드 종료
  function exitPlaylistAddMode() {
    elements.playlistSidebar?.classList.remove('add-mode');
  }

  // 추가 모드 확인
  function isPlaylistAddMode() {
    return elements.playlistSidebar?.classList.contains('add-mode');
  }

  // 재생목록 UI 업데이트 (디바운스 적용)
  let updatePlaylistUITimer = null;
  let isUpdatingPlaylistUI = false;

  async function updatePlaylistUI() {
    // 이미 업데이트 중이면 다음 사이클에 다시 시도
    if (isUpdatingPlaylistUI) {
      clearTimeout(updatePlaylistUITimer);
      updatePlaylistUITimer = setTimeout(() => updatePlaylistUI(), 50);
      return;
    }

    isUpdatingPlaylistUI = true;

    try {
      const playlistManager = getPlaylistManager();

      if (!playlistManager.isActive()) {
        elements.playlistSidebar?.classList.add('empty');
        return;
      }

      elements.playlistSidebar?.classList.remove('empty');

      // 이름 (입력 중이 아닐 때만 업데이트)
      if (elements.playlistNameInput && document.activeElement !== elements.playlistNameInput) {
        elements.playlistNameInput.value = playlistManager.getName();
      }

      // 자동 재생 체크박스
      if (elements.playlistAutoPlay) {
        elements.playlistAutoPlay.checked = playlistManager.getAutoPlay();
      }

      // 아이템 렌더링
      await renderPlaylistItems();

      // 위치 업데이트
      updatePlaylistPosition();

      // 전체 진행률 업데이트
      await updatePlaylistProgress();
    } finally {
      isUpdatingPlaylistUI = false;
    }
  }

  // 아이템 렌더링
  async function renderPlaylistItems() {
    const playlistManager = getPlaylistManager();
    const container = elements.playlistItems;
    if (!container) return;

    container.innerHTML = '';

    if (playlistManager.isEmpty()) {
      elements.playlistSidebar?.classList.add('empty');
      return;
    }

    elements.playlistSidebar?.classList.remove('empty');

    const items = playlistManager.getItems();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const progress = await playlistManager.getItemProgress(item.bframePath);

      const el = document.createElement('div');
      el.className = 'playlist-item' + (i === playlistManager.currentIndex ? ' active' : '');
      el.dataset.id = item.id;
      el.dataset.index = i;
      el.draggable = true;

      const thumbnailHtml = item.thumbnailPath
        ? `<img src="file://${item.thumbnailPath.replace(/\\/g, '/')}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'thumbnail-placeholder\\'></div>'">`
        : '<div class="thumbnail-placeholder"></div>';

      el.innerHTML = `
        <div class="playlist-item-drag-handle">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
            <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
          </svg>
        </div>
        <div class="playlist-item-thumbnail">
          ${thumbnailHtml}
        </div>
        <div class="playlist-item-info">
          <div class="playlist-item-name" title="${item.fileName}">${item.fileName}</div>
          <div class="playlist-item-stats">
            <span class="playlist-item-comments" title="피드백 개수">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              ${progress.total > 0 ? progress.total : '-'}
            </span>
            <span class="playlist-item-progress ${progress.percent === 100 ? 'completed' : ''}" title="완료율">
              <div class="mini-progress-bar">
                <div class="mini-progress-fill" style="width: ${progress.percent}%"></div>
              </div>
              ${progress.total > 0 ? `${progress.percent}%` : '-'}
            </span>
          </div>
        </div>
        <button class="playlist-item-remove" title="제거">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;

      // 클릭 이벤트
      el.addEventListener('click', (e) => {
        if (!e.target.closest('.playlist-item-remove') && !e.target.closest('.playlist-item-drag-handle')) {
          playlistManager.selectItem(i);
        }
      });

      // 제거 버튼
      el.querySelector('.playlist-item-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        playlistManager.removeItem(item.id);
        updatePlaylistUI();
      });

      container.appendChild(el);
    }
  }

  // 현재 아이템 하이라이트
  function updatePlaylistCurrentItem() {
    const playlistManager = getPlaylistManager();
    document.querySelectorAll('.playlist-item').forEach((el, index) => {
      el.classList.toggle('active', index === playlistManager.currentIndex);
    });
  }

  // 위치 표시 업데이트
  function updatePlaylistPosition() {
    const playlistManager = getPlaylistManager();
    const pos = playlistManager.currentIndex + 1;
    const total = playlistManager.getItemCount();

    if (elements.playlistPosition) {
      elements.playlistPosition.textContent = total > 0 ? `${pos} / ${total}` : '- / -';
    }

    // 이전/다음 버튼 활성화 상태
    if (elements.btnPlaylistPrev) {
      elements.btnPlaylistPrev.disabled = !playlistManager.hasPrev();
    }
    if (elements.btnPlaylistNext) {
      elements.btnPlaylistNext.disabled = !playlistManager.hasNext();
    }
  }

  // 전체 진행률 업데이트
  async function updatePlaylistProgress() {
    const playlistManager = getPlaylistManager();
    const progress = await playlistManager.getTotalProgress();

    if (elements.playlistProgressFill) {
      elements.playlistProgressFill.style.width = `${progress.percent}%`;
    }
    if (elements.playlistProgressText) {
      if (progress.total > 0) {
        elements.playlistProgressText.textContent = `${progress.resolved}/${progress.total} 완료 (${progress.percent}%)`;
      } else {
        elements.playlistProgressText.textContent = '피드백 없음';
      }
    }
  }

  // 파일 누락 표시
  function markPlaylistItemAsMissing(itemId) {
    const el = document.querySelector(`.playlist-item[data-id="${itemId}"]`);
    if (el) {
      el.classList.add('missing');
    }
  }

  // 파일 추가 드래그 앤 드롭
  function initPlaylistDragDrop() {
    const sidebar = elements.playlistSidebar;
    const dropzone = elements.playlistDropzone;
    if (!sidebar || !dropzone) return;

    sidebar.addEventListener('dragenter', (e) => {
      // 외부 파일인지 확인
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        dropzone.classList.add('active');
      }
    });

    sidebar.addEventListener('dragleave', (e) => {
      if (!sidebar.contains(e.relatedTarget)) {
        dropzone.classList.remove('active');
      }
    });

    sidebar.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    sidebar.addEventListener('drop', async (e) => {
      dropzone.classList.remove('active');

      if (!e.dataTransfer.types.includes('Files')) return;

      e.preventDefault();

      const files = Array.from(e.dataTransfer.files);
      const videoPaths = files
        .filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f.path))
        .map(f => f.path);

      if (videoPaths.length > 0) {
        const playlistManager = getPlaylistManager();

        if (!playlistManager.isActive()) {
          playlistManager.createNew();
        }

        try {
          const added = await playlistManager.addItems(videoPaths);
          if (added.length > 0) {
            showToast(`${added.length}개 파일이 추가되었습니다.`, 'success');
          }
          updatePlaylistUI();
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    });
  }

  // 추가 영역 드래그 앤 드롭
  function initPlaylistAddZoneDragDrop() {
    const addZone = elements.playlistAddZone;
    if (!addZone) return;

    addZone.addEventListener('dragenter', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        addZone.classList.add('drag-over');
      }
    });

    addZone.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    addZone.addEventListener('dragleave', (e) => {
      if (!addZone.contains(e.relatedTarget)) {
        addZone.classList.remove('drag-over');
      }
    });

    addZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      addZone.classList.remove('drag-over');

      const files = Array.from(e.dataTransfer.files);
      const videoPaths = files
        .filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f.path))
        .map(f => f.path);

      if (videoPaths.length > 0) {
        const playlistManager = getPlaylistManager();

        if (!playlistManager.isActive()) {
          playlistManager.createNew();
        }

        try {
          const added = await playlistManager.addItems(videoPaths);
          if (added.length > 0) {
            showToast(`${added.length}개 파일이 추가되었습니다.`, 'success');
          }
          exitPlaylistAddMode();
          updatePlaylistUI();
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    });
  }

  // 순서 변경 드래그 앤 드롭
  function initPlaylistDragReorder() {
    const container = elements.playlistItems;
    if (!container) return;

    let draggedItem = null;
    let draggedIndex = -1;
    let isDragFromHandle = false;

    // 드래그 핸들에서 mousedown 시 플래그 설정
    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.playlist-item-drag-handle')) {
        isDragFromHandle = true;
      } else {
        isDragFromHandle = false;
      }
    });

    container.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.playlist-item');
      if (!item) return;

      // 드래그 핸들에서 시작한 경우만 허용
      if (!isDragFromHandle) {
        e.preventDefault();
        return;
      }

      draggedItem = item;
      draggedIndex = parseInt(item.dataset.index);

      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.id);
    });

    container.addEventListener('dragend', () => {
      if (draggedItem) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
        draggedIndex = -1;
      }
      isDragFromHandle = false;

      // 플레이스홀더 제거
      container.querySelectorAll('.drag-placeholder').forEach(el => el.remove());
    });

    container.addEventListener('dragover', (e) => {
      if (!draggedItem) return;
      e.preventDefault();

      const afterElement = getDragAfterElement(container, e.clientY);
      let placeholder = container.querySelector('.drag-placeholder');

      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'drag-placeholder';
      }

      if (afterElement) {
        container.insertBefore(placeholder, afterElement);
      } else {
        container.appendChild(placeholder);
      }
    });

    container.addEventListener('drop', (e) => {
      const placeholder = container.querySelector('.drag-placeholder');
      if (!placeholder || draggedIndex === -1) return;

      e.preventDefault();

      // 새 인덱스 계산
      const items = [...container.querySelectorAll('.playlist-item:not(.dragging)')];
      let toIndex = items.indexOf(placeholder.nextElementSibling);
      if (toIndex === -1) toIndex = items.length;

      placeholder.remove();

      if (toIndex !== draggedIndex) {
        const playlistManager = getPlaylistManager();
        playlistManager.reorderItem(draggedIndex, toIndex > draggedIndex ? toIndex - 1 : toIndex);
        updatePlaylistUI();
      }
    });

    function getDragAfterElement(container, y) {
      const items = [...container.querySelectorAll('.playlist-item:not(.dragging)')];

      return items.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
          return { offset, element: child };
        } else {
          return closest;
        }
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
  }

  // 리사이저
  function initPlaylistResizer() {
    const resizer = elements.playlistResizer;
    const sidebar = elements.playlistSidebar;
    if (!resizer || !sidebar) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const diff = e.clientX - startX;
      const newWidth = Math.max(240, Math.min(400, startWidth + diff));
      sidebar.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }
}

// DOM 로드 완료 시 앱 초기화
document.addEventListener('DOMContentLoaded', initApp);
