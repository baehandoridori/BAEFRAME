/**
 * baeframe - Renderer App Entry Point
 */

import { createLogger, setupGlobalErrorHandlers } from './logger.js';
import { VideoPlayer } from './modules/video-player.js';
import { Timeline } from './modules/timeline.js';
import { DrawingManager, DrawingTool } from './modules/drawing-manager.js';

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

    // 뷰어
    dropZone: document.getElementById('dropZone'),
    videoWrapper: document.getElementById('videoWrapper'),
    videoPlayer: document.getElementById('videoPlayer'),
    drawingCanvas: document.getElementById('drawingCanvas'),
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
    toastContainer: document.getElementById('toastContainer')
  };

  // 상태
  const state = {
    isDrawMode: false,
    currentFile: null
  };

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
    canvas: elements.drawingCanvas
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

    log.info('비디오 정보', { duration, totalFrames, fps });
  });

  // 비디오 시간 업데이트
  videoPlayer.addEventListener('timeupdate', (e) => {
    const { currentTime, currentFrame } = e.detail;
    timeline.setCurrentTime(currentTime);
    updateTimecodeDisplay();

    // 드로잉 매니저에 현재 프레임 전달 (재생 중 프레임 변경 시)
    drawingManager.setCurrentFrame(currentFrame);
  });

  // 비디오 재생 상태 변경
  videoPlayer.addEventListener('play', () => {
    elements.btnPlay.textContent = '⏸';
    drawingManager.setPlaying(true);
  });

  videoPlayer.addEventListener('pause', () => {
    elements.btnPlay.textContent = '▶';
    drawingManager.setPlaying(false);
  });

  videoPlayer.addEventListener('ended', () => {
    elements.btnPlay.textContent = '▶';
    drawingManager.setPlaying(false);
  });

  // 비디오 에러
  videoPlayer.addEventListener('error', (e) => {
    showToast('비디오 재생 오류가 발생했습니다.', 'error');
  });

  // 타임라인에서 시간 이동 요청
  timeline.addEventListener('seek', (e) => {
    videoPlayer.seek(e.detail.time);
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

  // ====== 이벤트 리스너 설정 ======

  // 파일 열기 버튼
  elements.btnOpenFile.addEventListener('click', async () => {
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

  // 댓글 추가
  elements.btnAddComment.addEventListener('click', () => {
    elements.commentInput.focus();
  });

  // 링크 복사
  elements.btnCopyLink.addEventListener('click', async () => {
    if (!state.currentFile) {
      showToast('먼저 파일을 열어주세요.', 'warn');
      return;
    }
    const link = `baeframe://${state.currentFile}`;
    await window.electronAPI.copyToClipboard(link);
    showToast('링크가 복사되었습니다!', 'success');
    log.info('링크 복사됨', { link });
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

  // 필터 칩
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', function() {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      log.debug('필터 변경', { filter: this.dataset.filter });
    });
  });

  // 그리기 도구 선택
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
      const tool = toolMap[this.dataset.tool] || DrawingTool.PEN;
      drawingManager.setTool(tool);
      log.debug('도구 선택', { tool: this.dataset.tool });
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

  // 브러쉬 사이즈 슬라이더
  const brushSizeSlider = document.getElementById('brushSizeSlider');
  const brushSizeValue = document.getElementById('brushSizeValue');
  const sizePreview = document.getElementById('sizePreview');

  function updateSizePreview() {
    const size = brushSizeSlider.value;
    brushSizeValue.textContent = `${size}px`;
    sizePreview.style.setProperty('--preview-size', `${Math.min(size, 20)}px`);
    sizePreview.style.setProperty('--preview-color', currentColor);
  }

  brushSizeSlider.addEventListener('input', function() {
    const size = parseInt(this.value);
    drawingManager.setLineWidth(size);
    updateSizePreview();
  });

  // 초기 사이즈 프리뷰 설정
  updateSizePreview();

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

  onionToggle.addEventListener('click', () => {
    const isActive = onionToggle.classList.toggle('active');
    onionToggle.textContent = isActive ? 'ON' : 'OFF';
    onionControls.classList.toggle('visible', isActive);
    drawingManager.setOnionSkin(isActive, {
      before: parseInt(onionBefore.value),
      after: parseInt(onionAfter.value),
      opacity: parseInt(onionOpacity.value) / 100
    });
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

    if (!renderArea || !canvas) {
      return;
    }

    // 캔버스 위치와 크기를 비디오 실제 렌더 영역에 맞춤
    canvas.style.position = 'absolute';
    canvas.style.left = `${renderArea.left}px`;
    canvas.style.top = `${renderArea.top}px`;
    canvas.style.width = `${renderArea.width}px`;
    canvas.style.height = `${renderArea.height}px`;

    // 캔버스의 내부 해상도를 비디오 원본 해상도에 맞춤 (고해상도 드로잉)
    canvas.width = renderArea.videoWidth;
    canvas.height = renderArea.videoHeight;

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

      // 비디오 플레이어에 로드
      await videoPlayer.load(filePath);

      state.currentFile = filePath;
      elements.fileName.textContent = fileInfo.name;
      elements.filePath.textContent = fileInfo.dir;
      elements.dropZone.classList.add('hidden');

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

      showToast(`"${fileInfo.name}" 로드됨`, 'success');
      trace.end({ filePath });

    } catch (error) {
      trace.error(error);
      showToast('파일을 로드할 수 없습니다.', 'error');
    }
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
   * 비디오 파일 확인
   */
  function isVideoFile(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext);
  }

  /**
   * 토스트 메시지 표시
   */
  function showToast(message, type = 'info', duration = 3000) {
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
   * 리사이저 설정
   */
  function setupResizer(resizer, direction, onResize) {
    let isResizing = false;
    let startPos = 0;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startPos = direction === 'col' ? e.clientX : e.clientY;
      resizer.classList.add('dragging');
      document.body.style.cursor = direction === 'col' ? 'col-resize' : 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const currentPos = direction === 'col' ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      startPos = currentPos;
      onResize(delta);
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = 'default';
      }
    });
  }

  /**
   * 키보드 단축키 처리
   */
  function handleKeydown(e) {
    // 입력 필드에서는 단축키 무시
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        videoPlayer.togglePlay();
        break;

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

      case 'Home':
        e.preventDefault();
        videoPlayer.seekToStart();
        break;

      case 'End':
        e.preventDefault();
        videoPlayer.seekToEnd();
        break;

      case 'KeyD':
        e.preventDefault();
        toggleDrawMode();
        break;

      case 'KeyC':
        if (!e.ctrlKey) {
          e.preventDefault();
          elements.commentInput.focus();
        }
        break;

      case 'F6':
        // 키프레임 복제 추가 (이전 내용 복사)
        e.preventDefault();
        if (state.isDrawMode) {
          drawingManager.addKeyframeWithContent();
          showToast('키프레임 추가됨', 'success');
        }
        break;

      case 'F7':
        // 빈 키프레임 추가
        e.preventDefault();
        if (state.isDrawMode) {
          drawingManager.addBlankKeyframe();
          showToast('빈 키프레임 추가됨', 'success');
        }
        break;

      case 'Delete':
      case 'Backspace':
        // 키프레임 삭제 (그리기 모드에서만)
        if (state.isDrawMode && !e.ctrlKey) {
          e.preventDefault();
          drawingManager.removeKeyframe();
        }
        break;

      case 'Slash':
        if (e.shiftKey) { // ?
          e.preventDefault();
          elements.shortcutsToggle.click();
        }
        break;

      case 'Backslash':
        e.preventDefault();
        timeline.fitToView();
        break;

      case 'Equal':
      case 'NumpadAdd':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          timeline.zoomIn();
        }
        break;

      case 'Minus':
      case 'NumpadSubtract':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          timeline.zoomOut();
        }
        break;
    }
  }

  // 초기화 완료
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
