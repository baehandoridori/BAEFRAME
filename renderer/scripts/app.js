/**
 * baeframe - Renderer App Entry Point
 */

import { createLogger, setupGlobalErrorHandlers } from './logger.js';

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
    isPlaying: false,
    isDrawMode: false,
    currentFile: null,
    fps: 24,
    currentFrame: 0,
    totalFrames: 0
  };

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
  elements.btnPlay.addEventListener('click', togglePlay);

  // 프레임 이동
  elements.btnFirst.addEventListener('click', () => seekFrame(0));
  elements.btnPrevFrame.addEventListener('click', () => seekFrame(state.currentFrame - 1));
  elements.btnNextFrame.addEventListener('click', () => seekFrame(state.currentFrame + 1));
  elements.btnLast.addEventListener('click', () => seekFrame(state.totalFrames - 1));

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
      log.debug('도구 선택', { tool: this.dataset.tool });
    });
  });

  // 색상 선택
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      log.debug('색상 선택', { color: this.dataset.color });
    });
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
    }
  });

  // 키보드 단축키
  document.addEventListener('keydown', handleKeydown);

  // ====== 헬퍼 함수 ======

  /**
   * 비디오 파일 로드
   */
  async function loadVideo(filePath) {
    const trace = log.trace('loadVideo');
    try {
      const fileInfo = await window.electronAPI.getFileInfo(filePath);

      state.currentFile = filePath;
      elements.fileName.textContent = fileInfo.name;
      elements.filePath.textContent = fileInfo.dir;
      elements.dropZone.classList.add('hidden');

      // 버전 감지
      const versionMatch = fileInfo.name.match(/_v(\d+)/i);
      if (versionMatch) {
        elements.versionBadge.textContent = `v${versionMatch[1]}`;
        elements.versionBadge.style.display = 'inline-block';
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
   * 재생/일시정지 토글
   */
  function togglePlay() {
    state.isPlaying = !state.isPlaying;
    elements.btnPlay.textContent = state.isPlaying ? '⏸' : '▶';
    log.debug('재생 상태 변경', { isPlaying: state.isPlaying });
  }

  /**
   * 프레임 이동
   */
  function seekFrame(frame) {
    frame = Math.max(0, Math.min(frame, state.totalFrames - 1));
    state.currentFrame = frame;
    updateTimecode();
    log.debug('프레임 이동', { frame });
  }

  /**
   * 타임코드 업데이트
   */
  function updateTimecode() {
    const current = frameToTimecode(state.currentFrame, state.fps);
    const total = frameToTimecode(state.totalFrames, state.fps);
    elements.timecodeCurrent.textContent = current;
    elements.timecodeTotal.textContent = total;
    elements.frameIndicator.textContent = `${state.fps}fps · Frame ${state.currentFrame} / ${state.totalFrames}`;
  }

  /**
   * 프레임을 타임코드로 변환
   */
  function frameToTimecode(frame, fps) {
    const totalSeconds = frame / fps;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const frames = frame % fps;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
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
        togglePlay();
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) {
          seekFrame(state.currentFrame - state.fps); // 1초 뒤로
        } else {
          seekFrame(state.currentFrame - 1);
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) {
          seekFrame(state.currentFrame + state.fps); // 1초 앞으로
        } else {
          seekFrame(state.currentFrame + 1);
        }
        break;

      case 'Home':
        e.preventDefault();
        seekFrame(0);
        break;

      case 'End':
        e.preventDefault();
        seekFrame(state.totalFrames - 1);
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

      case 'Slash':
        if (e.shiftKey) { // ?
          e.preventDefault();
          elements.shortcutsToggle.click();
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
